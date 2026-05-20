import { chart, renderer } from './app.js';
import { TICKS_PER_MEASURE, TICKS_PER_BEAT, BEATS_PER_MEASURE } from './chart.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Pattern Radar — SDVX-style 6-axis chart analysis window  (v2)
   Axes (clockwise from top): NOTES · PEAK · TSUMAMI · TRICKY · HAND TRIP · ONE HAND
   Max value per axis: 200 (matches official SDVX Effect Radar scale)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Constants ─────────────────────────────────────────────────────────────────
const RADAR_MAX    = 200;
const RADAR_LABELS = ['NOTES', 'PEAK', 'TSUMAMI', 'TRICKY', 'HAND\nTRIP', 'ONE\nHAND'];
const RADAR_AXIS_COLORS = ['#44ff88', '#ff4466', '#cc44ff', '#ffcc00', '#ff8822', '#44ccff'];
// Canvas angles: clockwise from top (270° = 12 o'clock)
const RADAR_ANG = [270, 330, 30, 90, 150, 210].map(a => (a * Math.PI) / 180);
const _RADAR_STATE_KEY = 'vibe_editr_radar_win_v2';

// ── DOM / animation state ────────────────────────────────────────────────────
let _rdrWin     = null;
let _rdrCanvas  = null;
let _rdrCtx     = null;
let _rdrWindowM = 8;    // measures to analyse around cursor
let _rdrVisible = false;

// Lerped display scores (what's actually painted)
let _rdrDisplayScores = [0, 0, 0, 0, 0, 0];
// Target scores (computed from chart)
let _rdrTargetScores  = [0, 0, 0, 0, 0, 0];
// AI-detected pattern bonuses (accumulated, normalised 0-1 per axis)
let _rdrAiBonus = [0, 0, 0, 0, 0, 0];

// 60-fps loop
let _rdrAnimId = null;

// ── User-tunable parameters ──────────────────────────────────────────────────
// These are driven by sliders in the radar panel
let _rdrParams = {
  laserBias:    0.0,   // -1 = full left, +1 = full right; 0 = balanced
  slamSens:     1.0,   // multiplier on slam/tricky contribution [0.2 – 2.0]
  densityCurve: 'lin', // 'lin' | 'log' | 'exp'
  aiWeight:     0.4,   // 0 = pure algorithm, 1 = fully AI-adjusted
};

// ── Persistence ───────────────────────────────────────────────────────────────
function _saveRdrState(s) { try { localStorage.setItem(_RADAR_STATE_KEY, JSON.stringify(s)); } catch {} }
function _loadRdrState()  { try { return JSON.parse(localStorage.getItem(_RADAR_STATE_KEY) || 'null'); } catch { return null; } }

// ── Global PEAK cache ─────────────────────────────────────────────────────────
// PEAK scans the whole chart, so we cache it per chart reference to avoid
// repeating an O(N) sweep every frame during playback.
let _peakCacheRef   = null;   // the chart object we last scanned
let _peakCacheValue = 0;      // cached result (0-200)

/**
 * Compute PEAK score (0-200) by scanning the ENTIRE chart with a sliding
 * 1-beat (48-tick) window, stepped every 12 ticks (one 1/16th-note).
 *
 * Why global scan?  SDVX's "PEAK" axis represents the chart's hardest instant —
 * its densest burst — not the density near the cursor.  A chart with a single
 * brutal 2-second rush should always show a high PEAK even while the cursor sits
 * in the quiet intro.  Scrolling through the chart must not change PEAK.
 *
 * Algorithm: two-pointer O(N) sliding window.
 *
 * Calibration (empirical, matches SDVX official radar scale):
 *   ≥ 18 notes / 48 ticks  →  200   (physically impossible: all 6 buttons every 16th)
 *   ~12 notes / 48 ticks   →  ~133  (4-button chord stream, extremely hard)
 *    ~6 notes / 48 ticks   →  ~67   (2-button stream, moderate density)
 *    ~3 notes / 48 ticks   →  ~33   (sparse / easy)
 */
