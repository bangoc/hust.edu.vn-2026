'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LoggingDownloader } = require('../../adapters/outbound/downloaders/logging-downloader');

function createLogger() {
  const entries = [];
  return {
    entries,
    info(event, fields) {
      entries.push({ level: 'info', event, fields });
    },
    warn(event, fields) {
      entries.push({ level: 'warn', event, fields });
    },
  };
}

test('ghi log thành công với host, kích thước và thời lượng', async () => {
  const logger = createLogger();
  const times = [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:00.250Z')];
  const downloader = new LoggingDownloader({
    downloader: {
      async download() {
        return { httpStatus: 200, size: 123, notModified: false };
      },
    },
    logger,
    clock: { now: () => times.shift() },
  });

  const result = await downloader.download('https://hust.edu.vn/tin-tuc', { strategy: 'html' });

  assert.equal(result.size, 123);
  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].event, 'content_download_finished');
  assert.deepEqual(logger.entries[0].fields, {
    strategy: 'html',
    host: 'hust.edu.vn',
    httpStatus: 200,
    size: 123,
    notModified: false,
    durationMs: 250,
  });
});

test('ghi log thất bại và ném lại đúng lỗi gốc', async () => {
  const logger = createLogger();
  const times = [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-01T00:00:01.000Z')];
  const originalError = Object.assign(new Error('nguồn lỗi'), { code: 'render_error' });
  const downloader = new LoggingDownloader({
    downloader: {
      async download() {
        throw originalError;
      },
    },
    logger,
    clock: { now: () => times.shift() },
  });

  await assert.rejects(
    downloader.download('https://hust.edu.vn/tin-tuc', { strategy: 'html' }),
    (error) => error === originalError,
  );
  assert.equal(logger.entries.length, 1);
  assert.equal(logger.entries[0].event, 'content_download_failed');
  assert.equal(logger.entries[0].fields.host, 'hust.edu.vn');
  assert.equal(logger.entries[0].fields.errorCode, 'render_error');
  assert.equal(logger.entries[0].fields.durationMs, 1000);
});
