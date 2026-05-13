'use strict';

// ── Phase 1 WebGL2 lane renderer ────────────────────────────────────────────
// Renders ONLY the lane runway: background gradient, BT/FX + VOL trapezoid
// panels, side glow, beat/measure grid, vertical lane dividers, and the
// outer VOL boundary lines.
//
// Everything else (notes, lasers, slams, hit flashes, HUD) still runs on the
// 2D overlay canvas in game.js. The 2D canvas sits on top of this one with
// a transparent clear so the two layers composite naturally.
//
// All coordinates are in screen pixels (matching game.js _params() output).
// The vertex shader converts to clip space using u_resolution.
//
// On Phase 2 (notes) and Phase 3 (lasers) we'll add more shader programs
// next to the one here without touching this module's API.

class GLLaneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) { this.gl = null; this.ok = false; return; }
    this.gl = gl;
    this.ok = false;

    try {
      this._compile();
      this._buffers();
      this.ok = true;
    } catch (err) {
      console.warn('[GLLaneRenderer] init failed:', err);
      this.ok = false;
    }
  }

  // ── Shader compile ─────────────────────────────────────────────────────
  _compile() {
    const gl = this.gl;
    const vs = `#version 300 es
      precision highp float;
      in vec2 a_pos;
      in vec4 a_col;
      uniform vec2 u_res;
      out vec4 v_col;
      void main() {
        vec2 clip = vec2(
          (a_pos.x / u_res.x) * 2.0 - 1.0,
          1.0 - (a_pos.y / u_res.y) * 2.0
        );
        gl_Position = vec4(clip, 0.0, 1.0);
        v_col = a_col;
      }`;
    const fs = `#version 300 es
      precision highp float;
      in vec4 v_col;
      out vec4 outColor;
      void main() { outColor = v_col; }`;

    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('shader compile: ' + log);
      }
      return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, make(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, make(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('program link: ' + gl.getProgramInfoLog(prog));
    }
    this.prog    = prog;
    this.locPos  = gl.getAttribLocation(prog, 'a_pos');
    this.locCol  = gl.getAttribLocation(prog, 'a_col');
    this.locRes  = gl.getUniformLocation(prog, 'u_res');
  }

  _buffers() {
    const gl = this.gl;
    // One reusable buffer + VAO. We rewrite its contents each frame.
    // Pre-sized for ~4k vertices (more than enough for the lane stuff).
    this.vbo = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 4096 * 6 * 4, gl.DYNAMIC_DRAW);
    const stride = 6 * 4; // 6 floats per vertex (x, y, r, g, b, a) * 4 bytes
    gl.enableVertexAttribArray(this.locPos);
    gl.vertexAttribPointer(this.locPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.locCol);
    gl.vertexAttribPointer(this.locCol, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.bindVertexArray(null);

    // Scratch CPU buffer. Grows as needed.
    this._cpu = new Float32Array(4096 * 6);
    this._n   = 0;
  }

  // ── Sizing ─────────────────────────────────────────────────────────────
  resize(w, h) {
    if (!this.ok) return;
    this.canvas.width  = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  // ── Vertex emit helpers ────────────────────────────────────────────────
  _ensureCap(extraVerts) {
    const need = (this._n + extraVerts) * 6;
    if (need > this._cpu.length) {
      const grown = new Float32Array(Math.max(need, this._cpu.length * 2));
      grown.set(this._cpu);
      this._cpu = grown;
    }
  }
  _vert(x, y, r, g, b, a) {
    const i = this._n * 6;
    this._cpu[i  ] = x; this._cpu[i+1] = y;
    this._cpu[i+2] = r; this._cpu[i+3] = g;
    this._cpu[i+4] = b; this._cpu[i+5] = a;
    this._n++;
  }
  // Two-triangle quad with per-corner color. Corners in order TL, TR, BR, BL.
  _quad(x0, y0, x1, y1, x2, y2, x3, y3, c0, c1, c2, c3) {
    this._ensureCap(6);
    this._vert(x0, y0, c0[0], c0[1], c0[2], c0[3]);
    this._vert(x1, y1, c1[0], c1[1], c1[2], c1[3]);
    this._vert(x2, y2, c2[0], c2[1], c2[2], c2[3]);
    this._vert(x0, y0, c0[0], c0[1], c0[2], c0[3]);
    this._vert(x2, y2, c2[0], c2[1], c2[2], c2[3]);
    this._vert(x3, y3, c3[0], c3[1], c3[2], c3[3]);
  }
  // Thin line as a triangle strip (2 tris). Width in pixels.
  _line(x0, y0, x1, y1, w, col) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * (w * 0.5);
    const ny =  dx / len * (w * 0.5);
    this._quad(
      x0 + nx, y0 + ny,
      x1 + nx, y1 + ny,
      x1 - nx, y1 - ny,
      x0 - nx, y0 - ny,
      col, col, col, col
    );
  }

  // ── Tilt rotation (matches ctx.rotate around (cx, judgeY)) ─────────────
  _rotXform(p) {
    if (!p.tilt) return null;
    const s = Math.sin(p.tilt), c = Math.cos(p.tilt);
    const cx = p.cx, cy = p.judgeY;
    return (x, y) => {
      const dx = x - cx, dy = y - cy;
      return [cx + dx * c - dy * s, cy + dx * s + dy * c];
    };
  }

  // ── Main render ────────────────────────────────────────────────────────
  // `params` is the same object returned by GameView._params().
  // `gv` is the GameView instance (for _screenX / _screenY / _laserX / _halfW).
  // `chart` is optional — when present, BT chips/holds and FX chips/holds are
  // emitted into the same vertex buffer as the lane and submitted in a
  // single draw call (Phase 2).
  render(params, gv, laserColors, chart) {
    if (!this.ok) return;
    const gl = this.gl;
    this._n = 0;
    const p = params;
    const xf = this._rotXform(p);
    const T = xf ? ((x, y) => xf(x, y)) : ((x, y) => [x, y]);
    this._T = T;

    // ── 1. Full-screen background gradient (matches 2D draw) ───────────
    // NOT rotated — the 2D version doesn't rotate the background either.
    const TOP    = [0.008, 0.012, 0.031, 1];  // #020308
    const MIDDLE = [0.020, 0.020, 0.082, 1];  // #050515
    const BOT    = [0.031, 0.000, 0.102, 1];  // #08001a
    const w = p.w, h = p.h, midY = h * 0.4;
    // top half: TOP → MIDDLE
    this._quad(0, 0,    w, 0,    w, midY, 0, midY, TOP, TOP, MIDDLE, MIDDLE);
    // bottom half: MIDDLE → BOT
    this._quad(0, midY, w, midY, w, h,    0, h,    MIDDLE, MIDDLE, BOT, BOT);

    // ── 2. Trapezoid coordinates (rotated if tilt) ─────────────────────
    const OFF = (typeof GameView !== 'undefined' && GameView.LASER_LANE_OFFSET)
              || 0.135;
    const lx0  = gv._screenX(0,    p.cutoffY, p);
    const rx0  = gv._screenX(1,    p.cutoffY, p);
    const lx1  = gv._screenX(0,    p.judgeY,  p);
    const rx1  = gv._screenX(1,    p.judgeY,  p);
    const vlx0 = gv._screenX(-OFF, p.cutoffY, p);
    const vrx0 = gv._screenX(1+OFF, p.cutoffY, p);
    const vlx1 = gv._screenX(-OFF, p.judgeY,  p);
    const vrx1 = gv._screenX(1+OFF, p.judgeY,  p);

    const cTop = p.cutoffY, cBot = p.judgeY;
    const VOL_TOP = [0.012, 0.012, 0.071, 1]; // #030312
    const VOL_BOT = [0.031, 0.031, 0.125, 1]; // #080820

    // Left VOL panel (TL=vlx0,cTop; TR=lx0,cTop; BR=lx1,cBot; BL=vlx1,cBot)
    {
      const [a0,a1] = T(vlx0, cTop), [b0,b1] = T(lx0, cTop);
      const [c0,c1] = T(lx1,  cBot), [d0,d1] = T(vlx1, cBot);
      this._quad(a0,a1, b0,b1, c0,c1, d0,d1, VOL_TOP, VOL_TOP, VOL_BOT, VOL_BOT);
    }
    // Right VOL panel
    {
      const [a0,a1] = T(rx0,  cTop), [b0,b1] = T(vrx0, cTop);
      const [c0,c1] = T(vrx1, cBot), [d0,d1] = T(rx1,  cBot);
      this._quad(a0,a1, b0,b1, c0,c1, d0,d1, VOL_TOP, VOL_TOP, VOL_BOT, VOL_BOT);
    }
    // BT/FX main lane: 3-stop gradient via two stacked quads (mid at 60%)
    const LANE_TOP = [0.024, 0.024, 0.094, 1]; // #060618
    const LANE_MID = [0.051, 0.051, 0.157, 1]; // #0d0d28
    const LANE_BOT = [0.071, 0.075, 0.227, 1]; // #12133a
    const midT = cTop + (cBot - cTop) * 0.6;
    {
      const [a0,a1] = T(lx0, cTop);
      const [b0,b1] = T(rx0, cTop);
      // points on the lane edges at the mid Y
      const midL = gv._screenX(0, midT, p), midR = gv._screenX(1, midT, p);
      const [c0,c1] = T(midR, midT), [d0,d1] = T(midL, midT);
      this._quad(a0,a1, b0,b1, c0,c1, d0,d1, LANE_TOP, LANE_TOP, LANE_MID, LANE_MID);
      const [e0,e1] = T(midL, midT), [f0,f1] = T(midR, midT);
      const [g0,g1] = T(rx1,  cBot), [h0,h1] = T(lx1,  cBot);
      this._quad(e0,e1, f0,f1, g0,g1, h0,h1, LANE_MID, LANE_MID, LANE_BOT, LANE_BOT);
    }

    // ── 3. VOL outer boundary lines ────────────────────────────────────
    const BOUND = [0.165, 0.165, 0.333, 1]; // #2a2a55
    {
      const [a0,a1] = T(vlx0, cTop), [b0,b1] = T(vlx1, cBot);
      this._line(a0, a1, b0, b1, 1, BOUND);
      const [c0,c1] = T(vrx0, cTop), [d0,d1] = T(vrx1, cBot);
      this._line(c0, c1, d0, d1, 1, BOUND);
    }

    // ── 4. Side glow (gradient rectangles outside the lane) ────────────
    // Decompose hex #XXXXXX33 colors into rgba.
    const parseHex = hex => {
      const h = hex.replace('#','');
      const n = h.length === 8 ? h : h + 'ff';
      return [
        parseInt(n.slice(0,2), 16) / 255,
        parseInt(n.slice(2,4), 16) / 255,
        parseInt(n.slice(4,6), 16) / 255,
        parseInt(n.slice(6,8), 16) / 255,
      ];
    };
    const lcL = parseHex((laserColors?.L || '#1244ee') + '33');
    const lcR = parseHex((laserColors?.R || '#dd00cc') + '33');
    const lcLZero = [lcL[0], lcL[1], lcL[2], 0];
    const lcRZero = [lcR[0], lcR[1], lcR[2], 0];

    const volLeft  = gv._laserX(0, p.judgeY, p);
    const volRight = gv._laserX(1, p.judgeY, p);
    // Left glow: from vlx1 inward toward volLeft+40px
    const drawSideGlow = (innerX, outerX, c0, c1) => {
      const x0 = Math.min(innerX, outerX), x1 = Math.max(innerX, outerX);
      // Color at innerX (inside lane side, near critical line) = c0 (strong),
      // at outerX (further from lane) = c1 (transparent).
      const innerIsLeft = outerX < innerX;
      const aTop = innerIsLeft ? c1 : c0, aBot = innerIsLeft ? c1 : c0;
      const bTop = innerIsLeft ? c0 : c1, bBot = innerIsLeft ? c0 : c1;
      this._quad(x0, cTop, x1, cTop, x1, cBot, x0, cBot, aTop, bTop, bBot, aBot);
    };
    drawSideGlow(vlx1, volLeft  - 40, lcLZero, lcL);
    drawSideGlow(vrx1, volRight + 40, lcRZero, lcR);

    // ── 5. Scrolling grid (beat / measure lines) ───────────────────────
    const TPM = 192, TPB = 48;
    const VT = gv.VISIBLE_TICKS;
    const tick = gv.playTick;
    const startBeat = Math.floor(tick / TPB) * TPB;
    for (let t = startBeat; t <= tick + VT + TPB; t += TPB) {
      const dt = t - tick;
      if (dt < 0 || dt > VT) continue;
      const sy = gv._screenY(dt, p);
      if (sy <= p.cutoffY || sy >= p.judgeY) continue;
      const isMeasure = (t % TPM === 0);
      const col = isMeasure ? [0.376, 0.376, 0.667, 1]   // #6060aa
                            : [0.133, 0.133, 0.290, 1];  // #22224a
      const lw = isMeasure ? 1.5 : 0.8;
      const [x0, y0] = T(gv._screenX(0, sy, p), sy);
      const [x1, y1] = T(gv._screenX(1, sy, p), sy);
      this._line(x0, y0, x1, y1, lw, col);
    }

    // ── 6. Vertical lane dividers (5 lines: edges + 3 interior) ────────
    for (let i = 0; i <= 4; i++) {
      const n = i / 4;
      const edge = (i === 0 || i === 4);
      const col = edge ? [0.314, 0.314, 0.627, 1]   // #5050a0
                       : [0.157, 0.157, 0.345, 1];  // #282858
      const lw = edge ? 1.5 : 0.8;
      const [x0, y0] = T(gv._screenX(n, p.cutoffY, p), p.cutoffY);
      const [x1, y1] = T(gv._screenX(n, p.judgeY,  p), p.judgeY);
      this._line(x0, y0, x1, y1, lw, col);
    }

    // ── 7. Notes (Phase 2) — emitted into the same vertex buffer ───────
    if (chart) this._emitNotes(p, gv, chart);

    // ── 8. Submit + draw ───────────────────────────────────────────────
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform2f(this.locRes, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this._cpu, 0, this._n * 6);
    gl.drawArrays(gl.TRIANGLES, 0, this._n);
    gl.bindVertexArray(null);
  }

  // ── Phase 2: BT/FX notes ─────────────────────────────────────────────
  // Mirrors the iteration order and geometry of the 2D path in
  // game.js draw() exactly (FX holds → FX chips → BT holds → BT chips)
  // so the visual result matches by construction.
  //
  // Approximations vs 2D path:
  //  • No ctx.shadowBlur glow (would need a separate render target).
  //    Notes are ~95 % visually identical; the bloom around hits is
  //    skipped in Phase 2 — comes back in Phase 4 polish.
  //  • Multi-stop horizontal gradients (FX chip / FX hold) are emitted
  //    as two stacked quads split at the lane center, so the brighter
  //    middle stop renders correctly via vertex interpolation.
  //  • Active-hold bright outline reuses the same base quad rather than
  //    stroking a 1.5 px line, since gl.LINE_WIDTH > 1 is unreliable.
  _emitNotes(p, gv, chart) {
    const T = this._T;
    const VT = gv.VISIBLE_TICKS;
    const tick = gv.playTick;

    // Colors (precomputed normalized RGBA)
    const FX_HOLD_EDGE = [0.549, 0.251, 0.000, 1.00]; // #8c4000
    const FX_HOLD_MID  = [1.000, 0.533, 0.000, 0.80]; // #ff8800cc
    const FX_CHIP_EDGE = [0.667, 0.333, 0.000, 1.00]; // #aa5500
    const FX_CHIP_MID  = [1.000, 0.800, 0.000, 1.00]; // #ffcc00
    const BT_HOLD_TOP  = [0.565, 0.565, 0.800, 1.00]; // #9090cc
    const BT_HOLD_BOT  = [0.910, 0.910, 1.000, 1.00]; // #e8e8ff
    const BT_HOLD_HOT  = [1.000, 1.000, 1.000, 1.00]; // active highlight
    const BT_CAP       = [0.973, 0.973, 1.000, 1.00]; // #f8f8ff
    const BT_CHIP      = [0.910, 0.910, 1.000, 1.00]; // #e8e8ff
    const BT_HIGHLIGHT = [1.000, 1.000, 1.000, 0.80]; // #ffffffcc

    // Helper to emit a perspective trapezoid with 4 corner colors.
    const trapQuad = (x_TL, y_T, x_TR, x_BR, y_B, x_BL, cTL, cTR, cBR, cBL) => {
      const [a0,a1] = T(x_TL, y_T), [b0,b1] = T(x_TR, y_T);
      const [c0,c1] = T(x_BR, y_B), [d0,d1] = T(x_BL, y_B);
      this._quad(a0,a1, b0,b1, c0,c1, d0,d1, cTL, cTR, cBR, cBL);
    };

    // ── FX holds ──
    const FX_INSET = 0.012;
    for (let li = 0; li < 2; li++) {
      const ln = li * 0.5, rn = (li + 1) * 0.5;
      const mid = ln + 0.25;
      for (const n of chart.fx[li]) {
        if (n.len === 0 || n.y + n.len < tick || n.y > tick + VT) continue;
        const dt0 = Math.max(n.y - tick, 0);
        const dt1 = Math.min(n.y + n.len - tick, VT);
        const sy0 = gv._screenY(dt1, p);
        const sy1 = gv._screenY(dt0, p);
        const x0l = gv._screenX(ln + FX_INSET, sy0, p);
        const x0m = gv._screenX(mid,           sy0, p);
        const x0r = gv._screenX(rn - FX_INSET, sy0, p);
        const x1l = gv._screenX(ln + FX_INSET, sy1, p);
        const x1m = gv._screenX(mid,           sy1, p);
        const x1r = gv._screenX(rn - FX_INSET, sy1, p);
        trapQuad(x0l, sy0, x0m, x1m, sy1, x1l, FX_HOLD_EDGE, FX_HOLD_MID, FX_HOLD_MID, FX_HOLD_EDGE);
        trapQuad(x0m, sy0, x0r, x1r, sy1, x1m, FX_HOLD_MID, FX_HOLD_EDGE, FX_HOLD_EDGE, FX_HOLD_MID);
      }
    }

    // ── FX chips ──
    for (let li = 0; li < 2; li++) {
      const ln = li * 0.5, rn = (li + 1) * 0.5;
      for (const n of chart.fx[li]) {
        if (n.len !== 0 || n.y < tick || n.y > tick + VT) continue;
        const dt = n.y - tick;
        const sy = gv._screenY(dt, p);
        if (sy < p.cutoffY) continue;
        const lx = gv._screenX(ln + 0.01, sy, p);
        const rx = gv._screenX(rn - 0.01, sy, p);
        const chipH = Math.max(5, (rx - lx) * 0.12);
        const midX = (lx + rx) * 0.5;
        const yT = sy - chipH;
        trapQuad(lx,   yT, midX, midX, sy, lx,   FX_CHIP_EDGE, FX_CHIP_MID,  FX_CHIP_MID,  FX_CHIP_EDGE);
        trapQuad(midX, yT, rx,   rx,   sy, midX, FX_CHIP_MID,  FX_CHIP_EDGE, FX_CHIP_EDGE, FX_CHIP_MID);
      }
    }

    // ── BT holds ──
    const btScale = Math.min(1.5, Math.max(0, gv.btWidthScale ?? 1.0));
    const bwInset = (1 - btScale) / 8;
    for (let li = 0; li < 4; li++) {
      const ln = li / 4 + bwInset, rn = (li + 1) / 4 - bwInset;
      for (const n of chart.bt[li]) {
        if (n.len === 0 || n.y + n.len < tick || n.y > tick + VT) continue;
        const dt0 = Math.max(n.y - tick, 0);
        const dt1 = Math.min(n.y + n.len - tick, VT);
        const sy0 = gv._screenY(dt1, p);
        const sy1 = gv._screenY(dt0, p);
        const active = (n.y <= tick && n.y + n.len >= tick);
        const x0l = gv._screenX(ln + 0.005, sy0, p), x0r = gv._screenX(rn - 0.005, sy0, p);
        const x1l = gv._screenX(ln + 0.005, sy1, p), x1r = gv._screenX(rn - 0.005, sy1, p);
        const topC = active ? BT_HOLD_HOT : BT_HOLD_TOP;
        trapQuad(x0l, sy0, x0r, x1r, sy1, x1l, topC, topC, BT_HOLD_BOT, BT_HOLD_BOT);

        // White top cap at the start of the hold
        if (n.y >= tick && n.y <= tick + VT) {
          const capH = Math.max(3, (x1r - x1l) * 0.07);
          trapQuad(x1l, sy1 - capH, x1r, x1r, sy1, x1l, BT_CAP, BT_CAP, BT_CAP, BT_CAP);
        }
      }
    }

    // ── BT chips ──
    for (let li = 0; li < 4; li++) {
      const ln = li / 4 + bwInset, rn = (li + 1) / 4 - bwInset;
      for (const n of chart.bt[li]) {
        if (n.len !== 0 || n.y < tick || n.y > tick + VT) continue;
        const dt = n.y - tick;
        const sy = gv._screenY(dt, p);
        if (sy < p.cutoffY) continue;
        const hw = gv._halfW(sy, p);
        const chipH = Math.max(4, hw * 0.08 * btScale);
        const lx = gv._screenX(ln + 0.01, sy, p);
        const rx = gv._screenX(rn - 0.01, sy, p);
        const yT = sy - chipH;
        trapQuad(lx, yT, rx, rx, sy, lx, BT_CHIP, BT_CHIP, BT_CHIP, BT_CHIP);
        // 2-pixel top highlight
        trapQuad(lx, yT, rx, rx, yT + 2, lx, BT_HIGHLIGHT, BT_HIGHLIGHT, BT_HIGHLIGHT, BT_HIGHLIGHT);
      }
    }
  }

  clear() {
    if (!this.ok) return;
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

// Expose globally so game.js can pick it up.
if (typeof window !== 'undefined') {
  window.GLLaneRenderer = GLLaneRenderer;
}
