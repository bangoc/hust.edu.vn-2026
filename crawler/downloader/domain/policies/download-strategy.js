'use strict';

const {
  DOCUMENT_EXTENSIONS,
  getMediaType,
  getUrlExtension,
  isHtmlMediaType,
} = require('./content-format');

const DOWNLOAD_STRATEGY = Object.freeze({
  HTML: 'html',
  FILE: 'file',
});

/**
 * Chọn Puppeteer cho HTML và HTTP stream cho tài liệu.
 * Content-Type của HEAD được ưu tiên hơn extension để tránh trường hợp
 * URL .pdf nhưng server trả text/html.
 * Nguồn trả `Content-Disposition: attachment` luôn tải bằng HTTP stream, kể cả
 * khi là text/html: Chromium coi đó là file tải về và không render được.
 *
 * @param {{url: string, probe: import('../ports/source-probe').ProbeResult|null}} input
 * @returns {'html'|'file'}
 */
function selectDownloadStrategy({ url, probe = null }) {
  if (probe?.isAttachment) {
    return DOWNLOAD_STRATEGY.FILE;
  }

  const mediaType = getMediaType(probe?.contentType);

  if (isHtmlMediaType(mediaType)) {
    return DOWNLOAD_STRATEGY.HTML;
  }

  const urlExtension = getUrlExtension(url);
  if (urlExtension && DOCUMENT_EXTENSIONS.has(urlExtension)) {
    return DOWNLOAD_STRATEGY.FILE;
  }

  if (mediaType) {
    return DOWNLOAD_STRATEGY.FILE;
  }

  return DOWNLOAD_STRATEGY.HTML;
}

module.exports = { DOWNLOAD_STRATEGY, selectDownloadStrategy };
