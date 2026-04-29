/* Tests for src/visibility-pause.js — the bgInterval registry that
   pauses every registered timer while the browser tab is hidden.

   The module reads a real `document.visibilityState` and registers
   one document-level listener at load. We seed `document` BEFORE
   loading and toggle `visibilityState` directly between assertions,
   then call the test seam `_bgHandleVisibility()` to drive the logic
   without dispatching real events. */

const test = require('node:test');
const assert = require('node:assert/strict');

let _vsHandler = null;

globalThis.document = {
  visibilityState: 'visible',
  _listeners: {},
  addEventListener(name, fn) {
    /* Capture the visibility handler so the tests can drive it
       without dispatching a real DOM event. */
    if (name === 'visibilitychange') _vsHandler = fn;
    this._listeners[name] = fn;
  },
  removeEventListener() {},
};

const { loadScript } = require('./_setup.js');
loadScript('src/visibility-pause.js');

assert.equal(typeof _vsHandler, 'function', 'module must register a visibilitychange listener');

function setVisible(v) {
  globalThis.document.visibilityState = v ? 'visible' : 'hidden';
  _vsHandler();
}

test('bgInterval — runs while visible (callback fires within ~15 ms tick)', async () => {
  bgClearAll();
  setVisible(true);
  let calls = 0;
  bgInterval(() => {
    calls++;
  }, 15);
  await new Promise((r) => setTimeout(r, 50));
  bgClearAll();
  assert.ok(calls >= 2, `expected ≥ 2 ticks in 50 ms, got ${calls}`);
});

test('bgInterval — does NOT register a real timer while hidden', async () => {
  bgClearAll();
  setVisible(false);
  let calls = 0;
  bgInterval(() => {
    calls++;
  }, 10);
  await new Promise((r) => setTimeout(r, 40));
  bgClearAll();
  assert.equal(calls, 0, 'no callbacks should fire while the tab is hidden');
});

test('hide → unhide: timer is cleared on hide and re-armed on unhide', async () => {
  bgClearAll();
  setVisible(true);
  let calls = 0;
  bgInterval(() => {
    calls++;
  }, 20);
  await new Promise((r) => setTimeout(r, 30)); /* expect at least 1 */
  const beforeHide = calls;
  setVisible(false);
  await new Promise((r) => setTimeout(r, 60)); /* nothing while hidden */
  assert.equal(calls, beforeHide, 'no ticks while hidden');
  setVisible(true);
  /* On unhide we should see a catch-up tick PLUS interval ticks. */
  await new Promise((r) => setTimeout(r, 50));
  bgClearAll();
  assert.ok(calls >= beforeHide + 2, `expected catch-up + ticks, got ${calls - beforeHide} new`);
});

test('bgInterval — catch-up tick fires once on unhide before the interval resumes', async () => {
  bgClearAll();
  setVisible(false);
  let calls = 0;
  bgInterval(() => {
    calls++;
  }, 1_000_000); /* huge interval so only the catch-up should fire in test window */
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 0);
  setVisible(true);
  /* Synchronous catch-up tick — assert immediately. */
  assert.equal(calls, 1, 'unhide must fire one catch-up tick synchronously');
  bgClearAll();
});

test('bgInterval — a throw in catch-up does NOT break sibling timers on unhide', async () => {
  bgClearAll();
  setVisible(false);
  let okCalls = 0;
  bgInterval(() => {
    throw new Error('boom');
  }, 1_000_000);
  bgInterval(() => {
    okCalls++;
  }, 1_000_000);
  setVisible(true);
  assert.equal(okCalls, 1, 'sibling must still fire its catch-up after a throwing peer');
  bgClearAll();
});

test('bgClearAll — drops everything; further visibilitychange does nothing', async () => {
  bgClearAll();
  setVisible(true);
  let calls = 0;
  bgInterval(() => {
    calls++;
  }, 10);
  bgClearAll();
  setVisible(false);
  setVisible(true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 0, 'cleared timers must stay dead');
});

test('bgInterval — rejects bad arguments and returns 0', () => {
  assert.equal(bgInterval(null, 100), 0);
  assert.equal(
    bgInterval(() => {}, 0),
    0
  );
  assert.equal(
    bgInterval(() => {}, -5),
    0
  );
  assert.equal(bgInterval('not a function', 100), 0);
});

test('bgIsVisible — reflects document.visibilityState', () => {
  globalThis.document.visibilityState = 'visible';
  assert.equal(bgIsVisible(), true);
  globalThis.document.visibilityState = 'hidden';
  assert.equal(bgIsVisible(), false);
  globalThis.document.visibilityState = 'visible'; /* leave clean */
});
