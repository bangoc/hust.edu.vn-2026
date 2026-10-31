'use strict';

const { retryAsync } = require('../../../domain/policies/retry-policy');

class RetryingDownloader {
  constructor({
    downloader,
    retryCount = 3,
    baseMs = 500,
    maxMs = 8_000,
    jitterMs = 250,
    logger = null,
    sleepImpl = undefined,
    random = Math.random,
  }) {
    this.downloader = downloader;
    this.retryCount = retryCount;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.jitterMs = jitterMs;
    this.logger = logger;
    this.sleepImpl = sleepImpl;
    this.random = random;
  }

  download(url, options) {
    return retryAsync(() => this.downloader.download(url, options), {
      retryCount: this.retryCount,
      baseMs: this.baseMs,
      maxMs: this.maxMs,
      jitterMs: this.jitterMs,
      random: this.random,
      sleepImpl: this.sleepImpl,
      onRetry: ({ attempt, delayMs, error }) => {
        this.logger?.warn('content_download_retry', {
          attempt: attempt + 1,
          delayMs,
          errorCode: error?.code ?? 'unknown',
        });
      },
    });
  }
}

module.exports = { RetryingDownloader };
