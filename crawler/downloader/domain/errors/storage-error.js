'use strict';

const { DomainError } = require('./domain-error');

class StorageError extends DomainError {
  constructor(message = 'Không thể lưu nội dung vào object storage', options = {}) {
    super('storage_error', message, { httpStatus: 500, retryable: true, ...options });
  }
}

module.exports = { StorageError };
