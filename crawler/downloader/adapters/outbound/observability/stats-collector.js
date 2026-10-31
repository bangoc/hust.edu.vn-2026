'use strict';

class StatsCollector {
  #startedAt;
  #now;
  #counters;
  #errorCounts;
  #forwardErrorCounts;

  constructor({ now = () => new Date() } = {}) {
    this.#now = now;
    this.#startedAt = now();
    this.#counters = {
      jobsCreated: 0,
      jobsDone: 0,
      jobsFailed: 0,
      deduplicatedRequests: 0,
      notModifiedDownloads: 0,
      redownloadedSameContent: 0,
      changedContent: 0,
      duplicateContent: 0,
      htmlDownloads: 0,
      documentDownloads: 0,
      downloadedBytes: 0,
      forwardedContents: 0,
      forwardFailures: 0,
    };
    this.#errorCounts = new Map();
    this.#forwardErrorCounts = new Map();
  }

  recordForwarded() {
    this.#counters.forwardedContents += 1;
  }

  recordForwardFailed(error) {
    this.#counters.forwardFailures += 1;
    const code = error?.code ?? 'unknown_error';
    this.#forwardErrorCounts.set(code, (this.#forwardErrorCounts.get(code) ?? 0) + 1);
  }

  recordJobCreated() {
    this.#counters.jobsCreated += 1;
  }

  recordDeduplicated() {
    this.#counters.deduplicatedRequests += 1;
  }

  recordJobDone(result) {
    this.#counters.jobsDone += 1;
    this.#counters.downloadedBytes += result.size ?? 0;
    this.#recordResultFlags(result);
    if (result.format === 'html') {
      this.#counters.htmlDownloads += 1;
    } else {
      this.#counters.documentDownloads += 1;
    }
  }

  recordNotModified(result) {
    this.#counters.jobsDone += 1;
    this.#counters.notModifiedDownloads += 1;
    this.#recordResultFlags(result);
    if (result.format === 'html') {
      this.#counters.htmlDownloads += 1;
    } else {
      this.#counters.documentDownloads += 1;
    }
  }

  recordJobFailed(error) {
    this.#counters.jobsFailed += 1;
    const code = error?.code ?? 'unknown_error';
    this.#errorCounts.set(code, (this.#errorCounts.get(code) ?? 0) + 1);
  }

  #recordResultFlags(result) {
    if (result.redownloaded) {
      this.#counters.redownloadedSameContent += 1;
    }
    if (result.contentChanged) {
      this.#counters.changedContent += 1;
    }
    if (result.duplicateContent) {
      this.#counters.duplicateContent += 1;
    }
  }

  snapshot() {
    const now = this.#now();
    return {
      ...this.#counters,
      errorCounts: Object.fromEntries(this.#errorCounts),
      forwardErrorCounts: Object.fromEntries(this.#forwardErrorCounts),
      startedAt: this.#startedAt.toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((now.getTime() - this.#startedAt.getTime()) / 1000)),
    };
  }
}

module.exports = { StatsCollector };
