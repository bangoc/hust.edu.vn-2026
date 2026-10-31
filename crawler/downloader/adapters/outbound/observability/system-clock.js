'use strict';

const systemClock = Object.freeze({
  now: () => new Date(),
});

module.exports = { systemClock };
