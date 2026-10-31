'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DownloadJob } = require('../../domain/entities/download-job');
const { JOB_STATUS } = require('../../domain/value-objects/job-status');
const { FakeClock } = require('../helpers/fake-clock');

function createJob(clock) {
  return DownloadJob.create({
    jobId: 'job-123',
    url: 'https://hust.edu.vn/tin-tuc',
    normalizedUrl: 'https://hust.edu.vn/tin-tuc',
    urlKey: 'a'.repeat(64),
    now: clock.now(),
  });
}

test('DownloadJob.create tạo job queued bất biến', () => {
  const clock = new FakeClock();
  const job = createJob(clock);

  assert.equal(job.status, JOB_STATUS.QUEUED);
  assert.equal(job.force, false);
  assert.equal(Object.isFrozen(job), true);
  assert.equal(job.toSnapshot().createdAt, clock.now().toISOString());
});

test('transition trả về job mới và không sửa job cũ', () => {
  const clock = new FakeClock();
  const queuedJob = createJob(clock);
  const downloadingJob = queuedJob.transition(JOB_STATUS.DOWNLOADING, {
    now: clock.advance(100),
  });

  assert.equal(queuedJob.status, JOB_STATUS.QUEUED);
  assert.equal(downloadingJob.status, JOB_STATUS.DOWNLOADING);
  assert.notEqual(queuedJob, downloadingJob);
  assert.equal(downloadingJob.updatedAt.getTime(), clock.now().getTime());
});

test('job done phải có result và job failed phải có error', () => {
  const clock = new FakeClock();
  const downloadingJob = createJob(clock).transition(JOB_STATUS.DOWNLOADING, { now: clock.now() });
  const storingJob = downloadingJob.transition(JOB_STATUS.STORING, { now: clock.now() });

  assert.throws(
    () => storingJob.transition(JOB_STATUS.DONE, { now: clock.now() }),
    (error) => error.code === 'missing_job_result',
  );
  assert.throws(
    () => downloadingJob.transition(JOB_STATUS.FAILED, { now: clock.now() }),
    (error) => error.code === 'missing_job_error',
  );
});

test('job đi hết chuỗi done và giữ result', () => {
  const clock = new FakeClock();
  const job = createJob(clock)
    .transition(JOB_STATUS.DOWNLOADING, { now: clock.now() })
    .transition(JOB_STATUS.STORING, { now: clock.now() })
    .transition(JOB_STATUS.DONE, {
      now: clock.now(),
      result: { objectKey: 'raw/abc', format: 'html' },
    });

  assert.equal(job.status, JOB_STATUS.DONE);
  assert.equal(job.result.objectKey, 'raw/abc');
  assert.equal(Object.isFrozen(job.result), true);
});
