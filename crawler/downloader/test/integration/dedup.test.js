'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestApp } = require('../helpers/with-test-app');
const { postJson, pollJob } = require('../helpers/http-test-server');
const { ContentHash } = require('../../domain/value-objects/content-hash');

const HTML_URL = 'https://hust.edu.vn/tin-tuc';
const PDF_URL = 'https://hust.edu.vn/uploads/bm17.pdf';
const OTHER_HTML_URL = 'https://hust.edu.vn/thong-bao';
const HTML_V1 = Buffer.from('<html><body>Phiên bản 1</body></html>');
const HTML_V2 = Buffer.from('<html><body>Phiên bản 2</body></html>');
const PDF_BYTES = Buffer.from('%PDF-1.7\nnội dung pdf\n%%EOF');

function sha256(bytes) {
  return ContentHash.fromBuffer(bytes).value;
}

async function runJob(baseUrl, url, force = false) {
  const load = await postJson(baseUrl, '/load', force ? { url, force } : { url });
  assert.equal(load.status, 202, JSON.stringify(load.body));
  return pollJob(baseUrl, load.body.job_id);
}

test('ETag không đổi thì trả not_modified và không tải lại lần hai', async () => {
  await withTestApp(
    {
      probes: {
        [HTML_URL]: [
          { status: 200, contentType: 'text/html', etag: '"v1"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' },
          { status: 200, contentType: 'text/html', etag: '"v1"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' },
        ],
      },
      responses: {
        [HTML_URL]: {
          bytes: HTML_V1,
          contentType: 'text/html',
          etag: '"v1"',
          lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
        },
      },
    },
    async ({ baseUrl, contentDownloader, sourceProbe, manifestRepository }) => {
      const first = await runJob(baseUrl, HTML_URL);
      const second = await runJob(baseUrl, HTML_URL);

      assert.equal(second.status, 'done');
      assert.equal(second.not_modified, true);
      assert.equal(second.redownloaded, false);
      assert.equal(second.content_changed, false);
      assert.equal(second.sha256, sha256(HTML_V1));
      assert.equal(second.object_key, first.object_key);
      assert.match(second.content_ref, /^memory:\/\//);
      assert.equal(second.previous_sha256, sha256(HTML_V1));
      assert.equal(second.previous_fetched_at, first.fetched_at);

      assert.equal(contentDownloader.calls.length, 1);
      assert.equal(sourceProbe.calls[1].headers['If-None-Match'], '"v1"');
      assert.equal(
        sourceProbe.calls[1].headers['If-Modified-Since'],
        'Wed, 01 Jan 2025 00:00:00 GMT',
      );
      assert.equal(manifestRepository.manifests.size, 1);
    },
  );
});

test('hai request cùng URL trong lúc đang tải chỉ tạo một job', async () => {
  await withTestApp(
    {
      delayMs: 150,
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: HTML_V1, contentType: 'text/html' } },
    },
    async ({ baseUrl, contentDownloader, sourceProbe }) => {
      const first = await postJson(baseUrl, '/load', { url: HTML_URL });
      const second = await postJson(baseUrl, '/load', { url: HTML_URL });

      assert.equal(first.status, 202);
      assert.equal(second.status, 202);
      assert.equal(second.body.deduplicated, true);
      assert.equal(second.body.job_id, first.body.job_id);

      const job = await pollJob(baseUrl, first.body.job_id);
      assert.equal(job.status, 'done');
      assert.equal(contentDownloader.calls.length, 1);
      assert.equal(sourceProbe.calls.length, 1);
    },
  );
});

test('force trong lúc job đang chạy vẫn trả job đang chạy thay vì tạo job mới', async () => {
  await withTestApp(
    {
      delayMs: 120,
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: HTML_V1, contentType: 'text/html' } },
    },
    async ({ baseUrl, contentDownloader }) => {
      const normal = await postJson(baseUrl, '/load', { url: HTML_URL });
      const forced = await postJson(baseUrl, '/load', { url: HTML_URL, force: true });

      assert.equal(forced.body.deduplicated, true);
      assert.equal(forced.body.job_id, normal.body.job_id);

      const job = await pollJob(baseUrl, normal.body.job_id);
      assert.equal(job.status, 'done');
      assert.equal(job.forced, false);
      assert.equal(contentDownloader.calls.length, 1);
    },
  );
});

test('nội dung đổi với cùng URL ghi object mới và bật content_changed', async () => {
  await withTestApp(
    {
      probes: {
        [HTML_URL]: [
          { status: 200, contentType: 'text/html', etag: '"v1"' },
          { status: 200, contentType: 'text/html', etag: '"v2"' },
        ],
      },
      responses: {
        [HTML_URL]: [
          { bytes: HTML_V1, contentType: 'text/html', etag: '"v1"' },
          { bytes: HTML_V2, contentType: 'text/html', etag: '"v2"' },
        ],
      },
    },
    async ({ baseUrl, contentDownloader, contentStorage, sourceProbe }) => {
      const first = await runJob(baseUrl, HTML_URL);
      const second = await runJob(baseUrl, HTML_URL);

      assert.equal(second.status, 'done');
      assert.equal(second.content_changed, true);
      assert.equal(second.redownloaded, false);
      assert.equal(second.duplicate_content, false);
      assert.equal(second.not_modified, false);
      assert.equal(second.previous_sha256, sha256(HTML_V1));
      assert.equal(second.sha256, sha256(HTML_V2));
      assert.notEqual(second.object_key, first.object_key);
      assert.equal(contentStorage.objects.size, 2);
      assert.equal(contentDownloader.calls.length, 2);
      assert.equal(sourceProbe.calls[1].headers['If-None-Match'], '"v1"');
    },
  );
});

