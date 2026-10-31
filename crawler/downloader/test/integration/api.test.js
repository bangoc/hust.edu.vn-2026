'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestApp } = require('../helpers/with-test-app');
const { postJson, getJson, pollJob } = require('../helpers/http-test-server');
const { ContentHash } = require('../../domain/value-objects/content-hash');
const { createCaptureLogger } = require('../helpers/capture-logger');

const HTML_URL = 'https://hust.edu.vn/tin-tuc';
const PDF_URL = 'https://hust.edu.vn/uploads/bm17.pdf';
const DOCX_URL = 'https://hust.edu.vn/uploads/3.application-form2025.docx';
const HTML_BYTES = Buffer.from(
  '<!doctype html><html><body><h1>Tin tức HUST</h1></body></html>',
);
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

test('POST /load tải HTML, lưu object và trả presigned content_ref', async () => {
  await withTestApp(
    {
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html; charset=utf-8' } },
      responses: {
        [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html; charset=utf-8' },
      },
    },
    async ({ baseUrl, contentStorage, contentDownloader }) => {
      const load = await postJson(baseUrl, '/load', { url: HTML_URL });
      assert.equal(load.status, 202);
      assert.equal(load.body.status, 'queued');
      assert.equal(load.body.deduplicated, false);
      assert.equal(load.body.status_url, `/jobs/${load.body.job_id}`);

      const job = await pollJob(baseUrl, load.body.job_id);
      assert.equal(job.status, 'done');
      assert.equal(job.url, HTML_URL);
      assert.equal(job.format, 'html');
      assert.equal(job.extension, 'html');
      assert.equal(job.content_type, 'text/html; charset=utf-8');
      assert.equal(job.encoding, 'ref');
      assert.match(job.content_ref, /^memory:\/\//);
      assert.match(job.object_key, /^raw\/[a-f0-9]{64}$/);
      assert.equal(job.sha256, ContentHash.fromBuffer(HTML_BYTES).value);
      assert.equal(job.size, HTML_BYTES.length);
      assert.equal(job.http_status, 200);
      assert.equal(job.not_modified, false);
      assert.equal(job.redownloaded, false);
      assert.equal(job.content_changed, false);
      assert.equal(job.duplicate_content, false);
      assert.equal(job.error, null);
      assert.deepEqual(contentStorage.getBytes(job.object_key), HTML_BYTES);
      assert.equal(contentDownloader.calls.length, 1);
      assert.equal(contentDownloader.calls[0].options.strategy, 'html');
    },
  );
});

test('GET /ping phản ánh trạng thái chờ, đang tải và quay lại chờ', async () => {
  await withTestApp(
    {
      delayMs: 150,
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html' } },
    },
    async ({ baseUrl }) => {
      const initialPing = await getJson(baseUrl, '/ping');
      assert.deepEqual(initialPing.body, { status: 'đang chờ' });

      const load = await postJson(baseUrl, '/load', { url: HTML_URL });
      const activePing = await getJson(baseUrl, '/ping');
      assert.equal(activePing.status, 200);
      assert.equal(activePing.body.status, 'đang tải');

      await pollJob(baseUrl, load.body.job_id);
      const finalPing = await getJson(baseUrl, '/ping');
      assert.deepEqual(finalPing.body, { status: 'đang chờ' });
    },
  );
});

test('GET /jobs/:id trả 404 với job không tồn tại', async () => {
  await withTestApp({}, async ({ baseUrl }) => {
    const response = await getJson(baseUrl, '/jobs/khong-ton-tai');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
  });
});

test('POST /load từ chối JSON sai, URL sai scheme, URL rỗng và field lạ', async () => {
  await withTestApp({ blockedHosts: ['127.0.0.1'] }, async ({ baseUrl }) => {
    const badJson = await postJson(baseUrl, '/load', '{');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.body.error.code, 'bad_json');

    const badScheme = await postJson(baseUrl, '/load', { url: 'file:///etc/passwd' });
    assert.equal(badScheme.status, 400);
    assert.equal(badScheme.body.error.code, 'invalid_url');

    const emptyUrl = await postJson(baseUrl, '/load', { url: '' });
    assert.equal(emptyUrl.status, 400);

    const blockedHost = await postJson(baseUrl, '/load', { url: 'http://127.0.0.1/x' });
    assert.equal(blockedHost.status, 400);
    assert.equal(blockedHost.body.error.code, 'blocked_host');

    const unknownField = await postJson(baseUrl, '/load', { url: HTML_URL, extra: true });
    assert.equal(unknownField.status, 400);
    assert.equal(unknownField.body.error.code, 'invalid_request');
  });
});

test('GET route không tồn tại trả 404', async () => {
  await withTestApp({}, async ({ baseUrl }) => {
    const response = await getJson(baseUrl, '/khong-co-route');
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, 'not_found');
  });
});

