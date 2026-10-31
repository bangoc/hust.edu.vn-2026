'use strict';

/**
 * Lỗi nghiệp vụ có mã ổn định để adapter HTTP map sang response.
 * Không chứa body nội dung tải về, presigned URL hay secret.
 */
class DomainError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

module.exports = { DomainError };
