'use strict';

const { DomainError } = require('./domain-error');

class ManifestError extends DomainError {
  constructor(message = 'Không thể đọc hoặc ghi manifest URL', options = {}) {
    super('manifest_error', message, { httpStatus: 500, retryable: true, ...options });
  }
}

module.exports = { ManifestError };
