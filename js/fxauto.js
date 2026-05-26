import { TICKS_PER_MEASURE, TICKS_PER_BEAT } from './chart.js';
import { render, saveUndo, chart } from './app.js';

// ── FX Effect Automation Lane Editor ─────────────────────────────────────────
// Floating panel for drawing per-tick FX mix-level automation curves.
// Data is stored on chart._fxAutomation = { L: [...], R: [...] }
// Each entry: { y: <tick>, v: 0..1, m: 'step'|'linear' }
// ─────────────────────────────────────────────────────────────────────────────

const WIN_ID  = 'fxauto-win';
const STORE   = 'vibe-fxauto-win';
const PAD     = { top: 36, bottom: 20, left: 28, right: 12 };
const PT_R    = 6;   // breakpoint circle radius
const SNAP_PX = 4;   // px tolerance for point hit testing

let _win     = null;
let _canvas  = null;
let _ctx     = null;
let _side    = 'L';  // 'L' | 'R'
let _drag    = null; // { idx, ox, oy }
let _raf     = null;
let _dirty   = true;
let _viewStart = 0;
let _viewEnd   = 192 * 64;

// ── Public API ────────────────────────────────────────────────────────────────

export function openFxAutoWindow() {
  if (!_win) _build();
  _win.style.display = 'flex';
  _syncSideButtons();
  _ensureDefault();
  _startLoop();
  invalidateFxAuto();
}

export function closeFxAutoWindow() {
  if (_win) _win.style.display = 'none';
  _stopLoop();
}

export function toggleFxAutoWindow() {
  if (!_win) _build();
  if (_win.style.display === 'none') openFxAutoWindow();
  else closeFxAutoWindow();
}

export function invalidateFxAuto() { _dirty = true; }

export function getFxAutoData(c) {
  if (!c._fxAutomation) c._fxAutomation = { L: [], R: [] };
  return c._fxAutomation;
}

// ── Init / build ──────────────────────────────────────────────────────────────

