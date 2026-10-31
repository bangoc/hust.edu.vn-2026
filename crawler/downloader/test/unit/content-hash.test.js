'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContentHash,
  createContentHasher,
} = require('../../domain/value-objects/content-hash');

test('ContentHash khớp vector SHA-256 đã biết', () => {
  assert.equal(
    ContentHash.fromBuffer(Buffer.alloc(0)).value,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    ContentHash.fromBuffer(Buffer.from('abc')).value,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('createContentHasher cho cùng hash khi cập nhật theo chunk', () => {
  const hasher = createContentHasher();
  hasher.update(Buffer.from('a'));
  hasher.update(Buffer.from('bc'));

  assert.equal(
    hasher.digest().value,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('ContentHash từ chối hash sai định dạng', () => {
  assert.throws(
    () => ContentHash.fromHex('not-a-hash'),
    (error) => error.code === 'invalid_content_hash',
  );
});

test('hasher không cho update hoặc digest lần hai', () => {
  const hasher = createContentHasher();
  hasher.digest();

  assert.throws(() => hasher.update(Buffer.from('x')), (error) => error.code === 'content_hasher_closed');
  assert.throws(() => hasher.digest(), (error) => error.code === 'content_hasher_closed');
});
