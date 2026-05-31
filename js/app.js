import { ChartData, TICKS_PER_MEASURE, TICKS_PER_BEAT, BEATS_PER_MEASURE, LASER_SLAM_TICKS, LASER_SLAM_V_EPS, setLaserSlamTicks, laserCharToPos, laserPosToChar, LANE, LANE_COUNT, LASER_CHARS } from './chart.js';
import { Renderer, C, laserColors, laserOpacity, laserWideMode, LASER_PRESETS, applyLaserPreset, setLaserColorCustom, buildLaneHeader, setLaserOpacity, setLaserWideMode } from './renderer.js';
import { GameView } from './game.js';
import { exportKsh, importKsh, downloadText } from './ksh.js';
import { exportKson, importKson, exportKsonPack, importKsonPack } from './kson.js';
import { EFFECT_DEFS, makeEffectInstance } from './effects.js';
import { calibrationWindow } from './calibration.js';
import { t, applyLocalization } from './i18n.js';
import { velEnvEditor, getVelEnvEditor, openVelEnvEditor, toggleVelEnvEditor } from './velenv.js';
import { dockInit, dockRegister, dockApplyLayout, dockToggle } from './dock.js';
import { openToolsWindow, savePatternFromSelection, pfFlipHorizontal as _pfFlipHorizontal, pfFlipTemporal as _pfFlipTemporal } from './tools.js';
import { openHeatmapWindow, updateHeatmap } from './heatmap.js';
import { updateRadar, openRadarWindow } from './radar.js';
import { openHandSimWindow } from './handsim.js';
import { openGameplayPanel, closeGameplayPanel, toggleGameplayPanel } from './gameplay.js';
import { logger } from './logger.js';
import { openFxAutoWindow, toggleFxAutoWindow, invalidateFxAuto, getFxAutoData } from './fxauto.js';

// ── Pre-init error capture ─────────────────────────────────────────────────────
// Runs before anything else so errors from ANY script (including imports,
// async DOMContentLoaded handlers, unhandled rejections, and sub-modules)
// are captured and shown on the loading screen rather than silently swallowed.
const _initErrors = [];
let   _initPhase  = 'pre-init';

function _showInitError(msg, file, line, col, err) {
  _initErrors.push({ msg, file, line, col, err });
  const errBox  = document.getElementById('loading-errors');
  const errList = document.getElementById('loading-error-list');
  const contBtn = document.getElementById('loading-continue-btn');
  if (errBox)  errBox.style.display = '';
  if (errList) {
    const src = file ? file.split('/').pop() : '';
    const loc = src  ? (line ? `[${src}:${line}]` : `[${src}]`) : '';
    const txt = (loc ? loc + ' ' : '') + msg;
    errList.textContent += (errList.textContent ? '\n' : '') + txt;
  }
  if (contBtn && contBtn.style.display === 'none') contBtn.style.display = '';
  // Also keep the stage label updated so the last stage is always visible
  const stageEl = document.getElementById('loading-stage');
  if (stageEl) stageEl.textContent = `⚠ Error during: ${_initPhase}`;
}

window.addEventListener('error', ev => {
  _showInitError(ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
});
window.addEventListener('unhandledrejection', ev => {
  const msg = ev.reason instanceof Error
    ? ev.reason.message
    : String(ev.reason ?? 'Unknown rejection');
  _showInitError('Unhandled Promise — ' + msg, null, null, null, ev.reason);
});

// ── Console banner ─────────────────────────────────────────────────────────────
console.log(
  '%c vibe-editr %c vibecoded by gamboiuwu ',
  'background:#1255e8;color:#fff;font-weight:bold;font-size:13px;padding:3px 8px;border-radius:4px 0 0 4px',
  'background:#e000b8;color:#fff;font-weight:bold;font-size:13px;padding:3px 8px;border-radius:0 4px 4px 0'
);
console.log('%cSDVX Chart Editor  ·  vibe-editr', 'color:#6668a0;font-size:11px');

// ── Version & Changelog ───────────────────────────────────────────────────────
const APP_VERSION = '0.0.35';
const CHANGELOG = [
  {
    version: '0.0.35',
    title: 'Freehand Laser Drawing',
    entries: [
      ['add', '<strong>Shift+drag to draw freehand lasers.</strong> Hold <kbd>Shift</kbd> while pressing the left or right laser tool and drag across the lane — a live path preview follows the cursor. On release, the raw path is automatically simplified using the Ramer-Douglas-Peucker algorithm, producing a clean set of anchor points that faithfully capture your gesture without unnecessary clutter.'],
      ['add', 'Freehand mode always starts a fresh laser section from the drag origin, so it never accidentally extends an existing laser. All simplified points use linear interpolation; you can Alt+click any anchor afterward to refine the curve type.'],
      ['add', 'Freehand drawing respects <strong>Laser Mirror Mode</strong> — if mirror mode is active, the RDP-simplified path is simultaneously mirrored to the opposite side with inverted v values, making symmetric patterns fast to sketch.'],
      ['add', 'The raw freehand path is drawn as a semi-transparent colored stroke in real time while dragging, so you can see the shape before it is committed and simplified.'],
    ],
  },
  {
    version: '0.0.34',
    title: 'Scroll Rate Sync & Laser Cap Alignment',
    entries: [
      ['fix', '<strong>All notes now scroll at the same rate in the 3D Preview.</strong> Lasers, FX notes, and BT buttons now all use velocity-adjusted timing so they move down the lane in perfect sync with each other and with the chart\'s scroll speed events.'],
      ['fix', '<strong>Laser entry caps no longer visually lead BT notes.</strong> The rectangular entry cap was extending past the judgment line, making lasers appear to arrive earlier than notes at the same tick. The cap is now clamped to the judgment line so all elements align correctly.'],
      ['fix', 'Beat/measure grid lines in the 3D Preview now also respect chart scroll speed events, keeping the grid in sync with notes.'],
    ],
  },
  {
    version: '0.0.33',
    title: 'Rectangular Laser Caps & 3D Preview Caps',
    entries: [
      ['fix', '<strong>Rectangular entry/exit caps.</strong> The laser section start (entry) and end (exit) markers are now solid rectangles instead of triangles, matching the SDVX arcade visual convention.'],
      ['add', '<strong>Caps and slam arrows now visible in 3D Preview.</strong> The WebGL-rendered 3D game preview now draws rectangular entry/exit caps and white slam-direction arrowheads on all laser sections, matching the 2D editor.'],
      ['fix', 'Preview laser caps properly extend toward and away from the judgment line, giving clear visual cues for where each laser section starts and ends in 3D perspective.'],
    ],
  },
  {
    version: '0.0.32',
    title: 'Laser Continuity & SDVX Entry/Exit Markers',
    entries: [
      ['fix', '<strong>Smooth/Linear/Step now works on slam-connected lasers.</strong> Right-clicking the point where a laser line meets a slam previously edited the slam segment (which always renders as a slam, so nothing visibly changed). The interp menu and Alt+click now target the <em>visible</em> line — the non-slam segment adjacent to the point — so you can finally curve the run leading into or out of a slam.'],
      ['fix', 'The laser interpolation menu no longer leaves a stale click handler bound when dismissed without a selection, which could apply <em>Smooth</em> to the wrong anchor on a later open.'],
      ['add', '<strong>Auto-connect touching lasers.</strong> When the end of one laser sits on the same tick and position as the start of another (whether the junction is a slam, a smooth curve, or a normal point), the two are automatically merged into one continuous laser. Placing or dragging a laser onto another laser\'s endpoint now joins them instead of leaving a disjoint break.'],
      ['add', '<strong>SDVX-style entry tail & exit head.</strong> Every laser now draws a tapered tail at its start and a head at its end in the 2D editor, so you can always see where a laser begins and ends — matching the in-game/KSM look.'],
      ['add', '<strong>Slam direction arrows.</strong> Each slam draws a white arrowhead at its destination pointing the way the knob flicks, so isolated slams clearly communicate which direction to move.'],
    ],
  },
  {
    version: '0.0.31',
    title: 'Live Onset BPM Detection [Experimental]',
    entries: [
      ['add', '<strong>🎵 Live Detect button</strong> in the Calibration window\'s BPM panel. Click to start playing audio and collecting real-time onset data; click again (or stop playback) to end detection and receive a BPM suggestion.'],
      ['add', 'Uses <strong>spectral flux onset detection</strong>: each animation frame, the frequency spectrum is compared to the previous frame and positive energy increases are summed into a flux value. An adaptive threshold (1.5× rolling mean) gates onset events, preventing spurious double-triggers.'],
      ['add', '<strong>Inter-Onset Interval (IOI) histogram</strong> accumulates the time gaps between detected onsets, with harmonic weighting at ½× and 2× each IOI so beat subdivisions and double-beats reinforce the dominant period. Quadratic peak interpolation gives sub-bin BPM accuracy.'],
      ['add', 'Detected onset positions are drawn as <strong>amber tick marks</strong> on the waveform as they are captured. A pulsing <em>⏺ DETECTING · N onsets</em> status label is visible in the top-right corner of the waveform during detection.'],
      ['add', 'After detection stops, the estimated BPM is shown as a <em>suggestion</em> (same Apply / Dismiss flow as Auto-Detect and Tap Tempo). The calibration marker and offset are never modified while detection is running.'],
      ['add', 'The AnalyserNode is now wired into every calibration playback session (zero audio impact — analyser nodes are read-only). This lets Live Detect start instantly even if audio was already playing before the button was clicked.'],
    ],
  },
  {
    version: '0.0.30',
    title: 'Pattern Flip / Temporal Mirror [Experimental]',
    entries: [
      ['add', '<strong>Pattern Flip tool</strong> — new tool in <strong>Tools Hub → Edit → Pattern Flip</strong>. Select any region with the Select tool, then apply a horizontal lane mirror, a temporal (time) reversal, or both in a single click.'],
      ['add', '<strong>Horizontal Flip</strong>: mirrors BT-A↔D and BT-B↔C, swaps FX-L↔R, swaps VOL-L↔R and inverts all laser <em>v</em> values (1−v) so the path reflects correctly across the centre axis.'],
      ['add', '<strong>Temporal Flip (Reverse)</strong>: reverses the order of notes in time within the selection. Hold notes are repositioned so their end point stays at the mirror position. Laser sections have their point sequences reversed so the path plays backwards. Optionally includes hi-speed events.'],
      ['add', '<strong>Flip Both</strong>: applies horizontal mirror first, then time reversal — useful for building rotational/rotationally-symmetric chart sections from a single authored phrase.'],
      ['add', 'Live selection status readout shows the tick range, measure count, and note/laser-point counts before applying any operation. All three operations are fully undoable with <kbd>Ctrl+Z</kbd>.'],
      ['add', 'Keyboard shortcuts: <kbd>Ctrl+Shift+H</kbd> for horizontal flip and <kbd>Ctrl+Shift+R</kbd> for temporal reversal (when a selection is active).'],
    ],
  },
  {
    version: '0.0.29',
    title: 'Chart Minimap',
    entries: [
      ['add', '<strong>Chart Minimap</strong> — a compact navigation strip at the bottom of the 2D editor that renders the entire chart at a glance. Lane rows show VOL-L (blue), FX-L (orange), BT A–D (white/grey), FX-R (orange), and VOL-R (pink) in a 52px-tall canvas spanning the full editor width.'],
      ['add', 'Click or drag on the minimap to instantly seek the playhead and scroll the editor to that chart position. The current viewport is shown as a highlighted region with a white border. A red playhead line tracks position in real time during playback.'],
      ['add', 'BPM change events appear as amber vertical markers so tempo changes are immediately visible across the whole chart. The minimap updates live as you add or remove notes.'],
      ['add', 'Toggle the minimap on/off via <strong>View → Chart Minimap</strong>. State persists across sessions via Save Config.'],
    ],
  },
  {
    version: '0.0.28',
    title: 'FX Effect Automation Lane [Experimental]',
    entries: [
      ['add', '<strong>FX Effect Automation Lane</strong> — new floating panel (<strong>Window → FX Automation…</strong>) for drawing per-tick mix-level automation curves for FX-L and FX-R independently. This implements the long-requested "REAPER FX style automation lanes" from the system spec.'],
      ['add', 'Breakpoints are placed by clicking the canvas and dragged vertically to adjust the mix value (0–100%). Right-click any breakpoint to delete it. Double-click to toggle between <em>Step</em> (instant change) and <em>Linear</em> (smooth ramp) interpolation per segment.'],
      ['add', 'The automation curve is visualized as a colored filled area — blue for FX-L, pink for FX-R — with labeled breakpoint dots showing exact mix percentages. Measure grid lines align with the chart timeline.'],
      ['add', 'Automation data is stored as <code>_fxAutomation</code> in the KSON custom field and survives full export/import round-trips. The 2D editor draws a thin colored automation strip overlay on each active FX hold lane.'],
      ['add', 'Mouse-wheel zooms the automation timeline in/out (centered on cursor position). Use the FX-L / FX-R tabs to switch channels and the Clear All button to reset a channel\'s automation.'],
    ],
  },
  {
    version: '0.0.27',
    title: 'Preferences Save Fix · i18n Expansion',
    entries: [
      ['fix', '<strong>Preferences Save button now works correctly</strong> — added the missing <code>savePrefsToLocalStorage()</code> function that was called in five places but never defined, causing a ReferenceError when saving preferences.'],
      ['add', '107 new translation keys added across all 5 locales (en/es/fr/ja/zh) covering File menu, Edit menu, Chart menu, View dropdown, Window menu, metadata panel labels, camera sub-panel, right-panel headings, toolbar hint, and audio status.'],
      ['add', '~90 previously untranslated HTML elements now carry <code>data-i18n</code> attributes. Buttons that contain <kbd> children use <span data-i18n> wrappers to preserve the keyboard shortcut badge.'],
    ],
  },
  {
    version: '0.0.26',
    title: 'Laser Symmetry Mirror Mode',
    entries: [
      ['add', '<strong>Laser Mirror Mode</strong> — new toggle (<strong>View → Laser Mirror Mode</strong> or <kbd>Shift+M</kbd>) that automatically creates a mirrored laser on the opposite side whenever you place a laser point. Left laser values are reflected (v → 1−v) to the right side and vice versa, making symmetric patterns quick to author.'],
      ['add', 'A persistent <strong>⟺ MIRROR</strong> badge appears in the top-left of the chart canvas while mirror mode is active, so the state is always visible.'],
      ['add', 'Mirror mode correctly tracks the active section on both sides — extending a laser segment on one side simultaneously extends the mirrored segment on the other. Pressing <kbd>Escape</kbd> or switching tool clears both the active and mirror sections cleanly.'],
    ],
  },
  {
    version: '0.0.25',
    title: 'KSM/KSON Camera Effects on WebGL Lanes',
    entries: [
      ['fix', '<strong>center_split now creates a true lane split</strong> — the left half (BT-A/B, FX-L, VOL-L) and right half (BT-C/D, FX-R, VOL-R) slide apart with a visible gap in the centre. Previously center_split incorrectly shifted the entire lane sideways. Both the 2D and WebGL render paths match KSM/KSON behaviour.'],
      ['add', '<strong>lane_toggle implemented</strong> — when a lane_toggle camera event is active the lane runway (background, panels, grid, dividers) is hidden while notes and lasers remain visible, matching KSM behaviour.'],
      ['fix', 'Beat-grid lines and vertical dividers now draw in two half-segments (left and right of centre) so they stay within their respective lane halves when center_split is active.'],
      ['chg', 'zoom_side offset is now independent of center_split: zoom_side shifts both halves together; center_split slides them apart from the shared centre.'],
    ],
  },
  {
    version: '0.0.24',
    title: 'KSM-Style Laser Rendering',
    entries: [
      ['chg', '<strong>Laser ribbons now match KSM Editor / SDVX in-game appearance</strong> — anchor dots are no longer drawn during normal viewing or playback. They appear only when the laser tool is active, the section is being edited, an anchor is selected, or the <em>Show envelope points always</em> preference is enabled. This matches KSM Editor\'s clean ribbon look.'],
      ['chg', 'Ribbon half-width tuned from <code>0.425 × BT_W</code> down to <code>0.38 × BT_W</code> so the laser proportions visually match KSM Editor and the official Sound Voltex lane geometry.'],
      ['chg', 'Outline stroke removed from the normal-state ribbon — KSM-style flat-color ribbons. The outline now appears only on the section the user is actively editing, providing a clear visual signal when in laser-edit mode.'],
      ['add', '<strong>SDVX-style inner highlight</strong> — a thin brighter stripe is now rendered along the center of each laser ribbon (in high-quality mode), reproducing the characteristic SDVX laser glow effect without the heavy outline.'],
      ['fix', 'Anchor dots are now correctly hidden during playback / 2D viewing when not in laser-edit mode (previously they were always drawn regardless of <code>showLaserDots</code>).'],
    ],
  },
  {
    version: '0.0.23',
    title: 'Pattern Snippet Library',
    entries: [
      ['add', '<strong>Pattern Snippet Library</strong> — new panel (<strong>Window → Pattern Snippets…</strong>) for saving and reusing note patterns. Select any region, click <em>Save Selection</em> in the panel, give it a name, and it persists across sessions.'],
      ['add', 'Each snippet shows its note count and tick length. Click a snippet to load it into the clipboard, then <kbd>Ctrl+V</kbd> to paste it anywhere in the chart.'],
      ['add', 'Double-click a snippet name to rename it. Individual snippets can be deleted with the ✕ button. All snippets are stored in browser localStorage and survive page reloads.'],
      ['add', '<em>Save as Snippet…</em> option added to the right-click context menu (<kbd>C</kbd>) for quick access without opening the panel.'],
      ['add', 'Filter/search bar at the top of the panel for quickly finding patterns by name when the library grows large.'],
    ],
  },
  {
    version: '0.0.22',
    title: 'Per-Note FX Effects · Chromatic Aberration Glitch',
    entries: [
      ['add', '<strong>Per-note FX effect overrides</strong> — each FX hold can now carry its own independent effect type and parameter values. Right-click (or hover) an FX hold to open the FX tooltip, select any effect from the dropdown, and tweak its sliders. The hold drives that effect during playback regardless of the lane chain setting.'],
      ['add', '<em>None</em> option added to the FX tooltip type selector — set an FX hold to None to explicitly silence any lane-chain effect during that hold while leaving the chain intact for other holds.'],
      ['add', '<strong>Chromatic aberration + frame distortion glitch effects</strong> — Glitch Events now produce a true per-channel RGB offset (SVG <code>feColorMatrix</code> filter) visible as color fringing at the screen edges, plus an irregular <code>scaleX/scaleY/skewX</code> CSS keyframe animation that intensifies with the glitch level.'],
      ['chg', 'FX hold labels in the 2D editor now display the per-note effect type (falling back to the lane chain if none is set), making per-note overrides immediately visible without opening the tooltip.'],
    ],
  },
  {
    version: '0.0.21',
    title: 'Section-Relative Paste',
    entries: [
      ['add', '<strong>Paste at Section Start</strong> — right-click menu now includes a <em>Paste at Section…</em> submenu that lists every named chart section. Selecting one pastes the clipboard contents at that section\'s start tick, offset-matched exactly as with normal paste.'],
      ['add', 'Section names and tick positions are shown in the submenu (e.g. <em>Intro — m1:b1</em>) so the target is always unambiguous.'],
      ['add', 'If no sections are defined the submenu shows a hint to add sections via <strong>Window → Chart Sections…</strong>'],
      ['add', 'Section-relative paste is undo-able via <kbd>Ctrl+Z</kbd> like all other paste operations.'],
    ],
  },
  {
    version: '0.0.20',
    title: 'Chart Section Labels',
    entries: [
      ['add', '<strong>Chart Section Labels</strong> — named ranges (Intro, Verse, Chorus, Bridge, Outro…) drawn as colored bands on the 2D ruler. Each section has a start tick, end tick, name, and color.'],
      ['add', '<strong>Section Navigator panel</strong> — open via <strong>Window → Chart Sections…</strong>. Lists all sections in order; click any row to jump the playhead to that section\'s start.'],
      ['add', '<strong>Selection-aware Add</strong> — the <em>+ Add</em> button uses the current selection range as the section start/end. With no selection active, it creates a 4-measure section starting at the playhead.'],
      ['add', 'Click a color swatch in the panel to cycle through a preset palette (red, amber, green, blue, violet, cyan, orange). Edit the section name inline.'],
      ['add', 'Section data is saved as <code>_sections</code> in the KSON custom extension field and survives full export/import round-trips.'],
      ['fix', 'CHANGELOG array syntax error (v0.0.19 second entry was missing its enclosing object braces) — fixed so the What\'s New popup displays all entries correctly.'],
    ],
  },
  {
    version: '0.0.19',
    title: 'Practice Playback Rate [Experimental]',
    entries: [
      ['add', '<strong>Playback Rate</strong> control added to the Game Preview side panel. A slider (0.25×–2.0×) adjusts audio and chart playback speed simultaneously in real time — slow down to analyse dense sections or speed up for challenge practice.'],
      ['add', 'Rate label turns <span style="color:#ffcc44">amber</span> whenever the rate is not 1.0×, providing a clear indicator that practice mode is active.'],
      ['add', 'Changing the rate mid-playback is seamless — the playhead continues from the correct chart position without jumping or drifting.'],
      ['add', 'Playback Rate is saved and restored by <em>Save Config</em> alongside Projection, HiSpeed, and Judge Y.'],
      ['fix', 'TapeStop FX effect now ramps from the active playback rate (rather than always from 1.0×), so it behaves correctly when practice rate is engaged.'],
    ],
  },
  {
    version: '0.0.19',
    title: 'Laser X Snap · Tool Consolidation',
    entries: [
      ['add', '<strong>Laser X-Axis Snapping</strong> — press <kbd>;</kbd> / <kbd>\'</kbd> while placing lasers to step through X-position grids (Free → 1/2 → 1/4 → 1/8 → 1/16 → 1/32 → 1/50 KSM). A yellow HUD shows the current grid near your cursor, mirroring the Y-snap behaviour of <kbd>[</kbd> / <kbd>]</kbd>.'],
      ['add', 'X-snap applied consistently in all laser edit surfaces: the 2D pen tool, the game-preview drag, and the multi-preview drag. Freehand laser points snap to the nearest X grid position on every mousemove.'],
      ['add', '<strong>Chart Validator</strong> — unified Integrity / Ergonomics / Export validation tool (replaces three separate overlapping validate tools). Tab-based UI groups: Integrity (structural errors + auto-fix), Ergonomics (hold collision + strain patterns), Export (pre-flight checklist). Total tool count unchanged.'],
      ['add', '<strong>Chart Statistics</strong> tool (Analysis tab) — at-a-glance grid showing BT/FX/VOL-L/VOL-R note counts, BPM range, measure count, laser coverage percentages, and peak density.'],
      ['add', '<strong>Laser Fixer</strong> tool (Validate tab) — scans all laser sections for structure bugs: negative <code>ry</code> values, unsorted points, duplicate ticks, out-of-range <code>v</code>, empty sections, negative <code>y</code>. One-click Auto Fix resolves all detected issues.'],
    ],
  },
  {
    version: '0.0.18',
    title: 'Tap Tempo BPM [Experimental]',
    entries: [
      ['add', '<strong>Tap Tempo</strong> — new button in the Calibration Mode BPM panel. Click <em>🥁 Tap Tempo</em> (or press <kbd>T</kbd> while calibration is open) repeatedly in time with the music to estimate BPM from tap intervals. After 2 taps the running estimate is shown live; after 4 or more taps the result is promoted to a confirmable suggestion using the same Apply / Dismiss flow as Auto-Detect.'],
      ['add', 'Tap sequence auto-resets after 3 seconds of inactivity so a new sequence can be started without closing the window.'],
      ['add', '<kbd>T</kbd> keyboard shortcut fires a tap and briefly flashes the button so keyboard-driven tapping gives clear visual feedback.'],
      ['add', 'Tap Tempo integrates with the existing BPM panel — confirmed tap BPM updates the beat-grid overlay in real time and is applied to the chart\'s first BPM event when the calibration window is closed with Apply.'],
    ],
  },
  {
    version: '0.0.18',
    title: 'Tap Tempo BPM Detection [Experimental]',
    entries: [
      ['add', '<strong>Tap Tempo</strong> — two new tap-to-detect BPM interfaces. Tap the <kbd>◉ Tap BPM [T]</kbd> button in the Calibration window in rhythm, or use the new Tap Tempo section inside <strong>Tools Hub → Edit → BPM Sync</strong>. Both compute the average inter-tap interval and display a live BPM estimate.'],
      ['add', 'Keyboard shortcut <kbd>T</kbd> triggers a tap while the Calibration window is open, so you can keep time against the audio without moving your hand to the mouse.'],
      ['add', 'Minimum 2 taps (1 interval) required for a BPM estimate; accuracy improves with each additional tap. Count and running average are displayed in real time.'],
      ['add', '<em>Apply</em> button updates the working BPM field and the beat grid overlay instantly. The Tools Hub variant also writes the value directly to the chart\'s BPM event list (undoable with <kbd>Ctrl+Z</kbd>).'],
      ['add', 'Auto-reset — if no tap is received for 3 seconds the counter clears automatically, ready for a fresh attempt. A <em>Reset</em> button allows manual clearing at any time.'],
    ],
  },
  {
    version: '0.0.17',
    title: 'Adaptive Pattern Compression [Experimental]',
    entries: [
      ['add', '<strong>Adaptive Pattern Compression</strong> — new tool in <strong>Window → Tools Hub → Edit → Adaptive Compress</strong>. Scans the chart in configurable measure windows, calculates notes-per-beat density for each window, and identifies chip notes to remove in order to bring over-limit windows back under a user-set threshold.'],
      ['add', 'Density bar chart — visual overview of all measure windows drawn on a canvas inside the tool panel. Over-threshold windows appear in red; safe windows in blue. Orange overlay on each bar shows what proportion of notes would be removed.'],
      ['add', 'Subdivision-priority removal — notes on the weakest rhythmic positions are removed first (64th notes → 32nd triplets → 32nd → 16th triplets → 16th → 8th triplets → 8th → quarter), preserving rhythmic structure while reducing density.'],
      ['add', 'Hold notes are never removed by the compression pass — only chip notes (len=0) are candidates.'],
      ['add', 'Two-step workflow: click <em>Analyze</em> to preview what would be removed (shown in the bar chart), then click <em>Apply Compression</em> to commit the change. The operation is pushed to the undo stack so Ctrl+Z fully reverts it.'],
      ['add', 'Per-tool settings (gear icon ⚙) allow configuring the default threshold, window size, and which lane groups (BT/FX) are targeted.'],
    ],
  },
  {
    version: '0.0.16',
    title: 'Velocity Envelope Editor [Experimental]',
    entries: [
      ['add', '<strong>Velocity Envelope Editor</strong> — Ableton-style clip-envelope canvas for chart scroll speed events. Open via <strong>Chart Velocity → Open Envelope Editor</strong> in the left sidebar or press <kbd>`</kbd>.'],
      ['add', 'Drag-to-place nodes — left-click anywhere on the canvas to place a velocity node; drag existing nodes to reposition. Right-click a node to delete it.'],
      ['add', 'Linear ramps — double-click any segment to toggle between <em>Step</em> (instant change) and <em>Linear</em> (smooth ramp to the next value). Linear segments display as diagonal ramp lines.'],
      ['add', 'Snap controls — snap tick position to Free / Measure / Beat / ½-Beat / ¼-Beat, and snap speed value to Free / 0.25 / 0.5 / 1.0 increments.'],
      ['add', 'KSON round-trip — linear segments are exported as the third array element in the KSON scroll_speed array and re-imported correctly. Step segments are exported without the third element for backward compatibility.'],
      ['chg', 'Velocity pills in the 2D lane editor show a tilde suffix (<code>vel ~</code>) when their outgoing segment is a linear ramp, making linear transitions visually distinct.'],
    ],
  },
  {
    version: '0.0.15',
    title: 'Multi-Interpretation Preview Modes',
    entries: [
      ['add', '<strong>Visual Mode</strong> selector added to the game preview side panel. Four modes switch instantly without modifying chart data.'],
      ['add', '<em>Standard</em> — full SDVX-style rendering with gradients and glow. Default behavior, unchanged.'],
      ['add', '<em>Simple</em> — flat solid colors, no gradients or glow. BT notes render white, FX notes orange. Best for reading dense sections at high hi-speed.'],
      ['add', '<em>Colorblind</em> — deuteranopia and protanopia-safe palette. Right laser remapped from pink to gold (#ddaa00).'],
      ['add', '<em>Wireframe</em> — near-transparent fills with bright outlines only. Useful for structural density analysis.'],
      ['chg', 'Selected Visual Mode is saved by <em>Save Config</em> alongside Projection, HiSpeed, and Judge Y, and restored on next launch.'],
    ],
  },
  {
    version: '0.0.14',
    title: 'Audio Event Anchoring [Experimental]',
    entries: [
      ['add', 'Audio Event Anchoring — new <strong>Audio → Audio Anchoring</strong> tool in the Tools Hub. Detects amplitude transients in the loaded audio and converts them to chart tick positions, with adjustable threshold and minimum-gap controls.'],
      ['add', '<em>Snap to Transients</em> mode — when enabled, note placement snaps to the nearest detected transient within half a grid cell, falling back to normal grid snap when no transient is nearby. Toggle via the Audio Anchoring tool or the <em>Experimental</em> context menu.'],
      ['add', '<em>Place Chip Notes at Transients</em> — bulk-places BT or FX chip notes on any lane at every detected transient position, optionally restricted to the current selection region.'],
      ['add', 'Transient list panel in the Audio Anchoring tool — lists every detected transient with its measure/beat position and audio timestamp. Click any row to seek the playhead there.'],
      ['add', 'Transient markers drawn as yellow tick lines in the 2D editor whenever snap-to-transients mode is active, giving continuous visual feedback about anchor positions.'],
    ],
  },
  {
    version: '0.0.13',
    title: 'Physics-Based Laser Smoothing [Experimental]',
    entries: [
      ['add', 'Physics Sim algorithm added to the Laser Smooth tool (<strong>Window → Tools Hub → Edit → Laser Smooth</strong>). Uses a spring-damper simulation: interior laser points are treated as particles connected to their neighbours by springs with configurable stiffness, damping, and step count. Endpoints and (optionally) slam anchors are held fixed, producing organic curves that settle naturally between hard direction changes.'],
      ['add', 'Three physics parameters exposed in the tool panel: <em>Stiffness</em> (spring pull strength), <em>Damping</em> (oscillation suppression), and <em>Steps</em> (simulation resolution). Higher stiffness straightens the path; lower stiffness preserves character while adding flow.'],
      ['add', '<em>Preserve slam anchors</em> toggle — when enabled, laser slam points are treated as additional fixed anchors so directional flicks are not softened by the simulation.'],
    ],
  },
  {
    version: '0.0.12',
    title: 'Edit positioning fix, spatial panning &amp; folder ksonpack',
    entries: [
      ['fix', 'Preview edit: ghost cursor now renders at the exact cursor position instead of the snapped-tick position, eliminating the rightward visual drift vs. placed notes.'],
      ['fix', 'Preview edit: canvas coordinates are now properly scaled (canvas.width / rect.width) so click registration matches the visual lane position accurately.'],
      ['fix', 'Preview edit: snap line continues to show the snapped tick position while the ghost shape tracks the cursor, giving clear feedback about both locations.'],
      ['add', 'Multi-chart: each chart\'s BT tick sounds are spatially panned by slot position — leftmost chart pans hard left, rightmost pans hard right, middle slots proportionally.'],
      ['add', 'Open Folder now detects .ksonpack files inside the selected folder and loads them directly without requiring the separate "Open KSONpack" button.'],
    ],
  },
  {
    version: '0.0.11',
    title: 'Multi-chart edit mode &amp; right-click erase',
    entries: [
      ['add', 'Multi-chart view now supports full edit mode — BT, FX, laser-L/R, erase, and drag-hold work on each chart slot independently.'],
      ['fix', 'Right-click in preview edit mode now erases notes instead of opening the context menu. Context menu is still available via right-click when edit mode is off.'],
      ['fix', 'Multi-chart edit: each slot targets its own chart tab, so edits are correctly isolated and immediately reflected in both the 3D view and 2D editor.'],
    ],
  },
  {
    version: '0.0.10',
    title: 'Preview edit mode overhaul &amp; tab position saving',
    entries: [
      ['fix', 'Tab position saving — scroll position and playhead tick are now remembered per tab and restored when switching. No more jumping back to measure 1.'],
      ['fix', 'Preview edit mode: tick mapping now uses a perspective-aware binary-search inverse of the projection formula, so notes land at the correct position in SDVX and Hybrid modes (previously only Ortho was correct).'],
      ['fix', 'Preview edit mode: tilt rotation is now accounted for when hitting the lane — click targets are accurate even when the lane is tilted.'],
      ['fix', 'Preview edit mode: snap grid is respected (uses the same snap setting as the 2D editor instead of hardcoded 1/16).'],
      ['add', 'Preview edit mode: Left and Right Laser tools added to the in-preview toolbar. Click to place laser anchor points.'],
      ['add', 'Preview edit mode: ghost cursor — a semi-transparent note shape follows the mouse and shows a snap-line so you can see exactly where a note will land before clicking.'],
      ['add', 'Preview edit mode: drag to draw hold notes — hold BT or FX tools extend the note length while dragging.'],
      ['add', 'Preview edit mode: Edit Mode toggle button added to the preview controls panel for one-click access without needing the right-click context menu.'],
    ],
  },
  {
    version: '0.0.9',
    title: 'Emotional Intensity Heatmap',
    entries: [
      ['add', 'Intensity Heatmap — full-chart note density visualization. Open via <strong>Window → Intensity Heatmap…</strong>. Each measure is color-coded from cool blue (sparse) to hot red (dense). Laser-L and Laser-R coverage appear as thin side channels. Click any row to seek the editor to that measure.'],
    ],
  },
  {
    version: '0.0.8',
    title: 'Temporal mirror, diagnostics &amp; experimental features',
    entries: [
      ['add', 'Startup diagnostics — checks note overlaps, laser continuity, BPM range, KSON integrity. Re-run via <strong>Window → System Diagnostics</strong>.'],
      ['add', 'Experimental Features tab in Preferences — opt-in toggles for Pattern Anomaly Detection, Predictive Chart Assist, and Ghost Playback Tracing.'],
      ['add', 'Pattern anomaly detection — (experimental) highlights physically impossible jacks and all-lane simultaneity in the edit canvas.'],
      ['add', 'Temporal mirror — flip time ordering of current selection. <strong>Edit → Modify → Temporal Mirror All/BT/VOL</strong>.'],
      ['add', 'Predictive chart assist — (experimental) ghost-note suggestions while placing BT notes.'],
      ['add', 'Ghost playback tracing — (experimental) hand-position arcs in the 3D preview during playback.'],
    ],
  },
  {
    version: '0.0.7',
    title: 'Song data window & pattern radar',
    entries: [],
  },
  {
    version: '0.0.6',
    title: 'Hand simulator',
    entries: [],
  },
  {
    version: '0.0.5',
    title: 'Gameplay preview',
    entries: [],
  },
  {
    version: '0.0.4',
    title: 'Split view',
    entries: [],
  },
];

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabs = [{ name: 'Chart 1', chart: new ChartData(), audioBuffer: null, hispeed: 1.0 }];
let activeTabIdx = 0;

// ── State ─────────────────────────────────────────────────────────────────────
export let chart    = tabs[0].chart;
export let renderer = null;
let tool     = 'select';
let snap     = 12;
// Laser X-axis snap: 0 = free, otherwise snap v to nearest multiple
let laserXSnap = 0;
// Laser Mirror Mode: when true, placing a laser point auto-creates a mirrored point on the opposite side
let laserMirrorMode = false;
// Active mirror-side laser section (opposite side of the one being drawn)
let _mirrorLaserSec = null;

// ── Chart Minimap ─────────────────────────────────────────────────────────────
let minimapVisible = false;
let _minimapDragging = false;

const drag = { active: false, lane: -1, laneType: '', startTick: 0, side: 0, localX: 0, laserSec: null, freehand: false, freehandPts: [], freehandSide: 0, freehandStartTick: 0 };
export const sel  = { active: false, dragging: false, startTick: 0, endTick: 0, clipboard: null };
const undoStack = [], redoStack = [];
let MAX_UNDO = 100; // adjustable via preferences
let _hasUnsavedChanges = false; // track if chart has unsaved changes

// ── Camera tilt mode (updated by updateCameraFromEvents) ──────────────────────
let _tiltMode = 'zero'; // 'zero' | 'normal' | 'reverse' | 'keep'

// ── Chart annotation overlay ──────────────────────────────────────────────────
// Populated by tools (Hand Optimizer, Validity Checker) to show animated warning
// markers in both the 2D editor and SDVX game preview.
// Each entry: { tick, label, severity ('error'|'warn'), source, createdAt }
const _chartAnnotations = [];
const _ANN_LIFETIME = 7000; // ms visible (last 1200ms = fade-out)
const _ANN_FADE     = 1200; // ms of fade at end

export function addChartAnnotation({ tick, label, severity, source }) {
  // Deduplicate by tick+source
  const idx = _chartAnnotations.findIndex(a => a.tick === tick && a.source === source);
  if (idx >= 0) _chartAnnotations.splice(idx, 1);
  _chartAnnotations.push({ tick: Math.round(tick), label, severity, source, createdAt: Date.now() });
  // Keep at most 30 live annotations
  while (_chartAnnotations.length > 30) _chartAnnotations.shift();
  // Kick the animation loop if not already running
  if (typeof _startAnnotationLoop === 'function') _startAnnotationLoop();
}

function _pruneAnnotations() {
  const cutoff = Date.now() - _ANN_LIFETIME;
  for (let i = _chartAnnotations.length - 1; i >= 0; i--) {
    if (_chartAnnotations[i].createdAt < cutoff) _chartAnnotations.splice(i, 1);
  }
}

function _annAlpha(ann) {
  const age = Date.now() - ann.createdAt;
  if (age >= _ANN_LIFETIME) return 0;
  if (age < _ANN_LIFETIME - _ANN_FADE) return 1;
  return 1 - (age - (_ANN_LIFETIME - _ANN_FADE)) / _ANN_FADE;
}

// Keep annotation animations alive even when nothing else is rendering.
// Runs at ~30 fps while annotations exist (bouncing markers need constant redraw).
let _annAnimActive  = false;
let _annLastFrame   = 0;
const _ANN_FPS      = 30;
function _startAnnotationLoop() {
  if (_annAnimActive) return;
  _annAnimActive = true;
  const loop = (now) => {
    _pruneAnnotations();
    if (_chartAnnotations.length === 0) { _annAnimActive = false; return; }
    // Throttle to ~30fps
    if (now - _annLastFrame >= 1000 / _ANN_FPS) {
      _annLastFrame = now;
      // Full chart redraw so annotations don't smear onto stale pixels
      renderer?.draw();
      renderer?.drawAnnotations?.(_chartAnnotations, _annAlpha);
      if (gameView && viewMode !== 'edit') {
        gameView.draw();
        gameView.drawAnnotations?.(_chartAnnotations, _annAlpha);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ── Camera-pill hover popup state ─────────────────────────────────────────────
// _camPopupPinned: true while the mouse is inside the popup (prevents auto-hide)
let _camPopupPinned = false;
// _camPopupFixedTick: the tick whose popup is currently pinned open (null = closed)
let _camPopupFixedTick = null;
// _fxPopupFixedLane: 0 or 1 while FX hold popup is open, null when closed
let _fxPopupFixedLane = null;
// ── Chart Velocity pill popup state ──────────────────────────────────────────
let _velPopupPinned   = false;
let _velPopupFixedTick = null;

// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx         = null;
export let audioBuffer      = null;
let audioArrayBuffer = null; // raw bytes preserved before decodeAudioData (for IDB)
let audioSource      = null;
let audioStartAcTime = 0;
let audioStartChartSec = 0;
let playbackRate = 1.0;  // practice playback rate (1.0 = normal)
let laserFilterNode  = null;
let masterGainNode   = null;
let slamBuffer       = null;
let clapBuffer       = null;
let tickBuffer       = null;
let slamGainNode     = null;
let tickGainNode     = null;
let musicGainNode    = null;

// ── FX Effect Audio Nodes ────────────────────────────────────────────────────
// Wet/dry routing:  laserFilterNode → fxDryGain ─────────────────────────┐
//                                  → fxWetIn → [effect] → fxWetGain → mixOut → musicGainNode
let _fxDryGain    = null; // bypasses effect
let _fxWetIn      = null; // input to effect chain
let _fxWetGain    = null; // output mix control
let _fxMixOut     = null; // common output → musicGainNode
let _fxEffectType = null; // currently active effect type string

// ── FX chip SE (per-chart custom sounds from KSH fx-l_se / fx-r_se) ──────────
let fxChipSEBuffers = [null, null]; // [L, R] AudioBuffers
// Effect-specific nodes (created lazily)
let _fxWobbleFilter = null, _fxWobbleLFO = null, _fxWobbleLFOGain = null;
let _fxGateGain     = null, _fxGateTimer = null;
let _fxEchoDelay    = null, _fxEchoFB    = null, _fxEchoWet = null;
let _fxScGain       = null, _fxScTimer   = null;
let _fxFlangerDelay = null, _fxFlangerLFO = null, _fxFlangerLFOGain = null, _fxFlangerFB = null;
let _fxPhaserFilters = null, _fxPhaserLFO = null, _fxPhaserLFOGain = null;
let _fxBitcrusherProc = null;
let _fxRetriggerProc  = null;
let _fxTapeStopActive = false;

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    masterGainNode = audioCtx.createGain();
    // Actual value set below after prefs are applied
    masterGainNode.connect(audioCtx.destination);

    // Music chain:
    //   audioSource → laserFilter → fxDryGain ──────────────────────┐
    //                             → fxWetIn → [effects] → fxWetGain → fxMixOut → musicGain → master
    musicGainNode = audioCtx.createGain();
    musicGainNode.connect(masterGainNode);

    _fxMixOut = audioCtx.createGain();
    _fxMixOut.gain.value = 1.0;
    _fxMixOut.connect(musicGainNode);

    _fxDryGain = audioCtx.createGain();
    _fxDryGain.gain.value = 1.0;
    _fxDryGain.connect(_fxMixOut);

    _fxWetIn = audioCtx.createGain();
    _fxWetIn.gain.value = 1.0;

    _fxWetGain = audioCtx.createGain();
    _fxWetGain.gain.value = 0.0; // silent until an effect is active
    _fxWetGain.connect(_fxMixOut);

    laserFilterNode = audioCtx.createBiquadFilter();
    laserFilterNode.type = 'lowpass';
    laserFilterNode.frequency.value = 20000;
    laserFilterNode.Q.value = 1.5;
    laserFilterNode.connect(_fxDryGain);
    laserFilterNode.connect(_fxWetIn);

    // SFX chains: slamGain → master, tickGain → master
    slamGainNode = audioCtx.createGain();
    slamGainNode.connect(masterGainNode);
    tickGainNode = audioCtx.createGain();
    tickGainNode.connect(masterGainNode);

    // ── Apply saved volume prefs immediately on first audio init ─────────────
    // prefs is already loaded from localStorage by this point, so we can use
    // whatever the user last saved. Fall back to safer defaults (slams/ticks
    // are naturally loud; ship them quieter than music by default).
    masterGainNode.gain.value = prefs.volMaster ?? 0.85;
    musicGainNode.gain.value  = prefs.volMusic  ?? 0.80;
    slamGainNode.gain.value   = prefs.volSlam   ?? 0.28;
    tickGainNode.gain.value   = prefs.volTick   ?? 0.22;

    navigator.mediaDevices?.addEventListener('devicechange', async () => {
      if (audioCtx?.state === 'suspended') await audioCtx.resume();
    });
    // Load slam sound
    fetch('sounds/slam.ogg').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { slamBuffer = buf; }).catch(() => {});
    // Load clap sound for FX chips
    fetch('sounds/tick.wav').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { clapBuffer = buf; }).catch(() => {});
    // Load tick sound for BT/FX hits
    fetch('sounds/tick.ogg').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { tickBuffer = buf; }).catch(() => {});
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

async function loadAudioFile(file) {
  _loadingShow(`Loading audio: ${file.name}`, 20);
  ensureAudioCtx();
  const buf = await file.arrayBuffer();
  _loadingShow('Decoding audio…', 55);
  audioArrayBuffer = buf.slice(0); // preserve bytes before decodeAudioData may transfer ownership
  audioBuffer = await audioCtx.decodeAudioData(buf);
  document.getElementById('audio-status').textContent = `Audio: ${file.name}`;
  _loadingDone();
  window.dispatchEvent(new CustomEvent('vibe:audio-ready', { detail: { buffer: audioBuffer } }));
}

// ── Playback ──────────────────────────────────────────────────────────────────
export let playing        = false;
let playStartPerf  = 0;
let playStartTickV = 0;
let chartSpeed     = 1.0;  // hispeed: visual scroll density only
let prevPlayTick   = 0;

// ── View mode ─────────────────────────────────────────────────────────────────
let viewMode = 'split'; // start with 3D lane visible by default
export let gameView = null;
const settings = { tickSound: false };

// Apply a new beats-per-lane value and update all related UI.
function applyBeatsPerLane(beats) {
  if (!renderer) return;
  renderer.beatsPerCol = beats;
  const bplSlider = document.getElementById('beats-per-lane');
  const bplLabel  = document.getElementById('beats-per-lane-label');
  if (bplSlider) bplSlider.value = renderer.beatsPerCol;
  if (bplLabel) {
    const b = renderer.beatsPerCol;
    const frac = b % 4 === 0
      ? `${b / 4} meas`
      : b % 2 === 0
        ? `${b / 2} half-meas`
        : `${b} beat${b !== 1 ? 's' : ''}`;
    bplLabel.textContent = `${b} (${frac})`;
  }
  renderer.resize();
  render();
  if (typeof updateSeekbar === 'function') updateSeekbar(renderer.playTick);
}

// ── Tab management ────────────────────────────────────────────────────────────
function switchToTab(idx) {
  // Save current position before switching
  tabs[activeTabIdx].chart      = chart;
  tabs[activeTabIdx].audioBuffer = audioBuffer;
  tabs[activeTabIdx].hispeed    = chartSpeed;
  tabs[activeTabIdx].scrollCol  = renderer?.scrollCol ?? 0;
  tabs[activeTabIdx].playTick   = renderer?.playTick  ?? 0;

  activeTabIdx = idx;
  chart = tabs[activeTabIdx].chart;
  audioBuffer = tabs[activeTabIdx].audioBuffer || null;
  chartSpeed = tabs[activeTabIdx].hispeed ?? 1.0;
  _hasUnsavedChanges = false;
  if (renderer) {
    renderer.chart     = chart;
    // Restore saved position for this tab (defaults to 0 on first visit)
    renderer.scrollCol = tabs[activeTabIdx].scrollCol ?? 0;
    renderer.playTick  = tabs[activeTabIdx].playTick  ?? 0;
  }
  if (gameView) { gameView.chart = chart; gameView.hispeed = chartSpeed; gameView._totalWeight = 0; gameView.playTick = renderer?.playTick ?? 0; }
  if (typeof velEnvEditor !== 'undefined' && velEnvEditor) {
    velEnvEditor.setChart(chart);
  }
  _glitchAppliedLevel = -1; // force re-evaluation for the new chart
  _updateGlitchFromTick(renderer?.playTick ?? 0);
  // Sync hispeed UI sliders to restored value
  const _hsSl  = document.getElementById('pvc-hispeed');
  const _hsLbl = document.getElementById('pvc-hispeed-label');
  const _topSl  = document.getElementById('chart-speed');
  const _topLbl = document.getElementById('chart-speed-label');
  if (_hsSl)  _hsSl.value  = chartSpeed;
  if (_hsLbl) _hsLbl.textContent = chartSpeed.toFixed(1) + '×';
  if (_topSl)  _topSl.value  = chartSpeed;
  if (_topLbl) _topLbl.textContent = chartSpeed.toFixed(2) + '×';
  pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
  renderFxChain(0); renderFxChain(1);
  renderTabBar();
  _multiUpdateTabButtons();
  render();
  updateSeekbar(renderer ? renderer.playTick : 0);
}

function addTab() {
  tabs.push({ name: `Chart ${tabs.length + 1}`, chart: new ChartData(), audioBuffer: null, hispeed: chartSpeed });
  switchToTab(tabs.length - 1);
  _multiUpdateTabButtons();
}

// Show a confirmation modal before closing a tab.
// Calls closeTab(idx) only if the user confirms.
function _confirmCloseTab(idx) {
  if (tabs.length <= 1) return; // can't close last tab — no need to ask
  const name = tabs[idx]?.name ?? `Tab ${idx + 1}`;
  const modal = document.getElementById('modal-close-tab-confirm');
  const msg   = document.getElementById('close-tab-confirm-msg');
  const btnOk = document.getElementById('close-tab-confirm-ok');
  const btnNo = document.getElementById('close-tab-confirm-cancel');
  if (!modal) { closeTab(idx); return; } // fallback if modal missing
  if (msg) msg.textContent = `"${name}" will be closed. Any unsaved changes will be lost.`;
  modal.style.display = 'flex';
  const ok = () => { cleanup(); modal.style.display = 'none'; closeTab(idx); };
  const no = () => { cleanup(); modal.style.display = 'none'; };
  const onKey = e => { if (e.key === 'Escape') no(); if (e.key === 'Enter') ok(); };
  const cleanup = () => {
    btnOk.removeEventListener('click', ok);
    btnNo.removeEventListener('click', no);
    window.removeEventListener('keydown', onKey, true);
  };
  btnOk.addEventListener('click', ok);
  btnNo.addEventListener('click', no);
  window.addEventListener('keydown', onKey, true);
}

function closeTab(idx) {
  if (tabs.length <= 1) return; // can't close last tab
  // Remove from multi mask if present
  _multiTabMask.delete(idx);
  // Shift indices above idx down by 1
  const newMask = new Set();
  for (const i of _multiTabMask) newMask.add(i > idx ? i - 1 : i);
  _multiTabMask.clear(); for (const i of newMask) _multiTabMask.add(i);
  tabs.splice(idx, 1);
  const newIdx = Math.max(0, Math.min(idx, tabs.length - 1));
  // Don't use switchToTab which tries to save the current (now removed) tab
  activeTabIdx = newIdx;
  chart = tabs[activeTabIdx].chart;
  audioBuffer = tabs[activeTabIdx].audioBuffer || null;
  chartSpeed = tabs[activeTabIdx].hispeed ?? 1.0;
  if (renderer) { renderer.chart = chart; renderer.scrollCol = 0; renderer.playTick = 0; }
  if (gameView) { gameView.chart = chart; gameView.hispeed = chartSpeed; gameView._totalWeight = 0; }
  const _csSl = document.getElementById('chart-speed'); const _csLbl = document.getElementById('chart-speed-label');
  const _pvSl = document.getElementById('pvc-hispeed'); const _pvLbl = document.getElementById('pvc-hispeed-label');
  if (_csSl) _csSl.value = chartSpeed; if (_csLbl) _csLbl.textContent = chartSpeed.toFixed(2) + '×';
  if (_pvSl) _pvSl.value = chartSpeed; if (_pvLbl) _pvLbl.textContent = chartSpeed.toFixed(1) + '×';
  pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
  renderFxChain(0); renderFxChain(1);
  renderTabBar();
  _multiUpdateTabButtons();
  if (_multiMode) _multiRebuild();
  render();
}

let _tabDragIdx = -1;

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  tabs.forEach((t, i) => {
    const tab = document.createElement('div');
    tab.className = 'tab-item' + (i === activeTabIdx ? ' active' : '');
    tab.draggable = true;
    tab.dataset.idx = i;
    tab.innerHTML = `<span class="tab-name" title="Double-click to rename">${t.name}</span><button class="tab-close" data-close="${i}" title="Close tab">✕</button>`;

    tab.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      _confirmCloseTab(+e.currentTarget.dataset.close);
    });
    tab.querySelector('.tab-name').addEventListener('dblclick', () => renameTab(i));
    tab.addEventListener('click', e => { if (!e.target.closest('.tab-close')) switchToTab(i); });
    tab.addEventListener('contextmenu', e => { e.preventDefault(); showTabContextMenu(i, e.clientX, e.clientY); });

    // Drag-and-drop reorder
    tab.addEventListener('dragstart', e => {
      _tabDragIdx = i;
      tab.classList.add('tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    tab.addEventListener('dragend', () => {
      _tabDragIdx = -1;
      bar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-dragging', 'tab-dragover'));
    });
    tab.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      bar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-dragover'));
      tab.classList.add('tab-dragover');
    });
    tab.addEventListener('drop', e => {
      e.preventDefault();
      const from = _tabDragIdx;
      const to   = i;
      if (from < 0 || from === to) return;
      const moved = tabs.splice(from, 1)[0];
      tabs.splice(to, 0, moved);
      const newActive = from === activeTabIdx ? to : (activeTabIdx >= Math.min(from, to) && activeTabIdx <= Math.max(from, to)) ? activeTabIdx + (from < to ? -1 : 1) : activeTabIdx;
      activeTabIdx = Math.max(0, Math.min(newActive, tabs.length - 1));
      renderTabBar();
    });

    bar.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'New tab';
  addBtn.addEventListener('click', addTab);
  bar.appendChild(addBtn);
}

function renameTab(idx) {
  const name = prompt('Tab name:', tabs[idx].name);
  if (name) { tabs[idx].name = name; renderTabBar(); _multiUpdateTabButtons(); }
}

function duplicateTab(idx) {
  const src = tabs[idx];
  // Deep-copy chart data into a fresh ChartData so all methods are available
  const srcData  = JSON.parse(JSON.stringify(src.chart));
  const newChart = new ChartData();
  Object.assign(newChart, srcData);
  tabs.splice(idx + 1, 0, {
    name: src.name + ' (copy)',
    chart: newChart,
    audioBuffer: src.audioBuffer,
    hispeed: src.hispeed ?? 1.0,
  });
  switchToTab(idx + 1);
}

function showTabContextMenu(idx, x, y) {
  document.getElementById('tab-ctx-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'tab-ctx-menu';
  menu.style.cssText = [
    'position:fixed', 'z-index:10000', 'background:#1a1a2e',
    'border:1px solid #303060', 'border-radius:6px', 'padding:4px 0',
    'min-width:140px', 'box-shadow:0 4px 16px rgba(0,0,0,0.6)',
    'font-size:12px',
  ].join(';');

  const items = [
    { label: 'Rename',    action: () => renameTab(idx) },
    { label: 'Duplicate', action: () => duplicateTab(idx) },
    { sep: true },
    { label: 'Close', action: () => _confirmCloseTab(idx), danger: true },
  ];
  for (const item of items) {
    if (item.sep) {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:#303060;margin:3px 0';
      menu.appendChild(hr); continue;
    }
    const el = document.createElement('div');
    el.textContent = item.label;
    el.style.cssText = `padding:6px 16px;cursor:pointer;color:${item.danger ? '#ff6666' : '#c8c8ff'}`;
    el.addEventListener('mouseenter', () => { el.style.background = '#252548'; });
    el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
    el.addEventListener('click', () => { menu.remove(); item.action(); });
    menu.appendChild(el);
  }

  document.body.appendChild(menu);
  // Constrain to viewport after render
  requestAnimationFrame(() => {
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth  - mw - 6) + 'px';
    menu.style.top  = Math.min(y, window.innerHeight - mh - 6) + 'px';
  });

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}

// ── Tick / Second conversion (uses chartSpeed) ───────────────────────────────
function tickToSeconds(tick) {
  let seconds = 0;
  let prevTick = 0;
  let prevBpm  = Math.max(1, chart.bpmEvents[0]?.bpm || 120);
  for (const ev of chart.bpmEvents) {
    if (ev.y >= tick) break;
    // Add time for the segment [prevTick, ev.y] at the PREVIOUS BPM (active before this event)
    seconds  += (ev.y - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
    prevTick  = ev.y;
    prevBpm   = Math.max(1, ev.bpm || 120);
  }
  // Remaining ticks after the last BPM event before `tick`
  seconds += (tick - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
  return seconds;
}

function secondsToTick(sec) {
  let t = 0, prevSec = 0;
  let prevBpm = Math.max(1, chart.bpmEvents[0]?.bpm || 120);
  for (const ev of chart.bpmEvents) {
    const evSec = tickToSeconds(ev.y);
    if (evSec >= sec) break;
    t = ev.y; prevSec = evSec; prevBpm = Math.max(1, ev.bpm || 120);
  }
  t += (sec - prevSec) * prevBpm / 60 * TICKS_PER_BEAT;
  return t;
}

// ── Stop-aware audio time ─────────────────────────────────────────────────────
// Returns the total elapsed audio-file time (in seconds) when the chart has
// visually reached `tick`, accounting for stop-event pause durations.
// The audio recording plays linearly; stop events only freeze the lane.
// stopDurSec for each stop before `tick` must be added to get the correct seek.
function tickToAudioSec(tick) {
  let sec = tickToSeconds(tick);
  const stops = [...(chart.stopEvents ?? [])].sort((a, b) => a.y - b.y);
  for (const stop of stops) {
    if (stop.y >= tick) break;
    const bpmAtStop = chart.getBpmAt(stop.y);
    sec += stop.len / TICKS_PER_BEAT * (60 / bpmAtStop);
  }
  return sec;
}

// ── Stop-aware visual tick ────────────────────────────────────────────────────
// During a stop event the visual tick freezes at stop.y while audio (and real
// time) continue to advance.  This function converts elapsed seconds → visual
// tick, skipping over any stop durations that have been consumed.
// NOTE: `elapsedSec` must be in stop-aware audio seconds (from tickToAudioSec),
// not BPM-only seconds (from tickToSeconds).
function computeVisualTickWithStops(elapsedSec) {
  if (!chart?.stopEvents?.length) return secondsToTick(elapsedSec);

  // Sort stops by position so we can walk them in order
  const stops = [...chart.stopEvents].sort((a, b) => a.y - b.y);

  let remSec  = elapsedSec;
  let visTick = 0;

  for (const stop of stops) {
    // Time to reach this stop from current visual position
    const secToStop = tickToSeconds(stop.y) - tickToSeconds(visTick);
    if (secToStop > remSec) break; // stop is beyond our elapsed time
    remSec  -= secToStop;
    visTick  = stop.y;

    // Compute stop duration in seconds at current BPM
    const bpmAtStop  = chart.getBpmAt(stop.y);
    const stopDurSec = stop.len / TICKS_PER_BEAT * (60 / bpmAtStop);

    if (remSec < stopDurSec) {
      // We are INSIDE this stop — visual tick is frozen at stop.y
      return visTick;
    }
    remSec -= stopDurSec;
    // After the stop, advance past it (visual tick stays at stop.y; no ticks consumed)
    // so continue the loop from the same visTick position but with less remSec
  }

  // No more stops — advance normally from visTick using remaining seconds
  return secondsToTick(tickToSeconds(visTick) + remSec);
}

// ── Playback functions ────────────────────────────────────────────────────────
function togglePlay() {
  playing ? stopPlay() : startPlay();
}

let playStopTick = -1; // -1 = play until end

function startPlay(stopAtTick = -1) {
  playStopTick      = stopAtTick;
  ensureAudioCtx();
  playing           = true;
  renderer.playing  = true;
  playStartPerf     = performance.now();
  playStartTickV    = renderer.playTick;
  prevPlayTick      = renderer.playTick;

  // BPM-only seconds: used to seek the audio FILE (which plays linearly, no stops)
  const chartSecBpm  = tickToSeconds(renderer.playTick);
  // Stop-aware seconds: used for computeVisualTickWithStops() in playFrame
  const chartSecAware = tickToAudioSec(renderer.playTick);
  const offset   = (+(chart.meta.offset) || 0) / 1000; // guard NaN from bad metadata

  if (audioBuffer) {
    if (audioSource) { try { audioSource.stop(); } catch(e) {} }
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.playbackRate.value = 1.0; // audio always plays at normal speed; only lane scroll is rate-scaled
    audioSource.connect(laserFilterNode || audioCtx.destination);

    // Add user-calibrated global audio delay (System Preferences > Audio)
    const userDelay      = (prefs.audioDelay ?? 0) / 1000;
    // Seek the audio file using BPM-only time (audio recording has no stop gaps)
    const rawSeek        = chartSecBpm + offset + userDelay;
    // Guard: NaN / ±Infinity from bad BPM/offset data must not reach the AudioNode
    const audioSeek      = isFinite(rawSeek) ? rawSeek : 0;
    audioStartAcTime     = audioCtx.currentTime;
    // Store stop-aware chart time so computeVisualTickWithStops() works correctly
    // when starting playback from a position that follows stop events.
    audioStartChartSec   = isFinite(chartSecAware) ? chartSecAware : 0;

    if (audioSeek >= 0) {
      audioSource.start(audioCtx.currentTime, audioSeek);
    } else {
      const delay = -audioSeek;
      audioSource.start(audioCtx.currentTime + delay);
      audioStartAcTime += delay;
    }
    audioSource.onended = () => { if (playing) stopPlay(); };
  }

  updatePlayBtn(true);
  // Ensure radar animation loop is running if window is open
  if (typeof _startRdrLoop === 'function' && typeof _rdrVisible !== 'undefined' && _rdrVisible) {
    _startRdrLoop();
  }
  requestAnimationFrame(playFrame);
}

function stopPlay() {
  playing = false;
  renderer.playing = false;
  if (audioSource) { try { audioSource.stop(); } catch(e) {} audioSource = null; }
  // Reset live camera so the view snaps back to static chart.camera
  if (gameView) gameView._liveCamera = null;
  _tiltMode = 'zero';
  // Tear down any active FX effect and restore dry signal
  _teardownFxEffect();
  if (_fxWetGain)  _fxWetGain.gain.setTargetAtTime(0, audioCtx?.currentTime ?? 0, 0.05);
  if (_fxDryGain)  _fxDryGain.gain.setTargetAtTime(1, audioCtx?.currentTime ?? 0, 0.05);
  updatePlayBtn(false);
  updateSeekbar(renderer ? renderer.playTick : 0);
  render();
  // Flush any autosave that was deferred during playback
  if (_pendingAutosaveAfterPlay) {
    _pendingAutosaveAfterPlay = false;
    setTimeout(_idbAutosave, 600); // brief grace period so RAF has time to settle
  }
}
let _pendingAutosaveAfterPlay = false;

function playFrame(now) {
  if (!playing) return;

  let currentTick;
  // Video delay: shift the *visual* tick by N ms relative to audio (positive = visuals appear later)
  const videoOffsetSec = (prefs.videoDelay ?? 0) / 1000;
  if (audioBuffer && audioCtx) {
    const acElapsed = (audioCtx.currentTime - audioStartAcTime) * playbackRate;
    const audioChartSec = audioStartChartSec + acElapsed - videoOffsetSec;
    // Use stop-aware conversion so the visual chart freezes during stop events
    currentTick = computeVisualTickWithStops(audioChartSec);
  } else {
    // Note: chartSpeed (hispeed) is purely visual — it must NOT affect playback timing.
    // Real-time BPM-aware advancement; no chartSpeed divisor here.
    const elapsed = (now - playStartPerf) / 1000 * playbackRate;
    currentTick = playStartTickV;
    let remSec = elapsed, prevTick2 = playStartTickV;
    for (const ev of chart.bpmEvents) {
      if (ev.y <= prevTick2) continue;
      const segSec = (ev.y - prevTick2) / TICKS_PER_BEAT * (60 / chart.getBpmAt(prevTick2));
      if (remSec <= segSec) break;
      remSec -= segSec; currentTick = ev.y; prevTick2 = ev.y;
    }
    currentTick += remSec * TICKS_PER_BEAT * chart.getBpmAt(currentTick) / 60;
  }

  renderer.playTick = Math.max(0, currentTick);
  if (gameView) {
    gameView.playTick = renderer.playTick;
    gameView.chain = gameView.countChain(chart, renderer.playTick);
  }

  // Auto-scroll
  const colLen = renderer.measPerCol * TICKS_PER_MEASURE;
  const targetCol = Math.floor(renderer.playTick / colLen);
  if (targetCol >= renderer.scrollCol + renderer.numCols) renderer.scrollCol = targetCol - renderer.numCols + 1;
  else if (targetCol < renderer.scrollCol) renderer.scrollCol = targetCol;

  // Slam + FX chip + BT tick sounds
  detectSlams(prevPlayTick, renderer.playTick);
  detectFxHits(prevPlayTick, renderer.playTick);
  // In multi-chart mode, pan the active chart's ticks by slot position too
  const _activePan = (() => {
    if (!_multiMode || !_multiViews.length) return 0;
    const n = _multiViews.length;
    const si = _multiViews.findIndex(mv => mv.tabIdx === activeTabIdx);
    return si < 0 ? 0 : (n === 1 ? 0 : ((si / (n - 1)) * 2 - 1) * 0.8);
  })();
  detectBtHits(prevPlayTick, renderer.playTick, _activePan);
  detectMultiBtHits(prevPlayTick, renderer.playTick);
  prevPlayTick = renderer.playTick;

  // Laser filter + FX audio effects
  updateLaserFilter(renderer.playTick);
  updateFxEffects(renderer.playTick);
  _updateGlitchFromTick(renderer.playTick);

  // Live camera animation from KSH cameraEvents
  updateCameraFromEvents(renderer.playTick);

  const stopAt = playStopTick > 0 ? playStopTick : chart.totalTicks();
  if (renderer.playTick >= stopAt) { renderer.playTick = stopAt; stopPlay(); return; }

  updatePlayStatus();
  render();
  if (gameView && viewMode !== 'edit') {
    const minInterval = 1000 / (prefs.fpsCap || 60);
    if (!_lastGameFrameTime || now - _lastGameFrameTime >= minInterval) {
      gameView.draw();
      // Draw annotation markers on top of the game view
      _pruneAnnotations();
      gameView.drawAnnotations?.(_chartAnnotations, _annAlpha);
      _lastGameFrameTime = now;
    }
  }
  // Multi-chart preview — advance and redraw each slot. Throttle to the same FPS
  // cap as the single game view: each slot is a full WebGL+2D GameView, so drawing
  // every RAF frame on a 120Hz+ display multiplies the cost by the slot count and
  // is the main cause of multi-chart playback lag. Capping keeps it smooth.
  if (_multiMode && _multiViews.length) {
    const minInterval = 1000 / (prefs.fpsCap || 60);
    if (!_lastMultiFrameTime || now - _lastMultiFrameTime >= minInterval) {
      _multiSyncSettings();
      _multiDraw();
      _lastMultiFrameTime = now;
    }
  }
  // Update radar and heatmap every playback frame regardless of view mode
  if (typeof updateRadar === 'function') updateRadar();
  if (typeof updateHeatmap === 'function') updateHeatmap();
  _drawMinimap();
  requestAnimationFrame(playFrame);
}
let _lastGameFrameTime = 0;
let _lastMultiFrameTime = 0;

function detectSlams(prevTick, curTick) {
  for (let side = 0; side < 2; side++) {
    for (const sec of chart.lasers[side]) {
      const pts = sec.points;
      for (let pi = 0; pi < pts.length - 1; pi++) {
        const p0 = pts[pi], p1 = pts[pi + 1];
        const t0 = sec.y + p0.ry;
        const t1 = sec.y + p1.ry;
        if (ChartData.isPointSlam(p0, p1) && t0 >= prevTick && t0 < curTick) {
          // ── Audio: play slam scratch sound ──────────────────────────────
          if (slamBuffer && audioCtx) {
            const src = audioCtx.createBufferSource();
            src.buffer = slamBuffer;
            src.connect(slamGainNode || audioCtx.destination);
            src.start();
          }
          // ── Visual: brief burst on the game view judgment line ──────────
          gameView?.addSlamFlash(side, p0.v, p1.v, sec.wide);
        }
      }
    }
  }
}

function detectFxHits(prevTick, curTick) {
  if (!audioCtx) return;
  for (let li = 0; li < 2; li++) {
    for (const n of chart.fx[li]) {
      if (n.len === 0 && n.y >= prevTick && n.y < curTick) {
        // Chip hit: play SE sound
        const buf = fxChipSEBuffers[li] || clapBuffer;
        if (!buf) continue;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(tickGainNode || audioCtx.destination);
        src.start();
      }
      // FX hold: play tick once when hold starts
      else if (n.len > 0 && n.y >= prevTick && n.y < curTick) {
        // Play a tick when the hold is first pressed
        if (audioCtx && tickBuffer) {
          const src = audioCtx.createBufferSource();
          src.buffer = tickBuffer;
          const g = audioCtx.createGain();
          g.gain.value = 0.4;  // quieter than regular ticks
          src.connect(g);
          g.connect(tickGainNode || audioCtx.destination);
          src.start();
        }
      }
    }
  }
}

// ── Camera animation from KSH cameraEvents ───────────────────────────────────
// Interpolates zoom_top / zoom_bottom / zoom_side / tilt / center_split values
// between consecutive KSH camera events and pushes the result into
// gameView._liveCamera so _params() picks it up each draw frame.
//
// KSH camera value conventions:
//   zoom_top / zoom_bottom / zoom_side : integer, typical range −300…+300
//   center_split                        : integer, typical range −300…+300
//   tilt                                : numeric (degrees × 1/6 approx) or
//                                         string "normal" / "reverse" / "keep" / "zero"

function _parseCamValue(val) {
  const n = parseFloat(val);
  if (!isNaN(n)) return n;
  // string tilt keywords → numeric degrees
  switch ((val ?? '').toLowerCase()) {
    case 'zero':    return 0;
    case 'normal':  return 0;    // static no-tilt
    case 'reverse': return 0;    // direction handled by caller if needed
    default:        return 0;
  }
}

function updateCameraFromEvents(tick) {
  if (!gameView) return;
  if (!chart?.cameraEvents?.length) { gameView._liveCamera = null; return; }

  const evs = chart.cameraEvents;
  // Interpolate a single camera parameter type at the given tick.
  // Between two events: linear ramp. Beyond last event: hold last value.
  const interp = (type) => {
    let prev = null, next = null;
    for (const ev of evs) {
      if (ev.type !== type) continue;
      if (ev.y <= tick) prev = ev;
      else if (next === null || ev.y < next.y) next = ev;
    }
    if (!prev) return 0;
    const pv = _parseCamValue(prev.value);
    if (!next) return pv;
    const nv = _parseCamValue(next.value);
    const t  = Math.max(0, Math.min(1, (tick - prev.y) / (next.y - prev.y)));
    return pv + (nv - pv) * t;
  };

  // ── Tilt mode: handle string keywords from tilt camera events ─────────────
  // Walk tilt events in order; last one at or before tick determines mode/value
  let tiltDeg = 0;
  let tiltNumericRaw = 0; // used when mode ends up numeric/zero
  for (const ev of evs) {
    if (ev.type !== 'tilt') continue;
    if (ev.y > tick) continue;
    const raw = (ev.value ?? '').toString().trim().toLowerCase();
    const num = parseFloat(raw);
    if (!isNaN(num)) {
      // Numeric value — keep _tiltMode as-is but record numeric
      tiltNumericRaw = num;
    } else if (raw === 'normal')  { _tiltMode = 'normal'; }
    else if (raw === 'reverse')   { _tiltMode = 'reverse'; }
    else if (raw === 'keep')      { /* do not change _tiltMode */ }
    else if (raw === 'zero')      { _tiltMode = 'zero'; tiltNumericRaw = 0; }
  }

  // Compute final tilt angle
  // Convention (matching SDVX arcade):
  //   VOL-R → LEFT (rv=0) means the lane rotates CLOCKWISE  (positive ctx.rotate)
  //   VOL-R → RIGHT (rv=1) means the lane rotates COUNTER-CLOCKWISE (negative)
  // i.e. laserTilt = −(laser position − 0.5) × scale
  if (_tiltMode === 'normal' || _tiltMode === 'reverse') {
    const lv = getLaserPosAt(0, tick); // null if no laser
    const rv = getLaserPosAt(1, tick);
    let laserTilt = 0;
    if (lv !== null && rv !== null) {
      laserTilt = -((lv - 0.5) * 5 + (rv - 0.5) * 5) / 2;
    } else if (lv !== null) {
      laserTilt = -(lv - 0.5) * 5;
    } else if (rv !== null) {
      laserTilt = -(rv - 0.5) * 5;
    }
    tiltDeg = _tiltMode === 'reverse' ? -laserTilt : laserTilt;
  } else {
    // 'zero' or numeric — use interpolated numeric tilt × 2 (subtle rotation)
    tiltDeg = interp('tilt') * 2;
  }

  gameView._liveCamera = {
    zoomTop    : interp('zoom_top'),
    zoomBot    : interp('zoom_bottom'),
    zoomSide   : interp('zoom_side'),
    tilt       : tiltDeg,
    split      : interp('center_split'),
    laneToggle : interp('lane_toggle'),
  };
}

function updateLaserFilter(tick) {
  if (!laserFilterNode || !audioCtx) return;
  const lv = getLaserPosAt(0, tick);
  const rv = getLaserPosAt(1, tick);
  const li = lv !== null ? (1 - lv) : 0;
  const ri = rv !== null ? (1 - rv) : 0;
  const intensity = Math.max(li, ri);
  const filterType = chart.laserSettings.filter;
  if (filterType === 'lpf1') {
    laserFilterNode.type = 'lowpass';
    laserFilterNode.frequency.setTargetAtTime(20000 - intensity * 18000, audioCtx.currentTime, 0.02);
  } else if (filterType === 'hpf1') {
    laserFilterNode.type = 'highpass';
    laserFilterNode.frequency.setTargetAtTime(50 + intensity * 4000, audioCtx.currentTime, 0.02);
  } else if (filterType === 'peak') {
    laserFilterNode.type = 'peaking';
    laserFilterNode.frequency.setTargetAtTime(500 + intensity * 4000, audioCtx.currentTime, 0.02);
    laserFilterNode.gain.setTargetAtTime(intensity * 20, audioCtx.currentTime, 0.02);
  } else {
    laserFilterNode.frequency.setTargetAtTime(20000, audioCtx.currentTime, 0.02);
  }
}

// ── FX Effect Audio Processing ────────────────────────────────────────────────
// Called every playFrame; applies the currently active FX chain effect to the
// music via Web Audio API wet/dry routing built in ensureAudioCtx().
function updateFxEffects(tick) {
  if (!audioCtx || !_fxWetGain || !chart) return;

  // Find the highest-priority active FX hold; use its per-note effect if set
  let activeEffect = null;
  for (let li = 0; li < 2; li++) {
    const hold = chart.fx[li].find(n => n.len > 0 && n.y <= tick && tick <= n.y + n.len);
    if (hold) {
      const effType = hold.effect || null;
      if (effType && EFFECT_DEFS[effType]) {
        const def = EFFECT_DEFS[effType];
        const mergedParams = {};
        for (const [k, p] of Object.entries(def.params))
          mergedParams[k] = hold.effectParams?.[k] ?? p.def;
        activeEffect = { inst: { type: effType, params: mergedParams }, hold };
      }
      break;
    }
  }

  const bpm     = chart.getBpmAt(Math.floor(tick)) || 120;
  const nowAC   = audioCtx.currentTime;
  const type    = activeEffect?.inst?.type ?? null;
  const mix     = activeEffect ? (activeEffect.inst.params.mix ?? 80) / 100 : 0;
  const params  = activeEffect?.inst?.params ?? {};

  // ── Wobble: LFO-modulated lowpass filter ──────────────────────────────────
  if (type === 'wobble') {
    if (_fxEffectType !== 'wobble') { _teardownFxEffect(); _fxEffectType = 'wobble'; }
    if (!_fxWobbleFilter) {
      _fxWobbleFilter = audioCtx.createBiquadFilter();
      _fxWobbleFilter.type = 'lowpass';
      _fxWobbleFilter.Q.value = Math.max(0.5, params.q ?? 1);

      _fxWobbleLFOGain = audioCtx.createGain();
      const loF = params.loFreq ?? 500, hiF = params.hiFreq ?? 20000;
      _fxWobbleFilter.frequency.value = (loF + hiF) / 2;
      _fxWobbleLFOGain.gain.value     = (hiF - loF) / 2;

      _fxWobbleLFO = audioCtx.createOscillator();
      _fxWobbleLFO.type = 'sine';
      const hz = bpm / 60 / (params.waveLength ?? 12) * 4;
      _fxWobbleLFO.frequency.value = Math.max(0.05, hz);
      _fxWobbleLFO.connect(_fxWobbleLFOGain);
      _fxWobbleLFOGain.connect(_fxWobbleFilter.frequency);
      _fxWobbleLFO.start();

      _fxWetIn.connect(_fxWobbleFilter);
      _fxWobbleFilter.connect(_fxWetGain);
    }
  }

  // ── Gate: periodic amplitude gating ──────────────────────────────────────
  else if (type === 'gate') {
    if (_fxEffectType !== 'gate') { _teardownFxEffect(); _fxEffectType = 'gate'; }
    if (!_fxGateGain) {
      _fxGateGain = audioCtx.createGain();
      _fxGateGain.gain.value = 0;
      _fxWetIn.connect(_fxGateGain);
      _fxGateGain.connect(_fxWetGain);
      // Schedule gate envelope
      const period  = (60 / bpm) * 4 / (params.waveLength ?? 8);
      const rate    = (params.rate ?? 60) / 100;
      const now     = nowAC;
      const cycles  = 32; // schedule 32 cycles ahead
      for (let i = 0; i < cycles; i++) {
        const t0 = now + i * period;
        _fxGateGain.gain.setValueAtTime(1,   t0);
        _fxGateGain.gain.setValueAtTime(0,   t0 + period * rate);
      }
      _fxGateTimer = setInterval(() => {
        if (!_fxGateGain) { clearInterval(_fxGateTimer); return; }
        const t = audioCtx.currentTime;
        for (let i = 0; i < 8; i++) {
          const t0 = t + i * period;
          _fxGateGain.gain.setValueAtTime(1, t0);
          _fxGateGain.gain.setValueAtTime(0, t0 + period * rate);
        }
      }, period * 4 * 1000);
    }
  }

  // ── Echo: delay with feedback ─────────────────────────────────────────────
  else if (type === 'echo') {
    if (_fxEffectType !== 'echo') { _teardownFxEffect(); _fxEffectType = 'echo'; }
    if (!_fxEchoDelay) {
      const delayTime = (60 / bpm) * 4 / (params.waveLength ?? 4);
      _fxEchoDelay = audioCtx.createDelay(Math.min(2, delayTime * 2 + 0.1));
      _fxEchoDelay.delayTime.value = delayTime;
      _fxEchoFB  = audioCtx.createGain();
      _fxEchoFB.gain.value = Math.min(0.85, (params.feedback ?? 60) / 100);
      _fxEchoWet = audioCtx.createGain();
      _fxEchoWet.gain.value = 0.8;
      _fxWetIn.connect(_fxEchoDelay);
      _fxEchoDelay.connect(_fxEchoFB);
      _fxEchoFB.connect(_fxEchoDelay);   // feedback loop
      _fxEchoDelay.connect(_fxEchoWet);
      _fxEchoWet.connect(_fxWetGain);
    }
  }

  // ── SideChain: pumping gain ───────────────────────────────────────────────
  else if (type === 'sidechain') {
    if (_fxEffectType !== 'sidechain') { _teardownFxEffect(); _fxEffectType = 'sidechain'; }
    if (!_fxScGain) {
      _fxScGain = audioCtx.createGain();
      _fxScGain.gain.value = 0;
      _fxWetIn.connect(_fxScGain);
      _fxScGain.connect(_fxWetGain);
      const period   = (60 / bpm) * 4 / (params.period ?? 8);
      const holdSec  = (params.holdTime ?? 50)    / 1000;
      const atkSec   = (params.attackTime ?? 10)  / 1000;
      const relSec   = (params.releaseTime ?? 60) / 1000;
      const now      = nowAC;
      for (let i = 0; i < 16; i++) {
        const t0 = now + i * period;
        _fxScGain.gain.setValueAtTime(0,    t0);
        _fxScGain.gain.setValueAtTime(0,    t0 + holdSec);
        _fxScGain.gain.linearRampToValueAtTime(1, t0 + holdSec + atkSec);
        _fxScGain.gain.setValueAtTime(1,    t0 + holdSec + atkSec);
        _fxScGain.gain.linearRampToValueAtTime(0, t0 + holdSec + atkSec + relSec);
      }
      _fxScTimer = setInterval(() => {
        if (!_fxScGain) { clearInterval(_fxScTimer); return; }
        const t = audioCtx.currentTime;
        for (let i = 0; i < 8; i++) {
          const t0 = t + i * period;
          _fxScGain.gain.setValueAtTime(0,    t0);
          _fxScGain.gain.setValueAtTime(0,    t0 + holdSec);
          _fxScGain.gain.linearRampToValueAtTime(1, t0 + holdSec + atkSec);
          _fxScGain.gain.linearRampToValueAtTime(0, t0 + holdSec + atkSec + relSec);
        }
      }, period * 4 * 1000);
    }
  }

  // ── Retrigger: loop a buffer segment ─────────────────────────────────────
  else if (type === 'retrigger') {
    if (_fxEffectType !== 'retrigger') { _teardownFxEffect(); _fxEffectType = 'retrigger'; }
    if (!_fxRetriggerProc) {
      const loopSec = (60 / bpm) / (params.waveLength ?? 8) * 4;
      const loopSamples = Math.max(1, Math.round(loopSec * audioCtx.sampleRate));
      const buf = [new Float32Array(loopSamples), new Float32Array(loopSamples)];
      let writePos = 0, readPos = 0, recording = true;
      _fxRetriggerProc = audioCtx.createScriptProcessor(2048, 2, 2);
      _fxRetriggerProc.onaudioprocess = e => {
        const iL = e.inputBuffer.getChannelData(0), iR = e.inputBuffer.getChannelData(1);
        const oL = e.outputBuffer.getChannelData(0), oR = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < iL.length; i++) {
          if (recording) {
            buf[0][writePos] = iL[i]; buf[1][writePos] = iR[i];
            oL[i] = iL[i]; oR[i] = iR[i];
            writePos++;
            if (writePos >= loopSamples) { recording = false; readPos = 0; }
          } else {
            oL[i] = buf[0][readPos]; oR[i] = buf[1][readPos];
            readPos = (readPos + 1) % loopSamples;
          }
        }
      };
      _fxWetIn.connect(_fxRetriggerProc);
      _fxRetriggerProc.connect(_fxWetGain);
    }
  }

  // ── Flanger: LFO-modulated short delay with feedback ─────────────────────
  else if (type === 'flanger') {
    if (_fxEffectType !== 'flanger') { _teardownFxEffect(); _fxEffectType = 'flanger'; }
    if (!_fxFlangerDelay) {
      const baseMs  = Math.max(0.5, params.delay    ?? 30) / 1000;
      const depth   = Math.max(0.1, params.depth    ?? 60) / 100 * baseMs;
      const fb      = Math.min(0.8, (params.feedback ?? 60) / 100);
      const lfoHz   = bpm / 60 / Math.max(1, params.period ?? 2);

      _fxFlangerDelay = audioCtx.createDelay(0.05);
      _fxFlangerDelay.delayTime.value = baseMs;

      _fxFlangerFB = audioCtx.createGain();
      _fxFlangerFB.gain.value = fb;

      _fxFlangerLFOGain = audioCtx.createGain();
      _fxFlangerLFOGain.gain.value = depth;

      _fxFlangerLFO = audioCtx.createOscillator();
      _fxFlangerLFO.type = 'sine';
      _fxFlangerLFO.frequency.value = Math.max(0.05, lfoHz);
      _fxFlangerLFO.connect(_fxFlangerLFOGain);
      _fxFlangerLFOGain.connect(_fxFlangerDelay.delayTime);
      _fxFlangerLFO.start();

      _fxWetIn.connect(_fxFlangerDelay);
      _fxFlangerDelay.connect(_fxFlangerFB);
      _fxFlangerFB.connect(_fxFlangerDelay);  // feedback loop
      _fxFlangerDelay.connect(_fxWetGain);
    }
  }

  // ── Phaser: allpass filter chain with LFO ────────────────────────────────
  else if (type === 'phaser') {
    if (_fxEffectType !== 'phaser') { _teardownFxEffect(); _fxEffectType = 'phaser'; }
    if (!_fxPhaserFilters) {
      const stages  = Math.min(12, Math.max(2, Math.round(params.stages ?? 6)));
      const lfoHz   = bpm / 60 / Math.max(1, params.period ?? 4);

      _fxPhaserFilters = [];
      let prev = _fxWetIn;
      for (let i = 0; i < stages; i++) {
        const f = audioCtx.createBiquadFilter();
        f.type = 'allpass'; f.frequency.value = 1000 + i * 200; f.Q.value = 0.5;
        prev.connect(f); _fxPhaserFilters.push(f); prev = f;
      }
      prev.connect(_fxWetGain);

      _fxPhaserLFOGain = audioCtx.createGain();
      _fxPhaserLFOGain.gain.value = 900;
      _fxPhaserLFO = audioCtx.createOscillator();
      _fxPhaserLFO.type = 'sine';
      _fxPhaserLFO.frequency.value = Math.max(0.05, lfoHz);
      _fxPhaserLFO.connect(_fxPhaserLFOGain);
      _fxPhaserFilters.forEach(f => _fxPhaserLFOGain.connect(f.frequency));
      _fxPhaserLFO.start();
    }
  }

  // ── BitCrusher: sample-rate reduction via ScriptProcessor ────────────────
  else if (type === 'bitcrusher') {
    if (_fxEffectType !== 'bitcrusher') { _teardownFxEffect(); _fxEffectType = 'bitcrusher'; }
    if (!_fxBitcrusherProc) {
      const reduction = Math.max(2, Math.round((params.reduction ?? 60) / 100 * 64));
      let phase = 0, lastL = 0, lastR = 0;
      _fxBitcrusherProc = audioCtx.createScriptProcessor(2048, 2, 2);
      _fxBitcrusherProc.onaudioprocess = e => {
        const iL = e.inputBuffer.getChannelData(0), iR = e.inputBuffer.getChannelData(1);
        const oL = e.outputBuffer.getChannelData(0), oR = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < iL.length; i++) {
          if (++phase >= reduction) { phase = 0; lastL = iL[i]; lastR = iR[i]; }
          oL[i] = lastL; oR[i] = lastR;
        }
      };
      _fxWetIn.connect(_fxBitcrusherProc);
      _fxBitcrusherProc.connect(_fxWetGain);
    }
  }

  // ── TapeStop: exponential playback rate ramp ──────────────────────────────
  else if (type === 'tapestop') {
    if (_fxEffectType !== 'tapestop') {
      _teardownFxEffect(); _fxEffectType = 'tapestop'; _fxTapeStopActive = true;
      const dur = 1.5 * (1 - Math.min(0.99, (params.speed ?? 50) / 100)) + 0.05;
      if (audioSource) {
        audioSource.playbackRate.cancelScheduledValues(nowAC);
        audioSource.playbackRate.setValueAtTime(1.0, nowAC);
        audioSource.playbackRate.exponentialRampToValueAtTime(0.01, nowAC + dur);
      }
    }
    // Tapestop routes dry (rate change IS the effect); wet stays 0
  }

  // ── No active effect — bypass ─────────────────────────────────────────────
  else {
    if (_fxEffectType === 'tapestop' || _fxTapeStopActive) {
      if (audioSource) {
        audioSource.playbackRate.cancelScheduledValues(nowAC);
        audioSource.playbackRate.setTargetAtTime(1.0, nowAC, 0.05);
      }
      _fxTapeStopActive = false;
    }
    if (_fxEffectType) _teardownFxEffect();
  }

  // Wet/dry mix — tapestop is purely a rate effect, no wet routing needed
  const wetNow = (type && type !== 'tapestop') ? mix : 0;
  const dryNow = type === 'tapestop' ? 1.0 : (1 - wetNow);
  _fxWetGain.gain.setTargetAtTime(wetNow, nowAC, 0.02);
  _fxDryGain.gain.setTargetAtTime(dryNow, nowAC, 0.02);
}

function _teardownFxEffect() {
  _fxEffectType = null;
  // Clear gate/sidechain timers
  if (_fxGateTimer) { clearInterval(_fxGateTimer); _fxGateTimer = null; }
  if (_fxScTimer)   { clearInterval(_fxScTimer);   _fxScTimer   = null; }
  // Stop and disconnect all LFOs / oscillators
  try { _fxWobbleLFO?.stop(); } catch(_) {}
  try { _fxFlangerLFO?.stop(); } catch(_) {}
  try { _fxPhaserLFO?.stop(); } catch(_) {}
  // Disconnect original effect nodes
  [_fxWobbleLFO, _fxWobbleLFOGain, _fxWobbleFilter,
   _fxGateGain, _fxEchoDelay, _fxEchoFB, _fxEchoWet, _fxScGain]
    .forEach(n => { try { n?.disconnect(); } catch(_) {} });
  _fxWobbleFilter = _fxWobbleLFO = _fxWobbleLFOGain = null;
  _fxGateGain = _fxEchoDelay = _fxEchoFB = _fxEchoWet = _fxScGain = null;
  // Disconnect new effect nodes
  [_fxFlangerDelay, _fxFlangerLFO, _fxFlangerLFOGain, _fxFlangerFB,
   _fxPhaserLFO, _fxPhaserLFOGain]
    .forEach(n => { try { n?.disconnect(); } catch(_) {} });
  if (_fxPhaserFilters) { _fxPhaserFilters.forEach(n => { try { n?.disconnect(); } catch(_) {} }); _fxPhaserFilters = null; }
  if (_fxBitcrusherProc) { try { _fxBitcrusherProc.disconnect(); } catch(_) {} _fxBitcrusherProc = null; }
  if (_fxRetriggerProc)  { try { _fxRetriggerProc.disconnect();  } catch(_) {} _fxRetriggerProc = null; }
  _fxFlangerDelay = _fxFlangerLFO = _fxFlangerLFOGain = _fxFlangerFB = null;
  _fxPhaserLFO = _fxPhaserLFOGain = null;
  _fxTapeStopActive = false;
}

export function getLaserPosAt(side, tick) {
  for (const sec of chart.lasers[side]) {
    if (tick < sec.y) continue;
    const pts = sec.points;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      const t0 = sec.y + pts[pi].ry, t1 = sec.y + pts[pi+1].ry;
      if (tick >= t0 && tick <= t1) {
        const ratio = t1 === t0 ? 0 : (tick - t0) / (t1 - t0);
        return pts[pi].v + (pts[pi+1].v - pts[pi].v) * ratio;
      }
    }
    const last = pts[pts.length - 1];
    if (last && sec.y + last.ry >= tick) return last.v;
  }
  return null;
}
window.getLaserPosAt = getLaserPosAt;
window._drag = drag; // expose for renderer freehand preview (freehandStartTick)

function updatePlayBtn(isPlaying) {
  // Use localized strings, falling back to English defaults
  const label = isPlaying
    ? (typeof t === 'function' ? t('tool.stop') : '⏹ Stop')
    : (typeof t === 'function' ? t('tool.play') : '▶ Play');
  ['btn-play', 'btn-play-top'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = label;
    btn.classList.toggle('playing', isPlaying);
    // Set the data-i18n key dynamically so applyLocalization picks up state changes
    btn.setAttribute('data-i18n', isPlaying ? 'tool.stop' : 'tool.play');
  });
}

function updatePlayStatus() {
  const tick    = Math.round(renderer.playTick);
  const measure = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const beat    = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
  document.getElementById('status-tick').textContent    = `Tick: ${tick}`;
  document.getElementById('status-measure').textContent = `Measure: ${measure}`;
  document.getElementById('status-beat').textContent    = `Beat: ${beat}`;
  updateSeekbar(tick);
}

// ── Seekbar / scrub ───────────────────────────────────────────────────────────
let _seekScrubbing = false;
let _seekWasPlaying = false;

function _fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function updateSeekbar(tick) {
  const fill  = document.getElementById('game-seekbar-fill');
  const thumb = document.getElementById('game-seekbar-thumb');
  const label = document.getElementById('game-seekbar-time');
  if (!fill || !thumb || !label) return;

  const total = chart ? chart.totalTicks() : 0;
  const pct   = total > 0 ? Math.min(1, Math.max(0, tick / total)) : 0;
  fill.style.width  = `${pct * 100}%`;
  thumb.style.left  = `${pct * 100}%`;

  const curSec   = tickToSeconds(tick);
  const totSec   = tickToSeconds(total);
  label.textContent = `${_fmtTime(curSec)} / ${_fmtTime(totSec)}`;
}

function _seekbarTickFromEvent(e) {
  const track = document.getElementById('game-seekbar-track');
  if (!track) return null;
  const rect = track.getBoundingClientRect();
  const pct  = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  return Math.round(pct * (chart ? chart.totalTicks() : 0));
}

export function _seekTo(tick) {
  if (!chart) return;
  renderer.playTick = Math.max(0, Math.min(tick, chart.totalTicks()));
  if (gameView) gameView.playTick = renderer.playTick;
  // Scroll the 2D editor to follow
  const colLen = renderer.measPerCol * TICKS_PER_MEASURE;
  renderer.scrollCol = Math.floor(renderer.playTick / colLen);
  updatePlayStatus();
  render();
  if (gameView && viewMode !== 'edit') gameView.draw();
}

function initSeekbar() {
  const track = document.getElementById('game-seekbar-track');
  if (!track) return;

  track.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _seekScrubbing = true;
    _seekWasPlaying = playing;
    track.classList.add('scrubbing');
    if (playing) {
      // Pause audio without changing playTick
      playing = false;
      renderer.playing = false;
      if (audioSource) { try { audioSource.stop(); } catch(_) {} audioSource = null; }
      updatePlayBtn(false);
    }
    const tick = _seekbarTickFromEvent(e);
    if (tick !== null) _seekTo(tick);
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!_seekScrubbing) return;
    const tick = _seekbarTickFromEvent(e);
    if (tick !== null) _seekTo(tick);
  });

  document.addEventListener('mouseup', e => {
    if (!_seekScrubbing) return;
    _seekScrubbing = false;
    document.getElementById('game-seekbar-track')?.classList.remove('scrubbing');
    if (_seekWasPlaying) {
      // Resume playback from the new position
      startPlay(playStopTick);
    }
    _seekWasPlaying = false;
  });

  // Double-click → open selection range editor popup
  track.addEventListener('dblclick', e => {
    e.preventDefault();
    openSeekbarSelectionPopup(e.clientX, e.clientY);
  });

  // Initial render
  updateSeekbar(renderer ? renderer.playTick : 0);
}

// ── Seekbar double-click: selection range editor ───────────────────────────────
function openSeekbarSelectionPopup(clientX, clientY) {
  // Remove any existing popup
  document.getElementById('sel-range-popup')?.remove();
  document.getElementById('sel-range-overlay')?.remove();

  const totalTicks = chart ? chart.totalTicks() : 0;

  // Helper: tick → "M{measure} B{beat} T{subbeat}" display string
  function tickToLabel(tick) {
    const t  = Math.max(0, Math.round(tick));
    const m  = Math.floor(t / TICKS_PER_MEASURE) + 1;
    const b  = Math.floor((t % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const sub = t % TICKS_PER_BEAT;
    return sub > 0 ? `M${m} B${b}+${sub}` : `M${m} B${b}`;
  }

  // Helper: parse "M{m} B{b}" or plain tick integer string → tick
  function parseTickInput(str) {
    str = str.trim();
    // "M3 B2" or "M3B2" or "3 2" shorthand
    const mb = str.match(/[Mm](\d+)\s*[Bb](\d+)(?:\+(\d+))?/);
    if (mb) {
      const m   = Math.max(1, parseInt(mb[1], 10)) - 1;
      const b   = Math.max(1, parseInt(mb[2], 10)) - 1;
      const sub = mb[3] ? parseInt(mb[3], 10) : 0;
      return m * TICKS_PER_MEASURE + b * TICKS_PER_BEAT + sub;
    }
    // plain tick number
    const n = parseInt(str, 10);
    return isNaN(n) ? null : n;
  }

  // Current selection range (fall back to full chart if no active selection)
  const lo = sel.active ? Math.min(sel.startTick, sel.endTick) : 0;
  const hi = sel.active ? Math.max(sel.startTick, sel.endTick) : totalTicks;

  // ── Overlay ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'sel-range-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99997';

  // ── Popup ─────────────────────────────────────────────────────────────────
  const pop = document.createElement('div');
  pop.id = 'sel-range-popup';
  pop.style.cssText =
    'position:fixed;z-index:99998;background:#0c0c20;border:1.5px solid #3344aa;' +
    'border-radius:8px;padding:14px 16px;box-shadow:0 6px 24px #000c;' +
    'display:flex;flex-direction:column;gap:10px;min-width:230px;' +
    'font-family:inherit;color:#e0e8ff;font-size:12px';

  const inputStyle =
    'background:#161630;border:1px solid #3344aa;border-radius:4px;' +
    'color:#e0e8ff;font-size:12px;padding:4px 8px;outline:none;width:100%;box-sizing:border-box;' +
    'font-family:monospace';

  pop.innerHTML = `
    <div style="font-weight:bold;color:#7799ff;letter-spacing:0.06em;display:flex;justify-content:space-between;align-items:center">
      <span>&#9646;&#9646; Selection Range</span>
      <span id="srp-close" style="cursor:pointer;color:#445588;font-size:15px;padding:0 2px" title="Close">&#215;</span>
    </div>
    <div style="color:#445588;font-size:10px;line-height:1.5">
      Enter measure/beat as <span style="color:#8899cc">M# B#</span> or a raw tick number.<br>
      Leave blank to keep current value.
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <label style="color:#8899cc;font-size:11px">Start</label>
      <input id="srp-start" type="text" placeholder="${tickToLabel(lo)}" value="${tickToLabel(lo)}" style="${inputStyle}">
      <div style="color:#445588;font-size:10px;margin-top:-2px">Tick: <span id="srp-start-tick" style="color:#6677aa">${lo}</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <label style="color:#8899cc;font-size:11px">End</label>
      <input id="srp-end" type="text" placeholder="${tickToLabel(hi)}" value="${tickToLabel(hi)}" style="${inputStyle}">
      <div style="color:#445588;font-size:10px;margin-top:-2px">Tick: <span id="srp-end-tick" style="color:#6677aa">${hi}</span></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:2px">
      <button id="srp-ok"     style="flex:1;background:#2233aa;color:#e0e8ff;border:1px solid #3344cc;border-radius:4px;padding:6px;cursor:pointer;font-size:11px">Apply</button>
      <button id="srp-clear"  style="flex:1;background:#1a1a30;color:#6677aa;border:1px solid #2a2a55;border-radius:4px;padding:6px;cursor:pointer;font-size:11px">Clear Sel.</button>
      <button id="srp-cancel" style="flex:1;background:#0c0c20;color:#556;border:1px solid #1e1e3a;border-radius:4px;padding:6px;cursor:pointer;font-size:11px">Cancel</button>
    </div>`;

  // Position: anchor below the seekbar (or near cursor, keep on-screen)
  const vw = window.innerWidth, vh = window.innerHeight;
  let px = Math.min(clientX - 115, vw - 250);
  let py = clientY + 16;
  if (py + 280 > vh) py = clientY - 290;
  pop.style.left = Math.max(8, px) + 'px';
  pop.style.top  = py + 'px';

  document.body.appendChild(overlay);
  document.body.appendChild(pop);

  const close = () => { overlay.remove(); pop.remove(); };

  // Live preview: update "Tick:" readout as user types
  const livePreview = (inputId, tickSpanId) => {
    const input = pop.querySelector('#' + inputId);
    const span  = pop.querySelector('#' + tickSpanId);
    input.addEventListener('input', () => {
      const t = parseTickInput(input.value);
      span.textContent = t !== null ? Math.max(0, Math.min(totalTicks, t)) : '—';
      span.style.color = t !== null ? '#88aaff' : '#aa4444';
    });
  };
  livePreview('srp-start', 'srp-start-tick');
  livePreview('srp-end',   'srp-end-tick');

  // Apply button
  pop.querySelector('#srp-ok').addEventListener('click', () => {
    const rawStart = parseTickInput(pop.querySelector('#srp-start').value);
    const rawEnd   = parseTickInput(pop.querySelector('#srp-end').value);
    const newLo = rawStart !== null ? Math.max(0, Math.min(totalTicks, rawStart)) : lo;
    const newHi = rawEnd   !== null ? Math.max(0, Math.min(totalTicks, rawEnd))   : hi;
    if (newLo !== newHi) {
      sel.active    = true;
      sel.startTick = Math.min(newLo, newHi);
      sel.endTick   = Math.max(newLo, newHi);
      render();
    }
    close();
  });

  // Clear selection
  pop.querySelector('#srp-clear').addEventListener('click', () => {
    sel.active = false;
    render();
    close();
  });

  pop.querySelector('#srp-cancel').addEventListener('click', close);
  pop.querySelector('#srp-close').addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Keyboard: Enter = apply, Escape = cancel
  pop.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); pop.querySelector('#srp-ok').click(); }
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });

  // Focus start input
  setTimeout(() => {
    const si = pop.querySelector('#srp-start');
    si?.focus(); si?.select();
  }, 10);
}

// ── View mode ─────────────────────────────────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode;
  const editWrap = document.getElementById('main');
  const gameWrap = document.getElementById('game-wrap');
  if (mode === 'edit') {
    editWrap.style.display = 'flex'; gameWrap.style.display = 'none';
    // Force layout recalculation so renderer gets correct dimensions
    requestAnimationFrame(() => { renderer?.resize(); render(); });
  } else if (mode === 'game') {
    editWrap.style.display = 'none'; gameWrap.style.display = 'flex';
  } else { // split
    editWrap.style.display = 'flex'; gameWrap.style.display = 'flex';
    editWrap.style.flex = '1'; gameWrap.style.flex = '1';
    requestAnimationFrame(() => { renderer?.resize(); render(); });
  }
  // Respect multi-mode canvas visibility
  if (mode !== 'edit') {
    const singleCanvas = document.getElementById('game-canvas');
    const singleWrap   = document.getElementById('game-canvas-wrap');
    const multiArea    = document.getElementById('multi-preview-area');
    if (singleWrap)   singleWrap.style.display   = _multiMode ? 'none' : '';
    if (singleCanvas) singleCanvas.style.display = _multiMode ? 'none' : '';
    if (multiArea)    multiArea.style.display     = _multiMode ? 'flex' : 'none';
    if (_multiMode) {
      requestAnimationFrame(() => {
        for (const mv of _multiViews) { mv.gv?.resize(); mv.gv?.draw(); }
      });
    }
  }
  if (gameView) { gameView.resize(); gameView.draw(); }
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
}

let _isGameViewFullscreen = false;

function toggleGameViewFullscreen() {
  const gameWrap = document.getElementById('game-wrap');
  if (!gameWrap) return;

  if (!_isGameViewFullscreen) {
    // Enter fullscreen
    _isGameViewFullscreen = true;
    gameWrap.style.position = 'fixed';
    gameWrap.style.top = '0';
    gameWrap.style.left = '0';
    gameWrap.style.width = '100%';
    gameWrap.style.height = '100%';
    gameWrap.style.zIndex = '10000';
    gameWrap.style.display = 'flex';
    // Hide other UI elements
    const _el = (id) => document.getElementById(id);
    if (_el('header'))  _el('header').style.display  = 'none';
    if (_el('main'))    _el('main').style.display    = 'none';
    if (_el('tab-bar')) _el('tab-bar').style.display = 'none';
    if (_el('toolbar')) _el('toolbar').style.display = 'none';
    // Update button state
    const btn = document.getElementById('btn-fullscreen');
    if (btn) btn.classList.add('fullscreen-active');
    if (gameView) { gameView.resize(); gameView.draw(); }
  } else {
    // Exit fullscreen
    _isGameViewFullscreen = false;
    gameWrap.style.position = '';
    gameWrap.style.top = '';
    gameWrap.style.left = '';
    gameWrap.style.width = '';
    gameWrap.style.height = '';
    gameWrap.style.zIndex = '';
    // Restore all hidden UI elements
    const _el = (id) => document.getElementById(id);
    if (_el('header'))  _el('header').style.display  = '';
    if (_el('tab-bar')) _el('tab-bar').style.display = '';
    if (_el('toolbar')) _el('toolbar').style.display = '';
    // Restore view mode (handles main/game-wrap visibility)
    setViewMode(viewMode);
    // Update button state
    const btn = document.getElementById('btn-fullscreen');
    if (btn) btn.classList.remove('fullscreen-active');
  }
}

// ── Multi-chart preview ───────────────────────────────────────────────────────
// State
let _multiMode   = false;
let _multiViews  = [];      // [{ wrap, canvas, gv, tabIdx, mirrored, tickOffset, hsScale }]
let _multiLayout = 'row';   // 'row' | 'col'
let _multiGap    = 4;
let _multiSync   = true;
const _multiTabMask = new Set(); // which tab indices to show

// Build / re-build all slot canvases from scratch
function _wireMultiEditCanvas(mv) {
  const canvas = mv.canvas;
  mv._drag = { active: false, tool: '', startTick: 0, laneIdx: 0, fxIdx: 0, laserSide: 0 };

  const afterEdit = () => {
    if (!playing) mv.gv.draw();
    if (mv.tabIdx === activeTabIdx) render();
  };

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousedown', ev => {
    if (!_gameEditMode) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault();
    const p = mv.gv._params();
    if (!p) return;
    const rect   = canvas.getBoundingClientRect();
    const scaleX  = canvas.width  / rect.width;
    const scaleY  = canvas.height / rect.height;
    const hit  = _gameScreenToChart((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY, p, mv.gv);
    if (!hit) return;
    const { tick, norm } = hit;
    const li = Math.min(3, Math.max(0, Math.floor(norm * 4)));
    const fi = norm < 0.5 ? 0 : 1;
    const m  = Math.floor(tick / TICKS_PER_MEASURE) + 1;
    const targetChart = tabs[mv.tabIdx]?.chart;
    if (!targetChart) return;

    if (ev.button === 2 || tool === 'erase') {
      saveUndo(`Erased at M${m} (Multi-Preview)`);
      eraseAt(li, tick, null, targetChart);
      afterEdit();
      return;
    }
    if (tool === 'laser-l' || tool === 'laser-r') {
      const side = tool === 'laser-l' ? 0 : 1;
      const v    = snapLaserV(Math.max(0, Math.min(1, norm)));
      saveUndo(`VOL-${side === 0 ? 'L' : 'R'} at M${m} (Multi-Preview)`);
      targetChart.addLaserPoint(side, tick, v, 'auto', false);
      mv._drag.active = true; mv._drag.tool = tool; mv._drag.laserSide = side;
      afterEdit();
      return;
    }
    mv._drag.active    = true;
    mv._drag.tool      = tool;
    mv._drag.startTick = tick;
    mv._drag.laneIdx   = li;
    mv._drag.fxIdx     = fi;
    saveUndo(`${tool.toUpperCase()} at M${m} (Multi-Preview)`);
    if (tool === 'bt') targetChart.addBtNote(li, tick, 0);
    else               targetChart.addFxNote(fi, tick, 0);
    afterEdit();
  });

  canvas.addEventListener('mousemove', ev => {
    if (!_gameEditMode) return;
    const p = mv.gv._params();
    if (!p) return;
    const rect   = canvas.getBoundingClientRect();
    const scaleX  = canvas.width  / rect.width;
    const scaleY  = canvas.height / rect.height;
    const hit  = _gameScreenToChart((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY, p, mv.gv);
    if (!hit) { mv.gv._editGhost = null; return; }
    mv.gv._editGhost = { tick: hit.tick, norm: hit.norm, tool, sy: hit.canvasSy };
    if (mv._drag.active && (tool === 'laser-l' || tool === 'laser-r')) {
      const targetChart = tabs[mv.tabIdx]?.chart;
      if (targetChart) {
        const v = snapLaserV(Math.max(0, Math.min(1, hit.norm)));
        targetChart.addLaserPoint(mv._drag.laserSide, hit.tick, v, 'auto', false);
        afterEdit();
      }
    }
    if (!playing) mv.gv.draw();
  });

  canvas.addEventListener('mouseup', ev => {
    if (!mv._drag.active) return;
    const targetChart = tabs[mv.tabIdx]?.chart;
    const p = mv.gv._params();
    if (p && targetChart && (tool === 'bt' || tool === 'fx')) {
      const rect   = canvas.getBoundingClientRect();
      const scaleX  = canvas.width  / rect.width;
      const scaleY  = canvas.height / rect.height;
      const hit  = _gameScreenToChart((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY, p, mv.gv);
      if (hit) {
        const len = Math.max(0, hit.tick - mv._drag.startTick);
        if (len > 0) {
          if (tool === 'bt') {
            const lane = targetChart.bt[mv._drag.laneIdx];
            const n = lane.findLast?.(n => n.y === mv._drag.startTick) ?? lane.slice().reverse().find(n => n.y === mv._drag.startTick);
            if (n) n.len = len;
          } else {
            const lane = targetChart.fx[mv._drag.fxIdx];
            const n = lane.findLast?.(n => n.y === mv._drag.startTick) ?? lane.slice().reverse().find(n => n.y === mv._drag.startTick);
            if (n) n.len = len;
          }
          afterEdit();
        }
      }
    }
    mv._drag.active = false;
  });

  canvas.addEventListener('mouseleave', () => {
    mv._drag.active = false;
    mv.gv._editGhost = null;
    if (!playing) mv.gv.draw();
  });
}

function _multiRebuild() {
  const area = document.getElementById('multi-preview-area');
  if (!area) return;
  // Tear down old views
  for (const mv of _multiViews) { mv._ro?.disconnect(); mv.gv = null; }
  _multiViews = [];
  area.innerHTML = '';

  area.style.display   = _multiMode ? 'flex' : 'none';
  area.style.flexDirection = _multiLayout === 'row' ? 'row' : 'column';
  area.style.gap       = _multiGap + 'px';

  // Determine which tabs to show (mask, or all if none selected)
  let idxList = [..._multiTabMask].filter(i => i < tabs.length);
  if (!idxList.length) idxList = tabs.map((_, i) => i);

  const gvRef = gameView; // current single-chart view for settings inheritance

  for (const tabIdx of idxList) {
    const tab = tabs[tabIdx];

    // Slot wrapper
    const wrap = document.createElement('div');
    wrap.className = 'multi-chart-slot';

    // Header bar
    const header = document.createElement('div');
    header.className = 'multi-chart-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'mch-name';
    nameSpan.textContent = tab.name || `Chart ${tabIdx + 1}`;
    header.appendChild(nameSpan);

    // HiSpeed mini-slider
    const hsLabel = document.createElement('span');
    hsLabel.className = 'mch-hs-label';
    hsLabel.textContent = 'HS';
    header.appendChild(hsLabel);

    const hsSlider = document.createElement('input');
    hsSlider.type = 'range'; hsSlider.min = '0.2'; hsSlider.max = '10'; hsSlider.step = '0.1';
    hsSlider.value = gvRef ? gvRef.hispeed : 1;
    hsSlider.title = 'HiSpeed for this chart';
    header.appendChild(hsSlider);

    const hsVal = document.createElement('span');
    hsVal.className = 'mch-hs-label';
    hsVal.textContent = parseFloat(hsSlider.value).toFixed(1) + '×';
    header.appendChild(hsVal);

    // Mirror button
    const mirrorBtn = document.createElement('button');
    mirrorBtn.textContent = '⇄ Mirror';
    mirrorBtn.title = 'Mirror this chart horizontally';
    header.appendChild(mirrorBtn);

    // Offset control (tick offset relative to other charts)
    const offBtn = document.createElement('button');
    offBtn.textContent = '⏱ +0';
    offBtn.title = 'Tick offset — shifts this chart forward/backward in time relative to others';
    header.appendChild(offBtn);

    wrap.appendChild(header);

    // Canvas stack: WebGL lane runway behind, 2D overlay (notes/lasers/HUD) on
    // top. The lane is rendered exclusively in WebGL, so each slot needs its own
    // GL canvas just like the single preview.
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'multi-canvas-wrap';
    const glCanvas = document.createElement('canvas');
    glCanvas.className = 'multi-gl';
    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(glCanvas);
    canvasWrap.appendChild(canvas);
    wrap.appendChild(canvasWrap);
    area.appendChild(wrap);

    // GameView
    const gv = new GameView(canvas);
    gv.attachGL(glCanvas);
    gv.chart          = tab.chart;
    gv.hispeed        = gvRef ? gvRef.hispeed        : 1.0;
    gv.btWidthScale   = gvRef ? gvRef.btWidthScale   : 1.0;
    gv.projMode       = gvRef ? gvRef.projMode       : 'sdvx';
    gv.perspIntensity = gvRef ? gvRef.perspIntensity : 65;
    gv.judgeYFrac     = gvRef ? gvRef.judgeYFrac     : 0.73;
    gv.interpMode     = gvRef ? gvRef.interpMode     : 'standard';
    gv.playTick       = renderer.playTick;

    const mv = { wrap, canvasWrap, canvas, gv, tabIdx, mirrored: false, tickOffset: 0, hsSlider, hsVal };
    _multiViews.push(mv);

    // HiSpeed slider wiring
    hsSlider.addEventListener('input', () => {
      const v = +hsSlider.value;
      hsVal.textContent = v.toFixed(1) + '×';
      mv.gv.hispeed = v;
      if (!playing) mv.gv.draw();
    });

    // Mirror button wiring — flips the chart's laser/BT layout visually
    mirrorBtn.addEventListener('click', () => {
      mv.mirrored = !mv.mirrored;
      mirrorBtn.classList.toggle('active', mv.mirrored);
      _multiApplyMirror(mv);
      if (!playing) mv.gv.draw();
    });

    // Offset popup
    offBtn.addEventListener('click', () => {
      const raw = prompt('Tick offset for "' + (tab.name || `Chart ${tabIdx+1}`) + '" (negative = earlier):', mv.tickOffset);
      if (raw === null) return;
      const n = parseInt(raw, 10);
      if (!isNaN(n)) {
        mv.tickOffset = n;
        offBtn.textContent = '⏱ ' + (n >= 0 ? '+' : '') + n;
        if (!playing) _multiDraw();
      }
    });

    // Wire edit-mode mouse handlers for this slot
    _wireMultiEditCanvas(mv);

    // Use ResizeObserver so the canvas is sized correctly once the flex layout settles
    const ro = new ResizeObserver(() => {
      gv.resize();
      if (!playing) gv.draw();
    });
    ro.observe(wrap);
    mv._ro = ro; // keep reference so we can disconnect if needed
  }
}

// Apply / remove horizontal mirror to a multi-view slot via CSS transform.
// This avoids breaking GameView.draw()'s internal clearRect.
function _multiApplyMirror(mv) {
  // Flip the whole canvas stack (WebGL lane + 2D overlay) together.
  (mv.canvasWrap || mv.canvas).style.transform = mv.mirrored ? 'scaleX(-1)' : '';
}

// Draw all active multi-views (called from render() and playFrame())
function _multiDraw() {
  if (!_multiMode) return;
  for (const mv of _multiViews) {
    if (!mv.gv) continue;
    const offsetTick = _multiSync ? renderer.playTick + mv.tickOffset : mv.gv.playTick;
    mv.gv.playTick = Math.max(0, offsetTick);
    mv.gv.draw();
  }
}

// Sync settings from the main gameView to all multi-views (projection, btWidth, judgeY)
// Also refreshes gv.chart in case a file was loaded into a tab after the rebuild.
function _multiSyncSettings() {
  if (!gameView) return;
  for (const mv of _multiViews) {
    if (!mv.gv) continue;
    // Keep chart reference fresh — file loads replace tabs[i].chart with a new object
    const freshChart = tabs[mv.tabIdx]?.chart;
    if (freshChart && mv.gv.chart !== freshChart) {
      mv.gv.chart = freshChart;
      mv.gv._totalWeight = 0; // force recompute
    }
    mv.gv.btWidthScale   = gameView.btWidthScale;
    mv.gv.projMode       = gameView.projMode;
    mv.gv.perspIntensity = gameView.perspIntensity;
    mv.gv.judgeYFrac     = gameView.judgeYFrac;
    mv.gv.interpMode     = gameView.interpMode;
  }
}

// Toggle multi mode on/off
function _multiToggle() {
  _multiMode = !_multiMode;
  const singleCanvas = document.getElementById('game-canvas');
  const singleWrap   = document.getElementById('game-canvas-wrap');
  const area = document.getElementById('multi-preview-area');
  if (singleWrap)   singleWrap.style.display   = _multiMode ? 'none' : '';
  if (singleCanvas) singleCanvas.style.display = _multiMode ? 'none' : '';
  const sub = document.getElementById('pvc-multi-controls');
  if (sub) sub.style.display = _multiMode ? 'block' : 'none';
  const btn = document.getElementById('pvc-multi-toggle');
  if (btn) {
    btn.classList.toggle('active', _multiMode);
    btn.textContent = _multiMode ? '⊞ On' : '⊟ Off';
  }
  if (_multiMode) {
    if (!_multiTabMask.size) {
      // Default: show all tabs
      tabs.forEach((_, i) => _multiTabMask.add(i));
    }
    _multiRebuild();
  } else {
    if (area) { area.style.display = 'none'; area.innerHTML = ''; }
    _multiViews = [];
  }
  _multiUpdateTabButtons();
}

// Rebuild the tab-selector buttons in the controls panel
function _multiUpdateTabButtons() {
  const container = document.getElementById('pvc-multi-tabs');
  if (!container) return;
  container.innerHTML = '';
  tabs.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'pvc-multi-tab-btn' + (_multiTabMask.has(i) ? ' active' : '');
    btn.title = t.name || `Chart ${i + 1}`;
    btn.textContent = (t.name || `Chart ${i + 1}`).slice(0, 10);
    btn.addEventListener('click', () => {
      if (_multiTabMask.has(i)) _multiTabMask.delete(i);
      else _multiTabMask.add(i);
      btn.classList.toggle('active', _multiTabMask.has(i));
      if (_multiMode) _multiRebuild();
    });
    container.appendChild(btn);
  });
}

// Wire up all multi-preview control events (called once after DOM ready)
function _multiInitControls() {
  document.getElementById('pvc-multi-toggle')?.addEventListener('click', _multiToggle);

  // Layout buttons
  document.querySelectorAll('.pvc-multi-layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _multiLayout = btn.dataset.layout;
      document.querySelectorAll('.pvc-multi-layout-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.layout === _multiLayout));
      if (_multiMode) _multiRebuild();
    });
  });

  // Gap slider
  const gapSlider = document.getElementById('pvc-multi-gap');
  const gapLabel  = document.getElementById('pvc-multi-gap-label');
  gapSlider?.addEventListener('input', () => {
    _multiGap = +gapSlider.value;
    if (gapLabel) gapLabel.textContent = _multiGap + 'px';
    if (_multiMode && document.getElementById('multi-preview-area')) {
      document.getElementById('multi-preview-area').style.gap = _multiGap + 'px';
    }
  });

  // Sync toggle
  document.getElementById('pvc-multi-sync')?.addEventListener('change', e => {
    _multiSync = e.target.checked;
  });

  // Handle window resize — re-size all GameViews
  window.addEventListener('resize', () => {
    if (!_multiMode) return;
    for (const mv of _multiViews) {
      if (!mv.gv) continue;
      mv.gv.resize();
      mv.gv.draw();
    }
  });
}

// ── Multiple-chart picker modal ────────────────────────────────────────────────
function showMultiChartPicker(chartMetas, onConfirm) {
  // Build or reuse the modal element
  let modal = document.getElementById('modal-multi-chart');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id        = 'modal-multi-chart';
  modal.className = 'modal';
  modal.style.display = 'flex';

  // Track selection and mode
  let splitMode  = false;
  let selectedIdx = new Set();

  const render = () => {
    const cards = chartMetas.map((m, i) => {
      const sel = selectedIdx.has(i);
      return `
        <div class="mcp-card${sel ? ' mcp-card-selected' : ''}" data-idx="${i}">
          <div class="mcp-jacket">${m.jacketURL
            ? `<img src="${m.jacketURL}" alt="jacket">`
            : '<div class="mcp-jacket-placeholder">♪</div>'}</div>
          <div class="mcp-info">
            <div class="mcp-title">${m.title || m.file.name}</div>
            <div class="mcp-sub">
              ${m.diff ? `<span class="mcp-diff">${m.diff.toUpperCase()}</span>` : ''}
              ${m.level ? `<span class="mcp-level">Lv.${m.level}</span>` : ''}
            </div>
            <div class="mcp-filename">${m.file.name}</div>
          </div>
          ${sel ? '<div class="mcp-check">✓</div>' : ''}
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal-box mcp-box">
        <div class="mcp-header">
          <span class="mcp-icon">&#9670;</span> Multiple Charts Detected
        </div>
        <div class="mcp-mode-row">
          <button class="mcp-mode-btn${!splitMode ? ' active' : ''}" id="mcp-btn-normal">◉ Normal</button>
          <button class="mcp-mode-btn${splitMode  ? ' active' : ''}" id="mcp-btn-split">⧉ Split</button>
          <span class="mcp-mode-hint">${splitMode
            ? 'Select 2 charts — opens side-by-side'
            : 'Select 1 chart — opens in current tab'}</span>
        </div>
        <div class="mcp-cards">${cards}</div>
        <div class="mcp-actions">
          <button class="mcp-open-btn" id="mcp-open" ${selectedIdx.size === 0 ? 'disabled' : ''}>
            ${splitMode ? '⧉ Open in Split View' : '▶ Open'}
          </button>
          <button class="mcp-cancel-btn" id="mcp-cancel">Cancel</button>
        </div>
      </div>`;

    // Re-bind events after re-render
    modal.querySelectorAll('.mcp-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = +card.dataset.idx;
        if (splitMode) {
          if (selectedIdx.has(idx)) selectedIdx.delete(idx);
          else if (selectedIdx.size < 2) selectedIdx.add(idx);
        } else {
          selectedIdx = new Set([idx]);
        }
        render();
      });
    });
    modal.querySelector('#mcp-btn-normal')?.addEventListener('click', () => {
      splitMode = false; selectedIdx = new Set(); render();
    });
    modal.querySelector('#mcp-btn-split')?.addEventListener('click', () => {
      splitMode = true; selectedIdx = new Set(); render();
    });
    modal.querySelector('#mcp-open')?.addEventListener('click', () => {
      if (!selectedIdx.size) return;
      modal.style.display = 'none';
      const chosen = [...selectedIdx].map(i => chartMetas[i]);
      onConfirm(chosen, splitMode);
    });
    modal.querySelector('#mcp-cancel')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  };

  document.body.appendChild(modal);
  render();
}

// ── Loading overlay helpers ────────────────────────────────────────────────────
function _loadingShow(stage, pct) {
  const ov  = document.getElementById('loading-overlay');
  const st  = document.getElementById('loading-stage');
  const bar = document.getElementById('loading-bar');
  const pctEl = document.getElementById('loading-pct');
  if (!ov) return;
  ov.style.display   = 'flex';
  ov.style.opacity   = '1';
  ov.style.pointerEvents = 'all';
  if (st)    st.textContent    = stage || '';
  if (bar)   bar.style.width   = (pct ?? 0) + '%';
  if (pctEl) pctEl.textContent = (pct ?? 0) + '%';
}

function _loadingDone() {
  const ov = document.getElementById('loading-overlay');
  if (!ov) return;
  // Always dismiss — log any init errors to console instead of blocking the UI
  if (_initErrors.length > 0) {
    console.warn(`[vibe-editr] ${_initErrors.length} init error(s):`, _initErrors);
  }
  ov.style.opacity = '0';
  ov.style.pointerEvents = 'none';
  setTimeout(() => { if (ov) ov.style.display = 'none'; }, 420);
}

function _showErrorScreen(error) {
  const loadingOv = document.getElementById('loading-overlay');
  const errorScreen = document.getElementById('error-screen');
  const errorMsg = document.getElementById('error-message');
  const errorCode = document.getElementById('error-code');
  if (loadingOv) loadingOv.style.display = 'none';
  if (errorScreen) {
    errorScreen.style.display = 'flex';
    // Generate a pseudo error code from the error hash for aesthetics
    if (errorCode) {
      const str = error instanceof Error ? error.message : String(error);
      let h = 0;
      for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
      const code = Math.abs(h).toString(16).toUpperCase().padStart(8, '0');
      errorCode.textContent = `E-${code.slice(0,4)}-${code.slice(4)}`;
    }
    if (errorMsg) {
      const errText = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack || '') : '';
      errorMsg.textContent = errText + (stack ? '\n\n' + stack : '');
    }
  }
  console.error('Initialization error:', error);
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  try {

  _initPhase = 'editor-init';
  _loadingShow('Initializing editor…', 5);
  buildLaneHeader();

  _initPhase = 'renderer-init';
  const canvas = document.getElementById('chart-canvas');
  renderer = new Renderer(canvas);
  renderer.chart = chart;

  // Restore session state (zoom, scroll, cursor, view mode)
  _restoreSession();

  // Initial zoom from slider (100% on slider = 1.2× internal zoom)
  const zs = document.getElementById('zoom-slider');
  renderer.zoom = +zs.value / 100 * 1.2;
  renderer.resize();

  _initPhase = 'game-view-init';
  // Game view
  const gameCanvas = document.getElementById('game-canvas');
  if (gameCanvas) {
    gameView = new GameView(gameCanvas);
    gameView.chart = chart;
    // The lane runway is rendered exclusively by the WebGL renderer. Attach the
    // sibling WebGL canvas; if the browser somehow lacks WebGL2 the GameView
    // falls back to a plain background so notes/lasers still composite on top.
    const glCanvas = document.getElementById('game-canvas-gl');
    if (glCanvas) gameView.attachGL(glCanvas);
    gameView.resize();
    gameCanvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      // In edit mode right-click is handled as erase in mousedown — never show the menu
      if (!_gameEditMode) showGameCtxMenu(e.clientX, e.clientY);
    });
  }

  // Seekbar / scrub
  initSeekbar();

  // Chart Minimap
  _minimapInitEvents();
  _initMinimapToggle();

  // Chart speed slider — visual hi-speed only; playback timing is always BPM-accurate
  const speedSlider = document.getElementById('chart-speed');
  if (speedSlider) {
    const initHs = +speedSlider.value;
    chartSpeed = initHs;
    document.getElementById('chart-speed-label').textContent = initHs.toFixed(2) + '×';
    speedSlider.addEventListener('input', e => {
      const hs = +e.target.value;
      chartSpeed = hs; // kept for legacy references; does NOT affect timing
      document.getElementById('chart-speed-label').textContent = hs.toFixed(2) + '×';
      // Mirror to preview panel
      const pvSl  = document.getElementById('pvc-hispeed');
      const pvLbl = document.getElementById('pvc-hispeed-label');
      if (pvSl)  pvSl.value = hs;
      if (pvLbl) pvLbl.textContent = hs.toFixed(1) + '×';
      if (gameView) { gameView.hispeed = hs; if (!playing) gameView.draw(); }
    });
  }
  if (gameView) gameView.hispeed = chartSpeed;

  // BT Width slider
  const btWidthSlider = document.getElementById('pvc-bt-width');
  const btWidthLabel  = document.getElementById('pvc-bt-width-label');
  if (btWidthSlider) {
    btWidthSlider.addEventListener('input', e => {
      const bw = +e.target.value;
      if (btWidthLabel) btWidthLabel.textContent = bw.toFixed(2) + '×';
      if (gameView) { gameView.btWidthScale = bw; if (!playing) gameView.draw(); }
    });
  }
  if (gameView) gameView.btWidthScale = 1.0;

  // ── Multi-chart preview ───────────────────────────────────────────────────
  _multiInitControls();

  // View mode buttons (toolbar + menu items share same logic)
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Fullscreen button
  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleGameViewFullscreen);

  // Edit menu buttons
  document.getElementById('btn-undo')?.addEventListener('click', undo);
  document.getElementById('btn-redo')?.addEventListener('click', redo);
  document.getElementById('btn-cut')?.addEventListener('click',  () => { selCut(); render(); });
  document.getElementById('btn-copy')?.addEventListener('click', selCopy);
  document.getElementById('btn-paste')?.addEventListener('click', selPaste);
  document.getElementById('btn-mirror-all')?.addEventListener('click', () => selMirror('all'));
  document.getElementById('btn-mirror-bt')?.addEventListener('click',  () => selMirror('bt'));
  document.getElementById('btn-mirror-fx')?.addEventListener('click',  () => selMirror('fx'));
  document.getElementById('btn-mirror-vol')?.addEventListener('click', () => selMirror('vol'));
  document.getElementById('btn-tmirror-all')?.addEventListener('click', () => selTemporalMirror('all'));
  document.getElementById('btn-tmirror-bt')?.addEventListener('click',  () => selTemporalMirror('bt'));
  document.getElementById('btn-tmirror-vol')?.addEventListener('click', () => selTemporalMirror('vol'));
  document.getElementById('btn-swap-lasers')?.addEventListener('click', () => selSwapLasers());
  document.getElementById('btn-speed-half')?.addEventListener('click',   () => selAdjustSpeed(0.5));
  document.getElementById('btn-speed-double')?.addEventListener('click', () => selAdjustSpeed(2.0));
  document.getElementById('btn-sran-all')?.addEventListener('click', () => applySRan('all'));
  document.getElementById('btn-sran-bt')?.addEventListener('click',  () => applySRan('bt'));
  document.getElementById('btn-sran-fx')?.addEventListener('click',  () => applySRan('fx'));
  document.getElementById('btn-sran-vol')?.addEventListener('click', () => applySRan('vol'));
  document.getElementById('btn-ripple-delete')?.addEventListener('click', selRippleDelete);

  _initPhase = 'first-render';
  _loadingShow('Building renderer…', 60);
  syncMetaToChart();
  renderTabBar();
  render();

  _initPhase = 'done';
  _loadingShow('Ready', 100);
  // Dismiss loading overlay after a brief frame — everything is painted
  requestAnimationFrame(() => requestAnimationFrame(_loadingDone));

  // Seed the IndexedDB immediately so recovery is always available
  setTimeout(() => _idbAutosave(), 3000);

  // Canvas mouse
  canvas.addEventListener('mousedown',   onMouseDown);
  canvas.addEventListener('mousemove',   onMouseMove);
  canvas.addEventListener('mouseup',     onMouseUp);
  canvas.addEventListener('contextmenu', onRightClick);
  canvas.addEventListener('dblclick',    onDblClick);
  canvas.addEventListener('mouseleave', () => {
    // Clear hover highlights when leaving canvas; popups stay open (click-to-close)
    if (renderer) {
      let dirty = false;
      if (renderer._hoveredCamTick !== null) { renderer._hoveredCamTick = null; dirty = true; }
      if (renderer._hoveredVelTick !== null) { renderer._hoveredVelTick = null; dirty = true; }
      if (dirty) render();
    }
  });
  document.getElementById('canvas-wrap').addEventListener('wheel', onWheel, { passive: false });

  // Camera popup — click-to-open, click-outside to close.
  // Allow clicking the ✕ close button inside the popup to dismiss it.
  const _camPop = document.getElementById('cam-hover-popup');
  if (_camPop) {
    _camPop.addEventListener('click', ev => {
      if (ev.target.classList.contains('cam-pop-close')) {
        _camPopupFixedTick = null;
        _hideCamPopup();
      }
    });
  }

  // Play buttons (toolbar + topbar)
  document.getElementById('btn-play')?.addEventListener('click', togglePlay);
  document.getElementById('btn-play-top')?.addEventListener('click', togglePlay);

  // Topbar view buttons
  document.querySelectorAll('.topbar-view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Load audio button
  document.getElementById('btn-load-audio')?.addEventListener('click', () => {
    document.getElementById('audio-file-input').click();
  });
  document.getElementById('audio-file-input')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (f) { await loadAudioFile(f); tabs.forEach(t => { t.audioBuffer = audioBuffer; }); }
    e.target.value = '';
  });

  // Measures per column
  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // Snap
  document.getElementById('snap-select').addEventListener('change', e => { snap = parseFloat(e.target.value); syncSnapUI(); });

  // Zoom slider (100% = 1.2× internal zoom)
  document.getElementById('zoom-slider').addEventListener('input', e => {
    const val = +e.target.value;
    prefs.zoom = val;
    renderer.zoom = val / 100 * 1.2;
    document.getElementById('zoom-label').textContent = val + '%';
    renderer.resize();
    render();
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
  });

  // Beats per lane slider
  const bplSlider = document.getElementById('beats-per-lane');
  bplSlider?.addEventListener('input', () => {
    const val = +bplSlider.value;
    prefs.beatsPerLane = val;
    applyBeatsPerLane(val);
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
  });
  // Legacy meas-per-col input (Chart menu) — keep both in sync
  document.getElementById('meas-per-col')?.addEventListener('change', e => {
    const mpc = Math.max(1, Math.min(16, +e.target.value));
    prefs.measPerCol = mpc;
    renderer.measPerCol = mpc;
    applyBeatsPerLane(renderer.beatsPerCol);
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
  });

  // Metadata
  document.querySelectorAll('#panel-meta input, #panel-meta select').forEach(el => {
    el.addEventListener('change', syncMetaToChart);
    el.addEventListener('input',  syncMetaToChart);
  });

  // Export progress UI manager
  let _exportAborted = false;
  function showExportProgress(label = 'Exporting…') {
    _exportAborted = false;
    const modal = document.getElementById('export-progress-modal');
    const status = document.getElementById('export-status');
    const progressFill = document.getElementById('export-progress-fill');
    const progressText = document.getElementById('export-progress-text');
    const cancelBtn = document.getElementById('export-cancel-btn');
    const doneBtn = document.getElementById('export-done-btn');
    const debugLog = document.getElementById('export-debug');
    if (!modal) return;
    // Reset
    status.textContent = label;
    progressFill.style.width = '0%';
    progressText.textContent = '';
    debugLog.innerHTML = '<div style="color:#aaaadd;opacity:0.7">Debug log:</div>';
    cancelBtn.style.display = 'block';
    doneBtn.style.display = 'none';
    modal.style.display = 'flex';
  }
  function updateExportProgress(pct, status = null, debugMsg = null) {
    const modal = document.getElementById('export-progress-modal');
    const statusEl = document.getElementById('export-status');
    const progressFill = document.getElementById('export-progress-fill');
    const progressText = document.getElementById('export-progress-text');
    const debugLog = document.getElementById('export-debug');
    if (!modal) return;
    pct = Math.max(0, Math.min(100, pct));
    progressFill.style.width = pct + '%';
    if (pct > 10) progressText.textContent = pct + '%';
    if (status) statusEl.textContent = status;
    if (debugMsg) {
      const line = document.createElement('div');
      line.textContent = debugMsg;
      line.style.color = debugMsg.includes('Error') || debugMsg.includes('error') ? '#ff8888' : '#88cc88';
      debugLog.appendChild(line);
      debugLog.scrollTop = debugLog.scrollHeight;
    }
  }
  function closeExportProgress() {
    const modal = document.getElementById('export-progress-modal');
    if (modal) modal.style.display = 'none';
  }
  function finishExportProgress(success = true, msg = null) {
    const statusEl = document.getElementById('export-status');
    const cancelBtn = document.getElementById('export-cancel-btn');
    const doneBtn = document.getElementById('export-done-btn');
    if (success) {
      statusEl.textContent = msg || '✓ Export complete';
      statusEl.style.color = '#aaffaa';
      updateExportProgress(100);
    } else {
      statusEl.textContent = msg || '✗ Export failed';
      statusEl.style.color = '#ff8888';
    }
    cancelBtn.style.display = 'none';
    doneBtn.style.display = 'block';
  }
  function cancelExport() {
    _exportAborted = true;
    const modal = document.getElementById('export-progress-modal');
    if (modal) modal.style.display = 'none';
  }
  window.showExportProgress = showExportProgress;
  window.updateExportProgress = updateExportProgress;
  window.finishExportProgress = finishExportProgress;
  window.cancelExport = cancelExport;
  window.closeExportProgress = closeExportProgress;

  // Export
  document.getElementById('btn-export-ksh').addEventListener('click', () => {
    const title = chart.meta.title || 'Untitled Chart';
    if (!confirm(`Export "${title}" as KSH?`)) return;
    try {
      showExportProgress('Exporting KSH…');
      updateExportProgress(10, 'Preparing chart data…');
      const base = (chart.meta.title.replace(/[^a-zA-Z0-9_]/g, '_') || 'chart');
      const diff = (chart.meta.difficulty || '').toLowerCase();
      const suffix = diff ? `_${diff}` : '';
      const filename = base + suffix + '.ksh';
      updateExportProgress(30, 'Generating KSH…', 'Serializing chart notes and events');
      const ksh = exportKsh(chart);
      updateExportProgress(80, 'Preparing download…', `Generated ${(ksh.length / 1024).toFixed(1)}KB KSH`);
      console.log(`[Export] Calling downloadText('${filename}', ...)`);
      updateExportProgress(85, 'Starting download…', `Triggering download of ${filename}`);
      downloadText(filename, ksh);
      updateExportProgress(95, 'Download initiated…', 'Your file should appear in your Downloads folder');
      setTimeout(() => finishExportProgress(true, '✓ KSH exported: ' + filename), 500);
    } catch (err) {
      console.error('KSH export failed:', err);
      updateExportProgress(0, null, 'Error: ' + (err?.message || err));
      finishExportProgress(false, '✗ ' + (err?.message || err));
    }
  });
  document.getElementById('btn-export-kson').addEventListener('click', () => {
    const title = chart.meta.title || 'Untitled Chart';
    if (!confirm(`Export "${title}" as KSON?`)) return;
    try {
      showExportProgress('Exporting KSON…');
      updateExportProgress(10, 'Preparing chart data…');
      const base = (chart.meta.title.replace(/[^a-zA-Z0-9_]/g, '_') || 'chart');
      const diff = (chart.meta.difficulty || '').toLowerCase();
      const suffix = diff ? `_${diff}` : '';
      const filename = base + suffix + '.kson';
      updateExportProgress(30, 'Generating KSON…', 'Serializing chart with spec-compliant format');
      const kson = exportKson(chart);
      updateExportProgress(80, 'Preparing download…', `Generated ${(kson.length / 1024).toFixed(1)}KB KSON`);
      console.log(`[Export] Calling downloadText('${filename}', ...)`);
      updateExportProgress(85, 'Starting download…', `Triggering download of ${filename}`);
      downloadText(filename, kson);
      updateExportProgress(95, 'Download initiated…', 'Your file should appear in your Downloads folder');
      setTimeout(() => finishExportProgress(true, '✓ KSON exported: ' + filename), 500);
    } catch (err) {
      console.error('KSON export failed:', err);
      updateExportProgress(0, null, 'Error: ' + (err?.message || err));
      finishExportProgress(false, '✗ ' + (err?.message || err));
    }
  });

  // Open file
  document.getElementById('btn-open-ksh').addEventListener('click', () => {
    const fi = document.getElementById('file-input'); fi.accept = '.ksh'; fi.click();
  });
  document.getElementById('btn-open-kson').addEventListener('click', () => {
    const fi = document.getElementById('file-input'); fi.accept = '.kson'; fi.click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const isPack = !!e.target.dataset.bundle || file.name.endsWith('.ksonpack');
    delete e.target.dataset.bundle;
    const reader = new FileReader();
    reader.onload = ev => {
      _loadingShow(`Parsing ${file.name}…`, 30);
      try {
        const result = ev.target.result;

        // ── .ksonpack bundle: explode into one tab per chart ─────────────
        if (isPack) {
          const { charts: packCharts, meta: packMeta, tabNames: packTabNames = [] } = importKsonPack(result);
          if (!packCharts.length) throw new Error('Pack contains no charts.');
          const startIdx = activeTabIdx;
          for (let i = 0; i < packCharts.length; i++) {
            const c = packCharts[i];
            const savedName = packTabNames[i];
            const fallbackName = savedName || (c.meta?.title
              ? (c.meta.difficulty ? `${c.meta.title} - ${c.meta.difficulty.toUpperCase()}` : c.meta.title)
              : `Chart ${tabs.length + 1}`);
            const slot = (i === 0) ? startIdx : (tabs.push({
              name: fallbackName,
              chart: c, audioBuffer: null, hispeed: 1.0,
            }) - 1);
            tabs[slot].chart = c;
            tabs[slot].name  = fallbackName;
          }
          // Propagate any already-loaded audio to all pack tabs so switching
          // between difficulties doesn't lose the track.
          if (audioBuffer) tabs.forEach(t => { if (!t.audioBuffer) t.audioBuffer = audioBuffer; });

          // Update global chart before switchToTab so it doesn't save the
          // stale reference back over the first pack chart we just loaded.
          chart = packCharts[0];
          switchToTab(startIdx);
          chart = tabs[startIdx].chart;
          renderer.chart = chart; renderer.scrollCol = 0; renderer.playTick = 0;
          if (gameView) { gameView.chart = chart; gameView._liveCamera = null; gameView._totalWeight = 0; }
          fxChipSEBuffers = [null, null];
          pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
          renderFxChain(0); renderFxChain(1);
          renderTabBar();
          render();
          updateSeekbar(0);
          _loadingDone();
          _idbAutosave();
          // Friendly confirmation
          if (packMeta?.title) {
            console.log(`Loaded pack "${packMeta.title}" — ${packCharts.length} charts.`);
          }
          return;
        }

        // KSH files may be Shift-JIS encoded — pass ArrayBuffer so importKsh
        // can auto-detect. KSON is always UTF-8 JSON → read as text.
        chart = file.name.endsWith('.kson') ? importKson(result) : importKsh(result);
        tabs[activeTabIdx].chart = chart;
        // Set tab name to "Title - DIFFICULTY" format (sketch item 17)
        if (chart.meta.title) {
          const _diff = chart.meta.difficulty ? chart.meta.difficulty.toUpperCase() : '';
          tabs[activeTabIdx].name = _diff ? `${chart.meta.title} - ${_diff}` : chart.meta.title;
        }
        renderer.chart = chart;
        renderer.scrollCol = 0;
        renderer.playTick  = 0;
        if (gameView) { gameView.chart = chart; gameView._liveCamera = null; gameView._totalWeight = 0; }
        // Reset per-chart SE buffers (no folder context for single file)
        fxChipSEBuffers = [null, null];
        pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
        renderFxChain(0); renderFxChain(1);
        renderTabBar();
        render();
        updateSeekbar(0);
        _loadingDone();
        _idbAutosave(); // immediately persist imported chart
      } catch(err) { _loadingDone(); alert('Error loading file:\n' + err.message); }
    };
    // Bundles + KSON are JSON text. KSH is ArrayBuffer (Shift-JIS auto-detect).
    if (isPack || file.name.endsWith('.kson')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  });

  // New chart
  document.getElementById('btn-new').addEventListener('click', () => {
    if (!confirm('Start a new chart? Unsaved changes will be lost.')) return;
    chart = new ChartData();
    tabs[activeTabIdx].chart = chart;
    renderer.chart = chart;
    renderer.scrollCol = 0; renderer.playTick = 0;
    if (gameView) { gameView.chart = chart; gameView._totalWeight = 0; }
    pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
    renderFxChain(0); renderFxChain(1); render();
    updateSeekbar(0);
  });

  // New chart in NEW tab — additive, never replaces current
  document.getElementById('btn-new-tab')?.addEventListener('click', () => {
    addTab(); // creates fresh ChartData and switches to it
  });

  // Open .ksh / .kson in a NEW tab — same loader, just adds a tab first
  document.getElementById('btn-open-ksh-new-tab')?.addEventListener('click', () => {
    addTab();
    const fi = document.getElementById('file-input'); fi.accept = '.ksh'; fi.click();
  });
  document.getElementById('btn-open-kson-new-tab')?.addEventListener('click', () => {
    addTab();
    const fi = document.getElementById('file-input'); fi.accept = '.kson'; fi.click();
  });

  // ── ksonpack bundle: open / export ─────────────────────────────────────
  document.getElementById('btn-open-ksonpack')?.addEventListener('click', () => {
    const fi = document.getElementById('file-input'); fi.accept = '.ksonpack,.json'; fi.dataset.bundle = '1'; fi.click();
  });

  document.getElementById('btn-export-ksonpack')?.addEventListener('click', () => {
    if (!tabs.length) return;
    const validTabs = tabs.filter(t => t.chart);
    const charts = validTabs.map(t => t.chart);
    const tabNames = validTabs.map(t => t.name);
    if (!charts.length) { alert('No charts to export.'); return; }
    const packName = (charts[0].meta.title || 'pack').replace(/[^a-zA-Z0-9_]/g, '_');
    const filename = packName + '.ksonpack';
    const packMeta = {
      title:       charts[0].meta.title || 'Untitled Pack',
      artist:      charts[0].meta.artist || '',
      description: `${charts.length} chart${charts.length === 1 ? '' : 's'} bundled from vibe-editr.`,
    };
    try {
      showExportProgress('Exporting .ksonpack bundle…');
      updateExportProgress(10, `Preparing ${charts.length} chart(s)…`);
      updateExportProgress(25, 'Serializing charts…', `Processing ${charts.length} chart(s)`);
      const pack = exportKsonPack(charts, packMeta, tabNames);
      updateExportProgress(80, 'Preparing download…', `Generated ${(pack.length / 1024).toFixed(1)}KB pack`);
      console.log(`[Export] Calling downloadText('${filename}', ...)`);
      updateExportProgress(85, 'Starting download…', `Triggering download of ${filename}`);
      downloadText(filename, pack);
      updateExportProgress(95, 'Download initiated…', 'Your file should appear in your Downloads folder');
      setTimeout(() => finishExportProgress(true, `✓ Pack exported: ${filename}`), 500);
    } catch(err) {
      console.error('Pack export failed:', err);
      updateExportProgress(0, null, 'Error: ' + (err?.message || err));
      finishExportProgress(false, '✗ ' + (err?.message || err));
    }
  });

  // FX chain
  document.querySelectorAll('.add-fx-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lane = btn.dataset.lane === 'l' ? 0 : 1;
      saveUndo('Added FX Effect');
      chart.fxChains[lane].push(makeEffectInstance(document.getElementById('fx-type-select').value));
      renderFxChain(lane);
    });
  });

  // Song Metadata modal
  document.getElementById('btn-song-meta')?.addEventListener('click', openSongMetaModal);
  document.getElementById('sm-save')?.addEventListener('click', saveSongMetaModal);
  document.getElementById('sm-cancel')?.addEventListener('click', () => document.getElementById('modal-song-meta').style.display = 'none');

  // Import audio from inside Song Metadata modal
  document.getElementById('sm-btn-import-audio')?.addEventListener('click', () => {
    document.getElementById('sm-audio-import-input').click();
  });
  document.getElementById('sm-audio-import-input')?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // Close the metadata modal first so the import-progress modal is visible
    document.getElementById('modal-song-meta').style.display = 'none';
    await importAudioFile(f);
    // Re-sync the music filename back into the modal field
    document.getElementById('sm-music').value = chart.meta.music || '';
  });

  // Calibrate from inside Song Metadata modal
  document.getElementById('sm-btn-calibrate')?.addEventListener('click', () => {
    if (!audioBuffer) {
      alert('Load an audio file first before calibrating.');
      return;
    }
    // Close modal temporarily; calibration window is a full-screen overlay
    document.getElementById('modal-song-meta').style.display = 'none';
    calibrationWindow.open(audioBuffer, chart, (markerSec, calibBpm) => {
      const ms = Math.round(markerSec * 1000);
      chart.meta.offset = ms;
      document.getElementById('meta-offset').value  = ms;
      document.getElementById('sm-offset').value    = ms;
      pushMeta();
      // Apply BPM if changed
      if (calibBpm && chart.bpmEvents?.length) {
        const oldBpm = chart.bpmEvents[0].bpm;
        if (Math.abs(calibBpm - oldBpm) > 0.01) {
          chart.bpmEvents[0].bpm = calibBpm;
        }
      }
      saveUndo('Calibrated audio offset (from metadata modal)');
      // Re-open metadata modal after calibration
      openSongMetaModal();
    });
  });
  document.getElementById('sm-btn-jacket')?.addEventListener('click', () => document.getElementById('sm-jacket-picker').click());
  document.getElementById('sm-jacket-picker')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    document.getElementById('sm-jacket').value = f.name;
    const img = document.getElementById('meta-jacket-img-modal');
    const ph  = document.getElementById('meta-jacket-placeholder');
    img.src = URL.createObjectURL(f); img.style.display = 'block'; ph.style.display = 'none';
    // also sync to main jacket preview
    const main = document.getElementById('jacket-preview');
    if (main) { main.src = img.src; main.style.display = 'block'; }
  });

  // BPM modal
  document.getElementById('btn-add-bpm').addEventListener('click', () => document.getElementById('modal-bpm').style.display = 'flex');
  document.getElementById('bpm-ev-cancel').addEventListener('click', () => document.getElementById('modal-bpm').style.display = 'none');
  document.getElementById('bpm-ev-ok').addEventListener('click', () => {
    const measure = +document.getElementById('bpm-ev-measure').value - 1;
    const beat    = +document.getElementById('bpm-ev-beat').value - 1;
    const bpm     = +document.getElementById('bpm-ev-value').value;
    saveUndo(`Added BPM ${bpm} at M${measure+1}`);
    chart.addBpmEvent(measure * TICKS_PER_MEASURE + beat * TICKS_PER_BEAT, bpm);
    document.getElementById('modal-bpm').style.display = 'none';
    updateBpmList(); render();
  });

  // TimeSig modal
  document.getElementById('btn-add-timesig').addEventListener('click', () => document.getElementById('modal-timesig').style.display = 'flex');
  document.getElementById('ts-ev-cancel').addEventListener('click', () => document.getElementById('modal-timesig').style.display = 'none');
  document.getElementById('ts-ev-ok').addEventListener('click', () => {
    const measure = +document.getElementById('ts-ev-measure').value - 1;
    saveUndo(`Added Time Signature at M${measure+1}`);
    chart.addTimeSigEvent(measure, +document.getElementById('ts-ev-num').value, +document.getElementById('ts-ev-den').value);
    document.getElementById('modal-timesig').style.display = 'none';
    updateTimeSigList();
  });

  // Chart Velocity modal
  document.getElementById('btn-add-scroll-speed').addEventListener('click', () => document.getElementById('modal-scroll-speed').style.display = 'flex');
  document.getElementById('btn-open-velenv')?.addEventListener('click', () => openVelEnvEditor());
  document.getElementById('btn-velenv-menu')?.addEventListener('click', () => toggleVelEnvEditor());
  document.getElementById('ss-ev-cancel').addEventListener('click', () => document.getElementById('modal-scroll-speed').style.display = 'none');
  document.getElementById('ss-ev-ok').addEventListener('click', () => {
    const measure = +document.getElementById('ss-ev-measure').value - 1;
    const beat    = +document.getElementById('ss-ev-beat').value - 1;
    const speed   = +document.getElementById('ss-ev-speed').value;
    const y = measure * TICKS_PER_MEASURE + beat * TICKS_PER_BEAT;
    saveUndo(`Added Chart Velocity ${speed}x at M${measure+1}`);
    chart.addScrollSpeedEvent(y, speed);
    document.getElementById('modal-scroll-speed').style.display = 'none';
    updateScrollSpeedEventList(); render();
  });

  // Open song folder
  document.getElementById('btn-open-folder')?.addEventListener('click', () => {
    document.getElementById('folder-input').click();
  });
  document.getElementById('folder-input')?.addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const readText = (file) => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsText(file, 'utf-8');
    });
    // Read as ArrayBuffer for KSH (Shift-JIS auto-detect)
    const readBinary = (file) => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsArrayBuffer(file);
    });

    // If there's a .ksonpack in the folder, load it inline so the full folder
    // file list stays available for audio/jacket auto-load.
    const packFile = files.find(f => f.name.endsWith('.ksonpack') || (f.name.endsWith('.json') && f.name.toLowerCase().includes('pack')));
    if (packFile) {
      try {
        _loadingShow(`Loading ${packFile.name}…`, 20);
        const packText = await readText(packFile);
        const { charts: packCharts, meta: packMeta, tabNames: packTabNames = [], audioFilenames: packAudioNames = [] } = importKsonPack(packText);
        if (!packCharts.length) throw new Error('Pack contains no charts.');

        const startIdx = activeTabIdx;
        for (let i = 0; i < packCharts.length; i++) {
          const c = packCharts[i];
          const savedName = packTabNames[i];
          const fallback = savedName || (c.meta?.title
            ? (c.meta.difficulty ? `${c.meta.title} - ${c.meta.difficulty.toUpperCase()}` : c.meta.title)
            : `Chart ${tabs.length + 1}`);
          const slot = i === 0 ? startIdx : (tabs.push({ name: fallback, chart: c, audioBuffer: null, hispeed: 1.0 }) - 1);
          tabs[slot].chart = c;
          tabs[slot].name  = fallback;
        }

        chart = packCharts[0];
        switchToTab(startIdx);
        chart = tabs[startIdx].chart;
        renderer.chart = chart; renderer.scrollCol = 0; renderer.playTick = 0;
        if (gameView) { gameView.chart = chart; gameView._liveCamera = null; gameView._totalWeight = 0; }
        fxChipSEBuffers = [null, null];
        pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
        renderFxChain(0); renderFxChain(1);
        renderTabBar();
        render();
        updateSeekbar(0);
        _idbAutosave();

        // ── Auto-load audio from folder ───────────────────────────────────
        // 1. Try each audio filename listed in pack meta (exact basename match)
        // 2. Fall back to any audio file in the folder
        const audioExts = ['.ogg', '.mp3', '.wav', '.flac'];
        let audioFile = null;
        for (const name of packAudioNames) {
          audioFile = files.find(f => f.name === name);
          if (audioFile) break;
        }
        // Also check individual chart music fields in case pack was old format
        if (!audioFile) {
          for (const c of packCharts) {
            const musicName = c.meta?.music?.split(/[\\/]/).pop();
            if (musicName) { audioFile = files.find(f => f.name === musicName); if (audioFile) break; }
          }
        }
        if (!audioFile) audioFile = files.find(f => audioExts.some(x => f.name.toLowerCase().endsWith(x)));
        if (audioFile) { await loadAudioFile(audioFile); tabs.forEach(t => { t.audioBuffer = audioBuffer; }); }

        // ── Auto-load jacket from folder ──────────────────────────────────
        const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const jacketName = packCharts[0].meta?.jacket?.split(/[\\/]/).pop();
        const jacketFile = (jacketName && files.find(f => f.name === jacketName))
                        || files.find(f => imgExts.some(x => f.name.toLowerCase().endsWith(x)));
        if (jacketFile) {
          const img = document.getElementById('jacket-preview');
          if (img) { img.src = URL.createObjectURL(jacketFile); img.style.display = 'block'; }
        }

        _loadingDone();
      } catch (err) { _loadingDone(); alert('Error loading pack:\n' + err.message); }
      e.target.value = ''; return;
    }

    // Collect ALL chart files in the folder
    const chartFiles = files.filter(f => f.name.endsWith('.ksh') || f.name.endsWith('.kson'));
    if (!chartFiles.length) { alert('No .ksh, .kson, or .ksonpack file found in folder.'); return; }

    // Helper: load one chart file into the editor
    const loadOneChart = async (chartFile) => {
      const data = chartFile.name.endsWith('.kson')
        ? await readText(chartFile)
        : await readBinary(chartFile);
      const loaded = chartFile.name.endsWith('.kson') ? importKson(data) : importKsh(data);
      tabs[activeTabIdx].chart = loaded;
      chart = loaded;
      // Set tab name to "Title - DIFFICULTY" format (sketch item 17)
      if (chart.meta.title) {
        const _diff = chart.meta.difficulty ? chart.meta.difficulty.toUpperCase() : '';
        tabs[activeTabIdx].name = _diff ? `${chart.meta.title} - ${_diff}` : chart.meta.title;
      }
      renderer.chart = chart;
      renderer.scrollCol = 0; renderer.playTick = 0;
      if (gameView) { gameView.chart = chart; gameView._totalWeight = 0; }
      pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
      renderFxChain(0); renderFxChain(1);
      renderTabBar();
      updateSeekbar(0);
      _idbAutosave();

      // Audio
      const audioExts = ['.ogg', '.mp3', '.wav'];
      const musicName = chart.meta.music?.split(/[\\/]/).pop();
      const audioFile = (musicName && files.find(f => f.name === musicName))
                     || files.find(f => audioExts.some(x => f.name.toLowerCase().endsWith(x)));
      if (audioFile) { await loadAudioFile(audioFile); tabs.forEach(t => { t.audioBuffer = audioBuffer; }); }

      // Jacket
      const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const jacketName = chart.meta.jacket?.split(/[\\/]/).pop();
      const jacketFile = (jacketName && files.find(f => f.name === jacketName))
                      || files.find(f => imgExts.some(x => f.name.toLowerCase().endsWith(x)));
      if (jacketFile) {
        const img = document.getElementById('jacket-preview');
        img.src = URL.createObjectURL(jacketFile); img.style.display = 'block';
      }

      // FX chip SE sounds (KSH fx-l_se / fx-r_se)
      fxChipSEBuffers = [null, null];
      if (chart.meta.fxLSE || chart.meta.fxRSE) {
        await ensureAudioCtx();
        const loadSE = async (filename, idx) => {
          if (!filename) return;
          const baseName = filename.split(/[\\/]/).pop();
          const seFile   = files.find(f => f.name === baseName);
          if (!seFile) return;
          try {
            const ab  = await readBinary(seFile);
            fxChipSEBuffers[idx] = await audioCtx.decodeAudioData(ab);
          } catch (_) {}
        };
        await Promise.all([
          loadSE(chart.meta.fxLSE, 0),
          loadSE(chart.meta.fxRSE, 1),
        ]);
      }

      render();
    };

    // SDVX difficulty order: low → high
    const DIFF_ORDER = ['light','novice','challenge','advanced','extended','infinite','maximum','gravity','heavenly','vivid','exceed'];
    const diffRank = d => {
      const k = (d || '').toLowerCase().replace(/[^a-z]/g,'');
      const i = DIFF_ORDER.findIndex(x => k.startsWith(x));
      return i < 0 ? 99 : i;
    };

    // Quick-read metadata for all chart files
    const chartMetas = [];
    for (const cf of chartFiles) {
      try {
        let text;
        try { text = await readText(cf); } catch(_) { text = ''; }
        let title = cf.name, diff = '', level = '', jacket = '';
        if (cf.name.endsWith('.kson')) {
          try {
            const j = JSON.parse(text);
            title  = j.meta?.title            || cf.name;
            diff   = j.meta?.difficulty?.name || '';
            level  = j.meta?.level != null ? String(j.meta.level) : '';
            jacket = j.meta?.jacket_filename  || '';
          } catch(_) {}
        } else {
          for (const line of text.split('\n').slice(0, 60)) {
            const sep = line.indexOf('=');
            if (sep < 0) continue;
            const key = line.slice(0, sep).trim().toLowerCase();
            const val = line.slice(sep + 1).trim();
            if (key === 'title')      title  = val;
            if (key === 'difficulty') diff   = val;
            if (key === 'level')      level  = val;
            if (key === 'jacket')     jacket = val;
          }
        }
        const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const jacketBaseName = jacket?.split(/[\\/]/).pop();
        const jacketFile = (jacketBaseName && files.find(f => f.name === jacketBaseName))
                        || files.find(f => imgExts.some(x => f.name.toLowerCase().endsWith(x)));
        const jacketURL = jacketFile ? URL.createObjectURL(jacketFile) : null;
        chartMetas.push({ file: cf, title, diff, level, jacketURL });
      } catch(_) {
        chartMetas.push({ file: cf, title: cf.name, diff: '', level: '', jacketURL: null });
      }
    }

    // Sort low → high difficulty
    chartMetas.sort((a, b) => diffRank(a.diff) - diffRank(b.diff) || +a.level - +b.level);

    // Only one chart: load it directly
    if (chartMetas.length === 1) {
      try { await loadOneChart(chartMetas[0].file); }
      catch(err) { alert('Error loading chart:\n' + err.message); }
      e.target.value = ''; return;
    }

    // Multiple charts: open ALL (up to 4) sorted low→high, one per tab.
    // Always ensure exactly 4 tabs exist (add blank ones if needed).
    const toLoad = chartMetas.slice(0, 4);
    try {
      // Load first chart into current tab
      await loadOneChart(toLoad[0].file);
      // Load remaining charts, creating a new tab for each
      for (let i = 1; i < toLoad.length; i++) {
        addTab();
        await loadOneChart(toLoad[i].file);
      }
      // Pad to 4 tabs with blank tabs if we have fewer than 4 charts
      while (tabs.length < 4) addTab();
      // Switch back to first tab
      switchToTab(0);
    } catch(err) { alert('Error loading charts:\n' + err.message); }

    e.target.value = '';
  });

  // Music browse
  document.getElementById('btn-pick-music').addEventListener('click', () => document.getElementById('music-file-picker').click());
  document.getElementById('music-file-picker').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { document.getElementById('meta-music').value = f.name; syncMetaToChart(); }
  });

  // Jacket
  document.getElementById('btn-pick-jacket').addEventListener('click', () => document.getElementById('jacket-file-picker').click());
  document.getElementById('jacket-file-picker').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    document.getElementById('meta-jacket').value = f.name;
    const img = document.getElementById('jacket-preview');
    img.src = URL.createObjectURL(f); img.style.display = 'block';
    syncMetaToChart();
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    renderer.resize();
    if (gameView) gameView.resize();
    render();
  });

  updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); renderFxChain(0); renderFxChain(1);

  // Settings toggles
  document.getElementById('setting-tick')?.addEventListener('change', e => {
    settings.tickSound = e.target.checked;
  });

  // Volume sliders — bidirectional sync with prefs
  const volSliders = [
    { id: 'vol-master', lbl: 'vol-master-label', prefKey: 'volMaster', fn: v => { if (masterGainNode) masterGainNode.gain.value = v; } },
    { id: 'vol-music',  lbl: 'vol-music-label',  prefKey: 'volMusic',  fn: v => { if (musicGainNode)  musicGainNode.gain.value  = v; } },
    { id: 'vol-slam',   lbl: 'vol-slam-label',   prefKey: 'volSlam',   fn: v => { if (slamGainNode)   slamGainNode.gain.value   = v; } },
    { id: 'vol-tick',   lbl: 'vol-tick-label',   prefKey: 'volTick',   fn: v => { if (tickGainNode)   tickGainNode.gain.value   = v; } },
  ];
  volSliders.forEach(({ id, lbl, prefKey, fn }) => {
    const el = document.getElementById(id);
    const lb = document.getElementById(lbl);
    if (!el) return;
    // Initial value comes from prefs (which has been loaded by now)
    if (prefs[prefKey] != null) {
      el.value = prefs[prefKey];
      if (lb) lb.textContent = Math.round(prefs[prefKey] * 100) + '%';
    }
    el.addEventListener('input', () => {
      const v = +el.value;
      lb && (lb.textContent = Math.round(v * 100) + '%');
      ensureAudioCtx();
      fn(v);
      // Sync into prefs and persist
      prefs[prefKey] = v;
      try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
    });
  });

  // Error badge click
  document.getElementById('error-badge')?.addEventListener('click', () => logger.showModal());

  // Apply default view mode (shows 3D game preview by default)
  setViewMode(viewMode);

  // Preferences load
  loadPreferences();
  initHistoryPanel();

  // ── Calibration button ───────────────────────────────────────────────────
  document.getElementById('btn-calibrate')?.addEventListener('click', () => {
    if (!audioBuffer) {
      alert('Load an audio file first before calibrating.\n\nUse the 📂 Import button or Load Audio File to add music.');
      return;
    }
    calibrationWindow.open(audioBuffer, chart, (markerSec, calibBpm) => {
      if (markerSec === null) return;
      const ms = Math.round(markerSec * 1000);
      chart.meta.offset = ms;
      const el = document.getElementById('meta-offset');
      if (el) { el.value = ms; }
      syncMetaToChart();
      // Apply BPM if changed
      if (calibBpm && chart.bpmEvents?.length) {
        const oldBpm = chart.bpmEvents[0].bpm;
        if (Math.abs(calibBpm - oldBpm) > 0.01) {
          chart.bpmEvents[0].bpm = calibBpm;
        }
      }
      saveUndo('Calibrated audio offset');
      // Flash status
      const st = document.getElementById('audio-status');
      if (st) {
        const prev = st.textContent;
        st.textContent = `✓ Offset set to ${ms} ms`;
        setTimeout(() => { st.textContent = prev; }, 2500);
      }
    });
  });

  // ── Audio import button ───────────────────────────────────────────────────
  document.getElementById('btn-import-audio')?.addEventListener('click', () => {
    document.getElementById('audio-import-input').click();
  });
  document.getElementById('audio-import-input')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importAudioFile(f);
  });

  // Import error modal retry/choose buttons (wired dynamically — see importAudioFile)
  document.getElementById('import-error-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-import-error').style.display = 'none';
  });

  // Cancel in-progress OGG encoding
  document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
    if (_encodeStop) {
      _encodeStop();    // abort MediaRecorder, rejects the _encodeToOgg promise
      _encodeStop = null;
    }
    _hideImportProgress();
  });
  } catch(err) {
    _showErrorScreen(err);
  }
});

// Retry button on error screen
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('error-retry-btn')?.addEventListener('click', () => {
    location.reload();
  });
}, { once: true });

// ── Song Import System ────────────────────────────────────────────────────────
// Supports: .ogg (direct link), .flac/.wav/.mp3/.aac/.m4a (→ OGG via MediaRecorder)

let _importLastFile = null; // retained so Retry works
let _encodeStop     = null; // callable to abort in-progress OGG encoding

async function importAudioFile(file) {
  _importLastFile = file;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'ogg') {
    // Direct link — no conversion needed
    _showImportStage('Loading OGG file…', 10);
    try {
      await _linkAudioFile(file);
      _hideImportProgress();
      _flashStatus(`✓ Imported ${file.name}`);
    } catch (err) {
      _hideImportProgress();
      _showImportError(file.name, String(err));
    }
    return;
  }

  // Non-OGG: show confirmation before converting
  const ok = await _showImportConfirm(file.name, ext);
  if (!ok) return;

  // Conversion pipeline
  document.getElementById('modal-import-progress').style.display = 'flex';
  try {
    _showImportStage('Loading audio file…', 5);
    const arrayBuf = await file.arrayBuffer();

    _showImportStage('Decoding audio source…', 15);
    ensureAudioCtx();
    let decoded;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    } catch(decErr) {
      throw new Error(`Could not decode "${file.name}": ${decErr.message || decErr}`);
    }

    _showImportStage(`Encoding to OGG format… (song is ${decoded.duration.toFixed(1)}s)`, 20);
    const coffeeEl = document.getElementById('import-coffee-msg');
    if (coffeeEl) coffeeEl.style.display = 'block';

    const oggBlob = await _encodeToOgg(decoded);

    if (coffeeEl) coffeeEl.style.display = 'none';

    // Auto-download the converted OGG so the user always has the file.
    const newName = file.name.replace(/\.[^.]+$/, '.ogg');
    try {
      const dlUrl  = URL.createObjectURL(oggBlob);
      const dlLink = document.createElement('a');
      dlLink.href     = dlUrl;
      dlLink.download = newName;
      dlLink.click();
      setTimeout(() => URL.revokeObjectURL(dlUrl), 10000);
    } catch (_) { /* download is best-effort */ }

    _showImportStage('Finalizing and linking to project…', 95);
    const oggFile = new File([oggBlob], newName, { type: oggBlob.type });
    await _linkAudioFile(oggFile, decoded);

    _hideImportProgress();
    _flashStatus(`✓ Imported & converted ${newName} — check your Downloads folder`);
  } catch (err) {
    const coffeeEl = document.getElementById('import-coffee-msg');
    if (coffeeEl) coffeeEl.style.display = 'none';
    _hideImportProgress();
    if (err.message === 'Import cancelled') return; // user cancelled — no error modal
    _showImportError(file.name, err.message || String(err));
  }
}

// Show the format-conversion confirmation modal, returns Promise<boolean>
function _showImportConfirm(filename, fromExt) {
  return new Promise(resolve => {
    const modal  = document.getElementById('modal-import-confirm');
    const msgEl  = document.getElementById('import-confirm-msg');
    const btnOk  = document.getElementById('import-confirm-ok');
    const btnNo  = document.getElementById('import-confirm-cancel');

    msgEl.textContent =
      `"${filename}" is a ${fromExt.toUpperCase()} file. ` +
      `vibe-editr will convert it to OGG/Opus format so it works with the chart engine. ` +
      `The original file will not be changed.`;
    modal.style.display = 'flex';

    const ok = () => { cleanup(); modal.style.display = 'none'; resolve(true);  };
    const no = () => { cleanup(); modal.style.display = 'none'; resolve(false); };
    const cleanup = () => {
      btnOk.removeEventListener('click', ok);
      btnNo.removeEventListener('click', no);
    };
    btnOk.addEventListener('click', ok);
    btnNo.addEventListener('click', no);
  });
}

// Encode a decoded AudioBuffer to OGG (Opus or WebM Opus) via MediaRecorder.
// Sets _encodeStop to a callable that aborts encoding and rejects the promise.
function _encodeToOgg(decoded) {
  return new Promise((resolve, reject) => {
    const mimeTypes = [
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
    const mime = mimeTypes.find(m => {
      try { return MediaRecorder.isTypeSupported(m); } catch(_) { return false; }
    }) || 'audio/webm';

    // Play decoded buffer through a MediaStreamDestination → capture with MediaRecorder
    const encCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest   = encCtx.createMediaStreamDestination();
    const src    = encCtx.createBufferSource();
    src.buffer   = decoded;
    src.connect(dest);

    // AudioContext.close() returns a Promise that REJECTS if the context is
    // already closed. Always guard by state and swallow the rejection so it
    // doesn't surface as an unhandled-rejection in the error log.
    const _closeEnc = () => {
      if (!encCtx || encCtx.state === 'closed') return;
      try { encCtx.close().catch(() => {}); } catch(_) {}
    };

    let recorder;
    try {
      recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    } catch (e) {
      _closeEnc();
      reject(new Error('MediaRecorder not supported in this browser: ' + e.message));
      return;
    }

    const chunks   = [];
    const startMs  = performance.now();
    const totalSec = decoded.duration;
    let cancelled  = false;

    // Expose abort hook so the Cancel button can stop encoding mid-flight
    _encodeStop = () => {
      cancelled = true;
      clearInterval(progressTimer);
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch(_) {}
      try { src.disconnect(); } catch(_) {}
      _closeEnc();
      _encodeStop = null;
      reject(new Error('Import cancelled'));
    };

    // Progress update during real-time encoding
    const progressTimer = setInterval(() => {
      const elapsed = (performance.now() - startMs) / 1000;
      const pct = Math.min(92, 20 + Math.round((elapsed / totalSec) * 72));
      const rem = Math.max(0, Math.round(totalSec - elapsed));
      _showImportStage(`Encoding to OGG… (~${rem}s remaining)`, pct);
    }, 400);

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(progressTimer);
      _encodeStop = null;
      _closeEnc();
      if (cancelled) return; // reject already called by _encodeStop
      if (chunks.length === 0) { reject(new Error('MediaRecorder produced no data.')); return; }
      resolve(new Blob(chunks, { type: mime }));
    };
    recorder.onerror = e => {
      clearInterval(progressTimer);
      _encodeStop = null;
      _closeEnc();
      if (cancelled) return;
      reject(e.error || new Error('MediaRecorder error'));
    };

    recorder.start(250); // collect chunks every 250 ms
    src.start(0);
    src.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };

    // Safety: stop after duration + 4s buffer
    setTimeout(() => {
      if (!cancelled && recorder.state !== 'inactive') recorder.stop();
    }, (totalSec + 4) * 1000);
  });
}

// Link a file (OGG or converted Blob) to the chart
async function _linkAudioFile(file, decodedBuffer = null) {
  // Update metadata fields
  document.getElementById('meta-music').value = file.name;
  syncMetaToChart();

  // Load audio buffer
  if (decodedBuffer) {
    audioBuffer = decodedBuffer;
    // decodedBuffer already in memory; raw bytes were set by the caller's arrayBuffer() call
  } else {
    ensureAudioCtx();
    const ab = await file.arrayBuffer();
    audioArrayBuffer = ab.slice(0); // preserve before decodeAudioData may transfer ownership
    audioBuffer = await audioCtx.decodeAudioData(ab);
  }
  tabs.forEach(t => { t.audioBuffer = audioBuffer; });
  document.getElementById('audio-status').textContent = `Audio: ${file.name}`;
  window.dispatchEvent(new CustomEvent('vibe:audio-ready', { detail: { buffer: audioBuffer } }));
  _idbAutosave();
}

// Progress modal helpers
function _showImportStage(msg, pct) {
  const lbl = document.getElementById('import-stage-label');
  const bar = document.getElementById('import-progress-bar');
  const pct2 = document.getElementById('import-progress-pct');
  if (lbl) lbl.textContent = msg;
  if (bar) bar.style.width = pct + '%';
  if (pct2) pct2.textContent = pct + '%';
}

function _hideImportProgress() {
  document.getElementById('modal-import-progress').style.display = 'none';
  _showImportStage('', 0);
}

function _showImportError(filename, reason) {
  document.getElementById('import-error-file').textContent = `File: ${filename}`;
  document.getElementById('import-error-msg').textContent  = reason;
  document.getElementById('modal-import-error').style.display = 'flex';

  // Wire Retry button (replace each time to avoid stale listeners)
  const retryBtn  = document.getElementById('import-error-retry');
  const chooseBtn = document.getElementById('import-error-choose');
  const newRetry  = retryBtn.cloneNode(true);
  const newChoose = chooseBtn.cloneNode(true);
  retryBtn.replaceWith(newRetry);
  chooseBtn.replaceWith(newChoose);

  newRetry.addEventListener('click', async () => {
    document.getElementById('modal-import-error').style.display = 'none';
    if (_importLastFile) await importAudioFile(_importLastFile);
  });
  newChoose.addEventListener('click', () => {
    document.getElementById('modal-import-error').style.display = 'none';
    document.getElementById('audio-import-input').click();
  });
}

function _flashStatus(msg) {
  const st = document.getElementById('audio-status');
  if (!st) return;
  const prev = st.textContent;
  st.textContent = msg;
  setTimeout(() => { st.textContent = prev; }, 3000);
}

// ── FX Hover Tooltip ──────────────────────────────────────────────────────────
const FX_EFFECT_OPTIONS = [
  { value: 'none',        label: 'None'       },
  { value: 'retrigger',   label: 'Retrigger'  },
  { value: 'gate',        label: 'Gate'       },
  { value: 'flanger',     label: 'Flanger'    },
  { value: 'pitchshift',  label: 'PitchShift' },
  { value: 'bitcrusher',  label: 'BitCrusher' },
  { value: 'phaser',      label: 'Phaser'     },
  { value: 'wobble',      label: 'Wobble'     },
  { value: 'tapestop',    label: 'TapeStop'   },
  { value: 'echo',        label: 'Echo'       },
  { value: 'sidechain',   label: 'SideChain'  },
];

let fxTooltipEl   = null;
let fxTooltipNote = null;

function ensureFxTooltip() {
  if (fxTooltipEl) return;
  fxTooltipEl = document.createElement('div');
  fxTooltipEl.className = 'fx-tooltip';
  document.body.appendChild(fxTooltipEl);
  fxTooltipEl.addEventListener('mouseleave', hideFxTooltip);
}

let _fxHoverTimer = null;
let _fxPinned = false;
let _fxHoverNote = null; // tracks which note the timer is currently counting for

function showFxTooltip(clientX, clientY, note, lane) {
  ensureFxTooltip();
  if (_fxPinned) return;
  if (_fxHoverNote === note) return; // already counting for this note, don't reset timer
  clearTimeout(_fxHoverTimer);
  _fxHoverNote = note;
  _fxHoverTimer = setTimeout(() => {
    _fxHoverNote = null;
    _doShowFxTooltip(clientX, clientY, note, lane);
  }, 300);
}

function _doShowFxTooltip(clientX, clientY, note, lane) {
  ensureFxTooltip();
  fxTooltipNote = note;
  _fxPinned = true;
  _fxHoverNote = null;

  const current  = note.effect || '';
  const laneName = lane === 0 ? 'FX-L' : 'FX-R';

  const typeOpts = `<option value=""${!current ? ' selected' : ''}>None</option>` +
    Object.entries(EFFECT_DEFS).map(([k, d]) =>
      `<option value="${k}"${k === current ? ' selected' : ''}>${d.label}</option>`
    ).join('');

  fxTooltipEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <span class="fx-tt-label">${laneName}</span>
      <div class="fx-tt-close" title="Close" style="cursor:pointer;padding:0 2px;color:#888">✕</div>
    </div>
    <div style="margin-bottom:6px">
      <select class="fx-tt-type-sel"
        style="width:100%;background:#111;border:1px solid #444;color:#ddd;border-radius:3px;padding:2px 4px;font-size:11px">
        ${typeOpts}
      </select>
    </div>
    <div class="fx-tt-params"></div>
  `;

  function _buildParams(typeKey) {
    const container = fxTooltipEl.querySelector('.fx-tt-params');
    if (!container) return;
    const def = EFFECT_DEFS[typeKey];
    if (!def) { container.innerHTML = ''; return; }
    let html = '';
    for (const [k, p] of Object.entries(def.params)) {
      const val = note.effectParams?.[k] ?? p.def;
      html += `
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
          <span style="min-width:68px;font-size:10px;color:#aaa">${p.label}</span>
          <input type="range" class="fx-tt-sl" data-key="${k}"
            min="${p.min}" max="${p.max}" step="${p.step}" value="${val}"
            style="flex:1;accent-color:#ff8800;height:14px">
          <input type="number" class="fx-tt-num" data-key="${k}"
            min="${p.min}" max="${p.max}" step="${p.step}" value="${val}"
            style="width:46px;background:#111;border:1px solid #333;border-radius:3px;color:#ddd;padding:1px 3px;font-size:10px">
          <span style="min-width:20px;font-size:9px;color:#666">${p.unit || ''}</span>
        </div>`;
    }
    container.innerHTML = html;
    container.querySelectorAll('.fx-tt-sl').forEach(sl => {
      sl.addEventListener('input', () => {
        if (!fxTooltipNote) return;
        if (!fxTooltipNote.effectParams) fxTooltipNote.effectParams = {};
        fxTooltipNote.effectParams[sl.dataset.key] = parseFloat(sl.value);
        const num = container.querySelector(`.fx-tt-num[data-key="${sl.dataset.key}"]`);
        if (num) num.value = sl.value;
      });
    });
    container.querySelectorAll('.fx-tt-num').forEach(ni => {
      ni.addEventListener('input', () => {
        if (!fxTooltipNote) return;
        if (!fxTooltipNote.effectParams) fxTooltipNote.effectParams = {};
        fxTooltipNote.effectParams[ni.dataset.key] = parseFloat(ni.value);
        const sl = container.querySelector(`.fx-tt-sl[data-key="${ni.dataset.key}"]`);
        if (sl) sl.value = ni.value;
      });
    });
  }

  _buildParams(current);

  fxTooltipEl.querySelector('.fx-tt-type-sel')?.addEventListener('change', ev => {
    if (!fxTooltipNote) return;
    fxTooltipNote.effect = ev.target.value || null;
    _buildParams(ev.target.value);
    render();
  });

  fxTooltipEl.querySelector('.fx-tt-close')?.addEventListener('click', () => {
    _fxPinned = false;
    _fxHoverNote = null;
    hideFxTooltip();
  });

  fxTooltipEl.style.display = 'block';
  requestAnimationFrame(() => {
    const tw = fxTooltipEl.offsetWidth, th = fxTooltipEl.offsetHeight;
    fxTooltipEl.style.left = Math.min(clientX + 14, window.innerWidth  - tw - 8) + 'px';
    fxTooltipEl.style.top  = Math.min(clientY - 10, window.innerHeight - th - 8) + 'px';
  });
}

function hideFxTooltip() {
  if (_fxPinned) return;
  clearTimeout(_fxHoverTimer);
  _fxHoverNote = null;
  if (fxTooltipEl) fxTooltipEl.style.display = 'none';
  fxTooltipNote = null;
}

function checkFxHover(e) {
  if (_fxPinned) return; // tooltip is pinned, don't interfere
  const h = getHit(e);
  const { tick, laneIdx } = h;
  if (laneIdx < 0 || laneIdx > 3) { clearTimeout(_fxHoverTimer); hideFxTooltip(); return; }
  const fxLane = laneIdx <= 1 ? 0 : 1;
  const note = chart.fx[fxLane].find(n => tick >= n.y && tick <= n.y + Math.max(n.len, 1));
  if (!note) { clearTimeout(_fxHoverTimer); hideFxTooltip(); return; }
  showFxTooltip(e.clientX, e.clientY, note, fxLane);
}

// ── Tool ──────────────────────────────────────────────────────────────────────
function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const toolHints = { 'laser-l': 'VOL-L  [Shift+drag = freehand]', 'laser-r': 'VOL-R  [Shift+drag = freehand]' };
  document.getElementById('status-tool').textContent = 'Tool: ' + (toolHints[t] ?? t);
  // Show laser anchor dots only when a laser tool is active (edit layer gate)
  if (renderer) {
    renderer.showLaserDots = (t === 'laser-l' || t === 'laser-r');
    if (!renderer.showLaserDots) {
      renderer.activeLaserSec     = null;
      renderer.selectedLaserPoint = null;
      renderer._laserPreview      = null;
      _laserSel = null;
    }
  }
  // Finish any in-progress pen-tool laser section when switching tools
  if (_activeLaserSec) {
    _activeLaserSec = null;
    if (renderer) { renderer.activeLaserSec = null; renderer._laserPreview = null; }
  }
  // Cancel any in-progress freehand draw when switching tools
  if (drag.freehand) {
    drag.freehand    = false;
    drag.freehandPts = [];
    if (renderer) renderer.freehandPreviewPts = null;
  }
  // Show/hide cam-event subpanel
  const camSub = document.getElementById('cam-subpanel');
  if (camSub) camSub.classList.toggle('visible', t === 'cam-event');
  // Update context palette (dock.js)
  if (typeof updateContextPalette === 'function') updateContextPalette(t);
  syncLaserXSnapUI();
  // Redraw the chart so laser anchor dots (which are gated on showLaserDots)
  // appear/disappear immediately when switching tools instead of waiting for
  // the next mouse move on the canvas.
  render();
}

let _renderScheduled = false;
export function render() {
  autoDetectMeasures();
  checkLaserOverlap();
  if (playing) {
    // During playback, draw immediately (we're already inside a RAF from playFrame)
    renderer?.draw();
    renderer?.drawSelection(sel);
    return;
  }
  // Outside playback, coalesce rapid calls into one RAF frame
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    renderer?.draw();
    renderer?.drawSelection(sel);
    // Annotation overlay (warn/error markers from tools)
    _pruneAnnotations();
    renderer?.drawAnnotations(_chartAnnotations, _annAlpha);
    // Keep the SDVX preview in sync with every chart edit
    if (gameView && viewMode !== 'edit') gameView.draw();
    // Multi-chart preview
    if (_multiMode) { _multiSyncSettings(); _multiDraw(); }
    // Update pattern radar and intensity heatmap (live, no-op if windows are hidden)
    if (typeof updateRadar     === 'function') updateRadar();
    if (typeof updateHeatmap   === 'function') updateHeatmap();
    if (typeof invalidateFxAuto === 'function') invalidateFxAuto();
    _drawMinimap();
  });
}
function snapTick(t) {
  if (!snap) {
    // Free mode — still check transient attraction
    if (prefs.snapToTransients && window._audioTransientTicks?.length) {
      let nearest = null, nearestDist = Infinity;
      for (const tt of window._audioTransientTicks) {
        const d = Math.abs(tt - t);
        if (d < nearestDist) { nearestDist = d; nearest = tt; }
      }
      if (nearestDist <= 12) return nearest;
    }
    return Math.round(t);
  }
  const gridSnapped = Math.round(Math.round(t / snap) * snap);
  if (prefs.snapToTransients && window._audioTransientTicks?.length) {
    const attract = Math.max(snap * 0.5, 6);
    let nearest = null, nearestDist = Infinity;
    for (const tt of window._audioTransientTicks) {
      const d = Math.abs(tt - t);
      if (d < nearestDist) { nearestDist = d; nearest = tt; }
    }
    if (nearest !== null && nearestDist <= attract) return nearest;
  }
  return gridSnapped;
}

// ── Selection helpers ─────────────────────────────────────────────────────────
function selTickRange() {
  const lo = Math.min(sel.startTick, sel.endTick);
  const hi = Math.max(sel.startTick, sel.endTick);
  return [lo, hi];
}

function selCopy() {
  if (!sel.active) return;
  const [lo, hi] = selTickRange();
  sel.clipboard = {
    bt:     chart.bt.map(l   => l.filter(n => n.y >= lo && n.y <= hi).map(n => ({...n, y: n.y - lo}))),
    fx:     chart.fx.map(l   => l.filter(n => n.y >= lo && n.y <= hi).map(n => ({...n, y: n.y - lo}))),
    lasers: chart.lasers.map(arr => arr.filter(s => s.y >= lo && s.y <= hi).map(s => ({...s, y: s.y - lo, points: s.points.map(p => ({...p}))}))),
    vel:    (chart.scrollSpeedEvents ?? []).filter(e => e.y >= lo && e.y <= hi).map(e => ({...e, y: e.y - lo})),
    glitch: (chart.glitchEvents ?? []).filter(e => e.y >= lo && e.y <= hi).map(e => ({...e, y: e.y - lo})),
    dur: hi - lo,
  };
}

function selCut() {
  if (!sel.active) return;
  selCopy();
  const [lo, hi] = selTickRange();
  saveUndo('Cut Selection');
  for (let li = 0; li < 4; li++) chart.bt[li] = chart.bt[li].filter(n => !(n.y >= lo && n.y <= hi));
  for (let li = 0; li < 2; li++) chart.fx[li] = chart.fx[li].filter(n => !(n.y >= lo && n.y <= hi));
  for (let s  = 0; s  < 2; s++)  chart.lasers[s] = chart.lasers[s].filter(sec => !(sec.y >= lo && sec.y <= hi));
  sel.active = false; render();
}

// Like selCut() but doesn't touch the clipboard. Bound to plain Backspace
// while a selection is active. Leaves the surrounding chart unshifted (no
// ripple); use Shift+Backspace / Shift+Delete for ripple-delete.
function selDeleteContents() {
  if (!sel.active) return;
  const [lo, hi] = selTickRange();
  saveUndo('Deleted Selection');
  for (let li = 0; li < 4; li++) chart.bt[li] = chart.bt[li].filter(n => !(n.y >= lo && n.y <= hi));
  for (let li = 0; li < 2; li++) chart.fx[li] = chart.fx[li].filter(n => !(n.y >= lo && n.y <= hi));
  for (let s  = 0; s  < 2; s++)  chart.lasers[s] = chart.lasers[s].filter(sec => !(sec.y >= lo && sec.y <= hi));
  render();
}

// Cmd+T "Free Transform" for a selection: prompt for a stretch factor, then
// scale every note/laser inside the range around the selection's start. The
// selection range itself is rescaled too so subsequent edits keep working
// on the same notes.
function selTransform() {
  if (!sel.active) return;
  const [lo, hi] = selTickRange();
  const oldDur = hi - lo;
  if (oldDur <= 0) return;
  const raw = prompt(
    `Transform selection (× factor)\n\n` +
    `  >1  stretches the region (slows it down)\n` +
    `  <1  pulls it inward (speeds it up)\n\n` +
    `Current duration: ${oldDur} ticks`,
    '1.0'
  );
  if (raw === null) return;
  const factor = Number(raw);
  if (!Number.isFinite(factor) || factor <= 0) {
    alert('Invalid factor: must be a positive number.');
    return;
  }
  selAdjustSpeed(factor);
  // Extend the selection range to cover the new stretched region.
  sel.endTick = lo + Math.round(oldDur * factor);
  updateSelStatus?.();
}

function selPaste() {
  if (!sel.clipboard) return;
  saveUndo('Pasted Notes');
  const at = snapTick(sel.active ? Math.min(sel.startTick, sel.endTick) : renderer.playTick);
  const { bt, fx, lasers, vel = [], glitch = [] } = sel.clipboard;
  for (let li = 0; li < 4; li++) bt[li].forEach(n => chart.addBtNote(li, at + n.y, n.len));
  for (let li = 0; li < 2; li++) fx[li].forEach(n => chart.addFxNote(li, at + n.y, n.len));
  for (let s = 0; s < 2; s++) {
    lasers[s].forEach(sec => {
      chart.lasers[s].push({ y: at + sec.y, points: sec.points.map(p => ({...p})), wide: sec.wide });
    });
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  vel.forEach(ev => chart.addScrollSpeedEvent(at + ev.y, ev.speed, ev.interp ?? 'step'));
  glitch.forEach(ev => chart.addGlitchEvent(at + ev.y, ev.level));
  if (vel.length) updateScrollSpeedEventList();
  if (glitch.length) { updateGlitchEventList(); _glitchAppliedLevel = -1; _updateGlitchFromTick(renderer?.playTick ?? 0); }
  render();
}

// v0.0.21: Paste clipboard at an explicit target tick (section-relative paste).
function selPasteAtTick(targetTick) {
  if (!sel.clipboard) return;
  saveUndo('Pasted at Section');
  const at = Math.max(0, Math.round(targetTick));
  const { bt, fx, lasers, vel = [], glitch = [] } = sel.clipboard;
  for (let li = 0; li < 4; li++) bt[li].forEach(n => chart.addBtNote(li, at + n.y, n.len));
  for (let li = 0; li < 2; li++) fx[li].forEach(n => chart.addFxNote(li, at + n.y, n.len));
  for (let s = 0; s < 2; s++) {
    lasers[s].forEach(sec => {
      chart.lasers[s].push({ y: at + sec.y, points: sec.points.map(p => ({...p})), wide: sec.wide });
    });
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  vel.forEach(ev => chart.addScrollSpeedEvent(at + ev.y, ev.speed, ev.interp ?? 'step'));
  glitch.forEach(ev => chart.addGlitchEvent(at + ev.y, ev.level));
  if (vel.length) updateScrollSpeedEventList();
  if (glitch.length) { updateGlitchEventList(); _glitchAppliedLevel = -1; _updateGlitchFromTick(renderer?.playTick ?? 0); }
  render();
}

function selMirror(what) {
  if (!sel.active) return;
  saveUndo(`Mirrored ${what.toUpperCase()}`);
  const [lo, hi] = selTickRange();
  const inSel = y => y >= lo && y <= hi;

  if (what === 'all' || what === 'bt') {
    const snap0 = chart.bt[0].filter(n => inSel(n.y)), snap3 = chart.bt[3].filter(n => inSel(n.y));
    const snap1 = chart.bt[1].filter(n => inSel(n.y)), snap2 = chart.bt[2].filter(n => inSel(n.y));
    chart.bt[0] = [...chart.bt[0].filter(n => !inSel(n.y)), ...snap3];
    chart.bt[1] = [...chart.bt[1].filter(n => !inSel(n.y)), ...snap2];
    chart.bt[2] = [...chart.bt[2].filter(n => !inSel(n.y)), ...snap1];
    chart.bt[3] = [...chart.bt[3].filter(n => !inSel(n.y)), ...snap0];
    for (let li = 0; li < 4; li++) chart.bt[li].sort((a, b) => a.y - b.y);
  }
  if (what === 'all' || what === 'fx') {
    const snapL = chart.fx[0].filter(n => inSel(n.y)), snapR = chart.fx[1].filter(n => inSel(n.y));
    chart.fx[0] = [...chart.fx[0].filter(n => !inSel(n.y)), ...snapR];
    chart.fx[1] = [...chart.fx[1].filter(n => !inSel(n.y)), ...snapL];
    for (let li = 0; li < 2; li++) chart.fx[li].sort((a, b) => a.y - b.y);
  }
  if (what === 'all' || what === 'vol') {
    const flipPts = s => ({ ...s, points: s.points.map(p => ({ ...p, v: 1 - p.v })) });
    const snapLL = chart.lasers[0].filter(s => inSel(s.y)).map(flipPts);
    const snapRL = chart.lasers[1].filter(s => inSel(s.y)).map(flipPts);
    chart.lasers[0] = [...chart.lasers[0].filter(s => !inSel(s.y)), ...snapRL];
    chart.lasers[1] = [...chart.lasers[1].filter(s => !inSel(s.y)), ...snapLL];
    for (let s = 0; s < 2; s++) chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  updateTimeSigList();
  render();
}

function selTemporalMirror(what) {
  if (!sel.active) return;
  saveUndo(`Temporal Mirror ${what.toUpperCase()}`);
  const [lo, hi] = selTickRange();
  const span = hi - lo;

  // reflect a note's y around the selection midpoint, accounting for its length
  const reflectNote = n => ({ ...n, y: lo + (span - (n.y - lo) - n.len) });

  if (what === 'all' || what === 'bt') {
    for (let li = 0; li < 4; li++) {
      const inside = chart.bt[li].filter(n => n.y >= lo && n.y < hi);
      const outside = chart.bt[li].filter(n => n.y < lo || n.y >= hi);
      chart.bt[li] = [...outside, ...inside.map(reflectNote)];
      chart.bt[li].sort((a, b) => a.y - b.y);
    }
  }
  if (what === 'all' || what === 'fx') {
    for (let li = 0; li < 2; li++) {
      const inside = chart.fx[li].filter(n => n.y >= lo && n.y < hi);
      const outside = chart.fx[li].filter(n => n.y < lo || n.y >= hi);
      chart.fx[li] = [...outside, ...inside.map(reflectNote)];
      chart.fx[li].sort((a, b) => a.y - b.y);
    }
  }
  if (what === 'all' || what === 'vol') {
    for (let s = 0; s < 2; s++) {
      const inside = chart.lasers[s].filter(sec => sec.y >= lo && sec.y < hi);
      const outside = chart.lasers[s].filter(sec => sec.y < lo || sec.y >= hi);
      const reflected = inside.map(sec => {
        const secEnd = sec.y + (sec.points.length > 0 ? sec.points[sec.points.length-1].ry : 0);
        const newY = lo + (hi - secEnd);
        const newPts = [...sec.points].reverse().map((p, i, arr) => {
          const origRy = arr[arr.length - 1 - i].ry;
          const nextRy = i < arr.length - 1 ? arr[arr.length - 2 - i].ry : origRy;
          return { ...p, ry: sec.points[sec.points.length - 1].ry - p.ry };
        });
        return { ...sec, y: Math.max(lo, newY), points: newPts };
      });
      chart.lasers[s] = [...outside, ...reflected];
      chart.lasers[s].sort((a, b) => a.y - b.y);
    }
  }
  render();
}

// Swap VOL-L and VOL-R sections within the selection (or entire chart if no
// active selection). Unlike Mirror VOL, positions are not flipped — only the
// channel assignment changes so that left-knob patterns become right-knob and
// vice versa.
function selSwapLasers() {
  saveUndo('Swap VOL-L ↔ VOL-R');

  let lo = 0, hi = Infinity;
  if (sel.active) {
    [lo, hi] = selTickRange();
  }
  const inRange = y => y >= lo && y <= hi;

  const snapL = chart.lasers[0].filter(s => inRange(s.y));
  const snapR = chart.lasers[1].filter(s => inRange(s.y));

  chart.lasers[0] = [...chart.lasers[0].filter(s => !inRange(s.y)), ...snapR];
  chart.lasers[1] = [...chart.lasers[1].filter(s => !inRange(s.y)), ...snapL];
  chart.lasers[0].sort((a, b) => a.y - b.y);
  chart.lasers[1].sort((a, b) => a.y - b.y);

  updateTimeSigList();
  render();
}

function selAdjustSpeed(factor) {
  // factor > 1 = compress (2x speed = notes take half as many ticks)
  // factor < 1 = expand  (0.5x speed = notes take twice as many ticks)
  if (!sel.active) return;
  saveUndo(`Adjusted Speed ×${factor}`);
  const [lo, hi] = selTickRange();
  const oldDur = hi - lo;
  const newDur = Math.round(oldDur * factor);
  const delta  = newDur - oldDur;

  const scaleY = y => {
    if (y < lo) return y;
    if (y >= hi) return y + delta;
    return lo + Math.round((y - lo) * factor);
  };

  for (let li = 0; li < 4; li++) {
    chart.bt[li] = chart.bt[li].map(n => ({ ...n, y: scaleY(n.y), len: n.len > 0 ? Math.round(n.len * factor) : 0 }));
    chart.bt[li].sort((a, b) => a.y - b.y);
  }
  for (let li = 0; li < 2; li++) {
    chart.fx[li] = chart.fx[li].map(n => ({ ...n, y: scaleY(n.y), len: n.len > 0 ? Math.round(n.len * factor) : 0 }));
    chart.fx[li].sort((a, b) => a.y - b.y);
  }
  for (let s = 0; s < 2; s++) {
    chart.lasers[s] = chart.lasers[s].map(sec => ({
      ...sec,
      y: scaleY(sec.y),
      points: sec.points.map(p => ({ ...p, ry: Math.round(p.ry * factor) })),
    }));
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  chart.bpmEvents = chart.bpmEvents.map(ev => ({ ...ev, y: scaleY(ev.y) }));
  chart.bpmEvents.sort((a, b) => a.y - b.y);

  sel.startTick = lo;
  sel.endTick   = lo + newDur;
  updateBpmList(); render();
}

// ── Ripple Delete ─────────────────────────────────────────────────────────────
// Delete everything in the selected region [lo, hi) and shift all content that
// sits AFTER hi backward by (hi − lo) ticks, closing the gap like a splice cut.
//
// Boundary handling:
//   • Notes/holds that START inside [lo, hi)         → deleted entirely
//   • Chips/holds that start before lo and end in [lo, hi)
//                                                    → hold truncated to end at lo
//   • Holds that straddle the entire region (start < lo, end > hi)
//                                                    → hold shortened by (hi-lo), tail shifted
//   • Everything that starts at tick ≥ hi            → shifted back by (hi-lo)
//   • BPM, time-sig, camera, stop events follow the same rules
function selRippleDelete() {
  if (!sel.active) return;
  const [lo, hi] = selTickRange();
  if (hi <= lo) return;
  const span = hi - lo;
  saveUndo('Ripple Delete');

  // ── BT notes ─────────────────────────────────────────────────────────────
  for (let li = 0; li < 4; li++) {
    chart.bt[li] = chart.bt[li].reduce((acc, n) => {
      const end = n.y + n.len;
      if (n.y >= hi) {
        // Entirely after region — shift
        acc.push({ ...n, y: n.y - span });
      } else if (n.y >= lo) {
        // Starts inside region — delete
      } else if (end <= lo) {
        // Entirely before region — keep
        acc.push(n);
      } else if (end <= hi) {
        // Starts before, ends inside — truncate hold at lo
        acc.push({ ...n, len: lo - n.y });
      } else {
        // Straddles entire region — shorten by span, tail shifts
        acc.push({ ...n, len: n.len - span });
      }
      return acc;
    }, []);
    chart.bt[li].sort((a, b) => a.y - b.y);
  }

  // ── FX notes ─────────────────────────────────────────────────────────────
  for (let li = 0; li < 2; li++) {
    chart.fx[li] = chart.fx[li].reduce((acc, n) => {
      const end = n.y + n.len;
      if (n.y >= hi) {
        acc.push({ ...n, y: n.y - span });
      } else if (n.y >= lo) {
        // Inside — delete
      } else if (end <= lo) {
        acc.push(n);
      } else if (end <= hi) {
        acc.push({ ...n, len: lo - n.y });
      } else {
        acc.push({ ...n, len: n.len - span });
      }
      return acc;
    }, []);
    chart.fx[li].sort((a, b) => a.y - b.y);
  }

  // ── Laser sections ────────────────────────────────────────────────────────
  for (let s = 0; s < 2; s++) {
    chart.lasers[s] = chart.lasers[s].reduce((acc, sec) => {
      const lastPt  = sec.points[sec.points.length - 1];
      const secEnd  = sec.y + (lastPt?.ry ?? 0);

      if (sec.y >= hi) {
        // Entirely after — shift
        acc.push({ ...sec, y: sec.y - span });
      } else if (sec.y >= lo) {
        // Starts inside — delete
      } else if (secEnd <= lo) {
        // Entirely before — keep
        acc.push(sec);
      } else {
        // Starts before lo — overlaps the cut boundary.
        const baseY = sec.y;
        const cutRy = lo - baseY;  // relative tick at the lo boundary

        // ── Helper: interpolate laser v at a given relative tick ───────────
        const interpV = (ry) => {
          const pb = [...sec.points].reverse().find(p => p.ry <= ry);
          const pa = sec.points.find(p => p.ry > ry);
          if (pb && pa) return pb.v + (ry - pb.ry) / (pa.ry - pb.ry) * (pa.v - pb.v);
          return pb?.v ?? pa?.v ?? 0;
        };

        // ── Head: keep all points before the cut, cap at lo ───────────────
        const headPts = sec.points.filter(p => p.ry < cutRy);
        headPts.push({ ry: cutRy, v: interpV(cutRy) });
        if (headPts.length >= 2) acc.push({ ...sec, points: headPts });

        // ── Tail: section extends past hi — emit a new section from lo ────
        if (secEnd > hi) {
          const hiRy    = hi - baseY;
          const tailV0  = interpV(hiRy);
          // All points with ry > hiRy, re-based relative to the new section start (lo)
          const tailPts = sec.points
            .filter(p => p.ry > hiRy)
            .map(p => ({ ...p, ry: p.ry - hiRy }));
          if (tailPts.length >= 1) {
            acc.push({ ...sec, y: lo, points: [{ ry: 0, v: tailV0 }, ...tailPts] });
          }
        }
      }
      return acc;
    }, []);
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }

  // ── BPM events ────────────────────────────────────────────────────────────
  // Delete BPM changes inside the region; shift those after hi.
  // The BPM that was active at lo is still in effect via the event before lo,
  // so no sentinel needs to be re-inserted.
  chart.bpmEvents = chart.bpmEvents.reduce((acc, ev) => {
    if (ev.y < lo)        acc.push(ev);
    else if (ev.y < hi) { /* delete */ }
    else                  acc.push({ ...ev, y: ev.y - span });
    return acc;
  }, []);
  chart.bpmEvents.sort((a, b) => a.y - b.y);

  // ── Time-sig events ───────────────────────────────────────────────────────
  // timeSigEvents use { measure, num, den } — convert to ticks for comparison,
  // then shift measure index (not a raw tick) when moving events past the cut.
  if (chart.timeSigEvents?.length) {
    chart.timeSigEvents = chart.timeSigEvents.reduce((acc, ev) => {
      const evTick = ev.measure * TICKS_PER_MEASURE;
      if (evTick < lo)        acc.push(ev);
      else if (evTick < hi) { /* delete — inside cut region */ }
      else                    acc.push({ ...ev, measure: ev.measure - Math.round(span / TICKS_PER_MEASURE) });
      return acc;
    }, []);
    chart.timeSigEvents.sort((a, b) => a.measure - b.measure);
  }

  // ── Camera events ─────────────────────────────────────────────────────────
  if (chart.cameraEvents?.length) {
    chart.cameraEvents = chart.cameraEvents.reduce((acc, ev) => {
      if (ev.y < lo)        acc.push(ev);
      else if (ev.y < hi) { /* delete */ }
      else                  acc.push({ ...ev, y: ev.y - span });
      return acc;
    }, []);
    chart.cameraEvents.sort((a, b) => a.y - b.y);
  }

  // ── Stop events ───────────────────────────────────────────────────────────
  if (chart.stopEvents?.length) {
    chart.stopEvents = chart.stopEvents.reduce((acc, ev) => {
      if (ev.y < lo)        acc.push(ev);
      else if (ev.y < hi) { /* delete */ }
      else                  acc.push({ ...ev, y: ev.y - span });
      return acc;
    }, []);
    chart.stopEvents.sort((a, b) => a.y - b.y);
  }

  // ── Deselect and refresh ──────────────────────────────────────────────────
  sel.active = false;
  updateBpmList?.();
  updateCameraEventList?.();
  updateStopEventList?.();
  render();
}

// ── Random ────────────────────────────────────────────────────────────────────
function selRandom(what) {
  saveUndo(`Randomized ${what.toUpperCase()}`);
  const [lo, hi] = sel.active ? selTickRange() : [0, chart.totalTicks()];

  const shuffleArr = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  if (what === 'bt' || what === 'all') {
    // Collect BT columns of notes in range, shuffle lane assignments
    const inRange = [];
    for (let li = 0; li < 4; li++) {
      for (const n of chart.bt[li]) {
        if (n.y >= lo && n.y < hi) inRange.push({ li, n });
      }
    }
    const laneMap = shuffleArr([0,1,2,3]);
    for (const { li, n } of inRange) {
      chart.bt[li] = chart.bt[li].filter(x => x !== n);
    }
    for (const { li, n } of inRange) {
      chart.bt[laneMap[li]].push({ ...n });
      chart.bt[laneMap[li]].sort((a,b) => a.y - b.y);
    }
  }

  if (what === 'fx' || what === 'all') {
    // Swap FX-L and FX-R in range randomly
    if (Math.random() < 0.5) {
      const tmp = chart.fx[0].filter(n => n.y >= lo && n.y < hi);
      const tmp2 = chart.fx[1].filter(n => n.y >= lo && n.y < hi);
      chart.fx[0] = [...chart.fx[0].filter(n => n.y < lo || n.y >= hi), ...tmp2].sort((a,b)=>a.y-b.y);
      chart.fx[1] = [...chart.fx[1].filter(n => n.y < lo || n.y >= hi), ...tmp].sort((a,b)=>a.y-b.y);
    }
  }

  if (what === 'vol' || what === 'all') {
    // VOL random: either mirror or swap sides (preserve playability)
    const choice = Math.random() < 0.5 ? 'mirror' : 'swap';
    if (choice === 'mirror') {
      for (let s = 0; s < 2; s++) {
        for (const sec of chart.lasers[s]) {
          if (sec.y < lo || sec.y >= hi) continue;
          sec.points = sec.points.map(p => ({ ...p, v: 1 - p.v }));
        }
      }
    } else {
      // Swap L and R sections that are in range
      const lInRange = chart.lasers[0].filter(s => s.y >= lo && s.y < hi);
      const rInRange = chart.lasers[1].filter(s => s.y >= lo && s.y < hi);
      chart.lasers[0] = [...chart.lasers[0].filter(s => s.y < lo || s.y >= hi),
                         ...rInRange.map(s => ({ ...s, points: s.points.map(p => ({...p, v: 1-p.v})) }))].sort((a,b)=>a.y-b.y);
      chart.lasers[1] = [...chart.lasers[1].filter(s => s.y < lo || s.y >= hi),
                         ...lInRange.map(s => ({ ...s, points: s.points.map(p => ({...p, v: 1-p.v})) }))].sort((a,b)=>a.y-b.y);
    }
  }

  render();
}

// ── S-Ran: per-note independent random lane assignment (SDVX S-Random) ────────
// Each individual note is placed on a completely random lane within its category.
// Unlike selRandom (column shuffle), notes in the same chord can end up anywhere.
function applySRan(what) {
  saveUndo(`S-Ran ${what.toUpperCase()}`);
  const [lo, hi] = sel.active ? selTickRange() : [0, chart.totalTicks()];

  if (what === 'bt' || what === 'all') {
    // Collect all BT notes in range from all lanes, clear them, reassign randomly
    const notes = [];
    for (let li = 0; li < 4; li++) {
      for (const n of chart.bt[li]) {
        if (n.y >= lo && n.y < hi) notes.push({ ...n });
      }
      chart.bt[li] = chart.bt[li].filter(n => n.y < lo || n.y >= hi);
    }
    for (const n of notes) {
      const dest = Math.floor(Math.random() * 4);
      chart.bt[dest].push(n);
      chart.bt[dest].sort((a, b) => a.y - b.y);
    }
  }

  if (what === 'fx' || what === 'all') {
    // Each FX note independently goes to a random FX lane (0 or 1)
    const notes = [];
    for (let li = 0; li < 2; li++) {
      for (const n of chart.fx[li]) {
        if (n.y >= lo && n.y < hi) notes.push({ ...n });
      }
      chart.fx[li] = chart.fx[li].filter(n => n.y < lo || n.y >= hi);
    }
    for (const n of notes) {
      const dest = Math.floor(Math.random() * 2);
      chart.fx[dest].push(n);
      chart.fx[dest].sort((a, b) => a.y - b.y);
    }
  }

  if (what === 'vol' || what === 'all') {
    // Each VOL section independently assigned to L or R (preserving laser values)
    const sections = [];
    for (let s = 0; s < 2; s++) {
      for (const sec of chart.lasers[s]) {
        if (sec.y >= lo && sec.y < hi) sections.push({ sec: { ...sec, points: sec.points.map(p => ({ ...p })) }, src: s });
      }
      chart.lasers[s] = chart.lasers[s].filter(sec => sec.y < lo || sec.y >= hi);
    }
    for (const { sec } of sections) {
      const dest = Math.floor(Math.random() * 2);
      // Mirror position values when moving from one side to the other (so laser stays playable)
      chart.lasers[dest].push(sec);
      chart.lasers[dest].sort((a, b) => a.y - b.y);
    }
  }

  render();
}

// ── VOL overlap detection ─────────────────────────────────────────────────────
function checkLaserOverlap() {
  for (let side = 0; side < 2; side++) {
    const secs = chart.lasers[side];
    const toRemove = new Set();
    for (let i = 0; i < secs.length; i++) {
      const a = secs[i];
      const aEnd = a.y + (a.points[a.points.length - 1]?.ry ?? 0);
      for (let j = i + 1; j < secs.length; j++) {
        const b = secs[j];
        if (b.y > aEnd) break; // sorted by y, no more overlap possible
        if (b.y < aEnd) {
          // Overlap detected — flash red on renderer then remove later section
          toRemove.add(j);
          renderer?.flashLaserOverlap?.(side, b.y);
        }
      }
    }
    // Remove in reverse order to keep indices valid
    Array.from(toRemove).sort((a,b)=>b-a).forEach(idx => secs.splice(idx,1));
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
let ctxMenuEl = null;
// Tick of the click that most recently opened the context menu. Used so
// "Add BPM Change…" / "Add Time Sig…" can pre-fill the modal with the
// measure + beat under the right-click instead of defaulting to 1:1.
let _ctxMenuTick = 0;

function openBpmModalAtCtx() {
  const m = Math.floor(_ctxMenuTick / TICKS_PER_MEASURE) + 1;
  const b = Math.floor((_ctxMenuTick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
  const elM = document.getElementById('bpm-ev-measure');
  const elB = document.getElementById('bpm-ev-beat');
  const elV = document.getElementById('bpm-ev-value');
  if (elM) elM.value = m;
  if (elB) elB.value = b;
  if (elV && chart?.getBpmAt) elV.value = Number(chart.getBpmAt(_ctxMenuTick).toFixed(2));
  document.getElementById('modal-bpm').style.display = 'flex';
}

function openTimesigModalAtCtx() {
  const m = Math.floor(_ctxMenuTick / TICKS_PER_MEASURE) + 1;
  const elM = document.getElementById('ts-ev-measure');
  if (elM) elM.value = m;
  document.getElementById('modal-timesig').style.display = 'flex';
}

function openScrollSpeedModalAtCtx() {
  const m = Math.floor(_ctxMenuTick / TICKS_PER_MEASURE) + 1;
  const b = Math.floor((_ctxMenuTick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
  const elM = document.getElementById('ss-ev-measure');
  const elB = document.getElementById('ss-ev-beat');
  const elS = document.getElementById('ss-ev-speed');
  if (elM) elM.value = m;
  if (elB) elB.value = b;
  if (elS && chart?.getScrollSpeedAt) {
    const currentSpeed = chart.getScrollSpeedAt(_ctxMenuTick);
    elS.value = Number(currentSpeed.toFixed(1));
  }
  document.getElementById('modal-scroll-speed').style.display = 'flex';
}

function ensureCtxMenu() {
  if (ctxMenuEl) return;
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.display = 'none';
  ctxMenuEl.innerHTML = `
    <div class="ctx-item" data-act="cut">Cut</div>
    <div class="ctx-item" data-act="copy">Copy</div>
    <div class="ctx-item" data-act="paste">Paste</div>
    <div class="ctx-item ctx-has-sub" id="ctx-paste-section-root">Paste at Section… <span style="font-size:9px;color:#aaa">▶</span>
      <div class="ctx-sub" id="ctx-section-sub"></div>
    </div>
    <div class="ctx-item" data-act="save-snippet">Save as Snippet…</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-act="add-bpm">Add BPM Change…</div>
    <div class="ctx-item" data-act="add-timesig">Add Time Sig…</div>
    <div class="ctx-item" data-act="add-velocity">Add Chart Velocity…</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item ctx-has-sub">Modify Style
      <div class="ctx-sub">
        <div class="ctx-item ctx-has-sub">Mirror
          <div class="ctx-sub">
            <div class="ctx-item" data-act="mirror-all">Mirror All</div>
            <div class="ctx-item" data-act="mirror-fx">Mirror FX</div>
            <div class="ctx-item" data-act="mirror-bt">Mirror BT</div>
            <div class="ctx-item" data-act="mirror-vol">Mirror VOL</div>
          </div>
        </div>
        <div class="ctx-item ctx-has-sub">Temporal Mirror
          <div class="ctx-sub">
            <div class="ctx-item" data-act="tmirror-all">Temporal Mirror All</div>
            <div class="ctx-item" data-act="tmirror-bt">Temporal Mirror BT</div>
            <div class="ctx-item" data-act="tmirror-vol">Temporal Mirror VOL</div>
          </div>
        </div>
        <div class="ctx-item" data-act="swap-lasers">Swap VOL-L ↔ VOL-R</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item ctx-has-sub">Random
          <div class="ctx-sub">
            <div class="ctx-item" data-act="rand-all">Random All</div>
            <div class="ctx-item" data-act="rand-bt">Random BT</div>
            <div class="ctx-item" data-act="rand-fx">Random FX</div>
            <div class="ctx-item" data-act="rand-vol">Random VOL</div>
          </div>
        </div>
        <div class="ctx-item ctx-has-sub">S-Ran <span style="font-size:9px;color:#aaa">(per-note)</span>
          <div class="ctx-sub">
            <div class="ctx-item" data-act="sran-all">S-Ran All</div>
            <div class="ctx-item" data-act="sran-bt">S-Ran BT</div>
            <div class="ctx-item" data-act="sran-fx">S-Ran FX</div>
            <div class="ctx-item" data-act="sran-vol">S-Ran VOL</div>
          </div>
        </div>
      </div>
    </div>
    <div class="ctx-item ctx-has-sub">Adjust Speed
      <div class="ctx-sub">
        <div class="ctx-item" data-act="speed-half">Speed ½× (slower)</div>
        <div class="ctx-item" data-act="speed-double">Speed 2× (faster)</div>
        <div class="ctx-item" data-act="transform">Free Transform…  Ctrl+T</div>
      </div>
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item ctx-has-sub">Experimental <span style="font-size:9px;color:#aaa">(beta)</span>
      <div class="ctx-sub">
        <div class="ctx-item" data-act="toggle-anomaly" id="ctx-anomaly-item">✓ Pattern Anomaly Detection</div>
        <div class="ctx-item" data-act="toggle-predict" id="ctx-predict-item">✓ Predictive Chart Assist</div>
        <div class="ctx-item" data-act="toggle-ghost" id="ctx-ghost-item">✓ Ghost Playback Tracing</div>
        <div class="ctx-item" data-act="toggle-physics" id="ctx-physics-item">✕ Physics Laser Smoothing</div>
        <div class="ctx-item" data-act="toggle-snap-transients" id="ctx-snap-transients-item">✕ Snap to Transients</div>
        <div class="ctx-item" data-act="toggle-fxauto-vis" id="ctx-fxauto-item">✕ FX Automation Overlay</div>
      </div>
    </div>
  `;
  document.body.appendChild(ctxMenuEl);

  ctxMenuEl.addEventListener('click', e => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    ctxMenuEl.style.display = 'none';
    const act = item.dataset.act;
    if (act === 'cut')          selCut();
    else if (act === 'copy')    selCopy();
    else if (act === 'paste')   selPaste();
    else if (act.startsWith('paste-section-')) {
      const idx = parseInt(act.slice('paste-section-'.length), 10);
      const secs = [...(chart?.sections ?? [])].sort((a, b) => a.y - b.y);
      if (secs[idx]) selPasteAtTick(secs[idx].y);
    }
    else if (act === 'save-snippet') {
      savePatternFromSelection();
    }
    else if (act === 'add-bpm')      openBpmModalAtCtx();
    else if (act === 'add-timesig')  openTimesigModalAtCtx();
    else if (act === 'add-velocity') openScrollSpeedModalAtCtx();
    else if (act === 'transform')    selTransform();
    else if (act === 'mirror-all') selMirror('all');
    else if (act === 'mirror-fx')  selMirror('fx');
    else if (act === 'mirror-bt')  selMirror('bt');
    else if (act === 'mirror-vol') selMirror('vol');
    else if (act === 'tmirror-all') selTemporalMirror('all');
    else if (act === 'tmirror-bt')  selTemporalMirror('bt');
    else if (act === 'tmirror-vol') selTemporalMirror('vol');
    else if (act === 'swap-lasers') selSwapLasers();
    else if (act === 'speed-half')   selAdjustSpeed(0.5);
    else if (act === 'speed-double') selAdjustSpeed(2.0);
    else if (act === 'rand-all') selRandom('all');
    else if (act === 'rand-bt')  selRandom('bt');
    else if (act === 'rand-fx')  selRandom('fx');
    else if (act === 'rand-vol') selRandom('vol');
    else if (act === 'sran-all') applySRan('all');
    else if (act === 'sran-bt')  applySRan('bt');
    else if (act === 'sran-fx')  applySRan('fx');
    else if (act === 'sran-vol') applySRan('vol');
    else if (act === 'toggle-anomaly') {
      prefs.anomalyDetect = !prefs.anomalyDetect;
      savePrefsToLocalStorage();
      updateCtxMenuExperimentalLabels();
      render();
    }
    else if (act === 'toggle-predict') {
      prefs.predictAssist = !prefs.predictAssist;
      savePrefsToLocalStorage();
      updateCtxMenuExperimentalLabels();
      render();
    }
    else if (act === 'toggle-ghost') {
      prefs.ghostTrace = !prefs.ghostTrace;
      savePrefsToLocalStorage();
      updateCtxMenuExperimentalLabels();
      render();
    }
    else if (act === 'toggle-physics') {
      prefs.physicsLaser = !prefs.physicsLaser;
      savePrefsToLocalStorage();
      updateCtxMenuExperimentalLabels();
    }
    else if (act === 'toggle-snap-transients') {
      prefs.snapToTransients = !prefs.snapToTransients;
      savePrefsToLocalStorage();
      updateCtxMenuExperimentalLabels();
      render();
    }
    else if (act === 'toggle-fxauto-vis') {
      prefs.fxAutoVis = !prefs.fxAutoVis;
      const cb = document.getElementById('fxauto-vis-toggle');
      if (cb) cb.checked = prefs.fxAutoVis;
      savePrefsToLocalStorage();
      updateCtxMenuExperimentalLabels();
      render();
    }
  });

  document.addEventListener('click', () => { if (ctxMenuEl) ctxMenuEl.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctxMenuEl) ctxMenuEl.style.display = 'none'; });
}

function updateCtxMenuExperimentalLabels() {
  const anomalyEl  = document.getElementById('ctx-anomaly-item');
  const predictEl  = document.getElementById('ctx-predict-item');
  const ghostEl    = document.getElementById('ctx-ghost-item');
  const physicsEl  = document.getElementById('ctx-physics-item');
  const snapTrEl   = document.getElementById('ctx-snap-transients-item');
  const fxAutoEl   = document.getElementById('ctx-fxauto-item');
  if (anomalyEl)  anomalyEl.textContent  = (prefs.anomalyDetect    ? '✓' : '✕') + ' Pattern Anomaly Detection';
  if (predictEl)  predictEl.textContent  = (prefs.predictAssist    ? '✓' : '✕') + ' Predictive Chart Assist';
  if (ghostEl)    ghostEl.textContent    = (prefs.ghostTrace        ? '✓' : '✕') + ' Ghost Playback Tracing';
  if (physicsEl)  physicsEl.textContent  = (prefs.physicsLaser      ? '✓' : '✕') + ' Physics Laser Smoothing';
  if (snapTrEl)   snapTrEl.textContent   = (prefs.snapToTransients  ? '✓' : '✕') + ' Snap to Transients';
  if (fxAutoEl)   fxAutoEl.textContent   = (prefs.fxAutoVis         ? '✓' : '✕') + ' FX Automation Overlay';
}

// v0.0.21: refresh the "Paste at Section…" submenu with current section list.
function _refreshSectionPasteSubmenu() {
  const sub = document.getElementById('ctx-section-sub');
  const root = document.getElementById('ctx-paste-section-root');
  if (!sub) return;
  const secs = [...(chart?.sections ?? [])].sort((a, b) => a.y - b.y);
  const hasClip = !!sel.clipboard;
  if (root) root.style.opacity = hasClip ? '' : '0.4';
  if (!secs.length) {
    sub.innerHTML = `<div class="ctx-item" style="color:#888;cursor:default;font-style:italic">No sections — add via Window → Chart Sections…</div>`;
    return;
  }
  sub.innerHTML = secs.map((s, i) => {
    const m = Math.floor(s.y / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((s.y % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const label = s.label || `Section ${i + 1}`;
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px;flex-shrink:0"></span>`;
    return `<div class="ctx-item" data-act="paste-section-${i}">${dot}${label} <span style="color:#888;font-size:10px;margin-left:6px">m${m}:b${b}</span></div>`;
  }).join('');
}

function showCtxMenu(x, y) {
  ensureCtxMenu();
  updateCtxMenuExperimentalLabels();
  _refreshSectionPasteSubmenu();
  ctxMenuEl.style.display = 'block';
  const tw = ctxMenuEl.offsetWidth || 160, th = ctxMenuEl.offsetHeight || 200;
  ctxMenuEl.style.left = Math.min(x, window.innerWidth  - tw - 8) + 'px';
  ctxMenuEl.style.top  = Math.min(y, window.innerHeight - th - 8) + 'px';
}

function openContextMenuCenter() {
  // When opened via the C key, default the menu tick to the playhead so
  // "Add BPM Change…" / "Add Time Sig…" still pre-fill sensibly.
  _ctxMenuTick = renderer?.playTick ?? 0;
  const canvas = document.getElementById('chart-canvas');
  if (canvas && viewMode !== 'game') {
    const r = canvas.getBoundingClientRect();
    showCtxMenu(r.left + r.width / 2, r.top + r.height / 2);
  } else {
    const gw = document.getElementById('game-canvas');
    if (gw) {
      const r = gw.getBoundingClientRect();
      showGameCtxMenu(r.left + r.width / 2, r.top + r.height / 2);
    }
  }
}

// ── Laser envelope interaction ────────────────────────────────────────────────

// Track which anchor point is currently selected for interpolation editing.
let _laserSel = null; // { side, sec, ptIndex }

// Pen-tool laser state — the section currently being built point-by-point.
// Null when no laser is being drawn.  Press Esc or switch tool to finish.
let _activeLaserSec = null; // { sec, side } or null
// Tracks an in-progress laser pen press so a sideways drag-release can form a
// slam (parity with the game-preview edit mode). { side, downX, downY }
let _laserPress = null;

// Bezier handle drag state — set when user grabs a diamond handle
let _curveDrag = null; // { sec, ptIndex, t0, t1, colIdx, colLen }

// Resolve which point's outgoing `.interp` should be edited when the user opens
// the interpolation menu on anchor `ptIndex`.
//
// `.interp` describes the OUTGOING segment from a point. A slam segment always
// renders as a slam regardless of interp, so changing the interp of a point
// whose outgoing segment is a slam appears to "do nothing". When the user
// right-clicks such a point (e.g. the start of a slam, which is also the end of
// the laser line leading into it) they almost always mean the visible non-slam
// line. So:
//   • prefer the OUTGOING segment when it exists and is NOT a slam,
//   • otherwise fall back to the INCOMING segment (previous point) if non-slam,
//   • otherwise edit the outgoing point anyway (slam→slam / lone cases).
// Returns the point index whose `.interp` controls the segment we will edit.
function resolveLaserInterpTarget(sec, ptIndex) {
  const pts = sec?.points;
  if (!pts || !pts.length) return ptIndex;
  const hasOut = ptIndex < pts.length - 1;
  const hasIn  = ptIndex > 0;
  const outSlam = hasOut && ChartData.isPointSlam(pts[ptIndex], pts[ptIndex + 1]);
  const inSlam  = hasIn  && ChartData.isPointSlam(pts[ptIndex - 1], pts[ptIndex]);

  if (hasOut && !outSlam) return ptIndex;        // normal: edit outgoing
  if (hasIn  && !inSlam)  return ptIndex - 1;    // slam/endpoint: edit incoming line
  if (hasOut)             return ptIndex;         // slam→slam: edit outgoing
  return Math.max(0, ptIndex - 1);
}

// Show the laser interpolation popup menu at (x, y) for a given anchor point.
function showLaserInterpMenu(screenX, screenY, side, sec, ptIndex) {
  const menu = document.getElementById('laser-interp-menu');
  if (!menu) return;

  // Edit the segment the user most likely means (see resolveLaserInterpTarget).
  const targetIdx = resolveLaserInterpTarget(sec, ptIndex);
  const pt      = sec.points[targetIdx];
  const current = pt?.interp ?? 'linear';

  // Mark active item
  menu.querySelectorAll('.lim-item').forEach(el => {
    el.classList.toggle('lim-active', el.dataset.type === current);
  });

  menu.style.left    = screenX + 'px';
  menu.style.top     = screenY + 'px';
  menu.style.display = 'block';

  // Replace any previous handler so a menu that was opened then dismissed
  // (without a selection) can't leave a stale listener bound to an old point.
  if (menu._limHandler) menu.removeEventListener('click', menu._limHandler);
  const handler = e => {
    const item = e.target.closest('.lim-item');
    if (!item) return;
    const type = item.dataset.type;
    if (type && sec.points[targetIdx]) {
      saveUndo('Set interp ' + type);
      sec.points[targetIdx].interp = type;
      // Sync curve to sensible default when switching to bezier
      if (type === 'bezier' && !(sec.points[targetIdx].curve ?? 0.5)) {
        sec.points[targetIdx].curve = 0.5;
      }
      render();
    }
    menu.style.display = 'none';
    menu.removeEventListener('click', handler);
    menu._limHandler = null;
  };
  menu._limHandler = handler;
  menu.addEventListener('click', handler);
}

// Cycle through interpolation types: linear → bezier → step → linear.
// Uses the same segment-resolution logic as the menu so Alt+click on a
// slam-adjacent point cycles the visible line rather than the slam.
function cycleInterpType(sec, ptIndex) {
  const targetIdx = resolveLaserInterpTarget(sec, ptIndex);
  if (!sec?.points[targetIdx]) return;
  const pt   = sec.points[targetIdx];
  const cycle = ['linear', 'bezier', 'step'];
  const next  = cycle[(cycle.indexOf(pt.interp ?? 'linear') + 1) % cycle.length];
  saveUndo('Cycle interp → ' + next);
  pt.interp = next;
  if (next === 'bezier' && pt.curve == null) pt.curve = 0.5;
  render();
}

// Auto-connect touching laser sections on `side`, keeping any active-draw /
// mirror section references valid if they get merged into an earlier section.
function autoConnectLasersFixup(side) {
  if (!chart || typeof chart.autoConnectLasers !== 'function') return;
  if (_activeLaserSec && _activeLaserSec.side === side) _activeLaserSec.sec.__keep = 'active';
  if (_mirrorLaserSec && _mirrorLaserSec.side === side) _mirrorLaserSec.sec.__keep = 'mirror';

  const merges = chart.autoConnectLasers(side);

  if (merges > 0) {
    // Re-point references to the surviving (earlier) section that carries the tag.
    for (const sec of chart.lasers[side]) {
      if (sec.__keep === 'active' && _activeLaserSec) {
        _activeLaserSec.sec = sec;
        if (renderer) renderer.activeLaserSec = sec;
      }
      if (sec.__keep === 'mirror' && _mirrorLaserSec) _mirrorLaserSec.sec = sec;
    }
  }
  // Clean up tags regardless
  for (const sec of chart.lasers[side]) delete sec.__keep;
}

// Close laser interp menu when clicking elsewhere
document.addEventListener('click', e => {
  const menu = document.getElementById('laser-interp-menu');
  if (menu && !menu.contains(e.target)) menu.style.display = 'none';
});

// ── Game preview context menu ─────────────────────────────────────────────────
let gameCtxEl = null;
let _gameEditMode = false;

function ensureGameCtxMenu() {
  if (gameCtxEl) return;
  gameCtxEl = document.createElement('div');
  gameCtxEl.className = 'ctx-menu';
  gameCtxEl.style.display = 'none';
  gameCtxEl.innerHTML = `
    <div class="ctx-item" data-act="edit-mode">✏ Edit Chart in Preview</div>
    <div class="ctx-item" data-act="exit-edit">✕ Exit Edit Mode</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-act="to-edit">Open Full Edit View</div>
    <div class="ctx-item" data-act="to-split">Split View</div>
  `;
  document.body.appendChild(gameCtxEl);
  gameCtxEl.addEventListener('click', e => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    gameCtxEl.style.display = 'none';
    const act = item.dataset.act;
    if (act === 'edit-mode')  enableGameEditMode();
    else if (act === 'exit-edit') disableGameEditMode();
    else if (act === 'to-edit')  setViewMode('edit');
    else if (act === 'to-split') setViewMode('split');
  });
  document.addEventListener('click', ev => {
    if (gameCtxEl && !gameCtxEl.contains(ev.target)) gameCtxEl.style.display = 'none';
  });
}

function showGameCtxMenu(x, y) {
  ensureGameCtxMenu();
  // Toggle edit/exit items
  gameCtxEl.querySelector('[data-act="edit-mode"]').style.display  = _gameEditMode ? 'none' : '';
  gameCtxEl.querySelector('[data-act="exit-edit"]').style.display  = _gameEditMode ? '' : 'none';
  gameCtxEl.style.display = 'block';
  const tw = gameCtxEl.offsetWidth || 180, th = gameCtxEl.offsetHeight || 120;
  gameCtxEl.style.left = Math.min(x, window.innerWidth  - tw - 8) + 'px';
  gameCtxEl.style.top  = Math.min(y, window.innerHeight - th - 8) + 'px';
}

function enableGameEditMode() {
  _gameEditMode = true;
  const ov = document.getElementById('game-edit-overlay');
  if (ov) ov.style.display = 'flex';
}

function disableGameEditMode() {
  _gameEditMode = false;
  const ov = document.getElementById('game-edit-overlay');
  if (ov) ov.style.display = 'none';
}

// ── Tick sound ────────────────────────────────────────────────────────────────
function detectBtHits(prevTick, curTick, pan = 0) {
  if (!tickBuffer || !audioCtx || !settings.tickSound) return;
  for (let li = 0; li < 4; li++) {
    for (const n of chart.bt[li]) {
      const hitTick = n.y;
      if (hitTick >= prevTick && hitTick < curTick) {
        const src = audioCtx.createBufferSource();
        src.buffer = tickBuffer;
        if (pan !== 0 && audioCtx.createStereoPanner) {
          const panner = audioCtx.createStereoPanner();
          panner.pan.value = pan;
          src.connect(panner);
          panner.connect(tickGainNode || audioCtx.destination);
        } else {
          src.connect(tickGainNode || audioCtx.destination);
        }
        src.start();
      }
    }
  }
}

// Play ticks for all multi-chart slots, panned by horizontal slot position.
// Slot 0 (leftmost): pan -0.8, slot n-1 (rightmost): pan +0.8.
// The active tab's ticks are played by the normal detectBtHits; we skip that slot here.
function detectMultiBtHits(prevTick, curTick) {
  if (!tickBuffer || !audioCtx || !settings.tickSound) return;
  if (!_multiMode || !_multiViews.length) return;
  const n = _multiViews.length;
  for (let si = 0; si < n; si++) {
    const mv = _multiViews[si];
    const slotChart = tabs[mv.tabIdx]?.chart;
    if (!slotChart || slotChart === chart) continue; // active tab handled by detectBtHits
    const pan = n === 1 ? 0 : ((si / (n - 1)) * 2 - 1) * 0.8;
    const slotTick = _multiSync ? curTick + mv.tickOffset : mv.gv.playTick;
    const slotPrev = _multiSync ? prevTick + mv.tickOffset : Math.max(0, slotTick - (curTick - prevTick));
    for (let li = 0; li < 4; li++) {
      for (const note of slotChart.bt[li]) {
        if (note.y >= slotPrev && note.y < slotTick) {
          const src = audioCtx.createBufferSource();
          src.buffer = tickBuffer;
          if (pan !== 0 && audioCtx.createStereoPanner) {
            const panner = audioCtx.createStereoPanner();
            panner.pan.value = pan;
            src.connect(panner);
            panner.connect(tickGainNode || audioCtx.destination);
          } else {
            src.connect(tickGainNode || audioCtx.destination);
          }
          src.start();
        }
      }
    }
  }
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────
function getHit(e) {
  const rect = renderer.canvas.getBoundingClientRect();
  const cx   = e.clientX - rect.left;
  const cy   = e.clientY - rect.top;
  const hit  = renderer.canvasToTick(cx, cy);
  hit.tick   = Math.max(0, snapTick(hit.tick));
  hit.cx     = cx; hit.cy = cy;
  return hit;
}

function onMouseDown(e) {
  e.preventDefault();

  // ── Camera-pill click: open popup at fixed position (left-click only) ────
  // Check this FIRST so clicking a pill doesn't also place notes etc.
  if (e.button === 0 && renderer) {
    const camHit = _findCamPillAt(e.offsetX, e.offsetY);
    if (camHit !== null) {
      // Toggle: clicking the same tick closes, clicking a different tick opens
      const currentTick = _camPopupFixedTick;
      if (_camPopupFixedTick === camHit.tick) {
        _camPopupFixedTick = null;
        _hideCamPopup();
      } else {
        _camPopupFixedTick = camHit.tick;
        _showCamPopup(camHit.tick, e.clientX, e.clientY);
      }
      return;
    } else {
      // Clicked somewhere that isn't a pill — close popup if open
      if (_camPopupFixedTick !== null) {
        _camPopupFixedTick = null;
        _hideCamPopup();
      }
    }
  }

  // ── Chart Velocity pill click ─────────────────────────────────────────────
  if (e.button === 0 && renderer) {
    const velHit = _findVelPillAt(e.offsetX, e.offsetY);
    if (velHit !== null) {
      if (_velPopupFixedTick === velHit.tick) {
        _velPopupFixedTick = null;
        _hideVelPopup();
      } else {
        _velPopupFixedTick = velHit.tick;
        _showVelPopup(velHit.tick, e.clientX, e.clientY);
      }
      return;
    } else {
      if (_velPopupFixedTick !== null) {
        _velPopupFixedTick = null;
        _hideVelPopup();
      }
    }
  }

  // ── Glitch pill click ─────────────────────────────────────────────────────
  if (e.button === 0 && renderer) {
    const gHit = _findGlitchPillAt(e.offsetX, e.offsetY);
    if (gHit !== null) {
      if (_glitchPopupFixedTick === gHit.tick) {
        _glitchPopupFixedTick = null;
        _hideGlitchPopup();
      } else {
        _glitchPopupFixedTick = gHit.tick;
        _showGlitchPopup(gHit.tick, e.clientX, e.clientY);
      }
      return;
    } else {
      if (_glitchPopupFixedTick !== null) {
        _glitchPopupFixedTick = null;
        _hideGlitchPopup();
      }
    }
  }

  // ── FX hold click: open param popup (left-click, not during playback) ────
  // Skip when a placement tool is active — don't intercept BT/laser note clicks.
  if (e.button === 0 && renderer && !playing &&
      tool !== 'bt' && tool !== 'laser-l' && tool !== 'laser-r') {
    const fxHit = _findFxHoldAt(e.offsetX, e.offsetY);
    if (fxHit !== null) {
      if (_fxPopupFixedLane === fxHit.li) {
        // Clicking the same lane's hold closes the popup
        _fxPopupFixedLane = null;
        _hideFxPopup();
        renderer._hoveredFxHold = null;
      } else {
        _fxPopupFixedLane = fxHit.li;
        _showFxPopup(fxHit.li, e.clientX, e.clientY);
        renderer._hoveredFxHold = { li: fxHit.li, note: fxHit.note };
      }
      render();
      return;
    } else if (_fxPopupFixedLane !== null) {
      _fxPopupFixedLane = null;
      _hideFxPopup();
      renderer._hoveredFxHold = null;
    }
  }

  // Middle mouse = start selection drag (single) or open range editor (double)
  if (e.button === 1) {
    const now = performance.now();
    const DBLCLICK_MS = 300;
    if (now - (onMouseDown._lastMiddleT ?? 0) < DBLCLICK_MS) {
      // Double middle-click — open selection range editor popup
      onMouseDown._lastMiddleT = 0; // reset so a 3rd click doesn't re-trigger
      sel.dragging = false;
      render();
      openSeekbarSelectionPopup(e.clientX, e.clientY);
      return;
    }
    onMouseDown._lastMiddleT = now;
    const h = getHit(e);
    sel.dragging = true;
    sel._dragStartX = e.clientX;
    sel._dragStartY = e.clientY;
    sel.startTick = snapTick(h.tick);
    sel.endTick   = sel.startTick;
    render();
    return;
  }
  if (e.button !== 0) return;
  _fxPinned = false;
  hideFxTooltip();
  const h = getHit(e);
  const { tick, laneIdx, localX } = h;
  if (laneIdx < 0) return;

  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  if (tool === 'erase')    saveUndo(`Erased at M${m}`);
  else if (tool === 'bt')  saveUndo(`Added BT note at M${m}`);
  else if (tool === 'fx')  saveUndo(`Added FX note at M${m}`);
  else if (tool === 'laser-l') saveUndo(`Added VOL-L at M${m}`);
  else if (tool === 'laser-r') saveUndo(`Added VOL-R at M${m}`);
  else saveUndo();

  if (tool === 'erase') { eraseAt(laneIdx, tick); render(); return; }

  if (tool === 'cam-event') {
    const type = document.getElementById('cam-type-sel')?.value ?? 'zoom_bottom';
    const val  = String(parseFloat(document.getElementById('cam-val-inp')?.value ?? '0') || 0);
    chart.cameraEvents = chart.cameraEvents ?? [];
    chart.cameraEvents.push({ y: tick, type, value: val });
    chart.cameraEvents.sort((a, b) => a.y - b.y);
    updateCameraEventList();
    render();
    return;
  }

  if (tool === 'stop-event') {
    Object.assign(drag, { active: true, lane: -1, laneType: 'stop', startTick: tick });
    return;
  }

  if (tool === 'bt' && laneIdx >= 0 && laneIdx <= 3) {
    Object.assign(drag, { active: true, lane: laneIdx, laneType: 'bt', startTick: tick });
    chart.addBtNote(laneIdx, tick, 0); render(); return;
  }

  if (tool === 'fx' && laneIdx >= 0 && laneIdx <= 3) {
    const li = laneIdx <= 1 ? 0 : 1;
    Object.assign(drag, { active: true, lane: li, laneType: 'fx', startTick: tick });
    chart.addFxNote(li, tick, 0); render(); return;
  }

  if ((tool === 'laser-l' || tool === 'laser-r') && laneIdx !== -1) {
    const side = tool === 'laser-l' ? 0 : 1;
    const wide = chart.laserSettings.wide || laserWideMode;

    // ── Alt+click: cycle interpolation on nearest anchor dot ──────────────
    if (e.altKey) {
      const hit = renderer?.getLaserPointAt(e.offsetX, e.offsetY, side);
      if (hit) {
        cycleInterpType(hit.sec, hit.ptIndex);
        _laserSel = { side: hit.side, sec: hit.sec, ptIndex: hit.ptIndex };
        if (renderer) renderer.selectedLaserPoint = _laserSel;
        render(); return;
      }
    }

    // ── Grab bezier diamond handle → start curve drag ──────────────────────
    {
      const hit = renderer?.getBezierHandleAt(e.offsetX, e.offsetY, side);
      if (hit) {
        const h0 = getHit(e);
        _curveDrag = {
          sec: hit.sec, ptIndex: hit.ptIndex, t0: hit.t0, t1: hit.t1,
          // For Shift fine-mode: anchor the drag origin
          startTick:    h0.tick,
          curveAtStart: hit.sec.points[hit.ptIndex].curve ?? 0.5,
        };
        if (renderer) renderer.activeBezierHandle = { sec: hit.sec, ptIndex: hit.ptIndex };
        const canvas = document.getElementById('chart-canvas');
        if (canvas) canvas.style.cursor = 'grabbing';
        render(); return;
      }
    }

    // ── Shift+drag: freehand laser drawing ──────────────────────────────────
    if (e.shiftKey && !e.altKey) {
      const v0 = snapLaserV(renderer.localXToLaserPos(localX, wide));
      drag.freehand          = true;
      drag.freehandSide      = side;
      drag.freehandStartTick = Math.round(tick);
      drag.freehandPts       = [{ ry: 0, v: v0 }];
      // Clear pen-tool active section so freehand always starts fresh
      _activeLaserSec = null;
      _mirrorLaserSec = null;
      _laserPress     = null;
      if (renderer) {
        renderer.activeLaserSec        = null;
        renderer._laserPreview         = null;
        renderer.freehandPreviewPts    = drag.freehandPts;
        renderer.freehandPreviewSide   = side;
      }
      const canvas = document.getElementById('chart-canvas');
      if (canvas) canvas.style.cursor = 'crosshair';
      saveUndo(`Freehand VOL-${side === 0 ? 'L' : 'R'}`);
      render(); return;
    }

    // ── Pen tool: place one point at a time (Illustrator-style) ───────────
    const v = snapLaserV(renderer.localXToLaserPos(localX, wide));
    // Remember this press so a sideways drag-release can turn into a slam.
    _laserPress = { side, downX: e.clientX, downY: e.clientY };

    if (_activeLaserSec && _activeLaserSec.side === side) {
      // Extend the active section with a new point
      const sec    = _activeLaserSec.sec;
      const ry     = Math.round(tick) - sec.y;
      const lastPt = sec.points[sec.points.length - 1];
      const lastRy = lastPt?.ry ?? -1;
      // Horizontal slam: clicking a second point on (or within a slam-width of)
      // the SAME tick at a different position. This is the canonical "place two
      // laser points horizontally" gesture. Represent it the way the importers
      // do — hold at the previous value, then jump a hair later — so it renders
      // and round-trips to KSH/KSON correctly. Checked before the ry>lastRy case
      // because a same-tick click has ry === lastRy (not greater).
      const slamGap = Math.max(1, Math.floor(LASER_SLAM_TICKS / 2));
      const sameTickSlam = !!lastPt && ry <= lastRy && (lastRy - ry) <= LASER_SLAM_TICKS &&
                           Math.abs(v - lastPt.v) > LASER_SLAM_V_EPS;
      if (sameTickSlam) {
        if (lastPt.interp === 'linear') lastPt.interp = 'step';
        sec.points.push({ ry: lastRy + slamGap, v, slam: true, interp: 'linear', curve: 0.5 });
        if (laserMirrorMode && _mirrorLaserSec) {
          const mv = Math.max(0, Math.min(1, 1 - v));
          const mSec = _mirrorLaserSec.sec;
          const mLastPt = mSec.points[mSec.points.length - 1];
          if (mLastPt && Math.abs(mv - mLastPt.v) > LASER_SLAM_V_EPS) {
            if (mLastPt.interp === 'linear') mLastPt.interp = 'step';
            mSec.points.push({ ry: mLastPt.ry + slamGap, v: mv, slam: true, interp: 'linear', curve: 0.5 });
          }
        }
      } else if (ry > lastRy) {
        // Slam = near-instant horizontal move: small time gap + real position jump.
        const isSlam = !!lastPt && (ry - lastRy) <= LASER_SLAM_TICKS &&
                       Math.abs(v - lastPt.v) > LASER_SLAM_V_EPS;
        if (isSlam && lastPt.interp === 'linear') lastPt.interp = 'step';
        sec.points.push({ ry, v, slam: isSlam, interp: 'linear', curve: 0.5 });
        // Mirror Mode: extend the opposite-side section too
        if (laserMirrorMode && _mirrorLaserSec) {
          const mv  = Math.max(0, Math.min(1, 1 - v));
          const mSec = _mirrorLaserSec.sec;
          const mLastPt = mSec.points[mSec.points.length - 1];
          const mLastRy = mLastPt?.ry ?? -1;
          const mRy = Math.round(tick) - mSec.y;
          if (mRy > mLastRy) {
            const mSlam = !!mLastPt && (mRy - mLastRy) <= LASER_SLAM_TICKS &&
                          Math.abs(mv - mLastPt.v) > LASER_SLAM_V_EPS;
            if (mSlam && mLastPt.interp === 'linear') mLastPt.interp = 'step';
            mSec.points.push({ ry: mRy, v: mv, slam: mSlam, interp: 'linear', curve: 0.5 });
          }
        }
      } else {
        // Clicked at or before the last point — finish current section, start new
        _activeLaserSec = null;
        if (renderer) { renderer.activeLaserSec = null; renderer._laserPreview = null; }
        _mirrorLaserSec = null;
        const newSec = { y: tick, points: [{ ry: 0, v, slam: false, interp: 'linear', curve: 0.5 }], wide };
        chart.lasers[side].push(newSec);
        chart.lasers[side].sort((a, b) => a.y - b.y);
        _activeLaserSec = { sec: newSec, side };
        if (renderer) renderer.activeLaserSec = newSec;
        // Mirror Mode: start a fresh mirror section on the opposite side
        if (laserMirrorMode) {
          const mirSide = 1 - side;
          const mv = Math.max(0, Math.min(1, 1 - v));
          const mirSec = { y: tick, points: [{ ry: 0, v: mv, slam: false, interp: 'linear', curve: 0.5 }], wide };
          chart.lasers[mirSide].push(mirSec);
          chart.lasers[mirSide].sort((a, b) => a.y - b.y);
          _mirrorLaserSec = { sec: mirSec, side: mirSide };
        }
      }
    } else {
      // No active section (or switched side) — start a new one
      if (_activeLaserSec) {
        _activeLaserSec = null;
        if (renderer) { renderer.activeLaserSec = null; renderer._laserPreview = null; }
      }
      _mirrorLaserSec = null;
      const newSec = { y: tick, points: [{ ry: 0, v, slam: false, interp: 'linear', curve: 0.5 }], wide };
      chart.lasers[side].push(newSec);
      chart.lasers[side].sort((a, b) => a.y - b.y);
      _activeLaserSec = { sec: newSec, side };
      if (renderer) renderer.activeLaserSec = newSec;
      // Mirror Mode: start a mirrored section on the opposite side simultaneously
      if (laserMirrorMode) {
        const mirSide = 1 - side;
        const mv = Math.max(0, Math.min(1, 1 - v));
        const mirSec = { y: tick, points: [{ ry: 0, v: mv, slam: false, interp: 'linear', curve: 0.5 }], wide };
        chart.lasers[mirSide].push(mirSec);
        chart.lasers[mirSide].sort((a, b) => a.y - b.y);
        _mirrorLaserSec = { sec: mirSec, side: mirSide };
      }
    }

    // Auto-connect touching sections so a laser placed on another laser's
    // endpoint becomes one continuous path (keeps the active-draw ref valid).
    autoConnectLasersFixup(side);
    if (laserMirrorMode) autoConnectLasersFixup(1 - side);

    _laserSel = null;
    if (renderer) renderer.selectedLaserPoint = null;
    render(); return;
  }

  // Click to set cursor position in select mode
  if (tool === 'select') {
    renderer.playTick = tick;
    updateSeekbar(tick);
    render();
  }
}

function onMouseMove(e) {
  // ── Bezier handle drag ───────────────────────────────────────────────────
  if (_curveDrag) {
    const h = getHit(e);
    const { sec, ptIndex, t0, t1, startTick, curveAtStart } = _curveDrag;
    const span = t1 - t0;
    if (span > 0) {
      if (e.shiftKey) {
        // Shift held → fine mode: 1/8 sensitivity, anchored to drag origin.
        // The mouse must travel 8× as far to move the handle the same distance.
        const delta = (h.tick - startTick) / span;
        sec.points[ptIndex].curve = Math.max(0.01, Math.min(0.99, curveAtStart + delta * 0.125));
      } else {
        const rawCurve = (h.tick - t0) / span;
        sec.points[ptIndex].curve = Math.max(0.01, Math.min(0.99, rawCurve));
      }
    }
    const canvas = document.getElementById('chart-canvas');
    if (canvas) canvas.style.cursor = 'grabbing';
    render();
    return;
  }
  if (sel.dragging) {
    const h = getHit(e);
    sel.endTick = snapTick(h.tick);
    render();
    updateStatusFromEvent(e);
    return;
  }

  // ── Freehand laser drawing — collect raw path points ────────────────────
  if (drag.freehand) {
    const h    = getHit(e);
    const wide = chart?.laserSettings?.wide || laserWideMode;
    const ry   = Math.round(h.tick) - drag.freehandStartTick;
    const v    = snapLaserV(renderer.localXToLaserPos(h.localX, wide));
    const pts  = drag.freehandPts;
    const last = pts[pts.length - 1];
    if (ry > (last?.ry ?? -1)) {
      pts.push({ ry, v });
    } else if (last && ry === last.ry && Math.abs(v - last.v) > 0.001) {
      last.v = v;
    }
    if (renderer) {
      renderer.freehandPreviewPts  = [...pts];
      renderer.freehandPreviewSide = drag.freehandSide;
    }
    render(); return;
  }

  if (!drag.active) {
    updateStatusFromEvent(e);
    checkFxHover(e);
    // Show grab cursor and highlight handle when hovering over a bezier diamond
    if ((tool === 'laser-l' || tool === 'laser-r') && renderer) {
      const side = tool === 'laser-l' ? 0 : 1;
      const handleHit = renderer.getBezierHandleAt(e.offsetX, e.offsetY, side);
      const canvas = document.getElementById('chart-canvas');
      if (canvas) canvas.style.cursor = handleHit ? 'grab' : (_activeLaserSec ? 'crosshair' : '');
      const prev = renderer.activeBezierHandle;
      renderer.activeBezierHandle = handleHit
        ? { sec: handleHit.sec, ptIndex: handleHit.ptIndex }
        : null;
      // Update pen-tool preview line — ghost from last placed point to cursor
      if (_activeLaserSec && _activeLaserSec.side === side && !handleHit) {
        const h2 = getHit(e);
        const wide = _activeLaserSec.sec.wide || laserWideMode;
        const pv = renderer.localXToLaserPos(h2.localX, wide);
        renderer._laserPreview = {
          side,
          sec:  _activeLaserSec.sec,
          tick: Math.round(h2.tick),
          v:    pv,
        };
        render();
        return;
      } else if (!_activeLaserSec && renderer._laserPreview) {
        renderer._laserPreview = null;
        render();
        return;
      }
      // Only re-render if highlight state changed
      if (!!prev !== !!renderer.activeBezierHandle ||
          (prev && renderer.activeBezierHandle &&
           (prev.sec !== renderer.activeBezierHandle.sec ||
            prev.ptIndex !== renderer.activeBezierHandle.ptIndex))) {
        render();
      }
    }

    // ── Camera-pill highlight (hover only — popup triggered by click) ─────
    if (renderer) {
      const camHit = _findCamPillAt(e.offsetX, e.offsetY);
      const prevTick = renderer._hoveredCamTick;
      renderer._hoveredCamTick = camHit !== null ? camHit.tick : null;
      if (prevTick !== renderer._hoveredCamTick) render();
    }

    // ── Chart Velocity pill highlight ─────────────────────────────────────
    if (renderer) {
      const velHit  = _findVelPillAt(e.offsetX, e.offsetY);
      const prevVel = renderer._hoveredVelTick;
      renderer._hoveredVelTick = velHit !== null ? velHit.tick : null;
      if (prevVel !== renderer._hoveredVelTick) render();
    }

    // ── Glitch pill highlight ─────────────────────────────────────────────
    if (renderer) {
      const gHit  = _findGlitchPillAt(e.offsetX, e.offsetY);
      const prevG = renderer._hoveredGlitchTick;
      renderer._hoveredGlitchTick = gHit !== null ? gHit.tick : null;
      if (prevG !== renderer._hoveredGlitchTick) render();
    }

    // ── FX hold highlight (hover only — popup fixed by click) ─────────────
    if (renderer && _fxPopupFixedLane === null &&
        tool !== 'bt' && tool !== 'laser-l' && tool !== 'laser-r') {
      const fxHit = _findFxHoldAt(e.offsetX, e.offsetY);
      const prevFxHold = renderer._hoveredFxHold;
      renderer._hoveredFxHold = fxHit ? { li: fxHit.li, note: fxHit.note } : null;
      // Update cursor
      const canvas = document.getElementById('chart-canvas');
      if (canvas) canvas.style.cursor = fxHit ? 'pointer' : '';
      if (prevFxHold !== renderer._hoveredFxHold) render();
    }

    // Predictive chart assist ghost note
    if (renderer && window.prefs?.predictAssist) {
      const h = getHit(e);
      renderer._pendingPredictTick = h.tick;
      renderer._pendingPredictLane = h.laneIdx;
      render();
    }

    return;
  }
  const h = getHit(e);
  const { tick, localX } = h;

  if (drag.laneType === 'bt') {
    const st  = Math.min(drag.startTick, tick);
    const len = Math.abs(tick - drag.startTick);
    chart.addBtNote(drag.lane, st, len);
  } else if (drag.laneType === 'fx') {
    const st  = Math.min(drag.startTick, tick);
    const len = Math.abs(tick - drag.startTick);
    chart.addFxNote(drag.lane, st, len);
  }
  render();
  updateStatusFromEvent(e);
}

function onMouseUp(e) {
  // End bezier handle drag — save undo snapshot
  if (_curveDrag) {
    _curveDrag = null;
    if (renderer) renderer.activeBezierHandle = null;
    const canvas = document.getElementById('chart-canvas');
    if (canvas) canvas.style.cursor = '';
    saveUndo('Adjusted laser curve');
    render();
    return;
  }

  // ── Laser drag-release → slam / segment ──────────────────────────────────
  // The game-preview edit mode draws lasers by dragging; the 2D editor placed
  // points only on discrete clicks, so a sideways DRAG dropped a single point
  // and never formed a slam. Here, if the user dragged from the point they just
  // placed, append a point: a sideways move (same / near-same tick) becomes a
  // slam; a move to a later tick extends the section. The mousedown already
  // captured the undo snapshot, so one undo reverts the whole gesture.
  if (_laserPress && e?.button === 0) {
    const press = _laserPress;
    _laserPress = null;
    const dx = e.clientX - press.downX, dy = e.clientY - press.downY;
    const moved = Math.sqrt(dx * dx + dy * dy) >= 4;
    if (moved && _activeLaserSec && _activeLaserSec.side === press.side &&
        (tool === 'laser-l' || tool === 'laser-r') && renderer) {
      const sec    = _activeLaserSec.sec;
      const lastPt = sec.points[sec.points.length - 1];
      if (lastPt) {
        const h    = getHit(e);
        const wide = sec.wide || laserWideMode;
        const relV = snapLaserV(renderer.localXToLaserPos(h.localX, wide));
        const downTick = sec.y + lastPt.ry;
        const relTick  = Math.round(h.tick);
        const dt = relTick - downTick;
        const dvOK = Math.abs(relV - lastPt.v) > LASER_SLAM_V_EPS;
        const slamGap = Math.max(1, Math.floor(LASER_SLAM_TICKS / 2));
        if (dvOK && Math.abs(dt) <= LASER_SLAM_TICKS) {
          // Sideways (near-instant) horizontal move → slam.
          if (lastPt.interp === 'linear') lastPt.interp = 'step';
          sec.points.push({ ry: lastPt.ry + slamGap, v: relV, slam: true, interp: 'linear', curve: 0.5 });
          if (laserMirrorMode && _mirrorLaserSec) {
            const mSec  = _mirrorLaserSec.sec;
            const mLast = mSec.points[mSec.points.length - 1];
            const mv    = Math.max(0, Math.min(1, 1 - relV));
            if (mLast && Math.abs(mv - mLast.v) > LASER_SLAM_V_EPS) {
              if (mLast.interp === 'linear') mLast.interp = 'step';
              mSec.points.push({ ry: mLast.ry + slamGap, v: mv, slam: true, interp: 'linear', curve: 0.5 });
            }
          }
          autoConnectLasersFixup(press.side);
          if (laserMirrorMode) autoConnectLasersFixup(1 - press.side);
          render();
          return;
        } else if (dt > LASER_SLAM_TICKS && dvOK) {
          // Dragged to a later tick at a new position → normal segment point.
          sec.points.push({ ry: relTick - sec.y, v: relV, slam: false, interp: 'linear', curve: 0.5 });
          autoConnectLasersFixup(press.side);
          render();
          return;
        }
      }
    }
  }
  if (e?.button === 1) {
    sel.dragging = false;
    const dx = e.clientX - (sel._dragStartX ?? e.clientX);
    const dy = e.clientY - (sel._dragStartY ?? e.clientY);
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist < 5) {
      // Single click — just set cursor position
      renderer.playTick = sel.startTick;
      updateSeekbar(sel.startTick);
      sel.active = false;
    } else {
      sel.active = true;
      if (Math.abs(sel.endTick - sel.startTick) < snap) {
        sel.startTick = Math.min(sel.startTick, sel.endTick);
        sel.endTick   = sel.startTick + snap;
      }
    }
    updateSelStatus();
    render();
    return;
  }
  // Handle stop-event drag end
  if (drag.laneType === 'stop' && drag.active) {
    const h = getHit(e);
    const endTick = snapTick(h.tick);
    const minLen  = Math.round(TICKS_PER_BEAT / 4);
    const len     = Math.max(minLen, Math.abs(endTick - drag.startTick));
    const y       = Math.min(drag.startTick, endTick);
    chart.stopEvents = chart.stopEvents ?? [];
    chart.stopEvents.push({ y, len });
    chart.stopEvents.sort((a, b) => a.y - b.y);
    updateStopEventList();
    drag.active = false;
    drag.laneType = '';
    render();
    return;
  }

  // ── Finalize freehand laser drawing ─────────────────────────────────────
  if (drag.freehand) {
    const pts  = drag.freehandPts;
    const side = drag.freehandSide;
    const wide = chart?.laserSettings?.wide || laserWideMode;
    if (pts.length >= 2) {
      const simplified = _rdpSimplify(pts, FREEHAND_RDP_EPS);
      if (simplified.length >= 2) {
        const newSec = {
          y:      drag.freehandStartTick,
          points: simplified.map(p => ({
            ry: p.ry, v: p.v, slam: false, interp: 'linear', curve: 0.5,
          })),
          wide,
        };
        chart.lasers[side].push(newSec);
        chart.lasers[side].sort((a, b) => a.y - b.y);
        autoConnectLasersFixup(side);
        if (laserMirrorMode) {
          const mirSide = 1 - side;
          const mirSec  = {
            y:      drag.freehandStartTick,
            points: simplified.map(p => ({
              ry: p.ry, v: Math.max(0, Math.min(1, 1 - p.v)),
              slam: false, interp: 'linear', curve: 0.5,
            })),
            wide,
          };
          chart.lasers[mirSide].push(mirSec);
          chart.lasers[mirSide].sort((a, b) => a.y - b.y);
          autoConnectLasersFixup(mirSide);
        }
      }
    }
    drag.freehand    = false;
    drag.freehandPts = [];
    if (renderer) { renderer.freehandPreviewPts = null; renderer.activeLaserSec = null; }
    render(); return;
  }

  drag.active   = false;
  drag.freehand = false;
  drag.laserSec = null;
  // NOTE: do NOT clear renderer.activeLaserSec here — the pen tool keeps the
  // active section alive across mouse-up events until Esc or tool switch.
}

// ── Double-click: laser anchor X-position editor (sketch item 14) ────────────
// Opens a small floating popup for precision X (v) editing of any laser anchor dot.
function onDblClick(e) {
  if (e.button !== 0) return;
  if (tool !== 'laser-l' && tool !== 'laser-r') return;
  const side = tool === 'laser-l' ? 0 : 1;
  const hit  = renderer?.getLaserPointAt(e.offsetX, e.offsetY, side);
  if (!hit) return;

  e.preventDefault();

  // Remove stale popup if any
  document.getElementById('laser-pt-popup')?.remove();
  document.getElementById('laser-pt-overlay')?.remove();

  const pt  = hit.sec.points[hit.ptIndex];
  const absY = hit.sec.y + pt.ry;
  const m   = Math.floor(absY / TICKS_PER_MEASURE) + 1;
  const b   = Math.floor((absY % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

  // ── Overlay (click-outside closes) ───────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'laser-pt-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99997';

  // ── Popup ─────────────────────────────────────────────────────────────────
  const pop = document.createElement('div');
  pop.id = 'laser-pt-popup';
  pop.style.cssText =
    'position:fixed;z-index:99998;background:#0c0c20;border:1.5px solid #3344aa;' +
    'border-radius:8px;padding:12px 14px;box-shadow:0 6px 24px #000c;' +
    'display:flex;flex-direction:column;gap:8px;min-width:180px;font-family:inherit;color:#e0e8ff;font-size:12px';

  const sideLabel = side === 0 ? 'VOL-L' : 'VOL-R';
  const sideColor = side === 0 ? '#0088ff' : '#ff1177';

  pop.innerHTML = `
    <div style="font-weight:bold;color:${sideColor}">${sideLabel} Anchor — M${m} B${b}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <label style="color:#8899cc;min-width:20px">X:</label>
      <input id="lpt-x" type="number" min="0" max="1" step="0.0001" value="${pt.v.toFixed(4)}"
        style="background:#161630;border:1px solid #3344aa;border-radius:4px;color:#e0e8ff;
               font-size:12px;padding:4px 7px;outline:none;width:90px">
      <span style="color:#556">(0–1)</span>
    </div>
    <div style="color:#556;font-size:10px">Tick: ${absY}</div>
    <div style="display:flex;gap:8px;margin-top:2px">
      <button id="lpt-ok"     style="flex:1;background:#2233aa;color:#e0e8ff;border:1px solid #3344cc;border-radius:4px;padding:5px;cursor:pointer;font-size:11px">Apply</button>
      <button id="lpt-cancel" style="flex:1;background:#161630;color:#778;border:1px solid #2a2a55;border-radius:4px;padding:5px;cursor:pointer;font-size:11px">Cancel</button>
    </div>`;

  // Position near cursor, keep on-screen
  const vw = window.innerWidth, vh = window.innerHeight;
  let px = e.clientX + 12, py = e.clientY - 10;
  if (px + 200 > vw) px = e.clientX - 200;
  if (py + 130 > vh) py = e.clientY - 130;
  pop.style.left = px + 'px';
  pop.style.top  = py + 'px';

  const close = () => { overlay.remove(); pop.remove(); };

  pop.querySelector('#lpt-ok').addEventListener('click', () => {
    const newV = parseFloat(pop.querySelector('#lpt-x').value);
    if (!isNaN(newV)) {
      saveUndo('Adjusted laser anchor X');
      pt.v = Math.max(0, Math.min(1, newV));
      render();
    }
    close();
  });
  pop.querySelector('#lpt-cancel').addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Enter key submits
  pop.querySelector('#lpt-x').addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); pop.querySelector('#lpt-ok').click(); }
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });

  document.body.appendChild(overlay);
  document.body.appendChild(pop);
  setTimeout(() => pop.querySelector('#lpt-x')?.select(), 10);
}

// Ramer-Douglas-Peucker simplification for laser points {ry, v}
function _rdpSimplify(pts, epsilon) {
  if (pts.length <= 2) return pts;
  // Find point with max perpendicular distance from line between first and last
  const [first, last] = [pts[0], pts[pts.length - 1]];
  const dy = last.ry - first.ry, dx = last.v - first.v;
  const len = Math.sqrt(dy * dy + dx * dx);
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len === 0 ? Math.sqrt((pts[i].ry - first.ry) ** 2 + (pts[i].v - first.v) ** 2)
      : Math.abs(dy * (first.v - pts[i].v) - dx * (first.ry - pts[i].ry)) / len;
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    return [
      ..._rdpSimplify(pts.slice(0, maxIdx + 1), epsilon),
      ..._rdpSimplify(pts.slice(maxIdx), epsilon).slice(1),
    ];
  }
  return [first, last];
}

function updateSelStatus() {
  const el = document.getElementById('status-sel');
  if (!el) return;
  if (!sel.active) { el.textContent = ''; return; }
  const [lo, hi] = selTickRange();
  const mLo = Math.floor(lo / TICKS_PER_MEASURE) + 1;
  const mHi = Math.floor(hi / TICKS_PER_MEASURE) + 1;
  el.textContent = `Selection: M${mLo}–M${mHi} (${hi - lo} ticks) | Space=play sel | Ctrl+C/X/V | Ctrl+RClick=menu | Esc=clear`;
  const hint = document.getElementById('play-region-hint');
  if (hint) hint.textContent = sel.active ? '(plays selection)' : '';
}

function onRightClick(e) {
  e.preventDefault();

  // Right-click outside an open floating menu → close it and stop.
  {
    const interpMenu = document.getElementById('laser-interp-menu');
    if (interpMenu && interpMenu.style.display !== 'none' && !interpMenu.contains(e.target)) {
      interpMenu.style.display = 'none';
      return;
    }
    if (ctxMenuEl && ctxMenuEl.style.display !== 'none' && !ctxMenuEl.contains(e.target)) {
      ctxMenuEl.style.display = 'none';
      return;
    }
  }

  // Cmd/Ctrl+right-click → open the context menu. The clicked tick is
  // saved so measure-aware items ("Add BPM Change…", "Add Time Sig…")
  // can pre-fill their modal.
  if (e.ctrlKey || e.metaKey) {
    const h = getHit(e);
    _ctxMenuTick = Math.max(0, Math.round(h.tick));
    showCtxMenu(e.clientX, e.clientY);
    return;
  }

  // Shift+Right-click on a laser anchor dot → interp menu (laser tools).
  if (e.shiftKey && (tool === 'laser-l' || tool === 'laser-r')) {
    const side = tool === 'laser-l' ? 0 : 1;
    const hit  = renderer?.getLaserPointAt(e.offsetX, e.offsetY, side);
    if (hit) {
      _laserSel = { side: hit.side, sec: hit.sec, ptIndex: hit.ptIndex };
      if (renderer) {
        renderer.selectedLaserPoint = _laserSel;
        renderer.activeLaserSec     = hit.sec;
      }
      render();
      showLaserInterpMenu(e.clientX, e.clientY, hit.side, hit.sec, hit.ptIndex);
      return;
    }
  }

  // Default: erase note at cursor.
  // BT/FX tools constrain erasing to their own note type.
  const typeFilter = tool === 'bt' ? 'bt' : tool === 'fx' ? 'fx' : undefined;
  const h = getHit(e);
  if (h.laneIdx < 0) return;
  saveUndo(`Deleted at M${Math.floor(h.tick / TICKS_PER_MEASURE) + 1}`);
  eraseAt(h.laneIdx, h.tick, typeFilter);
  // Clear selection if we erased a laser
  if (!typeFilter && (h.laneIdx === 4 || h.laneIdx === 5)) {
    _laserSel = null;
    if (renderer) renderer.selectedLaserPoint = null;
  }
  render();
}

// typeFilter: 'bt' | 'fx' | undefined (undefined = erase everything)
// targetChart: optional ChartData to erase from (defaults to active global chart)
function eraseAt(laneIdx, tick, typeFilter, targetChart) {
  const ch = targetChart ?? chart;
  const isActive = (ch === chart);

  // Camera/stop events are only erased when using the dedicated erase tool
  if (!typeFilter) {
    const hitRadius = TICKS_PER_BEAT / 2;
    const prevCamLen = (ch.cameraEvents ?? []).length;
    ch.cameraEvents = (ch.cameraEvents ?? []).filter(ev => Math.abs(ev.y - tick) > hitRadius);
    const prevStopLen = (ch.stopEvents ?? []).length;
    ch.stopEvents   = (ch.stopEvents ?? []).filter(ev => !(tick >= ev.y && tick <= ev.y + ev.len));
    if (isActive) {
      if ((ch.cameraEvents ?? []).length !== prevCamLen)  updateCameraEventList();
      if ((ch.stopEvents   ?? []).length !== prevStopLen) updateStopEventList();
    }
  }

  if (laneIdx >= 0 && laneIdx <= 3) {
    if (!typeFilter || typeFilter === 'bt') ch.removeNote(ch.bt[laneIdx], tick);
    if (!typeFilter || typeFilter === 'fx') ch.removeNote(ch.fx[laneIdx <= 1 ? 0 : 1], tick);
  } else if (!typeFilter) {
    if (laneIdx === 4) ch.removeLaserAt(0, tick);
    if (laneIdx === 5) ch.removeLaserAt(1, tick);
  }
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+scroll: coarse zoom
    adjustZoom(e.deltaY < 0 ? 10 : -10);
  } else if (e.shiftKey) {
    // Shift+scroll: Ableton-style vertical zoom anchored to the tick under the cursor.
    //
    // How it works:
    //  1. Find which tick (within the column) is currently under the mouse cursor.
    //  2. Scale renderer.zoom by a smooth multiplier.
    //  3. After resize, scroll canvas-wrap so that same tick is still at the same screen Y.
    //
    // This feels exactly like Ableton track zoom: scroll up = zoom in (notes spread apart),
    // scroll down = zoom out (more chart visible), cursor position stays fixed.

    const canvasWrap = document.getElementById('canvas-wrap');
    const wrapRect   = canvasWrap.getBoundingClientRect();

    // Cursor Y relative to the viewport of canvas-wrap (0 = top of visible area)
    const screenY  = e.clientY - wrapRect.top;
    // Cursor Y relative to the canvas origin (accounts for vertical scroll)
    const canvasY  = screenY + canvasWrap.scrollTop;

    const oldZoom = renderer.zoom;
    const oldColH = renderer.colH;   // colTicks * oldZoom

    // Tick within the column that is under the cursor.
    // Canvas Y=0 is the TOP (highest tick); Y=colH is the BOTTOM (tick 0 of column).
    const tickUnderCursor = Math.max(0, (oldColH - canvasY) / oldZoom);

    // Smooth 12% per scroll notch — fine-grained like Ableton
    const FACTOR  = 1.12;
    const newZoom = Math.max(0.08, Math.min(8.0,
      e.deltaY < 0 ? oldZoom * FACTOR : oldZoom / FACTOR
    ));

    if (Math.abs(newZoom - oldZoom) > 0.0001) {
      renderer.zoom = newZoom;

      // Sync the zoom slider + label so the UI reflects the change
      const sliderVal = Math.round(newZoom / 1.2 * 100);
      const slider    = document.getElementById('zoom-slider');
      if (slider) {
        slider.value = Math.max(+slider.min, Math.min(+slider.max, sliderVal));
        const lbl = document.getElementById('zoom-label');
        if (lbl) lbl.textContent = slider.value + '%';
      }

      // Resize the canvas (sets canvas.height = newColH = colTicks * newZoom)
      renderer.resize();

      // Re-anchor: compute where tickUnderCursor lands in the new canvas and
      // set scrollTop so it appears at the same screenY.
      const newColH    = renderer.colH;                           // colTicks * newZoom
      const newCanvasY = newColH - tickUnderCursor * newZoom;     // new canvas Y of that tick
      canvasWrap.scrollTop = Math.max(0,
        Math.min(canvasWrap.scrollHeight - canvasWrap.clientHeight, newCanvasY - screenY)
      );

      render();
    }
  } else {
    const dir = e.deltaY > 0 ? -1 : 1;
    renderer.scrollCol = Math.max(0, Math.min(renderer.totalCols() - 1, renderer.scrollCol - dir));
    render();
  }
}

function updateStatusFromEvent(e) {
  const h = getHit(e);
  const tick    = Math.max(0, Math.round(h.tick));
  const measure = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const beat    = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
  document.getElementById('status-tick').textContent    = `Tick: ${tick}`;
  document.getElementById('status-measure').textContent = `Measure: ${measure}`;
  document.getElementById('status-beat').textContent    = `Beat: ${beat}`;
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
const TOOL_ORDER  = ['select', 'bt', 'fx', 'laser-l', 'laser-r', 'erase', 'cam-event', 'stop-event'];
// Snap entries: v = ticks (may be fractional), l = display label
// 192 ticks/measure; integer values: 48,24,16,12,8,6,4,3,2,1
// Sub-tick values (1.5, 0.75, 0.5, 0.375) are rounded to int by snapTick()
// RDP epsilon for freehand laser simplification (fraction of laser lane width).
// 0.018 ≈ 1.8% of the lane — keeps intentional curves while dropping noise.
const FREEHAND_RDP_EPS = 0.018;

const SNAP_ENTRIES = [
  { v: 48,    l: '1/4'   },
  { v: 24,    l: '1/8'   },
  { v: 16,    l: '1/12'  },
  { v: 12,    l: '1/16'  },
  { v: 8,     l: '1/24'  },
  { v: 6,     l: '1/32'  },
  { v: 4,     l: '1/48'  },
  { v: 3,     l: '1/64'  },
  { v: 2,     l: '1/96'  },
  { v: 1.5,   l: '1/128' },
  { v: 1,     l: '1/192' },
  { v: 0.75,  l: '1/256' },
  { v: 0.5,   l: '1/384' },
  { v: 0.375, l: '1/512' },
  { v: 0,     l: 'Free'  },
];
const SNAP_VALUES = SNAP_ENTRIES.map(e => e.v);
const SNAP_LABELS = Object.fromEntries(SNAP_ENTRIES.map(e => [e.v, e.l]));

// Laser X-axis snap grid — coarse to fine order ([ = coarser, ] = finer analog)
// ; = coarser (fewer snaps), ' = finer (more snaps)
const LASER_X_SNAP_ENTRIES = [
  { v: 0,        l: 'Free'       },
  { v: 0.5,      l: '1/2'        },
  { v: 0.25,     l: '1/4'        },
  { v: 0.125,    l: '1/8'        },
  { v: 0.0625,   l: '1/16'       },
  { v: 0.03125,  l: '1/32'       },
  { v: 0.02,     l: '1/50 (KSM)' },
];
const LASER_X_SNAP_VALUES = LASER_X_SNAP_ENTRIES.map(e => e.v);
const LASER_X_SNAP_LABELS = Object.fromEntries(LASER_X_SNAP_ENTRIES.map(e => [e.v, e.l]));

function snapLaserV(v) {
  if (laserXSnap <= 0) return v;
  return Math.max(0, Math.min(1, Math.round(v / laserXSnap) * laserXSnap));
}

let _laserXSnapDisplayTimeout = null;
function showLaserXSnapDisplay(oldSnap, newSnap, direction) {
  const display = document.getElementById('laser-xsnap-display');
  const curr    = document.getElementById('laser-xsnap-curr');
  const prev    = document.getElementById('laser-xsnap-prev');
  const next    = document.getElementById('laser-xsnap-next');
  if (!display || !curr || !prev || !next) return;

  const oldLabel = LASER_X_SNAP_LABELS[oldSnap];
  const newLabel = LASER_X_SNAP_LABELS[newSnap];
  const EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const T = '0.18s';
  const ANIM = `top ${T} ${EASE}, opacity ${T} ${EASE}`;

  [prev, curr, next].forEach(el => {
    el.style.transition = 'none'; el.style.opacity = '0'; el.style.top = '0px';
  });

  if (direction === 'up') {
    prev.textContent = oldLabel; curr.textContent = newLabel; next.textContent = '';
    prev.style.top = '0px'; prev.style.opacity = '1';
    curr.style.top = '22px'; curr.style.opacity = '0';
    requestAnimationFrame(() => {
      prev.style.transition = ANIM; curr.style.transition = ANIM;
      prev.style.top = '-22px'; prev.style.opacity = '0';
      curr.style.top = '0px'; curr.style.opacity = '1';
    });
  } else {
    next.textContent = oldLabel; curr.textContent = newLabel;
    next.style.top = '0px'; next.style.opacity = '1';
    curr.style.top = '-22px'; curr.style.opacity = '0';
    requestAnimationFrame(() => {
      next.style.transition = ANIM; curr.style.transition = ANIM;
      next.style.top = '22px'; next.style.opacity = '0';
      curr.style.top = '0px'; curr.style.opacity = '1';
    });
  }

  display.style.left = `${_lastMouseX + 18}px`;
  display.style.top  = `${_lastMouseY - 16}px`;
  display.style.display = 'block';
  clearTimeout(_laserXSnapDisplayTimeout);
  _laserXSnapDisplayTimeout = setTimeout(() => { display.style.display = 'none'; }, 1400);
}

function onKeyDown(e) {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  const ctrl = e.ctrlKey || e.metaKey;

  switch (e.key) {
    case '1': setTool('select');     break;
    case '2': setTool('bt');         break;
    case '3': setTool('fx');         break;
    case '4': setTool('laser-l');    break;
    case '5': setTool('laser-r');    break;
    case '6': setTool('cam-event');  break;
    case '7': setTool('stop-event'); break;
    case 'e': case 'E': setTool('erase'); break;
    case 'Tab': e.preventDefault(); toggleVelEnvEditor(); break;

    case 'f': case 'F':
      if (!ctrl) {
        e.preventDefault();
        toggleGameViewFullscreen();
      }
      break;

    case 'Tab':
      e.preventDefault();
      { const i = TOOL_ORDER.indexOf(tool);
        setTool(TOOL_ORDER[(i + (e.shiftKey ? -1 : 1) + TOOL_ORDER.length) % TOOL_ORDER.length]); }
      break;

    case ' ':
      e.preventDefault();
      if (sel.active && !playing) {
        const [lo, hi] = selTickRange();
        renderer.playTick = lo;
        startPlay(hi);
      } else {
        togglePlay();
      }
      break;

    case 'z': case 'Z':
      e.preventDefault();
      if (ctrl) undo();
      break;
    case 'y': case 'Y':
      e.preventDefault();
      if (ctrl) redo();
      break;

    case 's': case 'S':
      if (ctrl) { e.preventDefault();
        downloadText((chart.meta.title.replace(/[^a-zA-Z0-9_]/g,'_')||'chart')+'.ksh', exportKsh(chart)); }
      break;

    case 'h': case 'H':
      if (ctrl && e.shiftKey) {
        // Ctrl+Shift+H: Horizontal flip on selection
        e.preventDefault();
        if (sel.active) {
          const lo = Math.min(sel.startTick, sel.endTick);
          const hi = Math.max(sel.startTick, sel.endTick);
          saveUndo('Flip Horizontal');
          _pfFlipHorizontal(lo, hi, true);
          render();
        }
      } else if (!ctrl) {
        e.preventDefault();
        const hp = document.getElementById('history-panel');
        if (hp) hp.style.display = hp.style.display === 'none' ? 'flex' : 'none';
      }
      break;

    case 'd': case 'D':
      if (ctrl) { e.preventDefault(); sel.active = false; sel.dragging = false; updateSelStatus(); render(); }
      break;

    case 't': case 'T':
      // Cmd/Ctrl+T behaves like Photoshop's Free Transform when a selection
      // is active — stretches/pulls the region. Otherwise creates a new
      // blank chart in a new tab.
      if (ctrl) {
        e.preventDefault();
        if (sel.active) selTransform();
        else addTab();
      }
      break;

    case 'c': case 'C':
      if (ctrl) { e.preventDefault(); selCopy(); }
      else { e.preventDefault(); openContextMenuCenter(); }
      break;
    case 'x': case 'X':
      if (ctrl) { e.preventDefault(); selCut(); render(); } break;
    case 'v': case 'V':
      if (ctrl) { e.preventDefault(); selPaste(); } break;

    case 'Escape':
      sel.active = false; sel.dragging = false;
      if (_activeLaserSec) {
        _activeLaserSec = null;
        if (renderer) { renderer.activeLaserSec = null; renderer._laserPreview = null; }
      }
      _mirrorLaserSec = null;
      if (drag.freehand) {
        drag.freehand = false; drag.freehandPts = [];
        if (renderer) renderer.freehandPreviewPts = null;
      }
      updateSelStatus(); render(); break;

    case 'r': case 'R':
      if (ctrl && e.shiftKey) {
        // Ctrl+Shift+R: Temporal (time) reverse on selection
        e.preventDefault();
        if (sel.active) {
          const lo = Math.min(sel.startTick, sel.endTick);
          const hi = Math.max(sel.startTick, sel.endTick);
          saveUndo('Flip Vertical (Time Reverse)');
          _pfFlipTemporal(lo, hi, true, false);
          render();
        }
      }
      break;

    // Column navigation
    case 'ArrowLeft':
      e.preventDefault();
      renderer.scrollCol = Math.max(0, renderer.scrollCol - (ctrl ? renderer.numCols : 1));
      if (!playing) { renderer.playTick = renderer.scrollCol * renderer.measPerCol * TICKS_PER_MEASURE; updateSeekbar(renderer.playTick); }
      render(); break;
    case 'ArrowRight':
      e.preventDefault();
      renderer.scrollCol = Math.min(renderer.totalCols() - 1, renderer.scrollCol + (ctrl ? renderer.numCols : 1));
      if (!playing) { renderer.playTick = renderer.scrollCol * renderer.measPerCol * TICKS_PER_MEASURE; updateSeekbar(renderer.playTick); }
      render(); break;

    case 'Home':
      e.preventDefault(); stopPlay();
      renderer.scrollCol = 0; renderer.playTick = 0; updateSeekbar(0); render(); break;
    case 'End':
      e.preventDefault(); stopPlay();
      renderer.scrollCol = Math.max(0, renderer.totalCols() - renderer.numCols);
      renderer.playTick  = chart.totalTicks(); updateSeekbar(renderer.playTick); render(); break;

    case 'PageDown':
      e.preventDefault();
      renderer.scrollCol = Math.max(0, renderer.scrollCol - renderer.numCols);
      render(); break;
    case 'PageUp':
      e.preventDefault();
      renderer.scrollCol = Math.min(renderer.totalCols() - 1, renderer.scrollCol + renderer.numCols);
      render(); break;

    case '[':
      { const i = SNAP_VALUES.findIndex(v => Math.abs(v - snap) < 0.001);
        if (i < SNAP_VALUES.length - 1) {
          const oldSnap = snap;
          snap = SNAP_VALUES[i + 1];
          syncSnapUI();
          showSnapDisplay(oldSnap, snap, 'up');
        } }
      break;
    case ']':
      { const i = SNAP_VALUES.findIndex(v => Math.abs(v - snap) < 0.001);
        if (i > 0) {
          const oldSnap = snap;
          snap = SNAP_VALUES[i - 1];
          syncSnapUI();
          showSnapDisplay(oldSnap, snap, 'down');
        } }
      break;

    case ';':
      // Laser X snap — coarser (fewer grid divisions)
      { const i = LASER_X_SNAP_VALUES.findIndex(v => Math.abs(v - laserXSnap) < 0.0001);
        if (i > 0) {
          const old = laserXSnap;
          laserXSnap = LASER_X_SNAP_VALUES[i - 1];
          showLaserXSnapDisplay(old, laserXSnap, 'down');
          syncLaserXSnapUI();
        } }
      break;
    case "'":
      // Laser X snap — finer (more grid divisions)
      { const i = LASER_X_SNAP_VALUES.findIndex(v => Math.abs(v - laserXSnap) < 0.0001);
        if (i < LASER_X_SNAP_VALUES.length - 1) {
          const old = laserXSnap;
          laserXSnap = LASER_X_SNAP_VALUES[i + 1];
          showLaserXSnapDisplay(old, laserXSnap, 'up');
          syncLaserXSnapUI();
        } }
      break;

    case '=': case '+':
      if (ctrl) { e.preventDefault(); adjustZoom(+15); } break;
    case '-':
      if (ctrl) { e.preventDefault(); adjustZoom(-15); } break;

    case 'Delete': case 'Backspace':
      if (!sel.active) break;
      e.preventDefault();
      // Shift = ripple delete (close the gap by shifting downstream content).
      // No shift = delete in place — leaves everything outside the range
      // untouched.
      if (e.shiftKey) selRippleDelete();
      else            selDeleteContents();
      break;

    case 'G':
      if (e.shiftKey) { e.preventDefault(); openGotoBeatModal(); }
      break;

    case 'm': case 'M':
      if (!ctrl && e.shiftKey) {
        e.preventDefault();
        laserMirrorMode = !laserMirrorMode;
        if (!laserMirrorMode) { _mirrorLaserSec = null; }
        const mirrorCb = document.getElementById('laser-mirror-toggle');
        if (mirrorCb) mirrorCb.checked = laserMirrorMode;
        _updateMirrorHud();
        render();
      }
      break;
  }
}

// ── Laser Mirror Mode HUD ─────────────────────────────────────────────────────
// Shows a persistent badge in the top-left of the chart canvas while active.
function _updateMirrorHud() {
  let badge = document.getElementById('laser-mirror-hud');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'laser-mirror-hud';
    badge.style.cssText = [
      'position:absolute', 'top:6px', 'left:6px',
      'background:#1255e8cc', 'color:#fff',
      'font-size:11px', 'font-weight:700',
      'padding:3px 8px', 'border-radius:4px',
      'pointer-events:none', 'z-index:20',
      'letter-spacing:0.04em', 'display:none',
    ].join(';');
    badge.textContent = '⟺ MIRROR';
    const wrap = document.getElementById('canvas-wrap');
    if (wrap) wrap.style.position = wrap.style.position || 'relative';
    if (wrap) wrap.appendChild(badge);
  }
  badge.style.display = laserMirrorMode ? '' : 'none';
}

let _snapDisplayTimeout = null;
let _lastMouseX = window.innerWidth / 2;
let _lastMouseY = window.innerHeight / 2;
document.addEventListener('mousemove', e => { _lastMouseX = e.clientX; _lastMouseY = e.clientY; }, { passive: true });

function showSnapDisplay(oldSnap, newSnap, direction) {
  const display = document.getElementById('snap-display');
  const curr    = document.getElementById('snap-display-curr');
  const prev    = document.getElementById('snap-display-prev');
  const next    = document.getElementById('snap-display-next');
  if (!display || !curr || !prev || !next) return;

  const oldLabel = SNAP_LABELS[oldSnap];
  const newLabel = SNAP_LABELS[newSnap];
  const EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const T = '0.22s';
  const ANIM = `top ${T} ${EASE}, opacity ${T} ${EASE}`;

  // Disable transitions and reset ALL three to hidden so leftover state from
  // the previous animation direction doesn't bleed through as a ghost text.
  [prev, curr, next].forEach(el => {
    el.style.transition = 'none';
    el.style.opacity    = '0';
    el.style.top        = '0px';
  });

  if (direction === 'up') {
    // [ key: finer snap (1/4 → 1/8). Old exits up, new enters from below.
    curr.textContent = oldLabel; curr.style.top = '0px';   curr.style.opacity = '1';
    next.textContent = newLabel; next.style.top = '24px';  next.style.opacity = '0';
  } else {
    // ] key: coarser snap (1/8 → 1/4). Old exits down, new enters from above.
    curr.textContent = oldLabel; curr.style.top = '0px';   curr.style.opacity = '1';
    prev.textContent = newLabel; prev.style.top = '-24px'; prev.style.opacity = '0';
  }

  // Force reflow so initial positions are committed before transitions start
  display.offsetHeight;

  // Enable transitions on the relevant children and animate to final state
  if (direction === 'up') {
    curr.style.transition = ANIM; curr.style.top = '-24px'; curr.style.opacity = '0';
    next.style.transition = ANIM; next.style.top = '0px';   next.style.opacity = '1';
  } else {
    curr.style.transition = ANIM; curr.style.top = '24px'; curr.style.opacity = '0';
    prev.style.transition = ANIM; prev.style.top = '0px';  prev.style.opacity = '1';
  }

  // Position next to cursor
  display.style.left = (_lastMouseX + 16) + 'px';
  display.style.top  = (_lastMouseY - 12) + 'px';
  display.style.display = 'block';

  if (_snapDisplayTimeout) clearTimeout(_snapDisplayTimeout);
  _snapDisplayTimeout = setTimeout(() => {
    display.style.display = 'none';
    [prev, curr, next].forEach(el => { el.style.transition = 'none'; });
  }, 500);
}

function openGotoBeatModal() {
  // Remove any stale instance
  const existing = document.getElementById('go-to-beat-modal');
  if (existing) { existing.previousElementSibling?.remove(); existing.remove(); }

  // ── Helper: jump to an absolute tick ──────────────────────────────────────
  function jumpToTick(tick) {
    if (isNaN(tick) || tick < 0) return;
    const col = Math.floor(tick / (renderer.measPerCol * TICKS_PER_MEASURE));
    renderer.scrollCol = Math.max(0, Math.min(renderer.totalCols() - 1, col));
    renderer.playTick  = tick;
    updateSeekbar(tick);
    render();
    // Center the target beat vertically in canvas-wrap
    requestAnimationFrame(() => {
      const cw  = document.getElementById('canvas-wrap');
      const pos = renderer.tickToCanvas(tick);
      if (cw && pos) cw.scrollTop = Math.max(0, pos.cy - cw.clientHeight * 0.5);
    });
  }

  // ── Modal shell ───────────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id = 'go-to-beat-modal';
  modal.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:#0c0c20;border:1.5px solid #3344aa;border-radius:10px;' +
    'padding:18px 22px;z-index:99999;box-shadow:0 8px 32px #000c;' +
    'display:flex;flex-direction:column;gap:14px;min-width:260px;font-family:inherit;color:#e0e8ff';

  const inpCSS =
    'background:#161630;border:1px solid #3344aa;border-radius:4px;' +
    'color:#e0e8ff;font-size:13px;padding:6px 10px;outline:none;width:100%;box-sizing:border-box';

  // ── Section A: Go to Measure ──────────────────────────────────────────────
  const measTitle = document.createElement('div');
  measTitle.textContent = 'Go to Measure';
  measTitle.style.cssText = 'font-size:13px;font-weight:bold;color:#aabbff;letter-spacing:0.04em';

  const measRow = document.createElement('div');
  measRow.style.cssText = 'display:flex;gap:8px;align-items:center';
  const measInput = document.createElement('input');
  measInput.type = 'number'; measInput.min = '1'; measInput.placeholder = 'Measure (1-based)';
  measInput.style.cssText = inpCSS;
  const measOk = document.createElement('button');
  measOk.textContent = 'Go';
  measOk.style.cssText =
    'background:#2233aa;color:#e0e8ff;border:1px solid #3344cc;border-radius:4px;' +
    'padding:6px 14px;cursor:pointer;font-size:12px;white-space:nowrap';
  measRow.append(measInput, measOk);

  const totalMeasures = renderer?.totalCols() * renderer?.measPerCol ?? '?';
  const measHint = document.createElement('div');
  measHint.style.cssText = 'font-size:9px;color:#445;margin-top:-8px';
  measHint.textContent = `Chart has ~${Math.ceil(chart?.totalTicks?.() / TICKS_PER_MEASURE ?? 0)} measures`;

  // ── Divider ───────────────────────────────────────────────────────────────
  const divider = document.createElement('div');
  divider.style.cssText = 'border-top:1px solid #1a1a3a;margin:0 -4px';

  // ── Section B: Go to Beat ─────────────────────────────────────────────────
  const beatTitle = document.createElement('div');
  beatTitle.textContent = 'Or go to Beat';
  beatTitle.style.cssText = 'font-size:11px;font-weight:bold;color:#8899cc;letter-spacing:0.04em';

  const beatRow = document.createElement('div');
  beatRow.style.cssText = 'display:flex;gap:8px;align-items:center';
  const beatInput = document.createElement('input');
  beatInput.type = 'number'; beatInput.min = '1'; beatInput.placeholder = 'Beat (1-based)';
  beatInput.style.cssText = inpCSS.replace('font-size:13px', 'font-size:12px');
  const beatOk = document.createElement('button');
  beatOk.textContent = 'Go';
  beatOk.style.cssText =
    'background:#1a2a66;color:#aabbff;border:1px solid #2a3a88;border-radius:4px;' +
    'padding:5px 12px;cursor:pointer;font-size:12px;white-space:nowrap';
  beatRow.append(beatInput, beatOk);

  const totalBeats = Math.ceil((chart?.totalTicks?.() ?? 0) / TICKS_PER_BEAT);
  const beatHint = document.createElement('div');
  beatHint.style.cssText = 'font-size:9px;color:#445;margin-top:-8px';
  beatHint.textContent = `Chart has ~${totalBeats} beats  ·  4 beats = 1 measure`;

  // ── Cancel row ────────────────────────────────────────────────────────────
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText =
    'background:#161630;color:#778;border:1px solid #2a2a55;border-radius:4px;' +
    'padding:5px 12px;cursor:pointer;font-size:12px;align-self:flex-end';

  // ── Overlay ───────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998';

  const closeAll = () => { overlay.remove(); modal.remove(); };

  // ── Event handlers ────────────────────────────────────────────────────────
  const doMeasure = () => {
    const mNum = parseFloat(measInput.value);
    if (!isNaN(mNum) && mNum >= 1) jumpToTick(Math.round((mNum - 1) * TICKS_PER_MEASURE));
    closeAll();
  };
  const doBeat = () => {
    const bNum = parseFloat(beatInput.value);
    if (!isNaN(bNum) && bNum >= 1) jumpToTick(Math.round((bNum - 1) * TICKS_PER_BEAT));
    closeAll();
  };

  measOk.addEventListener('click', doMeasure);
  beatOk.addEventListener('click', doBeat);
  cancelBtn.addEventListener('click', closeAll);
  overlay.addEventListener('click', closeAll);

  measInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); doMeasure(); }
    if (ev.key === 'Escape') { ev.preventDefault(); closeAll(); }
    if (ev.key === 'Tab')    { ev.preventDefault(); beatInput.focus(); }
  });
  beatInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); doBeat(); }
    if (ev.key === 'Escape') { ev.preventDefault(); closeAll(); }
  });

  modal.append(measTitle, measRow, measHint, divider, beatTitle, beatRow, beatHint, cancelBtn);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  setTimeout(() => measInput.focus(), 10);
}

function syncSnapUI() {
  document.getElementById('snap-select').value = snap;
  const entry = SNAP_ENTRIES.find(e => Math.abs(e.v - snap) < 0.001);
  document.getElementById('status-tool').textContent = `Tool: ${tool}  Snap: ${entry?.l ?? snap}`;
  // Update context palette snap display (dock.js)
  if (typeof updateSnapDisplay === 'function') updateSnapDisplay(entry?.l ?? String(snap));
  syncLaserXSnapUI();
}

function syncLaserXSnapUI() {
  const el = document.getElementById('status-laser-xsnap');
  if (!el) return;
  const isLaserTool = tool === 'laser-l' || tool === 'laser-r';
  const entry = LASER_X_SNAP_ENTRIES.find(e => Math.abs(e.v - laserXSnap) < 0.0001);
  const label = entry?.l ?? 'Free';
  el.textContent = `X: ${label}`;
  el.style.display = isLaserTool ? '' : 'none';
}

function adjustZoom(delta) {
  const slider = document.getElementById('zoom-slider');
  slider.value = Math.max(+slider.min, Math.min(+slider.max, +slider.value + delta));
  renderer.zoom = +slider.value / 100 * 1.2;
  document.getElementById('zoom-label').textContent = slider.value + '%';
  renderer.resize();
  render();
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────
// saveUndo is defined later (history-panel aware version)
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(serialize()));
  const snap = undoStack.pop();
  historyCurrentIdx = Math.max(0, historyCurrentIdx - 1);
  deserialize(JSON.parse(snap));
  refreshHistoryPanel();
  render();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(serialize()));
  const snap = redoStack.pop();
  historyCurrentIdx = Math.min(historyEntries.length - 1, historyCurrentIdx + 1);
  deserialize(JSON.parse(snap));
  refreshHistoryPanel();
  render();
}
function serialize() {
  return {
    bt: chart.bt.map(l => l.map(n => ({...n}))),
    fx: chart.fx.map(l => l.map(n => ({...n}))),
    lasers: JSON.parse(JSON.stringify(chart.lasers)),
    bpmEvents: chart.bpmEvents.map(e => ({...e})),
    timeSigEvents: chart.timeSigEvents.map(e => ({...e})),
    fxChains: JSON.parse(JSON.stringify(chart.fxChains)),
    cameraEvents: JSON.parse(JSON.stringify(chart.cameraEvents ?? [])),
    stopEvents:   JSON.parse(JSON.stringify(chart.stopEvents   ?? [])),
  };
}
function deserialize(d) {
  chart.bt = d.bt.map(l => l.map(n => ({...n})));
  chart.fx = d.fx.map(l => l.map(n => ({...n})));
  chart.lasers = JSON.parse(JSON.stringify(d.lasers));
  chart.bpmEvents = d.bpmEvents.map(e => ({...e}));
  chart.timeSigEvents = d.timeSigEvents.map(e => ({...e}));
  chart.fxChains = JSON.parse(JSON.stringify(d.fxChains));
  // Restore camera & stop events if they were saved (legacy snapshots won't have them)
  if (d.cameraEvents) chart.cameraEvents = JSON.parse(JSON.stringify(d.cameraEvents));
  if (d.stopEvents)   chart.stopEvents   = JSON.parse(JSON.stringify(d.stopEvents));
  updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); renderFxChain(0); renderFxChain(1);
}

// ── Metadata sync ─────────────────────────────────────────────────────────────
function autoDetectMeasures() {
  let maxTick = 0;
  for (let li = 0; li < 4; li++) for (const n of chart.bt[li]) maxTick = Math.max(maxTick, n.y + n.len);
  for (let li = 0; li < 2; li++) for (const n of chart.fx[li]) maxTick = Math.max(maxTick, n.y + n.len);
  for (let s = 0; s < 2; s++) for (const sec of chart.lasers[s]) {
    const last = sec.points[sec.points.length - 1];
    if (last) maxTick = Math.max(maxTick, sec.y + last.ry);
  }
  for (const ev of chart.bpmEvents) maxTick = Math.max(maxTick, ev.y);
  chart.totalMeasures = Math.max(8, Math.ceil(maxTick / TICKS_PER_MEASURE) + 2);
  const el = document.getElementById('meta-measures-display');
  if (el) el.textContent = chart.totalMeasures;
  return chart.totalMeasures;
}

function syncMetaToChart() {
  const m = chart.meta;
  m.title   = document.getElementById('meta-title').value;
  m.artist  = document.getElementById('meta-artist').value;
  m.effect  = document.getElementById('meta-effect').value;
  m.illust  = document.getElementById('meta-illust').value;
  m.difficulty = document.getElementById('meta-diff').value;
  m.level   = +document.getElementById('meta-level').value;
  m.bpm     = +document.getElementById('meta-bpm').value;
  m.music   = document.getElementById('meta-music').value;
  m.offset  = +document.getElementById('meta-offset').value;
  m.previewStart    = +document.getElementById('meta-preview-start').value;
  m.previewDuration = +document.getElementById('meta-preview-dur').value;
  m.jacket  = document.getElementById('meta-jacket').value;
  m.bg      = document.getElementById('meta-bg').value;
  m.layer   = document.getElementById('meta-layer').value;
  autoDetectMeasures();
  chart.laserSettings.filter = document.getElementById('laser-filter').value;
  chart.laserSettings.gain   = +document.getElementById('laser-gain').value;
  chart.laserSettings.wide   = document.getElementById('laser-wide').checked;
  if (chart.bpmEvents[0]?.y === 0) chart.bpmEvents[0].bpm = m.bpm;
  updateBpmList();
}

function pushMeta() {
  const m = chart.meta;
  document.getElementById('meta-title').value  = m.title;
  document.getElementById('meta-artist').value = m.artist;
  document.getElementById('meta-effect').value = m.effect;
  document.getElementById('meta-illust').value = m.illust;
  document.getElementById('meta-diff').value   = m.difficulty;
  document.getElementById('meta-level').value  = m.level;
  document.getElementById('meta-bpm').value    = m.bpm;
  document.getElementById('meta-music').value  = m.music;
  document.getElementById('meta-offset').value = m.offset;
  document.getElementById('meta-preview-start').value = m.previewStart;
  document.getElementById('meta-preview-dur').value   = m.previewDuration;
  document.getElementById('meta-jacket').value = m.jacket;
  document.getElementById('meta-bg').value     = m.bg;
  document.getElementById('meta-layer').value  = m.layer || '';
  autoDetectMeasures();
  document.getElementById('laser-filter').value  = chart.laserSettings.filter;
  document.getElementById('laser-gain').value    = chart.laserSettings.gain;
  document.getElementById('laser-wide').checked  = chart.laserSettings.wide;
}

// ── Song Metadata popup ────────────────────────────────────────────────────────
function openSongMetaModal() {
  const m = chart.meta;
  document.getElementById('sm-title').value  = m.title;
  document.getElementById('sm-artist').value = m.artist;
  document.getElementById('sm-effect').value = m.effect;
  document.getElementById('sm-illust').value = m.illust;
  document.getElementById('sm-diff').value   = m.difficulty;
  document.getElementById('sm-level').value  = m.level;
  document.getElementById('sm-bpm').value    = m.bpm;
  document.getElementById('sm-music').value  = m.music;
  document.getElementById('sm-offset').value = m.offset;
  document.getElementById('sm-preview-start').value = m.previewStart;
  document.getElementById('sm-preview-dur').value   = m.previewDuration;
  document.getElementById('sm-jacket').value = m.jacket;
  document.getElementById('sm-bg').value     = m.bg;
  document.getElementById('sm-layer').value  = m.layer || '';
  // Show jacket preview if available
  const img = document.getElementById('meta-jacket-img-modal');
  const ph  = document.getElementById('meta-jacket-placeholder');
  const srcImg = document.getElementById('jacket-preview');
  if (srcImg && srcImg.src && srcImg.src !== window.location.href) {
    img.src = srcImg.src; img.style.display = 'block'; ph.style.display = 'none';
  } else { img.style.display = 'none'; ph.style.display = 'flex'; }
  document.getElementById('modal-song-meta').style.display = 'flex';
}

function saveSongMetaModal() {
  const m = chart.meta;
  m.title  = document.getElementById('sm-title').value;
  m.artist = document.getElementById('sm-artist').value;
  m.effect = document.getElementById('sm-effect').value;
  m.illust = document.getElementById('sm-illust').value;
  m.difficulty = document.getElementById('sm-diff').value;
  m.level  = +document.getElementById('sm-level').value;
  m.bpm    = +document.getElementById('sm-bpm').value;
  m.music  = document.getElementById('sm-music').value;
  m.offset = +document.getElementById('sm-offset').value;
  m.previewStart    = +document.getElementById('sm-preview-start').value;
  m.previewDuration = +document.getElementById('sm-preview-dur').value;
  m.jacket = document.getElementById('sm-jacket').value;
  m.bg     = document.getElementById('sm-bg').value;
  m.layer  = document.getElementById('sm-layer').value;
  // Only update the tick-0 BPM event if the value actually changed, to avoid
  // accidentally corrupting a tempo map that has diverged from the header BPM.
  const newBpm = +document.getElementById('sm-bpm').value;
  if (chart.bpmEvents[0]?.y === 0 && chart.bpmEvents[0].bpm !== newBpm) {
    chart.bpmEvents[0].bpm = newBpm;
    updateBpmList();
  }
  pushMeta(); // sync back to left panel
  saveUndo('Updated song metadata');
  document.getElementById('modal-song-meta').style.display = 'none';
  render();
}

// ── BPM / TimeSig event lists ─────────────────────────────────────────────────
function updateBpmList() {
  const list = document.getElementById('bpm-event-list');
  list.innerHTML = '';
  chart.bpmEvents.forEach(ev => {
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((ev.y % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.innerHTML = `<span>M${m} B${b}: <b>${ev.bpm}</b></span><button class="ev-del" data-y="${ev.y}">✕</button>`;
    row.querySelector('.ev-del').addEventListener('click', de => {
      const y = +de.target.dataset.y;
      if (y === 0) return;
      saveUndo(`Deleted BPM at M${Math.floor(y/TICKS_PER_MEASURE)+1}`); chart.bpmEvents = chart.bpmEvents.filter(e => e.y !== y);
      updateBpmList(); render();
    });
    list.appendChild(row);
  });
}

function updateTimeSigList() {
  const list = document.getElementById('timesig-event-list');
  list.innerHTML = '';
  chart.timeSigEvents.forEach(ev => {
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.innerHTML = `<span>M${ev.measure + 1}: <b>${ev.num}/${ev.den}</b></span><button class="ev-del" data-m="${ev.measure}">✕</button>`;
    row.querySelector('.ev-del').addEventListener('click', de => {
      const m = +de.target.dataset.m;
      if (m === 0) return;
      saveUndo(`Deleted Time Signature at M${m+1}`); chart.timeSigEvents = chart.timeSigEvents.filter(e => e.measure !== m);
      updateTimeSigList();
    });
    list.appendChild(row);
  });
}

function updateScrollSpeedEventList() {
  if (typeof velEnvEditor !== 'undefined' && velEnvEditor) velEnvEditor.invalidate();
  const list = document.getElementById('scroll-speed-event-list');
  if (!list) return;
  list.innerHTML = '';
  const evs = chart.scrollSpeedEvents ?? [];
  evs.forEach(ev => {
    if (ev.y === 0) return; // Don't show anchor event
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((ev.y % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const row = document.createElement('div');
    row.className = 'ev-row';
    const speedStr = ev.speed.toFixed(2).replace(/\.?0+$/, '');
    row.innerHTML = `<span>M${m} B${b}: <b>${speedStr}x</b></span><button class="ev-del" data-y="${ev.y}">✕</button>`;
    row.querySelector('.ev-del').addEventListener('click', de => {
      const y = +de.target.dataset.y;
      saveUndo(`Deleted Chart Velocity at M${Math.floor(y/TICKS_PER_MEASURE)+1}`);
      chart.removeScrollSpeedEvent(y);
      updateScrollSpeedEventList();
      render();
    });
    list.appendChild(row);
  });
}

function updateCameraEventList() {
  const list = document.getElementById('camera-event-list');
  if (!list) return;
  list.innerHTML = '';
  const evs = chart.cameraEvents ?? [];
  const CAM_COLORS = {
    zoom_top: '#00ffaa', zoom_bottom: '#00ccff', zoom_side: '#ffcc00',
    tilt: '#ff8844', center_split: '#cc88ff', lane_toggle: '#ff4466',
  };
  evs.forEach((ev, idx) => {
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((ev.y % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const pill = document.createElement('div');
    pill.className = 'cam-ev-pill';
    const col = CAM_COLORS[ev.type] ?? '#aaaaaa';
    pill.innerHTML = `<span style="color:${col};font-weight:bold">${ev.type}</span> <span style="color:#888">M${m}B${b}</span> <span style="color:#ddf">${ev.value}</span><span class="cam-ev-del" data-idx="${idx}">✕</span>`;
    pill.querySelector('.cam-ev-del').addEventListener('click', () => {
      saveUndo('Deleted camera event');
      chart.cameraEvents.splice(idx, 1);
      updateCameraEventList();
      render();
    });
    list.appendChild(pill);
  });
}

// ── Camera-pill hover popup ───────────────────────────────────────────────────

const _CAM_POPUP_COLORS = {
  zoom_top: '#00ffaa', zoom_bottom: '#00ccff', zoom_side: '#ffcc00',
  tilt: '#ff8844', center_split: '#cc88ff', lane_toggle: '#ff4466',
};
const _CAM_POPUP_LABELS = {
  zoom_top: 'Zoom Top', zoom_bottom: 'Zoom Bottom', zoom_side: 'Zoom Side',
  tilt: 'Tilt', center_split: 'Center Split', lane_toggle: 'Lane Toggle',
};
// Slider ranges per camera type
const _CAM_RANGES = {
  zoom_top:     { min: -300, max: 300, step: 5  },
  zoom_bottom:  { min: -300, max: 300, step: 5  },
  zoom_side:    { min: -300, max: 300, step: 5  },
  tilt:         { min: -3,   max: 3,   step: 0.05 },
  center_split: { min: -300, max: 300, step: 5  },
  lane_toggle:  null,  // boolean — handled separately
};

// Find which camera pill (if any) is under canvas-relative coords (cx, cy).
// Returns the first matching hit zone or null.
function _findCamPillAt(cx, cy) {
  if (!renderer?._camPillHitZones?.length) return null;
  for (const z of renderer._camPillHitZones) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

function updateGlitchEventList() {
  if (typeof velEnvEditor !== 'undefined' && velEnvEditor) velEnvEditor._gDirty = true;
  render();
}

function _findVelPillAt(cx, cy) {
  if (!renderer?._velPillHitZones?.length) return null;
  for (const z of renderer._velPillHitZones) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

function _findGlitchPillAt(cx, cy) {
  if (!renderer?._glitchPillHitZones?.length) return null;
  for (const z of renderer._glitchPillHitZones) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

function _showVelPopup(tick, clientX, clientY) {
  let pop = document.getElementById('vel-hover-popup');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'vel-hover-popup';
    pop.style.cssText = [
      'position:fixed', 'z-index:9999', 'background:#0d0d22',
      'border:1.5px solid #ff9900', 'border-radius:6px', 'padding:10px 12px',
      'min-width:200px', 'font-size:12px', 'color:#ddd',
      'box-shadow:0 4px 16px #ff990033', 'display:none',
    ].join(';');
    document.body.appendChild(pop);
    pop.addEventListener('mouseenter', () => { _velPopupPinned = true; });
    pop.addEventListener('mouseleave', () => {
      _velPopupPinned = false;
      if (_velPopupFixedTick === null) _hideVelPopup();
    });
  }

  const ev = (chart?.scrollSpeedEvents ?? []).find(e => e.y === tick);
  if (!ev) { pop.style.display = 'none'; return; }

  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const b = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

  const curInterp = ev.interp ?? 'step';
  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="color:#ff9900;font-weight:700;font-size:11px;letter-spacing:1px">CHART VELOCITY</span>
      <span style="color:#666;font-size:10px">M${m} B${b}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="color:#888;font-size:10px">×</span>
      <input type="range" id="vel-pop-slider" min="0.05" max="5" step="0.05"
        value="${ev.speed}" style="flex:1;accent-color:#ff9900">
      <input type="number" id="vel-pop-num" min="0.05" max="5" step="0.05"
        value="${ev.speed.toFixed(2)}"
        style="width:54px;background:#111;border:1px solid #333;border-radius:3px;color:#ddd;padding:2px 4px;font-size:11px">
    </div>
    <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px">
      <span style="color:#888;font-size:9px;white-space:nowrap">Transition:</span>
      <button id="vel-pop-step"   data-mode="step"
        style="flex:1;font-size:9px;padding:2px 6px;border-radius:3px;cursor:pointer;
               background:${curInterp==='step'?'#2a1e00':'#111'};
               border:1px solid ${curInterp==='step'?'#ff9900':'#444'};
               color:${curInterp==='step'?'#ff9900':'#777'}">Step</button>
      <button id="vel-pop-linear" data-mode="linear"
        style="flex:1;font-size:9px;padding:2px 6px;border-radius:3px;cursor:pointer;
               background:${curInterp==='linear'?'#2a1e00':'#111'};
               border:1px solid ${curInterp==='linear'?'#ff9900':'#444'};
               color:${curInterp==='linear'?'#ff9900':'#777'}">Linear ~</button>
    </div>
    <div style="text-align:right">
      <button id="vel-pop-del"
        style="font-size:10px;background:#3a1010;border:1px solid #aa3333;border-radius:3px;color:#ff6666;padding:2px 8px;cursor:pointer">
        Delete
      </button>
    </div>`;

  const slider = pop.querySelector('#vel-pop-slider');
  const numInp = pop.querySelector('#vel-pop-num');
  const delBtn = pop.querySelector('#vel-pop-del');

  const _sync = val => {
    const v = Math.max(0.05, Math.min(5, parseFloat(val) || 1));
    ev.speed = v;
    if (slider !== document.activeElement) slider.value = v;
    if (numInp !== document.activeElement) numInp.value = v.toFixed(2);
    updateScrollSpeedEventList();
    render();
  };
  const stepBtn   = pop.querySelector('#vel-pop-step');
  const linearBtn = pop.querySelector('#vel-pop-linear');
  const _syncInterp = (mode) => {
    saveUndo(`Chart Velocity transition → ${mode}`);
    chart.setScrollSpeedInterp(tick, mode);
    const isStep = mode === 'step';
    stepBtn.style.background   = isStep  ? '#2a1e00' : '#111';
    stepBtn.style.borderColor  = isStep  ? '#ff9900' : '#444';
    stepBtn.style.color        = isStep  ? '#ff9900' : '#777';
    linearBtn.style.background = !isStep ? '#2a1e00' : '#111';
    linearBtn.style.borderColor= !isStep ? '#ff9900' : '#444';
    linearBtn.style.color      = !isStep ? '#ff9900' : '#777';
    render();
  };
  stepBtn.addEventListener('click',   () => _syncInterp('step'));
  linearBtn.addEventListener('click', () => _syncInterp('linear'));

  slider.addEventListener('input', () => _sync(slider.value));
  numInp.addEventListener('input', () => _sync(numInp.value));
  delBtn.addEventListener('click', () => {
    saveUndo(`Deleted Chart Velocity at M${m}`);
    chart.removeScrollSpeedEvent(tick);
    updateScrollSpeedEventList();
    render();
    _velPopupFixedTick = null;
    _velPopupPinned    = false;
    _hideVelPopup();
  });

  const px = Math.min(clientX + 12, window.innerWidth  - 220);
  const py = Math.min(clientY - 10, window.innerHeight - 120);
  pop.style.left    = px + 'px';
  pop.style.top     = py + 'px';
  pop.style.display = 'block';
}

function _hideVelPopup() {
  if (_velPopupPinned || _velPopupFixedTick !== null) return;
  const pop = document.getElementById('vel-hover-popup');
  if (pop) pop.style.display = 'none';
  if (renderer) { renderer._hoveredVelTick = null; render(); }
}

let _glitchPopupPinned = false;
let _glitchPopupFixedTick = null;

function _showGlitchPopup(tick, clientX, clientY) {
  let pop = document.getElementById('glitch-hover-popup');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'glitch-hover-popup';
    pop.style.cssText = [
      'position:fixed', 'z-index:9999', 'background:#0d0518',
      'border:1.5px solid #aa44ff', 'border-radius:6px', 'padding:10px 12px',
      'min-width:180px', 'font-size:12px', 'color:#ddd',
      'box-shadow:0 4px 16px #aa44ff33', 'display:none',
    ].join(';');
    document.body.appendChild(pop);
    pop.addEventListener('mouseenter', () => { _glitchPopupPinned = true; });
    pop.addEventListener('mouseleave', () => {
      _glitchPopupPinned = false;
      if (_glitchPopupFixedTick === null) _hideGlitchPopup();
    });
  }

  const ev = (chart?.glitchEvents ?? []).find(e => e.y === tick);
  if (!ev) { pop.style.display = 'none'; return; }

  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const b = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <span style="color:#aa44ff;font-weight:700;font-size:11px;letter-spacing:1px">GLITCH</span>
      <span style="color:#666;font-size:10px">M${m} B${b}</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="color:#888;font-size:10px">Level</span>
      <input type="range" id="glitch-pop-slider" min="0" max="10" step="0.5"
        value="${ev.level}" style="flex:1;accent-color:#aa44ff">
      <input type="number" id="glitch-pop-num" min="0" max="10" step="0.5"
        value="${ev.level.toFixed(1)}"
        style="width:44px;background:#111;border:1px solid #333;border-radius:3px;color:#ddd;padding:2px 4px;font-size:11px">
    </div>
    <div style="text-align:right">
      <button id="glitch-pop-del"
        style="font-size:10px;background:#3a1010;border:1px solid #aa3333;border-radius:3px;color:#ff6666;padding:2px 8px;cursor:pointer">
        Delete
      </button>
    </div>`;

  const slider = pop.querySelector('#glitch-pop-slider');
  const numInp = pop.querySelector('#glitch-pop-num');
  const delBtn = pop.querySelector('#glitch-pop-del');

  const _sync = val => {
    const v = Math.max(0, Math.min(10, parseFloat(val) || 0));
    ev.level = v;
    if (slider !== document.activeElement) slider.value = v;
    if (numInp !== document.activeElement) numInp.value = v.toFixed(1);
    _glitchAppliedLevel = -1; // force re-apply
    _updateGlitchFromTick(renderer?.playTick ?? 0);
    updateGlitchEventList();
    render();
  };
  slider.addEventListener('input', () => _sync(slider.value));
  numInp.addEventListener('input', () => _sync(numInp.value));
  delBtn.addEventListener('click', () => {
    saveUndo(`Deleted Glitch at M${m}`);
    chart.removeGlitchEvent(tick);
    _glitchAppliedLevel = -1;
    _updateGlitchFromTick(renderer?.playTick ?? 0);
    updateGlitchEventList();
    render();
    _glitchPopupFixedTick = null;
    _glitchPopupPinned    = false;
    _hideGlitchPopup();
  });

  const px = Math.min(clientX + 12, window.innerWidth  - 200);
  const py = Math.min(clientY - 10, window.innerHeight - 100);
  pop.style.left    = px + 'px';
  pop.style.top     = py + 'px';
  pop.style.display = 'block';
}

function _hideGlitchPopup() {
  if (_glitchPopupPinned || _glitchPopupFixedTick !== null) return;
  const pop = document.getElementById('glitch-hover-popup');
  if (pop) pop.style.display = 'none';
  if (renderer) { renderer._hoveredGlitchTick = null; render(); }
}

// Build and display the hover popup for all camera events at `tick`.
// Positioned near (clientX, clientY) in viewport space.
function _showCamPopup(tick, clientX, clientY) {
  const pop = document.getElementById('cam-hover-popup');
  if (!pop) return;

  const eventsAtTick = (chart?.cameraEvents ?? [])
    .map((ev, i) => ({ ev, i }))
    .filter(({ ev }) => ev.y === tick);
  if (!eventsAtTick.length) { pop.style.display = 'none'; return; }

  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const b = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

  let html = `<div class="cam-pop-header">M${m} &mdash; beat ${b}<button class="cam-pop-close" title="Close">✕</button></div>`;

  for (const { ev, i } of eventsAtTick) {
    const col    = _CAM_POPUP_COLORS[ev.type] ?? '#aaa';
    const label  = _CAM_POPUP_LABELS[ev.type] ?? ev.type;
    const range  = _CAM_RANGES[ev.type];
    const numVal = parseFloat(ev.value);
    const isNum  = !isNaN(numVal) && range !== null;

    html += `<div class="cam-pop-row">`;
    html += `<div class="cam-pop-title"><span class="cam-pop-dot" style="background:${col}"></span>`;
    html += `<span class="cam-pop-label" style="color:${col}">${label}</span></div>`;

    if (range === null) {
      // Boolean toggle (lane_toggle)
      const on = ev.value !== '0' && ev.value !== '';
      html += `<div class="cam-pop-ctrl">`;
      html += `<button class="cam-pop-toggle${on ? ' active' : ''}" data-idx="${i}">${on ? 'ON' : 'OFF'}</button>`;
      html += `</div>`;
    } else {
      // Numeric: slider + number input
      const curVal = isNum ? numVal : 0;
      html += `<div class="cam-pop-ctrl">`;
      html += `<span class="cam-pop-range-min">${range.min}</span>`;
      html += `<input type="range" class="cam-pop-slider" data-idx="${i}"
                 min="${range.min}" max="${range.max}" step="${range.step}"
                 value="${curVal}" style="--col:${col}">`;
      html += `<span class="cam-pop-range-max">${range.max}</span>`;
      html += `<input type="number" class="cam-pop-num" data-idx="${i}"
                 min="${range.min}" max="${range.max}" step="${range.step}"
                 value="${curVal}">`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  pop.innerHTML = html;

  // ── Wire up controls ──────────────────────────────────────────────────────
  const _syncAndRender = (idx, val) => {
    const v = Math.max(
      _CAM_RANGES[chart.cameraEvents[idx]?.type]?.min ?? -300,
      Math.min(_CAM_RANGES[chart.cameraEvents[idx]?.type]?.max ?? 300, parseFloat(val) || 0)
    );
    chart.cameraEvents[idx].value = String(v);
    // Sync sibling controls
    pop.querySelectorAll(`[data-idx="${idx}"]`).forEach(el => {
      if (el !== document.activeElement) el.value = v;
    });
    updateCameraEventList();
    render();
  };

  pop.querySelectorAll('.cam-pop-slider').forEach(sl => {
    sl.addEventListener('input', () => _syncAndRender(+sl.dataset.idx, sl.value));
  });
  pop.querySelectorAll('.cam-pop-num').forEach(ni => {
    ni.addEventListener('input', () => _syncAndRender(+ni.dataset.idx, ni.value));
  });
  pop.querySelectorAll('.cam-pop-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const cur = chart.cameraEvents[idx].value;
      chart.cameraEvents[idx].value = (cur === '0' || cur === '') ? '1' : '0';
      btn.textContent = chart.cameraEvents[idx].value === '0' ? 'OFF' : 'ON';
      btn.classList.toggle('active', chart.cameraEvents[idx].value !== '0');
      updateCameraEventList(); render();
    });
  });

  // ── Position popup near cursor, keeping it fully on-screen ───────────────
  pop.style.display = 'block';
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let px = clientX + 16, py = clientY - 8;
  if (px + pr.width  > vw - 6) px = clientX - pr.width - 12;
  if (py + pr.height > vh - 6) py = Math.max(4, clientY - pr.height);
  pop.style.left = px + 'px';
  pop.style.top  = py + 'px';
}

function _hideCamPopup() {
  const pop = document.getElementById('cam-hover-popup');
  if (pop) pop.style.display = 'none';
}

// ── FX hold click popup ───────────────────────────────────────────────────────

function _findFxHoldAt(cx, cy) {
  if (!renderer?._fxHoldHitZones?.length) return null;
  for (const z of renderer._fxHoldHitZones) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

function _showFxPopup(li, clientX, clientY) {
  const pop = document.getElementById('fx-hold-popup');
  if (!pop) return;
  const chain = chart?.fxChains?.[li];
  if (!chain?.length) { pop.style.display = 'none'; return; }

  const laneName = li === 0 ? 'FX-L' : 'FX-R';
  let html = `<div class="cam-pop-header">${laneName} Effect<button class="cam-pop-close" title="Close">✕</button></div>`;

  chain.forEach((inst, idx) => {
    const def = EFFECT_DEFS[inst.type];
    if (!def) return;
    html += `<div class="fx-pop-effect-title">${def.label}</div>`;
    for (const [k, p] of Object.entries(def.params)) {
      const val = inst.params[k] ?? p.def;
      html += `<div class="cam-pop-row">`;
      html += `<div class="cam-pop-title"><span class="cam-pop-label">${p.label}</span></div>`;
      html += `<div class="cam-pop-ctrl">`;
      if (p.min !== undefined) {
        html += `<span class="cam-pop-range-min">${p.min}</span>`;
        html += `<input type="range" class="cam-pop-slider fx-pop-slider" data-chain="${li}" data-idx="${idx}" data-key="${k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">`;
        html += `<span class="cam-pop-range-max">${p.max}</span>`;
        html += `<input type="number" class="cam-pop-num fx-pop-num" data-chain="${li}" data-idx="${idx}" data-key="${k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">`;
        html += `<span class="fx-pop-unit">${p.unit || ''}</span>`;
      }
      html += `</div></div>`;
    }
  });

  pop.innerHTML = html;

  // Wire sliders and number inputs
  const sync = (li, idx, k, val) => {
    const inst = chart.fxChains[li]?.[idx];
    if (!inst) return;
    const def = EFFECT_DEFS[inst.type];
    const p = def?.params?.[k];
    if (!p) return;
    const v = Math.max(p.min, Math.min(p.max, parseFloat(val) || 0));
    inst.params[k] = v;
    pop.querySelectorAll(`[data-chain="${li}"][data-idx="${idx}"][data-key="${k}"]`)
       .forEach(el => { if (el !== document.activeElement) el.value = v; });
    renderFxChain(li);
  };
  pop.querySelectorAll('.fx-pop-slider').forEach(sl => {
    sl.addEventListener('input', () => sync(+sl.dataset.chain, +sl.dataset.idx, sl.dataset.key, sl.value));
  });
  pop.querySelectorAll('.fx-pop-num').forEach(ni => {
    ni.addEventListener('input', () => sync(+ni.dataset.chain, +ni.dataset.idx, ni.dataset.key, ni.value));
  });
  pop.querySelector('.cam-pop-close')?.addEventListener('click', () => {
    _fxPopupFixedLane = null;
    _hideFxPopup();
    if (renderer) { renderer._hoveredFxHold = null; render(); }
  });

  // Position popup near cursor, keeping it fully on-screen
  pop.style.display = 'block';
  const pr = pop.getBoundingClientRect();
  let px = clientX + 16, py = clientY - 8;
  if (px + pr.width  > window.innerWidth  - 6) px = clientX - pr.width - 12;
  if (py + pr.height > window.innerHeight - 6) py = Math.max(4, clientY - pr.height);
  pop.style.left = px + 'px'; pop.style.top = py + 'px';
}

function _hideFxPopup() {
  const pop = document.getElementById('fx-hold-popup');
  if (pop) pop.style.display = 'none';
}

function updateStopEventList() {
  const list = document.getElementById('stop-event-list');
  if (!list) return;
  list.innerHTML = '';
  const evs = chart.stopEvents ?? [];
  evs.forEach((ev, idx) => {
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const pill = document.createElement('div');
    pill.className = 'stop-ev-pill';
    pill.innerHTML = `<span>M${m}</span> <span style="color:#ffaaaa">${ev.len}t</span><span class="stop-ev-del" data-idx="${idx}">✕</span>`;
    pill.querySelector('.stop-ev-del').addEventListener('click', () => {
      saveUndo('Deleted stop event');
      chart.stopEvents.splice(idx, 1);
      updateStopEventList();
      render();
    });
    list.appendChild(pill);
  });
}

// ── FX Chain UI ───────────────────────────────────────────────────────────────
function renderFxChain(side) {
  const id = side === 0 ? 'fx-chain-l' : 'fx-chain-r';
  const el = document.getElementById(id);
  el.innerHTML = '';
  chart.fxChains[side].forEach((inst, idx) => {
    const def = EFFECT_DEFS[inst.type];
    if (!def) return;
    const slot = document.createElement('div');
    slot.className = 'fx-slot';
    const hdr = document.createElement('div');
    hdr.className = 'fx-slot-header';
    const led = document.createElement('div');
    led.className = 'fx-led' + (inst.enabled ? '' : ' off');
    led.addEventListener('click', ev => { ev.stopPropagation(); inst.enabled = !inst.enabled; led.className = 'fx-led' + (inst.enabled ? '' : ' off'); });
    const name = document.createElement('span');
    name.className = 'fx-name'; name.textContent = def.label;
    const rm = document.createElement('button');
    rm.className = 'fx-remove'; rm.textContent = '✕';
    rm.addEventListener('click', ev => { ev.stopPropagation(); saveUndo('Removed FX Effect'); chart.fxChains[side].splice(idx, 1); renderFxChain(side); });
    hdr.append(led, name, rm);
    const params = document.createElement('div');
    params.className = 'fx-params';
    for (const [k, p] of Object.entries(def.params)) {
      const row = document.createElement('div'); row.className = 'fx-param-row';
      const lbl = document.createElement('label'); lbl.textContent = p.label;
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = p.min; slider.max = p.max; slider.step = p.step; slider.value = inst.params[k] ?? p.def;
      const val = document.createElement('span'); val.textContent = slider.value + (p.unit || '');
      slider.addEventListener('input', () => { inst.params[k] = +slider.value; val.textContent = slider.value + (p.unit || ''); });
      row.append(lbl, slider, val); params.appendChild(row);
    }
    hdr.addEventListener('click', () => params.classList.toggle('open'));
    slot.append(hdr, params); el.appendChild(slot);
  });
}

// downloadText is defined in ksh.js

// ── History Panel ─────────────────────────────────────────────────────────────
// Each entry: { label, snapshot (JSON string) }
const historyEntries = [];
let historyCurrentIdx = -1; // index into historyEntries of current state

export function saveUndo(label = null) {
  const snap = JSON.stringify(serialize());
  const m = Math.floor((renderer?.playTick ?? 0) / TICKS_PER_MEASURE) + 1;
  const entry = { label: label ?? `Edit @ M${m}`, snap };
  // Prune any "future" entries (redos) when a new action is taken
  historyEntries.splice(historyCurrentIdx + 1);
  historyEntries.push(entry);
  if (historyEntries.length > MAX_UNDO) historyEntries.shift();
  historyCurrentIdx = historyEntries.length - 1;
  // Keep legacy stacks in sync for undo/redo
  undoStack.push(snap);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  _hasUnsavedChanges = true;
  refreshHistoryPanel();
  _scheduleAutosave(); // queue a background autosave after each edit
}

function initHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (!panel) return;

  // Make draggable by header
  const hdr = panel.querySelector('.float-panel-header');
  let _dx = 0, _dy = 0, _dragging = false;
  hdr.addEventListener('mousedown', ev => {
    if (ev.target.closest('button, input, select')) return;
    _dragging = true;
    _dx = ev.clientX - panel.offsetLeft;
    _dy = ev.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', ev => {
    if (!_dragging) return;
    panel.style.left = (ev.clientX - _dx) + 'px';
    panel.style.top  = (ev.clientY - _dy) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { _dragging = false; });

  // Close button
  document.getElementById('history-panel-close')?.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Tab switching
  panel.querySelectorAll('.fpanel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.fpanel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      document.getElementById('fpanel-history').style.display   = which === 'history'   ? '' : 'none';
      document.getElementById('fpanel-split-opts').style.display = which === 'split-opts' ? '' : 'none';
    });
  });

  // Window menu buttons
  document.getElementById('btn-gameplay-panel')?.addEventListener('click', () => {
    if (typeof toggleGameplayPanel === 'function') toggleGameplayPanel();
  });
  document.getElementById('btn-tools-window')?.addEventListener('click', () => {
    if (typeof dockToggle === 'function') dockToggle('tools-hub');
    else if (typeof openToolsWindow === 'function') openToolsWindow();
  });
  document.getElementById('btn-radar-window')?.addEventListener('click', () => {
    if (typeof openRadarWindow === 'function') openRadarWindow();
  });
  document.getElementById('btn-heatmap-window')?.addEventListener('click', () => {
    if (typeof openHeatmapWindow === 'function') openHeatmapWindow();
  });
  document.getElementById('btn-handsim-window')?.addEventListener('click', () => {
    if (typeof openHandSimWindow === 'function') openHandSimWindow();
  });
  document.getElementById('btn-fxauto-window')?.addEventListener('click', () => {
    if (typeof openFxAutoWindow === 'function') openFxAutoWindow();
  });
  document.getElementById('btn-history-panel')?.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('btn-split-opts')?.addEventListener('click', () => {
    panel.style.display = 'flex';
    // Switch to split-opts tab
    panel.querySelectorAll('.fpanel-tab').forEach(t => t.classList.remove('active'));
    panel.querySelector('[data-tab="split-opts"]')?.classList.add('active');
    document.getElementById('fpanel-history').style.display    = 'none';
    document.getElementById('fpanel-split-opts').style.display = '';
  });

  // Split view option controls
  const laneSlider = document.getElementById('split-lane-count');
  const laneLabel  = document.getElementById('split-lane-label');
  laneSlider?.addEventListener('input', () => {
    const val = Math.max(1, +laneSlider.value);
    prefs.measPerCol = val;
    laneLabel.textContent = val + ' lanes';
    // split-lane-count is "measures per column" — convert to beats and apply
    if (renderer) {
      renderer.measPerCol = val;
      applyBeatsPerLane(renderer.beatsPerCol);
    }
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
  });

  const widthSlider = document.getElementById('split-edit-width');
  const widthLabel  = document.getElementById('split-edit-width-label');
  widthSlider?.addEventListener('input', () => {
    const val = +widthSlider.value;
    prefs.splitEditWidth = val;
    widthLabel.textContent = val + '%';
    const main = document.getElementById('main');
    const gameWrap = document.getElementById('game-wrap');
    if (main && gameWrap && viewMode === 'split') {
      main.style.flex    = val;
      gameWrap.style.flex = (100 - val) + '';
    }
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
  });

  refreshHistoryPanel();
}

function refreshHistoryPanel() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '';
  if (!historyEntries.length) {
    list.innerHTML = '<div style="padding:12px;font-size:11px;color:#5558a0;text-align:center">No history yet</div>';
    return;
  }
  historyEntries.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'history-entry' +
      (i === historyCurrentIdx ? ' current' : '') +
      (i >  historyCurrentIdx ? ' future'  : '');
    div.innerHTML = `<span class="history-entry-idx">${i + 1}</span>
      <span class="history-entry-icon">${i === historyCurrentIdx ? '▶' : '○'}</span>
      <span>${entry.label}</span>`;
    div.addEventListener('click', () => jumpHistory(i));
    list.appendChild(div);
  });
  // Scroll current into view
  list.querySelectorAll('.history-entry.current')[0]?.scrollIntoView({ block: 'nearest' });
}

function jumpHistory(idx) {
  if (idx < 0 || idx >= historyEntries.length) return;
  historyCurrentIdx = idx;
  deserialize(JSON.parse(historyEntries[idx].snap));
  render();
  refreshHistoryPanel();
}

// ── Preferences ───────────────────────────────────────────────────────────────
// Global rendering quality flag — read by renderer.js and game.js at draw time.
// true  = full glow/shadow effects (GPU-heavy)
// false = flat rendering, no shadowBlur (fast, accurate for flat preview)
let highQualityRendering = true;

const prefs = {
  // Audio
  audioDelay:       0,      // ms — global audio offset for monitor latency
  tickEnabled:      true,   // tick sounds on by default
  volMaster:        0.85,   // master bus
  volMusic:         0.80,   // song track
  volSlam:          0.28,   // laser slam scratch sound
  volTick:          0.22,   // BT/FX hit tick
  // Video
  videoDelay:       0,      // ms — display offset
  fpsCap:           60,
  highQuality:      true,
  showLaserDir:     true,
  showLaserDots:    false,
  // General
  language:         'en',
  // Gameplay
  autoplay:         true,   // game preview auto-plays score chain
  slamThreshold:    12,     // LASER_SLAM_TICKS (≤1/16 note by default)
  defaultSnap:      8,      // default snap divisor
  // Editor UI
  zoom:             100,    // editor zoom level (20-500%)
  beatsPerLane:     16,     // beats displayed per lane column
  measPerCol:       4,      // measures per column in split view
  splitEditWidth:   50,     // editor/game split view width ratio
  // Autosave / history
  autosaveInterval: 60,
  savePath:         'Downloads',
  historyDepth:     100,
  // Experimental
  anomalyDetect:    false,
  predictAssist:    false,
  ghostTrace:       false,
  physicsLaser:     false,
  snapToTransients: false,
  fxAutoVis:        false,
  minimapVisible:   false,
};
let _autosaveTimer = null;

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('vibe-editr-prefs') || '{}');
    Object.assign(prefs, saved);
  } catch(e) {}
  applyPreferences();

  // ── Wire preferences modal ───────────────────────────────────────────────
  document.getElementById('btn-preferences')?.addEventListener('click', openPreferences);
  document.getElementById('pref-save')?.addEventListener('click', savePreferences);
  document.getElementById('pref-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-prefs').style.display = 'none';
  });

  // Tab switching in System Preferences
  document.querySelectorAll('.sysprefs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sysprefs-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sysprefs-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pref-tab-' + btn.dataset.tab)?.classList.add('active');
    });
  });

  // Live-update labels for prefs sliders
  const _liveSlider = (id, lblId, fmt) => {
    const sl = document.getElementById(id);
    const lb = document.getElementById(lblId);
    if (!sl || !lb) return;
    sl.addEventListener('input', () => { lb.textContent = fmt(+sl.value); });
  };
  _liveSlider('pref-vol-master',        'pref-vol-master-label',        v => Math.round(v*100) + '%');
  _liveSlider('pref-vol-music',         'pref-vol-music-label',         v => Math.round(v*100) + '%');
  _liveSlider('pref-vol-slam',          'pref-vol-slam-label',          v => Math.round(v*100) + '%');
  _liveSlider('pref-vol-tick',          'pref-vol-tick-label',          v => Math.round(v*100) + '%');
  _liveSlider('pref-slam-threshold',    'pref-slam-threshold-label',    v => v + ' ticks');
  _liveSlider('pref-laser-opacity',     'pref-laser-opacity-label',     v => v + '%');

  // Reset to defaults button
  document.getElementById('btn-reset-prefs-defaults')?.addEventListener('click', _resetPrefsDefaults);

  // Live language switch — apply translations immediately when the user picks a language
  document.getElementById('pref-language')?.addEventListener('change', e => {
    if (typeof applyLocalization === 'function') applyLocalization(e.target.value);
  });
}

function openPreferences() {
  // ── Audio ──────────────────────────────────────────────
  _setEl('pref-audio-delay',  prefs.audioDelay);
  _setChk('pref-tick-enabled', prefs.tickEnabled !== false);
  _setVol('pref-vol-master', prefs.volMaster, 'pref-vol-master-label');
  _setVol('pref-vol-music',  prefs.volMusic,  'pref-vol-music-label');
  _setVol('pref-vol-slam',   prefs.volSlam,   'pref-vol-slam-label');
  _setVol('pref-vol-tick',   prefs.volTick,   'pref-vol-tick-label');
  // ── Video ──────────────────────────────────────────────
  _setEl('pref-video-delay',       prefs.videoDelay);
  _setEl('pref-fps-cap',           prefs.fpsCap);
  _setChk('pref-high-quality',     prefs.highQuality !== false);
  _setChk('pref-show-laser-dir',   prefs.showLaserDir !== false);
  _setChk('pref-show-laser-dots',  !!prefs.showLaserDots);
  const opSl  = document.getElementById('pref-laser-opacity');
  const opLbl = document.getElementById('pref-laser-opacity-label');
  if (opSl)  opSl.value = Math.round(laserOpacity * 100);
  if (opLbl) opLbl.textContent = Math.round(laserOpacity * 100) + '%';
  _setEl('pref-laser-color-l', laserColors.L);
  _setEl('pref-laser-color-r', laserColors.R);
  const swL = document.getElementById('lcp-swatch-l');
  const swR = document.getElementById('lcp-swatch-r');
  if (swL) swL.style.background = laserColors.L;
  if (swR) swR.style.background = laserColors.R;
  // ── General ────────────────────────────────────────────
  _setEl('pref-language', prefs.language || 'en');
  // ── Gameplay ───────────────────────────────────────────
  _setChk('pref-autoplay', prefs.autoplay !== false);
  const stSl  = document.getElementById('pref-slam-threshold');
  const stLbl = document.getElementById('pref-slam-threshold-label');
  if (stSl)  { stSl.value = prefs.slamThreshold; }
  if (stLbl) { stLbl.textContent = prefs.slamThreshold + ' ticks'; }
  _setEl('pref-default-snap', prefs.defaultSnap);
  // ── Autosave ───────────────────────────────────────────
  _setEl('pref-autosave-interval', prefs.autosaveInterval);
  _setEl('pref-save-path',         prefs.savePath);
  _setEl('pref-history-depth',     prefs.historyDepth);

  document.getElementById('modal-prefs').style.display = 'flex';
}

function savePreferences() {
  // ── Audio ──────────────────────────────────────────────
  prefs.audioDelay   = +(_el('pref-audio-delay')?.value  ?? 0);
  prefs.tickEnabled  = !!_chk('pref-tick-enabled');
  prefs.volMaster    = +(_el('pref-vol-master')?.value    ?? 1);
  prefs.volMusic     = +(_el('pref-vol-music')?.value     ?? 1);
  prefs.volSlam      = +(_el('pref-vol-slam')?.value      ?? 0.5);
  prefs.volTick      = +(_el('pref-vol-tick')?.value      ?? 0.5);
  // ── Video ──────────────────────────────────────────────
  prefs.videoDelay   = +(_el('pref-video-delay')?.value   ?? 0);
  prefs.fpsCap       = +(_el('pref-fps-cap')?.value       ?? 60);
  prefs.highQuality  = !!_chk('pref-high-quality');
  prefs.showLaserDir = !!_chk('pref-show-laser-dir');
  prefs.showLaserDots = !!_chk('pref-show-laser-dots');
  // ── General ────────────────────────────────────────────
  prefs.language     = _el('pref-language')?.value || 'en';
  // ── Gameplay ───────────────────────────────────────────
  prefs.autoplay      = !!_chk('pref-autoplay');
  prefs.slamThreshold = +(_el('pref-slam-threshold')?.value ?? 6);
  prefs.defaultSnap   = +(_el('pref-default-snap')?.value   ?? 8);
  // ── Autosave ───────────────────────────────────────────
  prefs.autosaveInterval = +(_el('pref-autosave-interval')?.value ?? 60);
  prefs.savePath         =   _el('pref-save-path')?.value         ?? 'Downloads';
  prefs.historyDepth     = +(_el('pref-history-depth')?.value     ?? 100);

  savePrefsToLocalStorage();
  applyPreferences();
  document.getElementById('modal-prefs').style.display = 'none';
}

function savePrefsToLocalStorage() {
  try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
}

// ── Tiny DOM helpers used by prefs ───────────────────────────────────────────
const _el  = id => document.getElementById(id);
const _chk = id => document.getElementById(id)?.checked;
const _setEl  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
const _setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
const _setVol = (id, v, lblId) => {
  const el = document.getElementById(id);
  if (el) { el.value = v; }
  const lb = document.getElementById(lblId);
  if (lb) lb.textContent = Math.round(v * 100) + '%';
};

function _resetPrefsDefaults() {
  if (!confirm(t('general.resetConfirm'))) return;
  Object.assign(prefs, {
    audioDelay: 0, tickEnabled: true, volMaster: 1, volMusic: 1, volSlam: 0.5, volTick: 0.5,
    videoDelay: 0, fpsCap: 60, highQuality: true, showLaserDir: true, showLaserDots: false,
    language: 'en', autoplay: true, slamThreshold: 12, defaultSnap: 8,
    autosaveInterval: 60, savePath: 'Downloads', historyDepth: 100,
  });
  localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs));
  applyPreferences();
  openPreferences(); // re-populate UI
}

function applyPreferences() {
  MAX_UNDO = prefs.historyDepth;
  highQualityRendering = prefs.highQuality !== false;

  // Keep the delay DOM inputs in sync so the prefs panel always shows the live values
  const adEl = document.getElementById('pref-audio-delay');
  const vdEl = document.getElementById('pref-video-delay');
  if (adEl && document.activeElement !== adEl) adEl.value = prefs.audioDelay ?? 0;
  if (vdEl && document.activeElement !== vdEl) vdEl.value = prefs.videoDelay ?? 0;

  // Editor UI settings
  const zoomSlider = document.getElementById('zoom-slider');
  if (zoomSlider) {
    zoomSlider.value = prefs.zoom ?? 100;
    if (renderer) {
      renderer.zoom = (+zoomSlider.value / 100) * 1.2;
      renderer.resize();
    }
  }

  const bplSlider = document.getElementById('beats-per-lane');
  if (bplSlider) {
    bplSlider.value = prefs.beatsPerLane ?? 16;
    if (typeof applyBeatsPerLane === 'function') {
      applyBeatsPerLane(+bplSlider.value);
    }
  }

  const measPerColInput = document.getElementById('meas-per-col');
  if (measPerColInput) {
    measPerColInput.value = prefs.measPerCol ?? 4;
  }

  const splitLaneSlider = document.getElementById('split-lane-count');
  if (splitLaneSlider) {
    splitLaneSlider.value = prefs.measPerCol ?? 4;
    const laneLabel = document.getElementById('split-lane-label');
    if (laneLabel) laneLabel.textContent = splitLaneSlider.value + ' lanes';
  }

  const splitWidthSlider = document.getElementById('split-edit-width');
  if (splitWidthSlider) {
    splitWidthSlider.value = prefs.splitEditWidth ?? 50;
    const widthLabel = document.getElementById('split-edit-width-label');
    if (widthLabel) widthLabel.textContent = splitWidthSlider.value + '%';
  }

  // Slam threshold (1–16 ticks)
  setLaserSlamTicks(prefs.slamThreshold ?? 6);

  // Tick sound enabled gate (used by detectFxHits/detectBtHits via settings.tickSound)
  settings.tickSound = !!prefs.tickEnabled;
  const stEl = document.getElementById('setting-tick');
  if (stEl) stEl.checked = settings.tickSound;

  // Volume nodes
  if (masterGainNode) masterGainNode.gain.value = prefs.volMaster ?? 1.0;
  if (musicGainNode)  musicGainNode.gain.value  = prefs.volMusic  ?? 1.0;
  if (slamGainNode)   slamGainNode.gain.value   = prefs.volSlam   ?? 0.5;
  if (tickGainNode)   tickGainNode.gain.value   = prefs.volTick   ?? 0.5;

  // Sync menu volume sliders with prefs
  const _syncSidebar = (id, lblId, v) => {
    const sl = document.getElementById(id);
    const lb = document.getElementById(lblId);
    if (sl) sl.value = v;
    if (lb) lb.textContent = Math.round(v * 100) + '%';
  };
  _syncSidebar('vol-master', 'vol-master-label', prefs.volMaster ?? 1);
  _syncSidebar('vol-music',  'vol-music-label',  prefs.volMusic  ?? 1);
  _syncSidebar('vol-slam',   'vol-slam-label',   prefs.volSlam   ?? 0.5);
  _syncSidebar('vol-tick',   'vol-tick-label',   prefs.volTick   ?? 0.5);

  // Show laser anchor dots in 2D editor always
  if (renderer) renderer.showLaserDots = prefs.showLaserDots ?? false;

  // Default snap divisor — apply to global snap variable
  // 4 → 1/4 (48 ticks), 8 → 1/8 (24), 16 → 1/16 (12), 32 → 1/32 (6)
  const snapMap = { 4: 48, 8: 24, 16: 12, 32: 6 };
  if (typeof snap !== 'undefined' && snapMap[prefs.defaultSnap]) {
    snap = snapMap[prefs.defaultSnap];
    if (typeof syncSnapUI === 'function') try { syncSnapUI(); } catch(_) {}
  }

  // Autosave
  if (_autosaveTimer) clearInterval(_autosaveTimer);
  if (prefs.autosaveInterval > 0) {
    _autosaveTimer = setInterval(() => _idbAutosave(), prefs.autosaveInterval * 1000);
  }

  // Localization
  if (typeof applyLocalization === 'function') applyLocalization(prefs.language || 'en');

  // FX Automation overlay checkbox sync
  const fxAutoVisCb = document.getElementById('fxauto-vis-toggle');
  if (fxAutoVisCb) fxAutoVisCb.checked = !!prefs.fxAutoVis;

  // Chart Minimap sync
  minimapVisible = !!prefs.minimapVisible;
  _applyMinimapVisibility();
}

// ── IndexedDB autosave ────────────────────────────────────────────────────────
let _idb = null;

function _openIDB() {
  if (_idb && _idb.objectStoreNames.contains('autosave')) return Promise.resolve(_idb);
  return new Promise((res, rej) => {
    // Use version 2 to ensure fresh object store creation if needed
    const req = indexedDB.open('vibe-editr', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('autosave')) {
        db.createObjectStore('autosave');
      }
    };
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = e => { console.warn('IDB open failed:', e.target.error); rej(e.target.error); };
    req.onblocked = () => { console.warn('IDB blocked — close other tabs'); };
  });
}

// Properly await the IDB put transaction
function _idbPut(db, key, data) {
  return new Promise((res, rej) => {
    const tx  = db.transaction('autosave', 'readwrite');
    const req = tx.objectStore('autosave').put(data, key);
    tx.oncomplete = () => res();
    tx.onerror    = e  => rej(e.target.error);
    tx.onabort    = e  => rej(e.target.error);
  });
}

function _idbGet(db, key) {
  return new Promise((res, rej) => {
    const tx  = db.transaction('autosave', 'readonly');
    const req = tx.objectStore('autosave').get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror   = e  => rej(e.target.error);
  });
}

async function _idbAutosave() {
  // Never stall the audio/RAF thread during playback — defer to after stop
  if (playing) {
    _pendingAutosaveAfterPlay = true;
    return;
  }
  try {
    // Use KSON for autosave to preserve all time signatures and measures.
    // KSON is spec-compliant and round-trips perfectly.
    const kson = await new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(exportKson(chart)), { timeout: 3000 });
      } else {
        setTimeout(() => resolve(exportKson(chart)), 0);
      }
    });
    const db   = await _openIDB();
    const data = {
      kson,
      format: 'kson',  // marker so restore knows which importer to use
      title:      chart.meta.title || 'Untitled',
      audioName:  chart.meta.music || null,
      ts:         Date.now(),
    };
    await _idbPut(db, 'latest', data);
    // Also persist the raw audio bytes so they survive a page reload
    if (audioArrayBuffer) {
      await _idbPut(db, 'audio', audioArrayBuffer.slice(0)).catch(() => {});
    }
    // Mark as saved
    _hasUnsavedChanges = false;
    // Flash status bar
    const st = document.getElementById('audio-status');
    if (st) {
      const prev = st.textContent;
      st.textContent = '✔ Autosaved';
      setTimeout(() => { if (st.textContent === '✔ Autosaved') st.textContent = prev; }, 2000);
    }
  } catch(e) { console.warn('Autosave failed:', e); }
}

async function _idbRestore() {
  try {
    const db = await _openIDB();
    return await _idbGet(db, 'latest');
  } catch(e) { console.warn('Restore failed:', e); return null; }
}

// Debounced autosave — called on every saveUndo (max once per 10s)
let _autosaveDebounce = null;
function _scheduleAutosave() {
  if (_autosaveDebounce) clearTimeout(_autosaveDebounce);
  _autosaveDebounce = setTimeout(() => { _autosaveDebounce = null; _idbAutosave(); }, 10000);
}

// Recover last autosave (File menu / Preferences button)
async function recoverAutosave() {
  const data = await _idbRestore();
  if (!data) {
    alert('No autosave found.\n\nAutosaves happen automatically after each edit (10-second debounce) and periodically via the interval in Preferences.');
    return;
  }
  const ago  = Math.round((Date.now() - data.ts) / 60000);
  const when = ago < 1 ? 'just now' : `${ago} minute${ago === 1 ? '' : 's'} ago`;
  if (!confirm(`Restore autosave of "${data.title}"\nSaved: ${when}\n\nThis will replace the current chart. Continue?`)) return;
  try {
    // KSON (new format, preserves all TS/measures) or KSH (legacy fallback)
    const format = data.format === 'kson' ? 'kson' : (data.kson ? 'kson' : 'ksh');
    const text = format === 'kson' ? data.kson : data.ksh;
    chart = format === 'kson' ? importKson(text) : importKsh(text);
    tabs[activeTabIdx].chart = chart;
    if (renderer) renderer.chart = chart;
    if (gameView) { gameView.chart = chart; gameView._totalWeight = 0; }
    pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); updateScrollSpeedEventList();
    renderFxChain(0); renderFxChain(1); render();
    saveUndo('Restored Autosave');

    // Attempt to restore audio from IDB
    try {
      const db = await _openIDB();
      const savedAudio = await _idbGet(db, 'audio');
      if (savedAudio && data.audioName) {
        ensureAudioCtx();
        audioArrayBuffer = savedAudio;
        audioBuffer = await audioCtx.decodeAudioData(savedAudio.slice(0));
        tabs.forEach(t => { t.audioBuffer = audioBuffer; });
        document.getElementById('audio-status').textContent = `Audio: ${data.audioName} (restored)`;
        window.dispatchEvent(new CustomEvent('vibe:audio-ready', { detail: { buffer: audioBuffer } }));
      }
    } catch(audioErr) {
      console.warn('Could not restore autosaved audio:', audioErr);
    }
  } catch(e) { alert('Could not restore autosave:\n' + e.message); }
}

// ── Game edit overlay wiring ──────────────────────────────────────────────────

// Drag state for hold-note drawing in game edit mode
const _geDrag = { active: false, tool: '', startTick: 0, laneIdx: 0, fxIdx: 0, laserSide: 0 };

// Convert raw canvas-relative (sx, sy) → { tick, norm } using proper perspective inverse.
// Accounts for tilt rotation so the lane-hit position is accurate in all projection modes.
// Pass gv to use a specific GameView instance (defaults to the global gameView).
function _gameScreenToChart(rawSx, rawSy, p, gv) {
  const gvRef = gv ?? gameView;
  if (!gvRef || !p) return null;

  // Un-rotate if tilt is applied (game rotates around (cx, judgeY))
  let sx = rawSx, sy = rawSy;
  if (p.tilt) {
    const dx = rawSx - p.cx, dy = rawSy - p.judgeY;
    const c = Math.cos(-p.tilt), s = Math.sin(-p.tilt);
    sx = p.cx     + dx * c - dy * s;
    sy = p.judgeY + dx * s + dy * c;
  }

  const VT = gvRef.VISIBLE_TICKS;
  let dt;
  if (sy >= p.judgeY) {
    dt = 0;
  } else if (sy <= p.vanishY) {
    dt = VT;
  } else {
    // Binary-search inverse of _screenY (monotone decreasing in dt)
    let lo = 0, hi = VT;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) * 0.5;
      if (gvRef._screenY(mid, p) > sy) lo = mid; else hi = mid;
    }
    dt = (lo + hi) * 0.5;
  }

  const snapV = (typeof snap !== 'undefined' && snap > 0) ? snap : 12;
  const tick  = Math.max(0, Math.round((gvRef.playTick + dt) / snapV) * snapV);
  const hw    = gvRef._halfW(sy, p);
  const norm  = hw > 0 ? (sx - (p.cx - hw)) / (hw * 2) : 0.5;
  // canvasSy: tilt-corrected cursor y in canvas-pixel space, used to render ghost at cursor position
  return { tick, norm, canvasSy: sy };
}

document.addEventListener('DOMContentLoaded', () => {
  // ── Geo toolbar tool buttons ────────────────────────────────────────────────
  document.getElementById('geo-exit')?.addEventListener('click', disableGameEditMode);
  document.querySelectorAll('.geo-tool[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.geo-tool[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setTool(btn.dataset.tool);
    });
  });

  // ── pvc-edit-mode toggle button ─────────────────────────────────────────────
  const pvcEditBtn = document.getElementById('pvc-edit-mode');
  pvcEditBtn?.addEventListener('click', () => {
    if (_gameEditMode) {
      disableGameEditMode();
      pvcEditBtn.textContent  = '✏ Edit Mode: Off';
      pvcEditBtn.style.color  = '#88dd88';
      pvcEditBtn.style.background = '#1e2a1e';
      pvcEditBtn.style.borderColor = '#3a6a3a';
    } else {
      enableGameEditMode();
      pvcEditBtn.textContent  = '✏ Edit Mode: ON';
      pvcEditBtn.style.color  = '#ffdd44';
      pvcEditBtn.style.background = '#2a2a10';
      pvcEditBtn.style.borderColor = '#8a8a20';
    }
  });

  // Keep pvc button in sync when edit mode toggled via context menu
  const _syncPvcEditBtn = () => {
    if (!pvcEditBtn) return;
    if (_gameEditMode) {
      pvcEditBtn.textContent = '✏ Edit Mode: ON';
      pvcEditBtn.style.color = '#ffdd44';
      pvcEditBtn.style.background = '#2a2a10';
      pvcEditBtn.style.borderColor = '#8a8a20';
    } else {
      pvcEditBtn.textContent = '✏ Edit Mode: Off';
      pvcEditBtn.style.color = '#88dd88';
      pvcEditBtn.style.background = '#1e2a1e';
      pvcEditBtn.style.borderColor = '#3a6a3a';
    }
  };
  const _origEnable  = enableGameEditMode;
  const _origDisable = disableGameEditMode;
  window.enableGameEditMode  = function() { _origEnable();  _syncPvcEditBtn(); };
  window.disableGameEditMode = function() { _origDisable(); _syncPvcEditBtn(); };

  // ── Game canvas event handlers ──────────────────────────────────────────────
  const gameCanvas = document.getElementById('game-canvas');
  if (!gameCanvas) return;

  gameCanvas.addEventListener('mousedown', ev => {
    if (!_gameEditMode) return;
    if (ev.button !== 0 && ev.button !== 2) return;
    ev.preventDefault();
    const p = gameView?._params();
    if (!p) return;
    const rect  = gameCanvas.getBoundingClientRect();
    const scaleX = gameCanvas.width / rect.width;
    const scaleY = gameCanvas.height / rect.height;
    const hit  = _gameScreenToChart((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY, p);
    if (!hit) return;
    const { tick, norm } = hit;
    const li   = Math.min(3, Math.max(0, Math.floor(norm * 4)));
    const fi   = norm < 0.5 ? 0 : 1;
    const m    = Math.floor(tick / TICKS_PER_MEASURE) + 1;

    // Right-click always erases, regardless of selected tool
    if (ev.button === 2 || tool === 'erase') {
      saveUndo(`Erased at M${m} (Preview)`);
      if (norm < 0) chart.removeLaserAt(0, tick);
      else if (norm > 1) chart.removeLaserAt(1, tick);
      else eraseAt(li, tick);
      render(); if (gameView) gameView.draw();
      return;
    }
    if (tool === 'laser-l' || tool === 'laser-r') {
      const side = tool === 'laser-l' ? 0 : 1;
      const v    = snapLaserV(Math.max(0, Math.min(1, norm)));
      saveUndo(`VOL-${side === 0 ? 'L' : 'R'} at M${m} (Preview)`);
      chart.addLaserPoint(side, tick, v, 'auto', false);
      _geDrag.active = true; _geDrag.tool = tool; _geDrag.laserSide = side;
      render(); if (gameView) gameView.draw();
      return;
    }
    // BT / FX — start a potential hold drag
    _geDrag.active    = true;
    _geDrag.tool      = tool;
    _geDrag.startTick = tick;
    _geDrag.laneIdx   = li;
    _geDrag.fxIdx     = fi;
    // Place chip immediately so cursor shows something; will be extended on mouseup
    saveUndo(`${tool.toUpperCase()} at M${m} (Preview)`);
    if (tool === 'bt') chart.addBtNote(li, tick, 0);
    else               chart.addFxNote(fi, tick, 0);
    render(); if (gameView) gameView.draw();
  });

  gameCanvas.addEventListener('mousemove', ev => {
    if (!_gameEditMode || !gameView) return;
    const p = gameView._params();
    if (!p) return;
    const rect   = gameCanvas.getBoundingClientRect();
    const scaleX  = gameCanvas.width  / rect.width;
    const scaleY  = gameCanvas.height / rect.height;
    const hit  = _gameScreenToChart((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY, p);
    if (!hit) { if (gameView) gameView._editGhost = null; return; }

    // Update ghost cursor; canvasSy lets _drawEditGhost render at cursor y not snapped-tick y
    gameView._editGhost = { tick: hit.tick, norm: hit.norm, tool, sy: hit.canvasSy };

    // Extend laser while dragging
    if (_geDrag.active && (tool === 'laser-l' || tool === 'laser-r')) {
      const v = snapLaserV(Math.max(0, Math.min(1, hit.norm)));
      chart.addLaserPoint(_geDrag.laserSide, hit.tick, v, 'auto', false);
      render();
    }
    if (!playing) gameView.draw();
  });

  gameCanvas.addEventListener('mouseup', ev => {
    if (!_geDrag.active) return;
    const p = gameView?._params();
    if (p && (tool === 'bt' || tool === 'fx')) {
      const rect   = gameCanvas.getBoundingClientRect();
      const scaleX  = gameCanvas.width  / rect.width;
      const scaleY  = gameCanvas.height / rect.height;
      const hit  = _gameScreenToChart((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY, p);
      if (hit) {
        const endTick = hit.tick;
        const len = Math.max(0, endTick - _geDrag.startTick);
        if (len > 0) {
          // Extend the note that was placed on mousedown to a hold
          if (tool === 'bt') {
            const lane = chart.bt[_geDrag.laneIdx];
            const n    = lane.findLast?.(n => n.y === _geDrag.startTick) ?? lane.slice().reverse().find(n => n.y === _geDrag.startTick);
            if (n) n.len = len;
          } else {
            const lane = chart.fx[_geDrag.fxIdx];
            const n    = lane.findLast?.(n => n.y === _geDrag.startTick) ?? lane.slice().reverse().find(n => n.y === _geDrag.startTick);
            if (n) n.len = len;
          }
          render(); if (gameView) gameView.draw();
        }
      }
    }
    _geDrag.active = false;
    render(); if (gameView) gameView.draw();
  });

  gameCanvas.addEventListener('mouseleave', () => {
    _geDrag.active = false;
    if (gameView) { gameView._editGhost = null; if (!playing) gameView.draw(); }
  });

  // ── Preview scroll: move playhead with mouse wheel ────────────────────
  gameCanvas.addEventListener('wheel', e => {
    if (playing) return;
    e.preventDefault();
    const step = TICKS_PER_BEAT * (e.shiftKey ? 4 : 1);
    const delta = e.deltaY > 0 ? step : -step;
    const total = chart ? chart.totalTicks() : TICKS_PER_MEASURE * 64;
    const newTick = Math.max(0, Math.min(total, (renderer?.playTick ?? 0) + delta));
    if (renderer)   { renderer.playTick  = newTick; }
    if (gameView)   { gameView.playTick   = newTick; gameView.draw(); }
    updateSeekbar(newTick);
  }, { passive: false });
});

// ── Glitch effect (PowerGlitch) ───────────────────────────────────────────────
let _glitchCtrl          = null;
let _glitchActive        = false;
let _glitchRefreshTimer  = null; // periodic snapshot refresh interval ID

// ── Chromatic aberration + frame distortion CSS effects ──────────────────────
let _glitchCssStyleEl = null;
let _glitchCssAnimId  = 0;

function _ensureGlitchSvgFilter() {
  if (document.getElementById('glitch-chromab-svg')) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'glitch-chromab-svg';
  svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
  svg.innerHTML = `<defs>
    <filter id="chromab-lo" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feOffset in="r" dx="-2" dy="0" result="roff"/>
      <feOffset in="b" dx="2"  dy="0" result="boff"/>
      <feMerge><feMergeNode in="roff"/><feMergeNode in="g"/><feMergeNode in="boff"/></feMerge>
    </filter>
    <filter id="chromab-hi" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
      <feColorMatrix in="SourceGraphic" type="matrix"
        values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
      <feOffset in="r" dx="-5" dy="1"  result="roff"/>
      <feOffset in="b" dx="5"  dy="-1" result="boff"/>
      <feMerge><feMergeNode in="roff"/><feMergeNode in="g"/><feMergeNode in="boff"/></feMerge>
    </filter>
  </defs>`;
  document.body.appendChild(svg);
}

function _applyGlitchCssEffects(el, level) {
  if (!_glitchCssStyleEl) {
    _glitchCssStyleEl = document.createElement('style');
    _glitchCssStyleEl.id = 'glitch-css-effects';
    document.head.appendChild(_glitchCssStyleEl);
  }

  if (level <= 0) {
    el.style.filter    = '';
    el.style.animation = '';
    el.style.transform = '';
    _glitchCssStyleEl.textContent = '';
    return;
  }

  _ensureGlitchSvgFilter();

  const t      = Math.max(0, Math.min(10, level)) / 10;
  const filtId = t > 0.5 ? 'chromab-hi' : 'chromab-lo';
  el.style.filter = `url(#${filtId})`;

  // Distortion animation: irregular scaleX/scaleY/skewX oscillation
  const animName = `glitch-dist-${++_glitchCssAnimId}`;
  const sx1 = (1 + t * 0.06).toFixed(4);
  const sx2 = (1 - t * 0.04).toFixed(4);
  const sy1 = (1 - t * 0.05).toFixed(4);
  const sy2 = (1 + t * 0.03).toFixed(4);
  const sk  = (t * 1.8).toFixed(2);
  const dur = Math.max(60, Math.round(180 - t * 130));

  _glitchCssStyleEl.textContent = `
    @keyframes ${animName} {
      0%   { transform: scaleX(1)     scaleY(1);     }
      15%  { transform: scaleX(${sx1}) scaleY(${sy1}) skewX(${sk}deg);  }
      30%  { transform: scaleX(1)     scaleY(1);     }
      55%  { transform: scaleX(${sx2}) scaleY(${sy2}) skewX(-${sk}deg); }
      70%  { transform: scaleX(1)     scaleY(1);     }
      85%  { transform: scaleX(${sx1}) scaleY(${sy2});                   }
      100% { transform: scaleX(1)     scaleY(1);     }
    }`;
  el.style.animation = `${animName} ${dur}ms steps(3) infinite`;
}

function _levelToGlitchOptions(level) {
  const t = Math.max(0, Math.min(10, level)) / 10;
  return {
    playMode: 'manual',
    createContainers: true,
    hideOverflow: false,
    timing: {
      // Short cycle = rapid, snappy glitch bursts rather than slow drift
      duration: Math.max(50, Math.round(280 - t * 220)),
      iterations: Infinity,
    },
    glitchTimeSpan: {
      // Cover a wide fraction of the cycle so artifacts are frequent
      start: Math.max(0,   0.3 - t * 0.28),
      end:   Math.min(1.0, 0.7 + t * 0.28),
    },
    shake: {
      // Minimal camera-shake — glitch is about horizontal slice displacement, not wobble
      velocity:   Math.round(4 + t * 8),
      amplitudeX: 0.01 + t * 0.04,
      amplitudeY: 0.005 + t * 0.015,
    },
    slice: {
      // Many fast-moving slices with large bands — this is the real "digital glitch" look
      count:     Math.max(3, Math.round(4 + t * 24)),
      velocity:  Math.round(30 + t * 90),   // high velocity = big horizontal jumps
      minHeight: 0.01,
      maxHeight: 0.06 + t * 0.5,            // up to 56% of height for VHS-style bands
      hueRotate: t > 0.1,                   // RGB split from level 1+
    },
    pulse: t > 0.5 ? {
      show: 0.85,
      min:  0.0,
      max:  0.04 + t * 0.08,               // brief opacity blink at high levels
    } : false,
  };
}

let _glitchAppliedLevel = -1; // -1 = not applied; avoids reinitialization unless level changes

function _updateGlitchFromTick(tick) {
  if (typeof PowerGlitch === 'undefined') return;
  const el = document.getElementById('game-canvas-wrap');
  if (!el) return;
  const level = chart?.getGlitchLevelAt?.(tick) ?? 0;
  if (level === _glitchAppliedLevel) return; // no change
  _glitchAppliedLevel = level;
  _applyGlitchCssEffects(el, level);
  if (level <= 0) {
    _glitchCtrl?.stopGlitch();
    _glitchCtrl = null;
    _glitchActive = false;
    if (_glitchRefreshTimer) { clearInterval(_glitchRefreshTimer); _glitchRefreshTimer = null; }
    return;
  }

  // Helper that (re)initialises PowerGlitch against the current canvas content.
  // Called once after a one-frame delay and then periodically so the snapshot
  // stays in sync with the moving 2D overlay (notes/lasers).
  const _startGlitch = () => {
    if (_glitchAppliedLevel !== level) return;
    if (typeof PowerGlitch === 'undefined') return;
    _glitchCtrl?.stopGlitch();
    _glitchCtrl = PowerGlitch.glitch(el, _levelToGlitchOptions(level));
    _glitchCtrl.startGlitch();
    _glitchActive = true;
  };

  // Stop any currently running instance and clear refresh timer.
  _glitchCtrl?.stopGlitch();
  _glitchCtrl = null;
  _glitchActive = false;
  if (_glitchRefreshTimer) { clearInterval(_glitchRefreshTimer); _glitchRefreshTimer = null; }

  // Delay first init by one rAF so the WebGL canvas (preserveDrawingBuffer: true)
  // has committed at least one frame before PowerGlitch snapshots it.
  requestAnimationFrame(() => {
    _startGlitch();
    // Refresh the snapshot every ~250 ms while glitch is active so the
    // displacement layers stay approximately in sync with moving chart content.
    _glitchRefreshTimer = setInterval(() => {
      if (_glitchAppliedLevel !== level) {
        clearInterval(_glitchRefreshTimer); _glitchRefreshTimer = null; return;
      }
      _startGlitch();
    }, 250);
  });
}

// ── Session persistence ───────────────────────────────────────────────────────
const SESSION_KEY = 'vibe-editr-session';

function _saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      zoom:      renderer?.zoom ?? 0.75,
      scrollCol: renderer?.scrollCol ?? 0,
      playTick:  renderer?.playTick ?? 0,
      viewMode,
      laserOpacity,
      laserWideMode,
      svMode:    renderer?.svMode ?? false,
      laserPreset: _currentLaserPreset,
      laserColorL: laserColors.L,
      laserColorR: laserColors.R,
    }));
  } catch(e) {}
}

let _currentLaserPreset = 'sdvx-default';

function _restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    if (s.zoom && renderer)      renderer.zoom      = s.zoom;
    if (s.scrollCol && renderer) renderer.scrollCol = s.scrollCol;
    if (s.playTick && renderer)  renderer.playTick  = s.playTick;
    if (s.viewMode) setTimeout(() => setViewMode(s.viewMode), 0);
    if (typeof s.laserOpacity === 'number') {
      setLaserOpacity(s.laserOpacity);
      const sl = document.getElementById('pref-laser-opacity');
      if (sl) sl.value = Math.round(s.laserOpacity * 100);
    }
    if (typeof s.laserWideMode === 'boolean') {
      setLaserWideMode(s.laserWideMode);
      const cb = document.getElementById('laser-wide');
      if (cb) cb.checked = s.laserWideMode;
    }
    if (typeof s.svMode === 'boolean' && renderer) {
      renderer.svMode = s.svMode;
      const svCb = document.getElementById('sv-view-toggle');
      if (svCb) svCb.checked = s.svMode;
    }
    if (s.laserPreset) {
      _currentLaserPreset = s.laserPreset;
      applyLaserPreset(s.laserPreset);
    }
    if (s.laserColorL) setLaserColorCustom(0, s.laserColorL);
    if (s.laserColorR) setLaserColorCustom(1, s.laserColorR);
  } catch(e) {}
}

// Save session periodically and on unload
window.addEventListener('beforeunload', (e) => {
  _saveSession();
  // Show confirmation if there are unsaved changes
  if (_hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes. Do you want to discard them?';
  }
});
setInterval(_saveSession, 30000);

// Keep audio playing when tab is minimized/hidden
document.addEventListener('visibilitychange', async () => {
  if (!audioCtx) return;
  // Resume audio context if tab regains focus and context is suspended
  if (!document.hidden && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
});

// ── Laser appearance wiring ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Opacity slider
  const opSl = document.getElementById('pref-laser-opacity');
  if (opSl) {
    opSl.value = Math.round(laserOpacity * 100);
    opSl.addEventListener('input', () => {
      setLaserOpacity(+opSl.value / 100);
      const lbl = document.getElementById('pref-laser-opacity-label');
      if (lbl) lbl.textContent = opSl.value + '%';
      render();
    });
  }

  // Wide laser checkboxes — Settings menu + View menu stay in sync
  const _syncWideCheckboxes = (checked) => {
    setLaserWideMode(checked);
    const cbA = document.getElementById('laser-wide');
    const cbB = document.getElementById('laser-wide-view');
    if (cbA) cbA.checked = checked;
    if (cbB) cbB.checked = checked;
    render();
  };
  document.getElementById('laser-wide')?.addEventListener('change', e => _syncWideCheckboxes(e.target.checked));
  document.getElementById('laser-wide-view')?.addEventListener('change', e => _syncWideCheckboxes(e.target.checked));

  // SV View toggle — makes 2D editor space notes by scroll distance, not raw tick
  document.getElementById('sv-view-toggle')?.addEventListener('change', e => {
    if (renderer) { renderer.svMode = e.target.checked; render(); }
  });

  // Laser Mirror Mode toggle — Shift+M also toggles this
  document.getElementById('laser-mirror-toggle')?.addEventListener('change', e => {
    laserMirrorMode = e.target.checked;
    if (!laserMirrorMode) { _mirrorLaserSec = null; }
    _updateMirrorHud();
    render();
  });

  // FX Automation Overlay toggle (View menu)
  document.getElementById('fxauto-vis-toggle')?.addEventListener('change', e => {
    prefs.fxAutoVis = e.target.checked;
    savePrefsToLocalStorage();
    render();
  });

  // Recover autosave from File menu
  document.getElementById('btn-recover-autosave-file')?.addEventListener('click', recoverAutosave);

  // Color preset buttons
  document.querySelectorAll('[data-laser-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentLaserPreset = btn.dataset.laserPreset;
      applyLaserPreset(_currentLaserPreset);
      // Sync custom pickers to new preset
      const p = LASER_PRESETS[_currentLaserPreset];
      if (p) {
        const cl = document.getElementById('pref-laser-color-l');
        const cr = document.getElementById('pref-laser-color-r');
        if (cl) cl.value = p.L;
        if (cr) cr.value = p.R;
      }
      render();
    });
  });

  // Custom color pickers — sync swatch circle on change
  const _syncSwatch = (side, hex) => {
    const el = document.getElementById(`lcp-swatch-${side}`);
    if (el) el.style.background = hex;
  };
  document.getElementById('pref-laser-color-l')?.addEventListener('input', e => {
    setLaserColorCustom(0, e.target.value);
    _syncSwatch('l', e.target.value);
    _currentLaserPreset = 'custom';
    render();
  });
  document.getElementById('pref-laser-color-r')?.addEventListener('input', e => {
    setLaserColorCustom(1, e.target.value);
    _syncSwatch('r', e.target.value);
    _currentLaserPreset = 'custom';
    render();
  });

  // Quick-pick R/B/G/Y buttons (per laser side)
  document.querySelectorAll('.lcp-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const side  = btn.dataset.side;   // 'l' or 'r'
      const hex   = btn.dataset.color;
      const input = document.getElementById(`pref-laser-color-${side}`);
      if (input) input.value = hex;
      if (side === 'l') { setLaserColorCustom(0, hex); _syncSwatch('l', hex); }
      else              { setLaserColorCustom(1, hex); _syncSwatch('r', hex); }
      _currentLaserPreset = 'custom';
      render();
    });
  });

  // Recover autosave button
  document.getElementById('btn-recover-autosave')?.addEventListener('click', recoverAutosave);

  // ── Preview projection controls (in game-wrap panel) ──────────────────────
  _initProjectionControls();
});

function _initProjectionControls() {
  // Projection mode buttons
  document.querySelectorAll('.pvc-proj-btn[data-proj]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.proj;
      if (!gameView) return;
      gameView.projMode = mode;
      // Update active state
      document.querySelectorAll('.pvc-proj-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Intensity slider only meaningful in sdvx/hybrid modes
      const intRow = document.getElementById('pvc-intensity')?.closest('.pvc-section');
      if (intRow) intRow.style.opacity = mode === 'ortho' ? '0.4' : '1';
      if (gameView) gameView.draw();
      _saveSession();
    });
  });

  // Perspective intensity slider
  const intSl  = document.getElementById('pvc-intensity');
  const intLbl = document.getElementById('pvc-intensity-label');
  intSl?.addEventListener('input', () => {
    if (gameView) gameView.perspIntensity = +intSl.value;
    if (intLbl) intLbl.textContent = intSl.value;
    if (gameView) gameView.draw();
  });

  // HiSpeed slider — purely visual lane-scroll density; does NOT affect playback timing.
  // chartSpeed was previously misused here to also control the fallback timer; now decoupled.
  const hsSl  = document.getElementById('pvc-hispeed');
  const hsLbl = document.getElementById('pvc-hispeed-label');
  hsSl?.addEventListener('input', () => {
    const hs = +hsSl.value;
    if (hsLbl) hsLbl.textContent = hs.toFixed(1) + '×';
    // Mirror to the top-menu label only (no chartSpeed mutation — timing is independent)
    const topSl  = document.getElementById('chart-speed');
    const topLbl = document.getElementById('chart-speed-label');
    if (topSl)  topSl.value  = hs;
    if (topLbl) topLbl.textContent = hs.toFixed(2) + '×';
    // Apply exclusively to the game view's visual rendering pipeline
    if (gameView) { gameView.hispeed = hs; gameView.draw(); }
  });

  // BT Width slider (wired here so it's near the other preview controls)
  const bwSl  = document.getElementById('pvc-bt-width');
  const bwLbl = document.getElementById('pvc-bt-width-label');
  if (bwSl && !bwSl._wired) {
    bwSl._wired = true;
    bwSl.addEventListener('input', () => {
      const bw = +bwSl.value;
      if (bwLbl) bwLbl.textContent = bw.toFixed(2) + '×';
      if (gameView) { gameView.btWidthScale = bw; if (!playing) gameView.draw(); }
    });
  }

  // Playback Rate slider — controls lane scroll speed only (audio is unaffected)
  const rateSl  = document.getElementById('pvc-rate');
  const rateLbl = document.getElementById('pvc-rate-label');
  rateSl?.addEventListener('input', () => {
    const newRate = +rateSl.value;
    // Rebase chart position reference so the playhead stays accurate at the new rate
    if (playing && audioCtx) {
      const elapsed = audioCtx.currentTime - audioStartAcTime;
      audioStartChartSec += elapsed * playbackRate;
      audioStartAcTime = audioCtx.currentTime;
    }
    playbackRate = newRate;
    if (rateLbl) {
      rateLbl.textContent = newRate.toFixed(2) + '×';
      rateLbl.style.color = Math.abs(newRate - 1.0) > 0.001 ? '#ffcc44' : '';
    }
    // Audio pitch/speed is intentionally NOT changed — only chart tick advancement is scaled
  });

  // Judge Y slider
  const jySl  = document.getElementById('pvc-judge-y');
  const jyLbl = document.getElementById('pvc-judge-y-label');
  if (jySl && !jySl._wired) {
    jySl._wired = true;
    jySl.addEventListener('input', () => {
      const jy = +jySl.value;
      if (jyLbl) jyLbl.textContent = Math.round(jy * 100) + '%';
      if (gameView) { gameView.judgeYFrac = jy; gameView._paramDirty = true; if (!playing) gameView.draw(); }
    });
  }

  // Game canvas drag to reposition judgment line
  const gc = document.getElementById('game-canvas');
  if (gc && !gc._judgeYDragWired) {
    gc._judgeYDragWired = true;
    let _jyDragging = false;
    gc.addEventListener('mousedown', e => {
      if (!gameView || e.button !== 0) return;
      if (typeof _gameEditMode !== 'undefined' && _gameEditMode) return; // don't hijack game-edit clicks
      const p = gameView._params();
      if (Math.abs(e.offsetY - p.judgeY) < 12) {
        _jyDragging = true;
        e.preventDefault();
      }
    });
    gc.addEventListener('mousemove', e => {
      if (!_jyDragging || !gameView) return;
      const frac = Math.max(0.40, Math.min(0.90, e.offsetY / gc.height));
      gameView.judgeYFrac = frac;
      gameView._paramDirty = true;
      if (jySl)  jySl.value = frac;
      if (jyLbl) jyLbl.textContent = Math.round(frac * 100) + '%';
      if (!playing) gameView.draw();
    });
    const stopJyDrag = () => { _jyDragging = false; };
    gc.addEventListener('mouseup', stopJyDrag);
    gc.addEventListener('mouseleave', stopJyDrag);
    // Cursor: show ns-resize near judge line (only when not in game-edit mode)
    gc.addEventListener('mousemove', e => {
      if (!gameView) return;
      if (typeof _gameEditMode !== 'undefined' && _gameEditMode) return;
      const p = gameView._params();
      gc.style.cursor = Math.abs(e.offsetY - p.judgeY) < 12 ? 'ns-resize' : '';
    });
  }

  // Save Config button — persists current projection, hispeed, BT width and Judge Y to prefs
  // ── "⚙ More" toggle: show/hide the advanced display-settings group ─────────
  // Collapsed by default keeps the preview-controls bar one row tall so more of
  // the preview is visible. Last state is remembered across sessions.
  {
    const moreBtn = document.getElementById('pvc-more-toggle');
    const adv     = document.getElementById('pvc-advanced');
    if (moreBtn && adv) {
      const applyMore = (open) => {
        adv.classList.toggle('collapsed', !open);
        moreBtn.classList.toggle('active', open);
        const label = (typeof t === 'function' ? t('preview.more') : 'More');
        moreBtn.innerHTML = '⚙ ' + label + (open ? ' ▴' : ' ▾');
      };
      let openInit = false;
      try { openInit = localStorage.getItem('vibe-editr-pvc-more') === '1'; } catch(_) {}
      applyMore(openInit);
      moreBtn.addEventListener('click', () => {
        const open = adv.classList.contains('collapsed'); // currently collapsed → opening
        applyMore(open);
        try { localStorage.setItem('vibe-editr-pvc-more', open ? '1' : '0'); } catch(_) {}
      });
    }
  }

  document.getElementById('pvc-save-config')?.addEventListener('click', () => {
    if (!gameView) return;
    // Projection mode
    const activeProj = document.querySelector('.pvc-proj-btn.active');
    if (activeProj) prefs.projMode = activeProj.dataset.proj;
    // Perspective intensity
    const intEl = document.getElementById('pvc-intensity');
    if (intEl) prefs.perspIntensity = +intEl.value;
    // HiSpeed
    const hsEl = document.getElementById('pvc-hispeed');
    if (hsEl) prefs.hispeed = +hsEl.value;
    // BT Width
    const bwEl = document.getElementById('pvc-bt-width');
    if (bwEl) prefs.btWidthScale = +bwEl.value;
    // Judge Y
    const jyEl = document.getElementById('pvc-judge-y');
    if (jyEl) prefs.judgeYFrac = +jyEl.value;
    // Visual interpretation mode (managed by Tools Hub → Visual Mode)
    if (gameView) prefs.interpMode = gameView.interpMode;
    // Playback Rate
    const rateEl = document.getElementById('pvc-rate');
    if (rateEl) prefs.playbackRate = +rateEl.value;
    // Persist
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
    // Show "Saved!" flash
    const lbl = document.getElementById('pvc-save-config-label');
    if (lbl) {
      lbl.style.opacity = '1';
      setTimeout(() => { lbl.style.opacity = '0'; }, 1600);
    }
  });

  // Restore saved preview config on load
  if (prefs.projMode) {
    const btn = document.querySelector(`.pvc-proj-btn[data-proj="${prefs.projMode}"]`);
    if (btn) btn.click();
  }
  if (prefs.perspIntensity != null) {
    const el = document.getElementById('pvc-intensity');
    const lb = document.getElementById('pvc-intensity-label');
    if (el) { el.value = prefs.perspIntensity; if (gameView) gameView.perspIntensity = prefs.perspIntensity; }
    if (lb) lb.textContent = String(prefs.perspIntensity);
  }
  if (prefs.hispeed != null) {
    const el = document.getElementById('pvc-hispeed');
    const lb = document.getElementById('pvc-hispeed-label');
    if (el) { el.value = prefs.hispeed; if (gameView) gameView.hispeed = prefs.hispeed; }
    if (lb) lb.textContent = prefs.hispeed.toFixed(1) + '×';
  }
  if (prefs.btWidthScale != null) {
    const el = document.getElementById('pvc-bt-width');
    const lb = document.getElementById('pvc-bt-width-label');
    if (el) { el.value = prefs.btWidthScale; if (gameView) gameView.btWidthScale = prefs.btWidthScale; }
    if (lb) lb.textContent = prefs.btWidthScale.toFixed(2) + '×';
  }
  if (prefs.judgeYFrac != null) {
    const el = document.getElementById('pvc-judge-y');
    const lb = document.getElementById('pvc-judge-y-label');
    if (el) { el.value = prefs.judgeYFrac; if (gameView) gameView.judgeYFrac = prefs.judgeYFrac; }
    if (lb) lb.textContent = Math.round(prefs.judgeYFrac * 100) + '%';
  }
  if (prefs.playbackRate != null) {
    const el = document.getElementById('pvc-rate');
    const lb = document.getElementById('pvc-rate-label');
    playbackRate = prefs.playbackRate;
    if (el) el.value = prefs.playbackRate;
    if (lb) {
      lb.textContent = prefs.playbackRate.toFixed(2) + '×';
      lb.style.color = Math.abs(prefs.playbackRate - 1.0) > 0.001 ? '#ffcc44' : '';
    }
  }

  // Set default projection to SDVX on load (only if no saved proj mode)
  if (!prefs.projMode) document.querySelector('.pvc-proj-btn[data-proj="sdvx"]')?.click();

  // Restore saved interpretation mode directly onto gameView (Visual Mode is now in Tools Hub)
  if (prefs.interpMode && gameView) gameView.interpMode = prefs.interpMode;
}

// ── Donation modal ────────────────────────────────────────────────────────────
(function initDonate() {
  const PREF_KEY = 'vibe_editr_donate_no_prompt';
  const PROMPT_DELAY_MS = 8 * 60 * 1000; // 8 minutes

  const modal   = document.getElementById('modal-donate');
  const btnOpen = document.getElementById('btn-donate');
  const btnClose= document.getElementById('donate-close');
  const cbNoPrompt = document.getElementById('donate-no-prompt');

  function openModal() {
    if (!modal) return;
    modal.style.display = 'flex';
  }
  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    if (cbNoPrompt?.checked) {
      try { localStorage.setItem(PREF_KEY, '1'); } catch(_) {}
    }
  }

  btnOpen?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);

  // Close on backdrop click
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // Auto-prompt after delay (skip if user opted out)
  function maybePrompt() {
    try { if (localStorage.getItem(PREF_KEY)) return; } catch(_) {}
    const btn = document.getElementById('btn-donate');
    if (btn) {
      btn.classList.add('donate-pulse');
      setTimeout(() => btn.classList.remove('donate-pulse'), 7000);
    }
    // Show the modal automatically after the delay
    setTimeout(openModal, 500); // brief pause after pulse starts
  }
  setTimeout(maybePrompt, PROMPT_DELAY_MS);
})();

// ── Dock Manager integration ──────────────────────────────────────────────────
// Register all major panels with the dock system after both dock.js and
// tools.js have loaded and initialized their DOM elements.
window.addEventListener('DOMContentLoaded', () => {
  // Give tools.js time to finish building its window, then register panels.
  // (tools.js calls initTools() at end of file which appends .tw-window to body)
  setTimeout(() => {
    if (typeof dockRegister !== 'function') return;

    // ── Register dockable panels ────────────────────────────────────────────

    // Tools Hub — nativeFloat:true tells the dock to use display:flex (not block)
    // since .tw-window is a flex column. CSS in style.css strips position:fixed
    // and the panel's own chrome when it's inside dp-float or a dock region.
    const toolsWin = document.querySelector('.tw-window');
    if (toolsWin) {
      dockRegister('tools-hub', toolsWin, 'Tools Hub', '⚙', 'float', { nativeFloat: true, floatW: 640, floatH: 460 });
    }

    // Right dock: FX Chain + Events + Shortcuts
    const fxPanel = document.getElementById('panel-fx');
    if (fxPanel) {
      fxPanel.style.width = fxPanel.style.minWidth = fxPanel.style.maxWidth = '';
      dockRegister('fx-panel', fxPanel, 'FX & Events', '★', 'right');
    }

    // Eagerly create velenv so its dockRegister call runs before dockApplyLayout
    getVelEnvEditor();

    // Apply the full layout (from localStorage, or use each panel's defaultRegion)
    if (typeof dockApplyLayout === 'function') dockApplyLayout();

    // Initialise context palette with the current tool
    if (typeof updateContextPalette === 'function') updateContextPalette(tool || 'select');

    // Sync snap display
    if (typeof syncSnapUI === 'function') syncSnapUI();
  }, 150);
});

// ── Visual Calibration Window ─────────────────────────────────────────────────
// Metronome circle that blinks + plays metro_A (beat 1) / metro_B (beats 2-4).
// The user adjusts Audio/Video delay until blink and click are in sync.

(function initVisualCalib() {
  const modal    = document.getElementById('modal-visual-calib');
  const btnOpen  = document.getElementById('pref-open-visual-calib');
  const btnSave  = document.getElementById('vc-save');
  const btnCancel= document.getElementById('vc-cancel');
  const vcCanvas = document.getElementById('vc-canvas');
  const bpmInput = document.getElementById('vc-bpm');
  const audInput = document.getElementById('vc-audio-delay');
  const vidInput = document.getElementById('vc-video-delay');
  if (!modal || !vcCanvas) return;

  const ctx2 = vcCanvas.getContext('2d');
  const W = vcCanvas.width, H = vcCanvas.height;

  // ── Audio ──────────────────────────────────────────────────────────────────
  let _vcAcCtx    = null;   // own AudioContext so it can't be blocked by the main one
  let _metroA     = null;   // AudioBuffer for beat 1
  let _metroB     = null;   // AudioBuffer for beats 2-4
  let _loadedBufs = false;

  async function _ensureAudio() {
    if (_loadedBufs) return;
    if (!_vcAcCtx) _vcAcCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (_vcAcCtx.state === 'suspended') await _vcAcCtx.resume();
    const load = async url => {
      const res = await fetch(url);
      const ab  = await res.arrayBuffer();
      return _vcAcCtx.decodeAudioData(ab);
    };
    try {
      [_metroA, _metroB] = await Promise.all([load('sounds/metro_A.mp3'), load('sounds/metro_B.mp3')]);
      _loadedBufs = true;
    } catch(e) {
      console.warn('[VisualCalib] Could not load metro sounds:', e);
    }
  }

  function _fireClick(isDownbeat, acTime) {
    if (!_vcAcCtx) return;
    const buf = isDownbeat ? _metroA : _metroB;
    if (!buf) return;
    const src = _vcAcCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_vcAcCtx.destination);
    src.start(acTime);
  }

  // ── Scheduler ──────────────────────────────────────────────────────────────
  // We schedule audio slightly ahead (LOOKAHEAD_S) so clicks never glitch.
  // The visual blink is driven by performance.now() and is kept in sync with
  // _scheduleStart (the performance.now() timestamp when beat-0 fired).
  const LOOKAHEAD_S = 0.08; // seconds of audio lookahead
  let _schedStart   = null; // performance.now() of beat-0 (set on open / tap)
  let _nextBeat     = 0;    // index of next beat to schedule (0-based, mod 4 = measure position)
  let _schedTimer   = null;

  function _bpm()    { return Math.max(40, Math.min(400, +bpmInput.value || 120)); }
  function _beatMs() { return 60000 / _bpm(); }

  function _resetScheduler() {
    if (_schedTimer) { clearInterval(_schedTimer); _schedTimer = null; }
    _schedStart = performance.now();
    _nextBeat   = 0;
    // Immediately fire beat-0 (downbeat)
    if (_vcAcCtx) {
      if (_vcAcCtx.state === 'suspended') _vcAcCtx.resume();
      _fireClick(true, _vcAcCtx.currentTime);
    }
    // Schedule ahead every LOOKAHEAD_S / 2
    _schedTimer = setInterval(_scheduleTick, (LOOKAHEAD_S / 2) * 1000);
    _scheduleTick(); // fill the first window immediately
  }

  function _scheduleTick() {
    if (!_vcAcCtx || _schedStart === null) return;
    const beatMs  = _beatMs();
    const acNow   = _vcAcCtx.currentTime;
    const perfNow = performance.now();

    // How far ahead to schedule (in ms)
    const windowMs = LOOKAHEAD_S * 1000;

    while (true) {
      // performance.now() of next beat
      const beatPerfMs = _schedStart + _nextBeat * beatMs;
      // Already more than LOOKAHEAD ahead of now? Stop for this tick
      if (beatPerfMs > perfNow + windowMs) break;
      // Skip beats already in the past (can happen after a tab wake-up)
      if (beatPerfMs < perfNow - beatMs) { _nextBeat++; continue; }

      // Map performance.now() → AudioContext time
      const acFire = acNow + (beatPerfMs - perfNow) / 1000;
      if (acFire >= acNow - 0.005) {            // don't fire into the past
        const isDown = (_nextBeat % 4) === 0;   // beat 1 of each group of 4
        _fireClick(isDown, Math.max(acNow, acFire));
      }
      _nextBeat++;
    }
  }

  function _stopScheduler() {
    if (_schedTimer) { clearInterval(_schedTimer); _schedTimer = null; }
    _schedStart = null;
    _nextBeat   = 0;
  }

  // ── Tap measurement ────────────────────────────────────────────────────────
  // Each Space tap records how far off the user is from the nearest beat.
  // Positive offset = they tapped AFTER the flash (audio feels late to them).
  // We collect up to 8 taps and apply the rolling average to audInput.
  let _tapOffsets = [];   // ms offsets, positive = late
  let _lastTapT   = null;
  let _avgOffset  = null; // null = not enough taps yet

  const TAP_NEEDED = 3;   // taps before we start correcting
  const TAP_MAX    = 8;   // rolling window size

  function _recordTap() {
    if (_schedStart === null) return;
    const tapT   = performance.now();
    const beatMs = _beatMs();
    const elapsed = tapT - _schedStart;
    // Phase within nearest beat (-beatMs/2 … +beatMs/2)
    let phaseMs = ((elapsed % beatMs) + beatMs) % beatMs;
    if (phaseMs > beatMs / 2) phaseMs -= beatMs;
    // phaseMs > 0 → tapped after beat (audio sounds late) → reduce audio delay
    _tapOffsets.push(phaseMs);
    if (_tapOffsets.length > TAP_MAX) _tapOffsets.shift();
    _lastTapT = tapT;

    if (_tapOffsets.length >= TAP_NEEDED) {
      _avgOffset = _tapOffsets.reduce((a, b) => a + b, 0) / _tapOffsets.length;
      // Apply correction: if tapped late (+), audio is late → subtract from delay
      const correction = -Math.round(_avgOffset);
      const cur = +audInput.value || 0;
      audInput.value = Math.max(-500, Math.min(500, cur + correction));
      // Reset so next batch starts fresh (don't keep compounding)
      _tapOffsets = [];
    }
  }

  // ── Visuals ────────────────────────────────────────────────────────────────
  let _rafId = null;

  function _draw(now) {
    if (_schedStart === null) { _rafId = requestAnimationFrame(_draw); return; }

    const beatMs  = _beatMs();
    const elapsed = now - _schedStart;
    const phase   = ((elapsed % beatMs) + beatMs) % beatMs / beatMs;
    const beatIdx = Math.floor(elapsed / beatMs) % 4;
    const flash   = Math.pow(1 - phase, 2.5);
    const isDown  = beatIdx === 0;

    // Gold for beat 1, blue for 2-4
    const flashR = isDown ? 255 : 80;
    const flashG = isDown ? 210 : 150;
    const flashB = isDown ? 80  : 255;

    ctx2.clearRect(0, 0, W, H);
    ctx2.fillStyle = '#0a0a1a';
    ctx2.fillRect(0, 0, W, H);

    // Outer ring
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, 80, 0, Math.PI * 2);
    ctx2.strokeStyle = '#333366';
    ctx2.lineWidth   = 3;
    ctx2.stroke();

    // Sweep arc
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, 80, -Math.PI/2, -Math.PI/2 + phase * Math.PI * 2);
    ctx2.strokeStyle = isDown ? '#ffcc0088' : '#4488ff88';
    ctx2.lineWidth   = 3;
    ctx2.stroke();

    // Beat pips
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI/2 + i * Math.PI / 2;
      const px = W/2 + Math.cos(ang) * 80;
      const py = H/2 + Math.sin(ang) * 80;
      ctx2.beginPath();
      ctx2.arc(px, py, i === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx2.fillStyle = i === beatIdx ? (isDown ? '#ffdd44' : '#88aaff') : '#1a1a44';
      ctx2.fill();
    }

    // Main flash circle
    const r = 52 + flash * 12;
    const grd = ctx2.createRadialGradient(W/2, H/2, 0, W/2, H/2, r);
    if (flash > 0.03) {
      grd.addColorStop(0,   `rgba(${flashR},${flashG},${flashB},${0.25 + flash * 0.75})`);
      grd.addColorStop(0.55,`rgba(${flashR},${flashG},${flashB},${0.15 + flash * 0.45})`);
      grd.addColorStop(1,   `rgba(${flashR},${flashG},${flashB},0)`);
    } else {
      grd.addColorStop(0, '#1a1a44'); grd.addColorStop(1, '#0a0a1a');
    }
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, r, 0, Math.PI * 2);
    ctx2.fillStyle = grd; ctx2.fill();

    // Center dot
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, 7 + flash * 5, 0, Math.PI * 2);
    ctx2.fillStyle = flash > 0.03
      ? `rgba(${flashR},${flashG},${flashB},${0.6 + flash * 0.4})` : '#223355';
    ctx2.fill();

    // Beat number
    ctx2.fillStyle    = flash > 0.1 ? `rgba(255,255,255,${flash})` : '#334477';
    ctx2.font         = 'bold 22px monospace';
    ctx2.textAlign    = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(beatIdx + 1, W/2, H/2);

    // BPM label
    ctx2.fillStyle    = '#5566aa';
    ctx2.font         = 'bold 11px monospace';
    ctx2.textBaseline = 'bottom';
    ctx2.fillText(_bpm() + ' BPM', W/2, H - 10);

    // Tap progress / feedback area (below circle)
    const tapsLeft = TAP_NEEDED - _tapOffsets.length;
    ctx2.textBaseline = 'top';
    ctx2.textAlign    = 'center';
    ctx2.font         = '10px monospace';
    if (_lastTapT !== null) {
      const tapAge = (performance.now() - _lastTapT) / 1000;
      if (tapAge < 2 && _tapOffsets.length === 0) {
        // Just applied a correction — show it
        const corrMs = _avgOffset !== null ? -Math.round(_avgOffset) : 0;
        const sign   = corrMs >= 0 ? '+' : '';
        ctx2.fillStyle = `rgba(100,255,150,${Math.max(0, 1 - tapAge / 2)})`;
        ctx2.fillText(`Applied ${sign}${corrMs} ms → Audio Delay`, W/2, H/2 + 28);
      } else if (_tapOffsets.length > 0) {
        // Collecting — show progress dots
        ctx2.fillStyle = '#88aaff';
        ctx2.fillText(`Tap ${TAP_NEEDED - _tapOffsets.length} more…`, W/2, H/2 + 28);
      }
    } else {
      ctx2.fillStyle = '#445566';
      ctx2.fillText('Press Space on every beat you hear', W/2, H/2 + 28);
    }

    _rafId = requestAnimationFrame(_draw);
  }

  // ── Open / Close ───────────────────────────────────────────────────────────
  async function _open() {
    bpmInput.value = chart?.bpmEvents?.[0]?.bpm?.toFixed(0) ?? 120;
    const saved = JSON.parse(localStorage.getItem('vibe-editr-prefs') || '{}');
    audInput.value = saved.audioDelay ?? (document.getElementById('pref-audio-delay')?.value ?? 0);
    vidInput.value = saved.videoDelay ?? (document.getElementById('pref-video-delay')?.value ?? 0);
    modal.style.display = 'flex';
    _lastTapT  = null;
    _tapOffsets = [];
    _avgOffset  = null;
    await _ensureAudio();
    _resetScheduler();
    if (!_rafId) _rafId = requestAnimationFrame(_draw);
  }

  function _close() {
    modal.style.display = 'none';
    _stopScheduler();
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  function _save() {
    const ad = +audInput.value;
    const vd = +vidInput.value;
    // Write directly into prefs and persist — don't rely on DOM event chain
    prefs.audioDelay = ad;
    prefs.videoDelay = vd;
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
    // Also sync the prefs-panel inputs so they show the new values if opened
    const adEl = document.getElementById('pref-audio-delay');
    const vdEl = document.getElementById('pref-video-delay');
    if (adEl) adEl.value = ad;
    if (vdEl) vdEl.value = vd;
    _close();
  }

  function _onKey(e) {
    if (!modal || modal.style.display === 'none') return;
    if (e.code === 'Space') {
      e.preventDefault();
      _recordTap();
    }
    if (e.code === 'Escape') _close();
  }

  btnOpen?.addEventListener('click', _open);
  btnSave?.addEventListener('click', _save);
  btnCancel?.addEventListener('click', _close);
  modal.addEventListener('click', e => { if (e.target === modal) _close(); });
  document.addEventListener('keydown', _onKey);
  // Only restart the scheduler when the user finishes editing BPM (blur / Enter)
  bpmInput?.addEventListener('change', () => { if (_schedStart !== null) _resetScheduler(); });
})();

// ──────────────────────────────────────────────────────────────────────────────
// First-run disclaimer (blocks the app until the user agrees)
// ──────────────────────────────────────────────────────────────────────────────
const DisclaimerGate = (function() {
  const KEY = 'vibe_editr_disclaimer_accepted';
  const modal = document.getElementById('modal-disclaimer');
  const cb    = document.getElementById('disclaimer-agree-cb');
  const btn   = document.getElementById('disclaimer-continue');
  if (!modal || !cb || !btn) return { isAccepted: () => true, onAccept: (cb) => cb() };

  let alreadyAccepted = false;
  try { alreadyAccepted = localStorage.getItem(KEY) === '1'; } catch(_) {}

  const acceptCallbacks = [];

  function show() {
    modal.style.display = 'flex';
    cb.checked = false;
    btn.disabled = true;
  }
  function accept() {
    try { localStorage.setItem(KEY, '1'); } catch(_) {}
    modal.style.display = 'none';
    alreadyAccepted = true;
    acceptCallbacks.splice(0).forEach(fn => { try { fn(); } catch(_) {} });
  }

  cb.addEventListener('change', () => { btn.disabled = !cb.checked; });
  btn.addEventListener('click', () => { if (cb.checked) accept(); });

  if (!alreadyAccepted) show();

  return {
    isAccepted: () => alreadyAccepted,
    onAccept(fn) {
      if (alreadyAccepted) fn();
      else acceptCallbacks.push(fn);
    },
  };
})();

// ──────────────────────────────────────────────────────────────────────────────
// app version, changelog data, "What's New" modal
// ──────────────────────────────────────────────────────────────────────────────
(function initWhatsNew() {
  const KEY = 'vibe_editr_seen_version';
  const modal = document.getElementById('modal-whats-new');
  const body  = document.getElementById('wn-body');
  const title = document.getElementById('wn-title');
  const sub   = document.getElementById('wn-subtitle');
  const badge = document.getElementById('wn-badge');
  const btnClose = document.getElementById('wn-close');
  const btnMenu  = document.getElementById('btn-whats-new');
  if (!modal || !body) return;

  function buildBody(showAll) {
    const blocks = showAll ? CHANGELOG : [CHANGELOG[0]];
    body.innerHTML = blocks.map(v => `
      <div class="wn-version-block">
        <span class="wn-version-tag">v${v.version}</span>
        <span class="wn-version-title">${v.title}</span>
        <ul>${v.entries.map(([k, t]) =>
          `<li><span class="wn-tag ${k}">${k}</span>${t}</li>`).join('')}</ul>
      </div>
    `).join('');
  }

  function open(mode) {
    // mode: 'welcome' | 'updated' | 'manual'
    if (mode === 'welcome') {
      badge.textContent = 'WELCOME';
      title.innerHTML = `Welcome to vibe-editr v${APP_VERSION}`;
      sub.textContent = 'Here\'s what this version includes.';
      buildBody(false);
    } else if (mode === 'updated') {
      badge.textContent = 'UPDATED';
      title.innerHTML = `Updated to v${APP_VERSION}`;
      sub.textContent = 'New since your last visit:';
      buildBody(false);
    } else {
      badge.textContent = 'CHANGELOG';
      title.innerHTML = `What's New — v${APP_VERSION}`;
      sub.textContent = 'Recent release history.';
      buildBody(true);
    }
    modal.style.display = 'flex';
  }
  function close() {
    modal.style.display = 'none';
    try { localStorage.setItem(KEY, APP_VERSION); } catch(_) {}
  }

  btnClose?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  btnMenu?.addEventListener('click', () => open('manual'));

  // Boot-time check: show welcome on first run, "updated" if version changed.
  // Wait for the disclaimer to be accepted (or skip wait if already accepted).
  DisclaimerGate.onAccept(() => {
    setTimeout(() => {
      let seen = null;
      try { seen = localStorage.getItem(KEY); } catch(_) {}
      if (seen === APP_VERSION) return;
      open(seen ? 'updated' : 'welcome');
    }, 600);
  });
})();

// ──────────────────────────────────────────────────────────────────────────────
// v1.4.1: Chart Statistics modal
// ──────────────────────────────────────────────────────────────────────────────
(function initChartStats() {
  const modal = document.getElementById('modal-chart-stats');
  const grid  = document.getElementById('cs-grid');
  const sub   = document.getElementById('cs-subtitle');
  const btnOpen  = document.getElementById('btn-chart-stats');
  const btnClose = document.getElementById('cs-close');
  if (!modal || !grid) return;

  function row(k, v) {
    return `<div class="cs-row"><span class="cs-key">${k}</span><span class="cs-val">${v}</span></div>`;
  }
  function section(t) { return `<div class="cs-section-title">${t}</div>`; }

  function compute() {
    if (!chart) return null;
    const TPM = 192, TPB = 48;
    let btChip = 0, btHold = 0;
    for (const lane of chart.bt) for (const n of lane) (n.len > 0 ? btHold++ : btChip++);
    let fxChip = 0, fxHold = 0;
    for (const lane of chart.fx) for (const n of lane) (n.len > 0 ? fxHold++ : fxChip++);

    let segL = 0, segR = 0, slamL = 0, slamR = 0, pointsL = 0, pointsR = 0;
    [chart.lasers[0], chart.lasers[1]].forEach((side, idx) => {
      for (const sec of side) {
        if (idx === 0) segL++; else segR++;
        const pts = sec.points || [];
        if (idx === 0) pointsL += pts.length; else pointsR += pts.length;
        for (let i = 1; i < pts.length; i++) {
          if ((pts[i].ry - pts[i-1].ry) <= 6) {
            if (idx === 0) slamL++; else slamR++;
          }
        }
      }
    });

    const totalNotes = btChip + btHold + fxChip + fxHold;
    const totalMeas = chart.totalMeasures || 1;

    // Density: notes per measure across all measures that contain at least one note
    const measBuckets = new Array(totalMeas).fill(0);
    const addToBucket = (y) => {
      const m = Math.floor(y / TPM);
      if (m >= 0 && m < totalMeas) measBuckets[m]++;
    };
    for (const lane of chart.bt) for (const n of lane) addToBucket(n.y);
    for (const lane of chart.fx) for (const n of lane) addToBucket(n.y);

    let peak = 0, peakMeas = 0, totalSpanned = 0;
    measBuckets.forEach((c, i) => {
      if (c > peak) { peak = c; peakMeas = i; }
      if (c > 0) totalSpanned++;
    });
    const avgDens = totalSpanned ? (totalNotes / totalSpanned) : 0;

    // Duration estimate from BPM events
    let durSec = 0;
    const events = [...chart.bpmEvents].sort((a, b) => a.y - b.y);
    const endTick = totalMeas * TPM;
    for (let i = 0; i < events.length; i++) {
      const a = events[i].y;
      const b = (i + 1 < events.length) ? events[i + 1].y : endTick;
      const ticks = Math.max(0, b - a);
      const bpm = events[i].bpm || 120;
      durSec += (ticks / TPB) * (60 / bpm);
    }
    const mm = Math.floor(durSec / 60), ss = Math.floor(durSec % 60);
    const durStr = `${mm}:${String(ss).padStart(2, '0')}`;

    return {
      btChip, btHold, fxChip, fxHold,
      segL, segR, slamL, slamR, pointsL, pointsR,
      totalNotes, totalMeas, peak, peakMeas, avgDens, durStr,
      bpmRange: events.length ? (() => {
        const bs = events.map(e => e.bpm);
        const lo = Math.min(...bs), hi = Math.max(...bs);
        return lo === hi ? lo.toFixed(2) : `${lo.toFixed(2)} – ${hi.toFixed(2)}`;
      })() : '—',
    };
  }

  function render() {
    const s = compute();
    if (!s) { grid.innerHTML = '<div class="cs-row"><span>No chart loaded.</span></div>'; return; }
    const title = (chart.meta?.title || 'Untitled') + (chart.meta?.artist ? ' — ' + chart.meta.artist : '');
    sub.textContent = title;
    grid.innerHTML = [
      section('Notes'),
      row('BT chips',     s.btChip),
      row('BT holds',     s.btHold),
      row('FX chips',     s.fxChip),
      row('FX holds',     s.fxHold),
      row('Total notes',  `<strong>${s.totalNotes}</strong>`),
      section('Lasers'),
      row('L segments',   `${s.segL} (${s.pointsL} pts)`),
      row('R segments',   `${s.segR} (${s.pointsR} pts)`),
      row('Slams L / R',  `${s.slamL} / ${s.slamR}`),
      section('Timing'),
      row('Duration',     s.durStr),
      row('Total measures', s.totalMeas),
      row('BPM',          s.bpmRange),
      section('Density'),
      row('Peak (notes/measure)', `${s.peak} @ m${s.peakMeas + 1}`),
      row('Avg over active measures', s.avgDens.toFixed(1)),
    ].join('');
  }

  function open()  { render(); modal.style.display = 'flex'; }
  function close() { modal.style.display = 'none'; }

  btnOpen?.addEventListener('click', open);
  btnClose?.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
})();

// ──────────────────────────────────────────────────────────────────────────────
// v1.4.1: Quick Bookmarks (Ctrl+B), floating panel, per-chart persistence
// ──────────────────────────────────────────────────────────────────────────────
const Bookmarks = (function() {
  const STORAGE_PREFIX = 'vibe_editr_bookmarks::';
  const panel = document.getElementById('bookmarks-panel');
  const list  = document.getElementById('bm-list');
  const btnAdd   = document.getElementById('bm-add');
  const btnClear = document.getElementById('bm-clear');
  const btnClose = document.getElementById('bm-close');
  const btnOpen  = document.getElementById('btn-bookmarks-panel');

  let items = []; // [{ tick, label }]

  function key() {
    if (!chart) return null;
    const t = (chart.meta?.title  || '').trim();
    const a = (chart.meta?.artist || '').trim();
    return STORAGE_PREFIX + (t || 'untitled') + '|' + a;
  }
  function load() {
    items = [];
    const k = key();
    if (!k) return;
    try {
      const s = localStorage.getItem(k);
      if (s) items = JSON.parse(s) || [];
    } catch(_) { items = []; }
  }
  function save() {
    const k = key();
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(items)); } catch(_) {}
  }
  function tickToLabel(tick) {
    const TPM = 192, TPB = 48;
    const m = Math.floor(tick / TPM) + 1;
    const b = Math.floor((tick % TPM) / TPB) + 1;
    return `m${m}:b${b}`;
  }
  function refresh() {
    if (!list) return;
    if (!items.length) {
      list.innerHTML = `<div class="bm-empty">No bookmarks yet — press <kbd>Ctrl+B</kbd> at any playhead position to add one.</div>`;
      return;
    }
    items.sort((a, b) => a.tick - b.tick);
    list.innerHTML = items.map((b, i) =>
      `<div class="bm-item" data-i="${i}">
        <span class="bm-pos">${tickToLabel(b.tick)}</span>
        <input class="bm-label" value="${(b.label || '').replace(/"/g, '&quot;')}" placeholder="(label)">
        <button class="bm-del" title="Remove">✕</button>
       </div>`
    ).join('');
    list.querySelectorAll('.bm-item').forEach(el => {
      const i = +el.dataset.i;
      el.addEventListener('click', ev => {
        if (ev.target.classList.contains('bm-del') ||
            ev.target.classList.contains('bm-label')) return;
        if (typeof _seekTo === 'function') _seekTo(items[i].tick);
      });
      el.querySelector('.bm-label').addEventListener('change', ev => {
        items[i].label = ev.target.value;
        save();
      });
      el.querySelector('.bm-del').addEventListener('click', ev => {
        ev.stopPropagation();
        items.splice(i, 1);
        save(); refresh();
      });
    });
  }
  function flashToast(msg) {
    let t = document.getElementById('bm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'bm-toast';
      t.style.cssText = 'position:fixed;bottom:48px;left:50%;transform:translateX(-50%);' +
        'background:#16162a;border:1px solid #00cfff;color:#00cfff;padding:8px 16px;' +
        'border-radius:6px;font-size:13px;font-weight:600;z-index:9999;' +
        'box-shadow:0 4px 16px #00000099;opacity:0;transition:opacity .2s;' +
        'pointer-events:none';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.opacity = '0'; }, 1500);
  }
  function addAtPlayhead() {
    if (!chart || !renderer) {
      flashToast('No chart loaded');
      return;
    }
    load();
    const tick = renderer.playTick | 0;
    // Toggle: if a bookmark within 24 ticks (half-beat) already exists, remove it
    const idx = items.findIndex(b => Math.abs(b.tick - tick) < 24);
    let action;
    if (idx >= 0) { items.splice(idx, 1); action = 'removed'; }
    else { items.push({ tick, label: '' }); action = 'added'; }
    save();
    // Always show the panel so the user sees confirmation
    if (panel.style.display === 'none') {
      panel.style.display = 'flex';
    }
    refresh();
    flashToast(`Bookmark ${action} @ ${tickToLabel(tick)}`);
  }
  function clearAll() {
    if (!items.length) return;
    if (!confirm('Remove all bookmarks for this chart?')) return;
    items = []; save(); refresh();
  }
  function toggle() {
    if (!panel) return;
    if (panel.style.display === 'none') { load(); refresh(); panel.style.display = 'flex'; }
    else panel.style.display = 'none';
  }

  btnAdd?.addEventListener('click', addAtPlayhead);
  btnClear?.addEventListener('click', clearAll);
  btnClose?.addEventListener('click', () => panel.style.display = 'none');
  btnOpen?.addEventListener('click', toggle);

  // Drag-to-move on header
  const header = panel?.querySelector('.fp-header');
  if (header) {
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left = (e.clientX - ox) + 'px';
      panel.style.top  = (e.clientY - oy) + 'px';
      panel.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => dragging = false);
  }

  // Ctrl+B / Cmd+B keybind (Cmd+Shift+B works as fallback if browser swallows Cmd+B)
  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      e.stopPropagation();
      addAtPlayhead();
    }
  }, true); // capture phase so we run before any other handler

  return { addAtPlayhead, toggle, refresh };
})();

// ──────────────────────────────────────────────────────────────────────────────
// v0.0.20: Chart Section Labels
// Named ranges (Intro, Verse, Chorus…) overlaid on the 2D ruler.
// ──────────────────────────────────────────────────────────────────────────────
const ChartSections = (function() {
  const PALETTE = ['#ff4466','#ffaa00','#44dd88','#4488ff','#dd44ff','#00ccff','#ff8800'];
  const panel  = document.getElementById('sections-panel');
  const list   = document.getElementById('sec-list');
  const btnAdd = document.getElementById('sec-add');
  const btnClose = document.getElementById('sec-close');
  const btnOpen  = document.getElementById('btn-sections-panel');

  function getSections() { return (chart?.sections ?? []); }

  function tickToLabel(tick) {
    const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    return `m${m}:b${b}`;
  }

  function nextColor() {
    const used = getSections().map(s => s.color);
    for (const c of PALETTE) if (!used.includes(c)) return c;
    return PALETTE[getSections().length % PALETTE.length];
  }

  function save() {
    if (chart && renderer) renderer.draw();
    // Sections are persisted in KSON export; nothing extra needed for localStorage
  }

  function refresh() {
    if (!list) return;
    const secs = [...getSections()].sort((a, b) => a.y - b.y);
    if (!secs.length) {
      list.innerHTML = `<div class="bm-empty">No sections yet. Use <em>+ Add</em> to mark a region.</div>`;
      return;
    }
    list.innerHTML = secs.map((s, i) =>
      `<div class="sec-item" data-i="${i}">
        <span class="sec-swatch" data-i="${i}" style="background:${s.color}"></span>
        <span class="sec-range">${tickToLabel(s.y)}</span>
        <input class="sec-label bm-label" value="${(s.label || '').replace(/"/g,'&quot;')}" placeholder="Section name">
        <button class="bm-del sec-del" data-i="${i}" title="Remove">✕</button>
      </div>`
    ).join('');

    list.querySelectorAll('.sec-item').forEach(el => {
      const i = +el.dataset.i;
      const sec = secs[i];

      // Click row → seek
      el.addEventListener('click', ev => {
        if (ev.target.classList.contains('bm-del') ||
            ev.target.classList.contains('sec-label') ||
            ev.target.classList.contains('sec-swatch')) return;
        if (typeof _seekTo === 'function') _seekTo(sec.y);
      });

      // Edit label
      el.querySelector('.sec-label').addEventListener('change', ev => {
        sec.label = ev.target.value;
        save();
      });

      // Cycle color
      el.querySelector('.sec-swatch').addEventListener('click', ev => {
        ev.stopPropagation();
        const idx = PALETTE.indexOf(sec.color);
        sec.color = PALETTE[(idx + 1) % PALETTE.length];
        ev.target.style.background = sec.color;
        save();
      });

      // Delete
      el.querySelector('.sec-del').addEventListener('click', ev => {
        ev.stopPropagation();
        const arr = chart.sections;
        const real = arr.findIndex(s2 => s2.y === sec.y && s2.label === sec.label);
        if (real >= 0) arr.splice(real, 1);
        save(); refresh();
      });
    });
  }

  function addFromSelection() {
    if (!chart || !renderer) {
      alert('No chart loaded.');
      return;
    }
    let startTick, endTick;
    if (sel.active) {
      startTick = Math.min(sel.startTick, sel.endTick);
      endTick   = Math.max(sel.startTick, sel.endTick);
    } else {
      startTick = renderer.playTick | 0;
      endTick   = startTick + TICKS_PER_MEASURE * 4; // default 4 measures
    }
    if (endTick <= startTick) endTick = startTick + TICKS_PER_MEASURE;
    if (!Array.isArray(chart.sections)) chart.sections = [];
    chart.sections.push({ y: startTick, endY: endTick, label: 'Section', color: nextColor() });
    chart.sections.sort((a, b) => a.y - b.y);
    if (panel && panel.style.display === 'none') panel.style.display = 'flex';
    save(); refresh();
  }

  function toggle() {
    if (!panel) return;
    if (panel.style.display === 'none') { refresh(); panel.style.display = 'flex'; }
    else panel.style.display = 'none';
  }

  btnAdd?.addEventListener('click', addFromSelection);
  btnClose?.addEventListener('click', () => panel && (panel.style.display = 'none'));
  btnOpen?.addEventListener('click', toggle);

  // Drag-to-move header
  const header = panel?.querySelector('.fp-header');
  if (header) {
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left  = (e.clientX - ox) + 'px';
      panel.style.top   = (e.clientY - oy) + 'px';
      panel.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => dragging = false);
  }

  return { addFromSelection, toggle, refresh };
})();

// ──────────────────────────────────────────────────────────────────────────────
// v0.0.8: startup diagnostics
// ──────────────────────────────────────────────────────────────────────────────
(function initDiagnostics() {
  const modal = document.getElementById('modal-diagnostics');
  const body  = document.getElementById('diag-body');
  if (!modal || !body) return;

  document.getElementById('diag-close')?.addEventListener('click', () => modal.style.display = 'none');
  document.getElementById('diag-rerun')?.addEventListener('click', () => runDiagnostics());
  document.getElementById('btn-diagnostics')?.addEventListener('click', () => {
    runDiagnostics();
    modal.style.display = 'flex';
  });
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  function runDiagnostics() {
    const results = [];
    const pass = (msg) => results.push(`<div style="color:#44dd88">&#10003; ${msg}</div>`);
    const warn = (msg) => results.push(`<div style="color:#ffcc44">&#9888; ${msg}</div>`);
    const info = (msg) => results.push(`<div style="color:#8899cc">&#9432; ${msg}</div>`);

    try {
      let totalNotes = 0;
      tabs.forEach((t, i) => {
        const c = t.chart;
        const n = c.bt.reduce((s,l) => s + l.length, 0) + c.fx.reduce((s,l) => s + l.length, 0);
        totalNotes += n;
        if (n === 0 && i === activeTabIdx) warn(`Tab "${t.name || 'Untitled'}": chart is empty`);
      });
      pass(`KSON parse integrity OK — ${tabs.length} tab(s), ${totalNotes} total notes`);
    } catch(e) { warn('KSON parse check failed: ' + e.message); }

    try {
      let overlaps = 0;
      for (let li = 0; li < 4; li++) {
        const notes = chart.bt[li];
        for (let i = 0; i < notes.length - 1; i++) {
          if (notes[i].y + Math.max(notes[i].len, 1) > notes[i+1].y) overlaps++;
        }
      }
      for (let li = 0; li < 2; li++) {
        const notes = chart.fx[li];
        for (let i = 0; i < notes.length - 1; i++) {
          if (notes[i].y + Math.max(notes[i].len, 1) > notes[i+1].y) overlaps++;
        }
      }
      if (overlaps > 0) warn(`Note overlap: ${overlaps} overlapping note pair(s) detected`);
      else pass('Note overlap check OK — no overlaps found');
    } catch(e) { warn('Note overlap check failed: ' + e.message); }

    try {
      let badSections = 0;
      for (let s = 0; s < 2; s++) {
        chart.lasers[s].forEach(sec => {
          if (!sec.points || sec.points.length < 2) badSections++;
        });
      }
      if (badSections > 0) warn(`Laser continuity: ${badSections} degenerate laser section(s) (< 2 points)`);
      else pass('Laser continuity OK');
    } catch(e) { warn('Laser check failed: ' + e.message); }

    try {
      const bpms = chart.bpmEvents.map(e => e.bpm);
      const extremes = bpms.filter(b => b < 60 || b > 400);
      if (extremes.length > 0) warn(`BPM warning: ${extremes.length} BPM value(s) outside 60–400 range: ${extremes.join(', ')}`);
      else pass(`BPM range OK — ${bpms.length} BPM event(s), range: ${Math.min(...bpms)}–${Math.max(...bpms)}`);
    } catch(e) { warn('BPM check failed: ' + e.message); }

    if (audioBuffer) pass(`Audio loaded — ${(audioBuffer.duration).toFixed(1)}s, ${audioBuffer.sampleRate} Hz`);
    else info('No audio loaded for active chart');

    pass('Rendering system OK — Canvas 2D context active');

    body.innerHTML = results.join('') +
      `<div style="margin-top:12px;color:#555;font-size:11px">Diagnostics run at ${new Date().toLocaleTimeString()}</div>`;
  }

  const DIAG_KEY = 'vibe_diag_last_session';
  const today = new Date().toDateString();
  const lastRun = localStorage.getItem(DIAG_KEY);
  if (lastRun !== today) {
    setTimeout(() => {
      runDiagnostics();
      if (body.innerHTML.includes('&#9888;')) modal.style.display = 'flex';
      try { localStorage.setItem(DIAG_KEY, today); } catch(_) {}
    }, 2500);
  }
})();

// ── Chart Minimap ─────────────────────────────────────────────────────────────

function _applyMinimapVisibility() {
  const wrap = document.getElementById('chart-minimap-wrap');
  if (!wrap) return;
  wrap.style.display = minimapVisible ? 'block' : 'none';
  const cb = document.getElementById('minimap-toggle');
  if (cb) cb.checked = minimapVisible;
  if (minimapVisible) { _resizeMinimap(); _drawMinimap(); }
}

function _resizeMinimap() {
  const mm = document.getElementById('chart-minimap-canvas');
  if (!mm) return;
  const wrap = document.getElementById('chart-minimap-wrap');
  if (!wrap) return;
  const W = wrap.clientWidth || 400;
  const H = 52;
  if (mm.width !== W || mm.height !== H) {
    mm.width  = W;
    mm.height = H;
  }
}

export function _drawMinimap() {
  if (!minimapVisible) return;
  const mm = document.getElementById('chart-minimap-canvas');
  if (!mm) return;
  _resizeMinimap();

  const ctx = mm.getContext('2d');
  const W = mm.width, H = mm.height;
  if (W <= 0 || H <= 0) return;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, W, H);

  if (!chart) return;
  const totalTicks = chart.totalTicks();
  if (totalTicks <= 0) return;

  const tickToX = t => (t / totalTicks) * W;

  // Lane row layout
  const ROW = {
    volL: { y: 0,  h: 8  },
    fxL:  { y: 8,  h: 9  },
    bt:   { y: 17, h: 20 },
    fxR:  { y: 37, h: 7  },
    volR: { y: 44, h: 8  },
  };

  // Measure grid (dim vertical lines)
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  const measTicks = 192; // TICKS_PER_MEASURE
  for (let t = measTicks; t < totalTicks; t += measTicks) {
    const x = Math.round(tickToX(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // VOL-L coverage
  ctx.fillStyle = 'rgba(68,170,255,0.75)';
  for (const sec of chart.lasers[0]) {
    if (!sec.points?.length) continue;
    const lastPt = sec.points[sec.points.length - 1];
    const x = tickToX(sec.y);
    const w = Math.max(1, tickToX(sec.y + (lastPt.ry ?? 0)) - x);
    ctx.fillRect(x, ROW.volL.y, w, ROW.volL.h);
  }

  // VOL-R coverage
  ctx.fillStyle = 'rgba(255,68,200,0.75)';
  for (const sec of chart.lasers[1]) {
    if (!sec.points?.length) continue;
    const lastPt = sec.points[sec.points.length - 1];
    const x = tickToX(sec.y);
    const w = Math.max(1, tickToX(sec.y + (lastPt.ry ?? 0)) - x);
    ctx.fillRect(x, ROW.volR.y, w, ROW.volR.h);
  }

  // FX-L holds
  ctx.fillStyle = 'rgba(255,140,32,0.85)';
  for (const note of chart.fx[0]) {
    if (note.len <= 0) continue;
    const x = tickToX(note.y);
    const w = Math.max(1, tickToX(note.y + note.len) - x);
    ctx.fillRect(x, ROW.fxL.y, w, ROW.fxL.h);
  }

  // FX-R holds
  ctx.fillStyle = 'rgba(255,140,32,0.85)';
  for (const note of chart.fx[1]) {
    if (note.len <= 0) continue;
    const x = tickToX(note.y);
    const w = Math.max(1, tickToX(note.y + note.len) - x);
    ctx.fillRect(x, ROW.fxR.y, w, ROW.fxR.h);
  }

  // BT notes (A=0, B=1, C=2, D=3)
  const btRowH = ROW.bt.h / 4;
  const BT_COLORS = ['rgba(255,255,255,0.9)', 'rgba(210,210,255,0.9)', 'rgba(255,210,210,0.9)', 'rgba(255,255,210,0.9)'];
  for (let lane = 0; lane < 4; lane++) {
    ctx.fillStyle = BT_COLORS[lane];
    const rowY = ROW.bt.y + lane * btRowH;
    for (const note of chart.bt[lane]) {
      const x = tickToX(note.y);
      const w = note.len > 0 ? Math.max(1, tickToX(note.y + note.len) - x) : Math.max(1.5, W / totalTicks * 4);
      ctx.fillRect(x, rowY, w, btRowH - 0.5);
    }
  }

  // BPM change markers (amber lines)
  if (chart.bpmEvents.length > 1) {
    ctx.strokeStyle = 'rgba(255,200,50,0.55)';
    ctx.lineWidth = 1;
    for (let i = 1; i < chart.bpmEvents.length; i++) {
      const x = Math.round(tickToX(chart.bpmEvents[i].y)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  // Section labels (colored bands along very top)
  if (chart.sections?.length) {
    for (const sec of chart.sections) {
      const x = tickToX(sec.y);
      const w = Math.max(2, tickToX(sec.endY ?? (sec.y + measTicks)) - x);
      ctx.fillStyle = (sec.color || '#4488ff') + '55';
      ctx.fillRect(x, 0, w, 3);
    }
  }

  // Viewport indicator
  if (renderer) {
    const colLen = renderer.measPerCol * measTicks;
    const numCols = renderer.numCols || 1;
    const startTick = renderer.scrollCol * colLen;
    const endTick   = startTick + numCols * colLen;
    const vx = tickToX(startTick);
    const vw = Math.max(3, tickToX(endTick) - vx);

    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.fillRect(vx, 0, vw, H);

    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx + 0.5, 0.5, Math.max(2, vw - 1), H - 1);
  }

  // Playhead
  if (renderer && renderer.playTick >= 0) {
    const px = tickToX(renderer.playTick);
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }
}

function _minimapInitEvents() {
  const mm = document.getElementById('chart-minimap-canvas');
  if (!mm) return;

  const seekAt = e => {
    const rect = mm.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const totalTicks = chart?.totalTicks() ?? 0;
    if (totalTicks > 0) _seekTo(Math.round(pct * totalTicks));
  };

  mm.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _minimapDragging = true;
    seekAt(e);
    e.preventDefault();
  });
  mm.addEventListener('mousemove', e => {
    if (!_minimapDragging) return;
    seekAt(e);
  });
  document.addEventListener('mouseup', () => { _minimapDragging = false; });

  // Update minimap on resize
  const ro = new ResizeObserver(() => { if (minimapVisible) { _resizeMinimap(); _drawMinimap(); } });
  const wrap = document.getElementById('chart-minimap-wrap');
  if (wrap) ro.observe(wrap);
}

// Minimap View-menu toggle handler (called from main init)
function _initMinimapToggle() {
  const cb = document.getElementById('minimap-toggle');
  if (!cb) return;
  cb.checked = minimapVisible;
  cb.addEventListener('change', e => {
    minimapVisible = e.target.checked;
    prefs.minimapVisible = minimapVisible;
    savePrefsToLocalStorage();
    _applyMinimapVisibility();
    if (minimapVisible) _drawMinimap();
  });
}

// Pattern Library lives in tools.js (savePatternFromSelection exported)
