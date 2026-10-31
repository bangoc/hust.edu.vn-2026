'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestApp } = require('../helpers/with-test-app');
const { startHttpServer, postJson, getJson, pollJob } = require('../helpers/http-test-server');
const { DownloadError } = require('../../domain/errors/download-error');

const HTML_URL = 'https://hust.edu.vn/tin-tuc';
const PDF_URL = 'https://hust.edu.vn/uploads/quy-che.pdf';
const MISSING_URL = 'https://hust.edu.vn/khong-ton-tai';
const HTML = '<html><body><h1>Tin tức</h1><a href="bai-khac.html">bài khác</a></body></html>';
const PDF_BYTES = Buffer.from('%PDF-1.7\nquy chế đào tạo\n%%EOF');

/** Module đọc giả: ghi lại mọi body nhận được, trả mã HTTP theo danh sách. */
async function startFakeReader(statuses = [200]) {
  const receivedBodies = [];
  const queue = [...statuses];
  const server = await startHttpServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      receivedBodies.push({
        path: request.url,
        contentType: request.headers['content-type'],
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      const status = queue.length > 1 ? queue.shift() : queue[0];
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: status < 400 }));
    });
  });
  return { ...server, receivedBodies, readerUrl: `${server.baseUrl}/parse` };
}

function forwardingConfig(readerUrl) {
  return {
    READER_URL: readerUrl,
    READER_RETRY_COUNT: '1',
    READER_TIMEOUT_MS: '1000',
    RETRY_BASE_MS: '1',
    RETRY_MAX_MS: '1',
    RETRY_JITTER_MS: '0',
  };
}

async function runJob(baseUrl, url) {
  const load = await postJson(baseUrl, '/load', { url });
  assert.equal(load.status, 202, JSON.stringify(load.body));
  return pollJob(baseUrl, load.body.job_id);
}

test('trang HTML được chuyển sang module đọc đúng hợp đồng', async () => {
  const reader = await startFakeReader([200]);
  try {
    await withTestApp(
      {
        configOverrides: forwardingConfig(reader.readerUrl),
        probes: { [HTML_URL]: { status: 200, contentType: 'text/html; charset=utf-8' } },
        responses: { [HTML_URL]: { bytes: Buffer.from(HTML), contentType: 'text/html; charset=utf-8' } },
      },
      async ({ baseUrl }) => {
        const job = await runJob(baseUrl, HTML_URL);

        assert.equal(job.status, 'done');
        assert.equal(job.forwarded, true);
        assert.equal(job.forward_error, null);

        assert.equal(reader.receivedBodies.length, 1);
        const received = reader.receivedBodies[0];
        assert.equal(received.path, '/parse');
        assert.match(received.contentType, /^application\/json/);
        assert.deepEqual(received.body, {
          url: HTML_URL,
          format: 'html',
          encoding: 'text',
          content: HTML,
        });

        const stats = await getJson(baseUrl, '/stats');
        assert.equal(stats.body.jobs.forwardedContents, 1);
        assert.equal(stats.body.jobs.forwardFailures, 0);
      },
    );
  } finally {
    await reader.close();
  }
});

test('file PDF được chuyển dạng base64 kèm content_type', async () => {
  const reader = await startFakeReader([200]);
  try {
    await withTestApp(
      {
        configOverrides: forwardingConfig(reader.readerUrl),
        probes: { [PDF_URL]: { status: 200, contentType: 'application/pdf' } },
        responses: { [PDF_URL]: { bytes: PDF_BYTES, contentType: 'application/pdf' } },
      },
      async ({ baseUrl }) => {
        const job = await runJob(baseUrl, PDF_URL);

        assert.equal(job.status, 'done');
        assert.equal(job.forwarded, true);

        const { body } = reader.receivedBodies[0];
        assert.deepEqual(Object.keys(body), ['url', 'format', 'content_type', 'encoding', 'content']);
        assert.equal(body.url, PDF_URL);
        assert.equal(body.format, 'other');
        assert.equal(body.content_type, 'application/pdf');
        assert.equal(body.encoding, 'base64');
        assert.deepEqual(Buffer.from(body.content, 'base64'), PDF_BYTES);
      },
    );
  } finally {
    await reader.close();
  }
});

test('trang HTML trả Content-Disposition attachment được tải bằng HTTP và gửi dạng html', async () => {
  const saveFileUrl = 'https://hust.edu.vn/vi/news/savefile/tin-tuc-su-kien/bai-viet-654944.html';
  const reader = await startFakeReader([200]);
  try {
    await withTestApp(
      {
        configOverrides: forwardingConfig(reader.readerUrl),
        probes: {
          [saveFileUrl]: { status: 200, contentType: 'text/html; charset=utf-8', isAttachment: true },
        },
        responses: {
          [saveFileUrl]: { bytes: Buffer.from(HTML), contentType: 'text/html; charset=utf-8' },
        },
      },
      async ({ baseUrl, contentDownloader }) => {
        const job = await runJob(baseUrl, saveFileUrl);

        assert.equal(contentDownloader.calls[0].options.strategy, 'file');
        assert.equal(job.status, 'done');
        assert.equal(job.format, 'html');
        assert.equal(job.forwarded, true);
        assert.deepEqual(reader.receivedBodies[0].body, {
          url: saveFileUrl,
          format: 'html',
          encoding: 'text',
          content: HTML,
        });
      },
    );
  } finally {
    await reader.close();
  }
});

