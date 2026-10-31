'use strict';

const { createConfig } = require('../../config/env');

function createTestConfig(overrides = {}) {
  return createConfig({
    NODE_ENV: 'test',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
    S3_BUCKET: 'downloader-test',
    MAX_FILE_BYTES: '1048576',
    MAX_HTML_BYTES: '1048576',
    MAX_CONCURRENT: '1',
    QUEUE_SIZE: '4',
    PROBE_MODE: 'always',
    PROBE_TIMEOUT_MS: '1000',
    HTML_TIMEOUT_MS: '1000',
    FILE_TIMEOUT_MS: '1000',
    RETRY_COUNT: '0',
    HOST_DELAY_MS: '0',
    CHROME_BIN: '/nonexistent/chromium',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

module.exports = { createTestConfig };
