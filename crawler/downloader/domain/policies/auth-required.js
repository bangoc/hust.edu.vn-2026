'use strict';

const DEFAULT_LOGIN_PATH_SEGMENTS = Object.freeze([
  'login',
  'signin',
  'sign-in',
  'dang-nhap',
  'dangnhap',
  'sso',
  'oauth',
]);

const LOGIN_PAGE_EXTENSION_PATTERN = /\.(?:html?|php|aspx?|jsp)$/i;
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Nhận diện nguồn yêu cầu đăng nhập mà không cố vượt qua kiểm soát truy cập.
 * Chỉ dựa trên tín hiệu công khai của response: HTTP 401 hoặc redirect tới
 * một path login đã biết.
 *
 * @param {{
 *   finalUrl?: string|null,
 *   httpStatus?: number|null,
 *   loginPathSegments?: string[],
 * }} input
 * @returns {{required: boolean, reason: 'unauthorized'|'login_redirect'|null}}
 */
function detectAuthRequired({
  finalUrl = null,
  httpStatus = null,
  loginPathSegments = DEFAULT_LOGIN_PATH_SEGMENTS,
} = {}) {
  if (httpStatus === 401) {
    return { required: true, reason: 'unauthorized' };
  }

  if (isApplicableLoginStatus(httpStatus) && isLoginUrl(finalUrl, loginPathSegments)) {
    return { required: true, reason: 'login_redirect' };
  }

  return { required: false, reason: null };
}

function isApplicableLoginStatus(httpStatus) {
  if (httpStatus === null || httpStatus === undefined) {
    return true;
  }
  return (httpStatus >= 200 && httpStatus < 400) || httpStatus === 403;
}

function isLoginUrl(url, loginPathSegments) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    return false;
  }

  const configuredSegments = new Set(
    (loginPathSegments ?? DEFAULT_LOGIN_PATH_SEGMENTS)
      .map((segment) => normalizeSegment(segment))
      .filter(Boolean),
  );
  if (configuredSegments.size === 0) {
    return false;
  }

  return parsedUrl.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => normalizeSegment(segment))
    .some((segment) => configuredSegments.has(segment));
}

function normalizeSegment(segment) {
  let decoded = String(segment ?? '').trim().toLowerCase();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Giữ nguyên segment nếu percent-encoding không hợp lệ.
  }
  return decoded.replace(LOGIN_PAGE_EXTENSION_PATTERN, '');
}

module.exports = {
  DEFAULT_LOGIN_PATH_SEGMENTS,
  detectAuthRequired,
  isLoginUrl,
  normalizeSegment,
};
