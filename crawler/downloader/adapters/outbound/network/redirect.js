'use strict';

const REDIRECT_STATUSES = Object.freeze(new Set([301, 302, 303, 307, 308]));

function isRedirectStatus(status) {
  return REDIRECT_STATUSES.has(status);
}

function resolveRedirectUrl(location, baseUrl) {
  return new URL(location, baseUrl).toString();
}

module.exports = { REDIRECT_STATUSES, isRedirectStatus, resolveRedirectUrl };
