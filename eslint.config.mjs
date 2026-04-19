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

  /* Browser bundle — app.js + extracted src/*.js (all share one global scope
     because they're loaded as plain, non-module <script> tags) */
  {
    files: ['app.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        /* Telegram WebApp SDK, injected at runtime */
        Telegram: 'readonly',
        /* Optional runtime override for the proxy URL */
        NEXUS_PROXY: 'readonly',
        /* Language toggle — declared in app.js, read by t() in
           src/translations.js. Writable because setLang / togLang reassign it. */
        lang: 'writable',
        /* Declared in src/constants.js, used across the app */
        BN: 'readonly',
        BF: 'readonly',
        CG: 'readonly',
        CB: 'readonly',
        PROXY: 'readonly',
        WL: 'writable',
        COL: 'writable',
        /* Declared in src/utils.js */
        fmt: 'readonly',
        fP: 'readonly',
        esc: 'readonly',
        h: 'readonly',
        rawHtml: 'readonly',
        setHtml: 'readonly',
        safeC: 'readonly',
        calcRSI: 'readonly',
        calcMACD: 'readonly',
        calcEMA: 'readonly',
        /* Declared in src/storage.js */
        safeGetJSON: 'readonly',
        safeGet: 'readonly',
        safeSetJSON: 'readonly',
        safeSet: 'readonly',
        safeRemove: 'readonly',
        makeDebouncedSaver: 'readonly',
        /* Declared in src/translations.js */
        TR: 'readonly',
        t: 'readonly',
        /* Declared in src/sectors.js */
        SECTORS: 'readonly',
        getCoinSector: 'readonly',
        /* Declared in src/monitor-state.js */
        MONITOR_VERSION: 'readonly',
        DEFAULT_WEIGHTS: 'readonly',
        DEFAULT_V3_WEIGHTS: 'readonly',
        monitorState: 'writable',
        factorLog: 'writable',
        supervisorData: 'writable',
        saveMonitor: 'readonly',
        saveFactorLog: 'readonly',
        saveSupervisor: 'readonly',
        /* Declared in src/notifications.js */
        notifiedSet: 'writable',
        notifHist: 'writable',
        addNotifHist: 'readonly',
        renderNotifHist: 'readonly',
        checkWatchlistAlerts: 'readonly',
        showPopup: 'readonly',
        notify: 'readonly',
        playSound: 'readonly',
        previewTone: 'readonly',
        selTone: 'readonly',
        loadToneUI: 'readonly',
        saveSoundPref: 'readonly',
        soundPref: 'writable',
        soundEnabled: 'writable',
        TG_PROXY: 'readonly',
        tgSent: 'writable',
        sendTG: 'readonly',
        tgNotify: 'readonly',
        alertPrefs: 'writable',
        saveAlertPref: 'readonly',
        /* Declared in src/whale-state.js */
        whaleWaves: 'writable',
        calcRealTotalBuy: 'readonly',
        calcWhaleAvgEntry: 'readonly',
        calcWhalePnL: 'readonly',
        calcFlowRate: 'readonly',
        /* Declared in src/portfolio.js */
        portfolio: 'writable',
        predictions: 'writable',
        activeTrades: 'writable',
        sigHist: 'writable',
        recSig: 'readonly',
        getSigTime: 'readonly',
        savePred: 'readonly',
        getAcc: 'readonly',
        sP: 'readonly',
        addPort: 'readonly',
        rmPort: 'readonly',
        renderPort: 'readonly',
        /* Declared in src/connection.js */
        apiCooldown: 'writable',
        connMetrics: 'writable',
        fj: 'readonly',
        getConnQuality: 'readonly',
        updateConnStatus: 'readonly',
        /* Defined in app.js but referenced by other modules at call time */
        T: 'writable',
        FR: 'writable',
        CBP: 'writable',
        lastDataTime: 'writable',
        timeBadge: 'readonly',
        signalQualityGate: 'readonly',
        openTrade: 'readonly',
        openCoin: 'readonly',
        closeMo: 'readonly',
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

  /* Tests — run under Node's built-in test runner; load src/*.js into the
     current global scope via vm.runInThisContext, so every browser-side
     helper they touch (esc, fmt, safeGetJSON, …) is a Node global at
     runtime. */
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        /* From src/utils.js (loaded by tests/_setup.js) */
        fmt: 'readonly',
        fP: 'readonly',
        esc: 'readonly',
        h: 'readonly',
        rawHtml: 'readonly',
        safeC: 'readonly',
        calcRSI: 'readonly',
        calcMACD: 'readonly',
        calcEMA: 'readonly',
        /* From src/storage.js */
        safeGet: 'readonly',
        safeGetJSON: 'readonly',
        safeSet: 'readonly',
        safeSetJSON: 'readonly',
        safeRemove: 'readonly',
        makeDebouncedSaver: 'readonly',
        /* From src/notifications.js (loaded in tests/load.test.js) */
        notify: 'readonly',
        /* Other globals seeded by tests for the cross-file flow check */
        whaleWaves: 'writable',
        signalQualityGate: 'writable',
        openTrade: 'writable',
        T: 'writable',
        document: 'writable',
        fetch: 'writable',
        /* Test fixtures from tests/_setup.js */
        MemStorage: 'readonly',
        localStorage: 'writable',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
