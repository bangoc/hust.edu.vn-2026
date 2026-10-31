'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockApiServer } = require('../../mock/mock-api-server');

const FAST_LIFECYCLE_MS = { queued: 5, downloading: 10, storing: 5 };
const DEDUP_LIFECYCLE_MS = { queued: 100, downloading: 100, storing: 50 };

async function withMock(callback, lifecycleMs = FAST_LIFECYCLE_MS) {
  const mockApi = createMockApiServer({ lifecycleMs });
  const port = await mockApi.listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await callback(baseUrl, mockApi);
  } finally {
    await mockApi.close();
  }
}

async function submitUrl(baseUrl, body) {
  return fetch(`${baseUrl}/load`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForTerminal(baseUrl, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${jobId}`);
    const job = await response.json();
    if (job.status === 'done' || job.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Job ${jobId} không kết thúc`);
}

test('POST /load tạo job, job hoàn tất và content_ref đọc được', async () => {
  await withMock(async (baseUrl) => {
    const response = await submitUrl(baseUrl, {
      url: 'https://example.com/tai-lieu.pdf',
    });

    assert.equal(response.status, 202);
    const load = await response.json();
    assert.match(load.job_id, /^mock-\d{4}$/);
    assert.equal(load.status, 'queued');
    assert.equal(load.status_url, `/jobs/${load.job_id}`);
    assert.equal(load.deduplicated, false);

    const job = await waitForTerminal(baseUrl, load.job_id);
    assert.equal(job.status, 'done');
    assert.equal(job.format, 'other');
    assert.equal(job.extension, 'pdf');
    assert.equal(job.content_type, 'application/pdf');
    assert.equal(job.encoding, 'ref');
    assert.match(job.sha256, /^[a-f0-9]{64}$/);
    assert.match(job.content_ref, new RegExp(`^${baseUrl}/mock-content/`));
    assert.equal(job.auth_required, false);
    assert.equal(job.manifest_invalid, false);
    assert.equal(job.error, null);

    const contentResponse = await fetch(job.content_ref);
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers.get('content-type'), 'application/pdf');

    const stats = await (await fetch(`${baseUrl}/stats`)).json();
    assert.equal(stats.jobs.jobsCreated, 1);
    assert.equal(stats.jobs.jobsDone, 1);
    assert.equal(stats.jobs.documentDownloads, 1);
    assert.equal(stats.queue.doneJobs, 1);
  });
});

