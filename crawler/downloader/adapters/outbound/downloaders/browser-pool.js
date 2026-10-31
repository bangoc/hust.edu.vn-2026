'use strict';

const puppeteer = require('puppeteer-core');
const { RenderError } = require('../../../domain/errors/render-error');

const DEFAULT_CHROME_ARGS = Object.freeze([
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--no-first-run',
  '--mute-audio',
]);

// Puppeteer đổi API theo phiên bản: `connected` là thuộc tính ở v23,
// còn các phiên bản cũ dùng `isConnected()`. Hỗ trợ cả hai để tránh
// lỗi "connected is not a function" khi nâng/hạ phiên bản.
function isBrowserConnected(browser) {
  if (!browser) {
    return false;
  }
  if (typeof browser.connected === 'boolean') {
    return browser.connected;
  }
  if (typeof browser.isConnected === 'function') {
    return browser.isConnected();
  }
  if (typeof browser.connected === 'function') {
    return browser.connected();
  }
  return false;
}

class BrowserPool {
  #browser = null;
  #launchPromise = null;
  #activePages = 0;
  #pagesServed = 0;
  #waiters = [];

  constructor({
    executablePath,
    maxPages = 2,
    maxPagesPerBrowser = 100,
    launchOptions = {},
    logger = null,
    launchBrowser = (options) => puppeteer.launch(options),
  }) {
    if (!executablePath) {
      throw new RenderError('Chưa cấu hình CHROME_BIN cho puppeteer-core');
    }

    this.executablePath = executablePath;
    this.maxPages = maxPages;
    this.maxPagesPerBrowser = maxPagesPerBrowser;
    this.launchOptions = launchOptions;
    this.logger = logger;
    this.launchBrowser = launchBrowser;
    this.closed = false;
  }

  async acquirePage() {
    if (this.closed) {
      throw new RenderError('BrowserPool đã đóng');
    }

    await this.#acquireSlot();

    try {
      const browser = await this.#getBrowser();
      const page = await browser.newPage();
      this.#pagesServed += 1;
      return page;
    } catch (error) {
      this.#releaseSlot();
      if (error instanceof RenderError) {
        throw error;
      }
      throw new RenderError('Không thể mở trang Chromium', { cause: error });
    }
  }

  async releasePage(page) {
    try {
      await page.close();
    } catch (error) {
      this.logger?.warn('chromium_page_close_failed', {
        errorCode: error?.code ?? 'unknown',
      });
    } finally {
      this.#releaseSlot();
    }

    if (this.#pagesServed >= this.maxPagesPerBrowser && this.#activePages === 0) {
      await this.#restartBrowser();
    }
  }

  async close() {
    this.closed = true;
    const browser = this.#browser;
    this.#browser = null;
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        this.logger?.warn('chromium_close_failed', { errorCode: error?.code ?? 'unknown' });
      }
    }
  }

  stats() {
    return {
      activePages: this.#activePages,
      pagesServed: this.#pagesServed,
      maxPages: this.maxPages,
      connected: isBrowserConnected(this.#browser),
    };
  }

  async #getBrowser() {
    if (isBrowserConnected(this.#browser)) {
      return this.#browser;
    }
    this.#browser = null;
    if (this.#launchPromise) {
      return this.#launchPromise;
    }

    this.#launchPromise = this.launchBrowser({
      headless: true,
      executablePath: this.executablePath,
      args: DEFAULT_CHROME_ARGS,
      protocolTimeout: 60_000,
      ...this.launchOptions,
    })
      .then((browser) => {
        this.#browser = browser;
        this.#pagesServed = 0;
        browser.on('disconnected', () => {
          if (this.#browser === browser) {
            this.#browser = null;
          }
        });
        this.logger?.info('chromium_started', { executablePath: this.executablePath });
        return browser;
      })
      .catch((error) => {
        throw new RenderError('Không thể khởi động Chromium', { cause: error });
      })
      .finally(() => {
        this.#launchPromise = null;
      });

    return this.#launchPromise;
  }

  async #restartBrowser() {
    const browser = this.#browser;
    this.#browser = null;
    this.#pagesServed = 0;
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        this.logger?.warn('chromium_restart_close_failed', {
          errorCode: error?.code ?? 'unknown',
        });
      }
    }
  }

  async #acquireSlot() {
    if (this.#activePages < this.maxPages) {
      this.#activePages += 1;
      return;
    }

    await new Promise((resolve) => {
      this.#waiters.push(resolve);
    });
  }

  #releaseSlot() {
    this.#activePages = Math.max(0, this.#activePages - 1);
    const nextWaiter = this.#waiters.shift();
    if (nextWaiter) {
      this.#activePages += 1;
      nextWaiter();
    }
  }
}

module.exports = { BrowserPool, DEFAULT_CHROME_ARGS, isBrowserConnected };
