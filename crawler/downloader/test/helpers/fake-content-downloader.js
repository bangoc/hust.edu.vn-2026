'use strict';

const { DownloadError } = require('../../domain/errors/download-error');
const { ContentHash } = require('../../domain/value-objects/content-hash');

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

class FakeContentDownloader {
  constructor({ responses = {}, delayMs = 0 } = {}) {
    this.responses = new Map(Object.entries(responses));
    this.delayMs = delayMs;
    this.calls = [];
  }

  setResponse(url, response) {
    this.responses.set(url, response);
  }

  async download(url, options) {
    this.calls.push({ url, options });
    if (this.delayMs > 0) {
      await sleep(this.delayMs);
    }

    const configured = this.responses.get(url);
    if (!configured) {
      throw new DownloadError(`FakeContentDownloader chưa có response cho ${url}`);
    }

    const response = typeof configured === 'function' ? configured({ url, options }) : configured;
    const resolved = Array.isArray(response) ? response.shift() : response;
    if (!resolved) {
      throw new DownloadError(`FakeContentDownloader đã hết response cho ${url}`);
    }
    if (resolved.error) {
      throw resolved.error;
    }

    if (resolved.notModified) {
      return {
        bytes: Buffer.alloc(0),
        notModified: true,
        sha256: null,
        contentType: resolved.contentType ?? null,
        finalUrl: resolved.finalUrl ?? url,
        httpStatus: 304,
        etag: resolved.etag ?? null,
        lastModified: resolved.lastModified ?? null,
        size: 0,
      };
    }

    const bytes = Buffer.isBuffer(resolved.bytes)
      ? resolved.bytes
      : Buffer.from(resolved.bytes ?? '');
    const sha256 = resolved.sha256 ?? ContentHash.fromBuffer(bytes).value;

    return {
      bytes,
      notModified: false,
      sha256,
      contentType: resolved.contentType ?? 'application/octet-stream',
      finalUrl: resolved.finalUrl ?? url,
      httpStatus: resolved.httpStatus ?? 200,
      etag: resolved.etag ?? null,
      lastModified: resolved.lastModified ?? null,
      size: bytes.length,
    };
  }
}

module.exports = { FakeContentDownloader };
