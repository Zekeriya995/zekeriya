/* Test bootstrap: load src/*.js modules into the current global scope
   even though they were written for plain <script> tags in the browser.

   How it works:
   - `require('vm').runInThisContext(source)` evaluates a string as if it
     were a top-level script in this Node context, so every `var` and
     `function` declaration ends up on the same global object that
     subsequent test code reads from.
   - Before evaluating, we install a tiny `localStorage` shim and a
     no-op `window` so storage.js + utils.js can hydrate without a
     real browser.

   Tests then `require('./_setup.js')` and reference helpers (esc, fmt,
   safeGetJSON, …) directly. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Minimal localStorage shim — same surface as the browser API. */
class MemStorage {
  constructor() {
    this._m = new Map();
  }
  getItem(k) {
    return this._m.has(k) ? this._m.get(k) : null;
  }
  setItem(k, v) {
    if (typeof v !== 'string') v = String(v);
    this._m.set(k, v);
  }
  removeItem(k) {
    this._m.delete(k);
  }
  clear() {
    this._m.clear();
  }
  get length() {
    return this._m.size;
  }
  key(i) {
    return Array.from(this._m.keys())[i] || null;
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = new MemStorage();
}

/* Tests sometimes need to swap in a storage that throws — expose the
   class so they can construct one. */
globalThis.MemStorage = MemStorage;

/* `window` is referenced by storage.js's makeDebouncedSaver to attach
   pagehide / beforeunload listeners. Stub it with a no-op addEventListener
   so the module loads cleanly. */
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { addEventListener: () => {} };
}

/* Load a src/*.js script into this Node context so its top-level
   declarations become globals. */
function loadScript(rel) {
  const abs = path.resolve(__dirname, '..', rel);
  const src = fs.readFileSync(abs, 'utf8');
  vm.runInThisContext(src, { filename: rel });
}

loadScript('src/utils.js');
loadScript('src/storage.js');

module.exports = { MemStorage, loadScript };
