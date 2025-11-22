module.exports = {
  apps: [{
    name: 'cutup-api',
    script: 'server.js',
    instances: 1, // Start with 1 instance to avoid port conflicts
    exec_mode: 'fork', // Use fork mode instead of cluster
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: '/var/log/cutup/error.log',
    out_file: '/var/log/cutup/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false,
    ignore_watch: ['node_modules', 'logs']
  }]
};

