'use strict';

const { DomainError } = require('../../../domain/errors/domain-error');
const { isRedirectStatus, resolveRedirectUrl } = require('./redirect');

const DEFAULT_USER_AGENT = 'HUST-Content-Downloader/1.0';

class HttpSourceProbe {
  constructor({
    urlPolicy,
    hostGate = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    maxRedirects = 5,
    userAgent = DEFAULT_USER_AGENT,
  }) {
    if (!urlPolicy) {
      throw new DomainError('missing_url_policy', 'HttpSourceProbe cần urlPolicy');
    }
    if (typeof fetchImpl !== 'function') {
      throw new DomainError('missing_fetch', 'Môi trường không có fetch');
    }

    this.urlPolicy = urlPolicy;
    this.hostGate = hostGate;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRedirects = maxRedirects;
    this.userAgent = userAgent;
  }

  async head(url, headers = {}, { timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let currentUrl = url;

    try {
      for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount += 1) {
        await this.urlPolicy.assertAllowed(currentUrl);
        if (this.hostGate) {
          await this.hostGate.waitForUrl(currentUrl);
        }

        let response;
        try {
          response = await this.fetchImpl(currentUrl, {
            method: 'HEAD',
            headers: {
              'user-agent': this.userAgent,
              accept: '*/*',
              ...headers,
            },
            redirect: 'manual',
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof DomainError) {
            throw error;
          }
          return {
            status: null,
            contentType: null,
            contentLength: null,
            etag: null,
            lastModified: null,
            isAttachment: false,
            finalUrl: currentUrl,
            errorCode: controller.signal.aborted
              ? 'timeout'
              : error?.cause?.code ?? error?.code ?? 'probe_failed',
          };
        }

        if (isRedirectStatus(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => undefined);
          if (!location) {
            return probeFailure(currentUrl, 'redirect_without_location');
          }
          if (redirectCount === this.maxRedirects) {
            return probeFailure(currentUrl, 'too_many_redirects');
          }
          currentUrl = resolveRedirectUrl(location, currentUrl);
          continue;
        }

        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: parseContentLength(response.headers.get('content-length')),
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          isAttachment: isAttachmentDisposition(response.headers.get('content-disposition')),
          finalUrl: currentUrl,
          errorCode: null,
        };
      }

      return probeFailure(currentUrl, 'too_many_redirects');
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseContentLength(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isAttachmentDisposition(contentDisposition) {
  return /^\s*attachment\b/i.test(contentDisposition ?? '');
}

function probeFailure(finalUrl, errorCode) {
  return {
    status: null,
    contentType: null,
    contentLength: null,
    etag: null,
    lastModified: null,
    isAttachment: false,
    finalUrl,
    errorCode,
  };
}

module.exports = { HttpSourceProbe, DEFAULT_USER_AGENT, isAttachmentDisposition };
