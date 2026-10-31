'use strict';

const http = require('node:http');
const { once } = require('node:events');

async function startHttpServer(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function startAppServer(app) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function postJson(baseUrl, path, body, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response), headers: response.headers };
}

async function getJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: options.headers ?? {},
  });
  return { status: response.status, body: await readJson(response), headers: response.headers };
}

async function pollJob(baseUrl, jobId, { timeoutMs = 3000, intervalMs = 10 } = {}) {
  const startedAt = Date.now();
  for (;;) {
    const result = await getJson(baseUrl, `/jobs/${jobId}`);
    if (result.body.status === 'done' || result.body.status === 'failed') {
      return result.body;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Job ${jobId} không kết thúc sau ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = {
  startHttpServer,
  startAppServer,
  closeServer,
  readJson,
  postJson,
  getJson,
  pollJob,
};