function _build() {
  const win = document.createElement('div');
  win.id = WIN_ID;
  win.className = 'float-win';
  win.style.cssText = `
    display:none; position:fixed; flex-direction:column;
    left:120px; top:120px; width:560px; min-height:220px;
    background:#0d0d22; border:1px solid #3344aa; border-radius:6px;
    box-shadow:0 8px 32px #000a; z-index:1800; user-select:none;
    font-family:monospace; color:#ccd;
  `;

  win.innerHTML = `
    <div class="float-win-title" style="
      background:#14143a; padding:7px 12px; border-radius:6px 6px 0 0;
      display:flex; align-items:center; gap:8px; cursor:move; flex-shrink:0;
    ">
      <span style="flex:1;font-weight:bold;font-size:13px">⚡ FX Effect Automation</span>
      <button id="fxauto-side-L" style="
        background:#1a2255; border:1px solid #3355cc; border-radius:3px;
        color:#88aaff; padding:2px 10px; cursor:pointer; font-size:11px;
      ">FX-L</button>
      <button id="fxauto-side-R" style="
        background:#1a1a2a; border:1px solid #446; border-radius:3px;
        color:#aa88cc; padding:2px 10px; cursor:pointer; font-size:11px;
      ">FX-R</button>
      <span style="color:#556;font-size:10px;margin-left:6px">Mix Level</span>
      <button id="fxauto-close" style="
        background:none; border:none; color:#778; cursor:pointer;
        font-size:16px; padding:0 4px; line-height:1;
      ">×</button>
    </div>
    <div style="padding:6px 8px 4px; display:flex; gap:6px; align-items:center; flex-shrink:0; border-bottom:1px solid #223">
      <span style="font-size:10px;color:#668">Click to add · Drag to move · Right-click to delete · Dbl-click to toggle Step/Linear</span>
      <span style="flex:1"></span>
      <button id="fxauto-clear" style="
        background:#2a0010; border:1px solid #662; border-radius:3px;
        color:#aa6666; padding:1px 8px; cursor:pointer; font-size:10px;
      ">Clear All</button>
    </div>
    <canvas id="fxauto-canvas" style="flex:1; min-height:160px; width:100%; cursor:crosshair;"></canvas>
    <div style="display:flex; justify-content:space-between; padding:3px 8px; font-size:9px; color:#446; flex-shrink:0;">
      <span>Click canvas to place breakpoints</span>
      <span id="fxauto-info">0 breakpoints</span>
    </div>
  `;

  document.body.appendChild(win);
  _win = win;
  _canvas = win.querySelector('#fxauto-canvas');
  _ctx = _canvas.getContext('2d');

  // ── Drag to move window ─────────────────────────────────────────────────
  const titleBar = win.querySelector('.float-win-title');
  let _wd = null;
  titleBar.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    _wd = { sx: e.clientX - win.offsetLeft, sy: e.clientY - win.offsetTop };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!_wd) return;
    win.style.left = (e.clientX - _wd.sx) + 'px';
    win.style.top  = (e.clientY - _wd.sy) + 'px';
  });
  document.addEventListener('mouseup', () => { _wd = null; });

  // ── Resize canvas ───────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    _canvas.width  = _canvas.clientWidth  || 540;
    _canvas.height = _canvas.clientHeight || 160;
    _dirty = true;
  });
  ro.observe(_canvas);

  // ── Buttons ─────────────────────────────────────────────────────────────
  win.querySelector('#fxauto-close').addEventListener('click', closeFxAutoWindow);
  win.querySelector('#fxauto-side-L').addEventListener('click', () => { _side = 'L'; _syncSideButtons(); invalidateFxAuto(); });
  win.querySelector('#fxauto-side-R').addEventListener('click', () => { _side = 'R'; _syncSideButtons(); invalidateFxAuto(); });
  win.querySelector('#fxauto-clear').addEventListener('click', () => {
    const c = chart; if (!c) return;
    if (!confirm(`Clear all FX-${_side} automation breakpoints?`)) return;
    saveUndo('Clear FX Automation');
    getFxAutoData(c)[_side] = [];
    invalidateFxAuto();
    render();
  });

  // ── Canvas interactions ─────────────────────────────────────────────────
  _canvas.addEventListener('mousedown', _onMouseDown);
  _canvas.addEventListener('mousemove', _onMouseMove);
  _canvas.addEventListener('mouseup',   _onMouseUp);
  _canvas.addEventListener('contextmenu', _onRightClick);
  _canvas.addEventListener('dblclick',    _onDblClick);
  _canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const total = chart?.totalTicks?.() ?? 192 * 64;
    const range = _viewEnd - _viewStart;
    const delta = range * (e.deltaY > 0 ? 0.15 : -0.15);
    const cx = _xToTick(e.offsetX);
    _viewStart = Math.max(0, _viewStart + delta * ((cx - _viewStart) / range));
    _viewEnd   = Math.min(total, _viewEnd   - delta * ((_viewEnd - cx) / range));
    if (_viewEnd - _viewStart < TICKS_PER_BEAT) { _viewEnd = _viewStart + TICKS_PER_BEAT; }
    invalidateFxAuto();
  }, { passive: false });
}

function _syncSideButtons() {
  if (!_win) return;
  const lBtn = _win.querySelector('#fxauto-side-L');
  const rBtn = _win.querySelector('#fxauto-side-R');
  if (!lBtn || !rBtn) return;
  lBtn.style.background   = _side === 'L' ? '#1a2255' : '#1a1a2a';
  lBtn.style.borderColor  = _side === 'L' ? '#3355cc' : '#446';
  lBtn.style.color        = _side === 'L' ? '#88aaff' : '#668';
  rBtn.style.background   = _side === 'R' ? '#2a1040' : '#1a1a2a';
  rBtn.style.borderColor  = _side === 'R' ? '#8833cc' : '#446';
  rBtn.style.color        = _side === 'R' ? '#cc88ff' : '#668';
}

function _ensureDefault() {
  const c = chart;
  if (!c) return;
  const d = getFxAutoData(c);
  if (d.L.length === 0) d.L.push({ y: 0, v: 1.0, m: 'step' });
  if (d.R.length === 0) d.R.push({ y: 0, v: 1.0, m: 'step' });
  _updateViewRange(c);
}

