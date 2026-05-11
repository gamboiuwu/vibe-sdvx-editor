'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   vibe-editr  ·  DockManager  v2
   Photoshop / Clip Studio Paint–style dockable workspace.

   Layout
   ────────────────────────────────────────────────────
   body (flex-col)
     #topbar
     #tab-bar
     #ws-root  (flex-col, flex:1)
       #ws-main-row  (flex-row, flex:1)
         #ws-dock-left   (hidden until panel docked)
         #ws-center      (flex-col, flex:1)
           #toolbar
           #ctx-palette  (tool options bar)
           #ws-edit-area (flex:1 — houses #main + #game-wrap)
         #ws-dock-right  (default home of #panel-fx)
       #ws-dock-bottom   (full-width, hidden by default)
   ════════════════════════════════════════════════════ */

/* ── Constants ──────────────────────────────────────────────────────────────*/
const DOCK_KEY      = 'vibe_dock_layout_v2';
const DOCK_SNAP_PX  = 60;
const DOCK_ANIM_MS  = 180;
const DOCK_MIN_PX   = 140;
const DOCK_DEF_SIZE = { left: 260, right: 272, bottom: 180 };
const DOCK_REGION_IDS = ['left', 'right', 'bottom'];

/* ── State ──────────────────────────────────────────────────────────────────*/
// Use unique-prefixed names to avoid clashing with other scripts' globals.
const _dkPanels   = {};   // panelId → PanelRecord
const _dkRegions  = {};   // 'left'|'right'|'bottom' → RegionRecord
let   _dkDrag     = null; // active drag state
let   _dkSnap     = null; // snap overlay element
let   _dkReady    = false;// true after dockInit runs

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC API
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Register a panel element with the dock manager.
 * Must be called BEFORE dockApplyLayout().
 * @param {string}  id             Unique key
 * @param {Element} el             The panel's root DOM element
 * @param {string}  label          Tab / window title
 * @param {string}  icon           Emoji icon
 * @param {string}  defaultRegion  'left'|'right'|'bottom'|'float'
 */
function dockRegister(id, el, label, icon, defaultRegion, opts = {}) {
  _dkPanels[id] = {
    id, el, label, icon,
    region: null,
    floatEl: null,
    floatX: opts.floatX ?? 120,
    floatY: opts.floatY ?? 80,
    floatW: opts.floatW ?? 340,
    floatH: opts.floatH ?? 500,
    _default: defaultRegion,
    // nativeFloat: panel element uses display:flex internally (e.g. .tw-window).
    // The dock wraps it in dp-float like any other panel; CSS neutralises
    // position:fixed and hides the panel's own chrome inside that wrapper.
    nativeFloat: opts.nativeFloat ?? false,
  };
}

/**
 * Apply layout after all panels have been registered.
 * Restores saved state from localStorage, or uses each panel's defaultRegion.
 */
function dockApplyLayout() {
  if (!_dkReady) { console.warn('[dock] dockApplyLayout called before dockInit'); return; }
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null'); } catch {}

  if (saved) {
    // Restore region sizes
    for (const id of DOCK_REGION_IDS) {
      if (saved.regions?.[id]?.size && _dkRegions[id]) {
        _dkRegions[id].size = saved.regions[id].size;
      }
    }
    // Dock panels into their saved regions
    for (const id of DOCK_REGION_IDS) {
      const savedRegion = saved.regions?.[id];
      if (!savedRegion?.panelIds) continue;
      for (const pid of savedRegion.panelIds) {
        if (_dkPanels[pid]) _dkDockPanel(pid, id);
      }
    }
    // Float panels
    for (const [pid, fs] of Object.entries(saved.floats ?? {})) {
      if (!_dkPanels[pid] || _dkPanels[pid].region) continue; // already placed
      if (fs.hidden) continue;
      const rec = _dkPanels[pid];
      rec.floatX = fs.x ?? 120;
      rec.floatY = fs.y ?? 80;
      rec.floatW = fs.w ?? 340;
      rec.floatH = fs.h ?? 500;
      _dkFloatPanel(pid);
      if (!fs.visible) rec.floatEl.style.display = 'none';
    }
  }

  // Any panel still unplaced → use default
  for (const rec of Object.values(_dkPanels)) {
    if (rec.region) continue;
    if (rec._default === 'float') {
      _dkFloatPanel(rec.id);
    } else if (rec._default) {
      _dkDockPanel(rec.id, rec._default);
    }
  }
}

