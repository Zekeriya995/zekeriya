/* NEXUS PRO V10 — Early Detection + Sound Alerts + Smart Cache + 6 Checks */
const tg=window.Telegram?.WebApp;if(tg){tg.ready();tg.expand();tg.setHeaderColor('#060b14');tg.setBackgroundColor('#020408')}
const BN='https://api.binance.com/api/v3',BF='https://fapi.binance.com/fapi/v1',CG='https://api.coingecko.com/api/v3',CB='https://api.coinbase.com/v2';
const WL=['BTC','ETH','SOL','BNB','XRP','LINK','AVAX','DOGE','ADA','DOT','MATIC','UNI','ATOM','ARB','OP','INJ','SUI','SEI','TIA','FTM','NEAR','APT','LTC','PEPE','WIF'];
/* ═══ 🏆 3-TIER SYSTEM — Smart Coin Focus ═══ */
var TIER1=new Set(WL); /* Top 25 — Full Power */
var tier2Coins=[],tier3Coins=[];var tierLastRefresh=0;
function getCoinTier(s){if(TIER1.has(s))return 1;if(tier2Coins.includes(s))return 2;if(tier3Coins.includes(s))return 3;return 0}
function getTierBadge(s){var t=getCoinTier(s);return t===1?'🏆':t===2?'🥈':t===3?'🔍':''}
async function refreshTiers(){if(Date.now()-tierLastRefresh<4*3600000&&tier2Coins.length>0)return;tierLastRefresh=Date.now();
  var STABLES=['USDT','USDC','TUSD','DAI','BUSD','FDUSD','USDP','PYUSD'];var ranked=Object.entries(T).filter(function(e){return!STABLES.includes(e[0])&&!TIER1.has(e[0])&&e[1].v>1000000}).sort(function(a,b){return b[1].v-a[1].v}).map(function(e){return e[0]});
  tier2Coins=ranked.slice(0,75);tier3Coins=ranked.slice(75,275);
  console.log('[Tiers] T1:'+TIER1.size+' T2:'+tier2Coins.length+' T3:'+tier3Coins.length)}
/* Volume Spike: T3 → T2 auto-promote */
var volBaselines={};
function checkVolSpikes(){tier3Coins.forEach(function(s){var d=T[s];if(!d)return;if(!volBaselines[s]){volBaselines[s]=d.v;return}var spike=d.v/Math.max(volBaselines[s],1);if(spike>=5){tier2Coins.push(s);tier3Coins=tier3Coins.filter(function(x){return x!==s});notify(s,'gem',0);setTimeout(function(){if(!TIER1.has(s)){tier2Coins=tier2Coins.filter(function(x){return x!==s});tier3Coins.push(s)}},7200000)}volBaselines[s]=volBaselines[s]*0.95+d.v*0.05})}
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
const COL={BTC:'#f7931a',ETH:'#627eea',SOL:'#9945ff',BNB:'#f0b90b',XRP:'#23292f',LINK:'#2a5ada',AVAX:'#e84142',DOGE:'#c2a633',ADA:'#0033ad',DOT:'#e6007a',MATIC:'#8247e5',UNI:'#ff007a',ATOM:'#2e3148',ARB:'#28a0f0',OP:'#ff0420',INJ:'#00f2fe',SUI:'#4da2ff',SEI:'#9b1c1c',TIA:'#7c3aed',FTM:'#1969ff',NEAR:'#00c08b',APT:'#00bfa6',LTC:'#bfbbbb',PEPE:'#4c8c2f',WIF:'#8b5cf6'};
let T={},FR={},OI={},LS={},CBP={},ws=null,curCoin='BTC',curTF='1h',inds={vol:1,sma:0,rsi:0,sr:0,bb:0,macd:0,ema:0,pat:0};
var lsHist={},takerData={}; /* L/S Intelligence v2.0 */
let sparkHist={}; /* Real sparkline data per coin */
let whaleWaves={};try{whaleWaves=JSON.parse(localStorage.getItem('nxww10')||'{}')}catch(e){}
let prevOB={}; /* Previous Order Book snapshots */
let portfolio=[];try{portfolio=JSON.parse(localStorage.getItem('nxp10')||'[]')}catch(e){}
let predictions=[];try{predictions=JSON.parse(localStorage.getItem('nxpred10')||'[]')}catch(e){}
var activeTrades=[];try{activeTrades=JSON.parse(localStorage.getItem('nxTrades')||'[]')}catch(e){}
let sigHist={};try{sigHist=JSON.parse(localStorage.getItem('nxsig10')||'{}')}catch(e){}
let notifiedSet={};try{notifiedSet=JSON.parse(localStorage.getItem('nxnot10')||'{}')}catch(e){};
let lang=localStorage.getItem('nxlang')||'ar';
let fgValue=50,btcDom=50;
/* ═══ 🤖 PLATFORM MONITOR — PART A ═══ */
var MONITOR_VERSION = 1;
var DEFAULT_WEIGHTS = {trend:2, whales:2, rsi:1, fr:1, oi:1, vol:0.5, macd:0.5, confluence:1, structure:1};

var monitorState = null;
try { monitorState = JSON.parse(localStorage.getItem('nxMonitor')); } catch(e) { monitorState = null; }
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
      structure: {wins:0, losses:0, total:0, winRate:0}
    },
    confCalib: {},
    hourStats: {},
    coinStats: {},
    coinBlacklist: [],
    failPatterns: [],
    minConf: 55,
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

function saveMonitor() {
  try { localStorage.setItem('nxMonitor', JSON.stringify(monitorState)); } catch(e) {}
}
function saveFactorLog() {
  if (factorLog.length > 500) factorLog = factorLog.slice(-500);
  try { localStorage.setItem('nxFactorLog', JSON.stringify(factorLog)); } catch(e) {}
}

/* Takes a snapshot of which factors are active at trade entry */
function captureFactorSnapshot(sym) {
  var d = T[sym]; if (!d) return null;
  var fr = FR[sym];
  var ls = LS[sym];
  var oi = OI[sym];
  var ww = whaleWaves[sym];
  var wConf = ww && ww.engine ? ww.engine.confidence : 0;
  var cvd = analyzeCVD(sym);

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
      structure:  true
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

  var confBucket = Math.floor(trade.confAtEntry / 10) * 10;
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
  if (cs.total >= 5 && cs.rate < 40 && bl.indexOf(coinKey) === -1) {
    bl.push(coinKey);
  }
  if (cs.rate >= 50 && bl.indexOf(coinKey) !== -1) {
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

  var overallRate = monitorState.perf.overallRate;
  if (overallRate < 55 && monitorState.minConf < 70) {
    monitorState.minConf = Math.min(70, monitorState.minConf + 3);
  } else if (overallRate > 75 && monitorState.minConf > 50) {
    monitorState.minConf = Math.max(50, monitorState.minConf - 2);
  }

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

  monitorState.lastTune = Date.now();
  saveMonitor();

  addVLog('🧠', (lang === 'ar'
    ? 'تعلّم ذاتي: أوزان عُدّلت — أفضل: ' + bestKey + ' (' + bestRate + '%) — أضعف: ' + worstKey + ' (' + worstRate + '%)'
    : 'Auto-tune: weights adjusted — Best: ' + bestKey + ' (' + bestRate + '%) — Worst: ' + worstKey + ' (' + worstRate + '%)'));

  return {best: bestKey, bestRate: bestRate, worst: worstKey, worstRate: worstRate};
}

/* Calibrate displayed confidence based on actual outcomes */
function getCalibratedConf(rawConf) {
  var bucket = Math.floor(rawConf / 10) * 10;
  var key = bucket + '-' + (bucket + 10);
  var cb = monitorState.confCalib[key];
  if (cb && cb.total >= 5) {
    return cb.realRate;
  }
  return rawConf;
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

  var d = T[sym];
  var g1 = d && d.p > 0;
  results.push({name: lang === 'ar' ? 'سعر حقيقي' : 'Real price', pass: g1});
  if (!g1) pass = false;

  var minVol = TIER1.has(sym) ? 500000 : 1000000;
  var g2 = d && d.v >= minVol;
  results.push({name: lang === 'ar' ? 'حجم كافي' : 'Volume OK', pass: g2, detail: d ? fmt(d.v) : '$0'});
  if (!g2) pass = false;

  var mkt = detectMarketDanger();
  var g3 = !mkt.dangerous;
  results.push({name: lang === 'ar' ? 'السوق آمن' : 'Market safe', pass: g3, detail: mkt.level});
  if (!g3 && type !== 'whale') pass = false;

  var g4 = !isCoinBlacklisted(sym);
  results.push({name: lang === 'ar' ? 'عملة غير محظورة' : 'Not blacklisted', pass: g4});
  if (!g4) pass = false;

  var snap = captureFactorSnapshot(sym);
  var failPat = snap ? matchesFailPattern(snap.raw) : null;
  var g5 = !failPat;
  results.push({name: lang === 'ar' ? 'لا نمط فشل' : 'No fail pattern', pass: g5, detail: failPat ? failPat.label : ''});
  if (!g5 && failPat && failPat.failRate >= 70) pass = false;

  try {
    addVLog(pass ? '✅' : '🚫',
      (pass ? '' : '⛔ ') + sym + ' ' + type + ' — Gate: ' + results.filter(function(r) { return r.pass; }).length + '/5 ' +
      (pass ? (lang === 'ar' ? 'مرّ' : 'PASS') : (lang === 'ar' ? 'مرفوض: ' + results.filter(function(r) { return !r.pass; }).map(function(r) { return r.name; }).join(', ') : 'BLOCKED: ' + results.filter(function(r) { return !r.pass; }).map(function(r) { return r.name; }).join(', ')))
    );
  } catch(e) {}

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
    if (cs.total >= 5 && cs.rate < 40 && !inBL) {
      monitorState.coinBlacklist.push(coin);
      addedToBL.push(coin);
    }
    if (cs.total >= 5 && cs.rate >= 50 && inBL) {
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

/* ═══ ADMIN PANEL RENDERER ═══ */
var adminTapCount = 0;
var adminTapTimer = null;

function openAdminPanel() {
  adminTapCount++;
  if (adminTapTimer) clearTimeout(adminTapTimer);
  adminTapTimer = setTimeout(function() { adminTapCount = 0; }, 800);
  if (adminTapCount >= 3) {
    adminTapCount = 0;
    document.querySelectorAll('.pg').forEach(function(p) { p.classList.remove('act'); p.style.display = ''; });
    document.querySelectorAll('.bb').forEach(function(b) { b.classList.remove('act'); });
    var el = document.getElementById('pg-admin');
    if (el) { el.classList.add('act'); }
    renderAdminPanel();
    window.scrollTo({top: 0});
  }
}

function renderAdminPanel() {
  if (!monitorState) return;
  var ms = monitorState;
  var ar = lang === 'ar';

  var sumEl = document.getElementById('adminSummary'); if (!sumEl) return;
  var mkt = detectMarketDanger();
  var conn = getConnQuality();
  var mktCol = mkt.level === 'safe' ? 'var(--up)' : mkt.level === 'caution' ? 'var(--warn)' : 'var(--dn)';
  var mktIc = mkt.level === 'safe' ? '🟢' : mkt.level === 'caution' ? '🟡' : '🔴';
  var rateCol = ms.perf.overallRate >= 65 ? 'var(--up)' : ms.perf.overallRate >= 50 ? 'var(--warn)' : 'var(--dn)';

  sumEl.innerHTML = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">'
    + '<div class="cd" style="padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:' + rateCol + '">' + ms.perf.overallRate + '%</div><div style="font-size:9px;color:var(--t2)">' + (ar ? 'نسبة النجاح' : 'Success Rate') + '</div><div style="font-size:8px;font-family:var(--fm);color:var(--t3)">' + ms.perf.totalWins + '/' + ms.perf.totalTrades + '</div></div>'
    + '<div class="cd" style="padding:10px;text-align:center"><div style="font-size:20px">' + mktIc + '</div><div style="font-size:9px;color:var(--t2)">' + (ar ? 'حالة السوق' : 'Market') + '</div><div style="font-size:8px;color:' + mktCol + '">' + mkt.level + '</div></div>'
    + '<div class="cd" style="padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--neon)">' + conn + '</div><div style="font-size:9px;color:var(--t2)">' + (ar ? 'جودة الاتصال' : 'Connection') + '</div><div style="font-size:8px;color:var(--t3)">/100</div></div>'
    + '<div class="cd" style="padding:10px;text-align:center"><div style="font-family:var(--fm);font-size:20px;font-weight:800;color:var(--warn)">' + ms.minConf + '%</div><div style="font-size:9px;color:var(--t2)">' + (ar ? 'حد أدنى ثقة' : 'Min Confidence') + '</div><div style="font-size:8px;color:var(--t3)">' + (ar ? 'تعديل تلقائي' : 'Auto-adjusted') + '</div></div>'
    + '</div>';

  var facEl = document.getElementById('adminFactors'); if (facEl) {
    var facH = '';
    var keys = Object.keys(ms.factorStats);
    keys.sort(function(a, b) { return (ms.factorStats[b].winRate || 0) - (ms.factorStats[a].winRate || 0); });
    keys.forEach(function(key) {
      var f = ms.factorStats[key];
      var wr = f.winRate || 0;
      var wCol = wr >= 70 ? 'var(--up)' : wr >= 50 ? 'var(--warn)' : 'var(--dn)';
      var wt = ms.weights[key] || 0;
      var defW = DEFAULT_WEIGHTS[key] || 0;
      var wtChg = defW > 0 ? Math.round((wt / defW - 1) * 100) : 0;
      var wtCol = wtChg > 0 ? 'var(--up)' : wtChg < 0 ? 'var(--dn)' : 'var(--t3)';
      facH += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bdr);font-size:10px">'
        + '<span style="font-weight:700;min-width:60px">' + key + '</span>'
        + '<span style="font-family:var(--fm);font-weight:700;color:' + wCol + '">' + wr + '%</span>'
        + '<span style="font-family:var(--fm);font-size:8px;color:var(--t3)">' + f.wins + 'W / ' + f.total + 'T</span>'
        + '<span style="font-family:var(--fm);font-size:8px;color:' + wtCol + '">' + (wtChg >= 0 ? '+' : '') + wtChg + '%</span>'
        + '</div>';
    });
    facEl.innerHTML = facH || '<div style="color:var(--t3);font-size:10px;text-align:center;padding:8px">' + (ar ? 'لا بيانات بعد' : 'No data yet') + '</div>';
  }

  var confEl = document.getElementById('adminConf'); if (confEl) {
    var confH = '';
    var buckets = Object.keys(ms.confCalib).sort();
    buckets.forEach(function(b) {
      var c = ms.confCalib[b];
      var col = c.realRate >= 65 ? 'var(--up)' : c.realRate >= 45 ? 'var(--warn)' : 'var(--dn)';
      confH += '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:10px">'
        + '<span style="color:var(--t2)">' + (ar ? 'ثقة ' : 'Conf ') + b + '%</span>'
        + '<span style="font-family:var(--fm);font-weight:700;color:' + col + '">' + (ar ? 'فعلياً ' : 'Actual ') + c.realRate + '%</span>'
        + '<span style="font-size:8px;color:var(--t3)">(' + c.wins + '/' + c.total + ')</span></div>';
    });
    confEl.innerHTML = confH || '<div style="color:var(--t3);font-size:10px;text-align:center;padding:8px">' + (ar ? 'تحتاج 5+ صفقات لكل شريحة' : 'Need 5+ trades per bucket') + '</div>';
  }

  var timeEl = document.getElementById('adminTime'); if (timeEl) {
    var timeH = '<div style="display:flex;flex-wrap:wrap;gap:3px">';
    for (var h = 0; h < 24; h++) {
      var hs = ms.hourStats[String(h)];
      var rate = hs ? hs.rate : -1;
      var bg = rate < 0 ? 'var(--bg2)' : rate >= 65 ? 'rgba(0,255,136,.15)' : rate >= 45 ? 'rgba(255,184,0,.15)' : 'rgba(255,56,96,.15)';
      var col = rate < 0 ? 'var(--t3)' : rate >= 65 ? 'var(--up)' : rate >= 45 ? 'var(--warn)' : 'var(--dn)';
      timeH += '<div style="width:28px;padding:4px 2px;background:' + bg + ';border-radius:4px;text-align:center;font-size:7px">'
        + '<div style="color:var(--t3)">' + String(h).padStart(2, '0') + '</div>'
        + '<div style="font-weight:700;color:' + col + ';font-family:var(--fm)">' + (rate >= 0 ? rate + '%' : '--') + '</div></div>';
    }
    timeH += '</div>';
    if (ms.perf.bestHour >= 0) {
      timeH += '<div style="font-size:9px;margin-top:6px;color:var(--t2)">' + (ar ? 'أفضل ساعة: ' : 'Best hour: ') + '<b style="color:var(--up)">' + ms.perf.bestHour + ':00 UTC</b>'
        + (ms.perf.worstHour >= 0 ? ' — ' + (ar ? 'أضعف: ' : 'Worst: ') + '<b style="color:var(--dn)">' + ms.perf.worstHour + ':00 UTC</b>' : '') + '</div>';
    }
    timeEl.innerHTML = timeH;
  }

  var coinEl = document.getElementById('adminCoins'); if (coinEl) {
    var coinH = '';
    var coinKeys = Object.keys(ms.coinStats);
    coinKeys.sort(function(a, b) { return (ms.coinStats[b].rate || 0) - (ms.coinStats[a].rate || 0); });
    coinKeys.forEach(function(coin) {
      var cs = ms.coinStats[coin];
      var col = cs.rate >= 65 ? 'var(--up)' : cs.rate >= 45 ? 'var(--warn)' : 'var(--dn)';
      var isBL = ms.coinBlacklist.indexOf(coin) !== -1;
      coinH += '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--bdr);font-size:10px">'
        + '<span style="font-weight:700">' + coin + (isBL ? ' 🚫' : '') + '</span>'
        + '<span style="font-family:var(--fm);font-weight:700;color:' + col + '">' + cs.rate + '%</span>'
        + '<span style="font-size:8px;color:var(--t3)">' + cs.wins + '/' + cs.total + '</span></div>';
    });
    coinEl.innerHTML = coinH || '<div style="color:var(--t3);font-size:10px;text-align:center;padding:8px">--</div>';
  }

  var patEl = document.getElementById('adminPatterns'); if (patEl) {
    var patH = '';
    (ms.failPatterns || []).forEach(function(p) {
      patH += '<div style="padding:6px;background:rgba(255,56,96,.04);border:1px solid rgba(255,56,96,.06);border-radius:6px;margin-bottom:4px;font-size:10px">'
        + '<div style="font-weight:700;color:var(--dn)">' + p.label + '</div>'
        + '<div style="font-size:8px;color:var(--t3)">' + (ar ? 'عيّنات: ' : 'Samples: ') + p.sampleSize + '</div></div>';
    });
    patEl.innerHTML = patH || '<div style="color:var(--t3);font-size:10px;text-align:center;padding:8px">' + (ar ? 'لم تُكتشف أنماط فشل' : 'No patterns detected') + '</div>';
  }

  var wtEl = document.getElementById('adminWeights'); if (wtEl) {
    var wtH = '<div style="display:flex;flex-wrap:wrap;gap:4px">';
    Object.keys(ms.weights).forEach(function(key) {
      var w = ms.weights[key];
      var d = DEFAULT_WEIGHTS[key];
      var chg = d > 0 ? Math.round((w / d - 1) * 100) : 0;
      var col = chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--dn)' : 'var(--t2)';
      wtH += '<div style="padding:4px 8px;background:var(--bg2);border-radius:6px;text-align:center;font-size:9px">'
        + '<div style="font-weight:700">' + key + '</div>'
        + '<div style="font-family:var(--fm);color:' + col + '">' + w.toFixed(2) + '</div>'
        + '<div style="font-size:7px;color:var(--t3)">' + (chg >= 0 ? '+' : '') + chg + '%</div></div>';
    });
    wtH += '</div>';
    wtEl.innerHTML = wtH;
  }

  var hlEl = document.getElementById('adminHealth'); if (hlEl) {
    var wsOk = ws && ws.readyState === 1;
    var tkAge = Date.now() - lastDataTime;
    var total = connMetrics.apiOk + connMetrics.apiFail;
    var apiRate = total > 0 ? Math.round(connMetrics.apiOk / total * 100) : 0;
    hlEl.innerHTML = '<div style="font-size:10px">'
      + '<div style="padding:3px 0">WebSocket: <b style="color:' + (wsOk ? 'var(--up)' : 'var(--dn)') + '">' + (wsOk ? '✅' : '❌') + '</b></div>'
      + '<div style="padding:3px 0">' + (ar ? 'عمر البيانات: ' : 'Data age: ') + '<b>' + Math.round(tkAge / 1000) + 's</b></div>'
      + '<div style="padding:3px 0">API: <b style="color:' + (apiRate >= 90 ? 'var(--up)' : 'var(--warn)') + '">' + apiRate + '% (' + connMetrics.apiOk + '/' + total + ')</b></div>'
      + '<div style="padding:3px 0">' + (ar ? 'عملات: ' : 'Coins: ') + '<b>' + Object.keys(T).length + '</b></div>'
      + '<div style="padding:3px 0">FR: <b>' + Object.keys(FR).length + '</b> | OI: <b>' + Object.keys(OI).length + '</b></div>'
      + '</div>';
  }

  var wkEl = document.getElementById('adminWeekly'); if (wkEl) {
    var wkR = null;
    try { wkR = JSON.parse(localStorage.getItem('nxWeeklyReport')); } catch(e) {}
    if (wkR && wkR.changes) {
      var wkH = '<div style="font-size:10px">';
      wkH += '<div style="color:var(--t3);font-size:8px;margin-bottom:4px">' + new Date(wkR.time).toLocaleString() + '</div>';
      wkR.changes.forEach(function(c) { wkH += '<div style="padding:3px 0;border-bottom:1px solid var(--bdr)">\u2022 ' + c + '</div>'; });
      wkH += '</div>';
      wkEl.innerHTML = wkH;
    } else {
      wkEl.innerHTML = '<div style="color:var(--t3);font-size:10px;text-align:center;padding:8px">' + (ar ? 'لم يُجرَ تحسين بعد' : 'No improvement yet') + '</div>';
    }
  }
}
/* ═══ END MONITOR ═══ */
/* CACHE */
let cache={scan:null,scanTime:0,whale:null,whaleTime:0,fr:null,frTime:0};
const CACHE_TTL=60000;
const TR={nav_home:{ar:'الرئيسية',en:'Home'},nav_scan:{ar:'السكانر',en:'Scanner'},nav_whale:{ar:'حيتان',en:'Whales'},nav_ind:{ar:'مؤشرات',en:'Indicators'},nav_me:{ar:'حسابي',en:'Profile'},breakout:{ar:'بداية صعود',en:'Rising'},whales:{ar:'شراء حيتان',en:'Whale Buying'},scanning:{ar:'جاري المسح...',en:'Scanning...'},all:{ar:'الكل',en:'All'},full_scan:{ar:'مسح شامل',en:'Full Scan'},refresh:{ar:'تحديث',en:'Refresh'},total:{ar:'إجمالي',en:'Total'},buying:{ar:'شراء',en:'Buying'},selling:{ar:'بيع',en:'Selling'},success:{ar:'النجاح',en:'Success'},portfolio:{ar:'المحفظة',en:'Portfolio'},risk_calc:{ar:'حاسبة المخاطر',en:'Risk Calc'},alerts:{ar:'تنبيهات',en:'Alerts'},add_coins:{ar:'أضف عملات',en:'Add coins'},add_coin:{ar:'إضافة عملة',en:'Add Coin'},add:{ar:'إضافة',en:'Add'},cancel:{ar:'إلغاء',en:'Cancel'},back:{ar:'رجوع',en:'Back'},capital:{ar:'رأس المال',en:'Capital'},risk_pct:{ar:'المخاطرة',en:'Risk'},entry_price:{ar:'سعر الدخول',en:'Entry'},enter_data:{ar:'ادخل البيانات',en:'Enter data'},search_ph:{ar:'ابحث عن أي عملة...',en:'Search any coin...'},no_ultra:{ar:'لا ULTRA حالياً',en:'No ULTRA'},no_whale:{ar:'لا تجميع حيتان',en:'No whales'},confirmed:{ar:'مؤكدة',en:'Confirmed'},buy_strong:{ar:'شراء قوي',en:'Strong Buy'},buy:{ar:'شراء',en:'Buy'},sell:{ar:'بيع',en:'Sell'},hold:{ar:'انتظار',en:'Hold'},risk_amt:{ar:'💰 المخاطرة',en:'💰 Risk'},pos_size:{ar:'📦 الحجم',en:'📦 Size'},pos_val:{ar:'💵 القيمة',en:'💵 Value'},leverage:{ar:'📊 الرافعة',en:'📊 Leverage'},exp_profit:{ar:'🎯 الربح',en:'🎯 Profit'},sl_loss:{ar:'🛑 الخسارة',en:'🛑 Loss'},no_data:{ar:'لا بيانات',en:'No data'},empty_port:{ar:'فارغة',en:'Empty'},market_health:{ar:'🏥 صحة السوق',en:'🏥 Market Health'},smart_warn:{ar:'تحذيرات ذكية',en:'Smart Warnings'},sec_accuracy:{ar:'📈 نسبة النجاح',en:'📈 Accuracy'},scan_desc:{ar:'صيد مبكر — 6 فحوصات — 🏆 Top 100 Focus','en':'Early detection — 6 checks — 🏆 Top 100 Focus'},days:{ar:'يوم',en:'days'},today:{ar:'اليوم!',en:'Today!'},instant:{ar:'فوري',en:'Instant'},strong_signal:{ar:'شراء/بيع قوي',en:'Strong signal'},before_unlock:{ar:'قبل الفك',en:'Before unlock'},gems:{ar:'جواهر',en:'Gems'},gem_desc:{ar:'💎 عملات صغيرة بحركة غير عادية — فرص أرباح كبيرة',en:'💎 Small caps with unusual moves — big profit potential'},wl_desc:{ar:'👁 أضف عملات لمراقبتها 24/7',en:'👁 Add coins to watch 24/7'},stable_flow:{ar:'حركة الأموال',en:'Money Flow'},sf_index:{ar:'مؤشر التدفق',en:'Flow Index'},sf_buy:{ar:'شراء كريبتو',en:'Buying Crypto'},sf_sell:{ar:'بيع كريبتو',en:'Selling Crypto'},sf_neutral:{ar:'متوازن',en:'Balanced'},online:{ar:'متصل',en:'online'},settings:{ar:'الإعدادات',en:'Settings'},profile:{ar:'👤 الملف الشخصي',en:'👤 Profile'},general:{ar:'⚙️ عام',en:'⚙️ General'},language:{ar:'اللغة',en:'Language'},theme:{ar:'الثيم',en:'Theme'},sound:{ar:'الصوت',en:'Sound'},tone:{ar:'🔔 نغمة الإشعار',en:'🔔 Notification Tone'},t_bell:{ar:'جرس',en:'Bell'},t_horn:{ar:'بوق',en:'Horn'},t_pulse:{ar:'نبض',en:'Pulse'},t_silent:{ar:'صامت',en:'Silent'},about:{ar:'عن المنصة',en:'About'},clear_data:{ar:'مسح البيانات',en:'Clear Data'},mkt_dir:{ar:'اتجاه السوق',en:'Market Direction'},mkt_dir_sub:{ar:'تقرير مفصل — BTC & ETH — كل 4 ساعات',en:'Detailed Report — BTC & ETH — Every 4h'},nav_market:{ar:'حركة السوق',en:'Market'},top3:{ar:'أفضل 3 فرص الآن',en:'Top 3 Opportunities Now'},scan_trade:{ar:'صفقات مضاربة',en:'Trading'},scan_trend:{ar:'ترند القطاعات',en:'Sector Trends'},scan_gems:{ar:'صيد الجواهر',en:'Gem Hunter'},scan_all:{ar:'الكل',en:'All'},scan_fast:{ar:'⚡ سريع',en:'⚡ Fast'},scan_daily:{ar:'📊 يومي',en:'📊 Daily'},scan_early:{ar:'🟢 مبكر',en:'🟢 Early'},scan_still:{ar:'🟡 فرصة',en:'🟡 Still'},scan_late:{ar:'🔴 متأخر',en:'🔴 Late'},scan_signals:{ar:'إشارة',en:'signals'},scan_sectors:{ar:'قطاعات',en:'sectors'},scan_gems_found:{ar:'جواهر مكتشفة',en:'gems found'},scan_updated:{ar:'آخر تحديث',en:'Updated'},scan_enter:{ar:'▶ ادخل',en:'▶ Enter'},scan_chart:{ar:'📈 شارت',en:'📈 Chart'},scan_duration:{ar:'مدة متوقعة',en:'Duration'},scan_warn_small:{ar:'⚠️ ربح عالي + مخاطرة عالية — لا تدخل أكثر من 5% من رأس مالك!',en:'⚠️ High profit + High risk — max 5% of capital!'},mkt_daily:{ar:'تحليل يومي',en:'Daily Analysis'},mkt_full:{ar:'تقرير شامل',en:'Full Report'},mkt_hourly:{ar:'كل ساعة',en:'Hourly'},mkt_4h:{ar:'كل 4 ساعات — 12 طبقة',en:'Every 4h — 12 layers'},mkt_fresh:{ar:'بيانات طازجة',en:'Fresh data'},mkt_stale:{ar:'بيانات قديمة — حدّث!',en:'Stale — Refresh!'}};
const t=k=>TR[k]?TR[k][lang]:(k||'');
const fmt=n=>{if(n>=1e9)return'$'+(n/1e9).toFixed(1)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';if(n>=1e3)return'$'+(n/1e3).toFixed(1)+'K';return'$'+n.toFixed(0)};
const fP=p=>{if(!p||isNaN(p))return'$0';if(p>=1e3)return'$'+p.toLocaleString('en',{maximumFractionDigits:2});if(p>=1)return'$'+p.toFixed(2);if(p>=.01)return'$'+p.toFixed(4);return'$'+p.toFixed(6)};
const safeC=c=>{return(c&&!isNaN(c))?c:0}; /* NaN-safe change % */
const fj=async u=>{try{var c=new AbortController();var tm=setTimeout(function(){c.abort()},8000);var t0=Date.now();var r=await fetch(u,{signal:c.signal});clearTimeout(tm);connMetrics.lastLatency=Date.now()-t0;if(!r.ok){connMetrics.apiFail++;throw 0}connMetrics.apiOk++;return r.json()}catch(e){connMetrics.apiFail++;return null}};
function calcRSI(c,p){p=p||14;if(c.length<p+1)return 50;var g=0,l=0;for(var i=c.length-p;i<c.length;i++){var d=c[i]-c[i-1];if(d>0)g+=d;else l+=Math.abs(d)}return 100-100/(1+g/Math.max(l,.001))}
function calcMACD(c){if(c.length<26)return{h:0,signal:0,cross:'none'};var ema=function(d,p){var k=2/(p+1),e=d[0];for(var i=1;i<d.length;i++)e=d[i]*k+e*(1-k);return e};var macdLine=ema(c.slice(-12),12)-ema(c,26);var macdHist=[];for(var i=26;i<=c.length;i++){macdHist.push(ema(c.slice(i-12,i),12)-ema(c.slice(0,i),26))}var signal=macdHist.length>=9?ema(macdHist.slice(-9),9):macdLine;var prev=macdHist.length>=2?macdHist[macdHist.length-2]:0;var cross=macdLine>signal&&prev<=signal?'bull':macdLine<signal&&prev>=signal?'bear':'none';return{h:macdLine,signal:signal,cross:cross}}
function timeAgo(ts){var d=Date.now()-ts,m=Math.floor(d/60000),h=Math.floor(d/3600000);if(m<2)return{text:lang==='ar'?'🆕 الآن':'🆕 Now',cls:'fresh'};if(m<60)return{text:lang==='ar'?'منذ '+m+' دقيقة':m+'m ago',cls:'fresh'};return{text:lang==='ar'?'منذ '+h+' ساعة':h+'h ago',cls:h<6?'':'old'}}
function timeBadge(ts){var a=timeAgo(ts);return'<span class="time-badge '+a.cls+'">⏱ '+a.text+'</span>'}
function recSig(sym,type){var k=sym+'_'+type;if(!sigHist[k])sigHist[k]=Date.now();localStorage.setItem('nxsig10',JSON.stringify(sigHist));return sigHist[k]}
function getSigTime(sym,type){return sigHist[sym+'_'+type]||Date.now()}
/* NOTIFICATION HISTORY */
var notifHist=[];try{notifHist=JSON.parse(localStorage.getItem('nxnh10')||'[]')}catch(e){}
function addNotifHist(icon,sym,type,body){notifHist.unshift({icon:icon,sym:sym,type:type,body:body,time:Date.now()});if(notifHist.length>50)notifHist=notifHist.slice(0,50);localStorage.setItem('nxnh10',JSON.stringify(notifHist))}
function renderNotifHist(){var el=document.getElementById('notifHistList');if(!el)return;el.innerHTML=notifHist.length?notifHist.slice(0,20).map(function(n){return'<div class="al-i" style="cursor:pointer" onclick="openCoin(\''+n.sym+'\')"><div class="al-l"><div style="font-size:18px">'+n.icon+'</div><div><div style="font-weight:600;font-size:11px">'+n.sym+' — '+n.type+'</div><div style="font-size:8px;color:var(--t3)">'+n.body+'</div></div></div><div style="font-size:8px;font-family:var(--fm);color:var(--t2)">'+timeBadge(n.time)+'</div></div>'}).join(''):'<div class="empty"><div class="empty-ic">🔔</div><div class="empty-tx">'+(lang==='ar'?'لا إشعارات':'No notifications')+'</div></div>'}
/* WATCHLIST ALERTS — check every update */
function checkWatchlistAlerts(){var wl=JSON.parse(localStorage.getItem('nxwl10')||'[]');wl.forEach(function(sym){var d=T[sym];if(!d)return;if(d.c>=5){var k='wl_'+sym+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));playSound('whale');showPopup('👁',sym+' — '+(lang==='ar'?'عملة مراقبة تحركت!':'Watchlist coin moved!'),'+'+d.c.toFixed(1)+'% | '+fP(d.p));addNotifHist('👁',sym,'Watchlist','+'+d.c.toFixed(1)+'%')}}if(d.c<=-5){var k='wl_dn_'+sym+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));playSound('whale');showPopup('⚠️',sym+' — '+(lang==='ar'?'عملة مراقبة هبطت!':'Watchlist coin dropped!'),d.c.toFixed(1)+'% | '+fP(d.p));addNotifHist('⚠️',sym,'Watchlist Drop',d.c.toFixed(1)+'%')}}})}
/* SOUND NOTIFICATIONS — respects user tone preference */
function playSound(type){if(!soundEnabled||soundPref==='silent')return;previewTone(soundPref)}
/* 📲 TELEGRAM — SECURE PROXY (no token exposed!) */
var TG_PROXY='https://your-nexus-proxy.workers.dev/notify';
var tgSent={};
function sendTG(html){try{fetch(TG_PROXY,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:html})})}catch(e){}}
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
  /* === QUALITY GATE === */
  try{var gate=signalQualityGate(sym,type,score);if(!gate.pass){notifiedSet[k]=true;try{localStorage.setItem('nxnot10',JSON.stringify(notifiedSet))}catch(e){}return}}catch(e){}
  notifiedSet[k]=true;try{localStorage.setItem('nxnot10',JSON.stringify(notifiedSet))}catch(e){}playSound(type);
  if(type==='ultra'){showPopup('⭐',sym+' — ULTRA Signal!','Score: '+score+' | '+(lang==='ar'?'ادخل الآن!':'Enter now!'));addNotifHist('⭐',sym,'ULTRA','Score: '+score);tgNotify(sym,'ultra',extra||{score:score});if(T[sym])openTrade(sym,T[sym].p,'ultra',score,extra)}
  else if(type==='whale'){showPopup('🐋',sym+' — '+(lang==='ar'?'تجميع حيتان!':'Whale detected!'),(lang==='ar'?'نشاط غير عادي':'Unusual activity'));addNotifHist('🐋',sym,lang==='ar'?'حوت':'Whale',fP(T[sym]?T[sym].p:0));tgNotify(sym,'whale',{});if(T[sym])openTrade(sym,T[sym].p,'whale',score)}
  else if(type==='gem'){showPopup('💎',sym+' — '+(lang==='ar'?'جوهرة مكتشفة!':'Gem found!'),(lang==='ar'?'عملة صغيرة بحركة قوية':'Small cap with strong move'));addNotifHist('💎',sym,lang==='ar'?'جوهرة':'Gem','+'+(T[sym]?T[sym].c.toFixed(1):0)+'%');tgNotify(sym,'gem',{});if(T[sym])openTrade(sym,T[sym].p,'gem',score)}}