function _updateViewRange(c) {
  const total = c?.totalTicks?.() ?? 192 * 64;
  if (_viewEnd <= _viewStart || _viewEnd < total * 0.1) {
    _viewStart = 0;
    _viewEnd   = total;
  }
}

// ── Coordinate helpers ────────────────────────────────────────────────────────

function _tickToX(tick) {
  const w = _canvas?.width ?? 540;
  return PAD.left + (tick - _viewStart) / (_viewEnd - _viewStart) * (w - PAD.left - PAD.right);
}

function _xToTick(px) {
  const w = _canvas?.width ?? 540;
  return _viewStart + (px - PAD.left) / (w - PAD.left - PAD.right) * (_viewEnd - _viewStart);
}

function _valToY(v) {
  const h = _canvas?.height ?? 160;
  return PAD.top + (1 - v) * (h - PAD.top - PAD.bottom);
}

function _yToVal(py) {
  const h = _canvas?.height ?? 160;
  return Math.max(0, Math.min(1, 1 - (py - PAD.top) / (h - PAD.top - PAD.bottom)));
}

function _snapTick(tick) {
  const c = chart;
  if (!c) return Math.round(tick);
  return Math.round(tick / TICKS_PER_BEAT) * TICKS_PER_BEAT;
}

// ── Point hit test ─────────────────────────────────────────────────────────────

function _hitPoint(px, py, pts) {
  for (let i = pts.length - 1; i >= 0; i--) {
    const dx = px - _tickToX(pts[i].y);
    const dy = py - _valToY(pts[i].v);
    if (Math.sqrt(dx*dx + dy*dy) <= PT_R + SNAP_PX) return i;
  }
  return -1;
}

// ── Mouse handlers ────────────────────────────────────────────────────────────

function _onMouseDown(e) {
  if (e.button !== 0) return;
  const c = chart; if (!c) return;
  const pts = getFxAutoData(c)[_side];
  const idx = _hitPoint(e.offsetX, e.offsetY, pts);
  if (idx >= 0) {
    _drag = { idx, startY: e.offsetY, startV: pts[idx].v };
    _canvas.style.cursor = 'ns-resize';
    return;
  }
  // Add new breakpoint
  const tick = _snapTick(_xToTick(e.offsetX));
  const val  = _yToVal(e.offsetY);
  saveUndo('Add FX Automation Breakpoint');
  pts.push({ y: Math.max(0, tick), v: Math.max(0, Math.min(1, val)), m: 'step' });
  pts.sort((a, b) => a.y - b.y);
  invalidateFxAuto();
  render();
}

function _onMouseMove(e) {
  if (!_drag) return;
  const c = chart; if (!c) return;
  const pts = getFxAutoData(c)[_side];
  const pt = pts[_drag.idx]; if (!pt) return;
  const dpy = e.offsetY - _drag.startY;
  const h = _canvas?.height ?? 160;
  const dv = -dpy / (h - PAD.top - PAD.bottom);
  pt.v = Math.max(0, Math.min(1, _drag.startV + dv));
  invalidateFxAuto();
  render();
}

function _onMouseUp(e) {
  _drag = null;
  _canvas.style.cursor = 'crosshair';
}

function _onRightClick(e) {
  e.preventDefault();
  const c = chart; if (!c) return;
  const pts = getFxAutoData(c)[_side];
  const idx = _hitPoint(e.offsetX, e.offsetY, pts);
  if (idx < 0) return;
  saveUndo('Delete FX Automation Breakpoint');
  pts.splice(idx, 1);
  invalidateFxAuto();
  render();
}

function _onDblClick(e) {
  const c = chart; if (!c) return;
  const pts = getFxAutoData(c)[_side];
  const idx = _hitPoint(e.offsetX, e.offsetY, pts);
  if (idx < 0) return;
  const pt = pts[idx];
  pt.m = pt.m === 'linear' ? 'step' : 'linear';
  invalidateFxAuto();
}

// ── Draw loop ─────────────────────────────────────────────────────────────────

function _startLoop() {
  if (_raf) return;
  const loop = () => {
    if (_win && _win.style.display !== 'none') {
      if (_dirty) { _draw(); _dirty = false; }
      _raf = requestAnimationFrame(loop);
    } else {
      _raf = null;
    }
  };
  _raf = requestAnimationFrame(loop);
}

