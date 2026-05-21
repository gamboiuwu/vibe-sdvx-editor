import { chart, renderer, gameView, render, saveUndo, updateSeekbar, addChartAnnotation, _seekTo, sel, playing, audioBuffer } from './app.js';
import { TICKS_PER_MEASURE, TICKS_PER_BEAT, BEATS_PER_MEASURE } from './chart.js';
import { Renderer } from './renderer.js';
import { updateRadar } from './radar.js';
/* ═══════════════════════════════════════════════════════════════════════════
   vibe-editr  ·  Tools Hub  ·  20 tools — floating MDI window
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Tool registry ────────────────────────────────────────────────────────────
const TOOL_REGISTRY = [
  // Edit
  { id: 'bpm-sync',    cat: 'Edit',     label: 'BPM Sync',         icon: '♩' },
  { id: 'laser-smooth',cat: 'Edit',     label: 'Laser Smooth',     icon: '〜' },
  { id: 'fx-gen',      cat: 'Edit',     label: 'FX Generator',     icon: '⚡' },
  { id: 'hold-render', cat: 'Edit',     label: 'Hold Editor',      icon: '▬' },
  { id: 'scale',       cat: 'Edit',     label: 'Scale Suggester',  icon: '♫' },
  { id: 'pattern-lib',        cat: 'Edit',     label: 'Pattern Library',   icon: '≡' },
  { id: 'adaptive-compress',  cat: 'Edit',     label: 'Adaptive Compress', icon: '⊟' },
  // Analysis
  { id: 'density-heatmap',cat:'Analysis',label:'Density Heatmap',  icon: '≋'  },
  { id: 'multi-sync',  cat: 'Analysis', label: 'Multi-Chart Sync', icon: '⇄'  },
  { id: 'vol-angle',   cat: 'Analysis', label: 'VOL Rotation',     icon: '↻'  },
  { id: 'hand-opt',    cat: 'Analysis', label: 'Hand Optimizer',   icon: '◈'  },
  { id: 'symmetry',    cat: 'Analysis', label: 'Symmetry Check',   icon: '⚖'  },
  { id: 'timing-window',cat:'Analysis', label: 'Timing Windows',   icon: '⏱'  },
  { id: 'chart-stats', cat: 'Analysis', label: 'Chart Statistics', icon: '📊'  },
  // Preview
  { id: 'visual-mode', cat: 'Preview',  label: 'Visual Mode',      icon: '◑'  },
  // Audio
  { id: 'offset-finder',cat:'Audio',    label: 'Offset Finder',    icon: '◉'  },
  { id: 'keysound',    cat: 'Audio',    label: 'Keysound Map',     icon: '◆'  },
  { id: 'waveform-align',cat:'Audio',   label: 'Waveform Align',   icon: '≈'  },
  { id: 'audio-anchor', cat: 'Audio',   label: 'Audio Anchoring',  icon: '◎'  },
  // Metadata
  { id: 'jacket-meta', cat: 'Metadata', label: 'Jacket Meta',      icon: '▣'  },
  // Validate
  { id: 'chart-validator', cat: 'Validate', label: 'Chart Validator', icon: '✓'  },
  { id: 'laser-fixer',     cat: 'Validate', label: 'Laser Fixer',     icon: '⤢'  },
];

// ── Per-tool settings schema ──────────────────────────────────────────────────
const TOOL_SETTINGS = {
  'bpm-sync':     [
    { key:'defaultDiv', label:'Default subdivision', type:'select',
      opts:['0','1','2','3','4','5','6','7'],
      labels:['1/4','1/8','1/12 (triplet)','1/16','1/24 (triplet)','1/32','1/48','1/64'],
      default:'3' },
    { key:'autoRead', label:'Auto-read BPM from chart', type:'toggle', default:true },
  ],
  'laser-smooth': [
    { key:'algo',  label:'Default algorithm', type:'select',
      opts:['chaikin','mavg','resample'], labels:['Chaikin','Moving Avg','Resample'], default:'chaikin' },
    { key:'iters', label:'Default iterations', type:'number', min:1, max:10, default:2 },
  ],
  'density-heatmap': [
    { key:'window', label:'Window size (measures)', type:'number', min:1, max:8, default:1 },
    { key:'color',  label:'High-density color',     type:'color',  default:'#ff3300' },
  ],
  'chart-validator': [
    { key:'checkOverlaps', label:'Check BT note overlaps',  type:'toggle', default:true },
    { key:'checkFX',       label:'Check FX note overlaps',  type:'toggle', default:true },
    { key:'checkLasers',   label:'Check laser sections',    type:'toggle', default:true },
    { key:'checkMeta',     label:'Check metadata',          type:'toggle', default:true },
    { key:'strict',        label:'Strict mode (warnings = fail)', type:'toggle', default:false },
  ],
  'adaptive-compress': [
    { key:'threshold', label:'Default threshold (notes/beat)', type:'number', min:0.5, max:8, default:4 },
    { key:'window',    label:'Default window (measures)',      type:'select',
      opts:['1','2','4','8'], labels:['1 measure','2 measures','4 measures','8 measures'], default:'2' },
    { key:'targetBt',  label:'Target BT lanes by default',   type:'toggle', default:true },
    { key:'targetFx',  label:'Target FX lanes by default',   type:'toggle', default:true },
  ],
  'pattern-lib': [
    { key:'maxPatterns', label:'Max stored patterns', type:'number', min:5, max:100, default:20 },
  ],
  'hand-opt': [
    { key:'stretchThreshold', label:'Stretch penalty threshold (notes)', type:'number', min:1, max:10, default:3 },
  ],
  'timing-window': [
    { key:'sCritMs', label:'S-CRITICAL window (ms)', type:'number', min:10, max:100, default:34 },
    { key:'critMs',  label:'CRITICAL window (ms)',   type:'number', min:20, max:150, default:67 },
    { key:'nearMs',  label:'NEAR window (ms)',        type:'number', min:50, max:300, default:133 },
  ],
};

// ── Settings persistence ──────────────────────────────────────────────────────
const _SETTINGS_KEY  = 'vibe_editr_tool_settings';
const _PINS_KEY      = 'vibe_editr_pinned_tools';
const _WIN_STATE_KEY = 'vibe_editr_tools_win';

function _loadAllSettings() { try { return JSON.parse(localStorage.getItem(_SETTINGS_KEY) || '{}'); } catch { return {}; } }
function _saveAllSettings(s) { try { localStorage.setItem(_SETTINGS_KEY, JSON.stringify(s)); } catch {} }
function _getTS(toolId, key) {
  const schema = (TOOL_SETTINGS[toolId] ?? []).find(s => s.key === key);
  return _loadAllSettings()[toolId]?.[key] ?? schema?.default;
}
function _setTS(toolId, key, val) {
  const all = _loadAllSettings();
  (all[toolId] = all[toolId] || {})[key] = val;
  _saveAllSettings(all);
}
function _loadPins() { try { return JSON.parse(localStorage.getItem(_PINS_KEY) || '[]'); } catch { return []; } }
function _savePins(p) { try { localStorage.setItem(_PINS_KEY, JSON.stringify(p)); } catch {} }
function _loadWinState() { try { return JSON.parse(localStorage.getItem(_WIN_STATE_KEY) || 'null'); } catch { return null; } }
function _saveWinState(s) { try { localStorage.setItem(_WIN_STATE_KEY, JSON.stringify(s)); } catch {} }
function _getWinDims(win) { return { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height }; }

// ── Window state ──────────────────────────────────────────────────────────────
let _winEl = null;
let _activeToolId = null;

// ── Public API ────────────────────────────────────────────────────────────────
export function openToolsWindow() {
  if (!_winEl) return;
  _winEl.style.display = 'flex';
  _winEl.classList.remove('tw-collapsed');
  _saveWinState({ ..._getWinDims(_winEl), hidden: false });
  if (_activeToolId) _activateTool(_activeToolId);
}

// ── Init ─────────────────────────────────────────────────────────────────────
function _buildWelcomeGrid() {
  const grid = document.getElementById('tw-welcome-grid');
  if (!grid) return;
  grid.innerHTML = '';
  TOOL_REGISTRY.forEach(tool => {
    const card = _h('div', 'tw-welcome-card');
    card.title = `${tool.cat} · ${tool.label}`;
    card.innerHTML = `<span class="wc-icon">${tool.icon}</span><span class="wc-name">${tool.label}</span><span class="wc-cat">${tool.cat}</span>`;
    card.addEventListener('click', () => _activateTool(tool.id));
    grid.appendChild(card);
  });
}

export function initTools() {
  _winEl = _buildWindow();
  document.body.appendChild(_winEl);
  // Build sidebar and welcome grid NOW — elements are in the live DOM
  _buildSidebar();
  _buildWelcomeGrid();
  // Restore position/size — but reject fullscreen/maximized states
  const st = _loadWinState();
  if (st) {
    const badW = !st.width  || st.width.includes('%')    || st.width.includes('calc');
    const badH = !st.height || st.height.includes('calc') || st.height.includes('%');
    if (badW || badH) {
      // Saved state was maximized — discard it so CSS defaults kick in
      _saveWinState({ left: '120px', top: '50px', width: '620px', height: '440px' });
    } else {
      if (st.left)   _winEl.style.left   = st.left;
      if (st.top)    _winEl.style.top    = st.top;
      if (st.width)  _winEl.style.width  = st.width;
      if (st.height) _winEl.style.height = st.height;
      if (st.hidden) _winEl.style.display = 'none';
      if (st.collapsed) _winEl.classList.add('tw-collapsed');
    }
  }
}

// ── Window builder ────────────────────────────────────────────────────────────
function _buildWindow() {
  const win = document.createElement('div');
  win.className = 'tw-window';
  win.innerHTML = `
    <div class="tw-titlebar" id="tw-titlebar">
      <div class="tw-trafficlights">
        <button class="tw-tl tw-tl-close"  id="tw-close" title="Close"></button>
        <button class="tw-tl tw-tl-min"    id="tw-min"   title="Minimize"></button>
        <button class="tw-tl tw-tl-max"    id="tw-max"   title="Maximize/Restore"></button>
      </div>
      <span class="tw-win-title">Tools Hub — vibe-editr</span>
      <span class="tw-win-spacer"></span>
    </div>
    <div class="tw-body">
      <nav class="tw-sidebar" id="tw-sidebar">
        <div class="tw-search-wrap">
          <input class="tw-search-inp" id="tw-search" placeholder="Search tools…" type="text">
        </div>
        <div class="tw-tool-list" id="tw-tool-list"></div>
      </nav>
      <div class="tw-main" id="tw-main">
        <div class="tw-welcome" id="tw-welcome">
          <div class="tw-welcome-header">Tools Hub &mdash; ${TOOL_REGISTRY.length} tools &middot; Click to open &middot; &#9733; to pin</div>
          <div class="tw-welcome-grid" id="tw-welcome-grid"></div>
        </div>
        <div class="tw-tool-view" id="tw-tool-view" style="display:none">
          <div class="tw-tool-topbar" id="tw-tool-topbar"></div>
          <div class="tw-tool-body"   id="tw-tool-body"></div>
          <div class="tw-settings-overlay" id="tw-settings-overlay" style="display:none"></div>
        </div>
      </div>
    </div>
    <div class="tw-resize-handle" id="tw-resize"></div>`;

  // Traffic light controls
  win.querySelector('#tw-close').addEventListener('click', () => {
    win.style.display = 'none';
    _saveWinState({ ..._getWinDims(win), hidden: true });
  });
  win.querySelector('#tw-min').addEventListener('click', () => {
    const c = win.classList.toggle('tw-collapsed');
    _saveWinState({ ..._getWinDims(win), collapsed: c });
  });
  win.querySelector('#tw-max').addEventListener('click', () => {
    if (win.classList.toggle('tw-maximized')) {
      win.dataset.prevLeft   = win.style.left;
      win.dataset.prevTop    = win.style.top;
      win.dataset.prevWidth  = win.style.width;
      win.dataset.prevHeight = win.style.height;
      Object.assign(win.style, { left:'0', top:'34px', width:'100%', height:'calc(100vh - 34px)', right:'auto' });
    } else {
      Object.assign(win.style, {
        left:   win.dataset.prevLeft   || '120px',
        top:    win.dataset.prevTop    || '80px',
        width:  win.dataset.prevWidth  || '740px',
        height: win.dataset.prevHeight || '520px',
      });
    }
  });

  _makeDraggable(win, win.querySelector('#tw-titlebar'));
  _makeResizable(win, win.querySelector('#tw-resize'));
  win.querySelector('#tw-search').addEventListener('input', e => _filterSidebar(e.target.value.toLowerCase()));
  // NOTE: _buildSidebar() is called AFTER appendChild in initTools()
  // so document.getElementById can find #tw-tool-list in the live DOM.
  return win;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function _buildSidebar() {
  const list = document.getElementById('tw-tool-list');
  if (!list) return;
  list.innerHTML = '';
  const pins = _loadPins();
  const cats = [...new Set(TOOL_REGISTRY.map(t => t.cat))];

  if (pins.length) {
    list.appendChild(_catLabel('★ Pinned'));
    pins.forEach(id => { const t = TOOL_REGISTRY.find(x => x.id === id); if (t) list.appendChild(_toolItem(t)); });
  }
  cats.forEach(cat => {
    list.appendChild(_catLabel(cat));
    TOOL_REGISTRY.filter(t => t.cat === cat).forEach(t => list.appendChild(_toolItem(t)));
  });
}

function _catLabel(text) {
  const d = document.createElement('div');
  d.className = 'tw-cat-label';
  d.textContent = text;
  return d;
}

function _toolItem(t) {
  const pins = _loadPins();
  const isPinned = pins.includes(t.id);
  const item = document.createElement('div');
  item.className = 'tw-tool-item' + (t.id === _activeToolId ? ' tw-active' : '') + (isPinned ? ' tw-pinned' : '');
  item.dataset.id = t.id;
  item.innerHTML = `<span class="tw-item-icon">${t.icon}</span><span class="tw-item-label">${t.label}</span><button class="tw-pin" title="${isPinned?'Unpin':'Pin'}">${isPinned?'★':'☆'}</button>`;
  item.querySelector('.tw-pin').addEventListener('click', e => {
    e.stopPropagation();
    const p = _loadPins();
    const i = p.indexOf(t.id);
    i >= 0 ? p.splice(i, 1) : p.unshift(t.id);
    _savePins(p);
    _buildSidebar();
  });
  item.addEventListener('click', e => { if (!e.target.classList.contains('tw-pin')) _activateTool(t.id); });
  return item;
}

function _filterSidebar(q) {
  const list = document.getElementById('tw-tool-list');
  if (!list) return;
  list.querySelectorAll('.tw-tool-item').forEach(item => {
    item.style.display = (!q || item.querySelector('.tw-item-label')?.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
  list.querySelectorAll('.tw-cat-label').forEach(cat => {
    let sib = cat.nextElementSibling, any = false;
    while (sib && !sib.classList.contains('tw-cat-label')) { if (sib.style.display !== 'none') any = true; sib = sib.nextElementSibling; }
    cat.style.display = any ? '' : 'none';
  });
}

// ── Tool activation ───────────────────────────────────────────────────────────
function _activateTool(id) {
  _activeToolId = id;
  // Update sidebar highlights
  document.querySelectorAll('.tw-tool-item').forEach(el => el.classList.toggle('tw-active', el.dataset.id === id));

  const def = TOOL_REGISTRY.find(t => t.id === id);
  if (!def) return;

  document.getElementById('tw-welcome').style.display = 'none';
  const tv = document.getElementById('tw-tool-view');
  tv.style.display = 'flex';

  // Tool topbar
  const hasSettings = !!(TOOL_SETTINGS[id]?.length);
  const topbar = document.getElementById('tw-tool-topbar');
  topbar.innerHTML = `
    <span class="tw-tool-icon-lg">${def.icon}</span>
    <div class="tw-tool-meta">
      <div class="tw-tool-title">${def.label}</div>
      <div class="tw-tool-cat">${def.cat}</div>
    </div>
    <div class="tw-topbar-actions">
      <button class="tw-action-btn" id="tw-refresh-btn" title="Refresh / Re-run">↺ Refresh</button>
      ${hasSettings ? '<button class="tw-action-btn tw-settings-btn" id="tw-settings-btn">⚙ Customize</button>' : ''}
    </div>`;

  topbar.querySelector('#tw-refresh-btn').addEventListener('click', () => _activateTool(id));
  if (hasSettings) topbar.querySelector('#tw-settings-btn')?.addEventListener('click', () => _openSettings(id));

  // Render tool content
  const body = document.getElementById('tw-tool-body');
  body.innerHTML = '';
  document.getElementById('tw-settings-overlay').style.display = 'none';
  // Prepend localized description if a key exists for this tool
  const descKey = 'tool.desc.' + id;
  if (typeof t === 'function' && t(descKey) !== descKey) {
    body.appendChild(_toolDesc(descKey));
  }
  try { _renderTool(id, body); }
  catch (err) { body.innerHTML = `<div style="color:#ff6666;padding:16px;font-size:12px">⚠ Error: ${err.message}</div>`; console.error('[tools]', err); }
}

// ── Per-tool settings overlay ─────────────────────────────────────────────────
function _openSettings(toolId) {
  const overlay = document.getElementById('tw-settings-overlay');
  const schema  = TOOL_SETTINGS[toolId] ?? [];
  const def     = TOOL_REGISTRY.find(t => t.id === toolId);
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="tw-settings-header">
      <span>⚙ Customize — ${def?.label ?? toolId}</span>
      <button class="tw-settings-close" id="tw-s-close">✕ Done</button>
    </div>
    <div class="tw-settings-body" id="tw-settings-body"></div>
    <div style="margin-top:auto;padding-top:12px;display:flex;gap:8px">
      <button class="tool-btn-action" id="tw-s-reset" style="background:#1a0a0a;border-color:#882233;color:#ff8888">↺ Reset defaults</button>
    </div>`;

  const body = overlay.querySelector('#tw-settings-body');
  schema.forEach(s => {
    const row = document.createElement('div');
    row.className = 'tool-row';
    const lbl = document.createElement('label');
    lbl.textContent = s.label + ':';
    let inp;
    if (s.type === 'toggle') {
      inp = document.createElement('input'); inp.type = 'checkbox';
      inp.checked = _getTS(toolId, s.key) ?? s.default;
      inp.addEventListener('change', () => _setTS(toolId, s.key, inp.checked));
    } else if (s.type === 'select') {
      inp = document.createElement('select');
      s.opts.forEach((o, i) => { const opt = document.createElement('option'); opt.value = o; opt.textContent = s.labels?.[i] ?? o; if (String(_getTS(toolId, s.key) ?? s.default) === o) opt.selected = true; inp.appendChild(opt); });
      inp.addEventListener('change', () => _setTS(toolId, s.key, inp.value));
    } else if (s.type === 'color') {
      inp = document.createElement('input'); inp.type = 'color';
      inp.value = _getTS(toolId, s.key) ?? s.default;
      inp.addEventListener('input', () => _setTS(toolId, s.key, inp.value));
    } else {
      inp = document.createElement('input'); inp.type = 'number';
      inp.min = s.min; inp.max = s.max; inp.style.width = '70px';
      inp.value = _getTS(toolId, s.key) ?? s.default;
      inp.addEventListener('change', () => _setTS(toolId, s.key, +inp.value));
    }
    row.appendChild(lbl); row.appendChild(inp);
    body.appendChild(row);
  });

  overlay.querySelector('#tw-s-close').addEventListener('click', () => {
    overlay.style.display = 'none';
    _activateTool(toolId);
  });
  overlay.querySelector('#tw-s-reset').addEventListener('click', () => {
    const all = _loadAllSettings(); delete all[toolId]; _saveAllSettings(all);
    _openSettings(toolId);
  });
}

// ── Drag & resize ─────────────────────────────────────────────────────────────
function _makeDraggable(win, handle) {
  let ox, oy, mx, my, on = false;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button') || win.classList.contains('tw-maximized')) return;
    on = true; ox = win.offsetLeft; oy = win.offsetTop; mx = e.clientX; my = e.clientY;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!on) return;
    win.style.right = 'auto';
    win.style.left  = Math.max(0, ox + e.clientX - mx) + 'px';
    win.style.top   = Math.max(0, oy + e.clientY - my) + 'px';
  });
  document.addEventListener('mouseup', () => { if (on) { on = false; _saveWinState(_getWinDims(win)); } });
}

function _makeResizable(win, handle) {
  let on = false, sx, sy, sw, sh;
  handle.addEventListener('mousedown', e => {
    on = true; sx = e.clientX; sy = e.clientY; sw = win.offsetWidth; sh = win.offsetHeight;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!on) return;
    win.style.width  = Math.max(520, sw + e.clientX - sx) + 'px';
    win.style.height = Math.max(360, sh + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { if (on) { on = false; _saveWinState(_getWinDims(win)); } });
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function _h(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
}

function _row(label, inputEl) {
  const r = _h('div', 'tool-row');
  const l = _h('label', '', label);
  r.appendChild(l); r.appendChild(inputEl);
  return r;
}

function _btn(label, cls) {
  const b = _h('button', cls || 'tool-btn-action', label);
  return b;
}

function _section(title) {
  const s = _h('div', 'tool-section');
  if (title) { const h = _h('div', 'tool-section-title', title); s.appendChild(h); }
  return s;
}

function _statGrid(cells) {
  const grid = _h('div', 'tool-stat-grid');
  cells.forEach(({ label, value, color }) => {
    const cell = _h('div', 'tool-stat-cell');
    const v = _h('div', 'tsv', String(value));
    if (color) v.style.color = color;
    const l = _h('div', 'tsl', label.toUpperCase());
    cell.appendChild(v); cell.appendChild(l);
    grid.appendChild(cell);
  });
  return grid;
}

function _badge(text, type) {
  return _h('span', `tool-badge tool-badge-${type || 'info'}`, String(text));
}

// Creates a top-level tool description banner using the i18n key
function _toolDesc(key) {
  const txt = (typeof t === 'function') ? t(key) : key;
  const d = _h('div', 'tool-desc', txt);
  d.setAttribute('data-i18n-key', key);
  return d;
}

// Appends a sub-section description paragraph to an existing section element
function _subDesc(sec, key) {
  const txt = (typeof t === 'function') ? t(key) : key;
  const d = _h('div', 'tool-subdesc', txt);
  d.setAttribute('data-i18n-key', key);
  sec.appendChild(d);
  return d;
}

function _noteCount() {
  if (!(typeof chart !== "undefined" && chart)) return 0;
  let c = 0;
  for (let i = 0; i < 4; i++) c += chart.bt[i].length;
  for (let i = 0; i < 2; i++) c += chart.fx[i].length;
  return c;
}

/** Convert a raw tick to a human-readable "M{m} B{b}" string. */
function _tickToMB(tick) {
  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;          // 1-indexed measure
  const b = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1; // 1-indexed beat
  return `M${m} B${b}`;
}

/** Navigate both the edit renderer and the game/preview view to a measure. */
function _goToMeasure(m) {
  if (!(renderer && renderer.playTick !== undefined)) return;
  const targetTick = Math.max(0, m * TICKS_PER_MEASURE);
  renderer.playTick = targetTick;

  // Keep the column viewport centred on the target measure
  if (renderer.measPerCol !== undefined && renderer.numCols !== undefined) {
    const colLen    = renderer.measPerCol * TICKS_PER_MEASURE;
    const targetCol = Math.floor(targetTick / colLen);
    if (targetCol < renderer.scrollCol || targetCol >= renderer.scrollCol + renderer.numCols) {
      renderer.scrollCol = Math.max(0, targetCol - Math.floor(renderer.numCols / 2));
    }
  }

  // Sync the game/preview view too so it jumps in real-time
  if (gameView) {
    gameView.playTick = targetTick;
    if (typeof gameView.draw === 'function') gameView.draw();
  }

  if (typeof updateSeekbar === 'function') updateSeekbar(targetTick);
  if (typeof updateRadar   === 'function') updateRadar();
  if (typeof render        === 'function') render();
}

function _getBpm() {
  if (!(typeof chart !== "undefined" && chart)) return 180;
  return chart.bpmEvents[0]?.bpm ?? 180;
}

