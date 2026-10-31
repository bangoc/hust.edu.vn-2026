'use strict';

const { DomainError } = require('./domain-error');

class RobotsDisallowedError extends DomainError {
  constructor(message = 'URL bị robots.txt của host từ chối', options = {}) {
    super('robots_disallowed', message, { httpStatus: 403, ...options });
  }
}

module.exports = { RobotsDisallowedError };
