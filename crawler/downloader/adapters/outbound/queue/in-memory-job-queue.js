'use strict';

const { QueueFullError } = require('../../../domain/errors/queue-full-error');
const {
  JOB_STATUS,
  isActiveJobStatus,
  isTerminalJobStatus,
} = require('../../../domain/value-objects/job-status');

class InMemoryJobQueue {
  constructor({
    maxConcurrent = 2,
    queueSize = 20,
    clock,
    logger = null,
    jobTtlMs = 3_600_000,
    maxJobs = 1_000,
  }) {
    this.maxConcurrent = maxConcurrent;
    this.queueSize = queueSize;
    this.clock = clock;
    this.logger = logger;
    this.jobTtlMs = jobTtlMs;
    this.maxJobs = maxJobs;

    this.jobs = new Map();
    this.pendingJobs = [];
    this.inFlightByUrlKey = new Map();
    this.activeJobCount = 0;
    this.processor = null;
    this.doneJobs = 0;
    this.failedJobs = 0;
  }

  setProcessor(processor) {
    this.processor = processor;
    this.drain();
  }

  enqueue(job) {
    if (this.pendingJobs.length >= this.queueSize) {
      throw new QueueFullError();
    }

    this.jobs.set(job.jobId, job);
    this.pendingJobs.push(job);
    this.pruneJobs();
    this.drain();
  }

  get(jobId) {
    return this.jobs.get(jobId) ?? null;
  }

  findActiveByUrlKey(urlKey) {
    const jobId = this.inFlightByUrlKey.get(urlKey);
    if (!jobId) {
      return null;
    }

    const job = this.jobs.get(jobId);
    if (!job || !isActiveJobStatus(job.status)) {
      this.inFlightByUrlKey.delete(urlKey);
      return null;
    }
    return job;
  }

  markInFlight(urlKey, jobId) {
    this.inFlightByUrlKey.set(urlKey, jobId);
  }

  stats() {
    return {
      queued: this.pendingJobs.length,
      active: this.activeJobCount,
      concurrency: this.maxConcurrent,
      queueSize: this.queueSize,
      capacity: this.maxConcurrent + this.queueSize,
      totalJobs: this.jobs.size,
      doneJobs: this.doneJobs,
      failedJobs: this.failedJobs,
    };
  }

  drain() {
    if (!this.processor) {
      return;
    }

    while (this.activeJobCount < this.maxConcurrent && this.pendingJobs.length > 0) {
      const job = this.pendingJobs.shift();
      if (!job || isTerminalJobStatus(job.status)) {
        continue;
      }

      this.activeJobCount += 1;
      void this.runJob(job);
    }
  }

  async runJob(job) {
    const currentJob = this.jobs.get(job.jobId) ?? job;

    try {
      const updatedJob = await this.processor(currentJob);
      if (updatedJob) {
        this.storeJob(updatedJob);
      }
    } catch (error) {
      const latestJob = this.jobs.get(job.jobId) ?? currentJob;
      try {
        const failedJob = latestJob.transition(JOB_STATUS.FAILED, {
          error: {
            code: error?.code ?? 'download_error',
            message: error?.message ?? 'Lỗi không xác định khi xử lý job',
          },
          now: this.clock.now(),
        });
        this.storeJob(failedJob);
      } catch (transitionError) {
        this.logger?.error('job_queue_failure_transition_failed', {
          jobId: job.jobId,
          errorCode: transitionError?.code ?? 'unknown',
        });
      }
    } finally {
      this.activeJobCount = Math.max(0, this.activeJobCount - 1);
      this.inFlightByUrlKey.delete(job.urlKey);
      this.pruneJobs();
      this.drain();
    }
  }

  storeJob(job) {
    const previousJob = this.jobs.get(job.jobId);
    this.jobs.set(job.jobId, job);

    if (isTerminalJobStatus(job.status) && previousJob?.status !== job.status) {
      if (job.status === JOB_STATUS.DONE) {
        this.doneJobs += 1;
      }
      if (job.status === JOB_STATUS.FAILED) {
        this.failedJobs += 1;
      }
    }
  }

  pruneJobs() {
    const nowMs = this.clock.now().getTime();
    const terminalJobs = [];

    for (const [jobId, job] of this.jobs) {
      if (!isTerminalJobStatus(job.status)) {
        continue;
      }
      terminalJobs.push({ jobId, job });
      if (nowMs - job.updatedAt.getTime() > this.jobTtlMs) {
        this.jobs.delete(jobId);
      }
    }

    if (this.jobs.size > this.maxJobs) {
      const removable = terminalJobs
        .filter(({ jobId }) => this.jobs.has(jobId))
        .sort((left, right) => left.job.updatedAt.getTime() - right.job.updatedAt.getTime());
      for (const { jobId } of removable) {
        if (this.jobs.size <= this.maxJobs) {
          break;
        }
        this.jobs.delete(jobId);
      }
    }
  }
}

module.exports = { InMemoryJobQueue };
