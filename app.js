/* NEXUS PRO V10 — Early Detection + Sound Alerts + Smart Cache + 6 Checks
   Shared constants (BN/BF/CG/CB/PROXY/WL/COL) live in src/constants.js and
   pure helpers (esc/fmt/fP/safeC/calcRSI/calcMACD/calcEMA) in src/utils.js —
   both are loaded before this file by index.html. */
var tg=window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null;if(tg){tg.ready();tg.expand();tg.setHeaderColor('#060b14');tg.setBackgroundColor('#020408')}
/* ═══ 🏆 AUTO TOP 100 — updates every hour from CoinGecko + trending from exchanges ═══ */
async function updateTop100(){
  try{
    var STABLES=['USDT','USDC','TUSD','DAI','BUSD','FDUSD','USDP','PYUSD','USD','UST'];
    var newWL=[];
    /* Part 1: Top 100 by market cap from CoinGecko */
    var data=await fj(CG+'/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=120&page=1');
    if(data&&data.length){
      data.forEach(function(c){
        if(!c.symbol)return;
        var sym=c.symbol.toUpperCase();
        if(STABLES.includes(sym))return;
        if(newWL.length<100&&newWL.indexOf(sym)===-1)newWL.push(sym);
      });
    }
    /* Part 2: Rising coins from exchange data (before pump detection) */
    if(Object.keys(T).length>50){
      var rising=Object.entries(T).filter(function(e){
        var s=e[0],d=e[1];
        if(STABLES.includes(s)||newWL.indexOf(s)!==-1)return false;
        /* Strong rise + high volume = potential pump */
        return(d.c>=5&&d.v>=5000000)||(d.c>=3&&d.v>=50000000)||(d.v>=200000000);
      }).sort(function(a,b){return b[1].v-a[1].v}).slice(0,10);
      rising.forEach(function(e){
        if(newWL.indexOf(e[0])===-1){newWL.push(e[0]);console.log('[TOP100] 🔥 Rising added: '+e[0]+' +'+e[1].c.toFixed(1)+'% Vol:'+fmt(e[1].v))}
      });
    }
    /* Part 3: Coins with whale activity */
    Object.keys(whaleWaves).forEach(function(s){
      if(STABLES.includes(s)||newWL.indexOf(s)!==-1)return;
      var ww=whaleWaves[s];
      if(ww&&ww.totalBuy>=100000&&newWL.indexOf(s)===-1){
        newWL.push(s);
        console.log('[TOP100] 🐋 Whale added: '+s+' $'+fmt(ww.totalBuy));
      }
    });
    if(newWL.length>=50){
      WL=newWL;
      TIER1=new Set(WL);
      console.log('[TOP100] Updated: '+WL.length+' coins (100 mcap + '+Math.max(0,WL.length-100)+' rising/whale)');
    }
  }catch(e){console.log('[TOP100] Failed — using cached list')}
}
/* ═══ 🏆 3-TIER SYSTEM — Smart Coin Focus ═══ */
var TIER1=new Set(WL); /* Top 100 — Auto-updates hourly */
var tier2Coins=[],tier3Coins=[];var tierLastRefresh=0;
function getCoinTier(s){if(TIER1.has(s))return 1;if(tier2Coins.includes(s))return 2;if(tier3Coins.includes(s))return 3;return 0}
function getTierBadge(s){var t=getCoinTier(s);return t===1?'🏆':t===2?'🥈':t===3?'🔍':''}
async function refreshTiers(){if(Date.now()-tierLastRefresh<4*3600000&&tier2Coins.length>0)return;tierLastRefresh=Date.now();
  var STABLES=['USDT','USDC','TUSD','DAI','BUSD','FDUSD','USDP','PYUSD'];var ranked=Object.entries(T).filter(function(e){return!STABLES.includes(e[0])&&!TIER1.has(e[0])&&e[1].v>1000000}).sort(function(a,b){return b[1].v-a[1].v}).map(function(e){return e[0]});
  tier2Coins=ranked.slice(0,75);tier3Coins=ranked.slice(75,275);
  console.log('[Tiers] T1:'+TIER1.size+' T2:'+tier2Coins.length+' T3:'+tier3Coins.length)}
/* Volume Spike: T3 → T2 auto-promote */
var volBaselines={};
function checkVolSpikes(){/* Disabled — TOP 100 focus only */}
/* VPIN Calculator — simple version using REST trades */
var vpinBuckets={};
function updateVPIN(sym,price,qty,isBuyerMaker){
  if(!vpinBuckets[sym])vpinBuckets[sym]={buckets:[],cur:{bv:0,sv:0,n:0}};
  var d=vpinBuckets[sym];var val=price*qty;
  if(isBuyerMaker)d.cur.sv+=val;else d.cur.bv+=val;d.cur.n++;
  if(d.cur.n>=30){d.buckets.push({bv:d.cur.bv,sv:d.cur.sv});if(d.buckets.length>40)d.buckets.shift();d.cur={bv:0,sv:0,n:0}}}
function calcVPIN(sym){
  var d=vpinBuckets[sym];if(!d||d.buckets.length<8)return{vpin:0,score:0,signal:'NO_DATA'};
  var tImb=0,tVol=0;d.buckets.forEach(function(b){tImb+=Math.abs(b.bv-b.sv);tVol+=b.bv+b.sv});
  var vpin=tVol>0?tImb/tVol:0;var sc=0,sig='LOW_TOXICITY';
  if(vpin>0.7){sc+=12;sig='EXTREME_TOXICITY'}else if(vpin>0.55){sc+=8;sig='HIGH_TOXICITY'}else if(vpin>0.4){sc+=3;sig='MODERATE'}
  return{vpin:+vpin.toFixed(3),score:sc,signal:sig}}
/* COL (coin colors) moved to src/constants.js */
var T={},FR={},OI={},LS={},CBP={},ws=null,curCoin='BTC',curTF='1h',inds={vol:1,sma:0,rsi:0,sr:0,bb:0,macd:0,ema:0,pat:0};
var lsHist={},takerData={}; /* L/S Intelligence v2.0 */
var frHistory={},oiHistory={},topTradersLS={},globalLS={},aggCVD={},bookTickers={}; /* Binance Advanced */
var defiTVL={},stablecoinData={},tokenUnlocks=[]; /* DeFiLlama + Tokenomist */
/* ═══ NEW: Multi-Exchange Intelligence Data Stores ═══ */
var coinalyzeOI={},coinalyzeFR={},coinalyzeLiq={},coinalyzePredFR={}; /* Coinalyze — aggregated multi-exchange */
var hyperliquidData={},hyperliquidFR={}; /* Hyperliquid DEX */
var okxFR={},okxOI={},okxLS={}; /* OKX — 3rd largest exchange */
var cbPremium={BTC:0,ETH:0}; /* Coinbase Premium */
var btcOnChain={hashRate:0,difficulty:0,unconfirmed:0,txs24h:0}; /* Blockchain.info */
var cryptoNews=[],newsSentiment={pos:0,neg:0,neu:0}; /* CryptoCompare */
var bitfinexMargin={},bitfinexLending={}; /* Bitfinex */
var whaleAlerts=[]; /* Whale Alert */
var multiExCache={t:0}; /* Cache for multi-exchange fetch — 3 min */
var defiCache={t:0},unlockCache={t:0};
var sparkHist={}; /* Real sparkline data per coin */
var whaleWaves={};try{whaleWaves=JSON.parse(localStorage.getItem('nxww10')||'{}')}catch(e){}
var prevOB={}; /* Previous Order Book snapshots */
var portfolio=[];try{portfolio=JSON.parse(localStorage.getItem('nxp10')||'[]')}catch(e){}
var predictions=[];try{predictions=JSON.parse(localStorage.getItem('nxpred10')||'[]')}catch(e){}
var activeTrades=[];try{activeTrades=JSON.parse(localStorage.getItem('nxTrades')||'[]')}catch(e){}
var sigHist={};try{sigHist=JSON.parse(localStorage.getItem('nxsig10')||'{}')}catch(e){}
var notifiedSet={};try{notifiedSet=JSON.parse(localStorage.getItem('nxnot10')||'{}')}catch(e){};
var lang='ar';try{lang=localStorage.getItem('nxlang')||'ar'}catch(e){}
var fgValue=50,btcDom=50;
/* ═══ 🤖 PLATFORM MONITOR — PART A ═══ */
var MONITOR_VERSION = 2;
var DEFAULT_WEIGHTS = {trend:2, whales:2, rsi:1, fr:1, oi:1, vol:0.5, macd:0.5, confluence:1, structure:1, smart:1, flow:1, mood:0.5};

var monitorState = null;
try { monitorState = JSON.parse(localStorage.getItem('nxMonitor')); } catch(e) { monitorState = null; }
/* v2 migration: preserve existing stats but add new factor keys for smart/flow/mood */
if (monitorState && monitorState.v === 1) {
  /* Preserve learned data, just add new factor stats + weight keys */
  if (!monitorState.factorStats) monitorState.factorStats = {};
  ['smart','flow','mood'].forEach(function(k){
    if (!monitorState.factorStats[k]) monitorState.factorStats[k] = {wins:0, losses:0, total:0, winRate:0};
    if (monitorState.weights && monitorState.weights[k] === undefined) monitorState.weights[k] = DEFAULT_WEIGHTS[k];
  });
  monitorState.v = MONITOR_VERSION;
  try { localStorage.setItem('nxMonitor', JSON.stringify(monitorState)); } catch(e) {}
}
if (!monitorState || monitorState.v !== MONITOR_VERSION) {
  monitorState = {
    v: MONITOR_VERSION,
    weights: JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)),
    factorStats: {
      trend:  {wins:0, losses:0, total:0, winRate:0},
      whales: {wins:0, losses:0, total:0, winRate:0},
      rsi:    {wins:0, losses:0, total:0, winRate:0},
      fr:     {wins:0, losses:0, total:0, winRate:0},
      oi:     {wins:0, losses:0, total:0, winRate:0},
      vol:    {wins:0, losses:0, total:0, winRate:0},
      macd:   {wins:0, losses:0, total:0, winRate:0},
      confluence:{wins:0, losses:0, total:0, winRate:0},
      structure: {wins:0, losses:0, total:0, winRate:0},
      smart:  {wins:0, losses:0, total:0, winRate:0},
      flow:   {wins:0, losses:0, total:0, winRate:0},
      mood:   {wins:0, losses:0, total:0, winRate:0}
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
      lastUpdate: 0
    }
  };
}

var factorLog = [];
try { factorLog = JSON.parse(localStorage.getItem('nxFactorLog') || '[]'); } catch(e) { factorLog = []; }

var _saveMonitorTimer=null;var _saveMonitorPending=false;
function _saveMonitorNow(){
  _saveMonitorPending=false;
  try{localStorage.setItem('nxMonitor',JSON.stringify(monitorState))}catch(e){}
}
function saveMonitor(){
  _saveMonitorPending=true;
  if(_saveMonitorTimer)clearTimeout(_saveMonitorTimer);
  _saveMonitorTimer=setTimeout(_saveMonitorNow,2000);
}
/* Flush pending save before page unload */
if(typeof window!=='undefined'){
  window.addEventListener('beforeunload',function(){if(_saveMonitorPending)_saveMonitorNow()});
  window.addEventListener('pagehide',function(){if(_saveMonitorPending)_saveMonitorNow()});
}
function saveFactorLog() {
  if (factorLog.length > 500) factorLog = factorLog.slice(-500);
  try { localStorage.setItem('nxFactorLog', JSON.stringify(factorLog)); } catch(e) {}
}

/* ═══ V3 ADAPTIVE WEIGHTS ═══ */
var DEFAULT_V3_WEIGHTS = {whale:25, smartMoney:20, technical:20, funding:15, timing:10, context:10};
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

/* ═══ SUPERVISOR DATA ═══ */
var supervisorData = {};
try { supervisorData = JSON.parse(localStorage.getItem('nxSupervisor') || '{}'); } catch(e) { supervisorData = {}; }
if (!supervisorData.whaleAudit) supervisorData.whaleAudit = [];
if (!supervisorData.scannerAudit) supervisorData.scannerAudit = [];
if (!supervisorData.gateLog) supervisorData.gateLog = [];
if (!supervisorData.dataQuality) supervisorData.dataQuality = [];
if (!supervisorData.dailyReport) supervisorData.dailyReport = null;
if (!supervisorData.lastCollect) supervisorData.lastCollect = 0;
if (!supervisorData.lastReport) supervisorData.lastReport = 0;

function saveSupervisor() {
  if (supervisorData.whaleAudit.length > 200) supervisorData.whaleAudit = supervisorData.whaleAudit.slice(-200);
  if (supervisorData.scannerAudit.length > 200) supervisorData.scannerAudit = supervisorData.scannerAudit.slice(-200);
  if (supervisorData.gateLog.length > 100) supervisorData.gateLog = supervisorData.gateLog.slice(-100);
  if (supervisorData.dataQuality.length > 48) supervisorData.dataQuality = supervisorData.dataQuality.slice(-48);
  try { localStorage.setItem('nxSupervisor', JSON.stringify(supervisorData)); } catch(e) {}
}

/* ═══ SUPERVISOR TRACKING FUNCTIONS ═══ */
function trackWhaleOutcome() {
  var now = Date.now();
  Object.keys(whaleWaves).forEach(function(sym) {
    var ww = whaleWaves[sym];
    if (!ww || !ww.waves || !ww.waves.length) return;
    if (!ww.engine) return;
    var d = T[sym];
    if (!d || !d.p) return;
    var existing = supervisorData.whaleAudit.filter(function(a) {
      return a.sym === sym && now - a.time < 86400000;
    });
    if (!existing.length) {
      var avgEntry = 0;
      try { var we = calcWhaleAvgEntry(sym); if (we > 0) avgEntry = we; } catch(e) {}
      supervisorData.whaleAudit.push({
        sym: sym, time: now, conf: ww.engine.confidence || 0, rank: ww.engine.rank || '',
        entryPrice: avgEntry || d.p, waves: ww.waves.length,
        snapshots: [{ t: now, p: d.p }], outcome: null
      });
    } else {
      var entry = existing[0];
      var lastSnap = entry.snapshots.length ? entry.snapshots[entry.snapshots.length - 1].t : 0;
      if (now - lastSnap >= 1800000) {
        entry.snapshots.push({ t: now, p: d.p });
        if (entry.snapshots.length > 48) entry.snapshots = entry.snapshots.slice(-48);
      }
      if (!entry.outcome && now - entry.time >= 14400000 && entry.entryPrice > 0) {
        var change = ((d.p - entry.entryPrice) / entry.entryPrice) * 100;
        entry.outcome = change >= 2 ? 'WIN' : change >= 0 ? 'NEUTRAL' : 'LOSS';
        entry.finalChange = change;
      }
    }
  });
  saveSupervisor();
}

function trackGateRejection(sym, type, results, pass) {
  if (pass) return;
  var failed = results.filter(function(r) { return !r.pass; }).map(function(r) { return r.name; });
  supervisorData.gateLog.push({
    sym: sym, type: type, time: Date.now(), failed: failed,
    price: T[sym] ? T[sym].p : 0, change: T[sym] ? T[sym].c : 0
  });
  saveSupervisor();
}

function supervisorCollect() {
  var now = Date.now();
  var snapshot = {
    time: now,
    coins: Object.keys(T).length, fr: Object.keys(FR).length, oi: Object.keys(OI).length,
    ls: Object.keys(LS).length, topTraders: Object.keys(topTradersLS).length,
    frHist: Object.keys(frHistory).length, oiHist: Object.keys(oiHistory).length,
    cvd: Object.keys(aggCVD).length,
    depth: Object.keys(depthSnapshots).filter(function(s) { return depthSnapshots[s] && depthSnapshots[s].bids; }).length,
    taker: Object.keys(takerData).filter(function(s) { return takerData[s]; }).length,
    bitfinex: Object.keys(bitfinexMargin).length,
    hyperliquid: Object.keys(hyperliquidData).length,
    coinalyze: Object.keys(coinalyzeOI).length,
    cbp: Object.keys(CBP).length,
    whaleActive: Object.keys(whaleWaves).filter(function(s) { return whaleWaves[s] && whaleWaves[s].waves && whaleWaves[s].waves.length; }).length,
    scannerSignals: cache.scan ? cache.scan.length : 0,
    top3Shown: document.querySelectorAll('.top3-card').length,
    openTrades: activeTrades ? activeTrades.filter(function(t) { return t.status === 'OPEN'; }).length : 0,
    winRate: monitorState ? monitorState.perf.overallRate : 0,
    totalTrades: monitorState ? monitorState.perf.totalTrades : 0,
    btcChange: T.BTC ? T.BTC.c : 0, fgValue: fgValue || 50,
    dataAge: Math.round((now - lastDataTime) / 1000),
    apiRate: (connMetrics.apiOk + connMetrics.apiFail) > 0 ? Math.round(connMetrics.apiOk / (connMetrics.apiOk + connMetrics.apiFail) * 100) : 0
  };
  supervisorData.dataQuality.push(snapshot);
  supervisorData.lastCollect = now;
  saveSupervisor();
}

function supervisorDailyReport() {
  var now = Date.now(); var day = 86400000; var ar = lang === 'ar';
  var whaleRecent = supervisorData.whaleAudit.filter(function(a) { return now - a.time < day && a.outcome; });
  var whaleWins = whaleRecent.filter(function(a) { return a.outcome === 'WIN'; }).length;
  var whaleRate = whaleRecent.length > 0 ? Math.round(whaleWins / whaleRecent.length * 100) : 0;
  var diamondGold = whaleRecent.filter(function(a) { return a.conf >= 80; });
  var dgWins = diamondGold.filter(function(a) { return a.outcome === 'WIN'; }).length;
  var dgRate = diamondGold.length > 0 ? Math.round(dgWins / diamondGold.length * 100) : 0;
  var recentTrades = (typeof factorLog !== 'undefined' ? factorLog : []).filter(function(l) { return now - l.time < day; });
  var scanWins = recentTrades.filter(function(l) { return l.outcome === 'win' || l.outcome === 'partial'; }).length;
  var scanRate = recentTrades.length > 0 ? Math.round(scanWins / recentTrades.length * 100) : 0;
  var bestTrade = null, worstTrade = null;
  recentTrades.forEach(function(t) {
    if (!bestTrade || (t.pnl || 0) > (bestTrade.pnl || 0)) bestTrade = t;
    if (!worstTrade || (t.pnl || 0) < (worstTrade.pnl || 0)) worstTrade = t;
  });
  var vipTrades = recentTrades.filter(function(t) { return t.conf >= 80; });
  var vipWins = vipTrades.filter(function(t) { return t.outcome === 'win' || t.outcome === 'partial'; }).length;
  var vipRate = vipTrades.length > 0 ? Math.round(vipWins / vipTrades.length * 100) : 0;
  var gateRecent = supervisorData.gateLog.filter(function(g) { return now - g.time < day; });
  var gateCounts = {};
  gateRecent.forEach(function(g) { g.failed.forEach(function(f) { if (!gateCounts[f]) gateCounts[f] = { total: 0, coins: [] }; gateCounts[f].total++; if (gateCounts[f].coins.indexOf(g.sym) === -1) gateCounts[f].coins.push(g.sym); }); });
  var qualRecent = supervisorData.dataQuality.filter(function(q) { return now - q.time < day; });
  var avgApiRate = qualRecent.length > 0 ? Math.round(qualRecent.reduce(function(s, q) { return s + q.apiRate; }, 0) / qualRecent.length) : 0;
  var avgDataAge = qualRecent.length > 0 ? Math.round(qualRecent.reduce(function(s, q) { return s + q.dataAge; }, 0) / qualRecent.length) : 0;
  var disconnects = qualRecent.filter(function(q) { return q.coins < 50; }).length;
  var totalPnl = recentTrades.reduce(function(s, t) { return s + (t.pnl || 0); }, 0);
  var grade = 0;
  if (scanRate >= 70) grade += 30; else if (scanRate >= 50) grade += 20; else grade += 10;
  if (whaleRate >= 60) grade += 20; else if (whaleRate >= 40) grade += 10;
  if (avgApiRate >= 95) grade += 20; else if (avgApiRate >= 80) grade += 15; else grade += 5;
  if (totalPnl > 0) grade += 15; else if (totalPnl > -2) grade += 10; else grade += 5;
  if (disconnects === 0) grade += 15; else if (disconnects <= 2) grade += 10; else grade += 5;
  var gradeLabel = grade >= 85 ? 'A' : grade >= 70 ? 'B+' : grade >= 60 ? 'B' : grade >= 50 ? 'C' : 'D';
  var recommendations = [];
  Object.keys(gateCounts).forEach(function(gate) {
    if (gateCounts[gate].total >= 3) { recommendations.push({ type: 'info', text: 'Gate "' + gate + '" blocked ' + gateCounts[gate].total + ' signals' }); }
  });
  if (whaleRate < 50 && whaleRecent.length >= 3) recommendations.push({ type: 'warn', text: 'Whale accuracy low (' + whaleRate + '%) — consider raising threshold' });
  if (scanRate >= 70) recommendations.push({ type: 'good', text: 'Scanner performing well (' + scanRate + '%)' });
  if (avgDataAge > 15) recommendations.push({ type: 'warn', text: 'Average data age ' + avgDataAge + 's — check connection' });
  if (disconnects > 3) recommendations.push({ type: 'bad', text: 'Frequent disconnects (' + disconnects + 'x) — check PROXY' });
  var report = {
    time: now, grade: grade, gradeLabel: gradeLabel,
    totalTrades: recentTrades.length, scanWins: scanWins, scanRate: scanRate,
    bestTrade: bestTrade ? { sym: bestTrade.sym, pnl: bestTrade.pnl || 0 } : null,
    worstTrade: worstTrade ? { sym: worstTrade.sym, pnl: worstTrade.pnl || 0 } : null,
    totalPnl: totalPnl, vipTrades: vipTrades.length, vipWins: vipWins, vipRate: vipRate,
    whaleSignals: whaleRecent.length, whaleWins: whaleWins, whaleRate: whaleRate,
    dgRate: dgRate, dgCount: diamondGold.length,
    gateBlocks: gateRecent.length, gateCounts: gateCounts,
    avgApiRate: avgApiRate, avgDataAge: avgDataAge, disconnects: disconnects,
    recommendations: recommendations
  };
  supervisorData.dailyReport = report;
  supervisorData.lastReport = now;
  saveSupervisor();
  return report;
}

function renderDailyReport() {
  var rpt = supervisorData.dailyReport;
  if (!rpt) { try { rpt = supervisorDailyReport(); } catch(e) { return; } }
  if (!rpt) return;
  var ar = lang === 'ar';
  try { showPopup('📊', 'Daily Report', rpt.gradeLabel + ' — Scanner:' + rpt.scanRate + '% Whales:' + rpt.whaleRate + '%'); } catch(e) {}
}

/* Takes a snapshot of which factors are active at trade entry */
function captureFactorSnapshot(sym) {
  var d = T[sym]; if (!d) return null;
  var fr = FR[sym];
  var ls = LS[sym];
  var oi = OI[sym];
  var ww = whaleWaves[sym];
  var wConf = ww && ww.engine ? ww.engine.confidence : 0;
  var cvd = null; try { cvd = analyzeCVD(sym); } catch(e) {}

  var snapshot = {
    sym: sym,
    time: Date.now(),
    hour: new Date().getUTCHours(),
    price: d.p,
    change24h: d.c,
    factors: {
      trend:      d.c > 0,
      whales:     wConf >= 40,
      rsi:        true,
      fr:         fr ? fr.rate < 0 : false,
      oi:         oi ? oi > 0 : false,
      vol:        d.v > 5e7,
      macd:       true,
      confluence: true,
      structure:  true,
      /* NEW: market direction v2 factors */
      smart:      (function(){var s=false;try{if(topTradersLS[sym]&&topTradersLS[sym].accounts&&topTradersLS[sym].accounts.length){var tl=topTradersLS[sym].accounts[topTradersLS[sym].accounts.length-1];if(tl.long>0.55)s=true;}}catch(e){}try{if(!s&&typeof cbPremium!=='undefined'&&((sym==='BTC'&&cbPremium.BTC_pct>0.1)||(sym==='ETH'&&cbPremium.ETH_pct>0.1)))s=true;}catch(e){}try{if(!s&&bitfinexMargin[sym]&&bitfinexMargin[sym].longPct>60)s=true;}catch(e){}return s;})(),
      flow:       (function(){var f=false;try{var ic=detectIceberg(sym);if(ic&&ic.signal==='ICEBERG_BUY')f=true;}catch(e){}try{if(!f){var vp=calcVPIN(sym);if(vp&&vp.vpin>0.6)f=true;}}catch(e){}try{if(!f&&takerData[sym]&&takerData[sym].ratio>1.3)f=true;}catch(e){}return f;})(),
      mood:       (function(){var m=false;try{if(typeof fgValue!=='undefined'&&fgValue>=40&&fgValue<=70)m=true;}catch(e){}try{if(!m&&newsSentiment){var nsScore=newsSentiment.score!==undefined?newsSentiment.score:((newsSentiment.pos||0)/Math.max(1,((newsSentiment.pos||0)+(newsSentiment.neg||0)+(newsSentiment.neu||0)))*100);if(nsScore>55)m=true;}}catch(e){}return m;})()
    },
    v3categories: {
      whale: wConf >= 40 || (ww && ww.waves && ww.waves.length >= 2),
      smartMoney: (function() { var sm = false; try { if (topTradersLS[sym] && topTradersLS[sym].accounts && topTradersLS[sym].accounts.length) { var tl = topTradersLS[sym].accounts[topTradersLS[sym].accounts.length - 1]; if (tl.long > 0.55) sm = true; } } catch(e) {} try { if (!sm && CBP[sym] && T[sym] && T[sym].p > 0 && ((CBP[sym] - T[sym].p) / T[sym].p) > 0.002) sm = true; } catch(e) {} return sm; })(),
      technical: (function() { var tech = false; try { var cv = analyzeCVD(sym); if (cv && (cv.divergence === 'BULLISH' || cv.trend === 'BUYING')) tech = true; } catch(e) {} try { if (!tech) { var vp = calcVPIN(sym); if (vp && vp.vpin > 0.5) tech = true; } } catch(e) {} return tech; })(),
      funding: (fr && fr.rate < -0.005) || (function() { try { if (frHistory[sym] && frHistory[sym].length >= 4) { var negC = frHistory[sym].filter(function(x) { return x.rate < -0.005; }).length; if (negC >= 3) return true; } } catch(e) {} return false; })(),
      timing: (function() { try { if (sigHist[sym] && sigHist[sym].time && (Date.now() - sigHist[sym].time) < 900000) return true; } catch(e) {} return false; })(),
      context: (function() { var ctx = false; try { if (monitorState && monitorState.coinStats && monitorState.coinStats[sym] && monitorState.coinStats[sym].rate >= 55) ctx = true; } catch(e) {} if (!ctx && T.BTC && T.BTC.c > 1) ctx = true; return ctx; })()
    },
    raw: {
      frRate: fr ? fr.rate : 0,
      lsRatio: ls ? ls.ratio : 1,
      wConf: wConf,
      cvdSignal: cvd ? cvd.divergence : 'NONE',
      fgValue: fgValue,
      btcChange: T.BTC ? T.BTC.c : 0,
      volume: d.v,
      change: d.c
    }
  };
  return snapshot;
}

/* Process trade outcome — called from closeTrade hook */
function processTradeOutcome(trade) {
  if (!trade || !trade.factorSnapshot) return;
  var isWin = trade.finalPnl >= 2;
  var isPartial = trade.finalPnl >= 0.5 && trade.finalPnl < 2;
  var isLoss = trade.finalPnl < 0.5;
  var outcome = isWin ? 'win' : isPartial ? 'partial' : 'loss';

  var snap = trade.factorSnapshot;
  var factorKeys = Object.keys(monitorState.factorStats);
  factorKeys.forEach(function(key) {
    if (snap.factors[key]) {
      var fs = monitorState.factorStats[key];
      fs.total++;
      if (isWin || isPartial) fs.wins++;
      else fs.losses++;
      fs.winRate = fs.total > 0 ? Math.round((fs.wins / fs.total) * 100) : 0;
    }
  });

  /* V3 category tracking */
  if (snap.v3categories) {
    if (!monitorState.v3factorStats) monitorState.v3factorStats = {};
    var v3Keys = Object.keys(snap.v3categories);
    v3Keys.forEach(function(key) {
      if (snap.v3categories[key]) {
        if (!monitorState.v3factorStats[key]) monitorState.v3factorStats[key] = {wins:0, losses:0, total:0, winRate:0};
        var v3fs = monitorState.v3factorStats[key];
        v3fs.total++;
        if (isWin || isPartial) v3fs.wins++;
        else v3fs.losses++;
        v3fs.winRate = v3fs.total > 0 ? Math.round((v3fs.wins / v3fs.total) * 100) : 0;
      }
    });
  }

  /* P28: Clamp to same [0,90] range as getCalibratedConf read side, so write
     and read buckets match. Previously, trades with raw score > 100 went to
     buckets like "110-120" that the reader never consulted. */
  var clampedConf = Math.max(0, Math.min(100, trade.confAtEntry || 0));
  var confBucket = Math.min(90, Math.floor(clampedConf / 10) * 10);
  var bucketKey = confBucket + '-' + (confBucket + 10);
  if (!monitorState.confCalib[bucketKey]) {
    monitorState.confCalib[bucketKey] = {wins: 0, total: 0, realRate: 0};
  }
  var cb = monitorState.confCalib[bucketKey];
  cb.total++;
  if (isWin || isPartial) cb.wins++;
  cb.realRate = cb.total > 0 ? Math.round((cb.wins / cb.total) * 100) : 0;

  var hour = String(snap.hour);
  if (!monitorState.hourStats[hour]) {
    monitorState.hourStats[hour] = {wins: 0, total: 0, rate: 0};
  }
  var hs = monitorState.hourStats[hour];
  hs.total++;
  if (isWin || isPartial) hs.wins++;
  hs.rate = hs.total > 0 ? Math.round((hs.wins / hs.total) * 100) : 0;

  var coinKey = trade.sym;
  if (!monitorState.coinStats[coinKey]) {
    monitorState.coinStats[coinKey] = {wins: 0, total: 0, rate: 0};
  }
  var cs = monitorState.coinStats[coinKey];
  cs.total++;
  if (isWin || isPartial) cs.wins++;
  cs.rate = cs.total > 0 ? Math.round((cs.wins / cs.total) * 100) : 0;

  var bl = monitorState.coinBlacklist;
  if (cs.total >= 3 && cs.rate < 30 && bl.indexOf(coinKey) === -1) {
    bl.push(coinKey);
  }
  if (cs.rate >= 55 && bl.indexOf(coinKey) !== -1) {
    bl.splice(bl.indexOf(coinKey), 1);
  }

  factorLog.push({
    sym: trade.sym,
    type: trade.type,
    pnl: trade.finalPnl,
    outcome: outcome,
    conf: trade.confAtEntry,
    hour: snap.hour,
    duration: trade.duration || 0,
    raw: snap.raw,
    factors: snap.factors,
    time: Date.now()
  });

  monitorState.perf.totalTrades++;
  if (isWin || isPartial) monitorState.perf.totalWins++;
  else monitorState.perf.totalLosses++;
  monitorState.perf.overallRate = monitorState.perf.totalTrades > 0
    ? Math.round((monitorState.perf.totalWins / monitorState.perf.totalTrades) * 100) : 0;
  monitorState.perf.lastUpdate = Date.now();

  /* 5-trade auto-tune trigger */
  var tradesSinceLastTune = monitorState.perf.totalTrades - (monitorState.lastTuneTradeCount || 0);
  if (tradesSinceLastTune >= 5) {
    try { autoTuneWeights(); monitorState.lastTuneTradeCount = monitorState.perf.totalTrades; } catch(e) {}
  }

  saveMonitor();
  saveFactorLog();
}

/* Detect failure patterns from factor log */
function detectFailPatterns() {
  if (factorLog.length < 10) return;

  var patterns = [];
  var conditions = [
    {key: 'frHigh',    test: function(r) { return r.frRate > 0.05; },    label: 'FR > 0.05%'},
    {key: 'frVHigh',   test: function(r) { return r.frRate > 0.08; },    label: 'FR > 0.08%'},
    {key: 'lsHigh',    test: function(r) { return r.lsRatio > 1.5; },    label: 'L/S > 1.5'},
    {key: 'lsVHigh',   test: function(r) { return r.lsRatio > 2.0; },    label: 'L/S > 2.0'},
    {key: 'noWhale',   test: function(r) { return r.wConf < 20; },       label: 'No whales'},
    {key: 'cvdBear',   test: function(r) { return r.cvdSignal === 'BEARISH'; }, label: 'CVD Bearish'},
    {key: 'fear',      test: function(r) { return r.fgValue < 25; },     label: 'Fear < 25'},
    {key: 'greed',     test: function(r) { return r.fgValue > 75; },     label: 'Greed > 75'},
    {key: 'btcDn',     test: function(r) { return r.btcChange < -3; },   label: 'BTC < -3%'},
    {key: 'lowVol',    test: function(r) { return r.volume < 1e7; },     label: 'Vol < $10M'},
    {key: 'bigPump',   test: function(r) { return r.change > 15; },      label: 'Pump > 15%'}
  ];

  conditions.forEach(function(cond) {
    var matching = factorLog.filter(function(l) { return cond.test(l.raw); });
    if (matching.length >= 3) {
      var fails = matching.filter(function(l) { return l.outcome === 'loss'; }).length;
      var failRate = Math.round((fails / matching.length) * 100);
      if (failRate >= 60) {
        patterns.push({
          conditions: [cond.label],
          failRate: failRate,
          sampleSize: matching.length,
          label: cond.label + ' \u2192 ' + failRate + '% ' + (lang === 'ar' ? 'فشل' : 'fail')
        });
      }
    }
  });

  for (var i = 0; i < conditions.length; i++) {
    for (var j = i + 1; j < conditions.length; j++) {
      var c1 = conditions[i], c2 = conditions[j];
      var matching = factorLog.filter(function(l) { return c1.test(l.raw) && c2.test(l.raw); });
      if (matching.length >= 3) {
        var fails = matching.filter(function(l) { return l.outcome === 'loss'; }).length;
        var failRate = Math.round((fails / matching.length) * 100);
        if (failRate >= 65) {
          patterns.push({
            conditions: [c1.label, c2.label],
            failRate: failRate,
            sampleSize: matching.length,
            label: c1.label + ' + ' + c2.label + ' \u2192 ' + failRate + '% ' + (lang === 'ar' ? 'فشل' : 'fail')
          });
        }
      }
    }
  }

  patterns.sort(function(a, b) { return b.failRate - a.failRate; });
  monitorState.failPatterns = patterns.slice(0, 10);
  saveMonitor();
  return patterns;
}

/* Weekly auto-tune: adjust weights based on factor performance */
function autoTuneWeights() {
  var fs = monitorState.factorStats;
  var w = monitorState.weights;
  var def = DEFAULT_WEIGHTS;

  var factorKeys = Object.keys(def);
  var perfMap = {};
  var hasData = false;
  factorKeys.forEach(function(key) {
    var stat = fs[key];
    if (stat && stat.total >= 5) {
      perfMap[key] = stat.winRate;
      hasData = true;
    }
  });

  if (!hasData) return;

  var bestKey = '', bestRate = 0, worstKey = '', worstRate = 100;
  factorKeys.forEach(function(key) {
    if (perfMap[key] !== undefined) {
      if (perfMap[key] > bestRate) { bestRate = perfMap[key]; bestKey = key; }
      if (perfMap[key] < worstRate) { worstRate = perfMap[key]; worstKey = key; }
    }
  });

  factorKeys.forEach(function(key) {
    var defW = def[key];
    var minW = defW * 0.5;
    var maxW = defW * 2.0;

    if (perfMap[key] !== undefined) {
      var rate = perfMap[key];
      if (rate >= 70) {
        w[key] = Math.min(maxW, w[key] * 1.15);
      } else if (rate >= 55) {
        w[key] = w[key] + (defW - w[key]) * 0.1;
      } else if (rate < 45) {
        w[key] = Math.max(minW, w[key] * 0.85);
      }
      w[key] = Math.round(w[key] * 100) / 100;
    }
  });

  /* minConf tuning moved to runAutoImprove() to avoid double-adjustment.
     autoTuneWeights now only adjusts factor weights. */

  monitorState.perf.bestFactor = bestKey;
  monitorState.perf.worstFactor = worstKey;

  var bestH = -1, bestHR = 0, worstH = -1, worstHR = 100;
  Object.keys(monitorState.hourStats).forEach(function(h) {
    var hs = monitorState.hourStats[h];
    if (hs.total >= 3) {
      if (hs.rate > bestHR) { bestHR = hs.rate; bestH = +h; }
      if (hs.rate < worstHR) { worstHR = hs.rate; worstH = +h; }
    }
  });
  monitorState.perf.bestHour = bestH;
  monitorState.perf.worstHour = worstH;

  var bestC = '', bestCR = 0, worstC = '', worstCR = 100;
  Object.keys(monitorState.coinStats).forEach(function(c) {
    var cs = monitorState.coinStats[c];
    if (cs.total >= 3) {
      if (cs.rate > bestCR) { bestCR = cs.rate; bestC = c; }
      if (cs.rate < worstCR) { worstCR = cs.rate; worstC = c; }
    }
  });
  monitorState.perf.bestCoin = bestC;
  monitorState.perf.worstCoin = worstC;

  detectFailPatterns();

  /* V3 category weight tuning (used by renderTop3) */
  if (monitorState.v3factorStats && monitorState.v3weights) {
    var v3def = DEFAULT_V3_WEIGHTS;
    var v3w = monitorState.v3weights;
    Object.keys(v3def).forEach(function(key) {
      var stat = monitorState.v3factorStats[key];
      if (stat && stat.total >= 5) {
        var rate = stat.winRate;
        var defW = v3def[key];
        var minW = defW * 0.5;
        var maxW = defW * 2.0;
        if (rate >= 70) {
          v3w[key] = Math.min(maxW, Math.round(v3w[key] * 1.15 * 100) / 100);
        } else if (rate >= 55) {
          v3w[key] = Math.round((v3w[key] + (defW - v3w[key]) * 0.1) * 100) / 100;
        } else if (rate < 45) {
          v3w[key] = Math.max(minW, Math.round(v3w[key] * 0.85 * 100) / 100);
        }
      }
    });
  }

  monitorState.lastTune = Date.now();
  saveMonitor();

  addVLog('🧠', (lang === 'ar'
    ? 'تعلّم ذاتي: أوزان عُدّلت — أفضل: ' + bestKey + ' (' + bestRate + '%) — أضعف: ' + worstKey + ' (' + worstRate + '%)'
    : 'Auto-tune: weights adjusted — Best: ' + bestKey + ' (' + bestRate + '%) — Worst: ' + worstKey + ' (' + worstRate + '%)'));

  return {best: bestKey, bestRate: bestRate, worst: worstKey, worstRate: worstRate};
}

/* Calibrate displayed confidence based on actual outcomes.
   Clamp input to [0,100] since some callers pass raw scanner scores >100. */
function getCalibratedConf(rawConf) {
  var clamped = Math.max(0, Math.min(100, rawConf || 0));
  var bucket = Math.min(90, Math.floor(clamped / 10) * 10);
  var key = bucket + '-' + (bucket + 10);
  var cb = monitorState && monitorState.confCalib ? monitorState.confCalib[key] : null;
  if (cb && cb.total >= 5) {
    return cb.realRate;
  }
  return clamped;
}

/* Check if a signal matches any known failure pattern */
function matchesFailPattern(raw) {
  if (!monitorState.failPatterns || !monitorState.failPatterns.length) return null;

  var tests = {
    'FR > 0.05%':   raw.frRate > 0.05,
    'FR > 0.08%':   raw.frRate > 0.08,
    'L/S > 1.5':    raw.lsRatio > 1.5,
    'L/S > 2.0':    raw.lsRatio > 2.0,
    'CVD Bearish':   raw.cvdSignal === 'BEARISH',
    'Fear < 25':     raw.fgValue < 25,
    'Greed > 75':    raw.fgValue > 75,
    'BTC < -3%':     raw.btcChange < -3,
    'Vol < $10M':    raw.volume < 1e7,
    'Pump > 15%':    raw.change > 15
  };
  tests['No whales'] = raw.wConf < 20;

  for (var i = 0; i < monitorState.failPatterns.length; i++) {
    var pat = monitorState.failPatterns[i];
    var allMatch = true;
    for (var j = 0; j < pat.conditions.length; j++) {
      if (!tests[pat.conditions[j]]) { allMatch = false; break; }
    }
    if (allMatch) return pat;
  }
  return null;
}

/* Check if coin is blacklisted */
function isCoinBlacklisted(sym) {
  return monitorState.coinBlacklist.indexOf(sym) !== -1;
}

/* Get performance summary for a specific coin */
function getCoinPerf(sym) {
  return monitorState.coinStats[sym] || {wins: 0, total: 0, rate: 0};
}

/* Get performance summary for current hour */
function getHourPerf() {
  var h = String(new Date().getUTCHours());
  return monitorState.hourStats[h] || {wins: 0, total: 0, rate: 0};
}

/* ═══ 🛡️ PLATFORM MONITOR — PART B ═══ */

/* Detects dangerous market conditions */
function detectMarketDanger() {
  var reasons = [];
  var score = 0;

  var btcChg = T.BTC ? T.BTC.c : 0;
  if (btcChg < -5) { score += 3; reasons.push(lang === 'ar' ? 'BTC هابط ' + btcChg.toFixed(1) + '%' : 'BTC down ' + btcChg.toFixed(1) + '%'); }
  else if (btcChg < -3) { score += 1; reasons.push(lang === 'ar' ? 'BTC يتراجع ' + btcChg.toFixed(1) + '%' : 'BTC declining ' + btcChg.toFixed(1) + '%'); }

  if (fgValue < 15) { score += 3; reasons.push(lang === 'ar' ? 'ذعر شديد FG=' + fgValue : 'Extreme fear FG=' + fgValue); }
  else if (fgValue < 25) { score += 1; reasons.push(lang === 'ar' ? 'خوف FG=' + fgValue : 'Fear FG=' + fgValue); }

  var allCoins = Object.values(T);
  var redPct = allCoins.length > 0 ? Math.round(allCoins.filter(function(x) { return x.c < 0; }).length / allCoins.length * 100) : 0;
  if (redPct > 80) { score += 2; reasons.push(lang === 'ar' ? redPct + '% عملات حمراء' : redPct + '% coins red'); }

  var frKeys = Object.keys(FR);
  var avgFR = frKeys.length > 0 ? Object.values(FR).reduce(function(s, x) { return s + x.rate; }, 0) / frKeys.length : 0;
  if (avgFR > 0.08) { score += 2; reasons.push(lang === 'ar' ? 'FR عالي جداً ' + avgFR.toFixed(3) + '%' : 'Very high FR ' + avgFR.toFixed(3) + '%'); }

  var level = score >= 4 ? 'danger' : score >= 2 ? 'caution' : 'safe';
  return { dangerous: score >= 4, level: level, score: score, reasons: reasons, redPct: redPct, btcChg: btcChg };
}

/* Signal Quality Gate — 5 checks before each signal */
function signalQualityGate(sym, type, score) {
  var results = [];
  var pass = true;

  /* Gate 1 — Real price (UNCHANGED) */
  var d = T[sym];
  var g1 = d && d.p > 0;
  results.push({name: lang === 'ar' ? 'سعر حقيقي' : 'Real price', pass: g1});
  if (!g1) pass = false;

  /* Gate 2 — Volume (UNCHANGED) */
  var minVol = TIER1.has(sym) ? 2000000 : 5000000;
  var g2 = d && d.v >= minVol;
  results.push({name: lang === 'ar' ? 'حجم كافي (>$2M)' : 'Volume OK (>$2M)', pass: g2, detail: d ? fmt(d.v) : '$0'});
  if (!g2) pass = false;

  /* Gate 3 — Market safety (UNCHANGED) */
  var mkt = detectMarketDanger();
  var g3 = !mkt.dangerous;
  results.push({name: lang === 'ar' ? 'السوق آمن' : 'Market safe', pass: g3, detail: mkt.level});
  if (!g3) pass = false;

  /* Gate 4 — Blacklist: only block after 5+ trades AND <25% win rate.
     The legacy monitorState.coinBlacklist (populated by runAutoImprove with a
     looser 3-trade/30% threshold) is intentionally NOT consulted here. */
  var g4 = true;
  var coinStat = monitorState && monitorState.coinStats ? monitorState.coinStats[sym] : null;
  if (coinStat && coinStat.total >= 5 && coinStat.rate < 25) {
    g4 = false;
  }
  results.push({name: lang === 'ar' ? 'عملة غير محظورة' : 'Not blacklisted', pass: g4});
  if (!g4) pass = false;

  /* Gate 5 — Fail pattern (UNCHANGED) */
  var snap = captureFactorSnapshot(sym);
  var failPat = snap ? matchesFailPattern(snap.raw) : null;
  var g5 = !failPat;
  results.push({name: lang === 'ar' ? 'لا نمط فشل' : 'No fail pattern', pass: g5, detail: failPat ? failPat.label : ''});
  if (!g5 && failPat && failPat.failRate >= 60) pass = false;

  /* Gate 6 — Whale support (FIXED: allow bypass with strong alternative signals) */
  var ww = whaleWaves[sym];
  var hasWhale = ww && ww.waves && ww.waves.length > 0;
  var g6 = hasWhale || type === 'whale' || type === 'fast';

  if (!g6) {
    var hasStrongAlternative = false;
    if (topTradersLS[sym] && topTradersLS[sym].accounts && topTradersLS[sym].accounts.length) {
      var topLatest = topTradersLS[sym].accounts[topTradersLS[sym].accounts.length - 1];
      if (topLatest.long > 0.55) hasStrongAlternative = true;
    }
    try { var vp = calcVPIN(sym); if (vp && vp.vpin > 0.5) hasStrongAlternative = true; } catch(e) {}
    try { var ice6 = detectIceberg(sym); if (ice6 && ice6.signal === 'ICEBERG_BUY') hasStrongAlternative = true; } catch(e) {}
    try { var cvd6 = analyzeCVD(sym); if (cvd6 && cvd6.divergence === 'BULLISH') hasStrongAlternative = true; } catch(e) {}
    if (CBP[sym] && T[sym] && T[sym].p > 0 && ((CBP[sym] - T[sym].p) / T[sym].p) > 0.002) hasStrongAlternative = true;
    if (hasStrongAlternative) g6 = true;
  }
  results.push({name: lang === 'ar' ? 'دعم حيتان' : 'Whale support', pass: g6});
  if (!g6) pass = false;  /* g6 already true for type==='fast' */

  /* Gate 7 — Max open trades (UNCHANGED) */
  var openCount = activeTrades ? activeTrades.filter(function(x){return x.status==='OPEN'}).length : 0;
  var g7 = openCount < 5;
  results.push({name: lang === 'ar' ? 'حد الصفقات (<5)' : 'Max trades (<5)', pass: g7, detail: openCount+'/5'});
  if (!g7) pass = false;

  /* Gate 8 — Hour block (FIXED: require 5+ trades AND <20% win rate) */
  var hr = new Date().getUTCHours();
  var hourStat = monitorState && monitorState.hourStats ? monitorState.hourStats[String(hr)] : null;
  var g8 = !hourStat || hourStat.rate >= 20 || hourStat.total < 5;
  results.push({name: lang === 'ar' ? 'ساعة مناسبة' : 'Good hour', pass: g8, detail: hourStat ? hourStat.rate+'%' : '--'});
  if (!g8) pass = false;

  try {
    addVLog(pass ? '✅' : '🚫',
      (pass ? '' : '⛔ ') + sym + ' ' + type + ' — Gate: ' + results.filter(function(r) { return r.pass; }).length + '/8 ' +
      (pass ? (lang === 'ar' ? 'مرّ' : 'PASS') : (lang === 'ar' ? 'مرفوض: ' + results.filter(function(r) { return !r.pass; }).map(function(r) { return r.name; }).join(', ') : 'BLOCKED: ' + results.filter(function(r) { return !r.pass; }).map(function(r) { return r.name; }).join(', ')))
    );
  } catch(e) {}

  try { trackGateRejection(sym, type, results, pass); } catch(e) {}
  return { pass: pass, results: results, marketDanger: mkt, failPattern: failPat };
}

/* Weekly auto-improve — comprehensive */
function runAutoImprove() {
  if (!monitorState || monitorState.perf.totalTrades < 10) return null;

  var report = {
    time: Date.now(),
    before: {
      weights: JSON.parse(JSON.stringify(monitorState.weights)),
      minConf: monitorState.minConf,
      blacklist: monitorState.coinBlacklist.slice(),
      overallRate: monitorState.perf.overallRate
    },
    changes: []
  };

  var tuneResult = autoTuneWeights();
  if (tuneResult) {
    report.changes.push(lang === 'ar'
      ? 'أوزان: أفضل ' + tuneResult.best + ' (' + tuneResult.bestRate + '%) — أضعف ' + tuneResult.worst + ' (' + tuneResult.worstRate + '%)'
      : 'Weights: Best ' + tuneResult.best + ' (' + tuneResult.bestRate + '%) — Worst ' + tuneResult.worst + ' (' + tuneResult.worstRate + '%)');
  }

  var patterns = detectFailPatterns();
  if (patterns && patterns.length > 0) {
    report.changes.push(lang === 'ar'
      ? 'أنماط فشل: ' + patterns.length + ' نمط مكتشف — أخطر: ' + patterns[0].label
      : 'Fail patterns: ' + patterns.length + ' found — Worst: ' + patterns[0].label);
  }

  var removedFromBL = [];
  var addedToBL = [];
  Object.keys(monitorState.coinStats).forEach(function(coin) {
    var cs = monitorState.coinStats[coin];
    var inBL = monitorState.coinBlacklist.indexOf(coin) !== -1;
    if (cs.total >= 3 && cs.rate < 30 && !inBL) {
      monitorState.coinBlacklist.push(coin);
      addedToBL.push(coin);
    }
    if (cs.total >= 5 && cs.rate >= 55 && inBL) {
      monitorState.coinBlacklist.splice(monitorState.coinBlacklist.indexOf(coin), 1);
      removedFromBL.push(coin);
    }
  });
  if (addedToBL.length) report.changes.push((lang === 'ar' ? 'حُظرت: ' : 'Blacklisted: ') + addedToBL.join(', '));
  if (removedFromBL.length) report.changes.push((lang === 'ar' ? 'رُفع الحظر: ' : 'Unblocked: ') + removedFromBL.join(', '));

  var oldConf = monitorState.minConf;
  if (monitorState.perf.overallRate < 50) {
    monitorState.minConf = Math.min(75, monitorState.minConf + 5);
  } else if (monitorState.perf.overallRate < 60) {
    monitorState.minConf = Math.min(70, monitorState.minConf + 2);
  } else if (monitorState.perf.overallRate > 75) {
    monitorState.minConf = Math.max(45, monitorState.minConf - 3);
  }
  if (oldConf !== monitorState.minConf) {
    report.changes.push((lang === 'ar' ? 'حد الثقة: ' : 'Min confidence: ') + oldConf + '% \u2192 ' + monitorState.minConf + '%');
  }

  report.after = {
    weights: JSON.parse(JSON.stringify(monitorState.weights)),
    minConf: monitorState.minConf,
    blacklist: monitorState.coinBlacklist.slice(),
    overallRate: monitorState.perf.overallRate
  };

  try { localStorage.setItem('nxWeeklyReport', JSON.stringify(report)); } catch(e) {}
  monitorState.lastTune = Date.now();
  saveMonitor();

  addVLog('🧠', (lang === 'ar'
    ? 'تحسين أسبوعي: ' + report.changes.length + ' تعديل — النسبة: ' + monitorState.perf.overallRate + '%'
    : 'Weekly improve: ' + report.changes.length + ' changes — Rate: ' + monitorState.perf.overallRate + '%'));

  return report;
}

/* ═══ MONITOR PANEL SHORTCUT (logo tap → monitor page — no admin auth) ═══ */
function openAdminPanel(){try{openQA('monitor')}catch(e){}}
/* ═══ END MONITOR ═══ */
/* CACHE */
var cache={scan:null,scanTime:0,whale:null,whaleTime:0,fr:null,frTime:0};
var CACHE_TTL=60000;
const TR={nav_home:{ar:'الرئيسية',en:'Home'},nav_scan:{ar:'السكانر',en:'Scanner'},nav_whale:{ar:'حيتان',en:'Whales'},nav_ind:{ar:'مؤشرات',en:'Indicators'},nav_me:{ar:'حسابي',en:'Profile'},breakout:{ar:'بداية صعود',en:'Rising'},whales:{ar:'شراء حيتان',en:'Whale Buying'},whale_sell:{ar:'بيع حيتان',en:'Whale Selling'},liquidity:{ar:'سيولة',en:'Liquidity'},my_trades:{ar:'صفقاتي',en:'My Trades'},my_stats:{ar:'إحصائياتي',en:'My Stats'},my_settings:{ar:'إعداداتي',en:'My Settings'},my_log:{ar:'سجل',en:'History'},notif_log:{ar:'سجل الإشعارات',en:'Notification History'},clear_log:{ar:'مسح السجل',en:'Clear History'},scanning:{ar:'جاري المسح...',en:'Scanning...'},all:{ar:'الكل',en:'All'},full_scan:{ar:'مسح شامل',en:'Full Scan'},refresh:{ar:'تحديث',en:'Refresh'},total:{ar:'إجمالي',en:'Total'},buying:{ar:'شراء',en:'Buying'},selling:{ar:'بيع',en:'Selling'},success:{ar:'النجاح',en:'Success'},portfolio:{ar:'المحفظة',en:'Portfolio'},risk_calc:{ar:'حاسبة المخاطر',en:'Risk Calc'},alerts:{ar:'تنبيهات',en:'Alerts'},add_coins:{ar:'أضف عملات',en:'Add coins'},add_coin:{ar:'إضافة عملة',en:'Add Coin'},add:{ar:'إضافة',en:'Add'},cancel:{ar:'إلغاء',en:'Cancel'},back:{ar:'رجوع',en:'Back'},capital:{ar:'رأس المال',en:'Capital'},risk_pct:{ar:'المخاطرة',en:'Risk'},entry_price:{ar:'سعر الدخول',en:'Entry'},enter_data:{ar:'ادخل البيانات',en:'Enter data'},search_ph:{ar:'ابحث عن أي عملة...',en:'Search any coin...'},no_ultra:{ar:'لا ULTRA حالياً',en:'No ULTRA'},no_whale:{ar:'لا تجميع حيتان',en:'No whales'},confirmed:{ar:'مؤكدة',en:'Confirmed'},buy_strong:{ar:'شراء قوي',en:'Strong Buy'},buy:{ar:'شراء',en:'Buy'},sell:{ar:'بيع',en:'Sell'},hold:{ar:'انتظار',en:'Hold'},risk_amt:{ar:'💰 المخاطرة',en:'💰 Risk'},pos_size:{ar:'📦 الحجم',en:'📦 Size'},pos_val:{ar:'💵 القيمة',en:'💵 Value'},leverage:{ar:'📊 الرافعة',en:'📊 Leverage'},exp_profit:{ar:'🎯 الربح',en:'🎯 Profit'},sl_loss:{ar:'🛑 الخسارة',en:'🛑 Loss'},no_data:{ar:'لا بيانات',en:'No data'},empty_port:{ar:'فارغة',en:'Empty'},market_health:{ar:'🏥 صحة السوق',en:'🏥 Market Health'},smart_warn:{ar:'تحذيرات ذكية',en:'Smart Warnings'},sec_accuracy:{ar:'📈 نسبة النجاح',en:'📈 Accuracy'},scan_desc:{ar:'صيد مبكر — 6 فحوصات — 🏆 Top 100 Focus','en':'Early detection — 6 checks — 🏆 Top 100 Focus'},days:{ar:'يوم',en:'days'},today:{ar:'اليوم!',en:'Today!'},instant:{ar:'فوري',en:'Instant'},strong_signal:{ar:'شراء/بيع قوي',en:'Strong signal'},before_unlock:{ar:'قبل الفك',en:'Before unlock'},gems:{ar:'جواهر',en:'Gems'},gem_desc:{ar:'💎 عملات صغيرة بحركة غير عادية — فرص أرباح كبيرة',en:'💎 Small caps with unusual moves — big profit potential'},wl_desc:{ar:'👁 أضف عملات لمراقبتها 24/7',en:'👁 Add coins to watch 24/7'},stable_flow:{ar:'حركة الأموال',en:'Money Flow'},sf_index:{ar:'مؤشر التدفق',en:'Flow Index'},sf_buy:{ar:'شراء كريبتو',en:'Buying Crypto'},sf_sell:{ar:'بيع كريبتو',en:'Selling Crypto'},sf_neutral:{ar:'متوازن',en:'Balanced'},online:{ar:'متصل',en:'online'},settings:{ar:'الإعدادات',en:'Settings'},profile:{ar:'👤 الملف الشخصي',en:'👤 Profile'},general:{ar:'⚙️ عام',en:'⚙️ General'},language:{ar:'اللغة',en:'Language'},theme:{ar:'الثيم',en:'Theme'},sound:{ar:'الصوت',en:'Sound'},tone:{ar:'🔔 نغمة الإشعار',en:'🔔 Notification Tone'},t_bell:{ar:'جرس',en:'Bell'},t_horn:{ar:'بوق',en:'Horn'},t_pulse:{ar:'نبض',en:'Pulse'},t_silent:{ar:'صامت',en:'Silent'},about:{ar:'عن المنصة',en:'About'},clear_data:{ar:'مسح البيانات',en:'Clear Data'},mkt_dir:{ar:'اتجاه السوق',en:'Market Direction'},mkt_dir_sub:{ar:'تقرير مفصل — BTC & ETH — كل 4 ساعات',en:'Detailed Report — BTC & ETH — Every 4h'},nav_market:{ar:'حركة السوق',en:'Market'},top3:{ar:'🏆 أقوى 3 صفقات مضاربة VIP',en:'🏆 Top 3 VIP Trades'},scan_trade:{ar:'صفقات مضاربة',en:'Trading'},scan_trend:{ar:'ترند القطاعات',en:'Sector Trends'},scan_gems:{ar:'صيد الجواهر',en:'Gem Hunter'},scan_all:{ar:'الكل',en:'All'},scan_fast:{ar:'⚡ سريع',en:'⚡ Fast'},scan_daily:{ar:'📊 يومي',en:'📊 Daily'},scan_early:{ar:'🟢 مبكر',en:'🟢 Early'},scan_still:{ar:'🟡 فرصة',en:'🟡 Still'},scan_late:{ar:'🔴 متأخر',en:'🔴 Late'},scan_signals:{ar:'إشارة',en:'signals'},scan_sectors:{ar:'قطاعات',en:'sectors'},scan_gems_found:{ar:'جواهر مكتشفة',en:'gems found'},scan_updated:{ar:'آخر تحديث',en:'Updated'},scan_enter:{ar:'▶ ادخل',en:'▶ Enter'},scan_chart:{ar:'📈 شارت',en:'📈 Chart'},scan_duration:{ar:'مدة متوقعة',en:'Duration'},scan_warn_small:{ar:'⚠️ ربح عالي + مخاطرة عالية — لا تدخل أكثر من 5% من رأس مالك!',en:'⚠️ High profit + High risk — max 5% of capital!'},mkt_daily:{ar:'تحليل يومي',en:'Daily Analysis'},mkt_full:{ar:'تقرير شامل',en:'Full Report'},mkt_hourly:{ar:'كل ساعة',en:'Hourly'},mkt_4h:{ar:'كل 4 ساعات — 12 طبقة',en:'Every 4h — 12 layers'},mkt_fresh:{ar:'بيانات طازجة',en:'Fresh data'},mkt_stale:{ar:'بيانات قديمة — حدّث!',en:'Stale — Refresh!'},scan_coins_loaded:{ar:'عملات',en:'Coins'},scan_source:{ar:'المصدر',en:'Source'}};
function t(k){return TR[k]?TR[k][lang]:(k||'')}
/* fmt/fP/esc/safeC/calcRSI/calcMACD/calcEMA moved to src/utils.js */
var apiCooldown={until:0,reason:''};
async function fj(u){
  if(Date.now()<apiCooldown.until)return null;
  try{
    var c=new AbortController();var tm=setTimeout(function(){c.abort()},8000);
    var t0=Date.now();var r=await fetch(u,{signal:c.signal});clearTimeout(tm);
    connMetrics.lastLatency=Date.now()-t0;
    if(r.status===429){apiCooldown.until=Date.now()+60000;apiCooldown.reason='429 Rate Limited';connMetrics.apiFail++;return null}
    if(r.status===418){apiCooldown.until=Date.now()+300000;apiCooldown.reason='418 IP Banned';connMetrics.apiFail++;return null}
    if(r.status===403){apiCooldown.until=Date.now()+600000;apiCooldown.reason='403 Forbidden';connMetrics.apiFail++;return null}
    if(!r.ok){connMetrics.apiFail++;return null}
    connMetrics.apiOk++;return r.json()
  }catch(e){connMetrics.apiFail++;return null}
}
function timeAgo(ts){var d=Date.now()-ts,m=Math.floor(d/60000),h=Math.floor(d/3600000);if(m<2)return{text:lang==='ar'?'🆕 الآن':'🆕 Now',cls:'fresh'};if(m<60)return{text:lang==='ar'?'منذ '+m+' دقيقة':m+'m ago',cls:'fresh'};return{text:lang==='ar'?'منذ '+h+' ساعة':h+'h ago',cls:h<6?'':'old'}}
function timeBadge(ts){var a=timeAgo(ts);return'<span class="time-badge '+a.cls+'">⏱ '+a.text+'</span>'}
function recSig(sym,type,price){
  var k=sym+'_'+type;var now=Date.now();var existing=sigHist[k];
  /* Migrate legacy number entries: preserve firstSeen, set lastSeen=now so
     the freshness check below doesn't immediately overwrite the migration. */
  if(typeof existing==='number'){
    existing={firstSeen:existing,lastSeen:now,priceAtDetection:price||0,count:1};
    sigHist[k]=existing;
  }
  if(!existing||(now-existing.lastSeen>3600000)){
    sigHist[k]={firstSeen:now,lastSeen:now,priceAtDetection:price||0,count:1};
  }else{
    existing.lastSeen=now;existing.count++;
  }
  try{localStorage.setItem('nxsig10',JSON.stringify(sigHist))}catch(e){}
  return sigHist[k];
}
function getSigTime(sym,type){var v=sigHist[sym+'_'+type];if(!v)return Date.now();if(typeof v==='number')return v;return v.firstSeen||Date.now()}
/* NOTIFICATION HISTORY */
var notifHist=[];try{notifHist=JSON.parse(localStorage.getItem('nxnh10')||'[]')}catch(e){}
function addNotifHist(icon,sym,type,body){notifHist.unshift({icon:icon,sym:sym,type:type,body:body,time:Date.now()});if(notifHist.length>50)notifHist=notifHist.slice(0,50);try{localStorage.setItem('nxnh10',JSON.stringify(notifHist))}catch(e){}}
function renderNotifHist(){var el=document.getElementById('notifHistList');if(!el)return;el.innerHTML=notifHist.length?notifHist.slice(0,20).map(function(n){return'<div class="al-i" style="cursor:pointer" onclick="openCoin(\''+esc(n.sym)+'\')"><div class="al-l"><div style="font-size:18px">'+esc(n.icon)+'</div><div><div style="font-weight:600;font-size:11px">'+esc(n.sym)+' — '+esc(n.type)+'</div><div style="font-size:8px;color:var(--t3)">'+esc(n.body)+'</div></div></div><div style="font-size:8px;font-family:var(--fm);color:var(--t2)">'+timeBadge(n.time)+'</div></div>'}).join(''):'<div class="empty"><div class="empty-ic">🔔</div><div class="empty-tx">'+(lang==='ar'?'لا إشعارات':'No notifications')+'</div></div>'}
/* WATCHLIST ALERTS — check every update */
function checkWatchlistAlerts(){var wl=[];try{wl=JSON.parse(localStorage.getItem('nxwl10')||'[]')}catch(e){};wl.forEach(function(sym){var d=T[sym];if(!d)return;if(d.c>=3){var k='wl_'+sym+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;try{localStorage.setItem('nxnot10',JSON.stringify(notifiedSet))}catch(e){};playSound('whale');showPopup('👁',sym+' — '+(lang==='ar'?'عملة مراقبة تحركت!':'Watchlist coin moved!'),'+'+d.c.toFixed(1)+'% | '+fP(d.p));addNotifHist('👁',sym,'Watchlist','+'+d.c.toFixed(1)+'%')}}if(d.c<=-3){var k='wl_dn_'+sym+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;try{localStorage.setItem('nxnot10',JSON.stringify(notifiedSet))}catch(e){};playSound('whale');showPopup('⚠️',sym+' — '+(lang==='ar'?'عملة مراقبة هبطت!':'Watchlist coin dropped!'),d.c.toFixed(1)+'% | '+fP(d.p));addNotifHist('⚠️',sym,'Watchlist Drop',d.c.toFixed(1)+'%')}}})}/* SOUND NOTIFICATIONS — respects user tone preference */
function playSound(type){if(!soundEnabled||soundPref==='silent')return;previewTone(soundPref)}
/* 📲 TELEGRAM — SECURE PROXY (no token exposed!) */
var TG_PROXY = PROXY + '/notify';
var tgSent = {};
if (/your-nexus-proxy|placeholder|example\.com/i.test(TG_PROXY)) {
  console.warn('[TG] TG_PROXY looks like a placeholder — Telegram notifications disabled:', TG_PROXY);
}
function sendTG(html) {
  if (/your-nexus-proxy|placeholder|example\.com/i.test(TG_PROXY)) return;
  try {
    fetch(TG_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: html })
    }).catch(function(e){ console.warn('[TG] send failed:', e); });
  } catch(e) { console.warn('[TG] send threw:', e); }
}
function tgNotify(sym,type,data){
  /* Dedup: same coin+type per hour */
  var k=sym+'_'+type+'_'+new Date().getHours();if(tgSent[k])return;tgSent[k]=true;
  var d=T[sym]||{p:0,c:0,v:0};var fr=FR[sym];var waves=whaleWaves[sym]?whaleWaves[sym].waves:[];
  var src=[];if(T[sym])src.push('Binance');if(d.by)src.push('Bybit');if(CBP[sym])src.push('Coinbase');
  var msg='';
  if(type==='ultra'){
    var checks=data.checks||{};var passed=data.passed||0;var total=data.total||6;
    msg='⭐ <b>ULTRA SIGNAL — '+sym+'/USDT</b>\n\n'
      +'📊 Score: <b>'+data.score+'</b> | '+passed+'/'+total+' Checks ✅\n'
      +'💰 <b>'+fP(d.p)+'</b> ('+(d.c>=0?'+':'')+d.c.toFixed(1)+'%)\n'
      +'📈 Vol: <b>'+fmt(d.v)+'</b>\n\n'
      +'✅ VOL '+(checks.vol?'✅':'❌')+' │ OB '+(checks.ob?'✅':'❌')+'\n'
      +'✅ RSI '+(checks.rsi?'✅':'❌')+' │ MACD '+(checks.macd?'✅':'❌')+'\n'
      +'✅ FR '+(checks.fr?'✅':'❌')+' │ OI '+(checks.oi?'✅':'❌')+'\n\n'
      +'🎯 هدف: <b>'+fP(d.p*1.08)+' — '+fP(d.p*1.15)+'</b>\n'
      +'🛑 وقف: <b>'+fP(d.p*0.93)+'</b>\n'
      +(waves.length>=2?'\n🐋 '+waves.length+' موجات حيتان | ⚡ تجميع قوي\n':'')
      +(fr?'\n💰 FR: '+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%\n':'')
      +'\n📍 '+src.join(' · ')+'\n'
      +'━━━━━━━━━━━━━━━━━\n'
      +'🤖 <b>NEXUS PRO</b> | ⏱ '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
  else if(type==='whale'){
    var waveCount=waves.length;
    msg='🐋 <b>'+(waveCount>=3?'🐋🐋🐋':'🐋')+' تجميع حيتان — '+sym+'/USDT</b>\n\n'
      +'💰 <b>'+fP(d.p)+'</b> ('+(d.c>=0?'+':'')+d.c.toFixed(1)+'%)\n'
      +'📈 Vol: '+fmt(d.v)+'\n';
    if(waveCount>0){
      msg+='\n📊 <b>'+waveCount+' موجات تجميع:</b>\n';
      waves.forEach(function(w,i){
        msg+='🐋 #'+(i+1)+' | '+fmt(w.amount)+' | '+fP(w.price)+'\n'});
      var tot=waves.reduce(function(s,w){return s+w.amount},0);
      msg+='\n💎 إجمالي: <b>'+fmt(tot)+'</b>\n'}
    msg+='\n📍 '+src.join(' · ')+'\n'
      +'━━━━━━━━━━━━━━━━━\n'
      +'🤖 <b>NEXUS PRO</b> | ⏱ '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
  else if(type==='gem'){
    msg='💎 <b>جوهرة مكتشفة — '+sym+'/USDT</b>\n\n'
      +'💰 <b>'+fP(d.p)+'</b> ('+(d.c>=0?'+':'')+d.c.toFixed(1)+'%)\n'
      +'📈 Vol: '+fmt(d.v)+'\n'
      +(d.c<3?'\n🟢 <b>صيد مبكر — ادخل!</b>\n':d.c<8?'\n🟡 لسا فيه فرصة\n':'\n🔴 متأخر — راقب فقط\n')
      +'\n📍 '+src.join(' · ')+'\n'
      +'━━━━━━━━━━━━━━━━━\n'
      +'🤖 <b>NEXUS PRO</b> | ⏱ '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}
  if(msg)sendTG(msg)}
/* ON-SCREEN POPUP NOTIFICATION */
function showPopup(icon,title,body){var el=document.getElementById('notifPopup');document.getElementById('npIcon').textContent=icon;document.getElementById('npTitle').textContent=title;document.getElementById('npBody').textContent=body;document.getElementById('npTime').textContent='🆕';el.style.top='12px';setTimeout(function(){el.style.top='-80px'},4000)}
function notify(sym,type,score,extra){var k=sym+'_'+type+'_'+new Date().getHours();if(notifiedSet[k])return;
  /* Block small coin (gem) notifications */
  if(type==='gem')return;
  /* Whale: only notify if total buy volume > $100,000 */
  if(type==='whale'){var ww=whaleWaves[sym];if(!ww||!ww.engine||!ww.totalBuy||ww.totalBuy<100000)return}
  /* === QUALITY GATE === */
  try{var gate=signalQualityGate(sym,type,score);if(!gate.pass){notifiedSet[k]=true;try{localStorage.setItem('nxnot10',JSON.stringify(notifiedSet))}catch(e){}return}}catch(e){}
  notifiedSet[k]=true;try{localStorage.setItem('nxnot10',JSON.stringify(notifiedSet))}catch(e){}playSound(type);
  if(type==='ultra'){showPopup('⭐',sym+' — ULTRA Signal!','Score: '+score+' | '+(lang==='ar'?'ادخل الآن!':'Enter now!'));addNotifHist('⭐',sym,'ULTRA','Score: '+score);tgNotify(sym,'ultra',extra||{score:score});if(T[sym])openTrade(sym,T[sym].p,'ultra',score,extra)}
  else if(type==='whale'){var wVol=whaleWaves[sym]?whaleWaves[sym].totalBuy:0;showPopup('🐋',sym+' — '+(lang==='ar'?'تجميع حيتان!':'Whale detected!'),'$'+fmt(wVol));addNotifHist('🐋',sym,lang==='ar'?'حوت':'Whale','$'+fmt(wVol));tgNotify(sym,'whale',{});if(T[sym])openTrade(sym,T[sym].p,'whale',score)}
}
/* LANG/THEME/NAV */
function togLang(){lang=lang==='ar'?'en':'ar';try{localStorage.setItem('nxlang',lang)}catch(e){};document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.body.dataset.lang=lang;var sI=document.getElementById('sInp');if(sI)sI.placeholder=t('search_ph');document.querySelectorAll('[data-t]').forEach(function(el){var k=el.dataset.t;if(TR[k])el.textContent=TR[k][lang]});updateMenuLang()}
function togTh(){var d=document.body.dataset.theme==='dark'?'light':'dark';document.body.dataset.theme=d;if(tg){try{tg.setHeaderColor(d==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(d==='dark'?'#020408':'#f0f4f8')}catch(e){}}try{localStorage.setItem('nxt10',d)}catch(e){};updateMenuTheme()}
function setLang(l){lang=l;try{localStorage.setItem('nxlang',lang)}catch(e){};document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.body.dataset.lang=lang;var sI=document.getElementById('sInp');if(sI)sI.placeholder=t('search_ph');document.querySelectorAll('[data-t]').forEach(function(el){var k=el.dataset.t;if(TR[k])el.textContent=TR[k][lang]});updateMenuLang()}
function setTheme(d){document.body.dataset.theme=d;if(tg){try{tg.setHeaderColor(d==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(d==='dark'?'#020408':'#f0f4f8')}catch(e){}}try{localStorage.setItem('nxt10',d)}catch(e){};updateMenuTheme()}
/* SIDEBAR MENU */
function toggleMenu(){var sm=document.getElementById('sideMenu');var so=document.getElementById('sideOverlay');if(!sm||!so)return;sm.classList.toggle('open');so.classList.toggle('open')}
/* PROFILE */
var userProfile={};try{userProfile=JSON.parse(localStorage.getItem('nxprof10')||'{}')}catch(e){}
function loadProfile(){if(userProfile.name)document.getElementById('userName').value=userProfile.name;if(userProfile.nick)document.getElementById('userNick').value=userProfile.nick;var av=document.getElementById('sideAvatar');if(userProfile.name)av.textContent=userProfile.name.charAt(0).toUpperCase();else av.textContent='👤'}
function saveProfile(){userProfile.name=document.getElementById('userName').value;userProfile.nick=document.getElementById('userNick').value;try{localStorage.setItem('nxprof10',JSON.stringify(userProfile))}catch(e){};var av=document.getElementById('sideAvatar');if(userProfile.name)av.textContent=userProfile.name.charAt(0).toUpperCase()}
/* MENU STATE SYNC */
function updateMenuLang(){var isAr=lang==='ar';document.getElementById('sLangAr').classList.toggle('act',isAr);document.getElementById('sLangEn').classList.toggle('act',!isAr)}
function updateMenuTheme(){var isDark=document.body.dataset.theme==='dark';document.getElementById('sThDark').classList.toggle('act',isDark);document.getElementById('sThLight').classList.toggle('act',!isDark)}
/* SOUND PREFERENCES */
var soundPref='bell';try{soundPref=localStorage.getItem('nxsnd10')||'bell'}catch(e){}
var soundEnabled=true;try{soundEnabled=localStorage.getItem('nxsndon10')!=='off'}catch(e){}
function saveSoundPref(){var el=document.getElementById('tglSound');if(el)soundEnabled=el.classList.contains('on');try{localStorage.setItem('nxsndon10',soundEnabled?'on':'off')}catch(e){}}
function selTone(el){document.querySelectorAll('.tone-opt').forEach(function(o){o.classList.remove('act')});el.classList.add('act');soundPref=el.dataset.tone;try{localStorage.setItem('nxsnd10',soundPref)}catch(e){};previewTone(soundPref)}
function previewTone(tone){if(tone==='silent')return;try{var ac=new(window.AudioContext||window.webkitAudioContext)();var osc=ac.createOscillator();var gain=ac.createGain();osc.connect(gain);gain.connect(ac.destination);
  if(tone==='bell'){osc.frequency.value=880;osc.type='sine';gain.gain.value=0.3;osc.start();osc.stop(ac.currentTime+0.15);setTimeout(function(){var o2=ac.createOscillator();var g2=ac.createGain();o2.connect(g2);g2.connect(ac.destination);g2.gain.value=0.3;o2.frequency.value=1100;o2.type='sine';o2.start();o2.stop(ac.currentTime+0.15)},180)}
  else if(tone==='horn'){osc.frequency.value=440;osc.type='sawtooth';gain.gain.value=0.35;osc.start();osc.stop(ac.currentTime+0.4)}
  else if(tone==='pulse'){osc.frequency.value=1000;osc.type='square';gain.gain.value=0.2;osc.start();osc.stop(ac.currentTime+0.08);setTimeout(function(){var o2=ac.createOscillator();var g2=ac.createGain();o2.connect(g2);g2.connect(ac.destination);g2.gain.value=0.2;o2.frequency.value=1000;o2.type='square';o2.start();o2.stop(ac.currentTime+0.08)},120);setTimeout(function(){var o3=ac.createOscillator();var g3=ac.createGain();o3.connect(g3);g3.connect(ac.destination);g3.gain.value=0.2;o3.frequency.value=1200;o3.type='square';o3.start();o3.stop(ac.currentTime+0.12)},240)}
  }catch(e){}}
function loadToneUI(){var opts=document.querySelectorAll('.tone-opt');opts.forEach(function(o){o.classList.remove('act');if(o.dataset.tone===soundPref)o.classList.add('act')});if(!soundEnabled)document.getElementById('tglSound').classList.remove('on')}
/* Active users removed */
(function(){try{if(localStorage.getItem('nxt10')==='light'){document.body.dataset.theme='light'}}catch(e){};if(lang==='en')togLang()})();
document.querySelectorAll('.bb').forEach(function(b){b.onclick=function(){sp(b.dataset.p)}});
function sp(id){document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('act')});document.querySelectorAll('.bb').forEach(function(b){b.classList.remove('act')});var el=document.getElementById('pg-'+id);if(el)el.classList.add('act');document.querySelectorAll('[data-p="'+id+'"]').forEach(function(b){b.classList.add('act')});if(id==='scan')scanTab(curScanTab,document.querySelector('#pg-scan .big-tab.act'));if(id==='whale')loadWhales();if(id==='ind')loadInd();if(id==='me')renderPort();if(id==='market')loadMarket();window.scrollTo({top:0})}
function openMo(id){var e=document.getElementById(id);if(e)e.classList.add('show')}
function closeMo(id){var e=document.getElementById(id);if(e)e.classList.remove('show')}
document.querySelectorAll('.mo').forEach(function(m){m.onclick=function(e){if(e.target===m)m.classList.remove('show')}});
/* indTab removed — accordion cards */
function whTab(i,btn){document.getElementById('pg-whale').querySelectorAll('.big-tab').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');['wh0','wh1','wh2'].forEach(function(id,j){var el=document.getElementById(id);if(el)el.style.display=([0,1,2].indexOf(i)===j)?'block':'none'});if(i===0)loadWhales();if(i===1)loadLiq();if(i===2)loadWhaleSells()}
function pTab(i,btn){document.getElementById('pg-me').querySelectorAll('.big-tab').forEach(function(b){b.classList.remove('act')});if(btn)btn.classList.add('act');['p0','p1','p2','p3','p4'].forEach(function(id,j){var el=document.getElementById(id);if(el)el.style.display=j===i?'block':'none'});if(i===1)renderMyTrades();if(i===2)renderMyStats();if(i===3)renderMySettings();if(i===4)renderNotifHist()}
/* ═══ 📋 MY TRADES ═══ */
function renderMyTrades(){
  var el=document.getElementById('myTradesPanel');if(!el)return;var ar=lang==='ar';var h='';
  h+='<div style="font-weight:800;font-size:14px;color:var(--t0);margin:0 0 8px">📋 '+(ar?'صفقات مفتوحة':'Open Trades')+'</div>';
  var openTrades=activeTrades.filter(function(x){return x.status==='OPEN'});
  if(openTrades.length){
    openTrades.forEach(function(tr){
      var d=T[tr.sym];var cp=d?d.p:0;var pnl=tr.entry>0?((cp-tr.entry)/tr.entry*100):0;if(tr.type==='SHORT')pnl=-pnl;
      var pCol=pnl>=0?'var(--up)':'var(--dn)';
      h+='<div class="cd" style="padding:10px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:center">';
      h+='<div><div style="font-weight:800;font-size:13px;color:var(--t0)">'+tr.sym+'/USDT</div><div style="font-size:10px;color:var(--t2)">'+tr.type+' — '+(ar?'دخول: ':'Entry: ')+fP(tr.entry)+'</div></div>';
      h+='<div style="text-align:left"><div style="font-family:var(--fm);font-size:14px;font-weight:800;color:'+pCol+';direction:ltr">'+(pnl>=0?'+':'')+pnl.toFixed(1)+'%</div><div style="font-family:var(--fm);font-size:10px;color:var(--t2);direction:ltr">'+fP(cp)+'</div></div></div>';
      if(tr.tp1)h+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:10px;margin-top:6px;border-top:1px solid var(--bdr)"><span style="color:var(--t2)">🎯 TP1</span><span style="font-family:var(--fm);color:var(--up);direction:ltr">'+fP(tr.tp1)+'</span></div>';
      if(tr.sl)h+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:10px"><span style="color:var(--t2)">🛑 SL</span><span style="font-family:var(--fm);color:var(--dn);direction:ltr">'+fP(tr.sl)+'</span></div>';
      h+='</div>';
    });
  }else{h+='<div class="empty"><div class="empty-ic">📋</div><div class="empty-tx">'+(ar?'لا صفقات مفتوحة':'No open trades')+'</div></div>';}
  h+='<div style="font-weight:800;font-size:14px;color:var(--t0);margin:16px 0 8px">📜 '+(ar?'آخر الصفقات المغلقة':'Recent Closed')+'</div>';
  var logs=typeof factorLog!=='undefined'?factorLog.slice(-15).reverse():[];
  if(logs.length){
    logs.forEach(function(lg){
      var isWin=lg.outcome==='win'||lg.outcome==='partial';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bdr);font-size:11px">';
      h+='<span style="font-weight:700;min-width:40px">'+lg.sym+'</span>';
      h+='<span style="color:'+(isWin?'var(--up)':'var(--dn)')+';font-weight:700">'+(isWin?'✅ '+(ar?'ربح':'Win'):'❌ '+(ar?'خسارة':'Loss'))+'</span>';
      h+='<span style="font-family:var(--fm);font-size:9px;color:var(--t3)">'+new Date(lg.time).toLocaleDateString('en',{month:'short',day:'numeric'})+'</span></div>';
    });
  }else{h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:10px">'+(ar?'لا صفقات مغلقة بعد':'No closed trades yet')+'</div>';}
  el.innerHTML=h;
}
/* ═══ 📊 MY STATS ═══ */
function renderMyStats(){
  var el=document.getElementById('myStatsPanel');if(!el)return;var ar=lang==='ar';
  var ms=monitorState||{perf:{overallRate:0,totalTrades:0,totalWins:0,totalLosses:0,bestHour:-1,worstHour:-1},coinStats:{},hourStats:{},coinBlacklist:[]};
  var perf=ms.perf;var h='';
  h+='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:12px">';
  h+='<div class="cd" style="padding:12px;text-align:center"><div style="font-family:var(--fm);font-size:24px;font-weight:800;color:'+(perf.overallRate>=65?'var(--up)':perf.overallRate>=50?'var(--warn)':'var(--dn)')+'">'+perf.overallRate+'%</div><div style="font-size:10px;color:var(--t2)">'+(ar?'نسبة النجاح':'Win Rate')+'</div></div>';
  h+='<div class="cd" style="padding:12px;text-align:center"><div style="font-family:var(--fm);font-size:24px;font-weight:800;color:var(--neon)">'+perf.totalTrades+'</div><div style="font-size:10px;color:var(--t2)">'+(ar?'إجمالي':'Total')+'</div><div style="font-size:9px;color:var(--t3)">✅'+perf.totalWins+' ❌'+(perf.totalLosses||0)+'</div></div>';
  h+='<div class="cd" style="padding:12px;text-align:center"><div style="font-family:var(--fm);font-size:24px;font-weight:800;color:var(--up)">'+(perf.bestHour>=0?perf.bestHour+':00':'--')+'</div><div style="font-size:10px;color:var(--t2)">'+(ar?'أفضل ساعة':'Best Hour')+'</div></div>';
  h+='<div class="cd" style="padding:12px;text-align:center"><div style="font-family:var(--fm);font-size:24px;font-weight:800;color:var(--dn)">'+(perf.worstHour>=0?perf.worstHour+':00':'--')+'</div><div style="font-size:10px;color:var(--t2)">'+(ar?'أسوأ ساعة':'Worst Hour')+'</div></div></div>';
  var coins=Object.entries(ms.coinStats).sort(function(a,b){return(b[1].rate||0)-(a[1].rate||0)});
  if(coins.length){
    h+='<div style="font-weight:800;font-size:13px;color:var(--t0);margin:10px 0 6px">🏆 '+(ar?'أفضل العملات':'Best Coins')+'</div><div class="cd" style="padding:10px">';
    coins.slice(0,5).forEach(function(e){var s=e[0],c=e[1];h+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:11px"><span style="font-weight:700">'+s+'</span><span style="font-family:var(--fm);font-weight:700;color:var(--up)">'+c.rate+'%</span><span style="font-size:9px;color:var(--t3)">'+c.wins+'/'+c.total+'</span></div>';});
    h+='</div>';
    if(coins.length>5){
      h+='<div style="font-weight:800;font-size:13px;color:var(--t0);margin:10px 0 6px">⚠️ '+(ar?'أسوأ العملات':'Worst Coins')+'</div><div class="cd" style="padding:10px">';
      coins.slice(-3).reverse().forEach(function(e){var s=e[0],c=e[1];h+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:11px"><span style="font-weight:700">'+s+'</span><span style="font-family:var(--fm);font-weight:700;color:var(--dn)">'+c.rate+'%</span><span style="font-size:9px;color:var(--t3)">'+c.wins+'/'+c.total+'</span></div>';});
      h+='</div>';
    }
  }else{h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:10px">'+(ar?'تحتاج صفقات لعرض الإحصائيات':'Need trades to show stats')+'</div>';}
  el.innerHTML=h;
}
/* ═══ ⚙️ MY SETTINGS ═══ */
var alertPrefs={};try{alertPrefs=JSON.parse(localStorage.getItem('nxAlertPrefs')||'{}')}catch(e){alertPrefs={}}
function saveAlertPref(key,val){alertPrefs[key]=val;try{localStorage.setItem('nxAlertPrefs',JSON.stringify(alertPrefs))}catch(e){}}
function renderMySettings(){
  var el=document.getElementById('mySettingsPanel');if(!el)return;var ar=lang==='ar';var h='';
  h+='<div style="font-weight:800;font-size:14px;color:var(--t0);margin:0 0 10px">🌐 '+(ar?'اللغة':'Language')+'</div>';
  h+='<div style="display:flex;gap:6px;margin-bottom:14px"><button class="rfr" onclick="setLang(\'ar\');renderMySettings()" style="flex:1;margin:0;'+(lang==='ar'?'background:var(--ud);color:var(--up);border-color:var(--up)':'')+'">عربي</button><button class="rfr" onclick="setLang(\'en\');renderMySettings()" style="flex:1;margin:0;'+(lang==='en'?'background:var(--ud);color:var(--up);border-color:var(--up)':'')+'">English</button></div>';
  h+='<div style="font-weight:800;font-size:14px;color:var(--t0);margin:0 0 10px">🎨 '+(ar?'الثيم':'Theme')+'</div>';
  var isDark=document.body.dataset.theme==='dark';
  h+='<div style="display:flex;gap:6px;margin-bottom:14px"><button class="rfr" onclick="setTheme(\'dark\');renderMySettings()" style="flex:1;margin:0;'+(isDark?'background:var(--ud);color:var(--up);border-color:var(--up)':'')+'">🌙 '+(ar?'مظلم':'Dark')+'</button><button class="rfr" onclick="setTheme(\'light\');renderMySettings()" style="flex:1;margin:0;'+(!isDark?'background:var(--ud);color:var(--up);border-color:var(--up)':'')+'">☀️ '+(ar?'فاتح':'Light')+'</button></div>';
  h+='<div style="font-weight:800;font-size:14px;color:var(--t0);margin:0 0 10px">🔊 '+(ar?'الصوت':'Sound')+'</div>';
  h+='<div class="al-i"><div class="al-l"><div style="font-size:18px">🔊</div><div><div style="font-weight:600;font-size:12px">'+(ar?'تفعيل الصوت':'Enable Sound')+'</div></div></div><div class="tgl '+(soundEnabled?'on':'')+'" onclick="this.classList.toggle(\'on\');soundEnabled=!soundEnabled;try{localStorage.setItem(\'nxsndon10\',soundEnabled?\'on\':\'off\')}catch(e){}"><div class="tgl-k"></div></div></div>';
  h+='<div style="font-weight:800;font-size:14px;color:var(--t0);margin:14px 0 10px">🔔 '+(ar?'التنبيهات':'Alerts')+'</div>';
  var alerts=[{key:'ultra',ic:'⭐',nm:'ULTRA',sub:ar?'إشارات ≥85% ثقة':'Signals ≥85%'},{key:'whale',ic:'🐋',nm:ar?'حيتان':'Whales',sub:ar?'فوق $100K':'Above $100K'},{key:'breakout',ic:'💥',nm:ar?'انفجار':'Breakout',sub:'Score 60+'},{key:'warning',ic:'⚠️',nm:ar?'تحذيرات':'Warnings',sub:'FR + OI'},{key:'watchlist',ic:'👁',nm:'Watchlist',sub:ar?'تحرك ±3%':'Move ±3%'}];
  alerts.forEach(function(a){
    var isOn=alertPrefs[a.key]!==false;
    h+='<div class="al-i"><div class="al-l"><div style="font-size:18px">'+a.ic+'</div><div><div style="font-weight:600;font-size:12px">'+a.nm+'</div><div style="font-size:9px;color:var(--t3)">'+a.sub+'</div></div></div><div class="tgl '+(isOn?'on':'')+'" onclick="this.classList.toggle(\'on\');saveAlertPref(\''+a.key+'\',this.classList.contains(\'on\'))"><div class="tgl-k"></div></div></div>';
  });
  el.innerHTML=h;
}
/* ⚖️ calcRisk2 for QA page */
function calcRisk2(){var cap=+document.getElementById('rcCap2').value,risk=+document.getElementById('rcRisk2').value,entry=+document.getElementById('rcEntry2').value,sl=+document.getElementById('rcSL2').value,tp=+document.getElementById('rcTP2').value;if(!cap||!entry||!sl){document.getElementById('rcRes2').innerHTML='<div style="text-align:center;color:var(--t3);padding:12px;font-size:12px">'+t('enter_data')+'</div>';return};var rA=cap*(risk/100),slD=Math.abs(entry-sl),pos=slD>0?rA/slD:0,posV=pos*entry,rew=tp?pos*Math.abs(tp-entry):0,rr=tp&&rA>0?rew/rA:0,lev=cap>0?posV/cap:0;document.getElementById('rcRes2').innerHTML='<div class="rc-row"><span>'+t('risk_amt')+'</span><span class="rc-val" style="color:var(--dn)">'+fmt(rA)+'</span></div><div class="rc-row"><span>'+t('pos_size')+'</span><span class="rc-val">'+pos.toFixed(4)+'</span></div><div class="rc-row"><span>'+t('pos_val')+'</span><span class="rc-val">'+fmt(posV)+'</span></div><div class="rc-row"><span>'+t('leverage')+'</span><span class="rc-val" style="color:'+(lev>10?'var(--dn)':lev>5?'var(--warn)':'var(--up)')+'">'+lev.toFixed(1)+'x</span></div>'+(tp?'<div class="rc-row"><span>'+t('exp_profit')+'</span><span class="rc-val" style="color:var(--up)">'+fmt(rew)+'</span></div><div class="rc-row"><span>R/R</span><span class="rc-val" style="color:'+(rr>=2?'var(--up)':rr>=1?'var(--warn)':'var(--dn)')+'">1:'+rr.toFixed(1)+'</span></div>':'')+'<div class="rc-row"><span>'+t('sl_loss')+'</span><span class="rc-val" style="color:var(--dn)">-'+fmt(rA)+'</span></div>'}
var curScanTab=0,curTradeFilter='all',curSmallFilter='all',chartSignal=null;
var SECTORS={ai:{ic:'🤖',n:{ar:'ذكاء اصطناعي',en:'AI'},coins:['FET','RNDR','TAO','WLD','AKT','ARKM','OCEAN','AGIX','PRIME','CTXC','NMR'],col:'#7c3aed'},gaming:{ic:'🎮',n:{ar:'ألعاب وميتافيرس',en:'Gaming'},coins:['IMX','GALA','AXS','SAND','MANA','ENJ','PIXEL','BEAM','ILV','PORTAL','YGG','ALICE'],col:'#06b6d4'},layer1:{ic:'⛓️',n:{ar:'الطبقة الأولى',en:'Layer 1'},coins:['ETH','SOL','AVAX','DOT','ATOM','NEAR','APT','SUI','SEI','ICP','FTM','ALGO','HBAR','TIA'],col:'#3b82f6'},layer2:{ic:'🔗',n:{ar:'الطبقة الثانية',en:'Layer 2'},coins:['ARB','OP','MATIC','MANTA','STRK','METIS','ZK','BLAST'],col:'#8b5cf6'},defi:{ic:'💰',n:{ar:'التمويل اللامركزي',en:'DeFi'},coins:['UNI','AAVE','MKR','LDO','SNX','CRV','COMP','DYDX','GMX','SUSHI','PENDLE','JUP'],col:'#10b981'},meme:{ic:'🐕',n:{ar:'عملات ميم',en:'Meme'},coins:['DOGE','PEPE','WIF','BONK','FLOKI','SHIB','MEME','TURBO'],col:'#f59e0b'},rwa:{ic:'🏦',n:{ar:'أصول حقيقية',en:'RWA'},coins:['ONDO','POLYX','DUSK','RIO','CPOOL'],col:'#64748b'},depin:{ic:'🌐',n:{ar:'بنية تحتية',en:'DePIN'},coins:['FIL','AR','HNT','THETA','ANKR','IOTX'],col:'#0ea5e9'},data:{ic:'⚡',n:{ar:'بيانات وأوراكل',en:'Data/Oracle'},coins:['LINK','GRT','BAND','PYTH','API3','TRB'],col:'#6366f1'},privacy:{ic:'🔒',n:{ar:'خصوصية',en:'Privacy'},coins:['XMR','ZEC','SCRT','ROSE'],col:'#475569'}};
function getCoinSector(sym){for(var k in SECTORS)if(SECTORS[k].coins.includes(sym))return k;return null}
function scanTab(idx,btn){curScanTab=idx;document.querySelectorAll('#pg-scan>.big-tabs>.big-tab').forEach(function(b){b.classList.remove('act')});if(btn)btn.classList.add('act');['scanTrade','scanTrend','scanSmall'].forEach(function(id,j){var el=document.getElementById(id);if(el)el.style.display=j===idx?'block':'none'});updateScanSummary(0,Object.keys(T).length);if(idx===0)loadTrading();if(idx===1)loadTrending();if(idx===2)loadSmallCapsUI()}
/* ═══ TAB 1: SECTOR TRENDING ═══ */
function analyzeSectors(){var res=[];for(var k in SECTORS){var sec=SECTORS[k];var coins=sec.coins.filter(function(s){return T[s]});if(coins.length<2)continue;var totC=0,rising=0,totV=0,cd=[];coins.forEach(function(s){var d=T[s];totC+=d.c;totV+=d.v;if(d.c>0)rising++;cd.push({s:s,c:d.c,p:d.p,v:d.v})});cd.sort(function(a,b){return b.c-a.c});var avg=totC/coins.length;var rPct=Math.round(rising/coins.length*100);var str=0;if(avg>=8)str=90;else if(avg>=5)str=75;else if(avg>=3)str=60;else if(avg>=1)str=45;else if(avg>=0)str=30;else if(avg>=-3)str=15;else str=5;if(rPct>=80)str+=10;else if(rPct>=60)str+=5;str=Math.min(100,str);var v,vc;if(str>=70){v=lang==='ar'?'🔥 قطاع حامي — فرصة!':'🔥 Hot — Opportunity!';vc='var(--up)'}else if(str>=50){v=lang==='ar'?'📈 صاعد':'📈 Rising';vc='var(--neon)'}else if(str>=30){v=lang==='ar'?'🟡 محايد':'🟡 Neutral';vc='var(--warn)'}else{v=lang==='ar'?'🔴 هابط — تجنب':'🔴 Declining — Avoid';vc='var(--dn)'}
  res.push({k:k,ic:sec.ic,name:sec.n[lang]||sec.n.en,col:sec.col,avg:+avg.toFixed(1),rising:rising,total:coins.length,rPct:rPct,vol:totV,str:str,coins:cd,verdict:v,verdictCol:vc})}res.sort(function(a,b){return b.str-a.str});return res}
function loadTrending(){var secs=analyzeSectors();var h='';secs.forEach(function(s){var isHot=s.str>=60;var isMed=s.str>=30&&s.str<60;
  h+='<div class="whale-card" style="border-left:3px solid '+s.col+';margin-bottom:8px;padding:10px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">'+s.ic+'</span><div><div style="font-weight:800;font-size:13px;color:var(--t0)">'+s.name+'</div><div style="font-size:8px;color:var(--t3)">'+s.rising+'/'+s.total+' '+(lang==='ar'?'صاعدة':'rising')+'</div></div></div><div style="text-align:right"><div style="font-family:var(--fm);font-size:16px;font-weight:800;color:'+(s.avg>=0?'var(--up)':'var(--dn)')+'">'+(s.avg>=0?'+':'')+s.avg+'%</div><div style="font-size:8px;color:'+s.verdictCol+';font-weight:700">'+s.verdict+'</div></div></div>';
  if(isHot||isMed){var showCount=isHot?5:3;h+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">';s.coins.slice(0,showCount).forEach(function(c){h+='<div style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:var(--bg2);border-radius:6px;font-size:9px;font-family:var(--fm);cursor:pointer" onclick="openCoin(\''+c.s+'\')"><span style="font-weight:800">'+c.s+'</span><span style="color:'+(c.c>=0?'var(--up)':'var(--dn)')+';font-weight:700">'+(c.c>=0?'+':'')+c.c.toFixed(1)+'%</span></div>'});h+='</div>'}
  if(isHot){h+='<div style="text-align:center"><button class="chart-tf" onclick="scanTab(1,document.querySelectorAll(\'#pg-scan>.big-tabs>.big-tab\')[1]);curTradeFilter=\''+s.k+'\'" style="font-size:9px">📊 '+(lang==='ar'?'تداول '+s.name:'Trade '+s.name)+'</button></div>'}
  h+='<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden;margin-top:4px"><div style="width:'+s.str+'%;height:100%;background:'+s.col+';border-radius:2px"></div></div></div>'});
  var trendEl=document.getElementById('trendList');if(trendEl)trendEl.innerHTML=h||'<div class="empty"><div class="empty-ic">📡</div><div class="empty-tx">'+(lang==='ar'?'جاري التحليل...':'Analyzing...')+'</div></div>'}
/* ═══ TAB 2: SMART TRADING ═══ */
async function loadTrading(){var trLoadEl=document.getElementById('tradeList');if(trLoadEl)trLoadEl.innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';
  /* ═══ DATA CHECK: If no data loaded yet, show smart error ═══ */
  if(Object.keys(T).length<5){
    if(trLoadEl)trLoadEl.innerHTML='<div class="sc-empty"><div class="sc-empty-ic">⚠️</div><div class="sc-empty-title">'+(lang==='ar'?'جاري تحميل البيانات...':'Loading data...')+'</div><div class="sc-empty-sub">'+(lang==='ar'?(_proxyAlive?'يتم الاتصال بالسيرفر — انتظر 5 ثواني':'⚡ السيرفر غير متصل — يتم التحويل للاتصال المباشر'):(_proxyAlive?'Connecting to server — wait 5s':'⚡ Server offline — switching to direct API'))+'</div><div class="sc-empty-retry"><button class="rfr" onclick="loadTk().then(function(){loadTrading()})">🔄 '+(lang==='ar'?'إعادة المحاولة':'Retry')+'</button></div></div>';
    setTimeout(function(){if(Object.keys(T).length>=5)loadTrading()},3000);
    return}
  var c=quickScan();var r=await deepAnalyze(c);
  /* ═══ NEW: Apply qualityFilter before rendering ═══ */
  r=qualityFilter(r);
  cache.scan=r;cache.scanTime=Date.now();var sigs=[];
  for(var i=0;i<Math.min(r.length,7);i++){var x=r[i];var d=T[x.s];if(!d)continue;
    var type=(d.c>=-3&&d.c<=0&&d.v>1e8)?'fast':'daily';var entry,target,stop,dur;
    if(x.smartEntry&&type!=='fast'){entry=x.smartEntry.entry;target=x.smartEntry.target1;stop=x.smartEntry.stop;dur=lang==='ar'?'4-12 ساعة':'4-12 hours'}
    else if(type==='fast'){entry=d.p;target=d.p*1.015;stop=d.p*0.995;dur=lang==='ar'?'10-30 دقيقة':'10-30 min'}else{entry=d.p*0.995;target=x.ultra?d.p*1.08:d.p*1.06;stop=d.p*0.97;dur=lang==='ar'?'4-12 ساعة':'4-12 hours'}
    var risk=Math.abs(entry-stop);var rr=risk>0?+((target-entry)/risk).toFixed(1):0;if(rr<1.5)continue;
    var reasons=[];var ww=whaleWaves[x.s];if(ww&&ww.engine&&ww.engine.confidence>=30)reasons.push({ic:'🐋',t:lang==='ar'?'حوت مؤكد '+ww.engine.confidence+'%':'Whale '+ww.engine.confidence+'%'});
    var cvd=analyzeCVD(x.s);if(cvd.divergence==='BULLISH')reasons.push({ic:'📈',t:lang==='ar'?'CVD صاعد — تجميع صامت':'CVD rising — accumulation'});
    var fr=FR[x.s];if(fr&&fr.rate<-0.02)reasons.push({ic:'💰',t:lang==='ar'?'FR سلبي — فرصة':'Neg FR — opportunity'});
    if(fr&&fr.rate>=0&&fr.rate<0.01)reasons.push({ic:'✅',t:lang==='ar'?'FR متوازن':'FR balanced'});
    if(x.checks&&x.checks.ob)reasons.push({ic:'📗',t:lang==='ar'?'ضغط شراء OB':'OB buy pressure'});
    if(x.checks&&x.checks.vol)reasons.push({ic:'📊',t:lang==='ar'?'حجم تداول مرتفع':'High volume spike'});
    if(x.checks&&x.checks.rsi)reasons.push({ic:'📉',t:lang==='ar'?'RSI مناسب':'RSI in zone'});
    /* ═══ NEW: Informed flow reasons ═══ */
    if(x.checks&&x.checks.oi)reasons.push({ic:'📡',t:lang==='ar'?'تدفق ذكي مؤكد':'Informed flow confirmed'});
    if(x.tags.indexOf('🧠SMART')!==-1)reasons.push({ic:'🧠',t:lang==='ar'?'كبار المتداولين شراء':'Top traders going long'});
    /* ═══ NEW CONFIDENCE CALC v3 — Rewards timing + uses all data ═══ */
    var earlyBonus=d.c<1?20:d.c<2?12:d.c<3?5:0;
    var latePenalty=d.c>6?-35:d.c>4?-20:0;
    var cvdBonus=aggCVD[x.s]&&aggCVD[x.s].trend==='BUYING'?12:0;
    var takerBonus=takerData[x.s]&&takerData[x.s].avg>0&&takerData[x.s].ratio>takerData[x.s].avg*1.2?10:0;
    var _depthBR=0;
    if(depthSnapshots[x.s]&&depthSnapshots[x.s].bids&&depthSnapshots[x.s].asks){
      var _dBv=0,_dAv=0;
      for(var _dbi=0;_dbi<depthSnapshots[x.s].bids.length;_dbi++){_dBv+=parseFloat(depthSnapshots[x.s].bids[_dbi][0])*parseFloat(depthSnapshots[x.s].bids[_dbi][1])}
      for(var _dai=0;_dai<depthSnapshots[x.s].asks.length;_dai++){_dAv+=parseFloat(depthSnapshots[x.s].asks[_dai][0])*parseFloat(depthSnapshots[x.s].asks[_dai][1])}
      _depthBR=_dAv>0?_dBv/_dAv:0;
    }
    var obBonus=_depthBR>2?15:_depthBR>1.5?8:0;
    var lsBonus=LS[x.s]&&LS[x.s].ratio<0.8?10:0;
    var smartMoney=0;
    if(topTradersLS[x.s]&&topTradersLS[x.s].positions&&topTradersLS[x.s].positions.length>0){
      var _tpL=topTradersLS[x.s].positions[topTradersLS[x.s].positions.length-1];
      if(_tpL&&_tpL.long>0.55)smartMoney=12;
    }
    var vpinB=0;var _vpC=calcVPIN(x.s);
    if(_vpC&&_vpC.vpin>0.55)vpinB=12;else if(_vpC&&_vpC.vpin>0.4)vpinB=6;
    var exchangeDiv=0;
    if(T[x.s]&&T[x.s].by&&T[x.s].p>0&&((T[x.s].by-T[x.s].p)/T[x.s].p)>0.003)exchangeDiv=10;
    var cbPremB=0;
    if(CBP[x.s]&&T[x.s]&&T[x.s].p>0&&((CBP[x.s]-T[x.s].p)/T[x.s].p)>0.002)cbPremB=10;
    var checkBonus=x.passed?x.passed*3:0;
    var frBonus=0;
    if(fr&&fr.rate<-0.02)frBonus=10;else if(fr&&fr.rate<0.01)frBonus=5;else if(fr&&fr.rate>0.05)frBonus=-12;
    var whaleBonus=ww&&ww.engine?Math.min(12,ww.engine.confidence*0.15):0;
    var btcBonus=T.BTC?(T.BTC.c>1?5:T.BTC.c<-2?-8:0):0;
    var rawConf=earlyBonus+latePenalty+cvdBonus+takerBonus+obBonus+lsBonus+smartMoney+vpinB+exchangeDiv+cbPremB+checkBonus+frBonus+whaleBonus+btcBonus;
    var conf=Math.min(95,Math.max(20,Math.round(rawConf)));
    var sec=getCoinSector(x.s);
    sigs.push({s:x.s,p:d.p,c:d.c,v:d.v,type:type,conf:conf,entry:entry,target:target,stop:stop,rr:rr,dur:dur,reasons:reasons,score:x.score,checks:x.checks,passed:x.passed,total:x.total,ultra:x.ultra,confirmed:x.confirmed,tags:x.tags,sec:sec,detectedAt:x.detectedAt,priceAtDetection:x.priceAtDetection,ageMinutes:x.ageMinutes,changeFromDetection:x.changeFromDetection,freshness:x.freshness})}
  sigs.sort(function(a,b){return b.conf-a.conf});renderTrading(sigs)}
function filterTrade(f,btn){curTradeFilter=f;btn.parentElement.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');loadTrading()}
function renderTrading(sigs){var f=sigs;if(curTradeFilter==='fast')f=sigs.filter(function(x){return x.type==='fast'});else if(curTradeFilter==='daily')f=sigs.filter(function(x){return x.type==='daily'});else if(curTradeFilter!=='all'){f=sigs.filter(function(x){return x.sec===curTradeFilter})}
  /* Part B: Quality filter — min 40% confidence, max 7 — adaptive */
  var minConf=monitorState&&monitorState.minConf?Math.max(35,monitorState.minConf-10):40;
  f=f.filter(function(s){return s.conf>=minConf}).slice(0,7);
  var scanIEl=document.getElementById('scanI');
  var tkCount=Object.keys(T).length;
  var srcLabel=_proxyAlive?(lang==='ar'?'🟢 PROXY':'🟢 PROXY'):(lang==='ar'?'⚡ مباشر':'⚡ Direct');
  if(scanIEl)scanIEl.innerHTML='📊 '+f.length+' '+t('scan_signals')+' <span style="color:var(--t3)">/ '+tkCount+' '+(lang==='ar'?'عملة':'coins')+'</span> | '+srcLabel+' | '+t('scan_updated')+': '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
  /* ═══ Update summary bar ═══ */
  updateScanSummary(f.length,tkCount);
  if(!f.length){var trEl=document.getElementById('tradeList');if(trEl)trEl.innerHTML='<div class="sc-empty"><div class="sc-empty-ic">'+(tkCount<5?'⚠️':'📡')+'</div><div class="sc-empty-title">'+(tkCount<5?(lang==='ar'?'لم يتم تحميل البيانات بعد':'Data not loaded yet'):(lang==='ar'?'السوق هادئ — لا فرص قوية':'Market quiet — No strong signals'))+'</div><div class="sc-empty-sub">'+(tkCount<5?(lang==='ar'?'تحقق من اتصال الإنترنت أو اضغط تحديث':'Check internet or tap refresh'):(lang==='ar'?'البوابة الذكية ترفض الإشارات الضعيفة — الانتظار أفضل':'Smart gate blocks weak signals — Waiting is better'))+'</div>'+(tkCount<5?'<div class="sc-empty-retry"><button class="rfr" onclick="loadTk().then(function(){loadTrading()})">🔄 '+(lang==='ar'?'إعادة المحاولة':'Retry')+'</button></div>':'')+'<div class="sc-empty-stats"><span>📊 '+tkCount+' '+(lang==='ar'?'عملة محملة':'coins loaded')+'</span><span>'+srcLabel+'</span></div></div>';return}
  var h='';f.forEach(function(s,i){
    var tCol=s.type==='fast'?'var(--blue)':'var(--up)';var tLbl=s.type==='fast'?t('scan_fast'):t('scan_daily');
    var tb=getTierBadge(s.s);var ta=timeAgo(s.detectedAt||Date.now());
    /* Verdict (Part B) */
    var verdict,vCol,vBg;
    if(s.conf>=85&&s.ultra){verdict=lang==='ar'?'🟢 إشارة ممتازة — ادخل بثقة':'🟢 Excellent — Enter Now';vCol='var(--up)';vBg='rgba(0,255,136,.08)'}
    else if(s.conf>=80){verdict=lang==='ar'?'🟢 إشارة قوية — فرصة حقيقية':'🟢 Strong Signal';vCol='var(--up)';vBg='rgba(0,255,136,.06)'}
    else if(s.conf>=70){verdict=lang==='ar'?'🟡 فرصة جيدة — ادخل بحذر':'🟡 Good — Enter Carefully';vCol='var(--warn)';vBg='rgba(255,184,0,.04)'}
    else if(s.conf>=55){verdict=lang==='ar'?'🔵 إشارة متوسطة — للمراقبة':'🔵 Moderate — Monitor';vCol='var(--blue)';vBg='rgba(91,156,255,.04)'}
    else{verdict=lang==='ar'?'⚪ فرصة محتملة — راقب فقط':'⚪ Watch Only';vCol='var(--t2)';vBg='rgba(56,72,96,.04)'}
    var wConf=0;var ww=whaleWaves[s.s];if(ww&&ww.engine)wConf=ww.engine.confidence||0;
    var btcChg=T.BTC?T.BTC.c:0;var btcCol=btcChg>=1?'var(--up)':btcChg<=-1?'var(--dn)':'var(--t2)';
    /* Build 6-checks grid */
    var chkNames=['VOL','OB','RSI','SMART','FR','FLOW'];
    var chkKeys=['vol','ob','rsi','macd','fr','oi'];
    var chkHTML='<div class="sc-checks-grid">';
    chkNames.forEach(function(cn,ci){var k=chkKeys[ci];var pass=s.checks&&s.checks[k];chkHTML+='<div class="sc-chk-i '+(pass?'pass':'fail')+'">'+(pass?'✅':'·')+' '+cn+'</div>'});
    chkHTML+='</div>';
    /* ═══ NEW: Signal Timing Display ═══ */
    var sigAge=s.ageMinutes||0;
    var sigDrift=s.changeFromDetection||0;
    var sigFresh=s.freshness||'fresh';
    var sigPriceDet=s.priceAtDetection||s.p;
    var timingBadgeCls=sigFresh==='fresh'?'fresh':sigFresh==='warm'?'warm':'old';
    var timingLabel='';
    if(sigFresh==='fresh'){timingLabel=lang==='ar'?'وقت دخول مثالي':'Optimal entry time'}
    else if(sigFresh==='warm'){timingLabel=lang==='ar'?'لا زالت فرصة':'Still an opportunity'}
    else{timingLabel=lang==='ar'?'قد يكون متأخراً':'May be too late'}
    var driftCol=Math.abs(sigDrift)<2?'var(--up)':Math.abs(sigDrift)<4?'var(--warn)':'var(--dn)';
    var ageText=sigAge<1?(lang==='ar'?'الآن':'just now'):sigAge<60?(sigAge+(lang==='ar'?' دقيقة':'m ago')):(Math.floor(sigAge/60)+(lang==='ar'?' ساعة':'h ago'));
    var timingHTML='<div class="signal-timing">'
      +'<div style="display:flex;flex-direction:column;gap:2px">'
      +'<span style="color:var(--t1)">🟢 '+(lang==='ar'?'ظهر منذ ':'Appeared ')+ageText+'</span>'
      +'<span style="color:var(--t3)">'+(lang==='ar'?'سعر الاكتشاف: ':'Detection: ')+fP(sigPriceDet)+' <span style="color:'+driftCol+';font-weight:700">'+(sigDrift>=0?'+':'')+sigDrift.toFixed(1)+'%</span></span>'
      +'</div>'
      +'<span class="timing-badge '+timingBadgeCls+'">'+timingLabel+'</span></div>';
    h+='<div class="scan-card"><div class="scan-card-bar" style="background:'+(s.ultra?'var(--ultra)':s.type==='fast'?'var(--blue)':'var(--up)')+'"></div><div class="scan-card-body">'
      /* Header: rank + name + type + time + confidence */
      +'<div class="sc-head"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--t3);font-weight:800">#'+(i+1)+'</span><div><div style="font-family:var(--fd);font-weight:800;font-size:14px;color:var(--t0)">'+(s.ultra?'⭐ ':s.confirmed?'🟢 ':'')+s.s+(tb?' <span style="font-size:8px">'+tb+'</span>':'')+'</div><span class="sc-time '+(ta.cls==='fresh'?'fresh':'')+'">'+(ta.cls==='fresh'?'🆕 ':'⏱ ')+ta.text+'</span></div></div><div style="text-align:right"><div class="sc-badge" style="background:'+(s.conf>=70?'var(--ud)':s.conf>=55?'var(--bd)':'var(--wd)')+';color:'+(s.conf>=70?'var(--up)':s.conf>=55?'var(--blue)':'var(--warn)')+'">'+s.conf+'%</div><div style="font-size:8px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:'+tCol+';font-weight:700;margin-top:3px">'+tLbl+'</div></div></div>'
      /* ═══ NEW: Signal Timing Bar ═══ */
      +timingHTML
      /* Price */
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-family:var(--fm);font-size:18px;font-weight:800;color:var(--t0)">'+fP(s.p)+'</span><span style="font-family:var(--fm);font-size:14px;font-weight:800;color:'+(s.c>=0?'var(--up)':'var(--dn)')+'">'+(s.c>=0?'+':'')+s.c.toFixed(1)+'%</span></div>'
      /* Verdict */
      +'<div class="sc-verdict" style="background:'+vBg+';border:1px solid '+vCol+'20"><div class="sc-verdict-t" style="color:'+vCol+'">'+verdict+'</div><div class="sc-verdict-s">'+s.passed+'/6 '+(lang==='ar'?'فحوصات':'checks')+' · 🐋 '+wConf+'% · BTC '+(btcChg>=0?'+':'')+btcChg.toFixed(1)+'%</div></div>'
      /* 6 Checks Grid */
      +chkHTML
      /* Quick 3 */
      +'<div class="sc-quick3"><div class="sc-quick3-item"><div class="sc-quick3-val" style="color:'+(s.passed>=5?'var(--up)':s.passed>=3?'var(--warn)':'var(--dn)')+'">'+s.passed+'/6</div><div class="sc-quick3-lbl">'+(lang==='ar'?'فحوصات':'Checks')+'</div></div><div class="sc-quick3-item"><div class="sc-quick3-val" style="color:'+(wConf>=50?'var(--up)':wConf>=30?'var(--warn)':'var(--t3)')+'">🐋 '+wConf+'%</div><div class="sc-quick3-lbl">'+(lang==='ar'?'حوت':'Whale')+'</div></div><div class="sc-quick3-item"><div class="sc-quick3-val" style="color:'+btcCol+'">BTC '+(btcChg>=0?'+':'')+btcChg.toFixed(1)+'%</div><div class="sc-quick3-lbl">'+(lang==='ar'?'السوق':'Market')+'</div></div></div>'
      /* Trade zone */
      +'<div class="sc-trade"><div class="sc-trade-row"><span style="color:var(--neon)">🎯 '+(lang==='ar'?'ادخل':'Entry')+'</span><span style="font-weight:700">'+fP(s.entry)+'</span></div>'
      +'<div class="sc-trade-row"><span style="color:var(--up)">🎯 '+(lang==='ar'?'هدف':'Target')+' <span style="font-size:10px;color:var(--up)">+'+(((s.target-s.entry)/s.entry)*100).toFixed(1)+'%</span></span><span style="font-weight:700;color:var(--up)">'+fP(s.target)+'</span></div>'
      +'<div class="sc-trade-row"><span style="color:var(--dn)">🛑 '+(lang==='ar'?'وقف':'Stop')+'</span><span style="font-weight:700;color:var(--dn)">'+fP(s.stop)+'</span></div>'
      +'<div class="sc-trade-row"><span>⚖️ R:R</span><span style="font-weight:700;color:'+(s.rr>=2.5?'var(--up)':'var(--warn)')+'">1:'+s.rr+'</span></div></div>';
    /* Reasons */
    if(s.reasons.length){h+='<div style="margin-bottom:6px">';s.reasons.slice(0,5).forEach(function(r){h+='<div class="sc-reason"><span class="sc-reason-ic">'+r.ic+'</span><span>'+r.t+'</span></div>'});h+='</div>'}
    /* Volume info */
    h+='<div style="font-size:9px;color:var(--t2);font-family:var(--fm);text-align:center;margin:4px 0">📊 Vol: '+fmt(s.v)+'</div>';
    /* Progress bar */
    h+='<div class="sc-bar-wrap"><div class="sc-bar"><div class="sc-bar-fill" style="width:'+s.conf+'%;background:'+(s.ultra?'linear-gradient(90deg,var(--ultra),var(--dn))':s.conf>=60?'var(--up)':'var(--warn)')+'"></div></div><span class="sc-bar-num">'+s.conf+'</span></div>'
    /* Actions */
    +'<div class="sc-actions"><button class="sc-btn" onclick="chartSignal={entry:'+s.entry+',target:'+s.target+',stop:'+s.stop+',s:\''+s.s+'\'};openCoin(\''+s.s+'\')">'+t('scan_chart')+'</button><button class="sc-btn sc-btn-enter" style="flex:1" onclick="if(T[\''+s.s+'\'])openTrade(\''+s.s+'\',T[\''+s.s+'\'].p,\''+s.type+'\','+s.conf+')">'+t('scan_enter')+'</button></div>'
    +'<div style="font-size:9px;color:var(--t3);text-align:center;margin-top:6px">⏱ '+t('scan_duration')+': '+s.dur+'</div>'
    +'</div></div>'});
  var tradeListEl=document.getElementById('tradeList');if(tradeListEl)tradeListEl.innerHTML=h}
/* ═══ SCANNER SUMMARY BAR UPDATE ═══ */
function updateScanSummary(sigCount,tkCount){
  var ccEl=document.getElementById('scanCoinCount');
  var scEl=document.getElementById('scanSigCount');
  var srcEl=document.getElementById('scanSrcBadge');
  if(ccEl)ccEl.textContent=tkCount||Object.keys(T).length;
  if(scEl){scEl.textContent=sigCount||'0';scEl.style.color=sigCount>0?'var(--up)':'var(--t3)'}
  if(srcEl){
    if(tkCount<5){srcEl.innerHTML='<span style="color:var(--dn)">⏳</span>';srcEl.title=lang==='ar'?'جاري التحميل':'Loading'}
    else if(_proxyAlive){srcEl.innerHTML='<span style="color:var(--up)">🟢</span>';srcEl.title='PROXY'}
    else{srcEl.innerHTML='<span style="color:var(--warn)">⚡</span>';srcEl.title=lang==='ar'?'اتصال مباشر':'Direct API'}
  }
}
/* ═══ TAB 3: SMALL CAPS ═══ */
async function loadSmallCapsUI(){
  var slEl=document.getElementById('smallList');
  if(!slEl)return;
  slEl.innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';
  /* ═══ GEM HUNTER v2 — Enabled with direct Binance scan ═══ */
  if(Object.keys(T).length<10){
    slEl.innerHTML='<div class="sc-empty"><div class="sc-empty-ic">⚠️</div><div class="sc-empty-title">'+(lang==='ar'?'جاري تحميل البيانات...':'Loading data...')+'</div><div class="sc-empty-sub">'+(lang==='ar'?'انتظر حتى يتم تحميل بيانات العملات':'Waiting for coin data to load')+'</div></div>';
    return;
  }
  try{
    var res=await loadSmallCaps2();
    if(res&&res.length){renderSmallCaps(res)}
    else{slEl.innerHTML='<div class="sc-empty"><div class="sc-empty-ic">💎</div><div class="sc-empty-title">'+(lang==='ar'?'لا جواهر مكتشفة حالياً':'No gems found right now')+'</div><div class="sc-empty-sub">'+(lang==='ar'?'السكانر يبحث عن عملات صغيرة بحركة غير عادية — حاول لاحقاً':'Scanner looking for small caps with unusual moves — try later')+'</div></div>';}
  }catch(e){
    console.error('[GemHunter] Error:',e);
    slEl.innerHTML='<div class="sc-empty"><div class="sc-empty-ic">❌</div><div class="sc-empty-title">'+(lang==='ar'?'خطأ في التحليل':'Analysis error')+'</div><div class="sc-empty-sub">'+esc(e&&e.message?e.message:'unknown')+'</div></div>';
  }
}
async function loadSmallCaps2(){if(!Object.keys(T).length)await loadTk();var cands=Object.entries(T).filter(function(e){var d=e[1];var tier=getCoinTier(e[0]);return d.p>0&&d.p<20&&d.v>100000&&!TIER1.has(e[0])}).sort(function(a,b){return b[1].v-a[1].v}).slice(0,50);var res=[];
  var proms=cands.slice(0,25).map(function(e){var s=e[0];return fj(BN+'/klines?symbol='+s+'USDT&interval=1h&limit=12').then(function(kl){if(!kl||kl.length<6)return;var vols=kl.map(function(k){return+k[5]});var cls=kl.map(function(k){return+k[4]});var avgV=vols.slice(0,-2).reduce(function(a,b){return a+b},0)/Math.max(1,vols.length-2);var recV=(vols[vols.length-1]+vols[vols.length-2])/2;var vx=avgV>0?recV/avgV:1;
    var sI=vols.length-1;for(var i=vols.length-1;i>=1;i--){if(vols[i]>avgV*1.5)sI=i;else break}var pS=+kl[sI][1];var pN=cls[cls.length-1];var gain=pS>0?((pN-pS)/pS*100):0;
    var timing,tBadge;if(gain<3){timing='early';tBadge={ic:'🟢',l:lang==='ar'?'مبكر — ادخل!':'Early — Enter!',col:'var(--up)'}}else if(gain<8){timing='still';tBadge={ic:'🟡',l:lang==='ar'?'فيه فرصة — حذر':'Still time — Caution',col:'var(--warn)'}}else{timing='late';tBadge={ic:'🔴',l:lang==='ar'?'متأخر — راقب':'Late — Watch',col:'var(--dn)'}}
    var _d=T[s];if(!_d)return;
    var sc=0;if(vx>=4)sc+=45;else if(vx>=3)sc+=40;else if(vx>=2)sc+=30;else if(vx>=1.5)sc+=15;if(timing==='early')sc+=30;else if(timing==='still')sc+=15;if(_d.c>0&&_d.c<3)sc+=20;else if(_d.c>=3&&_d.c<8)sc+=10;
    var target=timing!=='late'?pN*(timing==='early'?1.30:1.25):null;var stop=timing!=='late'?pN*(timing==='early'?0.90:0.88):null;
    if(sc>=25)res.push({s:s,p:_d.p,c:_d.c,v:_d.v,vx:vx,gain:gain,timing:timing,tBadge:tBadge,sc:sc,target:target,stop:stop})}).catch(function(){})});
  await Promise.all(proms);res.sort(function(a,b){return b.sc-a.sc});return res}
function filterSmall(f,btn){curSmallFilter=f;btn.parentElement.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');loadSmallCapsUI()}
function renderSmallCaps(res){var f=res;if(curSmallFilter!=='all')f=res.filter(function(x){return x.timing===curSmallFilter});
  var slEl=document.getElementById('smallList');if(!slEl)return;
  if(!f.length){slEl.innerHTML='<div class="empty"><div class="empty-ic">💎</div><div class="empty-tx">'+(lang==='ar'?'لا جواهر حالياً':'No gems now')+'</div></div>';return}
  var h='';f.slice(0,15).forEach(function(g){
    h+='<div class="whale-card" style="border-left:3px solid '+g.tBadge.col+';margin-bottom:8px" onclick="openCoin(\''+g.s+'\')">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="display:flex;align-items:center;gap:6px"><span style="font-weight:800;font-size:14px">💎 '+g.s+'</span><span style="font-size:8px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:'+g.tBadge.col+';font-weight:700">'+g.tBadge.ic+' '+g.tBadge.l+'</span></div><span style="font-family:var(--fm);font-size:12px;font-weight:800;color:var(--neon)">'+g.vx.toFixed(1)+'x vol</span></div>'
      +'<div style="display:flex;justify-content:space-between;font-family:var(--fm);font-size:10px;margin-bottom:4px"><span>'+fP(g.p)+'</span><span style="color:'+(g.c>=0?'var(--up)':'var(--dn)')+'">'+(g.c>=0?'+':'')+g.c.toFixed(1)+'%</span><span>Vol:'+fmt(g.v)+'</span><span style="color:var(--warn)">+'+g.gain.toFixed(1)+'% from spike</span></div>'
      +(g.target?'<div style="display:flex;gap:8px;font-size:8px;font-family:var(--fm);margin-bottom:4px"><span style="color:var(--up)">🎯 '+fP(g.target)+'</span><span style="color:var(--dn)">🛑 '+fP(g.stop)+'</span></div>':'')
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+Math.min(100,g.sc)+'%;height:100%;background:'+(g.timing==='early'?'var(--up)':g.timing==='still'?'var(--warn)':'var(--dn)')+';border-radius:2px"></div></div></div>'});
  slEl.innerHTML=h}
function onSrch(v){var el=document.getElementById('sRes');if(!v){el.classList.remove('show');return}v=v.toUpperCase();var m=Object.entries(T).filter(function(e){return e[0].includes(v)}).slice(0,8);if(!m.length){el.classList.remove('show');return}el.innerHTML=m.map(function(e){var s=e[0],d=e[1];return'<div class="sr-i" onclick="openCoin(\''+s+'\')"><span style="font-weight:700">'+s+'</span><span style="font-family:var(--fm);font-size:10px">'+fP(d.p)+' <span class="cr-ch '+(d.c>=0?'up':'dn')+'">'+(d.c>=0?'+':'')+d.c.toFixed(1)+'%</span></span></div>'}).join('');el.classList.add('show')}
document.addEventListener('click',function(e){if(!e.target.closest('.srch'))document.getElementById('sRes').classList.remove('show')});
/* WS */
/* ═══ 🔌 DATA via PROXY /api/all — WS disabled ═══ */
var wsAgg=null,wsLiq=null,wsDepth=null,liquidationData={},depthSnapshots={};
/* ═══ 🔗 FEATURE 2: ON-CHAIN TRACKING (no key) ═══ */
var onChainData={};
async function fetchOnChainBTC(){try{var data=await fj('https://mempool.space/api/mempool/recent');if(!data||!data.length)return;var whale=data.filter(function(tx){return tx.fee>500000});onChainData.BTC={count:whale.length,time:Date.now(),signal:whale.length>=3?'WHALE_RUSH':whale.length>=1?'MODERATE':'LOW'}}catch(e){}}
/* ═══ 👛 FEATURE 3: WALLET TRACKING ═══ */
var trackedWallets=[];try{trackedWallets=JSON.parse(localStorage.getItem('nxwallets')||'[]')}catch(e){}
function addWallet(addr,label){
  if(trackedWallets.length>=20)return false;
  /* Whitelist address: 0x + 40 hex chars only (Ethereum address shape) */
  var cleanAddr=String(addr||'').trim();
  if(!/^0x[a-fA-F0-9]{40}$/.test(cleanAddr))return false;
  if(trackedWallets.some(function(w){return w.address===cleanAddr}))return false;
  /* Label: strip HTML-significant chars, cap at 30 chars */
  var cleanLabel=String(label||'').replace(/[<>"'&]/g,'').slice(0,30)||cleanAddr.slice(0,10);
  trackedWallets.push({address:cleanAddr,label:cleanLabel,chain:'ethereum',lastBal:null,lastChk:0});
  try{localStorage.setItem('nxwallets',JSON.stringify(trackedWallets))}catch(e){}
  return true;
}
function rmWallet(i){trackedWallets.splice(i,1);try{localStorage.setItem('nxwallets',JSON.stringify(trackedWallets))}catch(e){}}
window.addWallet=addWallet;window.rmWallet=rmWallet;
async function checkWallets(){for(var i=0;i<trackedWallets.length;i++){var w=trackedWallets[i];if(Date.now()-w.lastChk<60000)continue;try{var res=await fj('https://api.etherscan.io/api?module=account&action=balance&address='+encodeURIComponent(w.address)+'&tag=latest');if(res&&res.result){var bal=+res.result/1e18;if(w.lastBal!==null){var chg=bal-w.lastBal;var pct=w.lastBal>0?(chg/w.lastBal)*100:0;if(Math.abs(pct)>5){var ic=chg>0?'📥':'📤';showPopup(ic,w.label+(chg>0?' received':' sent'),Math.abs(chg).toFixed(2)+' ETH');addNotifHist(ic,w.label,'Wallet',pct.toFixed(1)+'%')}}w.lastBal=bal;w.lastChk=Date.now()}}catch(e){}await new Promise(function(r){setTimeout(r,6000)})}try{localStorage.setItem('nxwallets',JSON.stringify(trackedWallets))}catch(e){}}
/* LOAD TICKERS — ALL 3 EXCHANGES */
var _proxyAlive=true,_directFallbackRunning=false,_lastDirectFetch=0;
var _loadTkRunning=false;
async function loadTk(){
  if(_loadTkRunning)return; /* prevent concurrent calls from stacking */
  _loadTkRunning=true;
  try{
  var all=await fj(PROXY+'/api/all');
  if(all){
    _proxyAlive=true;
    /* — tickers — */
    if(all.tickers){Object.keys(all.tickers).forEach(function(s){var d=all.tickers[s];if(!d)return;var chg=d.change!==undefined?+d.change:(d.c!==undefined?+d.c:0);T[s]={p:+d.price||+d.p||0,c:isNaN(chg)?0:chg,v:+d.volume||+d.v||0,h:+d.high||+d.h||0,l:+d.low||+d.l||0,src:d.src||'PROXY'};if(d.by)T[s].by=+d.by})}
    /* — funding rates — */
    if(all.fr){Object.keys(all.fr).forEach(function(s){var d=all.fr[s];if(!d)return;FR[s]={rate:d.rate!==undefined?+d.rate:0,mark:d.mark!==undefined?+d.mark:(d.markPrice!==undefined?+d.markPrice:0)}})}
    /* — open interest — */
    if(all.oi){Object.keys(all.oi).forEach(function(s){var d=all.oi[s];OI[s]=typeof d==='number'?d:(+d.value||+d.oi||0)})}
    /* — long/short — */
    if(all.ls){Object.keys(all.ls).forEach(function(s){var d=all.ls[s];if(!d)return;LS[s]={long:+d.long||50,short:+d.short||50,ratio:+d.ratio||1};if(d.hist&&d.hist.length){lsHist[s]=d.hist.map(function(x){return{long:+x.long,short:+x.short,ratio:+x.ratio||1,time:+x.time||Date.now()}})}})}
    /* — taker volume — */
    if(all.taker){Object.keys(all.taker).forEach(function(s){var d=all.taker[s];if(!d)return;takerData[s]={ratio:+d.ratio||1,avg:+d.avg||1,trend:d.trend||'FLAT',buyVol:+d.buyVol||0,sellVol:+d.sellVol||0}})}
    /* — liquidation data — */
    if(all.liq){
      if(Array.isArray(all.liq)){liqEvents=all.liq.map(function(x){return{s:x.sym||x.s||'',S:x.side||x.S||'',p:+x.price||+x.p||0,q:x.qty||0,time:+x.time||Date.now()}}).slice(-100);all.liq.forEach(function(x){var s=x.sym||x.s||'';if(!s)return;if(!liquidationData[s])liquidationData[s]=[];liquidationData[s].push({side:x.side||x.S,value:+x.value||+x.v||0,price:+x.price||+x.p||0,time:+x.time||Date.now()});if(liquidationData[s].length>50)liquidationData[s]=liquidationData[s].slice(-50)})}
      else{Object.keys(all.liq).forEach(function(s){var arr=all.liq[s];if(!arr||!arr.length)return;liquidationData[s]=arr.map(function(x){return{side:x.side||x.S,value:+x.value||+x.v||0,price:+x.price||+x.p||0,time:+x.time||Date.now()}});arr.forEach(function(x){liqEvents.push({s:s+'USDT',S:x.side||x.S||'',p:+x.price||+x.p||0,q:0,time:+x.time||Date.now()})})});if(liqEvents.length>100)liqEvents=liqEvents.slice(-100)}
    }
    /* — depth snapshots — */
    if(all.depth){Object.keys(all.depth).forEach(function(s){var d=all.depth[s];if(!d)return;depthSnapshots[s]={bids:d.bids||d.b||[],asks:d.asks||d.a||[],time:+d.time||Date.now()}})}
    /* — market overview (FG + BTC dom + Coinbase) — */
    if(all.market){
      if(all.market.fgi!==undefined||all.market.fg!==undefined){fgValue=+(all.market.fgi||all.market.fg);var fgE=document.getElementById('fgV');if(fgE)fgE.textContent=fgValue;var pFGE=document.getElementById('pFG');if(pFGE)pFGE.textContent=fgValue;var fgLE=document.getElementById('fgL');if(fgLE)fgLE.textContent=all.market.fgiLabel||all.market.fgLabel||''}
      if(all.market.btcDom!==undefined){btcDom=+all.market.btcDom;var btcDE=document.getElementById('btcD');if(btcDE)btcDE.textContent=btcDom.toFixed(1)+'%'}
      if(all.market.cbp){Object.keys(all.market.cbp).forEach(function(c){CBP[c]=+all.market.cbp[c]})}
    }
    /* — whales engine data — */
    if(all.whales){Object.keys(all.whales).forEach(function(s){var d=all.whales[s];if(!d)return;if(!whaleWaves[s])whaleWaves[s]={waves:[],totalBuy:0,engine:null};if(d.waves)whaleWaves[s].waves=d.waves;if(d.totalBuy!==undefined)whaleWaves[s].totalBuy=+d.totalBuy;if(d.engine)whaleWaves[s].engine=d.engine})}
    /* ═══ NEW: Multi-Exchange Intelligence from VPS ═══ */
    if(all.multi){var m=all.multi;
      function caName(sym){return(sym||'').replace('USDT_PERP.A','').replace('USDT_PERP','').replace('USDT','')}
      if(m.coinalyze){
        if(m.coinalyze.oi){Object.keys(m.coinalyze.oi).forEach(function(s){coinalyzeOI[s]=m.coinalyze.oi[s]})}
        if(m.coinalyze.fr){Object.keys(m.coinalyze.fr).forEach(function(s){coinalyzeFR[s]=m.coinalyze.fr[s]})}
        if(m.coinalyze.predFR){Object.keys(m.coinalyze.predFR).forEach(function(s){coinalyzePredFR[s]=m.coinalyze.predFR[s]})}
        if(m.coinalyze.liq){Object.keys(m.coinalyze.liq).forEach(function(s){coinalyzeLiq[s]=m.coinalyze.liq[s]})}
      }
      if(m.hyperliquid){Object.keys(m.hyperliquid).forEach(function(s){hyperliquidData[s]=m.hyperliquid[s]})}
      if(m.blockchain){btcOnChain=m.blockchain;btcOnChain.time=btcOnChain.time||Date.now()}
      if(m.news&&m.news.length){cryptoNews=m.news}
      if(m.newsSentiment){newsSentiment=m.newsSentiment}
      if(m.bitfinex){Object.keys(m.bitfinex).forEach(function(s){bitfinexMargin[s]=m.bitfinex[s]})}
      if(m.cbPremium){Object.keys(m.cbPremium).forEach(function(s){var d=m.cbPremium[s];if(d){cbPremium[s]=d.diff||0;cbPremium[s+'_pct']=d.pct||0}});cbPremium.time=Date.now()}
    }
    connMetrics.apiOk++;lastDataTime=Date.now();
  }else{
    connMetrics.apiFail++;_proxyAlive=false;
    /* ═══ 🔌 DIRECT API FALLBACK — Binance + CoinGecko ═══ */
    if(!_directFallbackRunning&&(Date.now()-_lastDirectFetch>15000||Object.keys(T).length<10)){
      _directFallbackRunning=true;_lastDirectFetch=Date.now();
      console.log('[FALLBACK] ⚡ PROXY down — fetching direct from Binance...');
      try{
        /* Binance spot 24h tickers */
        var bnTk=await fj(BN+'/ticker/24hr');
        if(bnTk&&bnTk.length){
          var STABLES_FB=['USDT','USDC','TUSD','DAI','BUSD','FDUSD','USDP','PYUSD'];
          bnTk.forEach(function(tk){
            if(!tk.symbol||!tk.symbol.endsWith('USDT'))return;
            var sym=tk.symbol.replace('USDT','');
            if(STABLES_FB.includes(sym)||sym.length>10)return;
            T[sym]={p:+tk.lastPrice||0,c:+tk.priceChangePercent||0,v:+tk.quoteVolume||0,h:+tk.highPrice||0,l:+tk.lowPrice||0,src:'BN_DIRECT'};
          });
          console.log('[FALLBACK] ✅ Binance tickers loaded: '+Object.keys(T).length+' coins');
          /* Update TIER1 from loaded data */
          if(Object.keys(T).length>50){
            var sorted=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v});
            var newTier=new Set();
            sorted.slice(0,120).forEach(function(e){newTier.add(e[0])});
            WL.forEach(function(s){newTier.add(s)});
            TIER1=newTier;
          }
          lastDataTime=Date.now();connMetrics.apiOk++;
        }
        /* Binance Futures FR */
        var bnFR=await fj(BF+'/premiumIndex');
        if(bnFR&&bnFR.length){bnFR.forEach(function(x){var s=x.symbol.replace('USDT','');if(!s||!T[s])return;FR[s]={rate:+x.lastFundingRate||0,mark:+x.markPrice||0}})}
        /* Binance Futures OI — top coins */
        var oiProms=WL.slice(0,20).map(function(s){return fj(BF+'/openInterest?symbol='+s+'USDT').then(function(d){if(d&&d.openInterest)OI[s]=+d.openInterest}).catch(function(){})});
        await Promise.all(oiProms);
      }catch(e){console.log('[FALLBACK] ❌ Direct API also failed:',e)}
      _directFallbackRunning=false;
    }
  }
  /* sparkline update */
  Object.keys(T).forEach(function(s){var d=T[s];if(!d||!d.p)return;if(!sparkHist[s])sparkHist[s]=[];sparkHist[s].push(d.p);if(sparkHist[s].length>12)sparkHist[s]=sparkHist[s].slice(-12)});
  /* ticker bar */
  var el=document.getElementById('tkrEl');if(el){var items=WL.filter(function(s){return T[s]}).slice(0,16);var h='';for(var r=0;r<2;r++)items.forEach(function(s){var d=T[s],up=d.c>=0;h+='<div class="tkr-i"><span class="tkr-sym">'+s+'</span><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">'+fP(d.p)+'</span><div class="spark">'+mkSpark(s)+'</div><span class="tkr-c '+(up?'up':'dn')+'">'+(up?'+':'')+d.c.toFixed(1)+'%</span></div>'});el.innerHTML=h}
  /* FR panel shortcut */
  var pfrE=document.getElementById('pFR');if(pfrE&&FR.BTC)pfrE.textContent=(FR.BTC.rate>=0?'+':'')+FR.BTC.rate.toFixed(4)+'%';
  }finally{_loadTkRunning=false}
}
async function loadFutures(){/* FR/OI/LS now loaded via PROXY in loadTk() */await loadTk()}

/* ═══ BINANCE ADVANCED — 8 FREE ENDPOINTS ═══ */
var BN_ADV_COINS=['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT'];
var bnAdvCache={t:0};
async function fetchBinanceAdvanced(){
  if(Date.now()-bnAdvCache.t<120000)return; /* Cache 2 min */
  try{
  /* 1. Premium Index — FR + Mark Price for ALL coins at once */
  var pi=await fj(BF+'/premiumIndex');
  if(pi&&pi.length){pi.forEach(function(x){var s=x.symbol.replace('USDT','');if(!s||!T[s])return;
    FR[s]={rate:+x.lastFundingRate||0,mark:+x.markPrice||0,nextTime:+x.nextFundingTime||0,predicted:+x.estimatedSettlePrice||0};
  })}

  /* 2. FR History — last 100 periods for top coins */
  var frProms=BN_ADV_COINS.map(function(s){return fj(BF+'/fundingRate?symbol='+s+'USDT&limit=50').then(function(d){if(d&&d.length)frHistory[s]=d.map(function(x){return{rate:+x.fundingRate,time:+x.fundingTime}})}).catch(function(){})});

  /* 3. Top Traders L/S (Accounts) — what big players do */
  var topProms=BN_ADV_COINS.slice(0,6).map(function(s){return fj('https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol='+s+'USDT&period=1h&limit=24').then(function(d){if(d&&d.length)topTradersLS[s]={accounts:d.map(function(x){return{long:+x.longAccount,short:+x.shortAccount,ratio:+x.longShortRatio,time:+x.timestamp}})}}).catch(function(){})});

  /* 4. Top Traders L/S (Positions) — by position size */
  var posProms=BN_ADV_COINS.slice(0,6).map(function(s){return fj('https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol='+s+'USDT&period=1h&limit=24').then(function(d){if(d&&d.length){if(!topTradersLS[s])topTradersLS[s]={};topTradersLS[s].positions=d.map(function(x){return{long:+x.longAccount,short:+x.shortAccount,ratio:+x.longShortRatio,time:+x.timestamp}})}}).catch(function(){})});

  /* 5. Global L/S Ratio */
  var glProms=BN_ADV_COINS.slice(0,6).map(function(s){return fj('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol='+s+'USDT&period=1h&limit=24').then(function(d){if(d&&d.length)globalLS[s]=d.map(function(x){return{long:+x.longAccount,short:+x.shortAccount,ratio:+x.longShortRatio,time:+x.timestamp}})}).catch(function(){})});

  /* 6. OI History — change over time */
  var oiProms=BN_ADV_COINS.slice(0,6).map(function(s){return fj('https://fapi.binance.com/futures/data/openInterestHist?symbol='+s+'USDT&period=1h&limit=24').then(function(d){if(d&&d.length)oiHistory[s]=d.map(function(x){return{oi:+x.sumOpenInterest,val:+x.sumOpenInterestValue,time:+x.timestamp}})}).catch(function(){})});

  /* 7. AggTrades for real CVD — top 5 coins */
  var cvdProms=BN_ADV_COINS.slice(0,5).map(function(s){return fj(BF+'/aggTrades?symbol='+s+'USDT&limit=500').then(function(d){if(d&&d.length){var buyV=0,sellV=0;d.forEach(function(t){var v=+t.q*+t.p;if(t.m)sellV+=v;else buyV+=v});aggCVD[s]={buyVol:buyV,sellVol:sellV,delta:buyV-sellV,ratio:sellV>0?buyV/sellV:1,trend:buyV>sellV*1.1?'BUYING':sellV>buyV*1.1?'SELLING':'NEUTRAL',count:d.length,time:Date.now()}}}).catch(function(){})});

  /* 8. Book Tickers — best bid/ask spread */
  var bt=await fj(BF+'/ticker/bookTicker');
  if(bt&&bt.length){bt.forEach(function(x){var s=x.symbol.replace('USDT','');if(!s||!T[s])return;
    var bid=+x.bidPrice,ask=+x.askPrice,mid=(bid+ask)/2;
    bookTickers[s]={bid:bid,ask:ask,spread:mid>0?((ask-bid)/mid*100):0,bidQty:+x.bidQty,askQty:+x.askQty}
  })}

  await Promise.all(frProms.concat(topProms,posProms,glProms,oiProms,cvdProms));
  bnAdvCache.t=Date.now();
  }catch(e){}
}

/* ═══ HELPER: FR History mini-chart (8 bars) ═══ */
function frHistBars(sym){
  var h=frHistory[sym];if(!h||h.length<4)return'';
  var last8=h.slice(-8);var mx=Math.max.apply(null,last8.map(function(x){return Math.abs(x.rate)}))||0.001;
  var bars='';last8.forEach(function(x){var pct=Math.min(100,Math.abs(x.rate)/mx*100);var col=x.rate>0.03?'var(--dn)':x.rate<-0.01?'var(--up)':'var(--warn)';bars+='<div style="width:8px;background:'+col+';border-radius:2px;min-height:2px;height:'+pct+'%"></div>'});
  return'<div style="display:flex;align-items:flex-end;gap:1px;height:20px">'+bars+'</div>'
}

/* ═══ HELPER: OI History mini-chart (8 bars) ═══ */
function oiHistBars(sym){
  var h=oiHistory[sym];if(!h||h.length<4)return'';
  var last8=h.slice(-8);var mn=Math.min.apply(null,last8.map(function(x){return x.val}));var mx=Math.max.apply(null,last8.map(function(x){return x.val}))-mn;if(mx===0)mx=1;
  var bars='';last8.forEach(function(x,i){var pct=20+((x.val-mn)/mx*80);var prev=i>0?last8[i-1].val:x.val;var col=x.val>=prev?'var(--up)':'var(--dn)';bars+='<div style="width:8px;background:'+col+';border-radius:2px;min-height:2px;height:'+pct+'%"></div>'});
  return'<div style="display:flex;align-items:flex-end;gap:1px;height:20px">'+bars+'</div>'
}

/* ═══════════════════════════════════════════════════════════ */
/* ═══ Multi-Exchange Intelligence — data from VPS /api/all ═══ */
/* ═══════════════════════════════════════════════════════════ */
async function fetchMultiExchange(){
  /* Data now loaded automatically via loadTk() → /api/all → all.multi */
  /* This function just ensures loadTk has run */
  if(!Object.keys(T).length)try{await loadTk()}catch(e){}
}

/* HELPER: format large numbers */
function fmtB(n){if(!n||isNaN(n))return'--';if(n>=1e9)return'$'+(n/1e9).toFixed(1)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';return'$'+Math.round(n).toLocaleString()}

/* ═══ DeFiLlama — FREE: Stablecoin Flows + TVL ═══ */
async function fetchDeFiLlama(){
  if(Date.now()-defiCache.t<300000)return; /* Cache 5 min */
  try{
  /* 1. Stablecoins — total supply + changes */
  var sc=await fj('https://stablecoins.llama.fi/stablecoins?includePrices=true');
  if(sc&&sc.peggedAssets){
    sc.peggedAssets.forEach(function(s){
      if(!s.symbol||!s.chains)return;
      var sym=s.symbol.toUpperCase();
      var totalNow=0,total7d=0;
      s.chains.forEach(function(c){
        if(s.chainCirculating&&s.chainCirculating[c]&&s.chainCirculating[c].current)totalNow+=(+s.chainCirculating[c].current.peggedUSD||0);
      });
      if(s.circulatingPrevDay)total7d=+s.circulatingPrevDay.peggedUSD||0;
      var change7d=total7d>0?((totalNow-total7d)/total7d*100):0;
      stablecoinData[sym]={supply:totalNow||+s.circulating||0,change7d:change7d,name:s.name||sym,chains:s.chains?s.chains.length:0};
    });
  }
  /* 2. TVL per Chain */
  var chains=await fj('https://api.llama.fi/v2/chains');
  if(chains&&chains.length){
    chains.forEach(function(c){
      if(!c.name)return;
      defiTVL[c.name]={tvl:+c.tvl||0,change1d:+c.tokenSymbol?0:(c.change_1d||0),change7d:c.change_7d||0};
    });
  }
  defiCache.t=Date.now();
  }catch(e){}
}

/* ═══ Coinbase — Direct Price Fetch (no PROXY needed) ═══ */
var cbCache={t:0};
async function fetchCoinbasePrices(){
  if(Date.now()-cbCache.t<30000)return;
  var coins=['BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','LINK','DOT',
    'MATIC','UNI','ATOM','LTC','NEAR','APT','ARB','OP','SUI','SEI',
    'INJ','TIA','FIL','HBAR','ICP','PEPE','WIF','STX','IMX','FTM','AAVE'];
  var BATCH=6;
  for(var i=0;i<coins.length;i+=BATCH){
    var batch=coins.slice(i,i+BATCH);
    var proms=batch.map(function(s){
      return fj(CB+'/prices/'+s+'-USD/spot').then(function(d){
        if(d&&d.data&&d.data.amount)CBP[s]=+d.data.amount;
      }).catch(function(){})
    });
    try{await Promise.all(proms)}catch(e){}
    if(i+BATCH<coins.length)await new Promise(function(r){setTimeout(r,200)});
  }
  cbCache.t=Date.now();
}

/* ═══ Tokenomist — FREE: Token Unlocks ═══ */
async function fetchTokenUnlocks(){
  if(Date.now()-unlockCache.t<3600000&&tokenUnlocks.length>0)return;
  try{
  var data=await fj('https://api.tokenomist.ai/v1/unlocks/upcoming?limit=15');
  if(data&&data.length){
    tokenUnlocks=data.map(function(u){return{
      sym:(u.symbol||u.token||'').toUpperCase(),
      date:u.date||u.unlock_date||'',
      amount:+u.value_usd||+u.amount||0,
      tokens:+u.token_amount||+u.tokens||0,
      pct:+u.pct_of_supply||+u.percent||0,
      type:u.category||u.type||'',
      name:u.name||u.project||''
    }}).filter(function(u){return u.sym&&u.amount>100000});
    if(tokenUnlocks.length){
      TOKEN_UNLOCKS=tokenUnlocks.map(function(u){return{sym:u.sym,date:u.date,amount:u.amount}});
      unlockCache.t=Date.now();
    }
  }
  }catch(e){}
  if(!tokenUnlocks.length){
    TOKEN_UNLOCKS=[
      {sym:'ARB',date:'2026-04-16',amount:92650000},
      {sym:'APT',date:'2026-04-12',amount:81000000},
      {sym:'OP',date:'2026-04-30',amount:35000000},
      {sym:'SUI',date:'2026-05-01',amount:120000000},
      {sym:'TIA',date:'2026-04-20',amount:85000000},
      {sym:'SEI',date:'2026-04-15',amount:45000000},
      {sym:'STRK',date:'2026-04-25',amount:60000000}
    ];
    tokenUnlocks=TOKEN_UNLOCKS.map(function(u){return{sym:u.sym,date:u.date,amount:u.amount,tokens:0,pct:0,type:'team/investor',name:u.sym}});
    unlockCache.t=Date.now();
  }
}

/* ═══ DeFiLlama Indicator Card — Stablecoin Flows ═══ */
function buildStablecoinCard(){
  var coins=['USDT','USDC','DAI','FDUSD','TUSD'];
  var entries=coins.filter(function(s){return stablecoinData[s]}).map(function(s){return{sym:s,data:stablecoinData[s]}});
  if(!entries.length)return'';
  var totalSupply=entries.reduce(function(s,e){return s+e.data.supply},0);
  var usdtData=stablecoinData['USDT'];
  var usdcData=stablecoinData['USDC'];
  var rows='';
  entries.forEach(function(e){
    var d=e.data;var pct=totalSupply>0?(d.supply/totalSupply*100):0;
    var cls=d.change7d>1?'up':d.change7d<-1?'dn':'warn';
    var bar='<div style="flex:1;height:6px;background:var(--bg2);border-radius:3px;overflow:hidden;min-width:50px"><div style="width:'+Math.min(100,pct).toFixed(0)+'%;height:100%;background:var(--'+cls+');border-radius:3px"></div></div>';
    rows+='<div class="ind-row"><span class="ind-sym">'+e.sym+'</span>'
      +bar
      +'<span style="font-size:9px;color:var(--t1);min-width:52px;font-family:var(--fm)">$'+fmt(d.supply)+'</span>'
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:42px;font-family:var(--fm);direction:ltr">'+(d.change7d>=0?'+':'')+d.change7d.toFixed(1)+'%</span></div>';
  });
  /* Interpretation */
  var usdtChg=usdtData?usdtData.change7d:0;
  var signal=usdtChg>2?(lang==='ar'?'🟢 USDT يُطبع — أموال جديدة تدخل!':'🟢 USDT minting — New money entering!'):usdtChg<-2?(lang==='ar'?'🔴 USDT يُحرق — أموال تخرج!':'🔴 USDT burning — Money leaving!'):lang==='ar'?'🟡 مستقر':'🟡 Stable';
  var signalCol=usdtChg>2?'var(--up)':usdtChg<-2?'var(--dn)':'var(--warn)';
  var guide='<div class="ind-guide" style="color:'+signalCol+';font-weight:700">'+signal+'</div>'
    +'<div class="ind-guide">📖 '+(lang==='ar'?'USDT يُطبع = صعود قريب | يُحرق = هبوط قريب — يسبق السعر 24-48h':'USDT mint = pump soon | burn = dump soon — leads price 24-48h')+'</div>';
  return indCardWrap('💵','rgba(0,255,136,.06)','rgba(0,255,136,.12)',lang==='ar'?'تدفق Stablecoins الحقيقي':'Real Stablecoin Flow',lang==='ar'?'DeFiLlama — بيانات حقيقية':'DeFiLlama — real data','$'+fmt(totalSupply),'var(--neon)',rows+guide);
}

/* ═══ DeFiLlama Indicator Card — TVL ═══ */
function buildTVLCard(){
  var topChains=['Ethereum','Solana','BSC','Arbitrum','Base','Polygon','Avalanche','Optimism'];
  var entries=topChains.filter(function(c){return defiTVL[c]}).map(function(c){return{name:c,data:defiTVL[c]}});
  if(!entries.length)return'';
  entries.sort(function(a,b){return b.data.tvl-a.data.tvl});
  var totalTVL=entries.reduce(function(s,e){return s+e.data.tvl},0);
  var rows='';
  entries.slice(0,8).forEach(function(e,i){
    var d=e.data;var pct=totalTVL>0?(d.tvl/totalTVL*100):0;
    var ch=d.change7d||0;var cls=ch>5?'up':ch<-5?'dn':'warn';
    var icons={Ethereum:'⟠',Solana:'◎',BSC:'⬡',Arbitrum:'🔵',Base:'🔷',Polygon:'🟣',Avalanche:'🔺',Optimism:'🔴'};
    rows+='<div class="ind-row"><span class="ind-sym">'+(icons[e.name]||'●')+' '+e.name+'</span>'
      +'<span style="font-size:9px;color:var(--neon);min-width:52px;font-family:var(--fm)">$'+fmt(d.tvl)+'</span>'
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:42px;font-family:var(--fm);direction:ltr">'+(ch>=0?'+':'')+ch.toFixed(1)+'%</span></div>';
  });
  var ethTVL=defiTVL['Ethereum']?defiTVL['Ethereum'].tvl:0;var ethDom=totalTVL>0?(ethTVL/totalTVL*100):0;
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'TVL ينزل = الناس تسحب أموالها = هبوط | يزيد = ثقة = صعود':'TVL drops = money leaving = bearish | TVL rises = confidence = bullish')+'</div>';
  return indCardWrap('🏦','rgba(98,126,234,.06)','rgba(98,126,234,.12)','DeFi TVL',lang==='ar'?'القيمة المقفلة — '+entries.length+' chains':'Total Value Locked — '+entries.length+' chains','$'+fmt(totalTVL),'var(--neon)',rows+guide);
}

/* ═══ Token Unlocks Indicator Card ═══ */
function buildUnlocksCard(){
  if(!tokenUnlocks.length)return'';
  var now=new Date();
  var upcoming=tokenUnlocks.filter(function(u){return new Date(u.date)>=now}).sort(function(a,b){return new Date(a.date)-new Date(b.date)});
  if(!upcoming.length)return'';
  var rows='';var dangerCount=0;
  upcoming.slice(0,8).forEach(function(u){
    var dt=new Date(u.date);var days=Math.ceil((dt-now)/86400000);
    var cls=days<=3?'dn':days<=7?'warn':'t2';
    if(days<=7&&u.amount>50000000)dangerCount++;
    var urgency=days<=1?(lang==='ar'?'🔴 اليوم!':'🔴 Today!'):days<=3?(lang==='ar'?'🟠 قريب':'🟠 Soon'):days<=7?(lang==='ar'?'🟡 هذا الأسبوع':'🟡 This week'):(lang==='ar'?days+' يوم':days+'d');
    rows+='<div class="ind-row"><span class="ind-sym">'+u.sym+'</span>'
      +'<span style="font-size:9px;color:var(--t1);min-width:52px;font-family:var(--fm)">$'+fmt(u.amount)+'</span>'
      +(u.pct?'<span style="font-size:8px;color:var(--warn);min-width:32px">'+u.pct.toFixed(1)+'%</span>':'')
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:55px;font-weight:700">'+urgency+'</span></div>';
  });
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'فك توكنات = ضغط بيع محتمل — تجنب الشراء قبل الفك بـ 3 أيام':'Token unlock = sell pressure — avoid buying 3 days before unlock')+'</div>';
  var verdict=dangerCount>0?(lang==='ar'?'⚠️ '+dangerCount+' خطر':'⚠️ '+dangerCount+' danger'):(lang==='ar'?'✅ آمن':'✅ Safe');
  var vCol=dangerCount>0?'var(--dn)':'var(--up)';
  return indCardWrap('🔓','rgba(255,184,0,.06)','rgba(255,184,0,.12)',lang==='ar'?'فك التوكنات القادمة':'Upcoming Token Unlocks',lang==='ar'?upcoming.length+' حدث قادم':upcoming.length+' upcoming events',verdict,vCol,rows+guide);
}


function quickScan(){var STABLES=['USDT','USDC','TUSD','DAI','BUSD','FDUSD','USDP','PYUSD'];var cands=[];
  var tkCount=Object.keys(T).length;
  var btcOk=T.BTC?T.BTC.c>-2:true;
  Object.entries(T).forEach(function(e){var s=e[0],d=e[1];if(STABLES.includes(s))return;
  if(!d.p||d.p<=0)return;
  var tier=getCoinTier(s);
  var isTier1=TIER1.has(s);
  var isTier2=tier2Coins.includes(s);
  var minVol=tkCount<50?500000:isTier1?1000000:isTier2?2000000:5000000;
  if(d.v<minVol&&!isTier1)return;
  if(!isTier1&&!isTier2&&d.v<5000000)return;
  /* ═══ BLOCK: too late or overheated ═══ */
  if(d.c>=8)return;
  var sc=0,tags=[];
  /* Tier bonus */
  if(isTier1){sc+=10;tags.push('🏆TOP100')}
  else if(isTier2){sc+=5;tags.push('🥈T2')}
  else{sc+=2;tags.push('🔍NEW')}
  /* ═══ CORE: Silent Accumulation — volume + flat price ═══ */
  if(d.v>5e7&&Math.abs(d.c)<2){sc+=25;tags.push('🐋ACC')}
  if(d.v>3e7&&d.c>=0.3&&d.c<2){sc+=20;tags.push('🔍EARLY')}
  if(d.v>8e7&&d.c>=0.5&&d.c<3){sc+=15;tags.push('🔍STEALTH')}
  /* Already moving — penalise lateness */
  if(d.c>=3&&d.c<5){sc+=8;tags.push('📈RISING')}
  if(d.c>=5&&d.c<8){sc-=5;tags.push('⚠️LATE')}
  /* Penalties for late entries */
  if(d.c>3)sc-=15;
  if(d.c>5)sc-=30;
  /* Volume anomaly */
  if(d.v>1e9){sc+=25;tags.push('🔥MEGA_VOL')}
  else if(d.v>1e8){sc+=18;tags.push('📊HIGH_VOL')}
  else if(d.v>3e7){sc+=10;tags.push('📊VOL')}
  else if(d.v>1e7){sc+=5;tags.push('📊vol')}
  /* Near daily high with volume = breakout imminent */
  if(d.h>0&&d.p>0&&((d.h-d.p)/d.p)*100<1.5&&d.c>0&&d.c<3){sc+=12;tags.push('🎯AT_HIGH')}
  /* Bottom buying */
  if(d.h&&d.l&&d.h!==d.l&&((d.p-d.l)/(d.h-d.l))*100<25&&d.v>5e6){sc+=10;tags.push('📉BOTTOM')}
  /* ═══ DATA SOURCE 1: aggCVD — cumulative volume delta ═══ */
  if(aggCVD[s]&&aggCVD[s].trend==='BUYING'&&aggCVD[s].delta>0&&d.c<3){sc+=20;tags.push('📊CVD_BUY')}
  /* ═══ DATA SOURCE 2: takerData — taker buy/sell ratio ═══ */
  if(takerData[s]&&takerData[s].avg>0&&takerData[s].ratio>takerData[s].avg*1.3){sc+=15;tags.push('💹TAKER')}
  /* ═══ DATA SOURCE 3: depthSnapshots — order book depth ═══ */
  if(depthSnapshots[s]&&depthSnapshots[s].bids&&depthSnapshots[s].asks){
    var _bTotal=0,_aTotal=0;
    for(var _bi=0;_bi<depthSnapshots[s].bids.length;_bi++){_bTotal+=parseFloat(depthSnapshots[s].bids[_bi][0])*parseFloat(depthSnapshots[s].bids[_bi][1])}
    for(var _ai=0;_ai<depthSnapshots[s].asks.length;_ai++){_aTotal+=parseFloat(depthSnapshots[s].asks[_ai][0])*parseFloat(depthSnapshots[s].asks[_ai][1])}
    if(_aTotal>0&&_bTotal/_aTotal>1.5){sc+=15;tags.push('📗WALL')}
  }
  /* ═══ DATA SOURCE 4: bookTickers — best bid/ask ═══ */
  if(bookTickers[s]&&bookTickers[s].bidQty>0&&bookTickers[s].askQty>0){
    if(bookTickers[s].bidQty>bookTickers[s].askQty*2&&bookTickers[s].spread<0.15){sc+=12;tags.push('📘BID_PRESS')}
  }
  /* ═══ DATA SOURCE 5: FR — funding rate ═══ */
  var fr=FR[s];
  if(fr){
    if(fr.rate<-0.01){sc+=12;tags.push('FR⬇️')}
    else if(fr.rate<0){sc+=5;tags.push('FR-')}
    else if(fr.rate>0.08){sc-=8;tags.push('FR⚠️')}
  }
  /* ═══ DATA SOURCE 6: LS — long/short ratio ═══ */
  if(LS[s]&&LS[s].ratio<0.8){sc+=10;tags.push('🩳SHORTS')}
  /* ═══ DATA SOURCE 7: OI + oiHistory — open interest ═══ */
  if(OI[s]&&oiHistory[s]&&oiHistory[s].length>=2){
    var _oiLast=oiHistory[s][oiHistory[s].length-1];
    var _oiPrev=oiHistory[s][Math.max(0,oiHistory[s].length-4)];
    if(_oiLast&&_oiPrev&&_oiPrev.oi>0){
      var _oiChg=((_oiLast.oi-_oiPrev.oi)/_oiPrev.oi)*100;
      if(_oiChg>15&&Math.abs(d.c)<3){sc+=10;tags.push('📈OI_BUILD')}
    }
  } else if(OI[s]&&d.c>0){sc+=4;tags.push('OI↑')}
  /* ═══ DATA SOURCE 8: topTradersLS — smart money ═══ */
  if(topTradersLS[s]&&topTradersLS[s].positions&&topTradersLS[s].positions.length>0){
    var _topLatest=topTradersLS[s].positions[topTradersLS[s].positions.length-1];
    if(_topLatest&&_topLatest.long>0.55&&LS[s]&&LS[s].short>55){sc+=10;tags.push('🧠SMART')}
  }
  /* ═══ DATA SOURCE 9: coinalyzeFR — multi-exchange FR ═══ */
  if(coinalyzeFR[s]&&coinalyzeFR[s].rate<-0.01){sc+=8;tags.push('🌐FR_NEG')}
  /* ═══ DATA SOURCE 10: liquidationData — recent liquidations ═══ */
  if(liquidationData[s]&&liquidationData[s].length>0){
    var _liqShortVal=0;var _oneHourAgo=Date.now()-3600000;
    for(var _li=0;_li<liquidationData[s].length;_li++){
      var _lq=liquidationData[s][_li];
      if(_lq.side==='SELL'&&_lq.time>_oneHourAgo)_liqShortVal+=(_lq.value||0);
    }
    if(_liqShortVal>500000){sc+=8;tags.push('💥LIQ_SHORT')}
  }
  /* ═══ DATA SOURCE 11: VPIN — informed trading ═══ */
  var _vp=calcVPIN(s);
  if(_vp&&_vp.vpin>0.55){sc+=15;tags.push('🧪VPIN_HIGH')}
  else if(_vp&&_vp.vpin>0.4){sc+=6;tags.push('🧪VPIN')}
  /* ═══ DATA SOURCE 12: Bybit premium ═══ */
  if(d.by&&d.p&&d.p>0&&((d.by-d.p)/d.p)>0.003){sc+=12;tags.push('🅱️BY_PREM')}
  /* ═══ DATA SOURCE 13: Coinbase premium ═══ */
  if(CBP[s]&&d.p&&d.p>0&&((CBP[s]-d.p)/d.p)>0.002){sc+=12;tags.push('🏦CB_PREM')}
  /* ═══ DATA SOURCE 14: detectIceberg ═══ */
  var _ice=detectIceberg(s);
  if(_ice&&_ice.signal==='ICEBERG_BUY'){sc+=15;tags.push('🧊ICE_BUY')}
  /* ═══ DATA SOURCE 15: detectAbsorption ═══ */
  var _absorb=detectAbsorption(s);
  if(_absorb&&_absorb.signal==='BULLISH_ABSORPTION'){sc+=12;tags.push('🛡️ABSORB')}
  /* ═══ DATA SOURCE 16: getPredArrow ═══ */
  var _pred=getPredArrow(s);
  if(_pred&&_pred.sc>=4){sc+=8;tags.push('▲▲')}
  else if(_pred&&_pred.sc<=-4){sc-=15}
  /* ═══ BTC market check ═══ */
  if(btcOk){sc+=5;tags.push('BTC✅')}
  else{sc-=10}
  /* ═══ Negative change + high volume = reversal ═══ */
  if(d.c<=-3&&d.c>=-10&&d.v>5e7){sc+=12;tags.push('🔄REVERSAL')}
  if(sc>=15)cands.push({s:s,p:d.p,c:d.c,v:d.v,score:sc,tags:tags,fr:fr?fr.rate:null,by:d.by,cb:CBP[s]})});
  return cands.sort(function(a,b){return b.score-a.score})}
/* DEEP ANALYZE — tier-aware: T1=6 checks, T2=4 checks, T3=volume only */
async function deepAnalyze(cands){var results=[];var top=cands.slice(0,50);
  var klData={},obData={},kl5Data={},kl15Data={};
  /* Rate-limit aware: top10 get 5m+15m, top15 get 1h */
  var t1t2=top.filter(function(c){return getCoinTier(c.s)<=2||c.score>=30});
  var top10=t1t2.slice(0,10);
  var top15=t1t2.slice(0,15);
  /* Fetch 1h klines for top 15 */
  var klProms=top15.map(function(c){return fj(BN+'/klines?symbol='+c.s+'USDT&interval=1h&limit=30').then(function(d){klData[c.s]=d}).catch(function(){})});
  /* Fetch 15m klines for top 10 */
  var kl15Proms=top10.map(function(c){return fj(BN+'/klines?symbol='+c.s+'USDT&interval=15m&limit=40').then(function(d){kl15Data[c.s]=d}).catch(function(){})});
  /* Fetch 5m klines for top 10 */
  var kl5Proms=top10.map(function(c){return fj(BN+'/klines?symbol='+c.s+'USDT&interval=5m&limit=24').then(function(d){kl5Data[c.s]=d}).catch(function(){})});
  await Promise.all(klProms.concat(kl15Proms).concat(kl5Proms));
  /* Bybit fallback for coins without Binance klines */
  var byMissing=top.filter(function(c){return!klData[c.s]&&T[c.s]&&T[c.s].src==='BY'}).slice(0,10);
  if(byMissing.length){var byProms=byMissing.map(function(c){return fj('https://api.bybit.com/v5/market/kline?category=spot&symbol='+c.s+'USDT&interval=60&limit=30').then(function(d){if(d&&d.result&&d.result.list){klData[c.s]=d.result.list.reverse().map(function(k){return[+k[0],+k[1],+k[2],+k[3],+k[4],+k[5]]})}}).catch(function(){})});
    await Promise.all(byProms)}
  for(var ci=0;ci<top.length;ci++){var c=top[ci];var ds=c.score,dt=c.tags.slice();
    var checks={vol:false,ob:false,rsi:false,macd:false,fr:false,oi:false};var passed=0;
    /* ═══ CHECK 1: VOL Acceleration (5m klines preferred, fallback 1h) ═══ */
    var kl5=kl5Data[c.s];var kl=klData[c.s];
    if(kl5&&kl5.length>=12){
      var vols5=kl5.map(function(k){return+k[5]});
      var avg5=vols5.slice(0,-3).reduce(function(a,b){return a+b},0)/Math.max(1,vols5.length-3);
      var rec5=(vols5[vols5.length-1]+vols5[vols5.length-2]+vols5[vols5.length-3])/3;
      if(rec5>avg5*2.5){ds+=20;checks.vol=true;dt.push('VOL5m:'+Math.round(rec5/avg5*10)/10+'x')}
      else if(rec5>avg5*1.5){ds+=10;checks.vol=true;dt.push('VOL5m↑')}
    }
    if(!checks.vol&&kl&&kl.length>=20){
      var vols=kl.map(function(k){return+k[5]});
      var avgVol=vols.slice(0,-3).reduce(function(a,b){return a+b},0)/Math.max(1,vols.length-3);
      var recentVol=(vols[vols.length-1]+vols[vols.length-2])/2;
      if(recentVol>avgVol*1.8){ds+=18;checks.vol=true;dt.push('VOL:'+Math.round(recentVol/avgVol*10)/10+'x')}
      else if(recentVol>avgVol*1.3){ds+=10;checks.vol=true;dt.push('VOL↑')}
    }
    /* ═══ CHECK 2: OB Pressure — depthSnapshots (NO API call!) ═══ */
    var ob=depthSnapshots[c.s];
    if(ob&&ob.bids&&ob.bids.length&&ob.asks&&ob.asks.length){
      var bv=0,av=0;
      for(var _obi=0;_obi<ob.bids.length;_obi++){bv+=parseFloat(ob.bids[_obi][0])*parseFloat(ob.bids[_obi][1])}
      for(var _oai=0;_oai<ob.asks.length;_oai++){av+=parseFloat(ob.asks[_oai][0])*parseFloat(ob.asks[_oai][1])}
      var obRatio=bv/Math.max(av,1);
      if(obRatio>1.5){ds+=18;checks.ob=true;dt.push('OB:'+obRatio.toFixed(1)+'x')}
      else if(obRatio>1.2){ds+=10;checks.ob=true;dt.push('OB:'+obRatio.toFixed(1)+'x')}
    }
    /* ═══ CHECK 3: RSI Sweet Spot (15m klines preferred, fallback 1h) ═══ */
    var rsiCloses=null;
    var kl15=kl15Data[c.s];
    if(kl15&&kl15.length>=20){rsiCloses=kl15.map(function(k){return+k[4]})}
    else if(kl&&kl.length>=20){rsiCloses=kl.map(function(k){return+k[4]})}
    if(rsiCloses){
      var rsi=calcRSI(rsiCloses);
      var rsiPrev=calcRSI(rsiCloses.slice(0,-1));
      var rsiRising=rsi>rsiPrev;
      if(rsi>=35&&rsi<=55&&rsiRising){ds+=15;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'↑✅')}
      else if(rsi>=35&&rsi<=55){ds+=10;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'✅')}
      else if(rsi<30){ds+=12;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'🟢')}
      else if(rsi>75){ds-=10;dt.push('RSI:'+rsi.toFixed(0)+'⚠️')}
    }
    /* MACD from 1h klines (supplementary, not a check) */
    if(kl&&kl.length>=26){
      var macdCloses=kl.map(function(k){return+k[4]});
      var macd=calcMACD(macdCloses);
      if(macd.h>0){ds+=8;dt.push('MACD✅')}
      if(macd.cross==='bull'){ds+=5;dt.push('MACD🔀↑')}
    }
    /* ═══ CHECK 4: Smart Money — topTradersLS + LS ═══ */
    if(topTradersLS[c.s]&&topTradersLS[c.s].positions&&topTradersLS[c.s].positions.length>0){
      var _topPos=topTradersLS[c.s].positions[topTradersLS[c.s].positions.length-1];
      if(_topPos&&_topPos.long>0.55){
        ds+=12;checks.macd=true;dt.push('🧠SMART_LONG');
        if(LS[c.s]&&LS[c.s].short>55){ds+=8;dt.push('🧠vs_RETAIL')}
      }
    } else if(LS[c.s]&&LS[c.s].ratio<0.8){
      ds+=8;checks.macd=true;dt.push('🩳SQUEEZE_SETUP');
    }
    /* ═══ CHECK 5: FR Favorable — Binance + multi-exchange ═══ */
    if(FR[c.s]){
      if(FR[c.s].rate<-0.02){ds+=15;checks.fr=true;dt.push('FR⬇️🟢')}
      else if(FR[c.s].rate<0.01){ds+=10;checks.fr=true;dt.push('FR✅')}
      else if(FR[c.s].rate>0.05){ds-=8;dt.push('FR⚠️')}
      /* Multi-exchange confirmation */
      if(checks.fr&&coinalyzeFR[c.s]&&coinalyzeFR[c.s].rate<0){ds+=5;dt.push('🌐FR✅')}
    }
    /* ═══ CHECK 6: Informed Flow — any 2 of 4: CVD, taker, VPIN, exchange premium ═══ */
    var _ifCount=0;
    if(aggCVD[c.s]&&aggCVD[c.s].trend==='BUYING'&&aggCVD[c.s].delta>0)_ifCount++;
    if(takerData[c.s]&&takerData[c.s].avg>0&&takerData[c.s].ratio>takerData[c.s].avg*1.2)_ifCount++;
    var _vpCheck=calcVPIN(c.s);
    if(_vpCheck&&_vpCheck.vpin>0.4)_ifCount++;
    var _exPrem=false;
    if(T[c.s]&&T[c.s].by&&T[c.s].p>0&&((T[c.s].by-T[c.s].p)/T[c.s].p)>0.002)_exPrem=true;
    if(CBP[c.s]&&T[c.s]&&T[c.s].p>0&&((CBP[c.s]-T[c.s].p)/T[c.s].p)>0.002)_exPrem=true;
    if(_exPrem)_ifCount++;
    if(_ifCount>=2){ds+=15;checks.oi=true;dt.push('📡INFORMED:'+_ifCount+'/4')}
    else if(_ifCount===1){ds+=5;checks.oi=true;dt.push('📡FLOW')}
    passed=Object.values(checks).filter(Boolean).length;
    /* ═══ ULTRA v3.0 — Maximum Accuracy ═══ */
    var isUltra=false;var isConf=false;var whaleConf=0;var smartEntry=null;
    var basicPass=ds>=70&&passed>=5;var confPass=ds>=50&&passed>=4;
    var tooLate=c.c>=5;
    var btcOk=T.BTC?T.BTC.c>-3:true;var fgOk=fgValue>=20;var marketSafe=btcOk&&fgOk;
    /* Market breadth filter */
    var allUp=Object.values(T).filter(function(x){return x.c>0}).length;var breadthPct=Object.keys(T).length>0?allUp/Object.keys(T).length*100:50;
    var fomo=breadthPct>80;var crash=breadthPct<20;
    if(crash){ds=Math.max(ds-20,Math.round(ds*0.6));dt.push('⚠️CRASH_MKT');basicPass=ds>=70&&passed>=5;confPass=ds>=50&&passed>=4}
    if(basicPass&&!tooLate&&marketSafe){
      try{var wEng=await whaleEngine(c.s);whaleConf=wEng?wEng.confidence:0;
        var cvdChk=analyzeCVD(c.s);var btcDivChk=detectBTCDivergence(c.s);
        if(cvdChk.divergence==='BEARISH'||btcDivChk.signal==='WHALE_DISTRIBUTING')whaleConf=Math.max(0,whaleConf-30);
        if(fomo)whaleConf=Math.min(whaleConf,60);
        isUltra=whaleConf>=50&&basicPass;
        isConf=whaleConf>=30&&confPass&&!tooLate;
        /* Smart Entry — from real levels */
        smartEntry={entry:c.p*0.985,stop:c.p*0.93,target1:c.p*1.05,target2:c.p*1.10,rr:((c.p*1.05-c.p*0.985)/(c.p*0.985-c.p*0.93)).toFixed(1)};
        /* Use 15m klines for precise support/resistance */
        var _entryKl=kl15Data[c.s]||klData[c.s];
        if(_entryKl&&_entryKl.length>=10){
          var lows=_entryKl.map(function(k){return+k[3]});var highs=_entryKl.map(function(k){return+k[2]});
          var sup=Math.min.apply(null,lows.slice(-8));
          var res=Math.max.apply(null,highs.slice(-20));
          smartEntry.entry=c.c<1?c.p:Math.max(c.p*0.985,sup*1.005);
          smartEntry.stop=sup*0.985;
          smartEntry.target1=res;
          smartEntry.target2=res*1.05;
          var risk=smartEntry.entry-smartEntry.stop;
          smartEntry.rr=risk>0?((smartEntry.target1-smartEntry.entry)/risk).toFixed(1):'0';
          smartEntry.support=sup;smartEntry.resistance=res;
          /* Filter: profit not worth risk */
          if(smartEntry.entry>0&&((smartEntry.target1-smartEntry.entry)/smartEntry.entry)<0.03){
            isUltra=false;isConf=false;
          }
        }
        if(+smartEntry.rr<2.0){isUltra=false;if(+smartEntry.rr>=1.5)isConf=true;else isConf=false}
      }catch(e){isUltra=ds>=80&&passed>=5&&!tooLate&&marketSafe;isConf=ds>=60&&passed>=4&&!tooLate}}
    else{isConf=confPass&&!tooLate&&c.c<5}
    /* Record signal + notify */
    if(isUltra){recSig(c.s,'ultra',c.p);notify(c.s,'ultra',ds,{score:ds,checks:checks,passed:passed,total:6})}
    if(c.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')})){recSig(c.s,'whale',c.p);if(c.v>5e7||checks.ob)notify(c.s,'whale',ds)}
    if(c.c>=3)recSig(c.s,'breakout',c.p);
    recSig(c.s,'trade',c.p);
    /* Build result with new + old fields */
    var sigInfo=sigHist[c.s+'_trade'];
    var _priceAtDet=sigInfo&&sigInfo.priceAtDetection?sigInfo.priceAtDetection:c.p;
    var _ageMins=sigInfo&&sigInfo.firstSeen?Math.floor((Date.now()-sigInfo.firstSeen)/60000):0;
    var _changeDet=_priceAtDet>0?((c.p-_priceAtDet)/_priceAtDet)*100:0;
    var _freshness='fresh';
    if(_ageMins>60||Math.abs(_changeDet)>5)_freshness='old';
    else if(_ageMins>15||Math.abs(_changeDet)>2)_freshness='warm';
    results.push({s:c.s,p:c.p,c:c.c,v:c.v,score:ds,tags:dt,checks:checks,passed:passed,total:6,ultra:isUltra,confirmed:isConf,fr:c.fr,by:c.by,cb:c.cb,whaleConf:whaleConf,smartEntry:smartEntry,detectedAt:getSigTime(c.s,isUltra?'ultra':'trade'),priceAtDetection:_priceAtDet,ageMinutes:_ageMins,changeFromDetection:_changeDet,freshness:_freshness})}
  return results.sort(function(a,b){return b.score-a.score})}
/* ═══ QUALITY FILTER v3 — strict gate before rendering ═══ */
function qualityFilter(results){
  return results.filter(function(r){
    if(r.c>=5)return false;
    if(r.passed<4)return false;
    if(r.smartEntry&&+r.smartEntry.rr<2.0)return false;
    if(FR[r.s]&&FR[r.s].rate>0.05)return false;
    if(T.BTC&&T.BTC.c<-3)return false;
    /* Timing filter: drift too far from detection */
    var sig=sigHist[r.s+'_trade'];
    if(sig&&typeof sig==='object'&&sig.priceAtDetection>0){
      var drift=((r.p-sig.priceAtDetection)/sig.priceAtDetection)*100;
      if(drift>8)return false;
    }
    return true;
  }).slice(0,7);
}
/* MARKET HEALTH */
function calcHealth(){var sc=0,f=[];sc+=fgValue<25?5:fgValue<40?10:fgValue<60?15:fgValue<75?18:12;f.push({l:'Fear/Greed',v:fgValue,c:fgValue<30?'dn':fgValue>70?'up':'warn'});sc+=btcDom>60?8:btcDom>50?12:btcDom>40?15:10;f.push({l:'BTC Dom',v:btcDom.toFixed(1)+'%',c:btcDom>55?'warn':'neon'});var bk=Object.values(T).filter(function(x){return x.c>=8}).length;sc+=bk>20?15:bk>10?12:bk>5?10:5;f.push({l:lang==='ar'?'انفجارات':'Breakouts',v:bk,c:bk>15?'up':bk>5?'warn':'dn'});var rs=Object.values(T).filter(function(x){return x.c>0}).length,tt=Object.keys(T).length,bp=tt>0?Math.round(rs/tt*100):50;sc+=bp>60?15:bp>45?10:5;f.push({l:lang==='ar'?'صاعدة':'Bullish',v:bp+'%',c:bp>60?'up':bp>40?'warn':'dn'});var af=Object.values(FR).reduce(function(s,x){return s+x.rate},0)/Math.max(1,Object.keys(FR).length);sc+=af>0.05?5:af>0.02?10:af<-0.01?18:15;f.push({l:'Avg FR',v:(af>=0?'+':'')+af.toFixed(4)+'%',c:af>0.05?'dn':af<-0.01?'up':'warn'});var vc=Object.values(T).filter(function(x){return x.v>1e8}).length;sc+=vc>15?15:vc>8?10:5;f.push({l:'Vol>$100M',v:vc,c:vc>10?'up':'warn'});return{score:Math.min(100,sc),factors:f}}
function getWarnings(){var w=[];Object.entries(FR).filter(function(e){return WL.includes(e[0])}).forEach(function(e){if(e[1].rate>0.08)w.push({ic:'🔴',txt:e[0]+': FR '+e[1].rate.toFixed(3)+'% — '+(lang==='ar'?'خطر تصفية':'Liquidation risk')});if(e[1].rate<-0.05)w.push({ic:'🟢',txt:e[0]+': FR '+e[1].rate.toFixed(3)+'% — '+(lang==='ar'?'فرصة شراء':'Buy opportunity')})});Object.entries(LS).forEach(function(e){if(e[1].ratio>2)w.push({ic:'⚠️',txt:e[0]+': L/S '+e[1].ratio.toFixed(2)+' — '+(lang==='ar'?'Long مفرط':'Excessive Longs')});if(e[1].ratio<0.6)w.push({ic:'⚠️',txt:e[0]+': L/S '+e[1].ratio.toFixed(2)+' — Short Squeeze'})});return w.slice(0,4)}
/* ACCURACY */
function savePred(sym,p,tgt,sc){predictions.push({sym:sym,price:p,target:tgt,score:sc,time:Date.now(),checked:false,hit:false,partial:false});if(predictions.length>100)predictions=predictions.slice(-100);try{localStorage.setItem('nxpred10',JSON.stringify(predictions))}catch(e){}}
function getAcc(){var ch=false;predictions.forEach(function(p){if(!p.checked&&Date.now()-p.time>12*3600*1000){var cur=T[p.sym];if(cur){p.checked=true;var gain=(cur.p-p.price)/p.price*100;p.hit=gain>=5;p.partial=gain>=2&&gain<5;p.finalPrice=cur.p;p.pnl=gain;ch=true}}});if(ch)try{localStorage.setItem('nxpred10',JSON.stringify(predictions))}catch(e){};var c=predictions.filter(function(p){return p.checked});var hits=c.filter(function(p){return p.hit}).length;var partials=c.filter(function(p){return p.partial}).length;return{total:c.length,hits:hits,partials:partials,rate:c.length>0?Math.round((hits+partials*0.5)/c.length*100):0}}
function renderAcc(id){var a=getAcc();var el=document.getElementById(id);if(!el)return;
  var types={ultra:{h:0,t:0,p:0},whale:{h:0,t:0,p:0},brk:{h:0,t:0,p:0}};
  predictions.filter(function(p){return p.checked}).forEach(function(p){
    if(p.score>=60){types.ultra.t++;if(p.hit)types.ultra.h++;if(p.partial)types.ultra.p++}
    else if(p.score>=40){types.whale.t++;if(p.hit)types.whale.h++;if(p.partial)types.whale.p++}
    else{types.brk.t++;if(p.hit)types.brk.h++;if(p.partial)types.brk.p++}});
  var uR=types.ultra.t>0?Math.round((types.ultra.h+types.ultra.p*0.5)/types.ultra.t*100):0;
  var wR=types.whale.t>0?Math.round((types.whale.h+types.whale.p*0.5)/types.whale.t*100):0;
  var bR=types.brk.t>0?Math.round((types.brk.h+types.brk.p*0.5)/types.brk.t*100):0;
  var accCol=a.rate>=60?'var(--up)':a.rate>=40?'var(--warn)':'var(--t2)';
  var recent=predictions.filter(function(p){return p.checked}).slice(-8).reverse();
  var totalPnl=0;recent.forEach(function(p){totalPnl+=(p.pnl||0)});
  /* Profit Factor */
  var gains=0,losses=0;recent.forEach(function(p){if(p.pnl>0)gains+=p.pnl;else losses+=Math.abs(p.pnl||0)});
  var pf=losses>0?(gains/losses).toFixed(1):'∞';
  var pfHTML=' | PF:<b style="color:'+(gains>losses?'var(--up)':'var(--dn)')+'">'+pf+'x</b>';
  /* Open trades */
  var openTr=activeTrades.filter(function(t){return t.status==='OPEN'});
  var openHTML='';
  if(openTr.length){openHTML='<div style="margin-top:10px;border-top:1px solid var(--bdr);padding-top:8px"><div style="font-size:10px;font-weight:700;color:var(--neon);margin-bottom:6px">🟢 '+(lang==='ar'?openTr.length+' صفقات مفتوحة':openTr.length+' Open Trades')+'</div>';
    openTr.forEach(function(tr){var pnl=tr.pnl||0;var pCol=pnl>=0?'var(--up)':'var(--dn)';var icons={ultra:'⭐',whale:'🐋',gem:'💎',breakout:'💥'};
      openHTML+='<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:9px;font-family:var(--fm)">'
        +'<span style="font-weight:800">'+(icons[tr.type]||'📊')+' '+tr.sym+'</span>'
        +'<span style="color:var(--t3)">'+fP(tr.entry)+'</span>'
        +'<span style="font-weight:700;color:'+pCol+'">'+(pnl>=0?'+':'')+pnl.toFixed(1)+'%'+(tr.t1Hit?' 🎯':'')+'</span>'
        +'<span style="font-size:7px;color:var(--t3)">max:+'+tr.maxGain.toFixed(1)+'%</span></div>'});
    openHTML+='</div>'}
  /* Build recent trades HTML */
  var recentHTML='';
  if(recent.length){recentHTML='<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">'+(lang==='ar'?'📜 آخر الصفقات':'📜 Recent Trades')+'</div><div style="background:var(--bg2);border-radius:10px;overflow:hidden">';
    recent.forEach(function(p,i){var pnl=p.pnl||0;var st=p.hit?'✅':p.partial?'🟡':'❌';var stC=p.hit?'var(--up)':p.partial?'var(--warn)':'var(--dn)';
      /* Find matching closed trade for exit reason */
      var ct=activeTrades.find(function(t){return t.sym===p.sym&&t.status==='CLOSED'&&Math.abs(t.entryTime-p.time)<60000});
      var exitInfo=ct?'<div style="font-size:7px;color:var(--t3)">'+ct.exitReason+' | max:+'+ct.maxGain.toFixed(1)+'%</div>':'';
      recentHTML+='<div style="padding:7px 8px;font-size:8px;font-family:var(--fm);'+(i<recent.length-1?'border-bottom:1px solid var(--bdr)':'')+'"><div style="display:grid;grid-template-columns:45px 1fr 55px;align-items:center"><span style="font-weight:800;color:var(--t0)">'+p.sym+'</span><span style="color:var(--t3)">'+fP(p.price)+(p.finalPrice?' → '+fP(p.finalPrice):'')+'</span><span style="text-align:center;font-weight:700;color:'+stC+'">'+st+' '+(pnl>=0?'+':'')+pnl.toFixed(1)+'%</span></div>'+exitInfo+'</div>'});
    recentHTML+='</div>'}
  el.innerHTML='<div class="cd" style="padding:14px"><div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="var det=this.parentElement.querySelector(\'.acc-det\');det.style.display=det.style.display===\'none\'?\'block\':\'none\'"><div style="display:flex;align-items:center;gap:14px"><div style="position:relative;width:56px;height:56px"><svg viewBox="0 0 36 36" style="width:56px;height:56px;transform:rotate(-90deg)"><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bdr)" stroke-width="2.5"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="'+accCol+'" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="'+Math.round(a.rate)+' '+(100-Math.round(a.rate))+'"/></svg><div style="position:absolute;inset:0;display:grid;place-items:center;font-family:var(--fd);font-size:16px;font-weight:800;color:'+accCol+'">'+a.rate+'%</div></div><div><div style="font-family:var(--fd);font-size:13px;font-weight:700;color:var(--t0)">'+(lang==='ar'?'نسبة نجاح الصفقات':'Trade Success Rate')+'</div><div style="font-size:9px;color:var(--t2);font-family:var(--fm)">'+a.hits+'✅ '+(a.partials||0)+'🟡 / '+a.total+' '+(lang==='ar'?'صفقة':'trades')+pfHTML+'</div><div style="font-size:8px;color:var(--t3);margin-top:2px">'+(lang==='ar'?'▼ اضغط للتفاصيل':'▼ Tap for details')+'</div></div></div><div style="text-align:center"><div style="font-size:24px">'+(a.rate>=60?'🏆':a.rate>=40?'📊':'📉')+'</div><div style="font-size:9px;font-family:var(--fm);color:'+(totalPnl>=0?'var(--up)':'var(--dn)')+';font-weight:700">'+(totalPnl>=0?'+':'')+totalPnl.toFixed(1)+'%</div></div></div>'
  /* Open trades section */
  +openHTML
  +'<div class="acc-det" style="display:none;margin-top:10px;border-top:1px solid var(--bdr);padding-top:10px"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px"><div style="background:var(--ultd);border-radius:10px;padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--ultra)">'+uR+'%</div><div style="font-size:8px;color:var(--t2);font-weight:600;margin-top:2px">⭐ ULTRA</div><div style="font-size:7px;font-family:var(--fm);color:var(--t3)">'+types.ultra.h+'✅/'+types.ultra.t+'</div><div style="height:4px;border-radius:2px;background:var(--bg2);margin-top:4px;overflow:hidden"><div style="height:100%;width:'+uR+'%;background:var(--ultra);border-radius:2px"></div></div></div><div style="background:var(--nd);border-radius:10px;padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--neon)">'+wR+'%</div><div style="font-size:8px;color:var(--t2);font-weight:600;margin-top:2px">🐋 '+(lang==='ar'?'حيتان':'Whales')+'</div><div style="font-size:7px;font-family:var(--fm);color:var(--t3)">'+types.whale.h+'✅/'+types.whale.t+'</div><div style="height:4px;border-radius:2px;background:var(--bg2);margin-top:4px;overflow:hidden"><div style="height:100%;width:'+wR+'%;background:var(--neon);border-radius:2px"></div></div></div><div style="background:var(--dd);border-radius:10px;padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--dn)">'+bR+'%</div><div style="font-size:8px;color:var(--t2);font-weight:600;margin-top:2px">💥 '+(lang==='ar'?'انفجار':'Breakout')+'</div><div style="font-size:7px;font-family:var(--fm);color:var(--t3)">'+types.brk.h+'✅/'+types.brk.t+'</div><div style="height:4px;border-radius:2px;background:var(--bg2);margin-top:4px;overflow:hidden"><div style="height:100%;width:'+bR+'%;background:var(--dn);border-radius:2px"></div></div></div></div>'+recentHTML+'</div></div>'}

/* ═══ 📊 TRADE MANAGER — Entry/Exit System ═══ */
function openTrade(sym,price,type,score,extra){
  if(activeTrades.some(function(t){return t.sym===sym&&t.status==='OPEN'}))return;
  var se=extra&&extra.smartEntry?extra.smartEntry:null;
  var tgts={ultra:{t1:1.05,t2:1.08,sl:0.97},whale:{t1:1.04,t2:1.07,sl:0.965},gem:{t1:1.08,t2:1.15,sl:0.95},breakout:{t1:1.03,t2:1.06,sl:0.96}};
  var t=tgts[type]||tgts.breakout;
  var trade={id:Date.now()+'_'+sym,sym:sym,type:type,score:score,entry:price,entryTime:Date.now(),
    target1:se?se.target1:price*t.t1,target2:se?se.target2:price*t.t2,stop:se?se.stop:price*t.sl,
    status:'OPEN',curPrice:price,pnl:0,maxGain:0,maxGainPrice:price,maxGainTime:Date.now(),minPnl:0,
    t1Hit:false,trailingStop:null,
    marketAtEntry:{btc:T.BTC?T.BTC.c:0,fg:fgValue},
    snapshots:[]};
  // === MONITOR HOOK: Capture factor snapshot at entry ===
  trade.factorSnapshot = captureFactorSnapshot(sym);
  trade.confAtEntry = score;
  activeTrades.push(trade);saveTrades();return trade}

function saveTrades(){if(activeTrades.length>200)activeTrades=activeTrades.slice(-200);try{localStorage.setItem('nxTrades',JSON.stringify(activeTrades))}catch(e){}}

function closeTrade(trade,exitPrice,reason){
  trade.status='CLOSED';trade.exitPrice=exitPrice;trade.exitTime=Date.now();trade.exitReason=reason;
  var rawPnl=((exitPrice-trade.entry)/trade.entry*100);
  trade.finalPnl=(trade.type==='SHORT')?-rawPnl:rawPnl;
  trade.duration=Date.now()-trade.entryTime;
  saveTrades();
  // === MONITOR HOOK: Process outcome ===
  try { processTradeOutcome(trade); } catch(e) {}
  /* Notification */
  var ic=trade.finalPnl>=0?'✅':'❌';var pnlStr=(trade.finalPnl>=0?'+':'')+trade.finalPnl.toFixed(1)+'%';
  var durH=Math.floor(trade.duration/3600000);var durM=Math.floor((trade.duration%3600000)/60000);
  showPopup(ic,trade.sym+' '+pnlStr,reason);
  addNotifHist(ic,trade.sym,'Exit',pnlStr+' | '+reason);
  sendTG('<b>'+ic+' '+trade.sym+'/USDT — '+reason+'</b>\n'
    +(lang==='ar'?'دخول':'Entry')+': '+fP(trade.entry)+' → '+(lang==='ar'?'خروج':'Exit')+': '+fP(exitPrice)+'\n'
    +(lang==='ar'?'النتيجة':'Result')+': <b>'+pnlStr+'</b>\n'
    +(lang==='ar'?'أعلى ربح':'Max Gain')+': +'+trade.maxGain.toFixed(1)+'%\n'
    +(lang==='ar'?'المدة':'Duration')+': '+durH+'h '+durM+'m\n'
    +'📍 NEXUS PRO v10')}

/* Whale profit-taking detection — uses a 10-min trailing confidence baseline,
   not the last-seen value, to avoid noise from 10-second polls. */
function detectWhaleProfitTaking(sym){
  var ww=whaleWaves[sym];if(!ww||!ww.engine)return{taking:false,signals:[]};
  var d=T[sym];if(!d)return{taking:false,signals:[]};
  var sigs=[],isTaking=false;var now=Date.now();
  /* Maintain a bounded confidence history (last 20 min) */
  if(!ww.confHist)ww.confHist=[];
  ww.confHist.push({t:now,c:ww.engine.confidence});
  var cutoff=now-20*60000;
  ww.confHist=ww.confHist.filter(function(x){return x.t>=cutoff});
  /* Find earliest sample at least 10 min old = baseline */
  var baseline=null;
  for(var _i=0;_i<ww.confHist.length;_i++){
    if(now-ww.confHist[_i].t>=10*60000){baseline=ww.confHist[_i];break}
  }
  var cvd=analyzeCVD(sym);
  if(cvd.divergence==='BEARISH'&&cvd.cvdTrend==='FALLING'){sigs.push(lang==='ar'?'🐋🩸 CVD انقلب — حيتان تبيع':'🐋🩸 CVD flipped — Whales selling');isTaking=true}
  if(baseline&&ww.engine.confidence<25&&baseline.c>=50){sigs.push(lang==='ar'?'📉 ثقة نزلت '+baseline.c+'% → '+ww.engine.confidence+'%':'Confidence '+baseline.c+'% → '+ww.engine.confidence+'%');isTaking=true}
  if(ww.engine.layers&&ww.engine.layers.trades&&ww.engine.layers.trades.whaleSells>=2&&d.c>5){sigs.push(lang==='ar'?'💰 '+ww.engine.layers.trades.whaleSells+' صفقات بيع بعد +'+d.c.toFixed(1)+'%':ww.engine.layers.trades.whaleSells+' sells after +'+d.c.toFixed(1)+'%');isTaking=true}
  if(ww.engine.techniques&&ww.engine.techniques.oiDelta){var oiC=parseFloat(ww.engine.techniques.oiDelta.oiChange)||0;if(oiC<-5&&d.c>3){sigs.push(lang==='ar'?'📊 OI ينخفض '+oiC.toFixed(1)+'%':'OI dropping '+oiC.toFixed(1)+'%');isTaking=true}}
  var fr=FR[sym];if(fr&&fr.rate>0.08&&d.c>5){sigs.push(lang==='ar'?'⚠️ FR عالي '+fr.rate.toFixed(3)+'% بعد صعود':'High FR '+fr.rate.toFixed(3)+'% after pump');isTaking=true}
  ww.prevConf=ww.engine.confidence; /* kept for backward compat */
  return{taking:isTaking,signals:sigs}}

function monitorTrades(){
  var open=activeTrades.filter(function(t){return t.status==='OPEN'});
  open.forEach(function(tr){
    var d=T[tr.sym];if(!d)return;tr.curPrice=d.p;
    tr.pnl=(d.p-tr.entry)/tr.entry*100;
    if(tr.pnl>tr.maxGain){tr.maxGain=tr.pnl;tr.maxGainPrice=d.p;tr.maxGainTime=Date.now()}
    if(tr.pnl<tr.minPnl)tr.minPnl=tr.pnl;
    /* Snapshot every 5 min */
    var lastSnap=tr.snapshots.length?tr.snapshots[tr.snapshots.length-1].t:0;
    if(Date.now()-lastSnap>=300000){tr.snapshots.push({p:d.p,pnl:tr.pnl,t:Date.now()});if(tr.snapshots.length>200)tr.snapshots=tr.snapshots.slice(-200)}
    /* Part B: Whale profit-taking detection */
    var wpt=detectWhaleProfitTaking(tr.sym);
    var wSellVol=whaleWaves[tr.sym]?whaleWaves[tr.sym].totalBuy:0;
    if(wpt.taking&&tr.pnl>0&&wSellVol>=100000){showPopup('🐋🩸',tr.sym+' — '+(lang==='ar'?'حيتان تجني أرباح!':'Whales taking profit!'),'$'+fmt(wSellVol)+' | '+(tr.pnl>=0?'+':'')+tr.pnl.toFixed(1)+'%');addNotifHist('🐋🩸',tr.sym,lang==='ar'?'جني أرباح':'Profit Taking','$'+fmt(wSellVol));
      if(tr.pnl>=3){closeTrade(tr,d.p,lang==='ar'?'🐋🩸 حيتان تجني أرباح':'🐋🩸 Whale profit-taking');return}}
    /* Exit 1: Target 1 hit → move stop to breakeven */
    if(!tr.t1Hit&&d.p>=tr.target1){tr.t1Hit=true;tr.trailingStop=tr.entry*1.005;
      showPopup('🎯',tr.sym+' '+(lang==='ar'?'وصل هدف 1!':'Target 1 hit!'),'+'+tr.pnl.toFixed(1)+'% — '+(lang==='ar'?'وقف → تعادل':'Stop → breakeven'))}
    /* Exit 2: Target 2 hit → close */
    if(d.p>=tr.target2){closeTrade(tr,d.p,lang==='ar'?'🎯 هدف كامل':'🎯 Full target');return}
    /* Exit 3: Trailing stop (after T1, drop 2% from max) */
    if(tr.t1Hit&&tr.maxGain>3){var trail=tr.maxGainPrice*0.98;if(d.p<=trail){closeTrade(tr,d.p,lang==='ar'?'🛡️ وقف متحرك — حماية ربح':'🛡️ Trailing stop — profit protected');return}}
    /* Exit 4: Stop loss */
    var stopLevel=tr.trailingStop||tr.stop;
    if(d.p<=stopLevel){closeTrade(tr,d.p,tr.trailingStop?lang==='ar'?'🛡️ وقف تعادل':'🛡️ Breakeven stop':lang==='ar'?'🛑 وقف خسارة':'🛑 Stop loss');return}
    /* Exit 5: Whale sell signal */
    var ww=whaleWaves[tr.sym];var cvd=analyzeCVD(tr.sym);
    if(ww&&ww.engine&&ww.engine.confidence<10&&cvd.divergence==='BEARISH'){closeTrade(tr,d.p,lang==='ar'?'🐋🩸 حيتان تبيع':'🐋🩸 Whales selling');return}
    /* Exit 6: Timeout 24h */
    if(Date.now()-tr.entryTime>24*3600000){closeTrade(tr,d.p,lang==='ar'?'⏰ انتهى الوقت':'⏰ Timeout 24h');return}
    /* Exit 7: Market crash (BTC -5% from entry) */
    var btcNow=T.BTC?T.BTC.c:0;if(btcNow-tr.marketAtEntry.btc<-5){closeTrade(tr,d.p,lang==='ar'?'💥 انهيار السوق':'💥 Market crash');return}});
  try { trackWhaleOutcome(); } catch(e) {}
  saveTrades()}
/* 💰 STABLECOIN FLOW INDICATOR — uses already-loaded T data (no extra API calls) */
async function loadStableFlow(){
  try{
    /* Use REAL DeFiLlama data if available */
    var usdtVol=0,usdcVol=0,totalVol=0;
    var realData=stablecoinData['USDT']&&stablecoinData['USDT'].supply>0;
    if(realData){
      usdtVol=stablecoinData['USDT'].supply;
      usdcVol=stablecoinData['USDC']?stablecoinData['USDC'].supply:0;
      totalVol=usdtVol+usdcVol+(stablecoinData['DAI']?stablecoinData['DAI'].supply:0)+(stablecoinData['FDUSD']?stablecoinData['FDUSD'].supply:0);
    }else{
      Object.entries(T).forEach(function(e){var d=e[1];if(d.src==='BN'){totalVol+=d.v}});
      var stableCoins=['USDC','TUSD','FDUSD','DAI','BUSD'];
      stableCoins.forEach(function(s){if(T[s])usdcVol+=T[s].v});
      usdtVol=totalVol-usdcVol;
    }
    /* Calculate flow index based on market behavior */
    var btcChange=T['BTC']?T['BTC'].c:0;
    var ethChange=T['ETH']?T['ETH'].c:0;
    var avgTopChange=(btcChange+ethChange)/2;
    /* Rising coins count */
    var allCoins=Object.values(T);var risers=allCoins.filter(function(x){return x.c>0}).length;
    var riserPct=allCoins.length>0?risers/allCoins.length*100:50;
    /* Flow Index: 0=everyone buying crypto, 100=everyone selling to stables */
    var flowIndex=50;
    /* BTC trend: strongest signal */
    if(avgTopChange<-5)flowIndex+=20;else if(avgTopChange<-2)flowIndex+=10;
    else if(avgTopChange>5)flowIndex-=20;else if(avgTopChange>2)flowIndex-=10;
    /* Market breadth */
    if(riserPct>65)flowIndex-=15;else if(riserPct>55)flowIndex-=8;
    else if(riserPct<35)flowIndex+=15;else if(riserPct<45)flowIndex+=8;
    /* Fear & Greed */
    if(fgValue<25)flowIndex+=10;else if(fgValue>75)flowIndex-=10;
    /* Funding Rate trend */
    var avgFR=Object.values(FR).reduce(function(s,x){return s+x.rate},0)/Math.max(1,Object.keys(FR).length);
    if(avgFR>0.05)flowIndex+=8;else if(avgFR<-0.02)flowIndex-=8;
    /* Clamp */
    flowIndex=Math.max(5,Math.min(95,Math.round(flowIndex)));
    /* Update UI — safe null checks */
    var sfUSDTEl=document.getElementById('sfUSDT');if(sfUSDTEl)sfUSDTEl.textContent=fmt(usdtVol);
    var sfUSDCEl=document.getElementById('sfUSDC');if(sfUSDCEl)sfUSDCEl.textContent=fmt(usdcVol);
    var sfUSDTchEl=document.getElementById('sfUSDTch');if(sfUSDTchEl){sfUSDTchEl.style.color=btcChange>=0?'var(--up)':'var(--dn)';sfUSDTchEl.textContent=btcChange>=0?'📈 '+(lang==='ar'?'شراء كريبتو':'Buying crypto'):'📉 '+(lang==='ar'?'بيع كريبتو':'Selling crypto')}
    var sfUSDCchEl=document.getElementById('sfUSDCch');if(sfUSDCchEl){sfUSDCchEl.style.color=usdcVol>1e9?'var(--warn)':'var(--t2)';sfUSDCchEl.textContent=usdcVol>1e9?(lang==='ar'?'نشاط عالي':'High activity'):(lang==='ar'?'طبيعي':'Normal')}
    var idxColor=flowIndex<=30?'var(--up)':flowIndex<=55?'var(--warn)':'var(--dn)';
    var sfIdxEl=document.getElementById('sfIndex');if(sfIdxEl){sfIdxEl.textContent=flowIndex;sfIdxEl.style.color=idxColor}
    var idxLabel=flowIndex<=20?(lang==='ar'?'🟢 شراء قوي':'🟢 Strong Buy'):flowIndex<=35?(lang==='ar'?'🟢 شراء':'🟢 Buying'):flowIndex<=55?(lang==='ar'?'🟡 متوازن':'🟡 Balanced'):flowIndex<=75?(lang==='ar'?'🔴 بيع':'🔴 Selling'):(lang==='ar'?'🔴 بيع قوي':'🔴 Strong Sell');
    var sfIdxLblEl=document.getElementById('sfIndexLbl');if(sfIdxLblEl){sfIdxLblEl.textContent=idxLabel;sfIdxLblEl.style.color=idxColor}
    var sfPtEl=document.getElementById('sfPt');if(sfPtEl)sfPtEl.style.left=flowIndex+'%';
    var signalEl=document.getElementById('sfSignal');
    if(signalEl){if(flowIndex<=30){signalEl.textContent=lang==='ar'?'🟢 صعودي':'🟢 BULLISH';signalEl.style.background='var(--ud)';signalEl.style.color='var(--up)'}
    else if(flowIndex<=55){signalEl.textContent=lang==='ar'?'🟡 محايد':'🟡 NEUTRAL';signalEl.style.background='var(--wd)';signalEl.style.color='var(--warn)'}
    else{signalEl.textContent=lang==='ar'?'🔴 هبوطي':'🔴 BEARISH';signalEl.style.background='var(--dd)';signalEl.style.color='var(--dn)'}}
    var advice=flowIndex<=25?(lang==='ar'?'💡 الناس تشتري كريبتو بقوة — السوق صاعد':'💡 People buying crypto aggressively — Bullish'):flowIndex<=40?(lang==='ar'?'💡 تدفق إيجابي — فرص شراء':'💡 Positive flow — Buy opportunities'):flowIndex<=60?(lang==='ar'?'💡 السوق متوازن — انتظر إشارة واضحة':'💡 Market balanced — Wait for clear signal'):flowIndex<=80?(lang==='ar'?'💡 الناس تبيع كريبتو — حذر':'💡 People selling crypto — Be cautious'):(lang==='ar'?'⚠️ تدفق كبير نحو المستقرة — خطر هبوط':'⚠️ Major flow to stables — Crash risk');
    var sfAdvEl=document.getElementById('sfAdvice');if(sfAdvEl){sfAdvEl.textContent=advice;sfAdvEl.style.color=idxColor}
  }catch(e){try{document.getElementById('sfIndex').textContent='--'}catch(ex){}}}
/* RENDER — with real sparklines */
function mkSpark(s){var hist=sparkHist[s];var up=T[s]?(!isNaN(T[s].c)?T[s].c>=0:true):true;
  if(!hist||hist.length<3){var vals=up?[3,5,4,7,6,9,11,14,13,16,18,22]:[22,19,16,14,11,9,8,6,5,4,3,2];return vals.map(function(v,i){var op=0.3+i/vals.length*0.7;return'<b style="height:'+v+'px;background:var(--'+(up?'up':'dn')+');opacity:'+op.toFixed(2)+'"></b>'}).join('')}
  var mn=Math.min.apply(null,hist),mx=Math.max.apply(null,hist),rng=mx-mn||1;up=hist[hist.length-1]>=hist[0];
  return hist.slice(-12).map(function(v,i,a){var h=Math.max(3,Math.round((v-mn)/rng*24+3));var op=0.3+i/a.length*0.7;return'<b style="height:'+h+'px;background:var(--'+(up?'up':'dn')+');opacity:'+op.toFixed(2)+'"></b>'}).join('')}
function coinRow(s,d,i,sub){var up=d.c>=0;var bg=COL[s]||'#444';return'<div class="cr" onclick="openCoin(\''+s+'\')"><div class="cr-l">'+(i!==undefined?'<div class="cr-rk">'+i+'</div>':'')+'<div class="cr-ic" style="background:'+bg+'0a;color:'+bg+';border:1px solid '+bg+'22">'+s.slice(0,2)+'</div><div><div class="cr-n">'+s+'</div><div class="cr-sub">'+(sub||fmt(d.v))+'</div></div></div><div class="cr-spark">'+mkSpark(s)+'</div><div class="cr-r"><div class="cr-p">'+fP(d.p)+'</div><div class="cr-ch '+(up?'up':'dn')+'">'+(up?'+':'')+d.c.toFixed(1)+'%</div></div></div>'}
function ultraCard(r){var predKey=r.s+'_'+new Date().getHours();if(!predictions.some(function(p){return p.sym===r.s&&Date.now()-p.time<3600000}))savePred(r.s,r.p,r.p*1.05,r.score);var src=[];if(T[r.s])src.push('Binance');if(r.by)src.push('Bybit');if(CBP[r.s])src.push('Coinbase');
  var wc=r.whaleConf||0;var wcCol=wc>=60?'var(--up)':wc>=40?'var(--warn)':'var(--t3)';
  var se=r.smartEntry;var rrCol=se&&+se.rr>=2.5?'var(--up)':se&&+se.rr>=1.5?'var(--warn)':'var(--dn)';
  return'<div class="ultra" onclick="openCoin(\''+r.s+'\')">'
    +'<div class="u-badge">⭐ '+(r.ultra?'🟢 CONFIRMED':'🟡 PROBABLE')+' — '+r.passed+'/'+r.total+' CHECKS'+(wc?' | 🐋 '+wc+'%':'')+'</div>'
    +'<div style="display:flex;justify-content:space-between;align-items:flex-start"><div><div class="u-sym">'+r.s+'/USDT</div><div class="u-price"><span style="color:'+(r.c>=0?'var(--up)':'var(--dn)')+';font-weight:700">'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</span> '+fP(r.p)+'</div></div><div style="text-align:center"><div class="u-score-val">'+r.score+'</div><div class="u-score-lbl">SCORE</div></div></div>'
    +'<div style="margin:8px 0">'+timeBadge(r.detectedAt)+'</div>'
    +(wc?'<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0;padding:6px 8px;background:var(--nd);border-radius:8px"><span style="font-size:10px;color:var(--t1)">'+(lang==='ar'?'🐋 تأكيد الحيتان':'🐋 Whale Confirm')+'</span><span style="font-family:var(--fm);font-size:14px;font-weight:800;color:'+wcCol+'">'+wc+'%</span></div>':'')
    +'<div class="u-conf">'+Object.entries(r.checks).map(function(e){return'<div class="u-conf-i '+(e[1]?'pass':'fail')+'">'+e[0]+' '+(e[1]?'✅':'❌')+'</div>'}).join('')+'</div>'
    +'<div class="u-tags">'+r.tags.slice(0,6).map(function(x){return'<span class="u-tag" style="background:var(--ud);color:var(--up)">'+x+'</span>'}).join('')+'</div>'
    +'<div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div>'
    +(se?'<div style="margin-top:8px;padding:10px;background:var(--bg2);border-radius:10px"><div style="font-size:11px;font-weight:800;margin-bottom:6px">'+(lang==='ar'?'🎯 دخول ذكي':'🎯 Smart Entry')+'</div>'
      +'<div class="u-range-row"><span style="color:var(--neon)">'+(lang==='ar'?'ادخل عند':'Enter at')+'</span><span style="font-weight:700">'+fP(se.entry)+'</span></div>'
      +'<div class="u-range-row"><span style="color:var(--up)">'+(lang==='ar'?'هدف 1':'Target 1')+'</span><span style="font-weight:700">'+fP(se.target1)+'</span></div>'
      +'<div class="u-range-row"><span style="color:var(--neon)">'+(lang==='ar'?'هدف 2':'Target 2')+'</span><span style="font-weight:700">'+fP(se.target2)+'</span></div>'
      +'<div class="u-range-row"><span style="color:var(--dn)">🛑 Stop</span><span style="font-weight:700;color:var(--dn)">'+fP(se.stop)+'</span></div>'
      +'<div class="u-range-row"><span>⚖️ R:R</span><span style="font-weight:700;color:'+rrCol+'">1:'+se.rr+'</span></div>'
      +'</div>':'<div class="u-range" style="margin-top:8px"><div style="font-size:10px;font-weight:700;margin-bottom:4px">🎯 Target</div><div class="u-range-row"><span style="color:var(--up)">Conservative</span><span style="font-weight:700">'+fP(r.p*1.05)+'</span></div><div class="u-range-row"><span style="color:var(--neon)">Target</span><span style="font-weight:700">'+fP(r.p*1.10)+'</span></div><div class="u-range-row"><span style="color:var(--dn)">🛑 Stop</span><span style="font-weight:700;color:var(--dn)">'+fP(r.p*0.93)+'</span></div></div>')
    +'</div>'}
/* ═══ 🐋 WHALE INTELLIGENCE ENGINE v3.0 — 5 Layers + 8 Techniques ═══ */
var wCache={};var prevOBSnapshots={};var liqEvents=[];
var cvdData={};var icebergData={};var whaleLearning={preds:[],layerAcc:{}};try{whaleLearning.preds=JSON.parse(localStorage.getItem('nxwlrn')||'[]');whaleLearning.layerAcc=JSON.parse(localStorage.getItem('nxwlacc')||'{}')}catch(e){}
function wGet(k){var c=wCache[k];if(c&&Date.now()-c.t<c.ttl)return c.d;return null}
function wSet(k,d,ttl){wCache[k]={d:d,t:Date.now(),ttl:ttl||15000}}

/* 🧠 TECHNIQUE 1: CVD — Cumulative Volume Delta */
function updateCVD(sym,price,qty,isBuyerMaker){
  if(!cvdData[sym])cvdData[sym]={cvd:0,hist:[],prices:[]};
  var d=cvdData[sym];var val=price*qty;
  d.cvd+=isBuyerMaker?-val:val;
  var now=Date.now();var last=d.hist.length?d.hist[d.hist.length-1].t:0;
  if(now-last>=30000){d.hist.push({cvd:d.cvd,t:now});d.prices.push({p:price,t:now});if(d.hist.length>60){d.hist.shift();d.prices.shift()}}}
function analyzeCVD(sym){
  var d=cvdData[sym];if(!d||d.hist.length<5)return{score:0,signal:'NO_DATA',divergence:'NONE'};
  var recent=d.hist.slice(-10);var prices=d.prices.slice(-10);
  var cvdTrend=recent[recent.length-1].cvd-recent[0].cvd;
  var pStart=prices[0].p;var pEnd=prices[prices.length-1].p;
  var pTrend=pStart>0?((pEnd-pStart)/pStart)*100:0;
  var sc=0,sig='NEUTRAL',div='NONE';
  if(cvdTrend>0&&pTrend<0.5){sc+=15;sig='WHALE_ACCUMULATION';div='BULLISH';if(cvdTrend>100000){sc+=8;sig='HEAVY_ACCUMULATION'}}
  if(cvdTrend<0&&pTrend>0.5){sc-=10;sig='FAKE_PUMP';div='BEARISH'}
  if(cvdTrend>0&&pTrend>0.3){sc+=8;sig='CONFIRMED_BUYING';div='CONFIRMED'}
  return{score:sc,signal:sig,divergence:div,cvd:d.cvd,cvdTrend:cvdTrend>0?'RISING':'FALLING'}}

/* 🧠 TECHNIQUE 2: Iceberg Order Detection */
function updateIceberg(sym,price,qty,isBuyerMaker,time){
  if(!icebergData[sym])icebergData[sym]=[];
  icebergData[sym].push({p:price,q:qty,buy:!isBuyerMaker,t:time||Date.now(),v:price*qty});
  var cutoff=Date.now()-180000;icebergData[sym]=icebergData[sym].filter(function(t){return t.t>cutoff})}
function detectIceberg(sym){
  var trades=icebergData[sym];if(!trades||trades.length<10)return{score:0,signal:'NO_ICEBERG'};
  var levels={};trades.forEach(function(t){var k=Math.round(t.p*10000)/10000;if(!levels[k])levels[k]=[];levels[k].push(t)});
  var sc=0,icebergs=[];
  Object.entries(levels).forEach(function(e){var p=+e[0],lt=e[1];
    if(lt.length>=8){var span=lt[lt.length-1].t-lt[0].t;
      if(span<=120000){var vol=lt.reduce(function(s,t){return s+t.v},0);var buyPct=lt.filter(function(t){return t.buy}).length/lt.length;
        var sizes=lt.map(function(t){return t.v});var avg=vol/lt.length;var variance=sizes.reduce(function(s,v){return s+Math.pow(v-avg,2)},0)/sizes.length;
        var uniform=Math.sqrt(variance)/avg<0.5;sc+=uniform?12:6;
        icebergs.push({price:p,count:lt.length,vol:vol,side:buyPct>0.7?'BUY':'SELL',uniform:uniform})}}});
  return{score:Math.min(20,sc),icebergs:icebergs,signal:icebergs.length?icebergs[0].side==='BUY'?'ICEBERG_BUY':'ICEBERG_SELL':'NO_ICEBERG',count:icebergs.length}}

/* 🧠 TECHNIQUE 3: Absorption Detection */
function detectAbsorption(sym){
  var trades=icebergData[sym];var d=T[sym];if(!trades||trades.length<20||!d)return{score:0,signal:'NO_DATA'};
  var curP=d.p;var tol=curP*0.001;var recent=trades.filter(function(t){return Math.abs(t.p-curP)<=tol&&Date.now()-t.t<60000});
  var volAtLevel=recent.reduce(function(s,t){return s+t.v},0);
  var avgVol=trades.reduce(function(s,t){return s+t.v},0)/trades.length*recent.length;
  var sc=0,sig='NO_ABSORPTION';
  if(volAtLevel>avgVol*3&&Math.abs(d.c)<0.3){sc+=15;sig='ABSORPTION_DETECTED';
    var buyVol=recent.filter(function(t){return t.buy}).reduce(function(s,t){return s+t.v},0);
    if(buyVol>volAtLevel*0.6){sc+=8;sig='BULLISH_ABSORPTION'}
    else if(buyVol<volAtLevel*0.4){sc-=5;sig='BEARISH_ABSORPTION'}}
  return{score:sc,signal:sig,volRatio:avgVol>0?(volAtLevel/avgVol).toFixed(1)+'x':'0x'}}

/* 🧠 TECHNIQUE 5: BTC Correlation Divergence */
function detectBTCDivergence(sym){
  var d=T[sym];var btc=T.BTC;if(!d||!btc||sym==='BTC')return{score:0,signal:'N/A'};
  var sc=0,sig='CORRELATED';
  if(Math.abs(d.c)>3&&Math.abs(btc.c)<0.5){sc+=10;sig=d.c>0?'WHALE_TARGETING_BUY':'WHALE_TARGETING_SELL'}
  else if(d.c>2&&btc.c<-0.5){sc+=7;sig='STRONG_DIVERGENCE'}
  else if(d.c<-2&&btc.c>0.5){sc-=5;sig='WHALE_DISTRIBUTING'}
  return{score:sc,signal:sig,btcChg:btc.c.toFixed(1),symChg:d.c.toFixed(1)}}

/* 🧠 TECHNIQUE 6: OI Delta */
async function analyzeOIDelta(sym){
  var ck=wGet('OID_'+sym);if(ck)return ck;
  try{
    var h=null;
    /* Use pre-loaded oiHistory if available (saves 1 API call) */
    if(oiHistory[sym]&&oiHistory[sym].length>=2){
      h=oiHistory[sym].map(function(x){return{sumOpenInterestValue:x.val||x.oi}});
    }else{
      h=await fj('https://fapi.binance.com/futures/data/openInterestHist?symbol='+sym+'USDT&period=1h&limit=4');
    }
    if(!h||h.length<2)return{score:0,signal:'NO_DATA'};
    var prev= +h[h.length-2].sumOpenInterestValue;var curr= +h[h.length-1].sumOpenInterestValue;
    var chg=prev>0?((curr-prev)/prev)*100:0;var fr=FR[sym]?FR[sym].rate:0;
    var sc=0,sig='STABLE';
    if(chg>10){sc+=10;sig='MASSIVE_OI_SURGE'}else if(chg>5){sc+=7;sig='OI_INCREASING'}else if(chg<-10){sc+=4;sig='OI_FLUSH'}
    if(chg>3&&fr<-0.01){sc+=8;sig='WHALE_LONG_BUILDUP'}
    var r={score:sc,signal:sig,oiChange:chg.toFixed(1)+'%'};wSet('OID_'+sym,r,60000);return r}catch(e){return{score:0,signal:'ERROR'}}}

/* 🧠 TECHNIQUE 7: Taker Buy/Sell Ratio */
async function analyzeTakerRatio(sym){
  var ck=wGet('TKR_'+sym);if(ck)return ck;
  try{var d=await fj('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol='+sym+'USDT&period=5m&limit=6');
    if(!d||!d.length)return{score:0,signal:'NO_DATA'};
    var ratio= +d[d.length-1].buySellRatio;var avg=d.reduce(function(s,x){return s+ +x.buySellRatio},0)/d.length;
    var sc=0,sig='BALANCED';
    if(ratio>2.0){sc+=10;sig='EXTREME_BUY'}else if(ratio>1.5){sc+=7;sig='HEAVY_TAKER_BUY'}
    else if(ratio<0.5){sc-=7;sig='HEAVY_TAKER_SELL'}else if(ratio<0.7){sc-=3;sig='TAKER_SELLING'}
    if(ratio>avg*1.2&&ratio>1.0)sc+=3;
    var r={score:sc,signal:sig,ratio:ratio.toFixed(2)};wSet('TKR_'+sym,r,30000);return r}catch(e){return{score:0,signal:'ERROR'}}}

/* 🧠 TECHNIQUE 8: Time-of-Day Multiplier */
function getTimeMultiplier(){
  var h=new Date().getUTCHours();var day=new Date().getUTCDay();
  var m=1.0,reason=lang==='ar'?'ساعات عادية':'Normal';
  if(h>=2&&h<=6){m=1.5;reason=lang==='ar'?'سيولة منخفضة':'Low liquidity'}
  if(h>=4&&h<=5){m=2.0;reason=lang==='ar'?'سيولة منخفضة جداً':'Very low liquidity'}
  if(day===0||day===6){m*=1.3;reason+=(lang==='ar'?' + عطلة':' + Weekend')}
  if(h>=13&&h<=16){m=0.85;reason=lang==='ar'?'ذروة (ضجيج عالي)':'Peak hours (noise)'}
  return{mult:m,reason:reason}}

/* 🧠 TECHNIQUE 9: Self-Learning */
function wlRecordSignal(sym,conf,layers,price){
  whaleLearning.preds.push({
    sym:sym,conf:conf,
    layers:Object.fromEntries(Object.entries(layers).map(function(e){return[e[0],{sc:e[1].score,sig:e[1].signal}]})),
    price:price,time:Date.now(),chk:false,hit:false
  });
  /* Separate caps: 200 verified + 100 pending = 300 total.
     Prevents new signals from evicting pending predictions before verification. */
  var verified=whaleLearning.preds.filter(function(p){return p.chk});
  var pending=whaleLearning.preds.filter(function(p){return !p.chk});
  if(verified.length>200)verified=verified.slice(-200);
  if(pending.length>100)pending=pending.slice(-100);
  whaleLearning.preds=verified.concat(pending);
  try{localStorage.setItem('nxwlrn',JSON.stringify(whaleLearning.preds))}catch(e){}
}
function wlVerify(){
  /* Iterate only unchecked predictions old enough — saves ~95% of work */
  var ch=false;var cutoff=Date.now()-8*3600000;
  for(var _wvi=0;_wvi<whaleLearning.preds.length;_wvi++){
    var p=whaleLearning.preds[_wvi];
    if(p.chk||p.time>cutoff)continue;
    var cur=T[p.sym];if(!cur)continue;
    p.chk=true;
    p.hit=((cur.p-p.price)/p.price*100)>=2;
    ch=true;
    var _lents=Object.entries(p.layers);
    for(var _wvj=0;_wvj<_lents.length;_wvj++){
      var k=_lents[_wvj][0],l=_lents[_wvj][1];
      if(l.sc>0){
        if(!whaleLearning.layerAcc[k])whaleLearning.layerAcc[k]={ok:0,t:0};
        whaleLearning.layerAcc[k].t++;
        if(p.hit)whaleLearning.layerAcc[k].ok++;
      }
    }
  }
  if(ch){
    try{
      localStorage.setItem('nxwlrn',JSON.stringify(whaleLearning.preds));
      localStorage.setItem('nxwlacc',JSON.stringify(whaleLearning.layerAcc));
    }catch(e){}
  }
}
function wlGetStats(){var c=whaleLearning.preds.filter(function(p){return p.chk});var h=c.filter(function(p){return p.hit});return{total:c.length,hits:h.length,rate:c.length>0?Math.round(h.length/c.length*100):0}}

/* LAYER 1: Order Book — walls, spoofing, imbalance (15%) */
async function whaleL1(sym){
  var ck=wGet('L1_'+sym);if(ck)return ck;
  /* Use pre-loaded depthSnapshots instead of API call (saves 2 API calls) */
  var ob=null;
  if(depthSnapshots[sym]&&depthSnapshots[sym].bids&&depthSnapshots[sym].bids.length){
    ob=depthSnapshots[sym];
  }else{
    ob=await fj(BN+'/depth?symbol='+sym+'USDT&limit=20');
  }
  var byOb=null;
  /* Only call Bybit API if no depthSnapshots available */
  if(!ob||!ob.bids){
    try{var bd=await fj('https://api.bybit.com/v5/market/orderbook?category=spot&symbol='+sym+'USDT&limit=15');if(bd&&bd.result)byOb={bids:(bd.result.b||[]).map(function(x){return[x[0],x[1]]}),asks:(bd.result.a||[]).map(function(x){return[x[0],x[1]]})};}catch(e){}
  }
  if(!ob||!ob.bids){if(!byOb)return{score:0,signal:'OFFLINE'};ob=byOb}
  var bids=ob.bids,asks=ob.asks;
  var bV=bids.reduce(function(s,b){return s+ +b[0]* +b[1]},0);
  var aV=asks.reduce(function(s,a){return s+ +a[0]* +a[1]},0);
  var ratio=bV/Math.max(aV,1);
  /* Wall detection */
  var avgB=bV/bids.length;
  var bidWalls=bids.filter(function(b){return(+b[0]* +b[1])>avgB*3});
  var askWalls=asks.filter(function(a){return(+a[0]* +a[1])>avgB*3});
  /* Near-price imbalance (top 5) */
  var nBV=bids.slice(0,5).reduce(function(s,b){return s+ +b[0]* +b[1]},0);
  var nAV=asks.slice(0,5).reduce(function(s,a){return s+ +a[0]* +a[1]},0);
  var nearImb=nBV/Math.max(nAV,1);
  /* Spoofing check */
  var spoof=0;var prev=prevOBSnapshots[sym];
  if(prev&&prev.bidWalls){var gone=prev.bidWalls.filter(function(w){return!bidWalls.some(function(bw){return Math.abs(+bw[0]- +w[0])<+w[0]*0.001})});if(gone.length>0)spoof=-10}
  prevOBSnapshots[sym]={bidWalls:bidWalls,time:Date.now()};
  /* Bybit merge */
  if(byOb){var byBV=byOb.bids.reduce(function(s,b){return s+ +b[0]* +b[1]},0);var byAV=byOb.asks.reduce(function(s,a){return s+ +a[0]* +a[1]},0);var byR=byBV/Math.max(byAV,1);if(byR>1.5&&ratio>1.3)spoof+=3}
  var sc=0;
  if(ratio>2.0)sc+=20;else if(ratio>1.5)sc+=15;else if(ratio>1.2)sc+=10;else if(ratio>1.1)sc+=5;
  if(nearImb>3)sc+=12;else if(nearImb>2)sc+=8;else if(nearImb>1.5)sc+=4;
  if(bidWalls.length>0)sc+=5;if(bidWalls.length>=2)sc+=5;
  /* Old-style OB change detection */
  var prevBV=wGet('prevBV_'+sym);if(prevBV){var inc=bV-prevBV;var thresh=bV*0.15;if(inc>thresh&&inc>30000)sc+=8}
  wSet('prevBV_'+sym,bV,120000);
  /* NEW: bookTickers enrichment */
  if(bookTickers[sym]){
    var bt=bookTickers[sym];
    if(bt.bidQty&&bt.askQty&&bt.bidQty>bt.askQty*2){
      var spread=bt.ask&&bt.bid?((bt.ask-bt.bid)/bt.bid)*100:999;
      if(spread<0.1)sc+=5;
    }
  }
  /* NEW: takerData enrichment (no API call needed) */
  if(takerData[sym]){
    var td=takerData[sym];
    if(td.ratio&&td.avg&&td.ratio>td.avg*1.3&&td.ratio>1.0)sc+=5;
  }
  sc+=spoof;sc=Math.max(0,Math.min(40,sc));
  var r={score:sc,ratio:ratio,nearImbalance:nearImb,bidVolume:bV,askVolume:aV,bidWalls:bidWalls.length,askWalls:askWalls.length,spoofWarning:spoof<0,signal:ratio>1.8?'STRONG_BUY':ratio>1.3?'BUY':ratio<0.6?'SELL':'NEUTRAL'};
  wSet('L1_'+sym,r,10000);return r}

/* LAYER 2: Trade Flow — real executed trades (25%) */
async function whaleL2(sym){
  var ck=wGet('L2_'+sym);if(ck)return ck;
  var trades=await fj(BN+'/trades?symbol='+sym+'USDT&limit=100');
  if(!trades||!trades.length)return{score:0,signal:'OFFLINE'};
  /* Feed techniques with trade data */
  trades.forEach(function(tr){
    updateCVD(sym,+tr.price,+tr.qty,tr.isBuyerMaker);
    updateIceberg(sym,+tr.price,+tr.qty,tr.isBuyerMaker,+tr.time);
    updateVPIN(sym,+tr.price,+tr.qty,tr.isBuyerMaker)});
  var vol=T[sym]?T[sym].v:1e8;
  var thresh=vol>1e9?200000:vol>1e8?50000:vol>1e7?10000:3000;
  /* Cluster trades within 60s windows */
  var clusters=[],cur={trades:[],vol:0,st:0};
  trades.forEach(function(tr){
    var tv= +tr.price* +tr.qty;var tt= +tr.time;
    if(!cur.trades.length)cur.st=tt;
    if(tt-cur.st>60000){if(cur.vol>=thresh)clusters.push({trades:cur.trades,vol:cur.vol,st:cur.st});cur={trades:[],vol:0,st:tt}}
    cur.trades.push(tr);cur.vol+=tv});
  if(cur.vol>=thresh)clusters.push(cur);
  /* Classify buy vs sell */
  var whaleBuys=clusters.filter(function(c){var buyV=c.trades.filter(function(t){return!t.isBuyerMaker}).reduce(function(s,t){return s+ +t.price* +t.qty},0);return buyV>c.vol*0.6});
  var whaleSells=clusters.filter(function(c){var sellV=c.trades.filter(function(t){return t.isBuyerMaker}).reduce(function(s,t){return s+ +t.price* +t.qty},0);return sellV>c.vol*0.6});
  var sc=Math.min(30,whaleBuys.length*10);
  if(whaleSells.length>whaleBuys.length)sc-=8;
  var totalBuyVol=whaleBuys.reduce(function(s,c){return s+c.vol},0);
  var largest=clusters.length?Math.max.apply(null,clusters.map(function(c){return c.vol})):0;
  var r={score:Math.max(0,sc),whaleBuys:whaleBuys.length,whaleSells:whaleSells.length,totalBuyVolume:totalBuyVol,largestTrade:largest,threshold:thresh,signal:whaleBuys.length>=3?'HEAVY_ACCUMULATION':whaleBuys.length>=1?'WHALE_BUYING':whaleSells.length>=2?'WHALE_SELLING':'NO_ACTIVITY'};
  wSet('L2_'+sym,r,15000);return r}

/* LAYER 3: Liquidation Monitor (10%) */
async function whaleL3(sym){
  var ck=wGet('L3_'+sym);if(ck)return ck;
  /* Use real-time WS liquidation data first, then REST fallback */
  var recent=(liquidationData[sym]||[]).filter(function(e){return Date.now()-e.time<300000});
  if(!recent.length){recent=liqEvents.filter(function(e){return e.sym===sym&&Date.now()-e.time<300000})}
  if(!recent.length){try{var fd=await fj('https://fapi.binance.com/fapi/v1/allForceOrders?symbol='+sym+'USDT&limit=20');if(fd)fd.forEach(function(o){var v= +o.price* +o.origQty;if(v>50000)recent.push({side:o.side,value:v,price:+o.price,time:+o.time})})}catch(e){}}
  var longLiq=recent.filter(function(e){return e.side==='SELL'}).reduce(function(s,e){return s+e.value},0);
  var shortLiq=recent.filter(function(e){return e.side==='BUY'}).reduce(function(s,e){return s+e.value},0);
  var sc=0,sig='NEUTRAL';
  if(shortLiq>500000){sc+=12;sig='SHORT_SQUEEZE'}else if(shortLiq>200000){sc+=8;sig='SHORTS_PAIN'}else if(shortLiq>50000){sc+=4;sig='MINOR_SQUEEZE'}
  if(longLiq>1000000){sc+=6;sig='CAPITULATION_BUY'}else if(longLiq>200000){sc+=3;sig=sig==='NEUTRAL'?'LONG_PAIN':sig}
  var r={score:sc,longLiqValue:longLiq,shortLiqValue:shortLiq,signal:sig,count:recent.length};
  wSet('L3_'+sym,r,30000);return r}

/* ═══ WHALE INFLOW METER — 4 utility functions ═══ */
function calcRealTotalBuy(sym){
  var ww=whaleWaves[sym];
  if(!ww||!ww.waves||!ww.waves.length)return 0;
  var now=Date.now();
  var activeWaves=ww.waves.filter(function(w){return now-w.time<7200000});
  return activeWaves.reduce(function(s,w){return s+(w.source==='ESTIMATE'?0:w.amount)},0);
}
function calcWhaleAvgEntry(sym){
  var ww=whaleWaves[sym];
  if(!ww||!ww.waves||!ww.waves.length)return 0;
  var totalAmount=0,weightedPrice=0;
  ww.waves.forEach(function(w){
    if(w.source!=='ESTIMATE'&&w.price>0){
      totalAmount+=w.amount;
      weightedPrice+=w.amount*w.price;
    }
  });
  return totalAmount>0?weightedPrice/totalAmount:0;
}
function calcWhalePnL(sym){
  var avgEntry=calcWhaleAvgEntry(sym);
  if(!avgEntry||!T[sym])return{pnl:0,pct:0,status:'UNKNOWN'};
  var current=T[sym].p;
  var pct=((current-avgEntry)/avgEntry)*100;
  var status=pct>3?'PROFIT_TAKING_RISK':pct>0?'IN_PROFIT':pct>-3?'UNDERWATER':'DEEP_LOSS_DUMP_RISK';
  return{pnl:current-avgEntry,pct:pct,avgEntry:avgEntry,status:status};
}
function calcFlowRate(sym){
  var ww=whaleWaves[sym];
  if(!ww||!ww.waves||ww.waves.length<2)return 0;
  var recent=ww.waves.filter(function(w){return Date.now()-w.time<900000});
  if(!recent.length)return 0;
  var totalAmount=recent.reduce(function(s,w){return s+w.amount},0);
  var timeSpan=(Date.now()-recent[0].time)/60000;
  return timeSpan>0?totalAmount/timeSpan:0;
}

/* LAYER 4: Funding Rate Anomaly (10%) — UPGRADED with 6 data sources */
function whaleL4(sym){
  var fr=FR[sym];var oi=OI[sym];if(!fr)return{score:0,signal:'NO_DATA'};
  var sc=0,sig='NEUTRAL';
  if(fr.rate<-0.03){sc+=10;sig='VERY_BULLISH_FR'}
  else if(fr.rate<-0.01){sc+=7;sig='BULLISH_FR'}
  else if(fr.rate>0.08){sc-=5;sig='DANGER_HIGH_FR'}
  /* OI rising + negative FR = whale longs building */
  if(oi&&fr.rate<0){var prevOI=wGet('prevOI_'+sym);if(prevOI&&oi>prevOI*1.05){sc+=5;sig='WHALE_LONG_BUILDUP'}wSet('prevOI_'+sym,oi,120000)}
  /* NEW: FR History trend (frHistory) */
  if(frHistory[sym]&&frHistory[sym].length>=8){
    var last8=frHistory[sym].slice(-8);
    var negCount=last8.filter(function(x){return x.rate<-0.005}).length;
    var frTrend=last8[last8.length-1].rate-last8[0].rate;
    if(negCount>=5){sc+=8;sig='PERSISTENT_NEG_FR'}
    if(frTrend<-0.02)sc+=5;
  }
  /* NEW: OI History buildup (oiHistory) */
  if(oiHistory[sym]&&oiHistory[sym].length>=6){
    var oldest=oiHistory[sym][0].val||oiHistory[sym][0].oi||0;
    var newest=oiHistory[sym][oiHistory[sym].length-1].val||oiHistory[sym][oiHistory[sym].length-1].oi||0;
    var oiGrowth=oldest>0?((newest-oldest)/oldest)*100:0;
    if(oiGrowth>20&&T[sym]&&Math.abs(T[sym].c)<3){sc+=10;sig='MASSIVE_OI_BUILDUP'}
    else if(oiGrowth>10&&T[sym]&&Math.abs(T[sym].c)<5){sc+=5}
  }
  /* NEW: L/S Squeeze detection (LS) */
  if(LS[sym]&&LS[sym].ratio){
    if(LS[sym].ratio<0.7){sc+=8;sig='SHORT_SQUEEZE_SETUP'}
    else if(LS[sym].ratio<0.85){sc+=4}
    /* L/S history rapid drop = shorts piling in */
    if(lsHist[sym]&&lsHist[sym].length>=6){
      var lsFirst=lsHist[sym][0].ratio||1;
      var lsLast=lsHist[sym][lsHist[sym].length-1].ratio||1;
      if(lsLast<lsFirst*0.8){sc+=5}
    }
  }
  /* NEW: Predicted FR (coinalyzePredFR) */
  if(coinalyzePredFR[sym]&&coinalyzePredFR[sym].rate!==undefined&&fr.rate!==undefined){
    if(coinalyzePredFR[sym].rate<fr.rate){sc+=4}
  }
  /* NEW: Multi-exchange FR confirmation (coinalyzeFR) */
  if(coinalyzeFR[sym]&&coinalyzeFR[sym].rate<-0.01&&fr.rate<-0.01){
    sc+=4;sig=sig==='NEUTRAL'?'MULTI_EXCHANGE_NEG_FR':sig;
  }
  return{score:Math.max(-5,sc),fundingRate:fr.rate,openInterest:oi||0,signal:sig}}

/* LAYER 5: Cross-Exchange Flow (15%) — UPGRADED with 5 multi-exchange sources */
function whaleL5(sym){
  var d=T[sym];if(!d)return{score:0,signal:'NO_DATA'};
  var sc=0,sigs=[];
  if(d.by&&d.p){var div=((d.by-d.p)/d.p)*100;
    if(Math.abs(div)>0.3){sc+=6;sigs.push(div>0?'BYBIT_PREMIUM':'BINANCE_PREMIUM')}
    if(Math.abs(div)>0.7){sc+=8;sigs.push('LARGE_DIVERGENCE')}
    if(Math.abs(div)>1.5){sc+=6;sigs.push('EXTREME_DIVERGENCE')}}
  if(CBP[sym]&&d.p){var cbDiv=((CBP[sym]-d.p)/d.p)*100;
    if(cbDiv>0.2){sc+=6;sigs.push('COINBASE_PREMIUM')}
    if(cbDiv>0.5){sc+=4;sigs.push('INSTITUTIONAL_BUYING')}}
  /* NEW: Bitfinex margin positions */
  if(bitfinexMargin[sym]){
    if(bitfinexMargin[sym].longPct>65){sc+=6;sigs.push('BITFINEX_LONGS_RISING')}
    if(bitfinexMargin[sym].longPct>75){sc+=4;sigs.push('INSTITUTIONAL_MARGIN_BUY')}
  }
  /* NEW: Hyperliquid DEX funding */
  if(hyperliquidData[sym]&&hyperliquidData[sym].funding!==undefined){
    var dexFR=hyperliquidData[sym].funding;
    var cexFR=FR[sym]?FR[sym].rate:0;
    if(Math.abs(dexFR-cexFR)>0.02){sc+=6;sigs.push('DEX_CEX_DIVERGENCE')}
    if(dexFR<-0.02&&cexFR<-0.01){sc+=4;sigs.push('ALL_PLATFORMS_NEGATIVE_FR')}
  }
  /* NEW: Aggregated OI comparison */
  if(coinalyzeOI[sym]&&coinalyzeOI[sym].value&&OI[sym]){
    var binanceShare=OI[sym]/(coinalyzeOI[sym].value||1);
    if(binanceShare>0.5){sc+=4;sigs.push('BINANCE_OI_DOMINANT')}
  }
  /* NEW: Aggregated FR confirmation */
  if(coinalyzeFR[sym]&&coinalyzeFR[sym].rate<-0.01){
    sc+=5;sigs.push('MULTI_EXCHANGE_NEGATIVE_FR');
  }
  /* NEW: Aggregated liquidations */
  if(coinalyzeLiq[sym]){
    var shortLiqTotal=coinalyzeLiq[sym].shortVol||0;
    if(shortLiqTotal>1000000){sc+=6;sigs.push('MASSIVE_SHORT_LIQUIDATION')}
    else if(shortLiqTotal>500000){sc+=3;sigs.push('SHORT_LIQUIDATION_CASCADE')}
  }
  return{score:Math.max(0,sc),signals:sigs,signal:sigs[0]||'NO_DIVERGENCE'}}

/* ═══ WHALE INTELLIGENCE ENGINE v3.0 — 5L + 8T ═══ */
var LAYER_WEIGHTS={L1:0.18,L2:0.28,L3:0.10,L4:0.16,L5:0.28};
async function whaleEngine(sym){
  var t0=Date.now();
  /* Layers 1-3 parallel + OI delta (takerRatio now uses pre-loaded data) */
  var results=await Promise.allSettled([whaleL1(sym),whaleL2(sym),whaleL3(sym),analyzeOIDelta(sym)]);
  var layers={
    ob:results[0].status==='fulfilled'?results[0].value:{score:0,signal:'OFFLINE'},
    trades:results[1].status==='fulfilled'?results[1].value:{score:0,signal:'OFFLINE'},
    liqs:results[2].status==='fulfilled'?results[2].value:{score:0,signal:'OFFLINE'},
    fr:whaleL4(sym),
    xex:whaleL5(sym)};
  /* Add technique scores to layers */
  var cvd=analyzeCVD(sym);var iceberg=detectIceberg(sym);var absorb=detectAbsorption(sym);
  var btcDiv=detectBTCDivergence(sym);var vpin=calcVPIN(sym);
  var oiDelta=results[3].status==='fulfilled'?results[3].value:{score:0,signal:'NO_DATA'};
  /* NEW: Use pre-loaded takerData instead of API call (saves 1 API call per coin) */
  var takerR={score:0,signal:'NO_DATA',ratio:'1.00'};
  if(takerData[sym]){
    var tr=takerData[sym];
    if(tr.ratio>2.0){takerR.score=10;takerR.signal='EXTREME_BUY'}
    else if(tr.ratio>1.5){takerR.score=7;takerR.signal='HEAVY_TAKER_BUY'}
    else if(tr.ratio<0.5){takerR.score=-7;takerR.signal='HEAVY_TAKER_SELL'}
    else if(tr.ratio<0.7){takerR.score=-3;takerR.signal='TAKER_SELLING'}
    if(tr.ratio&&tr.avg&&tr.ratio>tr.avg*1.2&&tr.ratio>1.0)takerR.score+=3;
    takerR.ratio=tr.ratio?tr.ratio.toFixed(2):'1.00';
  }
  /* Merge technique scores into layers */
  layers.ob.score+=absorb.score;layers.ob.absorption=absorb;
  layers.trades.score+=cvd.score+iceberg.score+vpin.score;layers.trades.cvd=cvd;layers.trades.iceberg=iceberg;layers.trades.vpin=vpin;
  layers.fr.score+=oiDelta.score+takerR.score;layers.fr.oiDelta=oiDelta;layers.fr.takerRatio=takerR;
  layers.xex.score+=btcDiv.score;layers.xex.btcDiv=btcDiv;
  /* On-Chain data (BTC only, free) */
  var oc=onChainData.BTC||{signal:'NO_DATA'};var ocSc=0;
  if(oc.signal==='WHALE_RUSH')ocSc=8;else if(oc.signal==='MODERATE')ocSc=4;
  layers.ob.score+=ocSc;layers.ob.onchain=oc;
  /* Time multiplier */
  var timeMult=getTimeMultiplier();
  /* Weighted confidence */
  var maxPerLayer=25;var wScore=0;var active=0;
  var layerArr=[{k:'ob',w:LAYER_WEIGHTS.L1},{k:'trades',w:LAYER_WEIGHTS.L2},{k:'liqs',w:LAYER_WEIGHTS.L3},{k:'fr',w:LAYER_WEIGHTS.L4},{k:'xex',w:LAYER_WEIGHTS.L5}];
  layerArr.forEach(function(l){var d=layers[l.k];if(d&&d.signal!=='OFFLINE'&&d.signal!=='NO_DATA'){wScore+=(Math.max(0,d.score)/maxPerLayer)*l.w*100;active++}});
  if(active<5){var activeW=layerArr.filter(function(l){var d=layers[l.k];return d&&d.signal!=='OFFLINE'&&d.signal!=='NO_DATA'}).reduce(function(s,l){return s+l.w},0);if(activeW>0)wScore=wScore/activeW*0.9}
  /* NEW: Smart Money Layer (topTradersLS + globalLS) — bonus on top of 5 layers */
  var smartMoneySc=0;
  var smartMoneySignals=[];
  /* Top traders vs retail divergence (STRONGEST signal) */
  if(topTradersLS[sym]&&topTradersLS[sym].accounts&&topTradersLS[sym].accounts.length){
    var tLatest=topTradersLS[sym].accounts[topTradersLS[sym].accounts.length-1];
    var retailLS=LS[sym];
    if(tLatest.long>0.55&&retailLS&&retailLS.ratio&&retailLS.ratio<0.9){
      smartMoneySc+=15;
      smartMoneySignals.push('TOP_TRADERS_LONG_VS_RETAIL_SHORT');
    }
    /* Top traders increasing longs over time */
    if(topTradersLS[sym].accounts.length>=4){
      var tFirst=topTradersLS[sym].accounts[0];
      if(tLatest.long>tFirst.long+0.05){
        smartMoneySc+=8;
        smartMoneySignals.push('TOP_TRADERS_INCREASING_LONGS');
      }
    }
  }
  /* Global L/S vs Top Traders divergence */
  if(globalLS[sym]&&globalLS[sym].length&&topTradersLS[sym]&&topTradersLS[sym].accounts&&topTradersLS[sym].accounts.length){
    var gLatest=globalLS[sym][globalLS[sym].length-1];
    var ttLatest=topTradersLS[sym].accounts[topTradersLS[sym].accounts.length-1];
    if(ttLatest.long>gLatest.long+0.1){
      smartMoneySc+=10;
      smartMoneySignals.push('SMART_MONEY_DIVERGENCE');
    }
  }
  /* Add smart money score as bonus */
  wScore+=smartMoneySc;
  /* Apply time multiplier */
  wScore*=timeMult.mult;
  var conf=Math.round(Math.max(0,Math.min(100,wScore)));
  var sig,str;
  if(conf>=80){sig='WHALE_ACCUMULATION_CONFIRMED';str='VERY_STRONG'}
  else if(conf>=60){sig='WHALE_BUYING_DETECTED';str='STRONG'}
  else if(conf>=40){sig='POSSIBLE_WHALE_ACTIVITY';str='MODERATE'}
  else if(conf>=20){sig='MINOR_ACTIVITY';str='WEAK'}
  else{sig='NO_WHALE_ACTIVITY';str='NONE'}
  var bearish=layerArr.filter(function(l){return layers[l.k].score<0}).length;
  if(bearish>=3){sig='WHALE_DISTRIBUTION';str='BEARISH'}
  /* Build reasons */
  var reasons=[];
  if(smartMoneySignals.length)reasons.push('\u{1F3C6} '+(lang==='ar'?'ذكاء المال: ':'Smart Money: ')+smartMoneySignals.join(' + '));
  if(cvd.divergence==='BULLISH')reasons.push('\u{1F4CA} CVD '+(lang==='ar'?'تجميع صامت \u2014 أقوى إشارة!':'Silent accumulation \u2014 strongest signal!'));
  if(iceberg.count>0)reasons.push('\u{1F9CA} '+(lang==='ar'?'أوامر مخفية ':'Iceberg ')+iceberg.count+' '+iceberg.signal);
  if(absorb.signal==='BULLISH_ABSORPTION')reasons.push('\u{1F6E1}\u{FE0F} '+(lang==='ar'?'حوت يمتص البيع '+absorb.volRatio:'Whale absorbing sells '+absorb.volRatio));
  if(layers.trades.whaleBuys>=2)reasons.push('\u{1F4B0} '+layers.trades.whaleBuys+' '+(lang==='ar'?'صفقات حوت':'whale buys')+' ($'+fmt(layers.trades.totalBuyVolume)+')');
  if(layers.ob.nearImbalance>2)reasons.push('\u{1F4D7} OB '+(lang==='ar'?'ضغط شراء':'buy pressure')+' '+layers.ob.nearImbalance.toFixed(1)+'x');
  if(oiDelta.signal==='WHALE_LONG_BUILDUP')reasons.push('\u{1F4C8} OI\u2191 + FR\u2193 = '+(lang==='ar'?'حوت يبني Long':'Whale building Long'));
  if(takerR.score>5)reasons.push('\u26A1 Taker '+(lang==='ar'?'شراء عدواني':'aggressive buy')+' '+takerR.ratio+'x');
  if(btcDiv.signal==='WHALE_TARGETING_BUY')reasons.push('\u{1F3AF} '+(lang==='ar'?'حوت يستهدف \u2014 مستقل عن BTC':'Whale targeting \u2014 independent of BTC'));
  if(layers.fr.fundingRate<-0.01)reasons.push('\u{1F4CA} FR '+(lang==='ar'?'سلبي':'negative')+' '+layers.fr.fundingRate.toFixed(4)+'%');
  if(layers.xex.signals&&layers.xex.signals.includes('COINBASE_PREMIUM'))reasons.push('\u{1F3E6} Coinbase '+(lang==='ar'?'أعلى (مؤسسات)':'premium'));
  if(layers.liqs.signal==='SHORT_SQUEEZE')reasons.push('\u{1F4A5} '+(lang==='ar'?'تصفية شورت':'Short squeeze'));
  if(vpin.score>5)reasons.push('\u2623\u{FE0F} VPIN '+(lang==='ar'?'سمية عالية \u2014 حركة قادمة':'High toxicity \u2014 move imminent')+' '+vpin.vpin);
  if(layers.ob.spoofWarning)reasons.push('\u26A0\u{FE0F} '+(lang==='ar'?'تلاعب محتمل':'Possible spoofing'));
  /* NEW: L/S + FR history reasons */
  if(LS[sym]&&LS[sym].ratio&&LS[sym].ratio<0.7)reasons.push('\u{1F4CA} L/S '+(lang==='ar'?'شورت مسيطر \u2014 ضغط قادم':'Shorts dominant \u2014 squeeze fuel')+' '+LS[sym].ratio.toFixed(2));
  if(layers.xex.signals&&layers.xex.signals.includes('BITFINEX_LONGS_RISING'))reasons.push('\u{1F3E6} Bitfinex '+(lang==='ar'?'مؤسسات تشتري':'institutional longs rising'));
  if(layers.xex.signals&&layers.xex.signals.includes('DEX_CEX_DIVERGENCE'))reasons.push('\u{1F310} DEX/CEX '+(lang==='ar'?'تباين \u2014 ذكاء المال':'divergence \u2014 smart money'));
  /* Self-learning: record + verify */
  if(conf>=30)wlRecordSignal(sym,conf,layers,T[sym]?T[sym].p:0);wlVerify();
  var wlStats=wlGetStats();
  return{symbol:sym,confidence:conf,signal:sig,strength:str,layers:layers,activeLayers:active,execTime:(Date.now()-t0)+'ms',reasons:reasons.slice(0,7),timeMult:timeMult,techniques:{cvd:cvd,iceberg:iceberg,absorption:absorb,btcDiv:btcDiv,oiDelta:oiDelta,takerRatio:takerR,vpin:vpin},learning:wlStats,smartMoney:{score:smartMoneySc,signals:smartMoneySignals},action:conf>=70?{type:'BUY',target:'+8% to +15%',stop:'-7%'}:conf<=20?{type:'AVOID'}:{type:'WATCH'}}}

/* ═══ WHALE DETECTION — uses engine for top coins ═══ */
async function detectWhaleWaves(candidates){
  if(!candidates||!candidates.length)return;
  var top=candidates.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')})||(x.v>5e7&&Math.abs(x.c)<3)||(x.checks&&x.checks.ob)}).slice(0,15);
  /* Run whale engine on top 15 */
  var full=top.slice(0,15);var light=top.slice(15);
  var fullResults=await Promise.allSettled(full.map(function(c){return whaleEngine(c.s)}));
  full.forEach(function(c,i){
    var eng=fullResults[i].status==='fulfilled'?fullResults[i].value:null;
    if(!eng)return;
    if(!whaleWaves[c.s])whaleWaves[c.s]={waves:[],totalBuy:0,engine:null};
    var w=whaleWaves[c.s];w.engine=eng;
    /* Record wave if any whale activity detected */
    if(eng.confidence>=20||eng.layers.trades.whaleBuys>0||eng.layers.ob.ratio>1.3){
      var buyVol=eng.layers.trades.totalBuyVolume||eng.layers.ob.bidVolume*0.1||c.v*0.05;
      var lastWave=w.waves.length?w.waves[w.waves.length-1]:null;
      if(!lastWave||Date.now()-lastWave.time>60000){
        w.waves.push({
          amount:buyVol,
          price:c.p,
          time:Date.now(),
          confidence:eng.confidence,
          layers:eng.activeLayers,
          source:eng.layers.trades.totalBuyVolume>0?'REAL':'ESTIMATE'
        });
        w.totalBuy+=buyVol;
        if(w.waves.length>5)w.waves=w.waves.slice(-5);
        if(w.waves.length>=2)notify(c.s,'whale',w.waves.length)}}
    w.waves=w.waves.filter(function(wave){return Date.now()-wave.time<7200000});
    if(w.waves.length===0&&!eng.confidence)delete whaleWaves[c.s]});
  /* Light analysis for remaining */
  light.forEach(function(c){
    var l4=whaleL4(c.s);var l5=whaleL5(c.s);
    if(l4.score+l5.score>5){
      if(!whaleWaves[c.s])whaleWaves[c.s]={waves:[],totalBuy:0,engine:null};
      whaleWaves[c.s].engine={confidence:Math.round((l4.score+l5.score)*2),signal:'POSSIBLE_WHALE_ACTIVITY',strength:'WEAK',layers:{ob:{score:0,signal:'SKIP'},trades:{score:0,signal:'SKIP'},liqs:{score:0,signal:'SKIP'},fr:l4,xex:l5},activeLayers:2,reasons:[]}}});
  try{localStorage.setItem('nxww10',JSON.stringify(whaleWaves))}catch(e){}}

/* ═══ WHALE CARD v4.0 — 5 Layers + 8 Techniques + Inflow Meter + Timeline ═══ */
function whaleCard(r,rank){
  var RANKS=[
    {ic:'\u{1F3C6}',lbl:'DIAMOND',bg:'linear-gradient(135deg,#b9f2ff,#00d4ff)',col:'#0077b6',bdr:'2px solid #00d4ff',glow:'0 0 12px rgba(0,212,255,.4)'},
    {ic:'\u{1F947}',lbl:'GOLD',bg:'linear-gradient(135deg,#ffd700,#ff8c00)',col:'#8b6914',bdr:'2px solid #ffd700',glow:'0 0 12px rgba(255,215,0,.4)'},
    {ic:'\u{1F948}',lbl:'SILVER',bg:'linear-gradient(135deg,#e8e8e8,#a0a0a0)',col:'#555',bdr:'2px solid #c0c0c0',glow:'0 0 8px rgba(192,192,192,.3)'},
    {ic:'\u{1F949}',lbl:'BRONZE',bg:'linear-gradient(135deg,#cd7f32,#8b4513)',col:'#fff',bdr:'1px solid #cd7f32',glow:'none'},
    {ic:'\u2B50',lbl:'STAR',bg:'var(--bg2)',col:'var(--t1)',bdr:'1px solid var(--bdr)',glow:'none'}];
  var medal=rank!==undefined&&rank<5?RANKS[rank]:null;
  var medalHTML=medal?'<div style="position:absolute;top:-4px;right:-4px;z-index:1;padding:2px 6px;border-radius:6px;background:'+medal.bg+';box-shadow:'+medal.glow+';display:flex;align-items:center;gap:3px"><span style="font-size:14px">'+medal.ic+'</span><span style="font-size:7px;font-weight:800;color:'+medal.col+';font-family:var(--fm);letter-spacing:.5px">'+medal.lbl+'</span></div>':'';
  var cardBdr=medal?medal.bdr:'1px solid var(--bdr)';var cardGlow=medal?medal.glow:'none';
  var wt=getSigTime(r.s,'whale');
  var ww=whaleWaves[r.s]||{waves:[],totalBuy:0,engine:null};
  var waves=ww.waves;var eng=ww.engine;
  var waveCount=waves.length;
  var totalBuy=calcRealTotalBuy(r.s)||waves.reduce(function(s,w){return s+w.amount},0)||r.v*0.05;
  var conf=eng?eng.confidence:0;
  var str;
  if(conf>=80)str={t:lang==='ar'?'\u{1F525} تجميع مؤكد':'\u{1F525} Confirmed',c:'str-strong'};
  else if(conf>=60)str={t:lang==='ar'?'\u26A1 تجميع قوي':'\u26A1 Strong',c:'str-strong'};
  else if(conf>=40)str={t:lang==='ar'?'\u{1F4CA} نشاط متوسط':'\u{1F4CA} Moderate',c:'str-normal'};
  else str={t:lang==='ar'?'\u{1F440} مراقبة':'\u{1F440} Watch',c:'str-weak'};
  var src=[];if(T[r.s])src.push(T[r.s].src==='BY'?'Bybit':'Binance');if(T[r.s]&&T[r.s].by)src.push('Bybit');if(CBP[r.s])src.push('Coinbase');
  var whaleIc=conf>=80?'\u{1F40B}\u{1F40B}\u{1F40B}':conf>=60?'\u{1F40B}\u{1F40B}':'\u{1F40B}';
  /* ═══ NEW: Whale Inflow Meter ═══ */
  var meterHTML='';
  if(waveCount>0){
    var realTotal=calcRealTotalBuy(r.s);
    var avgEntry=calcWhaleAvgEntry(r.s);
    var whalePnl=calcWhalePnL(r.s);
    var flowRate=calcFlowRate(r.s);
    var flowLabel=flowRate>50000?{t:(lang==='ar'?'عدواني':'AGGRESSIVE'),c:'fast'}:flowRate>10000?{t:(lang==='ar'?'نشط':'ACTIVE'),c:'fast'}:{t:(lang==='ar'?'بطيء':'SLOW'),c:'slow'};
    var pnlClass=whalePnl.pct>0?'profit':'loss';
    var pnlIcon=whalePnl.pct>3?'\u{1F7E2}':whalePnl.pct>0?'\u{1F7E2}':whalePnl.pct>-3?'\u{1F7E0}':'\u{1F534}';
    var statusText=lang==='ar'?
      (whalePnl.status==='PROFIT_TAKING_RISK'?'حوت رابح \u2014 خطر جني أرباح':whalePnl.status==='IN_PROFIT'?'حوت رابح ويشتري \u2014 آمن للمتابعة':whalePnl.status==='UNDERWATER'?'حوت خاسر \u2014 حذر':'خسارة كبيرة \u2014 خطر تصفية'):
      (whalePnl.status==='PROFIT_TAKING_RISK'?'Whale profitable \u2014 profit-taking risk':whalePnl.status==='IN_PROFIT'?'Whale profitable & buying \u2014 safe to follow':whalePnl.status==='UNDERWATER'?'Whale underwater \u2014 caution':'Deep loss \u2014 dump risk');
    meterHTML='<div class="whale-meter">';
    meterHTML+='<div style="font-size:10px;font-weight:800;color:var(--t1);margin-bottom:6px">\u{1F40B} '+(lang==='ar'?'مقياس تدفق الحيتان':'Whale Inflow Meter')+'</div>';
    if(realTotal>0)meterHTML+='<div class="whale-meter-row"><span style="color:var(--t2)">'+(lang==='ar'?'التدفق الحقيقي':'Real Inflow')+'</span><span style="color:var(--neon);font-weight:800">'+fmt(realTotal)+'</span></div>';
    if(avgEntry>0)meterHTML+='<div class="whale-meter-row"><span style="color:var(--t2)">'+(lang==='ar'?'متوسط الدخول':'Avg Entry')+'</span><span style="color:var(--t0);font-weight:700">'+fP(avgEntry)+'</span></div>';
    if(avgEntry>0&&T[r.s])meterHTML+='<div class="whale-meter-row"><span style="color:var(--t2)">'+(lang==='ar'?'السعر الحالي':'Current Price')+'</span><span style="color:var(--t0);font-weight:700">'+fP(T[r.s].p)+'</span></div>';
    if(avgEntry>0)meterHTML+='<div class="whale-meter-row"><span style="color:var(--t2)">'+(lang==='ar'?'ربح/خسارة الحوت':'Whale P&L')+'</span><span style="font-weight:800;color:'+(whalePnl.pct>=0?'var(--up)':'var(--dn)')+'">'+pnlIcon+' '+(whalePnl.pct>=0?'+':'')+whalePnl.pct.toFixed(1)+'%</span></div>';
    if(flowRate>0)meterHTML+='<div class="whale-meter-row"><span style="color:var(--t2)">'+(lang==='ar'?'معدل التدفق':'Flow Rate')+'</span><span class="whale-rate '+flowLabel.c+'">\u26A1 '+fmt(flowRate)+(lang==='ar'?'/دقيقة':'/min')+' '+flowLabel.t+'</span></div>';
    meterHTML+='<div class="whale-meter-bar"><div class="whale-meter-fill" style="width:'+Math.min(100,conf)+'%;background:'+(conf>=70?'var(--up)':conf>=40?'var(--warn)':'var(--t3)')+'"></div></div>';
    meterHTML+='<div style="text-align:center;font-size:8px;color:var(--t2)">'+conf+'% '+(lang==='ar'?'ثقة':'confidence')+'</div>';
    if(avgEntry>0)meterHTML+='<div class="whale-pnl '+pnlClass+'">'+pnlIcon+' '+statusText+'</div>';
    meterHTML+='</div>';
  }
  /* ═══ NEW: Whale Activity Timeline ═══ */
  var timelineHTML='';
  if(waves.length>0){
    var firstWave=waves[0];
    var lastWave=waves[waves.length-1];
    var ageMin=Math.floor((Date.now()-firstWave.time)/60000);
    var priceAtStart=firstWave.price;
    var drift=T[r.s]?((T[r.s].p-priceAtStart)/priceAtStart*100):0;
    var freshness=ageMin<15?'fresh':ageMin<60?'warm':'old';
    var ageText=ageMin<60?(ageMin+(lang==='ar'?' دقيقة':' min')):(Math.floor(ageMin/60)+(lang==='ar'?' ساعة':'h'));
    var driftIcon=drift>5?'\u{1F534}':(drift>0?'\u{1F7E2}':'\u{1F7E0}');
    var lateWarning=ageMin>60&&drift>5?(lang==='ar'?' \u2014 قد يكون متأخراً':' \u2014 may be late'):'';
    timelineHTML='<div class="whale-timeline '+freshness+'">';
    timelineHTML+='<span>'+driftIcon+'</span>';
    timelineHTML+='<span style="color:var(--t1);flex:1">'+(lang==='ar'?'بدأ التجميع منذ ':'Accumulation started ')+ageText+(lang==='ar'?' عند ':' ago at ')+fP(priceAtStart)+(lang==='ar'?' \u2014 الآن ':' \u2014 now ')+fP(T[r.s]?T[r.s].p:0)+' ('+(drift>=0?'+':'')+drift.toFixed(1)+'%)'+lateWarning+'</span>';
    timelineHTML+='</div>';
  }
  /* Layer + Technique bars */
  var layerHTML='';
  if(eng&&eng.activeLayers>0){
    var lNames={ob:{n:lang==='ar'?'دفتر الأوامر':'Order Book',ic:'\u{1F4D7}',col:'#00ff88'},trades:{n:lang==='ar'?'صفقات كبيرة':'Trade Flow',ic:'\u{1F4B0}',col:'#ffd700'},liqs:{n:lang==='ar'?'تصفيات':'Liquidations',ic:'\u{1F4A5}',col:'#ff3860'},fr:{n:'Funding + OI',ic:'\u{1F4CA}',col:'#b07cff'},xex:{n:lang==='ar'?'بين المنصات + BTC':'X-Exchange + BTC',ic:'\u{1F504}',col:'#5b9cff'}};
    layerHTML='<div style="margin:8px 0;padding:10px;background:var(--bg2);border-radius:10px">';
    layerHTML+='<div style="font-size:10px;font-weight:800;color:var(--t1);margin-bottom:8px">'+(lang==='ar'?'\u{1F4CA} تحليل 5 طبقات + 8 تقنيات:':'\u{1F4CA} 5 Layers + 8 Techniques:')+'</div>';
    ['ob','trades','liqs','fr','xex'].forEach(function(k){
      var l=eng.layers[k];if(!l)return;var off=l.signal==='OFFLINE'||l.signal==='SKIP'||l.signal==='NO_DATA';
      var pct=off?0:Math.min(100,Math.max(0,l.score*2.5));
      var info=lNames[k];var barCol=off?'var(--t3)':info.col;
      layerHTML+='<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">'
        +'<span style="font-size:12px;width:18px">'+info.ic+'</span>'
        +'<span style="width:72px;font-size:9px;font-weight:700;color:var(--t1)">'+info.n+'</span>'
        +'<div style="flex:1;height:6px;background:var(--bdr);border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+barCol+';border-radius:3px;transition:width .5s"></div></div>'
        +'<span style="width:55px;text-align:left;font-size:8px;font-family:var(--fm);font-weight:800;color:'+barCol+'">'+(off?'\u2014':l.signal.replace(/_/g,' ').slice(0,14))+'</span></div>'});
    /* Technique badges */
    if(eng.techniques){
      var t=eng.techniques;var badges=[];
      if(t.cvd&&t.cvd.divergence==='BULLISH')badges.push({t:'CVD \u2191',c:'var(--up)',bg:'var(--ud)'});
      if(t.cvd&&t.cvd.divergence==='BEARISH')badges.push({t:'CVD \u2193',c:'var(--dn)',bg:'var(--dd)'});
      if(t.iceberg&&t.iceberg.count>0)badges.push({t:'\u{1F9CA} Iceberg \u00D7'+t.iceberg.count,c:'var(--blue)',bg:'var(--bd)'});
      if(t.absorption&&t.absorption.score>10)badges.push({t:'\u{1F6E1}\u{FE0F} Absorb '+t.absorption.volRatio,c:'var(--neon)',bg:'var(--nd)'});
      if(t.btcDiv&&t.btcDiv.score>5)badges.push({t:'\u{1F3AF} BTC div',c:'var(--purple)',bg:'var(--pd)'});
      if(t.oiDelta&&t.oiDelta.score>5)badges.push({t:'\u{1F4C8} OI '+t.oiDelta.oiChange,c:'var(--ultra)',bg:'var(--ultd)'});
      if(t.takerRatio&&t.takerRatio.score>5)badges.push({t:'\u26A1 Taker '+t.takerRatio.ratio+'x',c:'var(--up)',bg:'var(--ud)'});
      if(t.vpin&&t.vpin.score>3)badges.push({t:'\u2623\u{FE0F} VPIN '+t.vpin.vpin,c:'var(--dn)',bg:'var(--dd)'});
      if(badges.length){
        layerHTML+='<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;padding-top:6px;border-top:1px solid var(--bdr)">';
        badges.forEach(function(b){layerHTML+='<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+b.bg+';color:'+b.c+'">'+b.t+'</span>'});
        layerHTML+='</div>'}}
    /* Smart money badge */
    if(eng.smartMoney&&eng.smartMoney.score>0){
      layerHTML+='<div style="margin-top:6px;padding:4px 8px;background:rgba(255,215,0,.06);border:1px solid rgba(255,215,0,.12);border-radius:6px;font-size:9px;font-weight:700;color:#ffd700">\u{1F3C6} '+(lang==='ar'?'ذكاء المال':'Smart Money')+' +'+eng.smartMoney.score+' | '+eng.smartMoney.signals.join(', ')+'</div>';
    }
    /* Time multiplier */
    if(eng.timeMult&&eng.timeMult.mult!==1){layerHTML+='<div style="font-size:7px;color:var(--t3);margin-top:4px">\u{1F550} '+eng.timeMult.reason+' (\u00D7'+eng.timeMult.mult.toFixed(1)+')</div>'}
    layerHTML+='</div>'}
  /* Wave details */
  var waveHTML='';
  if(waveCount>0){
    waveHTML='<div style="margin:6px 0;border-top:1px solid var(--bdr);padding-top:6px">';
    waves.forEach(function(wave,i){
      var isNew=Date.now()-wave.time<120000;
      var srcBadge=wave.source==='REAL'?'<span style="font-size:7px;padding:1px 3px;border-radius:3px;background:var(--ud);color:var(--up);font-weight:700">REAL</span>':'<span style="font-size:7px;padding:1px 3px;border-radius:3px;background:var(--wd);color:var(--warn);font-weight:700">EST</span>';
      waveHTML+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:9px'+(i<waves.length-1?';border-bottom:1px solid rgba(56,72,96,.15)':'')+'">'
        +'<span style="color:var(--neon);font-weight:700;font-size:11px">\u{1F40B}</span>'
        +'<span style="font-family:var(--fm);font-weight:800;color:var(--t0);font-size:10px">#'+(i+1)+'</span>'
        +'<span style="font-family:var(--fm);font-weight:800;color:var(--neon);flex:1;font-size:10px">'+fmt(wave.amount)+'</span>'
        +srcBadge
        +'<span style="font-family:var(--fm);color:var(--t2);font-size:9px">'+fP(wave.price)+'</span>'
        +'<span class="time-badge '+(isNew?'fresh':'')+'">\u23F1'+timeAgo(wave.time).text+'</span></div>'});
    waveHTML+='</div>'}
  /* Reasons */
  var reasonHTML='';
  if(eng&&eng.reasons&&eng.reasons.length){
    reasonHTML='<div style="margin-top:6px;padding:8px;background:linear-gradient(135deg,rgba(0,255,136,.03),transparent);border:1px solid rgba(0,255,136,.1);border-radius:8px">';
    eng.reasons.forEach(function(re){reasonHTML+='<div style="font-size:9px;color:var(--t0);margin-bottom:2px;font-weight:600">'+re+'</div>'});
    if(eng.action&&eng.action.type==='BUY')reasonHTML+='<div style="margin-top:6px;padding:6px;background:var(--ud);border-radius:6px;text-align:center"><span style="font-size:11px;font-weight:800;color:var(--up)">\u{1F4A1} '+(lang==='ar'?'شراء قوي':'Strong Buy')+'</span><span style="font-size:9px;color:var(--t1);margin:0 8px">\u{1F3AF} '+eng.action.target+'</span><span style="font-size:9px;color:var(--dn)">\u{1F6D1} '+eng.action.stop+'</span></div>';
    /* Learning stats */
    if(eng.learning&&eng.learning.total>0)reasonHTML+='<div style="font-size:7px;color:var(--t3);margin-top:4px;text-align:center">\u{1F9EC} '+(lang==='ar'?'نسبة تعلم':'Learning')+': '+eng.learning.rate+'% ('+eng.learning.hits+'/'+eng.learning.total+')</div>';
    reasonHTML+='</div>'}
  return'<div class="whale-card" style="position:relative;border:'+cardBdr+';box-shadow:'+cardGlow+'" onclick="openCoin(\''+r.s+'\')">'
    +medalHTML
    +'<div class="whale-head"><div class="whale-sym" style="font-size:15px">'+whaleIc+' '+r.s+'/USDT <span class="str-badge '+str.c+'">'+str.t+'</span></div><div style="display:flex;align-items:center;gap:4px">'+timeBadge(wt)+'<span style="font-family:var(--fm);font-size:11px;font-weight:800;padding:3px 8px;border-radius:8px;background:'+(conf>=70?'var(--ud)':conf>=40?'var(--wd)':'var(--bg2)')+';color:'+(conf>=70?'var(--up)':conf>=40?'var(--warn)':'var(--t3)')+'">'+conf+'%</span></div></div>'
    +'<div class="whale-grid"><div class="whale-item"><div class="whale-item-v" style="color:var(--neon);font-size:14px">'+fmt(totalBuy)+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'إجمالي':'Total')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:var(--blue);font-size:14px">'+waveCount+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'موجات':'Waves')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:var(--up);font-size:14px">'+fP(r.p)+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'السعر':'Price')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:'+(r.c>=0?'var(--up)':'var(--dn)')+';font-size:14px">'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</div><div class="whale-item-l" style="font-size:9px">24H</div></div></div>'
    +timelineHTML+meterHTML+layerHTML+waveHTML+reasonHTML
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid var(--bdr)"><div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div>'+(eng?'<span style="font-family:var(--fm);font-size:8px;color:var(--t3)">\u26A1'+eng.execTime+' | '+eng.activeLayers+'/5 | v4.0</span>':'')+'</div></div>'}
/* ═══ \u{1F534} WHALE SELL DETECTION — 13 signals (8 original + 5 new) ═══ */
async function detectWhaleSells(candidates){
  if(!candidates||!candidates.length)return[];
  var sells=[];
  var top=candidates.filter(function(x){return getCoinTier(x.s)<=2}).slice(0,20);
  for(var i=0;i<Math.min(top.length,12);i++){
    var c=top[i];var d=T[c.s];if(!d)continue;
    var sc=0,sigs=[];
    /* Signal 1: Price dropping with high volume = dump */
    if(d.c<-3&&d.v>1e8){sc+=15;sigs.push({n:lang==='ar'?'تراجع مع حجم عالي':'Drop + high volume',ic:'\u{1F4C9}',col:'var(--dn)'})}
    else if(d.c<-1&&d.v>5e7){sc+=8;sigs.push({n:lang==='ar'?'ضغط بيع':'Sell pressure',ic:'\u{1F4C9}',col:'var(--warn)'})}
    /* Signal 2: CVD Bearish */
    var cvd=analyzeCVD(c.s);
    if(cvd.divergence==='BEARISH'){sc+=18;sigs.push({n:lang==='ar'?'CVD هابط \u2014 بيع مخفي':'CVD Bearish \u2014 hidden selling',ic:'\u{1F4CA}',col:'var(--dn)'})}
    /* Signal 3: Iceberg sells */
    var ice=detectIceberg(c.s);
    if(ice.icebergs&&ice.icebergs.some(function(x){return x.side==='SELL'})){sc+=12;sigs.push({n:lang==='ar'?'أوامر بيع مخفية':'Hidden sell orders',ic:'\u{1F9CA}',col:'var(--blue)'})}
    /* Signal 4: High Funding Rate */
    var fr=FR[c.s];
    if(fr&&fr.rate>0.08){sc+=10;sigs.push({n:'FR '+fr.rate.toFixed(3)+'% '+(lang==='ar'?'\u2014 خطر تصفية':'\u2014 liquidation risk'),ic:'\u26A0\u{FE0F}',col:'var(--warn)'})}
    else if(fr&&fr.rate>0.05){sc+=5;sigs.push({n:'FR '+(lang==='ar'?'مرتفع':'elevated'),ic:'\u{1F7E1}',col:'var(--warn)'})}
    /* Signal 5: OI dropping */
    var ww=whaleWaves[c.s];var eng=ww?ww.engine:null;
    if(eng&&eng.techniques&&eng.techniques.oiDelta){var oid=eng.techniques.oiDelta;var oiChg=parseFloat(oid.oiChange)||0;
      if(oiChg<-8){sc+=10;sigs.push({n:'OI '+oid.oiChange+' '+(lang==='ar'?'\u2014 إغلاق مراكز':'\u2014 closing positions'),ic:'\u{1F4C9}',col:'var(--dn)'})}
      else if(oiChg<-3){sc+=5;sigs.push({n:'OI '+(lang==='ar'?'ينخفض':'declining'),ic:'\u{1F4CA}',col:'var(--warn)'})}}
    /* Signal 6: Whale sell trades from L2 */
    if(eng&&eng.layers&&eng.layers.trades&&eng.layers.trades.whaleSells>0){sc+=12;sigs.push({n:eng.layers.trades.whaleSells+' '+(lang==='ar'?'صفقات بيع كبيرة':'large sell trades'),ic:'\u{1F4B0}',col:'var(--dn)'})}
    /* Signal 7: OB sell-heavy */
    if(eng&&eng.layers&&eng.layers.ob&&eng.layers.ob.ratio<0.7){sc+=8;sigs.push({n:'OB '+(lang==='ar'?'ضغط بيع':'sell pressure')+' '+eng.layers.ob.ratio.toFixed(1)+'x',ic:'\u{1F4D7}',col:'var(--dn)'})}
    /* Signal 8: BTC divergence bearish */
    var btcDiv=detectBTCDivergence(c.s);
    if(btcDiv.signal==='WHALE_DISTRIBUTING'){sc+=8;sigs.push({n:lang==='ar'?'حوت يبيع \u2014 مستقل عن BTC':'Whale dumping \u2014 BTC independent',ic:'\u{1F3AF}',col:'var(--dn)'})}
    /* ═══ NEW Signal 9: Top traders reducing longs ═══ */
    if(topTradersLS[c.s]&&topTradersLS[c.s].accounts&&topTradersLS[c.s].accounts.length>=4){
      var ttFirst=topTradersLS[c.s].accounts[0];
      var ttLast=topTradersLS[c.s].accounts[topTradersLS[c.s].accounts.length-1];
      if(ttLast.long<ttFirst.long-0.05){
        sc+=12;sigs.push({n:lang==='ar'?'كبار المتداولين يقللون Long':'Top traders reducing longs',ic:'\u{1F3C6}',col:'var(--dn)'});
      }
    }
    /* ═══ NEW Signal 10: Bitfinex margin longs dropping ═══ */
    if(bitfinexMargin[c.s]&&bitfinexMargin[c.s].longPct<45){
      sc+=8;sigs.push({n:lang==='ar'?'مارجن Bitfinex \u2014 Long ينخفض':'Bitfinex margin longs declining',ic:'\u{1F4CA}',col:'var(--dn)'});
    }
    /* ═══ NEW Signal 11: FR history climbing dangerously ═══ */
    if(frHistory[c.s]&&frHistory[c.s].length>=8){
      var last4=frHistory[c.s].slice(-4);
      var allHigh=last4.every(function(x){return x.rate>0.05});
      if(allHigh){
        sc+=10;sigs.push({n:lang==='ar'?'FR خطير 4 فترات متتالية':'FR dangerously high 4 periods',ic:'\u{1F534}',col:'var(--dn)'});
      }
    }
    /* ═══ NEW Signal 12: Whale P&L — profit-taking likely ═══ */
    var whalePnl=calcWhalePnL(c.s);
    if(whalePnl.pct>8){
      sc+=8;sigs.push({n:lang==='ar'?'حوت +'+whalePnl.pct.toFixed(1)+'% \u2014 جني أرباح محتمل':'Whale +'+whalePnl.pct.toFixed(1)+'% \u2014 profit-taking likely',ic:'\u{1F4B0}',col:'var(--warn)'});
    }
    /* ═══ NEW Signal 13: Multi-exchange liquidation cascade ═══ */
    if(coinalyzeLiq[c.s]&&coinalyzeLiq[c.s].longVol>500000){
      sc+=10;sigs.push({n:lang==='ar'?'تصفية Long $'+fmt(coinalyzeLiq[c.s].longVol)+' عبر المنصات':'Long liquidations $'+fmt(coinalyzeLiq[c.s].longVol)+' across exchanges',ic:'\u{1F4A5}',col:'var(--dn)'});
    }
    /* Only include if score >= 15 */
    if(sc>=15&&sigs.length>=2){
      var conf=Math.round(Math.min(100,sc*1.2));
      sells.push({s:c.s,p:d.p,c:d.c,v:d.v,sellConf:conf,signals:sigs,totalScore:sc})}}
  return sells.sort(function(a,b){return b.sellConf-a.sellConf})}

async function loadWhaleSells(){
  var c=quickScan();var r=await deepAnalyze(c);
  var sells=await detectWhaleSells(r);
  var top5=sells.slice(0,5);
  var totalSellVol=top5.reduce(function(s,x){return s+x.v*0.05},0);
  document.getElementById('whSellT').textContent=fmt(totalSellVol);
  document.getElementById('whSellC').textContent=top5.length;
  document.getElementById('whSellMax').textContent=top5.length?top5[0].s:'--';
  document.getElementById('whSellList').innerHTML=top5.length?top5.map(function(x,i){return whaleSellCard(x,i)}).join(''):'<div class="empty"><div class="empty-ic">✅</div><div class="empty-tx">'+(lang==='ar'?'لا بيع حيتان — السوق آمن':'No whale selling — Market safe')+'</div></div>'}

function whaleSellCard(r,rank){
  var RANKS=[
    {ic:'🐋💀',lbl:'CRITICAL',bg:'linear-gradient(135deg,#ff1744,#b71c1c)',col:'#fff',bdr:'2px solid #ff1744',glow:'0 0 12px rgba(255,23,68,.4)'},
    {ic:'🐋🩸🩸',lbl:'HEAVY',bg:'linear-gradient(135deg,#ff5722,#d84315)',col:'#fff',bdr:'2px solid #ff5722',glow:'0 0 10px rgba(255,87,34,.3)'},
    {ic:'🐋🩸',lbl:'SELLING',bg:'linear-gradient(135deg,#ff9800,#e65100)',col:'#fff',bdr:'1px solid #ff9800',glow:'0 0 8px rgba(255,152,0,.3)'},
    {ic:'🐋⚠️',lbl:'WARNING',bg:'linear-gradient(135deg,#ffc107,#f57f17)',col:'#5d4037',bdr:'1px solid #ffc107',glow:'none'},
    {ic:'🐋👁',lbl:'WATCH',bg:'var(--bg2)',col:'var(--t1)',bdr:'1px solid var(--bdr)',glow:'none'}];
  var medal=rank!==undefined&&rank<5?RANKS[rank]:null;
  var medalHTML=medal?'<div style="position:absolute;top:-4px;right:-4px;z-index:1;padding:2px 6px;border-radius:6px;background:'+medal.bg+';box-shadow:'+medal.glow+';display:flex;align-items:center;gap:3px"><span style="font-size:12px">'+medal.ic+'</span><span style="font-size:7px;font-weight:800;color:'+medal.col+';font-family:var(--fm);letter-spacing:.5px">'+medal.lbl+'</span></div>':'';
  var cardBdr=medal?medal.bdr:'1px solid var(--bdr)';var cardGlow=medal?medal.glow:'none';
  var strTxt=r.sellConf>=70?(lang==='ar'?'🔴 بيع قوي':'🔴 Heavy Sell'):r.sellConf>=40?(lang==='ar'?'🟠 بيع متوسط':'🟠 Moderate'):lang==='ar'?'🟡 ضغط خفيف':'🟡 Light';
  var tb=getTierBadge(r.s);
  return'<div class="whale-card" style="position:relative;border:'+cardBdr+';box-shadow:'+cardGlow+'" onclick="openCoin(\''+r.s+'\')">'
    +medalHTML
    +'<div class="whale-head"><div class="whale-sym" style="font-size:14px">⚠️ '+r.s+'/USDT'+(tb?' <span style="font-size:8px">'+tb+'</span>':'')+' <span class="str-badge str-weak" style="background:var(--dd);color:var(--dn)">'+strTxt+'</span></div>'
    +'<span style="font-family:var(--fm);font-size:13px;font-weight:800;padding:3px 8px;border-radius:8px;background:var(--dd);color:var(--dn)">'+r.sellConf+'%</span></div>'
    +'<div class="whale-grid"><div class="whale-item"><div class="whale-item-v" style="color:var(--dn);font-size:13px">'+fP(r.p)+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'السعر':'Price')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--dn);font-size:13px">'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</div><div class="whale-item-l" style="font-size:9px">24H</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--warn);font-size:13px">'+r.signals.length+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'إشارات':'Signals')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--t2);font-size:13px">'+fmt(r.v)+'</div><div class="whale-item-l" style="font-size:9px">Vol</div></div></div>'
    +'<div style="margin:8px 0;padding:8px;background:var(--bg2);border-radius:10px">'
    +'<div style="font-size:10px;font-weight:800;color:var(--dn);margin-bottom:6px">'+(lang==='ar'?'🔴 إشارات البيع:':'🔴 Sell Signals:')+'</div>'
    +r.signals.map(function(s){return'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:9px"><span style="font-size:12px">'+s.ic+'</span><span style="color:'+s.col+';font-weight:700;flex:1">'+s.n+'</span></div>'}).join('')
    +'</div>'
    +'<div style="height:5px;background:var(--bdr);border-radius:3px;overflow:hidden;margin:6px 0"><div style="width:'+r.sellConf+'%;height:100%;background:linear-gradient(90deg,var(--warn),var(--dn));border-radius:3px"></div></div>'
    +'<div style="padding:6px;background:var(--dd);border-radius:6px;text-align:center"><span style="font-size:10px;font-weight:800;color:var(--dn)">'+(r.sellConf>=60?'🔴 '+(lang==='ar'?'تجنب الشراء':'Avoid buying'):'⚠️ '+(lang==='ar'?'حذر':'Caution'))+'</span></div>'
    +'</div>'}
function scanItem(r){var sc=r.score>=60?'background:var(--ud);color:var(--up)':r.score>=40?'background:var(--wd);color:var(--warn)':'background:rgba(56,72,96,.3);color:var(--t2)';var tb=getTierBadge(r.s);return'<div class="'+(r.ultra?'scan-r ultra-r':'scan-r')+'" onclick="openCoin(\''+r.s+'\')"><div class="scan-h"><div class="scan-sym">'+(r.ultra?'⭐':r.confirmed?'🟢':'💎')+' '+r.s+(tb?' <span style="font-size:8px">'+tb+'</span>':'')+' '+timeBadge(r.detectedAt)+'</div><span class="scan-score" style="'+sc+'">'+r.score+' · '+r.passed+'/'+r.total+'✓</span></div><div class="scan-det"><span>💰 <b>'+fP(r.p)+'</b></span><span>'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</span><span>'+fmt(r.v)+'</span>'+(r.cb?'<span>CB:'+fP(r.cb)+'</span>':'')+'</div><div class="scan-checks">'+r.tags.slice(0,5).map(function(x){return'<span class="scan-chk chk-y">'+x+'</span>'}).join('')+'</div><div class="prw"><div class="prb" style="width:'+Math.min(100,r.score)+'%;background:'+(r.ultra?'linear-gradient(90deg,var(--ultra),var(--dn))':r.score>=50?'var(--up)':'var(--warn)')+'"></div></div></div>'}
function frRow(){return''} /* replaced by accordion */
/* ═══ 🆕 QUICK ACCESS CARDS ═══ */
var favorites=[];try{favorites=JSON.parse(localStorage.getItem('nxfav10')||'[]')}catch(e){favorites=[]}
function openQA(page){
  document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('act');p.style.display=''});
  document.querySelectorAll('.bb').forEach(function(b){b.classList.remove('act')});
  var el=document.getElementById('pg-'+page);
  if(!el)return;
  el.classList.add('act');
  try{
    if(page==='heatmap')renderHeatmap();
    else if(page==='favs')renderFavs();
    else if(page==='alerts')renderAlerts();
    else if(page==='monitor')renderMonPanel();
  }catch(e){}
  window.scrollTo({top:0});
}
function updateQACards(){
  try{
    var allC=Object.values(T);var greenPct=allC.length?Math.round(allC.filter(function(x){return x.c>0}).length/allC.length*100):0;
    var hmEl=document.getElementById('qaHM');if(hmEl){hmEl.textContent=greenPct+'%';hmEl.style.color=greenPct>55?'var(--up)':greenPct<40?'var(--dn)':'var(--warn)'}
    var favEl=document.getElementById('qaFav');if(favEl)favEl.textContent=favorites.length+(lang==='ar'?' عملات':' coins');
    var alEl=document.getElementById('qaAlerts');if(alEl){var c=notifHist?notifHist.length:0;alEl.innerHTML=c>0?c+' '+(lang==='ar'?'جديدة':'new')+'<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--dn);margin-right:3px;animation:pls 1s infinite"></span>':'0'}
    var monEl=document.getElementById('qaMon');if(monEl){
      var svRpt=supervisorData.dailyReport;
      if(svRpt&&svRpt.gradeLabel){
        var gCol=svRpt.grade>=85?'var(--up)':svRpt.grade>=60?'var(--warn)':'var(--dn)';
        monEl.innerHTML='<span style="font-size:14px;font-weight:800;color:'+gCol+'">'+svRpt.gradeLabel+'</span><span style="font-size:8px;color:var(--t3)"> ('+svRpt.grade+')</span>';
      }else{var q=getConnQuality();monEl.textContent=q+'%';monEl.style.color=q>=80?'var(--up)':q>=50?'var(--warn)':'var(--dn)'}
    }
  }catch(e){}
}
/* 🗺️ HEATMAP */
function renderHeatmap(){
  var el=document.getElementById('hmGrid');if(!el)return;
  var coins=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v}).slice(0,30);
  if(!coins.length){el.innerHTML='<div class="empty"><div class="empty-ic">🗺️</div><div class="empty-tx">'+(lang==='ar'?'لا بيانات':'No data')+'</div></div>';return}
  el.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:3px">'+coins.map(function(e){
    var s=e[0],d=e[1],ch=d.c;
    var bg=ch>10?'rgba(0,255,136,.6)':ch>5?'rgba(0,255,136,.4)':ch>2?'rgba(0,255,136,.25)':ch>0?'rgba(0,255,136,.12)':ch>-2?'rgba(255,56,96,.12)':ch>-5?'rgba(255,56,96,.25)':ch>-10?'rgba(255,56,96,.4)':'rgba(255,56,96,.6)';
    var sz=d.v>1e9?'flex:3':d.v>5e8?'flex:2':'flex:1';
    return'<div style="'+sz+';min-width:50px;background:'+bg+';border-radius:8px;padding:8px 4px;text-align:center;cursor:pointer" onclick="openCoin(\''+s+'\')">'
      +'<div style="font-size:10px;font-weight:800;color:var(--t0)">'+s+'</div>'
      +'<div style="font-family:var(--fm);font-size:9px;font-weight:700;margin-top:2px;direction:ltr;color:var(--t1)">'+(ch>=0?'+':'')+ch.toFixed(1)+'%</div>'
      +'<div style="font-size:7px;color:var(--t2);margin-top:1px">'+fmt(d.v)+'</div></div>';
  }).join('')+'</div>';
}
/* ⭐ FAVORITES */
function addFav(){
  var inp=document.getElementById('favInp');if(!inp)return;
  /* Whitelist: uppercase A-Z and 0-9 only, max 10 chars (largest real ticker is ~6) */
  var raw=inp.value.toUpperCase().trim();
  var sym=raw.replace(/[^A-Z0-9]/g,'').slice(0,10);
  if(!sym||favorites.indexOf(sym)!==-1)return;
  favorites.push(sym);try{localStorage.setItem('nxfav10',JSON.stringify(favorites))}catch(e){}
  inp.value='';renderFavs();updateQACards();
}
function rmFav(i){favorites.splice(i,1);try{localStorage.setItem('nxfav10',JSON.stringify(favorites))}catch(e){}renderFavs();updateQACards()}
function renderFavs(){
  var el=document.getElementById('favList');if(!el)return;
  if(!favorites.length){el.innerHTML='<div class="empty"><div class="empty-ic">⭐</div><div class="empty-tx">'+(lang==='ar'?'أضف عملاتك المفضلة':'Add your favorites')+'</div></div>';return}
  el.innerHTML=favorites.map(function(sym,i){
    var d=T[sym];if(!d)return'<div class="cr" style="padding:8px"><span style="font-weight:700">'+sym+'</span><span style="color:var(--t3);font-size:10px">'+(lang==='ar'?'غير متوفر':'Not found')+'</span><span style="font-size:8px;color:var(--dn);cursor:pointer" onclick="rmFav('+i+')">🗑</span></div>';
    var up=d.c>=0;return'<div class="cr" onclick="openCoin(\''+sym+'\')" style="margin-bottom:4px"><div class="cr-l"><div class="cr-ic" style="background:'+(COL[sym]||'#444')+'0a;color:'+(COL[sym]||'#444')+';border:1px solid '+(COL[sym]||'#444')+'22">'+sym.slice(0,2)+'</div><div><div class="cr-n">'+sym+'/USDT</div><div class="cr-sub">'+fmt(d.v)+'</div></div></div><div class="cr-spark">'+mkSpark(sym)+'</div><div class="cr-r"><div class="cr-p" style="direction:ltr">'+fP(d.p)+'</div><div class="cr-ch '+(up?'up':'dn')+'" style="direction:ltr">'+(up?'+':'')+d.c.toFixed(1)+'%</div></div></div>'
      +'<div style="text-align:left;margin:-2px 0 4px"><span style="font-size:7px;color:var(--t3);cursor:pointer;padding:2px 6px" onclick="event.stopPropagation();rmFav('+i+')">🗑 '+(lang==='ar'?'إزالة':'Remove')+'</span></div>';
  }).join('');
}
/* 🔔 ALERTS */
function renderAlerts(){
  var el=document.getElementById('alertList');if(!el)return;
  var hist=notifHist||[];
  if(!hist.length){el.innerHTML='<div class="empty"><div class="empty-ic">🔔</div><div class="empty-tx">'+(lang==='ar'?'لا تنبيهات':'No alerts')+'</div></div>';return}
  el.innerHTML=hist.slice(0,30).map(function(n){
    var age=Date.now()-n.time;var agoTxt=age<60000?'now':age<3600000?Math.floor(age/60000)+'m':age<86400000?Math.floor(age/3600000)+'h':Math.floor(age/86400000)+'d';
    return'<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--glass);border:1px solid var(--bdr);border-radius:10px;margin-bottom:4px'+(age<300000?';border-color:rgba(0,255,136,.1)':'')+'">'
      +'<span style="font-size:16px;min-width:24px;text-align:center">'+esc(n.icon||n.ic||'🔔')+'</span>'
      +'<div style="flex:1"><div style="font-size:10px;color:var(--t0);font-weight:700">'+esc(n.sym)+' — '+esc(n.type)+'</div><div style="font-size:8px;color:var(--t3)">'+esc(n.body||n.detail||'')+'</div></div>'
      +'<span style="font-family:var(--fm);font-size:8px;color:var(--t3);min-width:28px;text-align:left">'+agoTxt+'</span></div>';
  }).join('');
}
/* 🤖 MONITOR */
function renderMonPanel(){
  var el=document.getElementById('monPanel');if(!el)return;
  var ar=lang==='ar';var h='';
  var total=connMetrics.apiOk+connMetrics.apiFail;var apiRate=total>0?Math.round(connMetrics.apiOk/total*100):0;
  var ms=monitorState||{perf:{overallRate:0,totalTrades:0,totalWins:0,totalLosses:0,bestHour:-1,worstHour:-1},factorStats:{},confCalib:{},hourStats:{},coinStats:{},coinBlacklist:[],weights:{},minConf:55,failPatterns:[],v3weights:DEFAULT_V3_WEIGHTS,v3factorStats:{}};
  var perf=ms.perf;var perfCol=perf.overallRate>=65?'var(--up)':perf.overallRate>=50?'var(--warn)':'var(--dn)';
  var mkt;try{mkt=detectMarketDanger()}catch(e){mkt={level:'safe',dangerous:false,reasons:[]};}
  var mktIc=mkt.level==='safe'?'🟢':mkt.level==='caution'?'🟡':'🔴';
  var mktCol=mkt.level==='safe'?'var(--up)':mkt.level==='caution'?'var(--warn)':'var(--dn)';
  var tkC=Object.keys(T).length,frC=Object.keys(FR).length,oiC=Object.keys(OI).length;

  /* ═══ S1: DAILY REPORT CARD ═══ */
  var rpt=supervisorData.dailyReport;
  if(rpt){
    var gradeCol=rpt.grade>=85?'var(--up)':rpt.grade>=60?'var(--warn)':'var(--dn)';
    h+='<div class="sv-report-card" onclick="try{renderDailyReport()}catch(e){}">';
    h+='<div class="sv-grade" style="color:'+gradeCol+'">'+rpt.gradeLabel+'</div>';
    h+='<div style="font-size:11px;font-weight:700;color:'+gradeCol+'">'+(ar?'التقييم اليومي':'Daily Grade')+' ('+rpt.grade+'/100)</div>';
    h+='<div class="sv-report-stats">';
    h+='<div class="sv-rs"><span class="sv-rs-v" style="color:'+(rpt.scanRate>=60?'var(--up)':'var(--warn)')+'">'+rpt.scanRate+'%</span><span class="sv-rs-l">'+(ar?'سكانر':'Scanner')+'</span></div>';
    h+='<div class="sv-rs"><span class="sv-rs-v" style="color:'+(rpt.whaleRate>=50?'var(--up)':'var(--warn)')+'">'+rpt.whaleRate+'%</span><span class="sv-rs-l">'+(ar?'حيتان':'Whales')+'</span></div>';
    h+='<div class="sv-rs"><span class="sv-rs-v" style="color:'+(rpt.vipRate>=60?'var(--up)':'var(--warn)')+'">'+rpt.vipRate+'%</span><span class="sv-rs-l">VIP</span></div>';
    h+='<div class="sv-rs"><span class="sv-rs-v" style="color:'+(rpt.totalPnl>=0?'var(--up)':'var(--dn)')+'">'+(rpt.totalPnl>=0?'+':'')+rpt.totalPnl.toFixed(1)+'%</span><span class="sv-rs-l">P&L</span></div>';
    h+='</div>';
    h+='<div style="font-size:8px;color:var(--t3);margin-top:6px">'+new Date(rpt.time).toLocaleString()+' — '+(ar?'اضغط للتفاصيل':'Tap for details')+'</div></div>';
  }

  /* ═══ S2: LIVE P&L DASHBOARD ═══ */
  var openTrades=activeTrades?activeTrades.filter(function(t){return t.status==='OPEN'}):[];
  h+='<div class="sv-sec-title">💰 '+(ar?'الأرباح الحية':'Live P&L')+'</div>';
  if(openTrades.length){
    var totalUnrealized=0;
    h+='<div class="cd" style="padding:8px">';
    openTrades.forEach(function(tr){
      var pnl=tr.pnl||0;totalUnrealized+=pnl;
      var pnlCol=pnl>=2?'var(--up)':pnl>=0?'var(--warn)':'var(--dn)';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 4px;border-bottom:1px solid var(--bdr)">';
      h+='<div><span style="font-weight:700;font-size:11px;color:var(--t0)">'+tr.sym+'</span>';
      h+='<span style="font-size:9px;color:var(--t3);margin:0 6px">@ '+fP(tr.entry)+' → '+fP(tr.curPrice||0)+'</span></div>';
      h+='<div style="font-family:var(--fm);font-weight:700;font-size:11px;color:'+pnlCol+'">'+(pnl>=0?'+':'')+pnl.toFixed(2)+'%</div></div>';
    });
    var totalCol=totalUnrealized>=0?'var(--up)':'var(--dn)';
    h+='<div style="display:flex;justify-content:space-between;padding:8px 4px 4px;font-size:12px;font-weight:800">';
    h+='<span style="color:var(--t1)">'+(ar?'الإجمالي':'Total')+' ('+openTrades.length+')</span>';
    h+='<span style="color:'+totalCol+';font-family:var(--fm)">'+(totalUnrealized>=0?'+':'')+totalUnrealized.toFixed(2)+'%</span></div></div>';
  }else{
    h+='<div class="cd sv-empty">'+(ar?'لا صفقات مفتوحة':'No open trades')+'</div>';
  }

  /* ═══ S3: SIGNAL PIPELINE ═══ */
  var scanCount=cache.scan?cache.scan.length:0;
  var top3Count=0;try{top3Count=document.querySelectorAll('.top3-card').length}catch(e){}
  h+='<div class="sv-sec-title">🔬 '+(ar?'خط الإشارات':'Signal Pipeline')+'</div>';
  h+='<div class="sv-pipeline">';
  h+='<div class="sv-pip-step"><div class="sv-pip-v">'+tkC+'</div><div class="sv-pip-l">'+(ar?'عملة':'Coins')+'</div></div>';
  h+='<div class="sv-pip-arr">→</div>';
  h+='<div class="sv-pip-step"><div class="sv-pip-v">'+scanCount+'</div><div class="sv-pip-l">'+(ar?'إشارة':'Signals')+'</div></div>';
  h+='<div class="sv-pip-arr">→</div>';
  h+='<div class="sv-pip-step"><div class="sv-pip-v" style="color:var(--neon)">'+top3Count+'</div><div class="sv-pip-l">Top 3</div></div>';
  h+='<div class="sv-pip-arr">→</div>';
  h+='<div class="sv-pip-step"><div class="sv-pip-v" style="color:var(--ultra)">'+openTrades.length+'</div><div class="sv-pip-l">'+(ar?'صفقة':'Trades')+'</div></div></div>';

  /* ═══ S4: DATA FRESHNESS ═══ */
  h+='<div class="sv-sec-title">📡 '+(ar?'نضارة البيانات':'Data Freshness')+'</div>';
  h+='<div class="cd" style="padding:8px">';
  var dataAge=Math.round((Date.now()-lastDataTime)/1000);
  function dfRow(name,count){var col=count>0?'var(--up)':'var(--dn)';var st=count>0?'✅':'❌';return'<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 2px;border-bottom:1px solid var(--bdr);font-size:10px"><span style="color:var(--t2)">'+name+'</span><span style="font-family:var(--fm);font-weight:700;color:'+col+'">'+st+' '+count+'</span></div>';}
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);padding:2px 0;text-transform:uppercase;letter-spacing:1px">PROXY ('+dataAge+'s ago)</div>';
  h+=dfRow((ar?'أسعار':'Prices'),tkC);h+=dfRow('FR',frC);h+=dfRow('OI',oiC);h+=dfRow('L/S',Object.keys(LS).length);
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);padding:6px 0 2px;text-transform:uppercase;letter-spacing:1px">BINANCE ADV</div>';
  h+=dfRow('Top Traders',Object.keys(topTradersLS).length);h+=dfRow('FR History',Object.keys(frHistory).length);
  h+=dfRow('OI History',Object.keys(oiHistory).length);h+=dfRow('CVD',Object.keys(aggCVD).length);
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);padding:6px 0 2px;text-transform:uppercase;letter-spacing:1px">MULTI-EXCHANGE</div>';
  h+=dfRow('Bitfinex',Object.keys(bitfinexMargin).length);h+=dfRow('Hyperliquid',Object.keys(hyperliquidData).length);
  h+=dfRow('Coinalyze OI',Object.keys(coinalyzeOI).length);h+=dfRow('Coinalyze FR',Object.keys(coinalyzeFR).length);
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);padding:6px 0 2px;text-transform:uppercase;letter-spacing:1px">OTHER</div>';
  h+=dfRow('Coinbase',Object.keys(CBP).length);
  var depC=Object.keys(depthSnapshots).filter(function(s){return depthSnapshots[s]&&depthSnapshots[s].bids}).length;
  h+=dfRow('Order Book',depC);
  var tkDC=Object.keys(takerData).filter(function(s){return takerData[s]}).length;
  h+=dfRow('Taker',tkDC);h+=dfRow('BookTickers',Object.keys(bookTickers).length);
  var stableC=typeof stablecoinData!=='undefined'?Object.keys(stablecoinData).length:0;h+=dfRow('Stablecoins',stableC);
  var unlockC=typeof tokenUnlocks!=='undefined'&&tokenUnlocks?tokenUnlocks.length:0;h+=dfRow('Unlocks',unlockC);
  var newsC=typeof newsSentiment!=='undefined'&&newsSentiment?(newsSentiment.total||0):0;h+=dfRow('News',newsC);
  h+='</div>';

  /* ═══ S5: EXCHANGE HEALTH ═══ */
  h+='<div class="sv-sec-title">🌐 '+(ar?'صحة البورصات':'Exchange Health')+'</div>';
  h+='<div class="sv-exchange-grid">';
  var exArr=[{n:'Binance Spot',c:tkC},{n:'Binance Futures',c:frC},{n:'Bybit',c:Object.keys(coinalyzeOI).length},{n:'Coinbase',c:Object.keys(CBP).length},{n:'Bitfinex',c:Object.keys(bitfinexMargin).length},{n:'Hyperliquid',c:Object.keys(hyperliquidData).length},{n:'Coinalyze',c:Object.keys(coinalyzeOI).length}];
  exArr.forEach(function(ex){h+='<div class="sv-ex-item" style="border-color:'+(ex.c>0?'rgba(0,255,136,.1)':'rgba(255,56,96,.08)')+'"><span style="font-size:8px;font-weight:700;color:var(--t1)">'+ex.n+'</span><span style="font-size:9px;font-family:var(--fm);font-weight:700;color:'+(ex.c>0?'var(--up)':'var(--dn)')+'">'+(ex.c>0?'✅ '+ex.c:'❌')+'</span></div>';});
  h+='</div>';

  /* ═══ S6: WHALE ACTIVITY ═══ */
  var whC=Object.keys(whaleWaves).filter(function(s){return whaleWaves[s]&&whaleWaves[s].waves&&whaleWaves[s].waves.length}).length;
  h+='<div class="sv-sec-title">🐋 '+(ar?'نشاط الحيتان':'Whale Activity')+' <span style="font-size:9px;padding:2px 6px;border-radius:5px;background:rgba(0,255,136,.1);color:var(--up)">'+whC+'</span></div>';
  if(whC>0){
    var whaleArr=Object.entries(whaleWaves).filter(function(e){return e[1]&&e[1].waves&&e[1].waves.length&&e[1].engine}).sort(function(a,b){return(b[1].engine.confidence||0)-(a[1].engine.confidence||0)}).slice(0,3);
    var totalWhaleInflow=0;Object.keys(whaleWaves).forEach(function(s){if(whaleWaves[s]&&whaleWaves[s].totalBuy)totalWhaleInflow+=whaleWaves[s].totalBuy});
    h+='<div style="font-size:10px;color:var(--t2);margin-bottom:6px">'+(ar?'إجمالي التدفق: ':'Inflow: ')+'<b style="color:var(--neon)">'+fmt(totalWhaleInflow)+'</b></div>';
    h+='<div class="cd" style="padding:8px">';
    whaleArr.forEach(function(e){
      var s=e[0],ww=e[1];var pnl=null;try{pnl=calcWhalePnL(s)}catch(ex){}
      var pnlStr=pnl?((pnl.pct>=0?'+':'')+pnl.pct.toFixed(1)+'%'):'--';
      var pnlCol=pnl?(pnl.pct>=2?'var(--up)':pnl.pct>=0?'var(--warn)':'var(--dn)'):'var(--t3)';
      h+='<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 2px;border-bottom:1px solid var(--bdr)">';
      h+='<div><span style="font-weight:700;font-size:11px;color:var(--t0)">'+s+'</span> <span style="font-size:8px;color:var(--neon)">'+(ww.engine.rank||'')+' '+ww.engine.confidence+'%</span></div>';
      h+='<span style="font-family:var(--fm);font-size:10px;font-weight:700;color:'+pnlCol+'">'+pnlStr+'</span></div>';
    });
    h+='</div>';
  }else{h+='<div class="cd sv-empty">'+(ar?'لا نشاط':'No whale activity')+'</div>';}

  /* ═══ S7: MARKET MOOD ═══ */
  h+='<div class="sv-sec-title">🧠 '+(ar?'مزاج السوق':'Market Mood')+'</div>';
  var allCoins=Object.values(T);var greenPct=allCoins.length>0?Math.round(allCoins.filter(function(x){return x.c>0}).length/allCoins.length*100):50;
  var moodScore=50;moodScore+=(fgValue-50)*0.3;moodScore+=(greenPct-50)*0.2;
  var btcChg=T.BTC?T.BTC.c:0;moodScore+=btcChg*2;
  if(typeof newsSentiment!=='undefined'&&newsSentiment&&newsSentiment.score)moodScore+=(newsSentiment.score-50)*0.15;
  if(typeof stablecoinData!=='undefined'&&stablecoinData&&stablecoinData['USDT']&&stablecoinData['USDT'].change7d)moodScore+=stablecoinData['USDT'].change7d*3;
  moodScore=Math.max(0,Math.min(100,Math.round(moodScore)));
  var moodCol=moodScore>=65?'var(--up)':moodScore>=40?'var(--warn)':'var(--dn)';
  var moodLabel=moodScore>=75?(ar?'طمع':'Greedy'):moodScore>=55?(ar?'تفاؤل':'Optimistic'):moodScore>=40?(ar?'محايد':'Neutral'):moodScore>=25?(ar?'خوف':'Fearful'):(ar?'ذعر':'Panic');
  h+='<div class="cd" style="padding:12px;text-align:center">';
  h+='<div style="font-family:var(--fd);font-size:36px;font-weight:800;color:'+moodCol+'">'+moodScore+'</div>';
  h+='<div style="font-size:11px;font-weight:700;color:'+moodCol+'">'+moodLabel+'</div>';
  h+='<div style="height:5px;background:linear-gradient(90deg,var(--dn),var(--warn),var(--up));border-radius:3px;margin:8px 0;position:relative"><div style="position:absolute;top:-4px;left:'+moodScore+'%;width:12px;height:12px;background:var(--t0);border-radius:50%;border:2px solid var(--bg);transform:translateX(-50%)"></div></div>';
  h+='<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--t3)"><span>FG: '+fgValue+'</span><span>BTC: '+(btcChg>=0?'+':'')+btcChg.toFixed(1)+'%</span><span>Green: '+greenPct+'%</span></div></div>';

  /* ═══ S8: V3 CATEGORY PERFORMANCE ═══ */
  h+='<div class="sv-sec-title">📊 '+(ar?'أداء V3':'V3 Categories')+'</div>';
  h+='<div class="cd" style="padding:10px">';
  var v3fs=ms.v3factorStats||{};var v3cats=['whale','smartMoney','technical','funding','timing','context'];
  var v3icons={whale:'🐋',smartMoney:'💼',technical:'📈',funding:'💰',timing:'⏰',context:'🌍'};var hasV3=false;
  v3cats.forEach(function(key){
    var stat=v3fs[key];var wr=stat?stat.winRate:0;var tot=stat?stat.total:0;if(tot>0)hasV3=true;
    var wC=tot===0?'var(--t3)':wr>=65?'var(--up)':wr>=45?'var(--warn)':'var(--dn)';
    var wgt=ms.v3weights?(ms.v3weights[key]||DEFAULT_V3_WEIGHTS[key]):DEFAULT_V3_WEIGHTS[key];
    h+='<div style="display:flex;align-items:center;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:11px">';
    h+='<span style="min-width:18px">'+(v3icons[key]||'')+'</span>';
    h+='<span style="font-weight:700;min-width:70px">'+key+'</span>';
    h+='<div style="flex:1;height:5px;background:rgba(56,72,96,.1);border-radius:3px;margin:0 6px;overflow:hidden"><div style="height:100%;width:'+Math.min(100,wr)+'%;border-radius:3px;background:'+wC+'"></div></div>';
    h+='<span style="font-family:var(--fm);font-weight:700;color:'+wC+';min-width:32px;text-align:right">'+(tot>0?wr+'%':'--')+'</span>';
    h+='<span style="font-family:var(--fm);font-size:8px;color:var(--t3);min-width:30px;text-align:right">'+(tot>0?stat.wins+'/'+tot:'')+'</span>';
    h+='<span style="font-size:7px;color:var(--neon);min-width:20px;text-align:right">'+wgt+'</span></div>';
  });
  if(!hasV3)h+='<div style="color:var(--t3);font-size:10px;text-align:center;padding:6px">'+(ar?'تحتاج صفقات':'Need trades for V3 data')+'</div>';
  h+='</div>';

  /* ═══ S9: STREAK & P&L ═══ */
  h+='<div class="sv-sec-title">📈 '+(ar?'الخطوط والأرباح':'Streak & P&L')+'</div>';
  h+='<div class="cd" style="padding:10px">';
  var logs=factorLog||[];var streak=0,maxStreak=0,curType='';var dayPnl=0,weekPnl=0;var nowMs=Date.now();
  var last10=logs.slice(-10).reverse();
  last10.forEach(function(l,i){if(i===0){curType=(l.outcome==='win'||l.outcome==='partial')?'W':'L';streak=1}else{var tt=(l.outcome==='win'||l.outcome==='partial')?'W':'L';if(tt===curType)streak++}if(streak>maxStreak)maxStreak=streak});
  logs.forEach(function(l){if(nowMs-l.time<86400000)dayPnl+=(l.pnl||0);if(nowMs-l.time<604800000)weekPnl+=(l.pnl||0)});
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:var(--t2)">'+(ar?'الخط الحالي':'Streak')+'</span><span style="font-family:var(--fm);font-weight:700;color:'+(curType==='W'?'var(--up)':'var(--dn)')+'">'+streak+' '+curType+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">'+(ar?'أفضل خط':'Best')+'</span><span style="font-family:var(--fm);font-weight:700">'+maxStreak+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:var(--t2)">'+(ar?'ربح اليوم':'Today')+'</span><span style="font-family:var(--fm);font-weight:700;color:'+(dayPnl>=0?'var(--up)':'var(--dn)')+'">'+(dayPnl>=0?'+':'')+dayPnl.toFixed(1)+'%</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px"><span style="color:var(--t2)">'+(ar?'ربح الأسبوع':'Week')+'</span><span style="font-family:var(--fm);font-weight:700;color:'+(weekPnl>=0?'var(--up)':'var(--dn)')+'">'+(weekPnl>=0?'+':'')+weekPnl.toFixed(1)+'%</span></div>';
  if(last10.length){h+='<div style="display:flex;gap:3px;margin-top:6px;justify-content:center">';last10.forEach(function(l){var isW=l.outcome==='win'||l.outcome==='partial';h+='<div style="width:20px;height:20px;border-radius:4px;background:'+(isW?'rgba(0,255,136,.15)':'rgba(255,56,96,.15)')+';display:grid;place-items:center;font-size:9px;font-weight:700;color:'+(isW?'var(--up)':'var(--dn)')+'">'+(isW?'W':'L')+'</div>'});h+='</div>'}
  h+='</div>';

  /* ═══ S10: HOUR GRID ═══ */
  h+='<div class="sv-sec-title">🕐 '+(ar?'الساعات':'Hours')+'</div>';
  h+='<div class="cd" style="padding:10px"><div style="display:flex;flex-wrap:wrap;gap:2px">';
  for(var hr=0;hr<24;hr++){var hs=ms.hourStats[String(hr)];var rate=hs?hs.rate:-1;var bg=rate<0?'var(--bg2)':rate>=60?'rgba(0,255,136,.15)':rate>=40?'rgba(255,184,0,.15)':'rgba(255,56,96,.15)';var cl=rate<0?'var(--t3)':rate>=60?'var(--up)':rate>=40?'var(--warn)':'var(--dn)';h+='<div style="width:26px;padding:3px 1px;background:'+bg+';border-radius:4px;text-align:center"><div style="font-size:7px;color:var(--t3)">'+String(hr).padStart(2,'0')+'</div><div style="font-size:8px;font-weight:700;font-family:var(--fm);color:'+cl+'">'+(rate>=0?rate+'%':'--')+'</div></div>';}
  h+='</div>';
  if(perf.bestHour>=0)h+='<div style="font-size:10px;margin-top:6px;color:var(--t2)">🏆 '+(ar?'أفضل: ':'Best: ')+'<b style="color:var(--up)">'+perf.bestHour+':00</b>'+(perf.worstHour>=0?' — '+(ar?'أسوأ: ':'Worst: ')+'<b style="color:var(--dn)">'+perf.worstHour+':00</b>':'')+'</div>';
  h+='</div>';

  /* ═══ S11: COINS + BLACKLIST ═══ */
  var coins=Object.entries(ms.coinStats).sort(function(a,b){return(b[1].rate||0)-(a[1].rate||0)});
  if(coins.length){
    h+='<div class="sv-sec-title">🪙 '+(ar?'العملات':'Coins')+'</div><div class="cd" style="padding:10px">';
    coins.forEach(function(e){var s=e[0],c=e[1];var cl=c.rate>=65?'var(--up)':c.rate>=45?'var(--warn)':'var(--dn)';h+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:11px"><span style="font-weight:700">'+s+'</span><span style="font-family:var(--fm);font-weight:700;color:'+cl+'">'+c.rate+'%</span><span style="font-size:9px;color:var(--t3)">'+c.wins+'/'+c.total+'</span></div>'});
    h+='</div>';
  }
  h+='<div class="sv-sec-title">🚫 '+(ar?'محظورة':'Blacklist')+'</div>';
  if(ms.coinBlacklist&&ms.coinBlacklist.length){h+='<div style="display:flex;gap:4px;flex-wrap:wrap">';ms.coinBlacklist.forEach(function(s){h+='<span style="padding:5px 12px;background:var(--dd);border:1px solid rgba(255,56,96,.1);border-radius:8px;font-size:11px;font-weight:700;color:var(--dn)">'+s+'</span>'});h+='</div>'}else{h+='<div style="padding:6px;text-align:center;font-size:11px;color:var(--up)">✅ '+(ar?'لا محظورة':'All clean')+'</div>'}

  /* ═══ S12: GATE REJECTION LOG ═══ */
  h+='<div class="sv-sec-title">🚧 '+(ar?'سجل الحظر':'Gate Rejections')+'</div>';
  var gLog=supervisorData.gateLog||[];
  if(gLog.length){
    h+='<div class="cd" style="padding:8px;max-height:150px;overflow-y:auto">';
    gLog.slice(-10).reverse().forEach(function(g){var age=Date.now()-g.time;var agoTxt=age<60000?'now':age<3600000?Math.floor(age/60000)+'m':Math.floor(age/3600000)+'h';h+='<div style="display:flex;align-items:center;gap:6px;padding:5px 2px;border-bottom:1px solid var(--bdr);font-size:10px"><span style="font-weight:700;color:var(--t0);min-width:36px">'+g.sym+'</span><span style="flex:1;color:var(--dn)">'+g.failed.join(', ')+'</span><span style="font-family:var(--fm);font-size:8px;color:var(--t3)">'+agoTxt+'</span></div>'});
    h+='</div>';
  }else{h+='<div class="cd sv-empty">'+(ar?'لا حظر':'No rejections')+'</div>';}

  /* ═══ S13: TOKEN UNLOCKS ═══ */
  h+='<div class="sv-sec-title">🔓 '+(ar?'فك العملات':'Token Unlocks')+'</div>';
  if(typeof tokenUnlocks!=='undefined'&&tokenUnlocks&&tokenUnlocks.length){
    var nowD=new Date();var tier1U=tokenUnlocks.filter(function(u){return u&&u.sym&&TIER1.has(u.sym)}).slice(0,8);
    if(tier1U.length){
      h+='<div class="cd" style="padding:8px">';
      tier1U.forEach(function(u){var days=Math.round((new Date(u.date)-nowD)/86400000);var dC=days<=3?'var(--dn)':days<=7?'var(--warn)':'var(--t2)';h+='<div style="display:flex;justify-content:space-between;padding:4px 2px;border-bottom:1px solid var(--bdr);font-size:10px"><span style="font-weight:700;color:var(--t0)">'+u.sym+'</span><span style="color:var(--t2)">'+fmt(u.amount||0)+'</span><span style="font-family:var(--fm);font-weight:700;color:'+dC+'">'+(days<=0?(ar?'اليوم!':'Today!'):days+'d')+'</span></div>'});
      h+='</div>';
    }else{h+='<div class="cd sv-empty">'+(ar?'لا فك قريب':'No TIER1 unlocks')+'</div>';}
  }else{h+='<div class="cd sv-empty">'+(ar?'لا بيانات':'No data')+'</div>';}

  /* ═══ S14: CONFIDENCE CALIBRATION ═══ */
  h+='<div class="sv-sec-title">🎯 '+(ar?'معايرة الثقة':'Confidence')+'</div><div class="cd" style="padding:10px">';
  var bk=Object.keys(ms.confCalib).sort();
  if(bk.length){bk.forEach(function(b){var c=ms.confCalib[b];var cl=c.realRate>=65?'var(--up)':c.realRate>=45?'var(--warn)':'var(--dn)';h+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:11px"><span style="color:var(--t2)">Conf '+b+'%</span><span style="font-family:var(--fm);font-weight:700;color:'+cl+'">'+c.realRate+'%</span><span style="font-size:9px;color:var(--t3)">('+c.wins+'/'+c.total+')</span></div>'})}else{h+='<div style="color:var(--t3);font-size:11px;text-align:center;padding:8px">'+(ar?'تحتاج 5+ صفقات':'Need 5+ trades')+'</div>'}
  h+='</div>';

  /* ═══ S15: FAIL PATTERNS ═══ */
  if(ms.failPatterns&&ms.failPatterns.length){h+='<div class="sv-sec-title">⚠️ '+(ar?'أنماط فشل':'Fail Patterns')+'</div><div class="cd" style="padding:10px">';ms.failPatterns.slice(0,5).forEach(function(p){h+='<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:11px"><span>'+p.label+'</span><span style="font-family:var(--fm);font-weight:700;color:var(--dn)">'+p.failRate+'%</span></div>'});h+='</div>';}

  /* ═══ S16: SELF-IMPROVEMENT ═══ */
  h+='<div class="sv-sec-title">🧠 '+(ar?'تعلّم ذاتي':'Self-Improvement')+'</div><div class="cd" style="padding:10px;font-size:11px">';
  var lastTD=ms.lastTune?new Date(ms.lastTune).toLocaleString():(ar?'لا':'Never');
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">'+(ar?'آخر ضبط':'Last Tune')+'</span><span style="font-family:var(--fm);font-weight:600">'+lastTD+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">'+(ar?'حد ثقة':'Min Conf')+'</span><span style="font-family:var(--fm);font-weight:700;color:var(--warn)">'+ms.minConf+'%</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">'+(ar?'محفز التعلم':'Trigger')+'</span><span style="font-family:var(--fm);font-weight:600">'+(ar?'كل 5 صفقات':'Every 5 trades')+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--t2)">'+(ar?'أفضل عامل':'Best')+'</span><span style="font-weight:700;color:var(--up)">'+(perf.bestFactor||'--')+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--t2)">'+(ar?'أضعف عامل':'Worst')+'</span><span style="font-weight:700;color:var(--dn)">'+(perf.worstFactor||'--')+'</span></div>';
  var wKeys=Object.keys(ms.weights||{});
  if(wKeys.length){h+='<div style="font-size:9px;color:var(--t3);margin-top:6px;text-transform:uppercase;letter-spacing:1px">'+(ar?'أوزان قديمة':'Old Weights')+':</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">';wKeys.forEach(function(k){h+='<span style="font-size:8px;font-family:var(--fm);padding:2px 6px;background:var(--bg2);border-radius:4px;color:var(--t2)">'+k+':'+(ms.weights[k]||0).toFixed(1)+'</span>'});h+='</div>'}
  h+='</div>';

  /* ═══ S17: RECOMMENDATIONS ═══ */
  if(rpt&&rpt.recommendations&&rpt.recommendations.length){
    h+='<div class="sv-sec-title">💡 '+(ar?'توصيات':'Recommendations')+'</div>';
    rpt.recommendations.forEach(function(r){var ic=r.type==='good'?'✅':r.type==='warn'?'⚠️':r.type==='bad'?'🔴':'ℹ️';var bg=r.type==='good'?'rgba(0,255,136,.06)':r.type==='warn'?'rgba(255,184,0,.06)':r.type==='bad'?'rgba(255,56,96,.06)':'rgba(91,156,255,.06)';h+='<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:'+bg+';border:1px solid var(--bdr);border-radius:10px;margin-bottom:4px;font-size:10px;color:var(--t1)">'+ic+' '+r.text+'</div>'});
  }

  /* ═══ S18: SYSTEM INFO ═══ */
  h+='<div class="sv-sec-title">🏥 '+(ar?'النظام':'System')+'</div><div class="cd" style="padding:10px;font-size:11px">';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">'+(ar?'عملات':'Coins')+'</span><span style="font-family:var(--fm);font-weight:700;color:var(--neon)">'+tkC+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">FR/OI/LS</span><span style="font-family:var(--fm);font-weight:700">'+frC+'/'+oiC+'/'+Object.keys(LS).length+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">API</span><span style="font-family:var(--fm);font-weight:700;color:'+(apiRate>=90?'var(--up)':'var(--warn)')+'">'+apiRate+'%</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr)"><span style="color:var(--t2)">WL</span><span style="font-family:var(--fm);font-weight:700">'+WL.length+'</span></div>';
  h+='<div style="display:flex;justify-content:space-between;padding:4px 0"><span style="color:var(--t2)">Version</span><span style="font-family:var(--fm);font-weight:700;color:var(--neon)">V10 + Supervisor</span></div></div>';
  var lastCol=supervisorData.lastCollect||0;var colAge=Date.now()-lastCol;
  var colTxt=lastCol===0?'Never':colAge<3600000?Math.round(colAge/60000)+'m ago':Math.round(colAge/3600000)+'h ago';
  h+='<div style="text-align:center;font-size:8px;color:var(--t3);margin-top:8px">🔄 Supervisor: '+colTxt+' — report '+(supervisorData.lastReport?new Date(supervisorData.lastReport).toLocaleDateString():'Never')+'</div>';

  el.innerHTML=h;
}
/* DASHBOARD */
var lastFullLoad=0;var LOAD_COOLDOWN=15000;
async function loadDash(){
  if(Date.now()-lastFullLoad<LOAD_COOLDOWN&&Object.keys(T).length>100){
    try{renderTopCoins()}catch(e){}
    try{renderTop3()}catch(e){}
    try{updateQACards()}catch(e){}
    return;
  }
  lastFullLoad=Date.now();
  try{ await loadTk(); }catch(e){ console.error('loadTk:',e); }
  try{ fetchBinanceAdvanced(); }catch(e){} /* non-blocking — data loads in background */
  try{ fetchCoinbasePrices(); }catch(e){} /* Coinbase — direct price fetch */
  try{ fetchDeFiLlama(); }catch(e){} /* DeFiLlama — stablecoins + TVL */
  try{ fetchTokenUnlocks(); }catch(e){} /* Token Unlocks */
  try{ refreshTiers(); }catch(e){}
  try{ checkVolSpikes(); }catch(e){}
  try{ await loadTop4Ext(); }catch(e){}
  try{
  /* Only fetch from direct API if proxy didn't provide FG value */
  if(fgValue===50||!fgValue){var fg=await fj('https://api.alternative.me/fng/?limit=1');if(fg&&fg.data){fgValue=+fg.data[0].value;var fgE=document.getElementById('fgV');if(fgE)fgE.textContent=fgValue;var fgLE=document.getElementById('fgL');if(fgLE)fgLE.textContent=fg.data[0].value_classification;var pFGE=document.getElementById('pFG');if(pFGE)pFGE.textContent=fgValue}}
  }catch(e){}
  try{
  /* Only fetch from direct API if proxy didn't provide BTC Dom */
  if(btcDom===50||!btcDom){var gl=await fj(CG+'/global');if(gl&&gl.data){btcDom=gl.data.market_cap_percentage?gl.data.market_cap_percentage.btc:50;var btcDE=document.getElementById('btcD');if(btcDE)btcDE.textContent=btcDom.toFixed(1)+'%'}}
  }catch(e){}
  try{
  var h=calcHealth();var hc=h.score>=70?'up':h.score>=45?'warn':'dn';
  var mhSE=document.getElementById('mhScore');if(mhSE){mhSE.textContent=h.score;mhSE.style.color='var(--'+hc+')'}
  var mhLE=document.getElementById('mhLabel');if(mhLE)mhLE.textContent=h.score>=70?(lang==='ar'?'سوق صحي':'Healthy'):h.score>=45?(lang==='ar'?'محايد — حذر':'Neutral'):(lang==='ar'?'ضعيف':'Weak');
  var mhPE=document.getElementById('mhPt');if(mhPE)mhPE.style.left=h.score+'%';var pMHE=document.getElementById('pMH');if(pMHE)pMHE.textContent=h.score;
  var mhFE=document.getElementById('mhFactors');if(mhFE)mhFE.innerHTML=h.factors.map(function(f){return'<div class="mh-f"><div class="mh-f-v" style="color:var(--'+f.c+')">'+f.v+'</div><div class="mh-f-l">'+f.l+'</div></div>'}).join('');
  }catch(e){}
  try{ loadStableFlow(); }catch(e){}
  try{
  var wbE=document.getElementById('warnBox');if(wbE)wbE.innerHTML=getWarnings().map(function(w){return'<div class="warn-box"><div class="w-ic">'+w.ic+'</div><div class="w-txt">'+w.txt+'</div></div>'}).join('');
  var bk=Object.values(T).filter(function(x){return x.c>=8}).length;var bkE=document.getElementById('brkC');if(bkE)bkE.textContent=bk;var pBE=document.getElementById('pBrk');if(pBE)pBE.textContent=bk;
  }catch(e){}
  try{
  var cands=quickScan();var results=await deepAnalyze(cands);cache.scan=results;cache.scanTime=Date.now();detectWhaleWaves(results);
  var ultras=results.filter(function(r){return r.ultra});var conf=results.filter(function(r){return r.confirmed});
  var ultraLE=document.getElementById('ultraL');if(ultraLE)ultraLE.innerHTML=ultras.length?ultras.slice(0,3).map(ultraCard).join(''):conf.length?conf.slice(0,2).map(ultraCard).join(''):'<div class="muted">'+t('no_ultra')+'</div>';
  var ulCE=document.getElementById('ulC');if(ulCE)ulCE.textContent=ultras.length||conf.length;var pUlE=document.getElementById('pUl');if(pUlE)pUlE.textContent=ultras.length||conf.length;var notifBE=document.getElementById('notifB');if(notifBE)notifBE.dataset.c=(ultras.length||conf.length).toString();
  }catch(e){ console.error('scan:',e); }
  try{ renderDashLS(); }catch(e){ console.error('renderDashLS:',e); }
  try{ renderAcc('accCard'); }catch(e){}
  try{ renderTopCoins(); }catch(e){ console.error('renderTopCoins:',e); }
  try{ renderTop3(); }catch(e){ console.error('renderTop3:',e); }
  try{ checkWatchlistAlerts(); }catch(e){}
  try{ updateQACards(); }catch(e){}
}
/* SCANNER PAGE — uses cache for instant switch */
async function runScan(){if(cache.scan&&Date.now()-cache.scanTime<CACHE_TTL){renderScanResults(cache.scan);setTimeout(async function(){var c=quickScan();cache.scan=await deepAnalyze(c);cache.scanTime=Date.now();renderScanResults(cache.scan)},100);return}var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();renderScanResults(r)}
function renderScanResults(results){var f=results;var t1c=f.filter(function(r){return getCoinTier(r.s)===1}).length;var t2c=f.filter(function(r){return getCoinTier(r.s)===2}).length;var scanIEl=document.getElementById('scanI');if(scanIEl)scanIEl.textContent='📊 '+Object.keys(T).length+' '+(lang==='ar'?'عملة':'coins')+' → ✅ '+f.length+' (🏆'+t1c+' 🥈'+t2c+')';var trEl=document.getElementById('tradeList');if(trEl)trEl.innerHTML=f.length?f.slice(0,30).map(scanItem).join(''):'<div class="sc-empty"><div class="sc-empty-ic">📡</div><div class="sc-empty-title">'+t('no_data')+'</div></div>'}
/* WHALE PAGE */
async function loadWhales(){var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();await detectWhaleWaves(r);renderWhaleResults(r)}
function renderWhaleResults(results){var w=results.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')||t.includes('BOTTOM')})||(x.v>5e7&&Math.abs(x.c)<3)||(x.checks&&x.checks.ob&&x.v>1e7)||whaleWaves[x.s]}).slice(0,20);
  /* Sort by confidence first, then wave count */
  w.sort(function(a,b){var ea=whaleWaves[a.s]&&whaleWaves[a.s].engine?whaleWaves[a.s].engine.confidence:0;var eb=whaleWaves[b.s]&&whaleWaves[b.s].engine?whaleWaves[b.s].engine.confidence:0;if(eb!==ea)return eb-ea;var wa=whaleWaves[a.s]?whaleWaves[a.s].waves.length:0;var wb=whaleWaves[b.s]?whaleWaves[b.s].waves.length:0;return wb-wa||b.score-a.score});
  /* Use calcRealTotalBuy for accurate totals */
  var totalBuy=w.reduce(function(s,x){var real=calcRealTotalBuy(x.s);var ww=whaleWaves[x.s];return s+(real>0?real:(ww?ww.totalBuy:x.v*0.05))},0);
  var buyTotal=w.filter(function(x){return x.c>0}).reduce(function(s,x){var real=calcRealTotalBuy(x.s);var ww=whaleWaves[x.s];return s+(real>0?real:(ww?ww.totalBuy:x.v*0.05))},0);
  var sellTotal=w.filter(function(x){return x.c<0}).reduce(function(s,x){var real=calcRealTotalBuy(x.s);var ww=whaleWaves[x.s];return s+(real>0?real:(ww?ww.totalBuy:x.v*0.05))},0);
  document.getElementById('whT').textContent=fmt(totalBuy);document.getElementById('whB').textContent=fmt(buyTotal);document.getElementById('whS').textContent=fmt(sellTotal);document.getElementById('whAL').innerHTML=w.length?w.map(function(x,i){return whaleCard(x,i)}).join(''):'<div class="empty"><div class="empty-ic">\u{1F40B}</div><div class="empty-tx">'+t('no_whale')+'</div></div>';renderAcc('whAccCard')}
/* INDICATORS PAGE */
/* ═══ 📊 INDICATORS — 7 PRO ACCORDION CARDS ═══ */
async function loadInd(){
  var el=document.getElementById('indCards');if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:20px"><div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div></div>';
  if(!Object.keys(FR).length||!Object.keys(takerData).length)try{await loadTk()}catch(e){}
  try{await fetchBinanceAdvanced()}catch(e){}
  try{await fetchCoinbasePrices()}catch(e){}
  try{await fetchDeFiLlama()}catch(e){}
  try{await fetchTokenUnlocks()}catch(e){}
  var h='';
  try{h+=buildStablecoinCard()}catch(e){h+=''}
  try{h+=buildTVLCard()}catch(e){h+=''}
  try{h+=buildUnlocksCard()}catch(e){h+=''}
  try{h+=buildFRCard()}catch(e){h+=''}
  try{h+=buildFRHistCard()}catch(e){h+=''}
  try{h+=buildOICard()}catch(e){h+=''}
  try{h+=buildOIHistCard()}catch(e){h+=''}
  try{h+=buildTopTradersCard()}catch(e){h+=''}
  try{h+=buildLiqCard()}catch(e){h+=''}
  try{h+=buildWhaleCard()}catch(e){h+=''}
  try{h+=buildRealCVDCard()}catch(e){h+=''}
  try{h+=buildCVDCard()}catch(e){h+=''}
  try{h+=buildOBCard()}catch(e){h+=''}
  try{h+=buildTakerCard()}catch(e){h+=''}
  try{h+=buildSpreadCard()}catch(e){h+=''}
  /* ═══ NEW: Multi-Exchange Cards ═══ */
  try{await fetchMultiExchange()}catch(e){}
  try{h+=buildMultiOICard()}catch(e){h+=''}
  try{h+=buildMultiFRCard()}catch(e){h+=''}
  try{h+=buildAggLiqCard()}catch(e){h+=''}
  try{h+=buildDEXCard()}catch(e){h+=''}
  try{h+=buildCBPremiumCard()}catch(e){h+=''}
  try{h+=buildOnChainCard()}catch(e){h+=''}
  try{h+=buildBitfinexCard()}catch(e){h+=''}
  el.innerHTML=h||'<div class="empty"><div class="empty-ic">📊</div><div class="empty-tx">'+(lang==='ar'?'لا بيانات':'No data')+'</div></div>';
}
function indCardWrap(ic,icBg,icBdr,name,sub,val,valCol,bodyHTML){
  return'<div class="ind-card" onclick="this.classList.toggle(\'open\')">'
    +'<div class="ind-head"><div class="ind-left">'
    +'<div class="ind-ic" style="background:'+icBg+';border:1px solid '+icBdr+'">'+ic+'</div>'
    +'<div><div class="ind-nm">'+name+'</div><div class="ind-sub">'+sub+'</div></div></div>'
    +'<div class="ind-right"><span class="ind-val" style="color:'+valCol+'">'+val+'</span><span class="ind-arr">▼</span></div></div>'
    +'<div class="ind-body">'+bodyHTML+'</div></div>';
}
function buildFRCard(){
  var entries=Object.entries(FR).filter(function(e){return WL.includes(e[0])}).sort(function(a,b){return Math.abs(b[1].rate)-Math.abs(a[1].rate)});
  var danger=entries.filter(function(e){return e[1].rate>0.05}).length;
  var opp=entries.filter(function(e){return e[1].rate<-0.01}).length;
  var avg=entries.length?entries.reduce(function(s,e){return s+e[1].rate},0)/entries.length:0;
  var chips='<div class="ind-chips">'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">⚠️ '+danger+' '+(lang==='ar'?'خطر':'Danger')+'</span>'
    +'<span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 '+opp+' '+(lang==='ar'?'فرصة':'Opportunity')+'</span>'
    +'<span class="ind-chip" style="background:var(--wd);color:var(--warn)">'+(lang==='ar'?'متوسط':'Avg')+': '+(avg>=0?'+':'')+avg.toFixed(3)+'%</span></div>';
  var rows='';
  entries.slice(0,15).forEach(function(e){
    var s=e[0],r=e[1].rate;var cls=r>0.05?'dn':r<-0.01?'up':'warn';
    var w=Math.min(45,Math.abs(r)*500);
    var tag=r>0.05?(lang==='ar'?'خطر':'Danger'):r<-0.01?(lang==='ar'?'فرصة':'Opp'):(lang==='ar'?'طبيعي':'Normal');
    var tagBg=r>0.05?'var(--dd)':r<-0.01?'var(--ud)':'var(--wd)';
    var tagCol=r>0.05?'var(--dn)':r<-0.01?'var(--up)':'var(--warn)';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<div class="ind-bar"><div class="ind-fill" style="'+(r>=0?'right':'left')+':50%;width:'+w+'%;background:var(--'+cls+')"></div></div>'
      +'<span class="ind-val" style="color:var(--'+cls+');min-width:60px;font-size:10px;direction:ltr">'+(r>=0?'+':'')+r.toFixed(4)+'%</span>'
      +'<span class="ind-tag" style="background:'+tagBg+';color:'+tagCol+'">'+tag+'</span></div>';
  });
  return indCardWrap('💰','rgba(255,56,96,.06)','rgba(255,56,96,.12)','Funding Rate',lang==='ar'?'معدل التمويل — '+entries.length+' عملة':entries.length+' coins',(avg>=0?'+':'')+avg.toFixed(3)+'%',avg>0.03?'var(--dn)':avg<-0.01?'var(--up)':'var(--warn)',chips+rows);
}
function buildOICard(){
  var entries=Object.entries(OI).sort(function(a,b){return b[1]-a[1]});
  var total=entries.reduce(function(s,e){return s+e[1]},0);
  var rising=entries.filter(function(e){var d=T[e[0]];return d&&d.c>0}).length;
  var chips='<div class="ind-chips">'
    +'<span class="ind-chip" style="background:var(--ud);color:var(--up)">📈 '+rising+' '+(lang==='ar'?'يرتفع':'Rising')+'</span>'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">📉 '+(entries.length-rising)+' '+(lang==='ar'?'ينخفض':'Falling')+'</span></div>';
  var rows='';
  entries.slice(0,12).forEach(function(e){
    var s=e[0],v=e[1],d=T[s];var ch=d?d.c:0;
    var interp=ch>0?(lang==='ar'?'Long↑':'Long↑'):(lang==='ar'?'Short↑':'Short↑');
    var interpCol=ch>0?'var(--up)':'var(--dn)';var interpBg=ch>0?'var(--ud)':'var(--dd)';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<span class="ind-val" style="color:var(--neon);min-width:60px;font-size:10px">'+fmt(v)+'</span>'
      +'<span class="ind-tag" style="background:'+interpBg+';color:'+interpCol+'">'+interp+'</span></div>';
  });
  var guide='<div class="ind-guide">🟢 OI↑+Price↑ = '+(lang==='ar'?'Long جديد':'New Longs')+' | 🔴 OI↑+Price↓ = '+(lang==='ar'?'Short جديد':'New Shorts')+'</div>';
  return indCardWrap('📊','rgba(0,212,255,.06)','rgba(0,212,255,.12)','Open Interest',lang==='ar'?'مراكز مفتوحة':'Open positions',fmt(total),'var(--neon)',chips+rows+guide);
}
function buildLiqCard(){
  var now=Date.now(),hourAgo=now-3600000;
  var recent=liqEvents?liqEvents.filter(function(e){return e.time&&e.time>hourAgo}):[];
  var longT=0,shortT=0,biggest={s:'',v:0,side:''};
  recent.forEach(function(e){var v=(e.q||0)*(e.p||0);if(e.S==='SELL'){longT+=v;if(v>biggest.v){biggest={s:e.s?e.s.replace('USDT',''):'-',v:v,side:'Long'}}}else{shortT+=v;if(v>biggest.v){biggest={s:e.s?e.s.replace('USDT',''):'-',v:v,side:'Short'}}}});
  var chips='<div class="ind-chips">'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">🔴 Long: '+fmt(longT)+'</span>'
    +'<span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 Short: '+fmt(shortT)+'</span>'
    +(biggest.v>0?'<span class="ind-chip" style="background:rgba(255,122,26,.08);color:#ff7a1a">⚡ '+biggest.s+' '+fmt(biggest.v)+'</span>':'')+'</div>';
  var rows='';
  recent.sort(function(a,b){return(b.time||0)-(a.time||0)}).slice(0,8).forEach(function(e){
    var v=(e.q||0)*(e.p||0);var sym=e.s?e.s.replace('USDT',''):'?';var isLong=e.S==='SELL';
    var tm=e.time?new Date(e.time).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'}):'--';
    rows+='<div class="ind-liq">'
      +'<span style="font-family:var(--fm);font-size:9px;color:var(--t3);min-width:36px">'+tm+'</span>'
      +'<span class="ind-sym">'+sym+'</span>'
      +'<span class="ind-val" style="color:'+(isLong?'var(--dn)':'var(--up)')+';min-width:50px;font-size:10px">'+fmt(v)+'</span>'
      +'<span class="ind-tag" style="background:'+(isLong?'var(--dd)':'var(--ud)')+';color:'+(isLong?'var(--dn)':'var(--up)')+'">'+(isLong?'Long':'Short')+'</span>'
      +'<span style="font-family:var(--fm);font-size:8px;color:var(--t3);direction:ltr">@'+fP(e.p||0)+'</span></div>';
  });
  if(!rows)rows='<div style="text-align:center;color:var(--t3);font-size:10px;padding:8px">'+(lang==='ar'?'لا تصفيات حالياً':'No liquidations now')+'</div>';
  var pct=longT+shortT>0?Math.round(longT/(longT+shortT)*100):50;
  var note='<div style="text-align:center;font-size:9px;color:var(--t2);padding-top:4px">'+(pct>60?'🔴 '+pct+'% Long — '+(lang==='ar'?'ضغط على المشترين':'Pressure on buyers'):pct<40?'🟢 '+pct+'% Long — '+(lang==='ar'?'ضغط على البائعين':'Pressure on sellers'):'⚖️ '+(lang==='ar'?'متوازن':'Balanced'))+'</div>';
  return indCardWrap('💥','rgba(255,122,26,.06)','rgba(255,122,26,.12)','Liquidations',lang==='ar'?'تصفيات لايف — آخر ساعة':'Live — last hour',fmt(longT+shortT),'#ff7a1a',chips+rows+note);
}
function buildWhaleCard(){
  var totalBuy=0,totalSell=0,wRows='';var count=0;
  WL.slice(0,12).forEach(function(s){
    var ww=whaleWaves[s];if(!ww||!ww.waves||!ww.waves.length)return;
    var buy=ww.totalBuy||0;totalBuy+=buy;count++;
    var conf=ww.engine?ww.engine.confidence:0;
    var tag=conf>=50?(lang==='ar'?'تجميع قوي':'Strong'):(lang==='ar'?'بداية':'Starting');
    var tagCol=conf>=50?'var(--up)':'var(--neon)';var tagBg=conf>=50?'var(--ud)':'rgba(0,212,255,.08)';
    wRows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<span class="ind-val" style="color:var(--up);min-width:60px;font-size:10px">'+fmt(buy)+'</span>'
      +'<span class="ind-tag" style="background:'+tagBg+';color:'+tagCol+'">'+ww.waves.length+' '+(lang==='ar'?'موجة':'waves')+'</span></div>';
  });
  if(!wRows)wRows='<div style="text-align:center;color:var(--t3);font-size:10px;padding:8px">'+(lang==='ar'?'لا نشاط حيتان':'No whale activity')+'</div>';
  var chips='<div class="ind-chips"><span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 '+fmt(totalBuy)+' '+(lang==='ar'?'شراء':'Buy')+'</span>'
    +'<span class="ind-chip" style="background:rgba(0,212,255,.08);color:var(--neon)">'+count+' '+(lang==='ar'?'عملة':'coins')+'</span></div>';
  return indCardWrap('🐋','rgba(0,212,255,.06)','rgba(0,212,255,.12)','Whale Flow',lang==='ar'?'تحركات الحيتان':'Whale movements',fmt(totalBuy),'var(--neon)',chips+wRows);
}
function buildCVDCard(){
  var bullish=0,bearish=0,cRows='';
  WL.slice(0,12).forEach(function(s){
    try{var cvd=analyzeCVD(s);if(!cvd)return;
    var dir=cvd.divergence==='BULLISH'?'up':cvd.divergence==='BEARISH'?'dn':'t3';
    var arrow=dir==='up'?'↑':dir==='dn'?'↓':'↔';
    var label=dir==='up'?(lang==='ar'?'شراء مخفي':'Hidden buy'):dir==='dn'?(lang==='ar'?'بيع مخفي':'Hidden sell'):(lang==='ar'?'محايد':'Neutral');
    if(dir==='up')bullish++;if(dir==='dn')bearish++;
    cRows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<span class="ind-val" style="color:var(--'+dir+')">'+arrow+' '+label+'</span></div>';
    }catch(e){}
  });
  var chips='<div class="ind-chips"><span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 '+bullish+' '+(lang==='ar'?'شراء':'Buy')+'</span>'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">🔴 '+bearish+' '+(lang==='ar'?'بيع':'Sell')+'</span></div>';
  var guide='<div class="ind-guide">📖 CVD↑ + '+(lang==='ar'?'سعر ثابت = شراء مخفي (فرصة)':'Flat price = Hidden buy') +'</div>';
  var overall=bullish>bearish?(lang==='ar'?'صاعد':'Bullish'):bearish>bullish?(lang==='ar'?'هابط':'Bearish'):(lang==='ar'?'محايد':'Neutral');
  var oCol=bullish>bearish?'var(--up)':bearish>bullish?'var(--dn)':'var(--warn)';
  return indCardWrap('📈','rgba(176,124,255,.06)','rgba(176,124,255,.12)','CVD',lang==='ar'?'حجم الشراء المخفي':'Cumulative Volume Delta',overall,oCol,chips+cRows+guide);
}
function buildOBCard(){
  var obRows='',totalRatio=0,count=0;
  var syms=['BTC','ETH','SOL','BNB','XRP'];
  syms.forEach(function(s){
    var ds=depthSnapshots[s];if(!ds||!ds.bids||!ds.bids.length)return;
    var bidT=0,askT=0;
    try{ds.bids.slice(0,10).forEach(function(b){bidT+=((+b[0]||0)*(+b[1]||0))});ds.asks.slice(0,10).forEach(function(a){askT+=((+a[0]||0)*(+a[1]||0))})}catch(e){return}
    var r=askT>0?bidT/askT:1;totalRatio+=r;count++;
    var tag=r>1.3?'BUY':r<0.7?'SELL':'NEUTRAL';
    var tagCol=r>1.3?'var(--up)':r<0.7?'var(--dn)':'var(--warn)';
    var tagBg=r>1.3?'var(--ud)':r<0.7?'var(--dd)':'var(--wd)';
    var gPct=Math.min(80,r/(r+1)*100),rPct=100-gPct;
    obRows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<div style="flex:1;display:flex;align-items:center;gap:1px;margin:0 6px">'
      +'<div style="flex:'+gPct.toFixed(0)+';height:7px;background:rgba(0,255,136,.3);border-radius:3px 0 0 3px"></div>'
      +'<div style="width:1px;height:10px;background:var(--t3)"></div>'
      +'<div style="flex:'+rPct.toFixed(0)+';height:7px;background:rgba(255,56,96,.3);border-radius:0 3px 3px 0"></div></div>'
      +'<span class="ind-val" style="color:'+tagCol+';font-size:10px;min-width:35px">'+r.toFixed(1)+'x</span>'
      +'<span class="ind-tag" style="background:'+tagBg+';color:'+tagCol+'">'+tag+'</span></div>';
  });
  if(!obRows)obRows='<div style="text-align:center;color:var(--t3);font-size:10px;padding:8px">'+(lang==='ar'?'Order Book غير متوفر':'Order Book unavailable')+'</div>';
  var avgR=count>0?(totalRatio/count):1;
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'أخضر = أوامر شراء | أحمر = أوامر بيع | 1.5x+ = ضغط صعودي':'Green = Buy orders | Red = Sell | 1.5x+ = Bullish')+'</div>';
  return indCardWrap('📕','rgba(91,156,255,.06)','rgba(91,156,255,.12)','Order Book',lang==='ar'?'ضغط الشراء vs البيع':'Buy vs Sell pressure',avgR.toFixed(1)+'x',avgR>1.2?'var(--up)':avgR<0.8?'var(--dn)':'var(--warn)',obRows+guide);
}
function buildTakerCard(){
  var bullish=0,bearish=0,tRows='';
  WL.slice(0,12).forEach(function(s){
    var tk=takerData[s];if(!tk)return;
    var r=tk.ratio||1;var trend=tk.trend||'';
    var cls=r>1.5?'up':r<0.7?'dn':'warn';
    var label=r>1.5?(lang==='ar'?'شراء عدواني':'Aggressive buy'):r<0.7?(lang==='ar'?'بيع عدواني':'Aggressive sell'):(lang==='ar'?'متوازن':'Balanced');
    var trendIc=trend==='INCREASING'?'📈':trend==='DECREASING'?'📉':'';
    if(r>1.3)bullish++;if(r<0.8)bearish++;
    tRows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<span class="ind-val" style="color:var(--'+cls+');font-size:10px;min-width:40px">'+r.toFixed(1)+'x</span>'
      +'<span style="font-size:9px;color:var(--'+cls+')">'+trendIc+' '+label+'</span></div>';
  });
  if(!tRows)tRows='<div style="text-align:center;color:var(--t3);font-size:10px;padding:8px">'+(lang==='ar'?'لا بيانات':'No data')+'</div>';
  var chips='<div class="ind-chips"><span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 '+bullish+' '+(lang==='ar'?'شراء':'Buy')+'</span>'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">🔴 '+bearish+' '+(lang==='ar'?'بيع':'Sell')+'</span></div>';
  var guide='<div class="ind-guide">📖 Taker = '+(lang==='ar'?'اللي يشتري/يبيع بسعر السوق فوراً | 1.5x+ شراء = صعود':'Market order buyer/seller | 1.5x+ buy = Bullish')+'</div>';
  var avg=bullish>bearish?(lang==='ar'?'شراء':'Buy'):bearish>bullish?(lang==='ar'?'بيع':'Sell'):(lang==='ar'?'متوازن':'Balanced');
  var avgCol=bullish>bearish?'var(--up)':bearish>bullish?'var(--dn)':'var(--warn)';
  return indCardWrap('⚡','rgba(255,215,0,.06)','rgba(255,215,0,.12)','Taker Buy/Sell',lang==='ar'?'الشراء العدواني':'Aggressive trading',avg,avgCol,chips+tRows+guide);
}

/* ═══ NEW CARD: FR History (Binance Free) ═══ */
function buildFRHistCard(){
  var coins=BN_ADV_COINS.filter(function(s){return frHistory[s]&&frHistory[s].length>=4});
  if(!coins.length)return'';
  var rows='';
  coins.slice(0,8).forEach(function(s){
    var h=frHistory[s];var last=h[h.length-1];var prev=h[h.length-2];
    var avg8=h.slice(-8).reduce(function(a,x){return a+x.rate},0)/Math.min(8,h.length);
    var trend=last.rate>prev.rate?'📈':'📉';
    var cls=last.rate>0.03?'dn':last.rate<-0.01?'up':'warn';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:55px;direction:ltr;font-family:var(--fm)">'+(last.rate>=0?'+':'')+last.rate.toFixed(4)+'%</span>'
      +frHistBars(s)
      +'<span style="font-size:8px;color:var(--t2);min-width:50px;direction:ltr;font-family:var(--fm)">avg:'+(avg8>=0?'+':'')+avg8.toFixed(4)+'%</span>'
      +'<span style="font-size:10px">'+trend+'</span></div>';
  });
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'تاريخ FR آخر 50 فترة — الأعمدة = آخر 8':'FR history last 50 periods — bars = last 8')+'</div>';
  return indCardWrap('📉','rgba(176,124,255,.06)','rgba(176,124,255,.12)',lang==='ar'?'تاريخ FR':'FR History',lang==='ar'?'آخر 50 فترة — '+coins.length+' عملة':coins.length+' coins — last 50 periods','','',(rows||'<div style="text-align:center;color:var(--t3);font-size:10px;padding:8px">Loading...</div>')+guide);
}

/* ═══ NEW CARD: OI History (Binance Free) ═══ */
function buildOIHistCard(){
  var coins=BN_ADV_COINS.filter(function(s){return oiHistory[s]&&oiHistory[s].length>=4});
  if(!coins.length)return'';
  var rows='';
  coins.slice(0,8).forEach(function(s){
    var h=oiHistory[s];var last=h[h.length-1];var first=h[0];
    var change=first.val>0?((last.val-first.val)/first.val*100):0;
    var cls=change>5?'up':change<-5?'dn':'warn';
    var d=T[s];var pChg=d?d.c:0;
    /* OI interpretation */
    var interp='';
    if(change>3&&pChg>0)interp=lang==='ar'?'🟢 Long جديد':'🟢 New Longs';
    else if(change>3&&pChg<0)interp=lang==='ar'?'🔴 Short جديد':'🔴 New Shorts';
    else if(change<-3&&pChg>0)interp=lang==='ar'?'🟡 Short Squeeze':'🟡 Short Squeeze';
    else if(change<-3&&pChg<0)interp=lang==='ar'?'🟡 Long Squeeze':'🟡 Long Squeeze';
    else interp=lang==='ar'?'— مستقر':'— Stable';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +oiHistBars(s)
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:48px;direction:ltr;font-family:var(--fm)">'+(change>=0?'+':'')+change.toFixed(1)+'%</span>'
      +'<span style="font-size:8px;color:var(--t1);min-width:80px">'+interp+'</span></div>';
  });
  var guide='<div class="ind-guide">📖 OI↑+Price↑ = '+(lang==='ar'?'أموال جديدة Long':'New Long money')+' | OI↓+Price↑ = '+(lang==='ar'?'Short Squeeze':'Short Squeeze')+'</div>';
  return indCardWrap('📊','rgba(0,255,136,.06)','rgba(0,255,136,.12)',lang==='ar'?'تاريخ OI':'OI History',lang==='ar'?'تغير 24 ساعة — '+coins.length+' عملة':'24h change — '+coins.length+' coins','','',rows+guide);
}

/* ═══ NEW CARD: Top Traders L/S (Binance Free) ═══ */
function buildTopTradersCard(){
  var coins=BN_ADV_COINS.filter(function(s){return topTradersLS[s]&&topTradersLS[s].accounts&&topTradersLS[s].accounts.length});
  if(!coins.length)return'';
  var bullCount=0,bearCount=0;
  var rows='';
  coins.slice(0,8).forEach(function(s){
    var acc=topTradersLS[s].accounts;var pos=topTradersLS[s].positions;
    var lastAcc=acc[acc.length-1];var prevAcc=acc.length>=2?acc[acc.length-2]:lastAcc;
    var lastPos=pos&&pos.length?pos[pos.length-1]:null;
    var accLong=(lastAcc.long*100).toFixed(0);var accShort=(lastAcc.short*100).toFixed(0);
    var trend=lastAcc.long>prevAcc.long?'📈':'📉';
    var cls=lastAcc.long>0.55?'up':lastAcc.long<0.45?'dn':'warn';
    if(lastAcc.long>0.55)bullCount++;if(lastAcc.long<0.45)bearCount++;
    /* L/S bar */
    var barW=Math.round(lastAcc.long*100);
    var bar='<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;flex:1;min-width:60px">'
      +'<div style="width:'+barW+'%;background:var(--up)"></div>'
      +'<div style="width:'+(100-barW)+'%;background:var(--dn)"></div></div>';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +bar
      +'<span style="font-size:9px;color:var(--up);min-width:28px;font-family:var(--fm)">'+accLong+'%</span>'
      +'<span style="font-size:9px;color:var(--dn);min-width:28px;font-family:var(--fm)">'+accShort+'%</span>'
      +'<span style="font-size:10px">'+trend+'</span></div>';
  });
  var chips='<div class="ind-chips">'
    +'<span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 '+bullCount+' Long</span>'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">🔴 '+bearCount+' Short</span></div>';
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'أكبر 20% متداولين على Binance — ماذا يفعلون الآن':'Top 20% Binance traders — what they\'re doing now')+'</div>';
  var verdict=bullCount>bearCount?(lang==='ar'?'الكبار Long':'Pros: Long'):bearCount>bullCount?(lang==='ar'?'الكبار Short':'Pros: Short'):(lang==='ar'?'منقسمين':'Split');
  var vCol=bullCount>bearCount?'var(--up)':bearCount>bullCount?'var(--dn)':'var(--warn)';
  return indCardWrap('🏆','rgba(255,215,0,.06)','rgba(255,215,0,.12)',lang==='ar'?'كبار المتداولين':'Top Traders L/S',lang==='ar'?'أكبر 20% على Binance — '+coins.length+' عملة':'Top 20% Binance — '+coins.length+' coins',verdict,vCol,chips+rows+guide);
}

/* ═══ NEW CARD: Real CVD from aggTrades (Binance Free) ═══ */
function buildRealCVDCard(){
  var coins=BN_ADV_COINS.filter(function(s){return aggCVD[s]});
  if(!coins.length)return'';
  var rows='';var bullCount=0,bearCount=0;
  coins.slice(0,8).forEach(function(s){
    var c=aggCVD[s];
    var cls=c.trend==='BUYING'?'up':c.trend==='SELLING'?'dn':'warn';
    if(c.trend==='BUYING')bullCount++;if(c.trend==='SELLING')bearCount++;
    var deltaFmt=c.delta>=0?'+$'+fmt(c.delta):'-$'+fmt(Math.abs(c.delta));
    /* Buy/Sell pressure bar */
    var total=c.buyVol+c.sellVol;var buyPct=total>0?Math.round(c.buyVol/total*100):50;
    var bar='<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;flex:1;min-width:50px">'
      +'<div style="width:'+buyPct+'%;background:var(--up)"></div>'
      +'<div style="width:'+(100-buyPct)+'%;background:var(--dn)"></div></div>';
    var label=c.trend==='BUYING'?(lang==='ar'?'شراء مخفي':'Hidden buy'):c.trend==='SELLING'?(lang==='ar'?'بيع مخفي':'Hidden sell'):(lang==='ar'?'متوازن':'Balanced');
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +bar
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:55px;font-family:var(--fm);direction:ltr">'+deltaFmt+'</span>'
      +'<span style="font-size:8px;color:var(--'+cls+')">'+label+'</span></div>';
  });
  var chips='<div class="ind-chips">'
    +'<span class="ind-chip" style="background:var(--ud);color:var(--up)">🟢 '+bullCount+' '+(lang==='ar'?'شراء':'Buy')+'</span>'
    +'<span class="ind-chip" style="background:var(--dd);color:var(--dn)">🔴 '+bearCount+' '+(lang==='ar'?'بيع':'Sell')+'</span></div>';
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'CVD حقيقي من آخر 500 صفقة Futures — يكشف الشراء/البيع المخفي':'Real CVD from last 500 Futures trades — reveals hidden buying/selling')+'</div>';
  var verdict=bullCount>bearCount?(lang==='ar'?'شراء مسيطر':'Buying dominant'):bearCount>bullCount?(lang==='ar'?'بيع مسيطر':'Selling dominant'):(lang==='ar'?'متوازن':'Balanced');
  var vCol=bullCount>bearCount?'var(--up)':bearCount>bullCount?'var(--dn)':'var(--warn)';
  return indCardWrap('🔬','rgba(0,212,255,.06)','rgba(0,212,255,.12)',lang==='ar'?'CVD حقيقي (Futures)':'Real CVD (Futures)',lang==='ar'?'آخر 500 صفقة — '+coins.length+' عملة':'Last 500 trades — '+coins.length+' coins',verdict,vCol,chips+rows+guide);
}

/* ═══ NEW CARD: Spread Analysis (Binance Free) ═══ */
function buildSpreadCard(){
  var coins=Object.keys(bookTickers).filter(function(s){return WL.includes(s)}).sort(function(a,b){return bookTickers[b].spread-bookTickers[a].spread});
  if(!coins.length)return'';
  var rows='';var wideCount=0;
  coins.slice(0,12).forEach(function(s){
    var bk=bookTickers[s];
    var cls=bk.spread>0.05?'dn':bk.spread<0.01?'up':'warn';
    if(bk.spread>0.05)wideCount++;
    var pressure=bk.bidQty>bk.askQty*1.3?(lang==='ar'?'🟢 ضغط شراء':'🟢 Buy pressure'):bk.askQty>bk.bidQty*1.3?(lang==='ar'?'🔴 ضغط بيع':'🔴 Sell pressure'):'';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span>'
      +'<span style="font-size:9px;color:var(--'+cls+');min-width:52px;font-family:var(--fm);direction:ltr">'+bk.spread.toFixed(3)+'%</span>'
      +'<span style="font-size:8px;color:var(--t2);min-width:50px;font-family:var(--fm)">Bid:'+fmt(bk.bid*bk.bidQty)+'</span>'
      +(pressure?'<span style="font-size:8px">'+pressure+'</span>':'')+'</div>';
  });
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'Spread واسع = سيولة ضعيفة = حذر | ضيق = سيولة جيدة':'Wide spread = low liquidity = caution | Tight = good liquidity')+'</div>';
  return indCardWrap('📐','rgba(91,156,255,.06)','rgba(91,156,255,.12)','Bid/Ask Spread',lang==='ar'?'فرق السعر — سيولة السوق':'Price gap — Market liquidity',(wideCount>3?(lang==='ar'?'حذر':'Caution'):(lang==='ar'?'جيد':'Good')),wideCount>3?'var(--dn)':'var(--up)',rows+guide);
}


/* legacy stubs removed */

/* ═══════════════════════════════════════════════════ */
/* ═══ NEW: 7 Multi-Exchange Indicator Cards ═══ */
/* ═══════════════════════════════════════════════════ */

/* Card 16: Multi-Exchange OI (Coinalyze) */
function buildMultiOICard(){
  var coins=Object.keys(coinalyzeOI);if(!coins.length)return'';
  var totalOI=coins.reduce(function(s,c){return s+coinalyzeOI[c].value},0);
  var bnOI=Object.values(OI).reduce(function(s,v){return s+(typeof v==='number'?v:0)},0);
  var rows='';['BTC','ETH','SOL','BNB','XRP','DOGE'].forEach(function(s){
    var ca=coinalyzeOI[s],bn=OI[s];if(!ca)return;
    var bnV=typeof bn==='number'?bn:0;var pct=totalOI>0?(ca.value/totalOI*100):0;
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span><span style="font-size:9px;color:var(--neon);font-family:var(--fm)">'+fmtB(ca.value)+'</span><span style="font-size:8px;color:var(--t2);font-family:var(--fm)">'+pct.toFixed(1)+'%</span></div>';
  });
  var guide='<div class="ind-guide">📖 '+(lang==='ar'?'OI مجمّع من Binance+OKX+Bybit+dYdX+Bitfinex — الصورة الكاملة للسوق':'Aggregated OI from all exchanges — full market picture')+'</div>';
  return indCardWrap('🌐','rgba(0,212,255,.06)','rgba(0,212,255,.12)',lang==='ar'?'OI مجمّع — كل المنصات':'Multi-Exchange OI',lang==='ar'?coins.length+' عملة — 5+ منصات':coins.length+' coins — 5+ exchanges',fmtB(totalOI),'var(--neon)',rows+guide);
}

/* Card 17: Multi-Exchange FR + Predicted (Coinalyze) */
function buildMultiFRCard(){
  var coins=Object.keys(coinalyzeFR);if(!coins.length)return'';
  var rows='';['BTC','ETH','SOL','BNB','XRP','DOGE'].forEach(function(s){
    var cf=coinalyzeFR[s],pf=coinalyzePredFR[s];if(!cf)return;
    var pred=pf?pf.rate:0;var arrow=pred>cf.rate?'↗':'↘';
    var col=cf.rate>0.05?'var(--dn)':cf.rate<-0.01?'var(--up)':'var(--warn)';
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span><span style="font-size:9px;color:'+col+';font-family:var(--fm)">'+(cf.rate>=0?'+':'')+cf.rate.toFixed(4)+'%</span><span style="font-size:8px;color:var(--t2)">'+arrow+' '+(lang==='ar'?'متوقع':'Pred')+': '+(pred>=0?'+':'')+pred.toFixed(4)+'%</span></div>';
  });
  return indCardWrap('🔮','rgba(176,124,255,.06)','rgba(176,124,255,.12)',lang==='ar'?'FR مجمّع + متوقع':'Aggregated FR + Predicted',lang==='ar'?'من كل المنصات + التوقع القادم':'All exchanges + next prediction',coins.length+' '+( lang==='ar'?'عملة':'coins'),'var(--purple)',rows);
}

/* Card 18: Aggregated Liquidations (Coinalyze) */
function buildAggLiqCard(){
  var coins=Object.keys(coinalyzeLiq);if(!coins.length)return'';
  var totalLong=0,totalShort=0;
  var rows='';coins.forEach(function(s){
    var d=coinalyzeLiq[s];if(!d)return;totalLong+=d.longVol;totalShort+=d.shortVol;
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span><span style="font-size:9px;color:var(--up);font-family:var(--fm)">L:'+fmtB(d.longVol)+'</span><span style="font-size:9px;color:var(--dn);font-family:var(--fm)">S:'+fmtB(d.shortVol)+'</span></div>';
  });
  var dominant=totalLong>totalShort?(lang==='ar'?'Long أكثر':'More Longs'):(lang==='ar'?'Short أكثر':'More Shorts');
  return indCardWrap('💥','rgba(255,122,26,.06)','rgba(255,122,26,.12)',lang==='ar'?'تصفيات مجمّعة':'Aggregated Liquidations',lang==='ar'?'من كل المنصات — 24 ساعة':'All exchanges — 24h',dominant,totalLong>totalShort?'var(--up)':'var(--dn)',rows);
}

/* Card 19: DEX vs CEX (Hyperliquid) */
function buildDEXCard(){
  var hl=hyperliquidData;if(!hl.BTC)return'';
  var rows='';['BTC','ETH','SOL'].forEach(function(s){
    var dex=hl[s],cex=FR[s];if(!dex)return;
    var dexFR=dex.funding||0,cexFR=cex?cex.rate:0;
    var diff=Math.abs(dexFR-cexFR);var arb=diff>0.02;
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span><span style="font-size:8px;color:var(--warn);font-family:var(--fm)">CEX:'+(cexFR>=0?'+':'')+cexFR.toFixed(4)+'%</span><span style="font-size:8px;color:var(--neon);font-family:var(--fm)">DEX:'+(dexFR>=0?'+':'')+dexFR.toFixed(4)+'%</span>'+(arb?'<span style="font-size:7px;color:var(--up)">⚡ARB</span>':'')+'</div>';
  });
  var hlOI=hl.BTC?hl.BTC.oi*hl.BTC.oracle:0;
  return indCardWrap('🔬','rgba(0,255,136,.06)','rgba(0,255,136,.12)',lang==='ar'?'DEX vs CEX':'DEX vs CEX',lang==='ar'?'Hyperliquid (لامركزي) vs Binance':'Hyperliquid (DEX) vs Binance','OI:'+fmtB(hlOI),'var(--neon)',rows);
}

/* Card 20: Coinbase Premium (Institutional) */
function buildCBPremiumCard(){
  if(!cbPremium.time)return'';
  var pBTC=cbPremium.BTC_pct||0,pETH=cbPremium.ETH_pct||0;
  var sig=pBTC>0.2?(lang==='ar'?'🟢 مؤسسات تشتري':'🟢 Institutions buying'):pBTC<-0.2?(lang==='ar'?'🔴 مؤسسات تبيع':'🔴 Institutions selling'):(lang==='ar'?'⚪ طبيعي':'⚪ Neutral');
  var body='<div class="ind-row"><span class="ind-sym">BTC</span><span style="font-size:10px;font-weight:800;color:'+(pBTC>0?'var(--up)':'var(--dn)')+';font-family:var(--fm)">'+(pBTC>=0?'+':'')+pBTC.toFixed(3)+'%</span><span style="font-size:8px;color:var(--t2)">'+fP(cbPremium.BTC||0)+'</span></div>';
  body+='<div class="ind-row"><span class="ind-sym">ETH</span><span style="font-size:10px;color:'+(pETH>0?'var(--up)':'var(--dn)')+';font-family:var(--fm)">'+(pETH>=0?'+':'')+pETH.toFixed(3)+'%</span></div>';
  body+='<div class="ind-guide">📖 '+(lang==='ar'?'Premium إيجابي = أمريكا تدفع أكثر = مؤسسات تشتري — توقّع كل Rally مؤسسي من 2020':'Positive premium = US paying more = institutional buying — predicted every institutional rally since 2020')+'</div>';
  return indCardWrap('🏦','rgba(91,156,255,.06)','rgba(91,156,255,.12)',lang==='ar'?'Coinbase Premium':'Coinbase Premium',lang==='ar'?'مؤشر المؤسسات الأمريكية':'US Institutional Signal',sig,pBTC>0.2?'var(--up)':pBTC<-0.2?'var(--dn)':'var(--t2)',body);
}

/* Card 21: On-Chain BTC (Blockchain.info) */
function buildOnChainCard(){
  if(!btcOnChain.time)return'';
  var hr=btcOnChain.hashRate;var hrStr=hr>1e9?(hr/1e9).toFixed(0)+' EH/s':hr>1e6?(hr/1e6).toFixed(0)+' PH/s':hr>0?Math.round(hr)+' GH/s':'--';
  var body='<div class="ind-row"><span>⛏️ Hash Rate</span><span style="font-family:var(--fm);color:var(--up)">'+hrStr+'</span></div>';
  body+='<div class="ind-row"><span>🔒 Difficulty</span><span style="font-family:var(--fm)">'+((btcOnChain.difficulty||0)/1e12).toFixed(1)+'T</span></div>';
  body+='<div class="ind-row"><span>📨 '+(lang==='ar'?'معلّقة':'Pending')+'</span><span style="font-family:var(--fm)">'+(btcOnChain.unconfirmed||0).toLocaleString()+'</span></div>';
  body+='<div class="ind-row"><span>📊 TXs 24h</span><span style="font-family:var(--fm)">'+(btcOnChain.txs24h||0).toLocaleString()+'</span></div>';
  body+='<div class="ind-guide">📖 '+(lang==='ar'?'Hash Rate مرتفع = شبكة قوية = المعدّنون واثقون | ينخفض = ضغط':'High Hash Rate = strong network = miners confident | Drops = pressure')+'</div>';
  return indCardWrap('⛓️','rgba(247,147,26,.06)','rgba(247,147,26,.12)',lang==='ar'?'بلوكتشين BTC':'BTC Blockchain',lang==='ar'?'بيانات On-Chain حقيقية':'Real On-Chain Data',hrStr,'var(--up)',body);
}

/* Card 22: Bitfinex Margin (Longs vs Shorts) */
function buildBitfinexCard(){
  var coins=Object.keys(bitfinexMargin);if(!coins.length)return'';
  var rows='';coins.forEach(function(s){
    var d=bitfinexMargin[s];if(!d)return;
    rows+='<div class="ind-row"><span class="ind-sym">'+s+'</span><span style="font-size:9px;color:var(--up);font-family:var(--fm)">L:'+d.longPct.toFixed(0)+'%</span><span style="font-size:9px;color:var(--dn);font-family:var(--fm)">S:'+d.shortPct.toFixed(0)+'%</span><span style="font-size:8px;color:var(--t2);font-family:var(--fm)">'+(d.ratio).toFixed(2)+'x</span></div>';
  });
  var btcM=bitfinexMargin.BTC;var sig=btcM&&btcM.longPct>65?(lang==='ar'?'Long قوي':'Strong Long'):btcM&&btcM.shortPct>55?(lang==='ar'?'Short قوي':'Strong Short'):(lang==='ar'?'متوازن':'Balanced');
  rows+='<div class="ind-guide">📖 '+(lang==='ar'?'Bitfinex Margin = مؤشر مبكّر — Longs ترتفع قبل السعر تاريخياً':'Bitfinex Margin = early indicator — Longs rise before price historically')+'</div>';
  return indCardWrap('📊','rgba(176,124,255,.06)','rgba(176,124,255,.12)',lang==='ar'?'Bitfinex Margin':'Bitfinex Margin',lang==='ar'?'مراكز Margin — مؤشر مبكّر':'Margin positions — Early signal',sig,btcM&&btcM.longPct>60?'var(--up)':'var(--warn)',rows);
}

/* COIN DETAIL */
async function openCoin(sym){curCoin=sym;curTF='1h';document.getElementById('sRes').classList.remove('show');document.getElementById('sInp').value='';var d=T[sym]||{p:0,c:0,v:0,h:0,l:0};document.getElementById('cmT').textContent=sym+'/USDT';document.getElementById('cmP').textContent=fP(d.p);document.getElementById('cmC').style.color=d.c>=0?'var(--up)':'var(--dn)';document.getElementById('cmC').textContent=(d.c>=0?'+':'')+d.c.toFixed(2)+'%';document.getElementById('cmSts').innerHTML='<div class="st"><div class="st-l">VOL</div><div class="st-v" style="color:var(--neon)">'+fmt(d.v)+'</div></div><div class="st"><div class="st-l">HIGH</div><div class="st-v" style="color:var(--up)">'+fP(d.h)+'</div></div><div class="st"><div class="st-l">LOW</div><div class="st-v" style="color:var(--dn)">'+fP(d.l)+'</div></div>';var ex='';var fr=FR[sym];if(fr)ex+='<div class="fr-row" style="margin-top:6px"><span>📊 FR</span><span class="fr-val" style="color:'+(fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--warn)')+'">'+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%</span></div>';if(OI[sym])ex+='<div class="fr-row"><span>📈 OI</span><span class="fr-val" style="color:var(--neon)">'+fmt(OI[sym])+'</span></div>';if(LS[sym])ex+='<div class="fr-row"><span>⚖️ L/S</span><span class="fr-val">'+LS[sym].long.toFixed(0)+'%/'+LS[sym].short.toFixed(0)+'%</span></div>';if(d.by)ex+='<div class="fr-row"><span>Bybit</span><span class="fr-val">'+fP(d.by)+'</span></div>';if(CBP[sym])ex+='<div class="fr-row"><span>Coinbase</span><span class="fr-val">'+fP(CBP[sym])+'</span></div>';if(topTradersLS[sym]&&topTradersLS[sym].accounts&&topTradersLS[sym].accounts.length){var tla=topTradersLS[sym].accounts[topTradersLS[sym].accounts.length-1];ex+='<div class="fr-row"><span>🏆 Top L/S</span><span class="fr-val" style="color:'+(tla.long>0.55?'var(--up)':tla.long<0.45?'var(--dn)':'var(--warn)')+'">'+(tla.long*100).toFixed(0)+'%/'+(tla.short*100).toFixed(0)+'%</span></div>'}if(aggCVD[sym]){var cv=aggCVD[sym];ex+='<div class="fr-row"><span>🔬 CVD</span><span class="fr-val" style="color:'+(cv.trend==='BUYING'?'var(--up)':cv.trend==='SELLING'?'var(--dn)':'var(--warn)')+'">'+(cv.trend==='BUYING'?(lang==='ar'?'شراء':'Buy'):cv.trend==='SELLING'?(lang==='ar'?'بيع':'Sell'):(lang==='ar'?'متوازن':'Balanced'))+'</span></div>'}if(bookTickers[sym]){ex+='<div class="fr-row"><span>📐 Spread</span><span class="fr-val" style="color:'+(bookTickers[sym].spread>0.05?'var(--dn)':'var(--t2)')+'">'+bookTickers[sym].spread.toFixed(3)+'%</span></div>'}if(frHistory[sym]&&frHistory[sym].length>=4){ex+='<div class="fr-row" style="justify-content:space-between"><span>📉 FR Hist</span>'+frHistBars(sym)+'</div>'}/* NEW: Multi-Exchange Coin Detail */if(coinalyzeOI[sym])ex+='<div class="fr-row"><span>🌐 OI Agg</span><span class="fr-val" style="color:var(--neon)">'+fmtB(coinalyzeOI[sym].value)+'</span></div>';if(coinalyzeFR[sym])ex+='<div class="fr-row"><span>🌐 FR Agg</span><span class="fr-val" style="color:'+(coinalyzeFR[sym].rate>0.03?'var(--dn)':coinalyzeFR[sym].rate<-0.01?'var(--up)':'var(--warn)')+'">'+(coinalyzeFR[sym].rate>=0?'+':'')+coinalyzeFR[sym].rate.toFixed(4)+'%</span></div>';if(hyperliquidData[sym])ex+='<div class="fr-row"><span>🔬 HL FR</span><span class="fr-val" style="color:var(--neon)">'+(hyperliquidData[sym].funding>=0?'+':'')+hyperliquidData[sym].funding.toFixed(4)+'%</span></div>';if(okxFR[sym])ex+='<div class="fr-row"><span>📊 OKX FR</span><span class="fr-val">'+(okxFR[sym].rate>=0?'+':'')+okxFR[sym].rate.toFixed(4)+'%</span></div>';if(cbPremium.time&&sym==='BTC')ex+='<div class="fr-row"><span>🏦 CB Prem</span><span class="fr-val" style="color:'+(cbPremium.BTC_pct>0?'var(--up)':'var(--dn)')+'">'+(cbPremium.BTC_pct>=0?'+':'')+(cbPremium.BTC_pct||0).toFixed(3)+'%</span></div>';if(bitfinexMargin[sym])ex+='<div class="fr-row"><span>📊 BFX L/S</span><span class="fr-val">'+bitfinexMargin[sym].longPct.toFixed(0)+'%/'+bitfinexMargin[sym].shortPct.toFixed(0)+'%</span></div>';document.getElementById('cmExtra').innerHTML=ex;openMo('coinMo');document.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act');if(b.dataset.t2==='1h')b.classList.add('act')});drawChart(sym,'1h')}
function cTF(tf,btn){curTF=tf;document.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');drawChart(curCoin,tf)}
function tgI(ind,btn){inds[ind]=inds[ind]?0:1;btn.classList.toggle('act');drawChart(curCoin,curTF)}
var chartData=null,chartCtx=null,chartW=0,crosshair={active:false,x:0,y:0};
var chartOffset=0,visibleCandles=80,chartCv=null,lastPinchDist=0,touchStartX=0,isDragging=false;
function getChartH(){return Math.max(340,Math.min(500,window.innerHeight*0.5))}
function px(v){return Math.round(v)+0.5}
async function drawChart(sym,tf){
  var cv=document.getElementById('chCv');if(!cv)return;chartCv=cv;var ctx=cv.getContext('2d');chartCtx=ctx;
  var dpr=window.devicePixelRatio||1;var H=getChartH();
  cv.style.width='100%';cv.style.height=H+'px';
  cv.width=cv.clientWidth*dpr;cv.height=H*dpr;ctx.scale(dpr,dpr);chartW=cv.clientWidth;
  ctx.clearRect(0,0,chartW,H);
  var kl=await fj(BN+'/klines?symbol='+sym+'USDT&interval='+tf+'&limit=200');
  if(!kl||!kl.length){ctx.fillStyle='#4a5568';ctx.font='11px Syne';ctx.textAlign='center';ctx.fillText(t('no_data'),chartW/2,H/2);return}
  chartData=kl.map(function(k){return{t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}});
  chartOffset=Math.max(0,chartData.length-visibleCandles);
  drawChartFrame();
  /* Touch: 1 finger = crosshair or scroll, 2 fingers = zoom */
  var touchMode=null;
  cv.ontouchstart=function(e){e.preventDefault();
    if(e.touches.length===2){touchMode='zoom';var dx=e.touches[0].clientX-e.touches[1].clientX;var dy=e.touches[0].clientY-e.touches[1].clientY;lastPinchDist=Math.sqrt(dx*dx+dy*dy);return}
    touchMode='tap';isDragging=false;touchStartX=e.touches[0].clientX;var r=cv.getBoundingClientRect();crosshair.x=e.touches[0].clientX-r.left;crosshair.y=e.touches[0].clientY-r.top};
  cv.ontouchmove=function(e){e.preventDefault();
    if(e.touches.length===2&&touchMode==='zoom'){var dx=e.touches[0].clientX-e.touches[1].clientX;var dy=e.touches[0].clientY-e.touches[1].clientY;var dist=Math.sqrt(dx*dx+dy*dy);if(lastPinchDist>0){var d2=dist-lastPinchDist;if(d2>5)visibleCandles=Math.max(20,visibleCandles-3);if(d2<-5)visibleCandles=Math.min(150,visibleCandles+3);chartOffset=Math.max(0,Math.min(chartData.length-visibleCandles,chartOffset));drawChartFrame()}lastPinchDist=dist;return}
    var dx2=Math.abs(e.touches[0].clientX-touchStartX);
    if(dx2>8){touchMode='scroll';isDragging=true;crosshair.active=false;var cw2=(chartW-56)/visibleCandles;var cm=Math.round((e.touches[0].clientX-touchStartX)/cw2);if(cm!==0){chartOffset=Math.max(0,Math.min(chartData.length-visibleCandles,chartOffset-cm));touchStartX=e.touches[0].clientX;drawChartFrame()}}
    else if(touchMode==='tap'){crosshair.active=true;var r=cv.getBoundingClientRect();crosshair.x=e.touches[0].clientX-r.left;crosshair.y=e.touches[0].clientY-r.top;requestAnimationFrame(drawChartFrame)}};
  cv.ontouchend=function(){if(touchMode==='tap'&&!isDragging){crosshair.active=true;drawChartFrame()}else{crosshair.active=false;drawChartFrame()}touchMode=null;lastPinchDist=0};
  cv.onmousemove=function(e){var r=cv.getBoundingClientRect();crosshair.active=true;crosshair.x=e.clientX-r.left;crosshair.y=e.clientY-r.top;requestAnimationFrame(drawChartFrame)};
  cv.onmouseleave=function(){crosshair.active=false;drawChartFrame()};
  renderPerfStats(sym)}

function drawChartFrame(){
  if(!chartData||!chartCtx)return;var allData=chartData;var data=allData.slice(chartOffset,chartOffset+visibleCandles);
  if(!data.length)return;var ctx=chartCtx,W=chartW,H=getChartH(),tf=curTF;
  ctx.clearRect(0,0,W,H);
  var panels=(inds.rsi?1:0)+(inds.macd?1:0);var mH=panels?H*(1-panels*0.15)-16:H-36;
  var priceW=52;var rightPad=3;var cw=(W-priceW-4)/(data.length+rightPad);var ch=mH-32;
  var maxP=Math.max.apply(null,data.map(function(d){return d.h}));var minP=Math.min.apply(null,data.map(function(d){return d.l}));
  var range=maxP-minP;if(range===0)range=maxP*0.01;maxP+=range*0.03;minP-=range*0.03;range=maxP-minP;
  var isDark=document.body.dataset.theme!=='light';
  var upC=isDark?'#00ff88':'#059669',dnC=isDark?'#ff3860':'#dc2626';
  var upCa=isDark?'rgba(0,255,136,':'rgba(5,150,105,',dnCa=isDark?'rgba(255,56,96,':'rgba(220,38,38,';
  var bgFill=isDark?'#060b14':'#f7f9fc';
  var yS=function(p){return 14+ch-((p-minP)/range)*ch};
  /* GRID — cleaner */
  ctx.textAlign='right';for(var i=0;i<=5;i++){var y=14+ch/5*i;var price=maxP-range/5*i;ctx.strokeStyle=isDark?'rgba(56,72,96,.12)':'rgba(56,72,96,.08)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W-priceW,y);ctx.stroke();ctx.fillStyle='#8a9bb5';ctx.font='9px Geist Mono';ctx.fillText(fP(price),W-2,y+3)}
  /* TIME AXIS */
  var timeY=mH+2;ctx.fillStyle='#4a5568';ctx.font='7px Geist Mono';ctx.textAlign='center';
  var step=tf==='1w'?4:tf==='1d'?7:tf==='4h'?6:tf==='30m'?8:tf==='15m'?10:tf==='5m'?12:8;
  for(var i=0;i<data.length;i+=step){var dt=new Date(data[i].t);var label=tf==='1d'||tf==='1w'?(dt.getMonth()+1)+'/'+dt.getDate():dt.getHours()+':'+('0'+dt.getMinutes()).slice(-2);var tx=2+i*cw+cw/2;ctx.fillText(label,tx,timeY+10)}
  /* VOLUME */
  if(inds.vol){var mV=Math.max.apply(null,data.map(function(d){return d.v}));data.forEach(function(d,i){var up=d.c>=d.o;var vH=Math.max(2,d.v/mV*28);var x=2+i*cw;var grd=ctx.createLinearGradient(0,mH-vH,0,mH);grd.addColorStop(0,up?upCa+'.12)':dnCa+'.12)');grd.addColorStop(1,up?upCa+'.01)':dnCa+'.01)');ctx.fillStyle=grd;ctx.fillRect(x+1,mH-vH,cw-2,vH)})}
  /* BOLLINGER BANDS */
  if(inds.bb&&data.length>=20){var bbU=[],bbL=[],bbM=[];for(var i=19;i<data.length;i++){var sl=data.slice(i-19,i+1);var avg=sl.reduce(function(s,d){return s+d.c},0)/20;var vr=sl.reduce(function(s,d){return s+Math.pow(d.c-avg,2)},0)/20;var sd=Math.sqrt(vr);var x=2+i*cw+cw/2;bbU.push({x:x,y:yS(avg+2*sd)});bbL.push({x:x,y:yS(avg-2*sd)});bbM.push({x:x,y:yS(avg)})}
    ctx.beginPath();ctx.fillStyle='rgba(91,156,255,.06)';bbU.forEach(function(p,i){i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)});for(var i=bbL.length-1;i>=0;i--)ctx.lineTo(bbL[i].x,bbL[i].y);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.strokeStyle='rgba(91,156,255,.35)';ctx.lineWidth=0.8;bbU.forEach(function(p,i){i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)});ctx.stroke();
    ctx.beginPath();bbL.forEach(function(p,i){i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)});ctx.stroke();
    ctx.beginPath();ctx.strokeStyle='rgba(91,156,255,.2)';ctx.setLineDash([2,2]);bbM.forEach(function(p,i){i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y)});ctx.stroke();ctx.setLineDash([])}
  /* SMA 20 */
  if(inds.sma&&data.length>=21){ctx.beginPath();ctx.strokeStyle='rgba(91,156,255,.6)';ctx.lineWidth=1.5;for(var i=20;i<data.length;i++){var avg=data.slice(i-20,i+1).reduce(function(s,d){return s+d.c},0)/21;var x=2+i*cw+cw/2;if(i===20)ctx.moveTo(x,yS(avg));else ctx.lineTo(x,yS(avg))};ctx.stroke()}
  /* EMA 50 + 200 */
  if(inds.ema){var cls=data.map(function(d){return d.c});
    function calcEmaArr(vals,per){if(vals.length<per)return[];var k=2/(per+1);var r=[];var s=vals.slice(0,per).reduce(function(a,b){return a+b},0)/per;r[per-1]=s;for(var i=per;i<vals.length;i++)r[i]=vals[i]*k+r[i-1]*(1-k);return r}
    var e50=calcEmaArr(cls,Math.min(50,data.length-1));
    if(e50.length){ctx.beginPath();ctx.strokeStyle='rgba(255,193,7,.7)';ctx.lineWidth=1.2;e50.forEach(function(v,i){if(v===undefined)return;var x=2+i*cw+cw/2;if(!e50[i-1])ctx.moveTo(x,yS(v));else ctx.lineTo(x,yS(v))});ctx.stroke();ctx.fillStyle='rgba(255,193,7,.5)';ctx.font='7px Geist Mono';ctx.textAlign='left';var last50=e50[e50.length-1];if(last50)ctx.fillText('EMA50',4,yS(last50)-4);ctx.textAlign='right'}}
  /* S/R */
  if(inds.sr){var lows=data.map(function(d){return d.l}),highs=data.map(function(d){return d.h});for(var i=2;i<data.length-2;i++){if(lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2]){ctx.strokeStyle=upCa+'.2)';ctx.setLineDash([3,3]);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,yS(lows[i]));ctx.lineTo(W-priceW,yS(lows[i]));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=upCa+'.3)';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText('S',4,yS(lows[i])-3);ctx.textAlign='right'}if(highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2]){ctx.strokeStyle=dnCa+'.2)';ctx.setLineDash([3,3]);ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,yS(highs[i]));ctx.lineTo(W-priceW,yS(highs[i]));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=dnCa+'.3)';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText('R',4,yS(highs[i])-3);ctx.textAlign='right'}}}
  /* TRADE SIGNALS */
  var trades=activeTrades.filter(function(t){return t.sym===curCoin});
  trades.forEach(function(tr){var eY=yS(tr.entry);ctx.strokeStyle='rgba(0,200,255,.4)';ctx.lineWidth=.8;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,eY);ctx.lineTo(W-priceW,eY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='rgba(0,200,255,.8)';ctx.font='bold 7px Geist Mono';ctx.textAlign='left';ctx.fillText('▲ Entry '+fP(tr.entry),4,eY-3);
    if(tr.target1){var t1Y=yS(tr.target1);ctx.strokeStyle=upCa+'.3)';ctx.setLineDash([3,3]);ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(0,t1Y);ctx.lineTo(W-priceW,t1Y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=upCa+'.6)';ctx.fillText('🎯T1 '+fP(tr.target1),4,t1Y-3)}
    if(tr.stop){var sY=yS(tr.stop);ctx.strokeStyle=dnCa+'.3)';ctx.setLineDash([3,3]);ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(0,sY);ctx.lineTo(W-priceW,sY);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=dnCa+'.6)';ctx.fillText('🛑Stop '+fP(tr.stop),4,sY+8)}ctx.textAlign='right'});
  /* CANDLES — HD rendering: filled green + thick wicks */
  var bw=Math.max(5,cw*0.75);var wickW=Math.max(1.8,Math.min(3,bw*0.25));
  var upFill=isDark?'#00b368':'#059669'; /* Dark solid green fill */
  var upBorder=isDark?'#00ff88':'#10b981'; /* Bright green border */
  data.forEach(function(d,i){var x=2+i*cw+cw/2,up=d.c>=d.o;var col=up?upC:dnC;var top=yS(Math.max(d.o,d.c)),bot=yS(Math.min(d.o,d.c));var bodyH=bot-top;var isDoji=Math.abs(d.c-d.o)/Math.max(d.h-d.l,0.0001)<0.1;
    /* Wick */
    ctx.strokeStyle=col;ctx.lineWidth=wickW;ctx.beginPath();ctx.moveTo(x,yS(d.h));ctx.lineTo(x,yS(d.l));ctx.stroke();
    /* Body */
    if(isDoji){var dy=yS((d.o+d.c)/2);ctx.strokeStyle=col;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-bw/2,dy);ctx.lineTo(x+bw/2,dy);ctx.stroke()}
    else if(up){ctx.fillStyle=upFill;ctx.fillRect(x-bw/2,top,bw,Math.max(3,bodyH));ctx.strokeStyle=upBorder;ctx.lineWidth=1;ctx.strokeRect(x-bw/2,top,bw,Math.max(3,bodyH))}
    else{ctx.fillStyle=col;ctx.fillRect(x-bw/2,top,bw,Math.max(3,bodyH))}
    /* Last candle glow */
    if(i===data.length-1){ctx.shadowColor=col;ctx.shadowBlur=8;ctx.fillStyle=up?upFill:col;ctx.fillRect(x-bw/2-1,top-1,bw+2,Math.max(5,bodyH+2));ctx.shadowBlur=0}});
  /* PATTERNS */
  if(inds.pat){for(var i=2;i<data.length;i++){var c=data[i],p=data[i-1],pp=data[i-2];var body=Math.abs(c.c-c.o);var rng=c.h-c.l;var lw=Math.min(c.c,c.o)-c.l;var uw=c.h-Math.max(c.c,c.o);var isUp=c.c>c.o;var pB=Math.abs(p.c-p.o);var x=2+i*cw+cw/2;
    if(lw>=body*2&&uw<body*.5&&rng>0&&p.c<pp.c){ctx.font='9px serif';ctx.textAlign='center';ctx.fillText('🔨',x,yS(c.l)+14)}
    if(uw>=body*2&&lw<body*.5&&rng>0&&p.c>pp.c){ctx.fillText('🌠',x,yS(c.h)-10)}
    if(isUp&&p.c<p.o&&c.o<=p.c&&c.c>=p.o&&body>pB*1.2){ctx.fillText('🟢',x,yS(c.l)+14)}
    if(!isUp&&p.c>p.o&&c.o>=p.c&&c.c<=p.o&&body>pB*1.2){ctx.fillText('🔴',x,yS(c.h)-10)}}}
  /* CURRENT PRICE LINE */
  var lastP=data[data.length-1].c;var lastUp=data[data.length-1].c>=data[data.length-1].o;var cpY=yS(lastP);
  ctx.strokeStyle=lastUp?upCa+'.5)':dnCa+'.5)';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(0,cpY);ctx.lineTo(W-priceW,cpY);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=lastUp?upC:dnC;var lbW=54,lbH=17;ctx.fillRect(W-priceW-1,cpY-lbH/2,lbW,lbH);ctx.fillStyle='#000';ctx.font='bold 9px Geist Mono';ctx.textAlign='center';ctx.fillText(fP(lastP),W-priceW+lbW/2-1,cpY+3.5);ctx.textAlign='right';
  /* OHLC */
  var last=data[data.length-1];ctx.fillStyle='#6e82a0';ctx.font='7px Geist Mono';ctx.textAlign='left';ctx.fillText('O:'+fP(last.o)+' H:'+fP(last.h)+' L:'+fP(last.l)+' C:'+fP(last.c),4,10);ctx.textAlign='right';
  /* RSI PANEL */
  if(inds.rsi&&data.length>=14){var rsiY=mH+20;var rsiH=panels>1?H*0.13:H*0.15;var closes=data.map(function(d){return d.c}),rsis=[];for(var i=14;i<closes.length;i++){var g=0,l=0;for(var j=i-13;j<=i;j++){var df=closes[j]-closes[j-1];if(df>0)g+=df;else l+=Math.abs(df)};rsis.push(100-100/(1+g/Math.max(l,.001)))};
    ctx.fillStyle='rgba(10,16,28,.4)';ctx.fillRect(0,rsiY-2,W-priceW,rsiH+4);ctx.strokeStyle=dnCa+'.12)';ctx.setLineDash([3,3]);ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(0,rsiY+rsiH*0.3);ctx.lineTo(W-priceW,rsiY+rsiH*0.3);ctx.stroke();ctx.strokeStyle=upCa+'.12)';ctx.beginPath();ctx.moveTo(0,rsiY+rsiH*0.7);ctx.lineTo(W-priceW,rsiY+rsiH*0.7);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.strokeStyle='rgba(176,124,255,.8)';ctx.lineWidth=1.5;var off=data.length-rsis.length;rsis.forEach(function(v,i){var x=2+(i+off)*cw+cw/2,y=rsiY+rsiH-(v/100)*rsiH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.stroke();
    var lastRSI=rsis[rsis.length-1];ctx.fillStyle=lastRSI>70?dnC:lastRSI<30?upC:'#b07cff';ctx.font='bold 8px Geist Mono';ctx.textAlign='right';ctx.fillText('RSI '+lastRSI.toFixed(0),W-4,rsiY+10)}
  /* MACD PANEL */
  if(inds.macd&&data.length>=26){var macdY=inds.rsi?mH+20+(H*0.15)+4:mH+20;var macdH=H*0.13;
    var cls=data.map(function(d){return d.c});function emaC(v,p){var k=2/(p+1);var r=[v[0]];for(var i=1;i<v.length;i++)r.push(v[i]*k+r[i-1]*(1-k));return r}
    var e12=emaC(cls,12);var e26=emaC(cls,26);var ml=e12.map(function(v,i){return v-e26[i]});var si=emaC(ml.slice(25),9);var sIdx=33;
    var maxV=0;for(var i=sIdx;i<ml.length;i++){var h=ml[i]-(si[i-25]||0);if(Math.abs(h)>maxV)maxV=Math.abs(h);if(Math.abs(ml[i])>maxV)maxV=Math.abs(ml[i])}
    ctx.fillStyle='rgba(10,16,28,.4)';ctx.fillRect(0,macdY,W-priceW,macdH);var zY=macdY+macdH/2;
    ctx.strokeStyle='rgba(130,150,180,.15)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(0,zY);ctx.lineTo(W-priceW,zY);ctx.stroke();
    for(var i=sIdx;i<ml.length;i++){var hv=ml[i]-(si[i-25]||0);var x=2+i*cw;var bH=maxV>0?(Math.abs(hv)/maxV)*(macdH/2-2):0;ctx.fillStyle=hv>=0?upCa+'.3)':dnCa+'.3)';ctx.fillRect(x+1,hv>=0?zY-bH:zY,Math.max(1,cw-2),bH)}
    ctx.beginPath();ctx.strokeStyle='rgba(91,156,255,.8)';ctx.lineWidth=1;for(var i=sIdx;i<ml.length;i++){var x=2+i*cw+cw/2;var y=zY-(maxV>0?ml[i]/maxV:0)*(macdH/2-2);if(i===sIdx)ctx.moveTo(x,y);else ctx.lineTo(x,y)};ctx.stroke();
    ctx.beginPath();ctx.strokeStyle='rgba(255,152,0,.8)';ctx.lineWidth=1;for(var i=0;i<si.length;i++){var x=2+(i+25)*cw+cw/2;var y=zY-(maxV>0?si[i]/maxV:0)*(macdH/2-2);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)};ctx.stroke();
    ctx.fillStyle='rgba(91,156,255,.6)';ctx.font='bold 7px Geist Mono';ctx.textAlign='right';ctx.fillText('MACD',W-4,macdY+10)}
  /* CROSSHAIR */
  if(crosshair.active){var idx=Math.floor((crosshair.x-2)/cw);idx=Math.max(0,Math.min(data.length-1,idx));var cd=data[idx];if(cd){var cx=2+idx*cw+cw/2;
    ctx.strokeStyle='rgba(130,150,180,.3)';ctx.lineWidth=.5;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(cx,14);ctx.lineTo(cx,mH);ctx.stroke();ctx.beginPath();ctx.moveTo(0,crosshair.y);ctx.lineTo(W-priceW,crosshair.y);ctx.stroke();ctx.setLineDash([]);
    var pAtY=maxP-(crosshair.y-14)/ch*range;ctx.fillStyle='#3d5a80';ctx.fillRect(W-priceW,crosshair.y-8,priceW,16);ctx.fillStyle='#fff';ctx.font='bold 8px Geist Mono';ctx.textAlign='center';ctx.fillText(fP(pAtY),W-priceW/2,crosshair.y+3);
    var dt=new Date(cd.t);var tL=tf==='1d'||tf==='1w'?(dt.getMonth()+1)+'/'+dt.getDate():dt.getHours()+':'+('0'+dt.getMinutes()).slice(-2);ctx.fillStyle='#3d5a80';ctx.fillRect(cx-20,mH+2,40,14);ctx.fillStyle='#fff';ctx.font='7px Geist Mono';ctx.fillText(tL,cx,mH+12);
    var cUp=cd.c>=cd.o;var cChg=((cd.c-cd.o)/cd.o*100).toFixed(2);ctx.fillStyle='rgba(10,16,28,.85)';ctx.fillRect(2,0,220,24);ctx.font='8px Geist Mono';ctx.textAlign='left';ctx.fillStyle=cUp?upC:dnC;ctx.fillText('O:'+fP(cd.o)+' H:'+fP(cd.h)+' L:'+fP(cd.l)+' C:'+fP(cd.c)+' '+(cChg>=0?'+':'')+cChg+'%',4,14);ctx.textAlign='right'}}}

/* PERFORMANCE STATS — 24H/7D/30D/1Y below chart */
async function renderPerfStats(sym){var el=document.getElementById('perfStats');if(!el)return;
  var ivs=[{l:'24H',tf:'1h',lim:24},{l:'7D',tf:'4h',lim:42},{l:'30D',tf:'1d',lim:30},{l:'1Y',tf:'1w',lim:52}];
  var h='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px">';
  for(var i=0;i<ivs.length;i++){try{var kl=await fj(BN+'/klines?symbol='+sym+'USDT&interval='+ivs[i].tf+'&limit='+ivs[i].lim);
    if(kl&&kl.length>=2){var op=+kl[0][1];var cl=+kl[kl.length-1][4];var chg=((cl-op)/op*100);var hi=Math.max.apply(null,kl.map(function(k){return+k[2]}));var lo=Math.min.apply(null,kl.map(function(k){return+k[3]}));
      var col=chg>=0?'var(--up)':'var(--dn)';
      h+='<div style="text-align:center;padding:6px;background:var(--bg2);border-radius:8px"><div style="font-size:9px;color:var(--t3);font-family:var(--fm);font-weight:700">'+ivs[i].l+'</div><div style="font-size:13px;font-family:var(--fm);font-weight:800;color:'+col+'">'+(chg>=0?'+':'')+chg.toFixed(1)+'%</div><div style="display:flex;justify-content:space-between;margin-top:4px;font-family:var(--fm)"><span style="color:var(--dn);font-size:7px">L:'+fP(lo)+'</span><span style="color:var(--up);font-size:7px">H:'+fP(hi)+'</span></div></div>'}}catch(e){}}
  h+='</div>';el.innerHTML=h}

/* LIQUIDITY + ORDER BOOK */
async function loadLiq(){if(!Object.keys(T).length)await loadTk();document.getElementById('liqL').innerHTML=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v}).slice(0,12).map(function(e,i){return coinRow(e[0],e[1],i+1)}).join('');var h='';var syms=['BTC','ETH','SOL','BNB','XRP'];var proms=syms.map(function(s){return fj(BN+'/depth?symbol='+s+'USDT&limit=10')});var obs=await Promise.all(proms);syms.forEach(function(s,si){var ob=obs[si];if(!ob)return;var bids=ob.bids.map(function(b){return+b[0]*+b[1]}),asks=ob.asks.map(function(a){return+a[0]*+a[1]});var bT=bids.reduce(function(a,b){return a+b},0),aT=asks.reduce(function(a,b){return a+b},0);var r=aT>0?bT/aT:1;var mx=Math.max.apply(null,bids.concat(asks));h+='<div class="cd" style="padding:8px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-family:var(--fd)">'+s+'</span><span style="font-size:9px;font-family:var(--fm);color:var(--'+(r>1.3?'up':r<.7?'dn':'warn')+')">'+(r>1.3?'BUY':r<.7?'SELL':'NEUTRAL')+' '+r.toFixed(2)+'x</span></div><div class="ob-v">'+bids.reverse().map(function(v){return'<div class="ob-b bid" style="height:'+Math.max(3,v/mx*100)+'%"></div>'}).join('')+'<div style="width:1px;background:var(--t3);height:100%"></div>'+asks.map(function(v){return'<div class="ob-b ask" style="height:'+Math.max(3,v/mx*100)+'%"></div>'}).join('')+'</div></div>'});document.getElementById('obS').innerHTML=h}
/* GEM FINDER — small caps with unusual activity */
async function loadGems(){
  if(!Object.keys(T).length)await loadTk();
  var gemLEl=document.getElementById('gemL');if(!gemLEl)return;
  gemLEl.innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';
  /* Step 1: Filter small-cap coins (price < $1, volume $500K-$50M) */
  var candidates=Object.entries(T).filter(function(e){var d=e[1];return d.p>0&&d.p<1&&d.v>500000&&d.v<5e7}).sort(function(a,b){return b[1].v-a[1].v}).slice(0,40);
  /* Step 2: Fetch klines for top candidates to analyze volume spike */
  var gemResults=[];
  var proms=candidates.slice(0,20).map(function(e){var s=e[0];
    return fj(BN+'/klines?symbol='+s+'USDT&interval=1h&limit=12').then(function(kl){
      if(!kl||kl.length<6)return;
      var vols=kl.map(function(k){return+k[5]});
      var closes=kl.map(function(k){return+k[4]});
      /* Average volume of older candles (exclude last 2) */
      var oldVols=vols.slice(0,-2);
      var avgVol=oldVols.reduce(function(a,b){return a+b},0)/Math.max(1,oldVols.length);
      /* Recent volume (last 2 candles) */
      var recentVol=(vols[vols.length-1]+vols[vols.length-2])/2;
      var volMultiple=avgVol>0?recentVol/avgVol:1;
      /* Find when volume spike started */
      var spikeStartIdx=vols.length-1;
      for(var i=vols.length-1;i>=1;i--){if(vols[i]>avgVol*1.5)spikeStartIdx=i;else break}
      var spikeStartTime=+kl[spikeStartIdx][0];
      /* Price at spike start vs now */
      var priceAtSpike=+kl[spikeStartIdx][1];
      var priceNow=closes[closes.length-1];
      var gainSinceSpike=priceAtSpike>0?((priceNow-priceAtSpike)/priceAtSpike)*100:0;
      /* Classify timing */
      var timing,timingCls,timingLabel;
      if(gainSinceSpike<3){timing='early';timingCls='str-strong';timingLabel=lang==='ar'?'🟢 صيد مبكر — ادخل!':'🟢 Early — Enter now!'}
      else if(gainSinceSpike<8){timing='still';timingCls='str-normal';timingLabel=lang==='ar'?'🟡 لسا فيه فرصة — حذر':'🟡 Still time — Caution'}
      else{timing='late';timingCls='str-weak';timingLabel=lang==='ar'?'🔴 متأخر — راقب فقط':'🔴 Late — Watch only'}
      /* Score: high volume spike + early = best */
      var gemScore=0;
      if(volMultiple>=3)gemScore+=40;else if(volMultiple>=2)gemScore+=30;else if(volMultiple>=1.5)gemScore+=15;
      if(timing==='early')gemScore+=30;else if(timing==='still')gemScore+=15;
      var _gd=T[s];if(!_gd)return;
      if(_gd.c>0&&_gd.c<3)gemScore+=20; /* small positive = accumulating */
      else if(_gd.c>=3&&_gd.c<8)gemScore+=10;
      if(gemScore>=25)gemResults.push({s:s,p:_gd.p,c:_gd.c,v:_gd.v,volX:volMultiple,gainSinceSpike:gainSinceSpike,spikeTime:spikeStartTime,timing:timing,timingCls:timingCls,timingLabel:timingLabel,score:gemScore,priceAtSpike:priceAtSpike})
    }).catch(function(){})});
  await Promise.all(proms);
  /* Sort: early + high volume first */
  gemResults.sort(function(a,b){return b.score-a.score});
  /* Render */
  gemLEl.innerHTML=gemResults.length?gemResults.map(function(g){
    /* Notify only for EARLY gems with high volume */
    if(g.timing==='early'&&g.volX>=2)notify(g.s,'gem',g.score);
    var src=[];if(T[g.s])src.push('Binance');if(T[g.s]&&T[g.s].by)src.push('Bybit');if(CBP[g.s])src.push('Coinbase');
    return'<div class="whale-card" onclick="openCoin(\''+g.s+'\')">'
    +'<div class="whale-head"><div class="whale-sym">💎 '+g.s+'/USDT <span class="str-badge '+g.timingCls+'">'+g.timingLabel+'</span></div>'+timeBadge(g.spikeTime)+'</div>'
    +'<div class="whale-grid">'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--up)">'+fP(g.p)+'</div><div class="whale-item-l">'+(lang==='ar'?'السعر الحالي':'Current Price')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:var(--neon)">'+g.volX.toFixed(1)+'x</div><div class="whale-item-l">'+(lang==='ar'?'ضغط الحجم':'Vol Spike')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v" style="color:'+(g.gainSinceSpike<3?'var(--up)':g.gainSinceSpike<8?'var(--warn)':'var(--dn)')+'">+'+(g.gainSinceSpike).toFixed(1)+'%</div><div class="whale-item-l">'+(lang==='ar'?'منذ بداية الحركة':'Since spike')+'</div></div>'
    +'<div class="whale-item"><div class="whale-item-v">'+fP(g.priceAtSpike)+'</div><div class="whale-item-l">'+(lang==='ar'?'سعر البداية':'Spike Price')+'</div></div>'
    +'</div>'
    +'<div style="margin-top:4px"><div class="prw"><div class="prb" style="width:'+Math.min(100,g.score)+'%;background:'+(g.timing==='early'?'var(--up)':g.timing==='still'?'var(--warn)':'var(--dn)')+'"></div></div></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">Vol:'+fmt(g.v)+'</span></div>'
    +'</div>'}).join(''):'<div class="empty"><div class="empty-ic">💎</div><div class="empty-tx">'+(lang==='ar'?'لا جواهر حالياً — السوق هادئ':'No gems now — Market quiet')+'</div></div>'}/* WATCHLIST */
var watchlist=[];try{watchlist=JSON.parse(localStorage.getItem('nxwl10')||'[]')}catch(e){}
/* 📊 MARKET DIRECTION REPORT — Parallel + Error-Safe */
/* ═══ MARKET REPORT v2.0 ═══ */
/* calcEMA — defined earlier */
/* ═══ MARKET CHARTS v2.0 ═══ */
var curMktTab=0;
var btcCache={h:null,t:0};
var ethCache={h:null,t:0};
var MKT_TTL=4*3600000;
var RPT_COINS=[{s:'BTC',ic:'\u20bf',col:'#f7931a'},{s:'ETH',ic:'\u039e',col:'#627eea'},{s:'SOL',ic:'\u25ce',col:'#9945ff'},{s:'BNB',ic:'\u2b21',col:'#f0b90b'},{s:'XRP',ic:'\u2715',col:'#0085c0'}];
var reportHistory=[];try{reportHistory=JSON.parse(localStorage.getItem('nxRptHist')||'[]')}catch(e){reportHistory=[]}
var prevReport=null;try{prevReport=JSON.parse(localStorage.getItem('nxPrevRpt')||'null')}catch(e){prevReport=null}
var hourlyLog=[];try{hourlyLog=JSON.parse(localStorage.getItem('nxHrLog')||'[]')}catch(e){hourlyLog=[]}
var FOMC_DATES=['2026-01-28','2026-03-18','2026-05-06','2026-06-17','2026-07-29','2026-09-16','2026-11-04','2026-12-16'];
var CPI_DATES=['2026-01-14','2026-02-12','2026-03-11','2026-04-10','2026-05-13','2026-06-10','2026-07-15','2026-08-12','2026-09-11','2026-10-14','2026-11-12','2026-12-10'];
var TOKEN_UNLOCKS=[];
var CANDLE_NAMES={
  ar:{bull_engulf:'\u0627\u0628\u062a\u0644\u0627\u0639 \u0634\u0631\u0627\u0626\u064a',bear_engulf:'\u0627\u0628\u062a\u0644\u0627\u0639 \u0628\u064a\u0639\u064a',hammer:'\u0645\u0637\u0631\u0642\u0629 (Hammer)',shooting:'\u0634\u0647\u0627\u0628 (Shooting Star)',doji:'Doji \u2014 \u062a\u0631\u062f\u062f',marubozu_up:'Marubozu \u0635\u0639\u0648\u062f\u064a',marubozu_dn:'Marubozu \u0647\u0628\u0648\u0637\u064a',normal_up:'\u0634\u0645\u0639\u0629 \u062e\u0636\u0631\u0627\u0621',normal_dn:'\u0634\u0645\u0639\u0629 \u062d\u0645\u0631\u0627\u0621'},
  en:{bull_engulf:'Bullish Engulfing',bear_engulf:'Bearish Engulfing',hammer:'Hammer',shooting:'Shooting Star',doji:'Doji',marubozu_up:'Bullish Marubozu',marubozu_dn:'Bearish Marubozu',normal_up:'Green Candle',normal_dn:'Red Candle'}
};
var MKT_TPL={
  bull_strong:['{coin} \u064a\u0648\u0627\u0635\u0644 \u0635\u0639\u0648\u062f\u0647 \u0645\u062f\u0639\u0648\u0645\u0627\u0628\u0640{reason1}. \u0627\u0644\u0625\u063a\u0644\u0627\u0642 \u0641\u0648\u0642 {ema} \u064a\u0639\u0632\u0632 \u0627\u0644\u0625\u064a\u062c\u0627\u0628\u064a\u0629. \u0627\u0644\u0645\u0633\u062a\u0648\u0649 \u0627\u0644\u062d\u0631\u062c {resistance} \u2014 \u0627\u062e\u062a\u0631\u0627\u0642\u0647 \u064a\u0641\u062a\u062d \u0627\u0644\u0628\u0627\u0628 \u0644\u0640{target}. {warning}','{coin} \u0641\u064a \u0627\u062a\u062c\u0627\u0647 \u0635\u0639\u0648\u062f\u064a \u0642\u0648\u064a \u2014 {reason1}. \u0627\u0644\u0633\u0639\u0631 \u062b\u0627\u0628\u062a \u0641\u0648\u0642 {support} \u0645\u0639 \u062d\u062c\u0645 {volStatus}. \u0627\u0644\u0647\u062f\u0641 {target}. {warning}'],
  bull_mild:['{coin} \u064a\u0645\u064a\u0644 \u0644\u0644\u0635\u0639\u0648\u062f \u2014 {reason1}. \u0627\u0644\u0633\u0639\u0631 \u0641\u0648\u0642 {ema} \u0644\u0643\u0646 {warning}. \u062f\u062e\u0648\u0644 \u0639\u0646\u062f {entry} \u0648\u0642\u0641 {stop}.','{coin} \u0625\u064a\u062c\u0627\u0628\u064a \u0628\u0634\u0643\u0644 \u0639\u0627\u0645 \u2014 {reason1}. \u0627\u0644\u0645\u0633\u062a\u0648\u0649 \u0627\u0644\u0645\u0647\u0645 {resistance}. {warning}'],
  neutral:['{coin} \u064a\u062a\u062f\u0627\u0648\u0644 \u062c\u0627\u0646\u0628\u064a\u0627\u064b \u0628\u064a\u0646 {support} \u0648 {resistance}. {reason1}. \u0627\u0646\u062a\u0638\u0631 \u0627\u062e\u062a\u0631\u0627\u0642 \u0648\u0627\u0636\u062d. {warning}','{coin} \u0641\u064a \u0645\u0646\u0637\u0642\u0629 \u0645\u062d\u0627\u064a\u062f\u0629 \u2014 \u0644\u0627 \u0625\u0634\u0627\u0631\u0627\u062a \u0642\u0648\u064a\u0629. {reason1}. \u0627\u0644\u0623\u0641\u0636\u0644 \u0627\u0644\u0627\u0646\u062a\u0638\u0627\u0631.'],
  bear_mild:['{coin} \u064a\u0645\u064a\u0644 \u0644\u0644\u0647\u0628\u0648\u0637 \u2014 {reason1}. \u062a\u062d\u062a {ema}. \u062f\u0639\u0645 \u0645\u0647\u0645 {support}. \u0643\u0633\u0631\u0647 \u064a\u0641\u062a\u062d \u0647\u0628\u0648\u0637 \u0646\u062d\u0648 {target}. {warning}'],
  bear_strong:['{coin} \u0641\u064a \u0647\u0628\u0648\u0637 \u0642\u0648\u064a \u2014 {reason1}. \u0643\u0633\u0631 {support} \u064a\u0633\u0631\u0651\u0639 \u0627\u0644\u0647\u0628\u0648\u0637. \u062a\u062c\u0646\u0628 \u0627\u0644\u0634\u0631\u0627\u0621 \u062d\u0627\u0644\u064a\u0627\u064b. {warning}']
};
var MKT_TPL_EN={
  bull_strong:['{coin} continues rally \u2014 {reason1}. Close above {ema} is positive. Key level {resistance}. Target {target}. {warning}','{coin} in strong uptrend \u2014 {reason1}. Holding above {support}. Target {target}. {warning}'],
  bull_mild:['{coin} mildly bullish \u2014 {reason1}. Above {ema}. {warning}.'],
  neutral:['{coin} ranging between {support} and {resistance}. {reason1}. Wait for breakout.'],
  bear_mild:['{coin} leaning bearish \u2014 {reason1}. Support at {support}. {warning}'],
  bear_strong:['{coin} in strong decline \u2014 {reason1}. Avoid buying. {warning}']
};

function mktTab(idx,btn){
  curMktTab=idx;
  document.querySelectorAll('#mktTabs>.mkt-tab').forEach(function(b){b.classList.remove('act')});
  if(btn)btn.classList.add('act');
  var btcEl=document.getElementById('mktBTC');
  var ethEl=document.getElementById('mktETH');
  if(btcEl)btcEl.style.display=idx===0?'block':'none';
  if(ethEl)ethEl.style.display=idx===1?'block':'none';
  if(idx===0)loadBTCChart();
  if(idx===1)loadETHChart();
}

function getMktFresh(cacheTime){
  var age=Date.now()-cacheTime;var pct=age/MKT_TTL;
  if(pct<0.5)return{cls:'ok',txt:lang==='ar'?'بيانات طازجة':'Fresh'};
  if(pct<0.9)return{cls:'aging',txt:lang==='ar'?'بيانات جيدة':'Good'};
  return{cls:'stale',txt:lang==='ar'?'حدّث!':'Refresh!'};
}

function getUpcomingEvents(){var evs=[];var now=new Date();var in7=new Date(now.getTime()+7*86400000);
  FOMC_DATES.forEach(function(d){var dt=new Date(d);if(dt>=now&&dt<=in7){var dy=Math.ceil((dt-now)/86400000);evs.push({ic:'🏦',txt:lang==='ar'?'اجتماع Fed — '+(dy===0?'اليوم!':dy===1?'غداً':'بعد '+dy+' أيام'):'FOMC — '+(dy===0?'Today!':'in '+dy+'d'),impact:'high',warn:lang==='ar'?'توقع تذبذب عالي':'Expect volatility'})}});
  CPI_DATES.forEach(function(d){var dt=new Date(d);if(dt>=now&&dt<=in7){var dy=Math.ceil((dt-now)/86400000);evs.push({ic:'📊',txt:lang==='ar'?'بيانات CPI — '+(dy===0?'اليوم 15:30!':'بعد '+dy+' أيام'):'CPI Data — '+(dy===0?'Today 15:30!':'in '+dy+'d'),impact:'high',warn:lang==='ar'?'ممكن يأثر على الكريبتو':'May affect crypto'})}});
  TOKEN_UNLOCKS.forEach(function(u){var dt=new Date(u.date);if(dt>=now&&dt<=in7){var dy=Math.ceil((dt-now)/86400000);evs.push({ic:'🔓',txt:'Unlock: '+u.sym+' '+fmt(u.amount)+' — '+(dy===0?(lang==='ar'?'اليوم':'Today'):(lang==='ar'?'بعد '+dy+' أيام':'in '+dy+'d')),impact:u.amount>5e7?'high':'medium',warn:(lang==='ar'?'ضغط بيع على ':'Sell pressure ')+u.sym})}});
  return evs}

function getAccuracy(){var r=reportHistory.slice(-20);if(r.length<5)return null;var c=r.filter(function(x){return x.correct}).length;return{pct:Math.round(c/r.length*100),c:c,t:r.length}}

function detectCandlePattern(o,h,l,c){
  var body=Math.abs(c-o);var range=h-l;
  if(range===0)return'doji';var bodyPct=body/range;
  var upperWick=c>o?(h-c)/range:(h-o)/range;
  var lowerWick=c>o?(o-l)/range:(c-l)/range;
  if(bodyPct<0.1)return'doji';
  if(bodyPct>0.8&&c>o)return'marubozu_up';
  if(bodyPct>0.8&&c<o)return'marubozu_dn';
  if(lowerWick>0.6&&upperWick<0.1&&c>o)return'hammer';
  if(upperWick>0.6&&lowerWick<0.1&&c<o)return'shooting';
  return c>o?'normal_up':'normal_dn';
}

function rP(p){
  if(!p||isNaN(p))return'$0';
  if(p>=100)return'$'+Math.round(p).toLocaleString('en');
  if(p>=1)return'$'+(+p.toFixed(2));
  return'$'+(+p.toFixed(4));
}

function mktSignature(){
  return'<div class="mkt-signature">'
    +'<div class="mkt-sig-name">'+(lang==='ar'?'تحليل مقدّم من خبير زكريا الأحمد':'Analysis by expert Zakaria Al-Ahmad')+'</div>'
    +'<div class="mkt-sig-wish">'+(lang==='ar'?'أتمنى لكم النجاح 🎯':'Wishing you success 🎯')+'</div>'
    +'<div class="mkt-sig-note">'+(lang==='ar'
      ?'⚠️ ملاحظة: هذا تحليل حسب نظرة السوق — احتمال أي خبر كبير يقلب التحليل عكس النتائج'
      :'⚠️ Note: This analysis is based on market outlook — any major news could reverse the results')+'</div>'
    +'</div>';
}

function buildStory(coin,data){
  var tpls=lang==='ar'?MKT_TPL:MKT_TPL_EN;
  var cat=data.ts>=4?'bull_strong':data.ts>=2?'bull_mild':data.ts<=-4?'bear_strong':data.ts<=-2?'bear_mild':'neutral';
  var pool=tpls[cat]||tpls.neutral;
  var tmpl=pool[Math.floor(Date.now()/3600000)%pool.length];
  var cn=lang==='ar'?(coin==='BTC'?'البيتكوين':coin==='ETH'?'الإيثيريوم':coin==='SOL'?'سولانا':coin):coin;
  /* Safe replace: use function form so values containing $ or $1 aren't mangled */
  var vars={
    '{coin}':cn,
    '{reason1}':data.reasons[0]||'',
    '{reason2}':data.reasons[1]||'',
    '{ema}':rP(data.ema20),
    '{support}':rP(data.supp),
    '{resistance}':rP(data.resist),
    '{target}':rP(data.f618U),
    '{entry}':rP(data.price*0.99),
    '{stop}':rP(data.supp),
    '{volStatus}':data.volT>1.3?(lang==='ar'?'قوي':'strong'):(lang==='ar'?'ضعيف':'weak'),
    '{warning}':data.warning||''
  };
  return tmpl.replace(/\{(\w+)\}/g,function(m){return vars[m]!=null?String(vars[m]):m});
}

function addHourlyLog(msg){hourlyLog.push({time:Date.now(),txt:msg});if(hourlyLog.length>20)hourlyLog=hourlyLog.slice(-20);try{localStorage.setItem('nxHrLog',JSON.stringify(hourlyLog))}catch(e){}}

function getChanges(btc){
  if(!prevReport)return[];var ch=[];
  if(prevReport.btcDir!==btc.dIc)ch.push({ic:'🔄',txt:(lang==='ar'?'الاتجاه: ':'Direction: ')+prevReport.btcDir+' → '+btc.dIc});
  if(prevReport.btcPrice){var pD=((btc.price-prevReport.btcPrice)/prevReport.btcPrice*100);if(Math.abs(pD)>1)ch.push({ic:pD>0?'📈':'📉',txt:'BTC '+(pD>0?'+':'')+pD.toFixed(1)+'%'})}
  if(prevReport.fg!==undefined&&prevReport.fg!==fgValue){ch.push({ic:fgValue>prevReport.fg?'😊':'😨',txt:'F&G: '+prevReport.fg+' → '+fgValue})}
  return ch}

async function analyzeCoinRpt(sym){
  var d=T[sym];if(!d)return null;
  var res=await Promise.all([fj(BN+'/klines?symbol='+sym+'USDT&interval=1h&limit=48'),fj(BN+'/klines?symbol='+sym+'USDT&interval=4h&limit=50'),fj(BN+'/klines?symbol='+sym+'USDT&interval=1d&limit=30')]);
  var kl1h=res[0],kl4h=res[1],kl1d=res[2];if(!kl4h||kl4h.length<20)return null;
  var c1h=kl1h?kl1h.map(function(k){return+k[4]}):[];var c4=kl4h.map(function(k){return+k[4]});var h4=kl4h.map(function(k){return+k[2]});var l4=kl4h.map(function(k){return+k[3]});var v4=kl4h.map(function(k){return+k[5]});var o4=kl4h.map(function(k){return+k[1]});
  var c1d=kl1d?kl1d.map(function(k){return+k[4]}):[];var h1d=kl1d?kl1d.map(function(k){return+k[2]}):[];var l1d=kl1d?kl1d.map(function(k){return+k[3]}):[];
  var price=c4[c4.length-1];var rsi=calcRSI(c4);var rsi1d=calcRSI(c1d);var macd=calcMACD(c4);var macd1d=calcMACD(c1d);var ema20=calcEMA(c4.slice(-20),20);var ema50=calcEMA(c4,50);
  var avgVol=v4.slice(-10,-2).reduce(function(a,b){return a+b},0)/Math.max(1,v4.slice(-10,-2).length);var recVol=(v4[v4.length-1]+(v4[v4.length-2]||0))/2;var volT=avgVol>0?recVol/avgVol:1;
  var resist=Math.max.apply(null,h1d.length>=14?h1d.slice(-14):h4.slice(-20));var supp=Math.min.apply(null,l1d.length>=14?l1d.slice(-14):l4.slice(-20));
  var fRng=resist-supp;if(fRng===0)fRng=price*0.03;var f618U=price+fRng*0.618;var f100U=price+fRng;var f618D=price-fRng*0.618;

  /* ═══ NEW: Gather 12 additional data sources ═══ */
  var topTraders=null;
  try{if(topTradersLS[sym]&&topTradersLS[sym].accounts&&topTradersLS[sym].accounts.length){
    var tt=topTradersLS[sym];var ttLast=tt.accounts[tt.accounts.length-1];var ttFirst=tt.accounts[0];
    topTraders={long:ttLast.long,short:ttLast.short,trend:ttLast.long>ttFirst.long?'up':'down',delta:+((ttLast.long-ttFirst.long)*100).toFixed(1)};
  }}catch(e){}

  var gLS=null;
  try{if(globalLS[sym]&&globalLS[sym].length){var glL=globalLS[sym][globalLS[sym].length-1];gLS={long:glL.long,short:glL.short};}}catch(e){}

  var cbPrem=null;
  try{
    if(sym==='BTC'&&typeof cbPremium!=='undefined'&&cbPremium.time&&cbPremium.BTC_pct!==undefined)cbPrem={pct:cbPremium.BTC_pct||0};
    else if(sym==='ETH'&&typeof cbPremium!=='undefined'&&cbPremium.ETH_pct!==undefined)cbPrem={pct:cbPremium.ETH_pct||0};
    else if(typeof CBP!=='undefined'&&CBP[sym]&&d.p>0)cbPrem={pct:((CBP[sym]-d.p)/d.p)*100};
  }catch(e){}

  var bfxMargin=null;
  try{if(bitfinexMargin[sym]){bfxMargin={longPct:bitfinexMargin[sym].longPct,shortPct:bitfinexMargin[sym].shortPct,ratio:bitfinexMargin[sym].ratio||1};}}catch(e){}

  var hlFunding=null;
  try{if(hyperliquidData[sym]){hlFunding={rate:hyperliquidData[sym].funding||0,oi:hyperliquidData[sym].openInterest||0};}}catch(e){}

  var frHist=null;
  try{if(frHistory[sym]&&frHistory[sym].length){
    var fh=frHistory[sym];var last10=fh.slice(-10);
    var negCount=last10.filter(function(x){return x.rate<0}).length;
    var avg8=fh.slice(-8).reduce(function(a,x){return a+x.rate},0)/Math.min(8,fh.length);
    frHist={data:fh,last:fh[fh.length-1].rate,negCount:negCount,totalCount:last10.length,avg8:avg8};
  }}catch(e){}

  var oiHist=null;
  try{if(oiHistory[sym]&&oiHistory[sym].length>=4){
    var oh=oiHistory[sym];var oiGrowth=oh[0].val>0?((oh[oh.length-1].val-oh[0].val)/oh[0].val*100):0;
    oiHist={data:oh,growth:oiGrowth,current:oh[oh.length-1].val};
  }}catch(e){}

  var taker=null;
  try{if(takerData[sym]){taker={ratio:takerData[sym].ratio||1,trend:takerData[sym].trend||'FLAT',avg:takerData[sym].avg||1};}}catch(e){}

  var depth=null;
  try{if(depthSnapshots[sym])depth=depthSnapshots[sym];}catch(e){}

  var iceberg=null;
  try{iceberg=detectIceberg(sym);}catch(e){iceberg=null;}

  var vpinData=null;
  try{vpinData=calcVPIN(sym);}catch(e){vpinData=null;}

  var whalePnL=null;
  try{whalePnL=calcWhalePnL(sym);}catch(e){whalePnL=null;}

  var flowRate=0;
  try{flowRate=calcFlowRate(sym)||0;}catch(e){flowRate=0;}

  var predArrow=null;
  try{predArrow=getPredArrow(sym);}catch(e){predArrow=null;}

  var absorption=null;
  try{absorption=detectAbsorption(sym);}catch(e){absorption=null;}

  var stableFlow=null;
  try{if(stablecoinData&&stablecoinData['USDT']){stableFlow={usdt:stablecoinData['USDT'].supply||0,usdc:stablecoinData['USDC']?stablecoinData['USDC'].supply:0};}}catch(e){}

  var unlocks=[];
  try{if(tokenUnlocks&&tokenUnlocks.length){
    var _now=Date.now();var _in7=_now+7*86400000;
    unlocks=tokenUnlocks.filter(function(u){var dt=new Date(u.date).getTime();return dt>=_now&&dt<=_in7}).slice(0,3);
  }}catch(e){}

  var newsScore=null;
  try{if(newsSentiment&&(newsSentiment.time||newsSentiment.score!==undefined)){
    if(newsSentiment.score!==undefined)newsScore={score:newsSentiment.score,total:newsSentiment.total||0};
    else{var _tot=(newsSentiment.pos||0)+(newsSentiment.neg||0)+(newsSentiment.neu||0);
      if(_tot>0)newsScore={score:Math.round((newsSentiment.pos||0)/_tot*100),total:_tot};}
  }}catch(e){}

  var onChain=null;
  try{if(sym==='BTC'&&typeof btcOnChain!=='undefined'&&btcOnChain.time)onChain={hashRate:btcOnChain.hashRate||0,difficulty:btcOnChain.difficulty||0};}catch(e){}

  var ethBtcRatio=null,btcChange=null,ethChange=null;
  try{if(T.BTC&&T.ETH){ethBtcRatio=T.ETH.p/T.BTC.p;btcChange=T.BTC.c;ethChange=T.ETH.c;}}catch(e){}

  /* ═══ Trend score (original 10 + 12 new) ═══ */
  var ts=0;if(price>ema20)ts+=2;else ts-=2;if(price>ema50)ts+=2;else ts-=2;if(ema20>ema50)ts++;else ts--;if(macd.h>0)ts+=2;else ts-=2;if(macd.cross==='bull')ts+=2;if(macd.cross==='bear')ts-=2;if(rsi>55)ts++;else if(rsi<45)ts--;if(volT>1.3)ts++;
  var fr=FR[sym];if(fr){if(fr.rate<0)ts++;if(fr.rate>0.05)ts--}
  var ls=LS[sym];if(ls){if(ls.ratio>1.5)ts--;if(ls.ratio<0.8)ts++}
  var ww=whaleWaves[sym];var wConf=ww&&ww.engine?ww.engine.confidence:0;if(wConf>=50)ts++;
  var cvd=analyzeCVD(sym);

  /* 12 NEW trend score inputs */
  try{if(topTraders){if(topTraders.long>0.58)ts+=2;else if(topTraders.long>0.53)ts++;else if(topTraders.long<0.42)ts-=2;}}catch(e){}
  try{if(gLS&&topTraders){if(topTraders.long>0.55&&gLS.long<0.45)ts+=2;}}catch(e){}
  try{if(cbPrem){if(cbPrem.pct>0.3)ts+=2;else if(cbPrem.pct>0.1)ts++;else if(cbPrem.pct<-0.3)ts--;}}catch(e){}
  try{if(bfxMargin){if(bfxMargin.longPct>70)ts+=2;else if(bfxMargin.longPct>60)ts++;else if(bfxMargin.shortPct>60)ts--;}}catch(e){}
  try{if(hlFunding&&fr){if(hlFunding.rate<0&&fr.rate<0)ts++;}}catch(e){}
  try{if(frHist&&frHist.totalCount>0){if(frHist.negCount>=7)ts+=2;else if(frHist.negCount>=5)ts++;}}catch(e){}
  try{if(oiHist&&oiHist.growth>15&&Math.abs(d.c)<3)ts+=2;}catch(e){}
  try{if(taker){if(taker.ratio>1.5)ts++;else if(taker.ratio<0.6)ts--;}}catch(e){}
  try{if(iceberg){if(iceberg.signal==='ICEBERG_BUY')ts+=2;else if(iceberg.signal==='ICEBERG_SELL')ts-=2;}}catch(e){}
  try{if(vpinData&&vpinData.vpin>0.6)ts++;}catch(e){}
  try{if(whalePnL){if(whalePnL.pct>1)ts++;else if(whalePnL.pct<-3)ts-=2;}}catch(e){}
  try{if(newsScore){if(newsScore.score>70)ts++;else if(newsScore.score<30)ts--;}}catch(e){}

  var tf1h=c1h.length>=20?(c1h[c1h.length-1]>calcEMA(c1h.slice(-20),20)?'up':'down'):'neutral';
  var tf4h=price>ema20&&macd.h>0?'up':price<ema20&&macd.h<0?'down':'neutral';
  var tf1d=c1d.length>=20?(c1d[c1d.length-1]>calcEMA(c1d.slice(-20),20)&&macd1d.h>0?'up':'down'):'neutral';
  var tfW=c1d.length>=7?(c1d[c1d.length-1]>c1d[c1d.length-7]?'up':'down'):'neutral';
  var bullTFs=[tf1h,tf4h,tf1d,tfW].filter(function(t){return t==='up'}).length;
  var ch1h=c1h.length>=2?((price-c1h[c1h.length-2])/c1h[c1h.length-2]*100):0;
  var ch4h=c4.length>=2?((price-c4[c4.length-2])/c4[c4.length-2]*100):0;
  var ch24=c4.length>=7?((price-c4[c4.length-7])/c4[c4.length-7]*100):d.c;
  var ch7d=c1d.length>=7?((price-c1d[c1d.length-7])/c1d[c1d.length-7]*100):0;
  /* Divergence on 4H + Daily */
  var divRSI='none',divRSI1d='none';
  if(h4.length>=10){var pH=h4[h4.length-1]>h4[h4.length-5];var rO=calcRSI(c4.slice(0,-4));if(pH&&rsi<rO)divRSI='bearish';if(!pH&&rsi>rO)divRSI='bullish_hidden'}
  if(h1d.length>=10){var pH1d=h1d[h1d.length-1]>h1d[h1d.length-5];var rO1d=calcRSI(c1d.slice(0,-4));if(pH1d&&rsi1d<rO1d)divRSI1d='bearish'}
  /* Market Structure */
  var struct='neutral',bos=null,choch=null;
  if(h4.length>=10&&l4.length>=10){var hA=h4[h4.length-5],hB=h4[h4.length-1],lA=l4[l4.length-5],lB=l4[l4.length-1];
    if(hB>hA&&lB>lA){struct='HH/HL';bos=fP(lA)}else if(hB<hA&&lB<lA){struct='LH/LL';bos=fP(hA);choch=fP(hA)}else if(hB<hA&&lB>lA)struct='Range';else struct=hB>hA?'HH':'LH'}
  /* Order Blocks */
  var orderBlocks=[];
  for(var obi=Math.max(2,o4.length-15);obi<o4.length-1;obi++){var obB=Math.abs(c4[obi]-o4[obi]),obR=h4[obi]-l4[obi];
    if(obR>0&&obB/obR>0.6&&v4[obi]>avgVol*1.5){if(c4[obi]>o4[obi]&&c4[obi+1]<o4[obi+1])orderBlocks.push({type:'bearish',price:fP(h4[obi])});if(c4[obi]<o4[obi]&&c4[obi+1]>o4[obi+1])orderBlocks.push({type:'bullish',price:fP(l4[obi])})}}
  if(orderBlocks.length>3)orderBlocks=orderBlocks.slice(-3);
  /* FVG */
  var fvgs=[];
  for(var fi=2;fi<h4.length;fi++){if(l4[fi]>h4[fi-2])fvgs.push({type:'bullish',top:fP(l4[fi]),bot:fP(h4[fi-2])});if(h4[fi]<l4[fi-2])fvgs.push({type:'bearish',top:fP(l4[fi-2]),bot:fP(h4[fi])})}
  if(fvgs.length>2)fvgs=fvgs.slice(-2);
  /* Historical pattern match */
  var histMatch=null;
  if(c1d.length>=20&&kl1d){var cRSI=rsi1d,cM=macd1d.h>0?1:-1,bSim=0,bIdx=-1;
    for(var hi=15;hi<c1d.length-5;hi++){var hRSI=calcRSI(c1d.slice(0,hi));var hM=calcMACD(c1d.slice(0,hi));var sim=100-Math.abs(hRSI-cRSI)-Math.abs((hM.h>0?1:-1)-cM)*10;if(sim>bSim&&sim>70){bSim=sim;bIdx=hi}}
    if(bIdx>0&&bIdx+5<=c1d.length){var fRet=((c1d[bIdx+4]-c1d[bIdx])/c1d[bIdx]*100);histMatch={sim:bSim.toFixed(0),ret:(fRet>=0?'+':'')+fRet.toFixed(1)+'%',days:Math.round((Date.now()-new Date(kl1d[bIdx][0]).getTime())/86400000)}}}
  /* Direction */
  var dir,dCol,dIc;if(ts>=4){dir=lang==='ar'?'صعودي قوي':'Strong Bull';dCol='var(--up)';dIc='🟢🟢'}else if(ts>=2){dir=lang==='ar'?'صعودي':'Bullish';dCol='var(--up)';dIc='🟢'}else if(ts<=-4){dir=lang==='ar'?'هبوطي قوي':'Strong Bear';dCol='var(--dn)';dIc='🔴🔴'}else if(ts<=-2){dir=lang==='ar'?'هبوطي':'Bearish';dCol='var(--dn)';dIc='🔴'}else{dir=lang==='ar'?'محايد':'Neutral';dCol='var(--warn)';dIc='🟡'}
  /* Reasons */
  var reasons=[];if(wConf>=40)reasons.push(lang==='ar'?'تجميع حيتان '+wConf+'%':'Whale accumulation '+wConf+'%');
  if(cvd.divergence==='BULLISH')reasons.push(lang==='ar'?'CVD صاعد — شراء مخفي':'CVD bullish');
  if(fr&&fr.rate<-0.02)reasons.push(lang==='ar'?'FR سلبي — فرصة':'Negative FR');
  if(macd.cross==='bull')reasons.push(lang==='ar'?'تقاطع MACD صعودي':'MACD bull cross');
  if(rsi<35)reasons.push(lang==='ar'?'RSI '+rsi.toFixed(0)+' — منطقة شراء':'RSI '+rsi.toFixed(0)+' oversold');
  if(volT>1.3)reasons.push(lang==='ar'?'حجم '+volT.toFixed(1)+'x فوق المعدل':'Volume '+volT.toFixed(1)+'x above avg');
  if(price>ema20&&price>ema50)reasons.push(lang==='ar'?'فوق EMA20 و EMA50':'Above EMA20 & EMA50');
  if(cvd.divergence==='BEARISH')reasons.push(lang==='ar'?'CVD هابط — بيع مخفي':'CVD bearish');
  if(fr&&fr.rate>0.08)reasons.push(lang==='ar'?'FR عالي — خطر':'High FR — risk');
  var warning='';if(divRSI==='bearish')warning=lang==='ar'?'⚠️ RSI Divergence على 4H':'⚠️ RSI Div on 4H';
  else if(divRSI1d==='bearish')warning=lang==='ar'?'⚠️ RSI Divergence على اليومي':'⚠️ RSI Div on Daily';
  else if(volT<0.7)warning=lang==='ar'?'حجم ضعيف':'Low volume';
  /* Scenarios */
  var bullP=Math.min(80,Math.max(10,50+ts*4+(wConf>=50?5:0)+(bullTFs>=3?5:0)));var bearP=Math.min(35,Math.max(5,100-bullP-15));var neutP=100-bullP-bearP;
  var bullCond=lang==='ar'?'اختراق '+fP(resist)+' بحجم':'Break '+fP(resist)+' with volume';
  var bearCond=lang==='ar'?'كسر '+fP(supp)+' بإغلاق':'Close below '+fP(supp);
  var bullInv=lang==='ar'?'يُلغى لو كسر '+fP(supp):'Invalidated below '+fP(supp);
  var bearInv=lang==='ar'?'يُلغى لو اخترق '+fP(resist):'Invalidated above '+fP(resist);
  var riskPct=ts>=4?5:ts>=2?3:ts<=-2?0:1;
  /* Score (9 original + 3 new factors) */
  var W=monitorState?monitorState.weights:DEFAULT_WEIGHTS;
  var sc=0,scB=[];var addSc=function(n,v,k){var wt=W[k]||1;var adj=v*(wt/(DEFAULT_WEIGHTS[k]||1));scB.push({n:n,v:+adj.toFixed(2),k:k,raw:v,wt:+wt.toFixed(2)});sc+=adj};
  addSc(lang==='ar'?'الاتجاه':'Trend',ts>=4?2:ts>=2?1.5:ts>=0?1:0,'trend');
  addSc(lang==='ar'?'الحيتان':'Whales',wConf>=60?2:wConf>=40?1:0,'whales');
  addSc('RSI',rsi>=30&&rsi<=55?1:0.5,'rsi');
  addSc('FR',fr&&fr.rate<0?1:fr&&fr.rate>0.05?0:0.5,'fr');
  addSc('OI',OI[sym]?(ch4h>0&&ts>0?1:0.5):0,'oi');
  addSc(lang==='ar'?'حجم':'Vol',volT>1.3?0.5:0,'vol');
  addSc('MACD',macd.h>0?0.5:0,'macd');
  addSc(lang==='ar'?'توافق':'TF',bullTFs>=3?1:bullTFs>=2?0.5:0,'confluence');
  addSc(lang==='ar'?'هيكل':'Struct',struct==='HH/HL'?1:struct==='LH/LL'?0:0.5,'structure');
  /* 3 NEW factors */
  var smartSc=0;
  if(topTraders&&topTraders.long>0.55)smartSc+=0.6;
  if(cbPrem&&cbPrem.pct>0.2)smartSc+=0.5;
  if(bfxMargin&&bfxMargin.longPct>60)smartSc+=0.4;
  addSc(lang==='ar'?'ذكاء':'Smart',Math.min(1.5,smartSc),'smart');
  var flowSc=0;
  if(iceberg&&iceberg.signal==='ICEBERG_BUY')flowSc+=0.6;
  if(vpinData&&vpinData.vpin>0.6)flowSc+=0.5;
  if(taker&&taker.ratio>1.3)flowSc+=0.4;
  addSc(lang==='ar'?'تدفق':'Flow',Math.min(1.5,flowSc),'flow');
  var moodSc=0;
  if(typeof fgValue!=='undefined'&&fgValue>=40&&fgValue<=70)moodSc+=0.5;
  if(newsScore&&newsScore.score>55)moodSc+=0.5;
  addSc(lang==='ar'?'مزاج':'Mood',Math.min(1.0,moodSc),'mood');

  var rec,recIc;if(ts>=4){rec=lang==='ar'?'💰 شراء قوي — وقف '+fP(f618D):'💰 Strong Buy — Stop '+fP(f618D);recIc='💰'}else if(ts>=2){rec=lang==='ar'?'📈 شراء — دخول تدريجي':'📈 Buy — Scale in';recIc='📈'}else if(ts<=-4){rec=lang==='ar'?'⛔ تجنب — هبوط قوي':'⛔ Avoid';recIc='⛔'}else if(ts<=-2){rec=lang==='ar'?'⚠️ حذر — انتظر':'⚠️ Caution — Wait';recIc='⚠️'}else{rec=lang==='ar'?'⏳ انتظار — محايد':'⏳ Wait';recIc='⏳'}
  /* Liquidation zones */
  var liqZones=[];if(typeof liqEvents!=='undefined'&&liqEvents&&liqEvents.length){var sL=liqEvents.filter(function(e){return e.s===sym||e.s===sym+'USDT'});
    var longL=sL.filter(function(e){return e.S==='SELL'}).reduce(function(s,e){return s+(e.q||0)*(e.p||0)},0);
    var shortL=sL.filter(function(e){return e.S==='BUY'}).reduce(function(s,e){return s+(e.q||0)*(e.p||0)},0);
    if(longL>0)liqZones.push({side:'Long',amt:longL});if(shortL>0)liqZones.push({side:'Short',amt:shortL})}
  /* Aggregate liquidation data from coinalyze */
  var aggLiq=null;try{if(typeof coinalyzeLiq!=='undefined'&&coinalyzeLiq[sym])aggLiq={longVol:coinalyzeLiq[sym].longVol||0,shortVol:coinalyzeLiq[sym].shortVol||0};}catch(e){}

  return{sym:sym,price:price,d:d,ts:ts,dir:dir,dCol:dCol,dIc:dIc,rsi:rsi,rsi1d:rsi1d,macd:macd,macd1d:macd1d,ema20:ema20,ema50:ema50,volT:volT,resist:resist,supp:supp,f618U:f618U,f100U:f100U,f618D:f618D,fr:fr,ls:ls,oi:OI[sym],wConf:wConf,cvd:cvd,tf:{h1:tf1h,h4:tf4h,d:tf1d,w:tfW},bullTFs:bullTFs,ch:{h1:ch1h,h4:ch4h,h24:ch24,d7:ch7d},divRSI:divRSI,divRSI1d:divRSI1d,reasons:reasons,warning:warning,bullP:bullP,bearP:bearP,neutP:neutP,bullCond:bullCond,bearCond:bearCond,bullInv:bullInv,bearInv:bearInv,sc:+sc.toFixed(1),scB:scB,rec:rec,recIc:recIc,struct:struct,bos:bos,choch:choch,riskPct:riskPct,orderBlocks:orderBlocks,fvgs:fvgs,histMatch:histMatch,liqZones:liqZones,kl4h:kl4h,kl1d:kl1d,kl1h:kl1h,
    /* NEW return fields */
    topTraders:topTraders,gLS:gLS,cbPrem:cbPrem,bfxMargin:bfxMargin,hlFunding:hlFunding,frHist:frHist,oiHist:oiHist,taker:taker,depth:depth,iceberg:iceberg,vpinData:vpinData,whalePnL:whalePnL,flowRate:flowRate,predArrow:predArrow,absorption:absorption,stableFlow:stableFlow,unlocks:unlocks,newsScore:newsScore,onChain:onChain,ethBtcRatio:ethBtcRatio,btcChange:btcChange,ethChange:ethChange,aggLiq:aggLiq}}


/* ═══ buildChartHTML — 15 Section Professional Market Direction Report ═══ */
function buildChartHTML(data, coinColor, coinIcon, coinName){
  if(!data) return '<div class="empty"><div class="empty-ic">📊</div><div class="empty-tx">'+(lang==='ar'?'لا بيانات':'No data')+'</div></div>';
  var h='';
  var cn=lang==='ar'?coinName.ar:coinName.en;
  var sym=data.sym;
  var isAr=lang==='ar';

  /* ════════ SECTION 1: Hero Header + Smart Money Mini-Bar ════════ */
  var heroBg=data.ts>=2?'rgba(0,255,136,.04)':data.ts<=-2?'rgba(255,56,96,.04)':'rgba(255,184,0,.04)';
  var heroBdr=data.ts>=2?'rgba(0,255,136,.08)':data.ts<=-2?'rgba(255,56,96,.08)':'rgba(255,184,0,.08)';
  h+='<div class="mkt-hero" style="background:'+heroBg+';border:1px solid '+heroBdr+'">';
  h+='<div style="font-size:32px;color:'+coinColor+'">'+coinIcon+'</div>';
  h+='<div style="font-size:14px;font-weight:800;color:var(--t0);margin:4px 0">'+cn+' <span style="color:var(--t2);font-size:12px">'+sym+'/USDT</span></div>';
  h+='<div class="mkt-hero-price" style="direction:ltr">'+rP(data.price)+'</div>';
  h+='<div class="mkt-hero-ch" style="color:'+(data.ch.h24>=0?'var(--up)':'var(--dn)')+';direction:ltr">'+(data.ch.h24>=0?'+':'')+data.ch.h24.toFixed(1)+'% (24h)</div>';
  h+='<div class="mkt-hero-meta">'+(isAr?'الاتجاه: ':'Direction: ')+data.dIc+' '+data.dir+' · '+(isAr?'التقييم: ':'Score: ')+data.sc+'/10</div>';
  h+='<div class="mkt-hero-meta">'+(isAr?'آخر تحديث: ':'Updated: ')+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+'</div>';
  /* Smart Money mini-bar: count bullish smart signals */
  var smartBull=0,smartTotal=0;
  if(data.topTraders){smartTotal++;if(data.topTraders.long>0.55)smartBull++}
  if(data.cbPrem){smartTotal++;if(data.cbPrem.pct>0.1)smartBull++}
  if(data.bfxMargin){smartTotal++;if(data.bfxMargin.longPct>55)smartBull++}
  if(data.hlFunding){smartTotal++;if(data.hlFunding.rate<0)smartBull++}
  if(data.vpinData){smartTotal++;if(data.vpinData.vpin>0.5)smartBull++}
  if(data.absorption){smartTotal++;if(data.absorption.signal==='BULLISH_ABSORPTION')smartBull++}
  if(data.iceberg){smartTotal++;if(data.iceberg.signal==='ICEBERG_BUY')smartBull++}
  if(smartTotal>0){
    var smartPct=Math.round(smartBull/smartTotal*100);
    var smartCol=smartBull>=smartTotal*0.7?'var(--up)':smartBull<=smartTotal*0.3?'var(--dn)':'var(--warn)';
    h+='<div style="margin-top:6px;padding:4px 8px;background:rgba(91,156,255,.06);border-radius:6px;font-size:10px;color:var(--t1)">🧠 '+(isAr?'ذكاء المال: ':'Smart Money: ')+'<span style="font-weight:800;color:'+smartCol+'">'+smartBull+'/'+smartTotal+' '+(isAr?'صعودية':'bullish')+' ('+smartPct+'%)</span></div>';
  }
  h+='</div>';

  /* ════════ SECTION 2: Price Chart (SVG Candles + S/R) ════════ */
  if(data.kl4h&&data.kl4h.length>=12){
    var cKl=data.kl4h.slice(-24);
    var allH=cKl.map(function(k){return+k[2]});var allL=cKl.map(function(k){return+k[3]});
    var pMax=Math.max.apply(null,allH);var pMin=Math.min.apply(null,allL);var pRng=pMax-pMin;if(pRng===0)pRng=pMax*0.02;
    var cW=Math.floor(280/cKl.length)-1;if(cW<4)cW=4;var cH=140;var pad=20;
    var yScale=function(p){return pad+(1-(p-pMin)/pRng)*(cH-pad*2)};
    var svgW=cKl.length*(cW+1)+40;
    var svg='<svg width="100%" viewBox="0 0 '+svgW+' '+(cH+10)+'" style="display:block;margin:6px 0;border-radius:8px;background:var(--bg2)">';
    svg+='<line x1="0" y1="'+yScale(data.resist)+'" x2="'+svgW+'" y2="'+yScale(data.resist)+'" stroke="var(--dn)" stroke-width="0.5" stroke-dasharray="3 3" opacity="0.5"/>';
    svg+='<text x="'+(svgW-4)+'" y="'+(yScale(data.resist)-3)+'" fill="var(--dn)" font-size="7" text-anchor="end" font-family="var(--fm)">R '+rP(data.resist)+'</text>';
    svg+='<line x1="0" y1="'+yScale(data.supp)+'" x2="'+svgW+'" y2="'+yScale(data.supp)+'" stroke="var(--up)" stroke-width="0.5" stroke-dasharray="3 3" opacity="0.5"/>';
    svg+='<text x="'+(svgW-4)+'" y="'+(yScale(data.supp)+9)+'" fill="var(--up)" font-size="7" text-anchor="end" font-family="var(--fm)">S '+rP(data.supp)+'</text>';
    if(data.ema20){svg+='<line x1="0" y1="'+yScale(data.ema20)+'" x2="'+svgW+'" y2="'+yScale(data.ema20)+'" stroke="var(--warn)" stroke-width="0.5" opacity="0.4"/>';}
    if(data.fvgs&&data.fvgs.length){data.fvgs.forEach(function(f){
      var fTop=yScale(parseFloat(String(f.top).replace(/,/g,'').replace('$','')));var fBot=yScale(parseFloat(String(f.bot).replace(/,/g,'').replace('$','')));
      var fH=Math.abs(fBot-fTop);if(fH<2)fH=2;
      svg+='<rect x="0" y="'+Math.min(fTop,fBot)+'" width="'+svgW+'" height="'+fH+'" fill="'+(f.type==='bullish'?'rgba(0,255,136,.08)':'rgba(255,56,96,.08)')+'" rx="2"/>';
    })}
    cKl.forEach(function(k,i){
      var o=+k[1],hi=+k[2],lo=+k[3],cl=+k[4];
      var x=i*(cW+1)+20;var isGreen=cl>=o;
      var bodyTop=yScale(Math.max(o,cl));var bodyBot=yScale(Math.min(o,cl));var bodyH=Math.max(1,bodyBot-bodyTop);
      var wickTop=yScale(hi);var wickBot=yScale(lo);
      var color=isGreen?'var(--up)':'var(--dn)';
      svg+='<line x1="'+(x+cW/2)+'" y1="'+wickTop+'" x2="'+(x+cW/2)+'" y2="'+wickBot+'" stroke="'+color+'" stroke-width="1"/>';
      svg+='<rect x="'+x+'" y="'+bodyTop+'" width="'+cW+'" height="'+bodyH+'" fill="'+color+'" rx="0.5"/>';
    });
    svg+='<circle cx="'+(svgW-16)+'" cy="'+yScale(data.price)+'" r="3" fill="'+coinColor+'"/>';
    svg+='</svg>';
    h+='<div class="mkt-section"><div class="mkt-section-t">📈 2. '+(isAr?'الرسم البياني 4H — آخر 24 شمعة':'Chart 4H — Last 24 candles')+'</div>';
    h+=svg;
    h+='<div style="display:flex;justify-content:space-between;font-size:8px;color:var(--t3);margin-top:2px;direction:ltr"><span style="color:var(--dn)">▬ R: '+rP(data.resist)+'</span><span style="color:var(--warn)">▬ EMA20</span><span style="color:var(--up)">▬ S: '+rP(data.supp)+'</span>';
    if(data.fvgs&&data.fvgs.length)h+='<span style="color:var(--blue)">░ FVG</span>';
    h+='</div></div>';
  }

  /* ════════ SECTION 3: Timeframe Closings (Enhanced) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🕐 3. '+(isAr?'إغلاقات الشموع — تفصيل لكل فريم':'Candle Closings — Per-frame detail')+'</div>';
  var frames=[];
  if(data.kl1h&&data.kl1h.length>=2){var k1=data.kl1h[data.kl1h.length-1];frames.push({tf:'1H',o:+k1[1],h:+k1[2],l:+k1[3],c:+k1[4],v:+k1[5],rsi:data.rsi,macd:data.macd,tfDir:data.tf.h1});}
  if(data.kl4h&&data.kl4h.length>=2){var k2=data.kl4h[data.kl4h.length-1];frames.push({tf:'4H',o:+k2[1],h:+k2[2],l:+k2[3],c:+k2[4],v:+k2[5],rsi:data.rsi,macd:data.macd,tfDir:data.tf.h4});}
  if(data.kl1d&&data.kl1d.length>=2){var k3=data.kl1d[data.kl1d.length-1];frames.push({tf:isAr?'يومي':'D',o:+k3[1],h:+k3[2],l:+k3[3],c:+k3[4],v:+k3[5],rsi:data.rsi1d,macd:data.macd1d,tfDir:data.tf.d});}
  if(data.kl1d&&data.kl1d.length>=7){var wS=data.kl1d.slice(-7);var wO=+wS[0][1],wH=0,wL=9e12,wC=+wS[wS.length-1][4],wV=0;
    for(var wi=0;wi<wS.length;wi++){if(+wS[wi][2]>wH)wH=+wS[wi][2];if(+wS[wi][3]<wL)wL=+wS[wi][3];wV+=+wS[wi][5]}
    frames.push({tf:isAr?'أسبوعي':'W',o:wO,h:wH,l:wL,c:wC,v:wV,rsi:data.rsi1d,macd:data.macd1d,tfDir:data.tf.w});}
  /* Summary badge */
  var posCount=frames.filter(function(f){return f.c>=f.o}).length;
  var bdgCol=posCount>=3?'var(--up)':posCount<=1?'var(--dn)':'var(--warn)';
  var bdgBg=posCount>=3?'rgba(0,255,136,.08)':posCount<=1?'rgba(255,56,96,.08)':'rgba(255,184,0,.08)';
  h+='<div class="mkt-badge" style="background:'+bdgBg+';color:'+bdgCol+';margin-bottom:8px">'+posCount+'/'+frames.length+' '+(isAr?'فريمات صعودية':'bullish frames')+(posCount>=3?(isAr?' ✅ توافق قوي':' ✅ Strong confluence'):'')+'</div>';
  frames.forEach(function(f){
    var up=f.c>=f.o;var pat=detectCandlePattern(f.o,f.h,f.l,f.c);
    var patName=CANDLE_NAMES[isAr?'ar':'en'][pat]||pat;
    var ic=up?'▲':'▼';
    var dirCol=up?'var(--up)':'var(--dn)';
    var box='<div class="mkt-box" style="border-left:3px solid '+dirCol+'">';
    box+='<div class="mkt-box-t" style="color:'+dirCol+'">'+ic+' '+(isAr?'إغلاق ':'Close ')+f.tf+' — '+patName+'</div>';
    /* What the pattern means */
    var meaning='';
    if(pat==='marubozu_up')meaning=isAr?'شمعة مارُبوزو صعودية — إغلاق قرب القمة دون ظل علوي. ضغط شراء قوي وسيطرة واضحة للمشترين.':'Bullish Marubozu — close near high with no upper shadow. Strong buying pressure.';
    else if(pat==='marubozu_dn')meaning=isAr?'شمعة مارُبوزو هبوطية — إغلاق قرب القاع. ضغط بيع قوي.':'Bearish Marubozu — close near low. Strong selling pressure.';
    else if(pat==='hammer')meaning=isAr?'مطرقة (Hammer) — ظل سفلي طويل. إشارة انعكاس صعودي محتملة.':'Hammer — long lower shadow. Potential bullish reversal signal.';
    else if(pat==='shooting')meaning=isAr?'نجمة هابطة (Shooting Star) — ظل علوي طويل. إشارة انعكاس هبوطي محتملة.':'Shooting Star — long upper shadow. Potential bearish reversal.';
    else if(pat==='doji')meaning=isAr?'دوجي (Doji) — تردد بالسوق. انتظر إغلاق الشمعة التالية.':'Doji — market indecision. Wait for next candle confirmation.';
    else if(pat==='normal_up')meaning=isAr?'شمعة خضراء طبيعية — استمرار الزخم الصعودي.':'Normal green candle — bullish momentum continuation.';
    else if(pat==='normal_dn')meaning=isAr?'شمعة حمراء طبيعية — استمرار الضغط البيعي.':'Normal red candle — bearish pressure continuation.';
    else meaning=isAr?'نمط شمعة قياسي.':'Standard candle.';
    box+='<div style="font-size:10px;color:var(--t1);line-height:1.7;margin:4px 0">'+meaning+'</div>';
    /* Price data */
    box+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'افتتاح':'Open')+' → '+(isAr?'إغلاق':'Close')+'</span><span class="mkt-row-val" style="direction:ltr;color:'+dirCol+'">'+rP(f.o)+' → '+rP(f.c)+'</span></div>';
    box+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'أعلى':'High')+' / '+(isAr?'أدنى':'Low')+'</span><span class="mkt-row-val" style="direction:ltr">'+rP(f.h)+' / '+rP(f.l)+'</span></div>';
    /* RSI + MACD for this timeframe */
    if(f.rsi){
      var rsiState=f.rsi>70?(isAr?'تشبع شرائي':'overbought'):f.rsi<30?(isAr?'تشبع بيعي':'oversold'):(isAr?'صحي':'healthy');
      var rsiCol2=f.rsi>70?'var(--dn)':f.rsi<30?'var(--up)':'var(--t0)';
      box+='<div class="mkt-row"><span class="mkt-row-label">RSI</span><span class="mkt-row-val" style="color:'+rsiCol2+'">'+Math.round(f.rsi)+' — '+rsiState+'</span></div>';
    }
    if(f.macd){
      var macdTxt=f.macd.cross==='bull'?(isAr?'🟢 تقاطع صعودي':'🟢 Bull cross'):f.macd.cross==='bear'?(isAr?'🔴 تقاطع هبوطي':'🔴 Bear cross'):f.macd.h>0?(isAr?'إيجابي':'positive'):(isAr?'سلبي':'negative');
      box+='<div class="mkt-row"><span class="mkt-row-label">MACD</span><span class="mkt-row-val" style="color:'+(f.macd.h>0?'var(--up)':'var(--dn)')+'">'+macdTxt+'</span></div>';
    }
    /* Confirmation / invalidation */
    var confirm='';
    if(up&&pat!=='doji')confirm=isAr?'✅ يؤكد الصعود لو الشمعة القادمة تغلق فوق '+rP(f.c)+'. يُلغى تحت '+rP(f.l)+'.':'✅ Bullish confirmation if next close above '+rP(f.c)+'. Invalidated below '+rP(f.l)+'.';
    else if(!up&&pat!=='doji')confirm=isAr?'⚠️ يؤكد الهبوط لو إغلاق تحت '+rP(f.c)+'. يُلغى فوق '+rP(f.h)+'.':'⚠️ Bearish confirmation below '+rP(f.c)+'. Invalidated above '+rP(f.h)+'.';
    else confirm=isAr?'⏳ بانتظار الإغلاق التالي للتأكيد.':'⏳ Awaiting next close for confirmation.';
    box+='<div class="mkt-assess">'+confirm+'</div>';
    box+='</div>';
    h+=box;
  });
  h+='</div>';

  /* ════════ SECTION 4: Market Structure (SMC) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🏗️ 4. '+(isAr?'هيكل السوق (SMC)':'Market Structure (SMC)')+'</div>';
  var stCol=data.struct==='HH/HL'?'var(--up)':data.struct==='LH/LL'?'var(--dn)':'var(--warn)';
  var stLabel=data.struct==='HH/HL'?(isAr?'قمم أعلى + قيعان أعلى — هيكل صعودي كلاسيكي':'Higher Highs + Higher Lows — classic bullish structure'):data.struct==='LH/LL'?(isAr?'قمم أدنى + قيعان أدنى — هيكل هبوطي':'Lower Highs + Lower Lows — bearish structure'):data.struct==='Range'?(isAr?'نطاق جانبي — تجميع أو توزيع':'Range — accumulation or distribution'):(isAr?'غير واضح':'Unclear');
  h+='<div class="mkt-box">';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'النمط':'Pattern')+'</span><span class="mkt-row-val" style="font-weight:800;color:'+stCol+'">'+data.struct+'</span></div>';
  h+='<div style="font-size:10px;color:var(--t1);margin:4px 0;line-height:1.6">'+stLabel+'</div>';
  if(data.bos)h+='<div class="mkt-row"><span class="mkt-row-label">BOS ('+(isAr?'كسر هيكل':'Break of Structure')+')</span><span class="mkt-row-val" style="direction:ltr;color:var(--blue)">'+data.bos+'</span></div>';
  if(data.choch)h+='<div class="mkt-row"><span class="mkt-row-label">ChoCH ('+(isAr?'تغير الشخصية':'Change of Character')+')</span><span class="mkt-row-val" style="direction:ltr;color:var(--purple)">'+data.choch+'</span></div>';
  h+='</div></div>';

  /* ════════ SECTION 5: FVG + Order Blocks (merged) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">📦 5. '+(isAr?'فجوات القيمة (FVG) + Order Blocks':'Fair Value Gaps + Order Blocks')+'</div>';
  if(data.orderBlocks&&data.orderBlocks.length){
    h+='<div class="mkt-box"><div class="mkt-box-t">'+(isAr?'Order Blocks — مناطق سيولة مؤسسية':'Order Blocks — institutional liquidity zones')+'</div>';
    data.orderBlocks.forEach(function(ob){
      var obUp=ob.type==='bullish';
      h+='<div class="mkt-row"><span class="mkt-row-label">'+(obUp?'🟢':'🔴')+' '+(obUp?(isAr?'صعودي':'Bullish'):(isAr?'هبوطي':'Bearish'))+'</span><span class="mkt-row-val" style="direction:ltr;color:'+(obUp?'var(--up)':'var(--dn)')+'">'+ob.price+'</span></div>';
    });
    h+='</div>';
  }
  if(data.fvgs&&data.fvgs.length){
    h+='<div class="mkt-box"><div class="mkt-box-t">FVG — '+(isAr?'فجوات سعرية غير ممتلئة':'unfilled price gaps')+'</div>';
    h+='<div style="font-size:9px;color:var(--t2);margin-bottom:6px;line-height:1.6">'+(isAr?'السعر يعود غالباً لملء الفجوة قبل مواصلة الاتجاه.':'Price often returns to fill the gap before continuing.')+'</div>';
    data.fvgs.forEach(function(fg){
      var fgUp=fg.type==='bullish';
      h+='<div class="mkt-row" style="background:'+(fgUp?'rgba(0,255,136,.03)':'rgba(255,56,96,.03)')+';border-radius:6px;padding:5px 6px;margin-bottom:3px">';
      h+='<span class="mkt-row-label">'+(fgUp?'🟢':'🔴')+' '+(fgUp?(isAr?'صعودي':'Bullish'):(isAr?'هبوطي':'Bearish'))+'</span>';
      h+='<span class="mkt-row-val" style="direction:ltr;color:'+(fgUp?'var(--up)':'var(--dn)')+'">'+fg.bot+' — '+fg.top+'</span>';
      h+='</div>';
    });
    h+='</div>';
  }
  if((!data.orderBlocks||!data.orderBlocks.length)&&(!data.fvgs||!data.fvgs.length)){
    h+='<div class="mkt-box" style="text-align:center;color:var(--t3);font-size:12px">'+(isAr?'لا FVG / OB واضحة حالياً':'No active FVG / OB')+'</div>';
  }
  h+='</div>';

  /* ════════ SECTION 6: Key Levels Map ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🗺️ 6. '+(isAr?'المستويات الرئيسية':'Key Levels')+'</div>';
  h+='<div class="mkt-box">';
  var levels=[];
  levels.push({tag:'R2',label:isAr?'مقاومة رئيسية':'Major Resistance',price:data.f100U,col:'var(--dn)'});
  levels.push({tag:'R1',label:isAr?'مقاومة / منطقة عرض':'Resistance / Supply',price:data.resist,col:'var(--dn)'});
  levels.push({tag:'▶',label:isAr?'السعر الحالي':'Current Price',price:data.price,col:'var(--blue)',highlight:true});
  levels.push({tag:'S1',label:isAr?'دعم / منطقة طلب':'Support / Demand',price:data.supp,col:'var(--up)'});
  if(data.ema50&&data.ema50<data.supp)levels.push({tag:'S2',label:'EMA50',price:data.ema50,col:'var(--warn)'});
  levels.sort(function(a,b){return b.price-a.price});
  levels.forEach(function(lv){
    var bg=lv.highlight?'rgba(91,156,255,.06)':'transparent';
    h+='<div class="mkt-row" style="background:'+bg+';border-radius:4px;padding:5px 4px">';
    h+='<span class="mkt-row-label"><span style="font-size:12px;padding:2px 5px;border-radius:3px;font-weight:700;background:'+lv.col+'15;color:'+lv.col+'">'+lv.tag+'</span> '+lv.label+'</span>';
    h+='<span class="mkt-row-val" style="direction:ltr;color:'+lv.col+'">'+rP(lv.price)+'</span>';
    h+='</div>';
  });
  h+='</div></div>';

  /* ════════ SECTION 7: Technical Indicators ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">📊 7. '+(isAr?'المؤشرات الفنية':'Technical Indicators')+'</div>';
  h+='<div class="mkt-box"><div class="mkt-box-t">'+(isAr?'فريم 4H':'4H Frame')+'</div>';
  var rsiCol=data.rsi<30?'var(--up)':data.rsi>70?'var(--dn)':'var(--t0)';
  var rsiLabel=data.rsi<30?(isAr?'منطقة شراء':'Oversold'):data.rsi>70?(isAr?'منطقة بيع':'Overbought'):data.rsi>=40&&data.rsi<=60?(isAr?'صحي':'Healthy'):(isAr?'مقبول':'Normal');
  h+='<div class="mkt-row"><span class="mkt-row-label">RSI</span><span class="mkt-row-val" style="color:'+rsiCol+'">'+Math.round(data.rsi)+' — '+rsiLabel+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">MACD</span><span class="mkt-row-val" style="color:'+(data.macd.h>0?'var(--up)':'var(--dn)')+'">'+(data.macd.h>0?'🟢 ':'🔴 ')+(data.macd.cross==='bull'?(isAr?'تقاطع صعودي':'Bull Cross'):data.macd.cross==='bear'?(isAr?'تقاطع هبوطي':'Bear Cross'):(data.macd.h>0?(isAr?'إيجابي':'Positive'):(isAr?'سلبي':'Negative')))+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">EMA20</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.price>data.ema20?'var(--up)':'var(--dn)')+'">'+rP(data.ema20)+' '+(data.price>data.ema20?'✅':'❌')+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">EMA50</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.price>data.ema50?'var(--up)':'var(--dn)')+'">'+rP(data.ema50)+' '+(data.price>data.ema50?'✅':'❌')+'</span></div>';
  if(data.divRSI!=='none'||data.divRSI1d!=='none'){
    var divTxt=data.divRSI!=='none'?(isAr?'دايفرجنس على 4H':'RSI Div on 4H'):(isAr?'دايفرجنس على اليومي':'RSI Div on Daily');
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'دايفرجنس':'Divergence')+'</span><span class="mkt-row-val" style="color:var(--warn)">⚠️ '+divTxt+'</span></div>';
  }
  h+='</div>';
  /* Futures data */
  h+='<div class="mkt-box"><div class="mkt-box-t">'+(isAr?'بيانات العقود':'Futures Data')+'</div>';
  if(data.fr){
    var frCol=data.fr.rate<0?'var(--up)':data.fr.rate>0.05?'var(--dn)':'var(--t0)';
    var frLabel=data.fr.rate<0?(isAr?'سلبي = فرصة':'Negative = Opportunity'):data.fr.rate>0.05?(isAr?'عالي = خطر':'High = Risk'):(isAr?'طبيعي':'Normal');
    h+='<div class="mkt-row"><span class="mkt-row-label">Funding Rate</span><span class="mkt-row-val" style="direction:ltr;color:'+frCol+'">'+(data.fr.rate>=0?'+':'')+data.fr.rate.toFixed(4)+'% — '+frLabel+'</span></div>';
  }
  if(data.oi)h+='<div class="mkt-row"><span class="mkt-row-label">Open Interest</span><span class="mkt-row-val" style="direction:ltr">'+fmt(data.oi)+'</span></div>';
  if(data.oiHist)h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'تغير OI 24س':'OI 24h change')+'</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.oiHist.growth>0?'var(--up)':'var(--dn)')+'">'+(data.oiHist.growth>=0?'+':'')+data.oiHist.growth.toFixed(1)+'%</span></div>';
  if(data.ls)h+='<div class="mkt-row"><span class="mkt-row-label">Long/Short</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.ls.ratio>1.5?'var(--dn)':data.ls.ratio<0.8?'var(--up)':'var(--t0)')+'">'+data.ls.ratio.toFixed(2)+' (L:'+data.ls.long.toFixed(0)+'% S:'+data.ls.short.toFixed(0)+'%)</span></div>';
  if(typeof bookTickers!=='undefined'&&bookTickers[sym]){var spd=bookTickers[sym];
    h+='<div class="mkt-row"><span class="mkt-row-label">Bid/Ask Spread</span><span class="mkt-row-val" style="direction:ltr;color:'+(spd.spread>0.05?'var(--dn)':'var(--up)')+'">'+spd.spread.toFixed(3)+'% '+(spd.spread>0.05?(isAr?'(سيولة ضعيفة)':'(low liq)'):(isAr?'(سيولة جيدة)':'(good liq)'))+'</span></div>';
  }
  h+='</div></div>';

  /* ════════ SECTION 8: Whale Intelligence (Enhanced) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🐋 8. '+(isAr?'استخبارات الحيتان':'Whale Intelligence')+'</div>';
  h+='<div class="mkt-box">';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'ثقة الحيتان':'Whale Confidence')+'</span><span class="mkt-row-val" style="color:'+(data.wConf>=50?'var(--up)':data.wConf>=30?'var(--warn)':'var(--t3)')+'">'+data.wConf+'%</span></div>';
  var wwL=typeof whaleWaves!=='undefined'?whaleWaves[sym]:null;
  if(wwL&&wwL.waves&&wwL.waves.length){
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'موجات التجميع':'Accumulation waves')+'</span><span class="mkt-row-val">'+wwL.waves.length+'</span></div>';
  }
  /* Whale P&L */
  if(data.whalePnL){
    var pnlCol=data.whalePnL.pct>1?'var(--up)':data.whalePnL.pct<-3?'var(--dn)':'var(--warn)';
    var pnlText=data.whalePnL.pct>1?(isAr?'الحيتان رابحون — احتمال جني أرباح':'Whales profitable — may take profits'):data.whalePnL.pct<-3?(isAr?'الحيتان خاسرون — ضغط بيع':'Whales losing — sell pressure'):(isAr?'شبه متعادل':'Near breakeven');
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'ربح/خسارة الحيتان':'Whale P&L')+'</span><span class="mkt-row-val" style="color:'+pnlCol+';direction:ltr">'+(data.whalePnL.pct>=0?'+':'')+data.whalePnL.pct.toFixed(1)+'% — '+pnlText+'</span></div>';
  }
  /* Flow rate */
  if(data.flowRate>1000){
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'سرعة التدفق':'Flow Rate')+'</span><span class="mkt-row-val" style="color:var(--neon);direction:ltr">$'+fmt(data.flowRate)+(isAr?'/دقيقة':'/min')+'</span></div>';
  }
  /* Iceberg */
  if(data.iceberg&&data.iceberg.signal&&data.iceberg.signal!=='NONE'){
    var iceUp=data.iceberg.signal==='ICEBERG_BUY';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'أوامر مخفية':'Iceberg Orders')+'</span><span class="mkt-row-val" style="color:'+(iceUp?'var(--up)':'var(--dn)')+'">'+(iceUp?'🧊 '+(isAr?'شراء مخفي — تجميع':'Hidden buying'):'🧊 '+(isAr?'بيع مخفي — توزيع':'Hidden selling'))+(data.iceberg.count?' ('+data.iceberg.count+')':'')+'</span></div>';
  }
  /* Absorption */
  if(data.absorption&&data.absorption.signal==='BULLISH_ABSORPTION'){
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'الامتصاص':'Absorption')+'</span><span class="mkt-row-val" style="color:var(--up)">💧 '+(isAr?'نشط — الحوت يمتص البيع':'Active — whale absorbing sells')+'</span></div>';
  }
  /* CVD */
  if(data.cvd){
    var cvdCol=data.cvd.divergence==='BULLISH'?'var(--up)':data.cvd.divergence==='BEARISH'?'var(--dn)':'var(--t0)';
    h+='<div class="mkt-row"><span class="mkt-row-label">CVD</span><span class="mkt-row-val" style="color:'+cvdCol+'">'+(data.cvd.signal||'NEUTRAL')+(data.cvd.divergence!=='NONE'?' — '+data.cvd.divergence:'')+'</span></div>';
  }
  /* Summary */
  var wSummary;
  if(data.wConf>=50)wSummary=isAr?'🐋 تجميع قوي — إشارة إيجابية':'🐋 Strong accumulation — positive';
  else if(data.wConf>=30)wSummary=isAr?'🐋 نشاط متوسط':'🐋 Moderate activity';
  else wSummary=isAr?'🐋 لا نشاط واضح':'🐋 No clear activity';
  h+='<div class="mkt-assess">'+wSummary+'</div>';
  h+='</div></div>';

  /* ════════ SECTION 9: Smart Money Dashboard (NEW) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🧠 9. '+(isAr?'لوحة ذكاء المال':'Smart Money Dashboard')+'</div>';
  h+='<div class="mkt-box">';
  var smartItems=[],smartBullCount=0,smartTotalCount=0;
  if(data.topTraders){smartTotalCount++;var ttBull=data.topTraders.long>0.55;if(ttBull)smartBullCount++;
    var ttTrend=data.topTraders.trend==='up'?'↑':'↓';
    smartItems.push({ic:'🏆',label:isAr?'كبار المتداولين (Top 20%)':'Top Traders (Top 20%)',val:Math.round(data.topTraders.long*100)+'% Long '+ttTrend,bull:ttBull,col:ttBull?'var(--up)':'var(--dn)'});
  }
  if(data.cbPrem){smartTotalCount++;var cbBull=data.cbPrem.pct>0.1;if(cbBull)smartBullCount++;
    smartItems.push({ic:'🏦',label:isAr?'بريميوم Coinbase':'Coinbase Premium',val:(data.cbPrem.pct>=0?'+':'')+data.cbPrem.pct.toFixed(3)+'% '+(data.cbPrem.pct>0.15?(isAr?'(مؤسسات تشتري)':'(institutions buying)'):data.cbPrem.pct<-0.15?(isAr?'(مؤسسات تبيع)':'(institutions selling)'):''),bull:cbBull,col:cbBull?'var(--up)':data.cbPrem.pct<-0.1?'var(--dn)':'var(--warn)'});
  }
  if(data.bfxMargin){smartTotalCount++;var bfxBull=data.bfxMargin.longPct>55;if(bfxBull)smartBullCount++;
    smartItems.push({ic:'📊',label:isAr?'هامش Bitfinex':'Bitfinex Margin',val:data.bfxMargin.longPct.toFixed(0)+'% Long / '+data.bfxMargin.shortPct.toFixed(0)+'% Short',bull:bfxBull,col:bfxBull?'var(--up)':data.bfxMargin.shortPct>55?'var(--dn)':'var(--warn)'});
  }
  if(data.hlFunding){smartTotalCount++;var hlBull=data.hlFunding.rate<0;if(hlBull)smartBullCount++;
    smartItems.push({ic:'🔬',label:'Hyperliquid DEX',val:'FR '+(data.hlFunding.rate>=0?'+':'')+data.hlFunding.rate.toFixed(4)+'%',bull:hlBull,col:hlBull?'var(--up)':'var(--dn)'});
  }
  if(data.vpinData){smartTotalCount++;var vpBull=data.vpinData.vpin>0.5;if(vpBull)smartBullCount++;
    smartItems.push({ic:'📡',label:'VPIN',val:data.vpinData.vpin.toFixed(2)+' '+(data.vpinData.vpin>0.6?(isAr?'(تداول مُطّلع عالي)':'(high informed trading)'):(isAr?'(طبيعي)':'(normal)')),bull:vpBull,col:vpBull?'var(--neon)':'var(--t2)'});
  }
  if(data.absorption&&data.absorption.signal){smartTotalCount++;var absBull=data.absorption.signal==='BULLISH_ABSORPTION';if(absBull)smartBullCount++;
    smartItems.push({ic:'💧',label:isAr?'امتصاص':'Absorption',val:absBull?(isAr?'نشط صعودي':'Active bullish'):(isAr?'لا شيء':'None'),bull:absBull,col:absBull?'var(--up)':'var(--t3)'});
  }
  if(data.iceberg&&data.iceberg.signal&&data.iceberg.signal!=='NONE'){smartTotalCount++;var iceBull=data.iceberg.signal==='ICEBERG_BUY';if(iceBull)smartBullCount++;
    smartItems.push({ic:'🧊',label:isAr?'أوامر Iceberg':'Iceberg Orders',val:iceBull?(isAr?'شراء مخفي':'Hidden buying'):(isAr?'بيع مخفي':'Hidden selling'),bull:iceBull,col:iceBull?'var(--up)':'var(--dn)'});
  }
  if(smartItems.length){
    smartItems.forEach(function(si){
      h+='<div class="mkt-row"><span class="mkt-row-label">'+si.ic+' '+si.label+'</span><span class="mkt-row-val" style="color:'+si.col+';direction:ltr">'+si.val+'</span></div>';
    });
    var verdictCol=smartBullCount>=smartTotalCount*0.65?'var(--up)':smartBullCount<=smartTotalCount*0.35?'var(--dn)':'var(--warn)';
    var verdictTxt=smartBullCount>=smartTotalCount*0.65?(isAr?'✅ ذكاء المال صعودي — اتفاق':'✅ Smart money bullish — aligned'):smartBullCount<=smartTotalCount*0.35?(isAr?'⚠️ ذكاء المال هبوطي':'⚠️ Smart money bearish'):(isAr?'⚖️ منقسم':'⚖️ Split');
    h+='<div class="mkt-assess" style="color:'+verdictCol+';font-weight:700">'+smartBullCount+' '+(isAr?'من':'of')+' '+smartTotalCount+' — '+verdictTxt+'</div>';
  }else{
    h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:8px">'+(isAr?'لا بيانات ذكاء مال متوفرة':'No smart money data')+'</div>';
  }
  h+='</div></div>';

  /* ════════ SECTION 10: FR Multi-Exchange (NEW) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🔮 10. '+(isAr?'معدلات التمويل — مقارنة متعددة المنصات':'FR — Multi-Exchange Comparison')+'</div>';
  h+='<div class="mkt-box">';
  var frSources=[];
  if(data.fr)frSources.push({n:'Binance',r:data.fr.rate});
  if(data.hlFunding)frSources.push({n:'Hyperliquid',r:data.hlFunding.rate});
  if(typeof coinalyzeFR!=='undefined'&&coinalyzeFR[sym])frSources.push({n:'Coinalyze ('+(isAr?'مجمّع':'Agg')+')',r:coinalyzeFR[sym].rate});
  if(typeof coinalyzePredFR!=='undefined'&&coinalyzePredFR[sym])frSources.push({n:isAr?'المتوقع':'Predicted',r:coinalyzePredFR[sym].rate,pred:true});
  if(frSources.length){
    frSources.forEach(function(fs){
      var frC=fs.r<0?'var(--up)':fs.r>0.05?'var(--dn)':'var(--warn)';
      var ic=fs.pred?'🔮':fs.r<0?'🟢':fs.r>0.05?'🔴':'🟡';
      h+='<div class="mkt-row"><span class="mkt-row-label">'+ic+' '+fs.n+'</span><span class="mkt-row-val" style="color:'+frC+';direction:ltr;font-family:var(--fm)">'+(fs.r>=0?'+':'')+fs.r.toFixed(4)+'%</span></div>';
    });
  }
  /* FR History mini-bars */
  if(data.frHist&&data.frHist.data.length>=4){
    var fhData=data.frHist.data.slice(-50);
    var maxAbs=Math.max.apply(null,fhData.map(function(x){return Math.abs(x.rate)}));if(maxAbs===0)maxAbs=0.01;
    var bars='<div style="display:flex;align-items:flex-end;gap:1px;height:32px;padding:4px 0">';
    fhData.forEach(function(x){
      var bH=Math.max(1,Math.abs(x.rate)/maxAbs*28);
      var bC=x.rate<0?'var(--up)':'var(--dn)';
      bars+='<div style="flex:1;height:'+bH+'px;background:'+bC+';border-radius:1px;opacity:'+(0.4+Math.abs(x.rate)/maxAbs*0.6)+'"></div>';
    });
    bars+='</div>';
    h+='<div style="margin-top:8px"><div class="mkt-box-t">'+(isAr?'تاريخ FR — آخر '+fhData.length+' فترة':'FR History — last '+fhData.length+' periods')+'</div>'+bars;
    var negInterpret=data.frHist.negCount>=7?(isAr?'سلبي باستمرار — الشورتات تدفع للونقات = صعودي':'Consistently negative — shorts paying longs = bullish'):data.frHist.negCount>=5?(isAr?'سلبي في الغالب':'Mostly negative'):data.frHist.negCount<=3?(isAr?'إيجابي في الغالب — جشع':'Mostly positive — greed'):(isAr?'متذبذب':'Mixed');
    h+='<div style="font-size:10px;color:var(--t1);margin-top:4px">'+data.frHist.negCount+'/'+data.frHist.totalCount+' '+(isAr?'قراءات سلبية — ':'negative readings — ')+negInterpret+'</div></div>';
  }
  h+='</div></div>';

  /* ════════ SECTION 11: Liquidation Zones (NEW) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">💥 11. '+(isAr?'مناطق التصفية — مغناطيس السعر':'Liquidation Zones — Price Magnets')+'</div>';
  h+='<div class="mkt-box">';
  var longLiq=0,shortLiq=0;
  if(data.liqZones&&data.liqZones.length){
    data.liqZones.forEach(function(lz){if(lz.side==='Long')longLiq+=lz.amt;else shortLiq+=lz.amt});
  }
  if(data.aggLiq){longLiq+=data.aggLiq.longVol;shortLiq+=data.aggLiq.shortVol;}
  var totalLiq=longLiq+shortLiq;
  if(totalLiq>0){
    h+='<div style="font-size:10px;color:var(--t2);margin-bottom:8px;line-height:1.6">'+(isAr?'السعر يميل لجذب نحو مناطق التصفية الأكبر (short squeeze / long squeeze).':'Price tends to pull toward the larger liquidation cluster (short/long squeeze).')+'</div>';
    var shortPct=Math.round(shortLiq/totalLiq*100);
    /* Visual bar: above (shorts liquidating = bullish magnet) vs below (longs = bearish magnet) */
    h+='<div style="padding:8px;background:rgba(255,56,96,.04);border-radius:6px;margin-bottom:4px">';
    h+='<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px"><span>🔴 '+(isAr?'فوق السعر — تصفيات Short':'Above — Short liquidations')+'</span><span style="font-family:var(--fm);font-weight:800;color:var(--dn)">$'+fmt(shortLiq)+'</span></div>';
    h+='<div style="height:6px;background:var(--bg2);border-radius:3px;overflow:hidden"><div style="width:'+shortPct+'%;height:100%;background:var(--dn)"></div></div>';
    h+='</div>';
    h+='<div style="text-align:center;padding:4px;font-family:var(--fm);font-size:11px;color:var(--blue)">▬▬▬ '+(isAr?'السعر الحالي':'Current')+' '+rP(data.price)+' ▬▬▬</div>';
    var longPct=100-shortPct;
    h+='<div style="padding:8px;background:rgba(0,255,136,.04);border-radius:6px;margin-top:4px">';
    h+='<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px"><span>🟢 '+(isAr?'تحت السعر — تصفيات Long':'Below — Long liquidations')+'</span><span style="font-family:var(--fm);font-weight:800;color:var(--up)">$'+fmt(longLiq)+'</span></div>';
    h+='<div style="height:6px;background:var(--bg2);border-radius:3px;overflow:hidden"><div style="width:'+longPct+'%;height:100%;background:var(--up)"></div></div>';
    h+='</div>';
    /* Verdict */
    var liqVerdict='';
    if(shortLiq>longLiq*1.5)liqVerdict=isAr?'🧲 المغناطيس للأعلى — سيولة Short أكبر = احتمال short squeeze صعودي':'🧲 Magnet up — more short liquidity = potential short squeeze';
    else if(longLiq>shortLiq*1.5)liqVerdict=isAr?'🧲 المغناطيس للأسفل — سيولة Long أكبر = احتمال long squeeze هبوطي':'🧲 Magnet down — more long liquidity = potential long squeeze';
    else liqVerdict=isAr?'⚖️ متوازن — لا تحيز واضح':'⚖️ Balanced — no clear bias';
    h+='<div class="mkt-assess">'+liqVerdict+'</div>';
  }else{
    h+='<div style="text-align:center;color:var(--t3);font-size:11px;padding:8px">'+(isAr?'لا تصفيات مهمة في آخر ساعة':'No significant liquidations in last hour')+'</div>';
  }
  h+='</div></div>';

  /* ════════ SECTION 12: BTC↔ETH Correlation (NEW) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🔗 12. '+(isAr?'العلاقة BTC ↔ ETH':'BTC ↔ ETH Correlation')+'</div>';
  h+='<div class="mkt-box">';
  if(data.btcChange!==null&&data.ethChange!==null){
    h+='<div class="mkt-row"><span class="mkt-row-label">BTC 24h</span><span class="mkt-row-val" style="color:'+(data.btcChange>=0?'var(--up)':'var(--dn)')+';direction:ltr">'+(data.btcChange>=0?'+':'')+data.btcChange.toFixed(2)+'%</span></div>';
    h+='<div class="mkt-row"><span class="mkt-row-label">ETH 24h</span><span class="mkt-row-val" style="color:'+(data.ethChange>=0?'var(--up)':'var(--dn)')+';direction:ltr">'+(data.ethChange>=0?'+':'')+data.ethChange.toFixed(2)+'%</span></div>';
    /* Simple correlation signal from signs */
    var bothUp=data.btcChange>0&&data.ethChange>0;
    var bothDown=data.btcChange<0&&data.ethChange<0;
    var corrLabel=bothUp||bothDown?(isAr?'قوي (متزامنان)':'Strong (aligned)'):(isAr?'ضعيف (منفصلان)':'Weak (divergent)');
    var corrVal=bothUp||bothDown?'≈ 0.85':'≈ 0.35';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'الارتباط':'Correlation')+'</span><span class="mkt-row-val" style="font-family:var(--fm)">'+corrVal+' — '+corrLabel+'</span></div>';
  }
  if(typeof btcDom!=='undefined'){
    var domTrend=btcDom>55?'↑':btcDom<50?'↓':'→';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(isAr?'هيمنة BTC':'BTC Dominance')+'</span><span class="mkt-row-val" style="font-family:var(--fm)">'+btcDom.toFixed(1)+'% '+domTrend+'</span></div>';
  }
  if(data.ethBtcRatio){
    h+='<div class="mkt-row"><span class="mkt-row-label">ETH/BTC</span><span class="mkt-row-val" style="font-family:var(--fm);direction:ltr">'+data.ethBtcRatio.toFixed(5)+'</span></div>';
  }
  /* Altseason signal */
  if(data.ethChange!==null&&data.btcChange!==null){
    var altSig='';
    if(data.ethChange>data.btcChange+1)altSig=isAr?'🚀 ETH يتفوق — بداية محتملة لموسم البدائل':'🚀 ETH outperforming — potential altseason start';
    else if(data.btcChange>data.ethChange+1)altSig=isAr?'🛡️ BTC يقود — المال يتجه للأمان':'🛡️ BTC leading — money seeking safety';
    else altSig=isAr?'⚖️ تحرك متوازي':'⚖️ Parallel movement';
    h+='<div class="mkt-assess">'+altSig+'</div>';
  }
  h+='</div></div>';

  /* ════════ SECTION 13: Market Context Bar (NEW) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🌍 13. '+(isAr?'سياق السوق':'Market Context')+'</div>';
  h+='<div class="mkt-box" style="padding:10px">';
  var ctxChips='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">';
  /* Fear & Greed */
  if(typeof fgValue!=='undefined'){
    var fgC=fgValue<30?'var(--dn)':fgValue>60?'var(--up)':'var(--warn)';
    var fgL=fgValue<25?(isAr?'خوف شديد':'Extreme fear'):fgValue<45?(isAr?'خوف':'Fear'):fgValue<55?(isAr?'محايد':'Neutral'):fgValue<75?(isAr?'طمع':'Greed'):(isAr?'طمع شديد':'Extreme greed');
    ctxChips+='<span style="padding:3px 8px;background:'+fgC+'15;color:'+fgC+';border-radius:8px;font-size:10px;font-weight:700">'+(isAr?'خوف/طمع: ':'F&G: ')+fgValue+' — '+fgL+'</span>';
  }
  /* BTC Dom */
  if(typeof btcDom!=='undefined'){
    ctxChips+='<span style="padding:3px 8px;background:rgba(247,147,26,.1);color:#f7931a;border-radius:8px;font-size:10px;font-weight:700">BTC Dom: '+btcDom.toFixed(1)+'%</span>';
  }
  /* News */
  if(data.newsScore){
    var nsC=data.newsScore.score>60?'var(--up)':data.newsScore.score<40?'var(--dn)':'var(--warn)';
    ctxChips+='<span style="padding:3px 8px;background:'+nsC+'15;color:'+nsC+';border-radius:8px;font-size:10px;font-weight:700">'+(isAr?'أخبار: ':'News: ')+data.newsScore.score+'%+</span>';
  }
  /* Stablecoin flow */
  if(data.stableFlow&&data.stableFlow.usdt>0){
    ctxChips+='<span style="padding:3px 8px;background:rgba(91,156,255,.1);color:var(--blue);border-radius:8px;font-size:10px;font-weight:700">USDT: '+fmtB(data.stableFlow.usdt)+'</span>';
  }
  ctxChips+='</div>';
  h+=ctxChips;
  /* Upcoming unlocks */
  if(data.unlocks&&data.unlocks.length){
    h+='<div style="margin-top:4px">';
    data.unlocks.forEach(function(u){
      var dt=new Date(u.date);var days=Math.ceil((dt-Date.now())/86400000);
      h+='<div style="font-size:10px;color:var(--warn);margin:3px 0">🔓 '+(isAr?'فك ':'Unlock ')+u.sym+' $'+fmt(u.amount)+' '+(isAr?'بعد ':'in ')+days+(isAr?' يوم':'d')+'</div>';
    });
    h+='</div>';
  }
  /* On-chain (BTC only) */
  if(data.onChain&&data.onChain.hashRate){
    var hrEH=data.onChain.hashRate/1e9;
    h+='<div style="font-size:10px;color:var(--t1);margin-top:4px">⛏ Hash Rate: <span style="font-family:var(--fm);color:var(--up)">'+hrEH.toFixed(0)+' EH/s</span> '+(hrEH>500?(isAr?'— شبكة قوية':'— strong network'):(isAr?'— شبكة متوسطة':'— moderate'))+'</div>';
  }
  h+='</div></div>';

  /* ════════ SECTION 14: Multi-Level Entry Zones (Enhanced) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">🎯 14. '+(isAr?'مناطق الدخول متعددة المستويات':'Multi-Level Entry Zones')+'</div>';
  var zones=[];
  /* Zone 1 — aggressive (current price) */
  var z1Entry=data.price;var z1Stop=data.f618D;var z1Target=data.f618U;
  var z1RR=Math.abs(z1Entry-z1Stop)>0?((z1Target-z1Entry)/Math.abs(z1Entry-z1Stop)):0;
  zones.push({n:1,type:isAr?'عدوانية':'Aggressive',col:'var(--up)',bg:'rgba(0,255,136,.06)',range:rP(z1Entry),stop:z1Stop,target:z1Target,rr:z1RR,reason:isAr?'فوق EMA20 + '+(data.macd.h>0?'MACD صعودي':'MACD محايد'):'Above EMA20 + '+(data.macd.h>0?'MACD bull':'MACD flat')});
  /* Zone 2 — safe (at FVG or EMA50) */
  var z2Mid=data.ema50?Math.min(data.ema50,data.supp*1.01):data.supp*1.01;
  var z2Lo=z2Mid*0.995;var z2Hi=z2Mid*1.005;
  var z2Stop=data.supp*0.98;var z2Target=data.f618U;
  var z2RR=Math.abs(z2Mid-z2Stop)>0?((z2Target-z2Mid)/Math.abs(z2Mid-z2Stop)):0;
  var z2Reasons=[];
  if(data.ema50)z2Reasons.push('EMA50');
  if(data.fvgs&&data.fvgs.some(function(f){return f.type==='bullish'}))z2Reasons.push(isAr?'فجوة صعودية':'Bullish FVG');
  z2Reasons.push(isAr?'ارتد مراراً':'Prior bounces');
  zones.push({n:2,type:isAr?'آمنة':'Safe',col:'var(--blue)',bg:'rgba(91,156,255,.06)',range:rP(z2Lo)+' - '+rP(z2Hi),stop:z2Stop,target:z2Target,rr:z2RR,reason:z2Reasons.join(' + ')});
  /* Zone 3 — deep (OB + weekly support) */
  var z3Hi=data.supp;var z3Lo=data.supp*0.97;
  var z3Stop=data.supp*0.95;var z3Target=data.f100U;
  var z3Mid=(z3Hi+z3Lo)/2;
  var z3RR=Math.abs(z3Mid-z3Stop)>0?((z3Target-z3Mid)/Math.abs(z3Mid-z3Stop)):0;
  var z3Reasons=[];
  if(data.orderBlocks&&data.orderBlocks.some(function(ob){return ob.type==='bullish'}))z3Reasons.push('Order Block');
  z3Reasons.push(isAr?'Fib 0.618':'Fib 0.618');
  z3Reasons.push(isAr?'دعم أسبوعي':'Weekly support');
  zones.push({n:3,type:isAr?'عميقة':'Deep',col:'var(--purple)',bg:'rgba(176,124,255,.06)',range:rP(z3Lo)+' - '+rP(z3Hi),stop:z3Stop,target:z3Target,rr:z3RR,reason:z3Reasons.join(' + ')});
  /* Render zones */
  zones.forEach(function(z){
    h+='<div style="padding:10px;background:'+z.bg+';border:1px solid '+z.col+'20;border-left:3px solid '+z.col+';border-radius:8px;margin-bottom:6px">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-weight:800;color:'+z.col+';font-size:12px">'+(isAr?'المنطقة ':'Zone ')+z.n+' — '+z.type+'</span><span style="font-family:var(--fm);font-weight:700;color:'+z.col+';direction:ltr">'+z.range+'</span></div>';
    h+='<div style="font-size:10px;color:var(--t1);margin-bottom:4px">'+z.reason+'</div>';
    h+='<div style="display:flex;gap:8px;font-size:10px;direction:ltr">';
    h+='<span style="color:var(--up)">TP: '+rP(z.target)+'</span>';
    h+='<span style="color:var(--dn)">SL: '+rP(z.stop)+'</span>';
    h+='<span style="color:'+z.col+';font-weight:800">R:R 1:'+z.rr.toFixed(1)+'x</span>';
    h+='</div></div>';
  });
  /* Overall targets */
  h+='<div style="padding:8px;background:var(--bg2);border-radius:8px;margin-top:4px;text-align:center;font-size:10px;direction:ltr;color:var(--t1)">'+(isAr?'الأهداف: ':'Targets: ')+'<span style="color:var(--up);font-weight:700;font-family:var(--fm)">'+rP(data.f618U)+' → '+rP(data.f100U)+'</span> | '+(isAr?'الوقف الأساسي: ':'Main SL: ')+'<span style="color:var(--dn);font-weight:700;font-family:var(--fm)">'+rP(data.f618D)+'</span></div>';
  h+='</div>';

  /* ════════ SECTION 15: ختام التحليل (CONCLUSION — AT BOTTOM) ════════ */
  h+='<div class="mkt-section"><div class="mkt-section-t" style="font-size:14px;color:'+data.dCol+'">📝 15. '+(isAr?'ختام التحليل':'Analysis Conclusion')+'</div>';
  var isBull=data.ts>=2;var isBear=data.ts<=-2;
  /* 1. Verdict */
  h+='<div style="padding:12px;background:'+(isBull?'rgba(0,255,136,.06)':isBear?'rgba(255,56,96,.06)':'rgba(255,184,0,.06)')+';border:1px solid '+(isBull?'rgba(0,255,136,.15)':isBear?'rgba(255,56,96,.15)':'rgba(255,184,0,.15)')+';border-radius:10px;text-align:center;margin-bottom:8px">';
  h+='<div style="font-size:18px;font-weight:800;color:'+data.dCol+';margin-bottom:4px">'+data.dIc+' '+data.dir+'</div>';
  h+='<div style="font-size:11px;color:var(--t1)">'+data.rec+'</div>';
  h+='</div>';
  /* 2. Why bullish/bearish? (5 numbered reasons from all data) */
  var whyReasons=[];
  /* Collect up to 5 strongest reasons */
  if(isBull){
    if(data.price>data.ema20&&data.price>data.ema50)whyReasons.push(isAr?'<b>المتوسطات:</b> السعر فوق EMA20 و EMA50 ('+rP(data.ema20)+' / '+rP(data.ema50)+') — هيكل صعودي مؤكد':'<b>MAs:</b> Price above EMA20 & EMA50 — bullish structure');
    if(data.macd.cross==='bull'||data.macd.h>0)whyReasons.push(isAr?'<b>MACD:</b> '+(data.macd.cross==='bull'?'تقاطع صعودي جديد — من أقوى إشارات الشراء':'زخم إيجابي'):'<b>MACD:</b> '+(data.macd.cross==='bull'?'Fresh bull cross — strongest buy signal':'Positive momentum'));
    if(data.wConf>=40)whyReasons.push(isAr?'<b>الحيتان:</b> تجميع '+data.wConf+'% — المحافظ الكبيرة تشتري':'<b>Whales:</b> '+data.wConf+'% accumulation — large wallets buying');
    if(data.topTraders&&data.topTraders.long>0.55)whyReasons.push(isAr?'<b>كبار المتداولين:</b> '+Math.round(data.topTraders.long*100)+'% Long على Binance — المحترفون صاعدون':'<b>Top Traders:</b> '+Math.round(data.topTraders.long*100)+'% Long on Binance — pros bullish');
    if(data.cbPrem&&data.cbPrem.pct>0.15)whyReasons.push(isAr?'<b>بريميوم Coinbase:</b> +'+data.cbPrem.pct.toFixed(3)+'% — المؤسسات الأمريكية تشتري':'<b>Coinbase Premium:</b> +'+data.cbPrem.pct.toFixed(3)+'% — US institutions buying');
    if(data.bfxMargin&&data.bfxMargin.longPct>60)whyReasons.push(isAr?'<b>Bitfinex Margin:</b> '+data.bfxMargin.longPct.toFixed(0)+'% Long — Smart Money يتمركز صعودياً':'<b>Bitfinex Margin:</b> '+data.bfxMargin.longPct.toFixed(0)+'% Long — smart money positioning');
    if(data.frHist&&data.frHist.negCount>=7)whyReasons.push(isAr?'<b>تاريخ FR:</b> '+data.frHist.negCount+'/'+data.frHist.totalCount+' قراءات سلبية — الشورتات تدفع باستمرار':'<b>FR History:</b> '+data.frHist.negCount+'/'+data.frHist.totalCount+' negative — shorts paying continuously');
    if(data.iceberg&&data.iceberg.signal==='ICEBERG_BUY')whyReasons.push(isAr?'<b>أوامر مخفية:</b> شراء مؤسسي مقسّم على أوامر صغيرة — إشارة تجميع':'<b>Iceberg:</b> Hidden institutional buying — accumulation signal');
    if(data.struct==='HH/HL')whyReasons.push(isAr?'<b>الهيكل:</b> قمم أعلى وقيعان أعلى — هيكل صعودي كلاسيكي':'<b>Structure:</b> HH/HL — classic bullish');
  }else if(isBear){
    if(data.price<data.ema20)whyReasons.push(isAr?'<b>المتوسطات:</b> السعر تحت EMA20 ('+rP(data.ema20)+') — المتوسطات مقاومة':'<b>MAs:</b> Price below EMA20 — MAs acting as resistance');
    if(data.macd.cross==='bear'||data.macd.h<0)whyReasons.push(isAr?'<b>MACD:</b> '+(data.macd.cross==='bear'?'تقاطع هبوطي — إشارة بيع قوية':'زخم سلبي'):'<b>MACD:</b> '+(data.macd.cross==='bear'?'Bear cross — strong sell signal':'Negative momentum'));
    if(data.fr&&data.fr.rate>0.05)whyReasons.push(isAr?'<b>FR عالي:</b> '+(data.fr.rate*100).toFixed(3)+'% — جشع مفرط، تصحيح محتمل':'<b>High FR:</b> '+(data.fr.rate*100).toFixed(3)+'% — extreme greed, correction likely');
    if(data.topTraders&&data.topTraders.long<0.45)whyReasons.push(isAr?'<b>كبار المتداولين:</b> '+Math.round(data.topTraders.short*100)+'% Short — المحترفون يتوقعون هبوط':'<b>Top Traders:</b> '+Math.round(data.topTraders.short*100)+'% Short — pros expect decline');
    if(data.cbPrem&&data.cbPrem.pct<-0.15)whyReasons.push(isAr?'<b>بريميوم Coinbase:</b> '+data.cbPrem.pct.toFixed(3)+'% — المؤسسات تبيع':'<b>Coinbase Premium:</b> '+data.cbPrem.pct.toFixed(3)+'% — institutions selling');
    if(data.divRSI==='bearish'||data.divRSI1d==='bearish')whyReasons.push(isAr?'<b>دايفرجنس:</b> RSI divergence — ضعف زخم وانعكاس محتمل':'<b>Divergence:</b> RSI divergence — momentum fading');
    if(data.whalePnL&&data.whalePnL.pct<-3)whyReasons.push(isAr?'<b>الحيتان خاسرون:</b> '+data.whalePnL.pct.toFixed(1)+'% — ضغط بيع من المحافظ الكبيرة':'<b>Whales losing:</b> '+data.whalePnL.pct.toFixed(1)+'% — sell pressure from big wallets');
    if(data.struct==='LH/LL')whyReasons.push(isAr?'<b>الهيكل:</b> قمم أدنى وقيعان أدنى — هيكل هبوطي':'<b>Structure:</b> LH/LL — classic bearish');
  }else{
    whyReasons.push(isAr?'<b>السوق محايد:</b> لا توافق واضح بين المؤشرات — انتظر الاختراق':'<b>Market neutral:</b> No clear alignment — wait for breakout');
    whyReasons.push(isAr?'<b>التوافق:</b> '+data.bullTFs+'/4 فريمات صعودية':'<b>Confluence:</b> '+data.bullTFs+'/4 frames bullish');
  }
  whyReasons=whyReasons.slice(0,5);
  if(whyReasons.length){
    var whyTitle=isBull?(isAr?'لماذا '+cn+' صعودي؟':'Why is '+cn+' bullish?'):isBear?(isAr?'لماذا '+cn+' هبوطي؟':'Why is '+cn+' bearish?'):(isAr?'لماذا محايد؟':'Why neutral?');
    h+='<div style="padding:10px;background:'+(isBull?'rgba(0,255,136,.03)':isBear?'rgba(255,56,96,.03)':'rgba(255,184,0,.03)')+';border-radius:10px;margin-bottom:8px">';
    h+='<div style="font-size:12px;font-weight:800;color:'+data.dCol+';margin-bottom:6px">'+data.dIc+' '+whyTitle+'</div>';
    whyReasons.forEach(function(r,i){h+='<div style="font-size:10px;color:var(--t1);line-height:1.8;padding:4px 0;'+(i<whyReasons.length-1?'border-bottom:1px solid rgba(255,255,255,.04)':'')+'">'+(i+1)+'. '+r+'</div>';});
    h+='</div>';
  }
  /* 3. What invalidates? */
  var invalidations=[];
  if(isBull){
    invalidations.push(isAr?'كسر دعم '+rP(data.supp)+' بإغلاق 4H واضح':'4H close below support '+rP(data.supp));
    invalidations.push(isAr?'تقاطع MACD هبوطي على الفريم اليومي':'Daily MACD bear cross');
    invalidations.push(isAr?'ارتفاع FR فوق 0.1% (جشع مفرط)':'FR rising above 0.1% (extreme greed)');
    invalidations.push(isAr?'خروج الحيتان (ثقة تنزل تحت 20%)':'Whale exit (confidence drops below 20%)');
  }else if(isBear){
    invalidations.push(isAr?'اختراق مقاومة '+rP(data.resist)+' بإغلاق 4H + حجم':'4H close above '+rP(data.resist)+' with volume');
    invalidations.push(isAr?'تقاطع MACD صعودي':'MACD bull cross');
    invalidations.push(isAr?'FR يتحول لسلبي (Shorts تدفع)':'FR turns negative (shorts paying)');
    invalidations.push(isAr?'دخول حيتان جديدة (ثقة >50%)':'New whale entries (confidence >50%)');
  }else{
    invalidations.push(isAr?'اختراق النطاق إما '+rP(data.resist)+' أو '+rP(data.supp):'Break of either '+rP(data.resist)+' or '+rP(data.supp));
    invalidations.push(isAr?'ظهور تقاطع MACD واضح':'Clear MACD crossover');
  }
  h+='<div style="padding:10px;background:rgba(255,56,96,.04);border:1px solid rgba(255,56,96,.1);border-radius:10px;margin-bottom:8px">';
  h+='<div style="font-size:12px;font-weight:800;color:var(--dn);margin-bottom:6px">❌ '+(isAr?'ما يُبطل التحليل:':'What invalidates:')+'</div>';
  invalidations.forEach(function(inv,i){h+='<div style="font-size:10px;color:var(--t1);line-height:1.8;padding:3px 0">• '+inv+'</div>';});
  h+='</div>';
  /* 4. Entry recommendation */
  h+='<div style="padding:10px;background:rgba(91,156,255,.04);border:1px solid rgba(91,156,255,.1);border-radius:10px;margin-bottom:8px">';
  h+='<div style="font-size:12px;font-weight:800;color:var(--blue);margin-bottom:6px">🎯 '+(isAr?'توصية الدخول:':'Entry recommendation:')+'</div>';
  var bestEntry=isBull?data.price:isBear?data.resist*0.995:(data.price+data.supp)/2;
  var bestStop=isBull?data.f618D:isBear?data.resist*1.02:data.supp;
  var bestT1=isBull?data.f618U:isBear?data.f618D:data.resist;
  var bestT2=isBull?data.f100U:isBear?data.supp:data.f100U;
  h+='<div style="font-size:11px;color:var(--t1);line-height:1.9;direction:ltr">';
  h+=(isAr?'الدخول: ':'Entry: ')+'<span style="color:var(--blue);font-family:var(--fm);font-weight:700">'+rP(bestEntry)+'</span><br>';
  h+=(isAr?'الهدف 1: ':'TP1: ')+'<span style="color:var(--up);font-family:var(--fm);font-weight:700">'+rP(bestT1)+'</span><br>';
  h+=(isAr?'الهدف 2: ':'TP2: ')+'<span style="color:var(--up);font-family:var(--fm);font-weight:700">'+rP(bestT2)+'</span><br>';
  h+=(isAr?'الوقف: ':'Stop Loss: ')+'<span style="color:var(--dn);font-family:var(--fm);font-weight:700">'+rP(bestStop)+'</span><br>';
  var finalRR=Math.abs(bestEntry-bestStop)>0?((bestT1-bestEntry)/Math.abs(bestEntry-bestStop)):0;
  h+=(isAr?'R:R: ':'R:R: ')+'<span style="font-weight:700">1:'+Math.abs(finalRR).toFixed(1)+'x</span><br>';
  h+=(isAr?'حجم المركز المقترح: ':'Position size: ')+'<span style="font-weight:700">'+data.riskPct+'%</span>';
  h+='</div></div>';
  /* 5. Warning */
  h+='<div style="padding:8px;background:rgba(255,184,0,.08);border:1px solid rgba(255,184,0,.2);border-radius:8px;text-align:center;font-size:11px;font-weight:700;color:var(--warn)">⚠️ '+(isAr?'لا تتداول بدون وقف خسارة! إدارة المخاطر أهم من الإشارة.':'Never trade without a stop loss! Risk management matters more than the signal.')+'</div>';
  h+='</div>';

  /* Footer */
  h+='<div style="text-align:center;font-size:8px;color:var(--t3);margin:8px 0">⚠️ '+(isAr?'تحليل فني — ليس نصيحة مالية':'Technical analysis — not financial advice')+'</div>';
  h+=mktSignature();

  return h;
}

/* ═══ loadBTCChart ═══ */
async function loadBTCChart(){
  var el=document.getElementById('mktBTC');
  if(btcCache.h&&Date.now()-btcCache.t<MKT_TTL){
    if(el)el.innerHTML=btcCache.h;
    return;
  }
  if(el)el.innerHTML='<div style="text-align:center;padding:30px"><div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div><div style="font-size:11px;color:var(--t2);margin-top:10px">'+(lang==='ar'?'\u062c\u0627\u0631\u064a \u062a\u062d\u0644\u064a\u0644 12 \u0642\u0633\u0645...':'Analyzing 12 sections...')+'</div></div>';
  try{
    var data=await analyzeCoinRpt('BTC');
    if(!data){if(el)el.innerHTML='<div class="empty"><div class="empty-ic">\u{1F4CA}</div><div class="empty-tx">'+(lang==='ar'?'\u0644\u0627 \u0628\u064a\u0627\u0646\u0627\u062a':'No data')+'</div></div>';return}
    var frsh=getMktFresh(Date.now());
    var xml='<div class="mkt-fresh '+frsh.cls+'"><span class="mkt-fresh-dot"></span> '+frsh.txt+' \u2014 '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+'</div>';
    xml+=buildChartHTML(data,'#f7931a','\u20bf',{ar:'\u0627\u0644\u0628\u064a\u062a\u0643\u0648\u064a\u0646',en:'Bitcoin'});
    xml+='<button class="rfr" onclick="btcCache.t=0;loadBTCChart()">\u{1F504} '+(lang==='ar'?'\u062a\u062d\u062f\u064a\u062b':'Refresh')+'</button>';
    btcCache.h=xml;
    btcCache.t=Date.now();
    if(el)el.innerHTML=xml;
  }catch(e){
    if(el)el.innerHTML='<div class="empty"><div class="empty-ic">\u{1F4CA}</div><div class="empty-tx">'+(lang==='ar'?'\u062e\u0637\u0623 \u2014 \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u0627\u064b':'Error \u2014 try later')+'</div></div><button class="rfr" onclick="btcCache.t=0;loadBTCChart()">\u{1F504}</button>';
  }
}

/* ═══ loadETHChart ═══ */
async function loadETHChart(){
  var el=document.getElementById('mktETH');
  if(ethCache.h&&Date.now()-ethCache.t<MKT_TTL){
    if(el)el.innerHTML=ethCache.h;
    return;
  }
  if(el)el.innerHTML='<div style="text-align:center;padding:30px"><div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div><div style="font-size:11px;color:var(--t2);margin-top:10px">'+(lang==='ar'?'\u062c\u0627\u0631\u064a \u062a\u062d\u0644\u064a\u0644 12 \u0642\u0633\u0645...':'Analyzing 12 sections...')+'</div></div>';
  try{
    var data=await analyzeCoinRpt('ETH');
    if(!data){if(el)el.innerHTML='<div class="empty"><div class="empty-ic">\u{1F4CA}</div><div class="empty-tx">'+(lang==='ar'?'\u0644\u0627 \u0628\u064a\u0627\u0646\u0627\u062a':'No data')+'</div></div>';return}
    var frsh=getMktFresh(Date.now());
    var xml='<div class="mkt-fresh '+frsh.cls+'"><span class="mkt-fresh-dot"></span> '+frsh.txt+' \u2014 '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+'</div>';
    xml+=buildChartHTML(data,'#627eea','\u039e',{ar:'\u0627\u0644\u0625\u064a\u062b\u064a\u0631\u064a\u0648\u0645',en:'Ethereum'});
    xml+='<button class="rfr" onclick="ethCache.t=0;loadETHChart()">\u{1F504} '+(lang==='ar'?'\u062a\u062d\u062f\u064a\u062b':'Refresh')+'</button>';
    ethCache.h=xml;
    ethCache.t=Date.now();
    if(el)el.innerHTML=xml;
  }catch(e){
    if(el)el.innerHTML='<div class="empty"><div class="empty-ic">\u{1F4CA}</div><div class="empty-tx">'+(lang==='ar'?'\u062e\u0637\u0623 \u2014 \u062d\u0627\u0648\u0644 \u0644\u0627\u062d\u0642\u0627\u064b':'Error \u2014 try later')+'</div></div><button class="rfr" onclick="ethCache.t=0;loadETHChart()">\u{1F504}</button>';
  }
}


/* PORTFOLIO */
var sP=function(){try{localStorage.setItem('nxp10',JSON.stringify(portfolio))}catch(e){}};
function addPort(){
  var raw=document.getElementById('aSym').value.toUpperCase().trim();
  /* Whitelist symbol: A-Z and 0-9 only, max 10 chars */
  var sym=raw.replace(/[^A-Z0-9]/g,'').slice(0,10);
  var amt=+document.getElementById('aAmt').value;
  var pr=+document.getElementById('aPr').value;
  if(!sym||!amt||amt<=0||!isFinite(amt))return;
  if(pr&&(pr<0||!isFinite(pr)))return;
  portfolio.push({sym:sym,amt:amt,bp:pr});sP();closeMo('addMo');renderPort();
}
function rmPort(i){portfolio.splice(i,1);sP();renderPort()}
function renderPort(){var tV=0,tC=0;portfolio.forEach(function(p){var d=T[p.sym];if(d){tV+=d.p*p.amt;tC+=p.bp*p.amt}});var pnl=tC>0?((tV-tC)/tC*100):0;document.getElementById('pVal').textContent=tV>0?fmt(tV):'$0';var pE=document.getElementById('pCh');if(tC>0){pE.textContent=(pnl>=0?'+':'')+pnl.toFixed(2)+'%';pE.style.color=pnl>=0?'var(--up)':'var(--dn)'}else{pE.textContent=t('add_coins');pE.style.color='var(--t3)'};document.getElementById('pList').innerHTML=portfolio.length?portfolio.map(function(p,i){var d=T[p.sym],cp=d?d.p:0,v=cp*p.amt,pnl=p.bp>0?((cp-p.bp)/p.bp*100):0;var bg=COL[p.sym]||'#444';return'<div class="port-i"><div style="display:flex;align-items:center;gap:8px"><div class="cr-ic" style="background:'+bg+'0a;color:'+bg+';border:1px solid '+bg+'22;width:26px;height:26px;font-size:9px">'+esc(p.sym.slice(0,2))+'</div><div><div class="cr-n">'+esc(p.sym)+'</div><div class="cr-sub">'+p.amt+' × '+fP(cp)+'</div></div></div><div style="text-align:left"><div class="cr-p">'+fmt(v)+'</div><div style="font-family:var(--fm);font-size:9px;font-weight:700;color:'+(pnl>=0?'var(--up)':'var(--dn)')+'">'+(p.bp>0?(pnl>=0?'+':'')+pnl.toFixed(1)+'%':'--')+'</div><div style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmPort('+i+')">🗑</div></div></div>'}).join(''):'<div class="empty"><div class="empty-ic">💼</div><div class="empty-tx">'+t('empty_port')+'</div></div>'}
/* ═══ ⚖️ L/S INTELLIGENCE v2.0 ═══ */
async function loadTakerVol(){/* taker data now loaded via PROXY in loadTk() */await loadTk()}

function analyzeLongShort(sym){
  var ls=LS[sym],hist=lsHist[sym],fr=FR[sym],oi=OI[sym],taker=takerData[sym],price=T[sym];
  if(!ls)return{score:0,signal:'NO_DATA',signals:[],verdict:'--',verdictCol:'var(--t3)',verdictIcon:'⚪',longTrend:'0'};
  var sc=0,sigs=[];
  /* Signal 1: Extreme positions */
  if(ls.long>=70){sc-=15;sigs.push({ic:'🔴',n:lang==='ar'?'Long مفرط '+ls.long.toFixed(0)+'% — خطر تصفية!':'Extreme Longs '+ls.long.toFixed(0)+'% — Liquidation risk!',col:'var(--dn)'})}
  else if(ls.long>=60){sc-=8;sigs.push({ic:'🟡',n:lang==='ar'?'Long عالي '+ls.long.toFixed(0)+'% — حذر':'High Longs '+ls.long.toFixed(0)+'% — Caution',col:'var(--warn)'})}
  else if(ls.short>=65){sc+=12;sigs.push({ic:'🟢',n:lang==='ar'?'Short مفرط '+ls.short.toFixed(0)+'% — فرصة Squeeze!':'Extreme Shorts '+ls.short.toFixed(0)+'% — Squeeze!',col:'var(--up)'})}
  /* Signal 2: L/S Trend over 4h */
  if(hist&&hist.length>=3){var oldL=hist[0].long;var newL=hist[hist.length-1].long;var lTrend=newL-oldL;
    if(lTrend>5){sc-=10;sigs.push({ic:'📈',n:lang==='ar'?'Long يزيد +'+lTrend.toFixed(1)+'% بـ4h — حرارة':'Longs rising +'+lTrend.toFixed(1)+'% in 4h — overheating',col:'var(--dn)'})}
    else if(lTrend<-5){sc+=8;sigs.push({ic:'📉',n:lang==='ar'?'Long ينقص '+lTrend.toFixed(1)+'% — Longs تقفل':'Longs dropping '+lTrend.toFixed(1)+'% — closing',col:'var(--up)'})}}
  /* Signal 3: FR + L/S combo */
  if(fr){if(fr.rate>0.05&&ls.long>=55){sc-=12;sigs.push({ic:'💰',n:lang==='ar'?'FR '+fr.rate.toFixed(3)+'% + Long عالي = dump':'FR '+fr.rate.toFixed(3)+'% + High Longs = dump',col:'var(--dn)'})}
    else if(fr.rate<-0.02&&ls.short>=50){sc+=10;sigs.push({ic:'💰',n:lang==='ar'?'FR سلبي — Shorts تدفع! فرصة':'Neg FR — Shorts paying! Opportunity',col:'var(--up)'})}}
  /* Signal 4: Taker volume */
  if(taker){if(taker.ratio>1.8){sc+=8;sigs.push({ic:'⚡',n:lang==='ar'?'شراء عدواني '+taker.ratio.toFixed(2)+'x':'Aggressive buying '+taker.ratio.toFixed(2)+'x',col:'var(--up)'})}
    else if(taker.ratio<0.55){sc-=8;sigs.push({ic:'⚡',n:lang==='ar'?'بيع عدواني '+taker.ratio.toFixed(2)+'x':'Aggressive selling '+taker.ratio.toFixed(2)+'x',col:'var(--dn)'})}}
  /* Signal 5: OI + L/S */
  if(oi&&ls.long>=55){sigs.push({ic:'📊',n:lang==='ar'?'OI + Long عالي — مراكز تنبني':'OI + High Longs — positions building',col:'var(--warn)'})}
  /* Signal 6: Price vs L/S divergence */
  if(price&&hist&&hist.length>=3){var pUp=price.c>2;var lDec=hist[hist.length-1].long<hist[0].long;var pDn=price.c<-2;var lInc=hist[hist.length-1].long>hist[0].long;
    if(pUp&&lDec){sc+=10;sigs.push({ic:'🎯',n:lang==='ar'?'سعر ↑ + Longs ↓ = حركة صحية':'Price ↑ + Longs ↓ = healthy move',col:'var(--up)'})}
    if(pDn&&lInc){sc-=10;sigs.push({ic:'⚠️',n:lang==='ar'?'سعر ↓ + Longs ↑ = عناد خطير!':'Price ↓ + Longs ↑ = dangerous!',col:'var(--dn)'})}}
  /* Verdict */
  var v,vc,vi;
  if(sc>=15){v=lang==='ar'?'🟢 صعودي — فرصة':'🟢 Bullish — Opportunity';vc='var(--up)';vi='🟢'}
  else if(sc>=5){v=lang==='ar'?'🟢 إيجابي':'🟢 Positive';vc='var(--up)';vi='🟢'}
  else if(sc<=-15){v=lang==='ar'?'🔴 خطر — تجنب Long':'🔴 Danger — Avoid Long';vc='var(--dn)';vi='🔴'}
  else if(sc<=-5){v=lang==='ar'?'🟡 حذر':'🟡 Caution';vc='var(--warn)';vi='🟡'}
  else{v=lang==='ar'?'⚪ محايد':'⚪ Neutral';vc='var(--t2)';vi='⚪'}
  return{score:sc,signals:sigs,verdict:v,verdictCol:vc,verdictIcon:vi,longTrend:hist?(hist[hist.length-1].long-hist[0].long).toFixed(1):'0'}}

function calcLiqRisk(sym){
  var ls=LS[sym],fr=FR[sym],hist=lsHist[sym],taker=takerData[sym];if(!ls)return{risk:0,level:'--',color:'var(--t3)'};
  var r=0;if(ls.long>=70)r+=30;else if(ls.long>=60)r+=15;else if(ls.short>=65)r+=10;
  if(fr){if(fr.rate>0.1)r+=25;else if(fr.rate>0.05)r+=15;else if(fr.rate<-0.03)r+=10}
  if(hist&&hist.length>=2){var d=hist[hist.length-1].long-hist[0].long;if(ls.long>=55&&d>3)r+=15;if(ls.short>=55&&d<-3)r+=10}
  if(taker){if(taker.ratio>2.5||taker.ratio<0.4)r+=10}
  r=Math.min(100,r);var lv,cl;
  if(r>=70){lv=lang==='ar'?'🔴 شديد':'🔴 Critical';cl='var(--dn)'}
  else if(r>=50){lv=lang==='ar'?'🟠 عالي':'🟠 High';cl='var(--warn)'}
  else if(r>=30){lv=lang==='ar'?'🟡 متوسط':'🟡 Medium';cl='var(--warn)'}
  else{lv=lang==='ar'?'🟢 منخفض':'🟢 Low';cl='var(--up)'}
  return{risk:r,level:lv,color:cl}}

function renderDashLS(){
  var lsC=WL.filter(function(s){return LS[s]});
  if(!lsC.length){document.getElementById('dashLS').innerHTML='<div class="muted">'+t('scanning')+'</div>';return}
  var analyses=lsC.map(function(s){return{sym:s,a:analyzeLongShort(s),ls:LS[s]}});
  analyses.sort(function(a,b){return a.a.score-b.a.score});
  var avgL=lsC.reduce(function(s,c){return s+LS[c].long},0)/lsC.length;var avgS=100-avgL;
  var totSc=analyses.reduce(function(s,x){return s+x.a.score},0);
  var mV,mC;if(totSc>=20){mV=lang==='ar'?'🟢 السوق صعودي — فرص شراء':'🟢 Market Bullish — Buy opportunities';mC='var(--up)'}
  else if(totSc<=-20){mV=lang==='ar'?'🔴 السوق هبوطي — حذر من Long':'🔴 Market Bearish — Avoid Longs';mC='var(--dn)'}
  else{mV=lang==='ar'?'🟡 السوق متوازن — انتظر':'🟡 Market Balanced — Wait';mC='var(--warn)'}
  var dangerC=analyses.filter(function(x){return x.a.score<=-10});var oppC=analyses.filter(function(x){return x.a.score>=10});
  var h='<div class="cd" style="padding:12px">';
  /* Market verdict */
  h+='<div style="text-align:center;margin-bottom:10px;padding:8px;background:'+(totSc>=10?'var(--ud)':totSc<=-10?'var(--dd)':'var(--wd)')+';border-radius:10px">'
    +'<div style="font-size:11px;font-weight:800;color:'+mC+'">'+mV+'</div>'
    +'<div style="font-size:8px;font-family:var(--fm);color:var(--t3);margin-top:2px">L:'+avgL.toFixed(0)+'% / S:'+avgS.toFixed(0)+'% | '+lsC.length+' '+(lang==='ar'?'عملة':'coins')+'</div></div>';
  /* Danger alerts */
  if(dangerC.length){h+='<div style="margin-bottom:8px;padding:6px 8px;background:var(--dd);border-radius:8px;border-left:3px solid var(--dn)">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--dn);margin-bottom:4px">⚠️ '+(lang==='ar'?'تحذيرات:':'Warnings:')+'</div>';
    dangerC.slice(0,3).forEach(function(d){var s0=d.a.signals[0];if(s0)h+='<div style="font-size:8px;color:var(--dn);margin-bottom:2px">'+s0.ic+' '+d.sym+': '+s0.n+'</div>'});h+='</div>'}
  /* Opportunity alerts */
  if(oppC.length){h+='<div style="margin-bottom:8px;padding:6px 8px;background:var(--ud);border-radius:8px;border-left:3px solid var(--up)">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--up);margin-bottom:4px">🟢 '+(lang==='ar'?'فرص:':'Opportunities:')+'</div>';
    oppC.slice(0,3).forEach(function(d){var s0=d.a.signals[0];if(s0)h+='<div style="font-size:8px;color:var(--up);margin-bottom:2px">'+s0.ic+' '+d.sym+': '+s0.n+'</div>'});h+='</div>'}
  /* Per-coin bars (top 8 by |score|) */
  var top8=analyses.slice().sort(function(a,b){return Math.abs(b.a.score)-Math.abs(a.a.score)}).slice(0,8);
  top8.forEach(function(item){var s=item.sym,d=item.ls,a=item.a,bg=COL[s]||'#888';
    var tr=a.longTrend;var trI=tr>2?'↑':tr<-2?'↓':'→';var trC=tr>2?'var(--dn)':tr<-2?'var(--up)':'var(--t3)';
    h+='<div style="margin-bottom:8px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">'
      +'<div style="display:flex;align-items:center;gap:6px"><div style="width:22px;height:22px;border-radius:7px;background:'+bg+'18;color:'+bg+';border:1px solid '+bg+'30;display:grid;place-items:center;font-size:8px;font-weight:800">'+s.slice(0,2)+'</div>'
      +'<span style="font-family:var(--fd);font-weight:700;font-size:12px">'+s+'</span>'
      +'<span style="font-size:8px;color:'+a.verdictCol+';font-weight:700">'+a.verdictIcon+'</span></div>'
      +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:7px;color:'+trC+';font-weight:700">'+trI+tr+'%</span>'
      +'<span style="font-family:var(--fm);font-size:11px;font-weight:800;color:'+(d.ratio>1.5?'var(--warn)':d.ratio<0.7?'var(--dn)':'var(--t1)')+'">'+d.ratio.toFixed(2)+'</span></div></div>'
      +'<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg2)"><div style="width:'+d.long+'%;background:linear-gradient(90deg,var(--up),rgba(0,255,136,.5));border-radius:4px 0 0 4px;transition:width .5s"></div><div style="width:'+d.short+'%;background:linear-gradient(90deg,rgba(255,56,96,.5),var(--dn));border-radius:0 4px 4px 0;transition:width .5s"></div></div>'
      +'<div style="display:flex;justify-content:space-between;margin-top:2px;font-size:8px;font-family:var(--fm)"><span style="color:var(--up);font-weight:700">Long '+d.long.toFixed(0)+'%</span>'
      +(a.signals.length?'<span style="font-size:7px;color:'+a.signals[0].col+';font-weight:600">'+a.signals[0].ic+' '+(a.signals[0].n.length>28?a.signals[0].n.slice(0,28)+'...':a.signals[0].n)+'</span>':'')
      +'<span style="color:var(--dn);font-weight:700">Short '+d.short.toFixed(0)+'%</span></div></div>'});
  h+='</div>';document.getElementById('dashLS').innerHTML=h}

/* L/S API for other systems */
function getLSSignal(sym){return analyzeLongShort(sym)}
function getLSRisk(sym){return calcLiqRisk(sym)}
function getMarketLSSentiment(){var lsC=WL.filter(function(s){return LS[s]});if(!lsC.length)return{sentiment:'UNKNOWN',score:0};
  var tot=lsC.reduce(function(s,sym){return s+analyzeLongShort(sym).score},0);
  return{sentiment:tot>=20?'BULLISH':tot<=-20?'BEARISH':'NEUTRAL',score:tot}}
/* 🪙 TOP COIN CARDS — BTC, ETH, SOL, SUI (Upgraded v2) */
var TOP4=['BTC','ETH','SOL','SUI'];
var TOP4_ICONS={BTC:'₿',ETH:'Ξ',SOL:'◎',SUI:'💧'};
var top4Ext={}; /* Extended kline data per coin */

/* ── Live Pulse: glow based on whale activity ── */
function getCoinPulse(sym){
  var ww=whaleWaves[sym];if(!ww||!ww.engine)return'';
  var conf=ww.engine.confidence||0;var cvd=analyzeCVD(sym);
  if(conf>=60&&cvd.cvdTrend==='RISING')return'pulse-strong';
  if(conf>=40)return'pulse-buy';
  var sell=0;if(cvd.divergence==='BEARISH')sell++;if(FR[sym]&&FR[sym].rate>0.05)sell++;if(LS[sym]&&LS[sym].ratio>1.8)sell++;
  if(sell>=2)return'pulse-sell';return''}

/* ── Prediction Arrow: weighted direction from all signals ── */
function getPredArrow(sym){
  var sc=0;
  var ww=whaleWaves[sym];if(ww&&ww.engine){var c=ww.engine.confidence||0;if(c>=60)sc+=3;else if(c>=40)sc+=2;else if(c>=20)sc+=1}
  var cvd=analyzeCVD(sym);if(cvd.divergence==='BULLISH')sc+=3;else if(cvd.cvdTrend==='RISING')sc+=1;else if(cvd.divergence==='BEARISH')sc-=3;else if(cvd.cvdTrend==='FALLING')sc-=1;
  var fr=FR[sym];if(fr){if(fr.rate<-0.02)sc+=2;else if(fr.rate<-0.005)sc+=1;else if(fr.rate>0.08)sc-=2;else if(fr.rate>0.03)sc-=1}
  var ls=LS[sym];if(ls){if(ls.ratio<0.7)sc+=1;else if(ls.ratio>1.8)sc-=1}
  if(ww&&ww.engine&&ww.engine.techniques&&ww.engine.techniques.oiDelta){var oi=parseFloat(ww.engine.techniques.oiDelta.oiChange)||0;if(oi>5)sc+=1;if(oi<-8)sc-=1}
  var d=T[sym];if(d){if(d.c>3&&d.c<10)sc+=1;else if(d.c>15)sc-=1;else if(d.c<-5)sc-=1}
  if(sc>=6)return{a:'▲▲▲',col:'var(--up)',lb:lang==='ar'?'صعود قوي':'Strong up',sc:sc};
  if(sc>=4)return{a:'▲▲',col:'var(--up)',lb:lang==='ar'?'صعود متوقع':'Uptrend',sc:sc};
  if(sc>=2)return{a:'▲',col:'var(--up)',lb:lang==='ar'?'ميل صعودي':'Slightly bullish',sc:sc};
  if(sc<=-6)return{a:'▼▼▼',col:'var(--dn)',lb:lang==='ar'?'هبوط قوي':'Strong down',sc:sc};
  if(sc<=-4)return{a:'▼▼',col:'var(--dn)',lb:lang==='ar'?'هبوط متوقع':'Downtrend',sc:sc};
  if(sc<=-2)return{a:'▼',col:'var(--dn)',lb:lang==='ar'?'ميل هبوطي':'Slightly bearish',sc:sc};
  return{a:'→',col:'var(--warn)',lb:lang==='ar'?'محايد — انتظر':'Neutral — wait',sc:sc}}

/* ── Smart Summary: one-sentence explanation ── */
function getSmartSummary(sym){
  var sigs=[];
  var ww=whaleWaves[sym];if(ww&&ww.engine){var c=ww.engine.confidence||0;
    if(c>=60)sigs.push({t:'b',w:3,ar:'حيتان تجمّع بقوة',en:'Heavy whale accumulation'});
    else if(c>=40)sigs.push({t:'b',w:2,ar:'نشاط حيتان',en:'Whale activity detected'})}
  var cvd=analyzeCVD(sym);
  if(cvd.divergence==='BULLISH')sigs.push({t:'b',w:3,ar:'شراء مخفي (CVD صاعد)',en:'Hidden buying (CVD rising)'});
  else if(cvd.divergence==='BEARISH')sigs.push({t:'s',w:3,ar:'بيع مخفي (CVD هابط)',en:'Hidden selling (CVD falling)'});
  var fr=FR[sym];if(fr){if(fr.rate<-0.02)sigs.push({t:'b',w:2,ar:'FR سلبي = فرصة',en:'Negative FR = opportunity'});
    else if(fr.rate>0.08)sigs.push({t:'s',w:2,ar:'FR عالي جداً = خطر',en:'Very high FR = risk'});
    else if(fr.rate>0.05)sigs.push({t:'s',w:1,ar:'FR مرتفع',en:'Elevated FR'})}
  var ls=LS[sym];if(ls){if(ls.ratio>2.0)sigs.push({t:'s',w:2,ar:'Long مفرط = خطر',en:'Excessive longs = risky'});
    else if(ls.ratio<0.6)sigs.push({t:'b',w:2,ar:'Short Squeeze محتمل',en:'Possible short squeeze'})}
  var d=T[sym];if(d){if(d.c>15)sigs.push({t:'s',w:1,ar:'صعد كثير — حذر',en:'Overextended — caution'});
    if(d.c<-10)sigs.push({t:'n',w:1,ar:'هبوط حاد — انتظر',en:'Sharp drop — wait'})}
  if(sym==='BTC'&&btcDom>55)sigs.push({t:'b',w:1,ar:'هيمنة BTC عالية',en:'High BTC dominance'});
  if(fgValue<20)sigs.push({t:'s',w:1,ar:'خوف شديد بالسوق',en:'Extreme fear'});
  else if(fgValue>80)sigs.push({t:'s',w:1,ar:'طمع شديد — حذر',en:'Extreme greed — caution'});
  if(!sigs.length)return{text:lang==='ar'?'⏳ لا إشارات واضحة — انتظر':'⏳ No clear signals — wait',col:'var(--t2)'};
  sigs.sort(function(a,b){return b.w-a.w});var top=sigs.slice(0,3);
  var bull=top.filter(function(x){return x.t==='b'}).length;var bear=top.filter(function(x){return x.t==='s'}).length;
  var ic,col;if(bull>bear){ic='💡';col='var(--up)'}else if(bear>bull){ic='⚠️';col='var(--dn)'}else{ic='🔄';col='var(--warn)'}
  var reasons=top.map(function(x){return lang==='ar'?x.ar:x.en}).join(' + ');
  var end=bull>bear?(lang==='ar'?' = منطقة شراء':' = buy zone'):bear>bull?(lang==='ar'?' = تجنب أو انتظر':' = avoid or wait'):(lang==='ar'?' = إشارات مختلطة':' = mixed signals');
  return{text:ic+' '+reasons+end,col:col}}

/* ── Signal Badge: BUY / SELL / HOLD ── */
function getCoinSignal(sym){
  var p=getPredArrow(sym);var s=getSmartSummary(sym);var bull=s.col==='var(--up)';var bear=s.col==='var(--dn)';
  if(p.sc>=4&&bull)return{b:lang==='ar'?'🟢 شراء':'🟢 BUY',col:'var(--up)',bg:'var(--ud)'};
  if(p.sc>=2&&!bear)return{b:lang==='ar'?'🟢 شراء خفيف':'🟢 SOFT BUY',col:'var(--up)',bg:'var(--ud)'};
  if(p.sc<=-4&&bear)return{b:lang==='ar'?'🔴 بيع':'🔴 SELL',col:'var(--dn)',bg:'var(--dd)'};
  if(p.sc<=-2&&!bull)return{b:lang==='ar'?'🔴 حذر':'🔴 CAUTION',col:'var(--dn)',bg:'var(--dd)'};
  return{b:lang==='ar'?'🟡 انتظار':'🟡 HOLD',col:'var(--warn)',bg:'var(--wd)'}}

/* ── Extended kline data: multi-TF + RSI + MACD + S/R ── */
async function loadTop4Ext(){
  var proms=TOP4.map(function(s){return fj(BN+'/klines?symbol='+s+'USDT&interval=1h&limit=168').then(function(kl){
    if(!kl||kl.length<24)return;
    var closes=kl.map(function(k){return+k[4]});var highs=kl.map(function(k){return+k[2]});var lows=kl.map(function(k){return+k[3]});var now=closes[closes.length-1];
    var ch1h=closes.length>=2?((now-closes[closes.length-2])/closes[closes.length-2]*100):0;
    var ch4h=closes.length>=5?((now-closes[closes.length-5])/closes[closes.length-5]*100):0;
    var ch24h=closes.length>=25?((now-closes[closes.length-25])/closes[closes.length-25]*100):0;
    var ch7d=closes.length>=168?((now-closes[0])/closes[0]*100):0;
    var rsi=calcRSI(closes.slice(-15));var macd=calcMACD(closes);
    var sup=Math.min.apply(null,lows.slice(-48));var res=Math.max.apply(null,highs.slice(-48));
    var liqRisk='LOW';var frR=FR[s]?FR[s].rate:0;var lsR=LS[s]?LS[s].ratio:1;
    if(frR>0.08||lsR>2.0)liqRisk='HIGH';else if(frR>0.04||lsR>1.5)liqRisk='MEDIUM';
    top4Ext[s]={ch:{h1:ch1h,h4:ch4h,h24:ch24h,d7:ch7d},rsi:rsi,macd:{pos:macd.h>0,cross:macd.cross},sup:sup,res:res,liq:liqRisk}
  }).catch(function(){})});await Promise.all(proms)}

/* ── Render upgraded coin cards ── */
function renderTopCoins(){
  var el=document.getElementById('topCoins');if(!el)return;
  el.innerHTML=TOP4.map(function(s){var d=T[s];if(!d)return'';
    var chg=isNaN(d.c)?0:d.c;var up=chg>=0;var bg=COL[s]||'#888';
    var pulse=getCoinPulse(s);var pred=getPredArrow(s);var summary=getSmartSummary(s);var sig=getCoinSignal(s);
    var ext=top4Ext[s]||null;var fr=FR[s];var ls=LS[s];var oi=OI[s];
    var ww=whaleWaves[s];var wConf=ww&&ww.engine?ww.engine.confidence:0;var cvd=analyzeCVD(s);
    var frTxt=fr?(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%':'--';
    var frCol=fr?(fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--t2)'):'var(--t3)';
    var frLbl=fr?(fr.rate>0.05?'⚠️':fr.rate<-0.01?'🟢':''):'';
    var rsiTxt=ext?'RSI:'+ext.rsi.toFixed(0):'';var rsiCol=ext?(ext.rsi>70?'var(--dn)':ext.rsi<30?'var(--up)':'var(--t1)'):'var(--t3)';
    var macdTxt=ext?(ext.macd.pos?'MACD✅':'MACD❌'):'';var macdCol=ext?(ext.macd.pos?'var(--up)':'var(--dn)'):'var(--t3)';
    var oiTxt=oi?fmt(oi):'--';
    /* Multi-timeframe row */
    var tfH=ext?'<div class="cc-tf">'
      +'<span style="color:'+(ext.ch.h1>=0?'var(--up)':'var(--dn)')+'">1h '+(ext.ch.h1>=0?'+':'')+ext.ch.h1.toFixed(1)+'%</span>'
      +'<span style="color:'+(ext.ch.h4>=0?'var(--up)':'var(--dn)')+'">4h '+(ext.ch.h4>=0?'+':'')+ext.ch.h4.toFixed(1)+'%</span>'
      +'<span style="color:'+(ext.ch.h24>=0?'var(--up)':'var(--dn)')+'">24h '+(ext.ch.h24>=0?'+':'')+ext.ch.h24.toFixed(1)+'%</span>'
      +'<span style="color:'+(ext.ch.d7>=0?'var(--up)':'var(--dn)')+'">7d '+(ext.ch.d7>=0?'+':'')+ext.ch.d7.toFixed(1)+'%</span></div>':'';
    /* Support / Resistance */
    var srH=ext?'<div class="cc-sr"><span style="color:var(--up)">S:'+fP(ext.sup)+'</span><span style="color:var(--t3)">──</span><span style="font-weight:700;color:var(--t0)">'+fP(d.p)+'</span><span style="color:var(--t3)">──</span><span style="color:var(--dn)">R:'+fP(ext.res)+'</span></div>':'';
    /* Liquidation risk */
    var liqH=ext?'<span style="font-size:8px;padding:2px 5px;border-radius:4px;background:'+(ext.liq==='HIGH'?'var(--dd)':ext.liq==='MEDIUM'?'var(--wd)':'var(--ud)')+';color:'+(ext.liq==='HIGH'?'var(--dn)':ext.liq==='MEDIUM'?'var(--warn)':'var(--up)') +'">'+(lang==='ar'?'خطر:':'Risk:')+ext.liq+'</span>':'';
    var domH=s==='BTC'?'<span style="font-size:8px;color:var(--t2)">Dom:'+btcDom.toFixed(1)+'%</span>':'';
    return'<div class="coin-card '+(up?'up':'dn')+' '+pulse+'" onclick="openCoin(\''+s+'\')">'
      /* Row 1: Icon + Name + Signal + Arrow */
      +'<div class="cc-row1"><div class="coin-card-name"><div class="coin-card-ic" style="background:'+bg+'18;color:'+bg+';border:1px solid '+bg+'30">'+TOP4_ICONS[s]+'</div><span>'+s+'/USDT</span></div>'
      +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:18px;font-weight:800;color:'+pred.col+'">'+pred.a+'</span>'
      +'<span style="font-size:9px;padding:3px 8px;border-radius:6px;background:'+sig.bg+';color:'+sig.col+';font-weight:700">'+sig.b+'</span></div></div>'
      /* Row 2: Price + 24h change */
      +'<div class="cc-row2"><div class="coin-card-price">'+fP(d.p)+'</div>'
      +'<div class="coin-card-ch" style="background:var(--'+(up?'ud':'dd')+');color:var(--'+(up?'up':'dn')+')">'+(up?'▲+':'▼')+chg.toFixed(2)+'%</div></div>'
      /* Row 3: Multi-timeframe */
      +tfH
      /* Row 4: Indicators */
      +'<div class="cc-indicators"><span style="color:'+(wConf>=40?'var(--neon)':'var(--t3)')+'">🐋'+(wConf>0?wConf+'%':'--')+'</span>'
      +'<span style="color:'+(cvd.cvdTrend==='RISING'?'var(--up)':cvd.cvdTrend==='FALLING'?'var(--dn)':'var(--t3)')+'">CVD'+(cvd.cvdTrend==='RISING'?'↑':cvd.cvdTrend==='FALLING'?'↓':'→')+'</span>'
      +'<span style="color:'+rsiCol+'">'+rsiTxt+'</span><span style="color:'+macdCol+'">'+macdTxt+'</span></div>'
      /* Row 5: L/S Bar */
      +(ls?'<div class="cc-ls"><div class="cc-ls-bar"><div style="width:'+ls.long+'%;background:var(--up);border-radius:3px 0 0 3px"></div><div style="width:'+ls.short+'%;background:var(--dn);border-radius:0 3px 3px 0"></div></div><div class="cc-ls-labels"><span style="color:var(--up)">L:'+ls.long.toFixed(0)+'%</span><span style="color:var(--dn)">S:'+ls.short.toFixed(0)+'%</span></div></div>':'')
      /* Row 6: FR + OI + Risk + Dom */
      +'<div class="cc-details"><span>FR:<b style="color:'+frCol+'">'+frTxt+'</b>'+frLbl+'</span><span>OI:<b style="color:var(--neon)">'+oiTxt+'</b></span>'+liqH+domH+'</div>'
      /* Row 7: S/R */
      +srH
      /* Row 8: Smart Summary */
      +'<div class="cc-summary" style="color:'+summary.col+'">'+summary.text+'</div>'
      /* Row 9: Exchanges */
      +'<div class="cc-exchanges"><span>Binance</span>'+(d.by?'<span>Bybit:<b>'+fP(d.by)+'</b></span>':'')+(CBP[s]?'<span>CB:<b>'+fP(CBP[s])+'</b></span>':'')+'</div>'
      +'</div>'}).join('')}
/* 🎯 TOP 3 VIP TRADES — Smart Ranking + Auto-update */
function renderTop3(){
  var el=document.getElementById('top3List');if(!el||!cache.scan)return;
  var ar=lang==='ar';var opps=[];
  cache.scan.forEach(function(r){
    if(!TIER1.has(r.s))return;
    var d=T[r.s];if(!d||!d.p||d.p<=0)return;

    /* ═══ STRICT QUALITY GATE (before scoring) ═══ */
    if(r.c>=8)return;
    if(r.c<=-5)return;
    if(r.passed<2)return;
    if(T.BTC&&T.BTC.c<-4)return;
    if(d.v<3000000)return;
    try{var wPnLGate=calcWhalePnL(r.s);if(wPnLGate&&wPnLGate.pct<-3)return;}catch(e){}
    try{var iceGate=detectIceberg(r.s);if(iceGate&&iceGate.signal==='ICEBERG_SELL'&&iceGate.count>=2)return;}catch(e){}
    if(FR[r.s]&&FR[r.s].rate>0.12)return;
    try{var predGate=getPredArrow(r.s);if(predGate&&predGate.sc<=-5)return;}catch(e){}
    if(r.ageMinutes>120&&r.changeFromDetection>5)return;
    if(typeof tokenUnlocks!=='undefined'&&tokenUnlocks&&tokenUnlocks.length){
      var nowU=new Date();
      var unlockMatch=tokenUnlocks.filter(function(u){
        if(!u||!u.sym||u.sym!==r.s)return false;
        var daysUntil=(new Date(u.date)-nowU)/86400000;
        return daysUntil>=0&&daysUntil<=7&&u.amount>0;
      });
      if(unlockMatch.length){
        var totalUnlockValue=unlockMatch.reduce(function(s,u){return s+(u.amount||0)},0);
        if(totalUnlockValue>20000000)return;
      }
    }

    /* ═══ CATEGORY 1: Whale Intelligence (25 pts max) ═══ */
    var V3W = monitorState && monitorState.v3weights ? monitorState.v3weights : DEFAULT_V3_WEIGHTS;
    var whaleMax = V3W.whale || 25;
    var smartMax = V3W.smartMoney || 20;
    var techMax = V3W.technical || 20;
    var fundMax = V3W.funding || 15;
    var timeMax = V3W.timing || 10;
    var ctxMax = V3W.context || 10;
    var whaleScore=0;
    var ww=whaleWaves[r.s];
    var wConf=ww&&ww.engine?ww.engine.confidence:0;
    whaleScore+=Math.min(8,wConf*0.1);
    var wPnL=null;try{wPnL=calcWhalePnL(r.s)}catch(e){}
    if(wPnL&&wPnL.pct>0&&wPnL.pct<5)whaleScore+=6;
    else if(wPnL&&wPnL.pct>=5)whaleScore+=2;
    else if(wPnL&&wPnL.pct<-2)whaleScore-=5;
    var flowRate=0;try{flowRate=calcFlowRate(r.s)}catch(e){}
    if(flowRate>30000)whaleScore+=4;
    else if(flowRate>5000)whaleScore+=2;
    var ice=null;try{ice=detectIceberg(r.s)}catch(e){}
    if(ice&&ice.signal==='ICEBERG_BUY')whaleScore+=5;
    if(ice&&ice.signal==='ICEBERG_SELL')whaleScore-=8;
    var absorb=null;try{absorb=detectAbsorption(r.s)}catch(e){}
    if(absorb&&absorb.signal==='BULLISH_ABSORPTION')whaleScore+=3;
    var wWaves=ww&&ww.waves?ww.waves.length:0;
    if(wWaves>=3)whaleScore+=3;
    else if(wWaves>=2)whaleScore+=1;
    whaleScore=Math.max(-5,Math.min(whaleMax,whaleScore));

    /* ═══ CATEGORY 2: Smart Money & Cross-Exchange (20 pts max) ═══ */
    var smartScore=0;
    if(topTradersLS[r.s]&&topTradersLS[r.s].accounts&&topTradersLS[r.s].accounts.length){
      var topLatest=topTradersLS[r.s].accounts[topTradersLS[r.s].accounts.length-1];
      var retailLS=LS[r.s];
      if(topLatest.long>0.58&&retailLS&&retailLS.ratio<0.85)smartScore+=10;
      else if(topLatest.long>0.55)smartScore+=5;
    }
    if(CBP[r.s]&&T[r.s]&&T[r.s].p){
      var cbPrem=((CBP[r.s]-T[r.s].p)/T[r.s].p)*100;
      if(cbPrem>0.3)smartScore+=4;
      else if(cbPrem>0.15)smartScore+=2;
    }
    if(bitfinexMargin[r.s]&&bitfinexMargin[r.s].longPct>65)smartScore+=3;
    if(hyperliquidData[r.s]&&FR[r.s]){
      var dexFR=hyperliquidData[r.s].funding;
      if(typeof dexFR==='number'&&dexFR<-0.02&&FR[r.s].rate<-0.01)smartScore+=3;
    }
    if(coinalyzeFR[r.s]&&typeof coinalyzeFR[r.s].rate==='number'&&coinalyzeFR[r.s].rate<-0.01)smartScore+=2;
    smartScore=Math.min(smartMax,smartScore);

    /* ═══ CATEGORY 3: Technical & Flow (20 pts max) ═══ */
    var techScore=0;
    var ext=top4Ext[r.s]||null;
    if(ext){
      if(ext.rsi<30)techScore+=6;
      else if(ext.rsi<45&&ext.rsi>35)techScore+=4;
      if(ext.macd&&ext.macd.cross)techScore+=5;
      else if(ext.macd&&ext.macd.pos)techScore+=3;
    }
    techScore+=Math.min(4,r.passed*1);
    var cvd=null;try{cvd=analyzeCVD(r.s)}catch(e){}
    if(cvd&&cvd.divergence==='BULLISH')techScore+=4;
    else if(cvd&&cvd.trend==='BUYING')techScore+=2;
    var vpin=null;try{vpin=calcVPIN(r.s)}catch(e){}
    if(vpin&&vpin.vpin>0.55)techScore+=3;
    if(takerData[r.s]&&takerData[r.s].ratio>takerData[r.s].avg*1.3)techScore+=2;
    techScore=Math.min(techMax,techScore);

    /* ═══ CATEGORY 4: Funding & Positioning (15 pts max) ═══ */
    var fundScore=0;
    var fr=FR[r.s];
    if(fr&&fr.rate<-0.02)fundScore+=5;
    else if(fr&&fr.rate<-0.005)fundScore+=3;
    else if(fr&&fr.rate>0.06)fundScore-=4;
    if(frHistory[r.s]&&frHistory[r.s].length>=6){
      var last6=frHistory[r.s].slice(-6);
      var negCount=last6.filter(function(x){return x.rate<-0.005}).length;
      if(negCount>=4)fundScore+=4;
    }
    if(oiHistory[r.s]&&oiHistory[r.s].length>=4){
      var oldest=oiHistory[r.s][0].val;
      var newest=oiHistory[r.s][oiHistory[r.s].length-1].val;
      var growth=oldest>0?((newest-oldest)/oldest)*100:0;
      if(growth>15&&Math.abs(r.c)<3)fundScore+=4;
    }
    if(LS[r.s]&&LS[r.s].ratio<0.75)fundScore+=3;
    if(coinalyzePredFR[r.s]&&fr&&typeof coinalyzePredFR[r.s].rate==='number'&&coinalyzePredFR[r.s].rate<fr.rate)fundScore+=2;
    fundScore=Math.max(-4,Math.min(fundMax,fundScore));

    /* ═══ CATEGORY 5: Timing & Freshness (10 pts max) ═══ */
    var timeScore=0;
    if(r.freshness==='fresh')timeScore+=5;
    else if(r.freshness==='warm')timeScore+=2;
    if(r.changeFromDetection!==undefined){
      if(r.changeFromDetection<1.5)timeScore+=3;
      else if(r.changeFromDetection<3)timeScore+=1;
      else if(r.changeFromDetection>5)timeScore-=3;
    }
    var pred=null;try{pred=getPredArrow(r.s)}catch(e){}
    if(pred&&pred.sc>=5)timeScore+=2;
    else if(pred&&pred.sc<=-3)timeScore-=3;
    timeScore=Math.max(-3,Math.min(timeMax,timeScore));

    /* ═══ CATEGORY 6: Market Context & History (10 pts max) ═══ */
    var ctxScore=0;
    if(monitorState&&monitorState.coinStats&&monitorState.coinStats[r.s]){
      var cs=monitorState.coinStats[r.s];
      if(cs.rate>=65)ctxScore+=4;
      else if(cs.rate>=50)ctxScore+=2;
      else if(cs.total>=5&&cs.rate<30)ctxScore-=3;
    }
    if(T.BTC&&T.BTC.c>1)ctxScore+=2;
    else if(T.BTC&&T.BTC.c<-3)ctxScore-=3;
    if(newsSentiment&&newsSentiment.total>3){
      if(newsSentiment.score>65)ctxScore+=2;
      else if(newsSentiment.score<30)ctxScore-=2;
    }
    if(fgValue<25)ctxScore+=2;
    else if(fgValue>80)ctxScore-=1;
    if(typeof stablecoinData!=='undefined'&&stablecoinData){
      var usdtData=stablecoinData['USDT']||stablecoinData['usdt'];
      if(usdtData&&usdtData.change7d){
        if(usdtData.change7d>0.5)ctxScore+=2;
        else if(usdtData.change7d<-0.5)ctxScore-=2;
      }
    }
    if(typeof tokenUnlocks!=='undefined'&&tokenUnlocks&&tokenUnlocks.length){
      var now2=new Date();
      var smallUnlock=tokenUnlocks.some(function(u){
        if(!u||!u.sym||u.sym!==r.s)return false;
        var daysUntil=(new Date(u.date)-now2)/86400000;
        return daysUntil>=0&&daysUntil<=14&&u.amount>1000000;
      });
      if(smallUnlock)ctxScore-=3;
    }
    ctxScore=Math.max(-5,Math.min(ctxMax,ctxScore));

    /* ═══ TOTAL PRIORITY ═══ */
    var priority=whaleScore+smartScore+techScore+fundScore+timeScore+ctxScore;
    var conf=Math.min(99,Math.max(30,Math.round(45+priority*0.55)));

    /* ═══ Entry / Target / Stop ═══ */
    var entry,tp1,tp2,sl,rr;
    if(r.smartEntry&&r.smartEntry.entry>0){
      entry=r.smartEntry.entry;
      tp1=r.smartEntry.target1;
      tp2=r.smartEntry.target2;
      sl=r.smartEntry.stop;
      rr=r.smartEntry.rr;
    }else{
      var sup=ext?ext.sup:d.p*0.93;
      var res=ext?ext.res:d.p*1.08;
      entry=d.p;
      tp1=d.p+(res-d.p)*0.5;
      tp2=res;
      sl=sup-(d.p-sup)*0.3;
      rr=sl<d.p?((tp1-d.p)/(d.p-sl)):0;
    }
    if(sl>=d.p*0.99)sl=d.p*0.95;
    if(tp1<=d.p*1.01)tp1=d.p*1.05;
    if(tp2<=tp1)tp2=d.p*1.1;
    if(rr<1.5)return;

    /* ═══ SIGNAL QUALITY GATE ═══ */
    try{var gate=signalQualityGate(r.s,'top3',r.score);if(!gate.pass)return}catch(e){}

    /* ═══ Classify type ═══ */
    var type='';var icon='';
    if(r.ultra){type='ULTRA';icon='⭐'}
    else if(r.confirmed){type=ar?'إشارة قوية':'Strong';icon='🟢'}
    else if(r.tags&&r.tags.some(function(t){return t.indexOf('EARLY')!==-1||t.indexOf('STEALTH')!==-1})){type=ar?'صيد مبكر':'Early Catch';icon='💎'}
    else if(r.c>=3&&r.c<6){type=ar?'انفجار':'Breakout';icon='💥'}
    else if(r.c>=0.5&&r.c<3){type=ar?'تجميع':'Accumulation';icon='📊'}
    else{type=ar?'فرصة':'Opportunity';icon='📈'}

    /* ═══ Recommendation ═══ */
    var rec,recCol;
    if(conf>=90){rec=ar?'💡 شراء قوي':'💡 Strong Buy';recCol='var(--up)'}
    else if(conf>=80){rec=ar?'💡 فرصة ذهبية':'💡 Golden';recCol='var(--neon)'}
    else if(conf>=70){rec=ar?'💡 ادخل بحذر':'💡 Enter Carefully';recCol='var(--warn)'}
    else{rec=ar?'💡 راقب فقط':'💡 Watch Only';recCol='var(--t2)'}

    /* ═══ Collect badge data ═══ */
    var wBuy=0;try{wBuy=calcRealTotalBuy(r.s)||0}catch(e){}
    var topPct=0;
    if(topTradersLS[r.s]&&topTradersLS[r.s].accounts&&topTradersLS[r.s].accounts.length){
      var tl=topTradersLS[r.s].accounts[topTradersLS[r.s].accounts.length-1];
      topPct=tl.long?Math.round(tl.long*100):0;
    }
    var vpinVal=0;try{var vpRes=calcVPIN(r.s);if(vpRes)vpinVal=vpRes.vpin}catch(e){}
    var iceBadge='';
    if(ice&&ice.signal==='ICEBERG_BUY')iceBadge=ar?'🧊 شراء خفي':'🧊 Iceberg Buy';
    var predArrow='';var predSc=0;
    if(pred){predSc=pred.sc;predArrow=pred.sc>=5?'🔼':pred.sc>=2?'↗':pred.sc<=-3?'🔽':''}

    opps.push({
      s:r.s,p:d.p,c:r.c,v:d.v,score:r.score,priority:priority,type:type,icon:icon,
      conf:conf,rec:rec,recCol:recCol,passed:r.passed,total:r.total||6,
      waves:wWaves,wBuy:wBuy,
      detectedAt:r.detectedAt||Date.now(),
      tp1:tp1,tp2:tp2,sl:sl,rr:rr,entry:entry,
      whaleScore:whaleScore,smartScore:smartScore,techScore:techScore,
      fundScore:fundScore,timeScore:timeScore,ctxScore:ctxScore,
      wPnL:wPnL,topPct:topPct,vpinVal:vpinVal,iceBadge:iceBadge,
      predArrow:predArrow,predSc:predSc,
      freshness:r.freshness||'',priceAtDetection:r.priceAtDetection||0,
      changeFromDetection:r.changeFromDetection||0,ageMinutes:r.ageMinutes||0
    });
  });

  opps.sort(function(a,b){return b.priority-a.priority});
  var top=opps.slice(0,3);

  /* ═══ Quality controls ═══ */
  if(!top.length||top[0].priority<25){
    el.innerHTML='<div class="muted">'+(ar
      ?'🎯 لا صفقات VIP حالياً — الفلتر الذكي لا يقبل إلا الأفضل'
      :'🎯 No VIP trades right now — Smart filter accepts only the best')+'</div>';
    return;
  }
  top=top.filter(function(o){return o.priority>=25});
  if(!top.length){
    el.innerHTML='<div class="muted">'+(ar
      ?'🎯 لا صفقات VIP حالياً — الفلتر الذكي لا يقبل إلا الأفضل'
      :'🎯 No VIP trades right now — Smart filter accepts only the best')+'</div>';
    return;
  }

  var ranks=['gold','silver','bronze'];var rankIcons=['1️⃣','2️⃣','3️⃣'];

  el.innerHTML=top.map(function(o,i){
    var up=o.c>=0;
    var ta=timeAgo(o.detectedAt);

    /* Timing bar info */
    var ageStr=o.ageMinutes>0?(o.ageMinutes<60?Math.round(o.ageMinutes)+'m':Math.round(o.ageMinutes/60)+'h'):'--';
    var driftStr=o.changeFromDetection!==undefined?(o.changeFromDetection>=0?'+':'')+o.changeFromDetection.toFixed(1)+'%':'';
    var freshCls=o.freshness==='fresh'?'t3-fresh':o.freshness==='warm'?'t3-warm':'t3-old';

    /* Whale P&L badge */
    var wPnLBadge='';
    if(o.wPnL&&typeof o.wPnL.pct==='number'){
      var wCol=o.wPnL.pct>=0?'var(--up)':'var(--dn)';
      wPnLBadge='<span class="t3-badge" style="color:'+wCol+'">'+(ar?'🐋 PnL ':'🐋 PnL ')+(o.wPnL.pct>=0?'+':'')+o.wPnL.pct.toFixed(1)+'%</span>';
    }

    /* Smart money badge */
    var smBadge='';
    if(o.topPct>0)smBadge='<span class="t3-badge" style="color:var(--blue)">🧠 '+o.topPct+'%'+(ar?' كبار':' Top')+'</span>';

    /* VPIN badge */
    var vpinBadge='';
    if(o.vpinVal>0.4)vpinBadge='<span class="t3-badge" style="color:var(--purple)">📊 VPIN '+(o.vpinVal*100).toFixed(0)+'%</span>';

    /* Iceberg badge */
    var iceBadgeHtml='';
    if(o.iceBadge)iceBadgeHtml='<span class="t3-badge" style="color:var(--neon)">'+o.iceBadge+'</span>';

    /* Prediction arrow */
    var predHtml='';
    if(o.predArrow)predHtml='<span class="t3-badge" style="color:'+(o.predSc>=3?'var(--up)':'var(--dn)')+'">'+o.predArrow+(ar?' توقع':' Pred')+'</span>';

    return '<div class="top3-card '+ranks[i]+'" onclick="openCoin(\''+o.s+'\')">'

    /* Header row: rank + coin + type + conf */
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<div class="top3-rank" style="background:'+(i===0?'linear-gradient(135deg,#ffd700,#ff8c00)':i===1?'linear-gradient(135deg,#c0c0c0,#808080)':'linear-gradient(135deg,#cd7f32,#8b4513)')+';color:#fff">'+rankIcons[i]+'</div>'
    +'<div><div style="font-family:var(--fd);font-weight:800;font-size:14px;color:var(--t0)">'+o.icon+' '+o.s+'/USDT</div>'
    +'<div style="display:flex;align-items:center;gap:6px">'
    +'<span style="font-size:8px;font-family:var(--fm);color:var(--t2)">'+o.type+'</span>'
    +'<span class="t3-timing '+freshCls+'">'+(o.freshness==='fresh'?'🆕 ':'')+ta.text+'</span>'
    +'</div></div></div>'
    +'<div class="top3-conf" style="background:'+(o.conf>=90?'var(--ud)':o.conf>=80?'var(--nd)':'var(--wd)')+';color:'+(o.conf>=90?'var(--up)':o.conf>=80?'var(--neon)':'var(--warn)')+'">'+
    (ar?'ثقة':'Conf')+' '+o.conf+'%</div></div>'

    /* Timing bar: age + price at detection + drift */
    +'<div class="t3-timing-bar">'
    +'<span>⏱ '+ageStr+'</span>'
    +(o.priceAtDetection>0?'<span>'+(ar?'سعر الاكتشاف':'Detected@')+' '+fP(o.priceAtDetection)+'</span>':'')
    +(driftStr?'<span style="color:'+(o.changeFromDetection>=0?'var(--up)':'var(--dn)')+'">'+driftStr+'</span>':'')
    +'</div>'

    /* Price + change */
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    +'<span style="font-family:var(--fm);font-size:18px;font-weight:800;color:var(--t0);direction:ltr">'+fP(o.p)+'</span>'
    +'<span style="font-family:var(--fm);font-size:13px;font-weight:800;color:var(--'+(up?'up':'dn')+');direction:ltr">'+(up?'+':'')+o.c.toFixed(1)+'%</span></div>'

    /* Intelligence badges row */
    +'<div class="t3-badges">'
    +'<span class="t3-badge" style="background:var(--bg2);color:var(--t1)">'+o.passed+'/'+o.total+'✅</span>'
    +(o.waves>0?'<span class="t3-badge" style="background:var(--nd);color:var(--neon)">🐋'+o.waves+'</span>':'')
    +(o.wBuy>0?'<span class="t3-badge" style="background:rgba(0,212,255,.08);color:var(--blue)">$'+fmt(o.wBuy)+'</span>':'')
    +(o.rr>=1.5?'<span class="t3-badge" style="background:rgba(0,255,136,.08);color:var(--up)">R/R 1:'+o.rr.toFixed(1)+'</span>':'')
    +wPnLBadge+smBadge+vpinBadge+iceBadgeHtml+predHtml
    +'</div>'

    /* 6-category score breakdown */
    +'<div class="t3-score-row">'
    +'<span class="t3-cat" style="color:var(--blue)">'+(ar?'حوت':'W')+':'+o.whaleScore+'</span>'
    +'<span class="t3-cat" style="color:var(--purple)">'+(ar?'ذكي':'SM')+':'+o.smartScore+'</span>'
    +'<span class="t3-cat" style="color:#8b5cf6">'+(ar?'فنّي':'T')+':'+o.techScore+'</span>'
    +'<span class="t3-cat" style="color:var(--neon)">'+(ar?'تمويل':'F')+':'+o.fundScore+'</span>'
    +'<span class="t3-cat" style="color:var(--warn)">⏱:'+o.timeScore+'</span>'
    +'<span class="t3-cat" style="color:var(--t2)">'+(ar?'سياق':'C')+':'+o.ctxScore+'</span>'
    +'<div style="margin-'+(ar?'right':'left')+':auto;font-size:10px;font-weight:700;color:'+o.recCol+'">'+o.rec+'</div>'
    +'</div>'

    /* Entry / TP / SL bar */
    +'<div class="t3-levels">'
    +'<span style="color:var(--t1)">'+(ar?'دخول':'Entry')+' '+fP(o.entry)+'</span>'
    +'<span style="color:var(--up)">🎯 '+fP(o.tp1)+'</span>'
    +'<span style="color:var(--up)">🎯🎯 '+fP(o.tp2)+'</span>'
    +'<span style="color:var(--dn)">🛑 '+fP(o.sl)+'</span>'
    +'</div>'

    +'</div>';
  }).join('');
}
/* 📈 MARKET MOVEMENT PAGE */
async function loadMarket(){if(curMktTab===0)loadBTCChart();else loadETHChart()}
/* Market chart auto-refresh interval moved into init() */
/* 🤖 DATA VALIDATOR + AUTO-REPAIR + CONNECTION QUALITY */
var validatorLog=[];var lastDataTime=Date.now();var validatorStatus='ok';
var connMetrics={apiOk:0,apiFail:0,wsUp:false,lastLatency:0,lastCheck:Date.now()};
function addVLog(type,msg){validatorLog.unshift({type:type,msg:msg,time:Date.now()});if(validatorLog.length>30)validatorLog=validatorLog.slice(0,30)}
function getConnQuality(){
  var score=100;
  /* Data freshness */
  var age=Date.now()-lastDataTime;
  if(age>30000)score-=40;else if(age>15000)score-=15;
  /* API success rate */
  var total=connMetrics.apiOk+connMetrics.apiFail;
  if(total>0){var rate=connMetrics.apiOk/total;if(rate<0.5)score-=30;else if(rate<0.8)score-=10}
  /* Coins loaded */
  var coins=Object.keys(T).length;
  if(coins<100)score-=20;else if(coins<300)score-=5;
  return Math.max(0,Math.min(100,score))}
function updateConnStatus(){
  var q=getConnQuality();var el=document.getElementById('connStatus');var dot=document.getElementById('validatorDot');
  var txt,col;
  if(q>=80){txt=lang==='ar'?'ممتازة':'Excellent';col='var(--up)'}
  else if(q>=50){txt=lang==='ar'?'جيدة':'Good';col='var(--neon)'}
  else if(q>=30){txt=lang==='ar'?'عادية':'Fair';col='var(--warn)'}
  else{txt=lang==='ar'?'ضعيفة':'Poor';col='var(--dn)'}
  if(el){el.textContent=txt;el.style.color=col}
  if(dot){dot.style.background=col;dot.style.boxShadow='0 0 6px '+col}}
async function runValidator(){
  var issues=0,fixes=0;
  var tkAge=Date.now()-lastDataTime;
  if(tkAge>120000){addVLog('🔴','البيانات قديمة '+Math.round(tkAge/60000)+' دقيقة — يعيد التحميل');issues++;try{await loadTk();lastDataTime=Date.now();fixes++;connMetrics.apiOk++;addVLog('🔧','تم إعادة تحميل البيانات ✅')}catch(e){connMetrics.apiFail++;addVLog('❌','فشل إعادة التحميل')}}
  else if(tkAge>90000){addVLog('🟡','البيانات عمرها '+Math.round(tkAge/60000)+' دقيقة');issues++}
  if(T.BTC&&T.BTC.by){var diff=Math.abs(T.BTC.p-T.BTC.by)/T.BTC.p*100;if(diff>2){addVLog('🔴','فرق BTC بين Binance/Bybit: '+diff.toFixed(1)+'%');issues++}else{addVLog('✅','BTC Binance/Bybit متطابق ('+diff.toFixed(2)+'%)')}}
  if(T.BTC&&CBP.BTC){var cbDiff=Math.abs(T.BTC.p-CBP.BTC)/T.BTC.p*100;if(cbDiff>3){addVLog('🔴','فرق BTC Binance/Coinbase: '+cbDiff.toFixed(1)+'%');issues++;CBP.BTC=T.BTC.p;fixes++;addVLog('🔧','صحح سعر Coinbase')}else{addVLog('✅','BTC Coinbase متطابق ('+cbDiff.toFixed(2)+'%)')}}
  if(cache.scan){var whales=cache.scan.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')})});
    whales.slice(0,5).forEach(function(w){
      if(w.c>15){addVLog('🟡','حوت '+w.s+': صعد +'+w.c.toFixed(1)+'% — ممكن اكتشاف متأخر');issues++}
      else{addVLog('✅','حوت '+w.s+': +'+w.c.toFixed(1)+'% — اكتشاف مبكر ✅')}})}
  if(cache.scan){cache.scan.filter(function(r){return r.c>=8&&r.score>=40}).slice(0,3).forEach(function(r){
    if(r.c>=25){addVLog('🟡','انفجار '+r.s+': +'+r.c.toFixed(0)+'% — اكتشاف متأخر');issues++}})}
  if(cache.scan){var gems=cache.scan.filter(function(r){return r.tags.some(function(t){return t.includes('EARLY')})&&r.c<3});
    if(gems.length>0)addVLog('✅','جواهر: '+gems.length+' إشارة مبكرة (<3%)');
    var lateGems=cache.scan.filter(function(r){return r.c>=20&&r.tags.some(function(t){return t.includes('LATE')})});
    if(lateGems.length>0){addVLog('🟡','جواهر متأخرة: '+lateGems.length+' عملة فوق +20%');issues++}}
  var frCount=Object.keys(FR).length;
  if(frCount<10){addVLog('🟡','FR: فقط '+frCount+' عملة — يعيد التحميل');issues++;try{await loadTk();fixes++;connMetrics.apiOk++;addVLog('🔧','أعاد تحميل من Proxy ✅')}catch(e){connMetrics.apiFail++}}
  else{addVLog('✅','FR: '+frCount+' عملة محمّلة')}
  var coinCount=Object.keys(T).length;
  if(coinCount<100){addVLog('🔴','عملات: '+coinCount+' فقط');issues++;try{await loadTk();lastDataTime=Date.now();fixes++;connMetrics.apiOk++}catch(e){connMetrics.apiFail++}}
  else{addVLog('✅','عملات: '+coinCount+' محمّلة')}
  validatorStatus=issues===0?'ok':issues<=3?'ok':'warn';
  updateValidatorUI(issues,fixes);updateConnStatus();
  return{issues:issues,fixes:fixes}}
function updateValidatorUI(issues,fixes){
  var el=document.getElementById('validatorDot');var el2=document.getElementById('validatorDot2');var st=document.getElementById('validatorStatus');
  var col=validatorStatus==='ok'?'var(--up)':validatorStatus==='warn'?'var(--warn)':'var(--dn)';
  var txt=validatorStatus==='ok'?(lang==='ar'?'✅ كل شي سليم':'✅ All clear'):validatorStatus==='warn'?(lang==='ar'?'⚠️ '+issues+' ملاحظة':'⚠️ '+issues+' issues'):(lang==='ar'?'🔴 '+issues+' مشكلة | '+fixes+' أُصلحت':'🔴 '+issues+' problems | '+fixes+' fixed');
  if(el){el.style.background=col;el.style.boxShadow='0 0 6px '+col}
  if(el2){el2.style.background=col;el2.style.boxShadow='0 0 6px '+col}
  if(st){st.textContent=txt;st.style.color=col}
  renderValidatorLog()}
function renderValidatorLog(){
  var el=document.getElementById('validatorPanel');if(!el)return;
  el.innerHTML=validatorLog.length?validatorLog.map(function(l){var a=timeAgo(l.time);return'<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--bdr);font-size:9px"><span>'+l.type+'</span><span style="flex:1;color:var(--t1)">'+l.msg+'</span><span style="color:var(--t3);font-family:var(--fm);font-size:7px;flex-shrink:0">'+a.text+'</span></div>'}).join(''):'<div style="text-align:center;color:var(--t3);font-size:10px;padding:10px">🤖 '+(lang==='ar'?'لم يتم الفحص بعد':'Not scanned yet')+'</div>'}
/* scanBybitGainers — removed as dead code (never called) */
/* INIT */
async function init(){try{document.getElementById('sInp').placeholder=t('search_ph')}catch(e){}try{document.getElementById('notifB').dataset.c='0'}catch(e){}
  loadProfile();loadToneUI();updateMenuLang();updateMenuTheme();
  if(tg){try{tg.setHeaderColor(document.body.dataset.theme==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(document.body.dataset.theme==='dark'?'#020408':'#f0f4f8')}catch(e){}}
  try{await loadDash()}catch(e){console.error('init loadDash:',e)}
  try{renderPort()}catch(e){}
  try{updateConnStatus()}catch(e){}
  /* On-Chain + Wallet check */
  setTimeout(fetchOnChainBTC,10000);setInterval(fetchOnChainBTC,120000);
  /* Multi-Exchange data now comes via /api/all in loadTk — no separate fetch needed */
  setTimeout(checkWallets,20000);setInterval(checkWallets,120000);
  /* Delayed retry — if data still empty after 15s, refetch from proxy */
  setTimeout(async function(){
    try{
      if(!Object.keys(FR).length||!Object.keys(OI).length||!Object.keys(takerData).length){console.log('Retry loadTk from proxy...');await loadTk()}
    }catch(e){}
  },15000);
  /* ═══ TOP 100 AUTO-UPDATE: CoinGecko every hour ═══ */
  setTimeout(updateTop100,5000);setInterval(updateTop100,3600000);
  /* ═══ MAIN POLLING: fetch /api/all every 5 seconds ═══ */
  setInterval(async function(){try{await loadTk();checkWatchlistAlerts();updateConnStatus()}catch(e){connMetrics.apiFail++;updateConnStatus()}},5000);
  setInterval(async function(){if(document.getElementById('pg-dash').classList.contains('act'))try{await loadDash()}catch(e){}},120000);
  setInterval(monitorTrades,10000);
  setInterval(function(){try{renderTop3()}catch(e){}},60000); /* Auto-update VIP trades every minute */
  setInterval(function(){try{notifiedSet={};localStorage.setItem('nxnot10','{}')}catch(e){};try{tgSent={}}catch(e){}},3600000);
  setTimeout(function(){runValidator()},10000);
  setInterval(function(){runValidator()},90000);
  /* Market chart auto-refresh (moved from module-level) */
  setInterval(function(){
    var pgEl=document.getElementById('pg-market');
    if(pgEl&&pgEl.classList.contains('act')){
      if(curMktTab===0&&Date.now()-btcCache.t>=MKT_TTL)loadBTCChart();
      else if(curMktTab===1&&Date.now()-ethCache.t>=MKT_TTL)loadETHChart();
    }
  },60000);
  // === MONITOR: Weekly auto-tune / auto-improve check ===
  try {
    var weekMs = 7 * 24 * 3600000;
    if (monitorState && Date.now() - monitorState.lastTune > weekMs) {
      if (monitorState.perf.totalTrades >= 10) {
        runAutoImprove(); // comprehensive (includes autoTuneWeights + blacklist + minConf + report)
      } else {
        autoTuneWeights(); // lightweight (weights only, needs 5+ per factor)
      }
    }
  } catch(e) {}
  // === MONITOR: Run pattern detection every 6 hours ===
  setInterval(function() {
    try { detectFailPatterns(); } catch(e) {}
  }, 6 * 3600000);
  // === SUPERVISOR: Hourly collection ===
  setInterval(function() { try { supervisorCollect(); } catch(e) {} }, 3600000);
  // === SUPERVISOR: Daily report (every 24h) ===
  setInterval(function() { try { supervisorDailyReport(); } catch(e) {} }, 86400000);
  // === SUPERVISOR: First collection after 30s ===
  setTimeout(function() { try { supervisorCollect(); } catch(e) {} }, 30000);
  // === SUPERVISOR: Generate first report after 60s if none exists ===
  setTimeout(function() { try { if (!supervisorData.dailyReport) supervisorDailyReport(); } catch(e) {} }, 60000);
}
init();
/* PWA Service Worker */
if('serviceWorker' in navigator){try{navigator.serviceWorker.register('./sw.js')}catch(e){}}
