'use strict';

/**
 * @typedef {Object} UrlManifest
 * @property {string} url URL gốc do caller gửi.
 * @property {string} finalUrl URL cuối cùng sau redirect.
 * @property {string} urlKey SHA-256 của normalizedUrl.
 * @property {string} sha256 SHA-256 của nội dung.
 * @property {string} objectKey Khóa object trong storage.
 * @property {'html'|'other'} format
 * @property {string} contentType
 * @property {string} extension
 * @property {number} size
 * @property {string|null} etag
 * @property {string|null} lastModified
 * @property {string} fetchedAt ISO timestamp.
 * @property {string} jobId
 */

/**
 * Port manifest mới nhất theo URL.
 *
 * @interface ManifestRepository
 */

/**
 * @function get
 * @param {string} urlKey
 * @returns {Promise<UrlManifest|null>}
 */

/**
 * @function put
 * @param {string} urlKey
 * @param {UrlManifest} manifest
 * @returns {Promise<void>}
 */

module.exports = {};
