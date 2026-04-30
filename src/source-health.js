/* NEXUS PRO — data-source health monitor.

   The audit could not test live data sources from the build sandbox
   (every host outside api.github.com is blocked by the env's CORS
   allowlist). The fix is to bring observability into the app itself
   so the operator can see, from THEIR browser at any time, which of
   the 12 upstream sources is reachable, how fast, and how often it
   has failed in this session.

   Public surface (browser globals + window.*):
     - NEXUS_SOURCES          static catalogue of every upstream
     - sourceHealth           per-source rolling counters + last sample
     - pingSource(spec)       one-shot probe; updates sourceHealth
     - pingAllSources()       parallel probe of every source
     - nexusHealthCheck()     console.table-friendly summary + warnings
     - resetSourceHealth()    wipe counters (test / fresh-session use)

   Notes:
   - GET /ping endpoints are preferred where the upstream offers one
     (cheapest probe). For sources without a /ping, the smallest real
     response we know is requested (`limit=1`, single-symbol queries).
   - All probes run with an 8 s AbortController timeout so a hung
     upstream cannot deadlock the diagnostic.
   - This module DOES NOT auto-poll. Continuous monitoring would risk
     tripping rate limits on free-tier APIs (CoinGecko, Etherscan).
     The operator runs nexusHealthCheck() on demand. */

'use strict';

/* Static catalogue. Keep in sync with the connect-src in index.html
   and with sw.js's API_HOST_PATTERNS. `critical=true` means the app
   cannot operate without this source — the warning summary calls
   them out separately. */
var NEXUS_SOURCES = [
  {
    id: 'proxy',
    name: 'Cloudflare Proxy',
    /* Use the helper rather than hard-coding the worker URL so a
       localStorage override (nxProxyOverride) is respected here too. */
    url: function () {
      return (typeof PROXY === 'string' ? PROXY : '') + '/api/health';
    },
    critical: true,
  },
  {
    id: 'bn-spot',
    name: 'Binance Spot',
    url: function () {
      return (typeof BN === 'string' ? BN : 'https://api.binance.com/api/v3') + '/ping';
    },
    critical: true,
  },
  {
    id: 'bn-fut',
    name: 'Binance Futures',
    url: function () {
      return (typeof BF === 'string' ? BF : 'https://fapi.binance.com/fapi/v1') + '/ping';
    },
    critical: true,
  },
  {
    id: 'bybit',
    name: 'Bybit',
    url: function () {
      return 'https://api.bybit.com/v5/market/time';
    },
    critical: false,
  },
  {
    id: 'llama-tvl',
    name: 'DeFiLlama TVL',
    url: function () {
      return 'https://api.llama.fi/v2/chains';
    },
    critical: false,
  },
  {
    id: 'llama-stable',
    name: 'DeFiLlama Stables',
    url: function () {
      return 'https://stablecoins.llama.fi/stablecoins?includePrices=true';
    },
    critical: false,
  },
  {
    id: 'llama-emissions',
    name: 'DeFiLlama Emissions',
    /* Replaced api.tokenomist.ai/v1/unlocks (deprecated, returned
       HTTP 404 from production probes on 2026-04-30). DeFiLlama's
       emissions endpoint serves the same upcoming-unlock catalogue
       and our other DeFiLlama hosts respond in <50ms. */
    url: function () {
      return 'https://api.llama.fi/emissions';
    },
    critical: false,
  },
  {
    id: 'coingecko',
    name: 'CoinGecko',
    url: function () {
      return (typeof CG === 'string' ? CG : 'https://api.coingecko.com/api/v3') + '/ping';
    },
    critical: false,
  },
  {
    id: 'fng',
    name: 'Fear & Greed',
    url: function () {
      return 'https://api.alternative.me/fng/?limit=1';
    },
    critical: false,
  },
  {
    id: 'mempool',
    name: 'Mempool.space',
    url: function () {
      return 'https://mempool.space/api/mempool/recent';
    },
    critical: false,
  },
  {
    id: 'etherscan',
    name: 'Etherscan',
    url: function () {
      return 'https://api.etherscan.io/api?module=stats&action=ethsupply';
    },
    critical: false,
  },
  {
    id: 'coinbase',
    name: 'Coinbase',
    url: function () {
      return (typeof CB === 'string' ? CB : 'https://api.coinbase.com/v2') + '/prices/BTC-USD/spot';
    },
    critical: false,
  },
];

/* Rolling per-source counters. Reset on page reload; also via
   resetSourceHealth() from a test or "Reset stats" button. */
var sourceHealth = {};

