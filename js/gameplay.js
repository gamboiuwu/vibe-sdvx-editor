'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   vibe-editr  ·  Gameplay / Judgment Screen Panel
   Floating sub-window accessible via  Window → Gameplay…

   Reference for play options:
     https://voltexes.com/exceed-gear-play-options-guide

   Timing windows (SDVX EXCEED GEAR spec):
     S-CRIT  ≤ ±20.8 ms   → +5 EX pts
     CRITICAL  ≤ ±41.6 ms  → +2 EX pts
     NEAR      ≤ ±150 ms   → +0 EX pts
     ERROR     > ±150 ms   → +0 EX pts, breaks UC

   Score      : 0 – 10 000 000
   EX-score   : S-CRIT×5 + CRIT×2  (uncapped)
   MAX-#      : exMax − exScore  (0 = perfect)
   PUC        : all CRIT/S-CRIT, zero NEAR/ERROR
   UC         : all NEAR or better, zero ERROR
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Timing constants ─────────────────────────────────────────────────────────
const GP_S_CRIT_MS = 20.8;
const GP_CRIT_MS   = 41.6;
const GP_NEAR_MS   = 150.0;
const GP_SLAM_MS   = 100.0;

const GP_EX_S_CRIT = 5;
const GP_EX_CRIT   = 2;

// ── Window state ─────────────────────────────────────────────────────────────
let _gpWin   = null;
let _gpRaf   = null;
let _gpOpen  = false;

// DOM / canvas refs
let _gpElScore   = null;
let _gpElEx      = null;
let _gpElMaxHash = null;
let _gpElGrade   = null;
let _gpElStatus  = null;
let _gpElChain   = null;
let _gpElSCrit   = null, _gpElCrit  = null, _gpElNear  = null, _gpElError = null;
let _gpElBarSC   = null, _gpElBarC  = null, _gpElBarN  = null, _gpElBarE  = null;
let _gpBtCells   = [];   // 4 BT cells
let _gpFxCells   = [];   // 2 FX cells
let _gpVolCanvas = [];   // 2 <canvas> for VOL dials

const _GP_WIN_KEY = 'vibe_gameplay_win';

// ── Scoring helpers ───────────────────────────────────────────────────────────

function gpTotalObjects(chart) {
  if (!chart) return 1;
  if (typeof gameView !== 'undefined' && gameView?.countChain)
    return Math.max(1, gameView.countChain(chart, Infinity));
  const HS = (typeof HOLD_SAMPLE !== 'undefined') ? HOLD_SAMPLE : 240;
  let n = 0;
  for (let li = 0; li < 4; li++)
    for (const note of chart.bt[li])
      n += note.len === 0 ? 1 : Math.max(1, Math.floor(note.len / HS));
  for (let li = 0; li < 2; li++)
    for (const note of chart.fx[li])
      n += note.len === 0 ? 1 : Math.max(1, Math.floor(note.len / (HS * 2)));
  for (let s = 0; s < 2; s++)
    for (const sec of chart.lasers[s]) {
      const dur = sec.points[sec.points.length - 1]?.ry ?? 0;
      n += Math.max(0, Math.ceil(dur / HS));
    }
  return Math.max(1, n);
}

function gpChainAt(chart, tick) {
  if (!chart) return 0;
  if (typeof gameView !== 'undefined' && gameView?.countChain)
    return gameView.countChain(chart, tick);
  return 0;
}

function gpStats(chart, tick) {
  if (!chart) return { score: 0, exScore: 0, exMax: 0, sCrit: 0, crit: 0, near: 0, error: 0, chain: 0, total: 0 };
  const total   = gpTotalObjects(chart);
  const chain   = gpChainAt(chart, tick);
  const score   = (typeof gameView !== 'undefined' && gameView?._calcScore)
                  ? gameView._calcScore(chart, tick) : 0;
  const exMax   = total * GP_EX_S_CRIT;
  const exScore = chain * GP_EX_S_CRIT;
  return { score, exScore, exMax, sCrit: chain, crit: 0, near: 0, error: 0, chain, total };
}

function gpGrade(score) {
  if (score >= 9900000) return { label: 'S',    color: '#ffe866' };
  if (score >= 9800000) return { label: 'AAA+', color: '#ffcc00' };
  if (score >= 9700000) return { label: 'AAA',  color: '#ffcc00' };
  if (score >= 9500000) return { label: 'AA+',  color: '#88ccff' };
  if (score >= 9300000) return { label: 'AA',   color: '#88ccff' };
  if (score >= 9000000) return { label: 'A+',   color: '#aaffaa' };
  if (score >= 8700000) return { label: 'A',    color: '#aaffaa' };
  if (score >= 7500000) return { label: 'B',    color: '#d8d8f0' };
  if (score >= 6500000) return { label: 'C',    color: '#d8d8f0' };
  return                       { label: 'D',    color: '#ff7777' };
}