function _computeGlobalPeak(ch) {
  if (!ch) return 0;
  if (ch === _peakCacheRef) return _peakCacheValue;

  const PEAK_WIN       = 48;   // 1 beat = 48 ticks
  const PEAK_STEP      = 12;   // 1/16th note step
  const PEAK_MAX_NOTES = 18;   // notes in PEAK_WIN that saturates to 200

  // Collect ALL note-start positions (BT chips+holds, FX chips+holds)
  const allTicks = [];
  for (let i = 0; i < 4; i++) (ch.bt[i] || []).forEach(n => allTicks.push(n.y));
  for (let i = 0; i < 2; i++) (ch.fx[i] || []).forEach(n => allTicks.push(n.y));

  if (allTicks.length === 0) {
    _peakCacheRef = ch; _peakCacheValue = 0; return 0;
  }
  allTicks.sort((a, b) => a - b);

  const tStart = allTicks[0];
  const tEnd   = allTicks[allTicks.length - 1];

  // Two-pointer sliding window: O(total notes + (tEnd-tStart)/PEAK_STEP)
  let maxNotes = 0, lo = 0, hi = 0;
  for (let t = tStart; t <= tEnd; t += PEAK_STEP) {
    while (hi < allTicks.length && allTicks[hi] < t + PEAK_WIN) hi++;
    while (lo < allTicks.length && allTicks[lo] < t) lo++;
    const count = hi - lo;
    if (count > maxNotes) maxNotes = count;
  }

  const raw   = Math.min(1, maxNotes / PEAK_MAX_NOTES);
  const score = Math.round(_applyCurve(raw) * RADAR_MAX);
  _peakCacheRef   = ch;
  _peakCacheValue = score;
  return score;
}

// Invalidate PEAK cache (call when chart changes)
function _invalidatePeakCache() { _peakCacheRef = null; _peakCacheValue = 0; }

// ── AI pattern detection ──────────────────────────────────────────────────────
/**
 * Identifies high-level patterns in a note window and returns a bonus vector
 * [notes_bonus, peak_bonus, tsumami_bonus, tricky_bonus, handtrip_bonus, onehand_bonus]
 * Each value in [0, 1] — will be blended with the algorithmic score via aiWeight.
 */
function _detectPatterns(ch, start, end) {
  const TPM = 192;
  const bonus = [0, 0, 0, 0, 0, 0];
  if (!ch) return bonus;

  // Gather all BT/FX notes in window
  const notes = [];
  for (let i = 0; i < 4; i++) {
    (ch.bt[i] || []).forEach(n => {
      if (n.y >= start && n.y < end) notes.push({ y: n.y, len: n.l || 0, lane: i, kind: 'bt' });
    });
  }
  for (let i = 0; i < 2; i++) {
    (ch.fx[i] || []).forEach(n => {
      if (n.y >= start && n.y < end) notes.push({ y: n.y, len: n.l || 0, lane: i + 4, kind: 'fx' });
    });
  }
  notes.sort((a, b) => a.y - b.y);

  const n = notes.length;
  if (n < 2) return bonus;

  // ── Trill detection (rapid alternation between adjacent lanes, ≤12t gap) ──
  let trillRuns = 0, trillLen = 0, maxTrill = 0;
  for (let i = 1; i < n; i++) {
    const gap      = notes[i].y - notes[i - 1].y;
    const adjLanes = Math.abs(notes[i].lane - notes[i - 1].lane) === 1;
    const btOnly   = notes[i].kind === 'bt' && notes[i - 1].kind === 'bt';
    if (adjLanes && btOnly && gap <= 12 && gap > 0) {
      trillLen++;
      if (trillLen >= 3) { trillRuns++; maxTrill = Math.max(maxTrill, trillLen); }
    } else {
      trillLen = 0;
    }
  }
  const trillScore = Math.min(1, trillRuns / Math.max(1, n * 0.15));

  // ── Jack detection (same lane rapid repeat, ≤6t gap) ─────────────────────
  let jackCount = 0;
  for (let i = 1; i < n; i++) {
    if (notes[i].lane === notes[i - 1].lane && notes[i].y - notes[i - 1].y <= 6) jackCount++;
  }
  const jackScore = Math.min(1, jackCount / Math.max(1, n * 0.12));

  // ── Chord detection (3+ notes at same tick ± 3t) ──────────────────────────
  let chordCount = 0;
  for (let i = 0; i < n; i++) {
    let cluster = 1;
    for (let j = i + 1; j < n && notes[j].y - notes[i].y <= 3; j++) cluster++;
    if (cluster >= 3) { chordCount++; i += cluster - 1; }
  }
  const chordScore = Math.min(1, chordCount / Math.max(1, (end - start) / TPM * 2));

  // ── Jumpstream (4-lane spread in short window) ────────────────────────────
  let jumpCount = 0;
  const WIN = 48; // 1-beat window
  for (let t = start; t < end; t += WIN) {
    const inWin = notes.filter(x => x.y >= t && x.y < t + WIN);
    const lanes = new Set(inWin.map(x => x.lane));
    if (lanes.size >= 4) jumpCount++;
  }
  const jsScore = Math.min(1, jumpCount / Math.max(1, (end - start) / WIN * 0.3));

  // ── LaserPivot (extreme reversals: direction flip in < 1/8-note) ──────────
  let laserPivots = 0;
  for (let side = 0; side < 2; side++) {
    (ch.lasers[side] || []).forEach(sec => {
      if (sec.y >= end || sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0) < start) return;
      for (let pi = 1; pi < sec.points.length - 1; pi++) {
        const prev = sec.points[pi - 1];
        const cur  = sec.points[pi];
        const nxt  = sec.points[pi + 1];
        const d1   = cur.v - prev.v;
        const d2   = nxt.v - cur.v;
        if (Math.sign(d1) !== Math.sign(d2) && Math.abs(d1) > 0.25 && Math.abs(d2) > 0.25) {
          laserPivots++;
        }
      }
    });
  }
  const pivotScore = Math.min(1, laserPivots / Math.max(1, (end - start) / TPM * 3));

  // ── LaserGrind (sustained mid-position laser hold > 2 measures) ───────────
  let grindTicks = 0;
  for (let side = 0; side < 2; side++) {
    (ch.lasers[side] || []).forEach(sec => {
      const sEnd = sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0);
      if (sEnd <= start || sec.y >= end) return;
      const overlap = Math.min(sEnd, end) - Math.max(sec.y, start);
      if (overlap > TPM * 2) grindTicks += overlap;
    });
  }
  const grindScore = Math.min(1, grindTicks / Math.max(1, (end - start) * 0.6));

  // ── Map patterns → axes ───────────────────────────────────────────────────
  // [NOTES, PEAK, TSUMAMI, TRICKY, HAND_TRIP, ONE_HAND]
  bonus[0] = (jsScore * 0.6 + chordScore * 0.4);        // NOTES boosted by jumpstream/chords
  bonus[1] = Math.min(1, chordScore * 0.7 + jsScore * 0.3); // PEAK by chord density
  bonus[2] = grindScore;                                 // TSUMAMI by laser grind
  bonus[3] = Math.min(1, trillScore * 0.5 + jackScore * 0.3 + pivotScore * 0.5); // TRICKY
  bonus[4] = Math.min(1, trillScore * 0.4 + pivotScore * 0.4 + jsScore * 0.2);   // HAND TRIP
  bonus[5] = Math.min(1, chordScore * 0.5 + jackScore * 0.5);                    // ONE HAND

  return bonus;
}

