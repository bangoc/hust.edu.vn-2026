'use strict';

const { DomainError } = require('./domain-error');

class QueueFullError extends DomainError {
  constructor(message = 'Hàng đợi tải đã đầy, vui lòng thử lại sau', options = {}) {
    super('queue_full', message, { httpStatus: 503, retryable: true, ...options });
  }
}

module.exports = { QueueFullError };
