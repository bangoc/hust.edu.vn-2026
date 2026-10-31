'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DnsUrlPolicy,
  isPrivateIpv4,
  isPrivateOrReservedAddress,
} = require('../../adapters/outbound/network/dns-url-policy');

test('isPrivateIpv4 nhận diện các dải nội bộ và metadata', () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
  ]) {
    assert.equal(isPrivateIpv4(address), true, address);
  }

  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv4('1.1.1.1'), false);
});

test('isPrivateOrReservedAddress xử lý IPv6 và IPv4-mapped', () => {
  assert.equal(isPrivateOrReservedAddress('::1'), true);
  assert.equal(isPrivateOrReservedAddress('::'), true);
  assert.equal(isPrivateOrReservedAddress('fc00::1'), true);
  assert.equal(isPrivateOrReservedAddress('fd12:3456::1'), true);
  assert.equal(isPrivateOrReservedAddress('fe80::1'), true);
  assert.equal(isPrivateOrReservedAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedAddress('::ffff:7f00:1'), true);
  assert.equal(isPrivateOrReservedAddress('2001:4860:4860::8888'), false);
});

test('DnsUrlPolicy cho phép host public đã resolve', async () => {
  const policy = new DnsUrlPolicy({
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
  });

  await assert.doesNotReject(policy.assertAllowed('https://example.com/tin-tuc'));
});

test('DnsUrlPolicy chặn host resolve ra IP nội bộ', async () => {
  const policy = new DnsUrlPolicy({
    resolveHost: async () => [{ address: '10.0.0.5', family: 4 }],
  });

  await assert.rejects(
    policy.assertAllowed('https://noi-bo.example.com/'),
    (error) => error.code === 'blocked_host',
  );
});

test('DnsUrlPolicy chặn IP literal nội bộ và metadata', async () => {
  const policy = new DnsUrlPolicy({
    resolveHost: async () => {
      throw new Error('không được gọi resolver cho IP literal');
    },
  });

  for (const url of [
    'http://127.0.0.1:8080/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
  ]) {
    await assert.rejects(policy.assertAllowed(url), (error) => error.code === 'blocked_host');
  }

  await assert.doesNotReject(policy.assertAllowed('http://8.8.8.8/'));
});

test('DnsUrlPolicy áp dụng allowlist theo domain và subdomain', async () => {
  const policy = new DnsUrlPolicy({
    allowedDomains: ['hust.edu.vn'],
    resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
  });

  await assert.doesNotReject(policy.assertAllowed('https://soict.hust.edu.vn/'));
  await assert.rejects(
    policy.assertAllowed('https://example.com/'),
    (error) => error.code === 'blocked_host',
  );
});

test('DnsUrlPolicy từ chối khi resolver lỗi', async () => {
  const policy = new DnsUrlPolicy({
    resolveHost: async () => {
      throw new Error('DNS down');
    },
  });

  await assert.rejects(
    policy.assertAllowed('https://example.com/'),
    (error) => error.code === 'blocked_host',
  );
});

test('DnsUrlPolicy normalize trả normalizedUrl và urlKey', () => {
  const policy = new DnsUrlPolicy({ resolveHost: async () => [] });
  const result = policy.normalize('https://HUST.edu.vn/tin-tuc?utm_source=x#top');

  assert.equal(result.normalizedUrl, 'https://hust.edu.vn/tin-tuc');
  assert.match(result.urlKey, /^[a-f0-9]{64}$/);
});
