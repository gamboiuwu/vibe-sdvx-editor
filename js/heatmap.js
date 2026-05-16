'use strict';

// ── Emotional Intensity Heatmap — full-chart density visualization ─────────────
// Per-measure note density displayed as a color gradient (cool → hot).
// Laser-L and Laser-R coverage shown as thin side channels.
// Click any row to seek the editor to that measure.

const _HM_STATE_KEY = 'vibe_editr_heatmap_win_v1';
let _hmWin     = null;
let _hmCanvas  = null;
let _hmCtx     = null;
let _hmVisible = false;
let _hmAnimId  = null;
let _hmLastTick = -1;

function _saveHmState(s) { try { localStorage.setItem(_HM_STATE_KEY, JSON.stringify(s)); } catch {} }
function _loadHmState()  { try { return JSON.parse(localStorage.getItem(_HM_STATE_KEY) || 'null'); } catch { return null; } }

// ── Color gradient: cold (sparse) → hot (dense) ───────────────────────────────
// Stops: [fraction, [r, g, b]]
const _HM_GRADIENT = [
  [0.00, [13,  13,  32]],
  [0.05, [10,  40, 110]],
  [0.20, [10, 100, 140]],
  [0.40, [30, 170,  60]],
  [0.60, [200, 170,  0]],
  [0.80, [224,  96,  0]],
  [1.00, [204,  16, 16]],
];

function _intensityColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < _HM_GRADIENT.length; i++) {
    const [t1, c1] = _HM_GRADIENT[i];
    if (t <= t1) {
      const [t0, c0] = _HM_GRADIENT[i - 1];
      const f = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},${Math.round(c0[1] + (c1[1] - c0[1]) * f)},${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
    }
  }
  return 'rgb(204,16,16)';
}

// ── Data computation ──────────────────────────────────────────────────────────
function _computeHeatmapData(ch) {
  const TPM = 192;
  const totalMeas = Math.max(1, ch.totalMeasures || 64);
  const noteCounts = new Float32Array(totalMeas);
  const laserLCov  = new Float32Array(totalMeas);
  const laserRCov  = new Float32Array(totalMeas);

  // BT notes: chip = 1pt; hold = 1pt + 0.5 per additional measure covered
  for (let i = 0; i < 4; i++) {
    (ch.bt[i] || []).forEach(n => {
      const m0 = Math.floor(n.y / TPM);
      if (m0 >= 0 && m0 < totalMeas) noteCounts[m0] += 1;
      if (n.len > 0) {
        const mEnd = Math.min(totalMeas - 1, Math.floor((n.y + n.len) / TPM));
        for (let mm = m0 + 1; mm <= mEnd; mm++) noteCounts[mm] += 0.5;
      }
    });
  }

  // FX notes: chip = 1.5pt; hold = 1.5pt + 0.75 per additional measure covered
  for (let i = 0; i < 2; i++) {
    (ch.fx[i] || []).forEach(n => {
      const m0 = Math.floor(n.y / TPM);
      if (m0 >= 0 && m0 < totalMeas) noteCounts[m0] += 1.5;
      if (n.len > 0) {
        const mEnd = Math.min(totalMeas - 1, Math.floor((n.y + n.len) / TPM));
        for (let mm = m0 + 1; mm <= mEnd; mm++) noteCounts[mm] += 0.75;
      }
    });
  }

  // Laser coverage: sampled at 12-tick resolution per measure
  const STEP = 12;
  for (let side = 0; side < 2; side++) {
    const arr = side === 0 ? laserLCov : laserRCov;
    (ch.lasers[side] || []).forEach(sec => {
      const pts    = sec.points || [];
      if (pts.length === 0) return;
      const secEnd = sec.y + (pts[pts.length - 1].ry ?? 0);
      for (let t = sec.y; t < secEnd; t += STEP) {
        const m = Math.floor(t / TPM);
        if (m >= 0 && m < totalMeas) arr[m] = Math.min(1, arr[m] + STEP / TPM);
      }
    });
  }

  // Saturation: use 80th percentile of non-zero measures for better contrast
  const nonZero = Array.from(noteCounts).filter(v => v > 0).sort((a, b) => a - b);
  const satPt   = nonZero.length ? nonZero[Math.floor(nonZero.length * 0.8)] : 1;
  const sat     = Math.max(satPt, 1);

  return {
    densities: Array.from(noteCounts).map(v => Math.min(1, v / sat)),
    rawCounts: Array.from(noteCounts),
    laserL:    Array.from(laserLCov),
    laserR:    Array.from(laserRCov),
    totalMeas,
  };
}

