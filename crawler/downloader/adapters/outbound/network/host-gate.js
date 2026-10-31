'use strict';

class HostGate {
  #lastRequestAt;
  #perHostQueue;
  #clock;
  #sleepImpl;

  constructor({
    delayMs = 500,
    clock = { now: () => new Date() },
    sleepImpl = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    maxHosts = 1_000,
    hostTtlMs = 3_600_000,
  } = {}) {
    this.delayMs = delayMs;
    this.maxHosts = maxHosts;
    this.hostTtlMs = hostTtlMs;
    this.#clock = clock;
    this.#sleepImpl = sleepImpl;
    this.#lastRequestAt = new Map();
    this.#perHostQueue = new Map();
  }

  async waitForUrl(url) {
    const hostname = new URL(url).hostname.toLowerCase();
    return this.wait(hostname);
  }

  wait(hostname) {
    const normalizedHostname = String(hostname).toLowerCase();
    const previousRequest = this.#perHostQueue.get(normalizedHostname) ?? Promise.resolve();

    const nextRequest = previousRequest
      .catch(() => undefined)
      .then(async () => {
        this.prune();
        const lastRequestAt = this.#lastRequestAt.get(normalizedHostname) ?? 0;
        const elapsedMs = this.#clock.now().getTime() - lastRequestAt;
        const waitMs = Math.max(0, this.delayMs - elapsedMs);
        if (waitMs > 0) {
          await this.#sleepImpl(waitMs);
        }
        this.#lastRequestAt.set(normalizedHostname, this.#clock.now().getTime());
      })
      .finally(() => {
        if (this.#perHostQueue.get(normalizedHostname) === nextRequest) {
          this.#perHostQueue.delete(normalizedHostname);
        }
      });

    this.#perHostQueue.set(normalizedHostname, nextRequest);
    return nextRequest;
  }

  prune() {
    if (this.#lastRequestAt.size <= this.maxHosts) {
      return;
    }

    const nowMs = this.#clock.now().getTime();
    for (const [hostname, lastRequestAt] of this.#lastRequestAt) {
      if (nowMs - lastRequestAt > this.hostTtlMs) {
        this.#lastRequestAt.delete(hostname);
      }
    }

    while (this.#lastRequestAt.size > this.maxHosts) {
      const oldestHostname = this.#lastRequestAt.keys().next().value;
      this.#lastRequestAt.delete(oldestHostname);
    }
  }
}

module.exports = { HostGate };
