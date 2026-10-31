'use strict';

const { DomainError } = require('../../../domain/errors/domain-error');
const { ForwardError } = require('../../../domain/errors/forward-error');
const { RETRYABLE_HTTP_STATUSES, retryAsync } = require('../../../domain/policies/retry-policy');

/**
 * Dựng body đúng hợp đồng POST /parse của module đọc nội dung:
 * - HTML: {url, format: "html", encoding: "text", content}
 * - File: {url, format: "other", content_type, encoding: "base64", content}
 */
function buildReaderPayload({ url, format, contentType, bytes }) {
  if (format === 'html') {
    return {
      url,
      format: 'html',
      encoding: 'text',
      content: decodeText(bytes, contentType),
    };
  }

  return {
    url,
    format: 'other',
    content_type: contentType,
    encoding: 'base64',
    content: Buffer.from(bytes).toString('base64'),
  };
}

function decodeText(bytes, contentType) {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? '')?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Charset lạ: dùng UTF-8 bên dưới.
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

class HttpContentForwarder {
  constructor({
    readerUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    retryCount = 3,
    baseMs = 500,
    maxMs = 8_000,
    jitterMs = 250,
    random = Math.random,
    sleepImpl = undefined,
    logger = null,
  }) {
    if (!readerUrl) {
      throw new DomainError('missing_reader_url', 'HttpContentForwarder cần readerUrl');
    }
    if (typeof fetchImpl !== 'function') {
      throw new DomainError('missing_fetch', 'Môi trường không có fetch');
    }

    this.readerUrl = readerUrl;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retryCount = retryCount;
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.jitterMs = jitterMs;
    this.random = random;
    this.sleepImpl = sleepImpl;
    this.logger = logger;
  }

  async forward(content) {
    const body = JSON.stringify(buildReaderPayload(content));

    return retryAsync(() => this.postOnce(body), {
      retryCount: this.retryCount,
      baseMs: this.baseMs,
      maxMs: this.maxMs,
      jitterMs: this.jitterMs,
      random: this.random,
      sleepImpl: this.sleepImpl,
      onRetry: ({ attempt, delayMs, error }) => {
        this.logger?.warn('content_forward_retry', {
          attempt: attempt + 1,
          delayMs,
          errorCode: error?.code ?? 'unknown',
          upstreamStatus: error?.upstreamStatus ?? null,
        });
      },
    });
  }

  async postOnce(body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(this.readerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body,
        signal: controller.signal,
      });
      // Đọc hết body để giải phóng kết nối; nội dung phản hồi không được dùng.
      await response.arrayBuffer().catch(() => undefined);
    } catch (error) {
      throw new ForwardError(
        controller.signal.aborted
          ? 'Module đọc không phản hồi trong thời gian cho phép'
          : 'Không kết nối được tới module đọc',
        { cause: error, retryable: true },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new ForwardError(`Module đọc trả HTTP ${response.status}`, {
        upstreamStatus: response.status,
        retryable: RETRYABLE_HTTP_STATUSES.has(response.status),
        details: { retryAfter: response.headers.get('retry-after') },
      });
    }

    return { httpStatus: response.status };
  }
}

module.exports = { HttpContentForwarder, buildReaderPayload };
