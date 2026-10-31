'use strict';

const { Readable } = require('node:stream');
const { DomainError } = require('../../../domain/errors/domain-error');
const { DownloadError } = require('../../../domain/errors/download-error');
const { TooLargeError } = require('../../../domain/errors/too-large-error');
const { TimeoutError } = require('../../../domain/errors/timeout-error');
const { createContentHasher } = require('../../../domain/value-objects/content-hash');
const { isRetryableError, RETRYABLE_HTTP_STATUSES } = require('../../../domain/policies/retry-policy');
const { isRedirectStatus, resolveRedirectUrl } = require('../network/redirect');

const DEFAULT_USER_AGENT = 'HUST-Content-Downloader/1.0';

class HttpFileDownloader {
  constructor({
    urlPolicy,
    hostGate = null,
    fetchImpl = globalThis.fetch,
    userAgent = DEFAULT_USER_AGENT,
    maxRedirects = 5,
  }) {
    if (!urlPolicy) {
      throw new DomainError('missing_url_policy', 'HttpFileDownloader cần urlPolicy');
    }
    if (typeof fetchImpl !== 'function') {
      throw new DomainError('missing_fetch', 'Môi trường không có fetch');
    }

    this.urlPolicy = urlPolicy;
    this.hostGate = hostGate;
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
    this.maxRedirects = maxRedirects;
  }

  async download(url, { headers = {}, maxBytes, timeoutMs }) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new DomainError('invalid_max_bytes', 'maxBytes phải là số dương');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new DomainError('invalid_timeout', 'timeoutMs phải là số dương');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let currentUrl = url;

    try {
      for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
        await this.urlPolicy.assertAllowed(currentUrl);
        if (this.hostGate) {
          await this.hostGate.waitForUrl(currentUrl);
        }

        let response;
        try {
          response = await this.fetchImpl(currentUrl, {
            method: 'GET',
            headers: {
              'user-agent': this.userAgent,
              accept: '*/*',
              ...headers,
            },
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch (error) {
          throw mapFetchError(error, controller.signal.aborted);
        }

        if (response.status === 304) {
          await response.body?.cancel().catch(() => undefined);
          return {
            bytes: Buffer.alloc(0),
            notModified: true,
            sha256: null,
            contentType: response.headers.get('content-type'),
            finalUrl: currentUrl,
            httpStatus: 304,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
            size: 0,
          };
        }

        if (isRedirectStatus(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => undefined);
          if (!location) {
            throw new DownloadError('Nguồn trả redirect nhưng thiếu Location header', {
              upstreamStatus: response.status,
            });
          }
          if (redirectCount === this.maxRedirects) {
            throw new DownloadError('Nguồn redirect quá số lần cho phép', {
              upstreamStatus: response.status,
            });
          }
          currentUrl = resolveRedirectUrl(location, currentUrl);
          continue;
        }

        if (response.status >= 400) {
          await response.body?.cancel().catch(() => undefined);
          throw new DownloadError(`Nguồn trả HTTP ${response.status}`, {
            upstreamStatus: response.status,
            retryable: RETRYABLE_HTTP_STATUSES.has(response.status),
            details: {
              retryAfter: response.headers.get('retry-after'),
              finalUrl: currentUrl,
            },
          });
        }

        const declaredLength = parseContentLength(response.headers.get('content-length'));
        if (declaredLength !== null && declaredLength > maxBytes) {
          await response.body?.cancel().catch(() => undefined);
          throw new TooLargeError(
            `Nội dung khai báo ${declaredLength} byte, vượt giới hạn ${maxBytes} byte`,
          );
        }

        const { bytes, size, sha256 } = await readResponseBody(response, maxBytes, controller);

        return {
          bytes,
          notModified: false,
          sha256,
          contentType: response.headers.get('content-type'),
          finalUrl: currentUrl,
          httpStatus: response.status,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          size,
        };
      }

      throw new DownloadError('Nguồn redirect quá số lần cho phép');
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readResponseBody(response, maxBytes, controller) {
  const contentHash = createContentHasher();

  if (!response.body) {
    return { bytes: Buffer.alloc(0), size: 0, sha256: contentHash.digest().value };
  }

  const chunks = [];
  let totalBytes = 0;

  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        controller.abort();
        throw new TooLargeError(`Nội dung vượt giới hạn ${maxBytes} byte`);
      }
      contentHash.update(chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new TimeoutError('Tải nội dung quá thời gian cho phép', { cause: error });
    }
    throw error;
  }

  return {
    bytes: Buffer.concat(chunks, totalBytes),
    size: totalBytes,
    sha256: contentHash.digest().value,
  };
}

function parseContentLength(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mapFetchError(error, isAborted) {
  if (error instanceof DomainError) {
    return error;
  }
  if (isAborted || error?.name === 'AbortError') {
    return new TimeoutError('Tải nội dung quá thời gian cho phép', { cause: error });
  }
  return new DownloadError('Không thể tải nội dung', {
    cause: error,
    retryable: isRetryableError(error),
  });
}

module.exports = {
  HttpFileDownloader,
  DEFAULT_USER_AGENT,
  parseContentLength,
  readResponseBody,
};
