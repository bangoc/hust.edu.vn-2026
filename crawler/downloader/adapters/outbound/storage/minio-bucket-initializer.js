'use strict';

const {
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
} = require('@aws-sdk/client-s3');
const { StorageError } = require('../../../domain/errors/storage-error');
const { isNotFoundError } = require('./minio-content-storage');

const DEFAULT_READY_ATTEMPTS = 20;
const DEFAULT_READY_DELAY_MS = 1_000;

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

class MinioBucketInitializer {
  constructor({
    client,
    bucket,
    logger = null,
    readyAttempts = DEFAULT_READY_ATTEMPTS,
    readyDelayMs = DEFAULT_READY_DELAY_MS,
    sleepImpl = sleep,
  }) {
    this.client = client;
    this.bucket = bucket;
    this.logger = logger;
    this.readyAttempts = readyAttempts;
    this.readyDelayMs = readyDelayMs;
    this.sleepImpl = sleepImpl;
  }

  async ensureExists() {
    let lastError = null;

    for (let attempt = 1; attempt <= this.readyAttempts; attempt += 1) {
      try {
        await this.#ensureBucket();
        await this.#ensurePrivatePolicy();
        this.logger?.info('bucket_ready', {
          bucket: this.bucket,
          attempts: attempt,
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.readyAttempts) {
          this.logger?.warn('bucket_not_ready', {
            bucket: this.bucket,
            attempt,
            errorCode: error?.code ?? 'unknown',
          });
          await this.sleepImpl(this.readyDelayMs);
        }
      }
    }

    throw new StorageError('Không thể khởi tạo bucket MinIO', { cause: lastError });
  }

  async #ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (error?.name !== 'BucketAlreadyOwnedByYou' && error?.name !== 'BucketAlreadyExists') {
        throw error;
      }
    }
  }

  async #ensurePrivatePolicy() {
    try {
      await this.client.send(new DeleteBucketPolicyCommand({ Bucket: this.bucket }));
    } catch (error) {
      if (error?.name === 'NoSuchBucketPolicy' || isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

module.exports = { MinioBucketInitializer };
