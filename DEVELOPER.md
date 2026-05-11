# vibe-editr — Developer Reference

**Project:** vibe-editr (internal codename: kson-game)
**Author:** gamboiuwu
**Stack:** Vanilla JavaScript (ES2020+), Web Audio API, Canvas 2D API, HTML5, CSS3
**Entry point:** `index.html`

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Flow](#3-data-flow)
4. [File-by-File Breakdown](#4-file-by-file-breakdown)
   - 4.1 [index.html](#41-indexhtml)
   - 4.2 [style.css](#42-stylecss)
   - 4.3 [chart.js](#43-chartjs)
   - 4.4 [renderer.js](#44-rendererjs)
   - 4.5 [game.js](#45-gamejs)
   - 4.6 [app.js](#46-appjs)
   - 4.7 [effects.js](#47-effectsjs)
   - 4.8 [ksh.js](#48-kshjs)
   - 4.9 [kson.js](#49-ksonjs)
   - 4.10 [dock.js](#410-dockjs)
   - 4.11 [tools.js](#411-toolsjs)
   - 4.12 [gameplay.js](#412-gameplayjs)
5. [Key Data Structures](#5-key-data-structures)
   - 5.1 [ChartData](#51-chartdata)
   - 5.2 [Note Objects](#52-note-objects)
   - 5.3 [Laser Sections and Points](#53-laser-sections-and-points)
   - 5.4 [BPM Events](#54-bpm-events)
   - 5.5 [Time Signature Events](#55-time-signature-events)
   - 5.6 [FX Effect Instances](#56-fx-effect-instances)
6. [Tick System and Timing](#6-tick-system-and-timing)
7. [Audio System](#7-audio-system)
   - 7.1 [Audio Node Graph](#71-audio-node-graph)
   - 7.2 [Laser Filter](#72-laser-filter)
   - 7.3 [FX Effects Chain](#73-fx-effects-chain)
   - 7.4 [Sound Effects (SFX)](#74-sound-effects-sfx)
8. [Rendering Pipeline](#8-rendering-pipeline)
   - 8.1 [2D Edit View (renderer.js)](#81-2d-edit-view-rendererjs)
   - 8.2 [3D Game Preview (game.js)](#82-3d-game-preview-gamejs)
   - 8.3 [Projection Modes](#83-projection-modes)
9. [Docking System (dock.js)](#9-docking-system-dockjs)
10. [Tools Hub (tools.js)](#10-tools-hub-toolsjs)
11. [Chart Formats](#11-chart-formats)
    - 11.1 [KSH Format](#111-ksh-format)
    - 11.2 [KSON Format](#112-kson-format)
    - 11.3 [Tick Conversion](#113-tick-conversion)
12. [Gameplay System (gameplay.js)](#12-gameplay-system-gameplayjs)
13. [Key Variables Reference](#13-key-variables-reference)
14. [Actively Running Functions (Per-Frame)](#14-actively-running-functions-per-frame)
15. [Background / Init Functions (Run Once)](#15-background--init-functions-run-once)
16. [Undo / Redo System](#16-undo--redo-system)
17. [Session Persistence and Autosave](#17-session-persistence-and-autosave)
18. [How to Modify Common Things](#18-how-to-modify-common-things)
    - 18.1 [Add a New Drawing Tool](#181-add-a-new-drawing-tool)
    - 18.2 [Change Timing Constants](#182-change-timing-constants)
    - 18.3 [Add a New FX Effect Type](#183-add-a-new-fx-effect-type)
    - 18.4 [Add a New Dock Panel](#184-add-a-new-dock-panel)
    - 18.5 [Change Laser Colors / Presets](#185-change-laser-colors--presets)
    - 18.6 [Change Score Thresholds or Grade Boundaries](#186-change-score-thresholds-or-grade-boundaries)
19. [Keyboard Shortcuts Reference](#19-keyboard-shortcuts-reference)
20. [Error Handling and Logging](#20-error-handling-and-logging)

---

## 1. Project Overview

**vibe-editr** is a fully browser-based SDVX (Sound Voltex) chart editor. It lets users author, preview, import, and export rhythm game charts in both KSH (legacy text format) and KSON (modern JSON format) without any server, login, or installation. Everything runs in a single HTML page using only Web APIs.

### What it does

- **2D edit view:** Multi-column scrolling canvas showing BT notes, FX holds, and laser curves in a top-down layout. Notes are placed by clicking with the active tool.
- **3D game preview:** A real-time SDVX-style 3D lane using Canvas 2D with a hand-rolled perspective projection. Supports orthographic, SDVX arcade, and hybrid modes.
- **Audio playback:** Syncs music audio to chart time using the Web Audio API. Realtime laser filter (peak EQ, low-pass, high-pass, bit-crusher) modulates the sound based on laser position.
- **FX effects:** Per-lane FX hold notes trigger audio effects (wobble, gate, echo, sidechain) on the music bus through a wet/dry routing network.
- **Import/Export:** Full round-trip support for `.ksh` and `.kson` chart files.
- **Tab system:** Multiple charts open simultaneously in tabs, with drag-to-reorder.
- **Docking workspace:** Photoshop-style panels that can be docked left, right, bottom, or floated freely.
- **Tools Hub:** 20 analysis and editing tools (difficulty curve, heatmap, laser smoothing, etc.).
- **Autosave:** IndexedDB-backed autosave with recovery.

### Technology Stack

| Layer | Technology |
|---|---|
| UI Structure | HTML5 |
| Styling | CSS3 (CSS variables, flex, grid) |
| Logic | Vanilla JavaScript ES2020+ (`'use strict'`, classes, async/await) |
| 2D Drawing | Canvas 2D API |
| 3D Preview | Canvas 2D API (software perspective) |
| Audio | Web Audio API |
| Persistence | `localStorage` (prefs, dock layout), IndexedDB (autosave) |
| File I/O | `FileReader`, `Blob`, `URL.createObjectURL` |

No build tools, no frameworks, no bundlers. All scripts are loaded sequentially via `<script>` tags.

---

## 2. Architecture Overview

```
index.html
├── style.css                 (all CSS)
├── js/logger.js              (error badge logger, loaded first)
├── js/effects.js             (EFFECT_DEFS, makeEffectInstance, effectToKsh)
├── js/chart.js               (ChartData class — core data model)
├── js/renderer.js            (Renderer class — 2D edit canvas + laserColors globals)
├── js/game.js                (GameView class — 3D preview canvas)
├── js/ksh.js                 (importKsh, exportKsh)
├── js/kson.js                (importKson, exportKson)
├── js/app.js                 (main orchestrator: state, playback, UI events)
├── js/dock.js                (DockManager — dockable workspace)
├── js/tools.js               (Tools Hub floating window)
└── js/gameplay.js            (Gameplay scoring panel)
```

All files are loaded in the order above. Earlier files define globals that later files depend on. There is no module system — every `const`, `class`, and `function` at the top level is a global.

### Dependency Order

```
logger.js          → standalone (no deps)
effects.js         → standalone (EFFECT_DEFS registry)
chart.js           → uses TICKS_PER_MEASURE, LASER_SLAM_TICKS
renderer.js        → uses ChartData, TICKS_PER_MEASURE, TICKS_PER_BEAT
game.js            → uses ChartData, TICKS_PER_MEASURE, laserColors, laserOpacity
ksh.js             → uses ChartData, LASER_CHARS, effectToKsh, makeEffectInstance
kson.js            → uses ChartData, TICKS_PER_BEAT, KSH_TO_KSON
app.js             → uses ALL of the above + DOM
dock.js            → uses DOM (runs after app.js sets up the DOM)
tools.js           → uses DOM, dock.js
gameplay.js        → uses gameView, renderer, chart, prefs (all from app.js)
```

---

## 3. Data Flow

```
User interaction (click/keydown)
         │
         ▼
   app.js event handlers
         │
    ┌────┴────────────────────────┐
    │ Modify ChartData object     │
    │ (addBtNote, addLaserPoint…) │
    └────┬────────────────────────┘
         │
    saveUndo() → undoStack[]
         │
    render() → Renderer.draw()
    gameView.draw() (if preview visible)
         │
    ┌────┴──────────────────────────────┐
    │ Canvas 2D draws updated chart     │
    └───────────────────────────────────┘

Playback (Space key)
         │
    startPlay()
         │
    requestAnimationFrame(playFrame) ──► loop
         │
    ┌────┴─────────────────────────────────────┐
    │ Advance playTick from Web Audio clock    │
    │ detectSlams / detectFxHits / detectBtHits│
    │ updateLaserFilter(tick)                  │
    │ updateFxEffects(tick)                    │
    │ Renderer.draw() [2D]                     │
    │ GameView.draw() [3D, FPS capped]         │
    └──────────────────────────────────────────┘
```

---

## 4. File-by-File Breakdown

### 4.1 `index.html`

**Purpose:** Application shell. Defines the complete DOM structure, all modals, the menu bar, tool palette, and `<canvas>` elements. Includes all scripts in dependency order.

**Key elements:**

| Element ID | Description |
|---|---|
| `#topbar` | Fixed top menu bar (File, Edit, Chart, View, Settings, Window menus) |
| `#tab-bar` | Dynamic tab bar for multi-chart editing |
| `#toolbar` | Tool palette (Select, BT, FX, L-Laser, R-Laser, Erase, Play) |
| `#panel-meta` | Left sidebar: song metadata form fields |
| `#chart-canvas` | The 2D edit canvas (driven by `Renderer`) |
| `#panel-fx` | Right sidebar: FX chain UI, BPM/TimeSig event lists, shortcuts |
| `#game-canvas` | The 3D preview canvas (driven by `GameView`) |
| `#game-seekbar` | Scrubable playback progress bar |
| `#game-wrap` | Container for game canvas + preview controls |
| `#loading-overlay` | Fade-in startup splash with progress bar |
| `#modal-bpm` | "Add BPM Change" dialog |
| `#modal-timesig` | "Add Time Signature" dialog |
| `#modal-prefs` | System Preferences (Audio, Video, General, Gameplay, Autosave, Shortcuts) |
| `#modal-song-meta` | Song Metadata modal |
| `#modal-donate` | Support/donation modal |
| `#history-panel` | Floating undo history panel |
| `#laser-interp-menu` | Context menu for laser interpolation type (Linear/Smooth/Step) |
| `#preview-controls` | Projection + HiSpeed controls shown in game/split view |

**Script load order** (bottom of `<body>`):

```html
<script src="js/logger.js"></script>
<script src="js/effects.js"></script>
<script src="js/chart.js"></script>
<script src="js/renderer.js"></script>
<script src="js/game.js"></script>
<script src="js/ksh.js?v=2"></script>
<!-- laser-interp-menu DOM element here -->
<script src="js/kson.js"></script>
<script src="js/calibration.js"></script>
<script src="js/i18n.js"></script>
<script src="js/app.js?v=4"></script>
<script src="js/dock.js?v=5"></script>
<script src="js/tools.js?v=4"></script>
<script src="js/gameplay.js?v=2"></script>
```

The `?v=N` cache-busting suffixes must be incremented when making breaking changes to those files.

---

### 4.2 `style.css`

**Purpose:** All visual styling for vibe-editr. Uses a dark purple/navy color scheme consistent with the SDVX aesthetic.

**Key CSS variables** (defined on `:root`):

| Variable | Use |
|---|---|
| `--bg` | Main background |
| `--bg2` | Secondary background (panels) |
| `--border` | Border color |
| `--accent` | Accent color (blue) |
| `--text` | Primary text |
| `--text-dim` | Dimmed/secondary text |

**Major sections:**

- **Topbar / menus** — `.menu-group`, `.menu-dropdown`, `.menu-sub` (CSS-only hover dropdowns)
- **Tool palette** — `#toolbar`, `.tool-btn`
- **Panel layout** — `#main` flex row with `#panel-meta`, `#panel-chart`, `#panel-fx`
- **Canvas wrap** — `#canvas-wrap` scrollable container for `#chart-canvas`
- **Game wrap** — `#game-wrap` flex column for `#game-canvas` + seekbar
- **Dock system** — `.ws-root`, `.ws-main-row`, `.ws-center`, `.ws-dock-left`, `.ws-dock-right`, `.ws-dock-bottom`, `.dp-float` (floating panel wrapper)
- **Modals** — `.modal`, `.modal-box` (fixed + centered overlays)
- **Tools window** — `.tw-window`, `.tw-titlebar`, `.tw-sidebar`, `.tw-main`
- **Gameplay panel** — `.gp-window`, `.gp-body`, `.gp-score-row`
- **Preferences** — `.sysprefs-box`, `.sysprefs-sidebar`, `.sysprefs-panel`
- **Donate modal** — `.donate-box`, `.donate-left`, `.donate-right`, `.donate-method`
- **Tab bar** — `.tab-item`, `.tab-add-btn`, `.tab-close`

---

### 4.3 `chart.js`

**Purpose:** Core data model. Defines `ChartData`, the object that holds every note, event, and piece of metadata for one chart. Also defines timing constants and laser encoding utilities.

**Global constants:**

```js
const TICKS_PER_MEASURE = 192;   // ticks in one 4/4 measure
const BEATS_PER_MEASURE = 4;
const TICKS_PER_BEAT    = 48;    // = 192 / 4
let   LASER_SLAM_TICKS  = 12;    // mutable; adjustable in Gameplay preferences
                                  // 12 ticks = 1/16 note at 4/4
```

**Lane index constants:**

```js
const LANE = {
  LASER_L: 0, BT_A: 1, BT_B: 2,
  FX_L: 3, FX_R: 4,
  BT_C: 5, BT_D: 6, LASER_R: 7
};
const LANE_COUNT = 8;
```

> Note: the `LANE` constants are for KSH column ordering reference. Internally `chart.bt` uses indices 0–3 (BT-A/B/C/D) and `chart.fx` uses indices 0–1 (FX-L/R).

**Laser encoding:**

```js
const LASER_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno';
// 51 characters = 51 positions (0.0 to 1.0 in steps of 1/50)
```

- `laserCharToPos(ch)` — converts a KSH laser character to a float `0..1`
- `laserPosToChar(pos)` — converts a float `0..1` to the nearest KSH laser character

**`ChartData` class — public interface:**

| Method | Description |
|---|---|
| `measureBeatToTick(m, b, sb)` | Convert measure+beat+subbeat (all 0-indexed) to absolute tick |
| `tickToMeasure(y)` | Absolute tick → measure index |
| `tickToBeat(y)` | Absolute tick → beat within measure (0–3) |
| `totalTicks()` | `totalMeasures × TICKS_PER_MEASURE` |
| `getBpmAt(y)` | BPM value in effect at the given tick (walks `bpmEvents`) |
| `addBtNote(laneIdx, y, len)` | Insert/replace a BT note (len=0 is chip) |
| `addFxNote(laneIdx, y, len)` | Insert/replace an FX note (len=0 is chip) |
| `removeNote(arr, y)` | Remove note covering tick `y` from an array |
| `addLaserPoint(side, y, v, isSlam, forceNew, interp, curve)` | Append a laser point to the nearest open section, or start a new section |
| `getSlamEvents(side, threshold)` | Returns all slam events for one laser side as structured objects |
| `removeLaserAt(side, y)` | Remove the laser section covering tick `y` |
| `addBpmEvent(y, bpm)` | Add/replace a BPM event at the given tick |
| `addTimeSigEvent(measure, num, den)` | Add/replace a time sig event at the given measure |

**Static method:**

```js
ChartData.isPointSlam(p0, p1, threshold)
// Returns true if the transition from p0 to p1 is a slam.
// Priority: explicit .slam===true > explicit .slam===false > tick-distance heuristic
```

---

### 4.4 `renderer.js`

**Purpose:** The 2D edit view. `Renderer` draws the scrollable multi-column chart canvas. Also defines shared visual constants (`laserColors`, `laserOpacity`, color palette `C`) used by both the 2D and 3D views.

**Layout constants (pixels):**

```js
const BT_W         = 24;    // width of one BT lane
const BT_COUNT     = 4;
const SEP          = 1;     // separator between BT lanes
const TRACK_W      = 99;    // = 4×24 + 3×1 (total BT area)
const EXTEND_W     = 50;    // laser extension on each side (~½ track)
const RULER_W      = 26;    // left ruler/measure label area
const COL_GAP      = 12;    // gap between adjacent columns
const BT_AREA_X    = 76;    // = RULER_W + EXTEND_W, left edge of BT-A
const SINGLE_COL_W = 225;   // = RULER_W + EXTEND_W + TRACK_W + EXTEND_W
```

**Color palette `C` (object):**

All 2D editor colors are defined in the `C` object. Key entries:

| Key | Default | Description |
|---|---|---|
| `C.bg` | `#080810` | Canvas background |
| `C.bgBt` | `#0c0c1c` | BT area background |
| `C.bgLL` | `#010509` | Left laser extension background |
| `C.bgLR` | `#09010a` | Right laser extension background |
| `C.measLine` | `#50508a` | Measure boundary line |
| `C.beatLine` | `#252548` | Beat line |
| `C.btChip` | `#e0e0ff` | BT chip note color |
| `C.btHoldBg` | `#303060` | BT hold body |
| `C.fxChip` | `#ffcc00` | FX chip note color |
| `C.fxBody` | `#9a5000` | FX hold body |
| `C.laserL` | `#1255e8` | Left laser (overridden by `laserColors.L`) |
| `C.laserR` | `#e000b8` | Right laser (overridden by `laserColors.R`) |

**Runtime laser appearance globals:**

```js
const laserColors = { L, Lg, Le, R, Rg, Re };
// L/R = main fill color
// Lg/Rg = glow color (main + '88')
// Le/Re = edge highlight color (lightened)

let laserOpacity = 0.7;  // globalAlpha for laser fill (0.0–1.0)
let laserWideMode = false; // whether 2× wide laser ribbons are drawn
```

**Laser preset system:**

```js
const LASER_PRESETS = {
  'sdvx-default': { L:'#1255e8', ... },
  'blue-red':     { ... },
  'yellow-green': { ... },
  'cyan-orange':  { ... },
  'white-white':  { ... },
};
function applyLaserPreset(presetKey)
function setLaserColorCustom(side, hex)  // side: 0=L, 1=R
```

**`Renderer` class:**

| Property | Default | Description |
|---|---|---|
| `zoom` | `0.75` | Vertical pixel/tick ratio; higher = zoomed in |
| `_beatsPerCol` | `16` | Beats shown per column (4 = 1 measure, 16 = 4 measures) |
| `scrollCol` | `0` | Index of first visible column |
| `numCols` | `3` | Number of visible columns (computed from canvas width) |
| `playTick` | `0` | Current playback cursor position in ticks |
| `playing` | `false` | Whether playback is active |
| `showLaserDots` | `false` | Show laser anchor dot handles (active only when laser tool selected) |
| `activeLaserSec` | `null` | The laser section currently being drawn |
| `selectedLaserPoint` | `null` | Currently selected anchor `{ side, sec, ptIndex }` |

**`Renderer` — coordinate helpers:**

```js
tickToCanvas(tick)
// Returns { cx, cy, colIdx, visColIdx, visible }
// cx = canvas-x of the column's left edge
// cy = canvas-y of the tick within the column

canvasToTick(cx, cy)
// Returns { tick, laneIdx, localX, colIdx }
// laneIdx: -1=ruler, 0-3=BT, 4=left-laser-ext, 5=right-laser-ext

localXToLaserPos(lx, wide)
// Converts column-local x to laser position 0..1

_laserVtoX(ox, v, wide)
// Column-offset ox + laser value v → canvas x
```

**`Renderer.draw()` pipeline:**

For each visible column `vi` (0 to `numCols-1`):
1. `_drawColBg(ox)` — fills backgrounds and BT lane separators
2. `_drawColGrid(ox, startY, ci)` — horizontal measure/beat/sub-beat lines
3. `_drawColFxHolds(ox, startY, endY)` — orange FX hold bodies + caps
4. `_drawColFxChips(ox, startY, endY)` — gold FX chip notes
5. `_drawColBtNotes(ox, startY, endY)` — white BT chips + blue BT holds
6. `_drawColLasers(ox, startY, endY)` — colored laser ribbons + slam triangles + anchor dots
7. `_drawColRuler(ox, startY, ci)` — measure/beat labels, BPM event text

Then:
- `_drawCursor()` — horizontal playback cursor line
- `_drawOverlapFlashes?.()` — warning flashes for overlapping notes (if defined)

---

### 4.5 `game.js`

**Purpose:** 3D SDVX-style game preview. `GameView` takes the same `ChartData` and renders it onto `#game-canvas` using a perspective projection completely implemented in Canvas 2D (no WebGL).

**`GameView` class:**

| Property | Default | Description |
|---|---|---|
| `playTick` | `0` | Current playback position in ticks |
| `hispeed` | `1.0` | Visual scroll speed multiplier |
| `projMode` | `'sdvx'` | `'ortho'` \| `'sdvx'` \| `'hybrid'` |
| `perspIntensity` | `65` | 0–100; controls the strength of the 1/Z perspective |
| `btWidthScale` | `1.0` | 0.3–1.6; scales BT note visual width |
| `_score` | `0` | Current autoplay score |
| `_chain` | `0` | Current autoplay chain count |
| `_totalWeight` | `0` | Total judgeable weight of chart (used for score % calculation) |

**Key computed property:**

```js
get VISIBLE_TICKS() {
  return TICKS_PER_MEASURE * 4 / Math.max(0.1, this.hispeed);
}
// At hispeed=1.0: 768 ticks visible (4 measures)
// At hispeed=2.0: 384 ticks visible (2 measures)
```

**Perspective engine:**

The `_params()` method computes all projection constants each frame:

```
judgeY  = canvas height × 0.73   (judgment line y-coordinate)
vanishY = canvas height × 0.09   (vanishing point y-coordinate)
K       = 1 + (intensity/100)^1.5 × 27   (perspective factor; 65→~15, arcade default)
perspBlend = 0 (ortho) | 1 (sdvx) | 0.45 (hybrid)
laneWBot = min(canvasWidth × 0.52, 380)  (lane width at judgment line)
```

**Coordinate helpers:**

```js
_perspFactor(dt, p)
// dt = ticks ahead of playhead.
// Returns scale factor 0..1 blending ortho+perspective based on projMode.

_screenY(dt, p)
// Converts tick-distance to screen-Y using perspective factor.

_halfW(sy, p)
// Returns the lane half-width at screen-Y sy (narrows toward vanish point).

_screenX(norm, sy, p)
// norm ∈ [0,1] = normalized position across lane. Returns screen-X.

_laserNorm(v, wide)
// Maps laser value 0..1 to extended norm [-0.13, 1.13] (non-wide).
// Wide lasers span the full [0,1] range.

_laserX(v, sy, p, wide)
// Convenience: screen-X for a laser position v at screen-Y sy.
```

**`GameView.draw()` draw order:**

1. Background gradient fill
2. VOL lane panels (left and right, darker tint)
3. BT/FX main lane trapezoid
4. VOL outer boundary lines + side glow
5. Scrolling grid (beat/measure lines)
6. Vertical BT lane dividers (5 lines for 4 lanes)
7. FX hold notes (perspective-correct trapezoids, orange)
8. FX chip notes (yellow gradient bars)
9. BT hold notes (white/blue trapezoids, with active glow)
10. BT chip notes (white bars, glow)
11. Laser ribbons (perspective ribbon quads, grouped into continuous runs)
12. Laser slam blocks (perspective-correct trapezoids + bright leading edge)
13. Laser indicators at judgment line (animated diamond cursors + sparkles)
14. Approaching laser warning indicators (pulsing L/R labels below judgment line)
15. Judgment line (white horizontal line spanning full track)
16. BT button indicators below judgment line (A/B/C/D labels)
17. FX button indicators below BT buttons (L/R labels)
18. `_drawHitFlashes(p, tick, chart)` — upward beacon effects on active notes
19. `_drawHUD(p, tick, score, chain)` — score display, grade, chain counter, BPM, title/artist

**Scoring in the game view:**

`GameView` runs a continuous autoplay simulation:

```js
_calcTotalWeight(chart)   // total judgeable units across all note types
_calcScore(chart, tick)   // score 0–10,000,000 proportional to progress
countChain(chart, tick)   // hit count at given tick (used for chain display)
_grade(score)             // returns { g, col } — e.g. { g: 'S', col: '#ffee55' }
```

Score grade thresholds:

| Score | Grade |
|---|---|
| ≥ 9,900,000 | S |
| ≥ 9,800,000 | AAA+ |
| ≥ 9,700,000 | AAA |
| ≥ 9,500,000 | AA+ |
| ≥ 9,300,000 | AA |
| ≥ 9,000,000 | A+ |
| ≥ 8,700,000 | A |
| ≥ 7,500,000 | B |
| ≥ 6,500,000 | C |
| < 6,500,000 | D |

---

### 4.6 `app.js`

**Purpose:** Main application orchestrator. Contains all global state, event handlers, playback logic, laser filter/FX processing, tab management, undo/redo, UI helpers, and the `DOMContentLoaded` initialization block.

**Global state variables:**

```js
// Tab system
const tabs = [{ name, chart, audioBuffer }];
let activeTabIdx = 0;

// Active chart and renderer
let chart    = tabs[0].chart;   // currently active ChartData
let renderer = null;            // Renderer instance
let tool     = 'select';        // active drawing tool
let snap     = 12;              // snap resolution in ticks (12 = 1/16)

// Drag state for note/laser drawing
const drag = {
  active: false, lane: -1, laneType: '',
  startTick: 0, side: 0, localX: 0, laserSec: null
};

// Selection state
const sel = {
  active: false, dragging: false,
  startTick: 0, endTick: 0, clipboard: null
};

// Undo/Redo
const undoStack = [], redoStack = [];
let MAX_UNDO = 100;  // configurable via Preferences

// View mode
let viewMode = 'split';  // 'edit' | 'game' | 'split'
let gameView = null;     // GameView instance
```

**Audio state variables:**

```js
let audioCtx         = null;  // AudioContext (created lazily)
let audioBuffer      = null;  // decoded music audio
let audioArrayBuffer = null;  // raw bytes (preserved for IDB autosave)
let audioSource      = null;  // currently playing BufferSourceNode
let audioStartAcTime = 0;     // AC time when playback was started
let audioStartChartSec = 0;   // chart time at playback start

// Gain nodes
let masterGainNode   = null;  // final output
let musicGainNode    = null;  // music before laser filter
let slamGainNode     = null;  // slam SFX volume
let tickGainNode     = null;  // tick/clap SFX volume

// Laser filter
let laserFilterNode  = null;  // BiquadFilterNode (type varies per chart setting)

// FX wet/dry routing
let _fxDryGain    = null;     // bypasses effect chain
let _fxWetIn      = null;     // input to active effect
let _fxWetGain    = null;     // output mix from effect
let _fxMixOut     = null;     // summed output to musicGainNode
let _fxEffectType = null;     // currently active effect type string
```

**Playback state:**

```js
let playing        = false;
let playStartPerf  = 0;        // performance.now() at play start
let playStartTickV = 0;        // chart tick at play start
let chartSpeed     = 1.0;      // hispeed (visual only; does NOT affect timing)
let prevPlayTick   = 0;        // previous frame's tick (for SFX detection)
let playStopTick   = -1;       // -1 = play to end; otherwise stop at this tick
```

**Settings / preferences object:**

```js
const settings = { tickSound: false };  // legacy; actual prefs live in `prefs`
```

The `prefs` object is populated from `localStorage` by the preferences system and contains:

```js
prefs = {
  audioDelay:     0,      // ms; positive = audio plays later
  videoDelay:     0,      // ms; positive = visuals appear later
  fpsCap:         60,     // 30 | 60 | 120
  highQuality:    true,   // glow/shadow effects
  tickEnabled:    true,   // play tick sound
  volMaster:      1.0,
  volMusic:       1.0,
  volSlam:        0.5,
  volTick:        0.5,
  autoplay:       true,   // autoplay scoring in game view
  slamThreshold:  6,      // ticks; LASER_SLAM_TICKS
  showLaserDir:   true,   // show L/R label on laser indicator
  showLaserDots:  false,  // show anchor dots outside laser-tool mode
  laserOpacity:   70,     // percent
  autosaveInterval: 60,   // seconds (0 = disabled)
  historyDepth:   100,    // max undo states
}
```

**Key functions in app.js:**

| Function | Description |
|---|---|
| `ensureAudioCtx()` | Lazily creates AudioContext and builds the full audio node graph |
| `loadAudioFile(file)` | Decodes an audio File into `audioBuffer` |
| `startPlay(stopAtTick)` | Begins playback from `renderer.playTick`; connects audio source |
| `stopPlay()` | Halts playback, tears down FX effects, restores dry signal |
| `playFrame(now)` | RAF callback: advances tick, scrolls view, triggers SFX, updates filter/FX |
| `detectSlams(prev, cur)` | Fires slam sound for every slam event between two ticks |
| `detectFxHits(prev, cur)` | Fires clap sound for every FX chip between two ticks |
| `detectBtHits(prev, cur)` | Fires tick sound for every BT chip between two ticks |
| `updateLaserFilter(tick)` | Sets BiquadFilter frequency/gain based on current laser positions |
| `updateFxEffects(tick)` | Creates/updates/tears down Web Audio effect nodes for active FX holds |
| `_teardownFxEffect()` | Disconnects and nulls all FX effect nodes; clears timers |
| `getLaserPosAt(side, tick)` | Interpolates laser value 0..1 at a given tick (returns `null` if no laser) |
| `tickToSeconds(tick)` | Converts chart tick to wall-clock seconds (respects BPM changes) |
| `secondsToTick(sec)` | Inverse of tickToSeconds |
| `setViewMode(mode)` | Switches between `'edit'`, `'game'`, `'split'`; resizes canvases |
| `render()` | Calls `renderer.draw()` — redraws the 2D edit canvas |
| `saveUndo(label)` | Snapshot current chart state onto the undo stack |
| `undo()` / `redo()` | Pop/push undo states |
| `switchToTab(idx)` | Activate a different tab |
| `addTab()` / `closeTab(idx)` | Tab management |
| `renderTabBar()` | Rebuild tab bar DOM from `tabs[]` array |
| `syncMetaToChart()` | Read left-panel form fields → update `chart.meta` |
| `pushMeta()` | Write `chart.meta` → left-panel form fields |
| `updateSeekbar(tick)` | Update the seekbar fill/thumb/time label |
| `_idbAutosave()` | Write current chart+audio to IndexedDB |

---

### 4.7 `effects.js`

**Purpose:** Defines the catalog of FX effect types available in the editor. No rendering or audio code — purely the data schema.

**`EFFECT_DEFS` object:** A record keyed by effect type string. Each entry has:

```js
{
  label: 'Human-readable name',
  kshName: 'KSH export name (verbatim)',
  params: {
    paramName: {
      label: 'UI label',
      min, max, step, def,  // range and default value
      unit: 'display unit (%, Hz, ms, st, /beat, smp, …)'
    }
  }
}
```

**Available effect types:**

| Type | Key Params | Notes |
|---|---|---|
| `retrigger` | waveLength, rate, updatePeriod, mix | Stutter/loop effect |
| `gate` | waveLength, rate, mix | Periodic silence |
| `flanger` | period, delay, depth, feedback, stereoWidth, mix | Comb filter sweep |
| `pitchshift` | pitch (semitones), chunkSize, overlap, mix | |
| `bitcrusher` | reduction, mix | Sample rate reduction |
| `phaser` | period, stages, feedback, mix | All-pass comb |
| `wobble` | waveLength, loFreq, hiFreq, q, mix | LFO filter sweep |
| `tapestop` | speed, mix | Slow-down effect |
| `echo` | waveLength, feedback, mix | Delay line with feedback |
| `sidechain` | period, holdTime, attackTime, releaseTime, mix | Pumping gain |

**Utility functions:**

```js
makeEffectInstance(type)
// Returns { type, enabled: true, params: { ...defaults } }

effectToKsh(inst)
// Returns the KSH fx-l/fx-r string for the instance (e.g. "Gate;8", "Echo;4;60")
```

---

### 4.8 `ksh.js`

**Purpose:** KSH format import and export. The KSH format is a line-based text format used by Sound Voltex Custom Charts (USC, K-Shoot MANIA).

**`exportKsh(chart)`:** Serializes a `ChartData` to a KSH text string.

Structure of exported KSH:
```
title=...
artist=...
...
ver=167
--
beat=4/4
t=180
0000|00|--   ← tick row: BT-A/B/C/D | FX-L/R | VOL-L/R
...
--           ← measure separator
```

Row encoding:
- BT columns: `0` = empty, `1` = chip, `2` = hold body
- FX columns: `0` = empty, `2` = chip, `1` = hold body
- Laser columns: char (position), `:` = continuation, `-` = inactive/gap

**`importKsh(text)`:** Parses a KSH text file into a new `ChartData`.

Key state variables during parsing:
- `holdBt[0..3]`, `holdFx[0..1]` — open hold note start ticks
- `laserActive[0..1]` — whether a laser section is currently open
- `prevWasChar[0..1]` — whether the previous row had an explicit laser position (for slam detection)
- `currentSection[0..1]` — the active `lasers[side]` section being built

**`_kshEffectFromStr(str)`:** Parses a KSH effect definition string like `"Wobble;12"` into a `makeEffectInstance` result.

---

### 4.9 `kson.js`

**Purpose:** KSON format import and export. KSON is the modern JSON-based chart format.

**Tick scale:** KSON uses 240 ticks per beat; the editor uses 48 ticks per beat internally.

```js
const KSON_TPB     = 240;           // KSON ticks per beat
const KSH_TO_KSON  = 240 / 48;     // = 5  (multiply to go editor→KSON)
```

Every tick value written to or read from KSON must be scaled by this factor.

**`exportKson(chart)`:** Builds a KSON JSON object and returns `JSON.stringify(kson, null, 2)`.

KSON structure written:
```json
{
  "version": "0.8.0",
  "meta": { title, artist, chart_author, difficulty, level, … },
  "beat": {
    "bpm": [{ y, v }],
    "time_sig": [{ idx, v: [num, den] }],
    "scroll_speed": [{ y: 0, v: 1.0 }]
  },
  "note": {
    "bt": [[y, len], …],
    "fx": [[y, len], …],
    "laser": [{ y, v: [{ ry, v, a, b, slam? }], wide }]
  },
  "audio": { bgm: { filename, vol, offset, preview }, … },
  "camera": { … },
  "bg": { filename, offset }
}
```

**`importKson(text)`:** Parses a KSON JSON string back into `ChartData`.

Slam flag reconstruction priority during import:
1. `pt.slam === true` → explicit slam (the editor wrote this)
2. `pt.slam === false` → explicit non-slam
3. No `slam` field → tick-distance heuristic using `LASER_SLAM_TICKS`

---

### 4.10 `dock.js`

**Purpose:** DockManager. Provides a Photoshop/Clip Studio Paint style dockable workspace. Panels can be docked to the left, right, or bottom, or floated as free windows.

**Storage key:** `'vibe_dock_layout_v2'` in `localStorage`

**Constants:**

```js
const DOCK_SNAP_PX  = 60;   // pixel distance for snap-to-region
const DOCK_ANIM_MS  = 180;  // CSS transition duration (ms)
const DOCK_MIN_PX   = 140;  // minimum region size (px)
const DOCK_DEF_SIZE = { left: 260, right: 272, bottom: 180 };
```

**Internal state:**

```js
const _dkPanels   = {};   // panelId → PanelRecord
const _dkRegions  = {};   // 'left'|'right'|'bottom' → RegionRecord
let   _dkDrag     = null; // active drag state
let   _dkSnap     = null; // snap overlay element
```

**Public API:**

```js
dockInit()
// Must be called first. Builds the ws-root DOM structure, regions, and snap overlay.

dockRegister(id, el, label, icon, defaultRegion, opts)
// Register a panel. opts: { floatX, floatY, floatW, floatH, nativeFloat }

dockApplyLayout()
// Restore saved layout from localStorage, or apply defaultRegion for each panel.

dockFloat(id)
// Detach from region and show as free window.

dockTo(id, regionId)
// Dock into 'left', 'right', or 'bottom'.

dockToggle(id)
// Toggle: floating→visible/hidden, docked→undock+float, hidden→float.
```

**DOM structure created by `dockInit()`:**

```
body
└── #ws-root (flex-col)
    ├── #ws-main-row (flex-row)
    │   ├── #ws-dock-left   (hidden until panel docked here)
    │   ├── #ws-center (flex-col)
    │   │   ├── #toolbar
    │   │   ├── #ctx-palette  (context toolbar bar, created by dock)
    │   │   └── #ws-edit-area
    │   │       ├── #main (the 3-panel edit layout)
    │   │       └── #game-wrap
    │   └── #ws-dock-right
    └── #ws-dock-bottom
```

**Layout persistence:** Saved as JSON to `localStorage['vibe_dock_layout_v2']`:
```json
{
  "regions": {
    "left":   { "size": 260, "panelIds": ["panel-meta"] },
    "right":  { "size": 272, "panelIds": ["panel-fx"] },
    "bottom": { "size": 180, "panelIds": [] }
  },
  "floats": {
    "history-panel": { "x": 200, "y": 120, "w": 380, "h": 400, "visible": true }
  }
}
```

---

### 4.11 `tools.js`

**Purpose:** Tools Hub — a floating MDI window containing 20 specialist tools organized into Edit, Analysis, Audio, Metadata, and Validate categories.

**`TOOL_REGISTRY`:** Array of tool descriptors:
```js
{ id: 'bpm-sync', cat: 'Edit', label: 'BPM Sync', icon: '♩' }
```

**Available tools (by category):**

| Category | Tools |
|---|---|
| Edit | BPM Sync, Laser Smooth, FX Generator, Hold Editor, Scale Suggester, Pattern Library |
| Analysis | Difficulty Curve, Density Heatmap, Multi-Chart Sync, VOL Rotation, Hand Optimizer, Symmetry Check, Timing Windows |
| Audio | Offset Finder, Keysound Map, Waveform Align |
| Metadata | Jacket Meta |
| Validate | Validity Checker, Collision Detect, Export Validator |

**Per-tool settings schema (`TOOL_SETTINGS`):** Each tool can have configurable settings persisted to `localStorage['vibe_editr_tool_settings']`.

**Storage keys:**

```js
const _SETTINGS_KEY  = 'vibe_editr_tool_settings';
const _PINS_KEY      = 'vibe_editr_pinned_tools';
const _WIN_STATE_KEY = 'vibe_editr_tools_win';
```

**Public API:**

```js
initTools()
// Builds the Tools Hub window and appends it to document.body.

openToolsWindow()
// Shows the window (creates if first call).
```

**Window chrome:** macOS-style traffic light buttons (close, minimize/collapse, maximize/restore), drag-to-move titlebar, resize handle.

---

### 4.12 `gameplay.js`

**Purpose:** The Gameplay scoring panel — a floating window showing real-time score, EX-score, grade, chain, judgment breakdown, and lane activity indicators during playback.

**Timing constants (from SDVX spec):**

```js
const GP_S_CRIT_MS = 20.8;   // S-Critical window (±ms)
const GP_CRIT_MS   = 41.6;   // Critical window
const GP_NEAR_MS   = 150.0;  // Near window
const GP_SLAM_MS   = 100.0;  // Slam timing window
```

**EX-score points:**

```js
const GP_EX_S_CRIT = 5;
const GP_EX_CRIT   = 2;
const GP_EX_NEAR   = 0;
const GP_EX_ERROR  = 0;
```

In autoplay (the only mode available in the editor), every hit counts as S-CRIT.

**Key functions:**

```js
gpTotalObjects(chart)
// Total judgeable objects — uses gameView.countChain(chart, Infinity)

gpChainAt(chart, tick)
// Objects hit at given tick — delegates to gameView.countChain

gpStats(chart, tick)
// Returns { score, exScore, exMax, sCrit, crit, near, error, chain, total }

gpGrade(score)
// Returns { label: 'S', color: '#ffe866' } etc.

gpStatus(stats)
// Returns { label: 'PUC'|'UC'|'CLEAR', color }
```

**UC/PUC detection:**
- **PUC** (Perfect Ultimate Chain): `stats.error === 0 && stats.near === 0`
- **UC** (Ultimate Chain): `stats.error === 0`

**Storage key:** `'vibe_gameplay_win'` in `localStorage` for window position/size.

---

## 5. Key Data Structures

### 5.1 `ChartData`

The single source of truth for all chart content.

```js
chart = {
  meta: {
    title: '',
    artist: '',
    effect: '',       // charter name
    illust: '',       // jacket artist
    difficulty: 'infinite',
    level: 10,
    bpm: 180,
    music: '',        // filename of audio file
    offset: 0,        // ms; beat-1 starts at this ms offset in the audio file
    previewStart: 0,
    previewDuration: 15000,
    jacket: '',
    bg: '0',
    layer: '',
  },
  totalMeasures: 64,
  laserSettings: {
    filter: 'peak',   // 'peak' | 'lpf1' | 'hpf1' | 'bitc'
    gain: 50,         // 0–100
    wide: false,      // 2× wide lasers
  },
  camera: {
    tilt: 'normal',   // 'normal'|'bigger'|'biggest'|'keep_add'|'zero'
    zoomTop: 0,       // -300 to 300
    zoomBot: 0,
    rotation: 0,      // degrees
    split: 0,         // -100 to 100
  },
  bt:          [[...], [...], [...], [...]], // BT-A, BT-B, BT-C, BT-D
  fx:          [[...], [...]],              // FX-L, FX-R
  lasers:      [[...], [...]],             // laser sections: left, right
  bpmEvents:   [{ y: 0, bpm: 180 }],
  timeSigEvents: [{ measure: 0, num: 4, den: 4 }],
  fxChains:    [[...], [...]],             // FX-L chain, FX-R chain
}
```

### 5.2 Note Objects

BT and FX notes share the same structure:

```js
{ y: 384, len: 0 }   // chip note at tick 384 (measure 2 beat 1)
{ y: 192, len: 96 }  // hold note starting at tick 192, lasting 96 ticks (= 2 beats)
```

- `y` — absolute tick position (0-indexed from beginning of chart)
- `len` — duration in ticks; `0` = chip note

Arrays are always kept sorted by `y` ascending.

### 5.3 Laser Sections and Points

Each laser side (`chart.lasers[0]` for left, `chart.lasers[1]` for right) is an array of **sections**. A section is a contiguous laser ribbon — a gap in the chart creates a new section.

```js
{
  y: 192,          // absolute tick of section start
  points: [
    { ry: 0,   v: 0.0, slam: false, interp: 'linear', curve: 0.5 },
    { ry: 12,  v: 1.0, slam: true,  interp: 'linear', curve: 0.5 },
    { ry: 192, v: 0.5, slam: false, interp: 'bezier', curve: 0.5 },
  ],
  wide: false,     // whether to use 2× wide laser ribbon
}
```

Each **point** within a section:

| Field | Type | Description |
|---|---|---|
| `ry` | integer | Relative tick from `section.y` |
| `v` | float 0..1 | Laser horizontal position (0=far left, 1=far right) |
| `slam` | bool/undefined | `true`=explicit slam, `false`=explicit non-slam, `undefined`=use heuristic |
| `interp` | string | `'linear'` \| `'bezier'` \| `'step'` — outgoing interpolation type |
| `curve` | float 0..1 | Bezier curve symmetry (0.5 = symmetric S-curve) |

**CONNECT_THRESHOLD:** When `addLaserPoint` is called without `forceNew`, it searches backward for a section whose last tick is within **192 ticks** (1 measure) of the new point's tick. If found, the point is appended to that section; otherwise a new section is started.

### 5.4 BPM Events

```js
chart.bpmEvents = [
  { y: 0,   bpm: 180 },
  { y: 768, bpm: 160 },   // BPM changes at measure 4
]
```

Always sorted by `y` ascending. The first event defines the chart's initial BPM. `getBpmAt(tick)` walks this array and returns the last BPM whose `y <= tick`.

### 5.5 Time Signature Events

```js
chart.timeSigEvents = [
  { measure: 0, num: 4, den: 4 },
  { measure: 8, num: 3, den: 4 },  // 3/4 starting at measure 9
]
```

Note: `measure` is 0-indexed here.

### 5.6 FX Effect Instances

```js
chart.fxChains[0] = [
  {
    type: 'wobble',
    enabled: true,
    params: {
      waveLength: 12,
      loFreq: 500,
      hiFreq: 20000,
      q: 1,
      mix: 50,
    }
  }
]
```

`fxChains[0]` is the FX-L chain; `fxChains[1]` is FX-R. Currently only the first item in each chain is used for audio processing (the chain API exists for future multi-effect support).

---

## 6. Tick System and Timing

### Resolution

The editor uses **48 ticks per beat**, **192 ticks per 4/4 measure**.

```
1 measure (4/4) = 192 ticks
1 beat          =  48 ticks
1/8 note        =  24 ticks
1/16 note       =  12 ticks  ← LASER_SLAM_TICKS default
1/32 note       =   6 ticks
1/64 note       =   3 ticks
1/192 note      =   1 tick   (finest resolution)
```

### Snap Values

The snap dropdown maps the displayed fraction to a tick divisor:

| Display | Snap ticks |
|---|---|
| 1/4 | 48 |
| 1/8 | 24 |
| 1/12 | 16 |
| 1/16 | 12 |
| 1/24 | 8 |
| 1/32 | 6 |
| 1/48 | 4 |
| 1/64 | 3 |
| 1/96 | 2 |
| 1/128 | 1.5 |
| 1/192 | 1 |
| 1/256 | 0.75 |
| 1/384 | 0.5 |
| 1/512 | 0.375 |
| Free | 0 |

### Tick-to-Seconds Conversion

`tickToSeconds(tick)` iterates through BPM events to accumulate wall-clock time:

```js
seconds += (segmentTicks / TICKS_PER_BEAT) * (60 / bpm)
```

This means that at 180 BPM, 1 beat = 1/3 second, so 1 tick = 1/(3×48) ≈ 6.9 ms.

### KSON Tick Conversion

KSON uses 240 ticks per beat, so all values must be multiplied by `KSH_TO_KSON = 5` when exporting and divided (with rounding) when importing.

---

## 7. Audio System

### 7.1 Audio Node Graph

Created lazily by `ensureAudioCtx()` on first interaction requiring audio:

```
audioSource (BufferSourceNode)
    │
    ▼
laserFilterNode (BiquadFilterNode)
    │                │
    ▼                ▼
_fxDryGain        _fxWetIn (GainNode, gain=1)
    │                │
    │          [active effect nodes]
    │                │
    ▼                ▼
_fxMixOut ◄──── _fxWetGain (GainNode, gain=0 when bypassed)
    │
    ▼
musicGainNode
    │
    ▼
masterGainNode
    │
    ▼
AudioContext.destination (speakers)

slamGainNode ──► masterGainNode  (parallel SFX path)
tickGainNode ──► masterGainNode  (parallel SFX path)
```

**Note:** `_fxDryGain` and `_fxWetGain` gains are always summed to 1.0. When no effect is active: dry=1, wet=0. When an effect is fully applied: dry=0, wet=`mix/100`.

### 7.2 Laser Filter

`updateLaserFilter(tick)` is called every frame during playback. It:

1. Calls `getLaserPosAt(0, tick)` and `getLaserPosAt(1, tick)` to get current laser positions.
2. Computes `intensity = Math.max(li, ri)` where `li = 1 - lv` (inverted left position) and `ri = 1 - rv`.
3. Applies to `laserFilterNode` based on `chart.laserSettings.filter`:

| Filter Type | Effect |
|---|---|
| `lpf1` | Lowpass; frequency sweeps 2000 Hz → 20000 Hz as laser moves right |
| `hpf1` | Highpass; frequency sweeps 50 → 4050 Hz as laser moves right |
| `peak` | Peaking EQ; frequency sweeps 500 → 4500 Hz; gain 0 → 20 dB |
| `bitc` | No active filter node (BitCrusher is emulated via the FX chain, not natively supported by Web Audio) |

All parameter changes use `setTargetAtTime(..., audioCtx.currentTime, 0.02)` for 20ms smoothing.

### 7.3 FX Effects Chain

`updateFxEffects(tick)` is called every frame. It:
1. Searches for an active FX hold at the current tick with a chain entry.
2. If the effect type changed, calls `_teardownFxEffect()` to disconnect old nodes.
3. Lazily creates new audio nodes for the active effect.
4. Ramps wet/dry gains smoothly.

**Implemented audio effects:**

| Effect | Implementation |
|---|---|
| `wobble` | BiquadFilter (lowpass) modulated by an OscillatorNode LFO. LFO frequency = BPM-synced (`bpm/60 / waveLength × 4`). |
| `gate` | GainNode with scheduled automation (`setValueAtTime`) creating square-wave on/off. Refreshed every 4 periods via `setInterval`. |
| `echo` | DelayNode → GainNode (feedback) → feedback loop. Wet via GainNode. |
| `sidechain` | GainNode with hold → linear ramp up → linear ramp down automation per period. |

**Partially implemented** (UI exists, audio node not yet wired): `retrigger`, `flanger`, `pitchshift`, `bitcrusher`, `phaser`, `tapestop`.

### 7.4 Sound Effects (SFX)

Three sound buffers are loaded at startup via `fetch`:

| File | Buffer | Purpose |
|---|---|---|
| `sounds/slam.ogg` | `slamBuffer` | Laser slam hit sound |
| `sounds/tick.wav` | `clapBuffer` | FX chip hit sound |
| `sounds/tick.ogg` | `tickBuffer` | BT chip hit sound |

SFX are fired by `detectSlams`, `detectFxHits`, and `detectBtHits` in `playFrame`. Each creates a `BufferSourceNode`, connects to the appropriate gain node, and calls `.start()`.

---

## 8. Rendering Pipeline

### 8.1 2D Edit View (`renderer.js`)

The 2D canvas is a static-height element that recomputes its **width** when the panel resizes, fitting as many `SINGLE_COL_W`-wide columns as possible.

```
canvas.width  = numCols × 225 + (numCols-1) × 12
canvas.height = colH = colTicks × zoom
```

Each column represents `colTicks = beatsPerCol × 48` ticks and is **fixed height** in pixels (`colH`). Time runs **bottom-to-top** within each column. The oldest measure is at the bottom of column 0; as measures progress they fill columns left-to-right.

**Scroll model:** `scrollCol` is the index of the leftmost visible column. The renderer draws columns `scrollCol` through `scrollCol + numCols - 1`.

**Tick → canvas coordinate:**
```
cy = colH - (tickInCol × zoom)
```
where `tickInCol = tick - colIdx × colTicks`.

**Canvas → tick:**
```
colIdx  = floor(cx / (SINGLE_COL_W + COL_GAP)) + scrollCol
tickInCol = (colH - cy) / zoom
tick    = colIdx × colTicks + tickInCol
```

### 8.2 3D Game Preview (`game.js`)

The 3D canvas is sized to its container (`game-wrap`). Notes scroll upward from the judgment line toward the vanishing point as time advances.

**Note culling:** Only notes within `[tick, tick + VISIBLE_TICKS]` are rendered.

**Laser ribbon rendering:**
1. Build a flat list of `gSegs` — one segment per adjacent pair of laser points, clamped to visible range.
2. Group `gSegs` into continuous runs, splitting whenever a slam is encountered.
3. For normal runs: draw a filled polygon spanning all segments (quadratic bezier in ortho mode; straight quads in sdvx/hybrid).
4. For slam segments: draw a perspective-correct trapezoid with a bright leading edge.

### 8.3 Projection Modes

| Mode | `perspBlend` | Behavior |
|---|---|---|
| `ortho` | 0 | Completely flat; notes scroll linearly at constant width. Laser ribbons use smooth bezier curves. |
| `sdvx` | 1 | Full 1/Z perspective; lane narrows toward vanishing point; notes appear to rush in. |
| `hybrid` | 0.45 | Partial blend — reduced distortion for readability while retaining depth. |

The `perspIntensity` slider (0–100) controls the `K` factor:
```js
K = 1 + (intensity/100)^1.5 × 27
```
At intensity=65 (default), K≈15, matching the SDVX arcade cabinet perspective.

---

## 9. Docking System (`dock.js`)

### Lifecycle

1. `dockInit()` — Called by `app.js` after DOM is ready. Restructures the body into the workspace layout and creates region slots.
2. `dockRegister(id, el, label, icon, defaultRegion)` — Called for each panel element before applying layout.
3. `dockApplyLayout()` — Restores saved state from `localStorage`, or falls back to `defaultRegion`.

### Panel States

A panel can be in one of three states:
- **Docked**: Inserted into a `ws-dock-{left|right|bottom}` slot. The dock region becomes visible and resizable.
- **Floating**: Wrapped in a `.dp-float` element at a fixed screen position. Draggable, resizable.
- **Hidden**: Float wrapper exists but `display: none`.

### Region Resizing

Dock regions have a drag handle that calls `_dkStartResize`. The resizer updates the region element's width/height CSS directly and saves the new size.

### Drag-to-Dock

When a floating panel's titlebar is dragged near a dock region edge (within `DOCK_SNAP_PX = 60px`), a translucent snap overlay appears highlighting the target region. On mouse-up, `_dkDockPanel` moves the panel into the region.

### Saving Layout

`_dkSave()` serializes `_dkPanels` and `_dkRegions` to `localStorage['vibe_dock_layout_v2']`.

---

## 10. Tools Hub (`tools.js`)

Tools are registered in `TOOL_REGISTRY` and rendered in a sidebar. Clicking a tool calls `_activateTool(id)` which:
1. Renders a tool-specific UI into `#tw-tool-body`
2. Renders the tool's settings schema (if any) in a settings overlay

Per-tool settings are loaded from `localStorage['vibe_editr_tool_settings']` and persisted on change. Pinned tools (favorite tools starred by the user) are stored in `localStorage['vibe_editr_pinned_tools']`.

**To add a new tool:** Add an entry to `TOOL_REGISTRY` and optionally add a settings schema to `TOOL_SETTINGS`. Then add a handler in `_activateTool(id)` that populates `#tw-tool-body` with the tool's UI.

---

## 11. Chart Formats

### 11.1 KSH Format

KSH is a line-based text format. A chart file consists of:

**Header section** (before first `--`): key=value metadata pairs.

**Body section** (after first `--`): measure blocks separated by `--` lines.

Each measure block contains:
- Optional `beat=N/D` line if time signature changes
- Optional `t=BPM` line if BPM changes
- One tick row per subdivision: `BTBT|FX|VV`

**Tick row format:**
```
ABCD|LR|LR
│       │  └─ Laser-R position char or ':' (cont.) or '-' (off)
│       └──── Laser-L position char or ':' or '-'
│    └─────── FX-R (0/1/2)
│ └─────────── FX-L (0/1/2)
└───────────── BT-A/B/C/D (0/1/2)
```

**BT encoding:** `0`=empty, `1`=chip, `2`=hold body
**FX encoding:** `0`=empty, `2`=chip, `1`=hold body (inverted from BT)

### 11.2 KSON Format

JSON-based. Uses 240 ticks per beat (5× the editor's 48).

**Key differences from internal representation:**
- All tick values multiplied by 5 (KSH_TO_KSON)
- Notes stored as `[y, len]` arrays
- Lasers stored with `ry`, `v`, `a`, `b` fields (bezier curve params)
- Difficulty stored as `{ name, short_name, idx }`
- Audio stored under `audio.bgm`

### 11.3 Tick Conversion

```
Editor tick → KSON tick:   y_kson = y_editor × 5
KSON tick → Editor tick:   y_editor = Math.round(y_kson / 5)
```

---

## 12. Gameplay System (`gameplay.js`)

The Gameplay panel shows a real-time display of the score as it would appear during autoplay. It updates every animation frame while `playing === true`.

**Score formula (autoplay):**
```
score = round(10,000,000 × totalWeight_hit / totalWeight)
```

**EX-Score formula (autoplay, every hit = S-CRIT):**
```
exScore = chain × 5
exMax   = total × 5
```

**MAX-# counter:**
```
maxHash = exMax - exScore
```

**Chain counting** (`countChain`):
- BT chip: +1 per chip
- BT hold: +floor(elapsed / HOLD_SAMPLE) — one count per `HOLD_SAMPLE` (= TICKS_PER_BEAT/8 = 6 ticks)
- FX chip: +1 per chip
- FX hold: +floor(elapsed / (HOLD_SAMPLE × 2))

The Gameplay panel has 10 lane-cell divs visualizing which lanes are active at the current tick.

---

## 13. Key Variables Reference

| Variable | File | Description | How to change |
|---|---|---|---|
| `TICKS_PER_MEASURE` | chart.js | 192 — core timing resolution | Do not change; hardcoded in format |
| `LASER_SLAM_TICKS` | chart.js | 12 — slam detection threshold | Via Gameplay prefs slider (`pref-slam-threshold`) or `prefs.slamThreshold` |
| `BT_W` | renderer.js | 24 — BT lane pixel width | Change constant; call `renderer.resize()` |
| `EXTEND_W` | renderer.js | 50 — laser extension width | Change constant; call `renderer.resize()` |
| `RULER_W` | renderer.js | 26 — ruler area width | Change constant |
| `COL_GAP` | renderer.js | 12 — gap between columns | Change constant |
| `laserColors` | renderer.js | Current laser colors object | `applyLaserPreset(key)` or `setLaserColorCustom(side, hex)` |
| `laserOpacity` | renderer.js | 0.7 — laser globalAlpha | Direct assignment; also set by `prefs.laserOpacity/100` |
| `chart` | app.js | Active ChartData | Via `switchToTab(idx)` or import |
| `renderer` | app.js | Renderer instance | Created once in `DOMContentLoaded` |
| `gameView` | app.js | GameView instance | Created once in `DOMContentLoaded` |
| `viewMode` | app.js | `'edit'`\|`'game'`\|`'split'` | `setViewMode(mode)` |
| `tool` | app.js | Active tool string | `setTool(name)` |
| `snap` | app.js | Snap resolution in ticks | Snap dropdown or direct assignment |
| `MAX_UNDO` | app.js | 100 — max undo stack depth | `prefs.historyDepth` → `MAX_UNDO = prefs.historyDepth` |
| `chartSpeed` | app.js | Visual hispeed (1.0 default) | HiSpeed slider; also `gameView.hispeed` |
| `DOCK_DEF_SIZE` | dock.js | Default dock region sizes | Change object properties |
| `DOCK_SNAP_PX` | dock.js | 60 — snap activation distance | Change constant |
| `GP_S_CRIT_MS` | gameplay.js | 20.8ms S-Critical window | Change constant |
| `GP_CRIT_MS` | gameplay.js | 41.6ms Critical window | Change constant |
| `GP_NEAR_MS` | gameplay.js | 150ms Near window | Change constant |
| `HOLD_SAMPLE` | game.js | `TICKS_PER_BEAT/8 = 6` — hold scoring interval | Change constant; affects chain counting |

---

## 14. Actively Running Functions (Per-Frame)

### `playFrame(now)` — the main loop

Triggered by `requestAnimationFrame(playFrame)` from `startPlay()`. Runs every frame while `playing === true`.

**What it does each frame:**

1. **Advance tick** — using Web Audio clock (`audioCtx.currentTime`) if audio is loaded, or `performance.now()` otherwise. Applies `prefs.videoDelay` to shift visuals relative to audio.
2. **Sync `renderer.playTick` and `gameView.playTick`**.
3. **Auto-scroll** — advances `renderer.scrollCol` if `playTick` moves ahead of or behind the visible range.
4. **Sound effects:**
   - `detectSlams(prevTick, currentTick)` — fires slam SFX
   - `detectFxHits(prevTick, currentTick)` — fires FX chip SFX
   - `detectBtHits(prevTick, currentTick)` — fires BT chip SFX
5. **Audio DSP:**
   - `updateLaserFilter(tick)` — updates BiquadFilter frequency/gain
   - `updateFxEffects(tick)` — creates/updates/tears down FX effect nodes
6. **Check stop condition** — if `playTick >= stopAtTick`, calls `stopPlay()`.
7. **Status bar** — `updatePlayStatus()` updates tick/measure/beat display.
8. **Render:**
   - `render()` → `renderer.draw()` — always redraws 2D canvas
   - `gameView.draw()` — only in game/split view, FPS-capped by `prefs.fpsCap`
9. **Schedule next frame** — `requestAnimationFrame(playFrame)`

### `renderer.draw()` — 2D canvas redraw

Called directly by `render()` (which is called from `playFrame` and all edit operations). Not on its own RAF loop — called on demand.

### `gameView.draw()` — 3D canvas redraw

Called from `playFrame` (while playing, FPS-capped) and from `setViewMode`, `_seekTo`, and anywhere the preview needs refreshing while paused.

---

## 15. Background / Init Functions (Run Once)

### `DOMContentLoaded` handler (`app.js`)

The single monolithic init block. Runs once when the DOM is ready. In order:

1. `_loadingShow('Initializing editor…', 5)`
2. `buildLaneHeader()` — builds lane header row above the canvas
3. `new Renderer(canvas)` → `renderer` — creates 2D renderer
4. `_restoreSession()` — restores last scroll position, zoom, view mode, preferences from `localStorage`
5. Zoom slider init
6. `new GameView(gameCanvas)` → `gameView` — creates 3D renderer
7. `initSeekbar()` — wires seekbar mouse events
8. Chart speed / BT width sliders
9. View mode buttons
10. All menu item event listeners (Edit, Chart, View, Settings, Window)
11. Tool palette button listeners
12. Snap dropdown listener
13. Zoom slider listener
14. Beats-per-lane slider
15. Metadata panel listeners → `syncMetaToChart`
16. Export button listeners
17. File open listeners
18. New chart button
19. FX chain add buttons
20. Song Metadata modal wiring
21. BPM modal wiring
22. TimeSig modal wiring
23. Open folder listener (with multi-chart picker)
24. Calibration button wiring
25. Keyboard shortcut handler (`keydown`)
26. `syncMetaToChart()`, `renderTabBar()`, `render()` — initial paint
27. `_loadingDone()` — fades out the loading overlay
28. `setTimeout(_idbAutosave, 3000)` — initial autosave after 3 seconds
29. Mouse event listeners on canvas
30. `dockInit()`, `dockRegister(...)`, `dockApplyLayout()` — workspace setup
31. `initTools()`, `initGameplay()` — Tools Hub and Gameplay panel init

### `ensureAudioCtx()` (`app.js`)

Called on first audio interaction (play, load audio, etc.). Creates the AudioContext and the complete audio node graph. Also loads SFX buffers via `fetch`.

### `dockInit()` (`dock.js`)

Restructures the DOM body into the workspace layout (`ws-root`, regions, etc.) and initializes the snap overlay. Must run before `dockRegister`.

### `initTools()` (`tools.js`)

Builds the Tools Hub floating window and appends it to `document.body`. Restores window position/size from `localStorage`.

### `initGameplay()` (`gameplay.js`)

Builds the Gameplay floating panel and appends it to `document.body`. Starts the RAF update loop for the panel.

---

## 16. Undo / Redo System

```js
const undoStack = [];  // array of { label, chartJSON, audioBuffer }
const redoStack = [];
let MAX_UNDO = 100;
```

### `saveUndo(label)`

Snapshots the current chart state:
```js
undoStack.push({
  label,
  chartJSON: JSON.stringify(chart),  // deep clone via JSON round-trip
  audioBuffer: audioBuffer           // reference (not cloned)
});
if (undoStack.length > MAX_UNDO) undoStack.shift();
redoStack.length = 0;  // clear redo on new edit
```

### `undo()`

Pops the last state from `undoStack`, restores `chart = ChartData.fromJSON(...)`, and pushes the current state onto `redoStack`.

### `redo()`

Pops from `redoStack` and applies.

**Important:** `saveUndo` must be called **before** modifying the chart. Every tool operation, import, and menu action that modifies chart data should call `saveUndo(label)` first.

---

## 17. Session Persistence and Autosave

### `localStorage` keys

| Key | Contents |
|---|---|
| `'vibe_dock_layout_v2'` | Dock panel positions and sizes |
| `'vibe_editr_tool_settings'` | Per-tool settings |
| `'vibe_editr_pinned_tools'` | Pinned tool IDs |
| `'vibe_editr_tools_win'` | Tools Hub window position/size |
| `'vibe_gameplay_win'` | Gameplay panel position/size |
| `'vibe_prefs'` | All System Preferences values |
| `'vibe_session'` | Last scroll position, zoom, view mode, play cursor |

### IndexedDB Autosave

`_idbAutosave()` serializes the current chart (as KSH text) and the raw audio bytes to an IndexedDB store. This runs:
- Once, 3 seconds after startup
- Every `prefs.autosaveInterval` seconds during editing (if not playing)
- Immediately after stopping playback if edits occurred during play
- Immediately after importing a chart

`_idbRecover()` loads the most recent autosave slot back into the editor.

---

## 18. How to Modify Common Things

### 18.1 Add a New Drawing Tool

1. **Add a button** in `index.html`'s `#toolbar`:
   ```html
   <button class="tool-btn" data-tool="my-tool" title="My Tool [6]">⊛ MyTool</button>
   ```

2. **Handle tool activation** in `app.js`'s `setTool(name)` function. Add a case to update cursor style and any tool-specific UI.

3. **Handle mouse events** in `onMouseDown(e)`, `onMouseMove(e)`, `onMouseUp(e)`. Check `if (tool === 'my-tool')` and implement drawing logic, calling `chart.addBtNote(...)` or equivalent, then `saveUndo(label)` and `render()`.

4. **Add a keyboard shortcut** in the `keydown` handler in `app.js`.

### 18.2 Change Timing Constants

- **Slam threshold:** Change `LASER_SLAM_TICKS` in `chart.js` (default 12 = 1/16 note). Or change the default value of `pref-slam-threshold` slider in `index.html` and its handler in app.js.
- **Hold scoring rate:** Change `HOLD_SAMPLE` in `game.js` (currently `TICKS_PER_BEAT / 8 = 6` ticks).
- **Laser connect threshold:** Change `CONNECT_THRESHOLD` in `chart.js::addLaserPoint` (currently 192 = 1 measure).
- **Default BPM:** Change `this.meta.bpm = 180` in `ChartData` constructor in `chart.js`, and update the default value on `#meta-bpm` in `index.html`.

### 18.3 Add a New FX Effect Type

1. **Add to `EFFECT_DEFS`** in `effects.js`:
   ```js
   mynewfx: {
     label: 'My New FX',
     kshName: 'MyNewFX',
     params: {
       intensity: { label: 'Intensity', min: 0, max: 100, step: 1, def: 50, unit: '%' },
       mix:       { label: 'Mix',       min: 0, max: 100, step: 1, def: 80, unit: '%' },
     }
   }
   ```

2. **Add to `effectToKsh`** in `effects.js`:
   ```js
   case 'mynewfx': return `MyNewFX;${p.intensity}`;
   ```

3. **Add to the dropdown** in `index.html`:
   ```html
   <option value="mynewfx">My New FX</option>
   ```

4. **Implement audio processing** in `app.js::updateFxEffects(tick)`:
   ```js
   else if (type === 'mynewfx') {
     if (_fxEffectType !== 'mynewfx') { _teardownFxEffect(); _fxEffectType = 'mynewfx'; }
     // Create your AudioNode, connect _fxWetIn → node → _fxWetGain
   }
   ```

5. **Add cleanup** in `_teardownFxEffect()` — null out your node references and disconnect them.

6. **Optionally add KSH import parsing** in `ksh.js::_kshEffectFromStr`.

### 18.4 Add a New Dock Panel

1. **Create the panel HTML** — a `<div>` element with any content, initially in `index.html` or created dynamically.

2. **Register it** after `dockInit()` in `app.js`:
   ```js
   dockRegister('my-panel', document.getElementById('my-panel'), 'My Panel', '⚡', 'right');
   ```

3. **Wire a toggle button** (e.g., in the Window menu):
   ```js
   document.getElementById('btn-my-panel').addEventListener('click', () => dockToggle('my-panel'));
   ```

4. Call `dockApplyLayout()` after all panels are registered to apply saved/default positions.

### 18.5 Change Laser Colors / Presets

**Change the default colors** — edit the `laserColors` object in `renderer.js`:
```js
const laserColors = {
  L:  '#1255e8',  // Left laser main fill
  Lg: '#1255e888', // Left laser glow
  Le: '#5588ff',   // Left laser edge
  R:  '#e000b8',   // Right laser main fill
  Rg: '#e000b888',
  Re: '#ff55e8',
};
```

**Add a new preset** — add an entry to `LASER_PRESETS` in `renderer.js`:
```js
'my-preset': { L: '#ff0000', Lg: '#ff000088', Le: '#ff5555', R: '#0000ff', Rg: '#0000ff88', Re: '#5555ff' },
```

Then add a button in `index.html` with `data-laser-preset="my-preset"` and a corresponding handler in `app.js`.

### 18.6 Change Score Thresholds or Grade Boundaries

Both `GameView._grade()` in `game.js` and `gpGrade()` in `gameplay.js` define the grade thresholds independently. Update both:

```js
// In game.js GameView._grade(score):
if (score >= 9900000) return { g: 'S',    col: '#ffee55' };
// ...

// In gameplay.js gpGrade(score):
if (score >= 9900000) return { label: 'S', color: '#ffe866' };
// ...
```

---

## 19. Keyboard Shortcuts Reference

| Key | Action |
|---|---|
| `1` | Select tool |
| `2` | BT Note tool |
| `3` | FX Note tool |
| `4` | Left Laser tool |
| `5` | Right Laser tool |
| `E` | Erase tool |
| `Tab` | Cycle through tools |
| `Space` | Play / Stop |
| `←` / `→` | Scroll left / right by one column |
| `Ctrl + ←` / `→` | Scroll by `numCols` |
| `Home` | Jump to start |
| `End` | Jump to end |
| `Page Up/Down` | Jump one screen |
| `Scroll` | Scroll chart |
| `Ctrl + Scroll` | Zoom in / out |
| `[` | Finer snap |
| `]` | Coarser snap |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` / `Shift+Z` | Redo |
| `Ctrl + C` | Copy selection |
| `Ctrl + X` | Cut selection |
| `Ctrl + V` | Paste |
| `Ctrl + A` | Select all |
| `Delete` / `Backspace` | Delete selection |
| `Escape` | Clear selection |
| `Ctrl + S` | Export KSH |
| `Ctrl + O` | Open file |
| `M` | Mirror selection |
| `H` | Toggle History panel |
| `C` | Open context menu |
| `+` / `-` | Zoom in / out |
| `L` | Set laser interpolation to Linear (in interp menu) |
| `S` | Set laser interpolation to Smooth/Bezier |
| `H` | Set laser interpolation to Step |

---

## 20. Error Handling and Logging

`logger.js` is loaded first and patches `console.error` to maintain an error log array. The `#error-badge` button in the top bar shows the error count and allows viewing the log.

**Error badge:** `<button id="error-badge" class="error-badge">Errors: 0</button>`

**Loading failures:**
- Audio decode errors are caught silently for SFX buffers (the `catch(() => {})` pattern).
- Chart import errors display an `alert('Error loading file:\n' + err.message)` dialog.
- Audio import errors show the `#modal-import-error` modal.

**Autosave:** If autosave fails (IndexedDB unavailable), it fails silently. Recovery shows a warning in the preferences panel.

**FX audio errors:** Effect node creation and teardown use `try/catch` to prevent audio errors from breaking the render loop.

---

## Appendix: Project File Tree

```
kson-game/
├── index.html
├── style.css
├── DEVELOPER.md             ← this file
├── js/
│   ├── logger.js
│   ├── effects.js
│   ├── chart.js
│   ├── renderer.js
│   ├── game.js
│   ├── ksh.js
│   ├── kson.js
│   ├── calibration.js       (beat offset calibration window — not covered here)
│   ├── i18n.js              (internationalization — not covered here)
│   ├── app.js
│   ├── dock.js
│   ├── tools.js
│   └── gameplay.js
├── sounds/
│   ├── slam.ogg
│   ├── tick.wav
│   └── tick.ogg
└── img/
    └── dev.jpg              (developer avatar for donate modal)
```

---

*Document generated 2026-05-10 by Claude for the vibe-editr (kson-game) project.*
