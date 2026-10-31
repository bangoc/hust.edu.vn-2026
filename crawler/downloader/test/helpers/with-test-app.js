'use strict';

const { createTestContainer } = require('./create-test-container');
const { startAppServer } = require('./http-test-server');

async function withTestApp(options, callback) {
  const context = createTestContainer(options);
  const server = await startAppServer(context.container.app);

  try {
    return await callback({ ...context, baseUrl: server.baseUrl });
  } finally {
    await server.close();
    await context.container.close();
  }
}

module.exports = { withTestApp };
