'use strict';

const { DomainError } = require('../../../../domain/errors/domain-error');

function createErrorHandler({ logger = null } = {}) {
  return function errorHandler(error, req, res, next) {
    if (res.headersSent) {
      return next(error);
    }

    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: { code: 'bad_json', message: 'JSON body không hợp lệ' },
      });
    }

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({
        error: { code: 'payload_too_large', message: 'JSON body vượt quá giới hạn cho phép' },
      });
    }

    const status = error instanceof DomainError ? error.httpStatus : 500;
    const code = error instanceof DomainError ? error.code : 'internal_error';
    const message =
      error instanceof DomainError ? error.message : 'Lỗi nội bộ của dịch vụ tải nội dung';

    if (status >= 500) {
      logger?.error('http_request_failed', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status,
        errorCode: code,
      });
    } else {
      logger?.warn('http_request_rejected', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        status,
        errorCode: code,
      });
    }

    return res.status(status).json({
      error: { code, message },
    });
  };
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: 'Không tìm thấy route' },
  });
}

module.exports = { createErrorHandler, notFoundHandler };
