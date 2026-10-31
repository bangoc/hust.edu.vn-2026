'use strict';

const robotsParser = require('robots-parser');
const { RobotsDisallowedError } = require('../../../domain/errors/robots-disallowed-error');

const DEFAULT_USER_AGENT = 'HUST-Content-Downloader/1.0';
const MAX_ROBOTS_BYTES = 512 * 1024;

class RobotsPolicy {
  #cache = new Map();

  constructor({
    fetchImpl = globalThis.fetch,
    urlPolicy = null,
    userAgent = DEFAULT_USER_AGENT,
    cacheTtlMs = 3_600_000,
    maxHosts = 500,
    timeoutMs = 5_000,
    clock = { now: () => new Date() },
    logger = null,
  }) {
    this.fetchImpl = fetchImpl;
    this.urlPolicy = urlPolicy;
    this.userAgent = userAgent;
    this.cacheTtlMs = cacheTtlMs;
    this.maxHosts = maxHosts;
    this.timeoutMs = timeoutMs;
    this.clock = clock;
    this.logger = logger;
  }

  async assertAllowed(url) {
    const parsedUrl = new URL(url);
    if (parsedUrl.pathname === '/robots.txt') {
      return;
    }

    const policy = await this.#getPolicy(parsedUrl.origin);
    if (!policy) {
      return;
    }

    let allowed;
    try {
      allowed = policy.isAllowed(url, this.userAgent);
    } catch (error) {
      this.logger?.warn('robots_check_failed', { errorCode: error?.code ?? 'unknown' });
      return;
    }

    if (allowed === false) {
      throw new RobotsDisallowedError(`robots.txt của ${parsedUrl.hostname} không cho phép URL này`);
    }
  }

  async #getPolicy(origin) {
    const cached = this.#cache.get(origin);
    const nowMs = this.clock.now().getTime();
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.policy;
    }

    const robotsUrl = `${origin}/robots.txt`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let policy = null;

    try {
      if (this.urlPolicy) {
        await this.urlPolicy.assertAllowed(robotsUrl);
      }

      const response = await this.fetchImpl(robotsUrl, {
        method: 'GET',
        headers: {
          'user-agent': this.userAgent,
          accept: 'text/plain,*/*',
        },
        redirect: 'manual',
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        policy = null;
      } else if (response.status >= 400) {
        await response.body?.cancel().catch(() => undefined);
        policy = null;
      } else {
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_ROBOTS_BYTES) {
          await response.body?.cancel().catch(() => undefined);
          policy = null;
        } else {
          const text = await response.text();
          policy = robotsParser(robotsUrl, text.slice(0, MAX_ROBOTS_BYTES));
        }
      }
    } catch (error) {
      this.logger?.warn('robots_fetch_failed', {
        origin,
        errorCode: error?.code ?? 'unknown',
      });
      policy = null;
    } finally {
      clearTimeout(timeout);
    }

    this.#cache.set(origin, {
      policy,
      expiresAtMs: nowMs + this.cacheTtlMs,
    });
    this.#prune();
    return policy;
  }

  #prune() {
    if (this.#cache.size <= this.maxHosts) {
      return;
    }
    const oldestOrigin = this.#cache.keys().next().value;
    this.#cache.delete(oldestOrigin);
  }
}

module.exports = { RobotsPolicy, DEFAULT_USER_AGENT, MAX_ROBOTS_BYTES };
