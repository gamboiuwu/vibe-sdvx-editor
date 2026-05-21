// js/handsim.js v6 — 3D Skeletal Hand Renderer
// Forward-kinematics bone chains, perspective cylinder shading, joint spheres.
// ─────────────────────────────────────────────────────────────────────────────
import { chart, renderer } from './app.js';

const CW = 560, CH = 340;

// ── Controller layout ─────────────────────────────────────────────────────────
const VOL = [
  { cx: 50,  cy: 62, r: 32 },
  { cx: 510, cy: 62, r: 32 },
];
const BT = [
  { x:100, y:18, w:58, h:58 },
  { x:164, y:18, w:58, h:58 },
  { x:272, y:18, w:58, h:58 },
  { x:336, y:18, w:58, h:58 },
];
const FX = [
  { x:100, y:84, w:120, h:28 },
  { x:272, y:84, w:120, h:28 },
];
const BT_CY = BT[0].y + BT[0].h;
const FX_CY = FX[0].y + FX[0].h;
const BTC   = BT.map(b => ({ x: b.x + b.w/2, y: b.y + b.h/2 }));
const FXC   = FX.map(f => ({ x: f.x + f.w/2, y: f.y + f.h/2 }));

const LCOL = ['#44aaff','#88ccff','#ff8833','#ff6622','#cc44ff','#ff44cc','#2266ee','#cc00aa'];
function _hex(h) { return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]; }
function _rgba(h,a) { const [r,g,b]=_hex(h); return `rgba(${r},${g},${b},${a.toFixed(2)})`; }

// ── 3D world & projection ──────────────────────────────────────────────────────
// wx = canvas X (left-right)
// wz = world depth (≈ canvas Y when on the surface, 0 = top of board)
// wy = height above controller surface (0 = touching, positive = raised)
// Projection: raised fingers appear higher on-screen (smaller sy).
// Mild perspective: player-side things very slightly larger.
const H_LIFT = 1.35;   // screen-y pixels per unit of wy height
const PERSP_K = 620;   // perspective constant (larger = less foreshortening)

function proj3d(wx, wz, wy) {
  const ps = PERSP_K / (PERSP_K + wz * 0.025);
  return {
    sx: CW/2 + (wx - CW/2) * ps,
    sy: wz - wy * H_LIFT,
    scale: ps,
  };
}

// ── Forward kinematics ────────────────────────────────────────────────────────
// root : { x, z, y }   — anchor point (MCP knuckle in world space)
// dir  : { x, z }      — unit vector in the XZ plane (finger direction)
// lengths : number[]   — bone lengths
// angles  : number[]   — joint flexion (radians; positive = curl toward surface)
// Returns array of { x, z, y } joint positions: [root, j1, j2, …, tip]
function fk(root, dir, lengths, angles) {
  const pts = [{ x: root.x, z: root.z, y: root.y }];
  let cx = root.x, cz = root.z, cy = root.y, tilt = 0;
  for (let i = 0; i < lengths.length; i++) {
    tilt += (angles[i] || 0);
    const L = lengths[i];
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    cx += dir.x * L * cosT;
    cz += dir.z * L * cosT;
    cy  = Math.max(0, cy - L * sinT);
    pts.push({ x: cx, z: cz, y: cy });
  }
  return pts;
}

