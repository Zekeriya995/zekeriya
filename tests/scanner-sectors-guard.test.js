/* T1 — sector taxonomy drift guard (2026-05 scanner audit).

   Two hand-maintained copies of the sector→coins taxonomy exist:
     - browser: src/sectors.js  → SECTORS      (loaded via _setup.js)
     - server:  src/scanner-sectors.js → SECTOR_COINS

   The audit found silent drift in both: tickers that Binance renamed or
   delisted were left to rot. analyzeSectors() (browser) filters by the
   live ticker feed T[s] FIRST, so a dead symbol just quietly shrinks its
   sector; getSector()/aggregateBySector (server) map the dead symbol to a
   bucket no live signal will ever land in. Concretely:

     MATIC → POL     (Polygon rebrand, 2024)
     RNDR  → RENDER  (Render rebrand, 2023)
     AGIX  → FET     (ASI Alliance merger, 2024)
     OCEAN → FET     (ASI Alliance merger, 2024)

   These guards are deliberately STATIC (no live feed): they pin the
   curated lists so a future edit can't re-introduce a delisted ticker or
   starve a sector below the 2-coin floor where analyzeSectors drops it
   (`coins.length < 2`). Validating against the live Binance universe is a
   separate online concern — this just keeps the taxonomy honest. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadScript } = require('./_setup.js');
loadScript('src/sectors.js'); /* puts browser SECTORS on globalThis */
const { SECTOR_COINS } = require('../src/scanner-sectors');

const SYMBOL_RE = /^[A-Z0-9]{1,15}$/;

/* Tickers confirmed delisted / renamed on Binance by 2026-05. They must
   never appear in either taxonomy. */
const DELISTED = ['MATIC', 'RNDR', 'AGIX', 'OCEAN'];

/* Replacements that MUST be present so the renamed coin keeps its slot. */
const REQUIRED = { POL: 'layer2', RENDER: 'ai' };

/* The vanish floor differs by copy. analyzeSectors (browser) DROPS any
   sector with `coins.length < 2`, so the browser taxonomy needs headroom
   (3) above that floor to survive a future rename losing a member. The
   server's aggregateBySector has no such floor — a thin sector just rolls
   up fewer signals — so it only needs to be non-empty/non-singleton (2). */
const MIN_COINS = { SECTORS: 3, SECTOR_COINS: 2 };

/* Normalise both taxonomies to { sectorKey: [coins...] }. */
function coinsOf(tax) {
  const out = {};
  for (const k of Object.keys(tax)) {
    out[k] = Array.isArray(tax[k]) ? tax[k] : tax[k].coins;
  }
  return out;
}

function eachTaxonomy(fn) {
  fn('SECTORS', coinsOf(globalThis.SECTORS));
  fn('SECTOR_COINS', coinsOf(SECTOR_COINS));
}

test('T1 — no delisted/renamed ticker survives in any sector', () => {
  eachTaxonomy((name, tax) => {
    for (const k of Object.keys(tax)) {
      for (const c of tax[k]) {
        assert.ok(!DELISTED.includes(c), `${name}.${k} still lists delisted ticker ${c}`);
      }
    }
  });
});

test('T1 — renamed replacements are present in the right sector', () => {
  eachTaxonomy((name, tax) => {
    for (const sym of Object.keys(REQUIRED)) {
      const sec = REQUIRED[sym];
      assert.ok(tax[sec], `${name} is missing sector ${sec}`);
      assert.ok(tax[sec].includes(sym), `${name}.${sec} is missing replacement ${sym}`);
    }
  });
});

test('T1 — every sector has enough coins to survive rename attrition', () => {
  eachTaxonomy((name, tax) => {
    const min = MIN_COINS[name];
    for (const k of Object.keys(tax)) {
      assert.ok(tax[k].length >= min, `${name}.${k} has only ${tax[k].length} coins (min ${min})`);
    }
  });
});

test('T1 — no duplicate coin within a single sector', () => {
  eachTaxonomy((name, tax) => {
    for (const k of Object.keys(tax)) {
      const seen = new Set();
      for (const c of tax[k]) {
        assert.ok(!seen.has(c), `${name}.${k} lists ${c} twice`);
        seen.add(c);
      }
    }
  });
});

test('T1 — every ticker is a well-formed symbol', () => {
  eachTaxonomy((name, tax) => {
    for (const k of Object.keys(tax)) {
      for (const c of tax[k]) {
        assert.ok(SYMBOL_RE.test(c), `${name}.${k} has malformed ticker "${c}"`);
      }
    }
  });
});
