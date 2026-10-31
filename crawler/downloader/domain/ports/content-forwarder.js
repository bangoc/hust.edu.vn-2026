'use strict';

/**
 * @typedef {Object} ForwardableContent
 * @property {string} url URL do caller gửi trong POST /load.
 * @property {'html'|'other'} format
 * @property {string} contentType
 * @property {Buffer} bytes Nội dung đã tải.
 */

/**
 * Port chuyển nội dung đã tải sang module đọc nội dung.
 *
 * @interface ContentForwarder
 */

/**
 * Gửi nội dung; ném `ForwardError` khi module đọc không nhận.
 *
 * @function forward
 * @param {ForwardableContent} content
 * @returns {Promise<{httpStatus: number}>}
 */

module.exports = {};
