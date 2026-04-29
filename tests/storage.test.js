const test = require('node:test');
const assert = require('node:assert/strict');

require('./_setup.js');

function reset() {
  globalThis.localStorage = new MemStorage();
}

test('safeGetJSON — returns fallback when key is missing', () => {
  reset();
  assert.deepEqual(safeGetJSON('nope', { a: 1 }), { a: 1 });
});

test('safeGetJSON — round-trips through safeSetJSON', () => {
  reset();
  const v = { x: 1, y: ['z', null, 3] };
  assert.equal(safeSetJSON('k', v), true);
  assert.deepEqual(safeGetJSON('k', null), v);
});

test('safeGetJSON — returns fallback on corrupt JSON (no throw)', () => {
  reset();
  localStorage.setItem('k', '{not json');
  assert.deepEqual(safeGetJSON('k', []), []);
});

test('safeGet / safeSet — round-trips a string', () => {
  reset();
  assert.equal(safeGet('k', 'fb'), 'fb');
  safeSet('k', 'hello');
  assert.equal(safeGet('k'), 'hello');
});

test('safeRemove — removes the key', () => {
  reset();
  safeSet('k', 'v');
  assert.equal(safeRemove('k'), true);
  assert.equal(safeGet('k', null), null);
});

test('safeSetJSON — returns false when setItem throws (does not propagate)', () => {
  /* Install a storage whose setItem always throws (simulates QuotaExceeded) */
  globalThis.localStorage = {
    getItem: () => null,
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  assert.equal(safeSetJSON('k', { big: 'data' }), false);
});

test('safeGetJSON — returns fallback when getItem throws (does not propagate)', () => {
  globalThis.localStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.deepEqual(safeGetJSON('k', { fb: true }), { fb: true });
});

test('makeDebouncedSaver — coalesces multiple schedule() calls into one save', async () => {
  reset();
  let calls = 0;
  const saver = makeDebouncedSaver(() => {
    calls++;
  }, 20);
  saver.schedule();
  saver.schedule();
  saver.schedule();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1, 'expected exactly one save after the timer fires');
});

test('makeDebouncedSaver — flush() runs immediately and cancels the timer', async () => {
  reset();
  let calls = 0;
  const saver = makeDebouncedSaver(() => {
    calls++;
  }, 1000);
  saver.schedule();
  saver.flush();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 1, 'flush should fire once and the queued timer should not fire again');
});

test('makeDebouncedSaver — saveFn that throws does not crash the caller', async () => {
  reset();
  let attempts = 0;
  const saver = makeDebouncedSaver(() => {
    attempts++;
    throw new Error('boom');
  }, 5);
  saver.schedule();
  await new Promise((r) => setTimeout(r, 30));
  /* The wrapper must invoke saveFn (so the throw really happened) and must
     swallow the exception (test process is still alive to reach this line). */
  assert.equal(attempts, 1, 'saveFn must run exactly once even when it throws');
  /* Subsequent schedules still work — wrapper state was not corrupted. */
  saver.schedule();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(attempts, 2, 'wrapper must remain usable after a thrown save');
});