/** Float a panel (detach from region, show as free window). */
function dockFloat(id) { _dkFloatPanel(id); _dkSave(); }

/** Dock a panel into a region. */
function dockTo(id, regionId) { _dkDockPanel(id, regionId); _dkSave(); }

/** Toggle panel: if floating → show/hide; if docked → undock+float; if hidden → float. */
function dockToggle(id) {
  const rec = _dkPanels[id];
  if (!rec) return;

  if (rec.region === 'float' && rec.floatEl) {
    const hidden = rec.floatEl.style.display === 'none';
    rec.floatEl.style.display = hidden ? 'flex' : 'none';
    _dkSave();
    return;
  }
  if (rec.region && rec.region !== 'float') {
    _dkUndock(id);
    _dkFloatPanel(id);
  } else {
    _dkFloatPanel(id);
  }
  _dkSave();
}

/* ─────────────────────────────────────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────────────────────────────────── */

function dockInit() {
  _dkBuildWorkspace();
  _dkBuildRegions();
  _dkBuildContextPalette();
  _dkBuildSnapOverlay();
  _dkReady = true;
}

/* ─────────────────────────────────────────────────────────────────────────────
   WORKSPACE RESTRUCTURING
   ───────────────────────────────────────────────────────────────────────── */

function _dkBuildWorkspace() {
  const toolbar  = document.getElementById('toolbar');
  const main     = document.getElementById('main');
  const gameWrap = document.getElementById('game-wrap');
  if (!toolbar || !main) return;

  // Create outer column wrapper
  const wsRoot = _mk('div', 'ws-root', 'ws-root');
  document.body.appendChild(wsRoot);

  // Horizontal row: left + center + right
  const wsRow = _mk('div', 'ws-main-row', 'ws-main-row');
  wsRoot.appendChild(wsRow);

  const wsLeft = _mk('div', 'ws-dock-slot ws-dock-left', 'ws-dock-left');
  wsRow.appendChild(wsLeft);

  const wsCenter = _mk('div', 'ws-center', 'ws-center');
  wsRow.appendChild(wsCenter);

  const wsRight = _mk('div', 'ws-dock-slot ws-dock-right', 'ws-dock-right');
  wsRow.appendChild(wsRight);

  // Bottom strip (full width, below the row)
  const wsBottom = _mk('div', 'ws-dock-slot ws-dock-bottom', 'ws-dock-bottom');
  wsRoot.appendChild(wsBottom);

  // Populate center: toolbar → ctx-palette → edit-area
  wsCenter.appendChild(toolbar);
  const ctxPal = _mk('div', 'ctx-palette', 'ctx-palette');
  wsCenter.appendChild(ctxPal);

  const editArea = _mk('div', 'ws-edit-area', 'ws-edit-area');
  editArea.appendChild(main);
  if (gameWrap) editArea.appendChild(gameWrap);
  wsCenter.appendChild(editArea);
}

/* ─────────────────────────────────────────────────────────────────────────────
   DOCK REGIONS
   ───────────────────────────────────────────────────────────────────────── */