// ── Tool renderer ──────────────────────────────────────────────────────────────
function _renderTool(id, container) {
  switch (id) {
    case 'bpm-sync':      return _toolBpmSync(container);
    case 'chart-validator': return _toolChartValidator(container);
    case 'chart-stats':   return _toolChartStats(container);
    case 'laser-fixer':   return _toolLaserFixer(container);
    case 'laser-smooth':  return _toolLaserSmooth(container);
    case 'density-heatmap': return _toolDensityHeatmap(container);
    case 'multi-sync':    return _toolMultiSync(container);
    case 'vol-angle':     return _toolVolAngle(container);
    case 'fx-gen':        return _toolFxGen(container);
    case 'offset-finder': return _toolOffsetFinder(container);
    case 'jacket-meta':   return _toolJacketMeta(container);
    case 'hand-opt':      return _toolHandOpt(container);
    case 'keysound':      return _toolKeysound(container);
    case 'scale':         return _toolScale(container);
    case 'hold-render':   return _toolHoldRender(container);
    case 'timing-window': return _toolTimingWindow(container);
    case 'symmetry':      return _toolSymmetry(container);
    case 'pattern-lib':   return _toolPatternLib(container);
    case 'waveform-align':return _toolWaveformAlign(container);
    case 'audio-anchor':  return _toolAudioAnchor(container);
    case 'collision':      return _toolChartValidator(container); // redirected
    case 'export-validate':return _toolChartValidator(container); // redirected
    case 'visual-mode':       return _toolVisualMode(container);
    case 'adaptive-compress': return _toolAdaptiveCompress(container);
    default: container.textContent = 'Unknown tool: ' + id;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. BPM Sync Calculator
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolBpmSync(c) {
  const sec = _section('BPM Sync Calculator');
  c.appendChild(sec);

  const bpmIn = document.createElement('input');
  bpmIn.type = 'number'; bpmIn.value = _getBpm(); bpmIn.min = 1; bpmIn.max = 999; bpmIn.step = 0.01;

  const subdivSel = document.createElement('select');
  const subdivs = [
    {label:'1/4 beat',  div:1,  triplet:false},
    {label:'1/8 beat',  div:2,  triplet:false},
    {label:'1/12 (1/8T)',div:3, triplet:true },
    {label:'1/16 beat', div:4,  triplet:false},
    {label:'1/24 (1/16T)',div:6,triplet:true },
    {label:'1/32 beat', div:8,  triplet:false},
    {label:'1/48 (1/32T)',div:12,triplet:true},
    {label:'1/64 beat', div:16, triplet:false},
  ];
  subdivs.forEach((s, i) => {
    const o = document.createElement('option'); o.value = i; o.textContent = s.label;
    subdivSel.appendChild(o);
  });

  const out = _h('div', 'tool-result-box');

  function recalc() {
    const bpm = parseFloat(bpmIn.value) || _getBpm();
    const sd = subdivs[+subdivSel.value];
    const msBeat = 60000 / bpm;
    const msNote = msBeat / sd.div;
    const ticksNote = TICKS_PER_BEAT / sd.div;
    const nps = 1000 / msNote;
    out.innerHTML = '';
    out.appendChild(_statGrid([
      { label: 'ms / beat',    value: msBeat.toFixed(2)    },
      { label: 'ms / note',    value: msNote.toFixed(2)    },
      { label: 'ticks / note', value: ticksNote.toFixed(2) },
      { label: 'NPS',          value: nps.toFixed(2), color: nps > 20 ? '#ff6655' : nps > 12 ? '#ffaa33' : '#44dd88' },
    ]));
  }

  bpmIn.addEventListener('input', recalc);
  subdivSel.addEventListener('change', recalc);

  const snapBtn = _btn('Snap all notes to nearest subdivision');
  snapBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    const bpm = parseFloat(bpmIn.value) || _getBpm();
    const sd = subdivs[+subdivSel.value];
    const ticksNote = TICKS_PER_BEAT / sd.div;
    if (ticksNote < 1) { alert('Subdivision too fine.'); return; }
    if (typeof saveUndo === 'function') saveUndo('BPM Snap');
    const snap = t => Math.round(t / ticksNote) * ticksNote;
    for (let i = 0; i < 4; i++) chart.bt[i].forEach(n => { n.y = snap(n.y); });
    for (let i = 0; i < 2; i++) chart.fx[i].forEach(n => { n.y = snap(n.y); });
    if (typeof render === 'function') render();
    out.appendChild(_h('div', 'tool-result-item tool-result-ok', '✓ Snapped all notes'));
  });

  sec.appendChild(_row('BPM:', bpmIn));
  sec.appendChild(_row('Subdivision:', subdivSel));
  sec.appendChild(out);
  sec.appendChild(snapBtn);
  recalc();
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. Difficulty Curve Analyzer
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolDifficulty(c) {
  const sec = _section('Difficulty Curve Analyzer');
  c.appendChild(sec);

  const windowSl = document.createElement('input');
  windowSl.type = 'range'; windowSl.min = 1; windowSl.max = 16; windowSl.value = 4;
  const windowLbl = _h('span', '', '4 measures');

  const canvas = document.createElement('canvas');
  canvas.width = 360; canvas.height = 160;
  canvas.style.cssText = 'width:100%;height:160px;display:block;border:1px solid #2a2a44;border-radius:4px;background:#0d0d14;margin-top:8px';

  const statsEl = _h('div', 'tool-result-box');

  function draw() {
    const wm = parseInt(windowSl.value);
    windowLbl.textContent = wm + ' measure' + (wm > 1 ? 's' : '');
    if (!(typeof chart !== "undefined" && chart)) return;
    const totalM = chart.totalMeasures || 64;
    const windowTicks = wm * TICKS_PER_MEASURE;
    const npsArr = [];
    for (let m = 0; m < totalM; m++) {
      const startT = m * TICKS_PER_MEASURE;
      const endT = startT + windowTicks;
      let cnt = 0;
      for (let i = 0; i < 4; i++) chart.bt[i].forEach(n => { if (n.y >= startT && n.y < endT) cnt++; });
      for (let i = 0; i < 2; i++) chart.fx[i].forEach(n => { if (n.y >= startT && n.y < endT) cnt++; });
      const bpm = chart.getBpmAt(startT);
      const secPerMeasure = (60 / bpm) * BEATS_PER_MEASURE;
      npsArr.push(cnt / (secPerMeasure * wm));
    }
    const peak = Math.max(...npsArr, 0.01);
    const avg = npsArr.reduce((a, b) => a + b, 0) / (npsArr.length || 1);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Area
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    npsArr.forEach((v, i) => {
      const x = (i / totalM) * canvas.width;
      const y = canvas.height - (v / peak) * canvas.height;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, 'rgba(0,207,255,0.6)');
    grad.addColorStop(1, 'rgba(0,207,255,0.05)');
    ctx.fillStyle = grad;
    ctx.fill();
    // Line
    ctx.beginPath();
    npsArr.forEach((v, i) => {
      const x = (i / totalM) * canvas.width;
      const y = canvas.height - (v / peak) * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00cfff'; ctx.lineWidth = 1.5; ctx.stroke();
    // Avg line
    const avgY = canvas.height - (avg / peak) * canvas.height;
    ctx.beginPath(); ctx.moveTo(0, avgY); ctx.lineTo(canvas.width, avgY);
    ctx.strokeStyle = '#ff3aad66'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    statsEl.innerHTML = `<div class="tool-result-item">Peak NPS: <b>${peak.toFixed(2)}</b></div>
      <div class="tool-result-item">Avg NPS: <b>${avg.toFixed(2)}</b></div>`;
  }

  windowSl.addEventListener('input', draw);
  sec.appendChild(_row('Window (measures):', windowSl));
  sec.appendChild(windowLbl);
  sec.appendChild(canvas);
  sec.appendChild(statsEl);
  setTimeout(draw, 50);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. Chart Validity Checker
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolValidity(c) {
  const sec = _section('Chart Validity Checker');
  c.appendChild(sec);

  const runBtn   = _btn('Run Checks');
  const fixBtn   = _btn('Auto Fix');
  fixBtn.style.cssText = 'margin-left:6px;background:#1a3a1a;border-color:#3a7a3a;color:#88ff88';
  const results = _h('div', 'tool-result-box');
  const btnRow = _h('div', '');
  btnRow.style.cssText = 'display:flex;gap:6px;margin-bottom:4px';
  btnRow.appendChild(runBtn);
  btnRow.appendChild(fixBtn);
  sec.appendChild(btnRow);
  sec.appendChild(results);

  runBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== "undefined" && chart)) { results.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }
    const issues = [];

    // Overlapping BT
    for (let i = 0; i < 4; i++) {
      const arr = chart.bt[i];
      for (let j = 0; j < arr.length - 1; j++) {
        const n = arr[j], nx = arr[j+1];
        if (n.y + Math.max(n.len, 1) > nx.y) {
          issues.push({ type: 'err', msg: `BT-${['A','B','C','D'][i]} overlap at ${_tickToMB(n.y)}`, measure: Math.floor(n.y / TICKS_PER_MEASURE), tick: n.y });
        }
      }
    }
    // Overlapping FX
    for (let i = 0; i < 2; i++) {
      const arr = chart.fx[i];
      for (let j = 0; j < arr.length - 1; j++) {
        const n = arr[j], nx = arr[j+1];
        if (n.y + Math.max(n.len, 1) > nx.y) {
          issues.push({ type: 'err', msg: `FX-${['L','R'][i]} overlap at ${_tickToMB(n.y)}`, measure: Math.floor(n.y / TICKS_PER_MEASURE), tick: n.y });
        }
      }
    }
    // Laser sections < 2 points
    for (let s = 0; s < 2; s++) {
      chart.lasers[s].forEach((sec2, si) => {
        if (sec2.points.length < 2) {
          issues.push({ type: 'err', msg: `VOL-${['L','R'][s]} section ${si} has < 2 points`, measure: Math.floor(sec2.y / TICKS_PER_MEASURE) });
        }
      });
    }
    // Laser v out of range
    for (let s = 0; s < 2; s++) {
      chart.lasers[s].forEach((sec2, si) => {
        sec2.points.forEach((p, pi) => {
          if (p.v < 0 || p.v > 1) {
            issues.push({ type: 'err', msg: `VOL-${['L','R'][s]} section ${si} point ${pi} v=${p.v.toFixed(3)} out of [0,1]`, measure: Math.floor(sec2.y / TICKS_PER_MEASURE) });
          }
        });
      });
    }
    // ── Illegal: overlapping laser sections on the same side ──────────────
    // In SDVX, two simultaneous laser sections on the same side cannot exist.
    for (let s = 0; s < 2; s++) {
      const secs = (chart.lasers[s] || []).slice().sort((a, b) => a.y - b.y);
      for (let i = 0; i < secs.length - 1; i++) {
        const A = secs[i];
        const lastPt = A.points[A.points.length - 1];
        const aEnd   = A.y + (lastPt?.ry ?? 0);
        const B      = secs[i + 1];
        if (B.y < aEnd) {
          issues.push({
            type: 'err',
            msg:  `⛔ ILLEGAL: VOL-${['L','R'][s]} sections overlap (tick ${A.y}–${aEnd} vs ${B.y}) — physically impossible`,
            measure: Math.floor(A.y / TICKS_PER_MEASURE),
          });
        }
      }
    }

    // ── Illegal: zero-duration laser section (no movement = dead section) ──
    for (let s = 0; s < 2; s++) {
      (chart.lasers[s] || []).forEach((sec2, si) => {
        const lastPt = sec2.points[sec2.points.length - 1];
        const dur    = lastPt?.ry ?? 0;
        if (dur === 0) {
          issues.push({
            type: 'err',
            msg:  `⛔ ILLEGAL: VOL-${['L','R'][s]} section ${si} zero-duration at ${_tickToMB(sec2.y)}`,
            measure: Math.floor(sec2.y / TICKS_PER_MEASURE), tick: sec2.y,
          });
        }
      });
    }

    // ── Illegal: simultaneous inputs exceeding physical hand capacity ───────
    // SDVX physical layout:
    //   Left hand:  BT-A (bt[0]), BT-B (bt[1]), FX-L (fx[0])  — max 3 simultaneously
    //   Right hand: BT-C (bt[2]), BT-D (bt[3]), FX-R (fx[1])  — max 3 simultaneously
    // Truly impossible: any single tick needing a hand to do 4+ button presses
    // (left laser + BT-A + BT-B + FX-L all chips = left hand overwhelmed)
    // We only flag chip notes (len===0) since holds can be held with palm.
    {
      // Build a tick → {leftChips, rightChips} map for chip-only events
      const chipMap = new Map();
      const addChip = (tick, side) => {
        if (!chipMap.has(tick)) chipMap.set(tick, { l: 0, r: 0 });
        chipMap.get(tick)[side === 0 ? 'l' : 'r']++;
      };
      for (let i = 0; i < 4; i++) {
        chart.bt[i].forEach(n => { if (n.len === 0) addChip(n.y, i < 2 ? 0 : 1); });
      }
      for (let i = 0; i < 2; i++) {
        chart.fx[i].forEach(n => { if (n.len === 0) addChip(n.y, i); });
      }
      chipMap.forEach((counts, tick) => {
        if (counts.l > 3) {
          issues.push({
            type: 'err',
            msg:  `⛔ ILLEGAL: Left hand ${counts.l} simultaneous chips at ${_tickToMB(tick)} (max 3)`,
            measure: Math.floor(tick / TICKS_PER_MEASURE), tick,
          });
        }
        if (counts.r > 3) {
          issues.push({
            type: 'err',
            msg:  `⛔ ILLEGAL: Right hand ${counts.r} simultaneous chips at ${_tickToMB(tick)} (max 3)`,
            measure: Math.floor(tick / TICKS_PER_MEASURE), tick,
          });
        }
      });
    }

    // ── Hard warning: slam + immediate same-side button within 6 ticks ─────
    // When a laser slams (>0.25 position jump in <1/32 note = 6 ticks) it is
    // physically very hard (not illegal) to also press buttons on that side.
    for (let s = 0; s < 2; s++) {
      (chart.lasers[s] || []).forEach(sec2 => {
        for (let pi = 0; pi < sec2.points.length - 1; pi++) {
          const p0 = sec2.points[pi], p1 = sec2.points[pi + 1];
          const dt = p1.ry - p0.ry;
          const dv = Math.abs(p1.v - p0.v);
          if (dt <= 6 && dv >= 0.25) {
            // It's a slam at tick sec2.y + p0.ry
            const slamTick = sec2.y + p0.ry;
            // Check for same-side chip within ±6 ticks
            const sideBtn  = s === 0 ? [chart.bt[0], chart.bt[1], chart.fx[0]] : [chart.bt[2], chart.bt[3], chart.fx[1]];
            const hasBtn   = sideBtn.some(arr => arr.some(n => n.len === 0 && Math.abs(n.y - slamTick) <= 6));
            if (hasBtn) {
              issues.push({
                type: 'warn',
                msg:  `⚠ Hard: VOL-${['L','R'][s]} slam at ${_tickToMB(slamTick)} overlaps same-hand chip`,
                measure: Math.floor(slamTick / TICKS_PER_MEASURE), tick: slamTick,
              });
            }
          }
        }
      });
    }

    // ── Hard warning: extreme note density (>32 notes in 1 measure) ────────
    {
      const allNotes = [];
      for (let i = 0; i < 4; i++) chart.bt[i].forEach(n => allNotes.push(n.y));
      for (let i = 0; i < 2; i++) chart.fx[i].forEach(n => allNotes.push(n.y));
      const totalMeasures = Math.ceil((chart.bpmEvents[0]?.bpm || 120) / 1); // rough
      const measSet = new Set(allNotes.map(t => Math.floor(t / TICKS_PER_MEASURE)));
      measSet.forEach(m => {
        const start = m * TICKS_PER_MEASURE, end = start + TICKS_PER_MEASURE;
        const count = allNotes.filter(t => t >= start && t < end).length;
        if (count > 32) {
          issues.push({
            type: 'warn',
            msg:  `⚠ Dense: M${m + 1} has ${count} note events (very high density)`,
            measure: m, tick: m * TICKS_PER_MEASURE,
          });
        }
      });
    }

    // ── Missing title ──────────────────────────────────────────────────────
    if (!chart.meta.title) issues.push({ type: 'warn', msg: 'No title set', measure: null });
    // Missing BPM at tick 0
    if (!chart.bpmEvents.some(e => e.y === 0)) issues.push({ type: 'warn', msg: 'No BPM event at tick 0', measure: 0 });

    if (issues.length === 0) {
      results.innerHTML = '<div class="tool-result-item tool-result-ok">✓ No issues found — chart is clean</div>';
      return;
    }

    // Sort: illegal errors first, then warnings
    issues.sort((a, b) => (a.type === b.type ? 0 : a.type === 'err' ? -1 : 1));

    // Emit annotation overlays for up to 10 flagged measures
    if (typeof addChartAnnotation === 'function') {
      issues
        .filter(i => i.measure !== null && i.measure !== undefined)
        .slice(0, 10)
        .forEach(issue => {
          addChartAnnotation({
            tick:     issue.measure * TICKS_PER_MEASURE,
            label:    issue.msg.replace(/^[⛔⚠]\s*/, '').slice(0, 35),
            severity: issue.type === 'err' ? 'error' : 'warn',
            source:   'validity',
          });
        });
      if (typeof render === 'function') render();
    }

    // Summary banner
    const errCount  = issues.filter(i => i.type === 'err').length;
    const warnCount = issues.filter(i => i.type === 'warn').length;
    const sumRow = _h('div', 'tool-result-item', '');
    sumRow.style.cssText = 'background:#1a0808;border-color:#882233;color:#ff8888;font-weight:700;margin-bottom:6px';
    sumRow.textContent = `${errCount > 0 ? `⛔ ${errCount} illegal pattern${errCount > 1 ? 's' : ''}` : ''}` +
      `${errCount > 0 && warnCount > 0 ? ' · ' : ''}` +
      `${warnCount > 0 ? `⚠ ${warnCount} hard/warning${warnCount > 1 ? 's' : ''}` : ''}`;
    results.appendChild(sumRow);

    issues.forEach(issue => {
      const cls = issue.type === 'err' ? 'tool-result-err' : 'tool-result-warn';
      const row = _h('div', `tool-result-item ${cls}`);
      row.textContent = issue.msg;
      if (issue.measure !== null && issue.measure !== undefined) {
        row.style.cursor = 'pointer';
        const mDisp = issue.measure + 1;
        row.title = `Click → M${mDisp} in Edit & Preview`;
        // Small "→" nav hint
        const nav = document.createElement('span');
        nav.style.cssText = 'float:right;opacity:0.45;font-size:10px;margin-left:6px';
        nav.textContent = '→';
        row.appendChild(nav);
        row.addEventListener('click', () => {
          // Navigate using exact tick if available, else measure start
          const t = issue.tick != null ? issue.tick : issue.measure * TICKS_PER_MEASURE;
          if (renderer && renderer.playTick !== undefined) {
            renderer.playTick = Math.max(0, t);
            const colLen = (renderer.measPerCol ?? 1) * TICKS_PER_MEASURE;
            const col    = Math.floor(t / colLen);
            if (col < renderer.scrollCol || col >= renderer.scrollCol + (renderer.numCols ?? 1)) {
              renderer.scrollCol = Math.max(0, col - Math.floor((renderer.numCols ?? 1) / 2));
            }
            if (gameView) { gameView.playTick = renderer.playTick; if (typeof gameView.draw==='function') gameView.draw(); }
            if (typeof updateSeekbar === 'function') updateSeekbar(renderer.playTick);
            if (typeof updateRadar   === 'function') updateRadar();
            if (typeof render        === 'function') render();
          }
        });
      }
      results.appendChild(row);
    });
  });

  fixBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== 'undefined' && chart)) {
      results.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>';
      return;
    }
    if (typeof saveUndo === 'function') saveUndo('Auto Fix');
    let fixed = 0;

    // Fix BT overlaps: trim preceding note so it doesn't overlap
    for (let i = 0; i < 4; i++) {
      chart.bt[i].sort((a, b) => a.y - b.y);
      for (let j = 0; j < chart.bt[i].length - 1; j++) {
        const n = chart.bt[i][j], nx = chart.bt[i][j + 1];
        const maxEnd = nx.y - 1;
        if (n.y + Math.max(n.len, 1) > nx.y) {
          n.len = Math.max(0, maxEnd - n.y);
          fixed++;
        }
      }
    }
    // Fix FX overlaps
    for (let i = 0; i < 2; i++) {
      chart.fx[i].sort((a, b) => a.y - b.y);
      for (let j = 0; j < chart.fx[i].length - 1; j++) {
        const n = chart.fx[i][j], nx = chart.fx[i][j + 1];
        if (n.y + Math.max(n.len, 1) > nx.y) {
          n.len = Math.max(0, nx.y - 1 - n.y);
          fixed++;
        }
      }
    }
    // Fix laser: remove sections with < 2 points
    for (let s = 0; s < 2; s++) {
      const before = chart.lasers[s].length;
      chart.lasers[s] = chart.lasers[s].filter(sec2 => sec2.points.length >= 2);
      fixed += before - chart.lasers[s].length;
    }
    // Fix laser v out of range
    for (let s = 0; s < 2; s++) {
      chart.lasers[s].forEach(sec2 => {
        sec2.points.forEach(p => {
          if (p.v < 0 || p.v > 1) { p.v = Math.max(0, Math.min(1, p.v)); fixed++; }
        });
      });
    }
    // Fix zero-duration laser sections: remove them
    for (let s = 0; s < 2; s++) {
      const before = chart.lasers[s].length;
      chart.lasers[s] = chart.lasers[s].filter(sec2 => {
        const lastPt = sec2.points[sec2.points.length - 1];
        return (lastPt?.ry ?? 0) > 0;
      });
      fixed += before - chart.lasers[s].length;
    }
    // Fix overlapping laser sections: trim earlier section's last point ry
    for (let s = 0; s < 2; s++) {
      chart.lasers[s].sort((a, b) => a.y - b.y);
      for (let i = 0; i < chart.lasers[s].length - 1; i++) {
        const A = chart.lasers[s][i];
        const lastPt = A.points[A.points.length - 1];
        const aEnd   = A.y + (lastPt?.ry ?? 0);
        const B      = chart.lasers[s][i + 1];
        if (B.y < aEnd && lastPt) {
          lastPt.ry = Math.max(0, B.y - A.y - 1);
          fixed++;
        }
      }
      // Remove any that became zero-duration from above fix
      chart.lasers[s] = chart.lasers[s].filter(sec2 => {
        const lp = sec2.points[sec2.points.length - 1];
        return (lp?.ry ?? 0) > 0;
      });
    }

    if (typeof render === 'function') render();

    const msg = fixed > 0
      ? `<div class="tool-result-item tool-result-ok">Auto Fix applied ${fixed} correction${fixed !== 1 ? 's' : ''}. Run Checks to verify.</div>`
      : `<div class="tool-result-item tool-result-ok">No fixable issues found.</div>`;
    results.innerHTML = msg;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. Laser Smoothing Tool
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolLaserSmooth(c) {
  const sec = _section('Laser Smoothing Tool');
  c.appendChild(sec);

  const sideSelect = document.createElement('select');
  ['Both','Left','Right'].forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sideSelect.appendChild(o); });

  const algoSelect = document.createElement('select');
  const ALGOS = ['Chaikin','Moving Average','Resample','Physics Sim'];
  ALGOS.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a === 'Physics Sim' ? 'Physics Sim [EXP]' : a; algoSelect.appendChild(o); });

  // ── Iteration controls (Chaikin / Moving Average) ─────────────────────────
  const iterSl = document.createElement('input');
  iterSl.type = 'range'; iterSl.min = 1; iterSl.max = 5; iterSl.value = 2;
  const iterLbl = _h('span', '', '2 iterations');
  iterSl.addEventListener('input', () => iterLbl.textContent = iterSl.value + ' iterations');
  const iterRow = _row('Iterations:', iterSl);

  // ── Physics Sim controls ──────────────────────────────────────────────────
  const physDiv = document.createElement('div');
  physDiv.style.cssText = 'display:none;margin-top:4px;';

  const stiffSl = document.createElement('input');
  stiffSl.type = 'range'; stiffSl.min = 1; stiffSl.max = 50; stiffSl.value = 15;
  stiffSl.style.width = '100%';
  const stiffLbl = _h('span', '', 'stiffness 0.15');
  stiffSl.addEventListener('input', () => stiffLbl.textContent = `stiffness ${(stiffSl.value / 100).toFixed(2)}`);

  const dampSl = document.createElement('input');
  dampSl.type = 'range'; dampSl.min = 10; dampSl.max = 90; dampSl.value = 50;
  dampSl.style.width = '100%';
  const dampLbl = _h('span', '', 'damping 0.50');
  dampSl.addEventListener('input', () => dampLbl.textContent = `damping ${(dampSl.value / 100).toFixed(2)}`);

  const stepsSl = document.createElement('input');
  stepsSl.type = 'range'; stepsSl.min = 10; stepsSl.max = 200; stepsSl.value = 80;
  stepsSl.style.width = '100%';
  const stepsLbl = _h('span', '', '80 steps');
  stepsSl.addEventListener('input', () => stepsLbl.textContent = `${stepsSl.value} steps`);

  const skipSlamChk = document.createElement('input');
  skipSlamChk.type = 'checkbox'; skipSlamChk.checked = true; skipSlamChk.id = 'phys-skip-slams';
  const skipSlamLbl = document.createElement('label');
  skipSlamLbl.htmlFor = 'phys-skip-slams';
  skipSlamLbl.textContent = ' Preserve slam anchors';
  skipSlamLbl.style.cssText = 'font-size:12px;color:#c8c8f0;margin-left:4px;cursor:pointer;';

  const physNote = _h('div', '', '⚛ Spring-damper simulation. Endpoints are fixed; interior points relax toward neighbors over time.');
  physNote.style.cssText = 'font-size:10px;color:#7788aa;margin-top:4px;line-height:1.4;';

  physDiv.appendChild(_row('Stiffness:', stiffSl));
  physDiv.appendChild(stiffLbl);
  physDiv.appendChild(_row('Damping:', dampSl));
  physDiv.appendChild(dampLbl);
  physDiv.appendChild(_row('Steps:', stepsSl));
  physDiv.appendChild(stepsLbl);
  const slamRow = document.createElement('div');
  slamRow.style.cssText = 'display:flex;align-items:center;margin-top:4px;';
  slamRow.appendChild(skipSlamChk);
  slamRow.appendChild(skipSlamLbl);
  physDiv.appendChild(slamRow);
  physDiv.appendChild(physNote);

  // Show/hide controls based on algo
  function _updateAlgoUI() {
    const isPhys = algoSelect.value === 'Physics Sim';
    iterRow.style.display  = isPhys ? 'none' : '';
    iterLbl.style.display  = isPhys ? 'none' : '';
    physDiv.style.display  = isPhys ? ''     : 'none';
  }
  algoSelect.addEventListener('change', _updateAlgoUI);
  _updateAlgoUI();

  // ── Physics simulation core ───────────────────────────────────────────────
  function _physicsSmooth(pts, k, d, steps, preserveSlams) {
    if (pts.length < 3) return;
    // Identify anchor indices: first, last, and (optionally) slam points
    const anchors = new Uint8Array(pts.length);
    anchors[0] = 1;
    anchors[pts.length - 1] = 1;
    if (preserveSlams) {
      for (let i = 0; i < pts.length; i++) {
        if (pts[i].slam) anchors[i] = 1;
      }
    }

    const pos = new Float64Array(pts.map(p => p.v));
    const vel = new Float64Array(pts.length); // zero-initialised

    for (let step = 0; step < steps; step++) {
      for (let i = 1; i < pts.length - 1; i++) {
        if (anchors[i]) continue;
        // Spring force: each neighbour pulls the point toward itself
        const springL = pos[i - 1] - pos[i];
        const springR = pos[i + 1] - pos[i];
        const force   = k * (springL + springR) - d * vel[i];
        vel[i] += force;
        pos[i] = Math.max(0, Math.min(1, pos[i] + vel[i]));
      }
    }

    for (let i = 0; i < pts.length; i++) {
      if (!anchors[i]) pts[i].v = pos[i];
    }
  }

  const applyBtn = _btn('Apply Smoothing');
  const status = _h('div', 'tool-result-box');

  applyBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    if (typeof saveUndo === 'function') saveUndo('Laser Smooth');
    const sides = sideSelect.value === 'Both' ? [0,1] : sideSelect.value === 'Left' ? [0] : [1];
    const algo = algoSelect.value;
    const iters = parseInt(iterSl.value);

    sides.forEach(s => {
      chart.lasers[s].forEach(sec2 => {
        if (algo === 'Physics Sim') {
          const k     = stiffSl.value / 100;
          const damp  = dampSl.value / 100;
          const steps = parseInt(stepsSl.value);
          _physicsSmooth(sec2.points, k, damp, steps, skipSlamChk.checked);
          return;
        }

        for (let it = 0; it < iters; it++) {
          const pts = sec2.points;
          if (pts.length < 2) return;

          if (algo === 'Chaikin') {
            const newPts = [pts[0]];
            for (let i = 0; i < pts.length - 1; i++) {
              const a = pts[i], b = pts[i+1];
              const q = { ry: a.ry * 0.75 + b.ry * 0.25, v: a.v * 0.75 + b.v * 0.25, slam: false, interp: a.interp || 'linear', curve: 0.5 };
              const r = { ry: a.ry * 0.25 + b.ry * 0.75, v: a.v * 0.25 + b.v * 0.75, slam: false, interp: a.interp || 'linear', curve: 0.5 };
              newPts.push(q, r);
            }
            newPts.push(pts[pts.length-1]);
            sec2.points = newPts;

          } else if (algo === 'Moving Average') {
            const newV = pts.map((p, i) => {
              const prev = pts[Math.max(0, i-1)].v;
              const next = pts[Math.min(pts.length-1, i+1)].v;
              return (prev + p.v + next) / 3;
            });
            pts.forEach((p, i) => p.v = Math.max(0, Math.min(1, newV[i])));

          } else { // Resample
            if (pts.length < 2) return;
            const totalRy = pts[pts.length-1].ry;
            const n = pts.length;
            const newPts = pts.map((_, i) => {
              const ry = (i / (n-1)) * totalRy;
              let v = pts[0].v;
              for (let j = 0; j < pts.length-1; j++) {
                if (ry >= pts[j].ry && ry <= pts[j+1].ry) {
                  const t = (pts[j+1].ry - pts[j].ry) > 0 ? (ry - pts[j].ry) / (pts[j+1].ry - pts[j].ry) : 0;
                  v = pts[j].v + t * (pts[j+1].v - pts[j].v);
                  break;
                }
              }
              return { ry, v: Math.max(0, Math.min(1, v)), slam: false, interp: 'linear', curve: 0.5 };
            });
            sec2.points = newPts;
          }
        }
      });
    });
    if (typeof render === 'function') render();
    const label = algo === 'Physics Sim' ? '⚛ Physics smoothing applied' : '✓ Smoothing applied';
    status.innerHTML = `<div class="tool-result-item tool-result-ok">${label}</div>`;
  });

  sec.appendChild(_row('Side:', sideSelect));
  sec.appendChild(_row('Algorithm:', algoSelect));
  sec.appendChild(iterRow);
  sec.appendChild(iterLbl);
  sec.appendChild(physDiv);
  sec.appendChild(applyBtn);
  sec.appendChild(status);
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. Density Heatmap
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolDensityHeatmap(c) {
  // ── Lane definitions ───────────────────────────────────────────────────────
  const ALL_LANES = [
    { key:'bt0', label:'BT-A', color:'#c8c8ff', group:'bt' },
    { key:'bt1', label:'BT-B', color:'#a0a0ff', group:'bt' },
    { key:'bt2', label:'BT-C', color:'#8080ff', group:'bt' },
    { key:'bt3', label:'BT-D', color:'#6060ee', group:'bt' },
    { key:'fx0', label:'FX-L', color:'#ff8c00', group:'fx' },
    { key:'fx1', label:'FX-R', color:'#ff5500', group:'fx' },
    { key:'vl0', label:'VOL-L', color:'#2277ff', group:'vol' },
    { key:'vl1', label:'VOL-R', color:'#e000b8', group:'vol' },
  ];

  // ── State ──────────────────────────────────────────────────────────────────
  let _counts     = [];  // [laneIdx][colIdx] = count
  let _colMax     = [];  // [colIdx] combined max across visible lanes
  let _laneMax    = [];  // [laneIdx] per-lane max
  let _totalMax   = 1;
  let _cols       = 0;
  let _windowM    = 1;   // measures per column
  let _mode       = 'perLane';  // 'perLane' | 'combined'
  let _metric     = 'volatility'; // 'ticks' | 'beats' | 'pct' | 'volatility'
  let _groups     = { bt: true, fx: true, vol: true };
  let _tooltip    = null;
  let _hovCol     = -1;
  let _diffCard   = null;

  const LABEL_W = 46, TOP_PAD = 20, BOT_PAD = 22;

  // ── Build container ────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;font-size:11px';

  // Controls row 1
  const ctrl1 = document.createElement('div');
  ctrl1.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';

  const mkSel = (opts, val) => {
    const s = document.createElement('select');
    s.style.cssText = 'background:#12122a;color:#ccd;border:1px solid #334;padding:2px 4px;border-radius:4px;font-size:10px';
    opts.forEach(([v,t]) => { const o = document.createElement('option'); o.value=v; o.textContent=t; if(v==val)o.selected=true; s.appendChild(o); });
    return s;
  };
  const mkLbl = (t) => { const s = document.createElement('span'); s.style.color='#778'; s.textContent=t; return s; };
  const mkBtn = (t, fn) => {
    const b = document.createElement('button');
    b.textContent = t;
    b.style.cssText = 'background:#1a1a35;color:#aac;border:1px solid #334;padding:2px 7px;border-radius:4px;cursor:pointer;font-size:10px';
    b.addEventListener('click', fn);
    return b;
  };

  const winSel  = mkSel([[1,'1 measure'],[2,'2 measures'],[4,'4 measures'],[8,'8 measures'],[16,'16 measures']], 2);
  const modeSel = mkSel([['perLane','Per Lane'],['combined','Combined']], 'perLane');
  const metSel  = mkSel([['volatility','Volatility'],['ticks','Tick Weight'],['beats','Beats Covered'],['pct','% Fill']], 'volatility');

  ctrl1.append(mkLbl('Window:'), winSel, mkLbl('View:'), modeSel, mkLbl('Metric:'), metSel);
  wrap.appendChild(ctrl1);

  // Controls row 2 — group toggles
  const ctrl2 = document.createElement('div');
  ctrl2.style.cssText = 'display:flex;gap:5px;align-items:center';
  ctrl2.appendChild(mkLbl('Lanes:'));
  const mkToggle = (group, label, color) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.group = group;
    b.style.cssText = `background:${_groups[group]?color+'33':'#111'};color:${color};border:1px solid ${color}55;padding:2px 8px;border-radius:10px;cursor:pointer;font-size:10px;transition:background 0.15s`;
    b.addEventListener('click', () => {
      _groups[group] = !_groups[group];
      b.style.background = _groups[group] ? color + '33' : '#111';
      recompute(); draw();
    });
    return b;
  };
  ctrl2.append(mkToggle('bt','BT','#8080ff'), mkToggle('fx','FX','#ff8800'), mkToggle('vol','VOL','#2277ff'));
  const exportBtn = mkBtn('⬇ Export PNG', () => {
    const a = document.createElement('a');
    a.download = 'heatmap.png'; a.href = canvas.toDataURL('image/png'); a.click();
  });
  exportBtn.style.marginLeft = 'auto';
  ctrl2.appendChild(exportBtn);
  wrap.appendChild(ctrl2);

  // Heatmap hint
  const hmDesc = _h('div', 'tool-subdesc', (typeof t === 'function') ? t('tool.subdesc.heatmap') : '');
  hmDesc.setAttribute('data-i18n-key', 'tool.subdesc.heatmap');
  wrap.appendChild(hmDesc);

  // Canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:relative;width:100%';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;display:block;border:1px solid #2a2a44;border-radius:6px;background:#07070f;cursor:crosshair';
  canvasWrap.appendChild(canvas);

  // Floating tooltip
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;background:#101028ee;border:1px solid #4040aa;border-radius:4px;padding:4px 8px;font-size:10px;color:#eef;pointer-events:none;display:none;z-index:10;white-space:pre';
  canvasWrap.appendChild(tip);
  wrap.appendChild(canvasWrap);

  // Stats bar
  const statsBar = document.createElement('div');
  statsBar.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;font-size:10px;color:#778;padding:4px 0';
  wrap.appendChild(statsBar);

  // Jump button + measure indicator
  const jumpRow = document.createElement('div');
  jumpRow.style.cssText = 'display:flex;gap:8px;align-items:center;font-size:10px';
  const jumpBtn = mkBtn('↗ Jump to measure', () => {
    if (_hovCol < 0) return;
    const ci_abs = _hovCol + (_panOffset ?? 0);
    const targetMeasure = ci_abs * _windowM;
    if (typeof renderer !== 'undefined' && renderer) {
      const tick = targetMeasure * TICKS_PER_MEASURE;
      renderer.scrollCol = Math.floor(tick / (renderer.measPerCol * TICKS_PER_MEASURE));
      renderer.playTick  = tick;
      if (typeof updateSeekbar === 'function') updateSeekbar(tick);
      if (typeof render === 'function') render();
    }
  });
  const jumpLbl = document.createElement('span');
  jumpLbl.style.color = '#aac';
  jumpLbl.textContent = 'Hover a column then jump';
  jumpRow.append(jumpBtn, jumpLbl);
  wrap.appendChild(jumpRow);

  c.appendChild(wrap);

  // ── Safe chart/renderer accessors ─────────────────────────────────────────
  // `chart` and `renderer` are `let` variables in app.js — not window properties.
  // Access them directly; they're in the shared global scope of non-module scripts.
  const _chart    = () => { try { return (typeof chart    !== 'undefined') ? chart    : null; } catch(_){return null;} };
  const _renderer = () => { try { return (typeof renderer !== 'undefined') ? renderer : null; } catch(_){return null;} };

  // ── Compute density (tick-weighted) ──────────────────────────────────────────
  // Each cell stores total ticks of activity in that [lane × column] window.
  //   BT chip  → CHIP_TICKS (a 32nd note = 1 brief hit)
  //   BT hold  → actual hold length in ticks, spread across all columns it spans
  //   FX chip  → CHIP_TICKS
  //   FX hold  → actual hold length in ticks, spread across all columns
  //   VOL seg  → Σ|Δv| per segment (laser movement, not duration). Static holds = 0.
  //
  // A note spanning multiple columns contributes proportionally to each.
  function recompute() {
    const ch = _chart();
    if (!ch) { statsBar.innerHTML = '<span style="color:#f87">No chart loaded — open or create a chart first.</span>'; return; }

    const totalTicks  = ch.totalTicks?.() ?? 0;
    const totalM      = Math.max(1, Math.ceil(totalTicks / TICKS_PER_MEASURE));
    _windowM = parseInt(winSel.value);
    _metric  = metSel.value;
    _mode    = modeSel.value;
    _cols    = Math.ceil(totalM / _windowM);

    const ticksPerCol = _windowM * TICKS_PER_MEASURE;
    // BT/FX chips count as a 32nd note equivalent so they're still visible
    const CHIP_TICKS  = TICKS_PER_MEASURE / 8; // = 24 ticks (1/8 measure ≈ 32nd note)

    _counts = ALL_LANES.map(() => new Float64Array(_cols)); // float for fractional ticks

    // ── Helper: spread [startTick, endTick) across columns proportionally ──
    const spreadTicks = (row, startTick, endTick) => {
      if (endTick <= startTick) return;
      const c0 = Math.max(0, Math.floor(startTick / ticksPerCol));
      const c1 = Math.min(_cols - 1, Math.floor((endTick - 1) / ticksPerCol));
      for (let c = c0; c <= c1; c++) {
        const winStart = c * ticksPerCol;
        const winEnd   = winStart + ticksPerCol;
        const overlap  = Math.min(endTick, winEnd) - Math.max(startTick, winStart);
        if (overlap > 0) row[c] += overlap;
      }
    };

    if (_metric === 'volatility') {
      // ── Volatility / Acceleration mode ─────────────────────────────────
      // Models *player demand* — how much focus and physical effort each
      // window requires.  Key factors, weighted by SDVX difficulty research:
      //
      //  BT chips        → high (instant precision hit)
      //  BT hold start   → moderate (sustained press, less demanding per tick)
      //  FX chips        → highest BT-type (full-hand hits, rare & punishing)
      //  FX holds        → moderate start/end events
      //  Rapid-fire bonus→ notes within 1/16-note of each other get ×1.5
      //  VOL velocity    → Δv/Δt (laser speed) — fast lasers are harder
      //  VOL reversal    → direction change × reversal-size bonus
      //  VOL slam        → instant position jump, very demanding
      //  Simultaneity    → K lanes at same tick → ×(1 + 0.4×(K−1))
      //  Cross-type mix  → BT and VOL both active → +20% per VOL active

      // eventMap: tick → Map(laneIdx → weight)
      const eventMap = new Map();
      const addEv = (laneIdx, tick, weight) => {
        if (!_groups[ALL_LANES[laneIdx]?.group]) return;
        const t = Math.round(tick);
        if (!eventMap.has(t)) eventMap.set(t, new Map());
        const m = eventMap.get(t);
        m.set(laneIdx, (m.get(laneIdx) ?? 0) + weight);
      };

      // Track recent event ticks per lane for rapid-fire detection
      const lastTick = new Array(8).fill(-9999);
      const SIXTEENTH = TICKS_PER_MEASURE / 16;  // 12 ticks = 1/16 note
      const rapidBonus = (li, tick) =>
        (tick - lastTick[li]) <= SIXTEENTH ? 1.5 : 1.0;

      // Density multiplier: notes at tighter subdivisions are worth more
      const densityMult = interval => {
        if (interval <= 3)  return 2.2;  // 1/64
        if (interval <= 6)  return 1.8;  // 1/32
        if (interval <= 12) return 1.4;  // 1/16
        if (interval <= 24) return 1.1;  // 1/8
        return 1.0;
      };

      // BT chips & holds
      const prevTick = new Array(4).fill(-9999);
      for (let i = 0; i < 4; i++) {
        const sorted = [...ch.bt[i]].sort((a,b) => a.y - b.y);
        sorted.forEach(n => {
          if (n.len === 0) {
            const rb = rapidBonus(i, n.y);
            const interval = n.y - prevTick[i];
            const dm = densityMult(interval);
            addEv(i, n.y, 2.2 * rb * dm);
            lastTick[i] = n.y;
            prevTick[i] = n.y;
          } else {
            addEv(i, n.y,         1.1);  // hold press
            addEv(i, n.y + n.len, 0.5);  // hold release
          }
        });
      }

      // FX chips & holds (heavier — full-palm hits, harder to recover from)
      const prevTickFx = new Array(2).fill(-9999);
      for (let i = 0; i < 2; i++) {
        const sorted = [...ch.fx[i]].sort((a,b) => a.y - b.y);
        sorted.forEach(n => {
          if (n.len === 0) {
            const rb = rapidBonus(4+i, n.y);
            const interval = n.y - prevTickFx[i];
            const dm = densityMult(interval);
            addEv(4+i, n.y, 3.0 * rb * dm);
            lastTick[4+i] = n.y;
            prevTickFx[i] = n.y;
          } else {
            addEv(4+i, n.y,         1.6);
            addEv(4+i, n.y + n.len, 0.8);
          }
        });
      }

      // VOL — score by speed (velocity) + reversals + slams
      for (let s = 0; s < 2; s++) {
        ch.lasers[s].forEach(sec => {
          const pts = sec.points;
          let prevDir = 0;
          for (let pi = 0; pi < pts.length - 1; pi++) {
            const p0 = pts[pi], p1 = pts[pi + 1];
            const delta    = p1.v - p0.v;
            const absDelta = Math.abs(delta);
            const dir      = Math.sign(delta);
            if (absDelta < 0.005) continue;

            const t0     = sec.y + p0.ry;
            const t1     = sec.y + p1.ry;
            const isSlam = t1 <= t0;
            const dtTicks= Math.max(1, t1 - t0);

            // Velocity = Δv per 192 ticks (1 measure).  Fast = high demand.
            const velocity = absDelta / dtTicks * TICKS_PER_MEASURE;
            let w = velocity * 1.8;   // base: laser speed

            // Reversal — wrist must change direction sharply
            if (prevDir !== 0 && dir !== prevDir) w *= 2.8;

            // Slam — instant jump, very punishing in rhythm
            if (isSlam) w = absDelta * 6.0;

            addEv(6+s, t0, w);
            if (dir !== 0) prevDir = dir;
          }
        });
      }

      // Flush → _counts with simultaneity + cross-type bonuses
      eventMap.forEach((laneMap, tick) => {
        const c = Math.min(_cols - 1, Math.floor(tick / ticksPerCol));
        if (c < 0) return;

        const activeLanes = laneMap.size;
        // Cross-type mix bonus: +20% if both BT/FX and VOL active at same tick
        const hasBtFx = [...laneMap.keys()].some(li => li < 6);
        const hasVol  = [...laneMap.keys()].some(li => li >= 6);
        const mixBonus = (hasBtFx && hasVol) ? 1.2 : 1.0;
        // Simultaneity bonus
        const simBonus = 1 + 0.4 * (activeLanes - 1);
        const totalBonus = simBonus * mixBonus;

        laneMap.forEach((weight, li) => {
          if (_counts[li]) _counts[li][c] += weight * totalBonus;
        });
      });

    } else {
      // ── Density mode (ticks / beats / pct) ──────────────────────────────

      // BT
      for (let i = 0; i < 4; i++) ch.bt[i].forEach(n => {
        if (n.len === 0) {
          const c = Math.min(_cols - 1, Math.floor(n.y / ticksPerCol));
          _counts[i][c] += CHIP_TICKS;
        } else {
          spreadTicks(_counts[i], n.y, n.y + n.len);
        }
      });

      // FX
      for (let i = 0; i < 2; i++) ch.fx[i].forEach(n => {
        if (n.len === 0) {
          const c = Math.min(_cols - 1, Math.floor(n.y / ticksPerCol));
          _counts[4 + i][c] += CHIP_TICKS;
        } else {
          spreadTicks(_counts[4 + i], n.y, n.y + n.len);
        }
      });

      // VOL — score by laser *movement* (Σ|Δv| per segment), not duration.
      for (let s = 0; s < 2; s++) ch.lasers[s].forEach(sec => {
        const pts = sec.points;
        for (let pi = 0; pi < pts.length - 1; pi++) {
          const p0 = pts[pi], p1 = pts[pi + 1];
          const t0    = sec.y + p0.ry;
          const t1    = sec.y + p1.ry;
          const delta = Math.abs(p1.v - p0.v);
          if (delta <= 0) continue;
          if (t1 <= t0) {
            const c = Math.min(_cols - 1, Math.floor(t0 / ticksPerCol));
            _counts[6 + s][c] += delta;
            continue;
          }
          const c0 = Math.max(0, Math.floor(t0 / ticksPerCol));
          const c1 = Math.min(_cols - 1, Math.floor((t1 - 1) / ticksPerCol));
          const segLen = t1 - t0;
          for (let c = c0; c <= c1; c++) {
            const winStart = c * ticksPerCol;
            const winEnd   = winStart + ticksPerCol;
            const overlap  = Math.min(t1, winEnd) - Math.max(t0, winStart);
            if (overlap > 0) _counts[6 + s][c] += delta * (overlap / segLen);
          }
        }
      });
    } // end density branch

    // ── Mask lanes whose group is toggled off ─────────────────────────────
    ALL_LANES.forEach((lane, li) => {
      if (!_groups[lane.group]) _counts[li].fill(0);
    });

    // ── Scale to the chosen metric ────────────────────────────────────────
    const scaledCounts = Array.from(_counts, (row, li) => {
      return Array.from(row, v => {
        if (_metric === 'beats')      return v / TICKS_PER_BEAT;
        if (_metric === 'pct')        return Math.min(1, v / ticksPerCol);
        if (_metric === 'volatility') return v;   // already in event-weight units
        return v;                                  // raw ticks
      });
    });

    const visIdx = ALL_LANES.map((l, i) => _groups[l.group] ? i : -1).filter(i => i >= 0);
    _laneMax = scaledCounts.map(row => Math.max(...row, 0));
    _colMax  = Array.from({ length: _cols }, (_, ci) =>
      Math.max(...visIdx.map(i => scaledCounts[i][ci]), 0)
    );
    _totalMax = Math.max(..._colMax, 0.001);
    _counts   = scaledCounts; // swap in scaled version for draw()

    // ── Stats bar ─────────────────────────────────────────────────────────
    const totalBtFx   = [ch.bt[0],ch.bt[1],ch.bt[2],ch.bt[3],ch.fx[0],ch.fx[1]].reduce((s,a)=>s+a.length,0);
    const totalLasers = ch.lasers[0].length + ch.lasers[1].length;
    const peakCol     = _colMax.indexOf(Math.max(..._colMax));
    const avgVal      = _colMax.reduce((a,b)=>a+b,0) / Math.max(1,_cols);
    const fmtAvg      = _metric === 'ticks'      ? avgVal.toFixed(0)+'t'
                      : _metric === 'beats'      ? avgVal.toFixed(1)+'b'
                      : _metric === 'volatility' ? avgVal.toFixed(1)+'v'
                      : (avgVal*100).toFixed(0)+'%';
    // Find lowest non-empty column
    const nonZeroCols = _colMax.map((v,i) => ({v,i})).filter(x => x.v > 0);
    const lowCol = nonZeroCols.length
      ? nonZeroCols.reduce((a,b) => b.v < a.v ? b : a).i
      : 0;

    statsBar.innerHTML =
      `<span><b style="color:#d0d8ff">${totalBtFx}</b> BT/FX notes</span>` +
      `<span><b style="color:#d0d8ff">${totalLasers}</b> laser segs</span>` +
      `<span>Peak: <b style="color:#ff8844">M${peakCol * _windowM + 1}</b></span>` +
      `<span>Quietest: <b style="color:#66aaff">M${lowCol * _windowM + 1}</b></span>` +
      `<span>Avg density: <b style="color:#aad">${fmtAvg}</b></span>` +
      `<span>Measures: <b style="color:#aad">${totalM}</b></span>`;

    drawSnapshots(peakCol, lowCol);
    drawDifficultyEstimate(peakCol, lowCol, totalM);
  }

  // ── Snapshot cards: actual chart render at peak / quietest column ─────────
  // Spins up a throw-away Renderer on an offscreen canvas, points it at the
  // target column, renders one column worth of chart, and displays the result
  // as an <img> thumbnail.  Clicking jumps the main editor to that measure.
  let snapshotWrap = null;

  function drawSnapshots(peakCol, lowCol) {
    if (!snapshotWrap) {
      // Section label + sub-description above the cards
      const snapHeader = _h('div', 'tool-section-title', '📸 Chart Snapshots');
      snapHeader.style.marginTop = '10px';
      wrap.appendChild(snapHeader);
      const snapDesc = _h('div', 'tool-subdesc', (typeof t === 'function') ? t('tool.subdesc.heatmap.snapshots') : '');
      snapDesc.setAttribute('data-i18n-key', 'tool.subdesc.heatmap.snapshots');
      wrap.appendChild(snapDesc);
      snapshotWrap = document.createElement('div');
      snapshotWrap.style.cssText = 'display:flex;gap:10px;margin-top:4px';
      wrap.appendChild(snapshotWrap);
    }
    snapshotWrap.innerHTML = '';
    if (_cols === 0) return;

    const ch = _chart();
    if (!ch) return;

    const makeCard = (colIdx, label, accentColor) => {
      const targetMeasure = colIdx * _windowM;  // 0-based absolute measure index

      // ── Render snapshot: always 2 measures at high zoom ──────────────────
      // Show at most 2 measures so notes are large enough to see clearly.
      // If _windowM === 1, show that 1 measure.
      const snapMeas  = Math.min(_windowM, 2);
      const SNAP_ZOOM = 1.5;  // px per tick — good readability at all window sizes
      const snapH     = Math.round(snapMeas * TICKS_PER_MEASURE * SNAP_ZOOM);

      const offCanvas = document.createElement('canvas');
      let imgSrc = null;
      try {
        const snapR      = new Renderer(offCanvas);
        snapR.chart      = ch;
        snapR.numCols    = 1;
        snapR.measPerCol = snapMeas;
        // scrollCol in the snapshot renderer's coordinate system
        // (each snapshot col = snapMeas measures):
        snapR.scrollCol  = Math.floor(targetMeasure / snapMeas);
        snapR.zoom       = SNAP_ZOOM;

        offCanvas.width  = 225;   // SINGLE_COL_W
        offCanvas.height = snapH;

        snapR.draw();
        imgSrc = offCanvas.toDataURL('image/png');
      } catch (e) {
        console.warn('snapshot render failed', e);
      }

      // ── Card shell ────────────────────────────────────────────────────────
      const card = document.createElement('div');
      card.style.cssText =
        `flex:1;min-width:0;background:#0c0c20;border:1px solid ${accentColor}55;` +
        `border-radius:7px;padding:5px 6px;cursor:pointer;overflow:hidden;` +
        `display:flex;flex-direction:column;gap:4px`;
      card.title = `Click to jump editor to ${label} (M${targetMeasure + 1})`;

      const header = document.createElement('div');
      header.style.cssText =
        `font-size:9px;font-weight:bold;color:${accentColor};letter-spacing:0.05em;` +
        `display:flex;justify-content:space-between;align-items:center`;
      header.innerHTML =
        `<span>${label}</span>` +
        `<span style="color:#556;font-weight:normal">M${targetMeasure + 1}` +
        ((_windowM > 1) ? `–${targetMeasure + _windowM}` : '') + `</span>`;
      card.appendChild(header);

      if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.style.cssText =
          'width:100%;display:block;border-radius:4px;image-rendering:pixelated;' +
          `border:1px solid ${accentColor}33;max-height:280px;object-fit:cover;object-position:top`;
        card.appendChild(img);
      } else {
        const err = document.createElement('div');
        err.style.cssText = 'font-size:9px;color:#f87;padding:4px 0';
        err.textContent = 'Preview unavailable';
        card.appendChild(err);
      }

      card.addEventListener('click', () => {
        const r = _renderer();
        if (!r) return;
        const tick = targetMeasure * TICKS_PER_MEASURE;
        // Convert absolute measure → renderer column (renderer.measPerCol may differ from _windowM)
        const rCol = Math.floor(targetMeasure / r.measPerCol);
        r.scrollCol = Math.max(0, Math.min(r.totalCols() - 1, rCol));
        r.playTick  = tick;
        if (typeof updateSeekbar === 'function') updateSeekbar(tick);
        if (typeof render === 'function') render();
        // Also scroll canvas-wrap vertically to show the tick
        requestAnimationFrame(() => {
          const cw = document.getElementById('canvas-wrap');
          const pos = r.tickToCanvas(tick);
          if (cw && pos) cw.scrollTop = Math.max(0, pos.cy - cw.clientHeight * 0.5);
        });
      });

      return card;
    };

    snapshotWrap.appendChild(makeCard(peakCol, 'Peak',    '#ff8844'));
    snapshotWrap.appendChild(makeCard(lowCol,  'Quietest','#4499ff'));
  }

  // ── Difficulty estimate card ───────────────────────────────────────────────
  function drawDifficultyEstimate(peakCol, lowCol, totalM) {
    // Create or reuse the difficulty card
    if (!_diffCard) {
      _diffCard = document.createElement('div');
      _diffCard.style.cssText =
        'background:#0c0c20;border:1px solid #2a2a55;border-radius:7px;' +
        'padding:10px 14px;margin-top:4px;font-size:11px;color:#c8d0ff';
      wrap.appendChild(_diffCard);
    }
    _diffCard.innerHTML = '';

    if (_metric !== 'volatility') {
      _diffCard.innerHTML =
        '<span style="color:#778;font-size:10px;font-style:italic">' +
        'Switch to Volatility mode for difficulty estimate</span>';
      return;
    }

    const ch = _chart();
    if (!ch || _cols === 0) return;

    const peakVol = _colMax[peakCol] ?? 0;
    const avgVal  = _colMax.reduce((a,b) => a+b, 0) / Math.max(1, _cols);

    // Calibrated from 50 real SDVX Exceed Gear charts (lv10–19):
    //   lv14 ADV  → ~3 BT/m, ~0.5 FX/m, ~2 VOL/m  → vol/measure ≈ 10–15
    //   lv16 EXH  → ~5 BT/m, ~1 FX/m,  ~3 VOL/m  → vol/measure ≈ 18–28
    //   lv18 MXM  → ~7 BT/m, ~2 FX/m,  ~5 VOL/m  → vol/measure ≈ 30–55
    //   lv19 MXM  → ~9 BT/m, ~2.5 FX/m,~7 VOL/m  → vol/measure ≈ 45–80
    // Scale constants are per WINDOW (multiply per-measure estimate by _windowM)
    const PEAK_SCALE = Math.max(1, _windowM) * 50;  // peak col vol → lv18 threshold
    const AVG_SCALE  = Math.max(1, _windowM) * 20;  // avg col vol  → lv18 threshold
    const peakNorm = Math.min(1.2, peakVol / PEAK_SCALE);  // allow slight overflow for lv19+
    const avgNorm  = Math.min(1.2, avgVal   / AVG_SCALE);

    // Composite score: peak matters 55%, avg 30%, balance bonus 15%
    // balance = how evenly difficult the chart is (rewards consistent density)
    const nonZero = _colMax.filter(v => v > 0);
    const balance = nonZero.length > 1
      ? 1 - (Math.max(...nonZero) - Math.min(...nonZero)) / Math.max(1, Math.max(...nonZero))
      : 0;
    let raw = Math.min(1, peakNorm * 0.55 + avgNorm * 0.30 + balance * 0.15);

    // Map [0..1] → [1..20] with a mild S-curve so mid-range spreads out
    let diff = 1 + 19 * (raw < 0.5
      ? 2 * raw * raw
      : 1 - Math.pow(-2 * raw + 2, 2) / 2);

    // Fine-tune with note density per measure (derived from real chart data)
    const totalNotes = ch.bt.reduce((s,a) => s + a.length, 0) + ch.fx.reduce((s,a) => s + a.length, 0);
    const totalMeasures = Math.max(1, ch.totalTicks?.() ?? 0) / TICKS_PER_MEASURE;
    const noteDensity = totalNotes / totalMeasures;
    // Real data: lv18 ≈ 6-11 BT+FX notes/measure, lv14 ≈ 3-5
    if (noteDensity > 9)  diff = Math.min(20, diff + 0.8);
    else if (noteDensity > 7)  diff = Math.min(20, diff + 0.4);
    else if (noteDensity > 5)  diff = Math.min(20, diff + 0.2);

    // VOL-heavy charts get a bonus (real lv18+ often have >5 VOL events/measure)
    const totalLaserSegs = ch.lasers[0].length + ch.lasers[1].length;
    const volDensity = totalLaserSegs / totalMeasures;
    if (volDensity > 4) diff = Math.min(20, diff + 0.5);
    else if (volDensity > 2) diff = Math.min(20, diff + 0.2);

    diff = Math.max(1, Math.min(20, diff));
    const diffStr = diff >= 17.5 ? diff.toFixed(1) : String(Math.round(diff));

    // Color based on level
    let levelColor;
    if (diff <= 10)      levelColor = '#4488ff';
    else if (diff <= 15) levelColor = '#ffdd44';
    else if (diff <= 17) levelColor = '#ff8833';
    else                 levelColor = '#ff3333';

    // Header row
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:7px';
    const headerLabel = document.createElement('span');
    headerLabel.style.cssText = 'font-size:10px;font-weight:bold;color:#556;letter-spacing:0.06em;text-transform:uppercase';
    headerLabel.textContent = 'Estimated Difficulty';
    const levelBadge = document.createElement('span');
    levelBadge.style.cssText = `font-size:16px;font-weight:bold;color:${levelColor};letter-spacing:0.02em`;
    levelBadge.textContent = 'Level ' + diffStr;
    header.append(headerLabel, levelBadge);
    _diffCard.appendChild(header);

    // Bar
    const barTrack = document.createElement('div');
    barTrack.style.cssText =
      'background:#161630;border-radius:4px;height:8px;overflow:hidden;position:relative';
    const barFill = document.createElement('div');
    const fillPct = ((diff - 1) / 19 * 100).toFixed(1);
    barFill.style.cssText =
      `width:${fillPct}%;height:100%;border-radius:4px;` +
      `background:linear-gradient(90deg,#2255ff,${levelColor});transition:width 0.3s`;
    barTrack.appendChild(barFill);
    _diffCard.appendChild(barTrack);

    // Sub-info row
    const info = document.createElement('div');
    info.style.cssText = 'margin-top:6px;color:#556;font-size:9px;display:flex;gap:12px';
    info.innerHTML =
      `<span>Peak vol: <b style="color:#aab">${peakVol.toFixed(1)}</b></span>` +
      `<span>Avg vol: <b style="color:#aab">${avgVal.toFixed(1)}</b></span>` +
      `<span>Notes/m: <b style="color:#aab">${noteDensity.toFixed(1)}</b></span>`;
    _diffCard.appendChild(info);
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  function draw() {
    if (!_chart() || _cols === 0) return;

    const visLanes = ALL_LANES.filter(l => _groups[l.group]);
    if (visLanes.length === 0) return;

    const dpr  = window.devicePixelRatio || 1;
    const cw   = canvasWrap.clientWidth  || 400;
    const mode = modeSel.value;
    const rowCount = mode === 'combined' ? 1 : visLanes.length;
    const ch   = TOP_PAD + rowCount * 22 + BOT_PAD;

    // Resize canvas if needed
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width  = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.height = ch + 'px';
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const plotW  = cw - LABEL_W;
    const colW   = plotW / _cols;
    const rowH   = (ch - TOP_PAD - BOT_PAD) / rowCount;

    // Background
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, cw, ch);

    // ── Column axis labels (measure numbers, offset by pan) ──────────────
    const labelStep = Math.max(1, Math.ceil(_cols / Math.floor(plotW / 28)));
    ctx.fillStyle = '#556'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    for (let ci = 0; ci < _cols; ci += labelStep) {
      const x = LABEL_W + (ci + 0.5) * colW;
      ctx.fillText('M' + ((ci + _panOffset) * _windowM + 1), x, TOP_PAD - 4);
    }
    // Pan / zoom indicator (top-right, shown when panned away from start)
    if (_panOffset > 0) {
      const totalCols = _cols + _panOffset;
      ctx.fillStyle = '#4466aacc'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText(`pan M${_panOffset*_windowM+1}–M${(_panOffset+_cols)*_windowM}  |  Shift+scroll=zoom  scroll=pan`, cw - 4, TOP_PAD - 4);
      // Minimap bar
      ctx.fillStyle = '#1a1a3a';
      ctx.fillRect(LABEL_W, TOP_PAD - 2, plotW, 2);
      ctx.fillStyle = '#4488ff88';
      const mmX = LABEL_W + (_panOffset / totalCols) * plotW;
      const mmW = (_cols / totalCols) * plotW;
      ctx.fillRect(mmX, TOP_PAD - 2, mmW, 2);
    } else if (_windowM < 16) {
      ctx.fillStyle = '#33335a'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
      ctx.fillText('Shift+scroll to zoom  ·  scroll to pan', cw - 4, TOP_PAD - 4);
    }

    // ── Playhead marker ───────────────────────────────────────────────────
    if (typeof renderer !== 'undefined' && renderer) {
      const playMeas   = renderer.playTick / TICKS_PER_MEASURE;
      const playColAbs = playMeas / _windowM;           // absolute column
      const playColVis = playColAbs - _panOffset;        // view column
      if (playColVis >= 0 && playColVis < _cols) {
        const px = LABEL_W + playColVis * colW;
        ctx.strokeStyle = '#ffee5588'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, TOP_PAD); ctx.lineTo(px, ch - BOT_PAD); ctx.stroke();
      }
    }

    if (mode === 'combined') {
      // ── Combined: one row, stack all visible lanes ────────────────────
      for (let ci = 0; ci < _cols; ci++) {
        const x = LABEL_W + ci * colW;
        const combinedMax = _colMax[ci];
        if (combinedMax === 0) continue;
        // Stack each visible lane's contribution proportionally
        let yOff = ch - BOT_PAD;
        visLanes.forEach(lane => {
          const li  = ALL_LANES.indexOf(lane);
          const v   = _counts[li][ci];
          const frac = v / _totalMax;
          const h   = Math.max(0, frac * (ch - TOP_PAD - BOT_PAD));
          yOff -= h;
          ctx.fillStyle = hexToRgba(lane.color, Math.min(1, frac * 2 + 0.15));
          ctx.fillRect(x + 0.5, yOff, colW - 1, h);
        });
      }
      // Y-axis label
      ctx.fillStyle = '#aab'; ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'right'; ctx.fillText('ALL', LABEL_W - 3, TOP_PAD + rowH / 2 + 3);

    } else {
      // ── Per-lane: one row per visible lane ────────────────────────────
      visLanes.forEach((lane, ri) => {
        const li   = ALL_LANES.indexOf(lane);
        const yTop = TOP_PAD + ri * rowH;
        const lMax = Math.max(_laneMax[li], 0.001);

        // Row background (subtle stripe)
        ctx.fillStyle = ri % 2 === 0 ? '#0a0a18' : '#080812';
        ctx.fillRect(LABEL_W, yTop, plotW, rowH);

        for (let ci = 0; ci < _cols; ci++) {
          const v     = _counts[li][ci];
          if (v === 0) continue;
          const norm  = v / lMax;
          const x     = LABEL_W + ci * colW;
          // Highlight hovered column
          const isHov = ci === _hovCol;
          ctx.fillStyle = hexToRgba(lane.color, norm * 0.88 + 0.08 + (isHov ? 0.2 : 0));
          ctx.fillRect(x + 0.5, yTop + 1, colW - 1, rowH - 2);

          // Count label inside tall-enough cells
          if (colW > 18 && rowH > 13) {
            const raw = _metric === 'ticks'      ? Math.round(_counts[li][ci]) + 't' :
                        _metric === 'beats'      ? _counts[li][ci].toFixed(1) + 'b' :
                        _metric === 'volatility' ? _counts[li][ci].toFixed(1) + 'v' :
                        Math.round(_counts[li][ci] * 100) + '%';
            ctx.fillStyle = norm > 0.5 ? '#000a' : '#fff6';
            ctx.font = '8px monospace'; ctx.textAlign = 'center';
            ctx.fillText(raw, x + colW / 2, yTop + rowH / 2 + 3);
          }
        }

        // Lane label
        ctx.fillStyle = lane.color; ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(lane.label, LABEL_W - 3, yTop + rowH / 2 + 3);

        // Row separator
        ctx.strokeStyle = '#14143a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(LABEL_W, yTop + rowH); ctx.lineTo(cw, yTop + rowH); ctx.stroke();
      });
    }

    // ── Bottom axis: colour-scale legend ──────────────────────────────────
    const lgX = LABEL_W, lgY = ch - BOT_PAD + 6, lgW = plotW, lgH = 8;
    const lg  = ctx.createLinearGradient(lgX, 0, lgX + lgW, 0);
    lg.addColorStop(0,   '#07070f');
    lg.addColorStop(0.3, '#2a2a6a');
    lg.addColorStop(0.7, '#7744cc');
    lg.addColorStop(1,   '#ff88ff');
    ctx.fillStyle = lg; ctx.fillRect(lgX, lgY, lgW, lgH);
    ctx.strokeStyle = '#33335a'; ctx.lineWidth = 1;
    ctx.strokeRect(lgX, lgY, lgW, lgH);
    ctx.fillStyle = '#556'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText('low', lgX + 12, lgY + lgH + 10);
    ctx.fillText('high', lgX + lgW - 12, lgY + lgH + 10);
    ctx.fillText(
      _metric === 'ticks'      ? 'density  (BT/FX: ticks · VOL: Σ|Δpos|)' :
      _metric === 'beats'      ? 'beats covered' :
      _metric === 'volatility' ? 'volatility  (change events + simultaneity bonus)' :
      '% fill',
      lgX + lgW / 2, lgY + lgH + 10);
  }

  // ── Tooltip / hover ────────────────────────────────────────────────────────
  canvas.addEventListener('mousemove', e => {
    if (_cols === 0) return;
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const plotW  = rect.width - LABEL_W;
    // Visible columns = total minus pan offset
    const visCols = Math.max(1, _cols - _panOffset);
    const colW   = plotW / visCols;
    const ci_vis = Math.floor((mx - LABEL_W) / colW);
    if (ci_vis < 0 || ci_vis >= visCols) { tip.style.display='none'; _hovCol=-1; return; }

    // ci_abs = actual index into _counts (accounts for pan)
    const ci_abs = ci_vis + _panOffset;
    _hovCol = ci_vis;

    const startM = ci_abs * _windowM + 1;
    const endM   = Math.min(ci_abs * _windowM + _windowM, 99999);
    jumpLbl.textContent = `Measure ${startM}${_windowM > 1 ? '–' + endM : ''}`;

    const visLanes = ALL_LANES.filter(l => _groups[l.group]);
    let lines = [`M${startM}`];
    visLanes.forEach(lane => {
      const li  = ALL_LANES.indexOf(lane);
      const v   = _counts[li]?.[ci_abs] ?? 0;
      if (v === 0) return;
      const fmt = _metric === 'ticks'      ? Math.round(v) + 't' :
                  _metric === 'beats'      ? v.toFixed(2) + 'b' :
                  _metric === 'volatility' ? v.toFixed(1) + 'v' :
                  Math.round(v * 100) + '%';
      lines.push(`${lane.label}: ${fmt}`);
    });
    tip.textContent = lines.join('\n');
    tip.style.display = 'block';
    tip.style.left = Math.min(e.clientX - rect.left + 10, rect.width - 120) + 'px';
    tip.style.top  = Math.max(0, e.clientY - rect.top - 40) + 'px';
    draw(); // redraw for hover highlight
  });
  canvas.addEventListener('mouseleave', () => {
    tip.style.display = 'none'; _hovCol = -1; draw();
  });
  canvas.addEventListener('click', e => {
    if (_hovCol < 0) return;
    const ci_abs = _hovCol + _panOffset;
    const targetMeasure = ci_abs * _windowM;
    if (typeof renderer !== 'undefined' && renderer) {
      const tick = targetMeasure * TICKS_PER_MEASURE;
      renderer.scrollCol = Math.floor(tick / (renderer.measPerCol * TICKS_PER_MEASURE));
      renderer.playTick  = tick;
      if (typeof updateSeekbar === 'function') updateSeekbar(tick);
      if (typeof render === 'function') render();
    }
  });

  // ── Shift+scroll: zoom heatmap ─────────────────────────────────────────────
  // Shift+ScrollUp  → zoom in  (fewer measures per column = more detail)
  // Shift+ScrollDown→ zoom out (more measures per column = overview)
  // Plain scroll    → pan left/right when zoomed in enough to have extra space
  //
  // Zoom steps match the existing window-size options: 1, 2, 4, 8, 16 measures.
  const ZOOM_STEPS = [1, 2, 4, 8, 16];
  let _panOffset = 0;   // column pan offset (number of _windowM-columns scrolled)

  // Wrap draw() to honour pan offset: shift _counts view by _panOffset columns
  const _origDraw = draw;
  draw = function() {
    // Temporarily slice _counts to the panned window if panOffset > 0
    if (_panOffset > 0 && _cols > 0) {
      const maxPan = Math.max(0, _cols - 1);
      _panOffset   = Math.min(_panOffset, maxPan);
      // Shift counts so column 0 in the view = column _panOffset in _counts
      const saved  = _counts;
      const savedMax = _colMax.slice();
      _counts = _counts.map(row => row.slice(_panOffset));
      _colMax = _colMax.slice(_panOffset);
      _cols  -= _panOffset;
      _origDraw();
      _counts  = saved;
      _colMax  = savedMax;
      _cols   += _panOffset;
    } else {
      _origDraw();
    }
  };

  canvas.addEventListener('wheel', e => {
    e.preventDefault();

    if (e.shiftKey) {
      // ── Zoom (anchor to cursor) ────────────────────────────────────────
      const rect    = canvas.getBoundingClientRect();
      const mx      = e.clientX - rect.left;
      const plotW   = rect.width - LABEL_W;
      // Use the actual drawn column width (visCols, not full _cols)
      const visCols   = Math.max(1, _cols - _panOffset);
      const colWVis   = plotW / visCols;
      // Visual column index under cursor (clamped)
      const cursorColVis = Math.max(0, Math.min(visCols - 1,
        Math.floor((mx - LABEL_W) / colWVis)));
      // Absolute measure under cursor
      const cursorMeasure = (cursorColVis + _panOffset) * _windowM;

      const curIdx = ZOOM_STEPS.indexOf(_windowM);
      const newIdx = e.deltaY < 0
        ? Math.max(0, curIdx - 1)                        // up = zoom in (smaller window)
        : Math.min(ZOOM_STEPS.length - 1, curIdx + 1);  // down = zoom out

      if (newIdx !== curIdx) {
        const newWindow = ZOOM_STEPS[newIdx];
        winSel.value = newWindow;
        recompute();   // updates _cols and _windowM to new values
        // Re-anchor: place the same measure at the same cursor column
        const newAbsCol = cursorMeasure / newWindow;
        _panOffset = Math.max(0, Math.min(_cols - 1,
          Math.round(newAbsCol - cursorColVis)));
        draw();
      }

    } else {
      // ── Pan (left/right) ──────────────────────────────────────────────
      // deltaY > 0 = scroll down = pan forward (right, increase offset)
      const dir = e.deltaY > 0 ? 1 : -1;
      _panOffset = Math.max(0, Math.min(Math.max(0, _cols - 1), _panOffset + dir));
      draw();
    }
  }, { passive: false });

  // ── Wire controls ──────────────────────────────────────────────────────────
  [winSel, modeSel, metSel].forEach(el => el.addEventListener('change', () => {
    _panOffset = 0;   // reset pan when controls change
    recompute(); draw();
  }));

  // Redraw when canvas becomes visible / resizes.
  // Wrapped in rAF so DOM mutations from recompute/drawSnapshots don't
  // synchronously re-fire the observer (causes "undelivered notifications" warn).
  let _roPending = false;
  const ro = new ResizeObserver(() => {
    if (_roPending) return;
    _roPending = true;
    requestAnimationFrame(() => { _roPending = false; recompute(); draw(); });
  });
  ro.observe(canvasWrap);

  // Initial render — retry until the canvas has a real layout width
  // (the tool panel may not be visible yet on first render, so clientWidth=0)
  let _initAttempts = 0;
  function _tryInit() {
    recompute();
    if (canvasWrap.clientWidth > 10) { draw(); }
    else if (_initAttempts++ < 20)   { setTimeout(_tryInit, 80); }
  }
  setTimeout(_tryInit, 50);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. Multi-Chart Sync Checker
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolMultiSync(c) {
  const sec = _section('Multi-Chart Sync Checker');
  c.appendChild(sec);

  if (!window.tabs || tabs.length < 2) {
    sec.appendChild(_h('div', 'tool-result-item tool-result-warn', 'Need at least 2 open tabs to compare.'));
    return;
  }

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Chart</th><th>BPM Evts</th><th>BT-A</th><th>BT-B</th><th>BT-C</th><th>BT-D</th><th>FX-L</th><th>FX-R</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  tabs.forEach((tab, i) => {
    const ch = tab.chart;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #2a2a44';
    if (i === window.activeTabIdx) tr.style.color = '#00cfff';
    const cells = [
      tab.name || ('Tab '+(i+1)),
      ch.bpmEvents.length,
      ch.bt[0].length, ch.bt[1].length, ch.bt[2].length, ch.bt[3].length,
      ch.fx[0].length, ch.fx[1].length
    ];
    cells.forEach(v => { const td = document.createElement('td'); td.textContent = v; td.style.padding = '3px 5px'; tr.appendChild(td); });
    tbody.appendChild(tr);
  });

  sec.appendChild(table);
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. VOL Rotation Calculator
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolVolAngle(c) {
  // Safe accessor — `chart` is a top-level `let` in app.js (not on window)
  const _ch = () => { try { return (typeof chart !== 'undefined') ? chart : null; } catch(_e){return null;} };

  const sec = _section('VOL Rotation Analyzer');
  c.appendChild(sec);

  if (!_ch()) {
    sec.appendChild(_h('div', 'tool-result-item tool-result-err', 'No chart loaded'));
    return;
  }

  // ── Content container ──────────────────────────────────────────────────────
  const content = document.createElement('div');
  content.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  sec.appendChild(content);

  // ── Analysis function ──────────────────────────────────────────────────────
  function analyze() {
    const ch = _ch();
    if (!ch) return null;
    const totalTicks = (ch.totalTicks?.() ?? 0);
    const totalM = Math.max(1, totalTicks / TICKS_PER_MEASURE);

    const sections = [];
    for (let s = 0; s < 2; s++) {
      ch.lasers[s].forEach((laserSec, si) => {
        const pts = laserSec.points;
        if (pts.length < 2) return;
        let travel = 0, slams = 0, peakVel = 0, netDrift = 0;
        let oscCount = 0, prevDir = 0;
        let contRun = 0, maxContRun = 0;
        for (let pi = 0; pi < pts.length - 1; pi++) {
          const p0 = pts[pi], p1 = pts[pi+1];
          const dv = p1.v - p0.v;
          const absDv = Math.abs(dv);
          const dt = Math.max(0, (p1.ry - p0.ry));
          travel += absDv;
          netDrift += dv;
          const dir = Math.sign(dv);
          if (dt === 0) {
            slams++;
          } else {
            const vel = absDv / dt * TICKS_PER_MEASURE;
            peakVel = Math.max(peakVel, vel);
            if (prevDir !== 0 && dir !== 0 && dir !== prevDir) {
              oscCount++;
              contRun = 0;
            } else if (dir !== 0) {
              contRun++;
              maxContRun = Math.max(maxContRun, contRun);
            }
          }
          if (dir !== 0) prevDir = dir;
        }
        const startM = Math.floor((laserSec.y) / TICKS_PER_MEASURE) + 1;
        const durTicks = pts[pts.length-1].ry;
        const durM = durTicks / TICKS_PER_MEASURE;
        const avgVel = durTicks > 0 ? (travel / durTicks * TICKS_PER_MEASURE) : 0;
        sections.push({ side: ['L','R'][s], s, si, startM, durM, travel, slams, peakVel, avgVel, netDrift, oscCount, maxContRun,
          startTick: laserSec.y });
      });
    }
    return { sections, totalM };
  }

  // ── Build UI ───────────────────────────────────────────────────────────────
  function buildUI() {
    content.innerHTML = '';

    const data = analyze();
    if (!data) return;
    const { sections, totalM } = data;

    const bpm = (_ch()?.bpmEvents?.[0]?.bpm) ?? 180;
    const totalMinutes = Math.max(0.001, (totalM * TICKS_PER_MEASURE) / TICKS_PER_BEAT / bpm);

    // Aggregate stats
    let totalTravel = 0, totalSlams = 0, peakSingleTravel = 0;
    let totalAvgVel = 0, leftTravel = 0, rightTravel = 0;
    let highestVelTick = 0, highestVelVal = 0;
    let totalOsc = 0, totalContRun = 0, maxContRun = 0;
    sections.forEach(sec => {
      totalTravel     += sec.travel;
      totalSlams      += sec.slams;
      peakSingleTravel = Math.max(peakSingleTravel, sec.travel);
      totalAvgVel     += sec.avgVel * sec.durM;
      if (sec.s === 0) leftTravel  += sec.travel;
      else             rightTravel += sec.travel;
      if (sec.peakVel > highestVelVal) { highestVelVal = sec.peakVel; highestVelTick = sec.startTick; }
      totalOsc    += sec.oscCount;
      maxContRun   = Math.max(maxContRun, sec.maxContRun);
    });
    const globalAvgVel = totalM > 0 ? totalAvgVel / totalM : 0;
    const lrTotal = leftTravel + rightTravel || 1;
    const leftPct  = (leftTravel  / lrTotal * 100).toFixed(0);
    const rightPct = (rightTravel / lrTotal * 100).toFixed(0);
    const oscPerMin = totalOsc / totalMinutes;

    // ── A. Summary Statistics ──────────────────────────────────────────────
    const summaryBox = document.createElement('div');
    summaryBox.style.cssText =
      'background:#0c0c20;border:1px solid #2a2a55;border-radius:6px;padding:9px 12px;' +
      'display:grid;grid-template-columns:1fr 1fr;gap:5px 16px;font-size:10px';

    const stat = (label, val) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center';
      row.innerHTML = `<span style="color:#778">${label}</span><b style="color:#c8d0ff">${val}</b>`;
      return row;
    };
    summaryBox.appendChild(stat('Total laser travel', totalTravel.toFixed(3)));
    summaryBox.appendChild(stat('Peak segment travel', peakSingleTravel.toFixed(3)));
    summaryBox.appendChild(stat('Total slams', totalSlams));
    summaryBox.appendChild(stat('Avg velocity (per meas)', globalAvgVel.toFixed(2)));
    summaryBox.appendChild(stat('Left activity', leftPct + '%'));
    summaryBox.appendChild(stat('Right activity', rightPct + '%'));
    content.appendChild(summaryBox);

    // ── B. Section Table ───────────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'max-height:160px;overflow-y:auto;border:1px solid #1a1a3a;border-radius:5px';

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px';
    table.innerHTML = `<thead><tr style="background:#111128;position:sticky;top:0">
      <th style="padding:4px 5px;text-align:left;color:#556;font-weight:normal">Side</th>
      <th style="padding:4px 5px;text-align:right;color:#556;font-weight:normal">Start M</th>
      <th style="padding:4px 5px;text-align:right;color:#556;font-weight:normal">Dur M</th>
      <th style="padding:4px 5px;text-align:right;color:#556;font-weight:normal">Travel</th>
      <th style="padding:4px 5px;text-align:right;color:#556;font-weight:normal">Slams</th>
      <th style="padding:4px 5px;text-align:right;color:#556;font-weight:normal">PeakVel</th>
      <th style="padding:4px 5px;text-align:right;color:#556;font-weight:normal">Drift</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');
    sections.sort((a, b) => a.startTick - b.startTick).forEach((s, idx) => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid #111128;' + (idx % 2 ? 'background:#0a0a1a' : '');
      const driftPct = ((s.netDrift + 1) / 2 * 100).toFixed(0);
      const sideColor = s.s === 0 ? '#2277ff' : '#e000b8';
      [
        `<span style="color:${sideColor};font-weight:bold">${s.side}</span>`,
        s.startM,
        s.durM.toFixed(2),
        s.travel.toFixed(3),
        s.slams,
        s.peakVel.toFixed(2),
        driftPct + '%'
      ].forEach((v, ci) => {
        const td = document.createElement('td');
        td.innerHTML = v;
        td.style.cssText = 'padding:3px 5px;color:#c8d0ff;text-align:' + (ci === 0 ? 'left' : 'right');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    content.appendChild(tableWrap);

    // ── C. Rotation Pattern Analysis ──────────────────────────────────────
    const patBox = document.createElement('div');
    patBox.style.cssText =
      'background:#0c0c20;border:1px solid #2a2a55;border-radius:6px;padding:9px 12px;font-size:10px';

    let dominantRot = 'Mixed';
    const netL = sections.filter(s => s.s === 0).reduce((a, s) => a + s.netDrift, 0);
    const netR = sections.filter(s => s.s === 1).reduce((a, s) => a + s.netDrift, 0);
    const netAll = netL + netR;
    if (netAll > 0.3)       dominantRot = 'Clockwise';
    else if (netAll < -0.3) dominantRot = 'Counter-clockwise';

    const totalSegments = sections.length;
    const reversingSegs = sections.filter(s => s.oscCount > 0).length;
    const oscPct = totalSegments > 0 ? (reversingSegs / totalSegments * 100).toFixed(0) : 0;
    const maxContRunM = (maxContRun * (TICKS_PER_MEASURE / 16) / TICKS_PER_MEASURE).toFixed(2);

    patBox.innerHTML =
      `<div style="font-weight:bold;color:#aabbff;margin-bottom:6px;font-size:11px">Rotation Patterns</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px">` +
        `<span style="color:#778">Dominant rotation:</span><b style="color:#c8d0ff">${dominantRot}</b>` +
        `<span style="color:#778">Direction reversals:</span><b style="color:#c8d0ff">${totalOsc}</b>` +
        `<span style="color:#778">Reversing sections:</span><b style="color:#c8d0ff">${reversingSegs} / ${totalSegments} (${oscPct}%)</b>` +
        `<span style="color:#778">Max continuous run:</span><b style="color:#c8d0ff">${maxContRunM} measures</b>` +
        `<span style="color:#778">Reversals/min:</span><b style="color:#c8d0ff">${oscPerMin.toFixed(1)}</b>` +
      `</div>`;
    content.appendChild(patBox);

    // ── D. Difficulty Tags ─────────────────────────────────────────────────
    const tags = [];
    if (globalAvgVel > 3.0)   tags.push({ text: 'High Speed',         color: '#ffcc00', bg: '#2a2000' });
    if (oscPerMin > 10)        tags.push({ text: '↺ Heavy Rotation',   color: '#ff8833', bg: '#2a1500' });
    if (totalSlams > 5)        tags.push({ text: 'Precision Slams',    color: '#ff4499', bg: '#2a001a' });
    if (peakSingleTravel > 0.8)tags.push({ text: '↔ Full Range',       color: '#44aaff', bg: '#001a2a' });
    if (+oscPct > 50)          tags.push({ text: 'Oscillating',         color: '#aa44ff', bg: '#150022' });
    if (globalAvgVel < 0.5)    tags.push({ text: 'Calm Lasers',        color: '#44ff88', bg: '#002211' });

    if (tags.length > 0) {
      const tagsWrap = document.createElement('div');
      tagsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
      tags.forEach(tag => {
        const pill = document.createElement('span');
        pill.style.cssText =
          `background:${tag.bg};color:${tag.color};border:1px solid ${tag.color}44;` +
          `border-radius:12px;padding:3px 9px;font-size:10px;font-weight:bold`;
        pill.textContent = tag.text;
        tagsWrap.appendChild(pill);
      });
      content.appendChild(tagsWrap);
    }

    // ── E. Interactive Controls ────────────────────────────────────────────
    const ctrlRow = document.createElement('div');
    ctrlRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';

    const refreshBtn = _btn('↻ Refresh');
    refreshBtn.addEventListener('click', buildUI);

    const highlightBtn = _btn('▶ Jump to fastest section');
    highlightBtn.addEventListener('click', () => {
      if (typeof renderer !== 'undefined' && renderer && highestVelTick >= 0) {
        const col = Math.floor(highestVelTick / (renderer.measPerCol * TICKS_PER_MEASURE));
        renderer.scrollCol = Math.max(0, Math.min(renderer.totalCols() - 1, col));
        renderer.playTick  = highestVelTick;
        if (typeof updateSeekbar === 'function') updateSeekbar(highestVelTick);
        if (typeof render === 'function') render();
      }
    });

    ctrlRow.append(refreshBtn, highlightBtn);
    content.appendChild(ctrlRow);

    if (sections.length === 0) {
      content.innerHTML = '';
      content.appendChild(_h('div', 'tool-result-item', 'No laser sections found.'));
    }
  }

  buildUI();
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. FX Segment Generator
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolFxGen(c) {
  const sec = _section('FX Segment Generator');
  c.appendChild(sec);

  const preview = _h('div', 'tool-result-box');
  const status  = _h('div', 'tool-result-box');
  let suggestions = [];

  function computeSuggestions() {
    suggestions = [];
    if (!(typeof chart !== "undefined" && chart)) return;
    // BT-A+B overlap → FX-L
    const abOverlap = _findBtOverlaps(0, 1);
    abOverlap.forEach(([y, len]) => {
      if (!chart.fx[0].some(n => n.y === y)) suggestions.push({ side: 0, y, len });
    });
    // BT-C+D overlap → FX-R
    const cdOverlap = _findBtOverlaps(2, 3);
    cdOverlap.forEach(([y, len]) => {
      if (!chart.fx[1].some(n => n.y === y)) suggestions.push({ side: 1, y, len });
    });
  }

  function _findBtOverlaps(ia, ib) {
    const arrA = (typeof chart !== "undefined" && chart) ? chart.bt[ia] : [], arrB = (typeof chart !== "undefined" && chart) ? chart.bt[ib] : [];
    const result = [];
    arrA.forEach(a => {
      if (a.len <= 0) return;
      arrB.forEach(b => {
        if (b.len <= 0) return;
        const start = Math.max(a.y, b.y);
        const end = Math.min(a.y + a.len, b.y + b.len);
        if (end > start) result.push([start, end - start]);
      });
    });
    return result;
  }

  const previewBtn = _btn('Preview Suggestions', 'tool-btn-action');
  previewBtn.addEventListener('click', () => {
    computeSuggestions();
    preview.innerHTML = '';
    if (suggestions.length === 0) {
      preview.innerHTML = '<div class="tool-result-item">No suggestions (no overlapping BT holds found)</div>';
      return;
    }
    suggestions.forEach(s => {
      const m = Math.floor(s.y / TICKS_PER_MEASURE);
      preview.appendChild(_h('div', 'tool-result-item', `FX-${['L','R'][s.side]} @ tick ${s.y} (m${m+1}), len=${s.len}`));
    });
  });

  const applyBtn = _btn('Apply Suggestions');
  applyBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    if (typeof saveUndo === 'function') saveUndo('FX Gen Apply');
    computeSuggestions();
    suggestions.forEach(s => {
      chart.fx[s.side].push({ y: s.y, len: s.len });
      chart.fx[s.side].sort((a, b) => a.y - b.y);
    });
    if (typeof render === 'function') render();
    status.innerHTML = `<div class="tool-result-item tool-result-ok">✓ Added ${suggestions.length} FX note(s)</div>`;
  });

  const clearBtn = _btn('Clear All FX');
  clearBtn.style.background = '#2a0a0a';
  clearBtn.style.borderColor = '#882233';
  clearBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    if (!confirm('Clear all FX notes?')) return;
    if (typeof saveUndo === 'function') saveUndo('Clear FX');
    chart.fx[0] = []; chart.fx[1] = [];
    if (typeof render === 'function') render();
    status.innerHTML = '<div class="tool-result-item tool-result-warn">⚠ All FX cleared</div>';
  });

  sec.appendChild(previewBtn);
  sec.appendChild(preview);
  sec.appendChild(applyBtn);
  sec.appendChild(clearBtn);
  sec.appendChild(status);
}

