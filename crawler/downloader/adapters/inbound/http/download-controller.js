'use strict';

const { parseLoadRequest } = require('../../../application/dto/load-request');
const { toLoadResponse } = require('../../../application/dto/job-response');

function createDownloadController({ submitDownloadJob, getJobStatus }) {
  return {
    async load(req, res) {
      const { url, force } = parseLoadRequest(req.body);
      const { job, deduplicated } = await submitDownloadJob.execute({ url, force });
      res.status(202).json(toLoadResponse(job, { deduplicated }));
    },

    async getJob(req, res) {
      const jobResponse = await getJobStatus.execute(req.params.jobId);
      res.status(200).json(jobResponse);
    },
  };
}

module.exports = { createDownloadController };
