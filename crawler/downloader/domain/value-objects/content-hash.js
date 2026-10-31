'use strict';

const { createHash } = require('node:crypto');
const { DomainError } = require('../errors/domain-error');

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

class ContentHash {
  constructor(value) {
    if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) {
      throw new DomainError('invalid_content_hash', 'Content hash phải là chuỗi SHA-256 hex 64 ký tự');
    }
    this.value = value;
    Object.freeze(this);
  }

  static fromBuffer(buffer) {
    return new ContentHash(createHash('sha256').update(buffer).digest('hex'));
  }

  static fromHex(value) {
    return new ContentHash(value);
  }

  toString() {
    return this.value;
  }
}

/**
 * Hasher dùng cho streaming: cập nhật theo từng chunk, không giữ toàn bộ
 * nội dung trong bộ nhớ thêm một lần nữa.
 */
function createContentHasher() {
  const hash = createHash('sha256');
  let hasFinished = false;

  return {
    update(chunk) {
      if (hasFinished) {
        throw new DomainError('content_hasher_closed', 'Không thể cập nhật hasher đã kết thúc');
      }
      hash.update(chunk);
    },
    digest() {
      if (hasFinished) {
        throw new DomainError('content_hasher_closed', 'Hasher đã được kết thúc trước đó');
      }
      hasFinished = true;
      return new ContentHash(hash.digest('hex'));
    },
  };
}

module.exports = { ContentHash, createContentHasher, SHA256_HEX_PATTERN };
