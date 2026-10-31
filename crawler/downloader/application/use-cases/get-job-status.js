'use strict';

const { NotFoundError } = require('../../domain/errors/not-found-error');
const { StorageError } = require('../../domain/errors/storage-error');
const { JOB_STATUS } = require('../../domain/value-objects/job-status');
const { toJobResponse } = require('../dto/job-response');

class GetJobStatus {
  constructor({ jobQueue, contentStorage, presignTtlSeconds, logger = null }) {
    this.jobQueue = jobQueue;
    this.contentStorage = contentStorage;
    this.presignTtlSeconds = presignTtlSeconds;
    this.logger = logger;
  }

  async execute(jobId) {
    const job = this.jobQueue.get(jobId);
    if (!job) {
      throw new NotFoundError(`Không tìm thấy job ${jobId}`);
    }

    let contentRef = null;
    if (job.status === JOB_STATUS.DONE && job.result?.objectKey) {
      try {
        contentRef = await this.contentStorage.presign(
          job.result.objectKey,
          this.presignTtlSeconds,
        );
      } catch (error) {
        this.logger?.error('presigned_url_failed', {
          jobId: job.jobId,
          objectKey: job.result.objectKey,
          errorCode: error?.code ?? 'unknown',
        });
        throw new StorageError('Không thể tạo presigned URL cho nội dung đã tải', {
          cause: error,
        });
      }
    }

    return toJobResponse(job, { contentRef });
  }
}

module.exports = { GetJobStatus };
