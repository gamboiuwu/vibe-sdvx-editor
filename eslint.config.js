// ESLint flat config for vibe-editr
// Run:  npx eslint js/       — lint all source modules
//       npx eslint js/app.js — lint a single file
'use strict';

const globals = require('globals');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    // Source files only — skip build output and node_modules
    files: ['js/**/*.js'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script', // not ES modules — all files share the global scope
      globals: {
        // Browser built-ins
        ...globals.browser,

        // ── vibe-editr globals ────────────────────────────────────────────────
        // Core data (app.js)
        chart:             'writable',
        tabs:              'writable',
        activeTabIdx:      'writable',
        renderer:          'writable',
        gameView:          'writable',
        playing:           'writable',
        tool:              'writable',
        snap:              'writable',
        sel:               'writable',
        drag:              'writable',
        undoStack:         'writable',
        redoStack:         'writable',
        viewMode:          'writable',
        chartSpeed:        'writable',
        prefs:             'writable',

        // Public API (app.js)
        render:            'readonly',
        saveUndo:          'readonly',
        updateSeekbar:     'readonly',
        switchToTab:       'readonly',
        addChartAnnotation:'readonly',
        ensureAudioCtx:    'readonly',
        stopPlay:          'readonly',
        startPlay:         'readonly',
        updateRadar:       'readonly',
        tickToSeconds:     'readonly',
        secondsToTick:     'readonly',

        // Chart model constants (chart.js)
        TICKS_PER_MEASURE: 'readonly',
        TICKS_PER_BEAT:    'readonly',
        BEATS_PER_MEASURE: 'readonly',
        ChartData:         'readonly',
        LASER_SLAM_TICKS:  'readonly',

        // i18n (i18n.js)
        t:                 'readonly',

        // Format parsers/serializers (ksh.js, kson.js)
        parseKSH:          'readonly',
        serializeKSH:      'readonly',
        parseKSON:         'readonly',
        serializeKSON:     'readonly',

        // Effect definitions (effects.js)
        EFFECT_DEFS:       'readonly',

        // Rendering
        Renderer:          'readonly',
        GameView:          'readonly',
        laserColors:       'readonly',

        // Window managers
        openToolsWindow:   'readonly',
        openCalibration:   'readonly',
        openVelEnvWindow:  'readonly',
        openHeatmap:       'readonly',
        openRadar:         'readonly',
        openHandSim:       'readonly',
        openGameplay:      'readonly',
        dockInit:          'readonly',
        velEnvEditor:      'writable',

        // Optional external library
        PowerGlitch:       'readonly',

        // ── Cross-file helpers defined in renderer.js, game.js, tools.js, etc. ─
        GLLaneRenderer:           'readonly',
        HOLD_SAMPLE:              'readonly',
        LASER_PRESETS:            'readonly',
        applyLaserPreset:         'readonly',
        applyLocalization:        'readonly',
        audioBuffer:              'writable',
        buildLaneHeader:          'readonly',
        calibrationWindow:        'writable',
        closeHandSimWindow:       'readonly',
        dockApplyLayout:          'readonly',
        dockRegister:             'readonly',
        dockToggle:               'readonly',
        downloadText:             'readonly',
        effectToKsh:              'readonly',
        exportKsh:                'readonly',
        exportKson:               'readonly',
        exportKsonPack:           'readonly',
        highQualityRendering:     'writable',
        importKsh:                'readonly',
        importKson:               'readonly',
        importKsonPack:           'readonly',
        laserCharToPos:           'readonly',
        laserOpacity:             'writable',
        laserPosToChar:           'readonly',
        laserWideMode:            'writable',
        logger:                   'readonly',
        makeEffectInstance:       'readonly',
        openHandSimWindow:        'readonly',
        openHeatmapWindow:        'readonly',
        openRadarWindow:          'readonly',
        openVelEnvEditor:         'readonly',
        savePrefsToLocalStorage:  'readonly',
        setLaserColorCustom:      'readonly',
        toggleGameplayPanel:      'readonly',
        toggleVelEnvEditor:       'readonly',
        updateContextPalette:     'readonly',
        updateGlitchEventList:    'readonly',
        updateHeatmap:            'readonly',
        updateScrollSpeedEventList:'readonly',
        updateSnapDisplay:        'readonly',

        // ── renderer.js internal helpers used from app.js ─────────────────────
        _multiViews:              'writable',
        _rdrVisible:              'writable',
        _smoothActiveLaser:       'writable',
        _startRdrLoop:            'readonly',
      },
    },
    rules: {
      // ── Errors ──────────────────────────────────────────────────────────────
      'no-undef':         'error',   // catch typos that reference undefined names
      'no-unreachable':   'error',
      'no-duplicate-case':'error',
      'use-isnan':        'error',
      'valid-typeof':     'error',

      // ── Quality warnings ────────────────────────────────────────────────────
      'no-unused-vars':  ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console':      'off',      // console.log is used for debugging; keep it
      'no-debugger':     'warn',

      // ── Style (warn only — this codebase has its own conventions) ───────────
      'eqeqeq':          ['warn', 'smart'],
      'no-var':          'warn',     // prefer const/let; existing var usage won't break
      'prefer-const':    ['warn', { destructuring: 'all' }],

      // ── Off — would require too many changes to the existing codebase ───────
      'no-redeclare':    'off',      // some globals are re-declared in init functions
    },
  },
];
