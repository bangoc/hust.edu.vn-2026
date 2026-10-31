'use strict';

const { DOCUMENT_EXTENSIONS, getUrlExtension } = require('./content-format');

const PROBE_MODE = Object.freeze({
  AUTO: 'auto',
  ALWAYS: 'always',
  NEVER: 'never',
});

/**
 * Quyết định có cần HEAD trước khi tải hay không.
 *
 * - always: giữ hành vi cũ, HEAD cho mọi URL.
 * - auto: bỏ HEAD khi URL đã có đuôi tài liệu rõ ràng; vẫn HEAD cho HTML.
 * - never: không HEAD, chọn chiến lược theo đuôi URL.
 *
 * @param {{url: string, mode?: string}} input
 * @returns {boolean}
 */
function shouldProbeBeforeDownload({ url, mode = PROBE_MODE.AUTO }) {
  if (mode === PROBE_MODE.ALWAYS) {
    return true;
  }
  if (mode === PROBE_MODE.NEVER) {
    return false;
  }

  const extension = getUrlExtension(url);
  return !(extension && DOCUMENT_EXTENSIONS.has(extension));
}

module.exports = { PROBE_MODE, shouldProbeBeforeDownload };
