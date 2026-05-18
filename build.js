#!/usr/bin/env node
/**
 * vibe-editr production build
 * Concatenates all JS in load order, minifies with esbuild, and outputs
 * dist/bundle.min.js + dist/index.html ready for static hosting.
 *
 * Usage:
 *   npm run build          — full production bundle
 *   npm run build:watch    — rebuild on file change (dev loop)
 */
'use strict';

const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ── JS load order — must match the <script> sequence in index.html ────────────
const JS_FILES = [
  'js/logger.js',
  'js/effects.js',
  'js/chart.js',
  'js/renderer.js',
  'js/game.js',
  'js/velenv.js',
  'js/ksh.js',
  'js/kson.js',
  'js/calibration.js',
  'js/i18n.js',
  'js/gl-lane.js',
  'js/app.js',
  'js/dock.js',
  'js/tools.js',
  'js/heatmap.js',
  'js/radar.js',
  'js/handsim.js',
  'js/gameplay.js',
];

// PowerGlitch no-op stub (used when CDN unavailable; real lib loaded from CDN at runtime)
const POWERGLITCH_STUB =
  "window.PowerGlitch=window.PowerGlitch||{glitch:function(){return{startGlitch:function(){},stopGlitch:function(){}};}};";

async function build(watch) {
  fs.mkdirSync(DIST, { recursive: true });

  // ── 1. Concatenate JS ───────────────────────────────────────────────────────
  // Strip per-file 'use strict' to avoid duplicate directives in concat output
  const parts = JS_FILES.map(f => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return src.replace(/^[ \t]*['"]use strict['"];?[ \t]*\r?\n/m, '');
  });

  const combined = [
    "'use strict';",
    POWERGLITCH_STUB,
    ...parts,
  ].join('\n');

  // ── 2. Minify ───────────────────────────────────────────────────────────────
  const result = await esbuild.transform(combined, {
    minify:    true,
    target:    'es2020',
    logLevel:  'warning',
  });

  const bundlePath = path.join(DIST, 'bundle.min.js');
  fs.writeFileSync(bundlePath, result.code);

  const rawKB  = (Buffer.byteLength(combined, 'utf8') / 1024).toFixed(1);
  const minKB  = (Buffer.byteLength(result.code, 'utf8') / 1024).toFixed(1);
  const saving = Math.round((1 - result.code.length / combined.length) * 100);
  console.log(`\x1b[96m[build]\x1b[0m JS: ${rawKB} KB → \x1b[92m${minKB} KB\x1b[0m (${saving}% smaller)`);

  // ── 3. Generate dist/index.html ─────────────────────────────────────────────
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // Remove preload hints (irrelevant with single bundle)
  html = html.replace(/<link rel="preload"[^>]*>\n?/g, '');
  html = html.replace(/<link rel="dns-prefetch"[^>]*>\n?/g, '');

  // Replace every <script src="..."> line (individual files + CDN) with bundle
  html = html.replace(
    /[ \t]*<script src="(?:https:\/\/unpkg\.com\/[^"]*|js\/[^"]*)"[^>]*><\/script>\n?/g,
    ''
  );

  // Inject bundle before </body>
  html = html.replace('</body>', '  <script src="bundle.min.js"></script>\n</body>');

  fs.writeFileSync(path.join(DIST, 'index.html'), html);
  console.log(`\x1b[96m[build]\x1b[0m dist/index.html written`);

  // ── 4. Copy static assets ───────────────────────────────────────────────────
  for (const asset of ['style.css', 'fonts', 'sounds']) {
    const src = path.join(ROOT, asset);
    if (!fs.existsSync(src)) continue;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDir(src, path.join(DIST, asset));
    } else {
      fs.copyFileSync(src, path.join(DIST, asset));
    }
  }
  console.log(`\x1b[96m[build]\x1b[0m static assets copied`);
  console.log(`\x1b[92m[build]\x1b[0m \x1b[1mDone — serve dist/ for production\x1b[0m`);

  if (watch) watchSources();
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry), d = path.join(dest, entry);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function watchSources() {
  let timer = null;
  const trigger = () => { clearTimeout(timer); timer = setTimeout(() => build(true), 300); };
  for (const f of JS_FILES) fs.watch(path.join(ROOT, f), trigger);
  fs.watch(path.join(ROOT, 'style.css'), trigger);
  fs.watch(path.join(ROOT, 'index.html'), trigger);
  console.log('\x1b[2m[build] watching for changes…\x1b[0m');
}

const watch = process.argv.includes('--watch');
build(watch).catch(err => { console.error(err); process.exit(1); });
