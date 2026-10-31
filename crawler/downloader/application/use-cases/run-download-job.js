'use strict';

const { AuthRequiredError } = require('../../domain/errors/auth-required-error');
const { DomainError } = require('../../domain/errors/domain-error');
const { DownloadError } = require('../../domain/errors/download-error');
const { ForwardError } = require('../../domain/errors/forward-error');
const { TimeoutError } = require('../../domain/errors/timeout-error');
const { ContentHash } = require('../../domain/value-objects/content-hash');
const { JOB_STATUS } = require('../../domain/value-objects/job-status');
const { detectAuthRequired } = require('../../domain/policies/auth-required');
const { detectContentFormat } = require('../../domain/policies/content-format');
const {
  DOWNLOAD_STRATEGY,
  selectDownloadStrategy,
} = require('../../domain/policies/download-strategy');
const { isValidManifest } = require('../../domain/policies/manifest-policy');
const { shouldProbeBeforeDownload } = require('../../domain/policies/probe-policy');

class RunDownloadJob {
  constructor({
    sourceProbe,
    contentDownloader,
    contentStorage,
    manifestRepository,
    clock,
    logger = null,
    statsCollector = null,
    robotsPolicy = null,
    contentForwarder = null,
    config,
  }) {
    this.contentForwarder = contentForwarder;
    this.sourceProbe = sourceProbe;
    this.contentDownloader = contentDownloader;
    this.contentStorage = contentStorage;
    this.manifestRepository = manifestRepository;
    this.clock = clock;
    this.logger = logger;
    this.statsCollector = statsCollector;
    this.robotsPolicy = robotsPolicy;
    this.config = config;
  }

