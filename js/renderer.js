'use strict';

// ── Layout constants ──────────────────────────────────────────────────────────
// Lasers overlay the full column area (BT + side extensions).
// Column layout: [ruler] [laser-L ext] [BT-A BT-B BT-C BT-D] [laser-R ext]

const BT_W      = 24;                                        // px per BT lane
const BT_COUNT  = 4;
const SEP       = 1;                                         // separator between BT lanes
const TRACK_W   = BT_COUNT * BT_W + (BT_COUNT - 1) * SEP;  // 99 px
const EXTEND_W  = 50;                                        // laser side extension (~½ TRACK_W)
const RULER_W   = 26;
const COL_GAP   = 12;

const BT_AREA_X    = RULER_W + EXTEND_W;                          // left edge of BT-A
const SINGLE_COL_W = RULER_W + EXTEND_W + TRACK_W + EXTEND_W;    // 225 px

// BT-lane x positions (relative to column left edge)
const LANES  = ['BT-A', 'BT-B', 'BT-C', 'BT-D'];
const LANE_X = LANES.map((_, i) => BT_AREA_X + i * (BT_W + SEP));

// FX overlay spans — FX-L=BT-A+BT-B, FX-R=BT-C+BT-D
const FX_SPAN = [
  { li: 0, lx: () => LANE_X[0], rw: () => BT_W + SEP + BT_W },
  { li: 1, lx: () => LANE_X[2], rw: () => BT_W + SEP + BT_W },
];

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:         '#080810',
  bgBt:       '#0c0c1c',
  bgLL:       '#010509',
  bgLR:       '#09010a',
  colLine:    '#22224a',
  measLine:   '#50508a',
  beatLine:   '#252548',
  subLine:    '#141428',
  ruler:      '#09091a',
  rulerTxt:   '#6668b0',
  bpmTxt:     '#ffdd44',
  btChip:     '#e0e0ff',
  btHoldBg:   '#303060',
  btHoldCap:  '#b8b8ff',
  fxChip:     '#ffcc00',
  fxBody:     '#9a5000',
  fxEdge:     '#ff8800',
  fxCap:      '#ffd700',
  fxSheen:    '#ffee90',
  laserL:     '#0088ff',   // VOL-L: electric blue (matches SDVX arcade default)
  laserLg:    '#0088ff88',
  laserLe:    '#66bbff',
  laserR:     '#ff1177',   // VOL-R: hot pink (matches SDVX arcade default)
  laserRg:    '#ff117788',
  laserRe:    '#ff88cc',
  cursor:     '#ffffffcc',
  cursorGlow: '#ffffff44',
};

// ── Runtime-mutable laser appearance ─────────────────────────────────────────
// These override C.laserL/R/Lg/Rg/Le/Re at draw time.
const laserColors = {
  L:  C.laserL,  Lg: C.laserLg, Le: C.laserLe,
  R:  C.laserR,  Rg: C.laserRg, Re: C.laserRe,
};
// Opacity applied via globalAlpha during laser fill (0–1, default 0.7)
let laserOpacity = 0.7;
// Wide-laser mode: doubles laser ribbon width
let laserWideMode = false;

// ── SDVX laser color presets ──────────────────────────────────────────────────
const LASER_PRESETS = {
  'sdvx-default': { L:'#0088ff', Lg:'#0088ff88', Le:'#66bbff', R:'#ff1177', Rg:'#ff117788', Re:'#ff88cc' },
  'blue-red':     { L:'#0077ff', Lg:'#0077ff88', Le:'#55aaff', R:'#ff2200', Rg:'#ff220088', Re:'#ff6655' },
  'yellow-green': { L:'#ffcc00', Lg:'#ffcc0088', Le:'#ffe055', R:'#00cc44', Rg:'#00cc4488', Re:'#55ee88' },
  'cyan-orange':  { L:'#00ddff', Lg:'#00ddff88', Le:'#55eeff', R:'#ff7700', Rg:'#ff770088', Re:'#ffaa44' },
  'white-white':  { L:'#ddddff', Lg:'#ddddff88', Le:'#ffffff', R:'#ddddff', Rg:'#ddddff88', Re:'#ffffff' },
};

function applyLaserPreset(presetKey) {
  const p = LASER_PRESETS[presetKey];
  if (!p) return;
  Object.assign(laserColors, p);
}

function setLaserColorCustom(side, hex) {
  if (side === 0) {
    laserColors.L  = hex;
    laserColors.Lg = hex + '88';
    laserColors.Le = _lightenHex(hex, 0.4);
  } else {
    laserColors.R  = hex;
    laserColors.Rg = hex + '88';
    laserColors.Re = _lightenHex(hex, 0.4);
  }
}

function _lightenHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(amt * 255));
  const g = Math.min(255, ((n >>  8) & 0xff) + Math.round(amt * 255));
  const b = Math.min(255, ((n >>  0) & 0xff) + Math.round(amt * 255));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── Renderer ──────────────────────────────────────────────────────────────────
class Renderer {
  constructor(canvas) {
    this.canvas        = canvas;
    this.ctx           = canvas.getContext('2d');
    this.chart         = null;
    this.zoom          = 0.75;
    this._beatsPerCol  = 16;          // beats per column (default 16 = 4 measures)
    this.scrollCol     = 0;
    this.numCols       = 3;
    this.playTick      = 0;
    this.playing       = false;
    // showLaserDots: true only when the laser tool is active — hides edit handles otherwise
    this.showLaserDots = false;
    // activeLaserSec: the laser section currently being drawn (gets a highlighted dot)
    this.activeLaserSec = null;
    // selectedLaserPoint: the currently selected anchor { side, sec, ptIndex } or null
    this.selectedLaserPoint = null;
    // _laserPreview: pen-tool ghost line from last placed point to cursor
    // { side, sec, tick, v }  or null
    this._laserPreview = null;

    // Camera event pill hover state — set by app.js from mouse coords.
    // _camPillHitZones: rebuilt every draw(); each entry is a canvas-space rect
    //   { x, y, w, h, tick, camIdx }  where camIdx indexes chart.cameraEvents[]
    // _hoveredCamTick: set by app.js; pills at this tick get a highlight border
    this._camPillHitZones = [];
    this._hoveredCamTick  = null;

    // _velPillHitZones: rebuilt every draw(); { x, y, w, h, tick }
    // _hoveredVelTick: set by app.js; pill at this tick gets highlight border
    this._velPillHitZones = [];
    this._hoveredVelTick  = null;

    // FX hold hit zones — rebuilt every draw(); each entry is a canvas-space rect
    //   { x, y, w, h, li, note }  for click-to-popup
    this._fxHoldHitZones = [];
    this._hoveredFxHold  = null;

    // Waveform overlay — set by the Waveform Aligner tool.
    // null = disabled.  When set:
    //   { enabled, peaks (Float32Array), peakRate, duration, offsetMs,
    //     opacity, ampScale, colorMode, showBeatGrid, showTransients }
    this.waveformOverlay = null;
    this._waveOffscreen  = null;   // reused offscreen buffer

    this.resize();
  }

  // Beats per column — drives all column sizing.  Range: 1–64.
  get beatsPerCol()    { return this._beatsPerCol; }
  set beatsPerCol(v)   { this._beatsPerCol = Math.max(1, Math.round(v)); }

  // Measures per column (kept for backwards compat; setter rounds to nearest beat).
  get measPerCol()     { return this._beatsPerCol / BEATS_PER_MEASURE; }
  set measPerCol(v)    { this._beatsPerCol = Math.max(1, Math.round(v * BEATS_PER_MEASURE)); }

  // Ticks spanned by one column.
  get colTicks()       { return this._beatsPerCol * TICKS_PER_BEAT; }

  get colH() { return Math.round(this.colTicks * this.zoom); }

