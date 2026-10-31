'use strict';

const { DomainError } = require('../errors/domain-error');
const { InvalidJobTransitionError } = require('../errors/invalid-job-transition-error');

const JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  DOWNLOADING: 'downloading',
  STORING: 'storing',
  DONE: 'done',
  FAILED: 'failed',
});

const ALL_JOB_STATUSES = Object.freeze(Object.values(JOB_STATUS));
const ACTIVE_JOB_STATUSES = Object.freeze([
  JOB_STATUS.QUEUED,
  JOB_STATUS.DOWNLOADING,
  JOB_STATUS.STORING,
]);
const TERMINAL_JOB_STATUSES = Object.freeze([JOB_STATUS.DONE, JOB_STATUS.FAILED]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [JOB_STATUS.QUEUED]: [JOB_STATUS.DOWNLOADING, JOB_STATUS.FAILED],
  [JOB_STATUS.DOWNLOADING]: [JOB_STATUS.STORING, JOB_STATUS.FAILED],
  [JOB_STATUS.STORING]: [JOB_STATUS.DONE, JOB_STATUS.FAILED],
  [JOB_STATUS.DONE]: [],
  [JOB_STATUS.FAILED]: [],
});

class JobStatus {
  constructor(value) {
    if (!ALL_JOB_STATUSES.includes(value)) {
      throw new DomainError('invalid_job_status', `Trạng thái job không hợp lệ: ${value}`);
    }
    this.value = value;
    Object.freeze(this);
  }

  static from(value) {
    return new JobStatus(value);
  }

  get isActive() {
    return ACTIVE_JOB_STATUSES.includes(this.value);
  }

  get isTerminal() {
    return TERMINAL_JOB_STATUSES.includes(this.value);
  }

  toString() {
    return this.value;
  }
}

function isActiveJobStatus(value) {
  return ACTIVE_JOB_STATUSES.includes(value);
}

function isTerminalJobStatus(value) {
  return TERMINAL_JOB_STATUSES.includes(value);
}

function assertJobTransition(fromStatus, toStatus) {
  const allowedNextStatuses = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowedNextStatuses || !allowedNextStatuses.includes(toStatus)) {
    throw new InvalidJobTransitionError(fromStatus, toStatus);
  }
}

module.exports = {
  JOB_STATUS,
  ALL_JOB_STATUSES,
  ACTIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  ALLOWED_TRANSITIONS,
  JobStatus,
  isActiveJobStatus,
  isTerminalJobStatus,
  assertJobTransition,
};