  async execute(job) {
    let workingJob = job;

    try {
      workingJob = workingJob.transition(JOB_STATUS.DOWNLOADING, { now: this.clock.now() });
      this.logger?.info('download_job_started', { jobId: job.jobId, urlKey: job.urlKey });

      const manifestState = await this.loadManifestState(job);
      const previousManifest = manifestState.manifest;
      const manifestInvalid = manifestState.invalid;
      const conditionalHeaders = buildConditionalHeaders(previousManifest, job.force);

      if (this.robotsPolicy) {
        await this.robotsPolicy.assertAllowed(job.normalizedUrl);
      }

      const shouldProbe = shouldProbeBeforeDownload({
        url: job.normalizedUrl,
        mode: this.config.probeMode,
      });
      let strategy;
      if (shouldProbe) {
        const probe = await this.sourceProbe.head(job.normalizedUrl, conditionalHeaders);
        this.throwIfAuthRequired({ finalUrl: probe.finalUrl, httpStatus: probe.status });
        strategy = selectDownloadStrategy({ url: job.normalizedUrl, probe });

        if (previousManifest && !job.force && isNotModifiedProbe(probe, previousManifest)) {
          // HEAD đã xác nhận representation không đổi (304 hoặc cùng ETag/
          // Last-Modified) nên không cần GET lại nội dung cho cả HTML và file.
          return await this.completeNotModified(
            workingJob,
            previousManifest,
            probe.status ?? 304,
          );
        }
      } else {
        strategy = selectDownloadStrategy({ url: job.normalizedUrl, probe: null });
      }

      const isFileStrategy = strategy === DOWNLOAD_STRATEGY.FILE;
      const maxBytes = isFileStrategy ? this.config.maxFileBytes : this.config.maxHtmlBytes;
      const timeoutMs = isFileStrategy ? this.config.fileTimeoutMs : this.config.htmlTimeoutMs;
      const downloadHeaders = isFileStrategy ? conditionalHeaders : {};

      const downloadedContent = await this.contentDownloader.download(job.normalizedUrl, {
        strategy,
        headers: downloadHeaders,
        maxBytes,
        timeoutMs,
      });

      if (downloadedContent.notModified) {
        if (!previousManifest) {
          throw new DownloadError('Nguồn trả 304 nhưng chưa có manifest trước đó');
        }
        return await this.completeNotModified(
          workingJob,
          previousManifest,
          downloadedContent.httpStatus ?? 304,
        );
      }

      this.throwIfAuthRequired({
        finalUrl: downloadedContent.finalUrl,
        httpStatus: downloadedContent.httpStatus,
      });

      workingJob = workingJob.transition(JOB_STATUS.STORING, { now: this.clock.now() });

      const contentHash = ContentHash.fromHex(downloadedContent.sha256);
      const objectKey = `raw/${contentHash.value}`;
      const formatInfo = detectContentFormat({
        url: downloadedContent.finalUrl,
        contentType: downloadedContent.contentType,
        bytes: downloadedContent.bytes,
      });
      const contentType = downloadedContent.contentType || 'application/octet-stream';
      const size = downloadedContent.size ?? downloadedContent.bytes.length;

      const objectAlreadyExists = await this.contentStorage.exists(objectKey);
      if (!objectAlreadyExists) {
        await this.contentStorage.put(objectKey, downloadedContent.bytes, contentType);
      }

      const previousSha256 = previousManifest?.sha256 ?? null;
      const contentChanged = previousSha256 !== null && previousSha256 !== contentHash.value;
      const redownloaded = previousSha256 !== null && previousSha256 === contentHash.value;
      const duplicateContent = objectAlreadyExists;
      const fetchedAt = this.clock.now().toISOString();

      const manifest = {
        url: job.url,
        finalUrl: downloadedContent.finalUrl,
        urlKey: job.urlKey,
        sha256: contentHash.value,
        objectKey,
        format: formatInfo.format,
        contentType,
        extension: formatInfo.extension,
        size,
        etag: downloadedContent.etag ?? null,
        lastModified: downloadedContent.lastModified ?? null,
        fetchedAt,
        jobId: job.jobId,
      };

      await this.manifestRepository.put(job.urlKey, manifest);

      const forwardOutcome = await this.forwardContent(job, {
        format: formatInfo.format,
        contentType,
        bytes: downloadedContent.bytes,
      });

      const result = {
        ...forwardOutcome,
        finalUrl: downloadedContent.finalUrl,
        format: formatInfo.format,
        contentType,
        extension: formatInfo.extension,
        objectKey,
        size,
        sha256: contentHash.value,
        httpStatus: downloadedContent.httpStatus,
        fetchedAt,
        deduplicated: false,
        notModified: false,
        authRequired: false,
        manifestInvalid,
        redownloaded,
        contentChanged,
        duplicateContent,
        forced: job.force,
        previousSha256,
        previousFetchedAt: previousManifest?.fetchedAt ?? null,
        etag: downloadedContent.etag ?? null,
        lastModified: downloadedContent.lastModified ?? null,
      };

      const completedJob = workingJob.transition(JOB_STATUS.DONE, {
        result,
        now: this.clock.now(),
      });

      this.statsCollector?.recordJobDone(result);
      this.logger?.info('download_job_done', {
        jobId: job.jobId,
        urlKey: job.urlKey,
        format: result.format,
        extension: result.extension,
        size: result.size,
        notModified: false,
        contentChanged,
        duplicateContent,
      });

      return completedJob;
    } catch (error) {
      const domainError = this.mapAuthRequiredError(toDomainError(error));
      const jobError = {
        code: domainError.code,
        message: domainError.message,
      };
      if (domainError.details?.finalUrl) {
        jobError.finalUrl = domainError.details.finalUrl;
      }

      let failedJob;
      try {
        failedJob = workingJob.transition(JOB_STATUS.FAILED, {
          error: jobError,
          now: this.clock.now(),
        });
      } catch (transitionError) {
        this.logger?.error('download_job_failure_transition_failed', {
          jobId: job.jobId,
          urlKey: job.urlKey,
          errorCode: transitionError.code ?? 'unknown',
        });
        return workingJob;
      }

      this.statsCollector?.recordJobFailed(domainError);
      this.logger?.error('download_job_failed', {
        jobId: job.jobId,
        urlKey: job.urlKey,
        errorCode: domainError.code,
      });
      return failedJob;
    }
  }

  async loadManifestState(job) {
    let manifest;
    try {
      manifest = await this.manifestRepository.get(job.urlKey);
    } catch (error) {
      if (error?.code === 'manifest_invalid') {
        this.reportInvalidManifest(job, 'invalid_json');
        return { manifest: null, invalid: true };
      }
      throw error;
    }

    if (manifest !== null && !isValidManifest(manifest)) {
      this.reportInvalidManifest(job, 'schema_invalid');
      return { manifest: null, invalid: true };
    }

    return { manifest, invalid: false };
  }

  reportInvalidManifest(job, reason) {
    this.logger?.warn('download_manifest_invalid', {
      jobId: job.jobId,
      urlKey: job.urlKey,
      reason,
    });
  }

  throwIfAuthRequired({ finalUrl, httpStatus }) {
    const authRequirement = detectAuthRequired({
      finalUrl,
      httpStatus,
      loginPathSegments: this.config.authLoginPathSegments,
    });
    if (!authRequirement.required) {
      return;
    }

    throw new AuthRequiredError('Nguồn yêu cầu đăng nhập để truy cập nội dung', {
      finalUrl,
      reason: authRequirement.reason,
    });
  }

