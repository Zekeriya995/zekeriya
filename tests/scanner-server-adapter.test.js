/* Phase 2.A.2 — server-signal adapter contract.
 *
 * The adapter is the bridge between the server's signal payload
 * (output of scoreSymbol) and the client's signal shape
 * (output of deepAnalyze). The renderer's defensive checks already
 * cover missing enrichment, so the adapter is "correct" when each
 * mapping below passes — no need to assert every field-by-field.
 *
 * Implements: SCANNER_AUDIT_2026_05_15.md §6 P2.A.2 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./_setup.js');

/* ─── Input fixtures ─────────────────────────────────────────────── */

function baseServerSig(over) {
  const sig = {
    s: 'BTC',
    score: 105.5,
    tags: ['📗BID:2.3x', '🔥MEGA_VOL', '📉RSI_OS'],
    tier: 'ULTRA',
    direction: 'BULLISH',
    price: 100000,
    change: 2.5,
    volume: 5e8,
    manipulationRisk: { verdict: 'LOW' },
    sl: 97000,
    tp1: 105000,
    tp2: 110000,
    rr: 1.67,
    ts: 1700000000000,
  };
  if (over) Object.assign(sig, over);
  return sig;
}

/* ─── null-input handling ────────────────────────────────────────── */

test('adapter — null / non-object / missing symbol returns null', () => {
  assert.equal(adaptServerSignalToClient(null), null);
  assert.equal(adaptServerSignalToClient(undefined), null);
  assert.equal(adaptServerSignalToClient(42), null);
  assert.equal(adaptServerSignalToClient({}), null);
  assert.equal(adaptServerSignalToClient({ score: 100 }), null);
});

/* ─── source tag is always present, no duplicates ────────────────── */

test('adapter — appends 📡SRC_SERVER tag exactly once', () => {
  const out = adaptServerSignalToClient(baseServerSig());
  const occurrences = out.tags.filter((t) => t === SRC_SERVER_TAG).length;
  assert.equal(occurrences, 1);
});

test('adapter — re-adapting an already-adapted signal does not duplicate the source tag', () => {
  const first = adaptServerSignalToClient(baseServerSig());
  const second = adaptServerSignalToClient({ ...baseServerSig(), tags: first.tags });
  const occurrences = second.tags.filter((t) => t === SRC_SERVER_TAG).length;
  assert.equal(occurrences, 1);
});

/* ─── shape parity with deepAnalyze output ───────────────────────── */

test('adapter — preserves server fields the UI reads (score / tier / price / change / volume)', () => {
  const out = adaptServerSignalToClient(baseServerSig());
  assert.equal(out.s, 'BTC');
  assert.equal(out.score, 105.5);
  assert.equal(out.tier, 'ULTRA');
  assert.equal(out.p, 100000);
  assert.equal(out.c, 2.5);
  assert.equal(out.v, 5e8);
});

test('adapter — ultra flag matches ULTRA tier; confirmed covers STRONG too', () => {
  assert.equal(adaptServerSignalToClient(baseServerSig({ tier: 'ULTRA' })).ultra, true);
  assert.equal(adaptServerSignalToClient(baseServerSig({ tier: 'STRONG' })).ultra, false);
  assert.equal(adaptServerSignalToClient(baseServerSig({ tier: 'STRONG' })).confirmed, true);
  assert.equal(adaptServerSignalToClient(baseServerSig({ tier: 'MEDIUM' })).confirmed, false);
});

test('adapter — when MANIP_HARD_CAP demotes server tier to STRONG, ultra is false', () => {
  /* Simulates the audit §2.4 hard-cap path: scoreSymbol pushed
     '🚫MANIP_CAP' and set tier='STRONG' even though score is >=100. */
  const sig = baseServerSig({ tier: 'STRONG', score: 105, tags: ['🚫MANIP_CAP'] });
  const out = adaptServerSignalToClient(sig);
  assert.equal(out.ultra, false);
  assert.equal(out.confirmed, true);
});

