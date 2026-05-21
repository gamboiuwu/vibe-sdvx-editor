import { TICKS_PER_MEASURE } from './chart.js';
import { render, saveUndo, renderer } from './app.js';
import { dockRegister } from './dock.js';

// ─── Envelope Control ─────────────────────────────────────────────────────────
// Floating MDI window with two sections:
//  1. Velocity Envelope — Ableton-style canvas editor for scrollSpeedEvents
//  2. Glitch Effect — PowerGlitch intensity control per chart
// ─────────────────────────────────────────────────────────────────────────────

export class VelocityEnvelopeEditor {
  constructor() {
    this._win       = null;
    this._canvas    = null;
    this._ctx       = null;
    this._chart     = null;
    this._drag      = null;
    this._sel       = null;
    this._raf       = null;
    this._dirty     = true;
    this._viewStart = 0;
    this._viewEnd   = 192 * 64;
    this._minSpeed  = 0.05;
    this._maxSpeed  = 5.0;

    // Glitch envelope canvas state (mirrors velocity canvas but for glitchEvents)
    this._gCanvas    = null;
    this._gCtx       = null;
    this._gDirty     = true;
    this._gDrag      = null;
    this._gSel       = null;
    this._gViewStart = 0;
    this._gViewEnd   = 192 * 64;
    this._gRaf       = null;
    this._gTab       = false; // true when glitch tab is visible

    this._build();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setChart(chart) {
    const isNew = chart !== this._chart;
    this._chart = chart;
    if (chart && isNew) {
      const total = chart.totalTicks ? chart.totalTicks() : 192 * 64;
      this._viewStart  = 0;
      this._viewEnd    = total;
      this._gViewStart = 0;
      this._gViewEnd   = total;
      this._sel  = null;
      this._gSel = null;
    }
    this.invalidate();
    this._gDirty = true;
  }

  invalidate() { this._dirty = true; }

  show() {
    if (this._win) {
      this._win.style.display = 'flex';
      this._startLoop();
      if (this._gTab) this._startGlitchLoop();
      this.invalidate();
      this._gDirty = true;
    }
  }
  hide() {
    if (this._win) this._win.style.display = 'none';
    this._stopLoop();
    this._stopGlitchLoop();
  }
  toggle() {
    if (!this._win) return;
    if (this._win.style.display === 'none') this.show(); else this.hide();
  }
  isVisible() { return this._win && this._win.style.display !== 'none'; }
  destroy()   { this._stopLoop(); this._stopGlitchLoop(); this._win?.remove(); this._win = null; }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  _build() {
    const win = document.createElement('div');
    win.id = 'velenv-win';
    win.style.cssText = [
      'display:none', 'flex-direction:column',
      'position:fixed', 'z-index:8500',
      'left:80px', 'top:80px',
      'width:660px', 'height:340px',
      'min-width:380px', 'min-height:200px',
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
      'background:#15151f', 'padding:4px 10px',
      'border-bottom:1px solid #333', 'cursor:move', 'flex-shrink:0',
    ].join(';');
    bar.innerHTML = `
      <span style="color:#ff9900;font-weight:700;letter-spacing:1.5px;font-size:10px">ENVELOPE CONTROL</span>
      <div style="display:flex;align-items:center;gap:6px">
        <button id="velenv-close"
          style="background:#2a1010;border:1px solid #aa3333;border-radius:3px;
                 color:#ff6666;font-size:10px;padding:1px 8px;cursor:pointer">✕</button>
      </div>`;
    win.appendChild(bar);

    // Tab strip
    const tabStrip = document.createElement('div');
    tabStrip.style.cssText = [
      'display:flex', 'align-items:stretch',
      'background:#0d0d1d', 'border-bottom:1px solid #1e1e33',
      'flex-shrink:0',
    ].join(';');
    tabStrip.innerHTML = `
      <button id="velenv-tab-vel" style="flex:1;padding:5px 0;font-size:10px;font-family:monospace;
        cursor:pointer;border:none;border-bottom:2px solid #ff9900;
        background:#15151f;color:#ff9900;letter-spacing:.5px">VELOCITY</button>
      <button id="velenv-tab-glitch" style="flex:1;padding:5px 0;font-size:10px;font-family:monospace;
        cursor:pointer;border:none;border-bottom:2px solid transparent;
        background:#0d0d1d;color:#666;letter-spacing:.5px">GLITCH</button>`;
    win.appendChild(tabStrip);

    // ── Velocity section ──────────────────────────────────────────────────
    const velSection = document.createElement('div');
    velSection.id = 'velenv-section-vel';
    velSection.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;';

    const tb = document.createElement('div');
    tb.style.cssText = [
      'display:flex', 'align-items:center', 'gap:6px', 'padding:3px 8px',
      'border-bottom:1px solid #1a1a2a', 'flex-shrink:0', 'background:#0d0d1d',
    ].join(';');
    tb.innerHTML = `
      <span style="color:#666;font-size:9px">Snap:</span>
      <select id="velenv-snap"
        style="background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 2px">
        <option value="0">Free</option>
        <option value="192" selected>Measure</option>
        <option value="48">Beat</option>
        <option value="24">½ Beat</option>
        <option value="12">¼ Beat</option>
      </select>
      <span style="color:#666;font-size:9px;margin-left:4px">Speed:</span>
      <select id="velenv-spsnap"
        style="background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 2px">
        <option value="0">Free</option>
        <option value="0.25" selected>0.25</option>
        <option value="0.5">0.5</option>
        <option value="1">1.0</option>
      </select>
      <span style="color:#666;font-size:9px;margin-left:6px">Max:</span>
      <input type="number" id="velenv-maxspeed" value="5" min="0.5" max="20" step="0.5"
        title="Max visible speed (Y-axis top)"
        style="width:38px;background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 3px">
      <span style="color:#666;font-size:9px">Min:</span>
      <input type="number" id="velenv-minspeed" value="0.05" min="0.01" max="1" step="0.05"
        title="Min visible speed (Y-axis bottom)"
        style="width:38px;background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 3px">
      <button id="velenv-add-node" title="Add node at current playhead position"
        style="margin-left:6px;background:#1a2a1a;border:1px solid #3a6a3a;border-radius:3px;
               color:#88dd88;font-size:11px;font-weight:700;padding:0 7px;cursor:pointer;line-height:16px">+</button>
      <button id="velenv-reset"
        style="margin-left:auto;background:#111;border:1px solid #333;border-radius:3px;
               color:#888;font-size:9px;padding:1px 8px;cursor:pointer">Reset 1×</button>`;
    velSection.appendChild(tb);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'flex:1;overflow:hidden;position:relative;';
    const canvas = document.createElement('canvas');
    canvas.id = 'velenv-canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;';
    canvasWrap.appendChild(canvas);
    velSection.appendChild(canvasWrap);
    win.appendChild(velSection);

    // ── Glitch section ────────────────────────────────────────────────────
    const glitchSection = document.createElement('div');
    glitchSection.id = 'velenv-section-glitch';
    glitchSection.style.cssText = 'flex:1;display:none;flex-direction:column;overflow:hidden;';

    const gtb = document.createElement('div');
    gtb.style.cssText = [
      'display:flex', 'align-items:center', 'gap:6px', 'padding:3px 8px',
      'border-bottom:1px solid #1a1a2a', 'flex-shrink:0', 'background:#0d0d1d',
    ].join(';');
    gtb.innerHTML = `
      <span style="color:#666;font-size:9px">Snap:</span>
      <select id="velenv-gsnap"
        style="background:#111;border:1px solid #333;border-radius:3px;
               color:#ccc;font-size:9px;padding:1px 2px">
        <option value="0">Free</option>
        <option value="192" selected>Measure</option>
        <option value="48">Beat</option>
        <option value="24">½ Beat</option>
        <option value="12">¼ Beat</option>
      </select>
      <span style="color:#555;font-size:9px;margin-left:4px">Click: add/drag · Right-click: remove · Scroll: zoom</span>
      <button id="velenv-glitch-reset"
        style="margin-left:auto;background:#111;border:1px solid #333;border-radius:3px;
               color:#888;font-size:9px;padding:1px 8px;cursor:pointer">Reset 0</button>`;
    glitchSection.appendChild(gtb);

    const gCanvasWrap = document.createElement('div');
    gCanvasWrap.style.cssText = 'flex:1;overflow:hidden;position:relative;';
    const gCanvas = document.createElement('canvas');
    gCanvas.id = 'velenv-glitch-canvas';
    gCanvas.style.cssText = 'display:block;width:100%;height:100%;cursor:crosshair;';
    gCanvasWrap.appendChild(gCanvas);
    glitchSection.appendChild(gCanvasWrap);
    win.appendChild(glitchSection);

    document.body.appendChild(win);
    dockRegister('velenv', win, 'Envelope Control', '◈', 'float', { nativeFloat: true, floatW: 660, floatH: 340 });
    this._win    = win;
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._gCanvas = gCanvas;
    this._gCtx    = gCanvas.getContext('2d');

    this._makeDraggable(bar, win);
    this._makeResizable(win);
    this._bindTabStrip(tabStrip, velSection, glitchSection);
    this._bindEvents();
    this._bindGlitchCanvas();
  }

  // ── Tab strip ─────────────────────────────────────────────────────────────

  _bindTabStrip(strip, velSec, glitchSec) {
    const velBtn    = strip.querySelector('#velenv-tab-vel');
    const glitchBtn = strip.querySelector('#velenv-tab-glitch');
    const activate  = (tab) => {
      const isVel = tab === 'vel';
      this._gTab = !isVel;
      velSec.style.display    = isVel ? 'flex' : 'none';
      glitchSec.style.display = isVel ? 'none' : 'flex';
      velBtn.style.borderBottomColor    = isVel ? '#ff9900' : 'transparent';
      velBtn.style.background           = isVel ? '#15151f' : '#0d0d1d';
      velBtn.style.color                = isVel ? '#ff9900' : '#666';
      glitchBtn.style.borderBottomColor = isVel ? 'transparent' : '#aa44ff';
      glitchBtn.style.background        = isVel ? '#0d0d1d' : '#15151f';
      glitchBtn.style.color             = isVel ? '#666' : '#aa44ff';
      if (isVel) this.invalidate(); else { this._gDirty = true; this._startGlitchLoop(); }
    };
    velBtn.addEventListener('click',    () => activate('vel'));
    glitchBtn.addEventListener('click', () => activate('glitch'));
  }

  // ── Glitch canvas bindings ────────────────────────────────────────────────

  _bindGlitchCanvas() {
    const canvas = this._gCanvas;
    if (!canvas) return;

    this._win.querySelector('#velenv-glitch-reset')?.addEventListener('click', () => {
      if (!this._chart) return;
      saveUndo('Reset glitch envelope to 0');
      this._chart.glitchEvents = [{ y: 0, level: 0 }];
      this._gSel = null;
      this._notifyGlitchChange();
    });

    canvas.addEventListener('mousedown',   e => this._onGMouseDown(e));
    canvas.addEventListener('mousemove',   e => this._onGMouseMove(e));
    canvas.addEventListener('mouseup',     e => this._onGMouseUp(e));
    canvas.addEventListener('mouseleave',  e => this._onGMouseUp(e));
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this._onGRightClick(e); });
    canvas.addEventListener('wheel',       e => this._onGWheel(e), { passive: false });

    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth  * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      this._gDirty = true;
    });
    ro.observe(canvas);
  }

  // ── Glitch canvas coordinate helpers ─────────────────────────────────────

  _gSnapTick(tick) {
    const snap = parseInt(this._win?.querySelector('#velenv-gsnap')?.value ?? '192', 10);
    if (!snap) return Math.round(tick);
    return Math.round(tick / snap) * snap;
  }
  _gTickToX(tick) {
    const W = this._gCanvas.width / devicePixelRatio;
    return ((tick - this._gViewStart) / (this._gViewEnd - this._gViewStart)) * W;
  }
  _gXToTick(x) {
    const W = this._gCanvas.width / devicePixelRatio;
    return this._gViewStart + (x / W) * (this._gViewEnd - this._gViewStart);
  }
  _gLevelToY(level) {
    const H = this._gCanvas.height / devicePixelRatio;
    const pad = 20;
    return pad + (1 - level / 10) * (H - pad * 2);
  }
  _gYToLevel(y) {
    const H = this._gCanvas.height / devicePixelRatio;
    const pad = 20;
    return Math.max(0, Math.min(10, (1 - (y - pad) / (H - pad * 2)) * 10));
  }
  _gGetCanvasXY(e) {
    const r = this._gCanvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  _gHitNode(cx, cy, radius = 8) {
    if (!this._chart) return -1;
    const dpr = devicePixelRatio;
    const evs = this._chart.glitchEvents || [];
    for (let i = evs.length - 1; i >= 0; i--) {
      const nx = this._gTickToX(evs[i].y) * dpr;
      const ny = this._gLevelToY(evs[i].level) * dpr;
      if (Math.hypot(cx - nx, cy - ny) <= radius * dpr) return i;
    }
    return -1;
  }

  // ── Glitch canvas mouse handlers ──────────────────────────────────────────

  _onGMouseDown(e) {
    if (e.button !== 0) return;
    const [cx, cy] = this._gGetCanvasXY(e);
    const idx = this._gHitNode(cx * devicePixelRatio, cy * devicePixelRatio);
    if (idx >= 0) {
      this._gSel  = idx;
      this._gDrag = { evIdx: idx };
      e.preventDefault();
    } else {
      this._gAddNodeAt(cx, cy);
    }
    this._gDirty = true;
  }

  _onGMouseMove(e) {
    if (!this._gDrag) { this._gDirty = true; return; }
    const [cx, cy] = this._gGetCanvasXY(e);
    const evs = this._chart?.glitchEvents;
    if (!evs) return;
    const ev = evs[this._gDrag.evIdx];
    if (!ev) return;

    let tick  = this._gSnapTick(this._gXToTick(cx));
    let level = Math.round(this._gYToLevel(cy) * 2) / 2; // 0.5 steps
    level = Math.max(0, Math.min(10, level));

    if (this._gDrag.evIdx === 0) { tick = 0; }
    else {
      const prev = evs[this._gDrag.evIdx - 1];
      const next = evs[this._gDrag.evIdx + 1];
      tick = Math.max((prev?.y ?? 0) + 1, tick);
      if (next) tick = Math.min(next.y - 1, tick);
    }

    ev.y = tick; ev.level = level;
    this._notifyGlitchChange(false);
    this._gDirty = true;
  }

  _onGMouseUp(e) {
    if (this._gDrag) {
      saveUndo('Adjusted glitch envelope node');
      this._gDrag = null;
    }
    this._gDirty = true;
  }

  _onGRightClick(e) {
    const [cx, cy] = this._gGetCanvasXY(e);
    const idx = this._gHitNode(cx * devicePixelRatio, cy * devicePixelRatio);
    if (idx < 0 || !this._chart) return;
    if ((this._chart.glitchEvents || [])[idx]?.y === 0) return;
    saveUndo('Deleted glitch envelope node');
    this._chart.glitchEvents.splice(idx, 1);
    this._gSel = null;
    this._notifyGlitchChange();
  }

  _onGWheel(e) {
    e.preventDefault();
    const [cx] = this._gGetCanvasXY(e);
    const pivotTick = this._gXToTick(cx);
    const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8;
    const span = (this._gViewEnd - this._gViewStart) * zoomFactor;
    const total = this._chart?.totalTicks?.() ?? 192 * 64;
    const minSpan = 4 * 48;
    const clampedSpan = Math.min(Math.max(span, minSpan), total);
    const ratio = (pivotTick - this._gViewStart) / (this._gViewEnd - this._gViewStart);
    let newStart = pivotTick - ratio * clampedSpan;
    let newEnd   = newStart + clampedSpan;
    if (newStart < 0) { newStart = 0; newEnd = clampedSpan; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - clampedSpan); }
    this._gViewStart = newStart;
    this._gViewEnd   = newEnd;
    this._gDirty = true;
  }

  _gAddNodeAt(cx, cy) {
    if (!this._chart) return;
    let tick  = this._gSnapTick(this._gXToTick(cx));
    let level = Math.round(this._gYToLevel(cy) * 2) / 2;
    level = Math.max(0, Math.min(10, level));
    tick  = Math.max(0, tick);
    saveUndo('Added glitch envelope node');
    this._chart.addGlitchEvent(tick, level);
    const evs = this._chart.glitchEvents || [];
    this._gSel = evs.findIndex(e => e.y === tick);
    this._notifyGlitchChange();
  }

  _notifyGlitchChange(doUndo = false) {
    if (typeof updateGlitchEventList === 'function') updateGlitchEventList();
    render();
    this._gDirty = true;
  }

  // ── Glitch RAF loop ───────────────────────────────────────────────────────

  _startGlitchLoop() {
    if (this._gRaf) return;
    const loop = () => {
      if (this._gDirty) { this._drawGlitch(); this._gDirty = false; }
      this._gRaf = requestAnimationFrame(loop);
    };
    this._gRaf = requestAnimationFrame(loop);
  }
  _stopGlitchLoop() {
    if (this._gRaf) { cancelAnimationFrame(this._gRaf); this._gRaf = null; }
  }

  // ── Glitch canvas drawing ─────────────────────────────────────────────────

  _drawGlitch() {
    const canvas = this._gCanvas;
    const ctx    = this._gCtx;
    if (!canvas || !ctx) return;
    const dpr = devicePixelRatio;
    const W = canvas.width  / dpr;
    const H = canvas.height / dpr;
    const GCOL = '#aa44ff';

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#09091a';
    ctx.fillRect(0, 0, W, H);

    const evs = this._chart?.glitchEvents;
    if (!evs || evs.length === 0) {
      ctx.fillStyle = '#444'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('No chart loaded', W / 2, H / 2);
      ctx.restore();
      return;
    }

    const pad = 20;
    // Grid: horizontal level lines
    for (let lv = 0; lv <= 10; lv += 2) {
      const y = this._gLevelToY(lv);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y);
      ctx.strokeStyle = lv === 0 ? '#2a2a4a' : '#1a1a2e';
      ctx.lineWidth = lv === 0 ? 1.5 : 1;
      ctx.stroke();
    }
    // Grid: vertical measure lines
    const vs = this._gViewStart, ve = this._gViewEnd;
    const startM2 = Math.ceil(vs / TICKS_PER_MEASURE);
    const endM2   = Math.floor(ve / TICKS_PER_MEASURE);
    ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1;
    for (let m = startM2; m <= endM2; m++) {
      const x = this._gTickToX(m * TICKS_PER_MEASURE);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Envelope fill
    ctx.beginPath();
    const firstX = this._gTickToX(evs[0].y);
    const firstY = this._gLevelToY(evs[0].level);
    ctx.moveTo(firstX, H); ctx.lineTo(firstX, firstY);
    for (let i = 0; i < evs.length - 1; i++) {
      const e0 = evs[i], e1 = evs[i + 1];
      const x1 = this._gTickToX(e1.y);
      const y0 = this._gLevelToY(e0.level);
      const y1 = this._gLevelToY(e1.level);
      ctx.lineTo(x1, y0); ctx.lineTo(x1, y1);
    }
    const lx2 = this._gTickToX(this._gViewEnd);
    const ly2  = this._gLevelToY(evs[evs.length - 1].level);
    ctx.lineTo(lx2, ly2); ctx.lineTo(lx2, H); ctx.closePath();
    const grad2 = ctx.createLinearGradient(0, pad, 0, H);
    grad2.addColorStop(0, '#aa44ff33'); grad2.addColorStop(1, '#aa44ff08');
    ctx.fillStyle = grad2; ctx.fill();

    // Envelope line
    ctx.beginPath(); ctx.moveTo(firstX, firstY);
    for (let i = 0; i < evs.length - 1; i++) {
      const e0 = evs[i], e1 = evs[i + 1];
      const x1 = this._gTickToX(e1.y);
      const y0 = this._gLevelToY(e0.level);
      const y1 = this._gLevelToY(e1.level);
      ctx.lineTo(x1, y0); ctx.lineTo(x1, y1);
    }
    ctx.lineTo(lx2, ly2);
    ctx.strokeStyle = GCOL; ctx.lineWidth = 1.5; ctx.stroke();

    // Nodes
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const x = this._gTickToX(ev.y), y = this._gLevelToY(ev.level);
      const sel = i === this._gSel;
      ctx.beginPath(); ctx.arc(x, y, sel ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle   = sel ? '#cc88ff' : GCOL; ctx.fill();
      ctx.strokeStyle = sel ? '#fff8'   : '#aa44ff88'; ctx.lineWidth = 1; ctx.stroke();
      if (sel) {
        ctx.fillStyle = '#cc88ff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`${ev.level.toFixed(1)}`, x, y - 10);
      }
    }

    // Y axis labels
    ctx.fillStyle = '#555'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    for (let lv = 0; lv <= 10; lv += 2) {
      const y = this._gLevelToY(lv);
      if (y < pad || y > H - 4) continue;
      ctx.fillText(`L${lv}`, 20, y + 3);
    }

    // Measure labels
    const totalM2 = Math.ceil((ve - vs) / TICKS_PER_MEASURE);
    const step2   = totalM2 <= 16 ? 1 : totalM2 <= 32 ? 2 : totalM2 <= 64 ? 4 : 8;
    ctx.fillStyle = '#444'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    for (let m = startM2; m <= endM2; m++) {
      if ((m % step2) !== 0) continue;
      ctx.fillText(`M${m}`, this._gTickToX(m * TICKS_PER_MEASURE), H - 4);
    }

    // Zoom hint
    const measures2 = Math.round((this._gViewEnd - this._gViewStart) / TICKS_PER_MEASURE);
    ctx.fillStyle = '#333'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${measures2}m visible · scroll to zoom`, W - 4, 10);

    ctx.restore();
  }

  // ── Velocity canvas events ─────────────────────────────────────────────────

  _bindEvents() {
    const canvas = this._canvas;

    this._win.querySelector('#velenv-close').addEventListener('click', () => this.hide());

    this._win.querySelector('#velenv-add-node').addEventListener('click', () => this._addNodeAtPlayhead());

    this._win.querySelector('#velenv-maxspeed').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > this._minSpeed) { this._maxSpeed = v; this.invalidate(); }
    });
    this._win.querySelector('#velenv-minspeed').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v >= 0 && v < this._maxSpeed) { this._minSpeed = v; this.invalidate(); }
    });

    this._win.querySelector('#velenv-reset').addEventListener('click', () => {
      if (!this._chart) return;
      saveUndo('Reset velocity envelope to 1×');
      this._chart.scrollSpeedEvents = [{ y: 0, speed: 1.0, interp: 'step' }];
      this._sel = null;
      this._notifyChange();
    });

    canvas.addEventListener('mousedown',   e => this._onMouseDown(e));
    canvas.addEventListener('mousemove',   e => this._onMouseMove(e));
    canvas.addEventListener('mouseup',     e => this._onMouseUp(e));
    canvas.addEventListener('mouseleave',  e => this._onMouseUp(e));
    canvas.addEventListener('contextmenu', e => { e.preventDefault(); this._onRightClick(e); });
    canvas.addEventListener('dblclick',    e => this._onDblClick(e));
    canvas.addEventListener('wheel',       e => this._onWheel(e), { passive: false });

    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.clientWidth  * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      this.invalidate();
    });
    ro.observe(canvas);
  }

  // ── Zoom via scroll wheel ──────────────────────────────────────────────────

  _onWheel(e) {
    e.preventDefault();
    const [cx] = this._getCanvasXY(e);
    const pivotTick = this._xToTick(cx);
    const zoomFactor = e.deltaY > 0 ? 1.25 : 0.8;
    const span = (this._viewEnd - this._viewStart) * zoomFactor;
    const total = this._chart?.totalTicks?.() ?? 192 * 64;
    // Clamp minimum to 4 beats visible, max to full chart
    const minSpan = 4 * 48;
    const clampedSpan = Math.min(Math.max(span, minSpan), total);
    // Keep pivot point stationary under cursor
    const ratio = (pivotTick - this._viewStart) / (this._viewEnd - this._viewStart);
    let newStart = pivotTick - ratio * clampedSpan;
    let newEnd   = newStart + clampedSpan;
    // Clamp to chart bounds
    if (newStart < 0) { newStart = 0; newEnd = clampedSpan; }
    if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - clampedSpan); }
    this._viewStart = newStart;
    this._viewEnd   = newEnd;
    this.invalidate();
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
      resizing = true; ox = e.clientX; oy = e.clientY;
      ow = win.offsetWidth; oh = win.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      win.style.width  = Math.max(380, ow + e.clientX - ox) + 'px';
      win.style.height = Math.max(200, oh + e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { resizing = false; });
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  _snapTick(tick) {
    const snap = parseInt(this._win?.querySelector('#velenv-snap')?.value ?? '192', 10);
    if (!snap) return Math.round(tick);
    return Math.round(tick / snap) * snap;
  }
  _snapSpeed(spd) {
    const snap = parseFloat(this._win?.querySelector('#velenv-spsnap')?.value ?? '0.25');
    if (!snap) return +spd.toFixed(3);
    return Math.round(spd / snap) * snap;
  }
  _tickToX(tick) {
    const W = this._canvas.width / devicePixelRatio;
    return ((tick - this._viewStart) / (this._viewEnd - this._viewStart)) * W;
  }
  _xToTick(x) {
    const W = this._canvas.width / devicePixelRatio;
    return this._viewStart + (x / W) * (this._viewEnd - this._viewStart);
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
    const dpr = devicePixelRatio;
    const evs = this._chart.scrollSpeedEvents;
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
      this._drag = { evIdx: idx };
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

    if (this._drag.evIdx === 0) { tick = 0; }
    else {
      const prev = evs[this._drag.evIdx - 1];
      const next = evs[this._drag.evIdx + 1];
      tick = Math.max((prev?.y ?? 0) + 1, tick);
      if (next) tick = Math.min(next.y - 1, tick);
    }

    ev.y = tick; ev.speed = speed;
    this._notifyChange(false);
    this.invalidate();
  }

  _onMouseUp(e) {
    if (this._drag) {
      saveUndo('Adjusted velocity envelope node');
      this._drag = null;
    }
    this.invalidate();
  }

  _onRightClick(e) {
    const [cx, cy] = this._getCanvasXY(e);
    const idx = this._hitNode(cx * devicePixelRatio, cy * devicePixelRatio);
    if (idx < 0 || !this._chart) return;
    if (this._chart.scrollSpeedEvents[idx].y === 0) return;
    saveUndo('Deleted velocity envelope node');
    this._chart.scrollSpeedEvents.splice(idx, 1);
    this._sel = null;
    this._notifyChange();
  }

  _onDblClick(e) {
    if (!this._chart) return;
    const [cx] = this._getCanvasXY(e);
    const tick = this._xToTick(cx);
    const evs  = this._chart.scrollSpeedEvents;
    let segIdx = -1;
    for (let i = 0; i < evs.length - 1; i++) {
      if (tick >= evs[i].y && tick < evs[i + 1].y) { segIdx = i; break; }
    }
    if (segIdx < 0) return;
    const cur  = evs[segIdx].interp ?? 'step';
    const next = cur === 'step' ? 'linear' : 'step';
    saveUndo(`Velocity segment → ${next}`);
    this._chart.setScrollSpeedInterp(evs[segIdx].y, next);
    this._notifyChange();
  }

  _addNodeAt(cx, cy) {
    if (!this._chart) return;
    let tick  = this._snapTick(this._xToTick(cx));
    let speed = this._snapSpeed(this._yToSpeed(cy));
    speed = Math.max(this._minSpeed, Math.min(this._maxSpeed, speed));
    tick  = Math.max(0, tick);
    saveUndo('Added velocity envelope node');
    this._chart.addScrollSpeedEvent(tick, speed, 'step');
    const evs = this._chart.scrollSpeedEvents;
    this._sel = evs.findIndex(e => e.y === tick);
    this._notifyChange();
  }

  _addNodeAtPlayhead() {
    if (!this._chart) return;
    const tick = this._snapTick(renderer?.playTick ?? 0);
    const evs  = this._chart.scrollSpeedEvents;
    let speed = 1.0;
    for (let i = evs.length - 1; i >= 0; i--) {
      if (evs[i].y <= tick) { speed = evs[i].speed; break; }
    }
    saveUndo('Added velocity envelope node at playhead');
    this._chart.addScrollSpeedEvent(tick, speed, 'step');
    this._sel = this._chart.scrollSpeedEvents.findIndex(e => e.y === tick);
    this._notifyChange();
  }

  _notifyChange(doUndo = false) {
    if (typeof updateScrollSpeedEventList === 'function') updateScrollSpeedEventList();
    render();
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
    ctx.fillStyle = '#09091a';
    ctx.fillRect(0, 0, W, H);

    const evs = this._chart?.scrollSpeedEvents;
    if (!evs || evs.length === 0) {
      ctx.fillStyle = '#444'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
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
    this._drawZoomHint(ctx, W, H);
    ctx.restore();
  }

  _drawGrid(ctx, W, H, pad) {
    const steps = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
    for (const s of steps) {
      if (s < this._minSpeed || s > this._maxSpeed) continue;
      const y = this._speedToY(s);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y);
      if (s === 1.0) { ctx.strokeStyle = '#2a2a4a'; ctx.lineWidth = 1.5; }
      else           { ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1; }
      ctx.stroke();
    }
    const vs = this._viewStart, ve = this._viewEnd;
    const startM = Math.ceil(vs / TICKS_PER_MEASURE);
    const endM   = Math.floor(ve / TICKS_PER_MEASURE);
    ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1;
    for (let m = startM; m <= endM; m++) {
      const x = this._tickToX(m * TICKS_PER_MEASURE);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  _drawEnvelope(ctx, W, H, pad, evs) {
    if (!evs.length) return;
    ctx.beginPath();
    const firstX = this._tickToX(evs[0].y), firstY = this._speedToY(evs[0].speed);
    ctx.moveTo(firstX, H); ctx.lineTo(firstX, firstY);
    for (let i = 0; i < evs.length - 1; i++) {
      const e0 = evs[i], e1 = evs[i + 1];
      const x1 = this._tickToX(e1.y), y0 = this._speedToY(e0.speed), y1 = this._speedToY(e1.speed);
      if ((e0.interp ?? 'step') === 'linear') { ctx.lineTo(x1, y1); }
      else { ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); }
    }
    const lx = this._tickToX(this._viewEnd), ly = this._speedToY(evs[evs.length - 1].speed);
    ctx.lineTo(lx, ly); ctx.lineTo(lx, H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad, 0, H);
    grad.addColorStop(0, '#ff990033'); grad.addColorStop(1, '#ff990008');
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.moveTo(firstX, firstY);
    for (let i = 0; i < evs.length - 1; i++) {
      const e0 = evs[i], e1 = evs[i + 1];
      const x1 = this._tickToX(e1.y), y0 = this._speedToY(e0.speed), y1 = this._speedToY(e1.speed);
      if ((e0.interp ?? 'step') === 'linear') { ctx.lineTo(x1, y1); }
      else { ctx.lineTo(x1, y0); ctx.lineTo(x1, y1); }
    }
    ctx.lineTo(lx, ly);
    ctx.strokeStyle = '#ff9900'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  _drawNodes(ctx, evs) {
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const x = this._tickToX(ev.y), y = this._speedToY(ev.speed);
      const sel = i === this._sel;
      ctx.beginPath(); ctx.arc(x, y, sel ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle   = sel ? '#ffcc44' : '#ff9900'; ctx.fill();
      ctx.strokeStyle = sel ? '#fff8'   : '#ff990088'; ctx.lineWidth = 1; ctx.stroke();
      if (sel) {
        ctx.fillStyle = '#ffcc44'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`×${ev.speed.toFixed(2)}`, x, y - 10);
      }
    }
  }

  _drawAxisLabels(ctx, W, H, pad) {
    ctx.fillStyle = '#555'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    for (const s of [0.5, 1.0, 2.0, 3.0, 4.0, 5.0]) {
      const y = this._speedToY(s);
      if (y < pad || y > H - 4) continue;
      ctx.fillText(`×${s.toFixed(1)}`, 28, y + 3);
    }
  }

  _drawMeasureLabels(ctx, W, H) {
    const vs = this._viewStart, ve = this._viewEnd;
    const totalM = Math.ceil((ve - vs) / TICKS_PER_MEASURE);
    const step   = totalM <= 16 ? 1 : totalM <= 32 ? 2 : totalM <= 64 ? 4 : totalM <= 128 ? 8 : 16;
    ctx.fillStyle = '#444'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    const startM = Math.ceil(vs / TICKS_PER_MEASURE);
    const endM   = Math.floor(ve / TICKS_PER_MEASURE);
    for (let m = startM; m <= endM; m++) {
      if ((m % step) !== 0) continue;
      ctx.fillText(`M${m}`, this._tickToX(m * TICKS_PER_MEASURE), H - 4);
    }
  }

  _drawZoomHint(ctx, W, H) {
    // Show current zoom range in top-right
    const measures = Math.round((this._viewEnd - this._viewStart) / TICKS_PER_MEASURE);
    ctx.fillStyle = '#333'; ctx.font = '8px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`${measures}m visible · scroll to zoom`, W - 4, 10);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export let velEnvEditor = null;

export function getVelEnvEditor() {
  if (!velEnvEditor) {
    velEnvEditor = new VelocityEnvelopeEditor();
  }
  return velEnvEditor;
}

export function openVelEnvEditor() {
  const ed = getVelEnvEditor();
  if (typeof chart !== 'undefined' && chart) ed.setChart(chart);
  ed.show();
}

export function toggleVelEnvEditor() {
  const ed = getVelEnvEditor();
  if (ed.isVisible()) { ed.hide(); return; }
  openVelEnvEditor();
}