  mapAuthRequiredError(error) {
    if (error instanceof AuthRequiredError || !(error instanceof DownloadError)) {
      return error;
    }

    const authRequirement = detectAuthRequired({
      finalUrl: error.details?.finalUrl ?? null,
      httpStatus: error.upstreamStatus ?? null,
      loginPathSegments: this.config.authLoginPathSegments,
    });
    if (!authRequirement.required) {
      return error;
    }

    return new AuthRequiredError('Nguồn yêu cầu đăng nhập để truy cập nội dung', {
      cause: error,
      finalUrl: error.details?.finalUrl ?? null,
      reason: authRequirement.reason,
    });
  }

  /**
   * Chuyển nội dung sang module đọc nếu đã cấu hình. Lỗi khi chuyển không làm job
   * thất bại: nội dung đã nằm trong storage, kết quả job ghi lại trạng thái chuyển.
   */
  async forwardContent(job, { format, contentType, bytes = null, loadBytes = null }) {
    if (!this.contentForwarder) {
      return { forwarded: null, forwardError: null };
    }

    try {
      const contentBytes = bytes ?? (await loadBytes?.());
      if (!contentBytes) {
        throw new ForwardError('Không đọc lại được nội dung đã lưu để chuyển sang module đọc');
      }

      const { httpStatus } = await this.contentForwarder.forward({
        url: job.url,
        format,
        contentType,
        bytes: contentBytes,
      });
      this.statsCollector?.recordForwarded();
      this.logger?.info('content_forwarded', {
        jobId: job.jobId,
        urlKey: job.urlKey,
        format,
        size: contentBytes.length,
        httpStatus,
      });
      return { forwarded: true, forwardError: null };
    } catch (error) {
      const domainError = error instanceof DomainError ? error : new ForwardError(undefined, { cause: error });
      this.statsCollector?.recordForwardFailed(domainError);
      this.logger?.warn('content_forward_failed', {
        jobId: job.jobId,
        urlKey: job.urlKey,
        errorCode: domainError.code,
        upstreamStatus: domainError.upstreamStatus ?? null,
      });
      return {
        forwarded: false,
        forwardError: { code: domainError.code, message: domainError.message },
      };
    }
  }

  async completeNotModified(workingJob, manifest, httpStatus) {
    const storingJob = workingJob.transition(JOB_STATUS.STORING, { now: this.clock.now() });
    const forwardOutcome = await this.forwardContent(workingJob, {
      format: manifest.format,
      contentType: manifest.contentType,
      loadBytes: () => this.contentStorage.getObject(manifest.objectKey),
    });
    const result = {
      ...forwardOutcome,
      finalUrl: manifest.finalUrl,
      format: manifest.format,
      contentType: manifest.contentType,
      extension: manifest.extension,
      objectKey: manifest.objectKey,
      size: manifest.size,
      sha256: manifest.sha256,
      httpStatus,
      fetchedAt: manifest.fetchedAt,
      deduplicated: false,
      notModified: true,
      authRequired: false,
      manifestInvalid: false,
      redownloaded: false,
      contentChanged: false,
      duplicateContent: false,
      forced: workingJob.force,
      previousSha256: manifest.sha256,
      previousFetchedAt: manifest.fetchedAt,
      etag: manifest.etag ?? null,
      lastModified: manifest.lastModified ?? null,
    };

    const completedJob = storingJob.transition(JOB_STATUS.DONE, {
      result,
      now: this.clock.now(),
    });

    this.statsCollector?.recordNotModified(result);
    this.logger?.info('download_job_not_modified', {
      jobId: workingJob.jobId,
      urlKey: workingJob.urlKey,
      format: result.format,
      extension: result.extension,
      size: result.size,
    });
    return completedJob;
  }
}

function buildConditionalHeaders(manifest, force) {
  if (!manifest || force) {
    return {};
  }

  const headers = {};
  if (manifest.etag) {
    headers['If-None-Match'] = manifest.etag;
  }
  if (manifest.lastModified) {
    headers['If-Modified-Since'] = manifest.lastModified;
  }
  return headers;
}

function isNotModifiedProbe(probe, manifest) {
  if (!probe) {
    return false;
  }
  if (probe.status === 304) {
    return true;
  }
  if (probe.etag && manifest.etag && probe.etag === manifest.etag) {
    return true;
  }
  if (probe.lastModified && manifest.lastModified && probe.lastModified === manifest.lastModified) {
    return true;
  }
  return false;
}

function toDomainError(error) {
  if (error instanceof DomainError) {
    return error;
  }
  if (error?.name === 'AbortError') {
    return new TimeoutError('Tải nội dung quá thời gian cho phép', { cause: error });
  }
  return new DownloadError('Lỗi không xác định khi tải nội dung', {
    cause: error,
    retryable: false,
  });
}

module.exports = { RunDownloadJob, buildConditionalHeaders, isNotModifiedProbe };
