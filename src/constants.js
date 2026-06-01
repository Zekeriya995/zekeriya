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
   stripped so callers can safely append '/notify' etc.

   Resolution order (top to bottom):
     1. localStorage.nxProxyOverride       (manual user override)
     2. window.NEXUS_PROXY                 (build-time injection)
     3. Static-host shortcut               (NEW) — when the page loads
        from a host that obviously can't serve /api/* (GitHub Pages,
        Cloudflare Pages, the legacy workers.dev, file://) jump
        straight to the active VPS tunnel rather than try same-origin.
     4. window.location.origin             (same-origin: when nginx
        serves both static + /api/ — the trycloudflare tunnel, a
        named tunnel, or localhost during dev)
     5. ACTIVE_VPS_TUNNEL fallback         (last-resort hard-coded)

   This tiered chain lets a single bundle work in three deployment
   surfaces: directly via the tunnel, via Telegram Mini App, or via
   GitHub Pages — without per-deploy config. When the tunnel URL
   churns the only thing that needs updating is ACTIVE_VPS_TUNNEL
   (one line) and any user-set localStorage override. */
const ACTIVE_VPS_TUNNEL = 'https://shamcyrpto.com';
const STATIC_ONLY_HOST_RE = /(\.github\.io|\.pages\.dev|\.workers\.dev|jolly-bush-9254)$/i;
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
  /* Step 3 — static-only host shortcut. */
  try {
    if (
      typeof window !== 'undefined' &&
      window.location &&
      window.location.hostname &&
      STATIC_ONLY_HOST_RE.test(window.location.hostname)
    ) {
      return ACTIVE_VPS_TUNNEL.replace(/\/+$/, '');
    }
  } catch (e) {}
  /* Step 4 — same-origin (the happy path on the tunnel itself). */
  try {
    if (
      typeof window !== 'undefined' &&
      window.location &&
      /^https?:/.test(window.location.protocol) &&
      window.location.origin
    ) {
      return window.location.origin.replace(/\/+$/, '');
    }
  } catch (e) {}
  return ACTIVE_VPS_TUNNEL.replace(/\/+$/, '');
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
  'POL',
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
  POL: '#8247e5',
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
