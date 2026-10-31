'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHttpServer } = require('../helpers/http-test-server');
const { FakeUrlPolicy } = require('../helpers/fake-url-policy');
const {
  HttpSourceProbe,
  isAttachmentDisposition,
} = require('../../adapters/outbound/network/http-source-probe');

async function withServer(handler, callback) {
  const server = await startHttpServer(handler);
  try {
    return await callback(server.baseUrl);
  } finally {
    await server.close();
  }
}

function createProbe({ blockedHosts = [], timeoutMs = 1000, maxRedirects = 5 } = {}) {
  return new HttpSourceProbe({
    urlPolicy: new FakeUrlPolicy({ blockedHosts }),
    timeoutMs,
    maxRedirects,
  });
}

test('HEAD trả status, content-type, content-length, etag và last-modified', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': '1234',
        etag: '"v1"',
        'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT',
      });
      res.end();
    },
    async (baseUrl) => {
      const probe = await createProbe().head(`${baseUrl}/file.pdf`);

      assert.equal(probe.status, 200);
      assert.equal(probe.contentType, 'application/pdf');
      assert.equal(probe.contentLength, 1234);
      assert.equal(probe.etag, '"v1"');
      assert.equal(probe.lastModified, 'Wed, 01 Jan 2025 00:00:00 GMT');
      assert.equal(probe.finalUrl, `${baseUrl}/file.pdf`);
      assert.equal(probe.errorCode, null);
    },
  );
});

test('HEAD theo redirect và cập nhật finalUrl', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/start') {
        res.writeHead(301, { location: '/final' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end();
    },
    async (baseUrl) => {
      const probe = await createProbe().head(`${baseUrl}/start`);
      assert.equal(probe.status, 200);
      assert.equal(probe.finalUrl, `${baseUrl}/final`);
    },
  );
});

test('HEAD 405 vẫn trả status để policy fallback theo đuôi', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(405, { allow: 'GET' });
      res.end();
    },
    async (baseUrl) => {
      const probe = await createProbe().head(`${baseUrl}/trang-chu`);
      assert.equal(probe.status, 405);
      assert.equal(probe.contentType, null);
    },
  );
});

test('redirect không có Location và quá số redirect trả errorCode', async () => {
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
      const probe = createProbe({ maxRedirects: 2 });

      const noLocation = await probe.head(`${baseUrl}/no-location`);
      assert.equal(noLocation.status, null);
      assert.equal(noLocation.errorCode, 'redirect_without_location');

      const loop = await probe.head(`${baseUrl}/loop`);
      assert.equal(loop.status, null);
      assert.equal(loop.errorCode, 'too_many_redirects');
    },
  );
});

test('redirect sang host bị chặn ném BlockedHostError', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        createProbe({ blockedHosts: ['169.254.169.254'] }).head(`${baseUrl}/start`),
        (error) => error.code === 'blocked_host',
      );
    },
  );
});

test('timeout trả status null và errorCode timeout', async () => {
  await withServer(
    (req, res) => {
      const timer = setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 300);
      req.on('close', () => clearTimeout(timer));
    },
    async (baseUrl) => {
      const probe = await createProbe({ timeoutMs: 40 }).head(`${baseUrl}/slow`);
      assert.equal(probe.status, null);
      assert.equal(probe.errorCode, 'timeout');
    },
  );
});

test('HEAD nhận diện Content-Disposition: attachment', async () => {
  await withServer(
    (req, res) => {
      const isSaveFile = req.url.startsWith('/savefile');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        ...(isSaveFile ? { 'content-disposition': 'attachment; filename=bai-viet.html' } : {}),
      });
      res.end();
    },
    async (baseUrl) => {
      const attachment = await createProbe().head(`${baseUrl}/savefile/bai-viet.html`);
      const inline = await createProbe().head(`${baseUrl}/bai-viet.html`);

      assert.equal(attachment.isAttachment, true);
      assert.equal(attachment.contentType, 'text/html; charset=utf-8');
      assert.equal(inline.isAttachment, false);
    },
  );
});

test('isAttachmentDisposition chỉ nhận giá trị attachment', () => {
  assert.equal(isAttachmentDisposition('attachment; filename=a.html'), true);
  assert.equal(isAttachmentDisposition('  Attachment'), true);
  assert.equal(isAttachmentDisposition('inline; filename=a.pdf'), false);
  assert.equal(isAttachmentDisposition(null), false);
});
