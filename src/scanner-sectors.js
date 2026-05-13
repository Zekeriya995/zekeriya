/* NEXUS PRO — server-side sector aggregation.

   The browser already groups coins into ten sectors via SECTORS in
   src/sectors.js, which feeds the heatmap on the home tab. The
   scanner's output mirrors that taxonomy: every signal belongs to
   one sector, and rolling them up tells the user "AI is heating
   up" or "DeFi is bleeding" at a glance.

   This module duplicates the SECTORS coin lists rather than
   importing src/sectors.js — that file is browser-only (var
   declarations, no module.exports) and rewriting it for dual use
   would expand its surface area for no benefit. The duplication is
   small and easy to audit. */

'use strict';

const SECTOR_COINS = {
  ai: [
    'FET',
    'RNDR',
    'RENDER',
    'TAO',
    'WLD',
    'AKT',
    'ARKM',
    'OCEAN',
    'AGIX',
    'PRIME',
    'CTXC',
    'NMR',
  ],
  gaming: [
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
  layer1: [
    'BTC',
    'ETH',
    'SOL',
    'AVAX',
    'DOT',
    'ATOM',
    'NEAR',
    'BNB',
    'ADA',
    'TRX',
    'TON',
    'APT',
    'SUI',
    'SEI',
    'TIA',
    'INJ',
    'HBAR',
    'ICP',
    'KAS',
    'EOS',
    'XRP',
    'XLM',
    'LTC',
  ],
  layer2: ['ARB', 'OP', 'MATIC', 'METIS', 'STRK', 'MANTA', 'ZK', 'BLAST'],
  defi: ['UNI', 'AAVE', 'MKR', 'CRV', 'LDO', 'COMP', 'SUSHI', 'CAKE', 'JUP'],
  meme: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'TRUMP'],
  rwa: ['ONDO', 'GFI'],
  depin: ['IO', 'HNT', 'FIL'],
  data: ['LINK', 'GRT', 'BAND', 'PYTH', 'API3', 'TRB'],
  privacy: ['XMR', 'ZEC', 'SCRT', 'ROSE'],
};

/* Reverse index — built once at module load. First sector wins for
   coins that appear in two sectors (e.g. RNDR is both AI and DePIN
   in the original taxonomy; we surface the AI bucket because that's
   what the home heatmap also defaults to). */
const COIN_TO_SECTOR = (function () {
  const out = {};
  for (const sec in SECTOR_COINS) {
    for (const coin of SECTOR_COINS[sec]) {
      if (!out[coin]) out[coin] = sec;
    }
  }
  return out;
})();

function getSector(sym) {
  return COIN_TO_SECTOR[sym] || null;
}

/* aggregateBySector(signals) — pure function. Walks the sorted
   signal list once and produces a per-sector roll-up the UI can
   render as a heatmap card.

   Verdict ladder mirrors _tierFromScore in scanner-engine, so a
   sector whose average signal is in STRONG territory shows as
   "strong_bullish", same colour the individual cards use. */
function aggregateBySector(signals) {
  const out = {};
  for (const sec in SECTOR_COINS) {
    out[sec] = {
      sector: sec,
      count: 0,
      totalScore: 0,
      avgScore: 0,
      topSignals: [],
      verdict: 'empty',
    };
  }

  if (!Array.isArray(signals)) return out;

  for (const sig of signals) {
    if (!sig || !sig.s) continue;
    const sec = getSector(sig.s);
    if (!sec || !out[sec]) continue;
    out[sec].count++;
    out[sec].totalScore += sig.score || 0;
    /* Keep the top three by score per sector for the heatmap card
       drill-down. Sorted at the end. */
    out[sec].topSignals.push({
      s: sig.s,
      score: sig.score,
      change: sig.change,
      tier: sig.tier,
    });
  }

  for (const sec in out) {
    const s = out[sec];
    if (s.count === 0) {
      s.verdict = 'empty';
    } else {
      s.avgScore = Math.round((s.totalScore / s.count) * 10) / 10;
      if (s.avgScore >= 70) s.verdict = 'strong_bullish';
      else if (s.avgScore >= 50) s.verdict = 'bullish';
      else if (s.avgScore >= 30) s.verdict = 'neutral';
      else s.verdict = 'weak';
      s.topSignals.sort((a, b) => (b.score || 0) - (a.score || 0));
      if (s.topSignals.length > 3) s.topSignals.length = 3;
    }
    /* Keep the wire shape lean — totalScore is internal scratch. */
    delete s.totalScore;
  }

  return out;
}

module.exports = {
  SECTOR_COINS,
  COIN_TO_SECTOR,
  getSector,
  aggregateBySector,
};
