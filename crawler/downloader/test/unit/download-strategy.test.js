'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DOWNLOAD_STRATEGY,
  selectDownloadStrategy,
} = require('../../domain/policies/download-strategy');

test('HEAD text/html chọn HTML dù URL có đuôi .pdf', () => {
  assert.equal(
    selectDownloadStrategy({
      url: 'https://ctsv.hust.edu.vn/pdf-viewer/STSV-BK2019.pdf',
      probe: { status: 200, contentType: 'text/html; charset=utf-8' },
    }),
    DOWNLOAD_STRATEGY.HTML,
  );
});

test('HEAD application/pdf chọn FILE', () => {
  assert.equal(
    selectDownloadStrategy({
      url: 'https://hust.edu.vn/bm17.pdf',
      probe: { status: 200, contentType: 'application/pdf' },
    }),
    DOWNLOAD_STRATEGY.FILE,
  );
});

test('DOCX application/octet-stream chọn FILE', () => {
  assert.equal(
    selectDownloadStrategy({
      url: 'https://hust.edu.vn/uploads/3.application-form2025.docx',
      probe: { status: 200, contentType: 'application/octet-stream' },
    }),
    DOWNLOAD_STRATEGY.FILE,
  );
});

test('HEAD lỗi hoặc 405 fallback theo extension', () => {
  assert.equal(
    selectDownloadStrategy({
      url: 'https://example.com/file.pdf',
      probe: { status: null, contentType: null, errorCode: 'probe_failed' },
    }),
    DOWNLOAD_STRATEGY.FILE,
  );
  assert.equal(
    selectDownloadStrategy({
      url: 'https://example.com/trang-chu',
      probe: { status: 405, contentType: null },
    }),
    DOWNLOAD_STRATEGY.HTML,
  );
});

test('application/xhtml+xml chọn HTML', () => {
  assert.equal(
    selectDownloadStrategy({
      url: 'https://example.com/page',
      probe: { status: 200, contentType: 'application/xhtml+xml' },
    }),
    DOWNLOAD_STRATEGY.HTML,
  );
});

test('Content-Disposition attachment chọn FILE dù Content-Type là text/html', () => {
  assert.equal(
    selectDownloadStrategy({
      url: 'https://hust.edu.vn/vi/news/savefile/tin-tuc-su-kien/bai-viet-654944.html',
      probe: { status: 200, contentType: 'text/html; charset=utf-8', isAttachment: true },
    }),
    DOWNLOAD_STRATEGY.FILE,
  );
});
