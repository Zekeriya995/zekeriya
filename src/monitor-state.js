/* NEXUS PRO — monitor & supervisor state.
   Owns three long-lived localStorage-backed stores used by the adaptive
   scoring engine and the audit/supervisor layer:

     - monitorState   (key: 'nxMonitor')     — per-factor win-rates,
                                                confidence calibration, coin/hour
                                                stats, blacklist, fail patterns,
                                                v1→v2 migration logic.
     - factorLog      (key: 'nxFactorLog')   — rolling 500-entry trade journal.
     - supervisorData (key: 'nxSupervisor')  — whale audits, gate rejections,
                                                data-quality snapshots, daily
                                                report.

   Nothing here depends on other app-level globals: safe to load before
   app.js. Writes are debounced (2 s) and flushed on pagehide/beforeunload
   so a single burst of updates only triggers one persist. */

var MONITOR_VERSION = 2;
var DEFAULT_WEIGHTS = {
  trend: 2,
  whales: 2,
  rsi: 1,
  fr: 1,
  oi: 1,
  vol: 0.5,
  macd: 0.5,
  confluence: 1,
  structure: 1,
  smart: 1,
  flow: 1,
  mood: 0.5,
};
var DEFAULT_V3_WEIGHTS = {
  whale: 25,
  smartMoney: 20,
  technical: 20,
  funding: 15,
  timing: 10,
  context: 10,
};

/* ─── monitorState ─────────────────────────────────────────────── */
var monitorState = null;
try {
  monitorState = JSON.parse(localStorage.getItem('nxMonitor'));
} catch (e) {
  monitorState = null;
}

/* v1 → v2 migration: preserve learned data, add new factor keys (smart/flow/mood) */
if (monitorState && monitorState.v === 1) {
  if (!monitorState.factorStats) monitorState.factorStats = {};
  ['smart', 'flow', 'mood'].forEach(function (k) {
    if (!monitorState.factorStats[k]) {
      monitorState.factorStats[k] = { wins: 0, losses: 0, total: 0, winRate: 0 };
    }
    if (monitorState.weights && monitorState.weights[k] === undefined) {
      monitorState.weights[k] = DEFAULT_WEIGHTS[k];
    }
  });
  monitorState.v = MONITOR_VERSION;
  try {
    localStorage.setItem('nxMonitor', JSON.stringify(monitorState));
  } catch (e) {}
}

/* Fresh install, unknown version, or corrupt JSON → reset to defaults */
if (!monitorState || monitorState.v !== MONITOR_VERSION) {
  monitorState = {
    v: MONITOR_VERSION,
    weights: JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)),
    factorStats: {
      trend: { wins: 0, losses: 0, total: 0, winRate: 0 },
      whales: { wins: 0, losses: 0, total: 0, winRate: 0 },
      rsi: { wins: 0, losses: 0, total: 0, winRate: 0 },
      fr: { wins: 0, losses: 0, total: 0, winRate: 0 },
      oi: { wins: 0, losses: 0, total: 0, winRate: 0 },
      vol: { wins: 0, losses: 0, total: 0, winRate: 0 },
      macd: { wins: 0, losses: 0, total: 0, winRate: 0 },
      confluence: { wins: 0, losses: 0, total: 0, winRate: 0 },
      structure: { wins: 0, losses: 0, total: 0, winRate: 0 },
      smart: { wins: 0, losses: 0, total: 0, winRate: 0 },
      flow: { wins: 0, losses: 0, total: 0, winRate: 0 },
      mood: { wins: 0, losses: 0, total: 0, winRate: 0 },
    },
    confCalib: {},
    hourStats: {},
    coinStats: {},
    coinBlacklist: [],
    failPatterns: [],
    minConf: 65,
    lastTune: 0,
    perf: {
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      overallRate: 0,
      bestFactor: '',
      worstFactor: '',
      bestHour: -1,
      worstHour: -1,
      bestCoin: '',
      worstCoin: '',
      lastUpdate: 0,
    },
  };
}

/* ─── factorLog ────────────────────────────────────────────────── */
var factorLog = [];
try {
  factorLog = JSON.parse(localStorage.getItem('nxFactorLog') || '[]');
} catch (e) {
  factorLog = [];
}