// ── Canvas rendering ──────────────────────────────────────────────────────────
function _drawHeatmap() {
  if (!_hmCanvas || !_hmCtx) return;
  const ch   = (typeof chart    !== 'undefined') ? chart    : null;
  const rend = (typeof renderer !== 'undefined') ? renderer : null;
  const cvs  = _hmCanvas;
  const ctx  = _hmCtx;
  const dpr  = window.devicePixelRatio || 1;
  const W    = cvs.clientWidth  || 210;
  const H    = cvs.clientHeight || 440;

  // Sync physical resolution to CSS size × DPR
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);
  if (cvs.width !== pw || cvs.height !== ph) {
    cvs.width  = pw;
    cvs.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#090914';
  ctx.fillRect(0, 0, W, H);

  if (!ch) {
    ctx.fillStyle = '#5566aa';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No chart loaded', W / 2, H / 2);
    ctx.textAlign = 'left';
    return;
  }

  const { densities, rawCounts, laserL, laserR, totalMeas } = _computeHeatmapData(ch);

  const RULER_W = 30;   // px for measure-number ruler
  const LL_W    = 6;    // px for laser-L channel
  const LR_W    = 6;    // px for laser-R channel
  const GAP     = 2;
  const MAIN_X  = RULER_W + LL_W + GAP;
  const MAIN_W  = W - MAIN_X - LR_W - GAP - 2;
  const ROW_H   = H / totalMeas;

  // ── Per-measure rows ───────────────────────────────────────────────────────
  for (let m = 0; m < totalMeas; m++) {
    const y = m * ROW_H;
    const h = Math.max(1, ROW_H);

    // Main heat bar
    ctx.fillStyle = _intensityColor(densities[m]);
    ctx.fillRect(MAIN_X, y, MAIN_W, h - 0.5);

    // Laser-L side channel
    if (laserL[m] > 0.01) {
      ctx.globalAlpha = Math.min(1, laserL[m] * 1.5);
      ctx.fillStyle   = '#2299ff';
      ctx.fillRect(RULER_W + 1, y, LL_W, h - 0.5);
      ctx.globalAlpha = 1;
    }

    // Laser-R side channel
    if (laserR[m] > 0.01) {
      ctx.globalAlpha = Math.min(1, laserR[m] * 1.5);
      ctx.fillStyle   = '#ff1188';
      ctx.fillRect(MAIN_X + MAIN_W + GAP, y, LR_W, h - 0.5);
      ctx.globalAlpha = 1;
    }

    // Measure number labels
    const labelEvery = ROW_H >= 10 ? 1 : ROW_H >= 5 ? 4 : ROW_H >= 3 ? 8 : 16;
    if (m % labelEvery === 0 || m === 0) {
      ctx.fillStyle  = '#6668a0';
      ctx.font       = `${Math.min(9, Math.max(6, ROW_H - 1))}px monospace`;
      ctx.textAlign  = 'right';
      ctx.fillText(m + 1, RULER_W - 3, y + ROW_H * 0.72);
    }
  }

  ctx.textAlign = 'left';

  // ── Row dividers every measure ─────────────────────────────────────────────
  if (ROW_H >= 3) {
    ctx.strokeStyle = '#00000066';
    ctx.lineWidth   = 0.5;
    for (let m = 1; m < totalMeas; m++) {
      const y = m * ROW_H;
      ctx.beginPath();
      ctx.moveTo(MAIN_X, y);
      ctx.lineTo(MAIN_X + MAIN_W, y);
      ctx.stroke();
    }
  }

  // ── Thicker grid lines every 4 measures ───────────────────────────────────
  ctx.strokeStyle = '#ffffff22';
  ctx.lineWidth   = 0.75;
  for (let m = 0; m < totalMeas; m += 4) {
    const y = m * ROW_H;
    ctx.beginPath();
    ctx.moveTo(RULER_W, y);
    ctx.lineTo(W - 2, y);
    ctx.stroke();
  }

  // ── Playhead line ──────────────────────────────────────────────────────────
  const playTick = rend?.playTick ?? 0;
  const playY    = (playTick / 192) * ROW_H;
  ctx.save();
  ctx.strokeStyle = '#ffffffdd';
  ctx.lineWidth   = 1.5;
  ctx.shadowColor = '#ffffff88';
  ctx.shadowBlur  = 4;
  ctx.beginPath();
  ctx.moveTo(RULER_W, playY);
  ctx.lineTo(W - 2, playY);
  ctx.stroke();
  ctx.restore();

  // ── Color scale legend at bottom ──────────────────────────────────────────
  const LEGEND_H = 8;
  const LEGEND_Y = H - LEGEND_H - 1;
  const LEGEND_X = MAIN_X;
  const LEGEND_W = MAIN_W;
  for (let px = 0; px < LEGEND_W; px++) {
    ctx.fillStyle = _intensityColor(px / LEGEND_W);
    ctx.fillRect(LEGEND_X + px, LEGEND_Y, 1, LEGEND_H);
  }
  ctx.strokeStyle = '#ffffff33';
  ctx.lineWidth   = 0.5;
  ctx.strokeRect(LEGEND_X, LEGEND_Y, LEGEND_W, LEGEND_H);
}