function _stat(id) {
  if (!sourceHealth[id]) {
    sourceHealth[id] = {
      successCount: 0,
      failCount: 0,
      lastStatus: null,
      lastLatencyMs: null,
      lastSuccessAt: null,
      lastFailAt: null,
      lastError: null,
    };
  }
  return sourceHealth[id];
}

function resetSourceHealth() {
  for (var k in sourceHealth) {
    if (Object.prototype.hasOwnProperty.call(sourceHealth, k)) delete sourceHealth[k];
  }
}

function _now() {
  /* performance.now() is monotonic and avoids clock-jump artefacts in
     latency. Falls back to Date.now() in test environments. */
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return Date.now();
}

/* Probe one source. Always resolves — never throws — so callers can
   `Promise.all([...].map(pingSource))` without a wrapping try. */
async function pingSource(spec) {
  var url = typeof spec.url === 'function' ? spec.url() : String(spec.url || '');
  var stat = _stat(spec.id);
  var t0 = _now();
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timeoutId = null;
  if (ctrl && typeof setTimeout !== 'undefined') {
    timeoutId = setTimeout(function () {
      try {
        ctrl.abort();
      } catch (e) {
        /* abort can throw on already-aborted controllers; ignore. */
      }
    }, 8000);
  }
  try {
    var r = await fetch(url, ctrl ? { signal: ctrl.signal } : {});
    if (timeoutId !== null) clearTimeout(timeoutId);
    var ms = Math.round(_now() - t0);
    stat.lastLatencyMs = ms;
    stat.lastStatus = r.status;
    if (r.ok) {
      stat.successCount++;
      stat.lastSuccessAt = Date.now();
      stat.lastError = null;
      return { id: spec.id, name: spec.name, ok: true, status: r.status, ms: ms };
    }
    stat.failCount++;
    stat.lastFailAt = Date.now();
    stat.lastError = 'HTTP ' + r.status;
    return { id: spec.id, name: spec.name, ok: false, status: r.status, ms: ms };
  } catch (e) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    var failMs = Math.round(_now() - t0);
    stat.lastLatencyMs = failMs;
    stat.lastStatus = 0;
    stat.failCount++;
    stat.lastFailAt = Date.now();
    var msg = e && e.name === 'AbortError' ? 'TIMEOUT' : (e && e.message) || 'NETWORK_ERROR';
    stat.lastError = msg;
    return { id: spec.id, name: spec.name, ok: false, status: 0, ms: failMs, error: msg };
  }
}

async function pingAllSources() {
  return Promise.all(
    NEXUS_SOURCES.map(function (s) {
      return pingSource(s);
    })
  );
}

/* Console-friendly summary. Prints a table and warns if any critical
   source failed. Returns the raw results so the caller can inspect. */
async function nexusHealthCheck() {
  if (typeof console === 'undefined') return [];
  console.log('🔍 NEXUS — probing ' + NEXUS_SOURCES.length + ' data sources...');
  var results = await pingAllSources();
  if (console.table) {
    console.table(
      results.map(function (r) {
        return {
          Source: r.name,
          OK: r.ok ? '✅' : '❌',
          Status: r.status,
          'Latency (ms)': r.ms,
          Error: r.error || '',
        };
      })
    );
  } else {
    results.forEach(function (r) {
      console.log(
        (r.ok ? '✅' : '❌') + ' ' + r.name + ' — HTTP ' + r.status + ' — ' + r.ms + ' ms'
      );
    });
  }
  var failed = results.filter(function (r) {
    return !r.ok;
  });
  var criticalFailed = failed.filter(function (r) {
    var spec = NEXUS_SOURCES.find(function (s) {
      return s.id === r.id;
    });
    return spec && spec.critical;
  });
  if (failed.length === 0) {
    console.log('🎉 All ' + results.length + ' sources reachable.');
  } else if (criticalFailed.length > 0) {
    console.warn(
      '🚨 CRITICAL sources DOWN: ' +
        criticalFailed
          .map(function (f) {
            return f.name;
          })
          .join(', ')
    );
  } else {
    console.warn(
      '⚠️ ' +
        failed.length +
        ' non-critical source(s) failed: ' +
        failed
          .map(function (f) {
            return f.name;
          })
          .join(', ')
    );
  }
  return results;
}

/* Browser exposure — surface every helper on `window` so the operator
   can run a one-shot probe from DevTools without remembering the
   global names. Skipped in Node tests (no `window`). */
if (typeof window !== 'undefined') {
  window.NEXUS_SOURCES = NEXUS_SOURCES;
  window.sourceHealth = sourceHealth;
  window.pingSource = pingSource;
  window.pingAllSources = pingAllSources;
  window.nexusHealthCheck = nexusHealthCheck;
  window.resetSourceHealth = resetSourceHealth;
}
