'use strict';

function createCaptureLogger() {
  const records = [];
  const write = (level) => (event, fields = {}) => {
    records.push({ level, event, fields });
  };

  return {
    records,
    logger: {
      debug: write('debug'),
      info: write('info'),
      warn: write('warn'),
      error: write('error'),
    },
    text() {
      return JSON.stringify(records);
    },
  };
}

module.exports = { createCaptureLogger };
