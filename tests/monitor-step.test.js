/* Tests for src/monitor-step.js — pure decision helper for the
   trade-monitor exit logic.

   This file pins the CORRECTED behaviour after AUDIT-F1 (worst-case
   candle resolution) and AUDIT-F5 (SHORT-side support) landed. The
   helper accepts an observation `{ price, high, low }`; tests drive
   it with explicit candle bounds where the worst-case logic matters,
   and with bare numbers where it doesn't. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadScript } = require('./_setup.js');

loadScript('src/monitor-step.js');

/* Long baseline: entry=100, target1=105, target2=110, stop=95. */
function longTrade(overrides) {
  return Object.assign(
    {
      sym: 'BTC',
      type: 'LONG',
      entry: 100,
      target1: 105,
      target2: 110,
      stop: 95,
      t1Hit: false,
      trailingStop: 0,
      maxGain: 0,
      maxGainPrice: 0,
      pnl: 0,
      entryTime: Date.now(),
      marketAtEntry: { btc: 0 },
    },
    overrides || {}
  );
}

/* Short baseline: entry=100, target1=95, target2=90, stop=105. */
function shortTrade(overrides) {
  return Object.assign(
    {
      sym: 'BTC',
      type: 'SHORT',
      entry: 100,
      target1: 95,
      target2: 90,
      stop: 105,
      t1Hit: false,
      trailingStop: 0,
      maxGain: 0,
      maxGainPrice: 0,
      pnl: 0,
      entryTime: Date.now(),
      marketAtEntry: { btc: 0 },
    },
    overrides || {}
  );
}

/* Single-point observation helper — high == low == price (no candle
   bounds available). */
function tick(p) {
  return { price: p, high: p, low: p };
}

/* Candle observation — explicit high/low. */
function candle(p, hi, lo) {
  return { price: p, high: hi, low: lo };
}

const NOW = 1_700_000_000_000;

/* ─── LONG: no-op cases ──────────────────────────────────────────── */

test('LONG — price between stop and target1 → NONE', () => {
  const out = monitorTradeDecision(longTrade(), tick(102), 0, NOW);
  assert.equal(out.close, null);
  assert.equal(out.t1JustHit, false);
  assert.equal(out.newBreakevenStop, null);
});

test('LONG — accepts bare-number observation for backward compat', () => {
  /* Old call sites in app.js passed `d.p` (a number) directly; the
     helper still accepts that shape. */
  const out = monitorTradeDecision(longTrade(), 102, 0, NOW);
  assert.equal(out.close, null);
});

/* ─── LONG: target1 ──────────────────────────────────────────────── */

test('LONG — first cross of target1 sets t1JustHit + breakeven 1.005×entry', () => {
  const out = monitorTradeDecision(longTrade(), tick(105.5), 0, NOW);
  assert.equal(out.t1JustHit, true);
  assert.equal(out.newBreakevenStop, 100 * 1.005);
  assert.equal(out.close, null);
});

test('LONG — re-cross of target1 (already hit) does not re-fire', () => {
  const out = monitorTradeDecision(
    longTrade({ t1Hit: true, trailingStop: 100.5 }),
    tick(106),
    0,
    NOW
  );
  assert.equal(out.t1JustHit, false);
  assert.equal(out.newBreakevenStop, null);
});

/* ─── LONG: target2 ──────────────────────────────────────────────── */

test('LONG — target2 closes as TARGET_FULL', () => {
  const out = monitorTradeDecision(
    longTrade({ t1Hit: true, trailingStop: 100.5 }),
    tick(111),
    0,
    NOW
  );
  assert.equal(out.close, 'TARGET_FULL');
});

test('LONG — single observation through both T1 and T2 → t1JustHit + close', () => {
  const out = monitorTradeDecision(longTrade(), tick(115), 0, NOW);
  assert.equal(out.t1JustHit, true);
  assert.equal(out.newBreakevenStop, 100 * 1.005);
  assert.equal(out.close, 'TARGET_FULL');
});

/* ─── LONG: AUDIT-F1 worst-case candle ──────────────────────────── */

test('LONG — candle that wicks through STOP and TARGET2 closes as STOP_LOSS, not TARGET_FULL (AUDIT-F1)', () => {
  /* The audit's headline finding: a 10-second poll could see the
     candle settle above target2 even if the candle's low pierced the
     stop on the way through. Old behaviour credited TARGET_FULL.
     Fixed: when both would have hit, STOP wins. */
  const out = monitorTradeDecision(
    longTrade(),
    candle(/* settle */ 115, /* high */ 115, /* low */ 94),
    0,
    NOW
  );
  assert.equal(out.close, 'STOP_LOSS');
});

test('LONG — wick through stop only (target untouched) → STOP_LOSS', () => {
  const out = monitorTradeDecision(longTrade(), candle(98, 99, 94), 0, NOW);
  assert.equal(out.close, 'STOP_LOSS');
});

test('LONG — wick through target only (stop untouched) → TARGET_FULL', () => {
  const out = monitorTradeDecision(longTrade(), candle(108, 112, 98), 0, NOW);
  assert.equal(out.close, 'TARGET_FULL');
});

/* ─── LONG: trailing stop ────────────────────────────────────────── */

