'use strict';

const { DomainError } = require('../../../domain/errors/domain-error');
const { DownloadError } = require('../../../domain/errors/download-error');
const { RenderError } = require('../../../domain/errors/render-error');
const { TimeoutError } = require('../../../domain/errors/timeout-error');
const { TooLargeError } = require('../../../domain/errors/too-large-error');
const { ContentHash } = require('../../../domain/value-objects/content-hash');
const { RETRYABLE_HTTP_STATUSES } = require('../../../domain/policies/retry-policy');

const DEFAULT_USER_AGENT = 'HUST-Content-Downloader/1.0';

class PuppeteerHtmlDownloader {
  constructor({
    browserPool,
    urlPolicy,
    hostGate = null,
    userAgent = DEFAULT_USER_AGENT,
    blockedResourceTypes = [],
    logger = null,
  }) {
    if (!browserPool) {
      throw new RenderError('PuppeteerHtmlDownloader cần browserPool');
    }
    if (!urlPolicy) {
      throw new RenderError('PuppeteerHtmlDownloader cần urlPolicy');
    }

    this.browserPool = browserPool;
    this.urlPolicy = urlPolicy;
    this.hostGate = hostGate;
    this.userAgent = userAgent;
    this.blockedResourceTypes = new Set(
      blockedResourceTypes.map((resourceType) => String(resourceType).toLowerCase()),
    );
    this.logger = logger;
  }

  async download(url, { headers = {}, maxBytes, timeoutMs }) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      throw new DomainError('invalid_max_bytes', 'maxBytes phải là số dương');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new DomainError('invalid_timeout', 'timeoutMs phải là số dương');
    }

    await this.urlPolicy.assertAllowed(url);
    if (this.hostGate) {
      await this.hostGate.waitForUrl(url);
    }

    let page = null;
    try {
      page = await this.browserPool.acquirePage();
      await page.setUserAgent(this.userAgent);
      if (Object.keys(headers).length > 0) {
        await page.setExtraHTTPHeaders(headers);
      }
      page.setDefaultNavigationTimeout(timeoutMs);
      page.setDefaultTimeout(timeoutMs);

      if (this.blockedResourceTypes.size > 0) {
        // Chỉ cần DOM/HTML cho bước đọc nội dung; ảnh, media và font thường
        // chiếm phần lớn băng thông và không ảnh hưởng nội dung văn bản.
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (shouldBlockResourceType(request.resourceType(), this.blockedResourceTypes)) {
            void request.abort().catch(() => undefined);
            return;
          }
          void request.continue().catch(() => undefined);
        });
      }

      const response = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: timeoutMs,
      });

      const finalUrl = page.url();
      if (!finalUrl || finalUrl === 'about:blank') {
        throw new RenderError('Chromium không tải được trang hoặc trang bị chặn');
      }
      await this.urlPolicy.assertAllowed(finalUrl);

      if (response && response.status() === 304) {
        throw new DownloadError('Chromium nhận HTTP 304 ngoài luồng revalidation', {
          upstreamStatus: 304,
        });
      }

      if (response && response.status() >= 400) {
        const status = response.status();
        const responseHeaders = response.headers();
        throw new DownloadError(`Nguồn trả HTTP ${status}`, {
          upstreamStatus: status,
          retryable: RETRYABLE_HTTP_STATUSES.has(status),
          details: {
            retryAfter: responseHeaders['retry-after'] ?? null,
            finalUrl,
          },
        });
      }

      const html = await page.content();
      const bytes = Buffer.from(html, 'utf8');
      if (bytes.length > maxBytes) {
        throw new TooLargeError(
          `HTML sau render có ${bytes.length} byte, vượt giới hạn ${maxBytes} byte`,
        );
      }

      const responseHeaders = response?.headers() ?? {};
      return {
        bytes,
        notModified: false,
        sha256: ContentHash.fromBuffer(bytes).value,
        contentType: responseHeaders['content-type'] ?? 'text/html; charset=utf-8',
        finalUrl,
        httpStatus: response?.status() ?? 200,
        etag: responseHeaders.etag ?? null,
        lastModified: responseHeaders['last-modified'] ?? null,
        size: bytes.length,
      };
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      if (error?.name === 'TimeoutError' || /timeout/i.test(error?.message ?? '')) {
        throw new TimeoutError('Render HTML quá thời gian cho phép', { cause: error });
      }
      throw new RenderError('Không thể render trang HTML bằng Chromium', { cause: error });
    } finally {
      if (page) {
        await this.browserPool.releasePage(page);
      }
    }
  }
}

function shouldBlockResourceType(resourceType, blockedResourceTypes) {
  return blockedResourceTypes.has(String(resourceType ?? '').toLowerCase());
}

module.exports = {
  PuppeteerHtmlDownloader,
  DEFAULT_USER_AGENT,
  shouldBlockResourceType,
};
