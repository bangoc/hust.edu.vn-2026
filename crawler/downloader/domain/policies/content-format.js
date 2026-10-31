'use strict';

const HTML_MEDIA_TYPES = Object.freeze(new Set(['text/html', 'application/xhtml+xml']));

const DOCUMENT_EXTENSIONS = Object.freeze(
  new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z']),
);

const MIME_EXTENSION_MAP = Object.freeze({
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/csv': 'csv',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
});

function getMediaType(contentType) {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function isHtmlMediaType(contentType) {
  return HTML_MEDIA_TYPES.has(getMediaType(contentType));
}

function getUrlExtension(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const lastSegment = pathname.split('/').filter(Boolean).pop();
  if (!lastSegment || !lastSegment.includes('.')) {
    return null;
  }

  const extension = lastSegment.split('.').pop().toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(extension)) {
    return null;
  }
  return extension;
}

function detectMagicExtension(bytes) {
  if (!bytes || bytes.length < 4) {
    return null;
  }

  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'zip';
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return 'doc';
  }
  return null;
}

/**
 * Content-Type trước, sau đó extension URL, cuối cùng là magic bytes.
 * Lý do: cùng một URL .pdf có thể trả text/html, còn DOCX thường bị trả
 * application/octet-stream.
 *
 * @param {{url: string, contentType: string|null, bytes: Buffer|null}} input
 * @returns {{format: 'html'|'other', extension: string}}
 */
function detectContentFormat({ url, contentType, bytes = null }) {
  const mediaType = getMediaType(contentType);
  const urlExtension = getUrlExtension(url);

  if (isHtmlMediaType(mediaType)) {
    return { format: 'html', extension: 'html' };
  }

  if (mediaType && mediaType !== 'application/octet-stream' && mediaType !== 'binary/octet-stream') {
    return {
      format: 'other',
      extension: MIME_EXTENSION_MAP[mediaType] ?? urlExtension ?? 'bin',
    };
  }

  if (urlExtension && DOCUMENT_EXTENSIONS.has(urlExtension)) {
    return { format: 'other', extension: urlExtension };
  }

  const magicExtension = detectMagicExtension(bytes);
  if (magicExtension) {
    return { format: 'other', extension: magicExtension };
  }

  if (urlExtension === 'html' || urlExtension === 'htm') {
    return { format: 'html', extension: 'html' };
  }

  if (mediaType === 'application/octet-stream' || mediaType === 'binary/octet-stream') {
    return { format: 'other', extension: urlExtension ?? 'bin' };
  }

  return { format: 'html', extension: 'html' };
}

module.exports = {
  HTML_MEDIA_TYPES,
  DOCUMENT_EXTENSIONS,
  MIME_EXTENSION_MAP,
  getMediaType,
  isHtmlMediaType,
  getUrlExtension,
  detectMagicExtension,
  detectContentFormat,
};