test('LONG — trailing fires when low drops 2 % from peak', () => {
  const out = monitorTradeDecision(
    longTrade({ t1Hit: true, trailingStop: 100.5, maxGain: 8, maxGainPrice: 108 }),
    /* trail = 108 * 0.98 = 105.84; low touches 105.5 */
    candle(106, 106.5, 105.5),
    0,
    NOW
  );
  assert.equal(out.close, 'TRAILING_STOP');
});

test('LONG — trailing does NOT fire while low stays above the trail', () => {
  const out = monitorTradeDecision(
    longTrade({ t1Hit: true, trailingStop: 100.5, maxGain: 8, maxGainPrice: 108 }),
    candle(106, 106.5, 106),
    0,
    NOW
  );
  assert.equal(out.close, null);
});

/* ─── LONG: stop loss / breakeven ────────────────────────────────── */

test('LONG — STOP_LOSS when no trailingStop has been set', () => {
  const out = monitorTradeDecision(longTrade(), tick(94), 0, NOW);
  assert.equal(out.close, 'STOP_LOSS');
});

test('LONG — BREAKEVEN_STOP once a trailing breakeven is in place', () => {
  const out = monitorTradeDecision(
    longTrade({ t1Hit: true, trailingStop: 100.5 }),
    tick(100.4),
    0,
    NOW
  );
  assert.equal(out.close, 'BREAKEVEN_STOP');
});

/* ─── LONG: timeout / market crash ───────────────────────────────── */

test('LONG — closes on TIMEOUT after 24 h', () => {
  const t = longTrade({ entryTime: NOW - 25 * 3600 * 1000 });
  const out = monitorTradeDecision(t, tick(100), 0, NOW);
  assert.equal(out.close, 'TIMEOUT');
});

test('LONG — closes on MARKET_CRASH when BTC drops > 5 %', () => {
  const t = longTrade({ marketAtEntry: { btc: 0 } });
  const out = monitorTradeDecision(t, tick(100), -5.1, NOW);
  assert.equal(out.close, 'MARKET_CRASH');
});

test('LONG — does NOT close on a 4 % BTC drop', () => {
  const t = longTrade({ marketAtEntry: { btc: 0 } });
  const out = monitorTradeDecision(t, tick(100), -4.9, NOW);
  assert.equal(out.close, null);
});

/* ─── SHORT side (AUDIT-F5) ──────────────────────────────────────── */

test('SHORT — entry tick is a no-op (was wrongly closed as TARGET_FULL before AUDIT-F5)', () => {
  /* The audit's most embarrassing finding: a SHORT trade plumbed
     through the long-only helper closed instantly with a fake win on
     the very first tick because `currentPrice >= tr.target2` fired
     (price=100 >= target2=90). Fixed: the helper inverts every
     comparator for SHORT trades. */
  const out = monitorTradeDecision(shortTrade(), tick(100), 0, NOW);
  assert.equal(out.close, null);
  assert.equal(out.t1JustHit, false);
});

test('SHORT — price drops to target1 marks t1JustHit + breakeven 0.995×entry', () => {
  const out = monitorTradeDecision(shortTrade(), tick(94.5), 0, NOW);
  assert.equal(out.t1JustHit, true);
  assert.equal(out.newBreakevenStop, 100 * 0.995);
  assert.equal(out.close, null);
});

test('SHORT — price drops to target2 closes as TARGET_FULL', () => {
  const out = monitorTradeDecision(shortTrade(), tick(89), 0, NOW);
  assert.equal(out.close, 'TARGET_FULL');
});

test('SHORT — price spikes through stop closes as STOP_LOSS', () => {
  const out = monitorTradeDecision(shortTrade(), tick(106), 0, NOW);
  assert.equal(out.close, 'STOP_LOSS');
});

test('SHORT — candle that wicks through both target and stop → STOP_LOSS (AUDIT-F1 short side)', () => {
  /* Settle below target2 (= win), but candle high pierced the stop.
     Worst-case: stop wins. */
  const out = monitorTradeDecision(shortTrade(), candle(89, 106, 88), 0, NOW);
  assert.equal(out.close, 'STOP_LOSS');
});

test('SHORT — trailing fires when high pierces 1.02×maxGainPrice from below', () => {
  /* SHORT trailing: maxGainPrice is the LOWEST price seen (most
     favourable). trail = maxGainPrice * 1.02. If candle high reaches
     that, the trail is hit. */
  const out = monitorTradeDecision(
    shortTrade({ t1Hit: true, trailingStop: 99.5, maxGain: 8, maxGainPrice: 92 }),
    /* trail = 92 * 1.02 = 93.84 */
    candle(93, 94, 92.5),
    0,
    NOW
  );
  assert.equal(out.close, 'TRAILING_STOP');
});

test('SHORT — BTC -5 % does NOT fire MARKET_CRASH (a short benefits)', () => {
  const out = monitorTradeDecision(shortTrade(), tick(100), -5.5, NOW);
  /* SHORTs profit from BTC weakness — the LONG-only crash exit
     is bypassed. */
  assert.equal(out.close, null);
});

test('SHORT — TIMEOUT still fires after 24 h', () => {
  const t = shortTrade({ entryTime: NOW - 25 * 3600 * 1000 });
  const out = monitorTradeDecision(t, tick(100), 0, NOW);
  assert.equal(out.close, 'TIMEOUT');
});
