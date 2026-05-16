'use strict';

// ── SDVX Game Preview ──────────────────────────────────────────────────────────
// Tick interval for hold scoring samples
const HOLD_SAMPLE = TICKS_PER_BEAT / 8;

class GameView {
  constructor(canvas) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.chart    = null;
    this.playTick = 0;
    this.hispeed  = 1.0;   // visual speed multiplier

    // Projection mode: 'ortho' | 'sdvx' | 'hybrid'
    this.projMode = 'sdvx';
    // Perspective intensity 0-100 (65 = SDVX arcade default)
    this.perspIntensity = 65;
    // BT note visual width multiplier (1.0 = default)
    this.btWidthScale = 1.0;
    // Judgment line Y position as fraction of canvas height (0.73 = default)
    this.judgeYFrac = 0.73;

    // Autoplay scoring state
    this._score   = 0;
    this._chain   = 0;
    this._maxScore = 0;
    this._totalWeight = 0;
    this._judgment = null;  // { text, alpha, timer }
    this._lastTick  = 0;

    // Animation
    this._raf = null;

    // Geometry cache — invalidated when canvas size or projection changes
    this._paramCache = null;
    this._paramDirty = true;

    // Live camera state — set each frame by app.js from chart.cameraEvents.
    // null = use static chart.camera; otherwise overrides per-field.
    // { zoomTop, zoomBot, zoomSide, tilt (degrees), split }
    this._liveCamera = null;

    // Edit-mode ghost cursor — set by app.js during game-edit hover.
    // { tick, norm, tool }  |  null = hidden
    this._editGhost = null;

    // Slam flash queue: [{ side, v0, v1, wide, time }]
    // Each entry lives for ~200 ms then is pruned.
    this._slamFlashes = [];

