'use strict';

const fs = require('node:fs');
const { S3Client } = require('@aws-sdk/client-s3');
const { createConfig, loadOptionalEnvFile } = require('./config/env');
const { createConsoleLogger } = require('./adapters/outbound/observability/console-logger');
const { StatsCollector } = require('./adapters/outbound/observability/stats-collector');
const { systemClock } = require('./adapters/outbound/observability/system-clock');
const { DnsUrlPolicy } = require('./adapters/outbound/network/dns-url-policy');
const { HostGate } = require('./adapters/outbound/network/host-gate');
const { HttpSourceProbe } = require('./adapters/outbound/network/http-source-probe');
const { RobotsPolicy } = require('./adapters/outbound/network/robots-policy');
const { HttpFileDownloader } = require('./adapters/outbound/downloaders/http-file-downloader');
const { BrowserPool } = require('./adapters/outbound/downloaders/browser-pool');
const { PuppeteerHtmlDownloader } = require('./adapters/outbound/downloaders/puppeteer-html-downloader');
const { CompositeDownloader } = require('./adapters/outbound/downloaders/composite-downloader');
const { RetryingDownloader } = require('./adapters/outbound/downloaders/retrying-downloader');
const { LoggingDownloader } = require('./adapters/outbound/downloaders/logging-downloader');
const { MinioContentStorage } = require('./adapters/outbound/storage/minio-content-storage');
const { MinioManifestRepository } = require('./adapters/outbound/storage/minio-manifest-repository');
const { MinioBucketInitializer } = require('./adapters/outbound/storage/minio-bucket-initializer');
const { InMemoryJobQueue } = require('./adapters/outbound/queue/in-memory-job-queue');
const { HttpContentForwarder } = require('./adapters/outbound/reader/http-content-forwarder');
const { SubmitDownloadJob } = require('./application/use-cases/submit-download-job');
const { RunDownloadJob } = require('./application/use-cases/run-download-job');
const { GetJobStatus } = require('./application/use-cases/get-job-status');
const { createDownloadController } = require('./adapters/inbound/http/download-controller');
const { createHealthController } = require('./adapters/inbound/http/health-controller');
const { createStatsController } = require('./adapters/inbound/http/stats-controller');
const { createApp } = require('./app');

const LOCAL_CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

function createS3Client({ endpoint, region, accessKey, secretKey, forcePathStyle }) {
  return new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle,
  });
}

function resolveChromeExecutable(configuredPath) {
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }
  return LOCAL_CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? configuredPath;
}

