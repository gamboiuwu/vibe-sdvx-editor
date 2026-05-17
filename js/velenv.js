'use strict';

// ─── Velocity Envelope Editor ────────────────────────────────────────────────
// Ableton-style clip-envelope view for chart scrollSpeedEvents.
// Displays velocity nodes as draggable points on a time×speed canvas;
// segments between nodes are drawn as filled ramps (linear) or steps (step).
// Left-click empty area → add node; left-click node → select / drag;
// right-click node → delete; double-click segment → toggle step ↔ linear.
// ─────────────────────────────────────────────────────────────────────────────

class VelocityEnvelopeEditor {
  constructor() {
    this._win       = null;   // outer window div
    this._canvas    = null;   // <canvas>
    this._ctx       = null;
    this._chart     = null;
    this._drag      = null;   // { evIdx, startY, startSpeed, ox, oy }
    this._sel       = null;   // selected event index
    this._raf       = null;
    this._dirty     = true;
    this._viewStart = 0;      // view start tick
    this._viewEnd   = 0;      // view end tick (computed from chart)
    this._minSpeed  = 0.05;
    this._maxSpeed  = 5.0;
    this._bound     = {};     // cached bound handlers

    this._build();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setChart(chart) {
    this._chart = chart;
    if (chart) {
      this._viewStart = 0;
      this._viewEnd   = chart.totalTicks ? chart.totalTicks() : 192 * 64;
    }
    this.invalidate();
  }

  invalidate() {
    this._dirty = true;
  }

  show() {
    if (this._win) {
      this._win.style.display = 'flex';
      this._startLoop();
      this.invalidate();
    }
  }

  hide() {
    if (this._win) this._win.style.display = 'none';
    this._stopLoop();
  }

  toggle() {
    if (!this._win) return;
    if (this._win.style.display === 'none') this.show();
    else this.hide();
  }

  isVisible() {
    return this._win && this._win.style.display !== 'none';
  }

  destroy() {
    this._stopLoop();
    this._win?.remove();
    this._win = null;
  }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const win = document.createElement('div');
    win.id = 'velenv-win';
    win.style.cssText = [
      'display:none', 'flex-direction:column',
      'position:fixed', 'z-index:8500',
      'left:80px', 'top:80px',
      'width:640px', 'height:260px',
      'min-width:360px', 'min-height:140px',
      'background:#0a0a1a', 'border:1.5px solid #ff9900',
      'border-radius:6px', 'box-shadow:0 6px 28px #ff990044',
      'font-family:monospace', 'font-size:11px', 'color:#ddd',
      'user-select:none', 'overflow:hidden',
    ].join(';');

    // Title bar
    const bar = document.createElement('div');
    bar.id = 'velenv-bar';
    bar.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'background:#15151f', 'padding:4px 8px',
      'border-bottom:1px solid #333', 'cursor:move', 'flex-shrink:0',
    ].join(';');
    bar.innerHTML = `
      <span style="color:#ff9900;font-weight:700;letter-spacing:1px;font-size:10px">
        VELOCITY ENVELOPE
      </span>
      <div style="display:flex;align-items:center;gap:6px">
        <button id="velenv-hint-btn"
          title="Left-click: add / drag node  |  Right-click node: delete  |  Double-click segment: toggle ramp"
          style="background:#111;border:1px solid #333;border-radius:3px;color:#888;
                 font-size:9px;padding:1px 6px;cursor:pointer">?</button>
        <button id="velenv-close"
          style="background:#2a1010;border:1px solid #aa3333;border-radius:3px;
                 color:#ff6666;font-size:10px;padding:1px 8px;cursor:pointer">✕</button>
      </div>`;
    win.appendChild(bar);

