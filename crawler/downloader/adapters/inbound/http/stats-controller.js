'use strict';

function createStatsController({ jobQueue, statsCollector, browserPool = null }) {
  return {
    getStats(req, res) {
      res.status(200).json({
        queue: jobQueue.stats(),
        jobs: statsCollector.snapshot(),
        browser: browserPool ? browserPool.stats() : null,
      });
    },
  };
}

module.exports = { createStatsController };
