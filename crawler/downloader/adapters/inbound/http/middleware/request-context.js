'use strict';

const { randomUUID } = require('node:crypto');

const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function requestContext(req, res, next) {
  const incomingRequestId = req.get('x-request-id');
  const requestId =
    incomingRequestId && SAFE_REQUEST_ID_PATTERN.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}

module.exports = { requestContext, SAFE_REQUEST_ID_PATTERN };
