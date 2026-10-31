'use strict';

class FakeClock {
  #currentTimeMs;

  constructor(start = '2026-01-01T00:00:00.000Z') {
    this.#currentTimeMs = new Date(start).getTime();
  }

  now() {
    return new Date(this.#currentTimeMs);
  }

  advance(milliseconds) {
    this.#currentTimeMs += milliseconds;
    return this.now();
  }

  set(isoTimestamp) {
    this.#currentTimeMs = new Date(isoTimestamp).getTime();
    return this.now();
  }
}

module.exports = { FakeClock };
