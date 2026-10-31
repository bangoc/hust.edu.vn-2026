'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PuppeteerHtmlDownloader,
  shouldBlockResourceType,
} = require('../../adapters/outbound/downloaders/puppeteer-html-downloader');
const { RenderError } = require('../../domain/errors/render-error');
const { DownloadError } = require('../../domain/errors/download-error');
const { TimeoutError } = require('../../domain/errors/timeout-error');
const { TooLargeError } = require('../../domain/errors/too-large-error');
const { BlockedHostError } = require('../../domain/errors/blocked-host-error');

const HTML = Buffer.from('<html><body>Nội dung HUST</body></html>');
const DEFAULT_URL = 'https://hust.edu.vn/tin-tuc';

function createResponse({ status = 200, headers = {} } = {}) {
  return {
    status: () => status,
    headers: () => headers,
  };
}

function createPage({
  html = HTML.toString('utf8'),
  status = 200,
  headers = { 'content-type': 'text/html; charset=utf-8', etag: '"v1"' },
  finalUrl = null,
  gotoError = null,
  contentError = null,
} = {}) {
  const handlers = new Map();
  const page = {
    currentUrl: null,
    userAgent: null,
    extraHeaders: null,
    navigationTimeout: null,
    defaultTimeout: null,
    interceptionEnabled: false,
    closed: false,
    async setUserAgent(userAgent) {
      page.userAgent = userAgent;
    },
    async setExtraHTTPHeaders(headersValue) {
      page.extraHeaders = headersValue;
    },
    setDefaultNavigationTimeout(timeoutMs) {
      page.navigationTimeout = timeoutMs;
    },
    setDefaultTimeout(timeoutMs) {
      page.defaultTimeout = timeoutMs;
    },
    async setRequestInterception(enabled) {
      page.interceptionEnabled = enabled;
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      handlers.get(event)?.(payload);
    },
    async goto(url, options) {
      page.currentUrl = finalUrl ?? url;
      page.gotoOptions = options;
      if (gotoError) {
        throw gotoError;
      }
      return createResponse({ status, headers });
    },
    async content() {
      if (contentError) {
        throw contentError;
      }
      return html;
    },
    url() {
      return page.currentUrl;
    },
    async close() {
      page.closed = true;
    },
  };
  return page;
}

function createBrowserPool(page) {
  return {
    page,
    acquired: 0,
    released: 0,
    async acquirePage() {
      this.acquired += 1;
      return page;
    },
    async releasePage(releasedPage) {
      this.released += 1;
      await releasedPage.close();
    },
  };
}

function createUrlPolicy({ blockedUrls = new Set() } = {}) {
  return {
    calls: [],
    async assertAllowed(url) {
      this.calls.push(url);
      if (blockedUrls.has(url)) {
        throw new BlockedHostError(`URL bị chặn: ${url}`);
      }
    },
  };
}

function createHostGate() {
  return {
    calls: [],
    async waitForUrl(url) {
      this.calls.push(url);
    },
  };
}

function createDownloader(overrides = {}) {
  const page = overrides.page ?? createPage();
  const browserPool = overrides.browserPool ?? createBrowserPool(page);
  const urlPolicy = overrides.urlPolicy ?? createUrlPolicy();
  const hostGate = overrides.hostGate ?? createHostGate();
  const downloader = new PuppeteerHtmlDownloader({
    browserPool,
    urlPolicy,
    hostGate,
    userAgent: overrides.userAgent ?? 'HUST-Content-Downloader/1.0',
    blockedResourceTypes: overrides.blockedResourceTypes ?? [],
    logger: overrides.logger ?? null,
  });
  return { downloader, page, browserPool, urlPolicy, hostGate };
}

test('chặn đúng loại tài nguyên được cấu hình và không chặn document/script', () => {
  const blocked = new Set(['image', 'media', 'font']);

  assert.equal(shouldBlockResourceType('image', blocked), true);
  assert.equal(shouldBlockResourceType('MEDIA', blocked), true);
  assert.equal(shouldBlockResourceType('font', blocked), true);
  assert.equal(shouldBlockResourceType('document', blocked), false);
  assert.equal(shouldBlockResourceType('script', blocked), false);
  assert.equal(shouldBlockResourceType('xhr', blocked), false);
  assert.equal(shouldBlockResourceType(null, blocked), false);
});

test('constructor từ chối thiếu browserPool hoặc urlPolicy', () => {
  assert.throws(() => new PuppeteerHtmlDownloader({ urlPolicy: {} }), RenderError);
  assert.throws(() => new PuppeteerHtmlDownloader({ browserPool: {} }), RenderError);
});

