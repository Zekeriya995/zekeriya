/* NEXUS PRO — shared constants (API endpoints, proxy, watchlist, coin colors).
   Loaded before app.js via a plain <script> tag; everything here lives on the
   global script scope so the rest of the app can reference it as before. */

/* Exchange REST base URLs */
const BN = 'https://api.binance.com/api/v3';
const BF = 'https://fapi.binance.com/fapi/v1';
const CG = 'https://api.coingecko.com/api/v3';
const CB = 'https://api.coinbase.com/v2';

/* PROXY endpoint — overridable via localStorage('nxProxyOverride') or
   window.NEXUS_PROXY (set before this script loads) for dev / self-hosted
   deployments. Only http(s):// URLs are accepted; trailing slashes are
   stripped so callers can safely append '/notify' etc. */
const PROXY = (function () {
  try {
    var o = localStorage.getItem('nxProxyOverride');
    if (o && /^https?:\/\//.test(o)) return o.replace(/\/+$/, '');
  } catch (e) {}
  try {
    if (
      typeof window !== 'undefined' &&
      window.NEXUS_PROXY &&
      /^https?:\/\//.test(window.NEXUS_PROXY)
    ) {
      return String(window.NEXUS_PROXY).replace(/\/+$/, '');
    }
  } catch (e) {}
  return 'https://attorneys-lock-breed-warrant.trycloudflare.com';
})();

/* Watchlist — seeded with the top 100 by market cap; updateTop100() replaces
   it at runtime from CoinGecko, so this must remain `var`. */
var WL = [
  'BTC',
  'ETH',
  'SOL',
  'BNB',
  'XRP',
  'ADA',
  'DOGE',
  'LINK',
  'AVAX',
  'DOT',
  'MATIC',
  'UNI',
  'ATOM',
  'LTC',
  'NEAR',
  'APT',
  'ARB',
  'OP',
  'INJ',
  'SUI',
  'SEI',
  'TIA',
  'FTM',
  'PEPE',
  'WIF',
  'FIL',
  'HBAR',
  'ICP',
  'IMX',
  'STX',
  'MKR',
  'AAVE',
  'RENDER',
  'GRT',
  'FET',
  'TAO',
  'THETA',
  'LDO',
  'BONK',
  'FLOKI',
  'AR',
  'ALGO',
  'FLOW',
  'MINA',
  'AXS',
  'SAND',
  'MANA',
  'GALA',
  'ENJ',
  'CRV',
  'SNX',
  'COMP',
  'DYDX',
  'GMX',
  'SUSHI',
  'PENDLE',
  'JUP',
  'ENA',
  'W',
  'STRK',
  'TRX',
  'TON',
  'VET',
  'RUNE',
  'KAS',
  'EOS',
  'XLM',
  'EGLD',
  'ROSE',
  'ONE',
  'ZIL',
  'CHZ',
  'IOTA',
  'ENS',
  'WLD',
  'PYTH',
  'ONDO',
  'JTO',
  'PIXEL',
  'BEAM',
  'ORDI',
  'TWT',
  'CAKE',
  '1INCH',
  'BAL',
  'YFI',
  'ASTR',
  'CFX',
  'ANKR',
  'IOTX',
  'RVN',
  'ZEC',
  'QTUM',
  'XEM',
  'WAVES',
  'NEO',
  'KAVA',
  'CKB',
  'XTZ',
  'CELO',
];

/* Brand color per coin symbol — used for sparklines and card accents. */
var COL = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
  BNB: '#f0b90b',
  XRP: '#23292f',
  LINK: '#2a5ada',
  AVAX: '#e84142',
  DOGE: '#c2a633',
  ADA: '#0033ad',
  DOT: '#e6007a',
  MATIC: '#8247e5',
  UNI: '#ff007a',
  ATOM: '#2e3148',
  ARB: '#28a0f0',
  OP: '#ff0420',
  INJ: '#00f2fe',
  SUI: '#4da2ff',
  SEI: '#9b1c1c',
  TIA: '#7c3aed',
  FTM: '#1969ff',
  NEAR: '#00c08b',
  APT: '#00bfa6',
  LTC: '#bfbbbb',
  PEPE: '#4c8c2f',
  WIF: '#8b5cf6',
};