// ── Apply density curve ───────────────────────────────────────────────────────
function _applyCurve(x) {
  // x is normalised [0, 1]
  switch (_rdrParams.densityCurve) {
    case 'log': return x <= 0 ? 0 : Math.min(1, Math.log1p(x * (Math.E - 1)));
    case 'exp': return Math.min(1, x * x * (3 - 2 * x)); // smooth step
    default:    return x; // lin
  }
}

// ── Score computation ─────────────────────────────────────────────────────────
function _computeRadarScores(ch, centerTick, windowM) {
  const TPM = 192;
  const TPB = 48;
  const winT  = windowM * TPM;
  const start = Math.max(0, centerTick - Math.floor(winT / 2));
  const end   = start + winT;

  // Collect events in window
  const btNotes = [];
  const fxNotes = [];
  for (let i = 0; i < 4; i++) {
    (ch.bt[i] || []).forEach(n => { if (n.y >= start && n.y < end) btNotes.push({ ...n, lane: i }); });
  }
  for (let i = 0; i < 2; i++) {
    (ch.fx[i] || []).forEach(n => { if (n.y >= start && n.y < end) fxNotes.push({ ...n, lane: i }); });
  }
  const allNotes = [...btNotes, ...fxNotes];
  const noteCount = allNotes.length;

  // Laser coverage sampled at 12-tick resolution
  const laserSegs = [ch.lasers[0] || [], ch.lasers[1] || []];
  const laserActiveAt = (side, tick) =>
    laserSegs[side].some(sec => {
      const sEnd = sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0);
      return tick >= sec.y && tick < sEnd;
    });

  const laserCov = [0, 0];
  for (let t = start; t < end; t += 12) {
    if (laserActiveAt(0, t)) laserCov[0] += 12;
    if (laserActiveAt(1, t)) laserCov[1] += 12;
  }

  // Apply laser bias: -1 amplifies left, +1 amplifies right
  const bias = _rdrParams.laserBias;
  const lMul = bias < 0 ? 1 + (-bias) : 1;
  const rMul = bias > 0 ? 1 + bias    : 1;
  const adjLaserCov = [laserCov[0] * lMul, laserCov[1] * rMul];
  const totalLaserTicks = adjLaserCov[0] + adjLaserCov[1];
  const maxCovTicks = winT * 2 * ((1 + Math.abs(bias)) / 1);

  // NOTES
  const measCount = Math.max(1, windowM);
  const nps       = noteCount / measCount;
  const notesRaw  = _applyCurve(Math.min(1, nps / 50));
  const NOTES     = Math.round(notesRaw * RADAR_MAX);

  // PEAK — densest burst moment across the ENTIRE chart (not just cursor window)
  // Uses a sliding window of 1 beat (48 ticks), stepped every 12 ticks.
  // Scans globally so PEAK stays stable and meaningful regardless of cursor position.
  // Calibration: 20 notes in a 48-tick window = PEAK 200 (all 6 lanes, every 16th note
  // simultaneously — far beyond human ability, so real charts land 0-180 range).
  const PEAK = _computeGlobalPeak(ch);

  // TSUMAMI — proportion of window covered by lasers (laser bias applied)
  const TSUMAMI = Math.round(Math.min(1, totalLaserTicks / Math.max(1, maxCovTicks)) * RADAR_MAX);

  // ONE HAND — same-side button + laser simultaneously
  let oneHandCount = 0;
  btNotes.forEach(n => { if (laserActiveAt(n.lane < 2 ? 0 : 1, n.y)) oneHandCount++; });
  fxNotes.forEach(n => { if (laserActiveAt(n.lane,              n.y)) oneHandCount++; });
  const ONE_HAND = Math.round(Math.min(1, oneHandCount / Math.max(1, noteCount * 0.45)) * RADAR_MAX);

  // HAND TRIP — opposite-side button + laser simultaneously
  let handTripCount = 0;
  btNotes.forEach(n => { if (laserActiveAt(1 - (n.lane < 2 ? 0 : 1), n.y)) handTripCount++; });
  fxNotes.forEach(n => { if (laserActiveAt(1 - n.lane, n.y)) handTripCount++; });
  const HAND_TRIP = Math.round(Math.min(1, handTripCount / Math.max(1, noteCount * 0.3)) * RADAR_MAX);

  // TRICKY — off-beat notes + rapid laser reversals
  let trickyCount = 0;
  allNotes.forEach(n => {
    const t16 = n.y % TPB % 12 === 0;
    const t3  = n.y % TPB % 16 === 0;
    if (!t16 && !t3) trickyCount++;
  });
  let laserFlips = 0;
  for (let side = 0; side < 2; side++) {
    (ch.lasers[side] || []).forEach(sec => {
      if (sec.y >= end) return;
      for (let pi = 1; pi < sec.points.length - 1; pi++) {
        const prev = sec.points[pi - 1];
        const cur  = sec.points[pi];
        const nxt  = sec.points[pi + 1];
        if (cur.ry < 24) {
          const d1 = cur.v - prev.v, d2 = nxt.v - cur.v;
          if (Math.sign(d1) !== Math.sign(d2) && Math.abs(d1) > 0.15 && Math.abs(d2) > 0.15) laserFlips++;
        }
      }
    });
  }
  const trickyRaw = trickyCount + laserFlips * 3 * _rdrParams.slamSens;
  const TRICKY    = Math.round(Math.min(1, trickyRaw / Math.max(1, noteCount * 0.25)) * RADAR_MAX);

  const algoScores = [NOTES, PEAK, TSUMAMI, TRICKY, HAND_TRIP, ONE_HAND];

  // AI blend
  const aiBonus = _detectPatterns(ch, start, end);
  _rdrAiBonus   = aiBonus;
  const w = _rdrParams.aiWeight;
  return algoScores.map((s, i) => {
    const boosted = Math.round(s * (1 - w) + aiBonus[i] * RADAR_MAX * w);
    return Math.min(RADAR_MAX, Math.max(0, boosted));
  });
}