test('module đọc lỗi thì job vẫn done, ghi forwarded=false và forward_error', async () => {
  const reader = await startFakeReader([500]);
  try {
    await withTestApp(
      {
        configOverrides: forwardingConfig(reader.readerUrl),
        probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
        responses: { [HTML_URL]: { bytes: Buffer.from(HTML), contentType: 'text/html' } },
      },
      async ({ baseUrl, contentStorage }) => {
        const job = await runJob(baseUrl, HTML_URL);

        assert.equal(job.status, 'done');
        assert.match(job.content_ref, /^memory:\/\//);
        assert.equal(job.forwarded, false);
        assert.equal(job.forward_error.code, 'forward_error');
        assert.match(job.forward_error.message, /HTTP 500/);
        assert.ok(contentStorage.getBytes(job.object_key), 'nội dung vẫn được lưu');

        // READER_RETRY_COUNT=1: gửi 1 lần + thử lại 1 lần.
        assert.equal(reader.receivedBodies.length, 2);

        const stats = await getJson(baseUrl, '/stats');
        assert.equal(stats.body.jobs.forwardFailures, 1);
        assert.deepEqual(stats.body.jobs.forwardErrorCounts, { forward_error: 1 });
      },
    );
  } finally {
    await reader.close();
  }
});

test('module đọc tắt thì job vẫn done với forwarded=false', async () => {
  const reader = await startFakeReader([200]);
  const closedReaderUrl = reader.readerUrl;
  await reader.close();

  await withTestApp(
    {
      configOverrides: forwardingConfig(closedReaderUrl),
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: Buffer.from(HTML), contentType: 'text/html' } },
    },
    async ({ baseUrl }) => {
      const job = await runJob(baseUrl, HTML_URL);
      assert.equal(job.status, 'done');
      assert.equal(job.forwarded, false);
      assert.match(job.forward_error.message, /Không kết nối được/);
    },
  );
});

test('nội dung không đổi (not_modified) vẫn được chuyển lại, đọc từ storage', async () => {
  const reader = await startFakeReader([200]);
  const validators = { etag: '"v1"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' };
  try {
    await withTestApp(
      {
        configOverrides: forwardingConfig(reader.readerUrl),
        probes: {
          [HTML_URL]: [
            { status: 200, contentType: 'text/html', ...validators },
            { status: 200, contentType: 'text/html', ...validators },
          ],
        },
        responses: {
          [HTML_URL]: { bytes: Buffer.from(HTML), contentType: 'text/html', ...validators },
        },
      },
      async ({ baseUrl, contentDownloader }) => {
        await runJob(baseUrl, HTML_URL);
        const second = await runJob(baseUrl, HTML_URL);

        assert.equal(second.not_modified, true);
        assert.equal(second.forwarded, true);
        assert.equal(contentDownloader.calls.length, 1, 'lần hai không tải lại từ nguồn');
        assert.equal(reader.receivedBodies.length, 2);
        assert.deepEqual(reader.receivedBodies[1].body, reader.receivedBodies[0].body);
      },
    );
  } finally {
    await reader.close();
  }
});

test('job thất bại không gửi gì sang module đọc', async () => {
  const reader = await startFakeReader([200]);
  try {
    await withTestApp(
      {
        configOverrides: forwardingConfig(reader.readerUrl),
        probes: { [MISSING_URL]: { status: 200, contentType: 'text/html' } },
        responses: {
          [MISSING_URL]: { error: new DownloadError('Nguồn trả HTTP 404', { upstreamStatus: 404 }) },
        },
      },
      async ({ baseUrl }) => {
        const job = await runJob(baseUrl, MISSING_URL);
        assert.equal(job.status, 'failed');
        assert.equal(job.forwarded, null);
        assert.equal(reader.receivedBodies.length, 0);
      },
    );
  } finally {
    await reader.close();
  }
});

test('không cấu hình READER_URL thì không chuyển, forwarded=null', async () => {
  await withTestApp(
    {
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: Buffer.from(HTML), contentType: 'text/html' } },
    },
    async ({ baseUrl, container }) => {
      assert.equal(container.contentForwarder, null);
      const job = await runJob(baseUrl, HTML_URL);
      assert.equal(job.status, 'done');
      assert.equal(job.forwarded, null);
      assert.equal(job.forward_error, null);
    },
  );
});