/* ═══════════════════════════════════════════════════════════════════════════
   9. Song Offset Finder
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolOffsetFinder(c) {
  const sec = _section('Song Offset Finder');
  c.appendChild(sec);

  let tapTimes = [];
  const currentOffsetEl = _h('div', 'tool-result-item', `Current offset: <b>${((typeof chart !== "undefined" ? chart : null)?.meta?.offset ?? 0)}ms</b>`);
  sec.appendChild(currentOffsetEl);

  const tapBtn = _btn('Tap to Beat', 'tool-btn-action');
  tapBtn.style.padding = '14px 20px';
  const tapInfo = _h('div', 'tool-result-item', 'Tap at least 4 times...');
  const offsetIn = document.createElement('input');
  offsetIn.type = 'number'; offsetIn.style.width = '90px';
  offsetIn.value = (typeof chart !== "undefined" ? chart : null)?.meta?.offset ?? 0;

  tapBtn.addEventListener('click', () => {
    const now = Date.now();
    if (tapTimes.length > 0 && now - tapTimes[tapTimes.length-1] > 3000) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i-1]);
      const avgInterval = intervals.reduce((a,b) => a+b, 0) / intervals.length;
      const bpm = 60000 / avgInterval;
      tapInfo.innerHTML = `Taps: ${tapTimes.length} | Avg BPM: <b>${bpm.toFixed(1)}</b> | ms/beat: <b>${avgInterval.toFixed(0)}</b>`;
    } else {
      tapInfo.textContent = `Taps: ${tapTimes.length} — keep tapping...`;
    }
  });

  const minusBtn = _btn('-10ms'); const plusBtn = _btn('+10ms');
  minusBtn.addEventListener('click', () => { offsetIn.value = parseInt(offsetIn.value) - 10; });
  plusBtn.addEventListener('click',  () => { offsetIn.value = parseInt(offsetIn.value) + 10; });

  const saveBtn = _btn('Save Offset');
  const saveStatus = _h('div', 'tool-result-box');
  saveBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    chart.meta.offset = parseInt(offsetIn.value);
    const metaOffsetEl = document.getElementById('meta-offset');
    if (metaOffsetEl) metaOffsetEl.value = chart.meta.offset;
    saveStatus.innerHTML = `<div class="tool-result-item tool-result-ok">✓ Offset set to ${chart.meta.offset}ms</div>`;
    currentOffsetEl.innerHTML = `Current offset: <b>${chart.meta.offset}ms</b>`;
  });

  const resetTapBtn = _btn('Reset Taps');
  resetTapBtn.addEventListener('click', () => { tapTimes = []; tapInfo.textContent = 'Taps reset.'; });

  sec.appendChild(tapBtn);
  sec.appendChild(tapInfo);
  sec.appendChild(_row('Manual offset (ms):', offsetIn));
  const adjRow = _h('div', 'tool-row');
  adjRow.appendChild(minusBtn); adjRow.appendChild(plusBtn);
  sec.appendChild(adjRow);
  sec.appendChild(saveBtn);
  sec.appendChild(resetTapBtn);
  sec.appendChild(saveStatus);
}

/* ═══════════════════════════════════════════════════════════════════════════
   10. Jacket Metadata Builder
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolJacketMeta(c) {
  const sec = _section('Jacket Metadata Builder');
  c.appendChild(sec);

  const meta = (typeof chart !== "undefined" ? chart : null)?.meta ?? {};
  const fields = [
    { key: 'title',      label: 'Title',       type: 'text',   val: meta.title||'' },
    { key: 'artist',     label: 'Artist',       type: 'text',   val: meta.artist||'' },
    { key: 'effect',     label: 'Effector',     type: 'text',   val: meta.effect||'' },
    { key: 'illust',     label: 'Illustrator',  type: 'text',   val: meta.illust||'' },
    { key: 'bpm',        label: 'BPM',          type: 'number', val: meta.bpm||180 },
    { key: 'level',      label: 'Level (1-20)', type: 'number', val: meta.level||10 },
    { key: 'difficulty', label: 'Difficulty',   type: 'select', val: meta.difficulty||'infinite',
      opts: ['light','challenge','extended','infinite'] },
  ];

  const inputs = {};
  fields.forEach(f => {
    let inp;
    if (f.type === 'select') {
      inp = document.createElement('select');
      f.opts.forEach(o => { const opt = document.createElement('option'); opt.value = o; opt.textContent = o.toUpperCase(); if(o===f.val)opt.selected=true; inp.appendChild(opt); });
    } else {
      inp = document.createElement('input'); inp.type = f.type; inp.value = f.val;
    }
    inputs[f.key] = inp;
    const row = _row(f.label + ':', inp);
    if (f.type === 'text') {
      const cnt = _h('span', 'tool-char-count', `${String(f.val).length}`);
      inp.addEventListener('input', () => cnt.textContent = inp.value.length);
      row.appendChild(cnt);
    }
    sec.appendChild(row);
  });

  // Genre preset
  const genreSel = document.createElement('select');
  ['—','FLOOR','BOOTH','HEAVEN','BLASTER'].forEach(g => { const o = document.createElement('option'); o.value = g; o.textContent = g; genreSel.appendChild(o); });
  genreSel.addEventListener('change', () => {
    const g = genreSel.value;
    if (g === 'BLASTER') { inputs.difficulty.value = 'infinite'; inputs.level.value = 20; }
    else if (g === 'HEAVEN') { inputs.difficulty.value = 'extended'; }
    else if (g === 'BOOTH') { inputs.difficulty.value = 'challenge'; }
    else if (g === 'FLOOR') { inputs.difficulty.value = 'light'; }
  });
  sec.appendChild(_row('Genre preset:', genreSel));

  const applyBtn = _btn('Apply to Chart');
  const status = _h('div', 'tool-result-box');
  applyBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    fields.forEach(f => {
      const v = inputs[f.key].value;
      chart.meta[f.key] = (f.type === 'number') ? parseFloat(v) : v;
    });
    // Sync sidebar inputs
    ['title','artist','effect','illust','level','bpm','difficulty'].forEach(k => {
      const el = document.getElementById('meta-' + (k==='effect'?'effect':k==='illust'?'illust':k));
      if (el) el.value = chart.meta[k];
    });
    status.innerHTML = '<div class="tool-result-item tool-result-ok">✓ Metadata applied</div>';
  });
  sec.appendChild(applyBtn);
  sec.appendChild(status);
}

/* ═══════════════════════════════════════════════════════════════════════════
   11. Hand Position Optimizer
   ═══════════════════════════════════════════════════════════════════════════ */
