'use strict';

const { DomainError } = require('./domain-error');

class NotFoundError extends DomainError {
  constructor(message = 'Không tìm thấy tài nguyên', options = {}) {
    super('not_found', message, { httpStatus: 404, ...options });
  }
}

module.exports = { NotFoundError };
