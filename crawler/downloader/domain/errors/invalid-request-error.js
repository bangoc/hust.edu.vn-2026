'use strict';

const { DomainError } = require('./domain-error');

class InvalidRequestError extends DomainError {
  constructor(message = 'Dữ liệu yêu cầu không hợp lệ', options = {}) {
    super('invalid_request', message, { httpStatus: 400, ...options });
  }
}

module.exports = { InvalidRequestError };
