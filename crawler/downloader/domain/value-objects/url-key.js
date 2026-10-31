'use strict';

const { createHash } = require('node:crypto');
const { InvalidUrlError } = require('../errors/invalid-url-error');

const TRACKING_PARAMETER_PATTERNS = Object.freeze([
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
]);

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

function isTrackingParameter(name) {
  return TRACKING_PARAMETER_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Chuẩn hóa URL để hai lần gọi cùng một tài nguyên cho cùng một url_key.
 * Giữ nguyên thứ tự query và dấu "/" cuối path; bỏ fragment, port mặc định,
 * thông tin đăng nhập và các tham số tracking.
 */
function normalizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new InvalidUrlError('URL không được để trống');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch (cause) {
    throw new InvalidUrlError('URL không đúng định dạng', { cause });
  }

  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new InvalidUrlError('Chỉ hỗ trợ URL http hoặc https');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new InvalidUrlError('URL không được chứa thông tin đăng nhập');
  }

  parsedUrl.hash = '';

  if (
    (parsedUrl.protocol === 'http:' && parsedUrl.port === '80') ||
    (parsedUrl.protocol === 'https:' && parsedUrl.port === '443')
  ) {
    parsedUrl.port = '';
  }

  const queryParameters = new URLSearchParams();
  for (const [name, value] of parsedUrl.searchParams) {
    if (!isTrackingParameter(name)) {
      queryParameters.append(name, value);
    }
  }
  const normalizedQuery = queryParameters.toString();
  parsedUrl.search = normalizedQuery ? `?${normalizedQuery}` : '';

  return parsedUrl.toString();
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

class UrlKey {
  constructor(rawUrl) {
    this.normalizedUrl = normalizeUrl(rawUrl);
    this.value = sha256Hex(this.normalizedUrl);
    Object.freeze(this);
  }

  static fromUrl(rawUrl) {
    return new UrlKey(rawUrl);
  }

  toString() {
    return this.value;
  }
}

module.exports = {
  UrlKey,
  normalizeUrl,
  sha256Hex,
  TRACKING_PARAMETER_PATTERNS,
};
