'use strict';

const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { InvalidManifestError } = require('../../../domain/errors/invalid-manifest-error');
const { ManifestError } = require('../../../domain/errors/manifest-error');
const { isNotFoundError } = require('./minio-content-storage');

class MinioManifestRepository {
  constructor({ client, bucket, logger = null }) {
    this.client = client;
    this.bucket = bucket;
    this.logger = logger;
  }

  async get(urlKey) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.manifestKey(urlKey),
        }),
      );

      const text = await response.Body.transformToString('utf-8');
      let manifest;
      try {
        manifest = JSON.parse(text);
      } catch (cause) {
        throw new InvalidManifestError('Manifest URL không phải JSON hợp lệ', { cause });
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new InvalidManifestError('Manifest URL không phải object JSON');
      }
      return manifest;
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      if (error instanceof InvalidManifestError || error instanceof ManifestError) {
        throw error;
      }
      throw new ManifestError('Không thể đọc manifest URL từ MinIO', { cause: error });
    }
  }

  async put(urlKey, manifest) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.manifestKey(urlKey),
          Body: JSON.stringify(manifest),
          ContentType: 'application/json; charset=utf-8',
        }),
      );
    } catch (error) {
      throw new ManifestError('Không thể ghi manifest URL vào MinIO', { cause: error });
    }
  }

  manifestKey(urlKey) {
    return `index/url/${urlKey}.json`;
  }
}

module.exports = { MinioManifestRepository };
