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
      env: { NODE_ENV: 'production' },
      watch: false,
      time: true,
      merge_logs: true,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
    },
  ],
};
