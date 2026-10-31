'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  S3Client,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} = require('@aws-sdk/client-s3');
const { MinioContentStorage } = require('../../adapters/outbound/storage/minio-content-storage');
const { MinioManifestRepository } = require('../../adapters/outbound/storage/minio-manifest-repository');
const { MinioBucketInitializer } = require('../../adapters/outbound/storage/minio-bucket-initializer');

const endpoint = process.env.S3_TEST_ENDPOINT ?? 'http://127.0.0.1:9000';
const accessKey = process.env.S3_TEST_ACCESS_KEY ?? 'minioadmin';
const secretKey = process.env.S3_TEST_SECRET_KEY ?? 'minioadmin';
const bucket = `downloader-test-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const client = new S3Client({
  endpoint,
  region: 'us-east-1',
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  forcePathStyle: true,
});
const storage = new MinioContentStorage({ client, bucket });
const manifestRepository = new MinioManifestRepository({ client, bucket });
const bucketInitializer = new MinioBucketInitializer({
  client,
  bucket,
  readyAttempts: 10,
  readyDelayMs: 500,
});

const PDF_BYTES = Buffer.from('%PDF-1.7\nnội dung kiểm thử MinIO\n%%EOF');

function anonymousObjectUrl(objectKey) {
  return `${endpoint}/${bucket}/${objectKey}`;
}

test.before(async () => {
  await bucketInitializer.ensureExists();
});

test.after(async () => {
  try {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const keys = (listed.Contents ?? []).map((object) => ({ Key: object.Key }));
    if (keys.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys, Quiet: true },
        }),
      );
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  } finally {
    client.destroy();
  }
});

test('bucket được tạo idempotent và private', async () => {
  await bucketInitializer.ensureExists();

  const head = await client.send(new HeadBucketCommand({ Bucket: bucket }));
  assert.equal(head.$metadata.httpStatusCode, 200);

  const objectKey = 'test/private.txt';
  await storage.put(objectKey, Buffer.from('riêng tư'), 'text/plain');
  const anonymous = await fetch(anonymousObjectUrl(objectKey));
  assert.equal(anonymous.status, 403);
});

test('put, exists, getObject và exists trả false cho key thiếu', async () => {
  const objectKey = 'test/tai-lieu.pdf';
  await storage.put(objectKey, PDF_BYTES, 'application/pdf');

  assert.equal(await storage.exists(objectKey), true);
  assert.equal(await storage.exists('test/khong-co.pdf'), false);
  assert.deepEqual(await storage.getObject(objectKey), PDF_BYTES);
  assert.equal(await storage.getObject('test/khong-co.pdf'), null);
});

test('presigned GET đọc được object còn URL trần bị từ chối', async () => {
  const objectKey = 'test/presigned.pdf';
  await storage.put(objectKey, PDF_BYTES, 'application/pdf');

  const presignedUrl = await storage.presign(objectKey, 60);
  assert.match(presignedUrl, /X-Amz-Signature=/);
  assert.match(presignedUrl, new RegExp(`^${endpoint}/${bucket}/${objectKey}`));

  const signedResponse = await fetch(presignedUrl);
  assert.equal(signedResponse.status, 200);
  assert.equal(signedResponse.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await signedResponse.arrayBuffer()), PDF_BYTES);

  const anonymousResponse = await fetch(anonymousObjectUrl(objectKey));
  assert.equal(anonymousResponse.status, 403);
});

test('presigned URL hết hạn bị từ chối', async () => {
  const objectKey = 'test/expired.pdf';
  await storage.put(objectKey, PDF_BYTES, 'application/pdf');

  const presignedUrl = await storage.presign(objectKey, 1);
  await new Promise((resolve) => setTimeout(resolve, 2_200));

  const response = await fetch(presignedUrl);
  assert.equal(response.status, 403);
});

test('manifest lưu và đọc lại được từ instance repository mới', async () => {
  const urlKey = 'a'.repeat(64);
  const manifest = {
    url: 'https://hust.edu.vn/tin-tuc',
    normalizedUrl: 'https://hust.edu.vn/tin-tuc',
    sha256: 'b'.repeat(64),
    objectKey: `raw/${'b'.repeat(64)}`,
    contentType: 'text/html',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    etag: '"v1"',
  };

  assert.equal(await manifestRepository.get(urlKey), null);
  await manifestRepository.put(urlKey, manifest);

  const newRepository = new MinioManifestRepository({ client, bucket });
  assert.deepEqual(await newRepository.get(urlKey), manifest);
  assert.equal(await newRepository.get('c'.repeat(64)), null);
});

test('bucket đang public được đưa về private khi khởi tạo lại', async () => {
  const objectKey = 'test/public-sau-do-private.txt';
  await storage.put(objectKey, Buffer.from('công khai'), 'text/plain');

  const publicPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify(publicPolicy),
    }),
  );

  const publicResponse = await fetch(anonymousObjectUrl(objectKey));
  assert.equal(publicResponse.status, 200);

  await bucketInitializer.ensureExists();
  const privateResponse = await fetch(anonymousObjectUrl(objectKey));
  assert.equal(privateResponse.status, 403);
});
