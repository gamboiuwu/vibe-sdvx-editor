# vibe-editr — Claude working reference

> Read this before touching any file. It encodes the non-obvious parts of the codebase so you don't have to re-explore them.

## Identity
Browser-based SDVX chart editor. Vanilla JS ES2020+, no bundler, no framework. Single HTML page, everything is a global. Entry point: `index.html`.

## File map (dependency order = load order)
```
js/logger.js     — console.error patch + error badge (#error-badge)
js/effects.js    — EFFECT_DEFS, makeEffectInstance(), effectToKsh()
js/chart.js      — ChartData class, TICKS_PER_BEAT=48, TICKS_PER_MEASURE=192, LANE constants
js/renderer.js   — Renderer class (2D canvas), laserColors, C (color palette), layout constants
js/game.js       — GameView class (3D canvas), _grade(), countChain()
js/ksh.js        — importKsh(), exportKsh()
js/kson.js       — importKson(), exportKson(), KSON_TPB=240, KSH_TO_KSON=5
js/calibration.js
js/i18n.js
js/app.js        — ALL state, playback, events, undo, tabs, modals (8 700+ lines)
js/dock.js       — dockInit/Register/ApplyLayout/Float/To/Toggle
js/tools.js      — initTools(), TOOL_REGISTRY (22 tools), TOOL_SETTINGS
js/gameplay.js   — initGameplay(), gpStats(), scoring panel
```

Scripts load in body order. **Globals from earlier files are available to later ones.**  
Cache-bust query strings (`?v=N`) on renderer/game/ksh/kson/app/dock/tools/gameplay — bump N when breaking those files.

## Critical constants
```
TICKS_PER_BEAT    = 48   (chart.js)
TICKS_PER_MEASURE = 192  (chart.js)
LASER_SLAM_TICKS  = 12   (chart.js, mutable via prefs)
KSON_TPB          = 240  (kson.js) — KSON uses 240 ticks/beat, NOT 48
KSH_TO_KSON       = 5   — multiply editor ticks by 5 to get KSON ticks
DOCK_SNAP_PX      = 60   (dock.js)
APP_VERSION       = 'x.x.x'  (app.js:47)
```

## Data model — ChartData (chart.js:26)
```js
chart.bt[0..3]          // BT-A/B/C/D — arrays of { y, len }
chart.fx[0..1]          // FX-L/R     — arrays of { y, len }
chart.lasers[0..1]      // left/right — arrays of sections:
  section: { y, points: [{ ry, v, slam?, interp, curve }], wide }
  // v ∈ [0,1]: 0=far left, 1=far right
  // ry: relative tick from section.y
chart.bpmEvents         // [{ y, bpm }] sorted asc
chart.timeSigEvents     // [{ measure, num, den }] sorted asc
chart.fxChains[0..1]    // [{ type, enabled, params }]
chart.meta              // title, artist, bpm, offset, level, etc.
```

## Key globals (app.js)
```js
chart        // active ChartData
renderer     // Renderer instance
gameView     // GameView instance
tool         // 'select'|'bt'|'fx'|'laser-l'|'laser-r'|'erase'
snap         // snap ticks (e.g. 12 = 1/16)
laserXSnap   // X-snap divisor (0 = free)
playing      // boolean
viewMode     // 'edit'|'game'|'split'
tabs[]       // [{ name, chart, audioBuffer }]
activeTabIdx
undoStack[], redoStack[], MAX_UNDO
_initErrors[], _initPhase  // pre-init error capture system
```

## Mandatory patterns

**Before any chart mutation:** call `saveUndo(label)` first, then modify, then `render()`.  
```js
saveUndo('My action label');
chart.bt[laneIdx].push({ y: tick, len: 0 });
render();
```

**Snap a tick:** `snapTick(tick)` — always snap user-placed ticks through this.  
**Snap a laser X:** `snapLaserV(v)` — always snap laser v [0,1] through this.

**Version bump** (any user-facing change):
1. `app.js:47` → `APP_VERSION = 'x.x.x'`
2. `app.js:48` → prepend entry to `CHANGELOG` array
3. `vibe-editr-docs.html` → update version badge + add entry

**Dock registration** (app.js bottom, in a `setTimeout(() => {...}, 150)` after DOMContentLoaded):
```js
dockRegister(id, element, 'Label', '⚙', 'float'|'left'|'right'|'bottom', opts);
// opts.nativeFloat = true  → for .tw-window (flex column windows like Tools Hub)
// opts.floatW/floatH       → initial float size
```

## Non-obvious gotchas

**KSON tick scale:** All KSON `y`/`ry` values are `×5` vs internal ticks. Import divides, export multiplies. Never mix scales.

**KSH FX encoding is INVERTED vs BT:**
- BT: `0`=empty, `1`=chip, `2`=hold
- FX: `0`=empty, `2`=chip, `1`=hold

**LANE constants vs array index:**
```js
// chart.bt uses 0-3 (BT-A/B/C/D)
// chart.fx uses 0-1 (FX-L/R)
// LANE.BT_A=1, LANE.BT_B=2 etc. are KSH column numbers — NOT array indices
```

**Laser section connect threshold = 192 ticks (1 measure).** `addLaserPoint` auto-appends to an existing section if its last tick is within 192 ticks. Pass `forceNew=true` to override.

**`laserColors` in renderer.js** is the runtime laser color object used by BOTH renderer.js (2D) and game.js (3D). Changing colors goes through `applyLaserPreset()` or `setLaserColorCustom()`.

**Audio context is lazy.** `audioCtx` starts null. Call `ensureAudioCtx()` before any Web Audio API use.

**FX effects wet/dry:** `_fxDryGain` + `_fxWetGain` always sum to 1.0. When active: dry = `1 - mix/100`, wet = `mix/100`. Always call `_teardownFxEffect()` before switching effect types.

**`_loadingDone()` stays visible if `_initErrors.length > 0`.** It shows error count + "Continue anyway" button instead of fading. The `_initPhase` string in each error message comes from the `_initPhase = 'stage-name'` markers set throughout DOMContentLoaded.

**`dockRegister` runs inside a `setTimeout(..., 150)`** to let tools.js finish building `.tw-window` first.

## Adding a new tool (Tools Hub)
1. `tools.js:7` → add to `TOOL_REGISTRY`: `{ id, cat, label, icon }`
2. `tools.js:39` → optionally add to `TOOL_SETTINGS`: `{ id: { key: { label, type, def, ... } } }`
3. `tools.js` → add `case 'your-id':` in `_renderTool(c)` switch → call `_toolYourTool(c)`
4. `tools.js` → implement `function _toolYourTool(c) { /* build UI in c (the content div) */ }`

## Adding a dock panel
1. Have the element in the DOM (index.html or dynamically created)
2. In the `setTimeout(..., 150)` block at the bottom of app.js:
   ```js
   dockRegister('panel-id', document.getElementById('panel-id'), 'Label', '⊛', 'right');
   ```
3. Wire a Window menu toggle: `dockToggle('panel-id')`

## Branch & PR
- Branch: `claude/amazing-newton-PLJMB`
- Push: `git push -u origin claude/amazing-newton-PLJMB`
- Always create a PR after pushing (GitHub MCP tools: `mcp__github__*`)

## DEVELOPER.md
Full reference with all data structures, function descriptions, audio node graph, rendering pipeline details, and "how to" guides. Read it when CLAUDE.md doesn't have enough detail.
