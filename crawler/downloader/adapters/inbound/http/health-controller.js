'use strict';

function createHealthController({ jobQueue }) {
  return {
    getPing(req, res) {
      const queueStats = jobQueue.stats();
      let status = 'đang chờ';

      if (queueStats.active >= queueStats.concurrency && queueStats.queued > 0) {
        status = 'đang bận';
      } else if (queueStats.active > 0 || queueStats.queued > 0) {
        status = 'đang tải';
      }

      res.status(200).json({ status });
    },
  };
}

module.exports = { createHealthController };
