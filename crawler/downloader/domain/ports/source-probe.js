'use strict';

/**
 * @typedef {Object} ProbeResult
 * @property {number|null} status Mã HTTP; null nếu không probe được.
 * @property {string|null} contentType
 * @property {number|null} contentLength
 * @property {string|null} etag
 * @property {string|null} lastModified
 * @property {boolean} isAttachment Nguồn trả `Content-Disposition: attachment` (trình duyệt sẽ tải file thay vì hiển thị).
 * @property {string} finalUrl
 * @property {string|null} errorCode
 */

/**
 * Port HEAD để chọn chiến lược tải và revalidate.
 *
 * @interface SourceProbe
 */

/**
 * @function head
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<ProbeResult>}
 */

module.exports = {};