function _dkBuildRegions() {
  const slotIds = { left: 'ws-dock-left', right: 'ws-dock-right', bottom: 'ws-dock-bottom' };

  for (const id of DOCK_REGION_IDS) {
    const slot = document.getElementById(slotIds[id]);
    if (!slot) continue;

    const tabBar = _mk('div', 'dr-tabbar');
    const content = _mk('div', 'dr-content');
    const handle  = _mk('div', `dr-handle dr-handle-${id}`);

    slot.appendChild(tabBar);
    slot.appendChild(content);
    slot.appendChild(handle);

    _dkRegions[id] = {
      id, slot, tabBarEl: tabBar, contentEl: content, handleEl: handle,
      panelIds: [], activeIdx: 0,
      size: DOCK_DEF_SIZE[id] ?? 260,
    };

    _dkWireResize(id);
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   PANEL DOCKING / FLOATING / UNDOCKING
   ───────────────────────────────────────────────────────────────────────── */

function _dkDockPanel(panelId, regionId) {
  const rec    = _dkPanels[panelId];
  const region = _dkRegions[regionId];
  if (!rec || !region) return;

  _dkUndock(panelId, true);
  if (rec.floatEl) rec.floatEl.style.display = 'none';

  // tw-window panels need display:flex to preserve their internal column layout
  const disp = rec.nativeFloat ? 'flex;flex-direction:column' : 'block';
  rec.el.style.cssText = `width:100%;height:100%;overflow:hidden;display:${disp};`;
  region.contentEl.appendChild(rec.el);

  rec.region = regionId;
  region.panelIds.push(panelId);
  region.activeIdx = region.panelIds.length - 1;

  // Show region
  _dkApplySize(regionId);
  region.slot.style.display = 'flex';

  _dkRebuildTabs(regionId);
  _dkActivateTab(regionId, region.activeIdx);
  _dkAnimSnap(rec.el);
}

function _dkFloatPanel(panelId, x, y) {
  const rec = _dkPanels[panelId];
  if (!rec) return;

  _dkUndock(panelId, true);

  if (!rec.floatEl) _dkMakeFloat(rec);

  if (x !== undefined) { rec.floatX = x; rec.floatEl.style.left = x + 'px'; }
  if (y !== undefined) { rec.floatY = y; rec.floatEl.style.top  = y + 'px'; }

  // Ensure el is inside float window
  if (!rec.floatEl.contains(rec.el)) {
    // tw-window needs display:flex to preserve column layout; others use block
    const disp = rec.nativeFloat ? 'flex' : 'block';
    rec.el.style.cssText = `flex:1;overflow:hidden;display:${disp};min-height:0;`;
    rec.floatEl.appendChild(rec.el);
  }
  rec.floatEl.style.display = 'flex';
  rec.region = 'float';
}

function _dkUndock(panelId, silent) {
  const rec = _dkPanels[panelId];
  if (!rec || !rec.region) return;

  if (rec.region !== 'float') {
    const region = _dkRegions[rec.region];
    if (region) {
      const idx = region.panelIds.indexOf(panelId);
      if (idx >= 0) region.panelIds.splice(idx, 1);
      region.activeIdx = Math.max(0, Math.min(region.activeIdx, region.panelIds.length - 1));
      if (!region.panelIds.length) {
        region.slot.style.display = 'none';
      } else {
        _dkRebuildTabs(rec.region);
        _dkActivateTab(rec.region, region.activeIdx);
      }
    }
    // Detach el from content area
    if (rec.el.parentNode === _dkRegions[rec.region]?.contentEl) rec.el.remove();
  }

  rec.region = null;
  if (!silent) _dkSave();
}

/* ─────────────────────────────────────────────────────────────────────────────
   FLOAT WINDOW CHROME
   ───────────────────────────────────────────────────────────────────────── */

function _dkMakeFloat(rec) {
  const win = _mk('div', 'dp-float', `dp-float-${rec.id}`);
  Object.assign(win.style, {
    left: rec.floatX + 'px', top: rec.floatY + 'px',
    width: rec.floatW + 'px', height: rec.floatH + 'px',
  });

  // Title bar
  const tb    = _mk('div', 'dp-float-titlebar');
  const icon  = _mk('span', 'dp-float-icon');  icon.textContent = rec.icon;
  const lbl   = _mk('span', 'dp-float-label'); lbl.textContent  = rec.label;
  const acts  = _mk('div', 'dp-float-actions');

  const btnDock  = _mk('button', 'dp-float-btn', null, '⊞ Dock');
  btnDock.title  = 'Dock to right panel';
  const btnClose = _mk('button', 'dp-float-btn dp-float-btn-close', null, '✕');
  btnClose.title = 'Close';

  acts.appendChild(btnDock);
  acts.appendChild(btnClose);
  tb.appendChild(icon); tb.appendChild(lbl); tb.appendChild(acts);
  win.appendChild(tb);

  // Content placeholder (el appended by _dkFloatPanel)
  const resizeH = _mk('div', 'dp-float-resize');
  win.appendChild(resizeH);

  document.body.appendChild(win);
  rec.floatEl = win;

  // Events
  btnClose.addEventListener('click', () => {
    win.style.display = 'none'; _dkSave();
  });
  btnDock.addEventListener('click', () => {
    // Prefer right, then left, then bottom
    for (const r of ['right', 'left', 'bottom']) {
      if (_dkRegions[r] && _dkRegions[r].panelIds.length < 6) {
        _dkDockPanel(rec.id, r); _dkSave(); return;
      }
    }
  });

  // Draggable title bar → use dock's drag system
  tb.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    _dkStartDrag(rec.id, e, win.offsetLeft, win.offsetTop);
    e.preventDefault();
  });

  // Resizable corner
  _dkWireFloatResize(win, resizeH, rec);
}