test('mock trả lỗi đúng envelope cho body và URL không hợp lệ', async () => {
  await withMock(async (baseUrl) => {
    const badJsonResponse = await fetch(`${baseUrl}/load`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(badJsonResponse.status, 400);
    assert.deepEqual(await badJsonResponse.json(), {
      error: { code: 'bad_json', message: 'JSON body không hợp lệ' },
    });

    const oversizedResponse = await submitUrl(baseUrl, {
      url: 'https://example.com/a',
      padding: 'x'.repeat(33 * 1024),
    });
    assert.equal(oversizedResponse.status, 413);
    assert.equal((await oversizedResponse.json()).error.code, 'payload_too_large');

    const emptyUrlResponse = await submitUrl(baseUrl, { url: '' });
    assert.equal(emptyUrlResponse.status, 400);
    assert.equal((await emptyUrlResponse.json()).error.code, 'invalid_request');

    const extraFieldResponse = await submitUrl(baseUrl, {
      url: 'https://example.com/a',
      unexpected: true,
    });
    assert.equal(extraFieldResponse.status, 400);
    assert.equal((await extraFieldResponse.json()).error.code, 'invalid_request');

    const invalidUrlResponse = await submitUrl(baseUrl, {
      url: 'ftp://example.com/a',
    });
    assert.equal(invalidUrlResponse.status, 400);
    assert.equal((await invalidUrlResponse.json()).error.code, 'invalid_url');

    const blockedHostResponse = await submitUrl(baseUrl, {
      url: 'http://127.0.0.1/a',
    });
    assert.equal(blockedHostResponse.status, 400);
    assert.equal((await blockedHostResponse.json()).error.code, 'blocked_host');

    const missingJobResponse = await fetch(`${baseUrl}/jobs/khong-ton-tai`);
    assert.equal(missingJobResponse.status, 404);
    assert.equal((await missingJobResponse.json()).error.code, 'not_found');
  });
});

test('hai request cùng URL trong lúc đang chạy trả cùng job và deduplicated', async () => {
  await withMock(async (baseUrl) => {
    const first = await (await submitUrl(baseUrl, { url: 'https://example.com/tai-lieu' })).json();
    const second = await (await submitUrl(baseUrl, { url: 'https://example.com/tai-lieu' })).json();

    assert.equal(second.job_id, first.job_id);
    assert.equal(second.deduplicated, true);
    assert.ok(['queued', 'downloading'].includes(second.status));

    await waitForTerminal(baseUrl, first.job_id);
  }, DEDUP_LIFECYCLE_MS);
});

test('URL /mock-fail tạo job failed và tăng counter lỗi', async () => {
  await withMock(async (baseUrl) => {
    const load = await (
      await submitUrl(baseUrl, { url: 'https://example.com/mock-fail' })
    ).json();
    const job = await waitForTerminal(baseUrl, load.job_id);

    assert.equal(job.status, 'failed');
    assert.deepEqual(job.error, {
      code: 'download_error',
      message: 'Mock failure theo kịch bản /mock-fail',
    });
    assert.equal(job.content_ref, null);

    const stats = await (await fetch(`${baseUrl}/stats`)).json();
    assert.equal(stats.jobs.jobsFailed, 1);
    assert.equal(stats.jobs.errorCounts.download_error, 1);
    assert.equal(stats.queue.failedJobs, 1);
  });
});

test('URL /mock-auth-required trả lỗi auth_required kèm final_url trang login', async () => {
  await withMock(async (baseUrl) => {
    const load = await (
      await submitUrl(baseUrl, { url: 'https://example.com/mock-auth-required' })
    ).json();
    const job = await waitForTerminal(baseUrl, load.job_id);

    assert.equal(job.status, 'failed');
    assert.equal(job.auth_required, true);
    assert.equal(job.manifest_invalid, false);
    assert.equal(job.final_url, 'https://example.com/login');
    assert.equal(job.content_ref, null);
    assert.equal(job.error.code, 'auth_required');
    assert.match(job.error.message, /đăng nhập/);

    const stats = await (await fetch(`${baseUrl}/stats`)).json();
    assert.equal(stats.jobs.jobsFailed, 1);
    assert.equal(stats.jobs.errorCounts.auth_required, 1);
  });
});

test('GET /ping phản ánh trạng thái và HTML được nhận diện đúng', async () => {
  await withMock(async (baseUrl) => {
    const idle = await (await fetch(`${baseUrl}/ping`)).json();
    assert.equal(idle.status, 'đang chờ');

    const load = await (
      await submitUrl(baseUrl, { url: 'https://example.com/tin-tuc' })
    ).json();
    const running = await (await fetch(`${baseUrl}/ping`)).json();
    assert.equal(running.status, 'đang tải');

    const job = await waitForTerminal(baseUrl, load.job_id);
    assert.equal(job.format, 'html');
    assert.equal(job.extension, 'html');
    assert.equal(job.content_type, 'text/html; charset=utf-8');

    const content = await fetch(job.content_ref);
    assert.equal(content.status, 200);
    assert.match(await content.text(), /Mock content/);

    const stats = await (await fetch(`${baseUrl}/stats`)).json();
    assert.equal(stats.jobs.htmlDownloads, 1);
    assert.equal(stats.browser.connected, true);
  }, DEDUP_LIFECYCLE_MS);
});