function gpStatus(stats) {
  if (stats.total === 0) return { label: '—',     color: '#5558a0' };
  if (stats.error === 0 && stats.near === 0) return { label: 'PUC',   color: '#ffe866' };
  if (stats.error === 0)                     return { label: 'UC',    color: '#00cfff' };
  return                                            { label: 'CLEAR', color: '#aaffaa' };
}

// Fixed BPM lookup — ChartData uses bpmEvents[].bpm, not bpms[].v
function _gpGetBPM(chart, tick) {
  if (!chart?.bpmEvents?.length) return 120;
  let bpm = chart.bpmEvents[0]?.bpm ?? 120;
  for (const ev of chart.bpmEvents) {
    if (ev.y <= tick) bpm = ev.bpm ?? bpm;
    else break;
  }
  return bpm;
}

// ── VOL dial renderer ─────────────────────────────────────────────────────────
// Draws a circular knob indicator (0 = far left, 1 = far right).
// pos = null means laser is inactive.
function _gpDrawDial(canvas, pos, color, side = 0) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const r  = Math.min(cx, cy) - 3;

  ctx.clearRect(0, 0, W, H);

  // Outer ring track
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.strokeStyle = '#1a1a38';
  ctx.lineWidth   = 4;
  ctx.lineCap     = 'round';
  ctx.stroke();

  if (pos !== null) {
    // Active arc (0→pos mapped to 270° sweep)
    const startAng = 0.75 * Math.PI;
    const sweepAng = 1.5 * Math.PI * pos;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, startAng + sweepAng);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 4;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 8;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // Indicator dot
    const ang = startAng + sweepAng;
    const dx  = cx + Math.cos(ang) * r;
    const dy  = cy + Math.sin(ang) * r;
    ctx.beginPath();
    ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.shadowBlur  = 0;
  }

  // Inner circle fill
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.7);
  grad.addColorStop(0, pos !== null ? color + '22' : '#08080f');
  grad.addColorStop(1, '#08080f');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Label
  ctx.fillStyle    = pos !== null ? color : '#333360';
  ctx.font         = `bold ${Math.round(W * 0.22)}px monospace`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(side === 0 ? 'L' : 'R', cx, cy);
}

// ── Window builder ────────────────────────────────────────────────────────────

