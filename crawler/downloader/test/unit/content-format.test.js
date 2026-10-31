'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectContentFormat,
  getUrlExtension,
  isHtmlMediaType,
} = require('../../domain/policies/content-format');

test('Content-Type text/html thắng đuôi .pdf', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://ctsv.hust.edu.vn/pdf-viewer/STSV-BK2019.pdf',
      contentType: 'text/html; charset=utf-8',
      bytes: Buffer.from('<!doctype html>'),
    }),
    { format: 'html', extension: 'html' },
  );
});

test('Content-Type application/pdf thắng đuôi .docx', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://example.com/file.docx',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF'),
    }),
    { format: 'other', extension: 'pdf' },
  );
});

test('DOCX trả application/octet-stream vẫn detect theo đuôi', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://hust.edu.vn/uploads/3.application-form2025.docx',
      contentType: 'application/octet-stream',
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    }),
    { format: 'other', extension: 'docx' },
  );
});

test('magic bytes là fallback cuối khi không có Content-Type và đuôi', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://example.com/download/12345',
      contentType: '',
      bytes: Buffer.from('%PDF-1.7'),
    }),
    { format: 'other', extension: 'pdf' },
  );
  assert.deepEqual(
    detectContentFormat({
      url: 'https://example.com/download/12345',
      contentType: '',
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    }),
    { format: 'other', extension: 'zip' },
  );
});

test('đuôi tài liệu được dùng khi Content-Type rỗng', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://example.com/file.pdf?download=1',
      contentType: null,
      bytes: Buffer.from('%PDF'),
    }),
    { format: 'other', extension: 'pdf' },
  );
});

test('MIME chuẩn của DOCX trả extension docx dù URL không có đuôi', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://example.com/download/12345',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      bytes: null,
    }),
    { format: 'other', extension: 'docx' },
  );
});

test('không có Content-Type và đuôi thì mặc định HTML', () => {
  assert.deepEqual(
    detectContentFormat({
      url: 'https://example.com/trang-chu',
      contentType: '',
      bytes: Buffer.from('<html></html>'),
    }),
    { format: 'html', extension: 'html' },
  );
});

test('getUrlExtension và isHtmlMediaType xử lý đúng', () => {
  assert.equal(getUrlExtension('https://example.com/a/b.PDF?x=1'), 'pdf');
  assert.equal(getUrlExtension('https://example.com/a/b'), null);
  assert.equal(isHtmlMediaType('application/xhtml+xml; charset=utf-8'), true);
  assert.equal(isHtmlMediaType('application/pdf'), false);
});