    // Toolbar
    const tb = document.createElement('div');
    tb.style.cssText = [
      'display:flex', 'align-items:center', 'gap:6px', 'padding:4px 8px',
      'border-bottom:1px solid #1a1a2a', 'flex-shrink:0',
      'background:#0d0d1d',
    ].join(';');
    tb.innerHTML = `
      <span style="color:#666;font-size:9px">Snap:</span>
      <select id="velenv-snap"
        style="background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 2px">
        <option value="0">Free</option>
        <option value="192" selected>Measure</option>
        <option value="48">Beat</option>
        <option value="24">1/2 Beat</option>
        <option value="12">1/4 Beat</option>
      </select>
      <span style="color:#666;font-size:9px;margin-left:6px">Speed snap:</span>
      <select id="velenv-spsnap"
        style="background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 2px">
        <option value="0">Free</option>
        <option value="0.25" selected>0.25</option>
        <option value="0.5">0.5</option>
        <option value="1">1.0</option>
      </select>
      <button id="velenv-reset"
        style="margin-left:auto;background:#111;border:1px solid #333;border-radius:3px;
               color:#888;font-size:9px;padding:1px 8px;cursor:pointer">
        Reset to 1×</button>`;
    win.appendChild(tb);

    // Canvas area
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1;overflow:hidden;position:relative;';

    const canvas = document.createElement('canvas');
    canvas.id = 'velenv-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;';
    canvasWrap.appendChild(canvas);
    win.appendChild(canvasWrap);

    document.body.appendChild(win);
    this._win    = win;
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');

    this._makeDraggable(bar, win);
    this._makeResizable(win);
    this._bindEvents();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────