// ── Hand Optimizer helpers ──────────────────────────────────────────────────
// laneCount[] order: [btA=0, btB=1, btC=2, btD=3, fxL=4, fxR=5]
// Lane colors (indexed same as laneCount):
const _HO_LANE_COLORS = ['#44aaff','#66bbff','#ff8833','#ff6622','#cc44ff','#ff44cc'];
// Deprecated (kept to avoid ref errors from old code paths):
const _HO_LANE_ORDER  = [4,0,1,2,3,5];
const _HO_LANE_LABELS = ['FX-L','BT-A','BT-B','BT-C','BT-D','FX-R'];
const _HO_FINGER_H  = [28,36,42,42,36,28];
const _HO_HAND_SIDE = [0,0,0,1,1,1];

let _hoPopupAnimTimer = null;

function _hoScoreColor(frac) {
  const r = Math.round(Math.min(1, frac * 2) * 255);
  const g = Math.round(Math.min(1, (1 - frac) * 2) * 200);
  return `rgb(${r},${g},40)`;
}

// ── Ergonomic reason + suggestion generator ───────────────────────────────────
function _hoReason(s) {
  const reasons = [], suggests = [];
  const totalLoad = (s.lLoad + s.rLoad) || 1;
  const lPct = s.lLoad / totalLoad;

  // ── Stretch ────────────────────────────────────────────────────────────────
  if (s.stretch > 0) {
    reasons.push('Full-span stretch with laser: BT-A and BT-D both appear while a laser is moving, requiring the ring fingers to span the outermost lanes while a hand is also rotating the VOL knob. This is a demanding combination at high BPM.');
    suggests.push('Shift BT-A or BT-D hits to BT-B / BT-C during the laser section, or time the stretch notes so they fall before or after the moving laser segment.');
  }

  // ── Chord density ──────────────────────────────────────────────────────────
  if (s.simScore > s.noteCount * 0.45 && s.simScore > 3) {
    reasons.push(`Chord-heavy: ${s.simScore} simultaneous note moments detected. Repeated multi-finger presses break natural finger independence and feel "crunchy" to sight-read.`);
    suggests.push('Break chords into alternating two-hand patterns (e.g. BT-A+BT-C instead of BT-A+BT-B), or convert some chords into fast rolls.');
  }

  // ── Density ────────────────────────────────────────────────────────────────
  if (s.noteCount > 36) {
    reasons.push(`Very dense: ${s.noteCount} BT notes in one measure. At typical SDVX BPMs this creates a relentless finger stream with almost no rest, leading to fatigue and potential cramps.`);
    suggests.push('Thin the density by converting repeating chips into holds, or spread the busiest part across two measures.');
  }

  // ── Hand imbalance ─────────────────────────────────────────────────────────
  if (lPct > 0.70) {
    reasons.push(`Left-dominant: ${Math.round(lPct*100)}% of notes fall on BT-A/B. Sustained one-sided loading causes left-hand fatigue and can feel unfair or unrhythmic to the player.`);
    suggests.push('Mirror a portion of the BT-A/B pattern to BT-C/D to share the load with the right hand.');
  } else if (lPct < 0.30) {
    reasons.push(`Right-dominant: ${Math.round((1-lPct)*100)}% of notes fall on BT-C/D. The left hand sits largely idle, which feels awkward and breaks momentum.`);
    suggests.push('Add complementary notes on BT-A/B or mirror the right-hand run to the left side.');
  }

  // ── FX overuse ─────────────────────────────────────────────────────────────
  const fxTotal = (s.laneCount[4] || 0) + (s.laneCount[5] || 0);
  if (fxTotal > 5) {
    reasons.push(`Heavy FX: ${fxTotal} FX notes require frequent thumb movement. If lasers are also active in this section, the thumb cannot easily reach both the FX button and the VOL knob at once (ONE-HAND conflict).`);
    suggests.push('Stagger FX notes so they don\'t overlap with laser sections, or reduce FX frequency to give the thumb breathing room.');
  }

  if (reasons.length === 0) {
    reasons.push('No major ergonomic concerns — note distribution and hand demand look comfortable.');
    suggests.push('Pattern is well-balanced. Consider using a similar structure for adjacent measures.');
  }

  return { reason: reasons.join(' '), suggest: suggests.join(' ') };
}

// ── SVG helper (scoped to avoid name collision) ────────────────────────────
function _hoSvEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

// ── Mini controller SVG (for card rows, no hands) ─────────────────────────
// Layout (220×58): VOL circles at far sides, 4 BT buttons, 2 FX buttons below
function _buildMiniControllerSvg(s) {
  const W = 222, H = 58;
  const g = _hoSvEl;
  const laneColors = _HO_LANE_COLORS; // [btA,btB,btC,btD,fxL,fxR]
  const maxLC = Math.max(1, ...s.laneCount);

  const svg = g('svg', { viewBox:`0 0 ${W} ${H}`, width:'100%', height:H, style:'display:block;border-radius:5px;overflow:hidden' });
  svg.appendChild(g('rect', { x:0,y:0,width:W,height:H, rx:5, fill:'#0c0c1e', stroke:'#1e1e3888','stroke-width':'1' }));

  // VOL knob indicators
  [[10,27],[212,27]].forEach(([cx]) => {
    svg.appendChild(g('circle', { cx, cy:27, r:10, fill:'#161626', stroke:'#28284888','stroke-width':'1' }));
    svg.appendChild(g('circle', { cx, cy:20, r:3, fill:'#404060' }));
  });

  // BT buttons (4)
  const BT_X = [24,56,88,120], BTW=28, BTH=30, BT_Y=5;
  BT_X.forEach((bx, i) => {
    const count = s.laneCount[i], intens = count/maxLC, col = laneColors[i], act = count>0;
    svg.appendChild(g('rect',{ x:bx+1,y:BT_Y+1,width:BTW,height:BTH,rx:3,fill:'#00000033' }));
    svg.appendChild(g('rect',{ x:bx,y:BT_Y,width:BTW,height:BTH,rx:3,
      fill: act?`${col}${Math.round(18+intens*65).toString(16).padStart(2,'0')}`:'#161628',
      stroke: act?col:'#222238','stroke-width':'1.2' }));
    if (count>0) svg.appendChild(g('text',{x:bx+BTW/2,y:BT_Y+BTH/2+4,'text-anchor':'middle',fill:col,'font-size':'9','font-family':'monospace','font-weight':'bold',opacity:'0.9'},String(count)));
    svg.appendChild(g('text',{x:bx+BTW/2,y:BT_Y+BTH+8,'text-anchor':'middle',fill:act?col+'88':'#252535','font-size':'6.5','font-family':'monospace'},['A','B','C','D'][i]));
  });

  // FX buttons below BT (each spans 2 BT buttons width + gap)
  const FX_X=[24,88], FXW=60, FXH=11, FX_Y=38;
  FX_X.forEach((fx, i) => {
    const li=4+i, count=s.laneCount[li], intens=count/maxLC, col=laneColors[li], act=count>0;
    svg.appendChild(g('rect',{ x:fx,y:FX_Y,width:FXW,height:FXH,rx:2,
      fill: act?`${col}${Math.round(14+intens*55).toString(16).padStart(2,'0')}`:'#111122',
      stroke: act?col:'#1c1c30','stroke-width':'1' }));
    if (count>0) svg.appendChild(g('text',{x:fx+FXW/2,y:FX_Y+FXH-2,'text-anchor':'middle',fill:col,'font-size':'7','font-family':'monospace','font-weight':'bold'},`×${count}`));
    svg.appendChild(g('text',{x:fx+FXW/2,y:FX_Y+FXH+8,'text-anchor':'middle',fill:act?col+'88':'#202030','font-size':'6','font-family':'monospace'},['FX-L','FX-R'][i]));
  });

  return svg;
}

// ── Full controller SVG with hands (for hover popup) ──────────────────────
// viewBox 340×215; controller occupies y=0..133; hands occupy y=133..213
// laneCount[]: [btA=0, btB=1, btC=2, btD=3, fxL=4, fxR=5]
function _buildFullControllerSvg(s) {
  const W=340, H=215;
  const g = _hoSvEl;
  const lc = s.laneCount;
  const laneColors = _HO_LANE_COLORS;
  const maxLC = Math.max(1, ...lc);

  const svg = g('svg', { viewBox:`0 0 ${W} ${H}`, width:'100%', style:'display:block' });

  // Defs
  const defs = g('defs');
  // Board gradient
  const bgG = g('linearGradient', { id:'ho-bg-g',x1:'0%',y1:'0%',x2:'0%',y2:'100%' });
  bgG.appendChild(g('stop',{ offset:'0%','stop-color':'#1c1c32' }));
  bgG.appendChild(g('stop',{ offset:'70%','stop-color':'#0e0e1e' }));
  bgG.appendChild(g('stop',{ offset:'100%','stop-color':'#09091a' }));
  defs.appendChild(bgG);
  // Glow filter for pressed buttons
  const gf = g('filter',{ id:'ho-gf',x:'-60%',y:'-60%',width:'220%',height:'220%' });
  const feB = g('feGaussianBlur',{ in:'SourceGraphic',stdDeviation:'5',result:'b' });
  const feC = g('feComposite',{ in:'SourceGraphic',in2:'b',operator:'over' });
  gf.appendChild(feB); gf.appendChild(feC);
  defs.appendChild(gf);
  svg.appendChild(defs);

  // Controller body
  svg.appendChild(g('rect',{ x:1,y:1,width:W-2,height:133,rx:10,fill:'url(#ho-bg-g)',stroke:'#26264488','stroke-width':'1.5' }));
  // Top edge highlight
  svg.appendChild(g('line',{ x1:18,y1:2,x2:W-18,y2:2,stroke:'#3a3a5a44','stroke-width':'1' }));
  // Side accents (like real EXION chassis)
  svg.appendChild(g('polygon',{ points:'0,38 16,48 0,58', fill:'#22224466' }));
  svg.appendChild(g('polygon',{ points:`${W},38 ${W-16},48 ${W},58`, fill:'#22224466' }));
  // Horizontal separator lines (circuit board aesthetic)
  ['28','103'].forEach(y => svg.appendChild(g('line',{x1:0,y1:y,x2:W,y2:y,stroke:'#18183022','stroke-width':'0.5'})));

  // START button (top center)
  svg.appendChild(g('rect',{ x:148,y:14,width:44,height:15,rx:3,fill:'#162030',stroke:'#243040','stroke-width':'1' }));
  svg.appendChild(g('text',{ x:170,y:24,'text-anchor':'middle',fill:'#3a4a5a','font-size':'7','font-family':'monospace' },'START'));

  // VOL knobs (cx=30 and cx=310, cy=72)
  [30,310].forEach((cx, i) => {
    svg.appendChild(g('circle',{ cx,cy:72,r:26,fill:'#131322',stroke:'#28285088','stroke-width':'1.5' }));
    svg.appendChild(g('circle',{ cx,cy:72,r:20,fill:'#1e1e38',stroke:'#34346088','stroke-width':'1.5' }));
    svg.appendChild(g('circle',{ cx,cy:72-14,r:4,fill:'#484870' }));
    svg.appendChild(g('text',{ x:cx,y:126,'text-anchor':'middle',fill:'#2e2e4866','font-size':'7.5','font-family':'monospace'},[' VOL-L','VOL-R'][i]));
  });

  // BT BUTTONS  (y=40..84, w=44 h=44, centers: 90,142,194,246)
  const BT_X=[68,120,172,224], BTW=44, BTH=44, BT_Y=40;
  const btBtns = [];
  BT_X.forEach((bx,i) => {
    const count=lc[i], intens=count/maxLC, col=laneColors[i], act=count>0;
    svg.appendChild(g('rect',{x:bx+2,y:BT_Y+2,width:BTW,height:BTH,rx:4,fill:'#00000050'}));
    const btn=g('rect',{x:bx,y:BT_Y,width:BTW,height:BTH,rx:4,
      fill: act?`${col}${Math.round(16+intens*60).toString(16).padStart(2,'0')}`:'#181830',
      stroke: act?col:'#242444','stroke-width':'1.5'});
    svg.appendChild(btn);
    // inner surface shine
    svg.appendChild(g('rect',{x:bx+3,y:BT_Y+3,width:BTW-6,height:9,rx:3,fill:act?col+'1a':'#ffffff07'}));
    svg.appendChild(g('text',{x:bx+BTW/2,y:BT_Y+BTH+11,'text-anchor':'middle',fill:act?col+'bb':'#2e2e4a','font-size':'8','font-family':'monospace','font-weight':'bold'},['BT-A','BT-B','BT-C','BT-D'][i]));
    if(count>0) svg.appendChild(g('text',{x:bx+BTW/2,y:BT_Y+BTH/2+5,'text-anchor':'middle',fill:col,'font-size':'13','font-family':'monospace','font-weight':'bold',opacity:'0.88'},String(count)));
    btBtns.push({ el:btn, col, baseAct:act, baseIntens:intens });
  });

  // FX BUTTONS (y=92..116, w=96 h=24, centers: 116,220)
  const FX_X=[68,172], FXW=96, FXH=24, FX_Y=92;
  const fxBtns = [];
  FX_X.forEach((fx,i) => {
    const li=4+i, count=lc[li], intens=count/maxLC, col=laneColors[li], act=count>0;
    svg.appendChild(g('rect',{x:fx+1,y:FX_Y+1,width:FXW,height:FXH,rx:3,fill:'#00000033'}));
    const btn=g('rect',{x:fx,y:FX_Y,width:FXW,height:FXH,rx:3,
      fill: act?`${col}${Math.round(12+intens*50).toString(16).padStart(2,'0')}`:'#11112a',
      stroke: act?col:'#1c1c38','stroke-width':'1.2'});
    svg.appendChild(btn);
    svg.appendChild(g('text',{x:fx+FXW/2,y:FX_Y+FXH/2+4,'text-anchor':'middle',
      fill:act?col:'#282840','font-size':'8.5','font-family':'monospace','font-weight':'bold'},
      ['FX-L','FX-R'][i]+(count>0?`  ×${count}`:'')));
    fxBtns.push({ el:btn, col, baseAct:act, baseIntens:intens });
  });

  // ── HANDS ────────────────────────────────────────────────────────────────
  // Top-down view. Standard SDVX grip:
  //   Left:  ring→BT-A  index→BT-B  thumb→FX-L
  //   Right: thumb→FX-R  index→BT-C  ring→BT-D
  // Palms sit below the controller; fingers extend upward to the buttons.

  // Palm shapes (filled ellipses for top-down look, angled inward)
  svg.appendChild(g('ellipse',{cx:86,cy:201,rx:34,ry:14,fill:'#c8905c44',stroke:'#c8905c66','stroke-width':'1.2',transform:'rotate(-18,86,201)'}));
  svg.appendChild(g('ellipse',{cx:254,cy:201,rx:34,ry:14,fill:'#c8905c44',stroke:'#c8905c66','stroke-width':'1.2',transform:'rotate(18,254,201)'}));

  // Hand labels
  svg.appendChild(g('text',{x:86,y:213,'text-anchor':'middle',fill:'#6677aa88','font-size':'7','font-family':'monospace'},'L'));
  svg.appendChild(g('text',{x:254,y:213,'text-anchor':'middle',fill:'#aa776688','font-size':'7','font-family':'monospace'},'R'));

  // Correct SDVX finger mapping:
  //  Left hand (palm ~cx=86): pinky(rest), ring→BT-A, middle(rest), index→BT-B, thumb→FX-L
  //  Right hand (palm ~cx=254): thumb→FX-R, index→BT-C, middle(rest), ring→BT-D, pinky(rest)
  //
  // d = SVG quadratic bezier path (palm → button contact)
  // laneIdx: maps into laneCount[]; -1 = no highlight finger
  // w = stroke-width (finger thickness in px)
  // label = finger role (shown on hover)
  const fingerDefs = [
    // ── Left hand ─────────────────────────────────────────────────────────
    // L-thumb → FX-L  (thumb goes down toward FX-L below BT cluster)
    { d:'M 104,192 Q 114,158 116,116', laneIdx:4, w:10, col:'#c8905c', tipXY:[116,116], label:'L-thumb' },
    // L-index → BT-B  (index reaches up-right toward BT-B)
    { d:'M 96,184  Q 128,136 142,84',  laneIdx:1, w:12, col:'#c8905c', tipXY:[142,84],  label:'L-index' },
    // L-middle → resting  (between BT-A and BT-B zone)
    { d:'M 82,183  Q 96,140 104,108',  laneIdx:-1,w:12, col:'#c8905c', tipXY:[104,108], label:'L-middle' },
    // L-ring → BT-A  (ring reaches up-left toward BT-A)
    { d:'M 68,186  Q 74,136 90,84',    laneIdx:0, w:11, col:'#c8905c', tipXY:[90,84],   label:'L-ring' },
    // L-pinky → resting (far left, near VOL-L side)
    { d:'M 54,190  Q 46,162 44,140',   laneIdx:-1,w:8,  col:'#c8905c', tipXY:[44,140],  label:'L-pinky' },

    // ── Right hand ────────────────────────────────────────────────────────
    // R-pinky → resting
    { d:'M 286,190 Q 294,162 296,140', laneIdx:-1,w:8,  col:'#c8905c', tipXY:[296,140], label:'R-pinky' },
    // R-ring → BT-D
    { d:'M 272,186 Q 266,136 250,84',  laneIdx:3, w:11, col:'#c8905c', tipXY:[250,84],  label:'R-ring' },
    // R-middle → resting
    { d:'M 258,183 Q 244,140 236,108', laneIdx:-1,w:12, col:'#c8905c', tipXY:[236,108], label:'R-middle' },
    // R-index → BT-C
    { d:'M 244,184 Q 212,136 198,84',  laneIdx:2, w:12, col:'#c8905c', tipXY:[198,84],  label:'R-index' },
    // R-thumb → FX-R
    { d:'M 236,192 Q 226,158 224,116', laneIdx:5, w:10, col:'#c8905c', tipXY:[224,116], label:'R-thumb' },
  ];

  // Render fingers — draw lower-priority fingers first (under palms)
  const fingerRefs = {}; // laneIdx → { path, tip, col, baseCount, baseIntens }
  fingerDefs.forEach(f => {
    const count  = f.laneIdx >= 0 ? lc[f.laneIdx] : 0;
    const intens = count / maxLC;
    const active = f.laneIdx >= 0 && count > 0;
    const clr    = active ? laneColors[f.laneIdx] : f.col;

    // Skin-fill path for the finger body (drawn as thick stroke = looks like a finger)
    const aFrac  = active ? 0.6 + intens*0.35 : 0.22;
    const strokeA= Math.round(aFrac * 255).toString(16).padStart(2,'0');
    const skinFill = f.col + Math.round((active ? 0.55+intens*0.35 : 0.28)*255).toString(16).padStart(2,'0');

    // Finger body (thick stroke = simplified top-down silhouette)
    const fp = g('path',{ d:f.d,
      stroke: active ? clr+strokeA : f.col+'48',
      'stroke-width': f.w,
      'stroke-linecap':'round',
      fill:'none'
    });
    svg.appendChild(fp);

    // Skin-tone overlay on same path (slightly thinner, lighter)
    const sp = g('path',{ d:f.d,
      stroke: skinFill,
      'stroke-width': Math.max(2, f.w - 3),
      'stroke-linecap':'round',
      fill:'none'
    });
    svg.appendChild(sp);

    // Knuckle dots
    if (f.laneIdx >= 0 || true) {
      // Parse d to get rough midpoint — use a simple tick mark on the path
      // (SVG doesn't expose path midpoints directly; we approximate)
    }

    // Fingertip ellipse (shows button contact)
    const tipFill = active ? clr + Math.round((0.45+intens*0.45)*255).toString(16).padStart(2,'0') : f.col+'18';
    const tipStr  = active ? clr+'cc' : f.col+'30';
    const tipRx   = f.w/2 + 2, tipRy = f.w/2 + 3;
    const tip = g('ellipse',{ cx:f.tipXY[0], cy:f.tipXY[1], rx:tipRx, ry:tipRy,
      fill:tipFill, stroke:tipStr, 'stroke-width':'1.2' });
    svg.appendChild(tip);

    // Finger label
    svg.appendChild(g('text',{ x:f.tipXY[0], y:f.tipXY[1]-tipRy-3,
      'text-anchor':'middle', fill: active ? clr+'88' : '#33334488',
      'font-size':'5.5', 'font-family':'monospace' }, f.label));

    if (f.laneIdx >= 0) {
      fingerRefs[f.laneIdx] = { path:fp, skin:sp, tip, col:clr, baseCount:count, baseIntens:intens };
    }
  });

  // ── Animate function (called during combo cycling) ────────────────────
  const animate = (activeLanes) => {
    // Reset BT buttons
    btBtns.forEach(b => {
      b.el.setAttribute('fill', b.baseAct ? `${b.col}${Math.round(16+b.baseIntens*60).toString(16).padStart(2,'0')}` : '#181830');
      b.el.setAttribute('stroke', b.baseAct ? b.col : '#242444');
      b.el.removeAttribute('filter');
    });
    // Reset FX buttons
    fxBtns.forEach(b => {
      b.el.setAttribute('fill', b.baseAct ? `${b.col}${Math.round(12+b.baseIntens*50).toString(16).padStart(2,'0')}` : '#11112a');
      b.el.setAttribute('stroke', b.baseAct ? b.col : '#1c1c38');
      b.el.removeAttribute('filter');
    });
    // Reset fingers
    Object.values(fingerRefs).forEach(r => {
      const baseHex = Math.round((0.6+r.baseIntens*0.35)*255).toString(16).padStart(2,'0');
      r.path.setAttribute('stroke', r.col + (r.baseCount>0 ? baseHex : '48'));
      r.tip.setAttribute('fill',  r.col + (r.baseCount>0 ? '60' : '18'));
      r.tip.setAttribute('stroke',r.col + (r.baseCount>0 ? 'aa' : '30'));
    });
    // Highlight active lanes
    activeLanes.forEach(li => {
      if (li < 4) {
        btBtns[li].el.setAttribute('fill',   btBtns[li].col + 'ee');
        btBtns[li].el.setAttribute('stroke',  btBtns[li].col);
        btBtns[li].el.setAttribute('filter', 'url(#ho-gf)');
      } else if (fxBtns[li-4]) {
        fxBtns[li-4].el.setAttribute('fill',   fxBtns[li-4].col + 'ee');
        fxBtns[li-4].el.setAttribute('stroke',  fxBtns[li-4].col);
        fxBtns[li-4].el.setAttribute('filter', 'url(#ho-gf)');
      }
      if (fingerRefs[li]) {
        fingerRefs[li].path.setAttribute('stroke', fingerRefs[li].col + 'dd');
        fingerRefs[li].tip.setAttribute('fill',   fingerRefs[li].col + 'ee');
        fingerRefs[li].tip.setAttribute('stroke',  fingerRefs[li].col);
      }
    });
  };

  return { svg, animate };
}

function _buildHandCard(s, maxScore) {
  const frac     = Math.min(1, s.total / Math.max(1, maxScore));
  const barColor = _hoScoreColor(frac);
  const isSevere = s.stretch > 0 || s.total > 20;
  const { reason, suggest } = _hoReason(s);
  // Short reason: first sentence only (up to 80 chars)
  const reasonShort = reason.split('.')[0].slice(0, 88) + (reason.length > 88 ? '…' : '.');

  const card = document.createElement('div');
  card.style.cssText = [
    'background:#0d0d20',
    'border:1px solid '+(isSevere?'#ff335544':'#20203a88'),
    'border-radius:8px',
    'padding:6px 8px 5px',
    'cursor:pointer',
    'transition:border-color 0.15s,background 0.15s',
  ].join(';');
  card.title = 'Click to jump to this measure';
  card.addEventListener('mouseenter',()=>{ card.style.background='#121228'; card.style.borderColor=isSevere?'#ff3355aa':'#3344aaaa'; });
  card.addEventListener('mouseleave',()=>{ card.style.background='#0d0d20'; card.style.borderColor=isSevere?'#ff335544':'#20203a88'; });

  // Top row: M-label + score bar + score number
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:5px';
  const mLabel = document.createElement('span');
  mLabel.style.cssText = 'font-size:12px;font-weight:700;color:#8899cc;min-width:32px;font-family:monospace';
  mLabel.textContent = 'M'+(s.m+1);
  const barWrap = document.createElement('div');
  barWrap.style.cssText = 'flex:1;height:7px;background:#131320;border-radius:4px;overflow:hidden';
  const bar = document.createElement('div');
  bar.style.cssText = `width:${Math.round(frac*100)}%;height:100%;border-radius:4px;background:linear-gradient(90deg,${barColor}88,${barColor})`;
  barWrap.appendChild(bar);
  const scoreLabel = document.createElement('span');
  scoreLabel.style.cssText = `font-size:11px;font-weight:700;font-family:monospace;color:${barColor};min-width:24px;text-align:right`;
  scoreLabel.textContent = s.total;
  topRow.appendChild(mLabel); topRow.appendChild(barWrap); topRow.appendChild(scoreLabel);
  if (isSevere) { const w=document.createElement('span'); w.textContent='⚠'; w.style.fontSize='11px'; topRow.appendChild(w); }
  card.appendChild(topRow);

  // Mini controller SVG (replaces the old finger columns)
  const miniSvg = _buildMiniControllerSvg(s);
  card.appendChild(miniSvg);

  // Bottom: tags + L/R balance
  const bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px';
  s.tags.forEach(tag => {
    const t = document.createElement('span');
    t.style.cssText = `font-size:8px;font-weight:700;font-family:monospace;padding:1px 5px;border-radius:3px;background:${tag.color}22;color:${tag.color};border:1px solid ${tag.color}55`;
    t.textContent = tag.label;
    bottomRow.appendChild(t);
  });
  const totalLoad = s.lLoad+s.rLoad||1;
  const lPct = Math.round(s.lLoad/totalLoad*100);
  const balWrap = document.createElement('div');
  balWrap.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:3px';
  balWrap.innerHTML = `<span style="font-size:8px;font-family:monospace;color:#556688">L</span>`+
    `<div style="width:50px;height:4px;background:#111120;border-radius:3px;overflow:hidden;display:flex">`+
      `<div style="width:${lPct}%;background:#4477ff77"></div>`+
      `<div style="width:${100-lPct}%;background:#ff774477"></div>`+
    `</div>`+
    `<span style="font-size:8px;font-family:monospace;color:#556688">R</span>`;
  bottomRow.appendChild(balWrap);
  card.appendChild(bottomRow);

  // Reason blurb
  const reasonRow = document.createElement('div');
  reasonRow.style.cssText = 'margin-top:5px;font-size:8px;color:#556688;font-family:sans-serif;line-height:1.45;padding:4px 5px;background:#090918;border-radius:4px;border-left:2px solid '+(isSevere?'#ff335566':'#33449955');
  reasonRow.textContent = reasonShort;
  card.appendChild(reasonRow);

  return card;
}

