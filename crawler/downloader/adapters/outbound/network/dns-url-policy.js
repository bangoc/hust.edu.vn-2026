'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const { InvalidUrlError } = require('../../../domain/errors/invalid-url-error');
const { BlockedHostError } = require('../../../domain/errors/blocked-host-error');
const { UrlKey } = require('../../../domain/value-objects/url-key');

const BLOCKED_HOSTNAMES = Object.freeze(
  new Set(['localhost', 'localhost.localdomain', 'metadata', 'metadata.google.internal']),
);

async function defaultResolveHost(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [first, second, third] = parts;

  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 100 && second >= 64 && second <= 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  if (first === 192 && second === 0 && third === 0) {
    return true;
  }
  if (first === 192 && second === 0 && third === 2) {
    return true;
  }
  if (first === 198 && (second === 18 || second === 19)) {
    return true;
  }
  if (first === 198 && second === 51 && third === 100) {
    return true;
  }
  if (first === 203 && second === 0 && third === 113) {
    return true;
  }
  if (first >= 224) {
    return true;
  }
  return false;
}

function ipv4FromMappedHex(tail) {
  const groups = tail.split(':').filter(Boolean);
  if (groups.length !== 2) {
    return null;
  }
  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) {
    return null;
  }
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function extractEmbeddedIpv4(address) {
  const lower = address.toLowerCase();
  const dottedMatch = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) {
    return dottedMatch[1];
  }

  const mappedIndex = lower.indexOf(':ffff:');
  if (mappedIndex !== -1) {
    return ipv4FromMappedHex(lower.slice(mappedIndex + ':ffff:'.length));
  }
  return null;
}

function isPrivateOrReservedAddress(address) {
  const normalizedAddress = String(address).replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(normalizedAddress);

  if (family === 4) {
    return isPrivateIpv4(normalizedAddress);
  }

  if (family !== 6) {
    return true;
  }

  const lower = normalizedAddress.toLowerCase();
  if (lower === '::' || lower === '::1') {
    return true;
  }
  if (/^fe[89ab]/.test(lower)) {
    return true;
  }
  if (/^f[cd]/.test(lower)) {
    return true;
  }
  if (/^ff/.test(lower)) {
    return true;
  }

  const embeddedIpv4 = extractEmbeddedIpv4(lower);
  if (embeddedIpv4) {
    return isPrivateIpv4(embeddedIpv4);
  }

  return false;
}

function normalizeAllowedDomains(allowedDomains) {
  return allowedDomains
    .map((domain) => String(domain).trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

function matchesAllowedDomain(hostname, allowedDomains) {
  if (allowedDomains.length === 0) {
    return true;
  }

  const normalizedHostname = hostname.toLowerCase();
  return allowedDomains.some(
    (domain) => normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`),
  );
}

class DnsUrlPolicy {
  constructor({
    resolveHost = defaultResolveHost,
    allowedDomains = [],
    allowPrivateHosts = false,
  } = {}) {
    this.resolveHost = resolveHost;
    this.allowedDomains = normalizeAllowedDomains(allowedDomains);
    this.allowPrivateHosts = Boolean(allowPrivateHosts);
  }

  normalize(rawUrl) {
    const urlKey = new UrlKey(rawUrl);
    return { normalizedUrl: urlKey.normalizedUrl, urlKey: urlKey.value };
  }

  async assertAllowed(url) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (cause) {
      throw new InvalidUrlError('URL không đúng định dạng', { cause });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new InvalidUrlError('Chỉ hỗ trợ URL http hoặc https');
    }
    if (!parsedUrl.hostname) {
      throw new InvalidUrlError('URL phải có hostname');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new InvalidUrlError('URL không được chứa thông tin đăng nhập');
    }

    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
      throw new BlockedHostError(`Host ${hostname} bị chặn`);
    }

    if (!matchesAllowedDomain(hostname, this.allowedDomains)) {
      throw new BlockedHostError(`Host ${hostname} không nằm trong danh sách cho phép`);
    }

    if (net.isIP(hostname)) {
      if (!this.allowPrivateHosts && isPrivateOrReservedAddress(hostname)) {
        throw new BlockedHostError(`Địa chỉ ${hostname} là địa chỉ nội bộ hoặc dành riêng`);
      }
      return;
    }

    let resolvedAddresses;
    try {
      resolvedAddresses = await this.resolveHost(hostname);
    } catch (cause) {
      throw new BlockedHostError(`Không thể phân giải host ${hostname}`, { cause });
    }

    if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
      throw new BlockedHostError(`Không thể phân giải host ${hostname}`);
    }

    if (
      !this.allowPrivateHosts &&
      resolvedAddresses.some(({ address }) => isPrivateOrReservedAddress(address))
    ) {
      throw new BlockedHostError(`Host ${hostname} trỏ tới địa chỉ nội bộ hoặc dành riêng`);
    }
  }
}

module.exports = {
  DnsUrlPolicy,
  defaultResolveHost,
  isPrivateIpv4,
  isPrivateOrReservedAddress,
  normalizeAllowedDomains,
  matchesAllowedDomain,
};