  _bindEvents() {
    const canvas = this._canvas;

    this._win.querySelector('#velenv-close').addEventListener('click', () => this.hide());
    this._win.querySelector('#velenv-reset').addEventListener('click', () => {
      if (!this._chart) return;
      if (typeof saveUndo === 'function') saveUndo('Reset velocity envelope to 1×');
      this._chart.scrollSpeedEvents = [{ y: 0, speed: 1.0, interp: 'step' }];
      this._sel = null;
      this._notifyChange();
    });

    this._win.querySelector('#velenv-hint-btn').addEventListener('click', () => {
      alert(
        'Velocity Envelope Editor\n\n' +
        'Left-click empty area → add a new velocity node\n' +
        'Left-click node → select / drag to reposition\n' +
        'Right-click node → delete\n' +
        'Double-click segment → toggle Step ↔ Linear ramp\n\n' +
        'Snap settings control how nodes snap to the grid.\n' +
        'Segments shown as diagonals are Linear (smooth ramp);\n' +
        'horizontal segments are Step (instant change).'
      );
    });

    canvas.addEventListener('mousedown',  e => this._onMouseDown(e));
    canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
    canvas.addEventListener('mouseup',    e => this._onMouseUp(e));
    canvas.addEventListener('mouseleave', e => this._onMouseUp(e));
    canvas.addEventListener('contextmenu',e => { e.preventDefault(); this._onRightClick(e); });
    canvas.addEventListener('dblclick',   e => this._onDblClick(e));

    // ResizeObserver to keep canvas pixel size in sync
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth  * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      this.invalidate();
    });
    ro.observe(canvas);
  }

  // ── Draggable title bar ────────────────────────────────────────────────────

  _makeDraggable(handle, win) {
    let ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true;
      ox = e.clientX - win.offsetLeft;
      oy = e.clientY - win.offsetTop;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      win.style.left = Math.max(0, e.clientX - ox) + 'px';
      win.style.top  = Math.max(0, e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  // ── Resizable corner ──────────────────────────────────────────────────────

  _makeResizable(win) {
    const grip = document.createElement('div');
    grip.style.cssText = [
      'position:absolute', 'right:0', 'bottom:0',
      'width:14px', 'height:14px', 'cursor:se-resize',
      'background:linear-gradient(135deg,transparent 50%,#ff990055 50%)',
    ].join(';');
    win.appendChild(grip);
    let ox = 0, oy = 0, ow = 0, oh = 0, resizing = false;
    grip.addEventListener('mousedown', e => {
      resizing = true;
      ox = e.clientX; oy = e.clientY;
      ow = win.offsetWidth; oh = win.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      win.style.width  = Math.max(360, ow + e.clientX - ox) + 'px';
      win.style.height = Math.max(140, oh + e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { resizing = false; });
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  _snapTick(tick) {
    const snap = parseInt(this._win.querySelector('#velenv-snap').value, 10);
    if (!snap) return Math.round(tick);
    return Math.round(tick / snap) * snap;
  }

  _snapSpeed(spd) {
    const snap = parseFloat(this._win.querySelector('#velenv-spsnap').value);
    if (!snap) return +spd.toFixed(3);
    return Math.round(spd / snap) * snap;
  }

  _tickToX(tick) {
    const { _viewStart: vs, _viewEnd: ve } = this;
    const W = this._canvas.width / devicePixelRatio;
    return ((tick - vs) / (ve - vs)) * W;
  }

  _xToTick(x) {
    const { _viewStart: vs, _viewEnd: ve } = this;
    const W = this._canvas.width / devicePixelRatio;
    return vs + (x / W) * (ve - vs);
  }

  _speedToY(spd) {
    const H = this._canvas.height / devicePixelRatio;
    const pad = 20;
    return pad + (1 - (spd - this._minSpeed) / (this._maxSpeed - this._minSpeed)) * (H - pad * 2);
  }

  _yToSpeed(y) {
    const H = this._canvas.height / devicePixelRatio;
    const pad = 20;
    return this._minSpeed + (1 - (y - pad) / (H - pad * 2)) * (this._maxSpeed - this._minSpeed);
  }

  // ── Hit testing ───────────────────────────────────────────────────────────

  _hitNode(cx, cy, radius = 8) {
    if (!this._chart) return -1;
    const evs = this._chart.scrollSpeedEvents;
    const dpr = devicePixelRatio;
    for (let i = evs.length - 1; i >= 0; i--) {
      const nx = this._tickToX(evs[i].y) * dpr;
      const ny = this._speedToY(evs[i].speed) * dpr;
      if (Math.hypot(cx - nx, cy - ny) <= radius * dpr) return i;
    }
    return -1;
  }

  // ── Mouse handlers ────────────────────────────────────────────────────────

  _getCanvasXY(e) {
    const r = this._canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const [cx, cy] = this._getCanvasXY(e);
    const idx = this._hitNode(cx * devicePixelRatio, cy * devicePixelRatio);
    if (idx >= 0) {
      this._sel  = idx;
      this._drag = { evIdx: idx, startX: cx, startY: cy };
      e.preventDefault();
    } else {
      this._addNodeAt(cx, cy);
    }
    this.invalidate();
  }

  _onMouseMove(e) {
    if (!this._drag) { this.invalidate(); return; }
    const [cx, cy] = this._getCanvasXY(e);
    const evs = this._chart?.scrollSpeedEvents;
    if (!evs) return;
    const ev = evs[this._drag.evIdx];
    if (!ev) return;

    let tick  = this._snapTick(this._xToTick(cx));
    let speed = this._snapSpeed(this._yToSpeed(cy));
    speed = Math.max(this._minSpeed, Math.min(this._maxSpeed, speed));

    // Clamp: tick 0 always stays at 0
    if (this._drag.evIdx === 0) { tick = 0; }
    else {
      const prev = evs[this._drag.evIdx - 1];
      const next = evs[this._drag.evIdx + 1];
      tick = Math.max((prev?.y ?? 0) + 1, tick);
      if (next) tick = Math.min(next.y - 1, tick);
    }

    ev.y     = tick;
    ev.speed = speed;
    this._notifyChange(false); // no undo during drag
    this.invalidate();
  }

  _onMouseUp(e) {
    if (this._drag) {
      if (typeof saveUndo === 'function') saveUndo('Adjusted velocity envelope node');
      this._drag = null;
    }
    this.invalidate();
  }

  _onRightClick(e) {
    const [cx, cy] = this._getCanvasXY(e);
    const idx = this._hitNode(cx * devicePixelRatio, cy * devicePixelRatio);
    if (idx < 0 || !this._chart) return;
    const evs = this._chart.scrollSpeedEvents;
    if (evs[idx].y === 0) return; // cannot remove anchor
    if (typeof saveUndo === 'function') saveUndo('Deleted velocity envelope node');
    evs.splice(idx, 1);
    this._sel = null;
    this._notifyChange();
  }

  _onDblClick(e) {
    // Toggle the interpolation of the segment clicked
    if (!this._chart) return;
    const [cx, cy] = this._getCanvasXY(e);
    const tick = this._xToTick(cx);
    const evs  = this._chart.scrollSpeedEvents;
    // Find which segment's start event the click falls in
    let segIdx = -1;
    for (let i = 0; i < evs.length - 1; i++) {
      if (tick >= evs[i].y && tick < evs[i + 1].y) { segIdx = i; break; }
    }
    if (segIdx < 0) return;
    const cur = evs[segIdx].interp ?? 'step';
    const next = cur === 'step' ? 'linear' : 'step';
    if (typeof saveUndo === 'function') saveUndo(`Velocity segment → ${next}`);
    this._chart.setScrollSpeedInterp(evs[segIdx].y, next);
    this._notifyChange();
  }

  // ── Add node ──────────────────────────────────────────────────────────────

  _addNodeAt(cx, cy) {
    if (!this._chart) return;
    let tick  = this._snapTick(this._xToTick(cx));
    let speed = this._snapSpeed(this._yToSpeed(cy));
    speed = Math.max(this._minSpeed, Math.min(this._maxSpeed, speed));
    tick  = Math.max(0, tick);
    if (typeof saveUndo === 'function') saveUndo('Added velocity envelope node');
    this._chart.addScrollSpeedEvent(tick, speed, 'step');
    // Select the newly added node
    const evs = this._chart.scrollSpeedEvents;
    this._sel = evs.findIndex(e => e.y === tick);
    this._notifyChange();
  }

  // ── Notify external render ────────────────────────────────────────────────

  _notifyChange(doUndo = false) {
    if (typeof updateScrollSpeedEventList === 'function') updateScrollSpeedEventList();
    if (typeof render === 'function') render();
    this.invalidate();
  }

  // ── RAF loop ──────────────────────────────────────────────────────────────

  _startLoop() {
    if (this._raf) return;
    const loop = () => {
      if (this._dirty) { this._draw(); this._dirty = false; }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stopLoop() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  _draw() {
    const canvas = this._canvas;
    const ctx    = this._ctx;
    const dpr    = devicePixelRatio;
    const W = canvas.width  / dpr;
    const H = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#09091a';
    ctx.fillRect(0, 0, W, H);

    // Ensure chart is present
    const evs = this._chart?.scrollSpeedEvents;
    if (!evs || evs.length === 0) {
      ctx.fillStyle = '#444';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No chart loaded', W / 2, H / 2);
      ctx.restore();
      return;
    }

    const pad = 20;

    this._drawGrid(ctx, W, H, pad);
    this._drawEnvelope(ctx, W, H, pad, evs);
    this._drawNodes(ctx, evs);
    this._drawAxisLabels(ctx, W, H, pad);
    this._drawMeasureLabels(ctx, W, H);

    ctx.restore();
  }

  _drawGrid(ctx, W, H, pad) {
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 1;

    // Horizontal speed lines
    const steps = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
    for (const s of steps) {
      if (s < this._minSpeed || s > this._maxSpeed) continue;
      const y = this._speedToY(s);
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(W, y);
      if (s === 1.0) { ctx.strokeStyle = '#2a2a4a'; ctx.lineWidth = 1.5; }
      else           { ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1; }
      ctx.stroke();
    }

    // Vertical measure lines
    const vs = this._viewStart, ve = this._viewEnd;
    const startM = Math.ceil(vs / TICKS_PER_MEASURE);
    const endM   = Math.floor(ve / TICKS_PER_MEASURE);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth   = 1;
    for (let m = startM; m <= endM; m++) {
      const x = this._tickToX(m * TICKS_PER_MEASURE);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  _drawEnvelope(ctx, W, H, pad, evs) {
    if (evs.length === 0) return;

    // Build path for filled area under envelope
    ctx.beginPath();
    let firstX = this._tickToX(evs[0].y);
    let firstY = this._speedToY(evs[0].speed);
    ctx.moveTo(firstX, H);
    ctx.lineTo(firstX, firstY);

    for (let i = 0; i < evs.length - 1; i++) {
      const e0 = evs[i], e1 = evs[i + 1];
      const x0 = this._tickToX(e0.y), y0 = this._speedToY(e0.speed);
      const x1 = this._tickToX(e1.y), y1 = this._speedToY(e1.speed);
      const isLinear = (e0.interp ?? 'step') === 'linear';
      if (isLinear) {
        ctx.lineTo(x1, y1);
      } else {
        ctx.lineTo(x1, y0); // step: horizontal then drop
        ctx.lineTo(x1, y1);
      }
    }

    // Last node extends to view end
    const last = evs[evs.length - 1];
    const lx = this._tickToX(this._viewEnd);
    const ly = this._speedToY(last.speed);
    ctx.lineTo(lx, ly);
    ctx.lineTo(lx, H);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, pad, 0, H);
    grad.addColorStop(0, '#ff990033');
    grad.addColorStop(1, '#ff990008');
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw the envelope line on top
    ctx.beginPath();
    ctx.moveTo(firstX, firstY);
    for (let i = 0; i < evs.length - 1; i++) {
      const e0 = evs[i], e1 = evs[i + 1];
      const x0 = this._tickToX(e0.y), y0 = this._speedToY(e0.speed);
      const x1 = this._tickToX(e1.y), y1 = this._speedToY(e1.speed);
      const isLinear = (e0.interp ?? 'step') === 'linear';
      if (isLinear) {
        ctx.lineTo(x1, y1);
      } else {
        ctx.lineTo(x1, y0);
        ctx.lineTo(x1, y1);
      }
    }
    ctx.lineTo(lx, ly);

    ctx.strokeStyle = '#ff9900';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }

  _drawNodes(ctx, evs) {
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const x  = this._tickToX(ev.y);
      const y  = this._speedToY(ev.speed);
      const sel = i === this._sel;

      ctx.beginPath();
      ctx.arc(x, y, sel ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle   = sel ? '#ffcc44' : '#ff9900';
      ctx.fill();
      ctx.strokeStyle = sel ? '#fff8' : '#ff990088';
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Speed label for selected node
      if (sel) {
        ctx.fillStyle = '#ffcc44';
        ctx.font      = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`×${ev.speed.toFixed(2)}`, x, y - 10);
      }
    }
  }

  _drawAxisLabels(ctx, W, H, pad) {
    ctx.fillStyle = '#555';
    ctx.font      = '9px monospace';
    ctx.textAlign = 'right';

    const labelSpeeds = [0.5, 1.0, 2.0, 3.0, 4.0, 5.0];
    for (const s of labelSpeeds) {
      const y = this._speedToY(s);
      if (y < pad || y > H - 4) continue;
      ctx.fillText(`×${s.toFixed(1)}`, 28, y + 3);
    }
  }

  _drawMeasureLabels(ctx, W, H) {
    const vs = this._viewStart, ve = this._viewEnd;
    // Only draw labels every N measures to avoid clutter
    const totalM = Math.ceil((ve - vs) / TICKS_PER_MEASURE);
    const step   = totalM <= 32 ? 4 : totalM <= 64 ? 8 : 16;

    ctx.fillStyle = '#444';
    ctx.font      = '8px monospace';
    ctx.textAlign = 'center';

    const startM = Math.ceil(vs / TICKS_PER_MEASURE);
    const endM   = Math.floor(ve / TICKS_PER_MEASURE);
    for (let m = startM; m <= endM; m++) {
      if ((m % step) !== 0) continue;
      const x = this._tickToX(m * TICKS_PER_MEASURE);
      ctx.fillText(`M${m}`, x, H - 4);
    }
  }
}

// ── Singleton instance ────────────────────────────────────────────────────────

let velEnvEditor = null;

function getVelEnvEditor() {
  if (!velEnvEditor) velEnvEditor = new VelocityEnvelopeEditor();
  return velEnvEditor;
}

function openVelEnvEditor() {
  const ed = getVelEnvEditor();
  if (typeof chart !== 'undefined' && chart) ed.setChart(chart);
  ed.show();
}

function toggleVelEnvEditor() {
  const ed = getVelEnvEditor();
  if (typeof chart !== 'undefined' && chart && !ed.isVisible()) ed.setChart(chart);
  ed.toggle();
}
