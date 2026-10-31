'use strict';

const { DomainError } = require('./domain-error');

class DownloadError extends DomainError {
  constructor(message = 'Không thể tải nội dung', options = {}) {
    super('download_error', message, {
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

module.exports = { DownloadError };
