'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  JOB_STATUS,
  JobStatus,
  assertJobTransition,
  isActiveJobStatus,
  isTerminalJobStatus,
} = require('../../domain/value-objects/job-status');

test('các transition hợp lệ của state machine', () => {
  assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.QUEUED, JOB_STATUS.DOWNLOADING));
  assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.DOWNLOADING, JOB_STATUS.STORING));
  assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.STORING, JOB_STATUS.DONE));
  assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.DOWNLOADING, JOB_STATUS.FAILED));
});

test('transition không hợp lệ bị từ chối', () => {
  assert.throws(
    () => assertJobTransition(JOB_STATUS.QUEUED, JOB_STATUS.DONE),
    (error) => error.code === 'invalid_job_transition',
  );
  assert.throws(
    () => assertJobTransition(JOB_STATUS.DONE, JOB_STATUS.FAILED),
    (error) => error.code === 'invalid_job_transition',
  );
});

test('JobStatus phân loại active và terminal', () => {
  assert.equal(JobStatus.from(JOB_STATUS.QUEUED).isActive, true);
  assert.equal(JobStatus.from(JOB_STATUS.DONE).isTerminal, true);
  assert.equal(isActiveJobStatus(JOB_STATUS.STORING), true);
  assert.equal(isTerminalJobStatus(JOB_STATUS.FAILED), true);
  assert.equal(isActiveJobStatus(JOB_STATUS.DONE), false);
});

test('JobStatus từ chối giá trị lạ', () => {
  assert.throws(() => JobStatus.from('pending'), (error) => error.code === 'invalid_job_status');
});
