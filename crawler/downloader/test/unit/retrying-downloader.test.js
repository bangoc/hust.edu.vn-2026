'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RetryingDownloader } = require('../../adapters/outbound/downloaders/retrying-downloader');
const { DownloadError } = require('../../domain/errors/download-error');
const { createCaptureLogger } = require('../helpers/capture-logger');

test('thử lại lỗi 503 rồi trả kết quả thành công', async () => {
  const delays = [];
  let attemptCount = 0;
  const capture = createCaptureLogger();

  const downloader = new RetryingDownloader({
    downloader: {
      async download() {
        attemptCount += 1;
        if (attemptCount < 3) {
          throw new DownloadError('bận', { upstreamStatus: 503, retryable: true });
        }
        return { bytes: Buffer.from('ok'), sha256: 'hash', size: 2 };
      },
    },
    retryCount: 3,
    baseMs: 100,
    jitterMs: 0,
    random: () => 0,
    sleepImpl: async (delayMs) => delays.push(delayMs),
    logger: capture.logger,
  });

  const result = await downloader.download('https://hust.edu.vn/a.pdf', { strategy: 'file' });

  assert.equal(result.size, 2);
  assert.equal(attemptCount, 3);
  assert.deepEqual(delays, [100, 200]);
  assert.equal(capture.records.filter((record) => record.event === 'content_download_retry').length, 2);
});

test('không thử lại lỗi 404', async () => {
  let attemptCount = 0;
  const downloader = new RetryingDownloader({
    downloader: {
      async download() {
        attemptCount += 1;
        throw new DownloadError('không thấy', { upstreamStatus: 404 });
      },
    },
    retryCount: 3,
    sleepImpl: async () => undefined,
  });

  await assert.rejects(
    downloader.download('https://hust.edu.vn/missing.pdf', { strategy: 'file' }),
    (error) => error.upstreamStatus === 404,
  );
  assert.equal(attemptCount, 1);
});
