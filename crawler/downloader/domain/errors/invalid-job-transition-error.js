'use strict';

const { DomainError } = require('./domain-error');

class InvalidJobTransitionError extends DomainError {
  constructor(fromStatus, toStatus) {
    super(
      'invalid_job_transition',
      `Không thể chuyển job từ "${fromStatus}" sang "${toStatus}"`,
      { httpStatus: 500 },
    );
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

module.exports = { InvalidJobTransitionError };
