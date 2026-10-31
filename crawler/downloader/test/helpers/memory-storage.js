'use strict';

class MemoryContentStorage {
  constructor({ bucket = 'test-bucket' } = {}) {
    this.bucket = bucket;
    this.objects = new Map();
    this.presignCalls = [];
  }

  async exists(objectKey) {
    return this.objects.has(objectKey);
  }

  async put(objectKey, bytes, contentType) {
    this.objects.set(objectKey, {
      bytes: Buffer.from(bytes),
      contentType,
    });
  }

  async presign(objectKey, ttlSeconds) {
    this.presignCalls.push({ objectKey, ttlSeconds });
    return `memory://${this.bucket}/${objectKey}?ttl=${ttlSeconds}`;
  }

  async getObject(objectKey) {
    const bytes = this.objects.get(objectKey)?.bytes;
    return bytes ? Buffer.from(bytes) : null;
  }

  getBytes(objectKey) {
    return this.objects.get(objectKey)?.bytes ?? null;
  }
}

class MemoryManifestRepository {
  constructor() {
    this.manifests = new Map();
    this.errors = new Map();
  }

  setError(urlKey, error) {
    this.errors.set(urlKey, error);
  }

  async get(urlKey) {
    if (this.errors.has(urlKey)) {
      throw this.errors.get(urlKey);
    }
    const manifest = this.manifests.get(urlKey);
    return manifest ? { ...manifest } : null;
  }

  async put(urlKey, manifest) {
    this.manifests.set(urlKey, { ...manifest });
  }
}

module.exports = { MemoryContentStorage, MemoryManifestRepository };