test('tải HTML, trả metadata và đóng page sau khi xong', async () => {
  const { downloader, page, browserPool, urlPolicy, hostGate } = createDownloader({
    blockedResourceTypes: ['image', 'media', 'font'],
  });

  const result = await downloader.download(DEFAULT_URL, {
    headers: { 'accept-language': 'vi-VN' },
    maxBytes: 1_000_000,
    timeoutMs: 30_000,
  });

  assert.equal(result.notModified, false);
  assert.equal(result.contentType, 'text/html; charset=utf-8');
  assert.equal(result.finalUrl, DEFAULT_URL);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.etag, '"v1"');
  assert.equal(result.size, HTML.length);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(page.userAgent, 'HUST-Content-Downloader/1.0');
  assert.deepEqual(page.extraHeaders, { 'accept-language': 'vi-VN' });
  assert.equal(page.gotoOptions.waitUntil, 'networkidle2');
  assert.equal(page.interceptionEnabled, true);
  assert.equal(browserPool.released, 1);
  assert.equal(page.closed, true);
  assert.deepEqual(urlPolicy.calls, [DEFAULT_URL, DEFAULT_URL]);
  assert.deepEqual(hostGate.calls, [DEFAULT_URL]);
});

test('request interception abort ảnh/media/font nhưng continue document', async () => {
  const { downloader, page } = createDownloader({ blockedResourceTypes: ['image', 'media', 'font'] });
  await downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 });

  const aborted = [];
  const continued = [];
  page.emit('request', {
    resourceType: () => 'image',
    abort: async () => aborted.push('image'),
  });
  page.emit('request', {
    resourceType: () => 'document',
    continue: async () => continued.push('document'),
  });

  assert.deepEqual(aborted, ['image']);
  assert.deepEqual(continued, ['document']);
});

test('không bật request interception khi cấu hình rỗng', async () => {
  const { downloader, page } = createDownloader({ blockedResourceTypes: [] });
  await downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 });
  assert.equal(page.interceptionEnabled, false);
});

test('URL cuối sau redirect trỏ vào host bị chặn thì ném BlockedHostError', async () => {
  const finalUrl = 'http://169.254.169.254/latest/meta-data';
  const page = createPage({ finalUrl });
  const urlPolicy = createUrlPolicy({ blockedUrls: new Set([finalUrl]) });
  const { downloader, browserPool } = createDownloader({ page, urlPolicy });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    (error) => error instanceof BlockedHostError,
  );
  assert.equal(browserPool.released, 1);
});

test('HTTP 304 ngoài luồng revalidation bị từ chối', async () => {
  const page = createPage({ status: 304 });
  const { downloader } = createDownloader({ page });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    (error) => error instanceof DownloadError && error.upstreamStatus === 304,
  );
});

test('HTTP 503 giữ upstreamStatus và đánh dấu retryable', async () => {
  const page = createPage({ status: 503 });
  const { downloader } = createDownloader({ page });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    (error) =>
      error instanceof DownloadError &&
      error.upstreamStatus === 503 &&
      error.retryable === true,
  );
});

test('HTTP 404 không retry', async () => {
  const page = createPage({ status: 404 });
  const { downloader } = createDownloader({ page });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    (error) =>
      error instanceof DownloadError &&
      error.upstreamStatus === 404 &&
      error.retryable === false,
  );
});

test('HTML sau render vượt maxBytes ném TooLargeError', async () => {
  const { downloader } = createDownloader({ page: createPage({ html: '<html>quá lớn</html>' }) });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 8, timeoutMs: 30_000 }),
    TooLargeError,
  );
});

test('lỗi timeout của Puppeteer được map thành TimeoutError', async () => {
  const timeoutError = Object.assign(new Error('Navigation timeout of 30000 ms exceeded'), {
    name: 'TimeoutError',
  });
  const page = createPage({ gotoError: timeoutError });
  const { downloader } = createDownloader({ page });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    TimeoutError,
  );
});

test('lỗi mạng khác được map thành RenderError và vẫn release page', async () => {
  const page = createPage({ gotoError: new Error('net::ERR_CONNECTION_RESET') });
  const { downloader, browserPool } = createDownloader({ page });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    RenderError,
  );
  assert.equal(browserPool.released, 1);
});

test('trang about:blank bị coi là không tải được', async () => {
  const page = createPage({ finalUrl: 'about:blank' });
  const { downloader } = createDownloader({ page });

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 30_000 }),
    RenderError,
  );
});

test('maxBytes hoặc timeoutMs không hợp lệ bị từ chối trước khi mở browser', async () => {
  const { downloader, browserPool } = createDownloader();

  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 0, timeoutMs: 30_000 }),
    (error) => error.code === 'invalid_max_bytes',
  );
  await assert.rejects(
    downloader.download(DEFAULT_URL, { maxBytes: 1_000_000, timeoutMs: 0 }),
    (error) => error.code === 'invalid_timeout',
  );
  assert.equal(browserPool.acquired, 0);
});
