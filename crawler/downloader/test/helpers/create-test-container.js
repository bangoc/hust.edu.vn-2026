'use strict';

const { createContainer } = require('../../index');
const { createTestConfig } = require('./test-config');
const { FakeClock } = require('./fake-clock');
const { FakeUrlPolicy } = require('./fake-url-policy');
const { FakeSourceProbe } = require('./fake-source-probe');
const { FakeContentDownloader } = require('./fake-content-downloader');
const { MemoryContentStorage, MemoryManifestRepository } = require('./memory-storage');
const { InMemoryJobQueue } = require('../../adapters/outbound/queue/in-memory-job-queue');
const { silentLogger } = require('./silent-logger');

function createTestContainer({
  configOverrides = {},
  probes = {},
  responses = {},
  delayMs = 0,
  blockedHosts = [],
  logger = silentLogger,
} = {}) {
  const config = createTestConfig(configOverrides);
  const clock = new FakeClock();
  const contentStorage = new MemoryContentStorage({ bucket: config.s3.bucket });
  const manifestRepository = new MemoryManifestRepository();
  const urlPolicy = new FakeUrlPolicy({ blockedHosts });
  const sourceProbe = new FakeSourceProbe({ responses: probes });
  const contentDownloader = new FakeContentDownloader({ responses, delayMs });
  const jobQueue = new InMemoryJobQueue({
    maxConcurrent: config.maxConcurrent,
    queueSize: config.queueSize,
    clock,
    logger,
  });

  const container = createContainer({
    config,
    logger,
    overrides: {
      clock,
      urlPolicy,
      sourceProbe,
      contentDownloader,
      contentStorage,
      manifestRepository,
      jobQueue,
    },
  });

  return {
    container,
    config,
    clock,
    contentStorage,
    manifestRepository,
    urlPolicy,
    sourceProbe,
    contentDownloader,
    jobQueue,
  };
}

module.exports = { createTestContainer };
