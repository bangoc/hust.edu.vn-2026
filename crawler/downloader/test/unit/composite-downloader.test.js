'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompositeDownloader } = require('../../adapters/outbound/downloaders/composite-downloader');
const { DOWNLOAD_STRATEGY } = require('../../domain/policies/download-strategy');

function createRecorder(name) {
  return {
    calls: [],
    async download(url, options) {
      this.calls.push({ url, options });
      return { source: name };
    },
  };
}

test('định tuyến HTML sang htmlDownloader', async () => {
  const htmlDownloader = createRecorder('html');
  const fileDownloader = createRecorder('file');
  const composite = new CompositeDownloader({ htmlDownloader, fileDownloader });

  const result = await composite.download('https://hust.edu.vn', {
    strategy: DOWNLOAD_STRATEGY.HTML,
  });

  assert.deepEqual(result, { source: 'html' });
  assert.equal(htmlDownloader.calls.length, 1);
  assert.equal(fileDownloader.calls.length, 0);
});

test('định tuyến PDF sang fileDownloader', async () => {
  const htmlDownloader = createRecorder('html');
  const fileDownloader = createRecorder('file');
  const composite = new CompositeDownloader({ htmlDownloader, fileDownloader });

  const result = await composite.download('https://hust.edu.vn/a.pdf', {
    strategy: DOWNLOAD_STRATEGY.FILE,
  });

  assert.deepEqual(result, { source: 'file' });
  assert.equal(htmlDownloader.calls.length, 0);
  assert.equal(fileDownloader.calls.length, 1);
});

test('strategy lạ bị từ chối', async () => {
  const composite = new CompositeDownloader({
    htmlDownloader: createRecorder('html'),
    fileDownloader: createRecorder('file'),
  });

  await assert.rejects(
    composite.download('https://hust.edu.vn', { strategy: 'không-hợp-lệ' }),
    (error) => error.code === 'invalid_download_strategy',
  );
});