function _showHandPopup(popup, s, e) {
  if (_hoPopupAnimTimer) { clearInterval(_hoPopupAnimTimer); _hoPopupAnimTimer = null; }
  popup.innerHTML = '';
  popup.style.display = 'block';
  _positionHandPopup(popup, e);

  const { reason, suggest } = _hoReason(s);
  const isSevere = s.stretch > 0 || s.total > 20;

  // ── Header ────────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';
  hdr.innerHTML =
    `<span style="font-size:11px;font-weight:700;color:#8899cc;font-family:monospace">M${s.m+1} · difficulty ${s.total}</span>`+
    `<button id="ho-goto-btn" style="font-size:9px;font-family:monospace;padding:2px 7px;background:#1a2a4a;border:1px solid #3355aa;border-radius:4px;color:#88aadd;cursor:pointer">▶ Go to measure</button>`;
  popup.appendChild(hdr);
  popup.querySelector('#ho-goto-btn').addEventListener('click', () => _goToMeasure(s.m));

  // ── Controller SVG with hands ─────────────────────────────────────────────
  const { svg, animate } = _buildFullControllerSvg(s);
  popup.appendChild(svg);

  // Combo cycle label
  const comboLabel = document.createElement('div');
  comboLabel.style.cssText = 'font-size:8px;font-family:monospace;color:#33446688;text-align:center;margin-top:3px';
  comboLabel.textContent = s.topCombos.length>0 ? '▶ cycling hardest simultaneous combos' : 'no simultaneous combos detected';
  popup.appendChild(comboLabel);

  // ── Stats row ─────────────────────────────────────────────────────────────
  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;gap:10px;font-size:8px;font-family:monospace;color:#445566;border-top:1px solid #14142233;padding-top:4px;margin-top:5px';
  [['notes',s.noteCount],['chords',s.simScore],['stretch',s.stretch>0?'⚠ yes':'no'],['FX',(s.laneCount[4]||0)+(s.laneCount[5]||0)]].forEach(([k,v])=>{
    const d=document.createElement('div');
    d.innerHTML=`<span style="color:#2a3a4088">${k}:</span> <span style="color:#7788aa">${v}</span>`;
    statsRow.appendChild(d);
  });
  popup.appendChild(statsRow);

  // ── Why this is hard ─────────────────────────────────────────────────────
  const reasonBox = document.createElement('div');
  reasonBox.style.cssText = [
    'margin-top:7px',
    'padding:5px 7px',
    'background:#08081a',
    'border-left:2px solid '+(isSevere?'#ff3344':'#334488'),
    'border-radius:0 4px 4px 0',
    'font-size:8.5px',
    'font-family:sans-serif',
    'color:#6677aa',
    'line-height:1.5',
  ].join(';');
  reasonBox.innerHTML =
    `<div style="font-size:8px;font-weight:700;color:${isSevere?'#ff5566':'#4466aa'};margin-bottom:3px;font-family:monospace;letter-spacing:.03em">⚠ WHY IT'S DIFFICULT</div>`+
    `<div>${reason}</div>`;
  popup.appendChild(reasonBox);

  // ── Suggestion ────────────────────────────────────────────────────────────
  const suggestBox = document.createElement('div');
  suggestBox.style.cssText = [
    'margin-top:5px',
    'padding:5px 7px',
    'background:#08100e',
    'border-left:2px solid #226644',
    'border-radius:0 4px 4px 0',
    'font-size:8.5px',
    'font-family:sans-serif',
    'color:#558866',
    'line-height:1.5',
  ].join(';');
  suggestBox.innerHTML =
    `<div style="font-size:8px;font-weight:700;color:#44aa77;margin-bottom:3px;font-family:monospace;letter-spacing:.03em">SUGGESTION</div>`+
    `<div>${suggest}</div>`;
  popup.appendChild(suggestBox);

  // ── Combo cycling ─────────────────────────────────────────────────────────
  if (s.topCombos.length > 0) {
    let ci = 0;
    const step = () => {
      const combo = s.topCombos[ci % s.topCombos.length];
      animate(combo.lanes);
      comboLabel.textContent = `▶ combo ${ci%s.topCombos.length+1}/${s.topCombos.length}  (${combo.lanes.length} simultaneous — fingers shown above)`;
      ci++;
    };
    step();
    _hoPopupAnimTimer = setInterval(step, 720);
  }
}

function _positionHandPopup(popup, e) {
  const W = window.innerWidth, H = window.innerHeight;
  const pw = popup.offsetWidth  || 340;
  const ph = popup.offsetHeight || 300;
  let x = e.clientX + 16;
  let y = e.clientY - Math.round(ph / 2);
  if (x + pw > W - 8) x = e.clientX - pw - 16;
  if (y + ph > H - 8) y = H - ph - 8;
  if (y < 4) y = 4;
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
}

