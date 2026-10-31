'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isRetryableError,
  computeBackoffDelayMs,
  parseRetryAfterMs,
  retryAsync,
} = require('../../domain/policies/retry-policy');
const { DownloadError } = require('../../domain/errors/download-error');

test('isRetryableError nhận diện 429, 5xx và lỗi mạng', () => {
  assert.equal(isRetryableError({ upstreamStatus: 429 }), true);
  assert.equal(isRetryableError({ upstreamStatus: 503 }), true);
  assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryableError({ cause: { code: 'EAI_AGAIN' } }), true);
  assert.equal(isRetryableError({ upstreamStatus: 404 }), false);
  assert.equal(isRetryableError({ retryable: false }), false);
});

test('computeBackoffDelayMs tăng theo cấp số nhân và có cap', () => {
  assert.equal(
    computeBackoffDelayMs(0, { baseMs: 100, maxMs: 1000, jitterMs: 0, random: () => 0 }),
    100,
  );
  assert.equal(
    computeBackoffDelayMs(1, { baseMs: 100, maxMs: 1000, jitterMs: 0, random: () => 0 }),
    200,
  );
  assert.equal(
    computeBackoffDelayMs(10, { baseMs: 100, maxMs: 1000, jitterMs: 0, random: () => 0 }),
    1000,
  );
});

test('parseRetryAfterMs hỗ trợ giây và HTTP date', () => {
  assert.equal(parseRetryAfterMs('2', 0), 2000);
  assert.equal(parseRetryAfterMs('999', 0), 300_000);
  assert.equal(
    parseRetryAfterMs('Thu, 01 Jan 2026 00:00:02 GMT', Date.parse('2026-01-01T00:00:00Z')),
    2000,
  );
  assert.equal(parseRetryAfterMs('không phải ngày', 0), null);
  assert.equal(parseRetryAfterMs(null, 0), null);
});

test('retryAsync thử lại 500 rồi thành công', async () => {
  const delays = [];
  let attemptCount = 0;

  const result = await retryAsync(
    async () => {
      attemptCount += 1;
      if (attemptCount < 3) {
        throw new DownloadError('tạm lỗi', { upstreamStatus: 500, retryable: true });
      }
      return 'ok';
    },
    {
      retryCount: 3,
      baseMs: 100,
      maxMs: 1000,
      jitterMs: 0,
      random: () => 0,
      sleepImpl: async (delayMs) => delays.push(delayMs),
    },
  );

  assert.equal(result, 'ok');
  assert.equal(attemptCount, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('retryAsync không thử lại lỗi 404', async () => {
  let attemptCount = 0;

  await assert.rejects(
    retryAsync(
      async () => {
        attemptCount += 1;
        throw new DownloadError('không thấy', { upstreamStatus: 404 });
      },
      {
        retryCount: 3,
        sleepImpl: async () => undefined,
      },
    ),
    (error) => error.code === 'download_error' && error.upstreamStatus === 404,
  );
  assert.equal(attemptCount, 1);
});

test('retryAsync ưu tiên Retry-After', async () => {
  const delays = [];
  let attemptCount = 0;

  await retryAsync(
    async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        throw new DownloadError('bị giới hạn', {
          upstreamStatus: 429,
          retryable: true,
          details: { retryAfter: '2' },
        });
      }
      return 'ok';
    },
    {
      retryCount: 1,
      baseMs: 100,
      jitterMs: 0,
      sleepImpl: async (delayMs) => delays.push(delayMs),
    },
  );

  assert.deepEqual(delays, [2000]);
});
