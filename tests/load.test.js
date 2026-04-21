/* Smoke test: load every browser-side src/*.js module in the same order
   index.html does, then assert that each module's expected globals are
   actually on the global object. This is the cross-file equivalent of
   `node --check` — it catches missing globals, dead imports, and
   typos that ESLint can't (because ESLint trusts our `globals` config
   blindly). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('./_setup.js'); // installs MemStorage + window stub

/* Load order mirrors index.html — constants first, then helpers,
   then state, then the integrations layer. */
const LOAD_ORDER = [
  'src/constants.js',
  'src/utils.js',
  'src/storage.js',
  'src/translations.js',
  'src/sectors.js',
  'src/connection.js',
  'src/monitor-state.js',
  'src/whale-state.js',
  'src/portfolio.js',
  'src/notifications.js',
];

/* Per-module: identifiers that MUST exist on globalThis after the file
   evaluates. If any of these is missing, the refactor lost a global. */
const EXPECTS = {
  'src/constants.js': ['BN', 'BF', 'CG', 'CB', 'PROXY', 'WL', 'COL'],
  'src/utils.js': [
    'fmt',
    'fP',
    'esc',
    'h',
    'rawHtml',
    'setHtml',
    'safeC',
    'calcRSI',
    'calcMACD',
    'calcEMA',
    'emaSeries',
    'calcPearson',
  ],
  'src/storage.js': [
    'safeGetJSON',
    'safeGet',
    'safeSetJSON',
    'safeSet',
    'safeRemove',
    'makeDebouncedSaver',
  ],
  'src/translations.js': ['TR', 't'],
  'src/sectors.js': ['SECTORS', 'getCoinSector'],
  'src/connection.js': ['apiCooldown', 'connMetrics', 'fj', 'getConnQuality', 'updateConnStatus'],
  'src/monitor-state.js': [
    'MONITOR_VERSION',
    'DEFAULT_WEIGHTS',
    'DEFAULT_V3_WEIGHTS',
    'monitorState',
    'factorLog',
    'supervisorData',
    'saveMonitor',
    'saveFactorLog',
    'saveSupervisor',
  ],
  'src/whale-state.js': [
    'whaleWaves',
    'calcRealTotalBuy',
    'calcWhaleAvgEntry',
    'calcWhalePnL',
    'calcFlowRate',
  ],
  'src/portfolio.js': [
    'portfolio',
    'predictions',
    'activeTrades',
    'sigHist',
    'recSig',
    'getSigTime',
    'savePred',
    'getAcc',
    'sP',
    'addPort',
    'rmPort',
    'renderPort',
  ],
  'src/notifications.js': [
    'notifiedSet',
    'notifHist',
    'addNotifHist',
    'renderNotifHist',
    'checkWatchlistAlerts',
    'showPopup',
    'notify',
    'playSound',
    'previewTone',
    'selTone',
    'loadToneUI',
    'saveSoundPref',
    'soundPref',
    'soundEnabled',
    'TG_PROXY',
    'tgSent',
    'sendTG',
    'tgNotify',
    'alertPrefs',
    'saveAlertPref',
  ],
};

/* `lang` is declared in app.js, but several src/ modules (translations,
   notifications, connection) reference it inside function bodies. Stub
   it before loading so any incidental top-level read doesn't crash. */
globalThis.lang = 'en';
/* `T` ticker map + a couple of price-related stores are also app.js
   globals referenced inside helper bodies; stub as empties so nothing
   throws at hydration time. */
globalThis.T = {};
globalThis.FR = {};
globalThis.CBP = {};
globalThis.lastDataTime = Date.now();

function load(rel) {
  const abs = path.resolve(__dirname, '..', rel);
  const src = fs.readFileSync(abs, 'utf8');
  vm.runInThisContext(src, { filename: rel });
}

LOAD_ORDER.forEach((rel) => {
  test(`loads ${rel} cleanly and exposes expected globals`, () => {
    /* Fresh storage each pass so per-module migrations don't pollute. */
    globalThis.localStorage = new globalThis.MemStorage();

    /* The script must not throw at top level. */
    assert.doesNotThrow(() => load(rel), `${rel} threw at module init`);

    /* Each declared identifier must be resolvable by name in the same
       script scope. We probe via vm.runInThisContext so `const`/`let`
       bindings (which are global-lexical, not window properties) count
       — that's exactly how the browser resolves them across <script>
       tags. */
    const expected = EXPECTS[rel] || [];
    for (const name of expected) {
      const t = vm.runInThisContext('typeof ' + name);
      assert.notEqual(t, 'undefined', `${rel}: expected global "${name}" was undefined after load`);
    }
  });
});

test('cross-file: notify() can route a stubbed signal end-to-end', () => {
  /* Stub the app.js-provided pieces that notify() reaches into. */
  globalThis.lang = 'en';
  globalThis.T.BTC = { p: 100, c: 1, v: 1e9 };
  globalThis.whaleWaves.BTC = {
    waves: [],
    totalBuy: 200000,
    engine: { confidence: 60 },
  };
  globalThis.signalQualityGate = () => ({ pass: true });
  globalThis.openTrade = () => {};
  /* Replace fetch with a no-op so sendTG doesn't actually hit the network. */
  let tgFired = false;
  globalThis.fetch = () => {
    tgFired = true;
    return Promise.resolve({ ok: true });
  };
  /* showPopup needs the DOM elements it touches — stub document for this
     one call. */
  const stubEl = { textContent: '', style: {}, classList: { remove() {}, add() {} } };
  const realDoc = globalThis.document;
  globalThis.document = {
    getElementById: () => stubEl,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  notify('BTC', 'whale', 70);

  /* Restore */
  globalThis.document = realDoc;

  assert.ok(tgFired, 'notify() should have triggered the Telegram fetch');
});
