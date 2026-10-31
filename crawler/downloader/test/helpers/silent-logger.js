'use strict';

const noop = () => undefined;

const silentLogger = Object.freeze({
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
});

module.exports = { silentLogger };
