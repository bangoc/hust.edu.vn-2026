'use strict';

const express = require('express');
const { asyncHandler } = require('./middleware/async-handler');

function createRoutes({ downloadController, healthController, statsController }) {
  const router = express.Router();

  router.post('/load', asyncHandler(downloadController.load));
  router.get('/jobs/:jobId', asyncHandler(downloadController.getJob));
  router.get('/ping', healthController.getPing);
  router.get('/stats', statsController.getStats);

  return router;
}

module.exports = { createRoutes };