function createContainer({ config, logger = null, overrides = {} } = {}) {
  const clock = overrides.clock ?? systemClock;
  const activeLogger =
    logger ??
    createConsoleLogger({
      level: config.logLevel,
      service: 'content-downloader',
      now: () => clock.now(),
    });
  const statsCollector =
    overrides.statsCollector ?? new StatsCollector({ now: () => clock.now() });

  const urlPolicy =
    overrides.urlPolicy ??
    new DnsUrlPolicy({
      allowedDomains: config.allowedDomains,
    });
  const hostGate =
    overrides.hostGate ??
    new HostGate({
      delayMs: config.hostDelayMs,
      clock,
    });
  const sourceProbe =
    overrides.sourceProbe ??
    new HttpSourceProbe({
      urlPolicy,
      hostGate,
      timeoutMs: config.probeTimeoutMs,
      userAgent: config.userAgent,
    });

  let s3Client = null;
  let presignClient = null;
  if (!overrides.contentStorage || !overrides.manifestRepository) {
    s3Client = createS3Client(config.s3);
    presignClient =
      config.s3.publicEndpoint === config.s3.endpoint
        ? s3Client
        : createS3Client({
            ...config.s3,
            endpoint: config.s3.publicEndpoint,
          });
  }

  const contentStorage =
    overrides.contentStorage ??
    new MinioContentStorage({
      client: s3Client,
      presignClient,
      bucket: config.s3.bucket,
      logger: activeLogger,
    });
  const manifestRepository =
    overrides.manifestRepository ??
    new MinioManifestRepository({
      client: s3Client,
      bucket: config.s3.bucket,
      logger: activeLogger,
    });
  const bucketInitializer =
    overrides.bucketInitializer ??
    (s3Client
      ? new MinioBucketInitializer({
          client: s3Client,
          bucket: config.s3.bucket,
          logger: activeLogger,
        })
      : null);

  const jobQueue =
    overrides.jobQueue ??
    new InMemoryJobQueue({
      maxConcurrent: config.maxConcurrent,
      queueSize: config.queueSize,
      clock,
      logger: activeLogger,
      jobTtlMs: config.jobTtlMs,
      maxJobs: config.maxJobs,
    });

  let browserPool = overrides.browserPool ?? null;
  let contentDownloader = overrides.contentDownloader ?? null;
  if (!contentDownloader) {
    browserPool =
      browserPool ??
      new BrowserPool({
        executablePath: resolveChromeExecutable(config.chromeBin),
        maxPages: config.maxConcurrent,
        logger: activeLogger,
      });

    const htmlDownloader = new PuppeteerHtmlDownloader({
      browserPool,
      urlPolicy,
      hostGate,
      userAgent: config.userAgent,
      blockedResourceTypes: config.blockedResourceTypes,
      logger: activeLogger,
    });
    const fileDownloader = new HttpFileDownloader({
      urlPolicy,
      hostGate,
      userAgent: config.userAgent,
    });
    const compositeDownloader = new CompositeDownloader({
      htmlDownloader,
      fileDownloader,
    });
    const retryingDownloader = new RetryingDownloader({
      downloader: compositeDownloader,
      retryCount: config.retry.count,
      baseMs: config.retry.baseMs,
      maxMs: config.retry.maxMs,
      jitterMs: config.retry.jitterMs,
      logger: activeLogger,
    });
    contentDownloader = new LoggingDownloader({
      downloader: retryingDownloader,
      logger: activeLogger,
      clock,
    });
  }

  const robotsPolicy = config.respectRobots
    ? overrides.robotsPolicy ??
      new RobotsPolicy({
        urlPolicy,
        userAgent: config.userAgent,
        logger: activeLogger,
      })
    : null;

  const contentForwarder =
    overrides.contentForwarder ??
    (config.reader.url
      ? new HttpContentForwarder({
          readerUrl: config.reader.url,
          timeoutMs: config.reader.timeoutMs,
          retryCount: config.reader.retryCount,
          baseMs: config.retry.baseMs,
          maxMs: config.retry.maxMs,
          jitterMs: config.retry.jitterMs,
          logger: activeLogger,
        })
      : null);

  const submitDownloadJob = new SubmitDownloadJob({
    urlPolicy,
    jobQueue,
    clock,
    logger: activeLogger,
    statsCollector,
  });
  const runDownloadJob = new RunDownloadJob({
    sourceProbe,
    contentDownloader,
    contentStorage,
    manifestRepository,
    clock,
    logger: activeLogger,
    statsCollector,
    robotsPolicy,
    contentForwarder,
    config,
  });
  const getJobStatus = new GetJobStatus({
    jobQueue,
    contentStorage,
    presignTtlSeconds: config.presignTtlSeconds,
    logger: activeLogger,
  });

  jobQueue.setProcessor((job) => runDownloadJob.execute(job));

  const app = createApp({
    downloadController: createDownloadController({ submitDownloadJob, getJobStatus }),
    healthController: createHealthController({ jobQueue }),
    statsController: createStatsController({
      jobQueue,
      statsCollector,
      browserPool,
    }),
    logger: activeLogger,
  });

  return {
    app,
    config,
    logger: activeLogger,
    clock,
    statsCollector,
    jobQueue,
    urlPolicy,
    hostGate,
    sourceProbe,
    contentStorage,
    manifestRepository,
    bucketInitializer,
    contentDownloader,
    contentForwarder,
    browserPool,
    submitDownloadJob,
    runDownloadJob,
    getJobStatus,
    async close() {
      if (browserPool) {
        await browserPool.close();
      }
      if (s3Client && s3Client !== presignClient) {
        s3Client.destroy?.();
      }
      if (presignClient && presignClient !== s3Client) {
        presignClient.destroy?.();
      }
    },
  };
}

async function startApplication() {
  loadOptionalEnvFile();
  const config = createConfig();
  const container = createContainer({ config });
  await container.bucketInitializer?.ensureExists();

  const server = container.app.listen(config.port, '0.0.0.0', () => {
    container.logger.info('downloader_server_started', {
      port: config.port,
      nodeEnv: config.nodeEnv,
      queueSize: config.queueSize,
      maxConcurrent: config.maxConcurrent,
      isForwardingEnabled: Boolean(container.contentForwarder),
    });
  });

  let isShuttingDown = false;
  async function shutdown(signal) {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    container.logger.info('downloader_shutdown_started', { signal });
    const forceExitTimer = setTimeout(() => process.exit(1), 15_000);
    forceExitTimer.unref();

    server.close(async () => {
      try {
        await container.close();
        process.exit(0);
      } catch (error) {
        container.logger.error('downloader_shutdown_failed', {
          errorCode: error?.code ?? 'unknown',
        });
        process.exit(1);
      }
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { server, container };
}

if (require.main === module) {
  startApplication().catch((error) => {
    process.stderr.write(`Không thể khởi động dịch vụ tải nội dung: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  createContainer,
  startApplication,
  createS3Client,
  resolveChromeExecutable,
  LOCAL_CHROME_CANDIDATES,
};
