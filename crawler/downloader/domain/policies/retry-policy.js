'use strict';

const RETRYABLE_HTTP_STATUSES = Object.freeze(new Set([429, 500, 502, 503, 504]));

const RETRYABLE_NETWORK_CODES = Object.freeze(
  new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
  ]),
);

function getErrorCode(error) {
  return error?.code ?? error?.cause?.code ?? null;
}

function getUpstreamStatus(error) {
  return (
    error?.upstreamStatus ??
    error?.details?.upstreamStatus ??
    error?.httpStatus ??
    null
  );
}

function isRetryableError(error) {
  if (!error) {
    return false;
  }

  if (error.retryable === true) {
    return true;
  }
  if (error.retryable === false && error.name !== 'TypeError' && error.name !== 'AbortError') {
    return false;
  }

  const upstreamStatus = getUpstreamStatus(error);
  if (upstreamStatus && RETRYABLE_HTTP_STATUSES.has(upstreamStatus)) {
    return true;
  }

  const errorCode = getErrorCode(error);
  if (errorCode && RETRYABLE_NETWORK_CODES.has(errorCode)) {
    return true;
  }

  return false;
}

function computeBackoffDelayMs(
  attempt,
  { baseMs = 500, maxMs = 8000, jitterMs = 250, random = Math.random } = {},
) {
  const exponentialDelayMs = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.floor(random() * (jitterMs + 1));
  return exponentialDelayMs + jitter;
}

function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 300) * 1000;
  }

  const retryAtMs = Date.parse(value);
  if (Number.isNaN(retryAtMs)) {
    return null;
  }
  return Math.max(0, Math.min(retryAtMs - nowMs, 300_000));
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function retryAsync(
  operation,
  {
    retryCount = 3,
    baseMs = 500,
    maxMs = 8000,
    jitterMs = 250,
    random = Math.random,
    sleepImpl = sleep,
    nowMs = Date.now,
    onRetry = null,
  } = {},
) {
  let attempt = 0;

  for (;;) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= retryCount || !isRetryableError(error)) {
        throw error;
      }

      const retryAfterMs = parseRetryAfterMs(
        error?.details?.retryAfter ?? error?.retryAfter ?? null,
        nowMs(),
      );
      const delayMs =
        retryAfterMs ?? computeBackoffDelayMs(attempt, { baseMs, maxMs, jitterMs, random });

      if (onRetry) {
        onRetry({ attempt, delayMs, error });
      }
      await sleepImpl(delayMs);
      attempt += 1;
    }
  }
}

module.exports = {
  RETRYABLE_HTTP_STATUSES,
  RETRYABLE_NETWORK_CODES,
  isRetryableError,
  computeBackoffDelayMs,
  parseRetryAfterMs,
  retryAsync,
};
