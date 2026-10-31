'use strict';

const { DomainError } = require('../../../domain/errors/domain-error');
const { DOWNLOAD_STRATEGY } = require('../../../domain/policies/download-strategy');

class CompositeDownloader {
  constructor({ htmlDownloader, fileDownloader }) {
    this.htmlDownloader = htmlDownloader;
    this.fileDownloader = fileDownloader;
  }

  download(url, options) {
    if (options?.strategy === DOWNLOAD_STRATEGY.HTML) {
      return this.htmlDownloader.download(url, options);
    }
    if (options?.strategy === DOWNLOAD_STRATEGY.FILE) {
      return this.fileDownloader.download(url, options);
    }
    return Promise.reject(
      new DomainError('invalid_download_strategy', `Chiến lược tải không hợp lệ: ${options?.strategy}`),
    );
  }
}

module.exports = { CompositeDownloader };
