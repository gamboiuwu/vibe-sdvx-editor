# vibe-editr — Claude Code Guide

Quick-reference for AI-assisted development. Read this before touching any source file.

---

## Architecture in one paragraph

Pure vanilla-JS browser app. No framework, no bundler required (optional esbuild build in `build.js`). All state lives in globals declared in `app.js`. `ChartData` (chart.js) is the only data model. Two rendering paths: `Renderer` (canvas 2D, top-down edit view) and `GameView` (canvas 2D with software perspective, 3D preview). The UI chrome is assembled from raw HTML in `index.html` (~1440 lines). All scripts are loaded with `defer` so they execute after full DOM parse, in document order.

---

## File map

| File | Role | Key exports/globals |
|------|------|---------------------|
| `js/chart.js` | Data model | `ChartData`, `TICKS_PER_MEASURE=192`, `TICKS_PER_BEAT=48`, `BEATS_PER_MEASURE=4` |
| `js/app.js` | App orchestrator | `chart`, `tabs[]`, `renderer`, `gameView`, `playing`, `snap`, `tool`, `saveUndo()`, `render()`, `APP_VERSION`, `CHANGELOG` |
| `js/renderer.js` | 2D edit canvas | `Renderer` class, `laserColors` |
| `js/game.js` | 3D preview canvas | `GameView` class |
| `js/ksh.js` | KSH ↔ ChartData | `parseKSH()`, `serializeKSH()` |
| `js/kson.js` | KSON ↔ ChartData | `parseKSON()`, `serializeKSON()` |
| `js/effects.js` | FX definitions | `EFFECT_DEFS` |
| `js/tools.js` | Tools Hub window | `TOOL_REGISTRY`, `TOOL_SETTINGS`, `openToolsWindow()`, `initTools()` |
| `js/dock.js` | Docking workspace | `DockManager`, `dockInit()` |
| `js/calibration.js` | Calibration window | `openCalibration()` |
| `js/velenv.js` | Velocity envelope editor | `openVelEnvWindow()` |
| `js/heatmap.js` | Intensity heatmap window | `openHeatmap()` |
| `js/radar.js` | Pattern radar window | `openRadar()`, `updateRadar()` |
| `js/handsim.js` | Hand simulator window | `openHandSim()` |
| `js/gameplay.js` | Gameplay score panel | `openGameplay()` |
| `js/gl-lane.js` | WebGL lane renderer (optional) | `GlLane` |
| `js/logger.js` | Error badge | `logError()` |
| `js/i18n.js` | Translations | `t(key)`, `setLang()` |
| `style.css` | All styles | 3100 lines, dark theme |
| `index.html` | Shell + all menus | 1440 lines, NO inline JS |
| `server.js` | Dev HTTP server | gzip, in-memory cache, COOP/COEP headers |
| `build.js` | esbuild prod bundle | `npm run build` → `dist/bundle.min.js` |

---

## ChartData structure

```js
chart.meta          // { title, artist, effect, illust, difficulty, level, bpm, music, offset, … }
chart.bt[0..3]      // BT-A..D lanes — [{y:tick, len:0|n}, …]  len=0 → chip
chart.fx[0..1]      // FX-L/R lanes — [{y:tick, len:0|n}, …]
chart.lasers[0..1]  // L/R laser sections — [{y:tick, points:[{ry, v}], wide}, …]
chart.bpmEvents     // [{y:tick, bpm}, …]
chart.timeSigEvents // [{measure, num, den}, …]
chart.scrollSpeedEvents // [{y:tick, speed:float, interp?:'step'|'linear'}, …]
chart.glitchEvents  // [{y:tick, level:0-10}, …]
chart.cameraEvents  // [{y:tick, type, value}, …]
chart.stopEvents    // [{y:tick, len:ticks}, …]
chart.fxChains      // [[effectObj, …], [effectObj, …]]  L/R chains
chart.totalMeasures // int
```

Ticks: 192 ticks = 1 measure (4/4). 48 ticks = 1 beat. 12 ticks = 1/16 note.

---

