'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserPool, isBrowserConnected } = require('../../adapters/outbound/downloaders/browser-pool');

function createFakePage() {
  return {
    closed: false,
    async close() {
      this.closed = true;
    },
  };
}

function createFakeBrowser({ connected = true } = {}) {
  const listeners = new Map();
  const browser = {
    connected,
    pagesCreated: 0,
    closed: false,
    async newPage() {
      browser.pagesCreated += 1;
      return createFakePage();
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
    emit(event) {
      listeners.get(event)?.();
    },
    async close() {
      browser.closed = true;
      browser.connected = false;
      browser.emit('disconnected');
    },
  };
  return browser;
}

test('nhận diện browser connected theo property và method của nhiều phiên bản Puppeteer', () => {
  assert.equal(isBrowserConnected(null), false);
  assert.equal(isBrowserConnected({ connected: true }), true);
  assert.equal(isBrowserConnected({ connected: false }), false);
  assert.equal(isBrowserConnected({ isConnected: () => true }), true);
  assert.equal(isBrowserConnected({ connected: () => true }), true);
  assert.equal(isBrowserConnected({}), false);
});

test('dùng lại browser cho nhiều page và không gọi connected như hàm', async () => {
  const fakeBrowser = createFakeBrowser();
  let launchCount = 0;
  const pool = new BrowserPool({
    executablePath: '/usr/bin/chromium',
    maxPages: 2,
    launchBrowser: async () => {
      launchCount += 1;
      return fakeBrowser;
    },
  });

  const firstPage = await pool.acquirePage();
  await pool.releasePage(firstPage);
  const secondPage = await pool.acquirePage();
  await pool.releasePage(secondPage);

  assert.equal(launchCount, 1);
  assert.equal(fakeBrowser.pagesCreated, 2);
  assert.equal(pool.stats().connected, true);
  await pool.close();
});

test('khởi động browser mới khi browser cũ đã mất kết nối', async () => {
  const firstBrowser = createFakeBrowser();
  const secondBrowser = createFakeBrowser();
  const browsers = [firstBrowser, secondBrowser];
  let launchCount = 0;
  const pool = new BrowserPool({
    executablePath: '/usr/bin/chromium',
    launchBrowser: async () => {
      const browser = browsers[launchCount];
      launchCount += 1;
      return browser;
    },
  });

  const page = await pool.acquirePage();
  await pool.releasePage(page);
  firstBrowser.connected = false;

  const nextPage = await pool.acquirePage();
  await pool.releasePage(nextPage);

  assert.equal(launchCount, 2);
  assert.equal(firstBrowser.pagesCreated, 1);
  assert.equal(secondBrowser.pagesCreated, 1);
  await pool.close();
});

test('giới hạn số page đồng thời và trả slot sau khi release', async () => {
  const fakeBrowser = createFakeBrowser();
  const pool = new BrowserPool({
    executablePath: '/usr/bin/chromium',
    maxPages: 1,
    launchBrowser: async () => fakeBrowser,
  });

  const firstPage = await pool.acquirePage();
  let isSecondAcquired = false;
  const secondPagePromise = pool.acquirePage().then((page) => {
    isSecondAcquired = true;
    return page;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(isSecondAcquired, false);

  await pool.releasePage(firstPage);
  const secondPage = await secondPagePromise;
  assert.equal(isSecondAcquired, true);
  await pool.releasePage(secondPage);
  await pool.close();
});
