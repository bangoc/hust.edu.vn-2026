'use strict';

/**
 * Port hàng đợi job và kho trạng thái job trong bộ nhớ.
 *
 * @interface JobQueue
 */

/**
 * @function setProcessor
 * @param {(job: import('../entities/download-job').DownloadJob) => Promise<import('../entities/download-job').DownloadJob>} processor
 * @returns {void}
 */

/**
 * @function enqueue
 * @param {import('../entities/download-job').DownloadJob} job
 * @returns {void}
 */

/**
 * @function get
 * @param {string} jobId
 * @returns {import('../entities/download-job').DownloadJob|null}
 */

/**
 * @function findActiveByUrlKey
 * @param {string} urlKey
 * @returns {import('../entities/download-job').DownloadJob|null}
 */

/**
 * @function markInFlight
 * @param {string} urlKey
 * @param {string} jobId
 * @returns {void}
 */

/**
 * @function stats
 * @returns {{queued:number, active:number, capacity:number, totalJobs:number, doneJobs:number, failedJobs:number}}
 */

module.exports = {};