/* ─── smartEntry mapping (Phase 2.A.4 ATR zones flow through) ────── */

test('adapter — smartEntry mirrors server sl/tp1/tp2/rr when present', () => {
  const out = adaptServerSignalToClient(baseServerSig());
  assert.equal(out.smartEntry.entry, 100000);
  assert.equal(out.smartEntry.stop, 97000);
  assert.equal(out.smartEntry.target1, 105000);
  assert.equal(out.smartEntry.target2, 110000);
  assert.equal(out.smartEntry.rr, '1.67');
});

test('adapter — smartEntry is null when server has no SL (cold ATR + no fallback)', () => {
  const out = adaptServerSignalToClient(baseServerSig({ sl: null }));
  assert.equal(out.smartEntry, null);
});

test('adapter — smartEntry is null when price is missing', () => {
  const out = adaptServerSignalToClient(baseServerSig({ price: 0 }));
  assert.equal(out.smartEntry, null);
});

/* ─── checks{} inference from tag patterns ───────────────────────── */

test('adapter — checks inferred from BID/VOL/RSI/OI tags', () => {
  const out = adaptServerSignalToClient(
    baseServerSig({ tags: ['📗BID:2x', '🔥MEGA_VOL', '📉RSI_OS', '🌐OI', 'noise'] })
  );
  assert.equal(out.checks.ob, true);
  assert.equal(out.checks.vol, true);
  assert.equal(out.checks.rsi, true);
  assert.equal(out.checks.oi, true);
  assert.equal(out.passed, 4);
});

test('adapter — no matching tags ⇒ all checks false, passed=0', () => {
  const out = adaptServerSignalToClient(baseServerSig({ tags: ['📈RISING', '⚠️LATE'] }));
  assert.deepEqual(out.checks, { ob: false, vol: false, rsi: false, oi: false });
  assert.equal(out.passed, 0);
});

/* ─── pdFlags extraction (qualityFilterRejectReason reads this) ──── */

test('adapter — pdFlags 0 when no P&D tag', () => {
  assert.equal(adaptServerSignalToClient(baseServerSig()).pdFlags, 0);
});

test('adapter — pdFlags parses the N from "🚨P&D_RISK:N/5"', () => {
  const out = adaptServerSignalToClient(baseServerSig({ tags: ['🚨P&D_RISK:3/5'] }));
  assert.equal(out.pdFlags, 3);
});

test('adapter — pdFlags parses N from the WARN variant too', () => {
  const out = adaptServerSignalToClient(baseServerSig({ tags: ['⚠️P&D_WARN:2/5'] }));
  assert.equal(out.pdFlags, 2);
});

/* ─── freshness / age (deterministic via ctx.now) ────────────────── */

test('adapter — no sigInfo ⇒ fresh, age=0', () => {
  const out = adaptServerSignalToClient(baseServerSig(), { now: 1700000000000 });
  assert.equal(out.freshness, 'fresh');
  assert.equal(out.ageMinutes, 0);
  assert.equal(out.changeFromDetection, 0);
});

test('adapter — 30-minute-old detection at +3% price ⇒ warm', () => {
  const now = 1700000000000;
  const sigInfo = { firstSeen: now - 30 * 60 * 1000, priceAtDetection: 97000 };
  const out = adaptServerSignalToClient(baseServerSig({ price: 100000 }), { now, sigInfo });
  assert.equal(out.ageMinutes, 30);
  assert.ok(Math.abs(out.changeFromDetection - ((100000 - 97000) / 97000) * 100) < 1e-9);
  assert.equal(out.freshness, 'warm');
});

test('adapter — 90-minute-old detection ⇒ old regardless of price', () => {
  const now = 1700000000000;
  const sigInfo = { firstSeen: now - 90 * 60 * 1000, priceAtDetection: 100000 };
  const out = adaptServerSignalToClient(baseServerSig({ price: 100000 }), { now, sigInfo });
  assert.equal(out.ageMinutes, 90);
  assert.equal(out.freshness, 'old');
});

