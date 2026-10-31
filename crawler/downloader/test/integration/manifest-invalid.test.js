'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestApp } = require('../helpers/with-test-app');
const { postJson, pollJob } = require('../helpers/http-test-server');
const { createCaptureLogger } = require('../helpers/capture-logger');
const { InvalidManifestError } = require('../../domain/errors/invalid-manifest-error');
const { UrlKey } = require('../../domain/value-objects/url-key');

const HTML_URL = 'https://hust.edu.vn/tin-tuc';
const HTML_BYTES = Buffer.from('<!doctype html><html><body>Tin tức HUST</body></html>');
const URL_KEY = new UrlKey(HTML_URL).value;

async function runJob(baseUrl, url) {
  const load = await postJson(baseUrl, '/load', { url });
  assert.equal(load.status, 202, JSON.stringify(load.body));
  return pollJob(baseUrl, load.body.job_id);
}

function assertNoConditionalHeaders(sourceProbe) {
  const headers = sourceProbe.calls[0].headers;
  assert.equal(headers['If-None-Match'], undefined);
  assert.equal(headers['If-Modified-Since'], undefined);
}

function findManifestWarning(capture) {
  return capture.records.find(
    (record) => record.level === 'warn' && record.event === 'download_manifest_invalid',
  );
}

test('manifest sai schema được bỏ qua, job vẫn done và tải lại bình thường', async () => {
  const capture = createCaptureLogger();
  await withTestApp(
    {
      logger: capture.logger,
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html', etag: '"v2"' } },
      responses: { [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html', etag: '"v2"' } },
    },
    async ({ baseUrl, manifestRepository, sourceProbe }) => {
      manifestRepository.manifests.set(URL_KEY, {
        url: HTML_URL,
        finalUrl: HTML_URL,
        sha256: 'khong-phai-sha256',
      });

      const job = await runJob(baseUrl, HTML_URL);

      assert.equal(job.status, 'done');
      assert.equal(job.manifest_invalid, true);
      assert.equal(job.not_modified, false);
      assert.equal(job.redownloaded, false);
      assert.equal(job.previous_sha256, null);
      assertNoConditionalHeaders(sourceProbe);

      const warning = findManifestWarning(capture);
      assert.ok(warning, 'phải ghi log download_manifest_invalid');
      assert.equal(warning.fields.reason, 'schema_invalid');

      const storedManifest = manifestRepository.manifests.get(URL_KEY);
      assert.match(storedManifest.sha256, /^[a-f0-9]{64}$/);
      assert.equal(storedManifest.objectKey, `raw/${storedManifest.sha256}`);
    },
  );
});

test('manifest JSON hỏng trong MinIO được fallback và không làm job thất bại', async () => {
  const capture = createCaptureLogger();
  await withTestApp(
    {
      logger: capture.logger,
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html' } },
      responses: { [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html' } },
    },
    async ({ baseUrl, manifestRepository, sourceProbe }) => {
      manifestRepository.setError(
        URL_KEY,
        new InvalidManifestError('Manifest URL không phải JSON hợp lệ'),
      );

      const job = await runJob(baseUrl, HTML_URL);

      assert.equal(job.status, 'done');
      assert.equal(job.manifest_invalid, true);
      assert.equal(job.error, null);
      assertNoConditionalHeaders(sourceProbe);

      const warning = findManifestWarning(capture);
      assert.ok(warning, 'phải ghi log download_manifest_invalid');
      assert.equal(warning.fields.reason, 'invalid_json');
      assert.equal(manifestRepository.errors.size, 1);
    },
  );
});

test('job failed do auth không ghi đè manifest hợp lệ trước đó', async () => {
  await withTestApp(
    {
      probes: {
        [HTML_URL]: [
          { status: 200, contentType: 'text/html', etag: '"v1"' },
          { status: 200, contentType: 'text/html', finalUrl: 'https://hust.edu.vn/login' },
        ],
      },
      responses: {
        [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html', etag: '"v1"' },
      },
    },
    async ({ baseUrl, manifestRepository }) => {
      const first = await runJob(baseUrl, HTML_URL);
      assert.equal(first.status, 'done');

      const second = await runJob(baseUrl, HTML_URL);
      assert.equal(second.status, 'failed');
      assert.equal(second.auth_required, true);

      const storedManifest = manifestRepository.manifests.get(URL_KEY);
      assert.equal(storedManifest.sha256, first.sha256);
      assert.equal(storedManifest.objectKey, first.object_key);
    },
  );
});