/* LANG/THEME/NAV */
function togLang(){lang=lang==='ar'?'en':'ar';localStorage.setItem('nxlang',lang);document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.body.dataset.lang=lang;document.getElementById('sInp').placeholder=t('search_ph');document.querySelectorAll('[data-t]').forEach(function(el){var k=el.dataset.t;if(TR[k])el.textContent=TR[k][lang]});updateMenuLang()}
function togTh(){var d=document.body.dataset.theme==='dark'?'light':'dark';document.body.dataset.theme=d;if(tg){tg.setHeaderColor(d==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(d==='dark'?'#020408':'#f0f4f8')}localStorage.setItem('nxt10',d);updateMenuTheme()}
/* SIDEBAR MENU */
function toggleMenu(){document.getElementById('sideMenu').classList.toggle('open');document.getElementById('sideOverlay').classList.toggle('open')}
/* PROFILE */
var userProfile={};try{userProfile=JSON.parse(localStorage.getItem('nxprof10')||'{}')}catch(e){}
function loadProfile(){if(userProfile.name)document.getElementById('userName').value=userProfile.name;if(userProfile.nick)document.getElementById('userNick').value=userProfile.nick;var av=document.getElementById('sideAvatar');if(userProfile.name)av.textContent=userProfile.name.charAt(0).toUpperCase();else av.textContent='👤'}
function saveProfile(){userProfile.name=document.getElementById('userName').value;userProfile.nick=document.getElementById('userNick').value;localStorage.setItem('nxprof10',JSON.stringify(userProfile));var av=document.getElementById('sideAvatar');if(userProfile.name)av.textContent=userProfile.name.charAt(0).toUpperCase()}
/* MENU STATE SYNC */
function updateMenuLang(){var isAr=lang==='ar';document.getElementById('sLangAr').classList.toggle('act',isAr);document.getElementById('sLangEn').classList.toggle('act',!isAr)}
function updateMenuTheme(){var isDark=document.body.dataset.theme==='dark';document.getElementById('sThDark').classList.toggle('act',isDark);document.getElementById('sThLight').classList.toggle('act',!isDark)}
/* SOUND PREFERENCES */
var soundPref=localStorage.getItem('nxsnd10')||'bell';
var soundEnabled=localStorage.getItem('nxsndon10')!=='off';
function saveSoundPref(){soundEnabled=document.getElementById('tglSound').classList.contains('on');localStorage.setItem('nxsndon10',soundEnabled?'on':'off')}
function selTone(el){document.querySelectorAll('.tone-opt').forEach(function(o){o.classList.remove('act')});el.classList.add('act');soundPref=el.dataset.tone;localStorage.setItem('nxsnd10',soundPref);previewTone(soundPref)}
function previewTone(tone){if(tone==='silent')return;try{var ac=new(window.AudioContext||window.webkitAudioContext)();var osc=ac.createOscillator();var gain=ac.createGain();osc.connect(gain);gain.connect(ac.destination);
  if(tone==='bell'){osc.frequency.value=880;osc.type='sine';gain.gain.value=0.3;osc.start();osc.stop(ac.currentTime+0.15);setTimeout(function(){var o2=ac.createOscillator();var g2=ac.createGain();o2.connect(g2);g2.connect(ac.destination);g2.gain.value=0.3;o2.frequency.value=1100;o2.type='sine';o2.start();o2.stop(ac.currentTime+0.15)},180)}
  else if(tone==='horn'){osc.frequency.value=440;osc.type='sawtooth';gain.gain.value=0.35;osc.start();osc.stop(ac.currentTime+0.4)}
  else if(tone==='pulse'){osc.frequency.value=1000;osc.type='square';gain.gain.value=0.2;osc.start();osc.stop(ac.currentTime+0.08);setTimeout(function(){var o2=ac.createOscillator();var g2=ac.createGain();o2.connect(g2);g2.connect(ac.destination);g2.gain.value=0.2;o2.frequency.value=1000;o2.type='square';o2.start();o2.stop(ac.currentTime+0.08)},120);setTimeout(function(){var o3=ac.createOscillator();var g3=ac.createGain();o3.connect(g3);g3.connect(ac.destination);g3.gain.value=0.2;o3.frequency.value=1200;o3.type='square';o3.start();o3.stop(ac.currentTime+0.12)},240)}
  }catch(e){}}
function loadToneUI(){var opts=document.querySelectorAll('.tone-opt');opts.forEach(function(o){o.classList.remove('act');if(o.dataset.tone===soundPref)o.classList.add('act')});if(!soundEnabled)document.getElementById('tglSound').classList.remove('on')}
/* Active users removed */
(function(){if(localStorage.getItem('nxt10')==='light'){document.body.dataset.theme='light'};if(lang==='en')togLang()})();
document.querySelectorAll('.bb').forEach(function(b){b.onclick=function(){sp(b.dataset.p)}});
function sp(id){document.querySelectorAll('.pg').forEach(function(p){p.classList.remove('act')});document.querySelectorAll('.bb').forEach(function(b){b.classList.remove('act')});var el=document.getElementById('pg-'+id);if(el)el.classList.add('act');document.querySelectorAll('[data-p="'+id+'"]').forEach(function(b){b.classList.add('act')});if(id==='scan')scanTab(curScanTab,document.querySelector('#pg-scan .big-tab.act'));if(id==='whale')loadWhales();if(id==='ind')loadInd();if(id==='me')renderPort();if(id==='market')loadMarket();window.scrollTo({top:0})}
function openMo(id){document.getElementById(id).classList.add('show')}
function closeMo(id){document.getElementById(id).classList.remove('show')}
document.querySelectorAll('.mo').forEach(function(m){m.onclick=function(e){if(e.target===m)m.classList.remove('show')}});
function indTab(i,btn){document.getElementById('pg-ind').querySelectorAll('.big-tab').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');['ind0','ind1','ind2','ind3','ind4'].forEach(function(id,j){document.getElementById(id).style.display=j===i?'block':'none'});if(i===0)loadFR();if(i===1)loadOI();if(i===2)loadCor();if(i===3)loadHM();if(i===4)renderWL()}
function whTab(i,btn){document.getElementById('pg-whale').querySelectorAll('.big-tab').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');['wh0','wh1','wh2'].forEach(function(id,j){var el=document.getElementById(id);if(el)el.style.display=([0,1,2].indexOf(i)===j)?'block':'none'});if(i===0)loadWhales();if(i===1)loadLiq();if(i===2)loadWhaleSells()}
function pTab(i,btn){document.getElementById('pg-me').querySelectorAll('.big-tab').forEach(function(b){b.classList.remove('act')});if(btn)btn.classList.add('act');['p0','p1','p2','p3'].forEach(function(id,j){document.getElementById(id).style.display=j===i?'block':'none'});if(i===3)renderNotifHist()}
var curScanTab=0,curTradeFilter='all',curSmallFilter='all',chartSignal=null;
var SECTORS={ai:{ic:'🤖',n:{ar:'ذكاء اصطناعي',en:'AI'},coins:['FET','RNDR','TAO','WLD','AKT','ARKM','OCEAN','AGIX','PRIME','CTXC','NMR'],col:'#7c3aed'},gaming:{ic:'🎮',n:{ar:'ألعاب وميتافيرس',en:'Gaming'},coins:['IMX','GALA','AXS','SAND','MANA','ENJ','PIXEL','BEAM','ILV','PORTAL','YGG','ALICE'],col:'#06b6d4'},layer1:{ic:'⛓️',n:{ar:'الطبقة الأولى',en:'Layer 1'},coins:['ETH','SOL','AVAX','DOT','ATOM','NEAR','APT','SUI','SEI','ICP','FTM','ALGO','HBAR','TIA'],col:'#3b82f6'},layer2:{ic:'🔗',n:{ar:'الطبقة الثانية',en:'Layer 2'},coins:['ARB','OP','MATIC','MANTA','STRK','METIS','ZK','BLAST'],col:'#8b5cf6'},defi:{ic:'💰',n:{ar:'التمويل اللامركزي',en:'DeFi'},coins:['UNI','AAVE','MKR','LDO','SNX','CRV','COMP','DYDX','GMX','SUSHI','PENDLE','JUP'],col:'#10b981'},meme:{ic:'🐕',n:{ar:'عملات ميم',en:'Meme'},coins:['DOGE','PEPE','WIF','BONK','FLOKI','SHIB','MEME','TURBO'],col:'#f59e0b'},rwa:{ic:'🏦',n:{ar:'أصول حقيقية',en:'RWA'},coins:['ONDO','POLYX','DUSK','RIO','CPOOL'],col:'#64748b'},depin:{ic:'🌐',n:{ar:'بنية تحتية',en:'DePIN'},coins:['FIL','AR','HNT','THETA','ANKR','IOTX'],col:'#0ea5e9'},data:{ic:'⚡',n:{ar:'بيانات وأوراكل',en:'Data/Oracle'},coins:['LINK','GRT','BAND','PYTH','API3','TRB'],col:'#6366f1'},privacy:{ic:'🔒',n:{ar:'خصوصية',en:'Privacy'},coins:['XMR','ZEC','SCRT','ROSE'],col:'#475569'}};
function getCoinSector(sym){for(var k in SECTORS)if(SECTORS[k].coins.includes(sym))return k;return null}
function scanTab(idx,btn){curScanTab=idx;document.querySelectorAll('#pg-scan>.big-tabs>.big-tab').forEach(function(b){b.classList.remove('act')});if(btn)btn.classList.add('act');['scanTrade','scanTrend','scanSmall'].forEach(function(id,j){var el=document.getElementById(id);if(el)el.style.display=j===idx?'block':'none'});if(idx===0)loadTrading();if(idx===1)loadTrending();if(idx===2)loadSmallCapsUI()}
/* ═══ TAB 1: SECTOR TRENDING ═══ */
function analyzeSectors(){var res=[];for(var k in SECTORS){var sec=SECTORS[k];var coins=sec.coins.filter(function(s){return T[s]});if(coins.length<2)continue;var totC=0,rising=0,totV=0,cd=[];coins.forEach(function(s){var d=T[s];totC+=d.c;totV+=d.v;if(d.c>0)rising++;cd.push({s:s,c:d.c,p:d.p,v:d.v})});cd.sort(function(a,b){return b.c-a.c});var avg=totC/coins.length;var rPct=Math.round(rising/coins.length*100);var str=0;if(avg>=8)str=90;else if(avg>=5)str=75;else if(avg>=3)str=60;else if(avg>=1)str=45;else if(avg>=0)str=30;else if(avg>=-3)str=15;else str=5;if(rPct>=80)str+=10;else if(rPct>=60)str+=5;str=Math.min(100,str);var v,vc;if(str>=70){v=lang==='ar'?'🔥 قطاع حامي — فرصة!':'🔥 Hot — Opportunity!';vc='var(--up)'}else if(str>=50){v=lang==='ar'?'📈 صاعد':'📈 Rising';vc='var(--neon)'}else if(str>=30){v=lang==='ar'?'🟡 محايد':'🟡 Neutral';vc='var(--warn)'}else{v=lang==='ar'?'🔴 هابط — تجنب':'🔴 Declining — Avoid';vc='var(--dn)'}
  res.push({k:k,ic:sec.ic,name:sec.n[lang]||sec.n.en,col:sec.col,avg:+avg.toFixed(1),rising:rising,total:coins.length,rPct:rPct,vol:totV,str:str,coins:cd,verdict:v,verdictCol:vc})}res.sort(function(a,b){return b.str-a.str});return res}
function loadTrending(){var secs=analyzeSectors();var h='';secs.forEach(function(s){var isHot=s.str>=60;var isMed=s.str>=30&&s.str<60;
  h+='<div class="whale-card" style="border-left:3px solid '+s.col+';margin-bottom:8px;padding:10px">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:18px">'+s.ic+'</span><div><div style="font-weight:800;font-size:13px;color:var(--t0)">'+s.name+'</div><div style="font-size:8px;color:var(--t3)">'+s.rising+'/'+s.total+' '+(lang==='ar'?'صاعدة':'rising')+'</div></div></div><div style="text-align:right"><div style="font-family:var(--fm);font-size:16px;font-weight:800;color:'+(s.avg>=0?'var(--up)':'var(--dn)')+'">'+(s.avg>=0?'+':'')+s.avg+'%</div><div style="font-size:8px;color:'+s.verdictCol+';font-weight:700">'+s.verdict+'</div></div></div>';
  if(isHot||isMed){var showCount=isHot?5:3;h+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">';s.coins.slice(0,showCount).forEach(function(c){h+='<div style="display:flex;align-items:center;gap:4px;padding:3px 6px;background:var(--bg2);border-radius:6px;font-size:9px;font-family:var(--fm);cursor:pointer" onclick="openCoin(\''+c.s+'\')"><span style="font-weight:800">'+c.s+'</span><span style="color:'+(c.c>=0?'var(--up)':'var(--dn)')+';font-weight:700">'+(c.c>=0?'+':'')+c.c.toFixed(1)+'%</span></div>'});h+='</div>'}
  if(isHot){h+='<div style="text-align:center"><button class="chart-tf" onclick="scanTab(1,document.querySelectorAll(\'#pg-scan>.big-tabs>.big-tab\')[1]);curTradeFilter=\''+s.k+'\'" style="font-size:9px">📊 '+(lang==='ar'?'تداول '+s.name:'Trade '+s.name)+'</button></div>'}
  h+='<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden;margin-top:4px"><div style="width:'+s.str+'%;height:100%;background:'+s.col+';border-radius:2px"></div></div></div>'});
  document.getElementById('trendList').innerHTML=h||'<div class="empty"><div class="empty-ic">📡</div><div class="empty-tx">'+(lang==='ar'?'جاري التحليل...':'Analyzing...')+'</div></div>'}
/* ═══ TAB 2: SMART TRADING ═══ */
async function loadTrading(){document.getElementById('tradeList').innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();var sigs=[];
  for(var i=0;i<Math.min(r.length,20);i++){var x=r[i];var d=T[x.s];if(!d)continue;
    var type=(d.c>=-3&&d.c<=0&&d.v>1e8)?'fast':'daily';var entry,target,stop,dur;
    if(type==='fast'){entry=d.p;target=d.p*1.015;stop=d.p*0.995;dur=lang==='ar'?'10-30 دقيقة':'10-30 min'}else{entry=d.p*0.995;target=x.ultra?d.p*1.08:d.p*1.06;stop=d.p*0.97;dur=lang==='ar'?'4-12 ساعة':'4-12 hours'}
    var risk=Math.abs(entry-stop);var rr=risk>0?+((target-entry)/risk).toFixed(1):0;if(rr<1.5)continue;
    var reasons=[];var ww=whaleWaves[x.s];if(ww&&ww.engine&&ww.engine.confidence>=40)reasons.push({ic:'🐋',t:lang==='ar'?'حوت مؤكد '+ww.engine.confidence+'%':'Whale '+ww.engine.confidence+'%'});
    var cvd=analyzeCVD(x.s);if(cvd.divergence==='BULLISH')reasons.push({ic:'📈',t:lang==='ar'?'CVD صاعد — تجميع صامت':'CVD rising — accumulation'});
    var fr=FR[x.s];if(fr&&fr.rate<-0.02)reasons.push({ic:'💰',t:lang==='ar'?'FR سلبي — فرصة':'Neg FR — opportunity'});
    if(x.checks&&x.checks.ob)reasons.push({ic:'📗',t:lang==='ar'?'ضغط شراء OB':'OB buy pressure'});
    var conf=Math.min(100,Math.round(Math.min(40,x.score*0.5)+(ww&&ww.engine?Math.min(25,ww.engine.confidence*0.3):0)+(T.BTC&&T.BTC.c>=1?10:T.BTC&&T.BTC.c<-2?-15:0)));
    var sec=getCoinSector(x.s);
    sigs.push({s:x.s,p:d.p,c:d.c,v:d.v,type:type,conf:conf,entry:entry,target:target,stop:stop,rr:rr,dur:dur,reasons:reasons,score:x.score,checks:x.checks,passed:x.passed,total:x.total,ultra:x.ultra,confirmed:x.confirmed,tags:x.tags,sec:sec,detectedAt:x.detectedAt})}
  sigs.sort(function(a,b){return b.conf-a.conf});renderTrading(sigs)}
function filterTrade(f,btn){curTradeFilter=f;btn.parentElement.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');loadTrading()}
function renderTrading(sigs){var f=sigs;if(curTradeFilter==='fast')f=sigs.filter(function(x){return x.type==='fast'});else if(curTradeFilter==='daily')f=sigs.filter(function(x){return x.type==='daily'});else if(curTradeFilter!=='all'){f=sigs.filter(function(x){return x.sec===curTradeFilter})}
  /* Part B: Quality filter — min 55% confidence, max 10 */
  f=f.filter(function(s){return s.conf>=55}).slice(0,10);
  document.getElementById('scanI').innerHTML='📊 '+f.length+' '+t('scan_signals')+' | '+t('scan_updated')+': '+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
  if(!f.length){document.getElementById('tradeList').innerHTML='<div class="sc-empty"><div class="sc-empty-ic">📡</div><div style="font-size:13px;font-weight:700;color:var(--t0);margin-bottom:4px">'+(lang==='ar'?'السوق هادئ — لا فرص قوية الحين':'Market quiet — No strong signals')+'</div><div style="font-size:11px;color:var(--t2)">'+(lang==='ar'?'الانتظار أفضل من صفقة ضعيفة':'Waiting is better than a weak trade')+'</div></div>';return}
  var h='';f.forEach(function(s,i){
    var tCol=s.type==='fast'?'var(--blue)':'var(--up)';var tLbl=s.type==='fast'?t('scan_fast'):t('scan_daily');
    var tb=getTierBadge(s.s);var ta=timeAgo(s.detectedAt||Date.now());
    /* Verdict (Part B) */
    var verdict,vCol,vBg;
    if(s.conf>=85&&s.ultra){verdict=lang==='ar'?'🟢 شراء قوي — ادخل بثقة':'🟢 Strong Buy';vCol='var(--up)';vBg='rgba(0,255,136,.06)'}
    else if(s.conf>=70){verdict=lang==='ar'?'🟢 فرصة جيدة — ادخل':'🟢 Good — Enter';vCol='var(--up)';vBg='rgba(0,255,136,.04)'}
    else{verdict=lang==='ar'?'🟡 فرصة محتملة — حذر':'🟡 Possible — Caution';vCol='var(--warn)';vBg='rgba(255,184,0,.04)'}
    var wConf=0;var ww=whaleWaves[s.s];if(ww&&ww.engine)wConf=ww.engine.confidence||0;
    var btcChg=T.BTC?T.BTC.c:0;var btcCol=btcChg>=1?'var(--up)':btcChg<=-1?'var(--dn)':'var(--t2)';
    h+='<div class="scan-card"><div class="scan-card-bar" style="background:'+(s.ultra?'var(--ultra)':s.type==='fast'?'var(--blue)':'var(--up)')+'"></div><div class="scan-card-body">'
      /* Header: rank + name + type + time + confidence */
      +'<div class="sc-head"><div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;color:var(--t3);font-weight:800">#'+(i+1)+'</span><div><div style="font-family:var(--fd);font-weight:800;font-size:14px;color:var(--t0)">'+(s.ultra?'⭐ ':s.confirmed?'🟢 ':'')+s.s+(tb?' <span style="font-size:8px">'+tb+'</span>':'')+'</div><span class="sc-time '+(ta.cls==='fresh'?'fresh':'')+'">'+(ta.cls==='fresh'?'🆕 ':'⏱ ')+ta.text+'</span></div></div><div style="text-align:right"><div class="sc-badge" style="background:'+(s.conf>=70?'var(--ud)':'var(--wd)')+';color:'+(s.conf>=70?'var(--up)':'var(--warn)')+'">'+s.conf+'%</div><div style="font-size:8px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:'+tCol+';font-weight:700;margin-top:3px">'+tLbl+'</div></div></div>'
      /* Price */
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-family:var(--fm);font-size:18px;font-weight:800;color:var(--t0)">'+fP(s.p)+'</span><span style="font-family:var(--fm);font-size:14px;font-weight:800;color:'+(s.c>=0?'var(--up)':'var(--dn)')+'">'+(s.c>=0?'+':'')+s.c.toFixed(1)+'%</span></div>'
      /* Verdict */
      +'<div class="sc-verdict" style="background:'+vBg+';border:1px solid '+vCol+'20"><div class="sc-verdict-t" style="color:'+vCol+'">'+verdict+'</div><div class="sc-verdict-s">'+s.passed+'/6 '+(lang==='ar'?'فحوصات':'checks')+' · 🐋 '+wConf+'% · BTC '+(btcChg>=0?'+':'')+btcChg.toFixed(1)+'%</div></div>'
      /* Quick 3 */
      +'<div class="sc-quick3"><div class="sc-quick3-item"><div class="sc-quick3-val" style="color:'+(s.passed>=5?'var(--up)':s.passed>=3?'var(--warn)':'var(--dn)')+'">'+s.passed+'/6</div><div class="sc-quick3-lbl">'+(lang==='ar'?'فحوصات':'Checks')+'</div></div><div class="sc-quick3-item"><div class="sc-quick3-val" style="color:'+(wConf>=50?'var(--up)':wConf>=30?'var(--warn)':'var(--t3)')+'">🐋 '+wConf+'%</div><div class="sc-quick3-lbl">'+(lang==='ar'?'حوت':'Whale')+'</div></div><div class="sc-quick3-item"><div class="sc-quick3-val" style="color:'+btcCol+'">BTC '+(btcChg>=0?'+':'')+btcChg.toFixed(1)+'%</div><div class="sc-quick3-lbl">'+(lang==='ar'?'السوق':'Market')+'</div></div></div>'
      /* Trade zone */
      +'<div class="sc-trade"><div class="sc-trade-row"><span style="color:var(--neon)">🎯 '+(lang==='ar'?'ادخل':'Entry')+'</span><span style="font-weight:700">'+fP(s.entry)+'</span></div>'
      +'<div class="sc-trade-row"><span style="color:var(--up)">🎯 '+(lang==='ar'?'هدف':'Target')+' <span style="font-size:10px;color:var(--up)">+'+(((s.target-s.entry)/s.entry)*100).toFixed(1)+'%</span></span><span style="font-weight:700;color:var(--up)">'+fP(s.target)+'</span></div>'
      +'<div class="sc-trade-row"><span style="color:var(--dn)">🛑 '+(lang==='ar'?'وقف':'Stop')+'</span><span style="font-weight:700;color:var(--dn)">'+fP(s.stop)+'</span></div>'
      +'<div class="sc-trade-row"><span>⚖️ R:R</span><span style="font-weight:700;color:'+(s.rr>=2.5?'var(--up)':'var(--warn)')+'">1:'+s.rr+'</span></div></div>';
    /* Reasons */
    if(s.reasons.length){h+='<div style="margin-bottom:6px">';s.reasons.slice(0,4).forEach(function(r){h+='<div class="sc-reason"><span class="sc-reason-ic">'+r.ic+'</span><span>'+r.t+'</span></div>'});h+='</div>'}
    /* Progress bar */
    h+='<div class="sc-bar-wrap"><div class="sc-bar"><div class="sc-bar-fill" style="width:'+s.conf+'%;background:'+(s.ultra?'linear-gradient(90deg,var(--ultra),var(--dn))':s.conf>=60?'var(--up)':'var(--warn)')+'"></div></div><span class="sc-bar-num">'+s.conf+'</span></div>'
    /* Actions */
    +'<div class="sc-actions"><button class="sc-btn" onclick="chartSignal={entry:'+s.entry+',target:'+s.target+',stop:'+s.stop+',s:\''+s.s+'\'};openCoin(\''+s.s+'\')">'+t('scan_chart')+'</button><button class="sc-btn sc-btn-enter" style="flex:1" onclick="if(T[\''+s.s+'\'])openTrade(\''+s.s+'\',T[\''+s.s+'\'].p,\''+s.type+'\','+s.conf+')">'+t('scan_enter')+'</button></div>'
    +'<div style="font-size:9px;color:var(--t3);text-align:center;margin-top:6px">⏱ '+t('scan_duration')+': '+s.dur+'</div>'
    +'</div></div>'});
  document.getElementById('tradeList').innerHTML=h}
/* ═══ TAB 3: SMALL CAPS ═══ */
async function loadSmallCapsUI(){document.getElementById('smallList').innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';var r=await loadSmallCaps2();renderSmallCaps(r)}
async function loadSmallCaps2(){if(!Object.keys(T).length)await loadTk();var cands=Object.entries(T).filter(function(e){var d=e[1];return d.p>0&&d.p<5&&d.v>200000&&d.v<1e8&&getCoinTier(e[0])>=2}).sort(function(a,b){return b[1].v-a[1].v}).slice(0,50);var res=[];
  var proms=cands.slice(0,25).map(function(e){var s=e[0];return fj(BN+'/klines?symbol='+s+'USDT&interval=1h&limit=12').then(function(kl){if(!kl||kl.length<6)return;var vols=kl.map(function(k){return+k[5]});var cls=kl.map(function(k){return+k[4]});var avgV=vols.slice(0,-2).reduce(function(a,b){return a+b},0)/Math.max(1,vols.length-2);var recV=(vols[vols.length-1]+vols[vols.length-2])/2;var vx=avgV>0?recV/avgV:1;
    var sI=vols.length-1;for(var i=vols.length-1;i>=1;i--){if(vols[i]>avgV*1.5)sI=i;else break}var pS=+kl[sI][1];var pN=cls[cls.length-1];var gain=pS>0?((pN-pS)/pS*100):0;
    var timing,tBadge;if(gain<3){timing='early';tBadge={ic:'🟢',l:lang==='ar'?'مبكر — ادخل!':'Early — Enter!',col:'var(--up)'}}else if(gain<8){timing='still';tBadge={ic:'🟡',l:lang==='ar'?'فيه فرصة — حذر':'Still time — Caution',col:'var(--warn)'}}else{timing='late';tBadge={ic:'🔴',l:lang==='ar'?'متأخر — راقب':'Late — Watch',col:'var(--dn)'}}
    var sc=0;if(vx>=4)sc+=45;else if(vx>=3)sc+=40;else if(vx>=2)sc+=30;else if(vx>=1.5)sc+=15;if(timing==='early')sc+=30;else if(timing==='still')sc+=15;if(T[s].c>0&&T[s].c<3)sc+=20;else if(T[s].c>=3&&T[s].c<8)sc+=10;
    var target=timing!=='late'?pN*(timing==='early'?1.30:1.25):null;var stop=timing!=='late'?pN*(timing==='early'?0.90:0.88):null;
    if(sc>=25)res.push({s:s,p:T[s].p,c:T[s].c,v:T[s].v,vx:vx,gain:gain,timing:timing,tBadge:tBadge,sc:sc,target:target,stop:stop})}).catch(function(){})});
  await Promise.all(proms);res.sort(function(a,b){return b.sc-a.sc});return res}
function filterSmall(f,btn){curSmallFilter=f;btn.parentElement.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');loadSmallCapsUI()}
function renderSmallCaps(res){var f=res;if(curSmallFilter!=='all')f=res.filter(function(x){return x.timing===curSmallFilter});
  if(!f.length){document.getElementById('smallList').innerHTML='<div class="empty"><div class="empty-ic">💎</div><div class="empty-tx">'+(lang==='ar'?'لا جواهر حالياً':'No gems now')+'</div></div>';return}
  var h='';f.slice(0,15).forEach(function(g){
    h+='<div class="whale-card" style="border-left:3px solid '+g.tBadge.col+';margin-bottom:8px" onclick="openCoin(\''+g.s+'\')">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="display:flex;align-items:center;gap:6px"><span style="font-weight:800;font-size:14px">💎 '+g.s+'</span><span style="font-size:8px;padding:2px 6px;border-radius:4px;background:var(--bg2);color:'+g.tBadge.col+';font-weight:700">'+g.tBadge.ic+' '+g.tBadge.l+'</span></div><span style="font-family:var(--fm);font-size:12px;font-weight:800;color:var(--neon)">'+g.vx.toFixed(1)+'x vol</span></div>'
      +'<div style="display:flex;justify-content:space-between;font-family:var(--fm);font-size:10px;margin-bottom:4px"><span>'+fP(g.p)+'</span><span style="color:'+(g.c>=0?'var(--up)':'var(--dn)')+'">'+(g.c>=0?'+':'')+g.c.toFixed(1)+'%</span><span>Vol:'+fmt(g.v)+'</span><span style="color:var(--warn)">+'+g.gain.toFixed(1)+'% from spike</span></div>'
      +(g.target?'<div style="display:flex;gap:8px;font-size:8px;font-family:var(--fm);margin-bottom:4px"><span style="color:var(--up)">🎯 '+fP(g.target)+'</span><span style="color:var(--dn)">🛑 '+fP(g.stop)+'</span></div>':'')
      +'<div style="height:4px;background:var(--bg2);border-radius:2px;overflow:hidden"><div style="width:'+Math.min(100,g.sc)+'%;height:100%;background:'+(g.timing==='early'?'var(--up)':g.timing==='still'?'var(--warn)':'var(--dn)')+';border-radius:2px"></div></div></div>'});
  document.getElementById('smallList').innerHTML=h}
function onSrch(v){var el=document.getElementById('sRes');if(!v){el.classList.remove('show');return}v=v.toUpperCase();var m=Object.entries(T).filter(function(e){return e[0].includes(v)}).slice(0,8);if(!m.length){el.classList.remove('show');return}el.innerHTML=m.map(function(e){var s=e[0],d=e[1];return'<div class="sr-i" onclick="openCoin(\''+s+'\')"><span style="font-weight:700">'+s+'</span><span style="font-family:var(--fm);font-size:10px">'+fP(d.p)+' <span class="cr-ch '+(d.c>=0?'up':'dn')+'">'+(d.c>=0?'+':'')+d.c.toFixed(1)+'%</span></span></div>'}).join('');el.classList.add('show')}
document.addEventListener('click',function(e){if(!e.target.closest('.srch'))document.getElementById('sRes').classList.remove('show')});
/* WS */
function initWS(){if(ws)ws.close();ws=new WebSocket('wss://stream.binance.com:9443/stream?streams='+WL.map(function(s){return s.toLowerCase()+'usdt@miniTicker'}).join('/'));ws.onmessage=function(e){var d=JSON.parse(e.data).data;if(!d)return;var s=d.s.replace('USDT','');var price=+d.c;var chg=+d.P;if(isNaN(chg))chg=0;T[s]=Object.assign(T[s]||{},{p:price,c:chg,v:+d.q,h:+d.h,l:+d.l,src:'BN'});if(!sparkHist[s])sparkHist[s]=[];sparkHist[s].push(price);if(sparkHist[s].length>12)sparkHist[s]=sparkHist[s].slice(-12)};ws.onclose=function(){setTimeout(initWS,3000)};ws.onerror=function(){ws.close()}}
/* ═══ 🔌 FEATURE 1: MULTI-STREAM WEBSOCKET ═══ */
var wsAgg=null,wsLiq=null,wsDepth=null,liquidationData={},depthSnapshots={};
function initAggTradeWS(){
  var syms=WL.slice(0,10).map(function(s){return s.toLowerCase()+'usdt@aggTrade'}).join('/');
  wsAgg=new WebSocket('wss://stream.binance.com:9443/stream?streams='+syms);
  wsAgg.onmessage=function(e){try{var d=JSON.parse(e.data).data;if(!d)return;
    var sym=d.s.replace('USDT','');var price=+d.p;var qty=+d.q;var val=price*qty;
    updateCVD(sym,price,qty,d.m);updateIceberg(sym,price,qty,d.m,+d.T);updateVPIN(sym,price,qty,d.m);
    var isBuy=!d.m;var thresh=price>10000?100000:price>100?50000:20000;
    if(val>=thresh){var k='wt_'+sym+'_'+Math.floor(Date.now()/60000);if(!notifiedSet[k]){notifiedSet[k]=Date.now();
      var ic=isBuy?'🐋':'🐋🩸';var lb=isBuy?(lang==='ar'?'شراء حوت فوري!':'Whale buy!'):(lang==='ar'?'بيع حوت فوري!':'Whale sell!');
      showPopup(ic,sym+' — '+lb,'$'+fmt(val));addNotifHist(ic,sym,isBuy?'Whale':'WhaleSell','$'+fmt(val));
      if(val>=500000)sendTG('<b>'+ic+' '+sym+'/USDT</b>\n'+lb+'\n💰 $'+fmt(val)+'\n📍 Binance')}}}catch(ex){}};
  wsAgg.onclose=function(){setTimeout(initAggTradeWS,5000)};wsAgg.onerror=function(){wsAgg.close()}}
function initLiqWS(){
  wsLiq=new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');
  wsLiq.onmessage=function(e){try{var data=JSON.parse(e.data);var o=data.o;if(!o)return;
    var sym=o.s.replace('USDT','');var val=+o.p*+o.q;if(val<50000)return;
    if(!liquidationData[sym])liquidationData[sym]=[];
    liquidationData[sym].push({side:o.S,value:val,price:+o.p,time:Date.now()});
    if(liquidationData[sym].length>50)liquidationData[sym]=liquidationData[sym].slice(-50);
    if(val>=200000){var ic=o.S==='BUY'?'💥':'🔻';var lb=o.S==='BUY'?(lang==='ar'?'Short تصفّى!':'Short liquidated!'):(lang==='ar'?'Long تصفّى!':'Long liquidated!');
      showPopup(ic,sym+' — '+lb,'$'+fmt(val));addNotifHist(ic,sym,'Liquidation','$'+fmt(val))}}catch(ex){}};
  wsLiq.onclose=function(){setTimeout(initLiqWS,5000)};wsLiq.onerror=function(){wsLiq.close()}}
function initDepthWS(){
  var syms=['btc','eth','sol','bnb','xrp'].map(function(s){return s+'usdt@depth@100ms'}).join('/');
  wsDepth=new WebSocket('wss://stream.binance.com:9443/stream?streams='+syms);
  wsDepth.onmessage=function(e){try{var d=JSON.parse(e.data).data;if(!d||!d.s)return;depthSnapshots[d.s.replace('USDT','')]={bids:d.b||[],asks:d.a||[],time:Date.now()}}catch(ex){}};
  wsDepth.onclose=function(){setTimeout(initDepthWS,8000)};wsDepth.onerror=function(){wsDepth.close()}}
/* ═══ 🔗 FEATURE 2: ON-CHAIN TRACKING (no key) ═══ */
var onChainData={};
async function fetchOnChainBTC(){try{var data=await fj('https://mempool.space/api/mempool/recent');if(!data||!data.length)return;var whale=data.filter(function(tx){return tx.fee>50000});onChainData.BTC={count:whale.length,time:Date.now(),signal:whale.length>=3?'WHALE_RUSH':whale.length>=1?'MODERATE':'LOW'}}catch(e){}}
/* ═══ 👛 FEATURE 3: WALLET TRACKING ═══ */
var trackedWallets=[];try{trackedWallets=JSON.parse(localStorage.getItem('nxwallets')||'[]')}catch(e){}
function addWallet(addr,label){if(trackedWallets.length>=20||trackedWallets.some(function(w){return w.address===addr}))return false;trackedWallets.push({address:addr,label:label||addr.slice(0,10),chain:'ethereum',lastBal:null,lastChk:0});localStorage.setItem('nxwallets',JSON.stringify(trackedWallets));return true}
function rmWallet(i){trackedWallets.splice(i,1);localStorage.setItem('nxwallets',JSON.stringify(trackedWallets))}
window.addWallet=addWallet;window.rmWallet=rmWallet;
async function checkWallets(){for(var i=0;i<trackedWallets.length;i++){var w=trackedWallets[i];if(Date.now()-w.lastChk<60000)continue;try{var res=await fj('https://api.etherscan.io/api?module=account&action=balance&address='+w.address+'&tag=latest');if(res&&res.result){var bal=+res.result/1e18;if(w.lastBal!==null){var chg=bal-w.lastBal;var pct=w.lastBal>0?(chg/w.lastBal)*100:0;if(Math.abs(pct)>5){var ic=chg>0?'📥':'📤';showPopup(ic,w.label+(chg>0?' received':' sent'),Math.abs(chg).toFixed(2)+' ETH');addNotifHist(ic,w.label,'Wallet',pct.toFixed(1)+'%')}}w.lastBal=bal;w.lastChk=Date.now()}}catch(e){}await new Promise(function(r){setTimeout(r,6000)})}localStorage.setItem('nxwallets',JSON.stringify(trackedWallets))}
/* ═══ 🔓 FEATURE 4: TOKEN UNLOCK ═══ */
var unlockCache={};
async function checkUnlocks(){try{var coins=['ARB','OP','SUI','SEI','TIA','APT','INJ'];for(var i=0;i<coins.length;i++){var sym=coins[i];var d=T[sym];if(!d)continue;/* Check known unlock schedules — manual fallback */}}catch(e){}}
function getUnlockSignal(sym){var u=unlockCache[sym];if(!u)return null;return u}
/* LOAD TICKERS — ALL 3 EXCHANGES */
async function loadTk(){
  var bn=await fj(BN+'/ticker/24hr');if(bn)bn.filter(function(x){return x.symbol.endsWith('USDT')&&+x.quoteVolume>100000}).forEach(function(x){var s=x.symbol.replace('USDT','');var chg=+x.priceChangePercent;T[s]={p:+x.lastPrice,c:isNaN(chg)?0:chg,v:+x.quoteVolume,h:+x.highPrice,l:+x.lowPrice,src:'BN'}});
  try{var by=await fj('https://api.bybit.com/v5/market/tickers?category=spot');if(by&&by.result&&by.result.list)by.result.list.filter(function(x){return x.symbol.endsWith('USDT')}).forEach(function(x){var s=x.symbol.replace('USDT','');if(!T[s])T[s]={p:+x.lastPrice,c:+x.price24hPcnt*100,v:+x.turnover24h,h:+x.highPrice24h,l:+x.lowPrice24h,src:'BY'};else T[s].by=+x.lastPrice})}catch(e){}
  try{var cbR=await fj(CB+'/exchange-rates?currency=USD');if(cbR&&cbR.data&&cbR.data.rates){var rates=cbR.data.rates;Object.keys(rates).forEach(function(c){var r=+rates[c];if(r>0){var cbPrice=1/r;/* Validate: if Binance has this coin, check price is within 50% */var bnPrice=T[c]?T[c].p:0;if(bnPrice>0){var diff=Math.abs(cbPrice-bnPrice)/bnPrice;if(diff<0.5)CBP[c]=cbPrice}else{CBP[c]=cbPrice}}})}}catch(e){}
  var el=document.getElementById('tkrEl');var items=WL.filter(function(s){return T[s]}).slice(0,16);var h='';for(var r=0;r<2;r++)items.forEach(function(s){var d=T[s],up=d.c>=0;h+='<div class="tkr-i"><span class="tkr-sym">'+s+'</span><span style="font-family:var(--fm);font-size:9px;color:var(--t2)">'+fP(d.p)+'</span><div class="spark">'+mkSpark(s)+'</div><span class="tkr-c '+(up?'up':'dn')+'">'+(up?'+':'')+d.c.toFixed(1)+'%</span></div>'});el.innerHTML=h}
async function loadFutures(){
  var fd=await fj(BF+'/premiumIndex');if(fd)fd.filter(function(d){return d.symbol.endsWith('USDT')}).forEach(function(d){var s=d.symbol.replace('USDT','');FR[s]={rate:+d.lastFundingRate*100,mark:+d.markPrice}});if(FR.BTC)document.getElementById('pFR').textContent=(FR.BTC.rate>=0?'+':'')+FR.BTC.rate.toFixed(4)+'%';
  var p1=WL.slice(0,8).map(function(s){return fj(BF+'/openInterest?symbol='+s+'USDT').then(function(d){if(d)OI[s]=(+d.openInterest)*(T[s]?T[s].p:0)}).catch(function(){})});
  var p2=WL.map(function(s){return fj(BF+'/topLongShortPositionRatio?symbol='+s+'USDT&period=1h&limit=4').then(function(d){if(d&&d[0]){LS[s]={long:+d[0].longAccount*100,short:+d[0].shortAccount*100,ratio:+d[0].longShortRatio};lsHist[s]=d.map(function(x){return{long:+x.longAccount*100,short:+x.shortAccount*100,ratio:+x.longShortRatio,time:+x.timestamp}}).reverse()}}).catch(function(){})});
  await Promise.all(p1.concat(p2));
  if(!Object.keys(LS).length)WL.forEach(function(s){var fr=FR[s];if(fr){var b=fr.rate>0?55+Math.min(20,fr.rate*200):45-Math.min(15,Math.abs(fr.rate)*200);LS[s]={long:Math.round(b),short:Math.round(100-b),ratio:+(b/(100-b)).toFixed(2)}}});}
/* ═══ EARLY DETECTION SCANNER — catches coins BEFORE they pump ═══ */
function quickScan(){var STABLES=['USDT','USDC','TUSD','DAI','BUSD','FDUSD','USDP','PYUSD'];var cands=[];Object.entries(T).forEach(function(e){var s=e[0],d=e[1];if(STABLES.includes(s))return;
  var tier=getCoinTier(s);
  /* Smart volume filter: tier-aware */
  var minVol=200000;
  if(tier===1)minVol=100000; /* T1: lower bar — always worth checking */
  else if(tier===2)minVol=500000; /* T2: higher bar — need real volume */
  else if(tier===3||tier===0){minVol=1000000; /* T3/unknown: much higher bar */
    if(d.p<0.01)minVol=2000000} /* Micro caps need massive volume to be real */
  if(d.p<0.1&&d.c>=3)minVol=Math.min(minVol,50000);
  else if(d.p<1&&d.c>=2)minVol=Math.min(minVol,100000);
  if(d.v<minVol)return;
  var sc=0,tags=[];
  /* TIER BONUS: Top coins get priority — small coins penalized */
  if(tier===1){sc+=8;tags.push('🏆T1')}
  else if(tier===2){sc+=3;tags.push('🥈T2')}
  else if(tier===0&&d.v<5e6){sc-=5} /* Unknown tiny coin = penalty */
  /* EARLY DETECTION: low change + high volume = accumulation before pump */
  if(d.c>=0.5&&d.c<3&&d.v>5e7){sc+=25;tags.push('🔍EARLY')}
  if(d.c>=0.5&&d.c<5&&d.v>1e8){sc+=20;tags.push('🔍STEALTH')}
  /* Already moving but still early */
  if(d.c>=3&&d.c<8){sc+=22;tags.push('📈RISING')}
  if(d.c>=8&&d.c<15){sc+=18;tags.push('⚡SURGE')}
  if(d.c>=15){sc+=10;tags.push('🚀LATE')} /* late = lower score */
  /* Volume anomaly = most important signal */
  if(d.v>1e9){sc+=25;tags.push('🔥MEGA_VOL')}
  else if(d.v>1e8){sc+=18;tags.push('📊HIGH_VOL')}
  else if(d.v>5e7){sc+=10;tags.push('📊VOL')}
  /* Near resistance with volume = breakout imminent */
  if(d.h>0&&d.p>0&&((d.h-d.p)/d.p)*100<1.5){sc+=12;tags.push('🎯AT_HIGH')}
  /* FR opportunity */
  var fr=FR[s];if(fr){if(fr.rate<-0.02){sc+=8;tags.push('FR⬇️')}else if(fr.rate>0.08){sc-=8;tags.push('FR⚠️')}}
  /* Accumulation pattern */
  if(Math.abs(d.c)<2&&d.v>8e7){sc+=20;tags.push('🐋ACC')}
  /* Bottom buying */
  if(d.h&&d.l&&d.h!==d.l&&((d.p-d.l)/(d.h-d.l))*100<25&&d.v>1e7){sc+=10;tags.push('📉BOTTOM')}
  if(sc>=15)cands.push({s:s,p:d.p,c:d.c,v:d.v,score:sc,tags:tags,fr:fr?fr.rate:null,by:d.by,cb:CBP[s]})});
  return cands.sort(function(a,b){return b.score-a.score})}
/* DEEP ANALYZE — tier-aware: T1=6 checks, T2=4 checks, T3=volume only */
async function deepAnalyze(cands){var results=[];var top=cands.slice(0,30);
  var klData={},obData={};
  /* Only fetch klines for T1+T2, OB for T1 only */
  var t1t2=top.filter(function(c){return getCoinTier(c.s)<=2||c.score>=30});
  var t1Only=top.filter(function(c){return getCoinTier(c.s)===1||c.score>=40});
  var klProms=t1t2.slice(0,25).map(function(c){return fj(BN+'/klines?symbol='+c.s+'USDT&interval=1h&limit=30').then(function(d){klData[c.s]=d}).catch(function(){})});
  var obProms=t1Only.slice(0,15).map(function(c){return fj(BN+'/depth?symbol='+c.s+'USDT&limit=10').then(function(d){obData[c.s]=d}).catch(function(){})});
  await Promise.all(klProms.concat(obProms));
  /* Bybit fallback: for coins without Binance klines */
  var byMissing=top.filter(function(c){return!klData[c.s]&&T[c.s]&&T[c.s].src==='BY'}).slice(0,10);
  if(byMissing.length){var byProms=byMissing.map(function(c){return fj('https://api.bybit.com/v5/market/kline?category=spot&symbol='+c.s+'USDT&interval=60&limit=30').then(function(d){if(d&&d.result&&d.result.list){klData[c.s]=d.result.list.reverse().map(function(k){return[+k[0],+k[1],+k[2],+k[3],+k[4],+k[5]]})}}).catch(function(){})});
    var byObProms=byMissing.map(function(c){return fj('https://api.bybit.com/v5/market/orderbook?category=spot&symbol='+c.s+'USDT&limit=10').then(function(d){if(d&&d.result){obData[c.s]={bids:(d.result.b||[]).map(function(x){return[x[0],x[1]]}),asks:(d.result.a||[]).map(function(x){return[x[0],x[1]]})}}}).catch(function(){})});
    await Promise.all(byProms.concat(byObProms))}
  for(var ci=0;ci<top.length;ci++){var c=top[ci];var ds=c.score,dt=c.tags.slice();
    var checks={vol:false,ob:false,rsi:false,macd:false,fr:false,oi:false};var passed=0;
    /* CHECK 1: Volume Spike 25% */
    var kl=klData[c.s];if(kl&&kl.length>=20){var vols=kl.map(function(k){return+k[5]});var closes=kl.map(function(k){return+k[4]});
      var avgVol=vols.slice(0,-3).reduce(function(a,b){return a+b},0)/Math.max(1,vols.length-3);var recentVol=(vols[vols.length-1]+vols[vols.length-2])/2;
      if(recentVol>avgVol*1.8){ds+=20;checks.vol=true;dt.push('VOL:'+Math.round(recentVol/avgVol*10)/10+'x')}
      else if(recentVol>avgVol*1.3){ds+=10;checks.vol=true;dt.push('VOL↑')}
      /* CHECK 3: RSI Zone 15% */
      var rsi=calcRSI(closes);if(rsi>=35&&rsi<=60){ds+=12;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'✅')}
      else if(rsi<30){ds+=15;checks.rsi=true;dt.push('RSI:'+rsi.toFixed(0)+'🟢')}
      else if(rsi>70){ds-=5;dt.push('RSI:'+rsi.toFixed(0)+'⚠️')}
      /* CHECK 4: MACD Signal 15% */
      var macd=calcMACD(closes);if(macd.h>0){ds+=12;checks.macd=true;dt.push('MACD✅')}if(macd.cross==='bull'){ds+=5;dt.push('MACD🔀↑')}
    }
    /* CHECK 2: Order Book 20% */
    var ob=obData[c.s];if(ob){var bv=ob.bids.reduce(function(s,b){return s+ +b[0]* +b[1]},0);var av=ob.asks.reduce(function(s,a){return s+ +a[0]* +a[1]},0);var ratio=bv/Math.max(av,1);
      if(ratio>1.5){ds+=18;checks.ob=true;dt.push('OB:'+ratio.toFixed(1)+'x')}
      else if(ratio>1.2){ds+=10;checks.ob=true;dt.push('OB:'+ratio.toFixed(1)+'x')}}
    /* CHECK 5: Funding Rate 15% — negative FR first (best signal) */
    if(FR[c.s]){if(FR[c.s].rate<-0.02){ds+=15;checks.fr=true;dt.push('FR⬇️🟢')}
      else if(FR[c.s].rate<0.01){ds+=10;checks.fr=true;dt.push('FR✅')}}
    /* CHECK 6: OI Change 10% */
    if(OI[c.s]&&c.c>0){ds+=8;checks.oi=true;dt.push('OI↑')}
    passed=Object.values(checks).filter(Boolean).length;
    /* ═══ ULTRA v2.0 — Maximum Accuracy ═══ */
    var isUltra=false;var isConf=false;var whaleConf=0;var smartEntry=null;
    var basicPass=ds>=70&&passed>=5;var confPass=ds>=50&&passed>=3;
    var tooLate=c.c>=8; /* Block late entries */
    var btcOk=T.BTC?T.BTC.c>-3:true;var fgOk=fgValue>=20;var marketSafe=btcOk&&fgOk;
    /* Market breadth filter */
    var allUp=Object.values(T).filter(function(x){return x.c>0}).length;var breadthPct=Object.keys(T).length>0?allUp/Object.keys(T).length*100:50;
    var fomo=breadthPct>80;var crash=breadthPct<20;
    if(crash){basicPass=false;confPass=false}
    if(basicPass&&!tooLate&&marketSafe){
      try{var wEng=await whaleEngine(c.s);whaleConf=wEng?wEng.confidence:0;
        var cvdChk=analyzeCVD(c.s);var btcDivChk=detectBTCDivergence(c.s);
        if(cvdChk.divergence==='BEARISH'||btcDivChk.signal==='WHALE_DISTRIBUTING')whaleConf=Math.max(0,whaleConf-30);
        if(fomo)whaleConf=Math.min(whaleConf,60); /* FOMO = cap confidence */
        isUltra=whaleConf>=50&&basicPass;
        isConf=whaleConf>=30&&confPass&&!tooLate;
        /* Smart Entry */
        smartEntry={entry:c.p*0.985,stop:c.p*0.93,target1:c.p*1.05,target2:c.p*1.10,rr:((c.p*1.05-c.p*0.985)/(c.p*0.985-c.p*0.93)).toFixed(1)};
        if(klData[c.s]&&klData[c.s].length>=10){var lows=klData[c.s].map(function(k){return+k[3]});var highs=klData[c.s].map(function(k){return+k[2]});var sup=Math.min.apply(null,lows.slice(-10));var res=Math.max.apply(null,highs.slice(-10));var rng=res-sup;smartEntry.entry=Math.max(c.p*0.985,sup*1.01);smartEntry.stop=sup*0.97;smartEntry.target1=c.p+rng*0.618;smartEntry.target2=c.p+rng;var risk=smartEntry.entry-smartEntry.stop;smartEntry.rr=risk>0?((smartEntry.target1-smartEntry.entry)/risk).toFixed(1):'0';smartEntry.support=sup;smartEntry.resistance=res}
        if(+smartEntry.rr<2.0){isUltra=false;if(+smartEntry.rr>=1.5)isConf=true}
      }catch(e){isUltra=ds>=80&&passed>=5&&!tooLate&&marketSafe;isConf=ds>=60&&passed>=4&&!tooLate}}
    else{isConf=confPass&&!tooLate&&c.c<12}
    /* Record signal + notify */
    if(isUltra){recSig(c.s,'ultra');notify(c.s,'ultra',ds,{score:ds,checks:checks,passed:passed,total:6})}
    if(c.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')})){recSig(c.s,'whale');if(c.v>5e7||checks.ob)notify(c.s,'whale',ds)}
    if(c.c>=3)recSig(c.s,'breakout');
    results.push({s:c.s,p:c.p,c:c.c,v:c.v,score:ds,tags:dt,checks:checks,passed:passed,total:6,ultra:isUltra,confirmed:isConf,fr:c.fr,by:c.by,cb:c.cb,whaleConf:whaleConf,smartEntry:smartEntry,detectedAt:getSigTime(c.s,isUltra?'ultra':'breakout')})}
  return results.sort(function(a,b){return b.score-a.score})}
/* MARKET HEALTH */
function calcHealth(){var sc=0,f=[];sc+=fgValue<25?5:fgValue<40?10:fgValue<60?15:fgValue<75?18:12;f.push({l:'Fear/Greed',v:fgValue,c:fgValue<30?'dn':fgValue>70?'up':'warn'});sc+=btcDom>60?8:btcDom>50?12:btcDom>40?15:10;f.push({l:'BTC Dom',v:btcDom.toFixed(1)+'%',c:btcDom>55?'warn':'neon'});var bk=Object.values(T).filter(function(x){return x.c>=8}).length;sc+=bk>20?15:bk>10?12:bk>5?10:5;f.push({l:lang==='ar'?'انفجارات':'Breakouts',v:bk,c:bk>15?'up':bk>5?'warn':'dn'});var rs=Object.values(T).filter(function(x){return x.c>0}).length,tt=Object.keys(T).length,bp=tt>0?Math.round(rs/tt*100):50;sc+=bp>60?15:bp>45?10:5;f.push({l:lang==='ar'?'صاعدة':'Bullish',v:bp+'%',c:bp>60?'up':bp>40?'warn':'dn'});var af=Object.values(FR).reduce(function(s,x){return s+x.rate},0)/Math.max(1,Object.keys(FR).length);sc+=af>0.05?5:af>0.02?10:af<-0.01?18:15;f.push({l:'Avg FR',v:(af>=0?'+':'')+af.toFixed(4)+'%',c:af>0.05?'dn':af<-0.01?'up':'warn'});var vc=Object.values(T).filter(function(x){return x.v>1e8}).length;sc+=vc>15?15:vc>8?10:5;f.push({l:'Vol>$100M',v:vc,c:vc>10?'up':'warn'});return{score:Math.min(100,sc),factors:f}}
function getWarnings(){var w=[];Object.entries(FR).filter(function(e){return WL.includes(e[0])}).forEach(function(e){if(e[1].rate>0.08)w.push({ic:'🔴',txt:e[0]+': FR '+e[1].rate.toFixed(3)+'% — '+(lang==='ar'?'خطر تصفية':'Liquidation risk')});if(e[1].rate<-0.05)w.push({ic:'🟢',txt:e[0]+': FR '+e[1].rate.toFixed(3)+'% — '+(lang==='ar'?'فرصة شراء':'Buy opportunity')})});Object.entries(LS).forEach(function(e){if(e[1].ratio>2)w.push({ic:'⚠️',txt:e[0]+': L/S '+e[1].ratio.toFixed(2)+' — '+(lang==='ar'?'Long مفرط':'Excessive Longs')});if(e[1].ratio<0.6)w.push({ic:'⚠️',txt:e[0]+': L/S '+e[1].ratio.toFixed(2)+' — Short Squeeze'})});return w.slice(0,4)}
/* ACCURACY */
function savePred(sym,p,tgt,sc){predictions.push({sym:sym,price:p,target:tgt,score:sc,time:Date.now(),checked:false,hit:false,partial:false});if(predictions.length>100)predictions=predictions.slice(-100);localStorage.setItem('nxpred10',JSON.stringify(predictions))}
function getAcc(){var ch=false;predictions.forEach(function(p){if(!p.checked&&Date.now()-p.time>12*3600*1000){var cur=T[p.sym];if(cur){p.checked=true;var gain=(cur.p-p.price)/p.price*100;p.hit=gain>=5;p.partial=gain>=2&&gain<5;p.finalPrice=cur.p;p.pnl=gain;ch=true}}});if(ch)localStorage.setItem('nxpred10',JSON.stringify(predictions));var c=predictions.filter(function(p){return p.checked});var hits=c.filter(function(p){return p.hit}).length;var partials=c.filter(function(p){return p.partial}).length;return{total:c.length,hits:hits,partials:partials,rate:c.length>0?Math.round((hits+partials*0.5)/c.length*100):0}}
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

function saveTrades(){if(activeTrades.length>200)activeTrades=activeTrades.slice(-200);localStorage.setItem('nxTrades',JSON.stringify(activeTrades))}

function closeTrade(trade,exitPrice,reason){
  trade.status='CLOSED';trade.exitPrice=exitPrice;trade.exitTime=Date.now();trade.exitReason=reason;
  trade.finalPnl=((exitPrice-trade.entry)/trade.entry*100);trade.duration=Date.now()-trade.entryTime;
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

/* Whale profit-taking detection */
function detectWhaleProfitTaking(sym){
  var ww=whaleWaves[sym];if(!ww||!ww.engine)return{taking:false,signals:[]};
  var d=T[sym];if(!d)return{taking:false,signals:[]};
  var sigs=[],isTaking=false;
  var cvd=analyzeCVD(sym);
  if(cvd.divergence==='BEARISH'&&cvd.cvdTrend==='FALLING'){sigs.push(lang==='ar'?'🐋🩸 CVD انقلب — حيتان تبيع':'🐋🩸 CVD flipped — Whales selling');isTaking=true}
  if(ww.engine.confidence<25&&ww.prevConf&&ww.prevConf>=50){sigs.push(lang==='ar'?'📉 ثقة نزلت '+ww.prevConf+'% → '+ww.engine.confidence+'%':'Confidence '+ww.prevConf+'% → '+ww.engine.confidence+'%');isTaking=true}
  if(ww.engine.layers&&ww.engine.layers.trades&&ww.engine.layers.trades.whaleSells>=2&&d.c>5){sigs.push(lang==='ar'?'💰 '+ww.engine.layers.trades.whaleSells+' صفقات بيع بعد +'+d.c.toFixed(1)+'%':ww.engine.layers.trades.whaleSells+' sells after +'+d.c.toFixed(1)+'%');isTaking=true}
  if(ww.engine.techniques&&ww.engine.techniques.oiDelta){var oiC=parseFloat(ww.engine.techniques.oiDelta.oiChange)||0;if(oiC<-5&&d.c>3){sigs.push(lang==='ar'?'📊 OI ينخفض '+oiC.toFixed(1)+'%':'OI dropping '+oiC.toFixed(1)+'%');isTaking=true}}
  var fr=FR[sym];if(fr&&fr.rate>0.08&&d.c>5){sigs.push(lang==='ar'?'⚠️ FR عالي '+fr.rate.toFixed(3)+'% بعد صعود':'High FR '+fr.rate.toFixed(3)+'% after pump');isTaking=true}
  ww.prevConf=ww.engine.confidence;
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
    if(wpt.taking&&tr.pnl>0){showPopup('🐋🩸',tr.sym+' — '+(lang==='ar'?'حيتان تجني أرباح!':'Whales taking profit!'),(tr.pnl>=0?'+':'')+tr.pnl.toFixed(1)+'%');addNotifHist('🐋🩸',tr.sym,lang==='ar'?'جني أرباح':'Profit Taking',wpt.signals[0]||'');
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
  saveTrades()}
/* 💰 STABLECOIN FLOW INDICATOR — uses already-loaded T data (no extra API calls) */
async function loadStableFlow(){
  try{
    /* Calculate from already-loaded ticker data — NO duplicate API call */
    var usdtVol=0,usdcVol=0,totalVol=0;
    Object.entries(T).forEach(function(e){var d=e[1];if(d.src==='BN'){totalVol+=d.v}});
    /* Estimate USDC volume from known USDC-heavy coins */
    var stableCoins=['USDC','TUSD','FDUSD','DAI','BUSD'];
    stableCoins.forEach(function(s){if(T[s])usdcVol+=T[s].v});
    usdtVol=totalVol-usdcVol;
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
    /* Update UI */
    document.getElementById('sfUSDT').textContent=fmt(usdtVol);
    document.getElementById('sfUSDC').textContent=fmt(usdcVol);
    document.getElementById('sfUSDTch').style.color=btcChange>=0?'var(--up)':'var(--dn)';
    document.getElementById('sfUSDTch').textContent=btcChange>=0?'📈 '+(lang==='ar'?'شراء كريبتو':'Buying crypto'):'📉 '+(lang==='ar'?'بيع كريبتو':'Selling crypto');
    document.getElementById('sfUSDCch').style.color=usdcVol>1e9?'var(--warn)':'var(--t2)';
    document.getElementById('sfUSDCch').textContent=usdcVol>1e9?(lang==='ar'?'نشاط عالي':'High activity'):(lang==='ar'?'طبيعي':'Normal');
    var idxColor=flowIndex<=30?'var(--up)':flowIndex<=55?'var(--warn)':'var(--dn)';
    document.getElementById('sfIndex').textContent=flowIndex;document.getElementById('sfIndex').style.color=idxColor;
    var idxLabel=flowIndex<=20?(lang==='ar'?'🟢 شراء قوي':'🟢 Strong Buy'):flowIndex<=35?(lang==='ar'?'🟢 شراء':'🟢 Buying'):flowIndex<=55?(lang==='ar'?'🟡 متوازن':'🟡 Balanced'):flowIndex<=75?(lang==='ar'?'🔴 بيع':'🔴 Selling'):(lang==='ar'?'🔴 بيع قوي':'🔴 Strong Sell');
    document.getElementById('sfIndexLbl').textContent=idxLabel;document.getElementById('sfIndexLbl').style.color=idxColor;
    document.getElementById('sfPt').style.left=flowIndex+'%';
    var signalEl=document.getElementById('sfSignal');
    if(flowIndex<=30){signalEl.textContent=lang==='ar'?'🟢 صعودي':'🟢 BULLISH';signalEl.style.background='var(--ud)';signalEl.style.color='var(--up)'}
    else if(flowIndex<=55){signalEl.textContent=lang==='ar'?'🟡 محايد':'🟡 NEUTRAL';signalEl.style.background='var(--wd)';signalEl.style.color='var(--warn)'}
    else{signalEl.textContent=lang==='ar'?'🔴 هبوطي':'🔴 BEARISH';signalEl.style.background='var(--dd)';signalEl.style.color='var(--dn)'}
    var advice=flowIndex<=25?(lang==='ar'?'💡 الناس تشتري كريبتو بقوة — السوق صاعد':'💡 People buying crypto aggressively — Bullish'):flowIndex<=40?(lang==='ar'?'💡 تدفق إيجابي — فرص شراء':'💡 Positive flow — Buy opportunities'):flowIndex<=60?(lang==='ar'?'💡 السوق متوازن — انتظر إشارة واضحة':'💡 Market balanced — Wait for clear signal'):flowIndex<=80?(lang==='ar'?'💡 الناس تبيع كريبتو — حذر':'💡 People selling crypto — Be cautious'):(lang==='ar'?'⚠️ تدفق كبير نحو المستقرة — خطر هبوط':'⚠️ Major flow to stables — Crash risk');
    document.getElementById('sfAdvice').textContent=advice;document.getElementById('sfAdvice').style.color=idxColor;
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
  try{var h=await fj('https://fapi.binance.com/futures/data/openInterestHist?symbol='+sym+'USDT&period=1h&limit=4');
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
  whaleLearning.preds.push({sym:sym,conf:conf,layers:Object.fromEntries(Object.entries(layers).map(function(e){return[e[0],{sc:e[1].score,sig:e[1].signal}]})),price:price,time:Date.now(),chk:false,hit:false});
  if(whaleLearning.preds.length>300)whaleLearning.preds=whaleLearning.preds.slice(-300);
  localStorage.setItem('nxwlrn',JSON.stringify(whaleLearning.preds))}
function wlVerify(){
  var ch=false;whaleLearning.preds.forEach(function(p){
    if(!p.chk&&Date.now()-p.time>8*3600000){var cur=T[p.sym];if(cur){p.chk=true;p.hit=((cur.p-p.price)/p.price*100)>=2;ch=true;
      Object.entries(p.layers).forEach(function(e){var k=e[0],l=e[1];if(l.sc>0){if(!whaleLearning.layerAcc[k])whaleLearning.layerAcc[k]={ok:0,t:0};whaleLearning.layerAcc[k].t++;if(p.hit)whaleLearning.layerAcc[k].ok++}})}}});
  if(ch){localStorage.setItem('nxwlrn',JSON.stringify(whaleLearning.preds));localStorage.setItem('nxwlacc',JSON.stringify(whaleLearning.layerAcc))}}
function wlGetStats(){var c=whaleLearning.preds.filter(function(p){return p.chk});var h=c.filter(function(p){return p.hit});return{total:c.length,hits:h.length,rate:c.length>0?Math.round(h.length/c.length*100):0}}

/* LAYER 1: Order Book — walls, spoofing, imbalance (15%) */
async function whaleL1(sym){
  var ck=wGet('L1_'+sym);if(ck)return ck;
  var ob=await fj(BN+'/depth?symbol='+sym+'USDT&limit=20');
  var byOb=null;try{var bd=await fj('https://api.bybit.com/v5/market/orderbook?category=spot&symbol='+sym+'USDT&limit=15');if(bd&&bd.result)byOb={bids:(bd.result.b||[]).map(function(x){return[x[0],x[1]]}),asks:(bd.result.a||[]).map(function(x){return[x[0],x[1]]})}}catch(e){}
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
  /* Old-style OB change detection — keep the sensitivity */
  var prevBV=wGet('prevBV_'+sym);if(prevBV){var inc=bV-prevBV;var thresh=bV*0.15;if(inc>thresh&&inc>30000)sc+=8}
  wSet('prevBV_'+sym,bV,120000);
  sc+=spoof;sc=Math.max(0,Math.min(35,sc));
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

/* LAYER 4: Funding Rate Anomaly (10%) */
function whaleL4(sym){
  var fr=FR[sym];var oi=OI[sym];if(!fr)return{score:0,signal:'NO_DATA'};
  var sc=0,sig='NEUTRAL';
  if(fr.rate<-0.03){sc+=10;sig='VERY_BULLISH_FR'}
  else if(fr.rate<-0.01){sc+=7;sig='BULLISH_FR'}
  else if(fr.rate>0.08){sc-=5;sig='DANGER_HIGH_FR'}
  /* OI rising + negative FR = whale longs building */
  if(oi&&fr.rate<0){var prevOI=wGet('prevOI_'+sym);if(prevOI&&oi>prevOI*1.05){sc+=5;sig='WHALE_LONG_BUILDUP'}wSet('prevOI_'+sym,oi,120000)}
  return{score:Math.max(-5,sc),fundingRate:fr.rate,openInterest:oi||0,signal:sig}}

/* LAYER 5: Cross-Exchange Flow (15%) */
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
  return{score:Math.max(0,sc),signals:sigs,signal:sigs[0]||'NO_DIVERGENCE'}}

/* ═══ WHALE INTELLIGENCE ENGINE v3.0 — 5L + 8T ═══ */
var LAYER_WEIGHTS={L1:0.18,L2:0.28,L3:0.10,L4:0.16,L5:0.28};
async function whaleEngine(sym){
  var t0=Date.now();
  /* Layers 1-3 parallel + 6,7 async */
  var results=await Promise.allSettled([whaleL1(sym),whaleL2(sym),whaleL3(sym),analyzeOIDelta(sym),analyzeTakerRatio(sym)]);
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
  var takerR=results[4].status==='fulfilled'?results[4].value:{score:0,signal:'NO_DATA'};
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
  if(cvd.divergence==='BULLISH')reasons.push('📊 CVD '+(lang==='ar'?'تجميع صامت — أقوى إشارة!':'Silent accumulation — strongest signal!'));
  if(iceberg.count>0)reasons.push('🧊 '+(lang==='ar'?'أوامر مخفية ':'Iceberg ')+iceberg.count+' '+iceberg.signal);
  if(absorb.signal==='BULLISH_ABSORPTION')reasons.push('🛡️ '+(lang==='ar'?'حوت يمتص البيع '+absorb.volRatio:'Whale absorbing sells '+absorb.volRatio));
  if(layers.trades.whaleBuys>=2)reasons.push('💰 '+layers.trades.whaleBuys+' '+(lang==='ar'?'صفقات حوت':'whale buys')+' ($'+fmt(layers.trades.totalBuyVolume)+')');
  if(layers.ob.nearImbalance>2)reasons.push('📗 OB '+(lang==='ar'?'ضغط شراء':'buy pressure')+' '+layers.ob.nearImbalance.toFixed(1)+'x');
  if(oiDelta.signal==='WHALE_LONG_BUILDUP')reasons.push('📈 OI↑ + FR↓ = '+(lang==='ar'?'حوت يبني Long':'Whale building Long'));
  if(takerR.score>5)reasons.push('⚡ Taker '+(lang==='ar'?'شراء عدواني':'aggressive buy')+' '+takerR.ratio+'x');
  if(btcDiv.signal==='WHALE_TARGETING_BUY')reasons.push('🎯 '+(lang==='ar'?'حوت يستهدف — مستقل عن BTC':'Whale targeting — independent of BTC'));
  if(layers.fr.fundingRate<-0.01)reasons.push('📊 FR '+(lang==='ar'?'سلبي':'negative')+' '+layers.fr.fundingRate.toFixed(4)+'%');
  if(layers.xex.signals&&layers.xex.signals.includes('COINBASE_PREMIUM'))reasons.push('🏦 Coinbase '+(lang==='ar'?'أعلى (مؤسسات)':'premium'));
  if(layers.liqs.signal==='SHORT_SQUEEZE')reasons.push('💥 '+(lang==='ar'?'تصفية شورت':'Short squeeze'));
  if(vpin.score>5)reasons.push('☣️ VPIN '+(lang==='ar'?'سمية عالية — حركة قادمة':'High toxicity — move imminent')+' '+vpin.vpin);
  if(layers.ob.spoofWarning)reasons.push('⚠️ '+(lang==='ar'?'تلاعب محتمل':'Possible spoofing'));
  /* Self-learning: record + verify */
  if(conf>=30)wlRecordSignal(sym,conf,layers,T[sym]?T[sym].p:0);wlVerify();
  var wlStats=wlGetStats();
  return{symbol:sym,confidence:conf,signal:sig,strength:str,layers:layers,activeLayers:active,execTime:(Date.now()-t0)+'ms',reasons:reasons.slice(0,5),timeMult:timeMult,techniques:{cvd:cvd,iceberg:iceberg,absorption:absorb,btcDiv:btcDiv,oiDelta:oiDelta,takerRatio:takerR},learning:wlStats,action:conf>=70?{type:'BUY',target:'+8% to +15%',stop:'-7%'}:conf<=20?{type:'AVOID'}:{type:'WATCH'}}}

/* ═══ WHALE DETECTION — uses engine for top coins ═══ */
async function detectWhaleWaves(candidates){
  if(!candidates||!candidates.length)return;
  var top=candidates.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')})||(x.v>5e7&&Math.abs(x.c)<3)||(x.checks&&x.checks.ob)}).slice(0,15);
  /* Run whale engine on top 10, layers 1+4+5 only for rest */
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
        w.waves.push({amount:buyVol,price:c.p,time:Date.now(),confidence:eng.confidence,layers:eng.activeLayers});
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
  localStorage.setItem('nxww10',JSON.stringify(whaleWaves))}

/* ═══ WHALE CARD v3.0 — 5 Layers + 8 Techniques ═══ */
function whaleCard(r,rank){
  var RANKS=[
    {ic:'🏆',lbl:'DIAMOND',bg:'linear-gradient(135deg,#b9f2ff,#00d4ff)',col:'#0077b6',bdr:'2px solid #00d4ff',glow:'0 0 12px rgba(0,212,255,.4)'},
    {ic:'🥇',lbl:'GOLD',bg:'linear-gradient(135deg,#ffd700,#ff8c00)',col:'#8b6914',bdr:'2px solid #ffd700',glow:'0 0 12px rgba(255,215,0,.4)'},
    {ic:'🥈',lbl:'SILVER',bg:'linear-gradient(135deg,#e8e8e8,#a0a0a0)',col:'#555',bdr:'2px solid #c0c0c0',glow:'0 0 8px rgba(192,192,192,.3)'},
    {ic:'🥉',lbl:'BRONZE',bg:'linear-gradient(135deg,#cd7f32,#8b4513)',col:'#fff',bdr:'1px solid #cd7f32',glow:'none'},
    {ic:'⭐',lbl:'STAR',bg:'var(--bg2)',col:'var(--t1)',bdr:'1px solid var(--bdr)',glow:'none'}];
  var medal=rank!==undefined&&rank<5?RANKS[rank]:null;
  var medalHTML=medal?'<div style="position:absolute;top:-4px;right:-4px;z-index:1;padding:2px 6px;border-radius:6px;background:'+medal.bg+';box-shadow:'+medal.glow+';display:flex;align-items:center;gap:3px"><span style="font-size:14px">'+medal.ic+'</span><span style="font-size:7px;font-weight:800;color:'+medal.col+';font-family:var(--fm);letter-spacing:.5px">'+medal.lbl+'</span></div>':'';
  var cardBdr=medal?medal.bdr:'1px solid var(--bdr)';var cardGlow=medal?medal.glow:'none';
  var wt=getSigTime(r.s,'whale');
  var ww=whaleWaves[r.s]||{waves:[],totalBuy:0,engine:null};
  var waves=ww.waves;var eng=ww.engine;
  var waveCount=waves.length;
  var totalBuy=waves.reduce(function(s,w){return s+w.amount},0)||r.v*0.05;
  var conf=eng?eng.confidence:0;
  var str;
  if(conf>=80)str={t:lang==='ar'?'🔥 تجميع مؤكد':'🔥 Confirmed',c:'str-strong'};
  else if(conf>=60)str={t:lang==='ar'?'⚡ تجميع قوي':'⚡ Strong',c:'str-strong'};
  else if(conf>=40)str={t:lang==='ar'?'📊 نشاط متوسط':'📊 Moderate',c:'str-normal'};
  else str={t:lang==='ar'?'👀 مراقبة':'👀 Watch',c:'str-weak'};
  var src=[];if(T[r.s])src.push(T[r.s].src==='BY'?'Bybit':'Binance');if(T[r.s]&&T[r.s].by)src.push('Bybit');if(CBP[r.s])src.push('Coinbase');
  var whaleIc=conf>=80?'🐋🐋🐋':conf>=60?'🐋🐋':'🐋';
  /* Layer + Technique bars */
  var layerHTML='';
  if(eng&&eng.activeLayers>0){
    var lNames={ob:{n:lang==='ar'?'دفتر الأوامر':'Order Book',ic:'📗',col:'#00ff88'},trades:{n:lang==='ar'?'صفقات كبيرة':'Trade Flow',ic:'💰',col:'#ffd700'},liqs:{n:lang==='ar'?'تصفيات':'Liquidations',ic:'💥',col:'#ff3860'},fr:{n:'Funding + OI',ic:'📊',col:'#b07cff'},xex:{n:lang==='ar'?'بين المنصات + BTC':'X-Exchange + BTC',ic:'🔄',col:'#5b9cff'}};
    layerHTML='<div style="margin:8px 0;padding:10px;background:var(--bg2);border-radius:10px">';
    layerHTML+='<div style="font-size:10px;font-weight:800;color:var(--t1);margin-bottom:8px">'+(lang==='ar'?'📊 تحليل 5 طبقات + 8 تقنيات:':'📊 5 Layers + 8 Techniques:')+'</div>';
    ['ob','trades','liqs','fr','xex'].forEach(function(k){
      var l=eng.layers[k];if(!l)return;var off=l.signal==='OFFLINE'||l.signal==='SKIP'||l.signal==='NO_DATA';
      var pct=off?0:Math.min(100,Math.max(0,l.score*2.5));
      var info=lNames[k];var barCol=off?'var(--t3)':info.col;
      layerHTML+='<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">'
        +'<span style="font-size:12px;width:18px">'+info.ic+'</span>'
        +'<span style="width:72px;font-size:9px;font-weight:700;color:var(--t1)">'+info.n+'</span>'
        +'<div style="flex:1;height:6px;background:var(--bdr);border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+barCol+';border-radius:3px;transition:width .5s"></div></div>'
        +'<span style="width:55px;text-align:left;font-size:8px;font-family:var(--fm);font-weight:800;color:'+barCol+'">'+(off?'—':l.signal.replace(/_/g,' ').slice(0,14))+'</span></div>'});
    /* Technique badges */
    if(eng.techniques){
      var t=eng.techniques;var badges=[];
      if(t.cvd&&t.cvd.divergence==='BULLISH')badges.push({t:'CVD ↑',c:'var(--up)',bg:'var(--ud)'});
      if(t.cvd&&t.cvd.divergence==='BEARISH')badges.push({t:'CVD ↓',c:'var(--dn)',bg:'var(--dd)'});
      if(t.iceberg&&t.iceberg.count>0)badges.push({t:'🧊 Iceberg ×'+t.iceberg.count,c:'var(--blue)',bg:'var(--bd)'});
      if(t.absorption&&t.absorption.score>10)badges.push({t:'🛡️ Absorb '+t.absorption.volRatio,c:'var(--neon)',bg:'var(--nd)'});
      if(t.btcDiv&&t.btcDiv.score>5)badges.push({t:'🎯 BTC div',c:'var(--purple)',bg:'var(--pd)'});
      if(t.oiDelta&&t.oiDelta.score>5)badges.push({t:'📈 OI '+t.oiDelta.oiChange,c:'var(--ultra)',bg:'var(--ultd)'});
      if(t.takerRatio&&t.takerRatio.score>5)badges.push({t:'⚡ Taker '+t.takerRatio.ratio+'x',c:'var(--up)',bg:'var(--ud)'});
      if(t.vpin&&t.vpin.score>3)badges.push({t:'☣️ VPIN '+t.vpin.vpin,c:'var(--dn)',bg:'var(--dd)'});
      if(badges.length){
        layerHTML+='<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:6px;padding-top:6px;border-top:1px solid var(--bdr)">';
        badges.forEach(function(b){layerHTML+='<span style="font-size:8px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+b.bg+';color:'+b.c+'">'+b.t+'</span>'});
        layerHTML+='</div>'}}
    /* Time multiplier */
    if(eng.timeMult&&eng.timeMult.mult!==1){layerHTML+='<div style="font-size:7px;color:var(--t3);margin-top:4px">🕐 '+eng.timeMult.reason+' (×'+eng.timeMult.mult.toFixed(1)+')</div>'}
    layerHTML+='</div>'}
  /* Wave details */
  var waveHTML='';
  if(waveCount>0){
    waveHTML='<div style="margin:6px 0;border-top:1px solid var(--bdr);padding-top:6px">';
    waves.forEach(function(wave,i){
      var isNew=Date.now()-wave.time<120000;
      waveHTML+='<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:9px'+(i<waves.length-1?';border-bottom:1px solid rgba(56,72,96,.15)':'')+'">'
        +'<span style="color:var(--neon);font-weight:700;font-size:11px">🐋</span>'
        +'<span style="font-family:var(--fm);font-weight:800;color:var(--t0);font-size:10px">#'+(i+1)+'</span>'
        +'<span style="font-family:var(--fm);font-weight:800;color:var(--neon);flex:1;font-size:10px">'+fmt(wave.amount)+'</span>'
        +'<span style="font-family:var(--fm);color:var(--t2);font-size:9px">'+fP(wave.price)+'</span>'
        +'<span class="time-badge '+(isNew?'fresh':'')+'">⏱'+timeAgo(wave.time).text+'</span></div>'});
    waveHTML+='</div>'}
  /* Reasons */
  var reasonHTML='';
  if(eng&&eng.reasons&&eng.reasons.length){
    reasonHTML='<div style="margin-top:6px;padding:8px;background:linear-gradient(135deg,rgba(0,255,136,.03),transparent);border:1px solid rgba(0,255,136,.1);border-radius:8px">';
    eng.reasons.forEach(function(re){reasonHTML+='<div style="font-size:9px;color:var(--t0);margin-bottom:2px;font-weight:600">'+re+'</div>'});
    if(eng.action&&eng.action.type==='BUY')reasonHTML+='<div style="margin-top:6px;padding:6px;background:var(--ud);border-radius:6px;text-align:center"><span style="font-size:11px;font-weight:800;color:var(--up)">💡 '+(lang==='ar'?'شراء قوي':'Strong Buy')+'</span><span style="font-size:9px;color:var(--t1);margin:0 8px">🎯 '+eng.action.target+'</span><span style="font-size:9px;color:var(--dn)">🛑 '+eng.action.stop+'</span></div>';
    /* Learning stats */
    if(eng.learning&&eng.learning.total>0)reasonHTML+='<div style="font-size:7px;color:var(--t3);margin-top:4px;text-align:center">🧬 '+(lang==='ar'?'نسبة تعلم':'Learning')+': '+eng.learning.rate+'% ('+eng.learning.hits+'/'+eng.learning.total+')</div>';
    reasonHTML+='</div>'}
  return'<div class="whale-card" style="position:relative;border:'+cardBdr+';box-shadow:'+cardGlow+'" onclick="openCoin(\''+r.s+'\')">'
    +medalHTML
    +'<div class="whale-head"><div class="whale-sym" style="font-size:15px">'+whaleIc+' '+r.s+'/USDT <span class="str-badge '+str.c+'">'+str.t+'</span></div><div style="display:flex;align-items:center;gap:4px">'+timeBadge(wt)+'<span style="font-family:var(--fm);font-size:11px;font-weight:800;padding:3px 8px;border-radius:8px;background:'+(conf>=70?'var(--ud)':conf>=40?'var(--wd)':'var(--bg2)')+';color:'+(conf>=70?'var(--up)':conf>=40?'var(--warn)':'var(--t3)')+'">'+conf+'%</span></div></div>'
    +'<div class="whale-grid"><div class="whale-item"><div class="whale-item-v" style="color:var(--neon);font-size:14px">'+fmt(totalBuy)+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'إجمالي':'Total')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:var(--blue);font-size:14px">'+waveCount+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'موجات':'Waves')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:var(--up);font-size:14px">'+fP(r.p)+'</div><div class="whale-item-l" style="font-size:9px">'+(lang==='ar'?'السعر':'Price')+'</div></div><div class="whale-item"><div class="whale-item-v" style="color:'+(r.c>=0?'var(--up)':'var(--dn)')+';font-size:14px">'+(r.c>=0?'+':'')+r.c.toFixed(1)+'%</div><div class="whale-item-l" style="font-size:9px">24H</div></div></div>'
    +layerHTML+waveHTML+reasonHTML
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:6px;border-top:1px solid var(--bdr)"><div class="src-row">'+src.map(function(s){return'<span class="src-badge">'+s+'</span>'}).join('')+'</div>'+(eng?'<span style="font-family:var(--fm);font-size:8px;color:var(--t3)">⚡'+eng.execTime+' | '+eng.activeLayers+'/5 | v3.0</span>':'')+'</div></div>'}
/* ═══ 🔴 WHALE SELL DETECTION — 8 signals ═══ */
async function detectWhaleSells(candidates){
  if(!candidates||!candidates.length)return[];
  var sells=[];
  var top=candidates.filter(function(x){return getCoinTier(x.s)<=2}).slice(0,20);
  for(var i=0;i<Math.min(top.length,12);i++){
    var c=top[i];var d=T[c.s];if(!d)continue;
    var sc=0,sigs=[];
    /* Signal 1: Price dropping with high volume = dump */
    if(d.c<-3&&d.v>1e8){sc+=15;sigs.push({n:lang==='ar'?'تراجع مع حجم عالي':'Drop + high volume',ic:'📉',col:'var(--dn)'})}
    else if(d.c<-1&&d.v>5e7){sc+=8;sigs.push({n:lang==='ar'?'ضغط بيع':'Sell pressure',ic:'📉',col:'var(--warn)'})}
    /* Signal 2: CVD Bearish — falling CVD + rising price = selling into FOMO */
    var cvd=analyzeCVD(c.s);
    if(cvd.divergence==='BEARISH'){sc+=18;sigs.push({n:lang==='ar'?'CVD هابط — بيع مخفي':'CVD Bearish — hidden selling',ic:'📊',col:'var(--dn)'})}
    /* Signal 3: Iceberg sells */
    var ice=detectIceberg(c.s);
    if(ice.icebergs&&ice.icebergs.some(function(x){return x.side==='SELL'})){sc+=12;sigs.push({n:lang==='ar'?'أوامر بيع مخفية':'Hidden sell orders',ic:'🧊',col:'var(--blue)'})}
    /* Signal 4: High Funding Rate = overcrowded longs = dump incoming */
    var fr=FR[c.s];
    if(fr&&fr.rate>0.08){sc+=10;sigs.push({n:'FR '+fr.rate.toFixed(3)+'% '+(lang==='ar'?'— خطر تصفية':'— liquidation risk'),ic:'⚠️',col:'var(--warn)'})}
    else if(fr&&fr.rate>0.05){sc+=5;sigs.push({n:'FR '+(lang==='ar'?'مرتفع':'elevated'),ic:'🟡',col:'var(--warn)'})}
    /* Signal 5: OI dropping = positions closing */
    var ww=whaleWaves[c.s];var eng=ww?ww.engine:null;
    if(eng&&eng.techniques&&eng.techniques.oiDelta){var oid=eng.techniques.oiDelta;var oiChg=parseFloat(oid.oiChange)||0;
      if(oiChg<-8){sc+=10;sigs.push({n:'OI '+oid.oiChange+' '+(lang==='ar'?'— إغلاق مراكز':'— closing positions'),ic:'📉',col:'var(--dn)'})}
      else if(oiChg<-3){sc+=5;sigs.push({n:'OI '+(lang==='ar'?'ينخفض':'declining'),ic:'📊',col:'var(--warn)'})}}
    /* Signal 6: Whale sell trades from L2 */
    if(eng&&eng.layers&&eng.layers.trades&&eng.layers.trades.whaleSells>0){sc+=12;sigs.push({n:eng.layers.trades.whaleSells+' '+(lang==='ar'?'صفقات بيع كبيرة':'large sell trades'),ic:'💰',col:'var(--dn)'})}
    /* Signal 7: Order book sell-heavy */
    if(eng&&eng.layers&&eng.layers.ob&&eng.layers.ob.ratio<0.7){sc+=8;sigs.push({n:'OB '+(lang==='ar'?'ضغط بيع':'sell pressure')+' '+eng.layers.ob.ratio.toFixed(1)+'x',ic:'📗',col:'var(--dn)'})}
    /* Signal 8: BTC divergence bearish */
    var btcDiv=detectBTCDivergence(c.s);
    if(btcDiv.signal==='WHALE_DISTRIBUTING'){sc+=8;sigs.push({n:lang==='ar'?'حوت يبيع — مستقل عن BTC':'Whale dumping — BTC independent',ic:'🎯',col:'var(--dn)'})}
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
function frRow(s,d){var cls=d.rate>0.05?'dn':d.rate<-0.01?'up':'warn';var w=Math.min(48,Math.abs(d.rate)*500);return'<div class="fr-row"><span class="fr-sym">'+s+'</span><div class="fr-bar"><div class="fr-mid"></div><div class="fr-fill" style="'+(d.rate>=0?'left':'right')+':50%;width:'+w+'%;background:var(--'+cls+')"></div></div><div><div class="fr-val" style="color:var(--'+cls+')">'+(d.rate>=0?'+':'')+d.rate.toFixed(4)+'%</div><div class="fr-sub-t">'+(d.rate>0.05?(lang==='ar'?'⚠️ خطر':'⚠️ Danger'):d.rate<-0.01?(lang==='ar'?'فرصة':'Opportunity'):(lang==='ar'?'طبيعي':'Normal'))+'</div></div></div>'}
/* DASHBOARD */
async function loadDash(){
  try{ await loadTk(); }catch(e){ console.error('loadTk:',e); }
  try{ initWS(); }catch(e){}
  try{ await loadFutures(); }catch(e){ console.error('loadFutures:',e); }
  try{ refreshTiers(); }catch(e){}
  try{ checkVolSpikes(); }catch(e){}
  try{ await loadTop4Ext(); }catch(e){}
  try{
  var fg=await fj('https://api.alternative.me/fng/?limit=1');if(fg&&fg.data){fgValue=+fg.data[0].value;var fgE=document.getElementById('fgV');if(fgE)fgE.textContent=fgValue;var fgLE=document.getElementById('fgL');if(fgLE)fgLE.textContent=fg.data[0].value_classification;var pFGE=document.getElementById('pFG');if(pFGE)pFGE.textContent=fgValue}
  }catch(e){}
  try{
  var gl=await fj(CG+'/global');if(gl&&gl.data){btcDom=gl.data.market_cap_percentage?gl.data.market_cap_percentage.btc:50;var btcDE=document.getElementById('btcD');if(btcDE)btcDE.textContent=btcDom.toFixed(1)+'%'}
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
  try{ await loadTakerVol(); }catch(e){}
  try{ renderDashLS(); }catch(e){ console.error('renderDashLS:',e); }
  try{ renderAcc('accCard'); }catch(e){}
  try{ renderTopCoins(); }catch(e){ console.error('renderTopCoins:',e); }
  try{ renderTop3(); }catch(e){ console.error('renderTop3:',e); }
  try{ checkWatchlistAlerts(); }catch(e){}
}
/* SCANNER PAGE — uses cache for instant switch */
async function runScan(){if(cache.scan&&Date.now()-cache.scanTime<CACHE_TTL){renderScanResults(cache.scan);setTimeout(async function(){var c=quickScan();cache.scan=await deepAnalyze(c);cache.scanTime=Date.now();renderScanResults(cache.scan)},100);return}var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();renderScanResults(r)}
function renderScanResults(results){var mode=(document.querySelector('#fltM .big-tab.act')||{dataset:{m:'ultra'}}).dataset.m;var f=results;if(mode==='ultra')f=results.filter(function(r){return r.ultra||r.confirmed});else if(mode==='brk')f=results.filter(function(r){return r.c>=3&&r.score>=40});else if(mode==='fr')f=results.filter(function(r){return r.fr!=null}).sort(function(a,b){return Math.abs(b.fr||0)-Math.abs(a.fr||0)});var t1c=f.filter(function(r){return getCoinTier(r.s)===1}).length;var t2c=f.filter(function(r){return getCoinTier(r.s)===2}).length;document.getElementById('scanI').textContent='📊 '+Object.keys(T).length+' '+(lang==='ar'?'عملة':'coins')+' → ✅ '+f.length+' (🏆'+t1c+' 🥈'+t2c+')';document.getElementById('scanR').innerHTML=f.length?f.slice(0,30).map(scanItem).join(''):'<div class="empty"><div class="empty-ic">📡</div><div class="empty-tx">'+t('no_data')+'</div></div>'}
/* WHALE PAGE */
async function loadWhales(){var c=quickScan();var r=await deepAnalyze(c);cache.scan=r;cache.scanTime=Date.now();await detectWhaleWaves(r);renderWhaleResults(r)}
function renderWhaleResults(results){var w=results.filter(function(x){return x.tags.some(function(t){return t.includes('ACC')||t.includes('STEALTH')||t.includes('EARLY')||t.includes('BOTTOM')})||(x.v>5e7&&Math.abs(x.c)<3)||(x.checks&&x.checks.ob&&x.v>1e7)||whaleWaves[x.s]}).slice(0,20);
  /* Sort by wave count (most waves first) */
  w.sort(function(a,b){var wa=whaleWaves[a.s]?whaleWaves[a.s].waves.length:0;var wb=whaleWaves[b.s]?whaleWaves[b.s].waves.length:0;return wb-wa||b.score-a.score});
  var totalBuy=w.reduce(function(s,x){var ww=whaleWaves[x.s];return s+(ww?ww.totalBuy:x.v*0.05)},0);
  document.getElementById('whT').textContent=fmt(totalBuy);document.getElementById('whB').textContent=fmt(w.filter(function(x){return x.c>0}).reduce(function(s,x){var ww=whaleWaves[x.s];return s+(ww?ww.totalBuy:x.v*0.05)},0));document.getElementById('whS').textContent=fmt(w.filter(function(x){return x.c<0}).reduce(function(s,x){var ww=whaleWaves[x.s];return s+(ww?ww.totalBuy:x.v*0.05)},0));document.getElementById('whAL').innerHTML=w.length?w.map(function(x,i){return whaleCard(x,i)}).join(''):'<div class="empty"><div class="empty-ic">🐋</div><div class="empty-tx">'+t('no_whale')+'</div></div>';renderAcc('whAccCard')}
/* INDICATORS PAGE */
async function loadInd(){loadFR()}
async function loadFR(){if(!Object.keys(FR).length)await loadFutures();document.getElementById('frList').innerHTML='<div class="muted">'+(lang==='ar'?'🔴 FR عالي = خطر | 🟢 FR سلبي = فرصة':'🔴 High FR = Risk | 🟢 Neg FR = Opportunity')+'</div>'+Object.entries(FR).filter(function(e){return WL.includes(e[0])}).sort(function(a,b){return Math.abs(b[1].rate)-Math.abs(a[1].rate)}).map(function(e){return frRow(e[0],e[1])}).join('')}
async function loadOI(){if(!Object.keys(OI).length)await loadFutures();document.getElementById('oiList').innerHTML='<div class="muted">'+(lang==='ar'?'📈 OI ↑ = حركة حقيقية':'📈 OI ↑ = Real move')+'</div>'+Object.entries(OI).sort(function(a,b){return b[1]-a[1]}).map(function(e){var s=e[0],v=e[1],d=T[s];return'<div class="fr-row"><span class="fr-sym">'+s+'</span><span style="font-family:var(--fm);font-size:11px;color:var(--neon);font-weight:700">'+fmt(v)+'</span><span class="cr-ch '+(d&&d.c>=0?'up':'dn')+'">'+(d?(d.c>=0?'+':'')+d.c.toFixed(1)+'%':'--')+'</span></div>'}).join('')}
async function loadCor(){var coins=['BTC','ETH','SOL','BNB','XRP','LINK','DOGE','ADA'];var prices={};var proms=coins.map(function(s){return fj(BN+'/klines?symbol='+s+'USDT&interval=1d&limit=14').then(function(kl){if(kl)prices[s]=kl.map(function(k){return+k[4]})}).catch(function(){})});await Promise.all(proms);function corr(a,b){var n=Math.min(a.length,b.length);var ma=a.slice(-n).reduce(function(s,v){return s+v},0)/n,mb=b.slice(-n).reduce(function(s,v){return s+v},0)/n;var num=0,da=0,db=0;for(var i=0;i<n;i++){var x=a[a.length-n+i]-ma,y=b[b.length-n+i]-mb;num+=x*y;da+=x*x;db+=y*y}return da&&db?num/Math.sqrt(da*db):0}var h='<div class="muted">🔗 Correlation (14D)</div><div style="display:grid;grid-template-columns:auto repeat('+coins.length+',1fr);gap:2px;font-size:8px;font-family:var(--fm)"><div></div>';coins.forEach(function(s){h+='<div style="text-align:center;font-weight:700">'+s+'</div>'});coins.forEach(function(a){h+='<div style="font-weight:700">'+a+'</div>';coins.forEach(function(b){if(!prices[a]||!prices[b]){h+='<div style="text-align:center">--</div>';return}var c=a===b?1:corr(prices[a],prices[b]);h+='<div style="text-align:center;padding:3px;border-radius:3px;background:'+(c>.7?'var(--ud)':c<-.3?'var(--dd)':'transparent')+';color:'+(c>.5?'var(--up)':c<-.3?'var(--dn)':'var(--t2)')+';font-weight:700">'+c.toFixed(2)+'</div>'})});h+='</div>';document.getElementById('corGrid').innerHTML=h}
/* COIN DETAIL */
async function openCoin(sym){curCoin=sym;curTF='1h';document.getElementById('sRes').classList.remove('show');document.getElementById('sInp').value='';var d=T[sym]||{p:0,c:0,v:0,h:0,l:0};document.getElementById('cmT').textContent=sym+'/USDT';document.getElementById('cmP').textContent=fP(d.p);document.getElementById('cmC').style.color=d.c>=0?'var(--up)':'var(--dn)';document.getElementById('cmC').textContent=(d.c>=0?'+':'')+d.c.toFixed(2)+'%';document.getElementById('cmSts').innerHTML='<div class="st"><div class="st-l">VOL</div><div class="st-v" style="color:var(--neon)">'+fmt(d.v)+'</div></div><div class="st"><div class="st-l">HIGH</div><div class="st-v" style="color:var(--up)">'+fP(d.h)+'</div></div><div class="st"><div class="st-l">LOW</div><div class="st-v" style="color:var(--dn)">'+fP(d.l)+'</div></div>';var ex='';var fr=FR[sym];if(fr)ex+='<div class="fr-row" style="margin-top:6px"><span>📊 FR</span><span class="fr-val" style="color:'+(fr.rate>0.05?'var(--dn)':fr.rate<-0.01?'var(--up)':'var(--warn)')+'">'+(fr.rate>=0?'+':'')+fr.rate.toFixed(4)+'%</span></div>';if(OI[sym])ex+='<div class="fr-row"><span>📈 OI</span><span class="fr-val" style="color:var(--neon)">'+fmt(OI[sym])+'</span></div>';if(LS[sym])ex+='<div class="fr-row"><span>⚖️ L/S</span><span class="fr-val">'+LS[sym].long.toFixed(0)+'%/'+LS[sym].short.toFixed(0)+'%</span></div>';if(d.by)ex+='<div class="fr-row"><span>Bybit</span><span class="fr-val">'+fP(d.by)+'</span></div>';if(CBP[sym])ex+='<div class="fr-row"><span>Coinbase</span><span class="fr-val">'+fP(CBP[sym])+'</span></div>';document.getElementById('cmExtra').innerHTML=ex;openMo('coinMo');document.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act');if(b.dataset.t2==='1h')b.classList.add('act')});drawChart(sym,'1h')}
function cTF(tf,btn){curTF=tf;document.querySelectorAll('.chart-tf').forEach(function(b){b.classList.remove('act')});btn.classList.add('act');drawChart(curCoin,tf)}
function tgI(ind,btn){inds[ind]=inds[ind]?0:1;btn.classList.toggle('act');drawChart(curCoin,curTF)}
var chartData=null,chartCtx=null,chartW=0,crosshair={active:false,x:0,y:0};
var chartOffset=0,visibleCandles=80,chartCv=null,lastPinchDist=0,touchStartX=0,isDragging=false;
function getChartH(){return Math.max(300,Math.min(450,window.innerHeight*0.45))}
function px(v){return Math.round(v)+0.5}
async function drawChart(sym,tf){
  var cv=document.getElementById('chCv');chartCv=cv;var ctx=cv.getContext('2d');chartCtx=ctx;
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
  /* GRID */
  ctx.textAlign='right';for(var i=0;i<=5;i++){var y=14+ch/5*i;var price=maxP-range/5*i;ctx.strokeStyle='rgba(56,72,96,.1)';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W-priceW,y);ctx.stroke();ctx.fillStyle='#6e82a0';ctx.font='8px Geist Mono';ctx.fillText(fP(price),W-2,y+3)}
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
  /* CANDLES — sharp rendering */
  var bw=Math.max(3,cw*0.7);var wickW=Math.max(1.5,Math.min(2.5,bw*0.2));
  data.forEach(function(d,i){var x=2+i*cw+cw/2,up=d.c>=d.o;var col=up?upC:dnC;var top=yS(Math.max(d.o,d.c)),bot=yS(Math.min(d.o,d.c));var bodyH=bot-top;var isDoji=Math.abs(d.c-d.o)/Math.max(d.h-d.l,0.0001)<0.1;
    ctx.strokeStyle=col;ctx.lineWidth=wickW;ctx.beginPath();ctx.moveTo(x,yS(d.h));ctx.lineTo(x,yS(d.l));ctx.stroke();
    if(isDoji){var dy=yS((d.o+d.c)/2);ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x-bw/2,dy);ctx.lineTo(x+bw/2,dy);ctx.stroke()}
    else if(up){ctx.fillStyle=bgFill;ctx.fillRect(x-bw/2,top,bw,Math.max(2,bodyH));ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.strokeRect(x-bw/2,top,bw,Math.max(2,bodyH))}
    else{ctx.fillStyle=col;ctx.fillRect(x-bw/2,top,bw,Math.max(2,bodyH))}
    if(i===data.length-1){ctx.shadowColor=col;ctx.shadowBlur=6;ctx.fillRect(x-bw/2-1,top-1,bw+2,Math.max(4,bodyH+2));ctx.shadowBlur=0}});
  /* PATTERNS */
  if(inds.pat){for(var i=2;i<data.length;i++){var c=data[i],p=data[i-1],pp=data[i-2];var body=Math.abs(c.c-c.o);var rng=c.h-c.l;var lw=Math.min(c.c,c.o)-c.l;var uw=c.h-Math.max(c.c,c.o);var isUp=c.c>c.o;var pB=Math.abs(p.c-p.o);var x=2+i*cw+cw/2;
    if(lw>=body*2&&uw<body*.5&&rng>0&&p.c<pp.c){ctx.font='9px serif';ctx.textAlign='center';ctx.fillText('🔨',x,yS(c.l)+14)}
    if(uw>=body*2&&lw<body*.5&&rng>0&&p.c>pp.c){ctx.fillText('🌠',x,yS(c.h)-10)}
    if(isUp&&p.c<p.o&&c.o<=p.c&&c.c>=p.o&&body>pB*1.2){ctx.fillText('🟢',x,yS(c.l)+14)}
    if(!isUp&&p.c>p.o&&c.o>=p.c&&c.c<=p.o&&body>pB*1.2){ctx.fillText('🔴',x,yS(c.h)-10)}}}
  /* CURRENT PRICE LINE */
  var lastP=data[data.length-1].c;var lastUp=data[data.length-1].c>=data[data.length-1].o;var cpY=yS(lastP);
  ctx.strokeStyle=lastUp?upCa+'.4)':dnCa+'.4)';ctx.lineWidth=.8;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(0,cpY);ctx.lineTo(W-priceW,cpY);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=lastUp?upC:dnC;var lbW=50,lbH=15;ctx.fillRect(W-priceW-1,cpY-lbH/2,lbW,lbH);ctx.fillStyle='#000';ctx.font='bold 8px Geist Mono';ctx.textAlign='center';ctx.fillText(fP(lastP),W-priceW+lbW/2-1,cpY+3);ctx.textAlign='right';
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

/* HEATMAP */
async function loadHM(){if(!Object.keys(T).length)await loadTk();document.getElementById('hmG').innerHTML=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v}).slice(0,30).map(function(e){var s=e[0],d=e[1],ch=d.c;var bg=ch>10?'rgba(0,255,136,.75)':ch>5?'rgba(0,255,136,.5)':ch>2?'rgba(0,255,136,.3)':ch>0?'rgba(0,255,136,.15)':ch>-2?'rgba(255,56,96,.15)':ch>-5?'rgba(255,56,96,.3)':ch>-10?'rgba(255,56,96,.5)':'rgba(255,56,96,.75)';return'<div class="hm-c" style="background:'+bg+'" onclick="openCoin(\''+s+'\')"><div class="hm-s">'+s+'</div><div class="hm-ch">'+(ch>=0?'+':'')+ch.toFixed(1)+'%</div></div>'}).join('')}
/* LIQUIDITY + ORDER BOOK */
async function loadLiq(){if(!Object.keys(T).length)await loadTk();document.getElementById('liqL').innerHTML=Object.entries(T).sort(function(a,b){return b[1].v-a[1].v}).slice(0,12).map(function(e,i){return coinRow(e[0],e[1],i+1)}).join('');var h='';var syms=['BTC','ETH','SOL','BNB','XRP'];var proms=syms.map(function(s){return fj(BN+'/depth?symbol='+s+'USDT&limit=10')});var obs=await Promise.all(proms);syms.forEach(function(s,si){var ob=obs[si];if(!ob)return;var bids=ob.bids.map(function(b){return+b[0]*+b[1]}),asks=ob.asks.map(function(a){return+a[0]*+a[1]});var bT=bids.reduce(function(a,b){return a+b},0),aT=asks.reduce(function(a,b){return a+b},0);var r=aT>0?bT/aT:1;var mx=Math.max.apply(null,bids.concat(asks));h+='<div class="cd" style="padding:8px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-weight:700;font-family:var(--fd)">'+s+'</span><span style="font-size:9px;font-family:var(--fm);color:var(--'+(r>1.3?'up':r<.7?'dn':'warn')+')">'+(r>1.3?'BUY':r<.7?'SELL':'NEUTRAL')+' '+r.toFixed(2)+'x</span></div><div class="ob-v">'+bids.reverse().map(function(v){return'<div class="ob-b bid" style="height:'+Math.max(3,v/mx*100)+'%"></div>'}).join('')+'<div style="width:1px;background:var(--t3);height:100%"></div>'+asks.map(function(v){return'<div class="ob-b ask" style="height:'+Math.max(3,v/mx*100)+'%"></div>'}).join('')+'</div></div>'});document.getElementById('obS').innerHTML=h}
/* GEM FINDER — small caps with unusual activity */
async function loadGems(){
  if(!Object.keys(T).length)await loadTk();
  document.getElementById('gemL').innerHTML='<div class="ldr"><div class="ldr-d"></div><div class="ldr-d"></div><div class="ldr-d"></div></div>';
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
      if(T[s].c>0&&T[s].c<3)gemScore+=20; /* small positive = accumulating */
      else if(T[s].c>=3&&T[s].c<8)gemScore+=10;
      if(gemScore>=25)gemResults.push({s:s,p:T[s].p,c:T[s].c,v:T[s].v,volX:volMultiple,gainSinceSpike:gainSinceSpike,spikeTime:spikeStartTime,timing:timing,timingCls:timingCls,timingLabel:timingLabel,score:gemScore,priceAtSpike:priceAtSpike})
    }).catch(function(){})});
  await Promise.all(proms);
  /* Sort: early + high volume first */
  gemResults.sort(function(a,b){return b.score-a.score});
  /* Render */
  document.getElementById('gemL').innerHTML=gemResults.length?gemResults.map(function(g){
    /* Notify only for EARLY gems with high volume */
    if(g.timing==='early'&&g.volX>=2)notify(g.s,'gem',g.score);
    var src=[];if(T[g.s])src.push('Binance');if(T[g.s].by)src.push('Bybit');if(CBP[g.s])src.push('Coinbase');
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
function addWL(){var sym=document.getElementById('wlInp').value.toUpperCase().trim();if(!sym||watchlist.includes(sym))return;watchlist.push(sym);localStorage.setItem('nxwl10',JSON.stringify(watchlist));document.getElementById('wlInp').value='';renderWL()}
function rmWL(i){watchlist.splice(i,1);localStorage.setItem('nxwl10',JSON.stringify(watchlist));renderWL()}
function renderWL(){document.getElementById('wlList').innerHTML=watchlist.length?watchlist.map(function(sym,i){var d=T[sym];if(!d)return'<div class="fr-row"><span class="fr-sym">'+sym+'</span><span style="color:var(--t3);font-size:10px">'+(lang==='ar'?'غير متوفر':'Not found')+'</span><span style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmWL('+i+')">🗑</span></div>';
    return coinRow(sym,d,undefined)+'<div style="text-align:left;margin:-3px 0 5px"><span style="font-size:7px;color:var(--t3);cursor:pointer;padding:2px 6px" onclick="rmWL('+i+')">🗑 '+(lang==='ar'?'إزالة':'Remove')+'</span></div>'}).join(''):'<div class="empty"><div class="empty-ic">👁</div><div class="empty-tx">'+(lang==='ar'?'أضف عملات للمراقبة':'Add coins to watch')+'</div></div>'}
/* 📊 MARKET DIRECTION REPORT — Parallel + Error-Safe */
/* ═══ MARKET REPORT v2.0 ═══ */
function calcEMA(arr,p){if(!arr||arr.length<p)return arr?arr[arr.length-1]:0;var k=2/(p+1),e=arr[0];for(var i=1;i<arr.length;i++)e=arr[i]*k+e*(1-k);return e}
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

function buildStory(coin,data){var tpls=lang==='ar'?MKT_TPL:MKT_TPL_EN;var cat=data.ts>=4?'bull_strong':data.ts>=2?'bull_mild':data.ts<=-4?'bear_strong':data.ts<=-2?'bear_mild':'neutral';
  var pool=tpls[cat];var tmpl=pool[Math.floor(Date.now()/3600000)%pool.length];
  var cn=lang==='ar'?(coin==='BTC'?'البيتكوين':coin==='ETH'?'الإيثيريوم':coin==='SOL'?'سولانا':coin):coin;
  return tmpl.replace('{coin}',cn).replace('{reason1}',data.reasons[0]||'').replace('{reason2}',data.reasons[1]||'').replace('{ema}',rP(data.ema20)).replace('{support}',rP(data.supp)).replace('{resistance}',rP(data.resist)).replace('{target}',rP(data.f618U)).replace('{entry}',rP(data.price*0.99)).replace('{stop}',rP(data.supp)).replace('{volStatus}',data.volT>1.3?(lang==='ar'?'قوي':'strong'):(lang==='ar'?'ضعيف':'weak')).replace('{warning}',data.warning||'')}

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
  var ts=0;if(price>ema20)ts+=2;else ts-=2;if(price>ema50)ts+=2;else ts-=2;if(ema20>ema50)ts++;else ts--;if(macd.h>0)ts+=2;else ts-=2;if(macd.cross==='bull')ts+=2;if(macd.cross==='bear')ts-=2;if(rsi>55)ts++;else if(rsi<45)ts--;if(volT>1.3)ts++;
  var fr=FR[sym];if(fr){if(fr.rate<0)ts++;if(fr.rate>0.05)ts--}
  var ls=LS[sym];if(ls){if(ls.ratio>1.5)ts--;if(ls.ratio<0.8)ts++}
  var ww=whaleWaves[sym];var wConf=ww&&ww.engine?ww.engine.confidence:0;if(wConf>=50)ts++;
  var cvd=analyzeCVD(sym);
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
  /* Score (9 factors — dynamic weights) */
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
  var rec,recIc;if(ts>=4){rec=lang==='ar'?'💰 شراء قوي — وقف '+fP(f618D):'💰 Strong Buy — Stop '+fP(f618D);recIc='💰'}else if(ts>=2){rec=lang==='ar'?'📈 شراء — دخول تدريجي':'📈 Buy — Scale in';recIc='📈'}else if(ts<=-4){rec=lang==='ar'?'⛔ تجنب — هبوط قوي':'⛔ Avoid';recIc='⛔'}else if(ts<=-2){rec=lang==='ar'?'⚠️ حذر — انتظر':'⚠️ Caution — Wait';recIc='⚠️'}else{rec=lang==='ar'?'⏳ انتظار — محايد':'⏳ Wait';recIc='⏳'}
  /* Liquidation zones */
  var liqZones=[];if(typeof liqEvents!=='undefined'&&liqEvents&&liqEvents.length){var sL=liqEvents.filter(function(e){return e.s===sym||e.s===sym+'USDT'});
    var longL=sL.filter(function(e){return e.S==='SELL'}).reduce(function(s,e){return s+(e.q||0)*(e.p||0)},0);
    var shortL=sL.filter(function(e){return e.S==='BUY'}).reduce(function(s,e){return s+(e.q||0)*(e.p||0)},0);
    if(longL>0)liqZones.push({side:'Long',amt:longL});if(shortL>0)liqZones.push({side:'Short',amt:shortL})}
  return{sym:sym,price:price,d:d,ts:ts,dir:dir,dCol:dCol,dIc:dIc,rsi:rsi,rsi1d:rsi1d,macd:macd,macd1d:macd1d,ema20:ema20,ema50:ema50,volT:volT,resist:resist,supp:supp,f618U:f618U,f100U:f100U,f618D:f618D,fr:fr,ls:ls,oi:OI[sym],wConf:wConf,cvd:cvd,tf:{h1:tf1h,h4:tf4h,d:tf1d,w:tfW},bullTFs:bullTFs,ch:{h1:ch1h,h4:ch4h,h24:ch24,d7:ch7d},divRSI:divRSI,divRSI1d:divRSI1d,reasons:reasons,warning:warning,bullP:bullP,bearP:bearP,neutP:neutP,bullCond:bullCond,bearCond:bearCond,bullInv:bullInv,bearInv:bearInv,sc:+sc.toFixed(1),scB:scB,rec:rec,recIc:recIc,struct:struct,bos:bos,choch:choch,riskPct:riskPct,orderBlocks:orderBlocks,fvgs:fvgs,histMatch:histMatch,liqZones:liqZones,kl4h:kl4h,kl1d:kl1d,kl1h:kl1h}}

/* ═══ buildChartHTML — 12 Professional Analysis Sections ═══ */
function buildChartHTML(data, coinColor, coinIcon, coinName){
  if(!data) return '<div class="empty"><div class="empty-ic">\u{1F4CA}</div><div class="empty-tx">'+(lang==='ar'?'\u0644\u0627 \u0628\u064a\u0627\u0646\u0627\u062a':'No data')+'</div></div>';
  var h='';
  var cn=lang==='ar'?coinName.ar:coinName.en;
  var sym=data.sym;

  /* ════ Section 1: Hero Header ════ */
  var heroBg=data.ts>=2?'rgba(0,255,136,.04)':data.ts<=-2?'rgba(255,56,96,.04)':'rgba(255,184,0,.04)';
  var heroBdr=data.ts>=2?'rgba(0,255,136,.08)':data.ts<=-2?'rgba(255,56,96,.08)':'rgba(255,184,0,.08)';
  h+='<div class="mkt-hero" style="background:'+heroBg+';border:1px solid '+heroBdr+'">';
  h+='<div style="font-size:32px;color:'+coinColor+'">'+coinIcon+'</div>';
  h+='<div style="font-size:14px;font-weight:800;color:var(--t0);margin:4px 0">'+cn+' <span style="color:var(--t2);font-size:10px">'+sym+'/USDT</span></div>';
  h+='<div class="mkt-hero-price" style="direction:ltr">'+rP(data.price)+'</div>';
  h+='<div class="mkt-hero-ch" style="color:'+(data.ch.h24>=0?'var(--up)':'var(--dn)')+';direction:ltr">'+(data.ch.h24>=0?'+':'')+data.ch.h24.toFixed(1)+'% (24h)</div>';
  h+='<div class="mkt-hero-meta">'+(lang==='ar'?'\u0641\u0631\u064a\u0645: 4H \u2014 Binance':'Frame: 4H \u2014 Binance')+'</div>';
  var nxt=new Date();nxt.setHours(nxt.getHours()+(4-(nxt.getUTCHours()%4)),0,0,0);
  h+='<div class="mkt-hero-meta">'+(lang==='ar'?'\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b: ':'Updated: ')+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+' \u2014 '+(lang==='ar'?'\u0627\u0644\u0642\u0627\u062f\u0645: ':'Next: ')+nxt.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+'</div>';
  h+='</div>';

  /* ════ Section 2: Candle Closings Grid (4H, D, W, M) ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F56F}\uFE0F '+(lang==='ar'?'\u0625\u063a\u0644\u0627\u0642\u0627\u062a \u0627\u0644\u0634\u0645\u0648\u0639':'Candle Closings')+'</div>';
  var frames=[];
  /* 4H candle */
  if(data.kl4h&&data.kl4h.length>=2){
    var k=data.kl4h[data.kl4h.length-1];
    frames.push({tf:'4H',o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]});
  }
  /* Daily candle */
  if(data.kl1d&&data.kl1d.length>=2){
    var k2=data.kl1d[data.kl1d.length-1];
    frames.push({tf:'D',o:+k2[1],h:+k2[2],l:+k2[3],c:+k2[4],v:+k2[5]});
  }
  /* Weekly: last 7 daily candles aggregated */
  if(data.kl1d&&data.kl1d.length>=7){
    var wSlice=data.kl1d.slice(-7);
    var wO=+wSlice[0][1],wH=0,wL=999999999,wC=+wSlice[wSlice.length-1][4],wV=0;
    for(var wi=0;wi<wSlice.length;wi++){if(+wSlice[wi][2]>wH)wH=+wSlice[wi][2];if(+wSlice[wi][3]<wL)wL=+wSlice[wi][3];wV+=+wSlice[wi][5]}
    frames.push({tf:'W',o:wO,h:wH,l:wL,c:wC,v:wV});
  }
  /* Monthly: last 30 daily candles */
  if(data.kl1d&&data.kl1d.length>=20){
    var mSlice=data.kl1d.slice(-30);
    var mO=+mSlice[0][1],mH=0,mL=999999999,mC=+mSlice[mSlice.length-1][4],mV=0;
    for(var mi=0;mi<mSlice.length;mi++){if(+mSlice[mi][2]>mH)mH=+mSlice[mi][2];if(+mSlice[mi][3]<mL)mL=+mSlice[mi][3];mV+=+mSlice[mi][5]}
    frames.push({tf:'M',o:mO,h:mH,l:mL,c:mC,v:mV});
  }
  /* Badge */
  var posCount=0;
  frames.forEach(function(f){if(f.c>=f.o)posCount++});
  var bdgCol=posCount>=3?'var(--up)':posCount<=1?'var(--dn)':'var(--warn)';
  var bdgBg=posCount>=3?'rgba(0,255,136,.08)':posCount<=1?'rgba(255,56,96,.08)':'rgba(255,184,0,.08)';
  h+='<div class="mkt-badge" style="background:'+bdgBg+';color:'+bdgCol+'">'+posCount+'/'+frames.length+' '+(lang==='ar'?'\u0625\u064a\u062c\u0627\u0628\u064a':'Positive')+'</div>';
  h+='<div class="mkt-candles">';
  frames.forEach(function(f){
    var up=f.c>=f.o;var cls=up?'up':'dn';
    var pat=detectCandlePattern(f.o,f.h,f.l,f.c);
    var patName=CANDLE_NAMES[lang==='ar'?'ar':'en'][pat]||pat;
    h+='<div class="mkt-candle '+cls+'">';
    h+='<div class="mkt-candle-tf">'+f.tf+'</div>';
    h+='<div class="mkt-candle-ic">'+(up?'\u{1F7E2}':'\u{1F534}')+'</div>';
    h+='<div class="mkt-candle-state" style="color:'+(up?'var(--up)':'var(--dn)')+'">'+(up?(lang==='ar'?'\u0625\u064a\u062c\u0627\u0628\u064a':'Bullish'):(lang==='ar'?'\u0633\u0644\u0628\u064a':'Bearish'))+'</div>';
    h+='<div class="mkt-candle-close" style="direction:ltr">'+rP(f.c)+'</div>';
    h+='<div class="mkt-candle-pat">'+patName+'</div>';
    h+='</div>';
  });
  h+='</div></div>';

  /* ════ Section 3: Detailed Candle Explanations ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F4D6} '+(lang==='ar'?'\u0634\u0631\u062d \u0645\u0641\u0635\u0651\u0644 \u0644\u0644\u0625\u063a\u0644\u0627\u0642\u0627\u062a':'Detailed Closing Analysis')+'</div>';
  frames.forEach(function(f){
    var up=f.c>=f.o;var pat=detectCandlePattern(f.o,f.h,f.l,f.c);
    var patName=CANDLE_NAMES[lang==='ar'?'ar':'en'][pat]||pat;
    h+='<div class="mkt-box"><div class="mkt-box-t">'+(up?'\u{1F7E2}':'\u{1F534}')+' '+(lang==='ar'?'\u0625\u063a\u0644\u0627\u0642 '+f.tf:'Close '+f.tf)+'</div>';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u0627\u0641\u062a\u062a\u0627\u062d':'Open')+'</span><span class="mkt-row-val" style="direction:ltr">'+rP(f.o)+'</span></div>';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u0625\u063a\u0644\u0627\u0642':'Close')+'</span><span class="mkt-row-val" style="direction:ltr;color:'+(up?'var(--up)':'var(--dn)')+'">'+rP(f.c)+'</span></div>';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u0623\u0639\u0644\u0649':'High')+'</span><span class="mkt-row-val" style="direction:ltr">'+rP(f.h)+'</span></div>';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u0623\u062f\u0646\u0649':'Low')+'</span><span class="mkt-row-val" style="direction:ltr">'+rP(f.l)+'</span></div>';
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u062d\u062c\u0645':'Volume')+'</span><span class="mkt-row-val" style="direction:ltr">'+fmt(f.v)+'</span></div>';
    /* Assessment */
    var assess='';
    if(pat==='bull_engulf'||pat==='hammer')assess=lang==='ar'?'\u2705 '+patName+' \u0645\u0639 \u062d\u062c\u0645 \u0639\u0627\u0644\u064a \u2014 \u064a\u062f\u0639\u0645 \u0627\u0644\u0635\u0639\u0648\u062f':'\u2705 '+patName+' with volume \u2014 supports upside';
    else if(pat==='bear_engulf'||pat==='shooting')assess=lang==='ar'?'\u26a0\ufe0f '+patName+' \u2014 \u0625\u0634\u0627\u0631\u0629 \u0636\u063a\u0637 \u0628\u064a\u0639\u064a':'\u26a0\ufe0f '+patName+' \u2014 selling pressure signal';
    else if(pat==='doji')assess=lang==='ar'?'\u{1F7E1} '+patName+' \u2014 \u062a\u0631\u062f\u062f \u0628\u0627\u0644\u0633\u0648\u0642':'\u{1F7E1} '+patName+' \u2014 market indecision';
    else if(up)assess=lang==='ar'?'\u2705 \u0634\u0645\u0639\u0629 \u0625\u064a\u062c\u0627\u0628\u064a\u0629 \u2014 '+(f.v>0?'\u062d\u062c\u0645 \u0637\u0628\u064a\u0639\u064a':''):'\u2705 Positive candle \u2014 '+(f.v>0?'normal volume':'');
    else assess=lang==='ar'?'\u{1F534} \u0634\u0645\u0639\u0629 \u0633\u0644\u0628\u064a\u0629 \u2014 \u0636\u063a\u0637 \u0628\u064a\u0639\u064a':'\u{1F534} Negative candle \u2014 sell pressure';
    if(assess)h+='<div class="mkt-assess">'+assess+'</div>';
    h+='</div>';
  });
  h+='</div>';

  /* ════ Section 4: Timeframe Confluence ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F504} '+(lang==='ar'?'\u062a\u0648\u0627\u0641\u0642 \u0627\u0644\u0641\u0631\u064a\u0645\u0627\u062a':'Timeframe Confluence')+'</div>';
  var tfData=[
    {n:'1H',d:data.tf.h1},{n:'4H',d:data.tf.h4},{n:'D',d:data.tf.d},{n:'7D',d:data.tf.w}
  ];
  h+='<div class="mkt-candles">';
  tfData.forEach(function(tf){
    var ic=tf.d==='up'?'\u{1F4C8}':tf.d==='down'?'\u{1F4C9}':'\u2194\uFE0F';
    var col=tf.d==='up'?'var(--up)':tf.d==='down'?'var(--dn)':'var(--warn)';
    var cls=tf.d==='up'?'up':tf.d==='down'?'dn':'nt';
    var reason='';
    if(tf.n==='1H')reason=tf.d==='up'?(lang==='ar'?'\u0641\u0648\u0642 EMA20':'Above EMA20'):(lang==='ar'?'\u062a\u062d\u062a EMA20':'Below EMA20');
    else if(tf.n==='4H')reason=tf.d==='up'?(lang==='ar'?'MACD+ \u0648\u0641\u0648\u0642 EMA':'MACD+ & above EMA'):(lang==='ar'?'MACD- \u0623\u0648 \u062a\u062d\u062a EMA':'MACD- or below EMA');
    else if(tf.n==='D')reason=tf.d==='up'?(lang==='ar'?'\u0641\u0648\u0642 EMA \u0627\u0644\u064a\u0648\u0645\u064a':'Above daily EMA'):(lang==='ar'?'\u062a\u062d\u062a EMA \u0627\u0644\u064a\u0648\u0645\u064a':'Below daily EMA');
    else reason=tf.d==='up'?(lang==='ar'?'\u0625\u063a\u0644\u0627\u0642 \u0641\u0648\u0642 7 \u0623\u064a\u0627\u0645':'Close above 7d ago'):(lang==='ar'?'\u0625\u063a\u0644\u0627\u0642 \u062a\u062d\u062a 7 \u0623\u064a\u0627\u0645':'Close below 7d ago');
    h+='<div class="mkt-candle '+cls+'" style="padding:6px 3px">';
    h+='<div class="mkt-candle-tf">'+tf.n+'</div>';
    h+='<div style="font-size:16px;margin:2px 0">'+ic+'</div>';
    h+='<div style="font-size:7px;color:'+col+';font-weight:700">'+(tf.d==='up'?(lang==='ar'?'\u0635\u0627\u0639\u062f':'Bull'):tf.d==='down'?(lang==='ar'?'\u0647\u0627\u0628\u0637':'Bear'):(lang==='ar'?'\u0645\u062d\u0627\u064a\u062f':'Flat'))+'</div>';
    h+='<div style="font-size:6px;color:var(--t3);margin-top:1px">'+reason+'</div>';
    h+='</div>';
  });
  h+='</div>';
  var confCol=data.bullTFs>=3?'var(--up)':data.bullTFs<=1?'var(--dn)':'var(--warn)';
  h+='<div style="text-align:center;padding:5px;border-radius:6px;margin-bottom:8px;font-size:10px;font-weight:700;background:'+(data.bullTFs>=3?'rgba(0,255,136,.04)':data.bullTFs<=1?'rgba(255,56,96,.04)':'rgba(255,184,0,.04)')+';color:'+confCol+'">'+(lang==='ar'?'\u062a\u0648\u0627\u0641\u0642: ':'Confluence: ')+data.bullTFs+'/4 '+(data.bullTFs>=3?(lang==='ar'?'\u0635\u0627\u0639\u062f\u0629 = \u062a\u0648\u0627\u0641\u0642 \u0642\u0648\u064a':'Bullish = Strong'):data.bullTFs<=1?(lang==='ar'?'\u0647\u0627\u0628\u0637\u0629':'Bearish'):(lang==='ar'?'\u0645\u062e\u062a\u0644\u0637\u0629':'Mixed'))+'</div>';
  h+='</div>';

  /* ════ Section 5: Market Structure (SMC) ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F3D7}\uFE0F '+(lang==='ar'?'\u0647\u064a\u0643\u0644 \u0627\u0644\u0633\u0648\u0642 (SMC)':'Market Structure (SMC)')+'</div>';
  var stCol=data.struct==='HH/HL'?'var(--up)':data.struct==='LH/LL'?'var(--dn)':'var(--warn)';
  h+='<div class="mkt-box">';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u0627\u0644\u0646\u0645\u0637':'Pattern')+'</span><span class="mkt-row-val" style="font-weight:800;color:'+stCol+'">'+data.struct+'</span></div>';
  if(data.bos)h+='<div class="mkt-row"><span class="mkt-row-label">BOS</span><span class="mkt-row-val" style="direction:ltr;color:var(--blue)">'+data.bos+'</span></div>';
  if(data.choch)h+='<div class="mkt-row"><span class="mkt-row-label">ChoCH</span><span class="mkt-row-val" style="direction:ltr;color:var(--purple)">'+data.choch+'</span></div>';
  h+='</div></div>';

  /* ════ Section 6: Order Blocks + FVG ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F4E6} '+(lang==='ar'?'Order Blocks + FVG':'Order Blocks + FVG')+'</div>';
  if(data.orderBlocks&&data.orderBlocks.length){
    h+='<div class="mkt-box"><div class="mkt-box-t">'+(lang==='ar'?'Order Blocks':'Order Blocks')+'</div>';
    data.orderBlocks.forEach(function(ob){
      var obUp=ob.type==='bullish';
      h+='<div class="mkt-row"><span class="mkt-row-label">'+(obUp?'\u{1F7E2}':'\u{1F534}')+' '+(obUp?(lang==='ar'?'\u0635\u0639\u0648\u062f\u064a':'Bullish'):(lang==='ar'?'\u0647\u0628\u0648\u0637\u064a':'Bearish'))+'</span><span class="mkt-row-val" style="direction:ltr;color:'+(obUp?'var(--up)':'var(--dn)')+'">'+ob.price+'</span></div>';
    });
    h+='</div>';
  }
  if(data.fvgs&&data.fvgs.length){
    h+='<div class="mkt-box"><div class="mkt-box-t">FVG (Fair Value Gaps)</div>';
    data.fvgs.forEach(function(fg){
      var fgUp=fg.type==='bullish';
      h+='<div class="mkt-row"><span class="mkt-row-label">'+(fgUp?'\u{1F7E2}':'\u{1F534}')+' '+(fgUp?(lang==='ar'?'\u0635\u0639\u0648\u062f\u064a':'Bullish'):(lang==='ar'?'\u0647\u0628\u0648\u0637\u064a':'Bearish'))+'</span><span class="mkt-row-val" style="direction:ltr">'+fg.bot+' \u2014 '+fg.top+'</span></div>';
    });
    h+='</div>';
  }
  if((!data.orderBlocks||!data.orderBlocks.length)&&(!data.fvgs||!data.fvgs.length)){
    h+='<div class="mkt-box" style="text-align:center;color:var(--t3);font-size:10px">'+(lang==='ar'?'\u0644\u0627 OB / FVG \u062d\u0627\u0644\u064a\u0627\u064b':'No active OB / FVG')+'</div>';
  }
  h+='</div>';

  /* ════ Section 7: Key Levels Map (descending) ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F5FA}\uFE0F '+(lang==='ar'?'\u0627\u0644\u0645\u0633\u062a\u0648\u064a\u0627\u062a \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629':'Key Levels')+'</div>';
  h+='<div class="mkt-box">';
  /* Sorted descending: R2 > R1 > Price > S1 > S2 */
  var levels=[];
  levels.push({tag:'R2',label:lang==='ar'?'\u0645\u0642\u0627\u0648\u0645\u0629 \u0631\u0626\u064a\u0633\u064a\u0629':'Major Resistance',price:data.f100U,col:'var(--dn)'});
  levels.push({tag:'R1',label:lang==='ar'?'\u0645\u0642\u0627\u0648\u0645\u0629 / \u0645\u0646\u0637\u0642\u0629 \u0639\u0631\u0636':'Resistance / Supply',price:data.resist,col:'var(--dn)'});
  levels.push({tag:'\u25B6',label:lang==='ar'?'\u0627\u0644\u0633\u0639\u0631 \u0627\u0644\u062d\u0627\u0644\u064a':'Current Price',price:data.price,col:'var(--blue)',highlight:true});
  levels.push({tag:'S1',label:lang==='ar'?'\u062f\u0639\u0645 / \u0645\u0646\u0637\u0642\u0629 \u0637\u0644\u0628':'Support / Demand',price:data.supp,col:'var(--up)'});
  if(data.ema50&&data.ema50<data.supp)levels.push({tag:'S2',label:'EMA50',price:data.ema50,col:'var(--warn)'});
  /* Sort descending */
  levels.sort(function(a,b){return b.price-a.price});
  levels.forEach(function(lv){
    var bg=lv.highlight?'rgba(91,156,255,.06)':'transparent';
    h+='<div class="mkt-row" style="background:'+bg+';border-radius:4px;padding:5px 4px">';
    h+='<span class="mkt-row-label"><span style="font-size:7px;padding:2px 5px;border-radius:3px;font-weight:700;background:'+lv.col+'15;color:'+lv.col+'">'+lv.tag+'</span> '+lv.label+'</span>';
    h+='<span class="mkt-row-val" style="direction:ltr;color:'+lv.col+'">'+rP(lv.price)+'</span>';
    h+='</div>';
  });
  h+='</div></div>';

  /* ════ Section 8: Technical Indicators ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F4CA} '+(lang==='ar'?'\u0627\u0644\u0645\u0624\u0634\u0631\u0627\u062a \u0627\u0644\u0641\u0646\u064a\u0629':'Technical Indicators')+'</div>';
  /* Card 1: 4H indicators */
  h+='<div class="mkt-box"><div class="mkt-box-t">'+(lang==='ar'?'\u0641\u0631\u064a\u0645 4H':'4H Frame')+'</div>';
  var rsiCol=data.rsi<30?'var(--up)':data.rsi>70?'var(--dn)':'var(--t0)';
  var rsiLabel=data.rsi<30?(lang==='ar'?'\u0645\u0646\u0637\u0642\u0629 \u0634\u0631\u0627\u0621':'Oversold'):data.rsi>70?(lang==='ar'?'\u0645\u0646\u0637\u0642\u0629 \u0628\u064a\u0639':'Overbought'):data.rsi>=40&&data.rsi<=60?(lang==='ar'?'\u0635\u062d\u064a':'Healthy'):(lang==='ar'?'\u0645\u0642\u0628\u0648\u0644':'Normal');
  h+='<div class="mkt-row"><span class="mkt-row-label">RSI</span><span class="mkt-row-val" style="color:'+rsiCol+'">'+Math.round(data.rsi)+' \u2014 '+rsiLabel+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">MACD</span><span class="mkt-row-val" style="color:'+(data.macd.h>0?'var(--up)':'var(--dn)')+'">'+(data.macd.h>0?'\u{1F7E2} ':'🔴 ')+(data.macd.cross==='bull'?(lang==='ar'?'\u062a\u0642\u0627\u0637\u0639 \u0635\u0639\u0648\u062f\u064a':'Bull Cross'):data.macd.cross==='bear'?(lang==='ar'?'\u062a\u0642\u0627\u0637\u0639 \u0647\u0628\u0648\u0637\u064a':'Bear Cross'):(data.macd.h>0?(lang==='ar'?'\u0625\u064a\u062c\u0627\u0628\u064a':'Positive'):(lang==='ar'?'\u0633\u0644\u0628\u064a':'Negative')))+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">EMA20</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.price>data.ema20?'var(--up)':'var(--dn)')+'">'+rP(data.ema20)+' '+(data.price>data.ema20?'\u2705':'\u274C')+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">EMA50</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.price>data.ema50?'var(--up)':'var(--dn)')+'">'+rP(data.ema50)+' '+(data.price>data.ema50?'\u2705':'\u274C')+'</span></div>';
  if(data.divRSI!=='none'||data.divRSI1d!=='none'){
    var divTxt=data.divRSI!=='none'?(lang==='ar'?'RSI Divergence \u0639\u0644\u0649 4H':'RSI Div on 4H'):(lang==='ar'?'RSI Divergence \u0639\u0644\u0649 \u0627\u0644\u064a\u0648\u0645\u064a':'RSI Div on Daily');
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u062f\u0627\u064a\u0641\u0631\u062c\u0646\u0633':'Divergence')+'</span><span class="mkt-row-val" style="color:var(--warn)">\u26a0\ufe0f '+divTxt+'</span></div>';
  }
  h+='</div>';
  /* Card 2: Futures */
  h+='<div class="mkt-box"><div class="mkt-box-t">'+(lang==='ar'?'\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0642\u0648\u062f':'Futures Data')+'</div>';
  if(data.fr){
    var frCol=data.fr.rate<0?'var(--up)':data.fr.rate>0.05?'var(--dn)':'var(--t0)';
    var frLabel=data.fr.rate<0?(lang==='ar'?'\u0633\u0644\u0628\u064a = \u0641\u0631\u0635\u0629':'Negative = Opportunity'):data.fr.rate>0.05?(lang==='ar'?'\u0639\u0627\u0644\u064a = \u062e\u0637\u0631':'High = Risk'):(lang==='ar'?'\u0637\u0628\u064a\u0639\u064a':'Normal');
    h+='<div class="mkt-row"><span class="mkt-row-label">Funding Rate</span><span class="mkt-row-val" style="direction:ltr;color:'+frCol+'">'+(data.fr.rate>=0?'+':'')+data.fr.rate.toFixed(4)+'% \u2014 '+frLabel+'</span></div>';
  }
  if(data.oi){h+='<div class="mkt-row"><span class="mkt-row-label">Open Interest</span><span class="mkt-row-val" style="direction:ltr">'+fmt(data.oi)+'</span></div>'}
  if(data.ls){h+='<div class="mkt-row"><span class="mkt-row-label">Long/Short</span><span class="mkt-row-val" style="direction:ltr;color:'+(data.ls.ratio>1.5?'var(--dn)':data.ls.ratio<0.8?'var(--up)':'var(--t0)')+'">'+data.ls.ratio.toFixed(2)+' (L:'+data.ls.long.toFixed(0)+'% S:'+data.ls.short.toFixed(0)+'%)</span></div>'}
  if(data.liqZones&&data.liqZones.length){
    data.liqZones.forEach(function(lz){
      h+='<div class="mkt-row"><span class="mkt-row-label">'+(lz.side==='Short'?'\u{1F4A5}':'\u{1F4A5}')+' '+(lang==='ar'?'\u062a\u0635\u0641\u064a\u0627\u062a '+lz.side:'Liq '+lz.side)+'</span><span class="mkt-row-val" style="direction:ltr">'+fmt(lz.amt)+'</span></div>';
    });
  }
  h+='</div></div>';

  /* ════ Section 9: Whale Intelligence ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F433} '+(lang==='ar'?'\u0627\u0633\u062a\u062e\u0628\u0627\u0631\u0627\u062a \u0627\u0644\u062d\u064a\u062a\u0627\u0646':'Whale Intelligence')+'</div>';
  h+='<div class="mkt-box">';
  var ww=typeof whaleWaves!=='undefined'?whaleWaves[sym]:null;
  if(ww&&ww.waves&&ww.waves.length){
    h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u062d\u062c\u0645 \u0627\u0644\u062a\u062c\u0645\u064a\u0639':'Accumulation Volume')+'</span><span class="mkt-row-val" style="direction:ltr">'+ww.waves.length+' '+(lang==='ar'?'\u0645\u0648\u062c\u0629':'waves')+'</span></div>';
    if(ww.waves.length>=2){
      var wPrices=ww.waves.map(function(w){return w.p||w.price||0}).filter(function(p){return p>0});
      if(wPrices.length>=2){
        h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u062a\u062c\u0645\u064a\u0639':'Accumulation Zone')+'</span><span class="mkt-row-val" style="direction:ltr">'+rP(Math.min.apply(null,wPrices))+' \u2014 '+rP(Math.max.apply(null,wPrices))+'</span></div>';
      }
    }
  }
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u062b\u0642\u0629 \u0627\u0644\u062d\u064a\u062a\u0627\u0646':'Whale Confidence')+'</span><span class="mkt-row-val" style="color:'+(data.wConf>=50?'var(--up)':data.wConf>=30?'var(--warn)':'var(--t3)')+'">'+data.wConf+'%</span></div>';
  if(data.cvd){
    h+='<div class="mkt-row"><span class="mkt-row-label">CVD</span><span class="mkt-row-val" style="color:'+(data.cvd.divergence==='BULLISH'?'var(--up)':data.cvd.divergence==='BEARISH'?'var(--dn)':'var(--t0)')+'">'+data.cvd.signal+(data.cvd.divergence!=='NONE'?' \u2014 '+data.cvd.divergence:'')+'</span></div>';
  }
  if(typeof CBP!=='undefined'&&CBP[sym]){
    var cbPrem=((CBP[sym]-data.price)/data.price*100);
    h+='<div class="mkt-row"><span class="mkt-row-label">Coinbase Premium</span><span class="mkt-row-val" style="direction:ltr;color:'+(cbPrem>0?'var(--up)':'var(--dn)')+'">'+(cbPrem>=0?'+':'')+cbPrem.toFixed(2)+'%</span></div>';
  }
  /* Summary */
  var wSummary='';
  if(data.wConf>=50)wSummary=lang==='ar'?'\u{1F433} \u062a\u062c\u0645\u064a\u0639 \u0642\u0648\u064a \u0645\u0646 \u0627\u0644\u062d\u064a\u062a\u0627\u0646 \u2014 \u0625\u0634\u0627\u0631\u0629 \u0625\u064a\u062c\u0627\u0628\u064a\u0629':'\u{1F433} Strong whale accumulation \u2014 positive';
  else if(data.wConf>=30)wSummary=lang==='ar'?'\u{1F433} \u0646\u0634\u0627\u0637 \u062d\u064a\u062a\u0627\u0646 \u0645\u062a\u0648\u0633\u0637':'\u{1F433} Moderate whale activity';
  else wSummary=lang==='ar'?'\u{1F433} \u0644\u0627 \u0646\u0634\u0627\u0637 \u062d\u064a\u062a\u0627\u0646 \u0648\u0627\u0636\u062d':'\u{1F433} No clear whale activity';
  h+='<div class="mkt-assess">'+wSummary+'</div>';
  h+='</div></div>';

  /* ════ Section 10: Trading Signal ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F3AF} '+(lang==='ar'?'\u0625\u0634\u0627\u0631\u0629 \u0627\u0644\u062a\u062f\u0627\u0648\u0644':'Trading Signal')+'</div>';
  var sigCls=data.ts>=2?'buy':data.ts<=-2?'sell':'wait';
  var entryPrice=data.price*0.99;
  var slPrice=data.ts>=2?data.f618D:data.supp;
  var rr=Math.abs(slPrice-entryPrice)>0?((data.f618U-entryPrice)/Math.abs(entryPrice-slPrice)):0;
  h+='<div class="mkt-signal '+sigCls+'">';
  h+='<div class="mkt-signal-hdr"><div class="mkt-signal-dir" style="color:'+data.dCol+'">'+data.dIc+' '+data.dir+'</div>';
  h+='<div class="mkt-signal-score">'+(lang==='ar'?'\u062a\u0642\u064a\u064a\u0645: ':'Score: ')+data.sc+'/10</div></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u{1F3AF} \u0646\u0642\u0637\u0629 \u0627\u0644\u062f\u062e\u0648\u0644':'\u{1F3AF} Entry')+'</span><span class="mkt-row-val" style="direction:ltr;color:var(--blue)">'+rP(entryPrice)+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u{1F3AF} \u0647\u062f\u0641 1 (TP1)':'\u{1F3AF} TP1')+'</span><span class="mkt-row-val" style="direction:ltr;color:var(--up)">'+rP(data.f618U)+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u{1F3AF} \u0647\u062f\u0641 2 (TP2)':'\u{1F3AF} TP2')+'</span><span class="mkt-row-val" style="direction:ltr;color:var(--up)">'+rP(data.f100U)+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u{1F6D1} \u0648\u0642\u0641 \u062e\u0633\u0627\u0631\u0629 (SL)':'\u{1F6D1} Stop Loss')+'</span><span class="mkt-row-val" style="direction:ltr;color:var(--dn)">'+rP(slPrice)+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">\u2696\uFE0F R:R</span><span class="mkt-row-val">1:'+rr.toFixed(1)+'</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u{1F4B0} \u062d\u062c\u0645 \u0627\u0644\u0645\u0631\u0643\u0632':'\u{1F4B0} Position Size')+'</span><span class="mkt-row-val">'+data.riskPct+'%</span></div>';
  h+='<div class="mkt-row"><span class="mkt-row-label">'+(lang==='ar'?'\u23F0 \u0627\u0644\u0645\u062f\u0629':'\u23F0 Duration')+'</span><span class="mkt-row-val">'+(lang==='ar'?'3-5 \u0623\u064a\u0627\u0645':'3-5 days')+'</span></div>';
  h+='<div style="margin-top:6px;font-size:9px;color:var(--dn)">\u274C '+(lang==='ar'?'\u0634\u0631\u0637 \u0627\u0644\u0625\u0644\u063a\u0627\u0621: '+(data.ts>=0?data.bullInv:data.bearInv):'Cancel if: '+(data.ts>=0?data.bullInv:data.bearInv))+'</div>';
  h+='</div></div>';

  /* ════ Section 11: 3 Scenarios ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F52E} '+(lang==='ar'?'\u0627\u0644\u0633\u064a\u0646\u0627\u0631\u064a\u0648\u0647\u0627\u062a':'Scenarios')+'</div>';
  /* Bull scenario */
  var step1U=data.price;var step2U=data.f618U;var step3U=data.f100U;
  h+='<div class="mkt-scenario up">';
  h+='<div class="mkt-scenario-t" style="color:var(--up)"><span>\u{1F4C8} '+(lang==='ar'?'\u0635\u0639\u0648\u062f\u064a':'Bullish')+'</span><span class="mkt-badge" style="background:rgba(0,255,136,.08);color:var(--up);margin:0">'+data.bullP+'%</span></div>';
  h+='<div class="mkt-scenario-s">'+(lang==='ar'?'\u0634\u0631\u0637: ':'Trigger: ')+data.bullCond+'</div>';
  h+='<div class="mkt-scenario-stage">'+(lang==='ar'?'\u0627\u0644\u0645\u0631\u062d\u0644\u0629 1: ':'Stage 1: ')+rP(step1U)+' \u2192 '+rP(step2U)+'</div>';
  h+='<div class="mkt-scenario-stage">'+(lang==='ar'?'\u0627\u0644\u0645\u0631\u062d\u0644\u0629 2: ':'Stage 2: ')+rP(step2U)+' \u2192 '+rP(step3U)+'</div>';
  h+='<div class="mkt-scenario-inv">\u274C '+data.bullInv+'</div>';
  h+='<div class="mkt-scenario-prob"><div class="mkt-scenario-prob-bar"><div class="mkt-scenario-prob-fill" style="width:'+data.bullP+'%;background:var(--up)"></div></div><span style="font-size:8px;color:var(--up)">'+data.bullP+'%</span></div>';
  h+='</div>';
  /* Neutral scenario */
  h+='<div class="mkt-scenario neutral">';
  h+='<div class="mkt-scenario-t" style="color:var(--warn)"><span>\u27A1\uFE0F '+(lang==='ar'?'\u062c\u0627\u0646\u0628\u064a':'Sideways')+'</span><span class="mkt-badge" style="background:rgba(255,184,0,.08);color:var(--warn);margin:0">'+data.neutP+'%</span></div>';
  h+='<div class="mkt-scenario-stage">'+(lang==='ar'?'\u0646\u0637\u0627\u0642: ':'Range: ')+rP(data.supp)+' \u2194 '+rP(data.resist)+'</div>';
  h+='<div class="mkt-scenario-prob"><div class="mkt-scenario-prob-bar"><div class="mkt-scenario-prob-fill" style="width:'+data.neutP+'%;background:var(--warn)"></div></div><span style="font-size:8px;color:var(--warn)">'+data.neutP+'%</span></div>';
  h+='</div>';
  /* Bear scenario */
  var step1D=data.price;var step2D=data.f618D;var step3D=data.supp;
  h+='<div class="mkt-scenario down">';
  h+='<div class="mkt-scenario-t" style="color:var(--dn)"><span>\u{1F4C9} '+(lang==='ar'?'\u0647\u0628\u0648\u0637\u064a':'Bearish')+'</span><span class="mkt-badge" style="background:rgba(255,56,96,.08);color:var(--dn);margin:0">'+data.bearP+'%</span></div>';
  h+='<div class="mkt-scenario-s">'+(lang==='ar'?'\u0634\u0631\u0637: ':'Trigger: ')+data.bearCond+'</div>';
  h+='<div class="mkt-scenario-stage">'+(lang==='ar'?'\u0627\u0644\u0645\u0631\u062d\u0644\u0629 1: ':'Stage 1: ')+rP(step1D)+' \u2192 '+rP(step2D)+'</div>';
  h+='<div class="mkt-scenario-stage">'+(lang==='ar'?'\u0627\u0644\u0645\u0631\u062d\u0644\u0629 2: ':'Stage 2: ')+rP(step2D)+' \u2192 '+rP(step3D)+'</div>';
  h+='<div class="mkt-scenario-inv">\u274C '+data.bearInv+'</div>';
  h+='<div class="mkt-scenario-prob"><div class="mkt-scenario-prob-bar"><div class="mkt-scenario-prob-fill" style="width:'+data.bearP+'%;background:var(--dn)"></div></div><span style="font-size:8px;color:var(--dn)">'+data.bearP+'%</span></div>';
  h+='</div></div>';

  /* ════ Section 12: Summary + Correlations + Events + Signature ════ */
  h+='<div class="mkt-section"><div class="mkt-section-t">\u{1F4CB} '+(lang==='ar'?'\u0627\u0644\u062e\u0644\u0627\u0635\u0629 \u0648\u0627\u0644\u0627\u0631\u062a\u0628\u0627\u0637\u0627\u062a':'Summary & Correlations')+'</div>';
  /* Upcoming events */
  var evs=getUpcomingEvents();
  if(evs.length){
    h+='<div class="mkt-events">';
    evs.forEach(function(e){h+='<div class="mkt-event-i"><span>'+e.ic+'</span><span>'+e.txt+'</span></div>'+(e.warn?'<div style="font-size:8px;color:var(--warn);padding:0 0 2px 22px">'+e.warn+'</div>':'')});
    h+='</div>';
  }
  /* Correlations */
  h+='<div class="mkt-cor">';
  h+='<div class="mkt-cor-i"><div class="mkt-cor-v">'+btcDom.toFixed(1)+'%</div><div class="mkt-cor-l">BTC Dom</div></div>';
  h+='<div class="mkt-cor-i"><div class="mkt-cor-v">'+(T.ETH&&T.BTC?(T.ETH.p/T.BTC.p).toFixed(4):'--')+'</div><div class="mkt-cor-l">ETH/BTC</div></div>';
  h+='<div class="mkt-cor-i"><div class="mkt-cor-v" style="color:'+(fgValue<30?'var(--dn)':fgValue>60?'var(--up)':'var(--warn)')+'">'+fgValue+'</div><div class="mkt-cor-l">Fear&Greed</div></div>';
  h+='</div>';
  /* Story summary */
  h+='<div class="mkt-summary" style="border-right:3px solid '+coinColor+'20;background:var(--bg2)">'+buildStory(sym,data)+'</div>';
  /* Risk cards */
  h+='<div class="mkt-risk-grid">';
  var riskLbl=data.riskPct>=4?(lang==='ar'?'\u0645\u062e\u0627\u0637\u0631\u0629 \u0639\u0627\u0644\u064a\u0629':'High Risk'):data.riskPct>=2?(lang==='ar'?'\u0645\u062e\u0627\u0637\u0631\u0629 \u0645\u062a\u0648\u0633\u0637\u0629':'Medium'):data.riskPct>=1?(lang==='ar'?'\u0645\u062e\u0627\u0637\u0631\u0629 \u0645\u0646\u062e\u0641\u0636\u0629':'Low Risk'):(lang==='ar'?'\u0644\u0627 \u062f\u062e\u0648\u0644':'No Entry');
  h+='<div class="mkt-risk-card"><div class="mkt-risk-card-v" style="color:'+(data.riskPct>=4?'var(--dn)':data.riskPct>=2?'var(--warn)':'var(--up)')+'">'+riskLbl+'</div><div class="mkt-risk-card-l">'+(lang==='ar'?'\u0627\u0644\u0645\u062e\u0627\u0637\u0631\u0629':'Risk')+'</div></div>';
  h+='<div class="mkt-risk-card"><div class="mkt-risk-card-v">1:'+rr.toFixed(1)+'</div><div class="mkt-risk-card-l">R:R</div></div>';
  h+='<div class="mkt-risk-card"><div class="mkt-risk-card-v">4H</div><div class="mkt-risk-card-l">'+(lang==='ar'?'\u0627\u0644\u0641\u0631\u064a\u0645':'Frame')+'</div></div>';
  h+='<div class="mkt-risk-card"><div class="mkt-risk-card-v">3-5d</div><div class="mkt-risk-card-l">'+(lang==='ar'?'\u0627\u0644\u0645\u062f\u0629':'Duration')+'</div></div>';
  h+='</div>';
  /* Disclaimer */
  h+='<div style="text-align:center;font-size:8px;color:var(--t3);margin:6px 0">\u26a0\ufe0f '+(lang==='ar'?'\u062a\u062d\u0644\u064a\u0644 \u0641\u0646\u064a \u2014 \u0644\u064a\u0633 \u0646\u0635\u064a\u062d\u0629 \u0645\u0627\u0644\u064a\u0629':'Technical analysis \u2014 not financial advice')+'</div>';
  /* Signature */
  h+=mktSignature();
  h+='</div>';

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
var sP=function(){localStorage.setItem('nxp10',JSON.stringify(portfolio))};
function addPort(){var sym=document.getElementById('aSym').value.toUpperCase().trim(),amt=+document.getElementById('aAmt').value,pr=+document.getElementById('aPr').value;if(!sym||!amt)return;portfolio.push({sym:sym,amt:amt,bp:pr});sP();closeMo('addMo');renderPort()}
function rmPort(i){portfolio.splice(i,1);sP();renderPort()}
function renderPort(){var tV=0,tC=0;portfolio.forEach(function(p){var d=T[p.sym];if(d){tV+=d.p*p.amt;tC+=p.bp*p.amt}});var pnl=tC>0?((tV-tC)/tC*100):0;document.getElementById('pVal').textContent=tV>0?fmt(tV):'$0';var pE=document.getElementById('pCh');if(tC>0){pE.textContent=(pnl>=0?'+':'')+pnl.toFixed(2)+'%';pE.style.color=pnl>=0?'var(--up)':'var(--dn)'}else{pE.textContent=t('add_coins');pE.style.color='var(--t3)'};document.getElementById('pList').innerHTML=portfolio.length?portfolio.map(function(p,i){var d=T[p.sym],cp=d?d.p:0,v=cp*p.amt,pnl=p.bp>0?((cp-p.bp)/p.bp*100):0;var bg=COL[p.sym]||'#444';return'<div class="port-i"><div style="display:flex;align-items:center;gap:8px"><div class="cr-ic" style="background:'+bg+'0a;color:'+bg+';border:1px solid '+bg+'22;width:26px;height:26px;font-size:9px">'+p.sym.slice(0,2)+'</div><div><div class="cr-n">'+p.sym+'</div><div class="cr-sub">'+p.amt+' × '+fP(cp)+'</div></div></div><div style="text-align:left"><div class="cr-p">'+fmt(v)+'</div><div style="font-family:var(--fm);font-size:9px;font-weight:700;color:'+(pnl>=0?'var(--up)':'var(--dn)')+'">'+(p.bp>0?(pnl>=0?'+':'')+pnl.toFixed(1)+'%':'--')+'</div><div style="font-size:7px;color:var(--t3);cursor:pointer" onclick="rmPort('+i+')">🗑</div></div></div>'}).join(''):'<div class="empty"><div class="empty-ic">💼</div><div class="empty-tx">'+t('empty_port')+'</div></div>'}
/* ═══ ⚖️ L/S INTELLIGENCE v2.0 ═══ */
async function loadTakerVol(){
  var proms=WL.slice(0,15).map(function(s){return fj(BF+'/futures/data/takerlongshortRatio?symbol='+s+'USDT&period=5m&limit=6').then(function(d){
    if(!d||!d.length)return;var lat=d[d.length-1];var avg=d.reduce(function(sum,x){return sum+(+x.buySellRatio)},0)/d.length;
    takerData[s]={ratio:+lat.buySellRatio,avg:avg,trend:+lat.buySellRatio>avg?'INCREASING':'DECREASING',buyVol:+lat.buyVol,sellVol:+lat.sellVol}}).catch(function(){})});
  await Promise.all(proms)}

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
function calcRisk(){var cap=+document.getElementById('rcCap').value,risk=+document.getElementById('rcRisk').value,entry=+document.getElementById('rcEntry').value,sl=+document.getElementById('rcSL').value,tp=+document.getElementById('rcTP').value;if(!cap||!entry||!sl){document.getElementById('rcRes').innerHTML='<div style="text-align:center;color:var(--t3);padding:12px;font-size:11px">'+t('enter_data')+'</div>';return};var rA=cap*(risk/100),slD=Math.abs(entry-sl),pos=slD>0?rA/slD:0,posV=pos*entry,rew=tp?pos*Math.abs(tp-entry):0,rr=tp&&rA>0?rew/rA:0,lev=cap>0?posV/cap:0;document.getElementById('rcRes').innerHTML='<div class="rc-row"><span>'+t('risk_amt')+'</span><span class="rc-val" style="color:var(--dn)">'+fmt(rA)+'</span></div><div class="rc-row"><span>'+t('pos_size')+'</span><span class="rc-val">'+pos.toFixed(4)+'</span></div><div class="rc-row"><span>'+t('pos_val')+'</span><span class="rc-val">'+fmt(posV)+'</span></div><div class="rc-row"><span>'+t('leverage')+'</span><span class="rc-val" style="color:'+(lev>10?'var(--dn)':lev>5?'var(--warn)':'var(--up)')+'">'+lev.toFixed(1)+'x</span></div>'+(tp?'<div class="rc-row"><span>'+t('exp_profit')+'</span><span class="rc-val" style="color:var(--up)">'+fmt(rew)+'</span></div><div class="rc-row"><span>⚖️ R/R</span><span class="rc-val" style="color:'+(rr>=2?'var(--up)':rr>=1?'var(--warn)':'var(--dn)')+'">1:'+rr.toFixed(1)+'</span></div>':'')+'<div class="rc-row"><span>'+t('sl_loss')+'</span><span class="rc-val" style="color:var(--dn)">-'+fmt(rA)+'</span></div>'}
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
/* 🎯 TOP 3 BEST OPPORTUNITIES */
function renderTop3(){
  var el=document.getElementById('top3List');if(!el||!cache.scan)return;
  var opps=[];
  cache.scan.forEach(function(r){
    var priority=r.score;var type='';var icon='';var reason='';var conf=0;
    /* ULTRA signals get highest priority */
    if(r.ultra){type='ULTRA';icon='⭐';priority+=30;
      reason=lang==='ar'?'إشارة مؤكدة — '+r.passed+'/6 فحوصات':'Confirmed — '+r.passed+'/6 checks'}
    else if(r.confirmed){type=lang==='ar'?'إشارة قوية':'Strong Signal';icon='🟢';priority+=15;
      reason=lang==='ar'?'إشارة قوية — '+r.passed+'/6 فحوصات':'Strong — '+r.passed+'/6 checks'}
    else if(r.tags.some(function(t){return t.includes('EARLY')||t.includes('STEALTH')})){
      type=lang==='ar'?'صيد مبكر':'Early Catch';icon='💎';priority+=20;
      reason=lang==='ar'?'تجميع قبل الانفجار':'Accumulation before pump'}
    else if(r.c>=3&&r.c<10&&r.score>=40){type=lang==='ar'?'انفجار':'Breakout';icon='💥';
      reason=lang==='ar'?'بداية انفجار — لسا فيه فرصة':'Early breakout — still time'}
    else return;
    /* Whale wave bonus */
    var waves=whaleWaves[r.s]?whaleWaves[r.s].waves.length:0;
    if(waves>=3){priority+=20;reason+=(lang==='ar'?' | 🐋 3 موجات حيتان':' | 🐋 3 whale waves')}
    else if(waves>=2){priority+=10;reason+=(lang==='ar'?' | 🐋 موجتين':' | 🐋 2 waves')}
    /* FR bonus */
    if(FR[r.s]&&FR[r.s].rate<-0.01){priority+=8;reason+=(lang==='ar'?' | FR سلبي 🟢':' | Neg FR 🟢')}
    /* Late penalty */
    if(r.c>=10){priority-=15}
    if(r.c>=15){priority-=20}
    /* Confidence */
    conf=Math.min(99,Math.max(50,Math.round(50+priority*0.4)));
    /* Recommendation */
    var rec,recCol;
    if(conf>=90){rec=lang==='ar'?'💡 شراء قوي':'💡 Strong Buy';recCol='var(--up)'}
    else if(conf>=80){rec=lang==='ar'?'💡 فرصة ذهبية':'💡 Golden Opp';recCol='var(--neon)'}
    else if(conf>=70){rec=lang==='ar'?'💡 راقب':'💡 Watch';recCol='var(--warn)'}
    else{rec=lang==='ar'?'💡 حذر':'💡 Caution';recCol='var(--t2)'}
    opps.push({s:r.s,p:r.p,c:r.c,v:r.v,score:r.score,priority:priority,type:type,icon:icon,reason:reason,conf:conf,rec:rec,recCol:recCol,checks:r.checks,passed:r.passed,waves:waves,detectedAt:r.detectedAt})});
  opps=opps.filter(function(o){return o.c<8&&o.score>=45});
  opps.sort(function(a,b){var aw=whaleWaves[a.s]&&whaleWaves[a.s].engine?whaleWaves[a.s].engine.confidence:0;var bw=whaleWaves[b.s]&&whaleWaves[b.s].engine?whaleWaves[b.s].engine.confidence:0;if(bw!==aw)return bw-aw;return b.priority-a.priority});
  var top=opps.slice(0,3);
  var ranks=['gold','silver','bronze'];var rankIcons=['1️⃣','2️⃣','3️⃣'];
  el.innerHTML=top.length?top.map(function(o,i){
    var up=o.c>=0;var src=[];if(T[o.s])src.push(T[o.s].src==='BY'?'Bybit':'Binance');if(T[o.s]&&T[o.s].by)src.push('Bybit');if(CBP[o.s])src.push('Coinbase');
    return'<div class="top3-card '+ranks[i]+'" onclick="openCoin(\''+o.s+'\')">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px"><div class="top3-rank" style="background:'+(i===0?'linear-gradient(135deg,#ffd700,#ff8c00)':i===1?'linear-gradient(135deg,#c0c0c0,#808080)':'linear-gradient(135deg,#cd7f32,#8b4513)')+';color:#fff">'+rankIcons[i]+'</div><div><div style="font-family:var(--fd);font-weight:800;font-size:14px;color:var(--t0)">'+o.icon+' '+o.s+'/USDT</div><div style="font-size:8px;font-family:var(--fm);color:var(--t2)">'+o.type+'</div></div></div>'
    +'<div class="top3-conf" style="background:'+(o.conf>=90?'var(--ud)':o.conf>=80?'var(--nd)':'var(--wd)')+';color:'+(o.conf>=90?'var(--up)':o.conf>=80?'var(--neon)':'var(--warn)')+'">'+(lang==='ar'?'ثقة':'Conf')+' '+o.conf+'%</div></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-family:var(--fm);font-size:18px;font-weight:800;color:var(--t0)">'+fP(o.p)+'</span><span style="font-family:var(--fm);font-size:13px;font-weight:800;color:var(--'+(up?'up':'dn')+')">'+(up?'+':'')+o.c.toFixed(1)+'%</span></div>'
    +'<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap"><span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--bg2);color:var(--t1)">Score:'+o.score+'</span><span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--bg2);color:var(--t1)">'+o.passed+'/6✅</span>'+(o.waves>0?'<span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--nd);color:var(--neon)">🐋'+o.waves+'</span>':'')+'<span style="font-size:7px;font-family:var(--fm);padding:2px 5px;border-radius:3px;background:var(--bg2);color:var(--t2)">'+src.join('·')+'</span></div>'
    +'<div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:9px;color:var(--t2);flex:1">'+o.reason+'</div><div style="font-size:10px;font-weight:700;color:'+o.recCol+'">'+o.rec+'</div></div>'
    +'<div style="margin-top:4px;display:flex;gap:8px;font-size:8px;font-family:var(--fm)"><span style="color:var(--up)">🎯 '+fP(o.p*1.08)+' — '+fP(o.p*1.15)+'</span><span style="color:var(--dn)">🛑 '+fP(o.p*0.93)+'</span></div>'
    +'</div>'}).join(''):'<div class="muted">'+(lang==='ar'?'لا فرص قوية حالياً — السوق هادئ':'No strong opportunities — Market quiet')+'</div>'}
/* 📈 MARKET MOVEMENT PAGE */
async function loadMarket(){if(curMktTab===0)loadBTCChart();else loadETHChart()}
setInterval(function(){var pgEl=document.getElementById('pg-market');if(pgEl&&pgEl.classList.contains('act')){if(curMktTab===0&&Date.now()-btcCache.t>=MKT_TTL)loadBTCChart();else if(curMktTab===1&&Date.now()-ethCache.t>=MKT_TTL)loadETHChart()}},60000);
/* 🤖 DATA VALIDATOR + AUTO-REPAIR + CONNECTION QUALITY */
var validatorLog=[];var lastDataTime=Date.now();var validatorStatus='ok';
var connMetrics={apiOk:0,apiFail:0,wsUp:false,lastLatency:0,lastCheck:Date.now()};
function addVLog(type,msg){validatorLog.unshift({type:type,msg:msg,time:Date.now()});if(validatorLog.length>30)validatorLog=validatorLog.slice(0,30)}
function getConnQuality(){
  var score=100;
  /* WS connected? */
  if(!ws||ws.readyState!==1)score-=30;
  /* Data freshness */
  var age=Date.now()-lastDataTime;
  if(age>120000)score-=40;else if(age>60000)score-=15;
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
  if(!ws||ws.readyState!==1){addVLog('🔴','WebSocket غير متصل — يعيد الاتصال');issues++;initWS();fixes++;addVLog('🔧','أعاد اتصال WebSocket')}
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
  if(frCount<10){addVLog('🟡','FR: فقط '+frCount+' عملة — يعيد التحميل');issues++;try{await loadFutures();fixes++;connMetrics.apiOk++;addVLog('🔧','أعاد تحميل Futures ✅')}catch(e){connMetrics.apiFail++}}
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
/* 🎯 BYBIT TOP GAINERS — catch Bybit-only movers */
async function scanBybitGainers(){
  try{var by=await fj('https://api.bybit.com/v5/market/tickers?category=spot');if(!by||!by.result)return;
    var gainers=by.result.list.filter(function(x){return x.symbol.endsWith('USDT')&&+x.price24hPcnt*100>=3&&+x.turnover24h>50000}).sort(function(a,b){return+b.price24hPcnt-+a.price24hPcnt}).slice(0,20);
    gainers.forEach(function(x){var s=x.symbol.replace('USDT','');var chg=+x.price24hPcnt*100;
      if(!T[s]||T[s].src==='BY'){T[s]={p:+x.lastPrice,c:chg,v:+x.turnover24h,h:+x.highPrice24h,l:+x.lowPrice24h,src:'BY',by:+x.lastPrice}}
      if(chg>=5&&chg<=15){var k='by_'+s+'_'+new Date().getHours();if(!notifiedSet[k]){notifiedSet[k]=true;localStorage.setItem('nxnot10',JSON.stringify(notifiedSet));recSig(s,'breakout');if(chg<8)notify(s,'gem',0)}}})}catch(e){}}
/* INIT */
async function init(){try{document.getElementById('sInp').placeholder=t('search_ph')}catch(e){}try{document.getElementById('notifB').dataset.c='0'}catch(e){}
  loadProfile();loadToneUI();updateMenuLang();updateMenuTheme();
  if(tg){try{tg.setHeaderColor(document.body.dataset.theme==='dark'?'#060b14':'#f7f9fc');tg.setBackgroundColor(document.body.dataset.theme==='dark'?'#020408':'#f0f4f8')}catch(e){}}
  try{await loadDash()}catch(e){console.error('init loadDash:',e)}
  try{renderPort()}catch(e){}
  try{updateConnStatus()}catch(e){}
  /* Start Multi-Stream WebSocket */
  initAggTradeWS();initLiqWS();initDepthWS();
  /* On-Chain + Wallet check */
  setTimeout(fetchOnChainBTC,10000);setInterval(fetchOnChainBTC,120000);
  setTimeout(checkWallets,20000);setInterval(checkWallets,120000);
  setInterval(async function(){try{await loadTk();await loadFutures();lastDataTime=Date.now();checkWatchlistAlerts();scanBybitGainers();updateConnStatus()}catch(e){connMetrics.apiFail++;updateConnStatus()}},30000);
  setInterval(async function(){if(document.getElementById('pg-dash').classList.contains('act'))try{await loadDash()}catch(e){}},120000);
  setInterval(function(){if(!ws||ws.readyState!==1)initWS()},30000);
  setInterval(monitorTrades,10000);
  setInterval(function(){try{notifiedSet={};localStorage.setItem('nxnot10','{}')}catch(e){}},3600000);
  setTimeout(function(){runValidator()},10000);
  setInterval(function(){runValidator()},90000);
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
}
init();