function _dkWireFloatResize(win, handle, rec) {
  let on = false, sx, sy, sw, sh;
  handle.addEventListener('mousedown', e => {
    on = true; sx = e.clientX; sy = e.clientY;
    sw = win.offsetWidth; sh = win.offsetHeight;
    e.preventDefault(); e.stopPropagation();
    document.body.style.cursor = 'se-resize';
  });
  document.addEventListener('mousemove', e => {
    if (!on) return;
    const nw = Math.max(200, sw + e.clientX - sx);
    const nh = Math.max(100, sh + e.clientY - sy);
    win.style.width  = nw + 'px'; rec.floatW = nw;
    win.style.height = nh + 'px'; rec.floatH = nh;
  });
  document.addEventListener('mouseup', () => {
    if (on) { on = false; document.body.style.cursor = ''; _dkSave(); }
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   DRAG SYSTEM
   ───────────────────────────────────────────────────────────────────────── */

function _dkStartDrag(panelId, e, startLeft, startTop) {
  const rec = _dkPanels[panelId];
  if (!rec) return;

  const ghost = _mk('div', 'dp-drag-ghost');
  ghost.textContent = rec.icon + '  ' + rec.label;
  ghost.style.left = (e.clientX - 80) + 'px';
  ghost.style.top  = (e.clientY - 14) + 'px';
  document.body.appendChild(ghost);

  _dkDrag = {
    panelId, ghost,
    dx: e.clientX - (startLeft || 0),
    dy: e.clientY - (startTop  || 0),
    zone: null,
  };

  document.addEventListener('mousemove', _dkOnDragMove);
  document.addEventListener('mouseup',   _dkOnDragEnd);
  document.body.style.userSelect = 'none';
}

function _dkOnDragMove(e) {
  if (!_dkDrag) return;
  _dkDrag.ghost.style.left = (e.clientX - 80) + 'px';
  _dkDrag.ghost.style.top  = (e.clientY - 14) + 'px';

  // Move float window if it's floating
  const rec = _dkPanels[_dkDrag.panelId];
  if (rec?.region === 'float' && rec.floatEl) {
    const nx = e.clientX - _dkDrag.dx;
    const ny = e.clientY - _dkDrag.dy;
    rec.floatEl.style.left = Math.max(0, nx) + 'px';
    rec.floatEl.style.top  = Math.max(0, ny) + 'px';
  }

  const zone = _dkDetectZone(e.clientX, e.clientY);
  if (zone !== _dkDrag.zone) {
    _dkDrag.zone = zone;
    _dkShowSnap(zone, e.clientX, e.clientY);
  }
}

function _dkOnDragEnd(e) {
  if (!_dkDrag) return;
  const { panelId, ghost, zone } = _dkDrag;

  document.removeEventListener('mousemove', _dkOnDragMove);
  document.removeEventListener('mouseup',   _dkOnDragEnd);
  document.body.style.userSelect = '';
  ghost.remove();
  _dkHideSnap();
  _dkDrag = null;

  const rec = _dkPanels[panelId];
  if (!rec) return;

  if (zone && DOCK_REGION_IDS.includes(zone)) {
    _dkDockPanel(panelId, zone);
  } else if (rec.region === 'float' && rec.floatEl) {
    // Already moved during mousemove — save new position
    rec.floatX = parseInt(rec.floatEl.style.left) || rec.floatX;
    rec.floatY = parseInt(rec.floatEl.style.top)  || rec.floatY;
  } else if (!zone && rec.region && rec.region !== 'float') {
    // Dragged off a region with no target → float it
    _dkFloatPanel(panelId, Math.max(0, e.clientX - 120), Math.max(0, e.clientY - 20));
  }

  _dkSave();
}

function _dkDetectZone(x, y) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (x < DOCK_SNAP_PX) return 'left';
  if (x > vw - DOCK_SNAP_PX) return 'right';
  if (y > vh - DOCK_SNAP_PX) return 'bottom';
  // Over an existing visible region?
  for (const id of DOCK_REGION_IDS) {
    const r = _dkRegions[id];
    if (!r || !r.panelIds.length) continue;
    const rect = r.slot.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return id;
  }
  return null;
}

function _dkShowSnap(zone, mx, my) {
  if (!_dkSnap) return;
  if (!zone) { _dkSnap.style.display = 'none'; return; }

  const vw = window.innerWidth, vh = window.innerHeight;
  // Compute topbar height to start snap zones below it
  const hdrH = (document.getElementById('topbar')?.offsetHeight ?? 38) +
               (document.getElementById('tab-bar')?.offsetHeight ?? 30);

  let rect;
  if (zone === 'left')   rect = { l: 0,        t: hdrH,      w: 260,     h: vh - hdrH };
  else if (zone === 'right')  rect = { l: vw - 272, t: hdrH,      w: 272,     h: vh - hdrH };
  else if (zone === 'bottom') rect = { l: 0,        t: vh - 180,  w: vw,      h: 180       };
  else {
    const r = _dkRegions[zone];
    if (!r) { _dkSnap.style.display = 'none'; return; }
    const rb = r.slot.getBoundingClientRect();
    rect = { l: rb.left, t: rb.top, w: rb.width, h: rb.height };
  }

  Object.assign(_dkSnap.style, {
    display: 'block',
    left:   rect.l + 'px', top:    rect.t + 'px',
    width:  rect.w + 'px', height: rect.h + 'px',
  });
}

function _dkHideSnap() {
  if (_dkSnap) _dkSnap.style.display = 'none';
}

function _dkBuildSnapOverlay() {
  _dkSnap = _mk('div', 'dock-snap-overlay', 'dock-snap-overlay');
  _dkSnap.style.display = 'none';
  document.body.appendChild(_dkSnap);
}

/* ─────────────────────────────────────────────────────────────────────────────
   TAB MANAGEMENT
   ───────────────────────────────────────────────────────────────────────── */

function _dkRebuildTabs(regionId) {
  const region = _dkRegions[regionId];
  if (!region) return;
  const bar = region.tabBarEl;
  bar.innerHTML = '';

  // Region label pill
  const lbl = _mk('span', 'dr-region-label');
  lbl.textContent = regionId.charAt(0).toUpperCase() + regionId.slice(1);
  bar.appendChild(lbl);

  // Tab buttons
  const grp = _mk('div', 'dr-tab-group');
  bar.appendChild(grp);
  region.panelIds.forEach((pid, i) => {
    const p = _dkPanels[pid];
    if (!p) return;
    const tab = _mk('button', 'dr-tab');
    tab.textContent = p.icon + ' ' + p.label;
    tab.title = p.label;
    tab.addEventListener('click', () => _dkActivateTab(regionId, i));
    grp.appendChild(tab);
  });

  // Float-out button
  const fBtn = _mk('button', 'dr-tab-float-btn', null, '⊟');
  fBtn.title = 'Float active panel';
  fBtn.addEventListener('click', () => {
    const pid = region.panelIds[region.activeIdx];
    if (pid) { _dkFloatPanel(pid); _dkSave(); }
  });
  bar.appendChild(fBtn);
}

function _dkActivateTab(regionId, idx) {
  const region = _dkRegions[regionId];
  if (!region) return;
  region.activeIdx = Math.max(0, Math.min(idx, region.panelIds.length - 1));

  // Show only active panel's content
  region.panelIds.forEach((pid, i) => {
    const p  = _dkPanels[pid];
    const el = p?.el;
    if (!el) return;
    const show = i === region.activeIdx;
    el.style.display = show ? (p.nativeFloat ? 'flex' : 'block') : 'none';
  });

  // Highlight active tab
  region.tabBarEl.querySelectorAll('.dr-tab').forEach((t, i) =>
    t.classList.toggle('dr-tab-active', i === region.activeIdx)
  );

  // Ensure active panel has a drag handle
  const activePid = region.panelIds[region.activeIdx];
  if (activePid) _dkEnsureDragHandle(activePid, regionId);
}

function _dkEnsureDragHandle(panelId, regionId) {
  const rec = _dkPanels[panelId];
  if (!rec || !rec.el) return;
  if (rec.el.querySelector('.dp-drag-handle')) return;

  const handle = _mk('div', 'dp-drag-handle');
  const grip   = _mk('span', 'dp-drag-grip'); grip.textContent = '⋮⋮';
  const lbl    = _mk('span', 'dp-drag-title'); lbl.textContent = rec.label;
  handle.appendChild(grip); handle.appendChild(lbl);
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    _dkStartDrag(panelId, e, rec.el.parentNode?.closest('.ws-dock-slot')?.offsetLeft ?? 0, 0);
    e.preventDefault();
  });
  rec.el.insertBefore(handle, rec.el.firstChild);
}


