/* Tests for src/portfolio.js — recSig (signal aging), getSigTime,
   savePred, and the rolling accuracy report from getAcc().

   addPort/rmPort/renderPort are intentionally out of scope: they
   touch the DOM and are exercised at the integration layer.

   Two known issues from the audit are documented (search for AUDIT-F):

     - F2: getAcc() rescores predictions against TODAY's price every
           reload, so historical accuracy silently shifts.
     - "recSig resets priceAtDetection after a 1 h quiet period" — the
       drift gate in qualityFilterRejectReason relies on this never
       being overwritten. Pinned below. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadScript } = require('./_setup.js');

/* portfolio.js reads T (price ticker) at call time. */
globalThis.T = {};
/* DOM stubs — addPort / rmPort / renderPort are not exercised here, but
   the module body references `document` and `closeMo` at load time only
   inside function bodies, so we stub minimally to be safe. */
globalThis.document = {
  getElementById: () => ({ value: '', textContent: '', style: {}, innerHTML: '' }),
};
globalThis.COL = {};
globalThis.t = (k) => k;
globalThis.closeMo = () => {};
loadScript('src/portfolio.js');

function reset() {
  predictions.length = 0;
  for (const k of Object.keys(sigHist)) delete sigHist[k];
  for (const k of Object.keys(globalThis.T)) delete globalThis.T[k];
}

/* ─── recSig + getSigTime ─────────────────────────────────────────── */

test('recSig — fresh entry stores firstSeen, lastSeen, priceAtDetection, count=1', () => {
  reset();
  const before = Date.now();
  const e = recSig('BTC', 'breakout', 50000);
  const after = Date.now();
  assert.ok(e.firstSeen >= before && e.firstSeen <= after);
  assert.equal(e.priceAtDetection, 50000);
  assert.equal(e.count, 1);
});

test('recSig — within 1 h: increments count and updates lastSeen, keeps priceAtDetection', () => {
  reset();
  const e1 = recSig('BTC', 'breakout', 50000);
  /* Force lastSeen back 30 minutes so we exercise the "active" branch. */
  e1.lastSeen = Date.now() - 30 * 60 * 1000;
  sigHist['BTC_breakout'] = e1;
  const e2 = recSig('BTC', 'breakout', 60000); /* price arg ignored on update */
  assert.equal(e2.firstSeen, e1.firstSeen, 'firstSeen must not move during active window');
  assert.equal(e2.priceAtDetection, 50000, 'priceAtDetection must persist during active window');
  assert.equal(e2.count, 2);
});

test('recSig — quiet for >1 h resets the entry (AUDIT: drift gate impact)', () => {
  /* Documents current behaviour: priceAtDetection is overwritten with
     the new price after a 1 h gap. The qualityFilter drift gate reads
     this field, so it can never fire after a 1 h dormancy. The fix
     (preserve original detection price across resets) updates this
     test alongside the source change. */
  reset();
  const e1 = recSig('BTC', 'breakout', 50000);
  e1.lastSeen = Date.now() - 60 * 60 * 1000 - 1000; /* >1 h ago */
  sigHist['BTC_breakout'] = e1;
  const e2 = recSig('BTC', 'breakout', 70000);
  assert.equal(e2.priceAtDetection, 70000, 'TODAY: detection price is overwritten');
  assert.equal(e2.count, 1, 'reset path resets count too');
  assert.equal(
    e2.firstSeen,
    e2.lastSeen,
    'reset path stamps firstSeen and lastSeen to the same now()'
  );
});

test('recSig — migrates legacy numeric entry into the rich shape', () => {
  reset();
  const legacy = Date.now() - 10 * 60 * 1000;
  sigHist['BTC_breakout'] = legacy;
  const e = recSig('BTC', 'breakout', 50000);
  assert.equal(typeof e, 'object');
  assert.equal(e.firstSeen, legacy);
  assert.equal(e.count, 2, 'after migration the new sighting bumps count to 2');
});

test('getSigTime — falls back to now() for an unknown signal', () => {
  reset();
  const before = Date.now();
  const t1 = getSigTime('BTC', 'breakout');
  const after = Date.now();
  assert.ok(t1 >= before && t1 <= after);
});

test('getSigTime — returns numeric legacy value as-is', () => {
  reset();
  sigHist['BTC_breakout'] = 12345;
  assert.equal(getSigTime('BTC', 'breakout'), 12345);
});

test('getSigTime — returns firstSeen of a rich entry', () => {
  reset();
  sigHist['BTC_breakout'] = { firstSeen: 9999, lastSeen: 1, priceAtDetection: 0, count: 1 };
  assert.equal(getSigTime('BTC', 'breakout'), 9999);
});

/* ─── savePred + getAcc ───────────────────────────────────────────── */

