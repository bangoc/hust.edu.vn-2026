'use strict';

const express = require('express');
const { requestContext } = require('./adapters/inbound/http/middleware/request-context');
const { createErrorHandler, notFoundHandler } = require('./adapters/inbound/http/middleware/error-handler');
const { createRoutes } = require('./adapters/inbound/http/routes');

function createApp({
  downloadController,
  healthController,
  statsController,
  logger = null,
  jsonLimit = '32kb',
}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(express.json({ limit: jsonLimit, strict: true }));
  app.use(createRoutes({ downloadController, healthController, statsController }));
  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));

  return app;
}

module.exports = { createApp };
