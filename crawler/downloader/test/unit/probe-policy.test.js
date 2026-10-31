'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROBE_MODE,
  shouldProbeBeforeDownload,
} = require('../../domain/policies/probe-policy');

test('auto bỏ HEAD khi URL có đuôi tài liệu', () => {
  const urls = [
    'https://hust.edu.vn/uploads/bm17.pdf',
    'https://hust.edu.vn/uploads/bieu-mau.DOCX',
    'https://hust.edu.vn/uploads/diem.xlsx?download=1',
    'https://hust.edu.vn/uploads/slide.pptx#page=2',
  ];

  for (const url of urls) {
    assert.equal(
      shouldProbeBeforeDownload({ url, mode: PROBE_MODE.AUTO }),
      false,
      `không cần HEAD cho ${url}`,
    );
  }
});

test('auto vẫn HEAD cho trang HTML hoặc URL không có đuôi', () => {
  const urls = [
    'https://hust.edu.vn/tin-tuc',
    'https://hust.edu.vn/tin-tuc.html',
    'https://hust.edu.vn/tin-tuc/',
    'https://hust.edu.vn/',
  ];

  for (const url of urls) {
    assert.equal(
      shouldProbeBeforeDownload({ url, mode: PROBE_MODE.AUTO }),
      true,
      `cần HEAD cho ${url}`,
    );
  }
});

test('auto coi URL không hợp lệ là cần HEAD để probe quyết định', () => {
  assert.equal(
    shouldProbeBeforeDownload({ url: 'khong-phai-url', mode: PROBE_MODE.AUTO }),
    true,
  );
});

test('always luôn HEAD kể cả URL tài liệu', () => {
  assert.equal(
    shouldProbeBeforeDownload({
      url: 'https://hust.edu.vn/uploads/bm17.pdf',
      mode: PROBE_MODE.ALWAYS,
    }),
    true,
  );
});

test('never không HEAD cho cả HTML và tài liệu', () => {
  assert.equal(
    shouldProbeBeforeDownload({
      url: 'https://hust.edu.vn/tin-tuc',
      mode: PROBE_MODE.NEVER,
    }),
    false,
  );
  assert.equal(
    shouldProbeBeforeDownload({
      url: 'https://hust.edu.vn/uploads/bm17.pdf',
      mode: PROBE_MODE.NEVER,
    }),
    false,
  );
});

test('mặc định dùng auto khi không truyền mode', () => {
  assert.equal(
    shouldProbeBeforeDownload({ url: 'https://hust.edu.vn/uploads/bm17.pdf' }),
    false,
  );
  assert.equal(shouldProbeBeforeDownload({ url: 'https://hust.edu.vn/tin-tuc' }), true);
});
