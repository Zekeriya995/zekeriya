// PM2 process descriptor for the Express proxy.
// Used by `vps/deploy.sh` and any manual `pm2 startOrReload` call.
module.exports = {
  apps: [
    {
      name: 'nexus-proxy',
      script: 'server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        /* Bitfinex burst-throttle tuning (chronic-429 fix, verified live on
           the VPS 2026-06-01). A batch of 1 pair (2 requests) with a 2s gap
           held a stable 9-10/10 pairs where the in-code defaults (2 pairs /
           300ms) still stormed against Bitfinex's per-IP rate limit. Pinned
           here so a pm2 reload / reboot keeps the tuned values instead of
           reverting. Tune further via these same keys if Bitfinex tightens. */
        BITFINEX_BATCH_SIZE: '1',
        BITFINEX_BATCH_GAP_MS: '2000',
        /* Footprint cap — Bitfinex IP-rate-limited the host (a single request
           429s) even at the throttled rate, so fetch only the top N pairs
           (2 = BTC/ETH) to let the penalised IP recover. 0 disables Bitfinex;
           raise (≤17) to re-expand once it recovers. */
        BITFINEX_MAX_PAIRS: '2',
      },
      watch: false,
      time: true,
      merge_logs: true,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
    },
  ],
};
