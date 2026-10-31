'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestApp } = require('../helpers/with-test-app');
const { postJson, pollJob } = require('../helpers/http-test-server');
const { DownloadError } = require('../../domain/errors/download-error');

const PROTECTED_HTML_URL = 'https://hust.edu.vn/tai-lieu-noi-bo';
const PROTECTED_PDF_URL = 'https://hust.edu.vn/tai-lieu-noi-bo.pdf';
const LOGIN_URL = 'https://hust.edu.vn/login?returnUrl=%2Ftai-lieu-noi-bo';

async function runJob(baseUrl, url) {
  const load = await postJson(baseUrl, '/load', { url });
  assert.equal(load.status, 202, JSON.stringify(load.body));
  return pollJob(baseUrl, load.body.job_id);
}

function assertAuthRequiredFailure(job) {
  assert.equal(job.status, 'failed');
  assert.equal(job.auth_required, true);
  assert.equal(job.error.code, 'auth_required');
  assert.equal(job.content_ref, null);
  assert.equal(job.manifest_invalid, false);
}

test('probe redirect tới trang login làm job thất bại auth_required', async () => {
  await withTestApp(
    {
      probes: {
        [PROTECTED_HTML_URL]: {
          status: 200,
          contentType: 'text/html',
          finalUrl: LOGIN_URL,
        },
      },
    },
    async ({ baseUrl, contentStorage, manifestRepository, contentDownloader }) => {
      const job = await runJob(baseUrl, PROTECTED_HTML_URL);

      assertAuthRequiredFailure(job);
      assert.equal(job.final_url, LOGIN_URL);
      assert.equal(contentDownloader.calls.length, 0);
      assert.equal(contentStorage.objects.size, 0);
      assert.equal(manifestRepository.manifests.size, 0);
    },
  );
});

test('downloader redirect tới trang đăng nhập không lưu trang login', async () => {
  await withTestApp(
    {
      configOverrides: { PROBE_MODE: 'auto' },
      responses: {
        [PROTECTED_PDF_URL]: {
          bytes: Buffer.from('<html><body>Vui lòng đăng nhập</body></html>'),
          contentType: 'text/html; charset=utf-8',
          finalUrl: 'https://hust.edu.vn/dang-nhap',
        },
      },
    },
    async ({ baseUrl, contentStorage, manifestRepository, sourceProbe }) => {
      const job = await runJob(baseUrl, PROTECTED_PDF_URL);

      assertAuthRequiredFailure(job);
      assert.equal(job.final_url, 'https://hust.edu.vn/dang-nhap');
      assert.equal(sourceProbe.calls.length, 0);
      assert.equal(contentStorage.objects.size, 0);
      assert.equal(manifestRepository.manifests.size, 0);
    },
  );
});

test('nguồn trả HTTP 401 làm job thất bại auth_required', async () => {
  await withTestApp(
    {
      configOverrides: { PROBE_MODE: 'auto' },
      responses: {
        [PROTECTED_PDF_URL]: {
          error: new DownloadError('Nguồn trả HTTP 401', {
            upstreamStatus: 401,
            details: { finalUrl: PROTECTED_PDF_URL },
          }),
        },
      },
    },
    async ({ baseUrl, contentStorage, manifestRepository }) => {
      const job = await runJob(baseUrl, PROTECTED_PDF_URL);

      assertAuthRequiredFailure(job);
      assert.equal(job.final_url, PROTECTED_PDF_URL);
      assert.equal(contentStorage.objects.size, 0);
      assert.equal(manifestRepository.manifests.size, 0);
    },
  );
});

test('probe nhận HTTP 401 làm job thất bại auth_required', async () => {
  await withTestApp(
    {
      probes: { [PROTECTED_HTML_URL]: { status: 401, contentType: null } },
    },
    async ({ baseUrl, contentDownloader }) => {
      const job = await runJob(baseUrl, PROTECTED_HTML_URL);

      assertAuthRequiredFailure(job);
      assert.equal(contentDownloader.calls.length, 0);
    },
  );
});
