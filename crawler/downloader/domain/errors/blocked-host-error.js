'use strict';

const { DomainError } = require('./domain-error');

class BlockedHostError extends DomainError {
  constructor(message = 'Host bị chặn bởi chính sách an toàn', options = {}) {
    super('blocked_host', message, { httpStatus: 400, ...options });
  }
}

module.exports = { BlockedHostError };
