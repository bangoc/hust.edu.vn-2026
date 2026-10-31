'use strict';

const { DomainError } = require('./domain-error');

class InvalidManifestError extends DomainError {
  constructor(message = 'Manifest URL không đọc được hoặc sai định dạng', options = {}) {
    super('manifest_invalid', message, {
      httpStatus: 500,
      retryable: false,
      ...options,
    });
  }
}

module.exports = { InvalidManifestError };
