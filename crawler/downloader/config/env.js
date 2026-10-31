'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');

const DEFAULT_ENV_FILE = path.resolve(process.cwd(), '.env');

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8800),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  S3_ENDPOINT: z.url().default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  S3_SECRET_KEY: z.string().min(1).default('minioadmin'),
  S3_BUCKET: z.string().min(1).default('hust-raw'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_FORCE_PATH_STYLE: booleanString.default('true'),

  PRESIGN_TTL_SECONDS: z.coerce.number().int().min(1).max(604_800).default(900),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(20_971_520),
  MAX_HTML_BYTES: z.coerce.number().int().positive().default(5_242_880),
  MAX_CONCURRENT: z.coerce.number().int().positive().default(2),
  QUEUE_SIZE: z.coerce.number().int().positive().default(20),

  PROBE_MODE: z.enum(['auto', 'always', 'never']).default('auto'),
  PROBE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  HTML_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  FILE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  RETRY_COUNT: z.coerce.number().int().min(0).default(3),
  RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  RETRY_MAX_MS: z.coerce.number().int().positive().default(8_000),
  RETRY_JITTER_MS: z.coerce.number().int().min(0).default(250),
  HOST_DELAY_MS: z.coerce.number().int().min(0).default(500),

  ALLOWED_DOMAINS: z.string().default(''),
  AUTH_LOGIN_PATH_SEGMENTS: z.string().default('login,signin,sign-in,dang-nhap,dangnhap,sso,oauth'),
  RESPECT_ROBOTS: booleanString.default('false'),
  CHROME_BIN: z.string().min(1).default('/usr/bin/chromium'),
  BLOCK_RESOURCE_TYPES: z.string().default('image,media,font'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  USER_AGENT: z.string().min(1).default('HUST-Content-Downloader/1.0'),

  JOB_TTL_MS: z.coerce.number().int().positive().default(3_600_000),
  MAX_JOBS: z.coerce.number().int().positive().default(1_000),

  // Rỗng = không chuyển nội dung sang module đọc.
  READER_URL: z.union([z.literal(''), z.url()]).default(''),
  READER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  READER_RETRY_COUNT: z.coerce.number().int().min(0).default(3),
});

function loadOptionalEnvFile(envFile = DEFAULT_ENV_FILE) {
  if (typeof process.loadEnvFile !== 'function' || !fs.existsSync(envFile)) {
    return false;
  }
  process.loadEnvFile(envFile);
  return true;
}

function createConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Cấu hình biến môi trường không hợp lệ: ${details}`);
  }

  const values = parsed.data;
  const allowedDomains = values.ALLOWED_DOMAINS.split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  const blockedResourceTypes = values.BLOCK_RESOURCE_TYPES.split(',')
    .map((resourceType) => resourceType.trim().toLowerCase())
    .filter(Boolean);
  const authLoginPathSegments = values.AUTH_LOGIN_PATH_SEGMENTS.split(',')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  return Object.freeze({
    port: values.PORT,
    nodeEnv: values.NODE_ENV,
    s3: Object.freeze({
      endpoint: values.S3_ENDPOINT,
      publicEndpoint: values.S3_PUBLIC_ENDPOINT ?? values.S3_ENDPOINT,
      accessKey: values.S3_ACCESS_KEY,
      secretKey: values.S3_SECRET_KEY,
      bucket: values.S3_BUCKET,
      region: values.S3_REGION,
      forcePathStyle: values.S3_FORCE_PATH_STYLE,
    }),
    presignTtlSeconds: values.PRESIGN_TTL_SECONDS,
    maxFileBytes: values.MAX_FILE_BYTES,
    maxHtmlBytes: values.MAX_HTML_BYTES,
    maxConcurrent: values.MAX_CONCURRENT,
    queueSize: values.QUEUE_SIZE,
    probeMode: values.PROBE_MODE,
    probeTimeoutMs: values.PROBE_TIMEOUT_MS,
    htmlTimeoutMs: values.HTML_TIMEOUT_MS,
    fileTimeoutMs: values.FILE_TIMEOUT_MS,
    retry: Object.freeze({
      count: values.RETRY_COUNT,
      baseMs: values.RETRY_BASE_MS,
      maxMs: values.RETRY_MAX_MS,
      jitterMs: values.RETRY_JITTER_MS,
    }),
    hostDelayMs: values.HOST_DELAY_MS,
    allowedDomains,
    authLoginPathSegments,
    respectRobots: values.RESPECT_ROBOTS,
    chromeBin: values.CHROME_BIN,
    blockedResourceTypes,
    logLevel: values.LOG_LEVEL,
    userAgent: values.USER_AGENT,
    jobTtlMs: values.JOB_TTL_MS,
    maxJobs: values.MAX_JOBS,
    reader: Object.freeze({
      url: values.READER_URL || null,
      timeoutMs: values.READER_TIMEOUT_MS,
      retryCount: values.READER_RETRY_COUNT,
    }),
  });
}

module.exports = {
  DEFAULT_ENV_FILE,
  envSchema,
  createConfig,
  loadOptionalEnvFile,
};
