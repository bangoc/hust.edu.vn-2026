'use strict';

const { DomainError } = require('./domain-error');

class AuthRequiredError extends DomainError {
  constructor(message = 'Nguồn yêu cầu đăng nhập để truy cập nội dung', options = {}) {
    const { finalUrl = null, reason = null, ...rest } = options;
    super('auth_required', message, {
      httpStatus: 401,
      retryable: false,
      ...rest,
      details: {
        finalUrl,
        reason,
        ...(rest.details ?? {}),
      },
    });
    this.finalUrl = finalUrl;
    this.reason = reason;
  }
}

module.exports = { AuthRequiredError };
