// ESLint configuration for ordr.fm visualization (CommonJS)
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        global: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        
        // Browser globals (for client-side JS)
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        Notification: 'readonly',
        getComputedStyle: 'readonly',
        Event: 'readonly',
        
        // Browser APIs for PWA/testing
        caches: 'readonly',
        indexedDB: 'readonly'
      }
    },
    rules: {
      // Error prevention
      'no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-unreachable': 'error',
      
      // Code quality
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': 'error',
      'curly': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      
      // Best practices
      'no-console': 'warn', // Allow console for server-side logging
      'no-debugger': 'error',
      'no-alert': 'error',
      'radix': 'error',
      'yoda': 'error',
      
      // Style (delegated to Prettier mostly)
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'never']
    }
  },
  {
    // Server-side specific rules
    files: ['server.js', 'src/**/*.js'],
    rules: {
      'no-console': 'off' // Allow console.log in server code
    }
  },
  {
    // Test files - more relaxed rules
    files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
    rules: {
      'no-console': 'off', // Allow console in tests
      'no-unused-vars': ['error', { 
        argsIgnorePattern: '^_|^config$|^browserName$',
        varsIgnorePattern: '^_|modal|error|event|e$'
      }]
    }
  }
];