test('adapter — >5% price drift ⇒ old even when ageMinutes is tiny', () => {
  const now = 1700000000000;
  const sigInfo = { firstSeen: now - 2 * 60 * 1000, priceAtDetection: 90000 };
  const out = adaptServerSignalToClient(baseServerSig({ price: 100000 }), { now, sigInfo });
  assert.equal(out.ageMinutes, 2);
  assert.ok(out.changeFromDetection > 5);
  assert.equal(out.freshness, 'old');
});

/* ─── local cache filler (whale / fr / cb / by / proven) ─────────── */

test('adapter — whaleConf + waveCount pulled from ctx.whaleWave', () => {
  const ctx = {
    whaleWave: { engine: { confidence: 75 }, waves: [{}, {}, {}] },
  };
  const out = adaptServerSignalToClient(baseServerSig(), ctx);
  assert.equal(out.whaleConf, 75);
  assert.equal(out.waveCount, 3);
});

test('adapter — fr / cb / proven default to safe values when ctx is empty', () => {
  const out = adaptServerSignalToClient(baseServerSig());
  assert.equal(out.fr, null);
  assert.equal(out.cb, null);
  assert.equal(out.proven, false);
  assert.equal(out.coinWinRate, 0);
});

test('adapter — provenStatus { proven, rate } flows through', () => {
  const out = adaptServerSignalToClient(baseServerSig(), {
    provenStatus: { proven: true, rate: 72 },
  });
  assert.equal(out.proven, true);
  assert.equal(out.coinWinRate, 72);
});

/* ─── ticker-fallback path ───────────────────────────────────────── */

test('adapter — when server omits price/change/volume, ticker fills in', () => {
  const sig = baseServerSig({ price: null, change: null, volume: null });
  const ctx = { ticker: { p: 50000, c: 1.2, v: 1e9 } };
  const out = adaptServerSignalToClient(sig, ctx);
  assert.equal(out.p, 50000);
  assert.equal(out.c, 1.2);
  assert.equal(out.v, 1e9);
});

/* ─── _src field marks origin for telemetry / debug ──────────────── */

test('adapter — sets _src = "server" for downstream telemetry', () => {
  assert.equal(adaptServerSignalToClient(baseServerSig())._src, 'server');
});

/* ─── qualityFilterRejectReason contract — adapter output passes ── */

test('adapter — adapter output is compatible with qualityFilterRejectReason', () => {
  /* Build a healthy signal: change < 5, passed >= 4, smartEntry.rr >= 2,
     no PD, no btc-crash. qualityFilterRejectReason should return null. */
  const sig = baseServerSig({
    change: 1.2,
    tags: ['📗BID:2x', '🔥MEGA_VOL', '📉RSI_OS', '🌐OI'],
    sl: 97000,
    tp1: 106000,
    tp2: 110000,
    rr: 3.0,
  });
  const out = adaptServerSignalToClient(sig);
  const reason = qualityFilterRejectReason(out, {
    fr: { rate: 0.01 },
    btc: { c: 0.5 },
    priceAtDetection: 0,
  });
  assert.equal(reason, null);
});

test('adapter — qualityFilterRejectReason rejects an adapted P&D-flagged signal', () => {
  const sig = baseServerSig({
    change: 1,
    tags: ['📗BID:2x', '🔥MEGA_VOL', '📉RSI_OS', '🌐OI', '🚨P&D_RISK:3/5'],
    rr: 3.0,
  });
  const out = adaptServerSignalToClient(sig);
  const reason = qualityFilterRejectReason(out, {
    fr: { rate: 0.01 },
    btc: { c: 0.5 },
    priceAtDetection: 0,
  });
  assert.equal(reason, 'pd');
});
