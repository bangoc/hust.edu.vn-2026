'use strict';

const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

const SENSITIVE_FIELD_PATTERN =
  /^(body|bytes|content_ref|contentRef|presignedUrl|presigned_url|authorization|password|secret|accessKey|secretKey)$/i;

function redactFields(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  if (depth > 3) {
    return '[redacted-depth]';
  }
  if (Buffer.isBuffer(value)) {
    return `[buffer ${value.length} bytes]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactFields(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = SENSITIVE_FIELD_PATTERN.test(key)
        ? '[redacted]'
        : redactFields(nestedValue, depth + 1);
    }
    return result;
  }
  return value;
}

function createConsoleLogger({
  level = 'info',
  service = 'content-downloader',
  stream = process.stdout,
  now = () => new Date(),
} = {}) {
  const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.info;

  function write(levelName, event, fields = {}) {
    if ((LOG_LEVELS[levelName] ?? LOG_LEVELS.info) < threshold) {
      return;
    }

    const record = {
      time: now().toISOString(),
      level: levelName,
      service,
      event,
      ...redactFields(fields),
    };
    stream.write(`${JSON.stringify(record)}\n`);
  }

  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

module.exports = { createConsoleLogger, LOG_LEVELS, redactFields };