/* ─── debounced persistence for monitorState ───────────────────── */
var _saveMonitorTimer = null;
var _saveMonitorPending = false;

function _saveMonitorNow() {
  _saveMonitorPending = false;
  try {
    localStorage.setItem('nxMonitor', JSON.stringify(monitorState));
  } catch (e) {}
}

function saveMonitor() {
  _saveMonitorPending = true;
  if (_saveMonitorTimer) clearTimeout(_saveMonitorTimer);
  _saveMonitorTimer = setTimeout(_saveMonitorNow, 2000);
}

/* Flush any pending save before the page is hidden or unloaded. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', function () {
    if (_saveMonitorPending) _saveMonitorNow();
  });
  window.addEventListener('pagehide', function () {
    if (_saveMonitorPending) _saveMonitorNow();
  });
}

function saveFactorLog() {
  if (factorLog.length > 500) factorLog = factorLog.slice(-500);
  try {
    localStorage.setItem('nxFactorLog', JSON.stringify(factorLog));
  } catch (e) {}
}

/* ─── V3 weight migration (additive, leaves existing state alone) ─ */
if (monitorState && !monitorState.v3weights) {
  monitorState.v3weights = JSON.parse(JSON.stringify(DEFAULT_V3_WEIGHTS));
  saveMonitor();
}
if (monitorState && !monitorState.v3factorStats) {
  monitorState.v3factorStats = {};
  saveMonitor();
}
if (monitorState && !monitorState.lastTuneTradeCount) {
  monitorState.lastTuneTradeCount = 0;
  saveMonitor();
}

/* One-time migration: the blacklist threshold was tightened from
   "3 trades / <30% win rate" to "5 trades / <25% win rate" so it
   matches what signalQualityGate Gate 4 actually enforces. Coins
   added under the looser rule would otherwise stay stuck on the
   user-visible blacklist until their rate climbed to >=55%, even
   though Gate 4 wouldn't block them. Re-evaluate the list once
   under the new add threshold and drop anything that no longer
   qualifies. Flag-gated so subsequent loads skip the work. */
if (monitorState && !monitorState.blMigratedAt5_25) {
  if (Array.isArray(monitorState.coinBlacklist) && monitorState.coinStats) {
    monitorState.coinBlacklist = monitorState.coinBlacklist.filter(function (c) {
      var cs = monitorState.coinStats[c];
      return cs && cs.total >= 5 && cs.rate < 25;
    });
  }
  monitorState.blMigratedAt5_25 = true;
  saveMonitor();
}

/* ─── supervisorData ───────────────────────────────────────────── */
var supervisorData = {};
try {
  supervisorData = JSON.parse(localStorage.getItem('nxSupervisor') || '{}');
} catch (e) {
  supervisorData = {};
}
if (!supervisorData.whaleAudit) supervisorData.whaleAudit = [];
if (!supervisorData.scannerAudit) supervisorData.scannerAudit = [];
if (!supervisorData.gateLog) supervisorData.gateLog = [];
if (!supervisorData.dataQuality) supervisorData.dataQuality = [];
if (!supervisorData.dailyReport) supervisorData.dailyReport = null;
if (!supervisorData.lastCollect) supervisorData.lastCollect = 0;
if (!supervisorData.lastReport) supervisorData.lastReport = 0;

function saveSupervisor() {
  if (supervisorData.whaleAudit.length > 200) {
    supervisorData.whaleAudit = supervisorData.whaleAudit.slice(-200);
  }
  if (supervisorData.scannerAudit.length > 200) {
    supervisorData.scannerAudit = supervisorData.scannerAudit.slice(-200);
  }
  if (supervisorData.gateLog.length > 100) {
    supervisorData.gateLog = supervisorData.gateLog.slice(-100);
  }
  if (supervisorData.dataQuality.length > 48) {
    supervisorData.dataQuality = supervisorData.dataQuality.slice(-48);
  }
  try {
    localStorage.setItem('nxSupervisor', JSON.stringify(supervisorData));
  } catch (e) {}
}
