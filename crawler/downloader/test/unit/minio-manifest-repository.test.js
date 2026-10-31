'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MinioManifestRepository } = require('../../adapters/outbound/storage/minio-manifest-repository');
const { InvalidManifestError } = require('../../domain/errors/invalid-manifest-error');
const { ManifestError } = require('../../domain/errors/manifest-error');

const BUCKET = 'hust-raw';
const URL_KEY = 'a'.repeat(64);
const MANIFEST_KEY = `index/url/${URL_KEY}.json`;

function createFakeClient({ getText = null, getError = null, putError = null } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command);
      if (command.constructor.name === 'GetObjectCommand') {
        if (getError) {
          throw getError;
        }
        return {
          Body: {
            transformToString: async () => getText,
          },
        };
      }
      if (putError) {
        throw putError;
      }
      return {};
    },
  };
}

test('get trả manifest JSON hợp lệ và đọc đúng key', async () => {
  const client = createFakeClient({ getText: JSON.stringify({ sha256: 'abc' }) });
  const repository = new MinioManifestRepository({ client, bucket: BUCKET });

  const manifest = await repository.get(URL_KEY);

  assert.deepEqual(manifest, { sha256: 'abc' });
  assert.equal(client.calls[0].input.Bucket, BUCKET);
  assert.equal(client.calls[0].input.Key, MANIFEST_KEY);
});

test('get trả null khi manifest chưa tồn tại', async () => {
  const client = createFakeClient({
    getError: Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
  });
  const repository = new MinioManifestRepository({ client, bucket: BUCKET });

  assert.equal(await repository.get(URL_KEY), null);
});

test('get phân biệt JSON hỏng với lỗi MinIO', async () => {
  const brokenJson = new MinioManifestRepository({
    client: createFakeClient({ getText: '{"sha256":' }),
    bucket: BUCKET,
  });
  await assert.rejects(() => brokenJson.get(URL_KEY), (error) => {
    assert.ok(error instanceof InvalidManifestError);
    assert.equal(error.code, 'manifest_invalid');
    return true;
  });

  const nonObjectJson = new MinioManifestRepository({
    client: createFakeClient({ getText: '["raw/abc"]' }),
    bucket: BUCKET,
  });
  await assert.rejects(() => nonObjectJson.get(URL_KEY), (error) => {
    assert.ok(error instanceof InvalidManifestError);
    assert.equal(error.code, 'manifest_invalid');
    return true;
  });
});

test('get giữ ManifestError khi MinIO trả lỗi khác', async () => {
  const cause = Object.assign(new Error('access denied'), { name: 'AccessDenied' });
  const repository = new MinioManifestRepository({
    client: createFakeClient({ getError: cause }),
    bucket: BUCKET,
  });

  await assert.rejects(() => repository.get(URL_KEY), (error) => {
    assert.ok(error instanceof ManifestError);
    assert.equal(error.code, 'manifest_error');
    assert.equal(error.cause, cause);
    return true;
  });
});

test('put ghi JSON vào đúng key và content type', async () => {
  const client = createFakeClient();
  const repository = new MinioManifestRepository({ client, bucket: BUCKET });
  const manifest = { sha256: 'b'.repeat(64) };

  await repository.put(URL_KEY, manifest);

  const command = client.calls[0];
  assert.equal(command.input.Bucket, BUCKET);
  assert.equal(command.input.Key, MANIFEST_KEY);
  assert.equal(command.input.ContentType, 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(command.input.Body), manifest);
});

test('put bọc lỗi MinIO thành ManifestError', async () => {
  const cause = Object.assign(new Error('read only'), { name: 'AccessDenied' });
  const repository = new MinioManifestRepository({
    client: createFakeClient({ putError: cause }),
    bucket: BUCKET,
  });

  await assert.rejects(
    () => repository.put(URL_KEY, { sha256: 'c'.repeat(64) }),
    (error) => {
      assert.ok(error instanceof ManifestError);
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

test('manifestKey dựa trên urlKey', () => {
  const repository = new MinioManifestRepository({
    client: createFakeClient(),
    bucket: BUCKET,
  });

  assert.equal(repository.manifestKey(URL_KEY), MANIFEST_KEY);
});
