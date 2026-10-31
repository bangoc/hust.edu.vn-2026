'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_LOGIN_PATH_SEGMENTS,
  detectAuthRequired,
  isLoginUrl,
  normalizeSegment,
} = require('../../domain/policies/auth-required');

test('HTTP 401 luôn được nhận diện là yêu cầu đăng nhập', () => {
  assert.deepEqual(detectAuthRequired({ httpStatus: 401 }), {
    required: true,
    reason: 'unauthorized',
  });
  assert.deepEqual(
    detectAuthRequired({ httpStatus: 401, finalUrl: 'https://hust.edu.vn/tai-lieu.pdf' }),
    { required: true, reason: 'unauthorized' },
  );
});

test('redirect tới path login được nhận diện là yêu cầu đăng nhập', () => {
  const loginUrls = [
    'https://hust.edu.vn/login',
    'https://hust.edu.vn/login?returnUrl=%2Ftin-tuc',
    'https://hust.edu.vn/signin.html',
    'https://hust.edu.vn/dang-nhap',
    'https://hust.edu.vn/sso/cas',
    'https://hust.edu.vn/oauth/authorize',
    'https://hust.edu.vn/tin-tuc/login.aspx',
  ];

  for (const finalUrl of loginUrls) {
    assert.deepEqual(
      detectAuthRequired({ finalUrl, httpStatus: 200 }),
      { required: true, reason: 'login_redirect' },
      `phải nhận diện ${finalUrl}`,
    );
  }
});

test('login redirect sau 302 hoặc 403 vẫn được nhận diện', () => {
  const finalUrl = 'https://hust.edu.vn/login';
  assert.equal(detectAuthRequired({ finalUrl, httpStatus: 302 }).required, true);
  assert.equal(detectAuthRequired({ finalUrl, httpStatus: 403 }).required, true);
});

test('trang bình thường không bị coi là yêu cầu đăng nhập', () => {
  const urls = [
    'https://hust.edu.vn/tin-tuc',
    'https://hust.edu.vn/tin-tuc/login-help',
    'https://hust.edu.vn/tin-tuc/login-huong-dan',
    'https://hust.edu.vn/',
  ];

  for (const finalUrl of urls) {
    assert.deepEqual(detectAuthRequired({ finalUrl, httpStatus: 200 }), {
      required: false,
      reason: null,
    });
  }
});

test('path login với status lỗi không thuộc diện xét không bị coi là auth', () => {
  const finalUrl = 'https://hust.edu.vn/login';
  assert.equal(detectAuthRequired({ finalUrl, httpStatus: 404 }).required, false);
  assert.equal(detectAuthRequired({ finalUrl, httpStatus: 500 }).required, false);
});

test('chỉ nhận diện path login trên http và https', () => {
  assert.equal(isLoginUrl('ftp://hust.edu.vn/login', DEFAULT_LOGIN_PATH_SEGMENTS), false);
  assert.equal(isLoginUrl('khong-phai-url', DEFAULT_LOGIN_PATH_SEGMENTS), false);
  assert.equal(isLoginUrl(null, DEFAULT_LOGIN_PATH_SEGMENTS), false);
});

test('path login khớp theo segment và không phân biệt hoa thường', () => {
  assert.equal(isLoginUrl('https://hust.edu.vn/LOGIN', DEFAULT_LOGIN_PATH_SEGMENTS), true);
  assert.equal(
    isLoginUrl('https://hust.edu.vn/tin-tuc/%6Cogin', DEFAULT_LOGIN_PATH_SEGMENTS),
    true,
  );
  assert.equal(
    isLoginUrl('https://hust.edu.vn/tin-tuc/login-moi', DEFAULT_LOGIN_PATH_SEGMENTS),
    false,
  );
});

test('cấu hình segment login thay thế được danh sách mặc định', () => {
  assert.equal(
    detectAuthRequired({
      finalUrl: 'https://hust.edu.vn/xac-thuc',
      httpStatus: 200,
      loginPathSegments: ['xac-thuc'],
    }).required,
    true,
  );
  assert.equal(
    detectAuthRequired({
      finalUrl: 'https://hust.edu.vn/login',
      httpStatus: 200,
      loginPathSegments: ['xac-thuc'],
    }).required,
    false,
  );
  assert.equal(
    detectAuthRequired({
      finalUrl: 'https://hust.edu.vn/login',
      httpStatus: 200,
      loginPathSegments: [],
    }).required,
    false,
  );
});

test('normalizeSegment bỏ đuôi trang và giải mã percent-encoding', () => {
  assert.equal(normalizeSegment('LOGIN.HTML'), 'login');
  assert.equal(normalizeSegment('dang%2Dnhap'), 'dang-nhap');
  assert.equal(normalizeSegment('%E0%A4%A'), '%e0%a4%a');
});