test('tải PDF giữ format other, content_type và extension pdf', async () => {
  await withTestApp(
    {
      probes: { [PDF_URL]: { status: 200, contentType: 'application/pdf' } },
      responses: { [PDF_URL]: { bytes: PDF_BYTES, contentType: 'application/pdf' } },
    },
    async ({ baseUrl }) => {
      const load = await postJson(baseUrl, '/load', { url: PDF_URL });
      const job = await pollJob(baseUrl, load.body.job_id);

      assert.equal(job.format, 'other');
      assert.equal(job.extension, 'pdf');
      assert.equal(job.content_type, 'application/pdf');
      assert.equal(job.size, PDF_BYTES.length);
    },
  );
});

test('DOCX trả application/octet-stream vẫn có extension docx', async () => {
  await withTestApp(
    {
      probes: { [DOCX_URL]: { status: 200, contentType: 'application/octet-stream' } },
      responses: {
        [DOCX_URL]: { bytes: DOCX_BYTES, contentType: 'application/octet-stream' },
      },
    },
    async ({ baseUrl }) => {
      const load = await postJson(baseUrl, '/load', { url: DOCX_URL });
      const job = await pollJob(baseUrl, load.body.job_id);

      assert.equal(job.format, 'other');
      assert.equal(job.extension, 'docx');
      assert.equal(job.content_type, 'application/octet-stream');
    },
  );
});

test('URL .pdf nhưng server trả text/html được lưu là HTML', async () => {
  await withTestApp(
    {
      probes: { [PDF_URL]: { status: 200, contentType: 'text/html; charset=utf-8' } },
      responses: {
        [PDF_URL]: { bytes: HTML_BYTES, contentType: 'text/html; charset=utf-8' },
      },
    },
    async ({ baseUrl }) => {
      const load = await postJson(baseUrl, '/load', { url: PDF_URL });
      const job = await pollJob(baseUrl, load.body.job_id);

      assert.equal(job.format, 'html');
      assert.equal(job.extension, 'html');
    },
  );
});

test('HEAD 405 fallback về HTML khi URL không có đuôi tài liệu', async () => {
  const url = 'https://hust.edu.vn/trang-chu';
  await withTestApp(
    {
      probes: { [url]: { status: 405, contentType: null } },
      responses: { [url]: { bytes: HTML_BYTES, contentType: 'text/html' } },
    },
    async ({ baseUrl, contentDownloader }) => {
      const load = await postJson(baseUrl, '/load', { url });
      const job = await pollJob(baseUrl, load.body.job_id);

      assert.equal(job.format, 'html');
      assert.equal(contentDownloader.calls[0].options.strategy, 'html');
    },
  );
});