// ── Straight-line closed polygon ──────────────────────────────────────────────
/**
 * Given an array of {x, y} points forming a CLOSED polygon,
 * draw straight lines between them (matching the SDVX effect-radar style).
 */
function _smoothClosedPolygon(ctx, pts) {
  const n = pts.length;
  if (n < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

// ── Draw radar ────────────────────────────────────────────────────────────────
function _drawRadar() {
  if (!_rdrCanvas || !_rdrCtx) return;
  const cvs = _rdrCanvas;
  const ctx = _rdrCtx;
  const dpr = window.devicePixelRatio || 1;
  const W   = cvs.clientWidth  || 270;
  const H   = cvs.clientHeight || 270;

  // Sync physical resolution
  if (cvs.width !== W * dpr || cvs.height !== H * dpr) {
    cvs.width  = W * dpr;
    cvs.height = H * dpr;
    ctx.scale(dpr, dpr);
  }
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2;
  const cy = H / 2 - 4;
  const R  = Math.min(W, H) * 0.33;

  // ── Background ────────────────────────────────────────────────────────────
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
  bgGrad.addColorStop(0,   '#0d0d20');
  bgGrad.addColorStop(1,   '#07070f');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // ── Grid rings (25%, 50%, 75%, 100%) ─────────────────────────────────────
  [0.25, 0.5, 0.75, 1.0].forEach((frac, ri) => {
    const r = R * frac;
    const ringPts = RADAR_ANG.map(ang => ({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r }));
    ctx.beginPath();
    _smoothClosedPolygon(ctx, ringPts);
    ctx.strokeStyle = frac === 1.0 ? '#3a3a5a' : '#1e1e34';
    ctx.lineWidth   = frac === 1.0 ? 1.0 : 0.6;
    ctx.stroke();
    // Value label at top spoke
    if (frac < 1.0) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font         = `${7 * dpr / dpr}px monospace`;
      ctx.fillStyle    = '#33335588';
      ctx.fillText(Math.round(frac * RADAR_MAX), cx + Math.cos(RADAR_ANG[0]) * r, cy + Math.sin(RADAR_ANG[0]) * r);
    }
  });

  // ── Spokes ────────────────────────────────────────────────────────────────
  RADAR_ANG.forEach((ang, i) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    // Spoke color: use axis color at low opacity
    ctx.strokeStyle = RADAR_AXIS_COLORS[i] + '28';
    ctx.lineWidth   = 0.8;
    ctx.stroke();
  });

  // ── Filled polygon ────────────────────────────────────────────────────────
  const scores = _rdrDisplayScores;
  const polyPts = RADAR_ANG.map((ang, i) => {
    const r = R * Math.max(0, Math.min(1, scores[i] / RADAR_MAX));
    return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
  });

  // Outer glow pass
  ctx.save();
  ctx.shadowBlur  = 18;
  ctx.shadowColor = '#5566ffaa';
  ctx.beginPath();
  _smoothClosedPolygon(ctx, polyPts);
  ctx.strokeStyle = '#6688ffaa';
  ctx.lineWidth   = 2.5;
  ctx.stroke();
  ctx.restore();

  // Gradient fill
  const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  fillGrad.addColorStop(0,   '#8899ff55');
  fillGrad.addColorStop(0.5, '#4466ff44');
  fillGrad.addColorStop(1,   '#2244ee22');
  ctx.beginPath();
  _smoothClosedPolygon(ctx, polyPts);
  ctx.fillStyle = fillGrad;
  ctx.fill();
  ctx.strokeStyle = '#7799ffcc';
  ctx.lineWidth   = 1.8;
  ctx.stroke();

  // ── Axis endpoint dots + glow ─────────────────────────────────────────────
  RADAR_ANG.forEach((ang, i) => {
    const frac = Math.max(0, Math.min(1, scores[i] / RADAR_MAX));
    const r    = R * frac;
    const dx   = cx + Math.cos(ang) * r;
    const dy   = cy + Math.sin(ang) * r;
    ctx.save();
    ctx.shadowBlur  = 10;
    ctx.shadowColor = RADAR_AXIS_COLORS[i];
    ctx.beginPath();
    ctx.arc(dx, dy, 4, 0, Math.PI * 2);
    ctx.fillStyle = RADAR_AXIS_COLORS[i];
    ctx.fill();
    ctx.restore();
  });

  // ── Labels + score values ─────────────────────────────────────────────────
  const LABEL_R = R + 30;
  RADAR_ANG.forEach((ang, i) => {
    const lx    = cx + Math.cos(ang) * LABEL_R;
    const ly    = cy + Math.sin(ang) * LABEL_R;
    const lines = RADAR_LABELS[i].split('\n');
    const score = Math.round(scores[i]);

    ctx.textAlign    = lx > cx + 4 ? 'left' : lx < cx - 4 ? 'right' : 'center';
    ctx.textBaseline = ly > cy + 4 ? 'top'  : ly < cy - 4 ? 'bottom' : 'middle';

    // Label glow
    ctx.save();
    ctx.shadowBlur  = 8;
    ctx.shadowColor = RADAR_AXIS_COLORS[i];
    ctx.font        = 'bold 8.5px monospace';
    ctx.fillStyle   = RADAR_AXIS_COLORS[i];
    lines.forEach((line, li) => {
      const lineOff = (li - (lines.length - 1) / 2) * 11;
      ctx.fillText(line, lx, ly + lineOff - 6);
    });
    ctx.restore();

    // Score value
    ctx.font      = '9px monospace';
    ctx.fillStyle = '#e0e8ff';
    ctx.textBaseline = ly > cy + 4 ? 'top' : ly < cy - 4 ? 'bottom' : 'middle';
    const scoreY = ly + lines.length * 11 - 6;
    ctx.fillText(score.toString(), lx, scoreY);
  });

  // ── Center axis ornament ──────────────────────────────────────────────────
  // Small hexagon outline at center
  ctx.beginPath();
  const hexR = 8;
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 - 30) * Math.PI / 180;
    const hx = cx + Math.cos(a) * hexR, hy = cy + Math.sin(a) * hexR;
    k === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy);
  }
  ctx.closePath();
  ctx.strokeStyle = '#3a3a6a';
  ctx.lineWidth   = 0.8;
  ctx.stroke();

  // ── AI bonus halo (thin second ring, dimmer) ──────────────────────────────
  if (_rdrParams.aiWeight > 0.05) {
    const aiBonusPts = RADAR_ANG.map((ang, i) => {
      const r = R * Math.min(1, _rdrAiBonus[i]);
      return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
    });
    ctx.beginPath();
    _smoothClosedPolygon(ctx, aiBonusPts);
    ctx.strokeStyle = `rgba(200,160,255,${_rdrParams.aiWeight * 0.35})`;
    ctx.lineWidth   = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Window label ──────────────────────────────────────────────────────────
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font         = '8px monospace';
  ctx.fillStyle    = '#33336688';
  const winLabel = _rdrWindowM >= 9999 ? 'full chart' : `±${Math.round(_rdrWindowM / 2)}m window`;
  ctx.fillText(winLabel, cx, H - 2);
}

