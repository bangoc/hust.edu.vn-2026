'use strict';

const http = require('node:http');
const { createHash } = require('node:crypto');

const DEFAULT_PORT = 8899;
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_LIFECYCLE_MS = Object.freeze({
  queued: 250,
  downloading: 750,
  storing: 250,
});
const BLOCKED_HOSTNAMES = Object.freeze(
  new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata.google.internal']),
);

function createMockApiServer({ lifecycleMs = DEFAULT_LIFECYCLE_MS, now = () => new Date() } = {}) {
  const jobs = new Map();
  const activeByUrlKey = new Map();
  const timers = new Set();
  const startedAt = now();
  const counters = {
    jobsCreated: 0,
    jobsDone: 0,
    jobsFailed: 0,
    deduplicatedRequests: 0,
    htmlDownloads: 0,
    documentDownloads: 0,
    downloadedBytes: 0,
  };
  const errorCounts = new Map();
  let jobSequence = 0;

  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, errorBody('internal_error', 'Lỗi nội bộ của mock API'));
      } else {
        response.end();
      }
    });
  });

  async function handleRequest(request, response) {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, `http://${request.headers.host ?? '127.0.0.1'}`);
    const origin = `http://${request.headers.host ?? '127.0.0.1'}`;

    if (request.method === 'GET' && requestUrl.pathname === '/ping') {
      sendJson(response, 200, { status: pingStatus() });
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/stats') {
      sendJson(response, 200, statsSnapshot());
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/load') {
      await handleLoad(request, response);
      return;
    }

    const jobMatch = requestUrl.pathname.match(/^\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]));
      if (!job) {
        sendJson(response, 404, errorBody('not_found', 'Không tìm thấy job'));
        return;
      }
      sendJson(response, 200, toJobResponse(job, origin));
      return;
    }

    const contentMatch = requestUrl.pathname.match(/^\/mock-content\/([^/]+)$/);
    if (request.method === 'GET' && contentMatch) {
      const job = jobs.get(decodeURIComponent(contentMatch[1]));
      if (!job || job.status !== 'done' || !job.result) {
        sendJson(response, 404, errorBody('not_found', 'Chưa có nội dung cho job này'));
        return;
      }
      sendMockContent(response, job);
      return;
    }

    sendJson(response, 404, errorBody('not_found', 'Không tìm thấy route'));
  }

  async function handleLoad(request, response) {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      if (error.code === 'body_too_large') {
        sendJson(response, 413, errorBody('payload_too_large', 'JSON body vượt quá giới hạn'));
        return;
      }
      sendJson(response, 400, errorBody('bad_json', 'JSON body không hợp lệ'));
      return;
    }

    const validation = validateLoadBody(body);
    if (!validation.ok) {
      sendJson(response, 400, errorBody('invalid_request', validation.message));
      return;
    }

    let normalizedUrl;
    try {
      normalizedUrl = normalizeMockUrl(validation.url);
    } catch (error) {
      sendJson(response, 400, errorBody(error.code, error.message));
      return;
    }

    if (isBlockedMockHost(normalizedUrl.hostname)) {
      sendJson(
        response,
        400,
        errorBody('blocked_host', `Host ${normalizedUrl.hostname} bị chặn trong mock API`),
      );
      return;
    }

    const urlKey = sha256Hex(normalizedUrl.href);
    const activeJobId = activeByUrlKey.get(urlKey);
    const activeJob = activeJobId ? jobs.get(activeJobId) : null;
    if (activeJob) {
      counters.deduplicatedRequests += 1;
      sendJson(response, 202, {
        job_id: activeJob.jobId,
        status: activeJob.status,
        status_url: `/jobs/${activeJob.jobId}`,
        deduplicated: true,
      });
      return;
    }

    const job = {
      jobId: `mock-${String(++jobSequence).padStart(4, '0')}`,
      url: validation.url,
      normalizedUrl: normalizedUrl.href,
      urlKey,
      force: validation.force,
      status: 'queued',
      result: null,
      error: null,
      terminal: false,
      createdAt: now(),
      updatedAt: now(),
    };

    jobs.set(job.jobId, job);
    activeByUrlKey.set(urlKey, job.jobId);
    counters.jobsCreated += 1;
    scheduleLifecycle(job.jobId);

    sendJson(response, 202, {
      job_id: job.jobId,
      status: job.status,
      status_url: `/jobs/${job.jobId}`,
      deduplicated: false,
    });
  }

  function scheduleLifecycle(jobId) {
    schedule(lifecycleMs.queued, () => {
      transition(jobId, 'downloading');
      schedule(lifecycleMs.downloading, () => {
        transition(jobId, 'storing');
        schedule(lifecycleMs.storing, () => finishJob(jobId));
      });
    });
  }

  function schedule(delayMs, callback) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, Math.max(0, delayMs));
    timers.add(timer);
  }

  function transition(jobId, status) {
    const job = jobs.get(jobId);
    if (!job || job.terminal) {
      return;
    }
    jobs.set(jobId, { ...job, status, updatedAt: now() });
  }

  function finishJob(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.terminal) {
      return;
    }

    activeByUrlKey.delete(job.urlKey);
    const fetchedAt = now().toISOString();
    const jobUrl = new URL(job.normalizedUrl);

    if (jobUrl.pathname.endsWith('/mock-auth-required')) {
      const error = {
        code: 'auth_required',
        message: 'Mock yêu cầu đăng nhập theo kịch bản /mock-auth-required',
        finalUrl: new URL('/login', jobUrl.origin).href,
      };
      jobs.set(jobId, {
        ...job,
        status: 'failed',
        error,
        terminal: true,
        updatedAt: now(),
      });
      counters.jobsFailed += 1;
      errorCounts.set(error.code, (errorCounts.get(error.code) ?? 0) + 1);
      return;
    }

    if (jobUrl.pathname.endsWith('/mock-fail')) {
      const error = { code: 'download_error', message: 'Mock failure theo kịch bản /mock-fail' };
      jobs.set(jobId, {
        ...job,
        status: 'failed',
        error,
        terminal: true,
        updatedAt: now(),
      });
      counters.jobsFailed += 1;
      errorCounts.set(error.code, (errorCounts.get(error.code) ?? 0) + 1);
      return;
    }

    const formatInfo = detectMockFormat(job.normalizedUrl);
    const contentHash = sha256Hex(`mock-content:${job.urlKey}`);

    jobs.set(jobId, {
      ...job,
      status: 'done',
      terminal: true,
      updatedAt: now(),
      result: {
        finalUrl: job.normalizedUrl,
        format: formatInfo.format,
        contentType: formatInfo.contentType,
        extension: formatInfo.extension,
        objectKey: `raw/${contentHash}`,
        size: 1024,
        sha256: contentHash,
        httpStatus: 200,
        fetchedAt,
        contentPath: `/mock-content/${job.jobId}`,
        deduplicated: false,
        notModified: false,
        authRequired: false,
        manifestInvalid: false,
        redownloaded: false,
        contentChanged: false,
        duplicateContent: false,
        previousSha256: null,
        previousFetchedAt: null,
      },
    });

    counters.jobsDone += 1;
    counters.downloadedBytes += 1024;
    if (formatInfo.format === 'html') {
      counters.htmlDownloads += 1;
    } else {
      counters.documentDownloads += 1;
    }
  }

  function pingStatus() {
    const snapshot = queueSnapshot();
    if (snapshot.active >= snapshot.concurrency && snapshot.queued > 0) {
      return 'đang bận';
    }
    if (snapshot.active > 0 || snapshot.queued > 0) {
      return 'đang tải';
    }
    return 'đang chờ';
  }

  function queueSnapshot() {
    let queued = 0;
    let active = 0;
    for (const job of jobs.values()) {
      if (job.status === 'queued') {
        queued += 1;
      }
      if (job.status === 'downloading' || job.status === 'storing') {
        active += 1;
      }
    }
    return {
      queued,
      active,
      concurrency: 2,
      queueSize: 20,
      capacity: 22,
      totalJobs: jobs.size,
      doneJobs: counters.jobsDone,
      failedJobs: counters.jobsFailed,
    };
  }

  function statsSnapshot() {
    const queue = queueSnapshot();
    const uptimeSeconds = Math.max(
      0,
      Math.floor((now().getTime() - startedAt.getTime()) / 1000),
    );
    return {
      queue,
      jobs: {
        ...counters,
        notModifiedDownloads: 0,
        redownloadedSameContent: 0,
        changedContent: 0,
        duplicateContent: 0,
        errorCounts: Object.fromEntries(errorCounts),
        startedAt: startedAt.toISOString(),
        uptimeSeconds,
      },
      browser: {
        activePages: queue.active,
        pagesServed: counters.jobsCreated,
        maxPages: 2,
        connected: true,
      },
    };
  }

  async function listen(port = DEFAULT_PORT, host = '127.0.0.1') {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    return server.address().port;
  }

  async function close() {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();

    if (!server.listening) {
      return;
    }
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  return {
    server,
    listen,
    close,
    getJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    statsSnapshot,
  };
}

function validateLoadBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Body phải là JSON object' };
  }

  const unknownKeys = Object.keys(body).filter((key) => key !== 'url' && key !== 'force');
  if (unknownKeys.length > 0) {
    return { ok: false, message: `Field không được hỗ trợ: ${unknownKeys.join(', ')}` };
  }
  if (typeof body.url !== 'string' || body.url.trim().length === 0) {
    return { ok: false, message: 'url phải là chuỗi không rỗng' };
  }
  if (body.force !== undefined && typeof body.force !== 'boolean') {
    return { ok: false, message: 'force phải là boolean' };
  }

  return { ok: true, url: body.url.trim(), force: body.force ?? false };
}

function normalizeMockUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL không đúng định dạng'), { code: 'invalid_url' });
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw Object.assign(new Error('Chỉ hỗ trợ URL http hoặc https'), { code: 'invalid_url' });
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw Object.assign(
      new Error('URL không được chứa thông tin đăng nhập'),
      { code: 'invalid_url' },
    );
  }

  parsedUrl.hash = '';
  return parsedUrl;
}

function isBlockedMockHost(hostname) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    BLOCKED_HOSTNAMES.has(normalizedHostname) || normalizedHostname.endsWith('.localhost')
  );
}

function detectMockFormat(url) {
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    pathname = '';
  }

  if (pathname.endsWith('.pdf')) {
    return { format: 'other', extension: 'pdf', contentType: 'application/pdf' };
  }
  if (pathname.endsWith('.docx')) {
    return {
      format: 'other',
      extension: 'docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (pathname.endsWith('.doc')) {
    return { format: 'other', extension: 'doc', contentType: 'application/msword' };
  }
  if (pathname.endsWith('.xlsx')) {
    return {
      format: 'other',
      extension: 'xlsx',
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  if (pathname.endsWith('.pptx')) {
    return {
      format: 'other',
      extension: 'pptx',
      contentType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  }
  return { format: 'html', extension: 'html', contentType: 'text/html; charset=utf-8' };
}

function toJobResponse(job, origin) {
  const result = job.result ?? {};
  return {
    job_id: job.jobId,
    status: job.status,
    url: job.url,
    final_url: result.finalUrl ?? job.error?.finalUrl ?? null,
    url_key: job.urlKey,
    format: result.format ?? null,
    content_type: result.contentType ?? null,
    extension: result.extension ?? null,
    encoding: result.objectKey ? 'ref' : null,
    content_ref: result.contentPath ? `${origin}${result.contentPath}` : null,
    object_key: result.objectKey ?? null,
    size: result.size ?? null,
    sha256: result.sha256 ?? null,
    http_status: result.httpStatus ?? null,
    fetched_at: result.fetchedAt ?? null,
    deduplicated: result.deduplicated ?? false,
    not_modified: result.notModified ?? false,
    auth_required: result.authRequired ?? (job.error?.code === 'auth_required'),
    manifest_invalid: result.manifestInvalid ?? false,
    redownloaded: result.redownloaded ?? false,
    content_changed: result.contentChanged ?? false,
    duplicate_content: result.duplicateContent ?? false,
    forced: job.force,
    previous_sha256: result.previousSha256 ?? null,
    previous_fetched_at: result.previousFetchedAt ?? null,
    // Mock không chuyển nội dung sang module đọc.
    forwarded: null,
    forward_error: null,
    error: job.error,
  };
}

function sendMockContent(response, job) {
  const format = job.result.format;
  let body;
  let contentType;

  if (format === 'html') {
    body = `<html><body><h1>Mock content</h1><p>${escapeHtml(job.url)}</p></body></html>`;
    contentType = 'text/html; charset=utf-8';
  } else if (job.result.extension === 'pdf') {
    body = `%PDF-1.4\n% Mock content for ${job.url}\n%%EOF\n`;
    contentType = 'application/pdf';
  } else {
    body = `MOCK-DOCUMENT ${job.url}\n`;
    contentType = 'application/octet-stream';
  }

  const payload = Buffer.from(body, 'utf8');
  response.writeHead(200, {
    ...corsHeaders(),
    'content-type': contentType,
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    ...corsHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  response.end(body);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

function errorBody(code, message) {
  return { error: { code, message } };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    request.on('data', (chunk) => {
      if (settled) {
        return;
      }
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error('Body quá lớn'), { code: 'body_too_large' }));
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (settled) {
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error('JSON không hợp lệ'), { code: 'bad_json' }));
      }
    });

    request.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

if (require.main === module) {
  const port = readPositiveInteger(process.env.MOCK_PORT, DEFAULT_PORT);
  const lifecycleMs = {
    queued: readPositiveInteger(process.env.MOCK_QUEUED_MS, DEFAULT_LIFECYCLE_MS.queued),
    downloading: readPositiveInteger(
      process.env.MOCK_DOWNLOADING_MS,
      DEFAULT_LIFECYCLE_MS.downloading,
    ),
    storing: readPositiveInteger(process.env.MOCK_STORING_MS, DEFAULT_LIFECYCLE_MS.storing),
  };
  const mockApi = createMockApiServer({ lifecycleMs });

  mockApi
    .listen(port)
    .then((actualPort) => {
      console.log(`Mock API đang chạy tại http://127.0.0.1:${actualPort}`);
      console.log('Nhấn Ctrl+C để dừng.');
    })
    .catch((error) => {
      console.error('Không thể khởi động mock API:', error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  createMockApiServer,
  validateLoadBody,
  normalizeMockUrl,
  detectMockFormat,
  isBlockedMockHost,
};