/* ─────────────────────────────────────────────────────────────────────────────
   REGION RESIZE
   ───────────────────────────────────────────────────────────────────────── */

function _dkApplySize(regionId) {
  const r = _dkRegions[regionId];
  if (!r) return;
  if (regionId === 'left' || regionId === 'right') {
    r.slot.style.width    = r.size + 'px';
    r.slot.style.minWidth = r.size + 'px';
    r.slot.style.maxWidth = '';
  } else if (regionId === 'bottom') {
    r.slot.style.height    = r.size + 'px';
    r.slot.style.minHeight = r.size + 'px';
  }
}

function _dkWireResize(regionId) {
  const r = _dkRegions[regionId];
  if (!r) return;
  const handle = r.handleEl;
  let on = false, startMouse, startSize;

  handle.addEventListener('mousedown', e => {
    on = true;
    startMouse = (regionId === 'bottom') ? e.clientY : e.clientX;
    startSize  = r.size;
    e.preventDefault();
    document.body.style.cursor = (regionId === 'bottom') ? 'ns-resize' : 'ew-resize';
  });
  document.addEventListener('mousemove', e => {
    if (!on) return;
    const delta = regionId === 'bottom'  ? startMouse - e.clientY
                : regionId === 'right'   ? startMouse - e.clientX
                :                          e.clientX - startMouse;
    r.size = Math.max(DOCK_MIN_PX, startSize + delta);
    _dkApplySize(regionId);
    window.dispatchEvent(new Event('resize')); // trigger canvas resize
  });
  document.addEventListener('mouseup', () => {
    if (on) { on = false; document.body.style.cursor = ''; _dkSave(); }
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   SNAP ANIMATION
   ───────────────────────────────────────────────────────────────────────── */

function _dkAnimSnap(el) {
  el.classList.remove('dp-snap-anim');
  void el.offsetWidth;
  el.classList.add('dp-snap-anim');
  setTimeout(() => el.classList.remove('dp-snap-anim'), DOCK_ANIM_MS + 60);
}

/* ─────────────────────────────────────────────────────────────────────────────
   LAYOUT PERSISTENCE
   ───────────────────────────────────────────────────────────────────────── */

function _dkSave() {
  const state = { regions: {}, floats: {} };
  for (const id of DOCK_REGION_IDS) {
    const r = _dkRegions[id];
    if (r) state.regions[id] = { panelIds: [...r.panelIds], activeIdx: r.activeIdx, size: r.size };
  }
  for (const rec of Object.values(_dkPanels)) {
    if (rec.region === 'float' && rec.floatEl) {
      state.floats[rec.id] = {
        x: rec.floatEl.offsetLeft, y: rec.floatEl.offsetTop,
        w: rec.floatEl.offsetWidth, h: rec.floatEl.offsetHeight,
        visible: rec.floatEl.style.display !== 'none',
      };
    }
  }
  try { localStorage.setItem(DOCK_KEY, JSON.stringify(state)); } catch {}
}

/* ─────────────────────────────────────────────────────────────────────────────
   CONTEXT PALETTE  (Adobe-style tool options bar)
   ───────────────────────────────────────────────────────────────────────── */

function _dkBuildContextPalette() {
  // Palette is created as a placeholder div in _dkBuildWorkspace;
  // content is populated by updateContextPalette() called from app.js.
}

function updateContextPalette(toolName) {
  const palette = document.getElementById('ctx-palette');
  if (!palette) return;
  palette.innerHTML = '';

  const configs = {
    select: {
      label: 'Selection', items: [
        { type:'btngroup', id:'ctx-sel-mode',
          btns:[{v:'rect',l:'▭ Rect'},{v:'measure',l:'📐 Meas'}], def:'rect' },
        { type:'sep' },
        { type:'snapdisp' },
      ],
    },
    bt: {
      label: 'BT Note', color:'#d8d8f0', items: [
        { type:'label',  text:'Lane:' },
        { type:'btngroup', id:'ctx-bt-lane',
          btns:[{v:'A',l:'A'},{v:'B',l:'B'},{v:'C',l:'C'},{v:'D',l:'D'},{v:'any',l:'Auto'}], def:'any' },
        { type:'sep' },
        { type:'toggle', id:'ctx-bt-hold', label:'Auto-hold on drag', def:true },
      ],
    },
    fx: {
      label: 'FX Note', color:'var(--fx)', items: [
        { type:'label', text:'Effect:' },
        { type:'select', id:'ctx-fx-type',
          opts:[{v:'retrigger',l:'Retrigger'},{v:'gate',l:'Gate'},{v:'flanger',l:'Flanger'},
                {v:'pitchshift',l:'PitchShift'},{v:'bitcrusher',l:'BitCrusher'},{v:'phaser',l:'Phaser'},
                {v:'wobble',l:'Wobble'},{v:'tapestop',l:'TapeStop'},{v:'echo',l:'Echo'},{v:'sidechain',l:'SideChain'}],
          onChange: v => { const m=document.getElementById('fx-type-select'); if(m)m.value=v; },
        },
        { type:'sep' },
        { type:'label', text:'Lane:' },
        { type:'btngroup', id:'ctx-fx-lane',
          btns:[{v:'l',l:'FX-L'},{v:'r',l:'FX-R'},{v:'any',l:'Auto'}], def:'any' },
      ],
    },
    'laser-l': {
      label: 'Left Laser', color:'var(--laser-l)',
      items: _dkLaserItems('L'),
    },
    'laser-r': {
      label: 'Right Laser', color:'var(--laser-r)',
      items: _dkLaserItems('R'),
    },
    erase: {
      label: 'Erase', items: [
        { type:'label', text:'Target:' },
        { type:'btngroup', id:'ctx-erase-target',
          btns:[{v:'all',l:'All'},{v:'bt',l:'BT'},{v:'fx',l:'FX'},{v:'laser',l:'VOL'}], def:'all' },
      ],
    },
  };

  const cfg = configs[toolName];
  palette.style.display = cfg ? 'flex' : 'none';
  if (!cfg) return;

  // Tool badge
  const badge = _mk('span', 'ctx-tool-badge');
  badge.textContent = cfg.label;
  if (cfg.color) badge.style.color = cfg.color;
  palette.appendChild(badge);
  palette.appendChild(_mk('span', 'ctx-sep'));

  (cfg.items || []).forEach(item => {
    switch (item.type) {
      case 'label': {
        const l = _mk('span', 'ctx-label'); l.textContent = item.text;
        palette.appendChild(l); break;
      }
      case 'sep':
        palette.appendChild(_mk('span', 'ctx-sep')); break;

      case 'btngroup': {
        const grp = _mk('div', 'ctx-btngroup');
        const cur = _dkCtxGet(item.id, item.def);
        item.btns.forEach(b => {
          const btn = _mk('button', 'ctx-btn' + (cur === b.v ? ' ctx-btn-active' : ''));
          btn.textContent = b.l; btn.title = b.l;
          btn.addEventListener('click', () => {
            grp.querySelectorAll('.ctx-btn').forEach(x => x.classList.remove('ctx-btn-active'));
            btn.classList.add('ctx-btn-active');
            _dkCtxSet(item.id, b.v);
            item.onChange?.(b.v);
          });
          grp.appendChild(btn);
        });
        palette.appendChild(grp); break;
      }
      case 'toggle': {
        const wrap = document.createElement('label');
        wrap.className = 'ctx-toggle-wrap';
        const chk = document.createElement('input'); chk.type = 'checkbox';
        chk.checked = _dkCtxGet(item.id, item.def);
        chk.addEventListener('change', () => { _dkCtxSet(item.id, chk.checked); item.onChange?.(chk.checked); });
        const ll = _mk('span', 'ctx-toggle-lbl'); ll.textContent = item.label;
        wrap.appendChild(chk); wrap.appendChild(ll);
        palette.appendChild(wrap); break;
      }
      case 'range': {
        const wrap = _mk('div', 'ctx-range-wrap');
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = item.min ?? 0; sl.max = item.max ?? 100;
        sl.value = _dkCtxGet(item.id, item.def ?? 50);
        const vl = _mk('span', 'ctx-range-val');
        vl.textContent = item.fmt ? item.fmt(+sl.value) : sl.value;
        sl.addEventListener('input', () => {
          _dkCtxSet(item.id, +sl.value);
          vl.textContent = item.fmt ? item.fmt(+sl.value) : sl.value;
          item.onChange?.(+sl.value);
        });
        wrap.appendChild(sl); wrap.appendChild(vl);
        palette.appendChild(wrap); break;
      }
      case 'select': {
        const sel = document.createElement('select');
        sel.className = 'ctx-select';
        const saved = _dkCtxGet(item.id, item.opts[0]?.v);
        item.opts.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.v; opt.textContent = o.l;
          if (o.v === saved) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => { _dkCtxSet(item.id, sel.value); item.onChange?.(sel.value); });
        palette.appendChild(sel); break;
      }
      case 'btn': {
        const btn = _mk('button', 'ctx-action-btn', item.id, item.label);
        btn.title = item.title || item.label;
        btn.addEventListener('click', () => item.onClick?.());
        palette.appendChild(btn); break;
      }
      case 'snapdisp': {
        const sd = _mk('span', 'ctx-snap-disp', 'ctx-snap-disp');
        sd.textContent = '1/16';
        palette.appendChild(sd); break;
      }
    }
  });
}

function _dkLaserItems(side) {
  return [
    { type:'label', text:'Pen:' },
    { type:'btngroup', id:`ctx-laser-${side}-mode`,
      btns:[{v:'linear',l:'Linear'},{v:'bezier',l:'Bezier'},{v:'step',l:'Step'}], def:'linear',
      onChange: v => { window._dkLaserMode = v; },
    },
    { type:'sep' },
    { type:'label', text:'Curve:' },
    { type:'range', id:`ctx-laser-${side}-curve`, min:0, max:100, def:50,
      fmt: v => v + '%',
      onChange: v => { window._ctxLaserCurve = v / 100; },
    },
    { type:'sep' },
    { type:'toggle', id:`ctx-laser-${side}-wide`, label:'2× Wide', def:false,
      onChange: v => {
        const c = document.getElementById('laser-wide');
        if (c) { c.checked = v; c.dispatchEvent(new Event('change')); }
      },
    },
    { type:'sep' },
    { type:'btn', id:`ctx-laser-${side}-smooth`, label:'〜 Smooth',
      title:'Apply Chaikin smoothing to active laser',
      onClick: () => { if (typeof _smoothActiveLaser === 'function') _smoothActiveLaser(); },
    },
  ];
}

// Tiny context-state helpers (sessionStorage — reset each tab)
function _dkCtxGet(id, def) {
  try { const v = sessionStorage.getItem('dkctx_' + id); return v !== null ? JSON.parse(v) : def; }
  catch { return def; }
}
function _dkCtxSet(id, val) {
  try { sessionStorage.setItem('dkctx_' + id, JSON.stringify(val)); } catch {}
}

/** Call from app.js syncSnapUI to keep the snap display current. */
function updateSnapDisplay(label) {
  const sd = document.getElementById('ctx-snap-disp');
  if (sd) sd.textContent = label;
}

/* ─────────────────────────────────────────────────────────────────────────────
   DOM HELPER  (name-safe: _mk instead of _el)
   ───────────────────────────────────────────────────────────────────────── */

function _mk(tag, cls, id, text) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (id)   e.id = id;
  if (text !== undefined) e.textContent = text;
  return e;
}

/* ─────────────────────────────────────────────────────────────────────────────
   BOOTSTRAP
   ───────────────────────────────────────────────────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', dockInit);
} else {
  dockInit();
}

// Expose public API to window
window.dockRegister         = dockRegister;
window.dockApplyLayout      = dockApplyLayout;
window.dockTo               = dockTo;
window.dockFloat            = dockFloat;
window.dockToggle           = dockToggle;
window.updateContextPalette = updateContextPalette;
window.updateSnapDisplay    = updateSnapDisplay;
