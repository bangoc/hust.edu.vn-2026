'use strict';

const { DomainError } = require('../errors/domain-error');
const { JOB_STATUS, assertJobTransition } = require('../value-objects/job-status');

function freezePlainObject(value) {
  return value === null || value === undefined ? null : Object.freeze({ ...value });
}

class DownloadJob {
  #jobId;
  #url;
  #normalizedUrl;
  #urlKey;
  #status;
  #force;
  #createdAt;
  #updatedAt;
  #result;
  #error;

  constructor({
    jobId,
    url,
    normalizedUrl,
    urlKey,
    status,
    force = false,
    createdAt,
    updatedAt,
    result = null,
    error = null,
  }) {
    if (!jobId || typeof jobId !== 'string') {
      throw new DomainError('invalid_job_id', 'Job phải có jobId');
    }
    if (!url || !normalizedUrl || !urlKey) {
      throw new DomainError('invalid_job_url', 'Job phải có url, normalizedUrl và urlKey');
    }
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
      throw new DomainError('invalid_job_timestamp', 'createdAt của job không hợp lệ');
    }
    if (!(updatedAt instanceof Date) || Number.isNaN(updatedAt.getTime())) {
      throw new DomainError('invalid_job_timestamp', 'updatedAt của job không hợp lệ');
    }

    this.#jobId = jobId;
    this.#url = url;
    this.#normalizedUrl = normalizedUrl;
    this.#urlKey = urlKey;
    this.#status = status;
    this.#force = Boolean(force);
    this.#createdAt = new Date(createdAt.getTime());
    this.#updatedAt = new Date(updatedAt.getTime());
    this.#result = freezePlainObject(result);
    this.#error = freezePlainObject(error);
    Object.freeze(this);
  }

  static create({ jobId, url, normalizedUrl, urlKey, force = false, now = new Date() }) {
    return new DownloadJob({
      jobId,
      url,
      normalizedUrl,
      urlKey,
      status: JOB_STATUS.QUEUED,
      force,
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
    });
  }

  get jobId() {
    return this.#jobId;
  }

  get url() {
    return this.#url;
  }

  get normalizedUrl() {
    return this.#normalizedUrl;
  }

  get urlKey() {
    return this.#urlKey;
  }

  get status() {
    return this.#status;
  }

  get force() {
    return this.#force;
  }

  get createdAt() {
    return new Date(this.#createdAt.getTime());
  }

  get updatedAt() {
    return new Date(this.#updatedAt.getTime());
  }

  get result() {
    return this.#result;
  }

  get error() {
    return this.#error;
  }

  transition(nextStatus, { result = null, error = null, now = new Date() } = {}) {
    assertJobTransition(this.#status, nextStatus);

    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new DomainError('invalid_job_timestamp', 'Thời điểm chuyển trạng thái job không hợp lệ');
    }
    if (nextStatus === JOB_STATUS.DONE && !result) {
      throw new DomainError('missing_job_result', 'Job done phải có kết quả');
    }
    if (nextStatus === JOB_STATUS.FAILED && !error) {
      throw new DomainError('missing_job_error', 'Job failed phải có lỗi');
    }

    return new DownloadJob({
      jobId: this.#jobId,
      url: this.#url,
      normalizedUrl: this.#normalizedUrl,
      urlKey: this.#urlKey,
      status: nextStatus,
      force: this.#force,
      createdAt: this.#createdAt,
      updatedAt: now,
      result: nextStatus === JOB_STATUS.DONE ? result : null,
      error: nextStatus === JOB_STATUS.FAILED ? error : null,
    });
  }

  toSnapshot() {
    return {
      jobId: this.#jobId,
      url: this.#url,
      normalizedUrl: this.#normalizedUrl,
      urlKey: this.#urlKey,
      status: this.#status,
      force: this.#force,
      createdAt: new Date(this.#createdAt.getTime()).toISOString(),
      updatedAt: new Date(this.#updatedAt.getTime()).toISOString(),
      result: this.#result,
      error: this.#error,
    };
  }
}

module.exports = { DownloadJob };
