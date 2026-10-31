'use strict';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SUPPORTED_FORMATS = new Set(['html', 'other']);
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Manifest cũ hoặc hỏng không được làm job thất bại. Policy này chỉ kiểm tra
 * các field tối thiểu mà bước revalidate và kết quả job phụ thuộc vào.
 *
 * @param {unknown} manifest
 * @returns {boolean}
 */
function isValidManifest(manifest) {
  if (!isPlainObject(manifest)) {
    return false;
  }

  if (!isHttpUrl(manifest.finalUrl)) {
    return false;
  }
  if (typeof manifest.url !== 'string' || manifest.url.trim().length === 0) {
    return false;
  }
  if (typeof manifest.urlKey !== 'string' || !SHA256_PATTERN.test(manifest.urlKey)) {
    return false;
  }
  if (typeof manifest.sha256 !== 'string' || !SHA256_PATTERN.test(manifest.sha256)) {
    return false;
  }
  if (manifest.objectKey !== `raw/${manifest.sha256}`) {
    return false;
  }
  if (!SUPPORTED_FORMATS.has(manifest.format)) {
    return false;
  }
  if (typeof manifest.contentType !== 'string' || manifest.contentType.length === 0) {
    return false;
  }
  if (typeof manifest.extension !== 'string' || manifest.extension.length === 0) {
    return false;
  }
  if (!Number.isSafeInteger(manifest.size) || manifest.size < 0) {
    return false;
  }
  if (!isParseableTimestamp(manifest.fetchedAt)) {
    return false;
  }
  if (!isNullableString(manifest.etag)) {
    return false;
  }
  if (!isNullableString(manifest.lastModified)) {
    return false;
  }

  return true;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  try {
    return SUPPORTED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isParseableTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isNullableString(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.length > 0)
  );
}

module.exports = { isValidManifest, SHA256_PATTERN };
