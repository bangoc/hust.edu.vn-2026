'use strict';

const { DomainError } = require('./domain-error');

class TooLargeError extends DomainError {
  constructor(message = 'Nội dung vượt quá giới hạn kích thước', options = {}) {
    super('too_large', message, { httpStatus: 413, ...options });
  }
}

module.exports = { TooLargeError };