function _gpBuild() {
  const win = document.createElement('div');
  win.className = 'gp-window';

  // ── Title bar ──
  const tb = document.createElement('div');
  tb.className = 'gp-titlebar';
  const tl = document.createElement('div');
  tl.className = 'gp-trafficlights';
  tl.appendChild(_gpTL('gp-tl-close', '×', () => closeGameplayPanel()));
  tl.appendChild(_gpTL('gp-tl-min',   '−', () => win.classList.toggle('gp-collapsed')));
  const title = document.createElement('span');
  title.className = 'gp-title';
  title.textContent = '🎮 Judgment Screen';
  tb.appendChild(tl);
  tb.appendChild(title);
  win.appendChild(tb);

  // ── Body (two-column layout) ──
  const body = document.createElement('div');
  body.className = 'gp-body';

  // ─ Top strip: score + grade + status ─
  const scoreRow = document.createElement('div');
  scoreRow.className = 'gp-score-row';

  _gpElGrade = document.createElement('div');
  _gpElGrade.className = 'gp-grade';
  _gpElGrade.textContent = '—';

  const scoreNums = document.createElement('div');
  scoreNums.className = 'gp-score-nums';
  _gpElScore = document.createElement('div');
  _gpElScore.className = 'gp-score-main';
  _gpElScore.textContent = "0000'0000";
  _gpElStatus = document.createElement('div');
  _gpElStatus.className = 'gp-status';
  _gpElStatus.textContent = '—';
  scoreNums.appendChild(_gpElScore);
  scoreNums.appendChild(_gpElStatus);

  scoreRow.appendChild(_gpElGrade);
  scoreRow.appendChild(scoreNums);
  body.appendChild(scoreRow);

  // ─ EX + MAX-# + CHAIN ─
  const exRow = document.createElement('div');
  exRow.className = 'gp-ex-row';
  const exLabel = _gpSpan('EX-Score', 'gp-ex-label');
  _gpElEx = _gpSpan('0', 'gp-ex-val');
  const maxLabel = _gpSpan('MAX-', 'gp-max-label');
  _gpElMaxHash = _gpSpan('0', 'gp-max-val');
  _gpElChain   = _gpSpan('× 0', 'gp-chain');
  exRow.append(exLabel, _gpElEx, maxLabel, _gpElMaxHash, _gpElChain);
  body.appendChild(exRow);

  // ─ Controller area (grid + VOL dials side by side) ─
  const ctrlWrap = document.createElement('div');
  ctrlWrap.className = 'gp-ctrl-wrap';

  // BT/FX grid
  const grid = document.createElement('div');
  grid.className = 'gp-grid';
  _gpBtCells = [];
  _gpFxCells = [];

  // BT row — A B C D
  const btRow = document.createElement('div');
  btRow.className = 'gp-grid-row';
  ['A','B','C','D'].forEach(l => {
    const c = _gpGridCell(`BT-${l}`, '#d8d8ff');
    _gpBtCells.push(c);
    btRow.appendChild(c);
  });
  grid.appendChild(btRow);

  // FX row — FX-L (spans 2) · FX-R (spans 2)
  const fxRow = document.createElement('div');
  fxRow.className = 'gp-grid-row';
  const fxl = _gpGridCell('FX-L', '#ff8c00', 'gp-cell-fx gp-cell-fx-wide');
  const fxr = _gpGridCell('FX-R', '#ff8c00', 'gp-cell-fx gp-cell-fx-wide');
  _gpFxCells = [fxl, fxr];
  fxRow.appendChild(fxl);
  fxRow.appendChild(fxr);
  grid.appendChild(fxRow);

  ctrlWrap.appendChild(grid);

  // VOL dials
  const dialWrap = document.createElement('div');
  dialWrap.className = 'gp-dial-wrap';
  _gpVolCanvas = [];
  ['#0088ff', '#ff1177'].forEach((col, i) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'gp-dial-item';
    const cv = document.createElement('canvas');
    cv.width = cv.height = 56;
    cv.className = 'gp-dial-canvas';
    _gpDrawDial(cv, null, col, i);
    _gpVolCanvas.push(cv);
    wrapper.appendChild(cv);
    dialWrap.appendChild(wrapper);
  });
  ctrlWrap.appendChild(dialWrap);

  body.appendChild(ctrlWrap);

  // ─ Judgment breakdown bars ─
  const bars = document.createElement('div');
  bars.className = 'gp-bars';
  const judgments = [
    { key: 'S-CRIT', color: '#ffe866', elRef: 'sc' },
    { key: 'CRIT',   color: '#00cfff', elRef: 'c'  },
    { key: 'NEAR',   color: '#aa44ff', elRef: 'n'  },
    { key: 'ERROR',  color: '#ff3366', elRef: 'e'  },
  ];
  judgments.forEach(j => {
    const row  = document.createElement('div');
    row.className = 'gp-bar-row';
    const lbl  = _gpSpan(j.key, 'gp-bar-label');
    lbl.style.color = j.color;
    const val  = _gpSpan('0', 'gp-bar-val');
    const track = document.createElement('div');
    track.className = 'gp-bar-track';
    const fill = document.createElement('div');
    fill.className = 'gp-bar-fill';
    fill.style.background = j.color;
    fill.style.width = '0%';
    track.appendChild(fill);
    row.append(lbl, val, track);
    bars.appendChild(row);
    switch (j.elRef) {
      case 'sc': _gpElSCrit = val; _gpElBarSC = fill; break;
      case 'c':  _gpElCrit  = val; _gpElBarC  = fill; break;
      case 'n':  _gpElNear  = val; _gpElBarN  = fill; break;
      case 'e':  _gpElError = val; _gpElBarE  = fill; break;
    }
  });
  body.appendChild(bars);

  // ─ Timing reference footer ─
  const ref = document.createElement('div');
  ref.className = 'gp-timing-ref';
  ref.innerHTML =
    `<span style="color:#ffe866">S-CRIT ±${GP_S_CRIT_MS}ms</span>` +
    `<span class="gp-tr-sep">·</span>` +
    `<span style="color:#00cfff">CRIT ±${GP_CRIT_MS}ms</span>` +
    `<span class="gp-tr-sep">·</span>` +
    `<span style="color:#aa44ff">NEAR ±${GP_NEAR_MS}ms</span>` +
    `<span class="gp-tr-sep">·</span>` +
    `<span style="color:#888">SLAM ~${GP_SLAM_MS}ms</span>`;
  body.appendChild(ref);

  win.appendChild(body);

  // Resize handle
  const rh = document.createElement('div');
  rh.className = 'gp-resize';
  win.appendChild(rh);

  _gpMakeDraggable(win, tb);
  _gpMakeResizable(win, rh);
  return win;
}

