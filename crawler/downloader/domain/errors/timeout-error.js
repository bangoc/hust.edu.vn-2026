'use strict';

const { DomainError } = require('./domain-error');

class TimeoutError extends DomainError {
  constructor(message = 'Tải nội dung quá thời gian cho phép', options = {}) {
    super('timeout', message, { httpStatus: 504, retryable: true, ...options });
  }
}

module.exports = { TimeoutError };