test('force tải lại dù manifest còn validator', async () => {
  await withTestApp(
    {
      probes: {
        [HTML_URL]: [
          { status: 200, contentType: 'text/html', etag: '"v1"' },
          { status: 200, contentType: 'text/html', etag: '"v1"' },
        ],
      },
      responses: {
        [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html', etag: '"v1"' },
      },
    },
    async ({ baseUrl, contentDownloader, sourceProbe }) => {
      const first = await postJson(baseUrl, '/load', { url: HTML_URL });
      await pollJob(baseUrl, first.body.job_id);

      const second = await postJson(baseUrl, '/load', { url: HTML_URL, force: true });
      const job = await pollJob(baseUrl, second.body.job_id);

      assert.equal(job.status, 'done');
      assert.equal(job.forced, true);
      assert.equal(job.not_modified, false);
      assert.equal(job.redownloaded, true);
      assert.equal(contentDownloader.calls.length, 2);
      assert.equal(sourceProbe.calls[1].headers['If-None-Match'], undefined);
    },
  );
});

test('queue đầy trả 503 queue_full và vẫn xử lý các job trước đó', async () => {
  const urls = [
    'https://hust.edu.vn/trang-1',
    'https://hust.edu.vn/trang-2',
    'https://hust.edu.vn/trang-3',
  ];
  await withTestApp(
    {
      configOverrides: { MAX_CONCURRENT: '1', QUEUE_SIZE: '1' },
      delayMs: 120,
      probes: Object.fromEntries(
        urls.map((url) => [url, { status: 200, contentType: 'text/html' }]),
      ),
      responses: Object.fromEntries(
        urls.map((url) => [url, { bytes: HTML_BYTES, contentType: 'text/html' }]),
      ),
    },
    async ({ baseUrl }) => {
      const first = await postJson(baseUrl, '/load', { url: urls[0] });
      const second = await postJson(baseUrl, '/load', { url: urls[1] });
      const third = await postJson(baseUrl, '/load', { url: urls[2] });

      assert.equal(first.status, 202);
      assert.equal(second.status, 202);
      assert.equal(third.status, 503);
      assert.equal(third.body.error.code, 'queue_full');

      assert.equal((await pollJob(baseUrl, first.body.job_id)).status, 'done');
      assert.equal((await pollJob(baseUrl, second.body.job_id)).status, 'done');
    },
  );
});

test('job thất bại vẫn trả 200 khi GET và có error envelope', async () => {
  const url = 'https://hust.edu.vn/khong-ton-tai.pdf';
  await withTestApp(
    {
      probes: { [url]: { status: 404, contentType: null } },
      responses: {
        [url]: {
          error: new (require('../../domain/errors/download-error').DownloadError)(
            'Nguồn trả HTTP 404',
            { upstreamStatus: 404 },
          ),
        },
      },
    },
    async ({ baseUrl }) => {
      const load = await postJson(baseUrl, '/load', { url });
      const job = await pollJob(baseUrl, load.body.job_id);

      assert.equal(job.status, 'failed');
      assert.equal(job.content_ref, null);
      assert.equal(job.error.code, 'download_error');
      assert.match(job.error.message, /404/);
    },
  );
});

test('GET /stats trả counter job và định dạng đã tải', async () => {
  await withTestApp(
    {
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html' } },
    },
    async ({ baseUrl }) => {
      const load = await postJson(baseUrl, '/load', { url: HTML_URL });
      await pollJob(baseUrl, load.body.job_id);

      const stats = await getJson(baseUrl, '/stats');
      assert.equal(stats.status, 200);
      assert.equal(stats.body.queue.doneJobs, 1);
      assert.equal(stats.body.jobs.jobsCreated, 1);
      assert.equal(stats.body.jobs.jobsDone, 1);
      assert.equal(stats.body.jobs.htmlDownloads, 1);
      assert.equal(stats.body.jobs.downloadedBytes, HTML_BYTES.length);
      assert.equal(stats.body.browser, null);
    },
  );
});

test('log không chứa body hay presigned URL', async () => {
  const capture = createCaptureLogger();
  await withTestApp(
    {
      logger: capture.logger,
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: {
        [HTML_URL]: {
          bytes: Buffer.from('<html><body>BÍ MẬT-NỘI-DUNG-TẢI-VỀ</body></html>'),
          contentType: 'text/html',
        },
      },
    },
    async ({ baseUrl }) => {
      const load = await postJson(baseUrl, '/load', { url: HTML_URL });
      await pollJob(baseUrl, load.body.job_id);

      const logText = capture.text();
      assert.doesNotMatch(logText, /BÍ MẬT-NỘI-DUNG-TẢI-VỀ/);
      assert.doesNotMatch(logText, /memory:\/\//);
      assert.match(logText, /download_job_done/);
    },
  );
});