function _gpTL(cls, txt, fn) {
  const b = document.createElement('button');
  b.className = 'gp-tl ' + cls;
  b.textContent = txt;
  b.addEventListener('click', fn);
  return b;
}

function _gpSpan(text, cls) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function _gpGridCell(label, color, extraClass = '') {
  const c = document.createElement('div');
  c.className = ('gp-cell ' + extraClass).trim();
  c.dataset.lane = label;
  c.style.setProperty('--lane-color', color);
  const lbl = document.createElement('span');
  lbl.className = 'gp-cell-lbl';
  lbl.textContent = label;
  c.appendChild(lbl);
  return c;
}

// ── Drag & resize ─────────────────────────────────────────────────────────────

function _gpMakeDraggable(win, handle) {
  let on = false, sx, sy, ox, oy;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    on = true; sx = e.clientX; sy = e.clientY;
    ox = win.offsetLeft; oy = win.offsetTop;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!on) return;
    win.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
    win.style.top  = Math.max(0, oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { if (on) { on = false; _gpSaveWin(); } });
}

function _gpMakeResizable(win, handle) {
  let on = false, sx, sy, sw, sh;
  handle.addEventListener('mousedown', e => {
    on = true; sx = e.clientX; sy = e.clientY;
    sw = win.offsetWidth; sh = win.offsetHeight;
    e.preventDefault(); e.stopPropagation();
    document.body.style.cursor = 'se-resize';
  });
  document.addEventListener('mousemove', e => {
    if (!on) return;
    win.style.width  = Math.max(360, sw + e.clientX - sx) + 'px';
    win.style.height = Math.max(280, sh + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (on) { on = false; document.body.style.cursor = ''; _gpSaveWin(); }
  });
}

// ── Persistence ───────────────────────────────────────────────────────────────

function _gpSaveWin() {
  if (!_gpWin) return;
  try {
    localStorage.setItem(_GP_WIN_KEY, JSON.stringify({
      left: _gpWin.style.left, top: _gpWin.style.top,
      width: _gpWin.style.width, height: _gpWin.style.height,
    }));
  } catch {}
}

function _gpLoadWin() {
  try { return JSON.parse(localStorage.getItem(_GP_WIN_KEY) || 'null'); } catch { return null; }
}

// ── Render loop ───────────────────────────────────────────────────────────────

function _gpRender() {
  if (!_gpWin || !_gpOpen || _gpWin.style.display === 'none') {
    _gpRaf = null; return;
  }

  const gv = typeof gameView !== 'undefined' ? gameView : null;
  const ch = gv?.chart ?? (typeof chart !== 'undefined' ? chart : null);
  const isPlaying = typeof playing !== 'undefined' && playing;
  const tick = isPlaying
    ? (gv?.playTick ?? (typeof renderer !== 'undefined' ? renderer?.playTick : 0) ?? 0)
    : Infinity;

  const stats  = gpStats(ch, tick);
  const grade  = gpGrade(stats.score);
  const status = gpStatus(stats);

  // Score
  const scoreFmt = String(stats.score).padStart(8, '0').replace(/(\d)(\d{4})$/, "$1'$2");
  _gpElScore.textContent   = scoreFmt;
  _gpElGrade.textContent   = grade.label;
  _gpElGrade.style.color   = grade.color;
  _gpElStatus.textContent  = status.label;
  _gpElStatus.style.color  = status.color;
  _gpElEx.textContent      = stats.exScore.toLocaleString();
  _gpElChain.textContent   = '× ' + stats.chain.toLocaleString();

  const maxHash = Math.max(0, stats.exMax - stats.exScore);
  _gpElMaxHash.textContent  = maxHash;
  _gpElMaxHash.style.color  = maxHash === 0 ? '#ffe866' : '#d8d8f0';

  // Bars
  const total = Math.max(1, stats.total);
  _gpElSCrit.textContent = stats.sCrit;
  _gpElCrit.textContent  = stats.crit;
  _gpElNear.textContent  = stats.near;
  _gpElError.textContent = stats.error;
  _gpElBarSC.style.width = ((stats.sCrit  / total) * 100).toFixed(1) + '%';
  _gpElBarC.style.width  = ((stats.crit   / total) * 100).toFixed(1) + '%';
  _gpElBarN.style.width  = ((stats.near   / total) * 100).toFixed(1) + '%';
  _gpElBarE.style.width  = ((stats.error  / total) * 100).toFixed(1) + '%';

  // BT / FX cells — light up when notes are near judgment line
  _gpUpdateLaneCells(ch, isPlaying ? tick : null);

  // VOL dials — show current laser position when playing
  _gpUpdateDials(ch, isPlaying ? tick : null);

  _gpRaf = requestAnimationFrame(_gpRender);
}

function _gpUpdateLaneCells(chart, tick) {
  const activeBt = [false, false, false, false];
  const activeFx = [false, false];

  if (chart && tick !== null) {
    const bpm       = _gpGetBPM(chart, tick);
    const tPerMs    = bpm > 0 ? (TICKS_PER_BEAT * bpm) / 60000 : 0;
    const nearTicks = GP_NEAR_MS * tPerMs;

    for (let li = 0; li < 4; li++)
      for (const n of chart.bt[li]) {
        const end = n.y + Math.max(0, n.len);
        if (tick >= n.y - nearTicks && tick <= end + nearTicks) { activeBt[li] = true; break; }
      }
    for (let li = 0; li < 2; li++)
      for (const n of chart.fx[li]) {
        const end = n.y + Math.max(0, n.len);
        if (tick >= n.y - nearTicks && tick <= end + nearTicks) { activeFx[li] = true; break; }
      }
  }

  _gpBtCells.forEach((c, i) => c.classList.toggle('gp-cell-active', activeBt[i]));
  _gpFxCells.forEach((c, i) => c.classList.toggle('gp-cell-active', activeFx[i]));
}

function _gpUpdateDials(chart, tick) {
  if (_gpVolCanvas.length < 2) return;
  const getLaserPos = (side, t) => {
    if (!chart || t === null) return null;
    for (const sec of chart.lasers[side]) {
      if (t < sec.y) continue;
      const pts = sec.points;
      for (let pi = 0; pi < pts.length - 1; pi++) {
        const t0 = sec.y + pts[pi].ry, t1 = sec.y + pts[pi+1].ry;
        if (t >= t0 && t <= t1) {
          const r = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
          return pts[pi].v + (pts[pi+1].v - pts[pi].v) * r;
        }
      }
      const last = pts[pts.length - 1];
      if (last && sec.y + last.ry >= t) return last.v;
    }
    return null;
  };

  const lv = getLaserPos(0, tick);
  const rv = getLaserPos(1, tick);
  _gpDrawDial(_gpVolCanvas[0], lv, '#0088ff', 0);
  _gpDrawDial(_gpVolCanvas[1], rv, '#ff1177', 1);
}

// ── Public API ────────────────────────────────────────────────────────────────

function openGameplayPanel() {
  if (!_gpWin) {
    _gpWin = _gpBuild();
    const st = _gpLoadWin();
    if (st?.width && !st.width.includes('%') && !st.width.includes('calc')) {
      if (st.left)   _gpWin.style.left   = st.left;
      if (st.top)    _gpWin.style.top    = st.top;
      if (st.width)  _gpWin.style.width  = st.width;
      if (st.height) _gpWin.style.height = st.height;
    }
    document.body.appendChild(_gpWin);
  }
  _gpWin.style.display = 'flex';
  _gpOpen = true;
  if (!_gpRaf) _gpRaf = requestAnimationFrame(_gpRender);
}

function closeGameplayPanel() {
  if (_gpWin) _gpWin.style.display = 'none';
  _gpOpen = false;
  if (_gpRaf) { cancelAnimationFrame(_gpRaf); _gpRaf = null; }
  _gpSaveWin();
}

function toggleGameplayPanel() {
  if (!_gpWin || _gpWin.style.display === 'none') openGameplayPanel();
  else closeGameplayPanel();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
window.openGameplayPanel   = openGameplayPanel;
window.closeGameplayPanel  = closeGameplayPanel;
window.toggleGameplayPanel = toggleGameplayPanel;
window.GP_S_CRIT_MS = GP_S_CRIT_MS;
window.GP_CRIT_MS   = GP_CRIT_MS;
window.GP_NEAR_MS   = GP_NEAR_MS;
window.GP_SLAM_MS   = GP_SLAM_MS;
