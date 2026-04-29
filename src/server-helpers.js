/* NEXUS PRO — pure server-side helpers.
   Extracted from server.js so the parts that don't touch I/O can be
   unit-tested without booting Express + the data-refresh loops. */

'use strict';

const { timingSafeEqual } = require('node:crypto');
const dns = require('node:dns');
const https = require('node:https');

/* ─── upstream allowlist ─────────────────────────────────────────── */

/* The only hosts safeFetch() is allowed to talk to. Anything else is
   blocked at the URL-parse stage so a compromised symbol or argument
   can't redirect the request elsewhere. */
const FETCH_HOST_ALLOWLIST = new Set([
  'api.binance.com',
  'fapi.binance.com',
  'api.bybit.com',
  'api.coingecko.com',
  'api.coinbase.com',
  'api.alternative.me',
]);

function isAllowedFetchUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false; /* defeat user-info smuggling */
  return FETCH_HOST_ALLOWLIST.has(u.hostname);
}

/* ─── private-IP detection (DNS rebinding mitigation) ────────────── */

/* RFC1918 + loopback + link-local + carrier-grade NAT for IPv4. */
function isPrivateIPv4(ip) {
  if (typeof ip !== 'string') return false;
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1],
    b = +m[2];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true /* CGNAT */;
  if (a === 0) return true /* "this network" */;
  return false;
}

/* Loopback (::1), unique-local (fc00::/7), link-local (fe80::/10),
   IPv4-mapped (::ffff:a.b.c.d), and the IPv4-compatible (::a.b.c.d). */
function isPrivateIPv6(ip) {
  if (typeof ip !== 'string') return false;
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9')) return true;
  if (lower.startsWith('fea') || lower.startsWith('feb')) return true;
  /* IPv4-mapped: ::ffff:a.b.c.d  →  delegate to v4 check */
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  /* IPv4-compatible (deprecated, still routable on some stacks). */
  const compat = lower.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (compat) return isPrivateIPv4(compat[1]);
  return false;
}

function isPrivateAddress(addr, family) {
  return family === 6 ? isPrivateIPv6(addr) : isPrivateIPv4(addr);
}

/* https.Agent that re-runs the DNS lookup at connect time and refuses
   any address that resolves into a private range. Defeats the DNS-
   rebinding window between URL parse and TCP connect. */
function createSafeAgent() {
  return new https.Agent({
    keepAlive: true,
    lookup(hostname, opts, cb) {
      dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return cb(err);
        if (Array.isArray(address)) {
          /* When `all: true` is requested by the caller. */
          const filtered = address.filter((a) => !isPrivateAddress(a.address, a.family));
          if (filtered.length === 0) {
            return cb(new Error('blocked: hostname resolved only to private addresses'));
          }
          return cb(null, filtered);
        }
        if (isPrivateAddress(address, family)) {
          return cb(new Error('blocked: hostname resolved to a private address'));
        }
        cb(null, address, family);
      });
    },
  });
}

/* ─── Telegram HTML sanitiser ────────────────────────────────────── */

/* Telegram's HTML mode accepts a small subset of tags. We escape
   everything to defeat the parser, then re-enable a known-safe
   allowlist in a single pass — no per-tag regex compile, no risk
   of round-tripping a literal user-typed `&lt;b&gt;`. */
const TG_TAG_ALLOWLIST = /&lt;(\/?)(b|strong|i|em|u|s|code|pre)&gt;/gi;
const TG_MAX_LEN = 4000;

function sanitizeTelegramHtml(raw) {
  if (typeof raw !== 'string') return '';
  const input = raw.slice(0, TG_MAX_LEN);
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped.replace(TG_TAG_ALLOWLIST, (_, slash, tag) => '<' + slash + tag + '>');
}

/* ─── constant-time secret compare ───────────────────────────────── */

/* Wrap crypto.timingSafeEqual so callers don't have to deal with the
   length-mismatch throw, and so non-string inputs produce false. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

module.exports = {
  FETCH_HOST_ALLOWLIST,
  isAllowedFetchUrl,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateAddress,
  createSafeAgent,
  sanitizeTelegramHtml,
  safeEqual,
};