function _stopLoop() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
}

function _draw() {
  const ctx  = _ctx; if (!ctx) return;
  const cw   = _canvas.width  = _canvas.clientWidth  || 540;
  const ch   = _canvas.height = _canvas.clientHeight || 160;
  const c    = chart;
  const pts  = c ? (getFxAutoData(c)[_side] ?? []) : [];

  // Background
  ctx.fillStyle = '#090916';
  ctx.fillRect(0, 0, cw, ch);

  // Grid lines (horizontal: 0%, 25%, 50%, 75%, 100%)
  ctx.strokeStyle = '#1a1a3a';
  ctx.lineWidth = 1;
  for (let v = 0; v <= 1; v += 0.25) {
    const y = _valToY(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(cw - PAD.right, y); ctx.stroke();
    ctx.fillStyle = '#334';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(v * 100) + '%', PAD.left - 3, y + 3);
  }

  // Measure grid lines (vertical)
  if (c) {
    const total = c.totalTicks?.() ?? 192 * 64;
    ctx.strokeStyle = '#18182a';
    ctx.lineWidth = 1;
    for (let t = 0; t < total; t += TICKS_PER_MEASURE) {
      if (t < _viewStart || t > _viewEnd) continue;
      const x = _tickToX(t);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, ch - PAD.bottom); ctx.stroke();
      // Measure label
      const mNum = Math.round(t / TICKS_PER_MEASURE) + 1;
      ctx.fillStyle = '#334';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('m' + mNum, x, ch - PAD.bottom + 14);
    }
  }

  // Automation curve
  if (pts.length > 0) {
    const color = _side === 'L' ? '#0088ff' : '#ff1177';
    const colorFill = _side === 'L' ? 'rgba(0,136,255,0.12)' : 'rgba(255,17,119,0.12)';

    // Fill area under curve
    ctx.beginPath();
    const firstX = _tickToX(pts[0].y);
    const baseY  = _valToY(0);
    ctx.moveTo(firstX, baseY);
    ctx.lineTo(firstX, _valToY(pts[0].v));

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ax = _tickToX(a.y), ay = _valToY(a.v);
      const bx = _tickToX(b.y), by = _valToY(b.v);
      if (a.m === 'linear') {
        ctx.lineTo(bx, by);
      } else {
        ctx.lineTo(bx, ay);
        ctx.lineTo(bx, by);
      }
    }
    // Close to base
    const lastX = _tickToX(pts[pts.length - 1].y);
    ctx.lineTo(cw - PAD.right, _valToY(pts[pts.length - 1].v));
    ctx.lineTo(cw - PAD.right, baseY);
    ctx.closePath();
    ctx.fillStyle = colorFill;
    ctx.fill();

    // Stroke curve
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(_tickToX(pts[0].y), _valToY(pts[0].v));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ax = _tickToX(a.y), ay = _valToY(a.v);
      const bx = _tickToX(b.y), by = _valToY(b.v);
      if (a.m === 'linear') {
        ctx.lineTo(bx, by);
      } else {
        ctx.lineTo(bx, ay);
        ctx.lineTo(bx, by);
      }
    }
    ctx.lineTo(cw - PAD.right, _valToY(pts[pts.length - 1].v));
    ctx.stroke();

    // Breakpoint dots
    pts.forEach((pt, i) => {
      const x = _tickToX(pt.y);
      const y = _valToY(pt.v);
      if (x < PAD.left - PT_R || x > cw - PAD.right + PT_R) return;
      ctx.beginPath();
      ctx.arc(x, y, PT_R, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Linear mode indicator
      if (pt.m === 'linear') {
        ctx.fillStyle = '#fff';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('~', x, y + 3);
      }
      // Value label
      ctx.fillStyle = '#ccd';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(pt.v * 100) + '%', x, y - 10);
    });
  }

  // Border
  ctx.strokeStyle = '#223';
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD.left, PAD.top, cw - PAD.left - PAD.right, ch - PAD.top - PAD.bottom);

  // Info count
  const infoEl = _win?.querySelector('#fxauto-info');
  if (infoEl) infoEl.textContent = pts.length + (pts.length === 1 ? ' breakpoint' : ' breakpoints');
}