    // Phase 1 WebGL lane renderer. Attached lazily via attachGL().
    // When useGL is true and _glRenderer.ok is true, the lane runway is
    // rendered on a separate GL canvas behind this 2D canvas; the 2D
    // path skips its lane drawing and only paints notes/lasers/HUD.
    this.useGL = false;
    this._glRenderer = null;
  }

  // Wire a sibling WebGL canvas. If GL2 isn't supported the renderer
  // simply marks itself not-ok and the 2D fallback continues unchanged.
  attachGL(glCanvas) {
    if (!glCanvas || typeof GLLaneRenderer === 'undefined') return false;
    this._glRenderer = new GLLaneRenderer(glCanvas);
    if (this._glRenderer.ok) this._glRenderer.resize(this.canvas.width, this.canvas.height);
    return !!this._glRenderer.ok;
  }

  get VISIBLE_TICKS() { return TICKS_PER_MEASURE * 4 / Math.max(0.1, this.hispeed); }

  // ── Chart Velocity (visual scroll-speed) helpers ─────────────────────────
  // Effective "dt" from the playhead to a chart tick, integrating
  // chart.scrollSpeedEvents.  When no velocity events exist this is just
  // (y - playTick) so behaviour is identical to before.  Cached per draw().
  _effDt(y) {
    if (!this.chart || !this.chart.scrollDistanceTo) return y - this.playTick;
    if (this._playDist == null) {
      this._playDist = this.chart.scrollDistanceTo(this.playTick);
    }
    return this.chart.scrollDistanceTo(y) - this._playDist;
  }

  resize() {
    const w = this.canvas.clientWidth  || this.canvas.parentElement?.clientWidth  || 800;
    const h = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 600;
    this.canvas.width  = w;
    this.canvas.height = h;
    if (this._glRenderer?.ok) this._glRenderer.resize(w, h);
    this._totalWeight = this.chart ? this._calcTotalWeight(this.chart) : 0;
    this._paramDirty  = true;
  }

  // ── Projection helpers ────────────────────────────────────────────────────

  _params() {
    const w = this.canvas.width, h = this.canvas.height;
    // _liveCamera (set each frame during playback) takes priority over
    // the static chart.camera.  Fields not present in _liveCamera fall
    // back to the static object so the two sources compose cleanly.
    const lc  = this._liveCamera;                // live (may be null)
    const cam = this.chart?.camera;              // static fallback

    const judgeY    = h * Math.max(0.35, Math.min(0.92, this.judgeYFrac ?? 0.73));
    const vanishY   = h * 0.09;
    const baseLaneW = Math.min(w * 0.52, 380);

    // ── Lane width (zoom_bottom) ───────────────────────────────────────────
    // KSH zoom_bottom range ≈ −300…+300; positive = wider bottom.
    const zoomBot  = lc ? (lc.zoomBot  ?? 0) : (cam?.zoomBot  ?? 0);
    const laneWBot = baseLaneW * Math.max(0.1, 1 + zoomBot / 300);

    // ── Lateral offset (zoom_side) ────────────────────────────────────────
    // Each +100 unit shifts the lane ~2 % of screen width.
    const zoomSide = lc ? (lc.zoomSide ?? 0) : 0;
    const split    = lc ? (lc.split    ?? cam?.split ?? 0) : (cam?.split ?? 0);
    const cx       = w / 2 + split * w * 0.003 + zoomSide * w * 0.002;

    // ── Tilt ──────────────────────────────────────────────────────────────
    // _liveCamera.tilt is already in degrees; chart.camera.rotation is too.
    const tiltDeg = lc ? (lc.tilt ?? 0) : (cam?.rotation ?? 0);
    const tilt    = tiltDeg * Math.PI / 180;

    // ── Perspective K ─────────────────────────────────────────────────────
    // K: how strongly the lane narrows with distance.
    // zoom_top (KSH range ≈ −300…+300) modulates K: positive compresses
    // the vanishing-point end (stronger perspective), negative expands it.
    const zoomTop    = lc ? (lc.zoomTop ?? 0) : (cam?.zoomTop ?? 0);
    const zoomTopMul = Math.max(0.3, 1 + (zoomTop / 300) * 0.6);
    const rawK       = (1 + Math.pow(this.perspIntensity / 100, 1.5) * 27) * zoomTopMul;
    const K          = Math.max(1.001, rawK);

    // Effective blend based on mode
    // ortho: blend=0 (fully linear), sdvx: blend=1 (full perspective), hybrid: blend=0.45
    const perspBlend = this.projMode === 'ortho' ? 0
                     : this.projMode === 'sdvx'  ? 1
                     : 0.45; // hybrid

    // Cutoff depth: truncate the runway 4% of the lane height from the vanish point.
    // This scales with the projection so it stays consistent at all screen sizes and zoom levels.
    const cutoffY = vanishY + (judgeY - vanishY) * 0.04;

    return { w, h, judgeY, vanishY, cutoffY, laneWBot, cx, tilt, K, perspBlend,
             projMode: this.projMode };
  }

  // ── Core perspective factor ───────────────────────────────────────────────
  // Returns a scale factor ∈ (0, 1].
  // dt=0 (at judgment line) → pf=1 (full size)
  // dt=VT (far/spawn)       → pf→small (tiny)
  _perspFactor(dt, p) {
    const prog  = Math.max(0, Math.min(1, dt / this.VISIBLE_TICKS));
    const ortho = 1 - prog;                          // linear (orthographic)
    const persp = 1 / (1 + (p.K - 1) * prog);       // true perspective 1/Z
    return ortho * (1 - p.perspBlend) + persp * p.perspBlend;
  }

  // dt = ticks ahead of playhead.  Returns screen-Y coordinate.
  //
  // Uses the SAME perspective factor as _halfW so the projection is
  // geometrically consistent (proper 3D):
  //   ortho  → linear scroll, constant lane width
  //   sdvx   → 1/Z scroll + 1/Z width (notes rush in from vanish point)
  //   hybrid → blend
  //
  // In SDVX mode notes appear to accelerate toward the judgment line,
  // exactly as they do on the arcade cabinet.  Lane dividers stay as
  // straight 2-D lines because a straight 3-D line always projects to
  // a straight 2-D line — so all polygon edges remain correct.
  _screenY(dt, p) {
    const pf = this._perspFactor(dt, p);
    return p.vanishY + (p.judgeY - p.vanishY) * pf;
  }

  // Lane half-width at a given screen-Y position.
  // t = (sy − vanishY) / (judgeY − vanishY) is exactly the perspective
  // factor that _screenY used to place notes at sy, so this is consistent.
  // Ortho: t varies 0→1 linearly → orthoW (constant half-width).
  // SDVX:  t varies 1/K→1 (1/Z) → perspW = laneWBot/2 * t.
  _halfW(sy, p) {
    const t = Math.max(0, (sy - p.vanishY) / Math.max(1, p.judgeY - p.vanishY));
    const orthoW = p.laneWBot / 2;
    const perspW = p.laneWBot / 2 * t;
    return orthoW * (1 - p.perspBlend) + perspW * p.perspBlend;
  }

  // Tilt is applied as ctx.rotate() in draw() — no per-point shear here.
  _screenX(norm, sy, p) {
    const hw = this._halfW(sy, p);
    return p.cx + (norm - 0.5) * hw * 2;
  }

  // Convert a screen-Y back to a perspective factor (for use in laser ribbons)
  _pfFromSy(sy, p) {
    return Math.max(0, (sy - p.vanishY) / Math.max(1, p.judgeY - p.vanishY));
  }

  // ── Laser lane offset ─────────────────────────────────────────────────────
  // In SDVX the VOL (laser) lanes extend outside the BT/FX lane boundary.
  // This constant controls the size of the visible VOL panel painting
  // (the dark side-rails left and right of the BT lanes).
  // Matches LASER_HALF_FRAC × 2 so the panel exactly contains the laser
  // ribbon at v=0 / v=1.
  static get LASER_LANE_OFFSET() { return 0.25; }

  // Laser ribbon half-width as a fraction of the BT-lane normalised range.
  // 0.125 = full ribbon width 0.25 = one BT lane wide (user-tuned).
  // This is also the offset used by _laserNorm so that the ribbon's outer
  // edge lands exactly on the BT lane boundary at v=0 / v=1.
  static get LASER_HALF_FRAC() { return 0.125; }

  // Map laser position v ∈ [0, 1] to normalised track coordinate.
  // Default rest positions:
  //   v = 0  →  laser ribbon's RIGHT edge sits on BT-A's left edge (norm 0).
  //   v = 1  →  laser ribbon's LEFT  edge sits on BT-D's right edge (norm 1).
  // Wide 2× (wide=true) doubles the travel range, centered at 0.5.
  _laserNorm(v, wide = false) {
    const HALF = GameView.LASER_HALF_FRAC;
    if (wide) {
      return -0.5 - 2 * HALF + v * (2 + 4 * HALF);
    }
    return -HALF + v * (1 + 2 * HALF);
  }

  // Convenience: screen X for a laser v-value
  _laserX(v, sy, p, wide = false) {
    return this._screenX(this._laserNorm(v, wide), sy, p);
  }

  // ── Score helpers ─────────────────────────────────────────────────────────

  _calcTotalWeight(chart) {
    let w = 0;
    for (let li = 0; li < 4; li++) {
      for (const n of chart.bt[li]) {
        w += n.len === 0 ? 2 : Math.max(1, Math.ceil(n.len / HOLD_SAMPLE)) * 2;
      }
    }
    for (let li = 0; li < 2; li++) {
      for (const n of chart.fx[li]) {
        w += n.len === 0 ? 2 : Math.max(1, Math.ceil(n.len / HOLD_SAMPLE)) * 2;
      }
    }
    for (let s = 0; s < 2; s++) {
      for (const sec of chart.lasers[s]) {
        const dur = sec.points[sec.points.length - 1]?.ry ?? 0;
        w += Math.max(1, Math.ceil(dur / HOLD_SAMPLE)) * 2;
      }
    }
    return Math.max(1, w);
  }

  countChain(chart, tick) {
    let c = 0;
    for (let li = 0; li < 4; li++) {
      for (const n of chart.bt[li]) {
        if (n.y > tick) continue;
        c += n.len === 0 ? 1 : Math.max(1, Math.floor((Math.min(n.y + n.len, tick) - n.y) / HOLD_SAMPLE));
      }
    }
    for (let li = 0; li < 2; li++) {
      for (const n of chart.fx[li]) {
        if (n.y > tick) continue;
        c += n.len === 0 ? 1 : Math.max(1, Math.floor((Math.min(n.y + n.len, tick) - n.y) / (HOLD_SAMPLE * 2)));
      }
    }
    // ── Lasers count toward chain while active (SDVX official: sampled every HOLD_SAMPLE ticks)
    for (let s = 0; s < 2; s++) {
      for (const sec of chart.lasers[s]) {
        if (sec.y > tick) continue;
        const lastRy = sec.points[sec.points.length - 1]?.ry ?? 0;
        if (lastRy <= 0) continue; // single-point laser has no duration
        const activeLen = Math.min(lastRy, tick - sec.y);
        if (activeLen >= HOLD_SAMPLE) {
          c += Math.floor(activeLen / HOLD_SAMPLE);
        }
      }
    }
    return c;
  }

  // Compute autoplay score up to given tick
  _calcScore(chart, tick) {
    if (!this._totalWeight) return 0;
    let weight = 0;
    for (let li = 0; li < 4; li++) {
      for (const n of chart.bt[li]) {
        if (n.y > tick) continue;
        weight += n.len === 0
          ? 2
          : Math.max(1, Math.ceil(Math.min(n.len, tick - n.y) / HOLD_SAMPLE)) * 2;
      }
    }
    for (let li = 0; li < 2; li++) {
      for (const n of chart.fx[li]) {
        if (n.y > tick) continue;
        weight += n.len === 0
          ? 2
          : Math.max(1, Math.ceil(Math.min(n.len, tick - n.y) / HOLD_SAMPLE)) * 2;
      }
    }
    for (let s = 0; s < 2; s++) {
      for (const sec of chart.lasers[s]) {
        if (sec.y > tick) continue;
        const dur = Math.min(sec.points[sec.points.length - 1]?.ry ?? 0, tick - sec.y);
        weight += Math.max(0, Math.ceil(dur / HOLD_SAMPLE)) * 2;
      }
    }
    return Math.round(10000000 * weight / this._totalWeight);
  }

  _grade(score) {
    if (score >= 9900000) return { g: 'S',    col: '#ffee55' };
    if (score >= 9800000) return { g: 'AAA+', col: '#ffcc00' };
    if (score >= 9700000) return { g: 'AAA',  col: '#ffcc00' };
    if (score >= 9500000) return { g: 'AA+',  col: '#aaddff' };
    if (score >= 9300000) return { g: 'AA',   col: '#aaddff' };
    if (score >= 9000000) return { g: 'A+',   col: '#ccffcc' };
    if (score >= 8700000) return { g: 'A',    col: '#ccffcc' };
    if (score >= 7500000) return { g: 'B',    col: '#d8d8f0' };
    if (score >= 6500000) return { g: 'C',    col: '#d8d8f0' };
    return                       { g: 'D',    col: '#ff8888' };
  }

  // ── Main draw ─────────────────────────────────────────────────────────────

  draw() {
    const { ctx } = this;
    const p     = this._params();
    const chart = this.chart;
    const tick  = this.playTick;
    const VT    = this.VISIBLE_TICKS;
    // Reset the per-frame Chart Velocity playhead-distance cache.
    this._playDist = null;
    // High-quality flag: glow/shadow enabled when true (set via Preferences)
    const hq = (typeof highQualityRendering === 'undefined' || highQualityRendering)
               && p.projMode !== 'ortho';

    // Recompute total weight if chart changed
    if (chart && !this._totalWeight) {
      this._totalWeight = this._calcTotalWeight(chart);
    }

    // Autoplay scoring is gated by prefs.autoplay — when off, both stay 0
    const autoplayOn = (typeof prefs === 'undefined' || prefs?.autoplay !== false);
    const score = (chart && autoplayOn) ? this._calcScore(chart, tick) : 0;
    const chain = (chart && autoplayOn) ? this.countChain(chart, tick) : 0;

    // ── Background ────────────────────────────────────────────────────────
    // When the WebGL lane renderer is active, it owns the background gradient
    // and the entire lane runway. We just clear the 2D overlay to transparent
    // so notes/lasers/HUD composite cleanly on top.
    const useGL = this.useGL && this._glRenderer?.ok;
    if (useGL) {
      this._glRenderer.render(
        p, this,
        typeof laserColors !== 'undefined' ? laserColors : null,
        chart,
        typeof laserOpacity !== 'undefined' ? laserOpacity : 0.7
      );
      ctx.clearRect(0, 0, p.w, p.h);
    } else {
      const bgGrad = ctx.createLinearGradient(0, 0, 0, p.h);
      bgGrad.addColorStop(0,   '#020308');
      bgGrad.addColorStop(0.4, '#050515');
      bgGrad.addColorStop(1,   '#08001a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, p.w, p.h);
    }

    // ── Camera tilt: rotate the entire lane/notes around the judgment line center ──
    // We use ctx.rotate() so the full 3-D lane tilts as one rigid body (CW/CCW).
    // Background is intentionally NOT rotated — it remains full-screen.
    if (p.tilt) {
      ctx.save();
      ctx.translate(p.cx, p.judgeY);
      ctx.rotate(p.tilt);
      ctx.translate(-p.cx, -p.judgeY);
    }

    // Lane trapezoid — BT/FX area [norm 0..1] clipped at cutoffY
    // Coordinates are needed even when GL handles the visible lane,
    // since the rest of the draw path (hit flashes, etc.) doesn't
    // recompute them. Cheap to keep unconditional.
    const OFF = GameView.LASER_LANE_OFFSET;
    const lx0 = this._screenX(0,    p.cutoffY, p);
    const rx0 = this._screenX(1,    p.cutoffY, p);
    const lx1 = this._screenX(0,    p.judgeY,  p);
    const rx1 = this._screenX(1,    p.judgeY,  p);
    // VOL lane outer edges [norm -OFF .. 0] and [1 .. 1+OFF]
    const vlx0 = this._screenX(-OFF, p.cutoffY, p);
    const vrx0 = this._screenX(1+OFF, p.cutoffY, p);
    const vlx1 = this._screenX(-OFF, p.judgeY,  p);
    const vrx1 = this._screenX(1+OFF, p.judgeY,  p);

    if (!useGL) {
      // ── VOL lane panels (darker tint, drawn first) ───────────────────────
      const volGrad = ctx.createLinearGradient(0, p.cutoffY, 0, p.judgeY);
      volGrad.addColorStop(0, '#030312');
      volGrad.addColorStop(1, '#080820');

      // Left VOL panel
      ctx.beginPath();
      ctx.moveTo(vlx0, p.cutoffY); ctx.lineTo(lx0, p.cutoffY);
      ctx.lineTo(lx1, p.judgeY);   ctx.lineTo(vlx1, p.judgeY);
      ctx.closePath();
      ctx.fillStyle = volGrad; ctx.fill();

      // Right VOL panel
      ctx.beginPath();
      ctx.moveTo(rx0, p.cutoffY); ctx.lineTo(vrx0, p.cutoffY);
      ctx.lineTo(vrx1, p.judgeY); ctx.lineTo(rx1, p.judgeY);
      ctx.closePath();
      ctx.fillStyle = volGrad; ctx.fill();

      // ── BT/FX main lane ──────────────────────────────────────────────────
      ctx.beginPath();
      ctx.moveTo(lx0, p.cutoffY); ctx.lineTo(rx0, p.cutoffY);
      ctx.lineTo(rx1, p.judgeY);  ctx.lineTo(lx1, p.judgeY);
      ctx.closePath();
      const laneGrad = ctx.createLinearGradient(0, p.cutoffY, 0, p.judgeY);
      laneGrad.addColorStop(0, '#060618');
      laneGrad.addColorStop(0.6, '#0d0d28');
      laneGrad.addColorStop(1, '#12133a');
      ctx.fillStyle = laneGrad;
      ctx.fill();

      // VOL outer boundary lines
      ctx.strokeStyle = '#2a2a55'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(vlx0, p.cutoffY); ctx.lineTo(vlx1, p.judgeY);
      ctx.moveTo(vrx0, p.cutoffY); ctx.lineTo(vrx1, p.judgeY);
      ctx.stroke();

      // Side glow — from outer VOL lane edge inward
      const volLeft  = this._laserX(0, p.judgeY, p);   // leftmost laser position
      const volRight = this._laserX(1, p.judgeY, p);   // rightmost laser position
      const _drawGlow = (x, dir, col) => {
        const w = Math.abs(x - (dir < 0 ? vlx1 : vrx1)) + 40;
        const g = ctx.createLinearGradient(x, 0, x + dir * w, 0);
        g.addColorStop(0, col); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(x, x + dir * w), p.cutoffY, w, p.judgeY - p.cutoffY);
      };
      _drawGlow(volLeft,  -1, laserColors.L + '33');
      _drawGlow(volRight,  1, laserColors.R + '33');

      // ── Scrolling grid (beat/measure lines) ───────────────────────────────

      const beatStep  = TICKS_PER_BEAT;
      const startBeat = Math.floor(tick / beatStep) * beatStep;
      // Extend upper iteration bound when chart velocity is slower than 1.0
      // so we still draw all beat lines in the visible window.
      const _velAtTick = chart?.getScrollSpeedAt ? chart.getScrollSpeedAt(tick) : 1.0;
      const beatIterMax = tick + VT / Math.max(0.05, _velAtTick) + beatStep;
      for (let t = startBeat; t <= beatIterMax; t += beatStep) {
        const dt = this._effDt(t);
        if (dt < 0 || dt > VT) continue;
        const sy = this._screenY(dt, p);
        if (sy <= p.cutoffY || sy >= p.judgeY) continue;
        const isMeasure = (t % TICKS_PER_MEASURE === 0);
        ctx.strokeStyle = isMeasure ? '#6060aa' : '#22224a';
        ctx.lineWidth   = isMeasure ? 1.5 : 0.7;
        ctx.beginPath();
        ctx.moveTo(this._screenX(0, sy, p), sy);
        ctx.lineTo(this._screenX(1, sy, p), sy);
        ctx.stroke();
      }

      // ── Vertical lane dividers ────────────────────────────────────────────

      for (let i = 0; i <= 4; i++) {
        const n = i / 4;
        ctx.strokeStyle = i === 0 || i === 4 ? '#5050a0' : '#282858';
        ctx.lineWidth = i === 0 || i === 4 ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(this._screenX(n, p.cutoffY, p), p.cutoffY);
        ctx.lineTo(this._screenX(n, p.judgeY,  p), p.judgeY);
        ctx.stroke();
      }
    }

    if (!chart) { this._drawHUD(p, tick, score, chain); return; }

    // ── Hit flash surface glow — drawn ON the lane BEFORE notes ───────────
    // (additive composite makes it look like light emitted from the surface)
    this._drawHitFlashes(p, tick, chart);

    // ── FX holds / FX chips / BT holds / BT chips ────────────────────────
    // When the WebGL renderer is active it has already emitted these note
    // quads into its vertex buffer in the same draw pass as the lane.
    if (!useGL) {

    // ── FX holds ──────────────────────────────────────────────────────────

    for (let li = 0; li < 2; li++) {
      const ln = li * 0.5, rn = (li + 1) * 0.5;
      const FX_INSET = 0.012; // keep FX holds inside the lane boundary lines
      for (const n of chart.fx[li]) {
        const _eEnd = this._effDt(n.y + n.len);
        const _eStart = this._effDt(n.y);
        if (n.len === 0 || _eEnd < 0 || _eStart > VT) continue;
        const dt0 = Math.max(_eStart, 0);
        const dt1 = Math.min(_eEnd, VT);
        const sy0 = this._screenY(dt1, p); // top (far)
        const sy1 = this._screenY(dt0, p); // bottom (near)
        const x0l = this._screenX(ln + FX_INSET, sy0, p), x0r = this._screenX(rn - FX_INSET, sy0, p);
        const x1l = this._screenX(ln + FX_INSET, sy1, p), x1r = this._screenX(rn - FX_INSET, sy1, p);
        ctx.beginPath();
        ctx.moveTo(x0l, sy0); ctx.lineTo(x0r, sy0);
        ctx.lineTo(x1r, sy1); ctx.lineTo(x1l, sy1);
        ctx.closePath();
        const fg = ctx.createLinearGradient(x1l, 0, x1r, 0);
        fg.addColorStop(0,   '#8c4000');
        fg.addColorStop(0.5, '#ff8800cc');
        fg.addColorStop(1,   '#8c4000');
        ctx.fillStyle = fg;
        ctx.shadowColor = '#ff880055'; ctx.shadowBlur = hq ? 8 : 0;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ── FX chips ──────────────────────────────────────────────────────────

    for (let li = 0; li < 2; li++) {
      const ln = li * 0.5, rn = (li + 1) * 0.5;
      for (const n of chart.fx[li]) {
        if (n.len !== 0) continue;
        const dt = this._effDt(n.y);
        if (dt < 0 || dt > VT) continue;
        const sy = this._screenY(dt, p);
        if (sy < p.cutoffY) continue; // cull above runway
        const lx = this._screenX(ln + 0.01, sy, p);
        const rx = this._screenX(rn - 0.01, sy, p);
        const chipH = Math.max(5, (rx - lx) * 0.12);
        const fg = ctx.createLinearGradient(lx, 0, rx, 0);
        fg.addColorStop(0,   '#aa5500');
        fg.addColorStop(0.3, '#ffcc00');
        fg.addColorStop(0.7, '#ffcc00');
        fg.addColorStop(1,   '#aa5500');
        ctx.fillStyle = fg;
        ctx.shadowColor = '#ffcc00cc'; ctx.shadowBlur = hq ? 18 : 0;
        ctx.fillRect(lx, sy - chipH, rx - lx, chipH);
        ctx.shadowBlur = 0;
      }
    }

    // ── BT holds ──────────────────────────────────────────────────────────

    for (let li = 0; li < 4; li++) {
      // btWidthScale shrinks/grows BT notes by contracting/expanding their lane inset
      const bwInset = (1 - Math.min(1.5, Math.max(0, this.btWidthScale))) / 8;
      const ln = li / 4 + bwInset, rn = (li + 1) / 4 - bwInset;
      for (const n of chart.bt[li]) {
        const _eEnd = this._effDt(n.y + n.len);
        const _eStart = this._effDt(n.y);
        if (n.len === 0 || _eEnd < 0 || _eStart > VT) continue;
        const dt0 = Math.max(_eStart, 0);
        const dt1 = Math.min(_eEnd, VT);
        const sy0 = this._screenY(dt1, p); // top (far)
        const sy1 = this._screenY(dt0, p); // bottom (near/judgment)
        const x0l = this._screenX(ln + 0.005, sy0, p), x0r = this._screenX(rn - 0.005, sy0, p);
        const x1l = this._screenX(ln + 0.005, sy1, p), x1r = this._screenX(rn - 0.005, sy1, p);
        const isActiveNow = n.y <= tick && n.y + n.len >= tick;

        ctx.beginPath();
        ctx.moveTo(x0l, sy0); ctx.lineTo(x0r, sy0);
        ctx.lineTo(x1r, sy1); ctx.lineTo(x1l, sy1);
        ctx.closePath();

        // White/bright fill — same visual family as BT chips
        const hg = ctx.createLinearGradient(0, sy0, 0, sy1);
        hg.addColorStop(0,   '#9090cc');
        hg.addColorStop(0.5, '#c8c8f0');
        hg.addColorStop(1,   '#e8e8ff');
        ctx.fillStyle = hg;
        if (isActiveNow) {
          ctx.shadowColor = '#ffffffcc'; ctx.shadowBlur = hq ? 18 : 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;

        // Bright white edge outline
        ctx.strokeStyle = isActiveNow ? '#ffffffcc' : '#aaaaee88';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // White top cap at the start of the hold (chip-style header)
        if (n.y >= tick && n.y <= tick + VT) {
          const capH = Math.max(3, (x1r - x1l) * 0.07);
          ctx.fillStyle = '#f8f8ff';
          ctx.shadowColor = '#ffffffaa'; ctx.shadowBlur = hq ? 14 : 0;
          ctx.fillRect(x1l, sy1 - capH, x1r - x1l, capH);
          ctx.shadowBlur = 0;
        }
      }
    }

    // ── BT chips ──────────────────────────────────────────────────────────

    for (let li = 0; li < 4; li++) {
      const bwInset = (1 - Math.min(1.5, Math.max(0, this.btWidthScale))) / 8;
      const ln = li / 4 + bwInset, rn = (li + 1) / 4 - bwInset;
      for (const n of chart.bt[li]) {
        if (n.len !== 0) continue;
        const dt = this._effDt(n.y);
        if (dt < 0 || dt > VT) continue;
        const sy = this._screenY(dt, p);
        if (sy < p.cutoffY) continue; // cull above runway
        const hw = this._halfW(sy, p);
        const chipH = Math.max(4, hw * 0.08 * this.btWidthScale);
        const lx = this._screenX(ln + 0.01, sy, p);
        const rx = this._screenX(rn - 0.01, sy, p);
        ctx.fillStyle = '#e8e8ff';
        ctx.shadowColor = '#ffffffaa'; ctx.shadowBlur = hq ? 12 : 0;
        ctx.fillRect(lx, sy - chipH, rx - lx, chipH);
        ctx.shadowBlur = 0;
        // White top highlight
        ctx.fillStyle = '#ffffffcc';
        ctx.fillRect(lx, sy - chipH, rx - lx, 2);
      }
    }

    } // end if (!useGL) — notes block

    // ── Lasers — perspective-correct ribbon quads ─────────────────────────
    // When the WebGL renderer is active, lasers + slams are emitted into
    // the same vertex buffer as the lane runway and notes (Phase 3).
    if (!useGL) {

    for (let side = 0; side < 2; side++) {
      const mainCol = side === 0 ? laserColors.L  : laserColors.R;
      const edgeCol = side === 0 ? laserColors.Le : laserColors.Re;
      const glowCol = side === 0 ? laserColors.Lg : laserColors.Rg;
      // Laser ribbon half-width as fraction of lane half-width.
      // Sourced from the GameView static so the position/width pair stays in
      // sync: ribbon's outer edge lands on the BT lane boundary at v=0/v=1.
      const LASER_FRAC = GameView.LASER_HALF_FRAC; // 0.125 → one BT lane wide

      for (const sec of chart.lasers[side]) {
        if (!sec.points.length) continue;
        const secEnd = sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0);
        const _secEndEff   = this._effDt(secEnd);
        const _secStartEff = this._effDt(sec.y);
        if (_secEndEff < 0 || _secStartEff > VT) continue;

        // ── Build flat segment list (clamped to visible range) ───────────────
        // Bezier segments are pre-sampled into N micro-linear gSegs so that the
        // perspective projection correctly follows the curve in chart space.
        // The sampling uses the same parametric formulas as renderer.js:
        //   tick(t) = t0*(1-t)³ + tCtrl·3t(1-t) + t1·t³   [bezier in tick axis]
        //   v(t)    = v0·(1-t)²·(1+2t) + v1·t²·(3-2t)     [smoothstep in v]
        // where tCtrl = t0 + (t1-t0)*curve
        const BEZIER_STEPS = 10; // samples per bezier segment — smooth at all hispeeds
        const gSegs = [];
        for (let pi = 0; pi < sec.points.length - 1; pi++) {
          const p0 = sec.points[pi], p1 = sec.points[pi + 1];
          const t0 = sec.y + p0.ry, t1 = sec.y + p1.ry;
          const dt0g = this._effDt(t0), dt1g = this._effDt(t1);
          if (dt1g < 0 || dt0g > VT) continue;

          const isSlam = ChartData.isPointSlam(p0, p1);
          const interp = isSlam ? 'linear' : (p0.interp ?? 'linear');

          if (interp === 'bezier') {
            // ── Sample bezier into micro-linear gSegs ───────────────────────
            const curve  = p0.curve ?? 0.5;
            const tCtrl  = t0 + (t1 - t0) * curve;
            const bzTick = (t) => t0*(1-t)**3 + tCtrl*3*t*(1-t) + t1*t**3;
            const bzV    = (t) => p0.v*(1-t)**2*(1+2*t) + p1.v*t**2*(3-2*t);
            let prevDt = null, prevV = null;
            for (let si = 0; si <= BEZIER_STEPS; si++) {
              const t  = si / BEZIER_STEPS;
              const dt = this._effDt(bzTick(t));
              const v  = bzV(t);
              if (prevDt !== null) {
                const cDt0 = Math.max(prevDt, 0), cDt1 = Math.min(dt, VT);
                if (cDt0 <= cDt1) {
                  const span = dt - prevDt;
                  const r0   = span > 0 ? (cDt0 - prevDt) / span : 0;
                  const r1   = span > 0 ? (cDt1 - prevDt) / span : 1;
                  const mv0  = prevV + (v - prevV) * r0;
                  const mv1  = prevV + (v - prevV) * r1;
                  const sy0  = this._screenY(cDt0, p);
                  const sy1  = this._screenY(cDt1, p);
                  const hw0  = this._halfW(sy0, p) * LASER_FRAC * 2;
                  const hw1  = this._halfW(sy1, p) * LASER_FRAC * 2;
                  gSegs.push({ sy0, sy1,
                    cx0: this._laserX(mv0, sy0, p, sec.wide),
                    cx1: this._laserX(mv1, sy1, p, sec.wide),
                    hw0, hw1, v0: mv0, v1: mv1,
                    wide: sec.wide, isSlam: false });
                }
              }
              prevDt = dt; prevV = v;
            }
            continue;
          }

          // ── Linear / slam (existing path) ────────────────────────────────
          const cdt0 = Math.max(dt0g, 0), cdt1 = Math.min(dt1g, VT);
          const r0   = t1 === t0 ? 0 : (cdt0 - dt0g) / (dt1g - dt0g);
          const r1   = t1 === t0 ? 1 : (cdt1 - dt0g) / (dt1g - dt0g);
          const v0   = p0.v + (p1.v - p0.v) * r0;
          const v1   = p0.v + (p1.v - p0.v) * r1;
          const sy0  = this._screenY(cdt0, p);
          const sy1  = this._screenY(cdt1, p);
          const hw0  = this._halfW(sy0, p) * LASER_FRAC * 2;
          const hw1  = this._halfW(sy1, p) * LASER_FRAC * 2;
          const cx0  = this._laserX(v0, sy0, p, sec.wide);
          const cx1  = this._laserX(v1, sy1, p, sec.wide);
          // v0/v1/wide stored so slam rendering can reproject at any y level.
          gSegs.push({ sy0, sy1, cx0, cx1, hw0, hw1, v0, v1, wide: sec.wide,
                       isSlam });
        }
        if (!gSegs.length) continue;

        // ── Group into continuous runs (same logic as 2D renderer) ────────────
        const gRuns = [];
        let gRun = null;
        for (const seg of gSegs) {
          if (seg.isSlam) {
            if (gRun) { gRuns.push(gRun); gRun = null; }
            gRuns.push([seg]);
          } else {
            if (!gRun) gRun = [];
            gRun.push(seg);
          }
        }
        if (gRun) gRuns.push(gRun);

        // ── Render: one save/shadowBlur per section, one path per run ─────────
        ctx.save();
        ctx.globalAlpha = laserOpacity;
        ctx.shadowColor = glowCol;
        ctx.shadowBlur  = hq ? 14 : 0;

        for (const gr of gRuns) {
          if (gr[0].isSlam) {
            const s = gr[0];

            // ── Perspective-correct slam trapezoid ──────────────────────────
            // In the scrolling view the NOTE-START (p0, earlier in chart time)
            // arrives at the judgment line FIRST, so it maps to the LARGER y
            // (lower on screen).  We call this the "bottom" of the slam block.
            const syBot = Math.max(s.sy0, s.sy1); // closer to judgment (larger y)
            const syTop = Math.min(s.sy0, s.sy1); // further (smaller y)
            const vOld  = s.sy0 >= s.sy1 ? s.v0 : s.v1; // laser pos at bottom
            const vNew  = s.sy0 >= s.sy1 ? s.v1 : s.v0; // laser pos at top

            // Enforce a minimum visible height (SDVX style thick block)
            const hwMax = Math.max(s.hw0, s.hw1);
            const minH  = hwMax * 5.5;            // ~5× ribbon width, clearly visible
            const extraH = Math.max(0, minH - (syBot - syTop)) * 0.5;
            const sBot = syBot + extraH;           // actual rendered bottom edge
            const sTop = syTop - extraH;           // actual rendered top edge

            // Reproject both laser positions at both extended y levels so the
            // block edges respect the lane's 1/z perspective taper.
            const hwB = this._halfW(sBot, p) * LASER_FRAC * 2;
            const hwT = this._halfW(sTop, p) * LASER_FRAC * 2;
            const xB0 = this._laserX(vOld, sBot, p, s.wide);
            const xB1 = this._laserX(vNew, sBot, p, s.wide);
            const xT0 = this._laserX(vOld, sTop, p, s.wide);
            const xT1 = this._laserX(vNew, sTop, p, s.wide);
            const xLBot = Math.min(xB0, xB1) - hwB;
            const xRBot = Math.max(xB0, xB1) + hwB;
            const xLTop = Math.min(xT0, xT1) - hwT;
            const xRTop = Math.max(xT0, xT1) + hwT;

            // Gradient: full colour at the leading (bottom/judgment-facing) edge,
            // slightly dimmer at the top — matches SDVX's slam appearance.
            const grad = ctx.createLinearGradient(0, sTop, 0, sBot);
            grad.addColorStop(0,   mainCol + 'aa');
            grad.addColorStop(0.5, mainCol);
            grad.addColorStop(1,   mainCol);

            // Draw the trapezoid (4 corners, perspective-tapered)
            ctx.beginPath();
            ctx.moveTo(xLBot, sBot);
            ctx.lineTo(xRBot, sBot);
            ctx.lineTo(xRTop, sTop);
            ctx.lineTo(xLTop, sTop);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = edgeCol; ctx.lineWidth = 1.5; ctx.stroke();

            // Bright leading-edge glow line at the bottom (judgment-facing face)
            ctx.shadowBlur = hq ? 22 : 0;  // extra bloom on hit face
            ctx.beginPath();
            ctx.moveTo(xLBot + 2, sBot);
            ctx.lineTo(xRBot - 2, sBot);
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
            ctx.shadowBlur = hq ? 14 : 0;  // restore section shadow level
            continue;
          }
          ctx.beginPath();
          if (p.projMode === 'ortho' && gr.length > 1) {
            // Ortho: smooth bezier spline for continuous curves
            // Left edge — smooth through each data point
            ctx.moveTo(gr[0].cx0 - gr[0].hw0, gr[0].sy0);
            for (let i = 0; i < gr.length; i++) {
              const s = gr[i];
              if (i < gr.length - 1) {
                const ns = gr[i + 1];
                // quadratic bezier: control=current endpoint, end=midpoint to next
                const midX = ((s.cx1 - s.hw1) + (ns.cx0 - ns.hw0)) / 2;
                const midY = (s.sy1 + ns.sy0) / 2;
                ctx.quadraticCurveTo(s.cx1 - s.hw1, s.sy1, midX, midY);
              } else {
                ctx.lineTo(s.cx1 - s.hw1, s.sy1);
              }
            }
            // Right corner at top
            ctx.lineTo(gr[gr.length-1].cx1 + gr[gr.length-1].hw1, gr[gr.length-1].sy1);
            // Right edge back down — smooth
            for (let i = gr.length - 1; i >= 0; i--) {
              const s = gr[i];
              if (i > 0) {
                const ps = gr[i - 1];
                const midX = ((s.cx0 + s.hw0) + (ps.cx1 + ps.hw1)) / 2;
                const midY = (s.sy0 + ps.sy1) / 2;
                ctx.quadraticCurveTo(s.cx0 + s.hw0, s.sy0, midX, midY);
              } else {
                ctx.lineTo(s.cx0 + s.hw0, s.sy0);
              }
            }
            ctx.closePath();
          } else {
            // Perspective (sdvx/hybrid): straight-line ribbon segments
            ctx.moveTo(gr[0].cx0 - gr[0].hw0, gr[0].sy0);
            for (const s of gr) ctx.lineTo(s.cx1 - s.hw1, s.sy1);
            ctx.lineTo(gr[gr.length-1].cx1 + gr[gr.length-1].hw1, gr[gr.length-1].sy1);
            for (let i = gr.length - 1; i >= 0; i--) ctx.lineTo(gr[i].cx0 + gr[i].hw0, gr[i].sy0);
            ctx.closePath();
          }
          ctx.fillStyle = mainCol;
          ctx.fill();
          ctx.strokeStyle = edgeCol;
          ctx.lineWidth = Math.max(0.5, (gr[0].hw0 ?? gr[0].hw1) * 0.18);
          if (p.projMode === 'ortho') {
            ctx.strokeStyle = edgeCol;
            ctx.lineWidth = 1.5;
          }
          ctx.stroke();
        }

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
        // No anchor dots in the preview — edit handles are 2D-editor only

        // ── Tail-end cap at the last point of the section ─────────────────
        if (sec.points.length >= 2) {
          const lastPt = sec.points[sec.points.length - 1];
          const lastDt = this._effDt(sec.y + lastPt.ry);
          if (lastDt >= 0 && lastDt <= VT) {
            const lastSy = this._screenY(lastDt, p);
            if (lastSy > p.cutoffY) {
              const lastCx  = this._laserX(lastPt.v, lastSy, p, sec.wide);
              const lastHw  = this._halfW(lastSy, p) * LASER_FRAC * 2;
              ctx.save();
              ctx.globalAlpha = laserOpacity * 0.85;
              ctx.fillStyle   = mainCol;
              ctx.shadowColor = glowCol; ctx.shadowBlur = hq ? 6 : 0;
              ctx.fillRect(lastCx - lastHw * 1.6, lastSy - lastHw * 0.5, lastHw * 3.2, lastHw);
              ctx.shadowBlur = 0;
              ctx.globalAlpha = 1;
              ctx.restore();
            }
          }
        }
      }
    }

    } // end if (!useGL) — lasers block

    // ── Laser indicator bars at judgment line ─────────────────────────────

    // Laser position indicators at judgment line
    for (let side = 0; side < 2; side++) {
      const lp = this._getLaserPosAt(side, tick);
      if (lp === null) continue;
      // Pass `wide` so the indicator's X matches the ribbon's X for wide
      // laser sections — previously they desynced because _laserX defaulted
      // to non-wide.
      const sx = this._laserX(lp.v, p.judgeY, p, lp.wide);
      const col = side === 0 ? laserColors.L : laserColors.R;
      const hw  = this._halfW(p.judgeY, p) * 0.105 * 2;
      ctx.save();
      // Animated diamond cursor — no solid block overlay
      const cH = hw * 2.8, cW = hw * 0.85;
      // Subtle glow ring at contact point
      const ringGrad = ctx.createRadialGradient(sx, p.judgeY, 0, sx, p.judgeY, cW * 1.6);
      ringGrad.addColorStop(0,   col + 'cc');
      ringGrad.addColorStop(0.4, col + '66');
      ringGrad.addColorStop(1,   col + '00');
      ctx.fillStyle = ringGrad;
      ctx.fillRect(sx - cW * 1.6, p.judgeY - cW * 1.6, cW * 3.2, cW * 3.2);
      // Diamond cursor shape (pointed down toward judgment line)
      ctx.fillStyle   = col;
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth   = 1;
      ctx.shadowColor = col + 'dd'; ctx.shadowBlur = hq ? 18 : 6;
      ctx.beginPath();
      ctx.moveTo(sx,       p.judgeY - cH);       // apex (top)
      ctx.lineTo(sx + cW,  p.judgeY - cH * 0.4); // right wing
      ctx.lineTo(sx,       p.judgeY);             // tip (at judgment line)
      ctx.lineTo(sx - cW,  p.judgeY - cH * 0.4); // left wing
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // Sparkle particles — 7 small stars orbiting the laser contact point
      if (hq) {
        const sparkCount = 7;
        ctx.save();
        for (let si = 0; si < sparkCount; si++) {
          const phase = ((tick * 0.09) + si * (Math.PI * 2 / sparkCount)) % (Math.PI * 2);
          const radius  = hw * (1.8 + Math.sin(tick * 0.07 + si * 1.3) * 0.8);
          const px = sx + Math.cos(phase) * radius;
          const py = (p.judgeY - hw * 2) + Math.sin(phase * 0.6) * radius * 0.4;
          const alpha = Math.abs(Math.sin(tick * 0.13 + si)) * 0.75 + 0.15;
          const sz    = hw * 0.3;
          ctx.globalAlpha = alpha;
          ctx.fillStyle   = '#ffffff';
          ctx.shadowColor = col; ctx.shadowBlur = 5;
          ctx.beginPath();
          ctx.moveTo(px,             py - sz);
          ctx.lineTo(px + sz * 0.35, py - sz * 0.35);
          ctx.lineTo(px + sz,        py);
          ctx.lineTo(px + sz * 0.35, py + sz * 0.35);
          ctx.lineTo(px,             py + sz);
          ctx.lineTo(px - sz * 0.35, py + sz * 0.35);
          ctx.lineTo(px - sz,        py);
          ctx.lineTo(px - sz * 0.35, py - sz * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // L/R direction label
      if (typeof prefs === 'undefined' || prefs?.showLaserDir !== false) {
        ctx.save();
        ctx.font         = `bold ${Math.max(10, hw * 0.65)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle    = col;
        ctx.shadowColor  = col; ctx.shadowBlur = 10;
        ctx.fillText(side === 0 ? 'L' : 'R', sx, p.judgeY - hw * 3.5);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // ── Approaching laser warning indicators ──────────────────────────────
    // Show an animated L/R label below the judgment line at the x position
    // where an upcoming laser section will first appear.
    if (chart) {
      const WARN_TICKS = TICKS_PER_MEASURE * 2; // 2-measure lookahead
      const hw1 = this._halfW(p.judgeY, p);
      for (let side = 0; side < 2; side++) {
        const col = side === 0 ? laserColors.L : laserColors.R;
        // Find the nearest upcoming laser section that hasn't started yet
        let upcoming = null;
        for (const sec of chart.lasers[side]) {
          const dt = sec.y - tick;
          if (dt > 0 && dt <= WARN_TICKS) { upcoming = { dt, sec }; break; }
        }
        if (!upcoming) continue;

        const { dt, sec } = upcoming;
        // Proximity 0 → far away, 1 → laser is arriving now
        const prox  = 1 - dt / WARN_TICKS;
        // First point v-value → where on the judgment line the laser will appear
        const firstV = sec.points[0]?.v ?? (side === 0 ? 0 : 1);
        const sx = this._laserX(firstV, p.judgeY, p);

        // Pulse: fast breathing that speeds up as laser approaches
        const pulseSpeed = 0.06 + prox * 0.18;
        const pulse = (Math.sin(tick * pulseSpeed) * 0.5 + 0.5);
        const alpha = Math.max(0.15, prox * 0.7 + pulse * 0.3);

        // Size & bounce
        const baseSz = Math.max(11, hw1 * 0.15);
        const sz     = baseSz * (0.75 + prox * 0.45);
        const bounce = Math.sin(tick * (0.1 + prox * 0.12)) * (3 + prox * 5);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';

        // Arrow ▼ (drops toward the judgment line)
        ctx.font        = `bold ${sz * 0.9}px monospace`;
        ctx.fillStyle   = col;
        ctx.shadowColor = col; ctx.shadowBlur = hq ? Math.round(8 + prox * 14) : 0;
        ctx.fillText('▼', sx, p.judgeY + 28 + bounce);

        // L / R label below the arrow
        ctx.font        = `bold ${sz}px monospace`;
        ctx.fillStyle   = '#ffffff';
        ctx.shadowColor = col; ctx.shadowBlur = hq ? Math.round(6 + prox * 10) : 0;
        ctx.fillText(side === 0 ? 'L' : 'R', sx, p.judgeY + 28 + sz * 0.95 + bounce);

        ctx.shadowBlur  = 0;
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // ── Judgment line ─────────────────────────────────────────────────────

    // Judgment line spans the full track including VOL lanes
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
    ctx.shadowColor = '#ffffff88'; ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(this._screenX(-GameView.LASER_LANE_OFFSET, p.judgeY, p), p.judgeY);
    ctx.lineTo(this._screenX(1 + GameView.LASER_LANE_OFFSET, p.judgeY, p), p.judgeY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Drag handle — right-edge grip so user knows the line is movable
    if (this._judgeLineDragHint !== false) {
      const hx = p.w - 6;
      ctx.fillStyle    = '#ffffff55';
      ctx.strokeStyle  = '#ffffff99';
      ctx.lineWidth    = 1;
      // three horizontal tick marks
      for (let i = -1; i <= 1; i++) {
        const hy = p.judgeY + i * 4;
        ctx.beginPath(); ctx.moveTo(hx - 7, hy); ctx.lineTo(hx, hy); ctx.stroke();
      }
    }

    // ── BT button indicators at judgment line ──────────────────────────────

    for (let li = 0; li < 4; li++) {
      const bwInset = (1 - Math.min(1.5, Math.max(0, this.btWidthScale))) / 8;
      const ln = li / 4 + bwInset, rn = (li + 1) / 4 - bwInset;
      const lx = this._screenX(ln + 0.005, p.judgeY, p) + 1;
      const rx = this._screenX(rn - 0.005, p.judgeY, p) - 1;
      const w2 = rx - lx;
      // Active: hold note covers this tick, OR chip note is within a quarter-beat window
      const CHIP_WINDOW = TICKS_PER_BEAT / 4;
      const active = chart.bt[li].some(n =>
        (n.len > 0 && n.y <= tick && n.y + n.len >= tick) ||
        (n.len === 0 && Math.abs(n.y - tick) < CHIP_WINDOW)
      );

      // Button bg
      const bg = ctx.createLinearGradient(lx, p.judgeY, lx, p.judgeY + 22);
      bg.addColorStop(0, active ? '#c0c0ff' : '#242450');
      bg.addColorStop(1, active ? '#8080cc' : '#12122a');
      ctx.fillStyle   = bg;
      ctx.strokeStyle = active ? '#ffffff' : '#6060a0';
      ctx.lineWidth   = 1;
      ctx.fillRect(lx, p.judgeY, w2, 22);
      ctx.strokeRect(lx, p.judgeY, w2, 22);

      // Label
      ctx.fillStyle   = active ? '#ffffff' : '#8888aa';
      ctx.font        = 'bold 10px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(['A','B','C','D'][li], lx + w2 / 2, p.judgeY + 11);
    }

    // ── FX button indicators ───────────────────────────────────────────────

    for (let li = 0; li < 2; li++) {
      const ln = li * 0.5, rn = (li + 1) * 0.5;
      const lx = this._screenX(ln + 0.01, p.judgeY + 24, p) + 2;
      const rx = this._screenX(rn - 0.01, p.judgeY + 24, p) - 2;
      const w2 = rx - lx;
      const active = chart.fx[li].some(n => n.len > 0 && n.y <= tick && n.y + n.len >= tick);

      ctx.fillStyle   = active ? '#ffaa00' : '#2a1400';
      ctx.strokeStyle = active ? '#ffcc44' : '#7a4000';
      ctx.lineWidth   = 1;
      ctx.fillRect(lx, p.judgeY + 24, w2, 16);
      ctx.strokeRect(lx, p.judgeY + 24, w2, 16);
      if (active) {
        ctx.shadowColor = '#ffaa00aa'; ctx.shadowBlur = 10;
        ctx.fillRect(lx, p.judgeY + 24, w2, 16);
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = active ? '#fff' : '#cc6600';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(['L','R'][li], lx + w2 / 2, p.judgeY + 32);
    }

    // Edit-mode ghost cursor (rendered inside tilt context so it aligns with the lane)
    if (this._editGhost) this._drawEditGhost(p);

    // Close the tilt rotation context (HUD is always drawn unrotated)
    if (p.tilt) ctx.restore();

    if (window.prefs?.ghostTrace) this._drawGhostTrace(p, tick, chart);
    this._drawHUD(p, tick, score, chain);
  }

  // ── Edit-mode ghost cursor ────────────────────────────────────────────────
  _drawEditGhost(p) {
    const g = this._editGhost;
    if (!g) return;
    const { ctx } = this;
    const dt = g.tick - this.playTick;
    if (dt < 0 || dt > this.VISIBLE_TICKS * 1.05) return;
    const sy = this._screenY(dt, p);
    if (sy < p.vanishY - 4 || sy > p.judgeY + 4) return;
    const hw   = this._halfW(sy, p);
    const laneW = hw * 2;

    ctx.save();
    ctx.globalAlpha = 0.55;

    if (g.tool === 'bt') {
      const li = Math.min(3, Math.max(0, Math.floor(g.norm * 4)));
      const nw = laneW / 4 * (this.btWidthScale || 1);
      const lx = p.cx - hw + li * (laneW / 4);
      const nh = Math.max(6, laneW / 20);
      ctx.fillStyle   = '#e0e0ff';
      ctx.strokeStyle = '#8888ff';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.roundRect(lx + 2, sy - nh / 2, nw - 4, nh, 2);
      ctx.fill(); ctx.stroke();
    } else if (g.tool === 'fx') {
      const fi = g.norm < 0.5 ? 0 : 1;
      const nw = laneW / 2;
      const lx = p.cx - hw + fi * nw;
      const nh = Math.max(6, laneW / 20);
      ctx.fillStyle   = '#ffcc00bb';
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.roundRect(lx + 2, sy - nh / 2, nw - 4, nh, 2);
      ctx.fill(); ctx.stroke();
    } else if (g.tool === 'laser-l' || g.tool === 'laser-r') {
      const side = g.tool === 'laser-l' ? 0 : 1;
      const v  = Math.max(0, Math.min(1, g.norm));
      const lx = this._laserX(v, sy, p, this.chart?.laserSettings?.wide ?? false);
      const r  = Math.max(5, laneW / 18);
      ctx.beginPath();
      ctx.arc(lx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle   = side === 0 ? '#0088ffaa' : '#ff1177aa';
      ctx.strokeStyle = side === 0 ? '#66bbff'   : '#ff88cc';
      ctx.lineWidth   = 2;
      ctx.fill(); ctx.stroke();
    } else if (g.tool === 'erase') {
      const li = Math.min(3, Math.max(0, Math.floor(g.norm * 4)));
      const cx = p.cx - hw + (li + 0.5) * (laneW / 4);
      const r  = Math.max(6, laneW / 18);
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.7, sy - r * 0.7); ctx.lineTo(cx + r * 0.7, sy + r * 0.7);
      ctx.moveTo(cx + r * 0.7, sy - r * 0.7); ctx.lineTo(cx - r * 0.7, sy + r * 0.7);
      ctx.stroke();
    }

    // Snap-line across the lane at the ghost tick
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 0.75;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(p.cx - hw, sy); ctx.lineTo(p.cx + hw, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Hit flash surface glow ────────────────────────────────────────────────
  // Drawn BEFORE notes, using additive blending so it looks like light emitted
  // from the lane surface rather than a floating overlay.
  // Shape follows lane perspective exactly (same _screenX/_screenY as notes).

  _drawHitFlashes(p, tick, chart) {
    const { ctx }       = this;
    const FLASH_TICKS   = TICKS_PER_BEAT / 5;  // chip flash duration in ticks
    const BEACON_DT     = TICKS_PER_BEAT * 2.5; // how far up the runway the glow reaches

    ctx.save();
    // Additive blend — colour is ADDED to whatever is beneath, exactly like
    // real light hitting a surface.  This prevents any "floating box" look.
    ctx.globalCompositeOperation = 'lighter';

    // ── Helper: draw one perspective-correct lane glow ───────────────────
    // Uses multiple thin trapezoid slices to build a smooth linear gradient
    // running along the lane surface toward the vanishing point.
    const drawGlow = (ln, rn, inL, inR, alpha, r, g, b) => {
      if (alpha < 0.02) return;
      const STEPS    = 10;
      const beaconDt = BEACON_DT * alpha;  // glow shrinks as flash fades

      for (let si = 0; si < STEPS; si++) {
        const t0  = si        / STEPS; // 0=judgment line, 1=top of glow
        const t1  = (si + 1)  / STEPS;
        const sy0 = this._screenY(beaconDt * t0, p);
        const sy1 = this._screenY(beaconDt * t1, p);
        // Each slice only spans one step — skip if it would go above cutoff
        if (sy1 < p.cutoffY) break;

        // Opacity falls off toward the vanishing point (quadratic)
        const a0 = alpha * (1 - t0) * (1 - t0);
        const a1 = alpha * (1 - t1) * (1 - t1);
        if (a0 < 0.005 && a1 < 0.005) continue;

        const lx0 = this._screenX(ln + inL, sy0, p);
        const rx0 = this._screenX(rn - inR, sy0, p);
        const lx1 = this._screenX(ln + inL, sy1, p);
        const rx1 = this._screenX(rn - inR, sy1, p);

        // Per-slice solid colour at the average alpha of the two edges
        // (createLinearGradient per-slice would be expensive; single rgba is fine)
        const a = (a0 + a1) * 0.5;
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(lx0, sy0); ctx.lineTo(rx0, sy0);
        ctx.lineTo(rx1, sy1); ctx.lineTo(lx1, sy1);
        ctx.closePath();
        ctx.fill();
      }
    };

    // ── BT lanes (white/blue) ─────────────────────────────────────────────
    for (let li = 0; li < 4; li++) {
      const bwInset = (1 - Math.min(1.5, Math.max(0, this.btWidthScale))) / 8;
      const ln = li / 4 + bwInset, rn = (li + 1) / 4 - bwInset;
      let alpha = 0;

      for (const n of chart.bt[li]) {
        if (n.len === 0) {
          const age = tick - n.y;
          if (age >= 0 && age < FLASH_TICKS)
            alpha = Math.max(alpha, 1 - age / FLASH_TICKS);
        } else if (n.y <= tick && tick <= n.y + n.len) {
          const burst = Math.max(0, 1 - (tick - n.y) / FLASH_TICKS);
          alpha = Math.max(alpha, 0.38 + 0.32 * burst);
        }
      }

      // Two passes: wider dim base + tighter bright core
      drawGlow(ln, rn, 0,     0,     alpha * 0.5, 100, 130, 255);
      drawGlow(ln, rn, 0.008, 0.008, alpha,        200, 215, 255);
    }

    // ── FX lanes (orange/amber) ───────────────────────────────────────────
    for (let li = 0; li < 2; li++) {
      const ln = li * 0.5, rn = (li + 1) * 0.5;
      let alpha = 0;

      for (const n of chart.fx[li]) {
        if (n.len === 0) {
          const age = tick - n.y;
          if (age >= 0 && age < FLASH_TICKS)
            alpha = Math.max(alpha, 1 - age / FLASH_TICKS);
        } else if (n.y <= tick && tick <= n.y + n.len) {
          const burst = Math.max(0, 1 - (tick - n.y) / FLASH_TICKS);
          alpha = Math.max(alpha, 0.42 + 0.38 * burst);
        }
      }

      drawGlow(ln, rn, 0,     0,     alpha * 0.45, 200, 80,  0);
      drawGlow(ln, rn, 0.012, 0.012, alpha,         255, 160, 20);
    }

    // ── Slam flashes (laser-cursor burst at judgment line) ────────────────
    // A slam triggers a bright horizontal burst that expands then fades.
    if (this._slamFlashes.length) {
      const now    = performance.now();
      const laserC = { L: '#00aaff', R: '#ff0044' };
      const laserR = { L: [0, 180, 255], R: [255, 30, 80] };
      const kept   = [];

      for (const f of this._slamFlashes) {
        const age = now - f.time;              // ms since slam
        if (age > 200) continue;              // expired
        kept.push(f);

        const t    = age / 200;              // 0 (fresh) → 1 (gone)
        const alpha = (1 - t) * (1 - t);    // quadratic fade

        const xA = this._laserX(Math.min(f.v0, f.v1), p.judgeY, p, f.wide);
        const xB = this._laserX(Math.max(f.v0, f.v1), p.judgeY, p, f.wide);
        const span = Math.abs(xB - xA);
        const x0 = Math.min(xA, xB);

        const [r, g, b] = laserR[f.side === 0 ? 'L' : 'R'];

        // Horizontal burst bar centred on the judgment line
        const flashH = 12 + (1 - t) * 18; // shrinks as it ages
        const grad = ctx.createLinearGradient(x0, 0, x0 + span, 0);
        grad.addColorStop(0,   `rgba(${r},${g},${b},0)`);
        grad.addColorStop(0.15, `rgba(${r},${g},${b},${(alpha * 0.9).toFixed(3)})`);
        grad.addColorStop(0.5,  `rgba(${r},${g},${b},${(alpha      ).toFixed(3)})`);
        grad.addColorStop(0.85, `rgba(${r},${g},${b},${(alpha * 0.9).toFixed(3)})`);
        grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x0 - 6, p.judgeY - flashH, span + 12, flashH + 6);

        // Bright leading edge line at the judgment face of the slam
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle   = `rgba(255,255,255,${(alpha * 0.6).toFixed(3)})`;
        ctx.fillRect(x0 - 2, p.judgeY - 3, span + 4, 3);
        ctx.globalAlpha = 1;
      }

      this._slamFlashes = kept;
    }

    ctx.restore();
  }

  // ── Per-chart laser position query ───────────────────────────────────────
  // Uses this.chart so each GameView instance reads its own chart's lasers,
  // rather than the global getLaserPosAt which always reads the active tab.
  // Returns { v, wide } of the laser at `tick` for `side`, or null if no
  // section is active. `wide` flag is needed so callers can pass it to
  // _laserX() — wide sections use a different v→X mapping.
  _getLaserPosAt(side, tick) {
    if (!this.chart) return null;
    for (const sec of this.chart.lasers[side]) {
      if (tick < sec.y) continue;
      const pts = sec.points;
      for (let pi = 0; pi < pts.length - 1; pi++) {
        const t0 = sec.y + pts[pi].ry, t1 = sec.y + pts[pi + 1].ry;
        if (tick >= t0 && tick <= t1) {
          const ratio = t1 === t0 ? 0 : (tick - t0) / (t1 - t0);
          return {
            v: pts[pi].v + (pts[pi + 1].v - pts[pi].v) * ratio,
            wide: !!sec.wide,
          };
        }
      }
      const last = pts[pts.length - 1];
      if (last && sec.y + last.ry >= tick) {
        return { v: last.v, wide: !!sec.wide };
      }
    }
    return null;
  }

  // ── Slam flash API ────────────────────────────────────────────────────────
  // Called from app.js detectSlams() each time a laser slam crosses the
  // play-head.  The flash persists for ~200 ms then fades automatically.

  addSlamFlash(side, v0, v1, wide = false) {
    const now = performance.now();
    this._slamFlashes.push({ side, v0, v1, wide, time: now });
    // Prune any older than 220 ms
    this._slamFlashes = this._slamFlashes.filter(f => now - f.time < 220);
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  _drawHUD(p, tick, score, chain) {
    const { ctx } = this;

    // ── Score (top right) ─────────────────────────────────────────────────
    const scoreStr = String(score).padStart(8, '0');
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.font         = 'bold 30px monospace';
    ctx.shadowColor  = '#00000088'; ctx.shadowBlur = 6;
    ctx.fillStyle    = '#ffffff';
    ctx.fillText(scoreStr, p.w - 14, 14);
    ctx.shadowBlur   = 0;

    // Grade
    const { g, col } = this._grade(score);
    ctx.font      = 'bold 16px monospace';
    ctx.fillStyle = col;
    ctx.shadowColor = col + '88'; ctx.shadowBlur = 8;
    ctx.fillText(g, p.w - 14, 50);
    ctx.shadowBlur = 0;

    // ── Chain (bottom center) ─────────────────────────────────────────────
    const jb = p.judgeY + 50;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font         = 'bold 38px monospace';
    ctx.fillStyle    = '#ffffff';
    ctx.shadowColor  = '#ffffff44'; ctx.shadowBlur = 12;
    ctx.fillText(String(chain).padStart(4, '0'), p.cx, jb);
    ctx.shadowBlur   = 0;
    ctx.font         = 'bold 11px monospace';
    ctx.fillStyle    = '#7799ff';
    ctx.fillText('CHAIN', p.cx, jb + 16);

    // ── BPM & measure (top left) ──────────────────────────────────────────
    const bpm     = this.chart?.getBpmAt(Math.floor(tick)) ?? 120;
    const measure = Math.floor(tick / TICKS_PER_MEASURE) + 1;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffdd44';
    ctx.font      = 'bold 13px monospace';
    ctx.fillText(`BPM ${bpm.toFixed(1)}`, 14, 18);
    ctx.fillStyle = '#8899cc';
    ctx.font      = '11px monospace';
    ctx.fillText(`M ${measure}`, 14, 36);

    // ── Song title / artist (top center) ─────────────────────────────────
    const title  = this.chart?.meta.title  || '';
    const artist = this.chart?.meta.artist || '';
    if (title) {
      ctx.textAlign    = 'center';
      ctx.fillStyle    = '#d8d8f0';
      ctx.font         = '13px sans-serif';
      ctx.shadowColor  = '#00000099'; ctx.shadowBlur = 4;
      ctx.fillText(title, p.cx, 18);
      ctx.shadowBlur   = 0;
    }
    if (artist) {
      ctx.fillStyle = '#8888b0';
      ctx.font      = '11px sans-serif';
      ctx.fillText(artist, p.cx, 34);
    }

    // ── Difficulty / Level (top left, below BPM) ──────────────────────────
    const diff   = this.chart?.meta.difficulty || '';
    const level  = this.chart?.meta.level ?? '';
    if (diff) {
      const diffCol = { light:'#44cc44', challenge:'#ffee00', extended:'#ff6600', infinite:'#cc00cc' }[diff] || '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillStyle = diffCol;
      ctx.font      = 'bold 11px monospace';
      ctx.fillText(`${diff.toUpperCase()} Lv.${level}`, 14, 54);
    }
  }

  /* ── Annotation overlay: warning bands for tool-flagged issues ─────────────
     Draws approaching warning stripes in the game view lane whenever an
     annotation from Hand Optimizer or Validity Checker is within the runway.
     annotations : [{ tick, label, severity, source, createdAt }]
     alphaFn     : function(ann) → 0..1
  ─────────────────────────────────────────────────────────────────────────── */
  drawAnnotations(annotations, alphaFn) {
    if (!annotations || !annotations.length) return;
    const ctx  = this.ctx;
    const p    = this._params();
    const tick = this.playTick;
    const VT   = this.VISIBLE_TICKS;
    const now  = Date.now();

    annotations.forEach(ann => {
      const dt = this._effDt(ann.tick);     // ticks ahead of playhead (velocity-aware)
      if (dt < -TICKS_PER_BEAT || dt > VT) return;   // outside runway

      const alpha  = alphaFn ? alphaFn(ann) : 1;
      if (alpha <= 0) return;

      const isError = ann.severity === 'error';
      const color   = isError ? '#ff3355' : '#ffcc00';

      // Screen Y of the annotation's tick
      const sy = dt >= 0 ? this._screenY(dt, p)
                         : p.judgeY + (-dt / TICKS_PER_BEAT) * 8; // just below judge
      if (sy < p.cutoffY || sy > p.judgeY + 30) return;

      // Lane extents at this Y (respects perspective)
      const lx = this._screenX(0, Math.min(sy, p.judgeY), p);
      const rx = this._screenX(1, Math.min(sy, p.judgeY), p);

      // ── Proximity factor: brighter as note approaches ──────────────────
      const prox    = dt >= 0 ? 1 - dt / VT : 1;  // 0 far, 1 at judge
      const pulse   = 0.5 + 0.5 * Math.sin(now / 180 + ann.tick);
      const bAlpha  = alpha * (0.15 + prox * 0.45) * (0.7 + 0.3 * pulse);

      ctx.save();

      // Apply tilt so the band follows the lane
      if (p.tilt) {
        ctx.translate(p.cx, p.judgeY);
        ctx.rotate(p.tilt);
        ctx.translate(-p.cx, -p.judgeY);
      }

      // ── Warning stripe across the lane ──────────────────────────────────
      const stripeH = Math.max(3, 6 * prox);
      ctx.globalAlpha = bAlpha;
      ctx.fillStyle   = color;
      ctx.fillRect(lx, sy - stripeH / 2, rx - lx, stripeH);

      // ── Side icons (left + right of lane) ───────────────────────────────
      const iconAlpha = alpha * (0.6 + 0.4 * pulse) * Math.min(1, prox * 3);
      ctx.globalAlpha = iconAlpha;
      const icon = isError ? '⛔' : '⚠';
      ctx.font         = `${Math.round(10 + prox * 6)}px monospace`;
      ctx.textBaseline = 'middle';

      // Left icon
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.fillText(icon, lx - 4, sy);

      // Right icon
      ctx.textAlign = 'left';
      ctx.fillText(icon, rx + 4, sy);

      // ── Label (only when close, > 70% of way to judge) ──────────────────
      if (prox > 0.7 && ann.label) {
        ctx.globalAlpha  = alpha * (prox - 0.7) / 0.3;
        ctx.font         = '9px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle    = color;
        const labelTxt   = (ann.label || '').slice(0, 30);
        // backdrop
        const lw = ctx.measureText(labelTxt).width + 8;
        ctx.globalAlpha = alpha * (prox - 0.7) / 0.3 * 0.5;
        ctx.fillStyle   = '#000000';
        ctx.fillRect(p.cx - lw / 2, sy - stripeH / 2 - 14, lw, 12);
        ctx.globalAlpha = alpha * (prox - 0.7) / 0.3;
        ctx.fillStyle   = color;
        ctx.fillText(labelTxt, p.cx, sy - stripeH / 2 - 2);
      }

      ctx.restore();
    });
  }

  // ── Ghost Playback Tracing (Feature 6) ───────────────────────────────────
  _drawGhostTrace(p, tick, chart) {
    if (!window.prefs?.ghostTrace) return;
    const ctx = this.ctx;
    const FUTURE = 96; // ticks ahead to trace

    // Determine left-hand and right-hand x positions over next FUTURE ticks
    const leftLane  = [0, 1];  // BT-A, BT-B indices
    const rightLane = [2, 3];  // BT-C, BT-D indices

    const getHandX = (laneIndices, t) => {
      let xs = [];
      laneIndices.forEach(li => {
        chart.bt[li].forEach(n => {
          if (n.y <= t && n.y + Math.max(n.len, 1) > t) {
            const norm = (li + 0.5) / 4;
            const sy = this._screenY(n.y - t, p);
            xs.push(this._screenX(norm, sy, p));
          }
        });
      });
      // Also check FX
      const fxLi = laneIndices[0] < 2 ? 0 : 1;
      chart.fx[fxLi].forEach(n => {
        if (n.y <= t && n.y + Math.max(n.len, 1) > t) {
          const norm = fxLi === 0 ? 0.25 : 0.75;
          const sy = this._screenY(n.y - t, p);
          xs.push(this._screenX(norm, sy, p));
        }
      });
      // Laser
      const laserSide = laneIndices[0] < 2 ? 0 : 1;
      const lv = window.getLaserPosAt ? window.getLaserPosAt(laserSide, t) : null;
      if (lv !== null) {
        const sy = this._screenY(0, p);
        xs.push(this._laserX(lv, sy, p, chart.laserSettings?.wide));
      }
      return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };

    // Draw trace for each hand
    const drawTrace = (laneIndices, color) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      let started = false;
      for (let dt = 0; dt <= FUTURE; dt += 6) {
        const t = tick + dt;
        const x = getHandX(laneIndices, t);
        if (x === null) { started = false; continue; }
        const sy = this._screenY(dt, p);
        if (!started) { ctx.moveTo(x, sy); started = true; }
        else ctx.lineTo(x, sy);
      }
      ctx.stroke();
      ctx.restore();
    };

    drawTrace(leftLane,  'rgba(100,160,255,0.8)');
    drawTrace(rightLane, 'rgba(255,100,220,0.8)');
  }
}
