'use strict';

/**
 * @typedef {Object} DownloadedContent
 * @property {Buffer} bytes Nội dung đã tải; rỗng nếu notModified = true.
 * @property {boolean} notModified Server trả 304 hoặc không có nội dung mới.
 * @property {string|null} sha256 SHA-256 của bytes; null nếu notModified.
 * @property {string|null} contentType Content-Type thực tế từ server.
 * @property {string} finalUrl URL cuối cùng sau redirect.
 * @property {number} httpStatus Mã HTTP cuối cùng.
 * @property {string|null} etag ETag của response.
 * @property {string|null} lastModified Last-Modified của response.
 * @property {number} size Số byte đã đọc (không phải Content-Length khai báo).
 */

/**
 * @typedef {Object} DownloadOptions
 * @property {'html'|'file'} strategy Chiến lược do domain chọn.
 * @property {Record<string, string>} [headers] Header bổ sung, gồm conditional header.
 * @property {number} maxBytes Giới hạn cứng số byte.
 * @property {number} timeoutMs Giới hạn thời gian.
 */

/**
 * Port tải nội dung. Adapter Puppeteer và HTTP file cùng implements contract này.
 *
 * @interface ContentDownloader
 */
module.exports = {};
