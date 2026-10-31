'use strict';

/**
 * @typedef {Object} NormalizedUrl
 * @property {string} normalizedUrl
 * @property {string} urlKey
 */

/**
 * Port chính sách URL: chuẩn hóa và kiểm tra SSRF/allowlist.
 *
 * @interface UrlPolicy
 */

/**
 * @function normalize
 * @param {string} rawUrl
 * @returns {NormalizedUrl}
 */

/**
 * Kiểm tra scheme, host, IP private/reserved và allowlist.
 * Phải được gọi lại sau mỗi redirect.
 *
 * @function assertAllowed
 * @param {string} url
 * @returns {Promise<void>}
 */

module.exports = {};
