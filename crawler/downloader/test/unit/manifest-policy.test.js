'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidManifest } = require('../../domain/policies/manifest-policy');

const SHA256 = 'a'.repeat(64);
const URL_KEY = 'b'.repeat(64);

function createValidManifest(overrides = {}) {
  return {
    url: 'https://hust.edu.vn/uploads/bm17.pdf',
    finalUrl: 'https://hust.edu.vn/uploads/bm17.pdf',
    urlKey: URL_KEY,
    sha256: SHA256,
    objectKey: `raw/${SHA256}`,
    format: 'other',
    contentType: 'application/pdf',
    extension: 'pdf',
    size: 1024,
    etag: '"v1"',
    lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('manifest đúng schema được chấp nhận', () => {
  assert.equal(isValidManifest(createValidManifest()), true);
});

test('manifest không có etag hoặc lastModified vẫn hợp lệ', () => {
  assert.equal(isValidManifest(createValidManifest({ etag: null, lastModified: null })), true);
  assert.equal(
    isValidManifest(createValidManifest({ etag: undefined, lastModified: undefined })),
    true,
  );
});

test('manifest không phải object bị từ chối', () => {
  for (const manifest of [null, undefined, 'manifest', 42, [], ['raw/abc']]) {
    assert.equal(isValidManifest(manifest), false);
  }
});

test('manifest có URL sai scheme hoặc URL rỗng bị từ chối', () => {
  assert.equal(isValidManifest(createValidManifest({ finalUrl: 'ftp://hust.edu.vn/a.pdf' })), false);
  assert.equal(isValidManifest(createValidManifest({ finalUrl: 'khong-phai-url' })), false);
  assert.equal(isValidManifest(createValidManifest({ finalUrl: '' })), false);
  assert.equal(isValidManifest(createValidManifest({ url: '' })), false);
  assert.equal(isValidManifest(createValidManifest({ url: null })), false);
});

test('manifest có hash hoặc objectKey sai bị từ chối', () => {
  assert.equal(isValidManifest(createValidManifest({ sha256: 'abc' })), false);
  assert.equal(isValidManifest(createValidManifest({ sha256: SHA256.toUpperCase() })), false);
  assert.equal(isValidManifest(createValidManifest({ urlKey: 'khong-phai-hash' })), false);
  assert.equal(
    isValidManifest(createValidManifest({ objectKey: `raw/${'c'.repeat(64)}` })),
    false,
  );
  assert.equal(isValidManifest(createValidManifest({ objectKey: null })), false);
});

test('manifest có format, contentType hoặc extension sai bị từ chối', () => {
  assert.equal(isValidManifest(createValidManifest({ format: 'pdf' })), false);
  assert.equal(isValidManifest(createValidManifest({ format: null })), false);
  assert.equal(isValidManifest(createValidManifest({ contentType: '' })), false);
  assert.equal(isValidManifest(createValidManifest({ extension: '' })), false);
  assert.equal(isValidManifest(createValidManifest({ extension: 7 })), false);
});

test('manifest có size hoặc fetchedAt sai bị từ chối', () => {
  for (const size of [-1, 1.5, '1024', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isValidManifest(createValidManifest({ size })), false, `size=${size}`);
  }
  assert.equal(isValidManifest(createValidManifest({ fetchedAt: 'khong-phai-ngay' })), false);
  assert.equal(isValidManifest(createValidManifest({ fetchedAt: '' })), false);
  assert.equal(isValidManifest(createValidManifest({ fetchedAt: null })), false);
});

test('manifest có validator sai kiểu bị từ chối', () => {
  assert.equal(isValidManifest(createValidManifest({ etag: '' })), false);
  assert.equal(isValidManifest(createValidManifest({ lastModified: 123 })), false);
  assert.equal(isValidManifest(createValidManifest({ etag: {} })), false);
});
