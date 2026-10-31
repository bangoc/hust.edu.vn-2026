'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HttpContentForwarder,
  buildReaderPayload,
} = require('../../adapters/outbound/reader/http-content-forwarder');
const { ForwardError } = require('../../domain/errors/forward-error');

const READER_URL = 'http://reader.test/parse';
const HTML = '<h1>Tổng Bí thư</h1><p>Xem <a href=bai-khac-656090.html>bài liên quan</a></p>';
const PDF_BYTES = Buffer.from('%PDF-1.4\nnội dung\n%%EOF');

function jsonResponse(status, headers = {}) {
  return new Response('{}', { status, headers: { 'content-type': 'application/json', ...headers } });
}

function createRecordingFetch(statuses) {
  const calls = [];
  const queue = [...statuses];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) {
      throw next;
    }
    return jsonResponse(next);
  };
  return { fetchImpl, calls };
}

function createForwarder(fetchImpl, overrides = {}) {
  return new HttpContentForwarder({
    readerUrl: READER_URL,
    fetchImpl,
    retryCount: 2,
    baseMs: 1,
    maxMs: 1,
    jitterMs: 0,
    sleepImpl: async () => undefined,
    ...overrides,
  });
}

test('payload HTML đúng hợp đồng: url, format, encoding text, content', () => {
  const payload = buildReaderPayload({
    url: 'https://hust.edu.vn/tin-tuc',
    format: 'html',
    contentType: 'text/html; charset=utf-8',
    bytes: Buffer.from(HTML, 'utf8'),
  });

  assert.deepEqual(Object.keys(payload), ['url', 'format', 'encoding', 'content']);
  assert.deepEqual(payload, {
    url: 'https://hust.edu.vn/tin-tuc',
    format: 'html',
    encoding: 'text',
    content: HTML,
  });
});

test('payload file đúng hợp đồng: format other, content_type, encoding base64', () => {
  const payload = buildReaderPayload({
    url: 'https://hust.edu.vn/uploads/quy-che.pdf',
    format: 'other',
    contentType: 'application/pdf',
    bytes: PDF_BYTES,
  });

  assert.deepEqual(Object.keys(payload), ['url', 'format', 'content_type', 'encoding', 'content']);
  assert.equal(payload.format, 'other');
  assert.equal(payload.content_type, 'application/pdf');
  assert.equal(payload.encoding, 'base64');
  assert.deepEqual(Buffer.from(payload.content, 'base64'), PDF_BYTES);
});

test('HTML được giải mã theo charset trong Content-Type', () => {
  const latin1Bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" theo ISO-8859-1
  const payload = buildReaderPayload({
    url: 'https://hust.edu.vn/',
    format: 'html',
    contentType: 'text/html; charset=ISO-8859-1',
    bytes: latin1Bytes,
  });
  assert.equal(payload.content, 'café');
});

test('charset không hợp lệ thì giải mã UTF-8', () => {
  const payload = buildReaderPayload({
    url: 'https://hust.edu.vn/',
    format: 'html',
    contentType: 'text/html; charset=khong-ton-tai',
    bytes: Buffer.from('Bách khoa', 'utf8'),
  });
  assert.equal(payload.content, 'Bách khoa');
});

test('forward gửi POST JSON tới readerUrl và trả httpStatus', async () => {
  const { fetchImpl, calls } = createRecordingFetch([200]);
  const forwarder = createForwarder(fetchImpl);

  const outcome = await forwarder.forward({
    url: 'https://hust.edu.vn/',
    format: 'html',
    contentType: 'text/html',
    bytes: Buffer.from(HTML),
  });

  assert.deepEqual(outcome, { httpStatus: 200 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, READER_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(calls[0].body.content, HTML);
});

test('lỗi 503 được thử lại tới khi module đọc nhận', async () => {
  const { fetchImpl, calls } = createRecordingFetch([503, 503, 202]);
  const forwarder = createForwarder(fetchImpl);

  const outcome = await forwarder.forward({
    url: 'https://hust.edu.vn/a.pdf',
    format: 'other',
    contentType: 'application/pdf',
    bytes: PDF_BYTES,
  });

  assert.equal(outcome.httpStatus, 202);
  assert.equal(calls.length, 3);
});

test('lỗi 400 không thử lại và ném ForwardError có upstreamStatus', async () => {
  const { fetchImpl, calls } = createRecordingFetch([400]);
  const forwarder = createForwarder(fetchImpl);

  await assert.rejects(
    forwarder.forward({ url: 'https://hust.edu.vn/', format: 'html', contentType: 'text/html', bytes: Buffer.from('x') }),
    (error) => {
      assert.ok(error instanceof ForwardError);
      assert.equal(error.code, 'forward_error');
      assert.equal(error.upstreamStatus, 400);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test('không kết nối được thì thử lại rồi ném ForwardError', async () => {
  const { fetchImpl, calls } = createRecordingFetch([new TypeError('fetch failed')]);
  const forwarder = createForwarder(fetchImpl);

  await assert.rejects(
    forwarder.forward({ url: 'https://hust.edu.vn/', format: 'html', contentType: 'text/html', bytes: Buffer.from('x') }),
    (error) => error instanceof ForwardError && /Không kết nối được/.test(error.message),
  );
  assert.equal(calls.length, 3);
});

test('module đọc không phản hồi kịp thì báo quá thời gian', async () => {
  const hangingFetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const forwarder = createForwarder(hangingFetch, { retryCount: 0, timeoutMs: 20 });

  await assert.rejects(
    forwarder.forward({ url: 'https://hust.edu.vn/', format: 'html', contentType: 'text/html', bytes: Buffer.from('x') }),
    (error) => error instanceof ForwardError && /thời gian/.test(error.message),
  );
});

test('thiếu readerUrl thì không tạo được forwarder', () => {
  assert.throws(() => new HttpContentForwarder({ readerUrl: '' }), /readerUrl/);
});
