'use strict';

/**
 * Port lưu trữ object content-addressed.
 *
 * @interface ContentStorage
 */

/**
 * @function exists
 * @param {string} objectKey
 * @returns {Promise<boolean>}
 */

/**
 * Ghi object; idempotent với cùng objectKey vì objectKey là SHA-256 của nội dung.
 *
 * @function put
 * @param {string} objectKey
 * @param {Buffer} bytes
 * @param {string} contentType
 * @returns {Promise<void>}
 */

/**
 * Đọc lại nội dung object; trả null nếu object không tồn tại.
 *
 * @function getObject
 * @param {string} objectKey
 * @returns {Promise<Buffer|null>}
 */

/**
 * Tạo presigned GET URL, không gọi mạng.
 *
 * @function presign
 * @param {string} objectKey
 * @param {number} ttlSeconds
 * @returns {Promise<string>}
 */

module.exports = {};
