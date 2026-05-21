// main.js — ES module entry point for vibe-editr
// Single <script type="module"> entry point replacing all classic <script> tags.
// Modules are imported in dependency order; circular deps are handled by ES
// module live bindings (all cross-module references live inside function bodies).

// Leaf modules (no app-internal dependencies)
import './logger.js';
import './effects.js';
import './i18n.js';
import './chart.js';
import './velenv.js';
import './calibration.js';
import './gl-lane.js';
import './dock.js';

// Mid-tier modules (depend on chart.js / effects.js)
import './renderer.js';
import './game.js';
import './ksh.js';
import './kson.js';

// App core (depends on all above; has circular deps with satellite modules)
import './app.js';

// Satellite modules (import from app.js; app.js also imports from them — circular)
import './radar.js';
import './heatmap.js';
import './handsim.js';
import './gameplay.js';
import './tools.js';