test('tải lại cùng nội dung bật redownloaded và duplicate_content', async () => {
  await withTestApp(
    {
      probes: {
        [HTML_URL]: [
          { status: 200, contentType: 'text/html', etag: '"v1"' },
          { status: 200, contentType: 'text/html', etag: '"v2"' },
        ],
      },
      responses: {
        [HTML_URL]: [
          { bytes: HTML_V1, contentType: 'text/html', etag: '"v1"' },
          { bytes: HTML_V1, contentType: 'text/html', etag: '"v2"' },
        ],
      },
    },
    async ({ baseUrl, contentStorage }) => {
      const first = await runJob(baseUrl, HTML_URL);
      const second = await runJob(baseUrl, HTML_URL);

      assert.equal(second.redownloaded, true);
      assert.equal(second.content_changed, false);
      assert.equal(second.duplicate_content, true);
      assert.equal(second.previous_sha256, first.sha256);
      assert.equal(second.object_key, first.object_key);
      assert.equal(contentStorage.objects.size, 1);
    },
  );
});

test('hai URL khác nhau trả cùng nội dung thì object chỉ được ghi một lần', async () => {
  await withTestApp(
    {
      probes: {
        [HTML_URL]: { status: 200, contentType: 'text/html' },
        [OTHER_HTML_URL]: { status: 200, contentType: 'text/html' },
      },
      responses: {
        [HTML_URL]: { bytes: HTML_V1, contentType: 'text/html' },
        [OTHER_HTML_URL]: { bytes: HTML_V1, contentType: 'text/html' },
      },
    },
    async ({ baseUrl, contentStorage, manifestRepository }) => {
      const first = await runJob(baseUrl, HTML_URL);
      const second = await runJob(baseUrl, OTHER_HTML_URL);

      assert.equal(second.status, 'done');
      assert.equal(second.duplicate_content, true);
      assert.equal(second.redownloaded, false);
      assert.equal(second.content_changed, false);
      assert.equal(second.previous_sha256, null);
      assert.equal(second.object_key, first.object_key);
      assert.equal(contentStorage.objects.size, 1);
      assert.equal(manifestRepository.manifests.size, 2);
    },
  );
});

test('FILE nhận 304 từ conditional GET vẫn hoàn tất với metadata manifest', async () => {
  await withTestApp(
    {
      probes: {
        [PDF_URL]: [
          { status: 200, contentType: 'application/pdf', etag: '"pdf-v1"' },
          { status: 200, contentType: 'application/pdf' },
        ],
      },
      responses: {
        [PDF_URL]: [
          { bytes: PDF_BYTES, contentType: 'application/pdf', etag: '"pdf-v1"' },
          { notModified: true, contentType: 'application/pdf', etag: '"pdf-v1"' },
        ],
      },
    },
    async ({ baseUrl, contentDownloader }) => {
      const first = await runJob(baseUrl, PDF_URL);
      const second = await runJob(baseUrl, PDF_URL);

      assert.equal(second.status, 'done');
      assert.equal(second.not_modified, true);
      assert.equal(second.format, 'other');
      assert.equal(second.extension, 'pdf');
      assert.equal(second.sha256, first.sha256);
      assert.equal(second.previous_fetched_at, first.fetched_at);
      assert.equal(contentDownloader.calls.length, 2);
      assert.equal(contentDownloader.calls[1].options.strategy, 'file');
      assert.equal(contentDownloader.calls[1].options.headers['If-None-Match'], '"pdf-v1"');
    },
  );
});

test('FILE có HEAD 304 thì bỏ qua GET và dùng lại manifest', async () => {
  await withTestApp(
    {
      probes: {
        [PDF_URL]: [
          { status: 200, contentType: 'application/pdf', etag: '"pdf-v1"' },
          { status: 304, contentType: 'application/pdf', etag: '"pdf-v1"' },
        ],
      },
      responses: {
        [PDF_URL]: { bytes: PDF_BYTES, contentType: 'application/pdf', etag: '"pdf-v1"' },
      },
    },
    async ({ baseUrl, contentDownloader }) => {
      const first = await runJob(baseUrl, PDF_URL);
      const second = await runJob(baseUrl, PDF_URL);

      assert.equal(second.status, 'done');
      assert.equal(second.not_modified, true);
      assert.equal(second.sha256, first.sha256);
      assert.equal(second.object_key, first.object_key);
      assert.equal(contentDownloader.calls.length, 1);
    },
  );
});
