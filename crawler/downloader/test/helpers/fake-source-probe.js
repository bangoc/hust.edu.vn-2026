'use strict';

class FakeSourceProbe {
  constructor({ responses = {} } = {}) {
    this.responses = new Map(Object.entries(responses));
    this.calls = [];
  }

  setResponse(url, response) {
    this.responses.set(url, response);
  }

  async head(url, headers = {}) {
    this.calls.push({ url, headers: { ...headers } });
    const configured = this.responses.get(url);
    if (!configured) {
      throw new Error(`FakeSourceProbe chưa có response cho ${url}`);
    }

    const response = typeof configured === 'function' ? configured({ url, headers }) : configured;
    const resolved = Array.isArray(response) ? response.shift() : response;
    if (!resolved) {
      throw new Error(`FakeSourceProbe đã hết response cho ${url}`);
    }

    return {
      status: 200,
      contentType: null,
      contentLength: null,
      etag: null,
      lastModified: null,
      isAttachment: false,
      finalUrl: url,
      errorCode: null,
      ...resolved,
    };
  }
}

module.exports = { FakeSourceProbe };
