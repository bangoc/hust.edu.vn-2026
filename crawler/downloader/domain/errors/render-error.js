'use strict';

const { DomainError } = require('./domain-error');

class RenderError extends DomainError {
  constructor(message = 'Không thể render trang HTML bằng trình duyệt headless', options = {}) {
    super('render_error', message, { httpStatus: 502, retryable: true, ...options });
  }
}

module.exports = { RenderError };
