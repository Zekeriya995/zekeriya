/* NEXUS PRO — market sector taxonomy.
   Each sector lists its flagship coins; analyzeSectors() in app.js walks
   SECTORS and scores heat per sector based on live ticker data. */

var SECTORS = {
  ai: {
    ic: '🤖',
    n: { ar: 'ذكاء اصطناعي', en: 'AI' },
    /* RNDR→RENDER rebrand (2023); AGIX & OCEAN folded into FET in the
       ASI Alliance merger (2024) — dropped, FET now represents them. */
    coins: ['FET', 'RENDER', 'TAO', 'WLD', 'AKT', 'ARKM', 'PRIME', 'CTXC', 'NMR'],
    col: '#7c3aed',
  },
  gaming: {
    ic: '🎮',
    n: { ar: 'ألعاب وميتافيرس', en: 'Gaming' },
    coins: [
      'IMX',
      'GALA',
      'AXS',
      'SAND',
      'MANA',
      'ENJ',
      'PIXEL',
      'BEAM',
      'ILV',
      'PORTAL',
      'YGG',
      'ALICE',
    ],
    col: '#06b6d4',
  },
  layer1: {
    ic: '⛓️',
    n: { ar: 'الطبقة الأولى', en: 'Layer 1' },
    coins: [
      'ETH',
      'SOL',
      'AVAX',
      'DOT',
      'ATOM',
      'NEAR',
      'APT',
      'SUI',
      'SEI',
      'ICP',
      'FTM',
      /* Sonic — FTM→S migration; both kept until FTM fully delists. */
      'S',
      'ALGO',
      'HBAR',
      'TIA',
    ],
    col: '#3b82f6',
  },
  layer2: {
    ic: '🔗',
    n: { ar: 'الطبقة الثانية', en: 'Layer 2' },
    /* MATIC→POL rebrand (2024). */
    coins: ['ARB', 'OP', 'POL', 'MANTA', 'STRK', 'METIS', 'ZK', 'BLAST'],
    col: '#8b5cf6',
  },
  defi: {
    ic: '💰',
    n: { ar: 'التمويل اللامركزي', en: 'DeFi' },
    coins: [
      'UNI',
      'AAVE',
      'MKR',
      'LDO',
      'SNX',
      'CRV',
      'COMP',
      'DYDX',
      'GMX',
      'SUSHI',
      'PENDLE',
      'JUP',
    ],
    col: '#10b981',
  },
  meme: {
    ic: '🐕',
    n: { ar: 'عملات ميم', en: 'Meme' },
    coins: ['DOGE', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'SHIB', 'MEME', 'TURBO'],
    col: '#f59e0b',
  },
  rwa: {
    ic: '🏦',
    n: { ar: 'أصول حقيقية', en: 'RWA' },
    coins: ['ONDO', 'POLYX', 'DUSK', 'RIO', 'CPOOL'],
    col: '#64748b',
  },
  depin: {
    ic: '🌐',
    n: { ar: 'بنية تحتية', en: 'DePIN' },
    coins: ['FIL', 'AR', 'HNT', 'THETA', 'ANKR', 'IOTX'],
    col: '#0ea5e9',
  },
  data: {
    ic: '⚡',
    n: { ar: 'بيانات وأوراكل', en: 'Data/Oracle' },
    coins: ['LINK', 'GRT', 'BAND', 'PYTH', 'API3', 'TRB'],
    col: '#6366f1',
  },
  privacy: {
    ic: '🔒',
    n: { ar: 'خصوصية', en: 'Privacy' },
    coins: ['XMR', 'ZEC', 'SCRT', 'ROSE'],
    col: '#475569',
  },
};

/* Return the sector key (e.g. 'layer1') that contains the given symbol,
   or null if the coin isn't classified. */
function getCoinSector(sym) {
  for (var k in SECTORS) {
    if (SECTORS[k].coins.includes(sym)) return k;
  }
  return null;
}

/* ─── Sector heat — symmetric strength score (T2 scanner audit) ────────
   analyzeSectors() in app.js scored sector heat with a structurally
   bull-biased ladder: FIVE positive buckets (avg ≥0/1/3/5/8 → 30/45/60/
   75/90) but only TWO negative ones (avg ≥-3 → 15, else 5). A sector down
   −2% and one down −10% landed in the same bucket — the "money flow"
   panel was effectively blind to the DEPTH of an outflow, and sorted /
   coloured every decliner almost identically. Same asymmetry class as the
   Market-Direction trend-score bias (audit Group B).

   sectorStrength re-centres the scale on 50 = flat and mirrors the bullish
   ladder onto the bearish side, so an N% drop is exactly as far below 50 as
   an N% rise is above it. The breadth nudge (share of rising coins) is
   symmetric too: broad participation lifts, broad weakness drags equally.
   Pure: numbers in, 0..100 out — unit-tested in tests/sectors-heat.test.js.
   Wired into app.js behind nxScannerFix_sector_symmetry (default on) so the
   legacy ladder is one localStorage flip away if a regression surfaces. */
function sectorStrength(avg, rPct) {
  var a = +avg;
  if (!isFinite(a)) a = 0;
  var s;
  if (a >= 8) s = 92;
  else if (a >= 5) s = 82;
  else if (a >= 3) s = 72;
  else if (a >= 1) s = 60;
  else if (a > -1) s = 50; /* flat band (−1, 1) */
  else if (a > -3) s = 40;
  else if (a > -5) s = 28;
  else if (a > -8) s = 18;
  else s = 8;
  /* Breadth of participation — symmetric around the no-info case. */
  var r = +rPct;
  if (isFinite(r)) {
    if (r >= 80) s += 8;
    else if (r >= 60) s += 4;
    else if (r <= 20) s -= 8;
    else if (r <= 40) s -= 4;
  }
  if (s < 0) s = 0;
  if (s > 100) s = 100;
  return s;
}

/* Map a symmetric strength score to a verdict tier. Bands are symmetric
   around the flat midpoint (50): 'hot' is as far above neutral as the
   strong-down edge of 'declining' is below it. Returns a stable key the
   renderer maps to a localized label + colour, so i18n stays in app.js.
   Tiers: 'hot' ≥70 · 'rising' ≥56 · 'neutral' ≥44 · 'declining' <44. */
function sectorVerdictTier(str) {
  var s = +str;
  if (!isFinite(s)) s = 50;
  if (s >= 70) return 'hot';
  if (s >= 56) return 'rising';
  if (s >= 44) return 'neutral';
  return 'declining';
}

/* Dual-export so Node tests can require() these pure helpers while the
   browser keeps them as plain globals (script-tag load). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SECTORS, getCoinSector, sectorStrength, sectorVerdictTier };
}