  resize() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    this.numCols = Math.max(1, Math.floor((wrap.clientWidth + COL_GAP) / (SINGLE_COL_W + COL_GAP)));
    this.canvas.width  = this.numCols * SINGLE_COL_W + (this.numCols - 1) * COL_GAP;
    this.canvas.height = this.colH;
  }

  // ── Coordinate helpers ────────────────────────────────────────────────────

  // Velocity-aware canvas-Y for a given tick within a column that starts at startY.
  // If no scroll-speed events exist this is identical to the linear formula.
  _pyAt(tick, startY) {
    if (!this.chart?.scrollSpeedEvents?.length) {
      return this.colH - (tick - startY) * this.zoom;
    }
    return this.colH - this.chart.scrollDistanceBetween(tick, startY) * this.zoom;
  }

  // Inverse of _pyAt: given a visual distance from column bottom (in "zoom units"),
  // return the tick that lands at that position.
  _scrollDistToTick(targetDist) {
    const evs = this.chart?.scrollSpeedEvents;
    if (!evs?.length) return targetDist;
    let dist = 0, lastY = 0, speed = evs[0].speed ?? 1.0;
    for (let i = 1; i < evs.length; i++) {
      const segDist = (evs[i].y - lastY) * speed;
      if (dist + segDist >= targetDist) break;
      dist  += segDist;
      lastY  = evs[i].y;
      speed  = evs[i].speed ?? 1.0;
    }
    return lastY + (targetDist - dist) / Math.max(0.001, speed);
  }

  tickToCanvas(tick) {
    const colLen    = this.colTicks;
    const colIdx    = Math.floor(tick / colLen);
    const startY    = colIdx * colLen;
    const visColIdx = colIdx - this.scrollCol;
    const cx = visColIdx * (SINGLE_COL_W + COL_GAP);
    const cy = this._pyAt(tick, startY);
    return { cx, cy, colIdx, visColIdx, visible: visColIdx >= 0 && visColIdx < this.numCols };
  }

  canvasToTick(cx, cy) {
    const visColIdx  = Math.max(0, Math.floor(cx / (SINGLE_COL_W + COL_GAP)));
    const colIdx     = visColIdx + this.scrollCol;
    const localX     = cx - visColIdx * (SINGLE_COL_W + COL_GAP);
    const colLen     = this.colTicks;
    const startY     = colIdx * colLen;
    const dist       = Math.max(0, (this.colH - cy) / this.zoom);
    const baseDist   = this.chart ? this.chart.scrollDistanceTo(startY) : startY;
    const tick       = this.chart ? this._scrollDistToTick(baseDist + dist) : (startY + dist);
    const laneIdx    = this._localXToLane(localX);
    return { tick, laneIdx, localX, colIdx };
  }

  // -1=ruler, 0-3=BT lanes, 4=left-laser-ext, 5=right-laser-ext
  _localXToLane(lx) {
    if (lx < RULER_W) return -1;
    if (lx < BT_AREA_X) return 4;
    if (lx >= BT_AREA_X + TRACK_W) return 5;
    return Math.min(3, Math.max(0, Math.floor((lx - BT_AREA_X) / (BT_W + SEP))));
  }

  // Local x → laser value [0,1]
  localXToLaserPos(lx, wide) {
    if (wide) return Math.max(0, Math.min(1, (lx - RULER_W) / (EXTEND_W + TRACK_W + EXTEND_W)));
    return Math.max(0, Math.min(1, (lx - BT_AREA_X) / TRACK_W));
  }

  // Laser value [0,1] → canvas x within column offset ox
  _laserVtoX(ox, v, wide) {
    if (wide) return ox + RULER_W + v * (EXTEND_W + TRACK_W + EXTEND_W);
    return ox + BT_AREA_X + v * TRACK_W;
  }

  totalCols() {
    if (!this.chart) return 8;
    const totalTicks = this.chart.totalMeasures * TICKS_PER_MEASURE;
    return Math.ceil(totalTicks / this.colTicks);
  }

  // ── Main draw ─────────────────────────────────────────────────────────────

  draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Rebuild hit-zones every frame so they stay in sync with scroll/zoom
    this._camPillHitZones = [];
    this._velPillHitZones = [];
    this._fxHoldHitZones  = [];

    for (let vi = 0; vi < this.numCols; vi++) {
      const ci = vi + this.scrollCol;
      if (!this.chart && ci > 0) continue;
      const colLen = this.colTicks;
      const startY = ci * colLen;
      const endY   = startY + colLen;
      const ox     = vi * (SINGLE_COL_W + COL_GAP);

      this._drawColBg(ox);
      if (this.waveformOverlay?.enabled) this._drawColWaveform(ox, startY, endY);
      this._drawColGrid(ox, startY, ci);
      this._drawColEventOverlay(ox, startY, endY);
      this._drawColFxHolds(ox, startY, endY);
      this._drawColFxChips(ox, startY, endY);
      this._drawColBtNotes(ox, startY, endY);
      this._drawColLasers(ox, startY, endY);
      this._drawColRuler(ox, startY, ci);
    }

    this._drawCursor();
    this._drawOverlapFlashes?.();
  }

  // ── Per-column draw helpers ───────────────────────────────────────────────

  _drawColBg(ox) {
    const { ctx } = this;
    const h = this.colH;

    // Left laser extension
    ctx.fillStyle = C.bgLL;
    ctx.fillRect(ox + RULER_W, 0, EXTEND_W, h);

    // BT area
    ctx.fillStyle = C.bgBt;
    ctx.fillRect(ox + BT_AREA_X, 0, TRACK_W, h);

    // Right laser extension
    ctx.fillStyle = C.bgLR;
    ctx.fillRect(ox + BT_AREA_X + TRACK_W, 0, EXTEND_W, h);

    // BT lane separators
    ctx.fillStyle = C.colLine;
    for (let i = 1; i < BT_COUNT; i++) {
      ctx.fillRect(ox + LANE_X[i] - SEP, 0, SEP, h);
    }

    // BT area side walls
    ctx.fillStyle = '#2a2a58';
    ctx.fillRect(ox + BT_AREA_X - 2, 0, 2, h);
    ctx.fillRect(ox + BT_AREA_X + TRACK_W, 0, 2, h);

    // Column gap
    if (ox + SINGLE_COL_W < this.canvas.width) {
      ctx.fillStyle = '#18183a';
      ctx.fillRect(ox + SINGLE_COL_W, 0, COL_GAP, h);
    }
  }

  // ── Waveform overlay ─────────────────────────────────────────────────────
  _drawColWaveform(ox, startY, endY) {
    const ov = this.waveformOverlay;
    if (!ov?.enabled || !ov.peaks) return;
    const { ctx } = this;
    const colH     = this.colH;
    const bpmEvs   = this.chart?.bpmEvents ?? [];

    // Local tick→seconds (mirrors tickToSeconds in app.js but uses this.chart)
    const tickToSec = (tick) => {
      let sec = 0, prevTick = 0;
      let prevBpm = Math.max(1, bpmEvs[0]?.bpm || 120);
      for (const ev of bpmEvs) {
        if (ev.y >= tick) break;
        const bpm = Math.max(1, ev.bpm || 120);
        sec += (Math.min(ev.y, tick) - prevTick) / TICKS_PER_BEAT * (60 / bpm);
        prevTick = ev.y; prevBpm = bpm;
      }
      return sec + (tick - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
    };

    const CX      = ox + BT_AREA_X + TRACK_W / 2;   // center of BT track
    const maxHalf = (TRACK_W / 2) * (ov.ampScale ?? 1.0);
    const offSec  = (ov.offsetMs ?? 0) / 1000;
    const { peaks, peakRate, duration } = ov;
    const opacity = Math.round((ov.opacity ?? 0.35) * 255);
    const mode    = ov.colorMode ?? 'gradient';
    const canvasW = this.canvas.width;

    // Build pixel data for a strip covering the BT area + extensions
    const stripX = Math.max(0, Math.round(ox + BT_AREA_X - maxHalf - 2));
    const stripR = Math.min(canvasW, Math.round(ox + BT_AREA_X + TRACK_W + maxHalf + 2));
    const stripW = stripR - stripX;
    if (stripW <= 0) return;

    // Reuse / recreate offscreen canvas
    if (!this._waveOffscreen) this._waveOffscreen = document.createElement('canvas');
    if (this._waveOffscreen.width  !== stripW) this._waveOffscreen.width  = stripW;
    if (this._waveOffscreen.height !== colH)   this._waveOffscreen.height = colH;
    const octx = this._waveOffscreen.getContext('2d');
    const img  = octx.createImageData(stripW, colH);
    const d    = img.data;

    const localCX = CX - stripX;  // center X within the strip

    const _waveBaseDist = this.chart ? this.chart.scrollDistanceTo(startY) : startY;
    for (let py = 0; py < colH; py++) {
      const dist  = (colH - 1 - py) / this.zoom;
      const tick  = this.chart ? this._scrollDistToTick(_waveBaseDist + dist) : (startY + dist);
      const sec   = tickToSec(tick) + offSec;
      if (sec < 0 || sec > duration) continue;

      const idx  = Math.min(Math.floor(sec * peakRate), peaks.length - 1);
      const amp  = peaks[idx];
      if (amp < 0.004) continue;

      const hw   = Math.round(amp * maxHalf);
      const xL   = Math.max(0, localCX - hw);
      const xR   = Math.min(stripW - 1, localCX + hw);

      // Colour: quiet=deep blue, mid=cyan/teal, loud=amber/gold
      let r, g, b;
      if (mode === 'blue')  { r = 40;  g = 80 + Math.round(amp*100); b = 200; }
      else if (mode === 'green') { r = 20; g = 180 + Math.round(amp*75); b = 60; }
      else if (mode === 'white') { const v = 120 + Math.round(amp*135); r=v; g=v; b=v; }
      else { // gradient: blue→teal→amber
        if (amp < 0.45) {
          const t = amp / 0.45;
          r = Math.round(t * 10);
          g = Math.round(40 + t * 190);
          b = Math.round(220 - t * 80);
        } else {
          const t = (amp - 0.45) / 0.55;
          r = Math.round(10  + t * 255);
          g = Math.round(230 - t * 90);
          b = Math.round(140 - t * 130);
        }
      }

      for (let px = xL; px <= xR; px++) {
        const i4 = (py * stripW + px) * 4;
        d[i4]   = r; d[i4+1] = g; d[i4+2] = b; d[i4+3] = opacity;
      }
    }

    octx.putImageData(img, 0, 0);

    // Composite onto main canvas with source-over so notes sit on top
    ctx.save();
    ctx.globalAlpha = 1;   // alpha already baked into image
    ctx.drawImage(this._waveOffscreen, stripX, 0);
    ctx.restore();

    // ── Beat-grid lines over waveform ────────────────────────────────────
    if (ov.showBeatGrid && this.chart) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffffaa';
      ctx.lineWidth   = 0.5;
      ctx.setLineDash([2, 4]);
      const beatTicks = TICKS_PER_BEAT;
      const firstBeat = Math.floor(startY / beatTicks) * beatTicks;
      for (let bt = firstBeat; bt <= endY; bt += beatTicks) {
        const py = this._pyAt(bt, startY);
        if (py < 0 || py > colH) continue;
        ctx.beginPath();
        ctx.moveTo(ox + BT_AREA_X - EXTEND_W, py);
        ctx.lineTo(ox + BT_AREA_X + TRACK_W + EXTEND_W, py);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── Transient markers ────────────────────────────────────────────────
    if (ov.showTransients && ov.transients) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = '#ffdd44';
      ctx.lineWidth   = 1;
      for (const tSec of ov.transients) {
        const tick = this.chart ? (() => {
          let t = 0, prevSec = 0, prevBpm = Math.max(1, bpmEvs[0]?.bpm||120);
          for (const ev of bpmEvs) {
            const es = tickToSec(ev.y);
            if (es >= tSec) break;
            t = ev.y; prevSec = es; prevBpm = Math.max(1, ev.bpm||120);
          }
          return t + (tSec - prevSec) * prevBpm / 60 * TICKS_PER_BEAT;
        })() : 0;
        if (tick < startY || tick > endY) continue;
        const py = this._pyAt(tick, startY);
        ctx.beginPath();
        ctx.moveTo(ox + BT_AREA_X - 4, py);
        ctx.lineTo(ox + BT_AREA_X + TRACK_W + 4, py);
        ctx.stroke();
        // small triangle marker
        ctx.fillStyle = '#ffdd44';
        ctx.beginPath();
        ctx.moveTo(ox + BT_AREA_X - 4, py);
        ctx.lineTo(ox + BT_AREA_X - 4 - 6, py - 4);
        ctx.lineTo(ox + BT_AREA_X - 4 - 6, py + 4);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  _drawColGrid(ox, startY, colIdx) {
    const { ctx } = this;
    const lx = ox + BT_AREA_X;
    const rx = ox + BT_AREA_X + TRACK_W;
    const colTicks = this.colTicks;

    // Iterate over all sub-beat divisions (12 ticks each) within the column.
    // This handles any beatsPerCol value, including sub-measure columns.
    for (let sub = 0; sub * 12 < colTicks; sub++) {
      const relTick = sub * 12;
      const y       = this._pyAt(startY + relTick, startY);
      if (y < 0) break;

      const isMeasBound = ((startY + relTick) % TICKS_PER_MEASURE === 0);
      const isBeatBound = ((startY + relTick) % TICKS_PER_BEAT     === 0);

      let color, lw;
      if (isMeasBound)      { color = C.measLine; lw = 1.5; }
      else if (isBeatBound) { color = C.beatLine;  lw = 1.0; }
      else                  { color = C.subLine;   lw = 0.5; }

      ctx.strokeStyle = color;
      ctx.lineWidth   = lw;
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(rx, y); ctx.stroke();
    }
  }

  _drawColRuler(ox, startY, colIdx) {
    const { ctx } = this;
    const h        = this.colH;
    const colTicks = this.colTicks;

    ctx.fillStyle = C.ruler;
    ctx.fillRect(ox, 0, RULER_W, h);
    ctx.fillStyle = '#1c1c3c';
    ctx.fillRect(ox + RULER_W - 1, 0, 1, h);

    ctx.font      = '10px monospace';
    ctx.textAlign = 'right';

    // When the column spans less than a full measure, label by beats.
    // Otherwise label by measure number (original behaviour).
    const labelByBeats = this._beatsPerCol < BEATS_PER_MEASURE;

    for (let relTick = 0; relTick < colTicks; relTick += TICKS_PER_BEAT) {
      const absTick = startY + relTick;
      const y       = this._pyAt(absTick, startY);
      if (y < 0) break;

      const isMeasBound = (absTick % TICKS_PER_MEASURE === 0);
      const beatInMeas  = Math.round((absTick % TICKS_PER_MEASURE) / TICKS_PER_BEAT);

      if (labelByBeats) {
        // Show absolute beat index for every beat in the column
        const absBeat = Math.round(absTick / TICKS_PER_BEAT);
        ctx.fillStyle = isMeasBound ? '#c8c8ff' : C.rulerTxt;
        ctx.fillText('B' + String(absBeat).padStart(2, '0'), ox + RULER_W - 4, y - 3);
      } else if (isMeasBound) {
        // Measure number label
        const mNum = Math.round(absTick / TICKS_PER_MEASURE) + 1;
        ctx.fillStyle = C.rulerTxt;
        ctx.fillText(String(mNum).padStart(2, '0'), ox + RULER_W - 4, y - 3);
      } else {
        // Sub-beat tick mark between measure labels
        ctx.fillStyle = '#252548';
        ctx.fillRect(ox + RULER_W - 7, y - 0.5, 6, 1);
      }
    }

    // BPM event labels
    const endY = startY + colTicks;
    ctx.font      = '8px monospace';
    ctx.textAlign = 'left';
    for (const ev of (this.chart?.bpmEvents ?? [])) {
      if (ev.y < startY || ev.y >= endY) continue;
      const y = this._pyAt(ev.y, startY);
      ctx.fillStyle = C.bpmTxt;
      ctx.fillText(`${ev.bpm}`, ox + 2, y - 2);
    }
    // Time sig event labels in ruler (purple)
    for (const ev of (this.chart?.timeSigEvents ?? [])) {
      const evTick = (ev.measure ?? 0) * TICKS_PER_MEASURE;
      if (evTick < startY || evTick >= endY) continue;
      const y = this._pyAt(evTick, startY);
      ctx.fillStyle = '#bb44ff';
      ctx.fillText(`${ev.num}/${ev.den}`, ox + 2, y - 2 - 9); // offset up from BPM row
    }
  }

  _drawColEventOverlay(ox, startY, endY) {
    const { ctx } = this;
    const CAM_COLORS = {
      zoom_top:     '#00ffaa',
      zoom_bottom:  '#00ccff',
      zoom_side:    '#ffcc00',
      tilt:         '#ff8844',
      center_split: '#cc88ff',
      lane_toggle:  '#ff4466',
    };
    const leftExtX  = ox + RULER_W;                       // left extension left edge
    const trackX    = ox + BT_AREA_X;                     // BT area left edge
    const rightExtX = ox + BT_AREA_X + TRACK_W;          // right extension left edge
    const fullW     = EXTEND_W + TRACK_W + EXTEND_W;      // full width across both extensions + BT

    // ── Stop events — semi-transparent red band ──────────────────────────────
    for (const ev of (this.chart?.stopEvents ?? [])) {
      const evEnd = ev.y + ev.len;
      if (evEnd <= startY || ev.y >= endY) continue;
      const cStart = Math.max(ev.y, startY);
      const cEnd   = Math.min(evEnd, endY);
      const yTop   = this._pyAt(cEnd,   startY);
      const yBot   = this._pyAt(cStart, startY);
      const bh     = Math.max(2, yBot - yTop);

      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = 'rgba(255,30,30,1)';
      ctx.fillRect(leftExtX, yTop, fullW, bh);
      ctx.globalAlpha = 1;
      // Top border
      ctx.fillStyle = 'rgba(255,50,50,0.7)';
      ctx.fillRect(leftExtX, yTop, fullW, 1.5);
      // Label
      if (bh > 12 && ev.y >= startY) {
        ctx.font = 'bold 8px monospace';
        ctx.fillStyle = '#ff6666';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('⏹ STOP', trackX + 2, yBot - 1);
      }
      ctx.restore();
    }

    // ── BPM change markers — yellow line across full width ───────────────────
    for (const ev of (this.chart?.bpmEvents ?? [])) {
      if (ev.y < startY || ev.y >= endY) continue;
      const y = this._pyAt(ev.y, startY);
      ctx.save();
      ctx.strokeStyle = '#ffdd44';
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.moveTo(leftExtX, y); ctx.lineTo(rightExtX + EXTEND_W, y); ctx.stroke();
      // Triangle marker on left
      ctx.fillStyle = '#ffdd44';
      ctx.beginPath();
      ctx.moveTo(leftExtX, y);
      ctx.lineTo(leftExtX + 7, y - 4);
      ctx.lineTo(leftExtX + 7, y + 4);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // ── Time sig change markers — purple line across BT area ─────────────────
    for (const ev of (this.chart?.timeSigEvents ?? [])) {
      const evTick = (ev.measure ?? 0) * TICKS_PER_MEASURE;
      if (evTick < startY || evTick >= endY) continue;
      const y = this._pyAt(evTick, startY);
      ctx.save();
      ctx.strokeStyle = '#bb44ff';
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.moveTo(leftExtX, y); ctx.lineTo(rightExtX + EXTEND_W, y); ctx.stroke();
      // Label on right extension
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#bb44ff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${ev.num}/${ev.den}`, rightExtX + 2, y - 1);
      ctx.restore();
    }

    // ── Camera events — detailed pills in left (tilt/lane_toggle) or right (zoom) ──
    // Pill anatomy (height=12px):
    //   [3px accent] [type abbr + value text] [10px magnitude bar]
    // All events at the same tick stack upward without overlap.
    const PILL_H    = 12;
    const PILL_GAP  = 1;
    const PILL_STEP = PILL_H + PILL_GAP;
    const PILL_W    = EXTEND_W - 2;
    const TYPE_ABBR = {
      zoom_top:     'zTop', zoom_bottom: 'zBot', zoom_side: 'zSide',
      tilt:         'tilt', center_split: 'splt', lane_toggle: 'lane',
    };

    // Build grouped map preserving original index into chart.cameraEvents[]
    const camEvsByTick = new Map();
    const allCamEvs = this.chart?.cameraEvents ?? [];
    for (let ci = 0; ci < allCamEvs.length; ci++) {
      const ev = allCamEvs[ci];
      if (ev.y < startY || ev.y >= endY) continue;
      if (!camEvsByTick.has(ev.y)) camEvsByTick.set(ev.y, []);
      camEvsByTick.get(ev.y).push({ ev, ci });
    }

    for (const [tick, entries] of camEvsByTick) {
      const yBase   = this._pyAt(tick, startY);
      const hovered = this._hoveredCamTick === tick;
      let leftOff = 0, rightOff = 0;

      for (const { ev, ci } of entries) {
        const col    = CAM_COLORS[ev.type] ?? '#aaaaaa';
        const isLeft = ev.type === 'tilt' || ev.type === 'lane_toggle';
        const extX   = isLeft ? leftExtX : rightExtX;
        const yOff   = isLeft ? leftOff  : rightOff;
        const pillTop = yBase - PILL_H - yOff;

        ctx.save();

        // ── Background ──────────────────────────────────────────────────────
        ctx.fillStyle = hovered ? '#1c1c38' : '#0d0d22';
        ctx.fillRect(extX + 1, pillTop, PILL_W, PILL_H);

        // ── Left accent bar ─────────────────────────────────────────────────
        ctx.fillStyle = col;
        ctx.fillRect(extX + 1, pillTop, 3, PILL_H);

        // ── Magnitude bar (behind text, very subtle) ─────────────────────────
        const numVal = parseFloat(ev.value);
        const isNumeric = !isNaN(numVal);
        if (isNumeric) {
          const mag    = Math.abs(numVal) / 300;
          const barMax = PILL_W - 14;          // space after accent + padding
          const barW   = Math.round(mag * barMax);
          if (barW > 0) {
            ctx.globalAlpha = 0.22;
            ctx.fillStyle   = col;
            // Negative values bar anchors right; positive anchors left
            const barX = numVal >= 0
              ? extX + 5
              : extX + 5 + barMax - barW;
            ctx.fillRect(barX, pillTop + 2, barW, PILL_H - 4);
          }
        }
        ctx.globalAlpha = 1;

        // ── Type abbreviation ────────────────────────────────────────────────
        ctx.font         = 'bold 7px monospace';
        ctx.fillStyle    = hovered ? '#ffffff' : col;
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(TYPE_ABBR[ev.type] ?? ev.type.slice(0, 5), extX + 6, pillTop + PILL_H / 2);

        // ── Value label (right-aligned) ──────────────────────────────────────
        const valLabel = isNumeric
          ? (numVal >= 0 ? '+' : '') + Math.round(numVal)
          : String(ev.value ?? '').slice(0, 4);
        ctx.font      = '7px monospace';
        ctx.fillStyle = '#b0b0cc';
        ctx.textAlign = 'right';
        ctx.fillText(valLabel, extX + PILL_W, pillTop + PILL_H / 2);

        // ── Hover highlight border ───────────────────────────────────────────
        if (hovered) {
          ctx.strokeStyle = col;
          ctx.lineWidth   = 1;
          ctx.strokeRect(extX + 1.5, pillTop + 0.5, PILL_W - 1, PILL_H - 1);
        }

        ctx.restore();

        // ── Register hit zone (canvas-space, for mouse detection in app.js) ─
        this._camPillHitZones.push({
          x: extX + 1, y: pillTop, w: PILL_W, h: PILL_H, tick, camIdx: ci,
        });

        if (isLeft) leftOff += PILL_STEP; else rightOff += PILL_STEP;
      }
    }

    // ── Chart Velocity (scroll speed) pills — centered on BT track ──────────
    // Amber pill spanning the BT lane width with a dashed guide line.
    const VEL_COLOR  = '#ff9900';
    const velEvs = this.chart?.scrollSpeedEvents ?? [];
    for (const ev of velEvs) {
      if (ev.y === 0 || ev.y < startY || ev.y >= endY) continue;
      const yBase   = this._pyAt(ev.y, startY);
      const pillTop = yBase - PILL_H;
      const pillX   = trackX;
      const pillW   = TRACK_W;
      const isHov   = this._hoveredVelTick === ev.y;

      ctx.save();

      // Dashed guide line across full column width
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = VEL_COLOR;
      ctx.lineWidth   = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(leftExtX, yBase);
      ctx.lineTo(rightExtX + EXTEND_W, yBase);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Pill background
      ctx.fillStyle = isHov ? '#1c1c38' : '#0d0d22';
      ctx.fillRect(pillX, pillTop, pillW, PILL_H);

      // Left accent bar
      ctx.fillStyle = VEL_COLOR;
      ctx.fillRect(pillX, pillTop, 3, PILL_H);

      // Magnitude bar proportional to speed (0–3× range)
      const mag    = Math.min(1, ev.speed / 3);
      const barMax = pillW - 14;
      const barW   = Math.round(mag * barMax);
      if (barW > 0) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle   = VEL_COLOR;
        ctx.fillRect(pillX + 5, pillTop + 2, barW, PILL_H - 4);
      }
      ctx.globalAlpha = 1;

      // "vel" label
      ctx.font         = 'bold 7px monospace';
      ctx.fillStyle    = isHov ? '#ffffff' : VEL_COLOR;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('vel', pillX + 6, yBase - PILL_H / 2);

      // Speed value right-aligned
      const valStr = `×${ev.speed.toFixed(2).replace(/\.?0+$/, '')}`;
      ctx.font      = '7px monospace';
      ctx.fillStyle = '#b0b0cc';
      ctx.textAlign = 'right';
      ctx.fillText(valStr, pillX + pillW, yBase - PILL_H / 2);

      // Hover highlight border
      if (isHov) {
        ctx.strokeStyle = VEL_COLOR;
        ctx.lineWidth   = 1;
        ctx.strokeRect(pillX + 0.5, pillTop + 0.5, pillW - 1, PILL_H - 1);
      }

      ctx.restore();

      // Register hit zone for mouse detection in app.js
      this._velPillHitZones.push({ x: pillX, y: pillTop, w: pillW, h: PILL_H, tick: ev.y });
    }
  }

  _drawColFxHolds(ox, startY, endY) {
    const { ctx } = this;

    for (const span of FX_SPAN) {
      const x = ox + span.lx();
      const w = span.rw();

      for (const n of (this.chart?.fx[span.li] ?? [])) {
        if (n.len === 0) continue;
        const nEnd = n.y + n.len;
        if (nEnd <= startY || n.y >= endY) continue;

        const cStart = Math.max(n.y, startY);
        const cEnd   = Math.min(nEnd, endY);
        const yTop   = this._pyAt(cEnd,   startY);
        const yBot   = this._pyAt(cStart, startY);
        const bh     = Math.max(1, yBot - yTop);

        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0,    C.fxEdge);
        g.addColorStop(0.14, C.fxBody);
        g.addColorStop(0.86, C.fxBody);
        g.addColorStop(1,    C.fxEdge);
        ctx.fillStyle = g;
        ctx.fillRect(x, yTop, w, bh);

        if (n.y >= startY) {
          ctx.fillStyle   = C.fxCap;
          ctx.shadowColor = C.fxCap + 'bb';
          ctx.shadowBlur  = 6;
          ctx.fillRect(x, yBot - 5, w, 5);
          ctx.shadowBlur  = 0;
        }
        if (nEnd <= endY) {
          ctx.fillStyle = C.fxEdge;
          ctx.fillRect(x, yTop, w, 3);
        }
        // Effect label — look up the chain's active effect for this lane
        const chainEff = this.chart?.fxChains?.[span.li]?.[0];
        const effLabel = chainEff ? (EFFECT_DEFS[chainEff.type]?.label ?? chainEff.type) : null;
        if (effLabel && bh > 16) {
          ctx.save();
          ctx.font = `bold ${Math.min(11, bh * 0.35)}px monospace`;
          ctx.fillStyle = '#ffe0a0ee';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
          ctx.fillText(effLabel.toUpperCase(), x + w / 2, (yTop + yBot) / 2);
          ctx.restore();
        }

        // Hover highlight
        if (this._hoveredFxHold && this._hoveredFxHold.li === span.li && this._hoveredFxHold.note === n) {
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, yTop, w, bh);
          ctx.restore();
        }

        // Register hit zone (add 2px padding for easier clicking)
        this._fxHoldHitZones.push({ x: x - 2, y: yTop - 2, w: w + 4, h: bh + 4, li: span.li, note: n });
      }
    }
  }

  _drawColFxChips(ox, startY, endY) {
    const { ctx } = this;

    for (const span of FX_SPAN) {
      const x = ox + span.lx();
      const w = span.rw();

      for (const n of (this.chart?.fx[span.li] ?? [])) {
        if (n.len !== 0 || n.y < startY || n.y >= endY) continue;
        const yBot = this._pyAt(n.y, startY);

        const g = ctx.createLinearGradient(x, 0, x + w, 0);
        g.addColorStop(0,   C.fxEdge);
        g.addColorStop(0.2, C.fxCap);
        g.addColorStop(0.5, C.fxSheen);
        g.addColorStop(0.8, C.fxCap);
        g.addColorStop(1,   C.fxEdge);
        ctx.fillStyle   = g;
        ctx.shadowColor = C.fxCap;
        ctx.shadowBlur  = 14;
        ctx.fillRect(x, yBot - 7, w, 7);
        ctx.shadowBlur  = 0;
      }
    }
  }

  _drawColBtNotes(ox, startY, endY) {
    const { ctx } = this;

    for (let li = 0; li < 4; li++) {
      const x = ox + LANE_X[li];

      for (const n of (this.chart?.bt[li] ?? [])) {
        const nEnd = n.y + n.len;
        if (nEnd < startY || n.y >= endY) continue;

        if (n.len === 0) {
          const y = this._pyAt(n.y, startY);
          ctx.fillStyle   = C.btChip;
          ctx.shadowColor = '#ffffff88';
          ctx.shadowBlur  = 4;
          ctx.fillRect(x + 1, y - 4, BT_W - 2, 4);
          ctx.shadowBlur  = 0;
        } else {
          const cStart = Math.max(n.y, startY);
          const cEnd   = Math.min(nEnd, endY);
          const yTop   = this._pyAt(cEnd,   startY);
          const yBot   = this._pyAt(cStart, startY);

          ctx.fillStyle = C.btHoldBg;
          ctx.fillRect(x + 2, yTop, BT_W - 4, Math.max(1, yBot - yTop));

          if (n.y >= startY) {
            ctx.fillStyle = C.btHoldCap;
            ctx.fillRect(x + 1, yBot - 3, BT_W - 2, 3);
          }
          if (nEnd <= endY) {
            ctx.fillStyle = C.btHoldCap;
            ctx.fillRect(x + 1, yTop, BT_W - 2, 3);
          }
        }
      }
    }
  }

  // Lasers drawn last — continuous spline ribbons (SDVX style, Pen-Tool edit layer)
  // Performance model:
  //   • All continuous (non-slam) segments of a section → ONE batched path per run
  //   • Slam blocks → individual rects (rare)
  //   • ONE shadowBlur setup per section (not per segment)
  //   • Anchor dots ONLY when showLaserDots = true (laser tool active)
  _drawColLasers(ox, startY, endY) {
    const { ctx } = this;
    const BASE_HALF = BT_W * 0.425; // normal ribbon half-width

    for (let side = 0; side < 2; side++) {
      const color = side === 0 ? laserColors.L  : laserColors.R;
      const glow  = side === 0 ? laserColors.Lg : laserColors.Rg;
      const edge  = side === 0 ? laserColors.Le : laserColors.Re;

      for (const sec of (this.chart?.lasers[side] ?? [])) {
        const pts = sec.points;
        if (!pts.length) continue;
        const secEnd = sec.y + (pts[pts.length - 1]?.ry ?? 0);
        if (secEnd < startY || sec.y > endY) continue;

        const wide = sec.wide || laserWideMode;
        const HALF = wide ? BASE_HALF * 2 : BASE_HALF;
        const pxAt = (v) => this._laserVtoX(ox, v, wide);
        const pyAt = (t) => this._pyAt(t, startY);

        // ── Build flat segment list (clamped to column) ───────────────────────
        // Each segment carries: interpolation type (from p0, outgoing),
        // bezier curve parameter, and special flags for slams/steps.
        const segs = [];
        for (let pi = 0; pi < pts.length - 1; pi++) {
          const p0 = pts[pi], p1 = pts[pi + 1];
          const t0 = sec.y + p0.ry, t1 = sec.y + p1.ry;
          if (t1 < startY || t0 > endY) continue;
          const isSlam  = ChartData.isPointSlam(p0, p1);
          const interp  = p0.interp ?? 'linear';
          const curve   = p0.curve  ?? 0.5;
          const isStep  = !isSlam && interp === 'step';
          const ct0 = Math.max(t0, startY), ct1 = Math.min(t1, endY);
          const r0  = t1 === t0 ? 0 : (ct0 - t0) / (t1 - t0);
          const r1  = t1 === t0 ? 1 : (ct1 - t0) / (t1 - t0);
          const v0  = p0.v + (p1.v - p0.v) * r0;
          const v1  = p0.v + (p1.v - p0.v) * r1;
          // Out-of-range detection (laser must stay in [0,1])
          const outOfRange = p0.v < 0 || p0.v > 1 || p1.v < 0 || p1.v > 1;
          segs.push({
            x0: pxAt(v0), y0: pyAt(ct0), x1: pxAt(v1), y1: pyAt(ct1),
            isSlam, isStep, interp, curve, outOfRange,
            // For step: full-segment start/end positions (not clamped)
            xP0: pxAt(p0.v), xP1: pxAt(p1.v),
          });
        }
        if (!segs.length) continue;

        // ── Group into runs ──────────────────────────────────────────────────
        // Slams and steps are always solo; linear/bezier segments batch together.
        const runs = [];
        let run = null;
        for (const seg of segs) {
          if (seg.isSlam || seg.isStep) {
            if (run) { runs.push(run); run = null; }
            runs.push([seg]);
          } else {
            if (!run) run = [];
            run.push(seg);
          }
        }
        if (run) runs.push(run);

        // ── Render: one save/shadowBlur per section, one path per run ─────────
        ctx.save();
        ctx.globalAlpha = laserOpacity;
        ctx.shadowColor = glow;
        ctx.shadowBlur  = (typeof highQualityRendering !== 'undefined' && !highQualityRendering) ? 0 : 10;

        const hq2d = (typeof highQualityRendering === 'undefined' || highQualityRendering);

        for (const r of runs) {
          // ── Slam block ───────────────────────────────────────────────────
          if (r[0].isSlam) {
            const seg  = r[0];
            const timeH  = Math.max(0, seg.y0 - seg.y1);
            const minH   = HALF * 3.5;
            const extraH = Math.max(0, minH - timeH) * 0.5;
            const sBot = seg.y0 + extraH;
            const sTop = seg.y1 - extraH;
            const x0 = Math.min(seg.x0, seg.x1) - HALF;
            const x1 = Math.max(seg.x0, seg.x1) + HALF;
            const slamH = sBot - sTop;
            const grad2 = ctx.createLinearGradient(0, sTop, 0, sBot);
            grad2.addColorStop(0, color + 'aa');
            grad2.addColorStop(0.5, color);
            grad2.addColorStop(1, color);
            ctx.beginPath();
            ctx.rect(x0, sTop, x1 - x0, slamH);
            ctx.fillStyle = seg.outOfRange ? '#ff4444' : grad2; ctx.fill();
            ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.shadowBlur = hq2d ? 16 : 0;
            ctx.beginPath();
            ctx.moveTo(x0 + 1, sBot); ctx.lineTo(x1 - 1, sBot);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.stroke();
            ctx.shadowBlur = hq2d ? 10 : 0;

          // ── Step block: hold ribbon then jump ────────────────────────────
          } else if (r[0].isStep) {
            const seg  = r[0];
            const xH   = seg.xP0;  // hold position (v0)
            const xJ   = seg.xP1;  // jump destination (v1)
            const yTop = seg.y1, yBot = seg.y0;  // y1 < y0 (top is further from judgment)

            // Hold ribbon at v0 for full duration
            ctx.beginPath();
            ctx.rect(xH - HALF, yTop, HALF * 2, yBot - yTop);
            ctx.fillStyle = seg.outOfRange ? '#ff444488' : color + 'cc'; ctx.fill();
            ctx.strokeStyle = edge; ctx.lineWidth = 0.8; ctx.stroke();

            // Jump block at the top of the segment (the transition moment)
            const jX0 = Math.min(xH, xJ) - HALF;
            const jX1 = Math.max(xH, xJ) + HALF;
            const jH  = Math.max(HALF * 3, 8);
            const grad3 = ctx.createLinearGradient(0, yTop - jH * 0.5, 0, yTop + jH * 0.5);
            grad3.addColorStop(0, color + 'aa');
            grad3.addColorStop(1, color);
            ctx.beginPath();
            ctx.rect(jX0, yTop - jH * 0.5, jX1 - jX0, jH);
            ctx.fillStyle = seg.outOfRange ? '#ff4444' : grad3; ctx.fill();
            ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke();
            // Leading edge (top of jump = where player first hits it)
            ctx.shadowBlur = hq2d ? 14 : 0;
            ctx.beginPath();
            ctx.moveTo(jX0 + 1, yTop - jH * 0.5);
            ctx.lineTo(jX1 - 1, yTop - jH * 0.5);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
            ctx.shadowBlur = hq2d ? 10 : 0;

          // ── Continuous run: linear or bezier ribbon ─────────────────────
          } else {
            ctx.beginPath();
            // Left edge (bottom → top, y decreasing)
            ctx.moveTo(r[0].x0 - HALF, r[0].y0);
            for (let i = 0; i < r.length; i++) {
              const s  = r[i];
              const lx = s.x1 - HALF, ly = s.y1;
              if (s.interp === 'bezier') {
                // Cubic bezier: control points at curve-parameter fraction along Y
                // Both CPs share the same Y so the "bend" is at curve% of the segment
                const ctrlY = s.y0 + (s.y1 - s.y0) * s.curve;
                ctx.bezierCurveTo(s.x0 - HALF, ctrlY, lx, ctrlY, lx, ly);
              } else if (i < r.length - 1) {
                // Linear with Chaikin midpoint smoothing at junctions
                const ns   = r[i + 1];
                const midX = (lx + ns.x0 - HALF) / 2, midY = (ly + ns.y0) / 2;
                ctx.quadraticCurveTo(lx, ly, midX, midY);
              } else {
                ctx.lineTo(lx, ly);
              }
            }
            // Right corner, right edge back down
            const last = r[r.length - 1];
            ctx.lineTo(last.x1 + HALF, last.y1);
            for (let i = r.length - 1; i >= 0; i--) {
              const s  = r[i];
              const rx = s.x0 + HALF, ry2 = s.y0;
              if (s.interp === 'bezier') {
                const ctrlY = s.y0 + (s.y1 - s.y0) * s.curve;
                ctx.bezierCurveTo(s.x1 + HALF, ctrlY, rx, ctrlY, rx, ry2);
              } else if (i > 0) {
                const ps   = r[i - 1];
                const midX = (rx + ps.x1 + HALF) / 2, midY = (ry2 + ps.y1) / 2;
                ctx.quadraticCurveTo(rx, ry2, midX, midY);
              } else {
                ctx.lineTo(rx, ry2);
              }
            }
            ctx.closePath();
            // Out-of-range segments get a red tint
            ctx.fillStyle = r.some(s => s.outOfRange) ? '#ff444488' : color;
            ctx.fill();
            ctx.strokeStyle = edge; ctx.lineWidth = 0.8; ctx.stroke();
          }
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.restore();

        // ── Bezier handle indicators ─────────────────────────────────────────
        // Shown as a hollow diamond on the curve at the control point position.
        if (this.showLaserDots) {
          ctx.save();
          ctx.globalAlpha = 0.75;
          for (let pi = 0; pi < pts.length - 1; pi++) {
            const p0 = pts[pi], p1 = pts[pi + 1];
            if ((p0.interp ?? 'linear') !== 'bezier') continue;
            const t0 = sec.y + p0.ry, t1 = sec.y + p1.ry;
            if (t1 < startY || t0 > endY) continue;
            const curve  = p0.curve ?? 0.5;
            // Control point position: curve% of the way from t0 to t1
            const tCtrl = t0 + (t1 - t0) * curve;
            const yCtrl = pyAt(Math.max(startY, Math.min(endY, tCtrl)));
            // x: midpoint between the two anchor x positions
            const xCtrl = (pxAt(p0.v) + pxAt(p1.v)) / 2;
            // Draw diamond (rotated square) — larger + glowing when active
            const isActive = this.activeBezierHandle &&
              this.activeBezierHandle.sec === sec &&
              this.activeBezierHandle.ptIndex === pi;
            const ds = isActive ? 8 : 6;
            ctx.save();
            if (isActive) {
              ctx.shadowColor = color; ctx.shadowBlur = 14;
            }
            ctx.translate(xCtrl, yCtrl);
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.rect(-ds, -ds, ds * 2, ds * 2);
            ctx.fillStyle   = isActive ? color + 'cc' : '#00000077';
            ctx.strokeStyle = color;
            ctx.lineWidth   = isActive ? 2.5 : 1.5;
            ctx.fill(); ctx.stroke();
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }

        // ── Anchor dots: hollow (unselected) or filled+glow (selected) ──────
        {
          const isActiveSec = (sec === this.activeLaserSec) && this.showLaserDots;
          ctx.save();
          for (let pi = 0; pi < pts.length; pi++) {
            const t = sec.y + pts[pi].ry;
            if (t < startY || t > endY) continue;
            const x = pxAt(pts[pi].v);
            const y = pyAt(t);
            if (y < 0 || y > this.colH) continue;

            const isSel = this.selectedLaserPoint &&
                          this.selectedLaserPoint.side === side &&
                          this.selectedLaserPoint.sec  === sec  &&
                          this.selectedLaserPoint.ptIndex === pi;
            const isActive = isActiveSec || isSel;
            ctx.globalAlpha = isActive
              ? Math.min(1, laserOpacity + 0.25)
              : laserOpacity * 0.65;

            const dotR = isActive ? 5.5 : 3.5;
            ctx.lineWidth = isActive ? 1.8 : 1.0;

            if (isSel) {
              // Selected: filled white with strong glow
              ctx.shadowColor = color; ctx.shadowBlur = hq2d ? 12 : 0;
              ctx.fillStyle   = '#ffffff';
              ctx.strokeStyle = color;
              ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2);
              ctx.fill(); ctx.stroke();
              ctx.shadowBlur = 0;
            } else if (isActive) {
              // Active section: filled laser color with glow
              ctx.shadowColor = color; ctx.shadowBlur = hq2d ? 8 : 0;
              ctx.fillStyle   = '#ffffff';
              ctx.strokeStyle = color;
              ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2);
              ctx.fill(); ctx.stroke();
              ctx.shadowBlur = 0;
            } else {
              // Normal: hollow circle (laser color outline, transparent fill)
              ctx.fillStyle   = '#00000044';
              ctx.strokeStyle = color + 'cc';
              ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2);
              ctx.fill(); ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── Pen-tool preview line ───────────────────────────────────────────────
      // Dashed ghost from the last placed point to the cursor so the user can
      // see where the next click will go.  Only drawn for the matching side.
      const prev = this._laserPreview;
      if (prev && prev.side === side && prev.sec) {
        const sec  = prev.sec;
        const pts  = sec.points;
        if (pts.length > 0) {
          const lastPt   = pts[pts.length - 1];
          const lastTick = sec.y + lastPt.ry;
          const color    = side === 0 ? laserColors.L : laserColors.R;
          const wide     = sec.wide || laserWideMode;
          const pxAt     = (v) => this._laserVtoX(ox, v, wide);
          const pyAt     = (t) => this._pyAt(t, startY);
          const prevTick = prev.tick;
          const inCol = (lastTick >= startY && lastTick <= endY) ||
                        (prevTick  >= startY && prevTick  <= endY);
          if (inCol) {
            const x0 = pxAt(lastPt.v), y0 = pyAt(lastTick);
            const x1 = pxAt(prev.v),   y1 = pyAt(prevTick);
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = color;
            ctx.lineWidth   = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.7;
            ctx.fillStyle   = color;
            ctx.beginPath();
            ctx.arc(x1, y1, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
  }

  // Returns the nearest bezier curve handle (diamond) within hitRadius pixels of (cx,cy),
  // or null if none found.  Returns { side, sec, ptIndex, t0, t1 } where ptIndex = p0 index.
  getBezierHandleAt(canvasX, canvasY, side = -1, hitRadius = 12) {
    if (!this.chart) return null;
    const COL_TOT   = SINGLE_COL_W + COL_GAP;
    const visColIdx = Math.max(0, Math.floor(canvasX / COL_TOT));
    const colIdx    = visColIdx + this.scrollCol;
    const ox        = visColIdx * COL_TOT;
    const colLen    = this.colTicks;
    const startY    = colIdx * colLen;
    const endY      = startY + colLen;
    const pyAt      = (t) => this._pyAt(t, startY);
    const HR2       = hitRadius * hitRadius;

    for (let s = 0; s < 2; s++) {
      if (side >= 0 && s !== side) continue;
      for (const sec of (this.chart.lasers[s] ?? [])) {
        const pts  = sec.points;
        const wide = sec.wide || laserWideMode;
        const pxAt = (v) => this._laserVtoX(ox, v, wide);
        for (let pi = 0; pi < pts.length - 1; pi++) {
          const p0 = pts[pi], p1 = pts[pi + 1];
          if ((p0.interp ?? 'linear') !== 'bezier') continue;
          const t0 = sec.y + p0.ry, t1 = sec.y + p1.ry;
          if (t1 < startY || t0 > endY) continue;
          const curve  = p0.curve ?? 0.5;
          const tCtrl  = t0 + (t1 - t0) * curve;
          const yCtrl  = pyAt(Math.max(startY, Math.min(endY, tCtrl)));
          const xCtrl  = (pxAt(p0.v) + pxAt(p1.v)) / 2;
          const dx = canvasX - xCtrl, dy = canvasY - yCtrl;
          if (dx * dx + dy * dy <= HR2) {
            return { side: s, sec, ptIndex: pi, t0, t1 };
          }
        }
      }
    }
    return null;
  }

  // Returns the nearest laser anchor point within hitRadius pixels of (cx, cy),
  // or null if none found.  side=-1 means check both sides.
  getLaserPointAt(canvasX, canvasY, side = -1, hitRadius = 10) {
    if (!this.chart) return null;
    const COL_TOT    = SINGLE_COL_W + COL_GAP;
    const visColIdx  = Math.max(0, Math.floor(canvasX / COL_TOT));
    const colIdx     = visColIdx + this.scrollCol;
    const ox         = visColIdx * COL_TOT;
    const colLen     = this.colTicks;
    const colStartY  = colIdx * colLen;
    const colEndY    = colStartY + colLen;

    const HR2 = hitRadius * hitRadius;
    for (let s = 0; s < 2; s++) {
      if (side >= 0 && s !== side) continue;
      for (const sec of (this.chart.lasers[s] ?? [])) {
        const wide = sec.wide;
        for (let pi = 0; pi < sec.points.length; pi++) {
          const pt = sec.points[pi];
          const t  = sec.y + pt.ry;
          if (t < colStartY || t > colEndY) continue;
          const dotX = this._laserVtoX(ox, pt.v, wide);
          const dotY = this._pyAt(t, colStartY);
          if (dotY < 0 || dotY > this.colH) continue;
          const dx = canvasX - dotX, dy = canvasY - dotY;
          if (dx * dx + dy * dy <= HR2) {
            return { side: s, sec, ptIndex: pi };
          }
        }
      }
    }
    return null;
  }

  _drawCursor() {
    const { ctx } = this;
    const pos = this.tickToCanvas(this.playTick);
    if (!pos.visible) return;

    const cy = pos.cy;
    const ox = pos.visColIdx * (SINGLE_COL_W + COL_GAP);

    ctx.save();
    ctx.strokeStyle = C.cursor;
    ctx.shadowColor = C.cursorGlow;
    ctx.shadowBlur  = this.playing ? 10 : 4;
    ctx.lineWidth   = this.playing ? 2   : 1;
    ctx.setLineDash(this.playing ? [] : [5, 4]);
    ctx.globalAlpha = this.playing ? 1.0 : 0.5;
    ctx.beginPath();
    ctx.moveTo(ox + RULER_W, cy);
    ctx.lineTo(ox + SINGLE_COL_W, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// Draw selection overlay on top of the chart
Renderer.prototype.drawSelection = function(sel) {
  if (!sel || !sel.active) return;
  const { ctx } = this;
  const colLen = this.colTicks;
  const lo = Math.min(sel.startTick, sel.endTick);
  const hi = Math.max(sel.startTick, sel.endTick);

  for (let vi = 0; vi < this.numCols; vi++) {
    const ci = vi + this.scrollCol;
    const cStart = ci * colLen;
    const cEnd   = cStart + colLen;
    if (hi < cStart || lo > cEnd) continue;

    const ox     = vi * (SINGLE_COL_W + COL_GAP);
    const clampLo = Math.max(lo, cStart);
    const clampHi = Math.min(hi, cEnd);
    const yTop = this._pyAt(clampHi, cStart);
    const yBot = this._pyAt(clampLo, cStart);
    const height = Math.max(2, yBot - yTop);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#00cfff';
    ctx.fillRect(ox + RULER_W, yTop, TRACK_W + EXTEND_W * 2, height);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#00cfff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(ox + RULER_W, yTop, TRACK_W + EXTEND_W * 2, height);
    ctx.setLineDash([]);
    ctx.restore();
  }
};

function buildLaneHeader() {
  // Hidden in multi-column mode
}

// ── Laser overlap flash ────────────────────────────────────────────────────────
Renderer.prototype._overlapFlashes = [];

Renderer.prototype.flashLaserOverlap = function(side, tick) {
  this._overlapFlashes.push({ side, tick, alpha: 1.0, startTime: performance.now() });
};

Renderer.prototype._drawOverlapFlashes = function() {
  const now = performance.now();
  const { ctx } = this;
  this._overlapFlashes = this._overlapFlashes.filter(f => {
    f.alpha = Math.max(0, 1 - (now - f.startTime) / 600);
    if (f.alpha <= 0) return false;
    const pos = this.tickToCanvas(f.tick);
    if (!pos.visible) return true;
    const cy = pos.cy;
    const ox = pos.visColIdx * (SINGLE_COL_W + COL_GAP);
    ctx.save();
    ctx.globalAlpha = f.alpha * 0.6;
    ctx.fillStyle = '#ff2222';
    ctx.fillRect(ox + RULER_W, cy - 8, TRACK_W + EXTEND_W * 2, 16);
    ctx.restore();
    return true;
  });
};

/* ── Annotation overlay ─────────────────────────────────────────────────────
   Draws animated ⚠/⛔ markers for issues flagged by Hand Optimizer and
   Validity Checker.  Called from app.js after drawSelection().
   annotations : array of { tick, label, severity, source, createdAt }
   alphaFn     : function(ann) → 0..1 (fade-out over lifetime)
   ─────────────────────────────────────────────────────────────────────────── */
Renderer.prototype.drawAnnotations = function(annotations, alphaFn) {
  if (!annotations || !annotations.length) return;
  const ctx = this.ctx;
  const now = Date.now();

  // Group annotations by column position to handle stacking
  // tickKey → [ann, ...]
  const byPos = new Map();
  annotations.forEach(ann => {
    const pos = this.tickToCanvas(ann.tick);
    if (!pos.visible) return;
    const key = `${pos.visColIdx}_${Math.round(pos.cy / 4)}`; // ~4px bucket
    if (!byPos.has(key)) byPos.set(key, { pos, items: [] });
    byPos.get(key).items.push(ann);
  });

  byPos.forEach(({ pos, items }) => {
    const ox = pos.visColIdx * (SINGLE_COL_W + COL_GAP);
    const tickY = pos.cy;

    items.forEach((ann, stackIdx) => {
      const alpha = alphaFn ? alphaFn(ann) : 1;
      if (alpha <= 0) return;

      const isError   = ann.severity === 'error';
      const color     = isError ? '#ff3355' : '#ffcc00';
      const colorGlow = isError ? '#ff335544' : '#ffcc0044';

      // Animate: slow bounce + pulse
      const t        = now / 1000;
      const bounce   = Math.sin(t * 3.5 + stackIdx) * 5;
      const pulse    = 0.7 + Math.sin(t * 6 + stackIdx * 1.3) * 0.3;

      // Marker floats above the tick line, stacked for multiple items
      const markerX = ox + BT_AREA_X + TRACK_W / 2 + stackIdx * 18;
      const markerY = tickY - 28 + bounce;

      ctx.save();
      ctx.globalAlpha = alpha;

      // ── Tick-line highlight ─────────────────────────────────────────────
      ctx.globalAlpha = alpha * 0.25 * pulse;
      ctx.fillStyle   = color;
      ctx.fillRect(ox + RULER_W, tickY - 1, TRACK_W + EXTEND_W * 2, 2);

      // ── Glow halo around marker ─────────────────────────────────────────
      ctx.globalAlpha  = alpha * 0.35 * pulse;
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 12;
      ctx.fillStyle    = colorGlow;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ── Warning triangle ────────────────────────────────────────────────
      ctx.globalAlpha = alpha * pulse;
      const tr = 9; // triangle radius
      ctx.beginPath();
      ctx.moveTo(markerX,      markerY - tr);      // top
      ctx.lineTo(markerX - tr, markerY + tr * 0.6); // bottom-left
      ctx.lineTo(markerX + tr, markerY + tr * 0.6); // bottom-right
      ctx.closePath();
      ctx.fillStyle   = isError ? '#220008' : '#1a1400';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // ── Exclamation / × glyph ───────────────────────────────────────────
      ctx.fillStyle    = color;
      ctx.font         = `bold 8px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isError ? '✕' : '!', markerX, markerY + 1);

      // ── Stem arrow pointing down to tick ────────────────────────────────
      ctx.globalAlpha = alpha * 0.8;
      const stemTop   = markerY + tr * 0.6 + 1;
      const stemBot   = tickY - 3;
      if (stemBot > stemTop + 2) {
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(markerX, stemTop);
        ctx.lineTo(markerX, stemBot);
        ctx.stroke();
        ctx.setLineDash([]);
        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(markerX - 3, stemBot - 4);
        ctx.lineTo(markerX,     stemBot);
        ctx.lineTo(markerX + 3, stemBot - 4);
        ctx.stroke();
      }

      // ── Label (truncated, to the right of the marker) ───────────────────
      ctx.globalAlpha  = alpha * 0.9;
      const labelX     = markerX + 14;
      const labelY     = markerY + 1;
      const maxW       = ox + SINGLE_COL_W - labelX - 4;
      if (maxW > 20 && stackIdx === 0) {
        const src  = ann.source === 'hand-opt' ? '✋' : ann.source === 'validity' ? '⛔' : '⚠';
        const text = src + ' ' + (ann.label || '').slice(0, 22);
        ctx.font         = '8px monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle    = color;
        // Background pill
        const tw = Math.min(maxW, ctx.measureText(text).width + 6);
        ctx.globalAlpha  = alpha * 0.5;
        ctx.fillStyle    = isError ? '#220008' : '#1a1200';
        ctx.fillRect(labelX - 2, labelY - 6, tw, 12);
        ctx.globalAlpha  = alpha * 0.9;
        ctx.fillStyle    = color;
        ctx.fillText(text, labelX, labelY);
      }

      ctx.restore();
    });
  });
};