// ── Animation loop ────────────────────────────────────────────────────────────
function _startHmLoop() {
  if (_hmAnimId) return;
  const loop = () => {
    if (!_hmVisible) { _hmAnimId = null; return; }
    // Only redraw when tick changes (avoids wasted GPU work at idle)
    const tick = (typeof renderer !== 'undefined') ? (renderer?.playTick ?? 0) : 0;
    if (tick !== _hmLastTick) {
      _hmLastTick = tick;
      _drawHeatmap();
    }
    _hmAnimId = requestAnimationFrame(loop);
  };
  _hmAnimId = requestAnimationFrame(loop);
}

function _stopHmLoop() {
  if (_hmAnimId) { cancelAnimationFrame(_hmAnimId); _hmAnimId = null; }
}

// ── Drag-to-move helper ───────────────────────────────────────────────────────
function _makeHmDraggable(win, handle) {
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button,select,input')) return;
    const bx = e.clientX - win.getBoundingClientRect().left;
    const by = e.clientY - win.getBoundingClientRect().top;
    const move = ev => {
      win.style.left   = Math.max(0, ev.clientX - bx) + 'px';
      win.style.top    = Math.max(0, ev.clientY - by) + 'px';
      win.style.right  = 'auto';
      win.style.bottom = 'auto';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      _saveHmState({ left: win.style.left, top: win.style.top });
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// ── Window builder ────────────────────────────────────────────────────────────
function _buildHeatmapWindow() {
  const win = document.createElement('div');
  win.id = 'heatmap-window';
  win.style.cssText = [
    'position:fixed',
    'left:12px',
    'top:100px',
    'width:210px',
    'background:#090914',
    'border:1px solid #28285088',
    'border-radius:10px',
    'box-shadow:0 6px 32px #00003388,0 0 0 1px #0008',
    'z-index:2200',
    'display:none',
    'user-select:none',
    'font-family:monospace',
    'overflow:hidden',
    'flex-direction:column',
  ].join(';');

  const st = _loadHmState();
  if (st?.left) { win.style.left = st.left; win.style.right  = 'auto'; }
  if (st?.top)  { win.style.top  = st.top;  win.style.bottom = 'auto'; }

  win.innerHTML = `
<div id="hm-titlebar" style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f0f22;cursor:move;border-bottom:1px solid #22225088;flex-shrink:0">
  <span style="font-size:11px;font-weight:700;color:#8899cc;flex:1;letter-spacing:0.04em">&#x1F321; Intensity Heatmap</span>
  <button id="hm-close" style="background:none;border:none;color:#555;font-size:13px;cursor:pointer;padding:0 2px;line-height:1" title="Close">&#x2715;</button>
</div>
<div style="padding:3px 8px;border-bottom:1px solid #1a1a30;display:flex;align-items:center;gap:5px;flex-shrink:0">
  <span style="width:8px;height:8px;background:#2299ff;display:inline-block;border-radius:1px"></span>
  <span style="font-size:9px;color:#4488cc">L-Laser</span>
  <span style="flex:1;font-size:9px;color:#334;text-align:center">note density</span>
  <span style="font-size:9px;color:#cc44aa">R-Laser</span>
  <span style="width:8px;height:8px;background:#ff1188;display:inline-block;border-radius:1px"></span>
</div>
<canvas id="heatmap-canvas" style="width:210px;height:440px;display:block;cursor:crosshair;flex-shrink:0"></canvas>
<div style="padding:3px 8px 4px;background:#0b0b1c;border-top:1px solid #1a1a30;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
  <span style="font-size:8px;color:#3a3a6a;letter-spacing:0.03em">click to seek</span>
  <span id="hm-info" style="font-size:9px;color:#6668a0">—</span>
</div>
`;

  document.body.appendChild(win);

  _hmCanvas = win.querySelector('#heatmap-canvas');
  _hmCtx    = _hmCanvas.getContext('2d');

  _makeHmDraggable(win, win.querySelector('#hm-titlebar'));
  win.querySelector('#hm-close').addEventListener('click', closeHeatmapWindow);

  // Click → seek to that measure
  _hmCanvas.addEventListener('click', e => {
    const rect = _hmCanvas.getBoundingClientRect();
    const rel  = (e.clientY - rect.top) / rect.height;
    const ch   = (typeof chart    !== 'undefined') ? chart    : null;
    const rend = (typeof renderer !== 'undefined') ? renderer : null;
    if (!ch || !rend) return;
    const totalMeas = Math.max(1, ch.totalMeasures || 64);
    const tick = Math.max(0, Math.min(Math.round(rel * totalMeas * 192), (totalMeas - 1) * 192));
    rend.playTick = tick;
    if (typeof render === 'function') render();
    if (typeof updateSeekbar === 'function') updateSeekbar(tick);
    _drawHeatmap();
  });

  // Hover → show measure info in footer
  _hmCanvas.addEventListener('mousemove', e => {
    const rect  = _hmCanvas.getBoundingClientRect();
    const rel   = (e.clientY - rect.top) / rect.height;
    const ch    = (typeof chart !== 'undefined') ? chart : null;
    const info  = win.querySelector('#hm-info');
    if (!ch || !info) return;
    const totalMeas = Math.max(1, ch.totalMeasures || 64);
    const m = Math.min(totalMeas - 1, Math.max(0, Math.floor(rel * totalMeas)));
    const TPM = 192;
    let count = 0;
    for (let i = 0; i < 4; i++) (ch.bt[i] || []).forEach(n => { if (Math.floor(n.y / TPM) === m) count++; });
    for (let i = 0; i < 2; i++) (ch.fx[i] || []).forEach(n => { if (Math.floor(n.y / TPM) === m) count++; });
    info.textContent = `M${m + 1}: ${count} note${count !== 1 ? 's' : ''}`;
  });

  _hmCanvas.addEventListener('mouseleave', () => {
    const info = win.querySelector('#hm-info');
    if (info) info.textContent = '—';
  });

  return win;
}

// ── Public API ────────────────────────────────────────────────────────────────
function openHeatmapWindow() {
  if (!_hmWin) _hmWin = _buildHeatmapWindow();
  _hmWin.style.display = 'flex';
  _hmVisible = true;
  _saveHmState({ left: _hmWin.style.left, top: _hmWin.style.top });
  _hmLastTick = -1;
  _drawHeatmap();
  _startHmLoop();
}

function closeHeatmapWindow() {
  if (_hmWin) _hmWin.style.display = 'none';
  _hmVisible = false;
  _stopHmLoop();
  _saveHmState({ left: _hmWin?.style.left, top: _hmWin?.style.top, hidden: true });
}

// Called by render() / playFrame() whenever the chart or playhead changes.
function updateHeatmap() {
  if (!_hmWin || !_hmVisible) return;
  _hmLastTick = -1; // force redraw on next animation frame
}