// ── Animation loop (60 fps while visible) ────────────────────────────────────
function _rdrTick() {
  if (!_rdrVisible) { _rdrAnimId = null; return; }

  // Lerp display toward target
  const LERP = 0.08;
  let changed = false;
  for (let i = 0; i < 6; i++) {
    const delta = _rdrTargetScores[i] - _rdrDisplayScores[i];
    if (Math.abs(delta) > 0.15) {
      _rdrDisplayScores[i] += delta * LERP;
      changed = true;
    } else {
      _rdrDisplayScores[i] = _rdrTargetScores[i];
    }
  }

  _drawRadar();
  _rdrAnimId = requestAnimationFrame(_rdrTick);
}

function _startRdrLoop() {
  if (_rdrAnimId) return;
  _rdrAnimId = requestAnimationFrame(_rdrTick);
}

function _stopRdrLoop() {
  if (_rdrAnimId) { cancelAnimationFrame(_rdrAnimId); _rdrAnimId = null; }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function openRadarWindow() {
  if (!_rdrWin) _rdrWin = _buildRadarWindow();
  _rdrWin.style.display = 'block';
  _rdrVisible = true;
  _saveRdrState({ left: _rdrWin.style.left, top: _rdrWin.style.top, hidden: false, params: _rdrParams });
  updateRadar();
  _startRdrLoop();
}

export function closeRadarWindow() {
  if (_rdrWin) _rdrWin.style.display = 'none';
  _rdrVisible = false;
  _stopRdrLoop();
  _saveRdrState({ left: _rdrWin?.style.left, top: _rdrWin?.style.top, hidden: true, params: _rdrParams });
}

/**
 * Called by render() / playFrame() whenever cursor or chart changes.
 * Updates _rdrTargetScores so the lerp loop smoothly animates toward them.
 */
export function updateRadar() {
  if (!_rdrWin || !_rdrVisible) return;
  try {
    const ch   = (typeof chart    !== 'undefined') ? chart    : null;
    const rend = (typeof renderer !== 'undefined') ? renderer : null;
    if (ch) {
      // Invalidate PEAK cache whenever the chart object changes (new file loaded)
      if (ch !== _peakCacheRef) _invalidatePeakCache();
      const tick = rend?.playTick ?? 0;
      _rdrTargetScores = _computeRadarScores(ch, tick, _rdrWindowM);
    } else {
      _rdrTargetScores = [0, 0, 0, 0, 0, 0];
    }
  } catch (_) {}
}

// ── Settings panel toggle ─────────────────────────────────────────────────────
function _toggleRadarSettings(panel) {
  const vis = panel.style.display !== 'none';
  panel.style.display = vis ? 'none' : 'block';
}

// ── Window builder ────────────────────────────────────────────────────────────
function _buildRadarWindow() {
  const win = document.createElement('div');
  win.id = 'radar-window';
  win.style.cssText = [
    'position:fixed',
    'right:12px',
    'top:44px',
    'width:278px',
    'background:#090914',
    'border:1px solid #28285088',
    'border-radius:10px',
    'box-shadow:0 6px 32px #00003388,0 0 0 1px #0008',
    'z-index:2200',
    'display:none',
    'user-select:none',
    'font-family:monospace',
    'overflow:hidden',
  ].join(';');

  // Restore saved position + params
  const st = _loadRdrState();
  if (st) {
    if (st.left) { win.style.left = st.left; win.style.right = 'auto'; }
    if (st.top)  win.style.top = st.top;
    if (st.params) Object.assign(_rdrParams, st.params);
  }

  // ── Title bar ─────────────────────────────────────────────────────────────
  win.innerHTML = `
<div id="radar-titlebar" style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#0f0f22;cursor:move;border-bottom:1px solid #22225088">
  <span style="font-size:11px;font-weight:700;color:#8899cc;flex:1;letter-spacing:0.04em">⬡ Pattern Radar</span>
  <select id="radar-window-sel" style="background:#181830;color:#aac;border:1px solid #334;border-radius:4px;padding:1px 4px;font-size:10px;cursor:pointer" title="Analysis window">
    <option value="4">±2m</option>
    <option value="8" selected>±4m</option>
    <option value="16">±8m</option>
    <option value="32">±16m</option>
    <option value="0">Full chart</option>
  </select>
  <button id="radar-settings-btn" style="background:none;border:none;color:#778;font-size:12px;cursor:pointer;padding:0 2px;line-height:1" title="Parameters">⚙</button>
  <button id="radar-close" style="background:none;border:none;color:#555;font-size:13px;cursor:pointer;padding:0 2px;line-height:1" title="Close">✕</button>
</div>
<canvas id="radar-canvas" style="width:278px;height:278px;display:block"></canvas>
<div id="radar-settings-panel" style="display:none;padding:8px 10px;border-top:1px solid #1e1e3a;background:#0b0b1c">
  <div style="font-size:9px;color:#4466aa;margin-bottom:6px;letter-spacing:0.06em;text-transform:uppercase">⚙ Radar Parameters</div>

  <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
    <span style="font-size:9px;color:#778;width:80px;flex-shrink:0">Laser Bias</span>
    <span style="font-size:9px;color:#cc88ff;width:14px;text-align:right">L</span>
    <input type="range" id="rdr-laser-bias" min="-1" max="1" step="0.05" value="0" style="flex:1;accent-color:#cc88ff">
    <span style="font-size:9px;color:#88ccff;width:14px">R</span>
    <span id="rdr-laser-bias-val" style="font-size:9px;color:#aac;width:28px;text-align:right">0.0</span>
  </div>

  <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
    <span style="font-size:9px;color:#778;width:80px;flex-shrink:0">Slam Sens.</span>
    <input type="range" id="rdr-slam-sens" min="0.2" max="2" step="0.1" value="1" style="flex:1;accent-color:#ffcc44">
    <span id="rdr-slam-sens-val" style="font-size:9px;color:#aac;width:28px;text-align:right">1.0×</span>
  </div>

  <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
    <span style="font-size:9px;color:#778;width:80px;flex-shrink:0">Density Curve</span>
    <select id="rdr-density-curve" style="flex:1;background:#181830;color:#aac;border:1px solid #334;border-radius:3px;font-size:9px;padding:1px 3px">
      <option value="lin">Linear</option>
      <option value="log">Logarithmic</option>
      <option value="exp">S-Curve</option>
    </select>
  </div>

  <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
    <span style="font-size:9px;color:#778;width:80px;flex-shrink:0">AI Weight</span>
    <input type="range" id="rdr-ai-weight" min="0" max="1" step="0.05" value="0.4" style="flex:1;accent-color:#aa44ff">
    <span id="rdr-ai-weight-val" style="font-size:9px;color:#aac;width:28px;text-align:right">0.4</span>
  </div>

  <div id="radar-ai-legend" style="font-size:8.5px;color:#445;border-top:1px solid #181828;padding-top:4px">
    AI patterns: <span id="radar-ai-detail" style="color:#7766aa">—</span>
  </div>
</div>
<div id="radar-axis-legend" style="padding:5px 10px 7px;border-top:1px solid #14142288;display:flex;flex-wrap:wrap;gap:3px 8px;font-size:8.5px"></div>
  `;

  // ── Wire close ────────────────────────────────────────────────────────────
  win.querySelector('#radar-close').addEventListener('click', () => closeRadarWindow());

  // ── Wire settings toggle ──────────────────────────────────────────────────
  const settingsPanel = win.querySelector('#radar-settings-panel');
  win.querySelector('#radar-settings-btn').addEventListener('click', () => {
    _toggleRadarSettings(settingsPanel);
  });

  // ── Wire window size selector ─────────────────────────────────────────────
  const winSel = win.querySelector('#radar-window-sel');
  if (st?.params) {
    // Restore selected window M from state
  }
  winSel.addEventListener('change', () => {
    const v    = parseInt(winSel.value) || 0;
    _rdrWindowM = v === 0 ? 9999 : v;
    updateRadar();
  });

  // ── Wire parameter sliders ────────────────────────────────────────────────
  const biasSlider  = win.querySelector('#rdr-laser-bias');
  const biasVal     = win.querySelector('#rdr-laser-bias-val');
  const slamSlider  = win.querySelector('#rdr-slam-sens');
  const slamVal     = win.querySelector('#rdr-slam-sens-val');
  const curveSel    = win.querySelector('#rdr-density-curve');
  const aiSlider    = win.querySelector('#rdr-ai-weight');
  const aiVal       = win.querySelector('#rdr-ai-weight-val');
  const aiDetail    = win.querySelector('#radar-ai-detail');

  // Restore saved values
  biasSlider.value  = _rdrParams.laserBias;
  biasVal.textContent = (+_rdrParams.laserBias).toFixed(1);
  slamSlider.value  = _rdrParams.slamSens;
  slamVal.textContent = (+_rdrParams.slamSens).toFixed(1) + '×';
  curveSel.value    = _rdrParams.densityCurve;
  aiSlider.value    = _rdrParams.aiWeight;
  aiVal.textContent  = (+_rdrParams.aiWeight).toFixed(2);

  biasSlider.addEventListener('input', () => {
    _rdrParams.laserBias   = parseFloat(biasSlider.value);
    biasVal.textContent    = _rdrParams.laserBias.toFixed(1);
    updateRadar();
    _saveRdrState({ left: win.style.left, top: win.style.top, hidden: false, params: _rdrParams });
  });
  slamSlider.addEventListener('input', () => {
    _rdrParams.slamSens    = parseFloat(slamSlider.value);
    slamVal.textContent    = _rdrParams.slamSens.toFixed(1) + '×';
    updateRadar();
    _saveRdrState({ left: win.style.left, top: win.style.top, hidden: false, params: _rdrParams });
  });
  curveSel.addEventListener('change', () => {
    _rdrParams.densityCurve = curveSel.value;
    updateRadar();
    _saveRdrState({ left: win.style.left, top: win.style.top, hidden: false, params: _rdrParams });
  });
  aiSlider.addEventListener('input', () => {
    _rdrParams.aiWeight    = parseFloat(aiSlider.value);
    aiVal.textContent      = _rdrParams.aiWeight.toFixed(2);
    // Show breakdown of AI bonuses
    const pct = _rdrAiBonus.map((v, i) => RADAR_LABELS[i].replace('\n', ' ') + ':' + Math.round(v * 100) + '%').join(' · ');
    aiDetail.textContent   = pct || '—';
    updateRadar();
    _saveRdrState({ left: win.style.left, top: win.style.top, hidden: false, params: _rdrParams });
  });

  // Update AI detail whenever scores refresh
  const _updateAiDetail = () => {
    const pct = _rdrAiBonus.map((v, i) => RADAR_LABELS[i].replace('\n', ' ') + ':' + Math.round(v * 100) + '%').join(' · ');
    if (aiDetail) aiDetail.textContent = pct || '—';
  };
  // Patch updateRadar to also refresh AI detail
  const _origUpdateRadar = updateRadar;
  // (can't re-assign function declaration but we'll handle it in the loop below)

  // ── Build legend ──────────────────────────────────────────────────────────
  const legend = win.querySelector('#radar-axis-legend');
  RADAR_LABELS.forEach((lbl, i) => {
    const dot = document.createElement('span');
    dot.style.cssText = `color:${RADAR_AXIS_COLORS[i]};white-space:nowrap`;
    dot.textContent   = '● ' + lbl.replace('\n', ' ');
    legend.appendChild(dot);
  });

  // ── Canvas ref ────────────────────────────────────────────────────────────
  _rdrCanvas = win.querySelector('#radar-canvas');
  _rdrCtx    = _rdrCanvas.getContext('2d');

  // ── Draggable ─────────────────────────────────────────────────────────────
  const titlebar = win.querySelector('#radar-titlebar');
  let _ox = 0, _oy = 0, _mx = 0, _my = 0, _dragging = false;
  titlebar.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
    _dragging = true;
    _ox = win.offsetLeft; _oy = win.offsetTop; _mx = e.clientX; _my = e.clientY;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!_dragging) return;
    win.style.right = 'auto';
    win.style.left  = Math.max(0, _ox + e.clientX - _mx) + 'px';
    win.style.top   = Math.max(0, _oy + e.clientY - _my) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (_dragging) {
      _dragging = false;
      _saveRdrState({ left: win.style.left, top: win.style.top, hidden: false, params: _rdrParams });
    }
  });

  return win;
}

// ── Auto-init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  _rdrWin = _buildRadarWindow();
  document.body.appendChild(_rdrWin);

  const st = _loadRdrState();
  if (st && !st.hidden) {
    _rdrWin.style.display = 'block';
    _rdrVisible = true;
    setTimeout(() => { updateRadar(); _startRdrLoop(); }, 200);
  }
});
