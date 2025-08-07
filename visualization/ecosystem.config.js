module.exports = {
  apps: [{
    name: 'ordr-fm-visualization',
    script: 'server.js',
    
    // Production environment
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    
    // Development environment  
    env_development: {
      NODE_ENV: 'development',
      PORT: 3001,
      watch: true
    },
    
    // Process management
    instances: 1,
    exec_mode: 'fork',
    
    // Auto restart settings
    max_memory_restart: '500M',
    restart_delay: 2000,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Logging
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Source maps support
    source_map_support: true,
    
    // Health monitoring
    health_check_http: {
      path: '/api/health',
      port: 3001
    },
    
    // Environment variables
    env_vars: {
      'ORDRFM_DB': '../ordr.fm.metadata.db',
      'ORDRFM_STATE_DB': '../ordr.fm.state.db'
    }
  }]
};