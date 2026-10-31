'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestApp } = require('../helpers/with-test-app');
const { postJson, pollJob } = require('../helpers/http-test-server');

const HTML_URL = 'https://hust.edu.vn/tin-tuc';
const PDF_URL = 'https://hust.edu.vn/uploads/bm17.pdf';
const HTML_BYTES = Buffer.from('<!doctype html><html><body>Tin tức HUST</body></html>');
const PDF_BYTES = Buffer.from('%PDF-1.7\nnội dung pdf\n%%EOF');

async function runJob(baseUrl, url) {
  const load = await postJson(baseUrl, '/load', { url });
  assert.equal(load.status, 202, JSON.stringify(load.body));
  return pollJob(baseUrl, load.body.job_id);
}

test('PROBE_MODE=auto bỏ HEAD cho URL tài liệu và tải bằng FILE', async () => {
  await withTestApp(
    {
      configOverrides: { PROBE_MODE: 'auto' },
      responses: { [PDF_URL]: { bytes: PDF_BYTES, contentType: 'application/pdf' } },
    },
    async ({ baseUrl, sourceProbe, contentDownloader }) => {
      const job = await runJob(baseUrl, PDF_URL);

      assert.equal(job.status, 'done');
      assert.equal(job.format, 'other');
      assert.equal(job.extension, 'pdf');
      assert.equal(sourceProbe.calls.length, 0);
      assert.equal(contentDownloader.calls.length, 1);
      assert.equal(contentDownloader.calls[0].options.strategy, 'file');
    },
  );
});

test('PROBE_MODE=auto vẫn HEAD cho trang HTML', async () => {
  await withTestApp(
    {
      configOverrides: { PROBE_MODE: 'auto' },
      probes: { [HTML_URL]: { status: 200, contentType: 'text/html; charset=utf-8' } },
      responses: { [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html' } },
    },
    async ({ baseUrl, sourceProbe, contentDownloader }) => {
      const job = await runJob(baseUrl, HTML_URL);

      assert.equal(job.status, 'done');
      assert.equal(sourceProbe.calls.length, 1);
      assert.equal(contentDownloader.calls[0].options.strategy, 'html');
    },
  );
});

test('PROBE_MODE=never bỏ HEAD cho trang HTML và vẫn render', async () => {
  await withTestApp(
    {
      configOverrides: { PROBE_MODE: 'never' },
      responses: { [HTML_URL]: { bytes: HTML_BYTES, contentType: 'text/html' } },
    },
    async ({ baseUrl, sourceProbe, contentDownloader }) => {
      const job = await runJob(baseUrl, HTML_URL);

      assert.equal(job.status, 'done');
      assert.equal(job.format, 'html');
      assert.equal(sourceProbe.calls.length, 0);
      assert.equal(contentDownloader.calls.length, 1);
      assert.equal(contentDownloader.calls[0].options.strategy, 'html');
    },
  );
});

test('PROBE_MODE=always luôn HEAD kể cả URL tài liệu', async () => {
  await withTestApp(
    {
      configOverrides: { PROBE_MODE: 'always' },
      probes: { [PDF_URL]: { status: 200, contentType: 'application/pdf' } },
      responses: { [PDF_URL]: { bytes: PDF_BYTES, contentType: 'application/pdf' } },
    },
    async ({ baseUrl, sourceProbe, contentDownloader }) => {
      const job = await runJob(baseUrl, PDF_URL);

      assert.equal(job.status, 'done');
      assert.equal(sourceProbe.calls.length, 1);
      assert.equal(contentDownloader.calls[0].options.strategy, 'file');
    },
  );
});
