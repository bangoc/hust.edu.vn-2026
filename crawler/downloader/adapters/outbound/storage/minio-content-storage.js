'use strict';

const {
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { StorageError } = require('../../../domain/errors/storage-error');

function isNotFoundError(error) {
  return (
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.$metadata?.httpStatusCode === 404
  );
}

class MinioContentStorage {
  constructor({ client, presignClient = client, bucket, logger = null }) {
    this.client = client;
    this.presignClient = presignClient;
    this.bucket = bucket;
    this.logger = logger;
  }

  async exists(objectKey) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw new StorageError('Không thể kiểm tra object trong MinIO', { cause: error });
    }
  }

  async put(objectKey, bytes, contentType) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: bytes,
          ContentLength: bytes.length,
          ContentType: contentType,
        }),
      );
    } catch (error) {
      throw new StorageError('Không thể ghi object vào MinIO', { cause: error });
    }
  }

  async presign(objectKey, ttlSeconds) {
    try {
      return await getSignedUrl(
        this.presignClient,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
        { expiresIn: ttlSeconds },
      );
    } catch (error) {
      throw new StorageError('Không thể tạo presigned URL', { cause: error });
    }
  }

  async getObject(objectKey) {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw new StorageError('Không thể đọc object từ MinIO', { cause: error });
    }
  }
}

module.exports = { MinioContentStorage, isNotFoundError };
