'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHttpServer } = require('../helpers/http-test-server');
const { RobotsPolicy } = require('../../adapters/outbound/network/robots-policy');
const { FakeClock } = require('../helpers/fake-clock');

async function withServer(handler, callback) {
  const server = await startHttpServer(handler);
  try {
    return await callback(server.baseUrl);
  } finally {
    await server.close();
  }
}

test('cho phép URL công khai và chặn URL bị robots.txt Disallow', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\n');
    },
    async (baseUrl) => {
      const policy = new RobotsPolicy({ timeoutMs: 1000 });

      await assert.doesNotReject(policy.assertAllowed(`${baseUrl}/public`));
      await assert.rejects(
        policy.assertAllowed(`${baseUrl}/private/tai-lieu`),
        (error) => error.code === 'robots_disallowed' && error.httpStatus === 403,
      );
    },
  );
});

test('cache theo origin nên nhiều URL chỉ fetch robots.txt một lần', async () => {
  let requestCount = 0;
  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('User-agent: *\nAllow: /\n');
    },
    async (baseUrl) => {
      const policy = new RobotsPolicy({ timeoutMs: 1000 });

      await policy.assertAllowed(`${baseUrl}/mot`);
      await policy.assertAllowed(`${baseUrl}/hai`);
      await policy.assertAllowed(`${baseUrl}/ba`);

      assert.equal(requestCount, 1);
    },
  );
});

test('robots.txt 404 hoặc lỗi mạng thì fail-open', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(404);
      res.end();
    },
    async (baseUrl) => {
      const policy = new RobotsPolicy({ timeoutMs: 1000 });
      await assert.doesNotReject(policy.assertAllowed(`${baseUrl}/bat-ky`));
    },
  );

  const failingPolicy = new RobotsPolicy({
    timeoutMs: 1000,
    fetchImpl: async () => {
      throw Object.assign(new Error('mất mạng'), { code: 'ECONNREFUSED' });
    },
  });
  await assert.doesNotReject(failingPolicy.assertAllowed('https://vi-du.test/trang'));
});

test('cache hết TTL thì đọc lại robots.txt mới', async () => {
  const clock = new FakeClock(new Date('2026-01-01T00:00:00Z'));
  let robotsText = 'User-agent: *\nDisallow: /tai-lieu\n';
  let requestCount = 0;

  await withServer(
    (req, res) => {
      requestCount += 1;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(robotsText);
    },
    async (baseUrl) => {
      const policy = new RobotsPolicy({ timeoutMs: 1000, clock, cacheTtlMs: 1000 });
      const url = `${baseUrl}/tai-lieu`;

      await assert.rejects(
        policy.assertAllowed(url),
        (error) => error.code === 'robots_disallowed',
      );

      robotsText = 'User-agent: *\nAllow: /\n';
      clock.advance(1001);
      await assert.doesNotReject(policy.assertAllowed(url));
      assert.equal(requestCount, 2);
    },
  );
});

test('không kiểm tra robots cho chính URL robots.txt', async () => {
  let requestCount = 0;
  const policy = new RobotsPolicy({
    timeoutMs: 1000,
    fetchImpl: async () => {
      requestCount += 1;
      throw new Error('không được gọi');
    },
  });

  await assert.doesNotReject(policy.assertAllowed('https://vi-du.test/robots.txt'));
  assert.equal(requestCount, 0);
});
