'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHttpServer } = require('../helpers/http-test-server');
const { FakeUrlPolicy } = require('../helpers/fake-url-policy');
const { HttpFileDownloader } = require('../../adapters/outbound/downloaders/http-file-downloader');
const { ContentHash } = require('../../domain/value-objects/content-hash');

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');

async function withServer(handler, callback) {
  const server = await startHttpServer(handler);
  try {
    return await callback(server.baseUrl);
  } finally {
    await server.close();
  }
}

function createDownloader({ blockedHosts = [], maxRedirects = 5 } = {}) {
  return new HttpFileDownloader({
    urlPolicy: new FakeUrlPolicy({ blockedHosts }),
    maxRedirects,
  });
}

test('tải file thành công, trả bytes, size, sha256 và metadata', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        etag: '"pdf-v1"',
        'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
      });
      res.end(PDF_BYTES);
    },
    async (baseUrl) => {
      const downloader = createDownloader();
      const result = await downloader.download(`${baseUrl}/file.pdf`, {
        maxBytes: 1024,
        timeoutMs: 1000,
      });

      assert.equal(result.notModified, false);
      assert.deepEqual(result.bytes, PDF_BYTES);
      assert.equal(result.size, PDF_BYTES.length);
      assert.equal(result.sha256, ContentHash.fromBuffer(PDF_BYTES).value);
      assert.equal(result.contentType, 'application/pdf');
      assert.equal(result.httpStatus, 200);
      assert.equal(result.etag, '"pdf-v1"');
      assert.equal(result.finalUrl, `${baseUrl}/file.pdf`);
    },
  );
});

test('304 trả notModified và không có body', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(304, { etag: '"v1"' });
      res.end();
    },
    async (baseUrl) => {
      const result = await createDownloader().download(`${baseUrl}/file.pdf`, {
        headers: { 'If-None-Match': '"v1"' },
        maxBytes: 1024,
        timeoutMs: 1000,
      });

      assert.equal(result.notModified, true);
      assert.equal(result.httpStatus, 304);
      assert.equal(result.size, 0);
      assert.equal(result.sha256, null);
      assert.equal(result.etag, '"v1"');
    },
  );
});

test('404 trả DownloadError không retry và giữ upstreamStatus', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(404);
      res.end('không thấy');
    },
    async (baseUrl) => {
      await assert.rejects(
        createDownloader().download(`${baseUrl}/missing.pdf`, {
          maxBytes: 1024,
          timeoutMs: 1000,
        }),
        (error) =>
          error.code === 'download_error' &&
          error.upstreamStatus === 404 &&
          error.retryable === false,
      );
    },
  );
});

test('429 giữ Retry-After và đánh dấu retryable', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(429, { 'retry-after': '3' });
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        createDownloader().download(`${baseUrl}/limited.pdf`, {
          maxBytes: 1024,
          timeoutMs: 1000,
        }),
        (error) =>
          error.code === 'download_error' &&
          error.upstreamStatus === 429 &&
          error.retryable === true &&
          error.details.retryAfter === '3',
      );
    },
  );
});

test('Content-Length vượt maxBytes bị chặn trước khi đọc body', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-length': '5000' });
      res.end('x');
    },
    async (baseUrl) => {
      await assert.rejects(
        createDownloader().download(`${baseUrl}/big.pdf`, {
          maxBytes: 100,
          timeoutMs: 1000,
        }),
        (error) => error.code === 'too_large',
      );
    },
  );
});

test('body chunked vượt maxBytes bị chặn khi đang stream', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      const timer = setInterval(() => res.write(Buffer.alloc(4, 0x41)), 5);
      req.on('close', () => clearInterval(timer));
      res.on('close', () => clearInterval(timer));
    },
    async (baseUrl) => {
      await assert.rejects(
        createDownloader().download(`${baseUrl}/stream.bin`, {
          maxBytes: 10,
          timeoutMs: 1000,
        }),
        (error) => error.code === 'too_large',
      );
    },
  );
});

test('timeout khi server không phản hồi trả TimeoutError', async () => {
  await withServer(
    (req, res) => {
      const timer = setTimeout(() => {
        res.writeHead(200);
        res.end('muộn');
      }, 300);
      req.on('close', () => clearTimeout(timer));
    },
    async (baseUrl) => {
      await assert.rejects(
        createDownloader().download(`${baseUrl}/slow.pdf`, {
          maxBytes: 1024,
          timeoutMs: 40,
        }),
        (error) => error.code === 'timeout' && error.retryable === true,
      );
    },
  );
});

test('theo redirect và trả finalUrl sau redirect', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/start.pdf') {
        res.writeHead(302, { location: '/final.pdf' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/pdf' });
      res.end(PDF_BYTES);
    },
    async (baseUrl) => {
      const result = await createDownloader().download(`${baseUrl}/start.pdf`, {
        maxBytes: 1024,
        timeoutMs: 1000,
      });

      assert.deepEqual(result.bytes, PDF_BYTES);
      assert.equal(result.finalUrl, `${baseUrl}/final.pdf`);
    },
  );
});

test('redirect sang host bị chặn không được fetch', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    },
    async (baseUrl) => {
      const downloader = createDownloader({ blockedHosts: ['169.254.169.254'] });
      await assert.rejects(
        downloader.download(`${baseUrl}/start.pdf`, {
          maxBytes: 1024,
          timeoutMs: 1000,
        }),
        (error) => error.code === 'blocked_host',
      );
    },
  );
});

test('redirect thiếu Location và vòng lặp redirect đều bị từ chối', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/no-location') {
        res.writeHead(302);
        res.end();
        return;
      }
      res.writeHead(302, { location: '/loop' });
      res.end();
    },
    async (baseUrl) => {
      const downloader = createDownloader({ maxRedirects: 2 });

      await assert.rejects(
        downloader.download(`${baseUrl}/no-location`, { maxBytes: 1024, timeoutMs: 1000 }),
        (error) => error.code === 'download_error' && /Location/.test(error.message),
      );

      await assert.rejects(
        downloader.download(`${baseUrl}/loop`, { maxBytes: 1024, timeoutMs: 1000 }),
        (error) => error.code === 'download_error' && error.upstreamStatus === 302,
      );
    },
  );
});

test('maxBytes hoặc timeoutMs không hợp lệ bị từ chối', async () => {
  const downloader = createDownloader();
  await assert.rejects(
    downloader.download('http://example.com/a.pdf', { maxBytes: 0, timeoutMs: 1 }),
    (error) => error.code === 'invalid_max_bytes',
  );
  await assert.rejects(
    downloader.download('http://example.com/a.pdf', { maxBytes: 10, timeoutMs: 0 }),
    (error) => error.code === 'invalid_timeout',
  );
});
