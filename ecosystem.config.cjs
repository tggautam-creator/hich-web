/**
 * PM2 Ecosystem Config — HICH Server
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 reload ecosystem.config.cjs --env production   # zero-downtime reload
 *   pm2 save                                           # persist across reboots
 *   pm2 startup                                        # enable auto-start on boot
 */

module.exports = {
  apps: [
    {
      name: 'hich-server',
      script: './node_modules/.bin/tsx',
      args: '--env-file=.env server/index.ts',

      // Fork mode required when using tsx as the script
      instances: 1,
      exec_mode: 'fork',

      // Restart policy
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 2000,

      // Memory limit — restart worker if it exceeds 512 MB
      max_memory_restart: '512M',

      // Graceful shutdown: wait for in-flight requests (matches server SIGTERM handler)
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 10000,

      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Load .env file
      env_file: '.env',

      env: {
        NODE_ENV: 'development',
      },

      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
}
