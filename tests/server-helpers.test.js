/* Unit tests for src/server-helpers.js. These cover the parts of
   server.js that don't require a live HTTP server: URL allowlist,
   Telegram HTML sanitiser, private-IP detection (DNS rebinding
   mitigation), and constant-time secret compare. */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedFetchUrl,
  isPrivateIPv4,
  isPrivateIPv6,
  isPrivateAddress,
  sanitizeTelegramHtml,
  safeEqual,
  chunk,
} = require('../src/server-helpers');

/* ─── isAllowedFetchUrl ───────────────────────────────────────────── */

test('isAllowedFetchUrl — accepts each upstream we actually use', () => {
  assert.equal(isAllowedFetchUrl('https://api.binance.com/api/v3/ticker/24hr'), true);
  assert.equal(isAllowedFetchUrl('https://fapi.binance.com/fapi/v1/premiumIndex'), true);
  assert.equal(isAllowedFetchUrl('https://api.bybit.com/v5/market/tickers'), true);
  assert.equal(isAllowedFetchUrl('https://www.okx.com/api/v5/public/funding-rate'), true);
  assert.equal(isAllowedFetchUrl('https://api.coingecko.com/api/v3/global'), true);
  assert.equal(isAllowedFetchUrl('https://api.coinbase.com/v2/prices'), true);
  assert.equal(isAllowedFetchUrl('https://api.alternative.me/fng'), true);
  assert.equal(
    isAllowedFetchUrl('https://api-pub.bitfinex.com/v2/stats1/pos.size:1m:tBTCUSD:long/last'),
    true
  );
  assert.equal(isAllowedFetchUrl('https://api.hyperliquid.xyz/info'), true);
  assert.equal(isAllowedFetchUrl('https://cointelegraph.com/rss'), true);
});

test('isAllowedFetchUrl — rejects http:// (insecure)', () => {
  assert.equal(isAllowedFetchUrl('http://api.binance.com/'), false);
});

test('isAllowedFetchUrl — rejects unknown hosts', () => {
  assert.equal(isAllowedFetchUrl('https://internal.local/'), false);
  assert.equal(isAllowedFetchUrl('https://attacker.example.com/'), false);
  assert.equal(isAllowedFetchUrl('https://api.binance.com.attacker.com/'), false);
});

test('isAllowedFetchUrl — rejects user-info smuggling (basic-auth in URL)', () => {
  assert.equal(
    isAllowedFetchUrl('https://attacker:pw@api.binance.com/'),
    false,
    'user-info must not bypass the host allowlist'
  );
});

test('isAllowedFetchUrl — rejects malformed URLs', () => {
  assert.equal(isAllowedFetchUrl('not a url'), false);
  assert.equal(isAllowedFetchUrl(''), false);
  assert.equal(isAllowedFetchUrl(null), false);
});

/* ─── private-IP detection ────────────────────────────────────────── */

test('isPrivateIPv4 — RFC1918 + loopback + link-local + CGNAT', () => {
  assert.equal(isPrivateIPv4('10.0.0.1'), true);
  assert.equal(isPrivateIPv4('172.16.0.1'), true);
  assert.equal(isPrivateIPv4('172.31.255.255'), true);
  assert.equal(isPrivateIPv4('192.168.0.1'), true);
  assert.equal(isPrivateIPv4('127.0.0.1'), true);
  assert.equal(isPrivateIPv4('169.254.169.254'), true, 'AWS/GCP metadata service');
  assert.equal(isPrivateIPv4('100.64.0.1'), true, 'CGNAT');
  assert.equal(isPrivateIPv4('0.0.0.0'), true);
});

test('isPrivateIPv4 — public IPs return false', () => {
  assert.equal(isPrivateIPv4('8.8.8.8'), false);
  assert.equal(isPrivateIPv4('1.1.1.1'), false);
  assert.equal(isPrivateIPv4('172.15.0.1'), false, 'just outside the 172.16/12 block');
  assert.equal(isPrivateIPv4('172.32.0.1'), false, 'just past the 172.16/12 block');
});

test('isPrivateIPv4 — non-IPv4 input returns false', () => {
  assert.equal(isPrivateIPv4('::1'), false);
  assert.equal(isPrivateIPv4('not an ip'), false);
  assert.equal(isPrivateIPv4(''), false);
  assert.equal(isPrivateIPv4(null), false);
});

test('isPrivateIPv6 — loopback / unique-local / link-local', () => {
  assert.equal(isPrivateIPv6('::1'), true);
  assert.equal(isPrivateIPv6('::'), true);
  assert.equal(isPrivateIPv6('fc00::1'), true);
  assert.equal(isPrivateIPv6('fd12:3456::1'), true);
  assert.equal(isPrivateIPv6('fe80::1'), true);
  assert.equal(isPrivateIPv6('fea0::1'), true);
});

test('isPrivateIPv6 — IPv4-mapped delegates to v4 check', () => {
  assert.equal(isPrivateIPv6('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIPv6('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateIPv6('::ffff:8.8.8.8'), false);
});

test('isPrivateIPv6 — IPv4-compatible (deprecated) covered too', () => {
  assert.equal(isPrivateIPv6('::169.254.169.254'), true);
  assert.equal(isPrivateIPv6('::8.8.8.8'), false);
});

test('isPrivateIPv6 — public IPv6 returns false', () => {
  assert.equal(isPrivateIPv6('2001:4860:4860::8888'), false /* Google DNS */);
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false /* Cloudflare */);
});

test('isPrivateAddress — dispatches by family', () => {
  assert.equal(isPrivateAddress('10.0.0.1', 4), true);
  assert.equal(isPrivateAddress('::1', 6), true);
  assert.equal(isPrivateAddress('8.8.8.8', 4), false);
  assert.equal(isPrivateAddress('2001:4860:4860::8888', 6), false);
});

