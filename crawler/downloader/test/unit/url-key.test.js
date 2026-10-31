'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UrlKey, normalizeUrl } = require('../../domain/value-objects/url-key');

test('normalizeUrl hạ host, bỏ port mặc định, fragment và tham số tracking', () => {
  const normalized = normalizeUrl(
    'HTTPS://HUST.edu.vn:443/tin-tuc?b=2&utm_source=facebook&a=1&fbclid=xyz#section',
  );

  assert.equal(normalized, 'https://hust.edu.vn/tin-tuc?b=2&a=1');
});

test('normalizeUrl giữ thứ tự query và dấu slash cuối path', () => {
  assert.equal(
    normalizeUrl('https://hust.edu.vn/vi/news/?z=1&a=2'),
    'https://hust.edu.vn/vi/news/?z=1&a=2',
  );
  assert.equal(normalizeUrl('http://example.com:80'), 'http://example.com/');
});

test('normalizeUrl resolve dot segments', () => {
  assert.equal(
    normalizeUrl('https://example.com/a/../b/./c?x=1'),
    'https://example.com/b/c?x=1',
  );
});

test('UrlKey cho cùng giá trị với URL tương đương', () => {
  const first = new UrlKey('https://HUST.edu.vn/tin-tuc?utm_campaign=x#top');
  const second = new UrlKey('https://hust.edu.vn/tin-tuc');

  assert.equal(first.value, second.value);
  assert.equal(first.normalizedUrl, 'https://hust.edu.vn/tin-tuc');
  assert.match(first.value, /^[a-f0-9]{64}$/);
});

test('normalizeUrl từ chối URL không hợp lệ', () => {
  for (const invalidUrl of ['', '   ', 'ftp://example.com/file', 'file:///tmp/a', 'javascript:alert(1)']) {
    assert.throws(() => normalizeUrl(invalidUrl), (error) => error.code === 'invalid_url');
  }
});

test('normalizeUrl từ chối URL chứa thông tin đăng nhập', () => {
  assert.throws(
    () => normalizeUrl('https://user:password@example.com/'),
    (error) => error.code === 'invalid_url',
  );
});
