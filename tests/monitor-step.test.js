/* Tests for src/monitor-step.js — the pure decision helper that wraps
   the trade-monitor exit logic from app.js.

   These tests pin down the CURRENT (faithful) behaviour of the helper.
   Two audit findings are deliberately documented as-is and updated
   alongside the fix that lands in src/monitor-step.js:

     AUDIT-F1   tp/sl resolution is single-price; a candle that wicks
                through the stop first but observed at a price above
                target2 still credits TARGET_FULL.
     AUDIT-F5   long-only assumptions: a SHORT trade plumbed through
                this helper would close immediately on its stop. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadScript } = require('./_setup.js');

loadScript('src/monitor-step.js');

/* Build a baseline LONG trade. Entry=100, target1=105, target2=110,
   stop=95. Caller pre-fills maxGain etc. */
function trade(overrides) {
  return Object.assign(
    {
      sym: 'BTC',
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

const NOW = 1_700_000_000_000;

/* ─── no-op cases ─────────────────────────────────────────────────── */

test('monitorTradeDecision — price between stop and target1 → NONE', () => {
  const out = monitorTradeDecision(trade(), 102, 0, NOW);
  assert.equal(out.close, null);
  assert.equal(out.t1JustHit, false);
  assert.equal(out.newBreakevenStop, null);
});

test('monitorTradeDecision — exactly at entry is a no-op', () => {
  const out = monitorTradeDecision(trade(), 100, 0, NOW);
  assert.equal(out.close, null);
});

/* ─── target1 ─────────────────────────────────────────────────────── */

test('monitorTradeDecision — first cross of target1 sets t1JustHit + breakeven stop', () => {
  const out = monitorTradeDecision(trade(), 105.5, 0, NOW);
  assert.equal(out.t1JustHit, true);
  assert.equal(out.newBreakevenStop, 100 * 1.005);
  assert.equal(out.close, null, 'T1 alone is not a close');
});

test('monitorTradeDecision — re-cross of target1 (already hit) does not re-fire', () => {
  const out = monitorTradeDecision(trade({ t1Hit: true, trailingStop: 100.5 }), 106, 0, NOW);
  assert.equal(out.t1JustHit, false);
  assert.equal(out.newBreakevenStop, null);
});

/* ─── target2 (full target) ───────────────────────────────────────── */

test('monitorTradeDecision — target2 closes as TARGET_FULL', () => {
  const out = monitorTradeDecision(trade({ t1Hit: true, trailingStop: 100.5 }), 111, 0, NOW);
  assert.equal(out.close, 'TARGET_FULL');
});

test('monitorTradeDecision — single observation through both T1 and T2 → t1JustHit + close', () => {
  const out = monitorTradeDecision(trade(), 115, 0, NOW);
  assert.equal(out.t1JustHit, true, 'T1 mutation must still propagate');
  assert.equal(out.newBreakevenStop, 100 * 1.005);
  assert.equal(out.close, 'TARGET_FULL');
});

/* ─── trailing stop ───────────────────────────────────────────────── */

test('monitorTradeDecision — trailing only fires after T1 hit + maxGain > 3', () => {
  /* T1 not hit yet → trailing should not engage even if price is below
     0.98 × maxGainPrice. */
  const out = monitorTradeDecision(
    trade({ t1Hit: false, maxGain: 5, maxGainPrice: 110 }),
    100,
    0,
    NOW
  );
  assert.equal(out.close, null);
});

test('monitorTradeDecision — trailing fires when price drops 2 % from peak', () => {
  const out = monitorTradeDecision(
    trade({ t1Hit: true, trailingStop: 100.5, maxGain: 8, maxGainPrice: 108 }),
    /* trail = 108 * 0.98 = 105.84 */
    105.5,
    0,
    NOW
  );
  assert.equal(out.close, 'TRAILING_STOP');
});

test('monitorTradeDecision — trailing does NOT fire while price is above the trail', () => {
  const out = monitorTradeDecision(
    trade({ t1Hit: true, trailingStop: 100.5, maxGain: 8, maxGainPrice: 108 }),
    106,
    0,
    NOW
  );
  assert.equal(out.close, null);
});

/* ─── stop loss / breakeven stop ──────────────────────────────────── */

test('monitorTradeDecision — STOP_LOSS when no trailingStop has been set', () => {
  const out = monitorTradeDecision(trade(), 94, 0, NOW);
  assert.equal(out.close, 'STOP_LOSS');
});

test('monitorTradeDecision — BREAKEVEN_STOP once a trailing breakeven is in place', () => {
  /* Trailing = 100.5 (entry * 1.005). Price below it → breakeven exit. */
  const out = monitorTradeDecision(trade({ t1Hit: true, trailingStop: 100.5 }), 100.4, 0, NOW);
  assert.equal(out.close, 'BREAKEVEN_STOP');
});

test('monitorTradeDecision — first observation that crosses target1 AND falls to stop on the same candle: TODAY: TARGET_FULL credited (AUDIT-F1)', () => {
  /* CURRENT BEHAVIOUR — single price observation. We pass a price >= target2
     and the helper credits the win even though a real candle could have
     wicked through `stop` first. The fix takes (high, low) and prefers
     STOP when both would have hit. */
  const out = monitorTradeDecision(trade(), 115, 0, NOW);
  assert.equal(out.close, 'TARGET_FULL', 'today: target wins regardless of wick');
});

/* ─── timeout ─────────────────────────────────────────────────────── */

test('monitorTradeDecision — closes on TIMEOUT after 24 h', () => {
  const t = trade({ entryTime: NOW - 25 * 3600 * 1000 });
  const out = monitorTradeDecision(t, 100, 0, NOW);
  assert.equal(out.close, 'TIMEOUT');
});

test('monitorTradeDecision — does NOT timeout under 24 h', () => {
  const t = trade({ entryTime: NOW - 23 * 3600 * 1000 });
  const out = monitorTradeDecision(t, 100, 0, NOW);
  assert.equal(out.close, null);
});

/* ─── BTC market crash ───────────────────────────────────────────── */

test('monitorTradeDecision — closes on MARKET_CRASH when BTC drops > 5 %', () => {
  const t = trade({ marketAtEntry: { btc: 0 } });
  const out = monitorTradeDecision(t, 100, -5.1, NOW);
  assert.equal(out.close, 'MARKET_CRASH');
});

test('monitorTradeDecision — does NOT close on a 4 % BTC drop', () => {
  const t = trade({ marketAtEntry: { btc: 0 } });
  const out = monitorTradeDecision(t, 100, -4.9, NOW);
  assert.equal(out.close, null);
});

test('monitorTradeDecision — measures crash relative to entry market', () => {
  /* Entered when BTC was already +3 %. A drop to -2 % is only -5 from
     entry, which equals the threshold, NOT below it → no close. */
  const t = trade({ marketAtEntry: { btc: 3 } });
  const noClose = monitorTradeDecision(t, 100, -2, NOW);
  assert.equal(noClose.close, null);
  /* But -2.5 from entry-3 = -5.5 → close. */
  const close = monitorTradeDecision(t, 100, -2.5, NOW);
  assert.equal(close.close, 'MARKET_CRASH');
});

/* ─── SHORT side (audit F5) ───────────────────────────────────────── */

test('monitorTradeDecision — TODAY: SHORT trade is mis-credited on the very first tick (AUDIT-F5)', () => {
  /* A SHORT entry of 100 with target=90, stop=110, plumbed through the
     long-only helper:
       - `currentPrice >= tr.target2` is `100 >= 90` → true
     So the helper returns `TARGET_FULL` immediately — a phantom win
     handed to the user before the trade has moved at all. Even worse
     than the "instant stop" the audit predicted. The fix branches on
     `tr.type` and inverts comparators for SHORT. */
  const shortTrade = trade({
    type: 'SHORT',
    entry: 100,
    target1: 95,
    target2: 90,
    stop: 110,
  });
  const out = monitorTradeDecision(shortTrade, 100, 0, NOW);
  assert.equal(out.close, 'TARGET_FULL', 'today: a SHORT closes as a win on entry tick');
  assert.equal(out.t1JustHit, true, 'and t1 is also marked, double-credited');
});