/* ─── sanitizeTelegramHtml ────────────────────────────────────────── */

test('sanitizeTelegramHtml — escapes <script> entirely', () => {
  const out = sanitizeTelegramHtml('<script>alert(1)</script>');
  assert.ok(!out.includes('<script'), 'opening tag must be escaped');
  assert.ok(!out.includes('</script'), 'closing tag must be escaped');
  assert.ok(out.includes('&lt;script'));
});

test('sanitizeTelegramHtml — keeps the allowlisted tag set', () => {
  const out = sanitizeTelegramHtml('<b>x</b><i>y</i><code>z</code><pre>w</pre>');
  assert.equal(out, '<b>x</b><i>y</i><code>z</code><pre>w</pre>');
});

test('sanitizeTelegramHtml — drops unknown tags (e.g. <a>) but keeps text', () => {
  const out = sanitizeTelegramHtml('<a href="x">link</a><b>ok</b>');
  /* The <a> stays escaped; <b>ok</b> survives. */
  assert.ok(!out.includes('<a '));
  assert.ok(out.includes('<b>ok</b>'));
});

test('sanitizeTelegramHtml — does NOT round-trip a literal user-typed escape (AUDIT-H3)', () => {
  /* Old per-tag-loop sanitizer would replace `&lt;b&gt;` → `<b>` even
     when the user typed those literal characters, defeating the
     escape. The new single-pass regex applies once to the escape
     output only. */
  const out = sanitizeTelegramHtml('user typed &lt;b&gt; literally');
  /* User's `&` was escaped to `&amp;`, so we should see `&amp;lt;b&amp;gt;` */
  assert.ok(out.includes('&amp;lt;b&amp;gt;'), 'literal user escape must survive');
  assert.ok(!out.includes('<b>'), 'user-typed text must not produce a real <b>');
});

test('sanitizeTelegramHtml — non-string input returns empty', () => {
  assert.equal(sanitizeTelegramHtml(null), '');
  assert.equal(sanitizeTelegramHtml(undefined), '');
  assert.equal(sanitizeTelegramHtml(42), '');
  assert.equal(sanitizeTelegramHtml({}), '');
});

test('sanitizeTelegramHtml — caps length at 4000 chars', () => {
  const big = 'x'.repeat(5000);
  const out = sanitizeTelegramHtml(big);
  assert.equal(out.length, 4000);
});

test('sanitizeTelegramHtml — quotes are escaped', () => {
  const out = sanitizeTelegramHtml(`"hello" 'world'`);
  assert.ok(out.includes('&quot;'));
  assert.ok(out.includes('&#39;'));
});

/* ─── safeEqual ───────────────────────────────────────────────────── */

test('safeEqual — equal strings return true', () => {
  assert.equal(safeEqual('hello', 'hello'), true);
  assert.equal(safeEqual('', ''), true);
});

test('safeEqual — unequal strings return false', () => {
  assert.equal(safeEqual('hello', 'world'), false);
  assert.equal(safeEqual('hello', 'helloo'), false);
  assert.equal(safeEqual('a', 'b'), false);
});

test('safeEqual — different-length inputs short-circuit to false', () => {
  /* This must not throw — crypto.timingSafeEqual itself throws on
     mismatched lengths, so the wrapper has to handle it. */
  assert.equal(safeEqual('short', 'a-much-longer-string'), false);
});

test('safeEqual — non-string inputs return false (no throw)', () => {
  assert.equal(safeEqual(null, 'x'), false);
  assert.equal(safeEqual('x', undefined), false);
  assert.equal(safeEqual(123, 123), false);
  assert.equal(safeEqual({}, {}), false);
  assert.equal(safeEqual(undefined, undefined), false);
});

test('safeEqual — handles UTF-8 multibyte correctly', () => {
  /* Old charCodeAt-based version compared code units; Buffer.from()
     compares bytes, which is what timingSafeEqual expects. Equivalent
     here for BMP characters but matters for surrogate pairs. */
  assert.equal(safeEqual('سرّ', 'سرّ'), true);
  assert.equal(safeEqual('🔑', '🔑'), true);
  assert.equal(safeEqual('🔑', '🔒'), false);
});

/* ─── chunk — sequential batching for upstream burst control (Bitfinex 429) ── */

test('chunk — splits into consecutive batches of at most `size`', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [
    [1, 2],
    [3, 4],
  ]);
});

test('chunk — size >= length returns a single batch', () => {
  assert.deepEqual(chunk([1, 2, 3], 10), [[1, 2, 3]]);
  assert.deepEqual(chunk([1, 2, 3], 3), [[1, 2, 3]]);
});

test('chunk — size 1 yields one element per batch', () => {
  assert.deepEqual(chunk(['a', 'b'], 1), [['a'], ['b']]);
});

test('chunk — covers every element exactly once, preserving order (the 10 BFX pairs)', () => {
  const arr = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(chunk(arr, 2).flat(), arr);
  assert.equal(chunk(arr, 2).length, 5); /* 10 pairs / 2 = 5 sequential batches */
});

test('chunk — bad input returns [] so the caller falls back to all-at-once', () => {
  assert.deepEqual(chunk([1, 2, 3], 0), []);
  assert.deepEqual(chunk([1, 2, 3], -1), []);
  assert.deepEqual(chunk([1, 2, 3], NaN), []);
  assert.deepEqual(chunk(null, 2), []);
  assert.deepEqual(chunk('nope', 2), []);
});

test('chunk — empty array yields no batches', () => {
  assert.deepEqual(chunk([], 2), []);
});