## Key globals (app.js)

```js
chart          // active ChartData — always the current tab's chart
tabs[]         // [{name, chart, audioBuffer, hispeed}, …]
activeTabIdx   // int
renderer       // Renderer instance (edit canvas)
gameView       // GameView instance (3D preview canvas)
playing        // bool — true during playback
tool           // 'select'|'bt'|'fx'|'laser-l'|'laser-r'|'erase'
snap           // ticks per grid division (e.g. 12 = 1/16)
sel            // {active, startTick, endTick, clipboard}
undoStack / redoStack

saveUndo(label)   // snapshot chart state before a mutation
render()          // redraw 2D edit canvas
updateSeekbar(t)  // sync seek bar to tick t
updateRadar()     // refresh pattern radar if open
```

---

## Adding a new tool to Tools Hub

1. **Register** in `TOOL_REGISTRY` array (tools.js line ~8):
   ```js
   { id: 'my-tool', cat: 'Edit', label: 'My Tool', icon: '◉' }
   ```
2. **Settings schema** (optional) in `TOOL_SETTINGS` (tools.js line ~42):
   ```js
   'my-tool': [{ key:'foo', label:'Foo', type:'toggle', default:true }]
   ```
3. **Wire dispatch** in `_renderTool()` switch (tools.js ~line 513):
   ```js
   case 'my-tool': return _toolMyTool(container);
   ```
4. **Implement** `_toolMyTool(c)` before the Bootstrap section (tools.js end).
   Use helpers: `_section(title)`, `_h(tag,cls,html)`, `_row(label, input)`,
   `_btn(label, cls)`, `_subDesc(sec, text)`.
   Access chart via `const ch = (typeof chart !== 'undefined') ? chart : null`.
   Commit mutations with `saveUndo('label')` then call `render()`.

---

## Adding a menu item

All menus live in `index.html`. Find the relevant `<div class="menu-dropdown">` and add:
```html
<button class="menu-item" id="btn-my-action">My Action  <kbd>Ctrl+?</kbd></button>
```
Then wire it in `app.js` inside the big `DOMContentLoaded` block:
```js
document.getElementById('btn-my-action').addEventListener('click', () => { … });
```

---

## Updating the changelog

Two places must stay in sync:

1. **`js/app.js`** top — `APP_VERSION` string + `CHANGELOG` array (most-recent first).
   Each entry: `{ version, title, entries: [['add'|'fix'|'chg', 'HTML description'], …] }`

2. **`vibe-editr-docs.html`** — `#updates` section and the `.cover .version` tag.
   Copy the CSS pattern from an existing `.update-entry` div.

---

## Build & run

```bash
node server.js          # dev server on :3000 (gzip, in-memory cache)
npm run build           # → dist/bundle.min.js + dist/index.html  (production)
npm run build:watch     # rebuild on change
```

`dist/` is git-ignored. To deploy to GitHub Pages, run `npm run build` and push `dist/`.

---

## Patterns to follow

- **No frameworks** — vanilla JS only.
- **KSON-first** — always mutate `ChartData`, never raw format strings.
- **Undo before mutations** — call `saveUndo()` before modifying `chart`.
- **Guard chart access** — `const ch = (typeof chart !== 'undefined') ? chart : null; if (!ch) return;`
- **No comments explaining what** — only write comments for non-obvious WHY.
- **Experimental features** — add as opt-in toggles; mark `[Experimental]` in CHANGELOG.
- **Version bumps** — increment `APP_VERSION` and add CHANGELOG entry for every user-visible change.

---

## Common gotchas

- `TICKS_PER_BEAT = 48` (not 48.0). Integer math throughout.
- Laser notes use `ry` (relative tick from section start), not absolute tick.
- `chart.bt[lane]` is NOT sorted by tick — sort if you need order.
- `defer` on all scripts means `DOMContentLoaded` has already fired when each module executes. The `if (document.readyState === 'loading')` guard at the bottom of dock.js and tools.js handles this.
- PowerGlitch loads from CDN; the inline `onerror` fallback in index.html ensures the app works offline.