// ── 3D Bone segment (tapered cylinder via perpendicular gradient quad) ─────────
function drawBone3d(ctx, p0, p1, r0, r1, pr, accentCol) {
  const s0 = proj3d(p0.x, p0.z, p0.y);
  const s1 = proj3d(p1.x, p1.z, p1.y);

  const dx = s1.sx - s0.sx, dy = s1.sy - s0.sy;
  const blen = Math.hypot(dx, dy) || 0.01;
  const px = -dy / blen, py = dx / blen;   // perpendicular (cylinder axis)

  const rs0 = r0 * s0.scale * 1.15;
  const rs1 = r1 * s1.scale * 1.15;

  // Quad corners: left edge top→bottom, right edge bottom→top
  ctx.beginPath();
  ctx.moveTo(s0.sx + px*rs0, s0.sy + py*rs0);
  ctx.lineTo(s1.sx + px*rs1, s1.sy + py*rs1);
  ctx.lineTo(s1.sx - px*rs1, s1.sy - py*rs1);
  ctx.lineTo(s0.sx - px*rs0, s0.sy - py*rs0);
  ctx.closePath();

  // Cylinder shading: gradient perpendicular to bone direction
  const mcx = (s0.sx + s1.sx) * 0.5, mcy = (s0.sy + s1.sy) * 0.5;
  const mr  = (rs0 + rs1) * 0.5;
  const g = ctx.createLinearGradient(
    mcx - px*mr, mcy - py*mr,
    mcx + px*mr, mcy + py*mr
  );
  if (pr > 0.06 && accentCol) {
    // Pressed: tinted with lane colour at the highlight
    const [ar,ag,ab] = _hex(accentCol);
    g.addColorStop(0,    '#4a2208');
    g.addColorStop(0.25, `rgba(${ar},${ag},${ab},0.55)`);
    g.addColorStop(0.5,  accentCol);
    g.addColorStop(0.75, `rgba(${ar},${ag},${ab},0.55)`);
    g.addColorStop(1,    '#4a2208');
  } else {
    g.addColorStop(0,    '#6a380e');   // shadow edge
    g.addColorStop(0.22, '#a86230');   // transition
    g.addColorStop(0.5,  '#f2ca94');   // dorsal highlight (top of cylinder)
    g.addColorStop(0.78, '#a86230');
    g.addColorStop(1,    '#6a380e');
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.75;
  ctx.stroke();
}

// ── 3D Joint sphere ───────────────────────────────────────────────────────────
function drawJoint3d(ctx, p, r, pr, accentCol) {
  const s = proj3d(p.x, p.z, p.y);
  const rs = r * s.scale * 1.18;

  ctx.beginPath();
  ctx.arc(s.sx, s.sy, rs, 0, Math.PI * 2);

  const g = ctx.createRadialGradient(
    s.sx - rs*0.30, s.sy - rs*0.30, rs*0.04,
    s.sx, s.sy, rs
  );
  if (pr > 0.06 && accentCol) {
    const [ar,ag,ab] = _hex(accentCol);
    g.addColorStop(0,   `rgba(${ar},${ag},${ab},0.95)`);
    g.addColorStop(0.5, '#904820');
    g.addColorStop(1,   '#2e1006');
  } else {
    g.addColorStop(0,   '#f8ddb0');   // highlight
    g.addColorStop(0.45,'#c89050');   // mid-tone
    g.addColorStop(1,   '#5c2e0c');   // shadow
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

// ── Fingernail ────────────────────────────────────────────────────────────────
function drawNail3d(ctx, tip, preTip, tipR) {
  const st = proj3d(tip.x, tip.z, tip.y + 0.5);
  const sp = proj3d(preTip.x, preTip.z, preTip.y + 0.5);
  const dx = st.sx - sp.sx, dy = st.sy - sp.sy;
  const ang = Math.atan2(dy, dx);
  const rs = tipR * st.scale;
  ctx.beginPath();
  ctx.ellipse(st.sx + Math.cos(ang)*rs*0.25, st.sy + Math.sin(ang)*rs*0.25,
              rs*0.82, rs*0.52, ang, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,218,185,0.62)';
  ctx.fill();
}

// ── Finger config type ────────────────────────────────────────────────────────
// root: {x,z,y}  dir: {x,z} (will be normalized)
// lengths: bone lengths (PP, MP, DP for normal fingers; PP, DP for thumb)
// radii: [at root, at each joint, at tip] — one more than lengths
// restAngles / pressAngles: joint flexion arrays (same count as lengths)
// pressIdx, laneIdx, isThumb

function _norm2(dx, dz) {
  const m = Math.hypot(dx, dz) || 1;
  return { x: dx/m, z: dz/m };
}

// ── Left hand fingers ─────────────────────────────────────────────────────────
const L_PALM = { x: 160, z: 278 };

const LEFT_FINGERS = [
  // Pinky — resting
  {
    root: { x:116, z:264, y:10 },
    dir: _norm2(-0.06, -1),
    lengths: [15, 12, 9],
    radii: [3.8, 3.4, 2.8, 2.2],
    restAngles:  [0.12, 0.20, 0.12],
    pressAngles: [0.18, 0.28, 0.15],
    pressIdx:4, laneIdx:-1, isThumb:false, side:0,
  },
  // Ring — BT-A
  {
    root: { x:133, z:260, y:13 },
    dir: _norm2(BTC[0].x - 133, BTC[0].y - 260),
    lengths: [20, 15, 12],
    radii: [5.2, 4.8, 3.8, 2.9],
    restAngles:  [0.10, 0.16, 0.09],
    pressAngles: [0.30, 0.54, 0.28],
    pressIdx:0, laneIdx:0, isThumb:false, side:0,
  },
  // Middle — rest
  {
    root: { x:151, z:256, y:13 },
    dir: _norm2(0.01, -1),
    lengths: [22, 16, 13],
    radii: [5.8, 5.3, 4.2, 3.2],
    restAngles:  [0.08, 0.13, 0.07],
    pressAngles: [0.12, 0.18, 0.10],
    pressIdx:3, laneIdx:-1, isThumb:false, side:0,
  },
  // Index — BT-B
  {
    root: { x:169, z:260, y:13 },
    dir: _norm2(BTC[1].x - 169, BTC[1].y - 260),
    lengths: [20, 15, 12],
    radii: [5.2, 4.8, 3.8, 2.9],
    restAngles:  [0.10, 0.16, 0.09],
    pressAngles: [0.30, 0.54, 0.28],
    pressIdx:1, laneIdx:1, isThumb:false, side:0,
  },
  // Thumb — FX-L
  {
    root: { x:189, z:268, y:8 },
    dir: _norm2(FXC[0].x - 189, FXC[0].y - 268),
    lengths: [21, 16],
    radii: [6.8, 6.0, 4.8],
    restAngles:  [0.14, 0.18],
    pressAngles: [0.38, 0.44],
    pressIdx:2, laneIdx:4, isThumb:true, side:0,
  },
];

// ── Right hand fingers (mirror) ───────────────────────────────────────────────
const R_PALM = { x: 370, z: 278 };

const RIGHT_FINGERS = [
  // Thumb — FX-R
  {
    root: { x:351, z:268, y:8 },
    dir: _norm2(FXC[1].x - 351, FXC[1].y - 268),
    lengths: [21, 16],
    radii: [6.8, 6.0, 4.8],
    restAngles:  [0.14, 0.18],
    pressAngles: [0.38, 0.44],
    pressIdx:7, laneIdx:5, isThumb:true, side:1,
  },
  // Index — BT-C
  {
    root: { x:371, z:260, y:13 },
    dir: _norm2(BTC[2].x - 371, BTC[2].y - 260),
    lengths: [20, 15, 12],
    radii: [5.2, 4.8, 3.8, 2.9],
    restAngles:  [0.10, 0.16, 0.09],
    pressAngles: [0.30, 0.54, 0.28],
    pressIdx:5, laneIdx:2, isThumb:false, side:1,
  },
  // Middle — rest
  {
    root: { x:389, z:256, y:13 },
    dir: _norm2(-0.01, -1),
    lengths: [22, 16, 13],
    radii: [5.8, 5.3, 4.2, 3.2],
    restAngles:  [0.08, 0.13, 0.07],
    pressAngles: [0.12, 0.18, 0.10],
    pressIdx:8, laneIdx:-1, isThumb:false, side:1,
  },
  // Ring — BT-D
  {
    root: { x:407, z:260, y:13 },
    dir: _norm2(BTC[3].x - 407, BTC[3].y - 260),
    lengths: [20, 15, 12],
    radii: [5.2, 4.8, 3.8, 2.9],
    restAngles:  [0.10, 0.16, 0.09],
    pressAngles: [0.30, 0.54, 0.28],
    pressIdx:6, laneIdx:3, isThumb:false, side:1,
  },
  // Pinky — resting
  {
    root: { x:424, z:264, y:10 },
    dir: _norm2(0.06, -1),
    lengths: [15, 12, 9],
    radii: [3.8, 3.4, 2.8, 2.2],
    restAngles:  [0.12, 0.20, 0.12],
    pressAngles: [0.18, 0.28, 0.15],
    pressIdx:9, laneIdx:-1, isThumb:false, side:1,
  },
];

// ── Draw 3D palm ──────────────────────────────────────────────────────────────
function drawPalm3d(ctx, side, alpha) {
  if (alpha < 0.01) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;

  const P = side === 0 ? L_PALM : R_PALM;
  // Palm slab at wy=4 (slightly above surface)
  const pc = proj3d(P.x, P.z, 4);
  const pw = 44 * pc.scale, ph = 20 * pc.scale;

  // Outer shape: rounded trapezoid (wider at bottom, narrower at top)
  const topW  = pw * 0.78, botW = pw;
  const pcTop = proj3d(P.x, P.z - 28, 6);
  const pcBot = proj3d(P.x, P.z + 10, 2);

  ctx.beginPath();
  ctx.moveTo(pcTop.sx - topW,  pcTop.sy);
  ctx.quadraticCurveTo(pcTop.sx - topW - 4, (pcTop.sy + pcBot.sy)*0.5, pcBot.sx - botW, pcBot.sy);
  ctx.quadraticCurveTo(pcBot.sx, pcBot.sy + 8*pc.scale, pcBot.sx + botW, pcBot.sy);
  ctx.quadraticCurveTo(pcTop.sx + topW + 4, (pcTop.sy + pcBot.sy)*0.5, pcTop.sx + topW, pcTop.sy);
  ctx.closePath();

  const pg = ctx.createRadialGradient(
    pc.sx - 10*pc.scale, pc.sy - 8*pc.scale, 2*pc.scale,
    pc.sx, pc.sy, 55*pc.scale
  );
  pg.addColorStop(0,    '#f2ca94');   // dorsal highlight
  pg.addColorStop(0.35, '#c88c50');   // mid palm
  pg.addColorStop(0.75, '#9a6030');   // shadow edges
  pg.addColorStop(1,    '#7a4020');
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Metacarpal ridge lines (subtle)
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.8;
  const ridgeOffsets = side === 0
    ? [-22,-10, 2, 14]
    : [-14, -2, 10, 22];
  for (const ro of ridgeOffsets) {
    const rt = proj3d(P.x + ro, P.z - 24, 5);
    const rb = proj3d(P.x + ro * 0.7, P.z + 6, 3);
    ctx.beginPath();
    ctx.moveTo(rt.sx, rt.sy);
    ctx.quadraticCurveTo(rt.sx + ro*0.05, (rt.sy+rb.sy)*0.5, rb.sx, rb.sy);
    ctx.stroke();
  }

  // L / R label
  ctx.fillStyle = 'rgba(70,90,170,0.55)';
  ctx.font = `bold ${Math.round(10*pc.scale)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(side === 0 ? 'L' : 'R', pc.sx, pc.sy + 6*pc.scale);
  ctx.restore();
}

// ── Draw one 3D finger ────────────────────────────────────────────────────────
function drawFinger3d(ctx, cfg, pr, alpha) {
  if (alpha < 0.01) return;
  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha = alpha;

  const col = cfg.laneIdx >= 0 ? LCOL[cfg.laneIdx] : null;

  // Interpolate joint angles between rest and pressed
  const angles = cfg.restAngles.map((ra, i) =>
    ra + (cfg.pressAngles[i] - ra) * pr
  );

  const pts = fk(cfg.root, cfg.dir, cfg.lengths, angles);

  // Draw bones (base → tip) — draw back-to-front for painter's sort within finger
  for (let i = 0; i < pts.length - 1; i++) {
    drawBone3d(ctx, pts[i], pts[i+1], cfg.radii[i], cfg.radii[i+1], pr, col);
  }

  // Joint spheres (MCP hidden by palm; draw PIP, DIP, tip)
  for (let i = 1; i < pts.length; i++) {
    drawJoint3d(ctx, pts[i], cfg.radii[i], pr, col);
  }

  // Nail at fingertip
  if (pts.length >= 2) drawNail3d(ctx, pts[pts.length-1], pts[pts.length-2], cfg.radii[cfg.radii.length-1]);

  // Glow shadow on pressed finger
  if (pr > 0.1 && col) {
    ctx.shadowColor = col;
    ctx.shadowBlur  = 8 * pr;
    // Re-draw tip joint with glow
    drawJoint3d(ctx, pts[pts.length-1], cfg.radii[cfg.radii.length-1], pr, col);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// ── Grip-mode hand: whole hand wraps around VOL knob (3D bones, rotated) ─────
// Finger bones are drawn in the knob's local rotated canvas frame.
// Local frame: origin = knob centre; local x=horizontal, local y=vertical (screen).
// "world height" wy is still added for 3D depth even inside the rotated frame.
function drawGripHand3d(ctx, side, alpha) {
  if (alpha < 0.01) return;
  const v  = VOL[side];
  const rot = _volRot[side];
  const cl  = LCOL[6 + side];

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(v.cx, v.cy);
  ctx.rotate(rot);

  // ── Palm behind knob ────────────────────────────────────────────────────────
  const palmY = 44;   // local y of palm centre (below knob)
  ctx.beginPath();
  ctx.ellipse(0, palmY, 30, 19, 0, 0, Math.PI * 2);
  const pg = ctx.createRadialGradient(-10, palmY - 7, 2, 0, palmY, 30);
  pg.addColorStop(0,   '#f2ca94');
  pg.addColorStop(0.45,'#c08040');
  pg.addColorStop(1,   '#7a3e18');
  ctx.fillStyle = pg; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.9; ctx.stroke();

  // L/R label
  ctx.fillStyle = 'rgba(70,90,170,0.6)';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(side === 0 ? 'L' : 'R', 0, palmY);

  // ── Grip fingers radiating around upper half of knob ────────────────────────
  // In this local frame, draw each finger as a 3D bone chain.
  // The 5 fingers fan from ≈−95° to +70° (left hand) or mirror (right).
  // We use a simplified LOCAL projection for the rotated frame:
  //   sx_local = localX + wy * leanDir * 0.12   (height creates slight lean)
  //   sy_local = localZ - wy * H_LIFT * 0.7
  // where localZ is the local y-coordinate (vertical in rotated frame).

  const angsDeg = side === 0
    ? [-92, -54, -14,  24,  68]   // L: pinky → thumb
    : [-68, -24,  14,  54,  92];  // R: thumb → pinky
  const radiiSets = side === 0
    ? [[3.8,3.3,2.6],[5.2,4.6,3.6],[5.8,5.1,4.0],[5.2,4.6,3.6],[6.8,6.0,4.8]]
    : [[6.8,6.0,4.8],[5.2,4.6,3.6],[5.8,5.1,4.0],[5.2,4.6,3.6],[3.8,3.3,2.6]];
  const gripAngles = [0.42, 0.65, 0.35];  // PP, MP, DP flexion on knob grip
  const knobRim    = v.r + 3;

  // pressIdxs in grip order (pinky→thumb for L, thumb→pinky for R)
  const gPressIdx = side === 0 ? [4,0,3,1,2] : [7,5,8,6,9];
  const gLaneIdx  = side === 0 ? [-1,0,-1,1,4] : [5,2,-1,3,-1];

  for (let k = 0; k < 5; k++) {
    const angRad = angsDeg[k] * Math.PI / 180;
    const tipLX  = Math.sin(angRad) * knobRim;
    const tipLY  = -Math.cos(angRad) * knobRim;

    // Finger base on palm edge
    const fanBase = 13;
    const bx = Math.sin(angRad) * fanBase;
    const by = palmY - 9;

    // Direction in local frame: from base toward tip
    const ddx = tipLX - bx, ddy = tipLY - by;
    const dlen = Math.hypot(ddx, ddy) || 1;

    // Bone lengths: 3 segments
    const seg = dlen / 3;
    const lengths = [seg * 1.1, seg * 0.9, seg * 1.0];

    // Forward kinematics in LOCAL frame using a local proj
    // We treat localX as wx, localY as wz, and add wy for height lift
    let lx = bx, ly = by, lh = 8, tilt = 0;
    const pts3 = [{ lx, ly, lh }];
    const ndx = ddx/dlen, ndy = ddy/dlen;

    for (let i = 0; i < lengths.length; i++) {
      tilt += gripAngles[i];
      const L = lengths[i];
      const cT = Math.cos(tilt), sT = Math.sin(tilt);
      lx += ndx * L * cT;
      ly += ndy * L * cT;
      lh  = Math.max(0, lh - L * sT * 0.5);
      pts3.push({ lx, ly, lh });
    }

    // Draw bones in local frame (cylinder shading)
    const pr   = _press[gPressIdx[k]];
    const col  = gLaneIdx[k] >= 0 ? LCOL[gLaneIdx[k]] : null;
    const rset = radiiSets[k];
    const radii= [rset[0], rset[1], rset[1], rset[2]];

    for (let i = 0; i < pts3.length - 1; i++) {
      const a = pts3[i], b = pts3[i+1];
      const r0 = radii[i], r1 = radii[i+1];

      // Local screen positions with height lift
      const ax = a.lx, ay = a.ly - a.lh * H_LIFT * 0.7;
      const bx2 = b.lx, by2 = b.ly - b.lh * H_LIFT * 0.7;

      const dx = bx2 - ax, dy = by2 - ay;
      const bl = Math.hypot(dx, dy) || 0.01;
      const ppx = -dy/bl, ppy = dx/bl;

      ctx.beginPath();
      ctx.moveTo(ax + ppx*r0, ay + ppy*r0);
      ctx.lineTo(bx2 + ppx*r1, by2 + ppy*r1);
      ctx.lineTo(bx2 - ppx*r1, by2 - ppy*r1);
      ctx.lineTo(ax - ppx*r0, ay - ppy*r0);
      ctx.closePath();

      const mcx2 = (ax+bx2)*0.5, mcy2 = (ay+by2)*0.5, mr2 = (r0+r1)*0.5;
      const gg = ctx.createLinearGradient(
        mcx2 - ppx*mr2, mcy2 - ppy*mr2,
        mcx2 + ppx*mr2, mcy2 + ppy*mr2
      );
      if (pr > 0.06 && col) {
        const [ar2,ag2,ab2] = _hex(col);
        gg.addColorStop(0,   '#4a2208');
        gg.addColorStop(0.5, `rgba(${ar2},${ag2},${ab2},0.9)`);
        gg.addColorStop(1,   '#4a2208');
      } else {
        gg.addColorStop(0,   '#6a380e');
        gg.addColorStop(0.5, '#f2ca94');
        gg.addColorStop(1,   '#6a380e');
      }
      ctx.fillStyle = gg; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.7; ctx.stroke();
    }

    // Joint sphere at tip
    const tipPt = pts3[pts3.length-1];
    const tsx = tipPt.lx, tsy = tipPt.ly - tipPt.lh * H_LIFT * 0.7;
    const tr   = rset[2];
    ctx.beginPath(); ctx.arc(tsx, tsy, tr, 0, Math.PI*2);
    const jg = ctx.createRadialGradient(tsx-tr*0.3, tsy-tr*0.3, tr*0.05, tsx, tsy, tr);
    jg.addColorStop(0, '#f8ddb0'); jg.addColorStop(0.5, '#c89050'); jg.addColorStop(1, '#5c2e0c');
    ctx.fillStyle = jg; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 0.6; ctx.stroke();

    // Knob-glow on all grip fingers
    ctx.shadowColor = cl; ctx.shadowBlur = 5 * alpha;
    ctx.beginPath(); ctx.arc(tsx, tsy, tr * 0.6, 0, Math.PI*2);
    ctx.fillStyle = _rgba(cl, 0.25 * alpha); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Knuckle crease arc on palm
  ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, palmY - 9, 18, 0, Math.PI*2); ctx.stroke();

  ctx.restore();
}

// ── State ─────────────────────────────────────────────────────────────────────
let _press      = new Float32Array(10);
let _volRot     = [0, 0];
let _volRotTg   = [0, 0];
let _laserMov   = [false, false];
let _laserMovLp = [0, 0];
let _crossLp    = 0;

let _win=null, _canv=null, _ctx=null, _rafId=null;
window._hsVisible = false;

// ── Note detection ────────────────────────────────────────────────────────────
const CHIP_WIN = 14;

function _computeTargets(tick, ch) {
  const tgt = new Float32Array(10);
  if (!ch) return { tgt, laserMov:[false,false] };

  const BT_MAP = [0,1,5,6];
  for (let li=0;li<4;li++) {
    for (const n of (ch.bt[li]||[])) {
      if (n.len===0){ if(Math.abs(n.y-tick)<=CHIP_WIN){ tgt[BT_MAP[li]]=1; break; } }
      else          { if(tick>=n.y&&tick<=n.y+n.len)  { tgt[BT_MAP[li]]=1; break; } }
    }
  }

  const FX_MAP = [2,7];
  for (let li=0;li<2;li++) {
    for (const n of (ch.fx[li]||[])) {
      if (n.len===0){ if(Math.abs(n.y-tick)<=CHIP_WIN){ tgt[FX_MAP[li]]=1; break; } }
      else          { if(tick>=n.y&&tick<=n.y+n.len)  { tgt[FX_MAP[li]]=1; break; } }
    }
  }

  const laserMov = [false, false];
  for (let side=0;side<2;side++) {
    for (const sec of (ch.lasers[side]||[])) {
      const pts=sec.points; if(!pts?.length) continue;
      const sEnd=sec.y+pts[pts.length-1].ry;
      if (tick<sec.y||tick>sEnd) continue;
      let lv=pts[0].v;
      for (let pi=0;pi<pts.length-1;pi++) {
        const t0=sec.y+pts[pi].ry, t1=sec.y+pts[pi+1].ry;
        if (tick>=t0&&tick<=t1) {
          laserMov[side] = Math.abs(pts[pi+1].v-pts[pi].v) > 0.008;
          lv = pts[pi].v+(pts[pi+1].v-pts[pi].v)*(t1>t0?(tick-t0)/(t1-t0):0);
          break;
        }
      }
      _volRotTg[side] = (lv-0.5)*5.0;
      const ti = side===0?2:7;
      if (tgt[ti]<0.45) tgt[ti]=0.45;
      break;
    }
  }
  return { tgt, laserMov };
}

// ── Board ─────────────────────────────────────────────────────────────────────
function _drawBoard(ctx) {
  const bg=ctx.createLinearGradient(0,8,0,122);
  bg.addColorStop(0,'#1e1e34'); bg.addColorStop(1,'#0d0d1c');
  ctx.fillStyle=bg; ctx.beginPath(); ctx.roundRect(8,8,CW-16,114,10); ctx.fill();
  ctx.strokeStyle='#252540'; ctx.lineWidth=1; ctx.stroke();

  const lz=ctx.createLinearGradient(14,0,240,0);
  lz.addColorStop(0,'rgba(40,80,200,0.07)'); lz.addColorStop(1,'rgba(40,80,200,0)');
  ctx.fillStyle=lz; ctx.fillRect(14,10,226,110);
  const rz=ctx.createLinearGradient(328,0,CW-14,0);
  rz.addColorStop(0,'rgba(200,80,40,0)'); rz.addColorStop(1,'rgba(200,80,40,0.07)');
  ctx.fillStyle=rz; ctx.fillRect(328,10,CW-342,110);

  ctx.strokeStyle='#181832'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(238,14); ctx.lineTo(238,116); ctx.stroke();

  for (let i=0;i<2;i++) {
    const f=FX[i], pi=i===0?2:7;
    const pr=_press[pi]*(1-_laserMovLp[i]);
    const cl=LCOL[4+i];
    const fbg=ctx.createLinearGradient(f.x,f.y,f.x,f.y+f.h);
    fbg.addColorStop(0,pr>0.1?'#3c2850':'#1e1e38'); fbg.addColorStop(1,pr>0.1?'#261838':'#121228');
    ctx.fillStyle=fbg; ctx.beginPath(); ctx.roundRect(f.x,f.y,f.w,f.h,4); ctx.fill();
    if(pr>0.05){ctx.shadowColor=cl;ctx.shadowBlur=10*pr;ctx.strokeStyle=_rgba(cl,0.8*pr);ctx.lineWidth=1.5;}
    else{ctx.strokeStyle='#2e2e4a';ctx.lineWidth=1;}
    ctx.stroke(); ctx.shadowBlur=0;
    ctx.fillStyle=pr>0.2?cl:'#44447a'; ctx.font='bold 9px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(['FX-L','FX-R'][i],f.x+f.w/2,f.y+f.h/2);
  }

  const BT_PI=[0,1,5,6], BT_N=['BT-A','BT-B','BT-C','BT-D'];
  for (let i=0;i<4;i++) {
    const b=BT[i], pr=_press[BT_PI[i]], cl=LCOL[i];
    const bbg=ctx.createLinearGradient(b.x,b.y,b.x,b.y+b.h);
    bbg.addColorStop(0,pr>0.1?'#363658':'#1e1e38'); bbg.addColorStop(1,pr>0.1?'#202042':'#131322');
    ctx.fillStyle=bbg; ctx.beginPath(); ctx.roundRect(b.x,b.y,b.w,b.h,6); ctx.fill();
    if(pr>0.05){
      const ig=ctx.createRadialGradient(BTC[i].x,BTC[i].y,0,BTC[i].x,BTC[i].y,b.w*0.6);
      ig.addColorStop(0,_rgba(cl,0.22*pr)); ig.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=ig; ctx.beginPath(); ctx.roundRect(b.x,b.y,b.w,b.h,6); ctx.fill();
      ctx.shadowColor=cl; ctx.shadowBlur=16*pr;
      ctx.strokeStyle=_rgba(cl,0.9*pr); ctx.lineWidth=2;
    } else { ctx.strokeStyle='#2a2a50'; ctx.lineWidth=1; }
    ctx.stroke(); ctx.shadowBlur=0;
    ctx.fillStyle=pr>0.3?'#fff':'#4a4a80';
    ctx.font=`bold ${pr>0.3?12:10}px monospace`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(BT_N[i],BTC[i].x,BTC[i].y);
  }

  for (let i=0;i<2;i++) {
    const v=VOL[i], lp=_laserMovLp[i], cl=LCOL[6+i];
    const active=lp>0.05;
    ctx.beginPath(); ctx.arc(v.cx,v.cy,v.r+6,0,Math.PI*2);
    ctx.fillStyle='#08081a'; ctx.fill();
    for (let t=0;t<12;t++) {
      const a=(t/12)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(v.cx+Math.cos(a)*v.r,v.cy+Math.sin(a)*v.r);
      ctx.lineTo(v.cx+Math.cos(a)*(v.r+4),v.cy+Math.sin(a)*(v.r+4));
      ctx.strokeStyle='#1e1e38'; ctx.lineWidth=1; ctx.stroke();
    }
    if(active){ctx.shadowColor=cl;ctx.shadowBlur=16*lp;}
    ctx.beginPath(); ctx.arc(v.cx,v.cy,v.r+1,0,Math.PI*2);
    ctx.strokeStyle=active?_rgba(cl,0.8*lp):'#20203e';
    ctx.lineWidth=active?2:1; ctx.stroke(); ctx.shadowBlur=0;
    const kg=ctx.createRadialGradient(v.cx-9,v.cy-9,1,v.cx,v.cy,v.r);
    kg.addColorStop(0,active?'#2a2a4c':'#1a1a2e'); kg.addColorStop(1,'#07070f');
    ctx.fillStyle=kg; ctx.beginPath(); ctx.arc(v.cx,v.cy,v.r,0,Math.PI*2); ctx.fill();
    [7,14,20].forEach(gr=>{
      ctx.beginPath(); ctx.arc(v.cx,v.cy,gr,0,Math.PI*2);
      ctx.strokeStyle='rgba(255,255,255,0.025)'; ctx.lineWidth=1; ctx.stroke();
    });
    const rot=_volRot[i]-Math.PI/2;
    const ix=v.cx+Math.cos(rot)*(v.r-8), iy=v.cy+Math.sin(rot)*(v.r-8);
    ctx.beginPath(); ctx.moveTo(v.cx,v.cy); ctx.lineTo(ix,iy);
    ctx.strokeStyle=active?cl:'#383868'; ctx.lineWidth=2.5; ctx.lineCap='round'; ctx.stroke(); ctx.lineCap='butt';
    ctx.beginPath(); ctx.arc(v.cx,v.cy,3.5,0,Math.PI*2);
    ctx.fillStyle=active?cl:'#383868'; ctx.fill();
    ctx.fillStyle='#303068'; ctx.font='bold 7px monospace';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(['VOL-L','VOL-R'][i],v.cx,v.cy+v.r+13);
  }
}

// ── Ruler ─────────────────────────────────────────────────────────────────────
function _drawRuler(ctx) {
  ctx.font='7px monospace'; ctx.textBaseline='top'; ctx.lineWidth=1.5;
  ctx.strokeStyle='rgba(60,100,220,0.22)'; ctx.beginPath(); ctx.moveTo(22,125); ctx.lineTo(228,125); ctx.stroke();
  ctx.fillStyle='rgba(60,100,220,0.38)'; ctx.textAlign='center'; ctx.fillText('← L hand ~200 px / ~180 mm →',125,127);
  ctx.strokeStyle='rgba(220,100,60,0.22)'; ctx.beginPath(); ctx.moveTo(336,125); ctx.lineTo(540,125); ctx.stroke();
  ctx.fillStyle='rgba(220,100,60,0.38)'; ctx.textAlign='center'; ctx.fillText('← R hand ~200 px / ~180 mm →',438,127);
  ctx.setLineDash([3,3]); ctx.strokeStyle='rgba(180,180,60,0.2)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(193,8); ctx.lineTo(193,122); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(272,8); ctx.lineTo(272,122); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='rgba(200,200,60,0.28)'; ctx.textAlign='center'; ctx.fillText('overlap',232,10);
}

// ── Stretch indicator ─────────────────────────────────────────────────────────
function _drawStretch(ctx, fromX, fromY, toX, toY, alpha, colour) {
  if (alpha < 0.02) return;
  ctx.save(); ctx.globalAlpha = alpha * 0.55;
  ctx.setLineDash([5,4]);
  ctx.beginPath(); ctx.moveTo(fromX,fromY); ctx.lineTo(toX,toY);
  ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(toX,toY,4,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// ── Cross-hand visual ─────────────────────────────────────────────────────────
function _drawCrossHand(ctx, alpha) {
  if (alpha < 0.01) return;
  const lpsy = proj3d(L_PALM.x, L_PALM.z, 10).sy;
  const rpsy = proj3d(R_PALM.x, R_PALM.z, 10).sy;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(L_PALM.x, lpsy - 22);
  ctx.bezierCurveTo(L_PALM.x+55, lpsy-72, R_PALM.x-55, rpsy-72, R_PALM.x, rpsy-22);
  ctx.strokeStyle='#ff8822'; ctx.lineWidth=2.5; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle='#ff9933'; ctx.font='bold 11px monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.shadowColor='#ff6600'; ctx.shadowBlur=8;
  ctx.fillText('⚡ CROSS-HAND', CW/2, 205); ctx.shadowBlur=0;
  ctx.restore();
}

// ── Main draw ─────────────────────────────────────────────────────────────────
function _draw() {
  if (!_ctx) return;
  const ctx = _ctx;
  ctx.clearRect(0,0,CW,CH);
  const bg = ctx.createLinearGradient(0,0,0,CH);
  bg.addColorStop(0,'#0e0e1e'); bg.addColorStop(1,'#06060e');
  ctx.fillStyle = bg; ctx.fillRect(0,0,CW,CH);

  _drawBoard(ctx);
  _drawRuler(ctx);

  // ── Per hand: blend between normal (3D fingers) and grip (knob) ────────────
  // Sort order: draw farther things (smaller z/canvasY) first → painter's algorithm.
  // Palms are at large Z (near viewer). Fingers extend toward small Z.
  // We draw palm first (it's the "background" of the hand), then fingers on top.

  for (let side = 0; side < 2; side++) {
    const lp = _laserMovLp[side];
    const normAlpha = 1 - lp;
    const gripAlpha = lp;

    const fingers = side === 0 ? LEFT_FINGERS : RIGHT_FINGERS;

    // Normal mode
    if (normAlpha > 0.02) {
      // Palm first (background layer)
      drawPalm3d(ctx, side, normAlpha);

      // Fingers: draw non-pressing fingers first, pressing fingers last (on top with glow)
      const sorted = [...fingers].sort((a,b) => {
        const pa = _press[a.pressIdx], pb = _press[b.pressIdx];
        return pa - pb; // lower press drawn first (higher-press on top)
      });
      for (const fin of sorted) {
        drawFinger3d(ctx, fin, _press[fin.pressIdx], normAlpha);
      }
    }

    // Grip mode
    if (gripAlpha > 0.02) {
      drawGripHand3d(ctx, side, gripAlpha);
    }

    // Stretch indicators: opposite hand reaching to this side's buttons
    if (lp > 0.4) {
      const oppP = side === 0 ? R_PALM : L_PALM;
      const opsz = proj3d(oppP.x, oppP.z, 10).sy;
      const btIdxs = side === 0 ? [0,1] : [2,3];
      btIdxs.forEach(bi => {
        const pr = _press[[0,1,5,6][bi]];
        if (pr > 0.2) {
          _drawStretch(ctx, oppP.x, opsz, BTC[bi].x, BT_CY, (lp-0.4)/0.6*pr, LCOL[bi]);
        }
      });
    }
  }

  _drawCrossHand(ctx, _crossLp);

  // Legend
  ctx.font='7.5px monospace'; ctx.textBaseline='middle';
  ctx.fillStyle='rgba(50,80,140,0.6)'; ctx.textAlign='left';
  ctx.fillText('L: ring→BT-A  index→BT-B  thumb→FX-L / whole hand→VOL-L when turning',10,CH-14);
  ctx.fillStyle='rgba(140,80,50,0.6)'; ctx.textAlign='right';
  ctx.fillText('R: whole hand→VOL-R when turning / thumb→FX-R  index→BT-C  ring→BT-D',CW-10,CH-14);

  const tick = (typeof renderer!=='undefined') ? renderer.playTick : 0;
  const live = (typeof playing!=='undefined') && playing;
  ctx.fillStyle='#202048'; ctx.font='9px monospace'; ctx.textAlign='left'; ctx.textBaseline='bottom';
  ctx.fillText(`tick ${Math.floor(tick)}`, 10, CH-20);
  ctx.fillStyle=live?'#44cc66':'#282860'; ctx.textAlign='right';
  ctx.fillText(live?'● LIVE':'○ stopped', CW-10, CH-20);
}

// ── Animation loop ────────────────────────────────────────────────────────────
function _loop() {
  if (!_win || !window._hsVisible) { _rafId=null; return; }
  const tick = (typeof renderer!=='undefined') ? renderer.playTick : 0;
  const ch   = (typeof chart!=='undefined')    ? chart             : null;
  const { tgt, laserMov } = _computeTargets(tick, ch);

  for (let i=0;i<10;i++) {
    const spd = tgt[i] > _press[i] ? 0.55 : 0.38;
    _press[i] += (tgt[i] - _press[i]) * spd;
    if (_press[i] < 0.002) _press[i] = 0;
    if (_press[i] > 0.998) _press[i] = 1;
  }

  for (let i=0;i<2;i++) _volRot[i] += (_volRotTg[i] - _volRot[i]) * 0.40;

  for (let i=0;i<2;i++) {
    const tg  = laserMov[i] ? 1 : 0;
    const spd = tg > _laserMovLp[i] ? 0.40 : 0.28;
    _laserMovLp[i] += (tg - _laserMovLp[i]) * spd;
    if (_laserMovLp[i] < 0.002) _laserMovLp[i] = 0;
    if (_laserMovLp[i] > 0.998) _laserMovLp[i] = 1;
  }

  const cross = laserMov[0] && laserMov[1];
  _crossLp += ((cross ? 1 : 0) - _crossLp) * 0.35;

  _draw();
  _rafId = requestAnimationFrame(_loop);
}

function _startLoop() { if (!_rafId) _rafId = requestAnimationFrame(_loop); }
function _stopLoop()  { if (_rafId)  { cancelAnimationFrame(_rafId); _rafId=null; } }

// ── Window ────────────────────────────────────────────────────────────────────
function _build() {
  const win = document.createElement('div');
  win.id = 'hs-win';
  Object.assign(win.style, {
    position:'fixed', top:'110px', right:'24px', width:(CW+18)+'px',
    background:'#09091a', border:'1px solid #1e1e40', borderRadius:'10px',
    boxShadow:'0 10px 40px rgba(0,0,0,.88)', zIndex:'2500',
    userSelect:'none', display:'flex', flexDirection:'column', overflow:'hidden',
    fontFamily:'"Segoe UI",monospace',
  });
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'6px 12px', background:'#0c0c1c', borderBottom:'1px solid #181830', cursor:'move',
  });
  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:12px;font-weight:700;color:#8890cc;letter-spacing:.05em">✋ Hand Simulator</span>
      <span style="font-size:9px;color:#28284888;font-family:monospace">3D skeletal · FK bones · whole-hand knob grip</span>
    </div>
    <button id="hs-close" style="background:none;border:none;color:#38386066;font-size:15px;cursor:pointer;padding:2px 7px;border-radius:4px;line-height:1">✕</button>`;
  win.appendChild(bar);
  const canv = document.createElement('canvas');
  canv.width = CW; canv.height = CH;
  Object.assign(canv.style, { display:'block', margin:'6px auto 4px', borderRadius:'6px' });
  win.appendChild(canv);
  document.body.appendChild(win);
  _win=win; _canv=canv; _ctx=canv.getContext('2d');
  win.querySelector('#hs-close').addEventListener('click', closeHandSimWindow);
  let drag=false, ox=0, oy=0;
  bar.addEventListener('mousedown', e => { drag=true; ox=e.clientX-win.offsetLeft; oy=e.clientY-win.offsetTop; e.preventDefault(); });
  document.addEventListener('mousemove', e => { if(!drag)return; win.style.left=(e.clientX-ox)+'px'; win.style.top=(e.clientY-oy)+'px'; win.style.right='auto'; });
  document.addEventListener('mouseup', () => { drag=false; });
}

export function openHandSimWindow()  { if(!_win)_build(); _win.style.display='flex'; window._hsVisible=true;  _startLoop(); }
export function closeHandSimWindow() { if(_win)_win.style.display='none';            window._hsVisible=false; _stopLoop();  }
