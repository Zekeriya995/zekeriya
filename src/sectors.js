/* NEXUS PRO — market sector taxonomy.
   Each sector lists its flagship coins; analyzeSectors() in app.js walks
   SECTORS and scores heat per sector based on live ticker data. */

var SECTORS = {
  ai: {
    ic: '🤖',
    n: { ar: 'ذكاء اصطناعي', en: 'AI' },
    coins: ['FET', 'RNDR', 'TAO', 'WLD', 'AKT', 'ARKM', 'OCEAN', 'AGIX', 'PRIME', 'CTXC', 'NMR'],
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
      'ALGO',
      'HBAR',
      'TIA',
    ],
    col: '#3b82f6',
  },
  layer2: {
    ic: '🔗',
    n: { ar: 'الطبقة الثانية', en: 'Layer 2' },
    coins: ['ARB', 'OP', 'MATIC', 'MANTA', 'STRK', 'METIS', 'ZK', 'BLAST'],
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
