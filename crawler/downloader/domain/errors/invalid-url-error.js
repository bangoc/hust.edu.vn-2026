'use strict';

const { DomainError } = require('./domain-error');

class InvalidUrlError extends DomainError {
  constructor(message = 'URL không hợp lệ', options = {}) {
    super('invalid_url', message, { httpStatus: 400, ...options });
  }
}

module.exports = { InvalidUrlError };
