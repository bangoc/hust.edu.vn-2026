'use strict';

const { BlockedHostError } = require('../../domain/errors/blocked-host-error');
const { UrlKey } = require('../../domain/value-objects/url-key');

class FakeUrlPolicy {
  constructor({ blockedHosts = [] } = {}) {
    this.blockedHosts = new Set(blockedHosts);
    this.checkedUrls = [];
  }

  normalize(rawUrl) {
    const urlKey = new UrlKey(rawUrl);
    return { normalizedUrl: urlKey.normalizedUrl, urlKey: urlKey.value };
  }

  async assertAllowed(url) {
    this.checkedUrls.push(url);
    const hostname = new URL(url).hostname.toLowerCase();
    if (this.blockedHosts.has(hostname)) {
      throw new BlockedHostError(`Host ${hostname} bị chặn trong test`);
    }
  }
}

module.exports = { FakeUrlPolicy };