test('savePred — pushes a prediction with checked=false, hit=false, partial=false', () => {
  reset();
  savePred('BTC', 100, 110, 7);
  assert.equal(predictions.length, 1);
  const p = predictions[0];
  assert.equal(p.sym, 'BTC');
  assert.equal(p.price, 100);
  assert.equal(p.target, 110);
  assert.equal(p.score, 7);
  assert.equal(p.checked, false);
  assert.equal(p.hit, false);
  assert.equal(p.partial, false);
});

test('savePred — caps the journal at 100 entries (rolling window)', () => {
  reset();
  for (let i = 0; i < 105; i++) savePred('SYM' + i, 1, 1, 1);
  assert.equal(predictions.length, 100);
  assert.equal(predictions[0].sym, 'SYM5', 'oldest 5 entries must be dropped');
  assert.equal(predictions[99].sym, 'SYM104');
});

test('getAcc — empty journal returns zero rate', () => {
  reset();
  assert.deepEqual(getAcc(), { total: 0, hits: 0, partials: 0, rate: 0 });
});

test('getAcc — does NOT score entries younger than 12 h', () => {
  reset();
  savePred('BTC', 100, 110, 7);
  globalThis.T.BTC = { p: 110 }; /* would otherwise hit */
  const r = getAcc();
  assert.equal(r.total, 0, 'a fresh prediction must not be marked checked yet');
  assert.equal(predictions[0].checked, false);
});

test('getAcc — gain ≥ 5 % counts as hit; 2-5 % as partial; <2 % as miss', () => {
  reset();
  /* All three predictions are >12 h old. */
  predictions.push(
    {
      sym: 'AAA',
      price: 100,
      target: 110,
      score: 7,
      time: 1,
      checked: false,
      hit: false,
      partial: false,
    },
    {
      sym: 'BBB',
      price: 100,
      target: 110,
      score: 7,
      time: 1,
      checked: false,
      hit: false,
      partial: false,
    },
    {
      sym: 'CCC',
      price: 100,
      target: 110,
      score: 7,
      time: 1,
      checked: false,
      hit: false,
      partial: false,
    }
  );
  globalThis.T.AAA = { p: 106 }; /* +6 % → hit */
  globalThis.T.BBB = { p: 103 }; /* +3 % → partial */
  globalThis.T.CCC = { p: 101 }; /* +1 % → miss */
  const r = getAcc();
  assert.equal(r.total, 3);
  assert.equal(r.hits, 1);
  assert.equal(r.partials, 1);
  /* rate = round((1 + 0.5)/3 * 100) = 50 */
  assert.equal(r.rate, 50);
});

test('getAcc — partial counts as 0.5 in the rate calculation', () => {
  reset();
  predictions.push(
    {
      sym: 'X',
      price: 100,
      target: 110,
      score: 7,
      time: 1,
      checked: false,
      hit: false,
      partial: false,
    },
    {
      sym: 'Y',
      price: 100,
      target: 110,
      score: 7,
      time: 1,
      checked: false,
      hit: false,
      partial: false,
    }
  );
  globalThis.T.X = { p: 110 }; /* +10 % → hit */
  globalThis.T.Y = { p: 102 }; /* +2 % → partial */
  const r = getAcc();
  /* rate = round((1 + 0.5)/2 * 100) = 75 */
  assert.equal(r.rate, 75);
});

test('getAcc — leaves prediction unchecked if the ticker is missing', () => {
  reset();
  predictions.push({
    sym: 'GHOST',
    price: 100,
    target: 110,
    score: 7,
    time: 1,
    checked: false,
    hit: false,
    partial: false,
  });
  /* No T.GHOST */
  const r = getAcc();
  assert.equal(r.total, 0);
  assert.equal(predictions[0].checked, false);
});

test('getAcc — TODAY: rescores against current T[sym].p (AUDIT-F2)', () => {
  /* Documents the audit bug: a prediction made days ago is scored
     against the price of the ticker at THIS reload, not at T+12h.
     Demonstrated by checking the same already-checked prediction
     after T moves: today nothing re-runs because checked=true
     guards re-evaluation, but a NEW prediction made now will be
     scored against whatever T[sym].p is when getAcc() first
     observes it >12 h later — not when 12 h actually elapsed.
     The fix snapshots the resolution price on a real timer. */
  reset();
  predictions.push({
    sym: 'BTC',
    price: 100,
    target: 110,
    score: 7,
    time: 1 /* >12 h old */,
    checked: false,
    hit: false,
    partial: false,
  });
  globalThis.T.BTC = { p: 200 };
  const r1 = getAcc();
  assert.equal(r1.hits, 1, 'first observation marks hit at +100 %');
  /* Later the price collapses, but checked=true means we don't rescore. */
  globalThis.T.BTC = { p: 50 };
  const r2 = getAcc();
  assert.equal(r2.hits, 1, 'subsequent observations leave the hit alone');
});
