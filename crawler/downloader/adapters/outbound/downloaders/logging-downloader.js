'use strict';

class LoggingDownloader {
  constructor({ downloader, logger, clock = { now: () => new Date() } }) {
    this.downloader = downloader;
    this.logger = logger;
    this.clock = clock;
  }

  async download(url, options) {
    const startedAtMs = this.clock.now().getTime();
    try {
      const result = await this.downloader.download(url, options);
      this.logger?.info('content_download_finished', {
        strategy: options?.strategy,
        host: safeHost(url),
        httpStatus: result.httpStatus,
        size: result.size,
        notModified: result.notModified,
        durationMs: Math.max(0, this.clock.now().getTime() - startedAtMs),
      });
      return result;
    } catch (error) {
      this.logger?.warn('content_download_failed', {
        strategy: options?.strategy,
        host: safeHost(url),
        errorCode: error?.code ?? 'unknown',
        durationMs: Math.max(0, this.clock.now().getTime() - startedAtMs),
      });
      throw error;
    }
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

module.exports = { LoggingDownloader };