function _toolHandOpt(c) {
  const sec = _section('Hand Position Optimizer');
  c.appendChild(sec);

  // ── How to Read legend ──────────────────────────────────────────────────
  const legend = document.createElement('div');
  legend.style.cssText = 'background:#09091e;border:1px solid #1e1e38;border-radius:7px;padding:8px 10px;margin-bottom:8px;font-size:8.5px;font-family:sans-serif;color:#4a5588;line-height:1.6';
  legend.innerHTML = `
    <div style="font-size:9px;font-weight:700;color:#6677aa;font-family:monospace;margin-bottom:5px;letter-spacing:.04em">📖 HOW TO READ</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 14px">
      <div><span style="color:#8899cc;font-weight:700">Score bar</span> — overall difficulty of that measure (notes + chords + stretch penalty).</div>
      <div><span style="color:#8899cc;font-weight:700">Mini controller</span> — shows how many notes hit each button. Brighter = more hits.</div>
      <div><span style="color:#ff5566;font-weight:700">STRETCH</span> tag — BT-A and BT-D both appear; forces a full 4-lane hand span.</div>
      <div><span style="color:#ffaa22;font-weight:700">CHORD</span> tag — many simultaneous multi-finger presses; taxing on coordination.</div>
      <div><span style="color:#ff6644;font-weight:700">DENSE</span> tag — very high note count in the measure; little rest time for fingers.</div>
      <div><span style="color:#bb44ff;font-weight:700">FX</span> tag — frequent FX notes may conflict with VOL knob turns (ONE-HAND risk).</div>
      <div><span style="color:#4477ff;font-weight:700">L ▓░ R</span> bar — left vs right hand load balance. Even = better ergonomics.</div>
      <div><span style="color:#6699bb;font-weight:700">Hover</span> to see full hand diagram + combo animation. <span style="color:#44aa77;font-weight:700">Click</span> to jump there.</div>
    </div>
    <div style="margin-top:5px;padding-top:5px;border-top:1px solid #1a1a30;font-size:8px;color:#333360">
      <b style="color:#5566aa">SDVX grip:</b> Left — ring→BT-A, index→BT-B, thumb→FX-L/VOL-L.&nbsp;&nbsp;Right — index→BT-C, ring→BT-D, thumb→FX-R/VOL-R.
    </div>
  `;
  sec.appendChild(legend);

  // ── Top controls row ────────────────────────────────────────────────────
  const ctrlRow = document.createElement('div');
  ctrlRow.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:6px';

  const topN = document.createElement('select');
  topN.style.cssText = 'background:#181830;color:#aac;border:1px solid #334;border-radius:4px;padding:2px 5px;font-size:10px;font-family:monospace';
  [['Top 10', '10'], ['Top 15', '15'], ['Top 20', '20'], ['All non-zero', '0']].forEach(([lbl, v]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = lbl;
    if (v === '10') opt.selected = true;
    topN.appendChild(opt);
  });

  const runBtn = _btn('Analyze');
  ctrlRow.appendChild(topN);
  ctrlRow.appendChild(runBtn);
  sec.appendChild(ctrlRow);

  const results = document.createElement('div');
  results.style.cssText = 'display:flex;flex-direction:column;gap:5px;max-height:340px;overflow-y:auto;padding-right:2px';
  sec.appendChild(results);

  // Floating hover popup (shared, appended once to body)
  let popup = document.getElementById('hand-opt-hover-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'hand-opt-hover-popup';
    popup.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:9999',
      'display:none',
      'background:#0b0b1e',
      'border:1px solid #2a3a6088',
      'border-radius:11px',
      'padding:10px 12px 8px',
      'box-shadow:0 8px 36px #00003399,0 0 0 1px #00000088',
      'font-family:monospace',
      'min-width:230px',
    ].join(';');
    document.body.appendChild(popup);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────
  runBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== 'undefined' && chart)) return;

    const totalM   = chart.totalMeasures || 64;
    const topCount = parseInt(topN.value);
    const scores   = [];

    for (let m = 0; m < totalM; m++) {
      const startT = m * TICKS_PER_MEASURE;
      const endT   = startT + TICKS_PER_MEASURE;

      // Per-lane counts: [btA, btB, btC, btD, fxL, fxR]
      const laneCount = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 4; i++) laneCount[i] = chart.bt[i].filter(n => n.y >= startT && n.y < endT).length;
      for (let i = 0; i < 2; i++) laneCount[4 + i] = chart.fx[i].filter(n => n.y >= startT && n.y < endT).length;

      // Tick map for simultaneity + combo detection
      const tickMap = new Map();
      for (let i = 0; i < 4; i++) {
        chart.bt[i].forEach(n => {
          if (n.y >= startT && n.y < endT) {
            if (!tickMap.has(n.y)) tickMap.set(n.y, []);
            tickMap.get(n.y).push(i);          // indices 0-3 = BT lanes (= laneCount[0-3])
          }
        });
      }
      for (let i = 0; i < 2; i++) {
        chart.fx[i].forEach(n => {
          if (n.y >= startT && n.y < endT) {
            if (!tickMap.has(n.y)) tickMap.set(n.y, []);
            tickMap.get(n.y).push(4 + i);      // indices 4-5 = FX lanes
          }
        });
      }

      // Simultaneity score
      let simScore = 0;
      tickMap.forEach(lanes => { simScore += Math.max(0, lanes.length - 1); });

      // Top combos (hardest simultaneous moments)
      const combos = [];
      tickMap.forEach((lanes, tick) => { if (lanes.length >= 2) combos.push({ tick, lanes }); });
      combos.sort((a, b) => b.lanes.length - a.lanes.length);
      const topCombos = combos.slice(0, 12);

      // Stretch penalty: BT-A + BT-D coexist AND a moving laser is active in this measure
      const hasBtAD = chart.bt[0].some(n => n.y >= startT && n.y < endT) &&
                      chart.bt[3].some(n => n.y >= startT && n.y < endT);
      let stretchWithLaser = false;
      if (hasBtAD) {
        outer: for (let s = 0; s < 2; s++) {
          for (const sec of chart.lasers[s]) {
            let segStart = sec.y;
            for (let pi = 0; pi < sec.points.length - 1; pi++) {
              const p0 = sec.points[pi];
              const segEnd = segStart + p0.ry;
              if (p0.v !== sec.points[pi + 1].v && segEnd > startT && segStart < endT) {
                stretchWithLaser = true;
                break outer;
              }
              segStart = segEnd;
            }
          }
        }
      }
      const stretch = stretchWithLaser ? 10 : 0;

      const noteCount = laneCount.slice(0, 4).reduce((a, b) => a + b, 0);
      const total     = simScore + noteCount + stretch;

      // Tags
      const tags = [];
      if (stretch > 0) tags.push({ label: 'STRETCH',    color: '#ff4466' });
      if (simScore > noteCount * 0.5 && simScore > 2) tags.push({ label: 'CHORD',  color: '#ffaa22' });
      if (noteCount > 40) tags.push({ label: 'DENSE',   color: '#ff6644' });
      if ((laneCount[4] + laneCount[5]) > noteCount * 0.25 + 2) tags.push({ label: 'FX', color: '#bb44ff' });

      const lLoad = laneCount[0] + laneCount[1] + laneCount[4];
      const rLoad = laneCount[2] + laneCount[3] + laneCount[5];

      scores.push({ m, simScore, noteCount, stretch, total, laneCount, topCombos, tags, lLoad, rLoad });
    }

    scores.sort((a, b) => b.total - a.total);
    const displayed = topCount > 0
      ? scores.slice(0, topCount)
      : scores.filter(s => s.total > 0);

    const maxScore = displayed[0]?.total || 1;

    // Emit annotation overlays
    if (typeof addChartAnnotation === 'function') {
      displayed.slice(0, 5).forEach(s => {
        addChartAnnotation({
          tick: s.m * TICKS_PER_MEASURE,
          label: `M${s.m + 1} ${s.stretch > 0 ? 'STRETCH' : 'DENSITY'} (${s.total})`,
          severity: s.stretch > 0 || s.total > 20 ? 'error' : 'warn',
          source: 'hand-opt',
        });
      });
      if (typeof render === 'function') render();
    }

    // Build cards
    displayed.forEach(s => {
      const card = _buildHandCard(s, maxScore);
      card.addEventListener('mouseenter', e => _showHandPopup(popup, s, e));
      card.addEventListener('mousemove',  e => _positionHandPopup(popup, e));
      card.addEventListener('mouseleave', () => {
        popup.style.display = 'none';
        if (_hoPopupAnimTimer) { clearInterval(_hoPopupAnimTimer); _hoPopupAnimTimer = null; }
      });
      card.addEventListener('click', () => _goToMeasure(s.m));
      results.appendChild(card);
    });

    if (displayed.length === 0) {
      results.innerHTML = '<div class="tool-result-item">No notes found.</div>';
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   12. Keysound Mapper
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolKeysound(c) {
  const sec = _section('Keysound Mapper');
  c.appendChild(sec);

  if (!(typeof chart !== "undefined" && chart)) { sec.appendChild(_h('div', 'tool-result-item tool-result-err', 'No chart loaded')); return; }

  // Load existing mapping
  if (!chart.meta.keysounds) chart.meta.keysounds = {};

  // Collect all chip notes
  const chips = [];
  for (let i = 0; i < 4; i++) {
    chart.bt[i].filter(n => n.len === 0).forEach(n => chips.push({ lane: 'BT-'+['A','B','C','D'][i], tick: n.y, key: `bt${i}_${n.y}` }));
  }
  for (let i = 0; i < 2; i++) {
    chart.fx[i].filter(n => n.len === 0).forEach(n => chips.push({ lane: 'FX-'+['L','R'][i], tick: n.y, key: `fx${i}_${n.y}` }));
  }
  chips.sort((a, b) => a.tick - b.tick);

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px';
  table.innerHTML = '<thead><tr><th>Measure</th><th>Lane</th><th>File path</th></tr></thead>';
  const tbody = document.createElement('tbody');
  const inputsMap = {};

  const MAX_ROWS = 80;
  chips.slice(0, MAX_ROWS).forEach(chip => {
    const m = Math.floor(chip.tick / TICKS_PER_MEASURE) + 1;
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #1a1a2e';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.style.width = '130px'; inp.value = chart.meta.keysounds[chip.key] || '';
    inputsMap[chip.key] = inp;
    [m, chip.lane, inp].forEach(v => {
      const td = document.createElement('td'); td.style.padding = '2px 4px';
      if (typeof v === 'string' || typeof v === 'number') td.textContent = v;
      else td.appendChild(v);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const wrap = _h('div'); wrap.style.cssText = 'max-height:180px;overflow-y:auto';
  wrap.appendChild(table);
  if (chips.length > MAX_ROWS) {
    wrap.appendChild(_h('div', 'tool-result-item tool-result-warn', `Showing ${MAX_ROWS}/${chips.length} chips`));
  }
  sec.appendChild(wrap);

  const saveBtn = _btn('Save Mapping');
  saveBtn.addEventListener('click', () => {
    Object.keys(inputsMap).forEach(k => {
      if (inputsMap[k].value) chart.meta.keysounds[k] = inputsMap[k].value;
      else delete chart.meta.keysounds[k];
    });
    sec.appendChild(_h('div', 'tool-result-item tool-result-ok', '✓ Mapping saved'));
  });

  const exportBtn = _btn('Export JSON');
  exportBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(chart.meta.keysounds, null, 2));
    sec.appendChild(_h('div', 'tool-result-item tool-result-ok', '✓ JSON copied to clipboard'));
  });

  const btnRow = _h('div', 'tool-row');
  btnRow.appendChild(saveBtn); btnRow.appendChild(exportBtn);
  sec.appendChild(btnRow);
}

/* ═══════════════════════════════════════════════════════════════════════════
   13. Scale Suggester
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolScale(c) {
  const sec = _section('Scale Suggester');
  c.appendChild(sec);

  const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const SCALES = {
    'Major':      [0,2,4,5,7,9,11],
    'Minor':      [0,2,3,5,7,8,10],
    'Pentatonic': [0,2,4,7,9],
    'Blues':      [0,3,5,6,7,10],
    'Dorian':     [0,2,3,5,7,9,10],
  };

  const keySel = document.createElement('select');
  KEYS.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k; keySel.appendChild(o); });
  const scaleSel = document.createElement('select');
  Object.keys(SCALES).forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; scaleSel.appendChild(o); });

  // Mini piano
  const pianoCanvas = document.createElement('canvas');
  pianoCanvas.width = 350; pianoCanvas.height = 60;
  pianoCanvas.style.cssText = 'width:100%;height:60px;display:block;margin:8px 0;border-radius:4px';

  function drawPiano() {
    const rootIdx = KEYS.indexOf(keySel.value);
    const intervals = SCALES[scaleSel.value];
    const scaleNotes = new Set(intervals.map(i => (rootIdx + i) % 12));
    const ctx = pianoCanvas.getContext('2d');
    ctx.clearRect(0, 0, pianoCanvas.width, pianoCanvas.height);
    // Draw 2 octaves (24 notes = 14 white keys)
    const whites = [0,2,4,5,7,9,11, 12,14,16,17,19,21,23];
    const wW = pianoCanvas.width / whites.length;
    whites.forEach((semitone, wi) => {
      const noteIdx = semitone % 12;
      const inScale = scaleNotes.has(noteIdx);
      ctx.fillStyle = inScale ? '#00cfff' : '#ffffff';
      ctx.fillRect(wi * wW + 0.5, 0, wW - 1, pianoCanvas.height);
      ctx.strokeStyle = '#333';
      ctx.strokeRect(wi * wW + 0.5, 0, wW - 1, pianoCanvas.height);
    });
    // Black keys
    const blackMap = [1,3,null,6,8,10,null, 13,15,null,18,20,22,null];
    blackMap.forEach((semitone, wi) => {
      if (semitone === null) return;
      const noteIdx = semitone % 12;
      const inScale = scaleNotes.has(noteIdx);
      ctx.fillStyle = inScale ? '#0088cc' : '#222';
      ctx.fillRect((wi + 0.65) * wW, 0, wW * 0.6, pianoCanvas.height * 0.6);
    });
  }

  keySel.addEventListener('change', drawPiano);
  scaleSel.addEventListener('change', drawPiano);

  // Patterns
  const PATTERNS = {
    'Ascending Run':   [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    'Descending Run':  [[0,0,0,1],[0,0,1,0],[0,1,0,0],[1,0,0,0]],
    'Alternating':     [[1,0,1,0],[0,1,0,1],[1,0,1,0],[0,1,0,1]],
    'Stream':          [[1,1,0,0],[0,0,1,1],[1,1,0,0],[0,0,1,1]],
  };

  const patternsDiv = _h('div');
  patternsDiv.style.marginTop = '8px';
  Object.entries(PATTERNS).forEach(([name, grid]) => {
    const btn = document.createElement('button');
    btn.className = 'tp-pattern-btn';
    btn.title = 'Insert at play head';
    // Preview dots
    const preview = document.createElement('canvas');
    preview.width = 60; preview.height = 20;
    const pctx = preview.getContext('2d');
    grid.forEach((row, ri) => {
      row.forEach((v, ci) => {
        if (v) { pctx.fillStyle = '#00cfff'; pctx.fillRect(ci*15+1, ri*5+1, 12, 3); }
        else    { pctx.fillStyle = '#2a2a44'; pctx.fillRect(ci*15+1, ri*5+1, 12, 3); }
      });
    });
    btn.appendChild(preview);
    const lbl = document.createElement('span'); lbl.textContent = ' ' + name;
    btn.appendChild(lbl);
    btn.addEventListener('click', () => {
      if (!(typeof chart !== "undefined" && chart) || !renderer) return;
      if (typeof saveUndo === 'function') saveUndo('Insert Pattern: ' + name);
      const startTick = renderer.playTick || 0;
      grid.forEach((row, ri) => {
        row.forEach((hasNote, ci) => {
          if (hasNote) {
            const tick = startTick + ri * 12; // 1/16 note steps
            chart.bt[ci].push({ y: tick, len: 0 });
          }
        });
      });
      for (let i = 0; i < 4; i++) chart.bt[i].sort((a,b) => a.y - b.y);
      if (typeof render === 'function') render();
    });
    patternsDiv.appendChild(btn);
  });

  sec.appendChild(_row('Key:', keySel));
  sec.appendChild(_row('Scale:', scaleSel));
  sec.appendChild(pianoCanvas);
  sec.appendChild(patternsDiv);
  setTimeout(drawPiano, 50);
}

/* ═══════════════════════════════════════════════════════════════════════════
   14. Hold Note Editor
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolHoldRender(c) {
  const sec = _section('Hold Note Editor');
  c.appendChild(sec);

  const QUICK_LENS = [
    { label: '1/16', ticks: 12 },
    { label: '1/8',  ticks: 24 },
    { label: '1/4',  ticks: 48 },
    { label: '1/2',  ticks: 96 },
    { label: '1M',   ticks: 192 },
  ];

  function buildTable() {
    sec.querySelectorAll('table,.tool-result-item').forEach(el => el.remove());
    if (!(typeof chart !== "undefined" && chart)) return;

    const holds = [];
    for (let i = 0; i < 4; i++) {
      chart.bt[i].filter(n => n.len > 0).forEach(n => holds.push({ arr: chart.bt[i], n, lane: 'BT-'+['A','B','C','D'][i] }));
    }
    for (let i = 0; i < 2; i++) {
      chart.fx[i].filter(n => n.len > 0).forEach(n => holds.push({ arr: chart.fx[i], n, lane: 'FX-'+['L','R'][i] }));
    }
    holds.sort((a,b) => a.n.y - b.n.y);

    if (holds.length === 0) { sec.appendChild(_h('div', 'tool-result-item', 'No hold notes found.')); return; }

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px';
    table.innerHTML = '<thead><tr><th>M</th><th>Lane</th><th>Len</th><th>Quick-set</th></tr></thead>';
    const tbody = document.createElement('tbody');

    holds.slice(0, 100).forEach(({ arr, n, lane }) => {
      const m = Math.floor(n.y / TICKS_PER_MEASURE) + 1;
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #1a1a2e';
      const tdM = document.createElement('td'); tdM.textContent = m; tdM.style.padding = '2px 4px';
      const tdL = document.createElement('td'); tdL.textContent = lane; tdL.style.padding = '2px 4px';
      const tdLen = document.createElement('td'); tdLen.textContent = n.len; tdLen.style.padding = '2px 4px'; tdLen.style.color = '#00cfff';
      const tdQ = document.createElement('td'); tdQ.style.padding = '2px 2px';

      QUICK_LENS.forEach(ql => {
        const b = document.createElement('button');
        b.textContent = ql.label;
        b.style.cssText = 'font-size:9px;padding:1px 4px;margin:1px;background:#13131f;border:1px solid #2a2a44;color:#d8d8f0;cursor:pointer;border-radius:3px';
        b.addEventListener('click', () => {
          if (typeof saveUndo === 'function') saveUndo('Hold Length');
          n.len = ql.ticks;
          tdLen.textContent = n.len;
          if (typeof render === 'function') render();
        });
        tdQ.appendChild(b);
      });

      tr.appendChild(tdM); tr.appendChild(tdL); tr.appendChild(tdLen); tr.appendChild(tdQ);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    const wrap = _h('div'); wrap.style.cssText = 'max-height:220px;overflow-y:auto';
    wrap.appendChild(table);
    sec.appendChild(wrap);
    if (holds.length > 100) sec.appendChild(_h('div', 'tool-result-item tool-result-warn', `Showing 100/${holds.length}`));
  }

  const refreshBtn = _btn('Refresh List');
  refreshBtn.addEventListener('click', buildTable);
  sec.appendChild(refreshBtn);
  buildTable();
}

/* ═══════════════════════════════════════════════════════════════════════════
   15. Timing Window Visualizer
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolTimingWindow(c) {
  const _ch = () => { try { return typeof chart !== 'undefined' ? chart : null; } catch(_e){return null;} };
  const _rnd = () => { try { return typeof renderer !== 'undefined' ? renderer : null; } catch(_e){return null;} };

  // ── Preset definitions ──────────────────────────────────────────────────
  const PRESETS = {
    'sdvx3': { label:'SDVX III/IV',          sCrit:null, crit:83,  near:150 },
    'sdvx5': { label:'SDVX V/VI',            sCrit:34,   crit:83,  near:150 },
    'sdvxeg':{ label:'SDVX EG (arcade)',      sCrit:34,   crit:67,  near:133 },
    'custom':{ label:'Custom',               sCrit:34,   crit:67,  near:133 },
  };

  // ── State ───────────────────────────────────────────────────────────────
  let curSCrit = _getTS('timing-window','sCritMs') || 34;
  let curCrit  = _getTS('timing-window','critMs')  || 67;
  let curNear  = _getTS('timing-window','nearMs')  || 133;

  // ── Section 1: Preset + Config ──────────────────────────────────────────
  const sec1 = _section('Version Preset & Windows');
  _subDesc(sec1, 'tool.subdesc.timing.preset');
  c.appendChild(sec1);

  const presetRow = _h('div','tool-row');
  const presetLabel = _h('label','','Version:');
  presetLabel.style.marginRight = '8px';
  const presetSel = document.createElement('select');
  presetSel.style.cssText = 'background:#1a1a2e;color:#c8c8e8;border:1px solid #3a3a5e;border-radius:4px;padding:3px 6px;font-size:12px;';
  Object.entries(PRESETS).forEach(([k,p]) => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = p.label;
    if (k === 'sdvxeg') opt.selected = true;
    presetSel.appendChild(opt);
  });
  presetRow.appendChild(presetLabel);
  presetRow.appendChild(presetSel);
  sec1.appendChild(presetRow);

  // Window inputs
  const inputsWrap = _h('div','');
  inputsWrap.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;';

  function makeWinInput(labelTxt, initVal) {
    const wrap = _h('div','');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:3px;';
    const lbl = _h('label','',labelTxt);
    lbl.style.cssText = 'font-size:11px;color:#9090b8;';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = initVal; inp.min = 10; inp.max = 500;
    inp.style.cssText = 'width:72px;background:#1a1a2e;color:#c8c8e8;border:1px solid #3a3a5e;border-radius:4px;padding:3px 6px;font-size:12px;';
    wrap.appendChild(lbl); wrap.appendChild(inp);
    return { wrap, inp };
  }

  const scUI = makeWinInput('S-CRITICAL (ms)', curSCrit);
  const crUI = makeWinInput('CRITICAL (ms)',   curCrit);
  const nrUI = makeWinInput('NEAR (ms)',        curNear);
  inputsWrap.appendChild(scUI.wrap);
  inputsWrap.appendChild(crUI.wrap);
  inputsWrap.appendChild(nrUI.wrap);
  sec1.appendChild(inputsWrap);

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    if (p.sCrit !== null) { scUI.inp.value = p.sCrit; curSCrit = p.sCrit; scUI.inp.disabled = (key !== 'custom'); }
    else { scUI.inp.value = 0; curSCrit = 0; scUI.inp.disabled = true; }
    crUI.inp.value = p.crit; curCrit = p.crit; crUI.inp.disabled = (key !== 'custom');
    nrUI.inp.value = p.near; curNear = p.near; nrUI.inp.disabled = (key !== 'custom');
    drawDiagram();
  }

  function readInputs() {
    curSCrit = parseInt(scUI.inp.value) || 0;
    curCrit  = parseInt(crUI.inp.value) || 67;
    curNear  = parseInt(nrUI.inp.value) || 133;
  }

  presetSel.addEventListener('change', () => applyPreset(presetSel.value));
  [scUI.inp, crUI.inp, nrUI.inp].forEach(inp => inp.addEventListener('input', () => {
    presetSel.value = 'custom';
    readInputs(); drawDiagram();
  }));

  // ── Section 2: Visual Diagram ───────────────────────────────────────────
  const sec2 = _section('Timing Diagram');
  _subDesc(sec2, 'tool.subdesc.timing.diagram');
  c.appendChild(sec2);

  const canvas = document.createElement('canvas');
  canvas.height = 100;
  canvas.style.cssText = 'width:100%;height:100px;display:block;border:1px solid #2a2a44;border-radius:4px;background:#0d0d14;margin-top:4px;';
  sec2.appendChild(canvas);

  function drawDiagram() {
    const W = canvas.clientWidth || 420;
    canvas.width = W;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    const CX = W / 2;
    const MAX_MS = 250;

    ctx.clearRect(0,0,W,H);

    // ERROR background
    ctx.fillStyle = '#1a0808';
    ctx.fillRect(0, 0, W, H);

    const zones = [];
    if (curNear > 0)  zones.push({ ms: curNear,  color: '#c83030', name: 'NEAR',       nameShort: 'NEAR' });
    if (curCrit > 0)  zones.push({ ms: curCrit,  color: '#e07000', name: 'CRITICAL',   nameShort: 'CRIT' });
    if (curSCrit > 0) zones.push({ ms: curSCrit, color: '#d4a800', name: 'S-CRITICAL', nameShort: 'S-CR' });

    zones.forEach(z => {
      const hw = Math.min(z.ms / MAX_MS, 1) * (W / 2);
      ctx.fillStyle = z.color + '55';
      ctx.fillRect(CX - hw, 8, hw * 2, H - 16);
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(CX - hw, 8, hw * 2, H - 16);
    });

    // Labels on left half
    ctx.textAlign = 'center';
    zones.forEach((z,i) => {
      const hw = Math.min(z.ms / MAX_MS, 1) * (W / 2);
      const prevHw = i > 0 ? Math.min(zones[i-1].ms / MAX_MS, 1) * (W / 2) : 0;
      const midX = CX - prevHw - (hw - prevHw) / 2;
      ctx.fillStyle = z.color;
      ctx.font = 'bold 10px monospace';
      ctx.fillText(z.nameShort, midX, H/2 - 4);
      ctx.font = '9px monospace';
      ctx.fillText('\xb1' + z.ms + 'ms', midX, H/2 + 8);
    });

    // Mirror labels right half
    zones.forEach((z,i) => {
      const hw = Math.min(z.ms / MAX_MS, 1) * (W / 2);
      const prevHw = i > 0 ? Math.min(zones[i-1].ms / MAX_MS, 1) * (W / 2) : 0;
      const midX = CX + prevHw + (hw - prevHw) / 2;
      ctx.fillStyle = z.color;
      ctx.font = 'bold 10px monospace';
      ctx.fillText(z.nameShort, midX, H/2 - 4);
      ctx.font = '9px monospace';
      ctx.fillText('\xb1' + z.ms + 'ms', midX, H/2 + 8);
    });

    // ERROR labels
    ctx.fillStyle = '#ff3a3a88';
    ctx.font = '9px monospace';
    const nearHw = curNear > 0 ? Math.min(curNear / MAX_MS, 1) * (W / 2) : W / 2;
    if (nearHw < W/2 - 20) {
      ctx.fillText('ERR', CX - (W/2 + nearHw)/2, H/2 + 2);
      ctx.fillText('ERR', CX + (W/2 + nearHw)/2, H/2 + 2);
    }

    // Axis labels
    ctx.fillStyle = '#ffffff44';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left'; ctx.fillText('EARLY', 3, H - 3);
    ctx.textAlign = 'right'; ctx.fillText('LATE', W - 3, H - 3);

    // Center line
    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(CX, 4); ctx.lineTo(CX, H - 4); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '8px monospace';
    ctx.fillText('PERFECT', CX, H - 2);
  }

  // Responsive via ResizeObserver
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => drawDiagram());
    ro.observe(canvas);
  }

  // ── Analyze button ──────────────────────────────────────────────────────
  const analyzeBtn = _btn('▶ Analyze Chart');
  analyzeBtn.style.margin = '10px 0 4px 0';
  c.appendChild(analyzeBtn);

  const analysisWrap = _h('div','');
  c.appendChild(analysisWrap);

  analyzeBtn.addEventListener('click', () => {
    readInputs();
    drawDiagram();
    analysisWrap.innerHTML = '';
    const ch = _ch();
    if (!ch) {
      analysisWrap.appendChild(_h('div','tool-result-item tool-result-warn','No chart loaded.'));
      return;
    }
    runAnalysis(ch);
  });

  // ── Section 3: BPM x Window Table ──────────────────────────────────────
  function buildBpmTable(ch) {
    const sec = _section('BPM × Timing Windows');
    _subDesc(sec, 'tool.subdesc.timing.bpmtable');
    analysisWrap.appendChild(sec);

    const bpmEvents = (ch.bpmEvents || []).slice(0, 10);
    if (!bpmEvents.length) { sec.appendChild(_h('div','tool-result-item','No BPM events.')); return; }

    const tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;color:#c8c8e8;';
    const hdr = tbl.insertRow();
    ['BPM','ms/tick','S-CR ticks','CR ticks','NEAR ticks','NEAR % beat'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.cssText = 'text-align:left;padding:3px 5px;border-bottom:1px solid #2a2a44;color:#9090b8;';
      hdr.appendChild(th);
    });

    bpmEvents.forEach(ev => {
      const bpm = ev.bpm;
      const msPerTick = (60000 / bpm) / TICKS_PER_BEAT;
      const msBeat = 60000 / bpm;
      const scTicks = curSCrit > 0 ? (curSCrit / msPerTick).toFixed(1) : '--';
      const crTicks = (curCrit / msPerTick).toFixed(1);
      const nrTicks = (curNear / msPerTick).toFixed(1);
      const nrPct   = ((curNear / msBeat) * 100).toFixed(1);
      const row = tbl.insertRow();
      [bpm.toFixed(2), msPerTick.toFixed(3), '\xb1' + scTicks, '\xb1' + crTicks, '\xb1' + nrTicks, nrPct + '%'].forEach(v => {
        const td = row.insertCell();
        td.textContent = v;
        td.style.cssText = 'padding:3px 5px;border-bottom:1px solid #1a1a2e;';
      });
    });

    sec.appendChild(tbl);
  }

  // ── Section 4: Note Gap Analysis ────────────────────────────────────────
  function buildGapAnalysis(ch) {
    const sec = _section('Note Gap Analysis');
    _subDesc(sec, 'tool.subdesc.timing.gaps');
    analysisWrap.appendChild(sec);

    // Build BPM lookup: tick -> bpm
    const bpmEvents = (ch.bpmEvents || []).sort((a,b) => a.y - b.y);
    function bpmAtTick(tick) {
      let bpm = bpmEvents.length ? bpmEvents[0].bpm : 180;
      for (let i = 0; i < bpmEvents.length; i++) {
        if (bpmEvents[i].y <= tick) bpm = bpmEvents[i].bpm;
        else break;
      }
      return bpm;
    }
    function ticksToMs(ticks, tick) {
      return ticks * (60000 / bpmAtTick(tick)) / TICKS_PER_BEAT;
    }

    const gaps = [];
    // BT lanes 0-3, FX lanes 0-1
    const laneGroups = [
      { name:'BT', lanes: ch.bt || [] },
      { name:'FX', lanes: ch.fx || [] },
    ];

    laneGroups.forEach(group => {
      group.lanes.forEach((lane, li) => {
        const chips = lane.filter(n => n.len === 0);
        const sorted = chips.slice().sort((a,b) => a.y - b.y);
        for (let i = 1; i < sorted.length; i++) {
          const tickA = sorted[i-1].y;
          const tickB = sorted[i].y;
          const diffTicks = tickB - tickA;
          if (diffTicks <= 0) continue;
          const diffMs = ticksToMs(diffTicks, tickA);
          const mNum = Math.floor(tickA / TICKS_PER_MEASURE) + 1;
          gaps.push({ diffTicks, diffMs, lane: group.name + '-' + (group.name === 'BT' ? String.fromCharCode(65+li) : (li+1)), measure: mNum });
        }
      });
    });

    gaps.sort((a,b) => a.diffMs - b.diffMs);

    let dangerCount = 0;
    gaps.forEach(g => { if (g.diffMs < curNear * 2) dangerCount++; });

    const box = _h('div','tool-result-box');
    box.style.maxHeight = '160px'; box.style.overflowY = 'auto';

    if (!gaps.length) {
      box.appendChild(_h('div','tool-result-item','No chip gaps found.'));
    } else {
      const top5 = gaps.slice(0,5);
      top5.forEach(g => {
        const status = g.diffMs < curNear * 2 ? 'DANGER' : (g.diffMs < curNear * 3 ? 'OK' : 'SAFE');
        const color  = status === 'DANGER' ? '#ff3a3a' : (status === 'OK' ? '#f0a030' : '#40c880');
        const item = _h('div','tool-result-item',
          'Fastest gap [' + g.lane + '] at M' + g.measure + ': ' + g.diffTicks + ' ticks = ' + g.diffMs.toFixed(1) + 'ms — ');
        const badge = _h('span','', status);
        badge.style.cssText = 'color:' + color + ';font-weight:bold;';
        item.appendChild(badge);
        box.appendChild(item);
      });
      box.appendChild(_h('div','tool-result-item','Danger-zone gaps (< NEAR×2): ' + dangerCount));
    }
    sec.appendChild(box);

    // Chord count (same-tick cross-lane)
    const allChipsByTick = {};
    laneGroups.forEach(group => {
      group.lanes.forEach((lane, li) => {
        const chips = lane.filter(n => n.len === 0);
        chips.forEach(n => {
          const t = n.y;
          (allChipsByTick[t] = allChipsByTick[t] || []).push(group.name + li);
        });
      });
    });
    let chordCount = 0;
    Object.values(allChipsByTick).forEach(arr => { if (arr.length >= 2) chordCount++; });
    sec.appendChild(_h('div','tool-result-item','Chord ticks (2+ simultaneous chips): ' + chordCount));
  }

  // ── Section 5: Score Potential ──────────────────────────────────────────
  function buildScorePotential(ch) {
    const sec = _section('Score Potential Calculator');
    _subDesc(sec, 'tool.subdesc.timing.score');
    analysisWrap.appendChild(sec);

    let total = 0;
    (ch.bt || []).forEach(lane => { total += lane.length; });
    (ch.fx || []).forEach(lane => { total += lane.length; });
    // Laser sections
    (ch.lasers || []).forEach(side => { total += (side || []).length; });

    if (total === 0) { sec.appendChild(_h('div','tool-result-item','No notes found.')); return; }

    const perNote = 10000000 / (2 * total);
    const allSCrit = 10000000;
    const allCrit  = Math.round(perNote * total);  // each note gets 1x instead of 2x = 50%

    // To get 9,900,000: need X S-CRIT, rest CRIT
    // 2X*perNote + (total-X)*perNote = 9900000 => perNote*(X+total) = 9900000 => X = 9900000/perNote - total
    const xAAA  = Math.ceil(9900000 / perNote - total);
    const xAAAp = Math.ceil(9950000 / perNote - total);

    const tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;color:#c8c8e8;margin-top:4px;';
    const hdrR = tbl.insertRow();
    ['Grade','Score','Condition'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.cssText = 'text-align:left;padding:3px 5px;border-bottom:1px solid #2a2a44;color:#9090b8;';
      hdrR.appendChild(th);
    });
    [
      ['S',    '10,000,000', 'All S-CRITICAL'],
      ['AAA+', '9,950,000',  xAAAp > 0 ? (xAAAp + '/' + total + ' S-CRIT') : 'Unreachable'],
      ['AAA',  '9,900,000',  xAAA  > 0 ? (xAAA  + '/' + total + ' S-CRIT') : 'Unreachable'],
      ['All CRIT', allCrit.toLocaleString(), 'All CRITICAL (no S-CRIT)'],
    ].forEach(([grade, score, cond]) => {
      const row = tbl.insertRow();
      [grade, score, cond].forEach((v,i) => {
        const td = row.insertCell();
        td.textContent = v;
        td.style.cssText = 'padding:3px 5px;border-bottom:1px solid #1a1a2e;' + (i===0 ? 'font-weight:bold;color:#d4a800;' : '');
      });
    });
    sec.appendChild(_h('div','tool-result-item','Total notes: ' + total + ' | Score per note (S-CR): ' + perNote.toFixed(1)));
    sec.appendChild(tbl);
  }

  // ── Section 6: Fastest Measure Finder ──────────────────────────────────
  function buildFastestMeasures(ch) {
    const sec = _section('Fastest Measure Finder');
    _subDesc(sec, 'tool.subdesc.timing.fastest');
    analysisWrap.appendChild(sec);

    const bpmEvents = (ch.bpmEvents || []).sort((a,b) => a.y - b.y);
    function bpmAtTick(tick) {
      let bpm = bpmEvents.length ? bpmEvents[0].bpm : 180;
      for (let i = 0; i < bpmEvents.length; i++) {
        if (bpmEvents[i].y <= tick) bpm = bpmEvents[i].bpm;
        else break;
      }
      return bpm;
    }

    const measureChips = {};
    const laneGroups = [
      { lanes: ch.bt || [] },
      { lanes: ch.fx || [] },
    ];
    laneGroups.forEach(group => {
      group.lanes.forEach(lane => {
        lane.filter(n => n.len === 0).forEach(n => {
          const t = n.y;
          const m = Math.floor(t / TICKS_PER_MEASURE);
          measureChips[m] = (measureChips[m] || 0) + 1;
        });
      });
    });

    const sorted = Object.entries(measureChips)
      .map(([m, cnt]) => ({ m: parseInt(m), cnt }))
      .sort((a,b) => b.cnt - a.cnt)
      .slice(0, 5);

    const box = _h('div','tool-result-box');
    if (!sorted.length) {
      box.appendChild(_h('div','tool-result-item','No chip notes found.'));
    } else {
      sorted.forEach(({ m, cnt }) => {
        const bpm = bpmAtTick(m * TICKS_PER_MEASURE);
        const chipsPerBeat = (cnt / BEATS_PER_MEASURE).toFixed(2);
        const beatsBetween = cnt > 0 ? (BEATS_PER_MEASURE / cnt).toFixed(2) : '--';
        const item = _h('div','tool-result-item',
          'M' + (m+1) + ': ' + cnt + ' chips = ' + chipsPerBeat + ' chips/beat (BPM ' + bpm.toFixed(0) + ' → ' + beatsBetween + ' beats between hits) ');
        const link = document.createElement('a');
        link.href = '#'; link.textContent = '[Jump]';
        link.style.cssText = 'color:#7070e0;text-decoration:none;font-size:10px;';
        link.addEventListener('click', ev => {
          ev.preventDefault();
          const rnd = _rnd();
          if (rnd && rnd.playTick !== undefined) {
            rnd.playTick = m * TICKS_PER_MEASURE;
            if (typeof render === 'function') render();
          }
        });
        item.appendChild(link);
        box.appendChild(item);
      });
    }
    sec.appendChild(box);
  }

  // ── Section 7: Simultaneous Input Complexity ────────────────────────────
  function buildChordComplexity(ch) {
    const sec = _section('Simultaneous Input Complexity');
    _subDesc(sec, 'tool.subdesc.timing.chords');
    analysisWrap.appendChild(sec);

    const bpmEvents = (ch.bpmEvents || []).sort((a,b) => a.y - b.y);
    function bpmAtTick(tick) {
      let bpm = bpmEvents.length ? bpmEvents[0].bpm : 180;
      for (let i = 0; i < bpmEvents.length; i++) {
        if (bpmEvents[i].y <= tick) bpm = bpmEvents[i].bpm;
        else break;
      }
      return bpm;
    }

    const tickMap = {};
    const btLanes = ch.bt || [];
    const fxLanes = ch.fx || [];

    btLanes.forEach((lane, li) => {
      lane.filter(n => n.len === 0).forEach(n => {
        const entry = tickMap[n.y] = tickMap[n.y] || { bt: [], fx: [] };
        entry.bt.push(li);
      });
    });
    fxLanes.forEach((lane, li) => {
      lane.filter(n => n.len === 0).forEach(n => {
        const entry = tickMap[n.y] = tickMap[n.y] || { bt: [], fx: [] };
        entry.fx.push(li);
      });
    });

    const dist = { 1:0, 2:0, 3:0, 4:0 };
    let btFxTicks = 0;
    let hardestTick = null, hardestCount = 0, hardestBpm = 180;

    Object.entries(tickMap).forEach(([t, entry]) => {
      const total = entry.bt.length + entry.fx.length;
      if (total <= 0) return;
      const key = Math.min(total, 4);
      dist[key] = (dist[key] || 0) + 1;
      if (entry.bt.length > 0 && entry.fx.length > 0) btFxTicks++;
      if (total > hardestCount) {
        hardestCount = total;
        hardestTick = parseInt(t);
        hardestBpm = bpmAtTick(hardestTick);
      }
    });

    const box = _h('div','tool-result-box');
    const singleCount  = Object.values(tickMap).filter(e => e.bt.length + e.fx.length === 1).length;
    const multiCount   = Object.values(tickMap).filter(e => e.bt.length + e.fx.length >= 2).length;
    box.appendChild(_h('div','tool-result-item','1-note ticks: ' + singleCount));
    box.appendChild(_h('div','tool-result-item','2-note chords: ' + (dist[2] || 0)));
    box.appendChild(_h('div','tool-result-item','3-note chords: ' + (dist[3] || 0)));
    box.appendChild(_h('div','tool-result-item','4-note chords (full BT): ' + (dist[4] || 0)));
    box.appendChild(_h('div','tool-result-item','BT+FX simultaneous ticks: ' + btFxTicks));
    if (hardestTick !== null) {
      const mNum = Math.floor(hardestTick / TICKS_PER_MEASURE) + 1;
      box.appendChild(_h('div','tool-result-item tool-result-warn',
        'Hardest chord at M' + mNum + ' — ' + hardestCount + ' buttons at BPM ' + hardestBpm.toFixed(0)));
    }
    sec.appendChild(box);
  }

  // ── Section 8: Chart Snapshots at key moments ───────────────────────────
  function buildChartSnapshots(ch) {
    const sec = _section('Chart Snapshots');
    _subDesc(sec, 'tool.subdesc.timing.snapshots');
    analysisWrap.appendChild(sec);

    const r = _rnd();
    if (!r) {
      sec.appendChild(_h('div','tool-result-item tool-result-warn','Renderer not available.'));
      return;
    }

    // Find top-5 densest measures (BT+FX chips)
    const measureChips = {};
    [...(ch.bt || []), ...(ch.fx || [])].forEach(lane => {
      lane.filter(n => n.len === 0).forEach(n => {
        const m = Math.floor(n.y / TICKS_PER_MEASURE);
        measureChips[m] = (measureChips[m] || 0) + 1;
      });
    });
    const allMeasures = Object.entries(measureChips)
      .map(([m, cnt]) => ({ m: parseInt(m), cnt }))
      .sort((a, b) => b.cnt - a.cnt);
    const topDense = allMeasures.slice(0, 3);
    const quietest = allMeasures.slice(-1);

    // Find measure with most laser activity
    const measureLaser = {};
    (ch.lasers || []).forEach(side => {
      (side || []).forEach(seg => {
        const m = Math.floor(seg.y / TICKS_PER_MEASURE);
        measureLaser[m] = (measureLaser[m] || 0) + (seg.points?.length ?? 0);
      });
    });
    const topLaser = Object.entries(measureLaser)
      .map(([m, v]) => ({ m: parseInt(m), v }))
      .sort((a,b) => b.v - a.v)
      .slice(0, 1);

    // Cards to render: dense1, dense2, dense3, laser1, quietest
    const cards = [
      ...topDense.map((d, i) => ({ m: d.m, label: i === 0 ? 'Densest' : `Dense #${i+1}`, color: '#ff8844', sub: `${d.cnt} chips` })),
      ...topLaser.map(d    => ({ m: d.m, label: 'Most VOL',  color: '#4477ff', sub: `${d.v} pts` })),
      ...quietest.map(d    => ({ m: d.m, label: 'Quietest',  color: '#44aaff', sub: `${d.cnt} chips` })),
    ];

    if (!cards.length) {
      sec.appendChild(_h('div','tool-result-item','No notes to snapshot.'));
      return;
    }

    const cardRow = document.createElement('div');
    cardRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:4px';

    cards.forEach(({ m, label, color, sub }) => {
      const card = document.createElement('div');
      card.style.cssText =
        `flex:1;min-width:130px;max-width:200px;background:#0c0c20;border:1px solid ${color}55;` +
        `border-radius:7px;padding:5px 6px;cursor:pointer;overflow:hidden;display:flex;flex-direction:column;gap:3px`;
      card.title = `Click to jump to M${m + 1}`;

      const hdr = document.createElement('div');
      hdr.style.cssText =
        `font-size:9px;font-weight:bold;color:${color};display:flex;justify-content:space-between`;
      hdr.innerHTML = `<span>${label}</span><span style="color:#556">M${m+1}</span>`;
      card.appendChild(hdr);

      const sub2 = document.createElement('div');
      sub2.style.cssText = 'font-size:8px;color:#445;margin-bottom:2px';
      sub2.textContent = sub;
      card.appendChild(sub2);

      // Offscreen render — 1 measure at 1.5 px/tick
      const ZOOM = 1.5;
      const snapH = Math.round(TICKS_PER_MEASURE * ZOOM);
      const offC = document.createElement('canvas');
      try {
        const sr = new Renderer(offC);
        sr.chart = ch; sr.numCols = 1; sr.measPerCol = 1;
        sr.scrollCol = m; sr.zoom = ZOOM;
        offC.width = 225; offC.height = snapH;
        sr.draw();
        const img = document.createElement('img');
        img.src = offC.toDataURL('image/png');
        img.style.cssText =
          'width:100%;display:block;border-radius:3px;image-rendering:pixelated;' +
          `border:1px solid ${color}33;max-height:200px;object-fit:cover;object-position:top`;
        card.appendChild(img);
      } catch(e) { card.appendChild(_h('div','','Preview unavailable')); }

      card.addEventListener('click', () => {
        const rr = _rnd(); if (!rr) return;
        const tick = m * TICKS_PER_MEASURE;
        rr.scrollCol = Math.max(0, Math.min(rr.totalCols()-1, Math.floor(m / rr.measPerCol)));
        rr.playTick  = tick;
        if (typeof updateSeekbar === 'function') updateSeekbar(tick);
        if (typeof render       === 'function') render();
        requestAnimationFrame(() => {
          const cw = document.getElementById('canvas-wrap');
          const pos = rr.tickToCanvas(tick);
          if (cw && pos) cw.scrollTop = Math.max(0, pos.cy - cw.clientHeight * 0.5);
        });
      });

      cardRow.appendChild(card);
    });

    sec.appendChild(cardRow);
  }

  // ── Main analysis runner ────────────────────────────────────────────────
  function runAnalysis(ch) {
    buildBpmTable(ch);
    buildGapAnalysis(ch);
    buildScorePotential(ch);
    buildFastestMeasures(ch);
    buildChordComplexity(ch);
    buildChartSnapshots(ch);
  }

  // ── Initial render ──────────────────────────────────────────────────────
  applyPreset('sdvxeg');
}

/* ═══════════════════════════════════════════════════════════════════════════
   16. Symmetry Checker
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolSymmetry(c) {
  const sec = _section('Symmetry Checker');
  c.appendChild(sec);

  const results = _h('div', 'tool-result-box');
  results.style.maxHeight = '180px'; results.style.overflowY = 'auto';

  const checkBtn = _btn('Check Symmetry');
  checkBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== "undefined" && chart)) return;
    const lSecs = chart.lasers[0], rSecs = chart.lasers[1];
    let symCount = 0, asymCount = 0;

    lSecs.forEach(ls => {
      const lEnd = ls.y + ls.points[ls.points.length-1].ry;
      // Find overlapping R sections
      rSecs.forEach(rs => {
        const rEnd = rs.y + rs.points[rs.points.length-1].ry;
        if (rs.y > lEnd || ls.y > rEnd) return; // no overlap
        // Compare point pairs by relative position
        let isSym = true;
        const lPts = ls.points, rPts = rs.points;
        if (lPts.length !== rPts.length) { isSym = false; }
        else {
          for (let i = 0; i < lPts.length; i++) {
            const mirror = 1 - rPts[i].v;
            if (Math.abs(lPts[i].v - mirror) > 0.05) { isSym = false; break; }
          }
        }
        const m = Math.floor(ls.y / TICKS_PER_MEASURE) + 1;
        if (isSym) {
          symCount++;
          results.appendChild(_h('div', 'tool-result-item tool-result-ok', `✓ Symmetric pair at M${m}`));
        } else {
          asymCount++;
          results.appendChild(_h('div', 'tool-result-item tool-result-warn', `≠ Asymmetric at M${m}`));
        }
      });
    });

    const total = symCount + asymCount;
    const pct = total > 0 ? Math.round(100 * symCount / total) : 0;
    results.insertBefore(_h('div', 'tool-result-item', `Symmetric: ${symCount}/${total} (${pct}%)`), results.firstChild);
  });

  const mirrorLtoR = _btn('Mirror L → R');
  mirrorLtoR.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    if (typeof saveUndo === 'function') saveUndo('Mirror L to R');
    chart.lasers[1] = chart.lasers[0].map(ls => ({
      y: ls.y, wide: ls.wide,
      points: ls.points.map(p => ({ ...p, v: 1 - p.v }))
    }));
    if (typeof render === 'function') render();
    results.innerHTML = '<div class="tool-result-item tool-result-ok">✓ L mirrored to R</div>';
  });

  const mirrorRtoL = _btn('Mirror R → L');
  mirrorRtoL.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    if (typeof saveUndo === 'function') saveUndo('Mirror R to L');
    chart.lasers[0] = chart.lasers[1].map(rs => ({
      y: rs.y, wide: rs.wide,
      points: rs.points.map(p => ({ ...p, v: 1 - p.v }))
    }));
    if (typeof render === 'function') render();
    results.innerHTML = '<div class="tool-result-item tool-result-ok">✓ R mirrored to L</div>';
  });

  const btnRow = _h('div', 'tool-row');
  btnRow.appendChild(mirrorLtoR); btnRow.appendChild(mirrorRtoL);
  sec.appendChild(checkBtn);
  sec.appendChild(results);
  sec.appendChild(btnRow);
}

/* ═══════════════════════════════════════════════════════════════════════════
   17. Pattern Library
   ═══════════════════════════════════════════════════════════════════════════ */
const PATTERN_LIB_KEY = 'vibe_editr_patterns';

function _toolPatternLib(c) {
  const sec = _section('Pattern Library');
  c.appendChild(sec);

  const listEl = _h('div', 'tool-result-box');
  listEl.style.maxHeight = '200px'; listEl.style.overflowY = 'auto';

  function getPatterns() {
    try { return JSON.parse(localStorage.getItem(PATTERN_LIB_KEY) || '[]'); } catch { return []; }
  }
  function savePatterns(pats) {
    localStorage.setItem(PATTERN_LIB_KEY, JSON.stringify(pats));
  }

  function renderList() {
    listEl.innerHTML = '';
    const pats = getPatterns();
    if (pats.length === 0) { listEl.innerHTML = '<div class="tool-result-item">No saved patterns.</div>'; return; }
    pats.forEach((pat, i) => {
      const row = _h('div', 'tool-result-item');
      row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '6px';
      // Mini dot preview
      const preview = document.createElement('canvas');
      preview.width = 32; preview.height = 16;
      const pctx = preview.getContext('2d');
      const spanTicks = pat.spanTicks || 192;
      if (pat.btNotes) {
        pat.btNotes.forEach((arr, li) => {
          arr.forEach(n => {
            const x = Math.floor((n.y / spanTicks) * 30);
            const y = li * 4;
            pctx.fillStyle = '#00cfff';
            pctx.fillRect(x, y, 2, 3);
          });
        });
      }
      const nameSpan = _h('span', '', pat.name);
      nameSpan.style.flex = '1';
      const insBtn = document.createElement('button');
      insBtn.textContent = 'Insert'; insBtn.className = 'tool-btn-action'; insBtn.style.fontSize = '10px'; insBtn.style.padding = '2px 7px';
      insBtn.addEventListener('click', () => _insertPattern(pat));
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕'; delBtn.style.cssText = 'font-size:10px;padding:2px 5px;background:#2a0a0a;border:1px solid #882233;color:#ffaaaa;cursor:pointer;border-radius:3px';
      delBtn.addEventListener('click', () => {
        const pats2 = getPatterns(); pats2.splice(i, 1); savePatterns(pats2); renderList();
      });
      row.appendChild(preview); row.appendChild(nameSpan); row.appendChild(insBtn); row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  function _insertPattern(pat) {
    if (!(typeof chart !== "undefined" && chart) || !renderer) return;
    if (typeof saveUndo === 'function') saveUndo('Insert Pattern: ' + pat.name);
    const startTick = renderer.playTick || 0;
    if (pat.btNotes) {
      pat.btNotes.forEach((arr, li) => {
        arr.forEach(n => { chart.bt[li].push({ y: startTick + n.y, len: n.len }); });
        chart.bt[li].sort((a,b) => a.y - b.y);
      });
    }
    if (pat.fxNotes) {
      pat.fxNotes.forEach((arr, li) => {
        arr.forEach(n => { chart.fx[li].push({ y: startTick + n.y, len: n.len }); });
        chart.fx[li].sort((a,b) => a.y - b.y);
      });
    }
    if (typeof render === 'function') render();
  }

  const saveBtn = _btn('Save Current Selection');
  saveBtn.addEventListener('click', () => {
    if (!(typeof chart !== "undefined" && chart)) return;
    const name = prompt('Pattern name:');
    if (!name) return;
    // Capture from selection or full chart if no selection
    const hasSel = sel && sel.active;
    const startT = hasSel ? Math.min(sel.startTick, sel.endTick) : 0;
    const endT   = hasSel ? Math.max(sel.startTick, sel.endTick) : chart.totalMeasures * TICKS_PER_MEASURE;
    const spanTicks = endT - startT;
    const btNotes = chart.bt.map(arr => arr.filter(n => n.y >= startT && n.y < endT).map(n => ({ y: n.y - startT, len: n.len })));
    const fxNotes = chart.fx.map(arr => arr.filter(n => n.y >= startT && n.y < endT).map(n => ({ y: n.y - startT, len: n.len })));
    const pats = getPatterns();
    pats.push({ name, btNotes, fxNotes, spanTicks });
    savePatterns(pats);
    renderList();
  });

  sec.appendChild(saveBtn);
  sec.appendChild(listEl);
  renderList();
}

/* ═══════════════════════════════════════════════════════════════════════════
   19. Audio Event Anchoring
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolAudioAnchor(c) {
  const _ch  = () => chart;
  const _buf = () => audioBuffer;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:11px';

  const mkLabel = (t) => { const s = document.createElement('span'); s.style.cssText='color:#778;font-size:10px'; s.textContent=t; return s; };
  const mkSep   = () => { const d = document.createElement('div'); d.style.cssText='border-top:1px solid #1e1e3a;margin:6px 0'; return d; };
  const mkRow   = (...els) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:2px 0';
    els.forEach(e => d.appendChild(typeof e === 'string' ? mkLabel(e) : e));
    return d;
  };
  const mkBtn2 = (txt, color, fn) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = `background:#12122a;color:${color};border:1px solid ${color}55;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px`;
    b.addEventListener('click', fn);
    return b;
  };
  const mkChk = (label, checked, fn) => {
    const wrap2 = document.createElement('label');
    wrap2.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;font-size:10px;color:#aac';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=checked;
    cb.addEventListener('change', () => fn(cb.checked));
    wrap2.append(cb, label); return wrap2;
  };

  // ── Header ──────────────────────────────────────────────────────────────
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:10px;font-weight:bold;color:#ffaa55;letter-spacing:0.05em';
  hdr.textContent = 'Audio Event Anchoring';
  wrap.appendChild(hdr);

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:9px;color:#778;line-height:1.4';
  desc.textContent = 'Detects audio transients and lets you snap note placement to them or bulk-fill a lane at each hit.';
  wrap.appendChild(desc);
  wrap.appendChild(mkSep());

  // ── Status / detect ───────────────────────────────────────────────────────
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'font-size:10px;color:#778;padding:2px 0;min-height:14px';

  function refreshStatus() {
    const ticks = window._audioTransientTicks;
    if (!ticks || !ticks.length) {
      statusDiv.style.color = '#f87';
      statusDiv.textContent = '⚠ No transients — run Waveform Align → Decode first, or detect below.';
    } else {
      statusDiv.style.color = '#8f8';
      statusDiv.textContent = `✓ ${ticks.length} transients loaded (${(window._audioTransientsSec?.length??0)} sec → ticks).`;
    }
    refreshList();
  }

  // Local detect — runs its own computePeaks with adjustable threshold
  let localThreshold = 0.55;
  let localMarginMs  = 80;

  const thrVal = document.createElement('span');
  thrVal.style.cssText = 'font-size:10px;color:#aad;font-family:monospace;min-width:38px;text-align:right';
  thrVal.textContent = localThreshold.toFixed(2);

  const thrSlider = document.createElement('input');
  thrSlider.type='range'; thrSlider.min=0.10; thrSlider.max=0.95; thrSlider.step=0.01; thrSlider.value=localThreshold;
  thrSlider.style.cssText='flex:1;min-width:60px;accent-color:#ffaa55';
  thrSlider.addEventListener('input', () => { localThreshold=+thrSlider.value; thrVal.textContent=localThreshold.toFixed(2); });

  const mgnVal = document.createElement('span');
  mgnVal.style.cssText = 'font-size:10px;color:#aad;font-family:monospace;min-width:42px;text-align:right';
  mgnVal.textContent = localMarginMs + 'ms';

  const mgnSlider = document.createElement('input');
  mgnSlider.type='range'; mgnSlider.min=20; mgnSlider.max=300; mgnSlider.step=5; mgnSlider.value=localMarginMs;
  mgnSlider.style.cssText='flex:1;min-width:60px;accent-color:#ffaa55';
  mgnSlider.addEventListener('input', () => { localMarginMs=+mgnSlider.value; mgnVal.textContent=localMarginMs+'ms'; });

  const detectBtn = mkBtn2('Detect Transients', '#ffaa55', () => {
    const buf = _buf();
    if (!buf) { statusDiv.style.color='#f87'; statusDiv.textContent='⚠ No audio loaded.'; return; }
    statusDiv.style.color='#aac'; statusDiv.textContent='⏳ Detecting…';
    requestAnimationFrame(() => {
      const RATE = 300;
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      const sr  = buf.sampleRate;
      const spk = Math.max(1, Math.round(sr / RATE));
      const n   = Math.ceil(buf.length / spk);
      const p   = new Float32Array(n);
      let gmax  = 0;
      for (let i = 0; i < n; i++) {
        let mx = 0;
        const s0 = i*spk, s1 = Math.min(s0+spk,buf.length);
        for (let j=s0;j<s1;j++) { const v=Math.max(Math.abs(ch0[j]||0),Math.abs(ch1[j]||0)); if(v>mx)mx=v; }
        p[i]=mx; if(mx>gmax)gmax=mx;
      }
      if (gmax > 0) for (let i=0;i<n;i++) p[i]/=gmax;
      const margin = Math.round(RATE * localMarginMs / 1000);
      const tr = [];
      for (let i=margin; i<n-margin; i++) {
        if (p[i] < localThreshold) continue;
        let isMax=true;
        for (let j=i-margin;j<=i+margin;j++) { if(p[j]>p[i]){isMax=false;break;} }
        if (isMax) tr.push(i/RATE);
      }
      window._audioTransientsSec = tr;
      // Convert to ticks
      const ch = _ch();
      const ticks2 = [];
      if (ch) {
        const offSec = (+(ch.meta?.offset??0))/1000;
        for (const tSec of tr) {
          const adj = tSec - offSec;
          if (adj < 0) continue;
          let pTick2 = 0, pSec2 = 0;
          for (const ev of ch.bpmEvents) {
            const es = (typeof tickToSeconds === 'function') ? tickToSeconds(ev.y) : 0;
            if (es >= adj) break;
            pSec2 = es; pTick2 = ev.y;
          }
          const bpmHere = ch.getBpmAt(pTick2);
          ticks2.push(Math.round(pTick2 + (adj - pSec2) * bpmHere / 60 * TICKS_PER_BEAT));
        }
      }
      window._audioTransientTicks = ticks2;
      refreshStatus();
      if (typeof render === 'function') render();
    });
  });

  wrap.append(mkRow(detectBtn, statusDiv));

  // Refresh status when audio loads while this tool is open (e.g. ksonpack auto-load)
  const _aaOnAudioReady = () => refreshStatus();
  window.addEventListener('vibe:audio-ready', _aaOnAudioReady);
  const _aaObserver = new MutationObserver(() => {
    if (!document.contains(c)) { window.removeEventListener('vibe:audio-ready', _aaOnAudioReady); _aaObserver.disconnect(); }
  });
  _aaObserver.observe(document.body, { childList: true, subtree: true });

  wrap.append(mkRow('Threshold', thrSlider, thrVal));
  wrap.append(mkRow('Min gap', mgnSlider, mgnVal));
  wrap.appendChild(mkSep());

  // ── Snap to Transients toggle ─────────────────────────────────────────────
  const snapHdr = document.createElement('div');
  snapHdr.style.cssText='font-size:10px;font-weight:bold;color:#88ccff;letter-spacing:0.05em';
  snapHdr.textContent='📐 Snap to Transients';
  wrap.appendChild(snapHdr);

  const snapChk = mkChk('Enable snap-to-transients mode', !!(window.prefs?.snapToTransients), v => {
    if (window.prefs) { window.prefs.snapToTransients = v; }
    if (typeof savePrefsToLocalStorage === 'function') savePrefsToLocalStorage();
    if (typeof render === 'function') render();
  });
  wrap.appendChild(snapChk);

  const snapNote = document.createElement('div');
  snapNote.style.cssText='font-size:9px;color:#556;line-height:1.4;margin-top:2px';
  snapNote.textContent='When on, note placement snaps to the nearest detected transient within half a snap-grid cell. Falls back to normal grid snap if no transient is close.';
  wrap.appendChild(snapNote);
  wrap.appendChild(mkSep());

  // ── Place notes at transients ─────────────────────────────────────────────
  const placeHdr = document.createElement('div');
  placeHdr.style.cssText='font-size:10px;font-weight:bold;color:#aaff88;letter-spacing:0.05em';
  placeHdr.textContent='Place Notes at Transients';
  wrap.appendChild(placeHdr);

  const laneLabels = ['BT-A','BT-B','BT-C','BT-D','FX-L','FX-R'];

  // Predefined patterns: each is [label, laneIndex[]]
  // Indices: BT-A=0 BT-B=1 BT-C=2 BT-D=3 FX-L=4 FX-R=5
  const PATTERNS = [
    ['Alternating A/C',       [0,2]],
    ['Alternating B/D',       [1,3]],
    ['Stairs Up (A→D)',       [0,1,2,3]],
    ['Stairs Down (D→A)',     [3,2,1,0]],
    ['Zigzag Outer (A D B C)',[0,3,1,2]],
    ['Zigzag Inner (B C A D)',[1,2,0,3]],
    ['Hand Trill L (A B)',    [0,1]],
    ['Hand Trill R (C D)',    [2,3]],
    ['FX Alternate (L R)',    [4,5]],
    ['Spread (A C B D)',      [0,2,1,3]],
  ];

  // ── Mode selector ─────────────────────────────────────────────────────────
  const modeSel = document.createElement('select');
  modeSel.style.cssText='background:#12122a;color:#ccd;border:1px solid #334;padding:2px 6px;border-radius:4px;font-size:10px;flex:1';
  [['single','Single Lane'],['random','Random'],['pattern','Pattern']].forEach(([v,l])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=l; modeSel.appendChild(o);
  });
  wrap.appendChild(mkRow('Mode', modeSel));

  // ── Single-lane row ───────────────────────────────────────────────────────
  const laneSel = document.createElement('select');
  laneSel.style.cssText='background:#12122a;color:#ccd;border:1px solid #334;padding:2px 6px;border-radius:4px;font-size:10px;flex:1';
  laneLabels.forEach((l,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=l; laneSel.appendChild(o); });
  const laneRow = mkRow('Lane', laneSel);
  wrap.appendChild(laneRow);

  // ── Random-group row ──────────────────────────────────────────────────────
  const randGrpSel = document.createElement('select');
  randGrpSel.style.cssText='background:#12122a;color:#ccd;border:1px solid #334;padding:2px 6px;border-radius:4px;font-size:10px;flex:1';
  [['bt','BT lanes (A–D)'],['fx','FX lanes (L–R)'],['all','All lanes']].forEach(([v,l])=>{
    const o=document.createElement('option'); o.value=v; o.textContent=l; randGrpSel.appendChild(o);
  });
  const randRow = mkRow('Random from', randGrpSel);
  randRow.style.display='none';
  wrap.appendChild(randRow);

  // ── Pattern selector row ──────────────────────────────────────────────────
  const patSel = document.createElement('select');
  patSel.style.cssText='background:#12122a;color:#ccd;border:1px solid #334;padding:2px 6px;border-radius:4px;font-size:10px;flex:1';
  PATTERNS.forEach(([label],i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=label; patSel.appendChild(o); });
  const patRow = mkRow('Pattern', patSel);
  patRow.style.display='none';
  wrap.appendChild(patRow);

  // Show/hide rows when mode changes
  modeSel.addEventListener('change', () => {
    const m = modeSel.value;
    laneRow.style.display = m==='single'  ? '' : 'none';
    randRow.style.display = m==='random'  ? '' : 'none';
    patRow.style.display  = m==='pattern' ? '' : 'none';
  });

  // ── Region selector ───────────────────────────────────────────────────────
  const regionSel = document.createElement('select');
  regionSel.style.cssText='background:#12122a;color:#ccd;border:1px solid #334;padding:2px 6px;border-radius:4px;font-size:10px;flex:1';
  [['all','Entire chart'],['sel','Current selection']].forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; regionSel.appendChild(o); });
  wrap.appendChild(mkRow('Region', regionSel));

  const placeMsg = document.createElement('div');
  placeMsg.style.cssText='font-size:10px;color:#aac;min-height:13px';

  const placeBtn = mkBtn2('⬇ Place Chip Notes', '#aaff88', () => {
    const ticks = window._audioTransientTicks;
    if (!ticks?.length) { placeMsg.textContent='⚠ No transients. Detect first.'; placeMsg.style.color='#f87'; return; }
    const ch = _ch();
    if (!ch) { placeMsg.textContent='⚠ No chart loaded.'; placeMsg.style.color='#f87'; return; }

    const mode = modeSel.value;
    const useSelection = regionSel.value === 'sel' && sel?.active;
    let lo = 0, hi = Infinity;
    if (useSelection) {
      lo = Math.min(sel.startTick, sel.endTick);
      hi = Math.max(sel.startTick, sel.endTick);
    }

    // Build the ordered list of ticks in range
    const inRange = ticks.filter(t => t >= lo && t <= hi);
    if (!inRange.length) {
      placeMsg.style.color='#f87';
      placeMsg.textContent='⚠ No transients in the selected region.';
      return;
    }

    if (typeof saveUndo === 'function') saveUndo('Place Notes at Transients');

    // Helpers to add a note by lane index (0-3 = BT, 4-5 = FX)
    const addNote = (laneIdx, tick) => {
      if (laneIdx < 4) ch.addBtNote(laneIdx, tick, 0);
      else             ch.addFxNote(laneIdx - 4, tick, 0);
    };

    let placed = 0;
    let modeLabel = '';

    if (mode === 'single') {
      // ── Original behaviour ──────────────────────────────────────────────
      const laneIdx = +laneSel.value;
      for (const tick of inRange) { addNote(laneIdx, tick); placed++; }
      modeLabel = laneLabels[laneIdx];

    } else if (mode === 'random') {
      // ── Random pick from group each transient ───────────────────────────
      const grp = randGrpSel.value;
      const pool = grp==='bt'  ? [0,1,2,3]
                 : grp==='fx'  ? [4,5]
                 :               [0,1,2,3,4,5];
      for (const tick of inRange) {
        const laneIdx = pool[Math.floor(Math.random() * pool.length)];
        addNote(laneIdx, tick);
        placed++;
      }
      modeLabel = `random ${grp.toUpperCase()}`;

    } else if (mode === 'pattern') {
      // ── Cycle through predefined pattern sequence ───────────────────────
      const patIdx = +patSel.value;
      const seq    = PATTERNS[patIdx][1];
      for (let i = 0; i < inRange.length; i++) {
        const laneIdx = seq[i % seq.length];
        addNote(laneIdx, inRange[i]);
        placed++;
      }
      modeLabel = PATTERNS[patIdx][0];
    }

    placeMsg.style.color = '#8f8';
    placeMsg.textContent = `✓ Placed ${placed} notes — ${modeLabel}`;
    if (typeof render === 'function') render();
  });

  wrap.append(mkRow(placeBtn, placeMsg));
  wrap.appendChild(mkSep());

  // ── Transient list ────────────────────────────────────────────────────────
  const listHdr = document.createElement('div');
  listHdr.style.cssText='font-size:10px;font-weight:bold;color:#aac;letter-spacing:0.05em';
  listHdr.textContent='Detected Transients';
  wrap.appendChild(listHdr);

  const listBox = document.createElement('div');
  listBox.style.cssText='max-height:140px;overflow-y:auto;background:#09091a;border:1px solid #1e1e3a;border-radius:4px;padding:4px;font-size:9px;font-family:monospace;color:#aac;display:flex;flex-direction:column;gap:1px';

  function refreshList() {
    listBox.innerHTML='';
    const ticks = window._audioTransientTicks;
    const secs  = window._audioTransientsSec;
    if (!ticks?.length) {
      const empty = document.createElement('div');
      empty.style.color='#556'; empty.textContent='(none detected)'; listBox.appendChild(empty);
      return;
    }
    ticks.forEach((tick,i) => {
      const row = document.createElement('div');
      row.style.cssText='display:flex;gap:8px;padding:1px 2px;border-radius:2px;cursor:pointer';
      row.style.color='#8899bb';
      const m = Math.floor(tick/TICKS_PER_MEASURE)+1;
      const b = Math.floor((tick%TICKS_PER_MEASURE)/TICKS_PER_BEAT)+1;
      const secStr = secs?.[i]!=null ? secs[i].toFixed(3)+'s' : '';
      row.innerHTML=`<span style="color:#ffaa55;min-width:28px">T${i+1}</span><span style="min-width:60px">M${m} B${b}</span><span style="color:#778">${secStr}</span>`;
      row.addEventListener('click', () => {
        if (renderer) {
          renderer.playTick = tick;
          if (typeof updateSeekbar === 'function') updateSeekbar(tick);
          if (typeof render === 'function') render();
        }
      });
      row.addEventListener('mouseenter', () => row.style.background='#1a1a3a');
      row.addEventListener('mouseleave', () => row.style.background='');
      listBox.appendChild(row);
    });
  }

  wrap.appendChild(listBox);
  refreshStatus();
  c.appendChild(wrap);
}

/* ═══════════════════════════════════════════════════════════════════════════
   18. Audio Waveform Aligner
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolWaveformAlign(c) {
  // ── Safe accessors (let vars in app.js — not window props) ────────────────
  const _ch  = () => chart;
  const _r   = () => renderer;
  const _buf = () => audioBuffer;

  // ── Tool state ────────────────────────────────────────────────────────────
  let peaks         = null;   // Float32Array 0-1 normalised
  let peakRate      = 300;    // peaks per second
  let peakDuration  = 0;      // seconds
  let transients    = [];     // [seconds…] of detected loud onset peaks
  let localOffsetMs = +((_ch()?.meta?.offset) ?? 0);
  let originalOffMs = localOffsetMs;
  let showOverlay   = false;
  let overlayOpacity= 0.38;
  let ampScale      = 1.0;
  let colorMode     = 'gradient';
  let showBeatGrid  = false;
  let showTransients= false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const mkLabel = (t) => { const s = document.createElement('span'); s.style.cssText='color:#778;font-size:10px'; s.textContent=t; return s; };
  const mkSep   = () => { const d = document.createElement('div'); d.style.cssText='border-top:1px solid #1e1e3a;margin:6px 0'; return d; };
  const mkRow   = (...els) => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:3px 0';
    els.forEach(e => d.appendChild(typeof e === 'string' ? mkLabel(e) : e));
    return d;
  };
  const mkBtn2 = (txt, color, fn) => {
    const b = document.createElement('button');
    b.textContent = txt;
    b.style.cssText = `background:#12122a;color:${color};border:1px solid ${color}55;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px`;
    b.addEventListener('click', fn);
    return b;
  };
  const mkRange = (min, max, step, val, fn) => {
    const r = document.createElement('input');
    r.type='range'; r.min=min; r.max=max; r.step=step; r.value=val;
    r.style.cssText = 'flex:1;min-width:60px;accent-color:#6688ff';
    r.addEventListener('input', fn);
    return r;
  };
  const mkChk = (label, checked, fn) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;font-size:10px;color:#aac';
    const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=checked;
    cb.addEventListener('change', () => fn(cb.checked));
    wrap.append(cb, label);
    return wrap;
  };
  const valSpan = (txt, color='#aad') => {
    const s = document.createElement('span');
    s.style.cssText = `font-size:10px;color:${color};font-family:monospace;min-width:52px;text-align:right`;
    s.textContent = txt; return s;
  };

  // ── Rebuild global transient tick array (called after decode or BPM change) ──
  function _rebuildTransientTicks() {
    const ch = _ch();
    if (!ch || !transients.length) { window._audioTransientTicks = []; return; }
    const offSec = (+(ch.meta?.offset ?? 0)) / 1000;
    const ticks = [];
    for (const tSec of transients) {
      const adjusted = tSec - offSec;
      if (adjusted < 0) continue;
      // Convert seconds to ticks using BPM map
      let tick = 0, prevSec2 = 0, prevTick2 = 0;
      const evs = ch.bpmEvents;
      for (let ei = 0; ei < evs.length; ei++) {
        const ev = evs[ei];
        const evSec = (typeof tickToSeconds === 'function') ? tickToSeconds(ev.y) : 0;
        if (evSec >= adjusted) break;
        prevSec2 = evSec; prevTick2 = ev.y;
      }
      const bpmHere = (typeof chart !== 'undefined' && chart) ? chart.getBpmAt(prevTick2) : 120;
      tick = prevTick2 + (adjusted - prevSec2) * bpmHere / 60 * TICKS_PER_BEAT;
      ticks.push(Math.round(tick));
    }
    window._audioTransientTicks = ticks;
  }

  // ── Push/remove overlay on the renderer ───────────────────────────────────
  function applyOverlay() {
    const r = _r();
    if (!r) return;
    if (!showOverlay || !peaks) {
      r.waveformOverlay = null;
    } else {
      r.waveformOverlay = {
        enabled: true, peaks, peakRate, duration: peakDuration,
        offsetMs: localOffsetMs, opacity: overlayOpacity,
        ampScale, colorMode, showBeatGrid, showTransients,
        transients,
      };
    }
    if (typeof render === 'function') render();
  }

  // ── Peak computation ──────────────────────────────────────────────────────
  function computePeaks(buf) {
    const RATE = 300;
    const ch0  = buf.getChannelData(0);
    const ch1  = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const sr   = buf.sampleRate;
    const spk  = Math.max(1, Math.round(sr / RATE));
    const n    = Math.ceil(buf.length / spk);
    const p    = new Float32Array(n);
    let globalMax = 0;
    for (let i = 0; i < n; i++) {
      let max = 0;
      const s0 = i * spk, s1 = Math.min(s0 + spk, buf.length);
      for (let j = s0; j < s1; j++) {
        const v = Math.max(Math.abs(ch0[j] || 0), Math.abs(ch1[j] || 0));
        if (v > max) max = v;
      }
      p[i] = max;
      if (max > globalMax) globalMax = max;
    }
    if (globalMax > 0) for (let i = 0; i < n; i++) p[i] /= globalMax;

    // Detect transients: peaks that are > 0.65 and locally maximum over ±100ms
    const margin = Math.round(RATE * 0.1);
    const thr    = 0.65;
    const tr = [];
    for (let i = margin; i < n - margin; i++) {
      if (p[i] < thr) continue;
      let isMax = true;
      for (let j = i - margin; j <= i + margin; j++) {
        if (p[j] > p[i]) { isMax = false; break; }
      }
      if (isMax) tr.push(i / RATE);
    }

    return { peaks: p, peakRate: RATE, duration: buf.length / sr, transients: tr };
  }

  // ── Overview waveform canvas ──────────────────────────────────────────────
  function drawOverview() {
    const buf = _buf();
    if (!buf || !peaks) return;
    const ctx = ovCanvas.getContext('2d');
    const W = ovCanvas.width, H = ovCanvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#09091a'; ctx.fillRect(0, 0, W, H);

    // Waveform bars
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      const frac  = x / W;
      const idx   = Math.floor(frac * peaks.length);
      const amp   = peaks[idx] ?? 0;
      const barH  = Math.max(1, amp * mid * 0.95);
      // Colour by amplitude
      const hue   = Math.round(220 - amp * 185);
      ctx.fillStyle = `hsl(${hue},85%,${35 + amp*30}%)`;
      ctx.fillRect(x, mid - barH, 1, barH * 2);
    }

    // Beat grid
    const ch = _ch();
    if (showBeatGrid && ch) {
      const totalMs = peakDuration * 1000;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle   = '#ffffff';
      const bpmEvs = ch.bpmEvents;
      const firstBpm = Math.max(1, bpmEvs[0]?.bpm || 120);
      const beatSec  = 60 / firstBpm;
      for (let t = 0; t < peakDuration; t += beatSec) {
        const x = Math.round((t / peakDuration) * W);
        ctx.fillRect(x, 0, 1, H);
      }
      ctx.globalAlpha = 1;
    }

    // Transient markers
    if (showTransients) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#ffdd44';
      for (const tSec of transients) {
        const x = Math.round((tSec / peakDuration) * W);
        ctx.fillRect(x, 0, 1, H);
      }
      ctx.globalAlpha = 1;
    }

    // Offset marker — the chart start position in audio time
    const offSec = localOffsetMs / 1000;
    if (offSec >= 0 && offSec <= peakDuration) {
      const mx = Math.round((offSec / peakDuration) * W);
      ctx.strokeStyle = '#ff3aad';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
      ctx.fillStyle = '#ff3aad';
      ctx.font = '8px monospace';
      ctx.textAlign = mx > W * 0.8 ? 'right' : 'left';
      ctx.fillText(`chart start: ${localOffsetMs}ms`, mx + (mx > W*0.8 ? -3 : 3), 10);
      ctx.textAlign = 'left';
    } else if (offSec < 0) {
      // Negative offset: audio starts after chart beat 1
      ctx.fillStyle = '#ff8844';
      ctx.font = '8px monospace';
      ctx.fillText(`chart start: −${Math.abs(localOffsetMs)}ms before audio`, 4, 10);
    }

    // Clipping indicator (peaks == 1.0 before normalisation — check raw)
    ctx.lineWidth = 1;
  }

  // ── Analysis info ─────────────────────────────────────────────────────────
  function runAnalysis() {
    const buf = _buf();
    if (!buf) return;
    const ch0 = buf.getChannelData(0);
    // RMS over full track
    let sumSq = 0;
    for (let i = 0; i < ch0.length; i++) sumSq += ch0[i] * ch0[i];
    const rms  = Math.sqrt(sumSq / ch0.length);
    const dbFS = 20 * Math.log10(Math.max(1e-10, rms));
    // Peak raw
    let rawPeak = 0;
    for (let i = 0; i < ch0.length; i++) { const v = Math.abs(ch0[i]); if (v > rawPeak) rawPeak = v; }
    const clipping = rawPeak >= 1.0;

    // Loudest / quietest region (using peaks array, 1-second windows)
    const windowPeaks = Math.round(peakRate);
    const numWindows  = Math.floor(peaks.length / windowPeaks);
    let maxReg=0, minReg=Infinity, maxRegI=0, minRegI=0;
    for (let w = 0; w < numWindows; w++) {
      let sum = 0;
      for (let j = 0; j < windowPeaks; j++) sum += peaks[w * windowPeaks + j];
      const avg = sum / windowPeaks;
      if (avg > maxReg) { maxReg = avg; maxRegI = w; }
      if (avg < minReg) { minReg = avg; minRegI = w; }
    }

    const ch = _ch();
    const firstTransient = transients[0];

    let html =
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:10px;color:#aac">` +
      `<span style="color:#778">Duration</span><span>${peakDuration.toFixed(2)}s</span>` +
      `<span style="color:#778">Sample rate</span><span>${buf.sampleRate} Hz</span>` +
      `<span style="color:#778">Channels</span><span>${buf.numberOfChannels}</span>` +
      `<span style="color:#778">RMS level</span><span>${dbFS.toFixed(1)} dBFS</span>` +
      `<span style="color:#778">Clipping</span><span style="color:${clipping?'#f87':'#8f8'}">${clipping?'⚠ YES':'✓ Clean'}</span>` +
      `<span style="color:#778">Loudest ~1s</span><span>t=${maxRegI.toFixed(0)}s</span>` +
      `<span style="color:#778">Quietest ~1s</span><span>t=${minRegI.toFixed(0)}s</span>` +
      `<span style="color:#778">Transients</span><span>${transients.length} detected</span>` +
      (firstTransient != null ? `<span style="color:#778">First hit</span><span>${firstTransient.toFixed(3)}s</span>` : '') +
      `</div>`;
    analysisBox.innerHTML = html;
  }

  // ── Build the UI ──────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:11px';

  // ── Status / Decode ───────────────────────────────────────────────────────
  const statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'font-size:10px;color:#778;padding:2px 0';

  const decodeBtn = mkBtn2('Decode Audio', '#88ccff', () => {
    const buf = _buf();
    if (!buf) {
      statusDiv.textContent = '⚠ No audio loaded — use Chart menu → Load Audio File first.';
      statusDiv.style.color = '#f87';
      return;
    }
    statusDiv.textContent = '⏳ Computing peaks…'; statusDiv.style.color = '#aac';
    requestAnimationFrame(() => {
      const res = computePeaks(buf);
      peaks        = res.peaks;
      peakRate     = res.peakRate;
      peakDuration = res.duration;
      transients   = res.transients;
      // Expose transients globally so Audio Anchoring tool can snap to them
      window._audioTransientsSec = transients.slice();
      _rebuildTransientTicks();
      statusDiv.textContent =
        `✓ ${buf.numberOfChannels}ch · ${buf.sampleRate}Hz · ${peakDuration.toFixed(2)}s · ${transients.length} transients`;
      statusDiv.style.color = '#8f8';
      drawOverview();
      runAnalysis();
      applyOverlay();
    });
  });

  // Auto-decode if audio already loaded
  const initialBuf = _buf();
  if (initialBuf) {
    statusDiv.textContent = 'Audio present — click Decode to load waveform.';
    statusDiv.style.color = '#aac';
  } else {
    statusDiv.textContent = '⚠ No audio loaded.';
    statusDiv.style.color = '#f87';
  }

  // Refresh status when audio loads while this tool is open (e.g. ksonpack auto-load)
  const _onAudioReady = () => {
    if (!peaks) {
      statusDiv.textContent = 'Audio present — click Decode to load waveform.';
      statusDiv.style.color = '#aac';
    }
  };
  window.addEventListener('vibe:audio-ready', _onAudioReady);
  // Clean up listener when the container is removed from the DOM
  const _waObserver = new MutationObserver(() => {
    if (!document.contains(c)) { window.removeEventListener('vibe:audio-ready', _onAudioReady); _waObserver.disconnect(); }
  });
  _waObserver.observe(document.body, { childList: true, subtree: true });

  wrap.append(mkRow(decodeBtn, statusDiv));
  wrap.appendChild(mkSep());

  // ── Overlay controls ──────────────────────────────────────────────────────
  const overlayHdr = document.createElement('div');
  overlayHdr.style.cssText = 'font-size:10px;font-weight:bold;color:#88ccff;letter-spacing:0.05em';
  overlayHdr.textContent = 'Editor Overlay';
  wrap.appendChild(overlayHdr);

  const ovToggle   = mkChk('Show waveform on editor lanes', false, v => { showOverlay = v; applyOverlay(); });
  wrap.appendChild(ovToggle);

  const opacityVal = valSpan((overlayOpacity * 100).toFixed(0) + '%');
  const opacitySlider = mkRange(5, 90, 1, Math.round(overlayOpacity * 100), () => {
    overlayOpacity = opacitySlider.value / 100;
    opacityVal.textContent = opacitySlider.value + '%';
    applyOverlay();
  });
  wrap.appendChild(mkRow('Opacity', opacitySlider, opacityVal));

  const ampVal = valSpan('1.0×');
  const ampSlider = mkRange(0.2, 3.0, 0.05, 1.0, () => {
    ampScale = +ampSlider.value;
    ampVal.textContent = ampScale.toFixed(2) + '×';
    applyOverlay();
  });
  wrap.appendChild(mkRow('Amp scale', ampSlider, ampVal));

  // Color mode selector
  const colorSel = document.createElement('select');
  colorSel.style.cssText = 'background:#12122a;color:#ccd;border:1px solid #334;padding:2px 5px;border-radius:4px;font-size:10px';
  [['gradient','Auto Gradient'],['blue','Blue'],['green','Green'],['white','White']].forEach(([v,t]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=t; colorSel.appendChild(o);
  });
  colorSel.addEventListener('change', () => { colorMode = colorSel.value; applyOverlay(); });
  wrap.appendChild(mkRow('Color', colorSel));

  const bgChk = mkChk('Show beat grid on overlay', false, v => { showBeatGrid = v; applyOverlay(); });
  const trChk = mkChk('Show transient markers', false, v => { showTransients = v; applyOverlay(); });
  wrap.append(bgChk, trChk);
  wrap.appendChild(mkSep());

  // ── Offset alignment ──────────────────────────────────────────────────────
  const offsetHdr = document.createElement('div');
  offsetHdr.style.cssText = 'font-size:10px;font-weight:bold;color:#ffaa66;letter-spacing:0.05em';
  offsetHdr.textContent = '⏱ Offset Alignment';
  wrap.appendChild(offsetHdr);

  const offsetDisp = valSpan(localOffsetMs + ' ms', '#ffdd88');
  offsetDisp.style.fontSize = '13px';
  offsetDisp.style.minWidth = '80px';
  wrap.appendChild(mkRow('Current offset:', offsetDisp));

  // Nudge buttons
  const nudgeRow = document.createElement('div');
  nudgeRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center';
  const nudge = (delta) => () => {
    localOffsetMs += delta;
    syncOffsetUI();
    applyOverlay();
    drawOverview();
  };
  [[-1000,'−1s'],[-100,'−100'],[-10,'−10'],[-1,'−1']].forEach(([d,t]) =>
    nudgeRow.appendChild(mkBtn2(t, '#ff8866', nudge(d))));
  nudgeRow.appendChild(valSpan('ms', '#556'));
  [[1,'+1'],[10,'+10'],[100,'+100'],[1000,'+1s']].forEach(([d,t]) =>
    nudgeRow.appendChild(mkBtn2(t, '#66ff88', nudge(d))));
  wrap.appendChild(nudgeRow);

  // Fine slider ±3000ms
  const fineVal = valSpan(localOffsetMs + ' ms', '#aac');
  const fineSlider = mkRange(-3000, 3000, 1, localOffsetMs, () => {
    localOffsetMs = +fineSlider.value;
    syncOffsetUI();
    applyOverlay();
    drawOverview();
  });
  wrap.appendChild(mkRow('Fine adjust', fineSlider, fineVal));

  function syncOffsetUI() {
    offsetDisp.textContent = localOffsetMs + ' ms';
    fineSlider.value = Math.max(-3000, Math.min(3000, localOffsetMs));
    fineVal.textContent = localOffsetMs + ' ms';
  }

  // Auto-align: set offset so first transient lands on beat 1 (tick 0)
  const autoBtn = mkBtn2('Auto-align to first transient', '#ffcc44', () => {
    if (!transients.length) { return; }
    // First transient in audio should be the first beat
    localOffsetMs = Math.round(transients[0] * 1000);
    syncOffsetUI();
    applyOverlay();
    drawOverview();
    autoMsg.textContent = `→ Set offset to ${localOffsetMs}ms (first transient at ${transients[0].toFixed(3)}s)`;
  });
  const autoMsg = document.createElement('div');
  autoMsg.style.cssText = 'font-size:9px;color:#aac;min-height:12px';
  wrap.append(autoBtn, autoMsg);

  // Apply + Reset
  const applyBtn = mkBtn2('Save offset to chart metadata', '#88ffaa', () => {
    const ch = _ch();
    if (!ch) return;
    ch.meta.offset = localOffsetMs;
    originalOffMs  = localOffsetMs;
    const el = document.getElementById('meta-offset');
    if (el) el.value = localOffsetMs;
    applyMsg.textContent = `✓ Saved — chart offset is now ${localOffsetMs}ms`;
    applyMsg.style.color = '#8f8';
  });
  const resetBtn = mkBtn2('↺ Reset', '#aab', () => {
    localOffsetMs = originalOffMs;
    syncOffsetUI();
    applyOverlay();
    drawOverview();
    applyMsg.textContent = `Reset to ${originalOffMs}ms`;
    applyMsg.style.color = '#778';
  });
  const applyMsg = document.createElement('div');
  applyMsg.style.cssText = 'font-size:9px;color:#aac;min-height:12px';
  wrap.appendChild(mkRow(applyBtn, resetBtn));
  wrap.appendChild(applyMsg);
  wrap.appendChild(mkSep());

  // ── Waveform overview canvas ──────────────────────────────────────────────
  const ovHdr = document.createElement('div');
  ovHdr.style.cssText = 'font-size:10px;font-weight:bold;color:#aa88ff;letter-spacing:0.05em';
  ovHdr.textContent = 'Waveform Overview';
  wrap.appendChild(ovHdr);

  const ovCanvasWrap = document.createElement('div');
  ovCanvasWrap.style.cssText = 'position:relative;width:100%';
  const ovCanvas = document.createElement('canvas');
  ovCanvas.height = 60;
  ovCanvas.style.cssText = 'width:100%;display:block;height:60px;border:1px solid #2a2a44;border-radius:5px;background:#09091a;cursor:crosshair';
  ovCanvasWrap.appendChild(ovCanvas);
  wrap.appendChild(ovCanvasWrap);

  // Click on overview → set offset to that audio time
  ovCanvas.addEventListener('click', e => {
    if (!peakDuration) return;
    const rect = ovCanvas.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    localOffsetMs = Math.round(frac * peakDuration * 1000);
    syncOffsetUI();
    applyOverlay();
    drawOverview();
  });

  // Resize observer for overview canvas
  new ResizeObserver(() => {
    ovCanvas.width = ovCanvasWrap.clientWidth || 360;
    drawOverview();
  }).observe(ovCanvasWrap);

  wrap.appendChild(mkSep());

  // ── Analysis ──────────────────────────────────────────────────────────────
  const anaHdr = document.createElement('div');
  anaHdr.style.cssText = 'font-size:10px;font-weight:bold;color:#88ffcc;letter-spacing:0.05em';
  anaHdr.textContent = 'Audio Analysis';
  wrap.appendChild(anaHdr);
  const analysisBox = document.createElement('div');
  analysisBox.style.cssText = 'background:#0c0c1e;border:1px solid #1e1e3a;border-radius:5px;padding:6px 8px;min-height:20px';
  analysisBox.innerHTML = '<span style="color:#556;font-size:10px">Decode audio to see analysis.</span>';
  wrap.appendChild(analysisBox);

  c.appendChild(wrap);

  // Auto-decode if buffer already available
  if (initialBuf) {
    requestAnimationFrame(() => decodeBtn.click());
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   21. Chart Validator — unified Integrity + Ergonomics + Export Preflight
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolChartValidator(c) {
  // Tab bar
  const TAB_DEFS = [
    { id: 'integrity',   label: '✓ Integrity'   },
    { id: 'ergonomics',  label: '◈ Ergonomics'  },
    { id: 'export',      label: '▶ Export'       },
  ];
  let activeTab = 'integrity';

  const tabBar = _h('div', '');
  tabBar.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;border-bottom:1px solid #1e1e40;padding-bottom:6px;';

  const panels = {};

  TAB_DEFS.forEach(t => {
    const btn = document.createElement('button');
    btn.textContent = t.label;
    btn.style.cssText = 'flex:1;background:#07071a;border:1px solid #1e1e40;border-radius:4px;color:#8888bb;padding:4px 6px;font-size:10px;cursor:pointer;transition:color 0.15s,border-color 0.15s';
    btn.addEventListener('click', () => {
      activeTab = t.id;
      updateTabs();
    });
    tabBar.appendChild(btn);
    panels[t.id] = { btn };
  });

  function updateTabs() {
    TAB_DEFS.forEach(t => {
      const on = t.id === activeTab;
      panels[t.id].btn.style.borderColor = on ? '#5566ee' : '#1e1e40';
      panels[t.id].btn.style.color       = on ? '#aabbff' : '#8888bb';
      panels[t.id].btn.style.background  = on ? '#0d0d2a' : '#07071a';
      panels[t.id].panelEl.style.display = on ? '' : 'none';
    });
  }

  c.appendChild(tabBar);

  // ── Integrity tab (was _toolValidity) ─────────────────────────────────────
  {
    const panel = _h('div', '');
    const runBtn   = _btn('Run Checks');
    const fixBtn   = _btn('Auto Fix');
    fixBtn.style.cssText = 'margin-left:6px;background:#1a3a1a;border-color:#3a7a3a;color:#88ff88';
    const results = _h('div', 'tool-result-box');
    results.style.maxHeight = '240px'; results.style.overflowY = 'auto';
    const btnRow = _h('div', '');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-bottom:4px';
    btnRow.appendChild(runBtn); btnRow.appendChild(fixBtn);
    panel.appendChild(btnRow); panel.appendChild(results);

    runBtn.addEventListener('click', () => {
      results.innerHTML = '';
      if (!(typeof chart !== "undefined" && chart)) { results.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }
      const issues = [];

      for (let i = 0; i < 4; i++) {
        const arr = chart.bt[i];
        for (let j = 0; j < arr.length - 1; j++) {
          const n = arr[j], nx = arr[j+1];
          if (n.y + Math.max(n.len, 1) > nx.y)
            issues.push({ type:'err', msg:`BT-${['A','B','C','D'][i]} overlap at ${_tickToMB(n.y)}`, measure: Math.floor(n.y/TICKS_PER_MEASURE), tick:n.y });
        }
      }
      for (let i = 0; i < 2; i++) {
        const arr = chart.fx[i];
        for (let j = 0; j < arr.length - 1; j++) {
          const n = arr[j], nx = arr[j+1];
          if (n.y + Math.max(n.len, 1) > nx.y)
            issues.push({ type:'err', msg:`FX-${['L','R'][i]} overlap at ${_tickToMB(n.y)}`, measure: Math.floor(n.y/TICKS_PER_MEASURE), tick:n.y });
        }
      }
      for (let s = 0; s < 2; s++) {
        chart.lasers[s].forEach((sec2, si) => {
          if (sec2.points.length < 2)
            issues.push({ type:'err', msg:`VOL-${['L','R'][s]} section ${si} has <2 points`, measure: Math.floor(sec2.y/TICKS_PER_MEASURE) });
          sec2.points.forEach((p, pi) => {
            if (p.v < 0 || p.v > 1)
              issues.push({ type:'err', msg:`VOL-${['L','R'][s]} sec ${si} pt ${pi} v=${p.v.toFixed(3)} OOB`, measure: Math.floor(sec2.y/TICKS_PER_MEASURE) });
          });
        });
        const secs = (chart.lasers[s]||[]).slice().sort((a,b)=>a.y-b.y);
        for (let i = 0; i < secs.length-1; i++) {
          const A=secs[i], lp=A.points[A.points.length-1], aEnd=A.y+(lp?.ry??0), B=secs[i+1];
          if (B.y < aEnd) issues.push({ type:'err', msg:`⛔ VOL-${['L','R'][s]} sections overlap (${A.y}–${aEnd} vs ${B.y})`, measure:Math.floor(A.y/TICKS_PER_MEASURE) });
        }
        (chart.lasers[s]||[]).forEach((sec2,si) => {
          const lp=sec2.points[sec2.points.length-1], dur=lp?.ry??0;
          if (dur===0) issues.push({ type:'err', msg:`⛔ VOL-${['L','R'][s]} section ${si} zero-duration`, measure:Math.floor(sec2.y/TICKS_PER_MEASURE), tick:sec2.y });
        });
      }
      const chipMap = new Map();
      const addChip = (t,side) => { if (!chipMap.has(t)) chipMap.set(t,{l:0,r:0}); chipMap.get(t)[side===0?'l':'r']++; };
      for (let i=0;i<4;i++) chart.bt[i].forEach(n=>{if(n.len===0)addChip(n.y,i<2?0:1);});
      for (let i=0;i<2;i++) chart.fx[i].forEach(n=>{if(n.len===0)addChip(n.y,i);});
      chipMap.forEach((counts,tick) => {
        if (counts.l>3) issues.push({ type:'err', msg:`⛔ Left hand ${counts.l} chips at ${_tickToMB(tick)} (max 3)`, measure:Math.floor(tick/TICKS_PER_MEASURE), tick });
        if (counts.r>3) issues.push({ type:'err', msg:`⛔ Right hand ${counts.r} chips at ${_tickToMB(tick)} (max 3)`, measure:Math.floor(tick/TICKS_PER_MEASURE), tick });
      });
      for (let s=0;s<2;s++) {
        (chart.lasers[s]||[]).forEach(sec2=>{
          for (let pi=0;pi<sec2.points.length-1;pi++) {
            const p0=sec2.points[pi],p1=sec2.points[pi+1],dt=p1.ry-p0.ry,dv=Math.abs(p1.v-p0.v);
            if (dt<=6&&dv>=0.25) {
              const slamTick=sec2.y+p0.ry;
              const sideBtn=s===0?[chart.bt[0],chart.bt[1],chart.fx[0]]:[chart.bt[2],chart.bt[3],chart.fx[1]];
              if (sideBtn.some(arr=>arr.some(n=>n.len===0&&Math.abs(n.y-slamTick)<=6)))
                issues.push({ type:'warn', msg:`⚠ VOL-${['L','R'][s]} slam at ${_tickToMB(slamTick)} + same-hand chip`, measure:Math.floor(slamTick/TICKS_PER_MEASURE), tick:slamTick });
            }
          }
        });
      }
      if (!chart.meta.title) issues.push({ type:'warn', msg:'No title set', measure:null });
      if (!chart.bpmEvents.some(e=>e.y===0)) issues.push({ type:'warn', msg:'No BPM event at tick 0', measure:0 });

      if (issues.length===0) { results.innerHTML='<div class="tool-result-item tool-result-ok">✓ No issues — chart is clean</div>'; return; }
      issues.sort((a,b)=>a.type===b.type?0:a.type==='err'?-1:1);
      if (typeof addChartAnnotation==='function') {
        issues.filter(i=>i.measure!=null).slice(0,10).forEach(issue=>{
          addChartAnnotation({ tick:issue.measure*TICKS_PER_MEASURE, label:issue.msg.replace(/^[⛔⚠]\s*/,'').slice(0,35), severity:issue.type==='err'?'error':'warn', source:'chart-validator' });
        });
        if (typeof render==='function') render();
      }
      const errCount=issues.filter(i=>i.type==='err').length, warnCount=issues.filter(i=>i.type==='warn').length;
      const sumRow=_h('div','tool-result-item','');
      sumRow.style.cssText='background:#1a0808;border-color:#882233;color:#ff8888;font-weight:700;margin-bottom:6px';
      sumRow.textContent=`${errCount>0?`⛔ ${errCount} error${errCount>1?'s':''}`:''}`+`${errCount>0&&warnCount>0?' · ':''}`+`${warnCount>0?`⚠ ${warnCount} warning${warnCount>1?'s':''}`:''}`;
      results.appendChild(sumRow);
      issues.forEach(issue=>{
        const cls=issue.type==='err'?'tool-result-err':'tool-result-warn';
        const row=_h('div',`tool-result-item ${cls}`);
        row.textContent=issue.msg;
        if (issue.measure!=null) {
          row.style.cursor='pointer';
          const nav=document.createElement('span'); nav.style.cssText='float:right;opacity:0.45;font-size:10px;margin-left:6px'; nav.textContent='→';
          row.appendChild(nav);
          row.addEventListener('click',()=>{
            const t=issue.tick!=null?issue.tick:issue.measure*TICKS_PER_MEASURE;
            if (renderer&&renderer.playTick!==undefined) {
              renderer.playTick=Math.max(0,t);
              const colLen=(renderer.measPerCol??1)*TICKS_PER_MEASURE, col=Math.floor(t/colLen);
              if (col<renderer.scrollCol||col>=renderer.scrollCol+(renderer.numCols??1)) renderer.scrollCol=Math.max(0,col-Math.floor((renderer.numCols??1)/2));
              if (gameView){gameView.playTick=renderer.playTick;if(typeof gameView.draw==='function')gameView.draw();}
              if (typeof updateSeekbar==='function') updateSeekbar(renderer.playTick);
              if (typeof render==='function') render();
            }
          });
        }
        results.appendChild(row);
      });
    });

    fixBtn.addEventListener('click',()=>{
      results.innerHTML='';
      if (!(typeof chart!=='undefined'&&chart)){ results.innerHTML='<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }
      if (typeof saveUndo==='function') saveUndo('Auto Fix');
      let fixed=0;
      for (let i=0;i<4;i++) {
        chart.bt[i].sort((a,b)=>a.y-b.y);
        for (let j=0;j<chart.bt[i].length-1;j++) {
          const n=chart.bt[i][j],nx=chart.bt[i][j+1];
          if (n.y+Math.max(n.len,1)>nx.y){ n.len=Math.max(0,nx.y-1-n.y); fixed++; }
        }
      }
      for (let i=0;i<2;i++) {
        chart.fx[i].sort((a,b)=>a.y-b.y);
        for (let j=0;j<chart.fx[i].length-1;j++) {
          const n=chart.fx[i][j],nx=chart.fx[i][j+1];
          if (n.y+Math.max(n.len,1)>nx.y){ n.len=Math.max(0,nx.y-1-n.y); fixed++; }
        }
      }
      for (let s=0;s<2;s++) {
        const before=chart.lasers[s].length;
        chart.lasers[s]=chart.lasers[s].filter(sec2=>sec2.points.length>=2);
        fixed+=before-chart.lasers[s].length;
        chart.lasers[s].forEach(sec2=>sec2.points.forEach(p=>{ if(p.v<0||p.v>1){p.v=Math.max(0,Math.min(1,p.v));fixed++;} }));
        const b2=chart.lasers[s].length;
        chart.lasers[s]=chart.lasers[s].filter(sec2=>(sec2.points[sec2.points.length-1]?.ry??0)>0);
        fixed+=b2-chart.lasers[s].length;
        chart.lasers[s].sort((a,b)=>a.y-b.y);
        for (let i=0;i<chart.lasers[s].length-1;i++) {
          const A=chart.lasers[s][i],lp=A.points[A.points.length-1],aEnd=A.y+(lp?.ry??0),B=chart.lasers[s][i+1];
          if (B.y<aEnd&&lp){ lp.ry=Math.max(0,B.y-A.y-1); fixed++; }
        }
        chart.lasers[s]=chart.lasers[s].filter(sec2=>(sec2.points[sec2.points.length-1]?.ry??0)>0);
      }
      if (typeof render==='function') render();
      results.innerHTML=fixed>0?`<div class="tool-result-item tool-result-ok">Auto Fix applied ${fixed} correction${fixed!==1?'s':''}.</div>`:`<div class="tool-result-item tool-result-ok">No fixable issues found.</div>`;
    });

    panels['integrity'].panelEl = panel;
    c.appendChild(panel);
    setTimeout(() => runBtn.click(), 80);
  }

  // ── Ergonomics tab (was _toolCollision) ───────────────────────────────────
  {
    const panel = _h('div', '');
    const runBtn = _btn('Detect Ergonomic Issues');
    const results = _h('div', 'tool-result-box');
    results.style.maxHeight = '240px'; results.style.overflowY = 'auto';

    runBtn.addEventListener('click', () => {
      results.innerHTML = '';
      if (!(typeof chart !== "undefined" && chart)) return;
      const issues = [];
      const RESOLUTION = 6;
      const totalTicks = (chart.totalMeasures || 64) * TICKS_PER_MEASURE;
      // max tick gap between laser sections that still makes buttons-in-gap impossible
      const LASER_GAP_LIMIT = 12;

      // Returns true if any laser has a non-static (moving) segment active at tick t.
      // A segment is moving when its start and end positions differ (p0.v !== p1.v).
      function isLaserMoving(t) {
        for (let s = 0; s < 2; s++) {
          for (const sec of chart.lasers[s]) {
            let segStart = sec.y;
            for (let pi = 0; pi < sec.points.length - 1; pi++) {
              const p0 = sec.points[pi];
              const segEnd = segStart + p0.ry;
              if (t >= segStart && t < segEnd && p0.v !== sec.points[pi + 1].v) return true;
              segStart = segEnd;
            }
          }
        }
        return false;
      }

      // Rule 1 & 2: stretch / overload only illegal when a laser is also moving
      for (let t = 0; t < totalTicks; t += RESOLUTION) {
        const activeBt = [false,false,false,false];
        const activeFx = [false,false];
        for (let i=0;i<4;i++) activeBt[i]=chart.bt[i].some(n=>n.len>0&&t>=n.y&&t<n.y+n.len);
        for (let i=0;i<2;i++) activeFx[i]=chart.fx[i].some(n=>n.len>0&&t>=n.y&&t<n.y+n.len);
        const simBt=activeBt.filter(Boolean).length, simFx=activeFx.filter(Boolean).length;
        const total=simBt+simFx;
        const m=Math.floor(t/TICKS_PER_MEASURE), beat=Math.floor((t%TICKS_PER_MEASURE)/TICKS_PER_BEAT)+1;
        const moving = isLaserMoving(t);
        if (total >= 5 && moving) {
          issues.push({ type:'err', msg:`5+ simultaneous holds + moving laser at M${m+1} B${beat} (impossible)`, measure:m });
        } else if (activeBt[0] && activeBt[3] && moving) {
          issues.push({ type:'warn', msg:`BT-A+D extreme stretch during laser at M${m+1} B${beat}`, measure:m });
        }
      }

      // Rule 3: button(s) pressed inside a near-zero gap between two laser sections
      // on the same side — the hand physically cannot reach both knob and button.
      for (let s = 0; s < 2; s++) {
        const side = chart.lasers[s];
        for (let i = 0; i < side.length - 1; i++) {
          const A = side[i];
          const lastPt = A.points[A.points.length - 1];
          const aEnd = A.y + (lastPt?.ry ?? 0);
          const B = side[i + 1];
          const gap = B.y - aEnd;
          if (gap >= 0 && gap <= LASER_GAP_LIMIT) {
            let hasButton = false;
            for (let li = 0; li < 4 && !hasButton; li++)
              hasButton = chart.bt[li].some(n => n.y > aEnd && n.y < B.y);
            for (let li = 0; li < 2 && !hasButton; li++)
              hasButton = chart.fx[li].some(n => n.y > aEnd && n.y < B.y);
            if (hasButton) {
              const m = Math.floor(aEnd / TICKS_PER_MEASURE);
              const beat = Math.floor((aEnd % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
              const sideName = s === 0 ? 'L' : 'R';
              issues.push({ type:'err', msg:`Button in ${gap}-tick laser-${sideName} gap at M${m+1} B${beat} (physically impossible)`, measure:m });
            }
          }
        }
      }

      issues.sort((a, b) => a.measure - b.measure);
      const deduped = [];
      issues.forEach(iss => {
        const last=deduped[deduped.length-1];
        if (last&&last.msg===iss.msg&&Math.abs(iss.measure-last.measure)<2) return;
        deduped.push(iss);
      });

      if (deduped.length===0) { results.innerHTML='<div class="tool-result-item tool-result-ok">✓ No ergonomic issues detected</div>'; return; }
      deduped.forEach(iss => {
        const row=_h('div',`tool-result-item tool-result-${iss.type==='err'?'err':'warn'}`);
        row.textContent=iss.msg; row.style.cursor='pointer';
        row.addEventListener('click',()=>_goToMeasure(iss.measure));
        results.appendChild(row);
      });
      results.insertBefore(_h('div','tool-result-item',`Found ${deduped.length} issue(s):`),results.firstChild);
    });

    panel.appendChild(runBtn); panel.appendChild(results);
    panels['ergonomics'].panelEl = panel;
    c.appendChild(panel);
  }

  // ── Export tab (was _toolExportValidate) ──────────────────────────────────
  {
    const panel = _h('div', '');
    const runBtn = _btn('Run Pre-flight Checks');
    const results = _h('div', 'tool-result-box');
    const summary = _h('div', 'tool-export-summary');

    runBtn.addEventListener('click', () => {
      results.innerHTML=''; summary.innerHTML='';
      if (!(typeof chart!=="undefined"&&chart)){ results.innerHTML='<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }
      const checks=[], ch=chart;
      function chk(label,pass,warn,detail) { checks.push({ label, type:pass?'ok':warn?'warn':'err', icon:pass?'✓':warn?'⚠':'✗', detail }); }

      const totalNotes=_noteCount();
      const hasLaserBad=ch.lasers.some(side=>side.some(s=>s.points.length<2));
      const hasVBad=ch.lasers.some(side=>side.some(s=>s.points.some(p=>p.v<0||p.v>1)));
      const hasShortNotes=[0,1,2,3].some(i=>ch.bt[i].some(n=>n.len>0&&n.len<3))||[0,1].some(i=>ch.fx[i].some(n=>n.len>0&&n.len<3));
      let btOverlap=false;
      for (let i=0;i<4;i++){const arr=ch.bt[i];for(let j=0;j<arr.length-1;j++){if(arr[j].y+Math.max(arr[j].len,1)>arr[j+1].y){btOverlap=true;break;}}}
      let fxOverlap=false;
      for (let i=0;i<2;i++){const arr=ch.fx[i];for(let j=0;j<arr.length-1;j++){if(arr[j].y+Math.max(arr[j].len,1)>arr[j+1].y){fxOverlap=true;break;}}}

      chk('Title not empty',            !!ch.meta.title,                      false,  ch.meta.title||'(empty)');
      chk('Artist not empty',           !!ch.meta.artist,                     false,  ch.meta.artist||'(empty)');
      chk('BPM event at tick 0',        ch.bpmEvents.some(e=>e.y===0),        false,  `${ch.bpmEvents.length} BPM event(s)`);
      chk('At least 10 notes',          totalNotes>=10,                       totalNotes>=1&&totalNotes<10, `${totalNotes} notes`);
      chk('No overlapping BT notes',    !btOverlap,                           false,  btOverlap?'Overlaps found':'OK');
      chk('No overlapping FX notes',    !fxOverlap,                           false,  fxOverlap?'Overlaps found':'OK');
      chk('Laser sections ≥2 points',   !hasLaserBad,                         false,  hasLaserBad?'Bad sections found':'OK');
      chk('Laser v values in [0,1]',    !hasVBad,                             false,  hasVBad?'Out-of-range values':'OK');
      chk('Level is 1–20',              ch.meta.level>=1&&ch.meta.level<=20,  false,  `Level: ${ch.meta.level}`);
      chk('totalMeasures > 0',          ch.totalMeasures>0,                   false,  `${ch.totalMeasures} measures`);
      chk('Audio file specified',        !!ch.meta.music,                     true,   ch.meta.music||'(none)');
      chk('No impossibly short notes',   !hasShortNotes,                      false,  hasShortNotes?'Notes < 3 ticks found':'OK');

      checks.forEach(chk2=>{
        const row=_h('div',`tool-result-item tool-result-${chk2.type}`);
        row.innerHTML=`<span>${chk2.icon}</span> <b>${chk2.label}</b> — <span style="color:#8888aa;font-size:10px">${chk2.detail}</span>`;
        results.appendChild(row);
      });
      const errCount=checks.filter(c2=>c2.type==='err').length, warnCount=checks.filter(c2=>c2.type==='warn').length;
      let status, cls;
      if (errCount>0)       { status=`✗ ERRORS (${errCount} error${errCount>1?'s':''}, ${warnCount} warning${warnCount!==1?'s':''})`; cls='tool-result-err'; }
      else if (warnCount>0) { status=`⚠ WARNINGS (${warnCount} warning${warnCount!==1?'s':''})`; cls='tool-result-warn'; }
      else                  { status='✓ READY TO EXPORT'; cls='tool-result-ok'; }
      summary.className=`tool-export-summary tool-result-item ${cls}`;
      summary.textContent=status;
    });

    panel.appendChild(runBtn); panel.appendChild(summary); panel.appendChild(results);
    panels['export'].panelEl = panel;
    c.appendChild(panel);
  }

  updateTabs();
}

/* ═══════════════════════════════════════════════════════════════════════════
   22. Chart Statistics — note counts, density, laser coverage
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolChartStats(c) {
  const sec = _section('Chart Statistics');
  c.appendChild(sec);

  const results   = _h('div', '');
  const fullRes   = _h('div', 'tool-result-box');
  fullRes.style.cssText = 'margin-top:8px;max-height:200px;overflow-y:auto';

  const refreshBtn = _btn('↺ Refresh');
  refreshBtn.style.cssText = 'margin-bottom:8px;font-size:10px';
  sec.appendChild(refreshBtn);
  sec.appendChild(results);
  sec.appendChild(fullRes);

  function compute() {
    results.innerHTML = ''; fullRes.innerHTML = '';
    if (!(typeof chart !== 'undefined' && chart)) {
      fullRes.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>'; return;
    }
    const ch = chart;
    const totalMeas  = ch.totalMeasures || 1;
    const totalTicks = totalMeas * TICKS_PER_MEASURE;

    const btTotal  = [0,1,2,3].reduce((s,i)=>s+ch.bt[i].length, 0);
    const fxTotal  = [0,1].reduce((s,i)=>s+ch.fx[i].length, 0);
    const btChips  = [0,1,2,3].reduce((s,i)=>s+ch.bt[i].filter(n=>n.len===0).length, 0);
    const btHolds  = btTotal - btChips;
    const fxChips  = [0,1].reduce((s,i)=>s+ch.fx[i].filter(n=>n.len===0).length, 0);
    const fxHolds  = fxTotal - fxChips;
    const lptsL    = ch.lasers[0].reduce((s,sec2)=>s+sec2.points.length, 0);
    const lptsR    = ch.lasers[1].reduce((s,sec2)=>s+sec2.points.length, 0);

    const calcCov = secs => {
      let cov = 0;
      secs.forEach(sec2 => { const lp = sec2.points[sec2.points.length-1]; cov += lp?.ry ?? 0; });
      return totalTicks > 0 ? Math.min(100, cov/totalTicks*100).toFixed(1) : '0.0';
    };
    const coverL = calcCov(ch.lasers[0]);
    const coverR = calcCov(ch.lasers[1]);

    const bpms   = ch.bpmEvents.map(e=>e.bpm);
    const bpmMin = bpms.length ? Math.min(...bpms) : 0;
    const bpmMax = bpms.length ? Math.max(...bpms) : 0;
    const bpmStr = bpmMin === bpmMax ? bpmMin.toFixed(1) : `${bpmMin.toFixed(0)}–${bpmMax.toFixed(0)}`;

    const allTicks = [];
    for (let i=0;i<4;i++) ch.bt[i].forEach(n=>allTicks.push(n.y));
    for (let i=0;i<2;i++) ch.fx[i].forEach(n=>allTicks.push(n.y));
    let peakDens = 0;
    for (let m=0;m<totalMeas;m++) {
      const s=m*TICKS_PER_MEASURE, e=s+TICKS_PER_MEASURE;
      const cnt=allTicks.filter(t=>t>=s&&t<e).length;
      if (cnt>peakDens) peakDens=cnt;
    }

    results.appendChild(_statGrid([
      { label: 'BT Notes',  value: btTotal,   color: '#c8c8ff' },
      { label: 'BT Chips',  value: btChips,   color: '#9999ee' },
      { label: 'BT Holds',  value: btHolds,   color: '#7777cc' },
      { label: 'FX Notes',  value: fxTotal,   color: '#ffd700' },
      { label: 'VOL-L pts', value: lptsL,     color: '#3388ff' },
      { label: 'VOL-R pts', value: lptsR,     color: '#ff2266' },
      { label: 'BPM',       value: bpmStr,    color: '#ffdd44' },
      { label: 'Measures',  value: totalMeas, color: '#aabbff' },
    ]));

    const details = [
      { label: 'FX Chips / Holds',    value: `${fxChips} / ${fxHolds}` },
      { label: 'VOL-L coverage',       value: `${coverL}%  (${ch.lasers[0].length} section${ch.lasers[0].length!==1?'s':''})` },
      { label: 'VOL-R coverage',       value: `${coverR}%  (${ch.lasers[1].length} section${ch.lasers[1].length!==1?'s':''})` },
      { label: 'Peak density',         value: `${peakDens} notes/measure` },
      { label: 'Total note events',    value: allTicks.length },
      { label: 'BPM events',           value: ch.bpmEvents.length },
      { label: 'Chart sections',       value: (ch.sections||[]).length },
    ];
    details.forEach(({ label, value }) => {
      const kv = _h('div', 'tool-kv', '');
      kv.innerHTML = `<span class="tool-kv-key">${label}</span><span class="tool-kv-val">${value}</span>`;
      fullRes.appendChild(kv);
    });
  }

  refreshBtn.addEventListener('click', compute);
  setTimeout(compute, 50);
}

/* ═══════════════════════════════════════════════════════════════════════════
   23. Laser Fixer — detect and correct laser position drift / structure issues
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolLaserFixer(c) {
  const sec = _section('Laser Fixer');
  c.appendChild(sec);

  const desc = _h('div','','Detect and fix laser section structural issues: out-of-range values, negative ry offsets, unsorted points, and empty sections.');
  desc.style.cssText = 'font-size:9px;color:#556;line-height:1.5;margin-bottom:6px';
  sec.appendChild(desc);

  const runBtn = _btn('Scan Lasers');
  const fixBtn = _btn('Fix All Issues');
  fixBtn.style.cssText = 'margin-left:6px;background:#1a3a1a;border-color:#3a7a3a;color:#88ff88';

  const results = _h('div', 'tool-result-box');
  results.style.maxHeight = '220px'; results.style.overflowY = 'auto';

  const btnRow = _h('div','');
  btnRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  btnRow.appendChild(runBtn); btnRow.appendChild(fixBtn);
  sec.appendChild(btnRow); sec.appendChild(results);

  function scanLasers(ch) {
    const issues = [];
    for (let s = 0; s < 2; s++) {
      const side = ['VOL-L','VOL-R'][s];
      ch.lasers[s].forEach((sec2, si) => {
        // Check points are sorted by ry
        const pts = sec2.points;
        for (let pi = 0; pi < pts.length; pi++) {
          if (pts[pi].ry < 0) issues.push({ side:s, sec:sec2, si, pi, type:'negative-ry', msg:`${side} sec ${si} pt ${pi}: negative ry=${pts[pi].ry}` });
        }
        for (let pi = 0; pi < pts.length - 1; pi++) {
          if (pts[pi].ry > pts[pi+1].ry) issues.push({ side:s, sec:sec2, si, pi, type:'unsorted', msg:`${side} sec ${si}: pts not sorted at ${pi}→${pi+1}` });
          if (pts[pi].ry === pts[pi+1].ry && pi < pts.length - 2) issues.push({ side:s, sec:sec2, si, pi, type:'duplicate-ry', msg:`${side} sec ${si}: duplicate ry=${pts[pi].ry} at ${pi}` });
        }
        // v out of range
        pts.forEach((p, pi) => {
          if (p.v < 0 || p.v > 1) issues.push({ side:s, sec:sec2, si, pi, type:'v-oob', msg:`${side} sec ${si} pt ${pi}: v=${p.v.toFixed(4)} outside [0,1]` });
        });
        // sec.y negative
        if (sec2.y < 0) issues.push({ side:s, sec:sec2, si, pi:null, type:'negative-y', msg:`${side} sec ${si}: negative y=${sec2.y}` });
        // empty / single-point
        if (pts.length < 2) issues.push({ side:s, sec:sec2, si, pi:null, type:'short', msg:`${side} sec ${si}: only ${pts.length} point(s)` });
      });
    }
    return issues;
  }

  runBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== "undefined" && chart)) { results.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }
    const issues = scanLasers(chart);
    if (issues.length === 0) { results.innerHTML = '<div class="tool-result-item tool-result-ok">✓ No laser structure issues found</div>'; return; }
    results.appendChild(_h('div','tool-result-item',`Found ${issues.length} issue(s):`));
    issues.forEach(iss => {
      const row = _h('div', `tool-result-item tool-result-${iss.type==='v-oob'||iss.type==='negative-y'||iss.type==='negative-ry'?'err':'warn'}`);
      row.textContent = iss.msg;
      if (iss.sec) {
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => _goToMeasure(Math.floor(iss.sec.y / TICKS_PER_MEASURE)));
      }
      results.appendChild(row);
    });
  });

  fixBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== "undefined" && chart)) { results.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }
    if (typeof saveUndo === 'function') saveUndo('Laser Fixer');
    let fixed = 0;
    for (let s = 0; s < 2; s++) {
      // Clamp v to [0,1]
      chart.lasers[s].forEach(sec2 => sec2.points.forEach(p => {
        if (p.v < 0 || p.v > 1) { p.v = Math.max(0, Math.min(1, p.v)); fixed++; }
      }));
      // Clamp negative ry to 0
      chart.lasers[s].forEach(sec2 => sec2.points.forEach(p => {
        if (p.ry < 0) { p.ry = 0; fixed++; }
      }));
      // Sort points by ry
      chart.lasers[s].forEach(sec2 => {
        const before = JSON.stringify(sec2.points.map(p=>p.ry));
        sec2.points.sort((a,b) => a.ry - b.ry);
        if (JSON.stringify(sec2.points.map(p=>p.ry)) !== before) fixed++;
      });
      // Remove duplicate ry entries (keep first)
      chart.lasers[s].forEach(sec2 => {
        const seen = new Set();
        const before = sec2.points.length;
        sec2.points = sec2.points.filter(p => { if (seen.has(p.ry)) return false; seen.add(p.ry); return true; });
        fixed += before - sec2.points.length;
      });
      // Remove sections with <2 points or negative y
      const before = chart.lasers[s].length;
      chart.lasers[s] = chart.lasers[s].filter(sec2 => sec2.points.length >= 2 && sec2.y >= 0);
      fixed += before - chart.lasers[s].length;
      // Sort sections by y
      chart.lasers[s].sort((a,b) => a.y - b.y);
    }
    if (typeof render === 'function') render();
    results.innerHTML = `<div class="tool-result-item tool-result-ok">Fixed ${fixed} issue${fixed!==1?'s':''}. Re-scan to verify.</div>`;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   19. Collision Detector
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolCollision(c) {
  const sec = _section('Collision Detector');
  c.appendChild(sec);

  const runBtn = _btn('Detect Collisions');
  const results = _h('div', 'tool-result-box');
  results.style.maxHeight = '220px'; results.style.overflowY = 'auto';

  runBtn.addEventListener('click', () => {
    results.innerHTML = '';
    if (!(typeof chart !== "undefined" && chart)) return;
    const issues = [];

    // Build tick→active lanes map (check every tick in each note's range)
    const RESOLUTION = 6; // check every 6 ticks for performance
    const totalTicks = (chart.totalMeasures || 64) * TICKS_PER_MEASURE;

    // For each tick cluster, find simultaneous holds
    for (let t = 0; t < totalTicks; t += RESOLUTION) {
      const activeBt = [false,false,false,false];
      const activeFx = [false,false];
      for (let i = 0; i < 4; i++) {
        activeBt[i] = chart.bt[i].some(n => n.len > 0 && t >= n.y && t < n.y + n.len);
      }
      for (let i = 0; i < 2; i++) {
        activeFx[i] = chart.fx[i].some(n => n.len > 0 && t >= n.y && t < n.y + n.len);
      }
      const simBt = activeBt.filter(Boolean).length;
      const simFx = activeFx.filter(Boolean).length;
      const total = simBt + simFx;
      const m = Math.floor(t / TICKS_PER_MEASURE);
      const beat = Math.floor((t % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

      if (total >= 5) {
        issues.push({ type: 'err', msg: `5+ simultaneous holds at M${m+1} B${beat} (impossible)`, measure: m });
      } else if (activeBt[0] && activeBt[3] && simBt >= 2) {
        issues.push({ type: 'warn', msg: `BT-A+D extreme stretch at M${m+1} B${beat}`, measure: m });
      } else if (activeFx[0] && activeBt[0] && activeBt[1]) {
        issues.push({ type: 'warn', msg: `FX-L + BT-A + BT-B (3-finger strain) at M${m+1} B${beat}`, measure: m });
      }
    }

    // Deduplicate nearby issues
    const deduped = [];
    issues.forEach(iss => {
      const last = deduped[deduped.length - 1];
      if (last && last.msg === iss.msg && Math.abs(iss.measure - last.measure) < 2) return;
      deduped.push(iss);
    });

    if (deduped.length === 0) {
      results.innerHTML = '<div class="tool-result-item tool-result-ok">✓ No collisions detected</div>';
      return;
    }
    deduped.forEach(iss => {
      const row = _h('div', `tool-result-item tool-result-${iss.type === 'err' ? 'err' : 'warn'}`);
      row.textContent = iss.msg;
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => _goToMeasure(iss.measure));
      results.appendChild(row);
    });
    results.insertBefore(_h('div', 'tool-result-item', `Found ${deduped.length} issue(s):`), results.firstChild);
  });

  sec.appendChild(runBtn);
  sec.appendChild(results);
}

/* ═══════════════════════════════════════════════════════════════════════════
   20. Export Validator
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolExportValidate(c) {
  const sec = _section('Export Validator');
  c.appendChild(sec);

  const runBtn = _btn('Run Pre-flight Checks');
  const results = _h('div', 'tool-result-box');
  const summary = _h('div', 'tool-export-summary');

  runBtn.addEventListener('click', () => {
    results.innerHTML = ''; summary.innerHTML = '';
    if (!(typeof chart !== "undefined" && chart)) { results.innerHTML = '<div class="tool-result-item tool-result-err">No chart loaded</div>'; return; }

    const checks = [];
    const ch = chart;

    function chk(label, pass, warn, detail) {
      const type = pass ? 'ok' : warn ? 'warn' : 'err';
      const icon = pass ? '✓' : warn ? '⚠' : '✗';
      checks.push({ label, type, icon, detail });
    }

    const totalNotes = _noteCount();
    const hasLaserBad = ch.lasers.some(side => side.some(s => s.points.length < 2));
    const hasVBad = ch.lasers.some(side => side.some(s => s.points.some(p => p.v < 0 || p.v > 1)));
    const hasShortNotes = [0,1,2,3].some(i => ch.bt[i].some(n => n.len > 0 && n.len < 3)) ||
                          [0,1].some(i => ch.fx[i].some(n => n.len > 0 && n.len < 3));
    // BT overlap
    let btOverlap = false;
    for (let i = 0; i < 4; i++) {
      const arr = ch.bt[i];
      for (let j = 0; j < arr.length-1; j++) {
        if (arr[j].y + Math.max(arr[j].len,1) > arr[j+1].y) { btOverlap = true; break; }
      }
    }
    let fxOverlap = false;
    for (let i = 0; i < 2; i++) {
      const arr = ch.fx[i];
      for (let j = 0; j < arr.length-1; j++) {
        if (arr[j].y + Math.max(arr[j].len,1) > arr[j+1].y) { fxOverlap = true; break; }
      }
    }

    chk('Title not empty',           !!ch.meta.title,                      false,  ch.meta.title || '(empty)');
    chk('Artist not empty',          !!ch.meta.artist,                     false,  ch.meta.artist || '(empty)');
    chk('BPM event at tick 0',       ch.bpmEvents.some(e => e.y === 0),    false,  `${ch.bpmEvents.length} BPM event(s)`);
    chk('At least 10 notes',         totalNotes >= 10,                     totalNotes >= 1 && totalNotes < 10, `${totalNotes} notes`);
    chk('No overlapping BT notes',   !btOverlap,                           false,  btOverlap ? 'Overlaps found' : 'OK');
    chk('No overlapping FX notes',   !fxOverlap,                           false,  fxOverlap ? 'Overlaps found' : 'OK');
    chk('Laser sections ≥2 points',  !hasLaserBad,                         false,  hasLaserBad ? 'Bad sections found' : 'OK');
    chk('Laser v values in [0,1]',   !hasVBad,                             false,  hasVBad ? 'Out-of-range values' : 'OK');
    chk('Level is 1–20',             ch.meta.level >= 1 && ch.meta.level <= 20, false, `Level: ${ch.meta.level}`);
    chk('totalMeasures > 0',         ch.totalMeasures > 0,                 false,  `${ch.totalMeasures} measures`);
    chk('Audio file specified',       !!ch.meta.music,                     true,   ch.meta.music || '(none)');
    chk('No impossibly short notes',  !hasShortNotes,                      false,  hasShortNotes ? 'Notes < 3 ticks found' : 'OK');

    checks.forEach(chk2 => {
      const row = _h('div', `tool-result-item tool-result-${chk2.type}`);
      row.innerHTML = `<span>${chk2.icon}</span> <b>${chk2.label}</b> — <span style="color:#8888aa;font-size:10px">${chk2.detail}</span>`;
      results.appendChild(row);
    });

    const errCount  = checks.filter(ch2 => ch2.type === 'err').length;
    const warnCount = checks.filter(ch2 => ch2.type === 'warn').length;
    let status, cls;
    if (errCount > 0)       { status = `✗ ERRORS (${errCount} error${errCount>1?'s':''}, ${warnCount} warning${warnCount!==1?'s':''})`; cls = 'tool-result-err'; }
    else if (warnCount > 0) { status = `⚠ WARNINGS (${warnCount} warning${warnCount!==1?'s':''})`; cls = 'tool-result-warn'; }
    else                    { status = '✓ READY TO EXPORT'; cls = 'tool-result-ok'; }
    summary.className = `tool-export-summary tool-result-item ${cls}`;
    summary.textContent = status;
  });

  sec.appendChild(runBtn);
  sec.appendChild(summary);
  sec.appendChild(results);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Visual Mode — multi-interpretation preview rendering
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolVisualMode(c) {
  const gv = () => (typeof gameView !== 'undefined' ? gameView : null);

  const modes = [
    {
      id: 'standard',
      label: 'Standard',
      desc: 'Full SDVX-style rendering with gradients and glow. Default behavior, unchanged from the arcade aesthetic.',
    },
    {
      id: 'simplified',
      label: 'Simple',
      desc: 'Flat solid colors, no gradients or glow effects. BT notes render white, FX notes orange. Best for reading dense sections at high hi-speed.',
    },
    {
      id: 'colorblind',
      label: 'Colorblind',
      desc: 'Deuteranopia and protanopia-safe palette. Right laser is remapped from pink/magenta to gold. All other elements retain standard appearance.',
    },
    {
      id: 'wireframe',
      label: 'Wireframe',
      desc: 'Near-transparent fills with bright outlines only. BT notes are white stroked boxes, FX notes orange, lasers drawn as outlines. Use for structural analysis.',
    },
  ];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:2px 0';

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:9px;color:#556;line-height:1.5;padding:2px 0';
  desc.textContent = 'Changes the visual rendering style of the game preview for readability testing. Switches instantly without modifying chart data. Saved with Save Config.';
  wrap.appendChild(desc);

  const btnWrap = document.createElement('div');
  btnWrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';

  const buttons = {};

  function syncActive() {
    const active = gv()?.interpMode ?? 'standard';
    for (const [id, el] of Object.entries(buttons)) {
      const on = id === active;
      el.style.background   = on ? '#0d2240' : '#07071a';
      el.style.borderColor  = on ? '#00cfff' : '#1e1e40';
      el.querySelector('.vm-lbl').style.color      = on ? '#00cfff' : '#8888bb';
      el.querySelector('.vm-lbl').style.fontWeight = on ? '700' : '400';
    }
  }

  function applyMode(id) {
    const v = gv();
    if (!v) return;
    v.interpMode = id;
    // Mirror to any multi-chart views
    if (typeof _multiViews !== 'undefined') {
      for (const mv of _multiViews) mv.gv.interpMode = id;
    }
    // Persist to prefs
    if (typeof prefs !== 'undefined') {
      prefs.interpMode = id;
      try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch (_) {}
    }
    if (!playing && typeof render === 'function') render();
    syncActive();
  }

  for (const mode of modes) {
    const btn = document.createElement('button');
    btn.style.cssText = [
      'text-align:left', 'padding:8px 10px', 'background:#07071a',
      'border:1px solid #1e1e40', 'border-radius:6px', 'cursor:pointer',
      'font-family:inherit', 'width:100%', 'transition:border-color .12s,background .12s',
    ].join(';');
    btn.innerHTML =
      `<div class="vm-lbl" style="font-size:11px;font-family:monospace;color:#8888bb;transition:color .12s">${mode.label}</div>` +
      `<div style="font-size:9px;color:#3a3a66;margin-top:3px;line-height:1.4">${mode.desc}</div>`;
    btn.addEventListener('mouseenter', () => { if (btn.style.borderColor !== 'rgb(0, 207, 255)') btn.style.borderColor = '#3a3a70'; });
    btn.addEventListener('mouseleave', syncActive);
    btn.addEventListener('click', () => applyMode(mode.id));
    buttons[mode.id] = btn;
    btnWrap.appendChild(btn);
  }

  wrap.appendChild(btnWrap);
  syncActive();
  c.appendChild(wrap);
}

/* ═══════════════════════════════════════════════════════════════════════════
   Adaptive Pattern Compression  [Experimental]
   Finds windows that exceed a notes-per-beat density limit and removes the
   lowest-priority chip notes (weakest subdivisions first) to bring each
   window back under the threshold. Hold notes are never touched.
   ═══════════════════════════════════════════════════════════════════════════ */
function _toolAdaptiveCompress(c) {
  const TPBEAT = TICKS_PER_BEAT; // 48 at 4/4

  // ── Header ────────────────────────────────────────────────────────────────
  const sec = _section('Adaptive Pattern Compression');
  c.appendChild(sec);

  const descEl = _h('div', 'tool-subdesc',
    'Finds chart windows that exceed a notes-per-beat limit and removes the lowest-priority chip notes — weakest subdivisions (64th → 32nd → 16th) first — to bring density under the threshold. Hold notes are never removed.');
  sec.appendChild(descEl);

  // ── Threshold slider ──────────────────────────────────────────────────────
  const threshSlider = document.createElement('input');
  threshSlider.type = 'range'; threshSlider.min = '0.5'; threshSlider.max = '8';
  threshSlider.step = '0.5';
  threshSlider.value = String(_getTS('adaptive-compress', 'threshold') ?? 4);

  const threshDisp = _h('span', '', parseFloat(threshSlider.value).toFixed(1));
  threshDisp.style.cssText = 'color:#00cfff;min-width:32px;text-align:right;font-family:monospace;font-size:11px';

  const threshWrap = document.createElement('div');
  threshWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex:1';
  threshSlider.style.flex = '1';
  threshWrap.appendChild(threshSlider);
  threshWrap.appendChild(threshDisp);

  const threshRow = _h('div', 'tool-row');
  threshRow.appendChild(_h('label', '', 'Max notes/beat:'));
  threshRow.appendChild(threshWrap);
  sec.appendChild(threshRow);

  // ── Window size ───────────────────────────────────────────────────────────
  const winSel = document.createElement('select');
  winSel.style.cssText = 'background:#12122a;color:#ccd;border:1px solid #334;padding:2px 6px;border-radius:4px;font-size:10px';
  const defWin = String(_getTS('adaptive-compress', 'window') ?? '2');
  [['1','1 measure'],['2','2 measures'],['4','4 measures'],['8','8 measures']].forEach(([v,lbl]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = lbl;
    if (v === defWin) o.selected = true;
    winSel.appendChild(o);
  });
  sec.appendChild(_row('Analysis window:', winSel));

  // ── Lane toggles ──────────────────────────────────────────────────────────
  const laneState = {
    bt: _getTS('adaptive-compress', 'targetBt') !== false,
    fx: _getTS('adaptive-compress', 'targetFx') !== false,
  };
  const ltRow = _h('div', 'tool-row');
  ltRow.appendChild(_h('label', '', 'Target lanes:'));
  const ltBtns = document.createElement('div');
  ltBtns.style.cssText = 'display:flex;gap:5px';
  const _mkLBtn = (key, label, color) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:${color}33;color:${color};border:1px solid ${color}66;` +
                      `padding:2px 9px;border-radius:10px;cursor:pointer;font-size:10px;transition:background .15s`;
    b.addEventListener('click', () => {
      laneState[key] = !laneState[key];
      b.style.background = laneState[key] ? color + '33' : '#1a1a35';
      _clearStage();
    });
    return b;
  };
  ltBtns.appendChild(_mkLBtn('bt', 'BT', '#8080ff'));
  ltBtns.appendChild(_mkLBtn('fx', 'FX', '#ff8800'));
  ltRow.appendChild(ltBtns);
  sec.appendChild(ltRow);

  // ── Density bar chart canvas ──────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = 480; canvas.height = 100;
  canvas.style.cssText = 'width:100%;display:block;border:1px solid #2a2a44;border-radius:6px;' +
                          'background:#07070f;margin-top:6px';
  sec.appendChild(canvas);

  // ── Status text ───────────────────────────────────────────────────────────
  const statusEl = _h('div', 'tool-result-box',
    'Click <b>Analyze</b> to scan for over-density windows.');
  sec.appendChild(statusEl);

  // ── Action buttons ────────────────────────────────────────────────────────
  const actRow = document.createElement('div');
  actRow.style.cssText = 'display:flex;gap:8px;margin-top:4px';

  const analyzeBtn = _btn('🔍 Analyze', 'tool-btn-action');
  analyzeBtn.style.flex = '1';

  const applyBtn = _btn('✂ Apply Compression', 'tool-btn-action');
  applyBtn.style.cssText += ';flex:1;opacity:0.4;cursor:not-allowed;background:#2a0a0a;border-color:#773333';
  applyBtn.disabled = true;

  actRow.appendChild(analyzeBtn);
  actRow.appendChild(applyBtn);
  sec.appendChild(actRow);

  // ── Internal state ────────────────────────────────────────────────────────
  let _staged = null; // [{ note (obj ref), type:'bt'|'fx', lane }]

  function _clearStage() {
    _staged = null;
    applyBtn.disabled = true;
    applyBtn.style.opacity = '0.4';
    applyBtn.style.cursor = 'not-allowed';
  }

  // Returns a priority score for a tick position within a measure.
  // Lower score = removed first (weakest subdivision).
  function _priority(tick) {
    const t = ((tick % TICKS_PER_MEASURE) + TICKS_PER_MEASURE) % TICKS_PER_MEASURE;
    if (t === 0)                              return 100; // measure downbeat
    if (t % TPBEAT === 0)                     return 90;  // quarter note
    if (t % (TPBEAT / 2)  === 0)             return 75;  // 8th
    if (t % (TPBEAT / 3)  === 0)             return 68;  // 8th triplet
    if (t % (TPBEAT / 4)  === 0)             return 55;  // 16th
    if (t % (TPBEAT / 6)  === 0)             return 38;  // 16th triplet
    if (t % (TPBEAT / 8)  === 0)             return 22;  // 32nd
    if (t % (TPBEAT / 12) === 0)             return 12;  // 32nd triplet
    return 5;                                             // 64th or finer
  }

  function analyze() {
    const ch = (typeof chart !== 'undefined') ? chart : null;
    if (!ch) { statusEl.textContent = 'No chart loaded.'; return; }

    const threshold = parseFloat(threshSlider.value);
    const windowM   = parseInt(winSel.value);
    const wTicks    = windowM * TICKS_PER_MEASURE;
    const wBeats    = windowM * BEATS_PER_MEASURE;
    const totalM    = ch.totalMeasures || 64;
    const totalW    = Math.ceil(totalM / windowM);

    const staged     = [];
    const windowData = [];

    for (let w = 0; w < totalW; w++) {
      const s = w * wTicks;
      const e = s + wTicks;
      const chips = [];
      let totalNotes = 0;

      if (laneState.bt) {
        for (let l = 0; l < 4; l++) {
          ch.bt[l].forEach(n => {
            if (n.y < s || n.y >= e) return;
            totalNotes++;
            if (n.len === 0) chips.push({ note: n, type: 'bt', lane: l, tick: n.y });
          });
        }
      }
      if (laneState.fx) {
        for (let l = 0; l < 2; l++) {
          ch.fx[l].forEach(n => {
            if (n.y < s || n.y >= e) return;
            totalNotes++;
            if (n.len === 0) chips.push({ note: n, type: 'fx', lane: l, tick: n.y });
          });
        }
      }

      const density  = totalNotes / wBeats;
      let   toRemove = 0;

      if (density > threshold) {
        // Sort ascending by priority — lowest priority removed first
        chips.sort((a, b) => _priority(a.tick) - _priority(b.tick));
        const excess = Math.ceil(totalNotes - threshold * wBeats);
        toRemove = Math.min(excess, chips.length);
        for (let i = 0; i < toRemove; i++) staged.push(chips[i]);
      }

      windowData.push({ density, totalNotes, toRemove, over: density > threshold });
    }

    _drawCanvas(windowData, threshold);

    const overW = windowData.filter(d => d.over).length;
    if (overW === 0) {
      statusEl.innerHTML =
        `<span style="color:#44ff88">✓ All ${totalW} window${totalW>1?'s':''} are within the limit ` +
        `(≤&nbsp;${threshold.toFixed(1)}&nbsp;n/b). No changes needed.</span>`;
      _clearStage();
    } else {
      _staged = staged;
      applyBtn.disabled = false;
      applyBtn.style.opacity = '1';
      applyBtn.style.cursor  = 'pointer';
      statusEl.innerHTML =
        `<span style="color:#ffcc44">⚠ ${overW}/${totalW} window${overW>1?'s':''} over limit — ` +
        `<b>${staged.length}</b> chip note${staged.length!==1?'s':''} would be removed.</span><br>` +
        `<span style="color:#556;font-size:10px">Hold notes are preserved. Weakest subdivisions removed first ` +
        `(64th → 32nd → 16th). Orange bars show what will be removed.</span>`;
    }
  }

  function _drawCanvas(windowData, threshold) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!windowData.length) return;

    const maxD = Math.max(threshold * 1.6, ...windowData.map(d => d.density), 0.1);
    const bW   = W / windowData.length;
    const PAD  = 14; // bottom padding for labels

    windowData.forEach((d, i) => {
      const x  = i * bW;
      const bH = Math.max(0, (d.density / maxD) * (H - PAD));
      const y  = H - bH - 2;

      ctx.fillStyle = d.over ? '#ff444488' : '#4488ff44';
      ctx.fillRect(x + 0.5, y, Math.max(bW - 1, 1), bH);

      // Highlight the portion that would be removed
      if (d.toRemove > 0 && d.totalNotes > 0) {
        ctx.fillStyle = '#ffaa3355';
        ctx.fillRect(x + 0.5, y, Math.max(bW - 1, 1), bH * (d.toRemove / d.totalNotes));
      }
    });

    // Threshold line
    const ty = H - (threshold / maxD) * (H - PAD) - 2;
    ctx.save();
    ctx.strokeStyle = '#ff8080cc';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ff8080';
    ctx.font = '8px monospace';
    ctx.fillText(`${parseFloat(threshSlider.value).toFixed(1)} n/b`, 3, Math.max(ty - 3, 10));

    // Edge measure labels
    ctx.fillStyle = '#445';
    ctx.font = '8px monospace';
    ctx.fillText('M1', 2, H - 1);
    const lastLabel = `M${windowData.length * parseInt(winSel.value)}`;
    ctx.fillText(lastLabel, W - lastLabel.length * 5.2, H - 1);
  }

  applyBtn.addEventListener('click', () => {
    if (!_staged || !_staged.length) return;
    const ch = (typeof chart !== 'undefined') ? chart : null;
    if (!ch) return;

    if (typeof saveUndo === 'function') saveUndo('Adaptive Pattern Compression');

    // Group removals by lane, use object reference equality to avoid index drift
    const btByLane = Array.from({ length: 4 }, () => []);
    const fxByLane = Array.from({ length: 2 }, () => []);
    for (const { note, type, lane } of _staged) {
      if (type === 'bt') btByLane[lane].push(note);
      else               fxByLane[lane].push(note);
    }

    for (let l = 0; l < 4; l++) {
      for (const note of btByLane[l]) {
        const idx = ch.bt[l].indexOf(note);
        if (idx >= 0) ch.bt[l].splice(idx, 1);
      }
    }
    for (let l = 0; l < 2; l++) {
      for (const note of fxByLane[l]) {
        const idx = ch.fx[l].indexOf(note);
        if (idx >= 0) ch.fx[l].splice(idx, 1);
      }
    }

    const n = _staged.length;
    statusEl.innerHTML =
      `<span style="color:#44ff88">✓ Removed ${n} chip note${n!==1?'s':''}. Press <kbd>Ctrl+Z</kbd> to undo.</span>`;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    _clearStage();
    if (typeof render === 'function') render();
  });

  threshSlider.addEventListener('input', () => {
    threshDisp.textContent = parseFloat(threshSlider.value).toFixed(1);
    _clearStage();
  });
  winSel.addEventListener('change', _clearStage);
  analyzeBtn.addEventListener('click', analyze);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTools);
} else {
  initTools();
}
