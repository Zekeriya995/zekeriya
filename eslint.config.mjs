import globals from 'globals';
import js from '@eslint/js';

/**
 * NEXUS PRO — ESLint flat config.
 *
 * The codebase is legacy-style ES5 vanilla JS (var, no modules) split across
 * a browser bundle (app.js, sw.js) and a Node server (server.js). Rules are
 * tuned to catch real bugs without drowning the project in warnings from the
 * existing minified-style code — stricter rules can be ratcheted on later.
 */
export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**'],
  },

  /* Baseline recommended rules */
  js.configs.recommended,

  /* Browser bundle — app.js */
  {
    files: ['app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        /* Telegram WebApp SDK, injected at runtime */
        Telegram: 'readonly',
        /* Optional runtime override for the proxy URL */
        NEXUS_PROXY: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-inner-declarations': 'off',
      'no-redeclare': 'off',
      'no-undef': 'warn',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-cond-assign': 'off',
      'no-misleading-character-class': 'off',
      /* Real bug catchers — keep these as errors */
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },

  /* Service worker */
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
    },
  },

  /* Node server */
  {
    files: ['server.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
