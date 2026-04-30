/* Tests for src/source-health-ui.js — verify the panel renders one
   row per source, the "Check now" button binds correctly, and the
   summary line surfaces the right state for ok / failure / critical-
   failure outcomes. */

const test = require('node:test');
const assert = require('node:assert/strict');

/* Seed the runtime constants source-health.js reads at call time. */
globalThis.PROXY = 'https://proxy.test';
globalThis.BN = 'https://api.binance.com/api/v3';
globalThis.BF = 'https://fapi.binance.com/fapi/v1';
globalThis.CG = 'https://api.coingecko.com/api/v3';
globalThis.CB = 'https://api.coinbase.com/v2';

/* Translation stub used by the UI's optional t() lookup. */
globalThis.t = (key) => key;

/* Minimal DOM stub — only the surface the UI actually calls. */
class DomEl {
  constructor(id, tag) {
    this.id = id;
    this.tagName = tag || 'DIV';
    this.innerHTML = '';
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this._attrs = {};
    this._listeners = {};
    this._nxBound = false;
  }
  setAttribute(name, val) {
    this._attrs[name] = String(val);
  }
  getAttribute(name) {
    return this._attrs[name] !== undefined ? this._attrs[name] : null;
  }
  addEventListener(event, fn) {
    this._listeners[event] = fn;
  }
  click() {
    if (this._listeners.click) this._listeners.click({});
  }
}

const els = {
  srcHealthRunBtn: new DomEl('srcHealthRunBtn', 'BUTTON'),
  srcHealthList: new DomEl('srcHealthList', 'DIV'),
  srcHealthSummary: new DomEl('srcHealthSummary', 'DIV'),
};

globalThis.document = {
  readyState: 'complete',
  getElementById(id) {
    return els[id] || null;
  },
  addEventListener() {},
};

/* esc() lives in src/utils.js — _setup loads it. */
const { loadScript } = require('./_setup.js');
loadScript('src/source-health.js');
loadScript('src/source-health-ui.js');

function reset() {
  resetSourceHealth();
  els.srcHealthList.innerHTML = '';
  els.srcHealthList._attrs = {};
  els.srcHealthSummary.textContent = '';
  els.srcHealthSummary.style = {};
  els.srcHealthRunBtn.disabled = false;
  els.srcHealthRunBtn.innerHTML = '🔍 check';
  els.srcHealthRunBtn.dataset = {};
}

/* ─── renderSourceHealth ──────────────────────────────────────────── */

test('renderSourceHealth — neutral row per source before any probe', () => {
  reset();
  renderSourceHealth();
  /* Each NEXUS_SOURCES entry produces exactly one src-health-row. */
  const rowCount = (els.srcHealthList.innerHTML.match(/src-health-row/g) || []).length;
  assert.equal(rowCount, NEXUS_SOURCES.length);
  /* Neutral icons present for every entry. */
  const dashCount = (els.srcHealthList.innerHTML.match(/⚪/g) || []).length;
  assert.equal(dashCount, NEXUS_SOURCES.length);
});

test('renderSourceHealth — successful source shows ✅ + latency', () => {
  reset();
  sourceHealth['proxy'] = {
    successCount: 1,
    failCount: 0,
    lastStatus: 200,
    lastLatencyMs: 187,
    lastSuccessAt: Date.now(),
    lastFailAt: null,
    lastError: null,
  };
  renderSourceHealth();
  /* The proxy row contains ✅ and the 187 ms latency. */
  assert.match(els.srcHealthList.innerHTML, /Cloudflare Proxy.*✅|✅.*Cloudflare Proxy/);
  assert.ok(els.srcHealthList.innerHTML.includes('187 ms'));
});

test('renderSourceHealth — failed source shows ❌ + error', () => {
  reset();
  sourceHealth['proxy'] = {
    successCount: 0,
    failCount: 1,
    lastStatus: 500,
    lastLatencyMs: 200,
    lastSuccessAt: null,
    lastFailAt: Date.now(),
    lastError: 'HTTP 500',
  };
  renderSourceHealth();
  assert.ok(els.srcHealthList.innerHTML.includes('❌'));
  assert.ok(els.srcHealthList.innerHTML.includes('HTTP 500'));
});

/* ─── runSourceHealthCheck ────────────────────────────────────────── */

test('runSourceHealthCheck — all sources OK → green summary', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  await runSourceHealthCheck();
  assert.match(els.srcHealthSummary.textContent, /✅/);
  assert.ok(els.srcHealthSummary.textContent.includes(String(NEXUS_SOURCES.length)));
  assert.equal(els.srcHealthRunBtn.disabled, false, 'button re-enabled after probe');
});

test('runSourceHealthCheck — critical source down → red summary mentions name', async () => {
  reset();
  /* Fail only the proxy (critical). Everyone else returns 200. */
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.indexOf('proxy.test') !== -1) {
      throw new Error('refused');
    }
    return { ok: true, status: 200 };
  };
  await runSourceHealthCheck();
  assert.match(els.srcHealthSummary.textContent, /🚨/);
  assert.ok(els.srcHealthSummary.textContent.includes('Cloudflare Proxy'));
});

test('runSourceHealthCheck — non-critical failure → yellow summary, count visible', async () => {
  reset();
  /* Fail only Bybit (not critical). */
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.indexOf('bybit.com') !== -1) {
      throw new Error('flaky');
    }
    return { ok: true, status: 200 };
  };
  await runSourceHealthCheck();
  assert.match(els.srcHealthSummary.textContent, /⚠️/);
  /* "11/12 reachable" — n-1 successes shown. */
  assert.ok(
    els.srcHealthSummary.textContent.includes(
      String(NEXUS_SOURCES.length - 1) + '/' + NEXUS_SOURCES.length
    )
  );
});

test('runSourceHealthCheck — button is disabled while probing then re-enabled', async () => {
  reset();
  /* Hold every fetch so we can observe the busy state mid-probe.
     pingAllSources calls fetch once per source — capture every
     resolve() and release them together at the end. */
  const pending = [];
  globalThis.fetch = () =>
    new Promise((r) => {
      pending.push(r);
    });
  const probe = runSourceHealthCheck();
  /* Yield once so the synchronous setup inside runSourceHealthCheck
     (button disable, aria-busy=true) is observable. */
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(els.srcHealthRunBtn.disabled, true);
  /* Release every pending fetch. */
  pending.forEach((r) => r({ ok: true, status: 200 }));
  await probe;
  assert.equal(els.srcHealthRunBtn.disabled, false);
});

test('runSourceHealthCheck — aria-busy toggles around the probe', async () => {
  reset();
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  await runSourceHealthCheck();
  /* After completion, aria-busy is "false". */
  assert.equal(els.srcHealthList.getAttribute('aria-busy'), 'false');
});
