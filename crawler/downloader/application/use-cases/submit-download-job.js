'use strict';

const { randomUUID } = require('node:crypto');
const { DownloadJob } = require('../../domain/entities/download-job');

class SubmitDownloadJob {
  constructor({ urlPolicy, jobQueue, clock, logger = null, statsCollector = null }) {
    this.urlPolicy = urlPolicy;
    this.jobQueue = jobQueue;
    this.clock = clock;
    this.logger = logger;
    this.statsCollector = statsCollector;
  }

  async execute({ url, force = false }) {
    const { normalizedUrl, urlKey } = this.urlPolicy.normalize(url);
    await this.urlPolicy.assertAllowed(normalizedUrl);

    // Đoạn kiểm tra và đánh dấu in-flight là đồng bộ để hai request đến cùng
    // urlKey không thể cùng tạo job trong một event-loop tick.
    const inFlightJob = this.jobQueue.findActiveByUrlKey(urlKey);
    if (inFlightJob) {
      this.logger?.info('download_job_deduplicated', {
        jobId: inFlightJob.jobId,
        urlKey,
        host: safeHost(normalizedUrl),
      });
      this.statsCollector?.recordDeduplicated();
      return { job: inFlightJob, deduplicated: true };
    }

    const now = this.clock.now();
    const job = DownloadJob.create({
      jobId: randomUUID(),
      url: String(url).trim(),
      normalizedUrl,
      urlKey,
      force,
      now,
    });

    this.jobQueue.enqueue(job);
    this.jobQueue.markInFlight(urlKey, job.jobId);
    this.statsCollector?.recordJobCreated();

    this.logger?.info('download_job_queued', {
      jobId: job.jobId,
      urlKey,
      host: safeHost(normalizedUrl),
      force,
    });

    return { job, deduplicated: false };
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

module.exports = { SubmitDownloadJob };
