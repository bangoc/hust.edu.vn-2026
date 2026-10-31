'use strict';

const { DomainError } = require('./domain-error');

/**
 * Không chuyển được nội dung đã tải sang module đọc nội dung.
 * Lỗi này không làm job thất bại; nó chỉ được ghi vào kết quả job.
 */
class ForwardError extends DomainError {
  constructor(message = 'Không chuyển được nội dung sang module đọc', options = {}) {
    super('forward_error', message, {
      httpStatus: 502,
      retryable: false,
      ...options,
      details: {
        upstreamStatus: options.upstreamStatus ?? null,
        ...(options.details ?? {}),
      },
    });
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

module.exports = { ForwardError };
