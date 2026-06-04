
// Ticks per measure at 4/4 (matches KSH resolution)
export const TICKS_PER_MEASURE = 192;
export const BEATS_PER_MEASURE = 4;
export const TICKS_PER_BEAT    = TICKS_PER_MEASURE / BEATS_PER_MEASURE; // 48
// Sketch spec: "any laser ≤ 1/16 point is a SLAM" — 1/16 = 192/16 = 12 ticks
export let LASER_SLAM_TICKS = 12; // mutable — adjusted by Gameplay preferences
export function setLaserSlamTicks(v) { LASER_SLAM_TICKS = v; }
// Minimum horizontal position delta (v is 0..1) for a near-instant laser move to
// count as a SLAM. One laser char step is 1/50 = 0.02, so 0.01 means "any snapped
// horizontal movement". A slam is a horizontal jump — two points must differ in v,
// otherwise a pair of close-but-stationary points is just a redundant anchor.
export const LASER_SLAM_V_EPS = 0.01;

// Lane indices
export const LANE = { LASER_L: 0, BT_A: 1, BT_B: 2, FX_L: 3, FX_R: 4, BT_C: 5, BT_D: 6, LASER_R: 7 };
export const LANE_COUNT = 8;

// Laser position chars (51 steps: 0-9, A-Z, a-o)
export const LASER_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno';

export function laserCharToPos(ch) {
  const i = LASER_CHARS.indexOf(ch);
  return i < 0 ? null : i / (LASER_CHARS.length - 1);
}
export function laserPosToChar(pos) {
  const i = Math.round(Math.max(0, Math.min(1, pos)) * (LASER_CHARS.length - 1));
  return LASER_CHARS[i];
}

// Estimate BPM from a list of tap timestamps (performance.now() ms) by averaging
// the inter-tap intervals. Shared by the Calibration window's Tap Tempo and the
// Tools Hub BPM Sync tool so both stay in lock-step. Returns null with < 2 taps.
export function bpmFromTapTimes(times) {
  if (!times || times.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
  const avg = sum / (times.length - 1);
  return avg > 0 ? 60000 / avg : null;
}

// Single source of truth for chart statistics. Both the Window-menu "Chart
// Statistics" modal and the Tools Hub "Chart Statistics" tool used to carry
// their own near-identical copies of this math; both now call this. Returns a
// superset object so either UI can pick the fields it shows.
export function computeChartStats(chart) {
  if (!chart) return null;
  const TPM = TICKS_PER_MEASURE, TPB = TICKS_PER_BEAT;

  let btChip = 0, btHold = 0;
  for (const lane of chart.bt) for (const n of lane) (n.len > 0 ? btHold++ : btChip++);
  let fxChip = 0, fxHold = 0;
  for (const lane of chart.fx) for (const n of lane) (n.len > 0 ? fxHold++ : fxChip++);

  const segL = chart.lasers[0].length, segR = chart.lasers[1].length;
  let slamL = 0, slamR = 0, pointsL = 0, pointsR = 0;
  [chart.lasers[0], chart.lasers[1]].forEach((side, idx) => {
    for (const sec of side) {
      const pts = sec.points || [];
      if (idx === 0) pointsL += pts.length; else pointsR += pts.length;
      for (let i = 1; i < pts.length; i++) {
        if ((pts[i].ry - pts[i - 1].ry) <= 6) { if (idx === 0) slamL++; else slamR++; }
      }
    }
  });

  const totalNotes = btChip + btHold + fxChip + fxHold;
  const totalMeas  = chart.totalMeasures || 1;
  const totalTicks = totalMeas * TPM;

  // Per-measure note density → peak + spanned-measure average
  const measBuckets = new Array(totalMeas).fill(0);
  const addToBucket = (y) => { const m = Math.floor(y / TPM); if (m >= 0 && m < totalMeas) measBuckets[m]++; };
  for (const lane of chart.bt) for (const n of lane) addToBucket(n.y);
  for (const lane of chart.fx) for (const n of lane) addToBucket(n.y);
  let peak = 0, peakMeas = 0, totalSpanned = 0;
  measBuckets.forEach((c, i) => { if (c > peak) { peak = c; peakMeas = i; } if (c > 0) totalSpanned++; });
  const avgDens = totalSpanned ? (totalNotes / totalSpanned) : 0;

  // Laser coverage % (sum of section lengths / chart length)
  const cov = secs => {
    let c = 0;
    secs.forEach(s => { const lp = s.points[s.points.length - 1]; c += lp?.ry ?? 0; });
    return totalTicks > 0 ? Math.min(100, c / totalTicks * 100) : 0;
  };
  const coverL = cov(chart.lasers[0]), coverR = cov(chart.lasers[1]);

  // Duration estimate from BPM events
  let durSec = 0;
  const events = [...chart.bpmEvents].sort((a, b) => a.y - b.y);
  const endTick = totalMeas * TPM;
  for (let i = 0; i < events.length; i++) {
    const a = events[i].y;
    const b = (i + 1 < events.length) ? events[i + 1].y : endTick;
    durSec += (Math.max(0, b - a) / TPB) * (60 / (events[i].bpm || 120));
  }
  const mm = Math.floor(durSec / 60), ss = Math.floor(durSec % 60);
  const durStr = `${mm}:${String(ss).padStart(2, '0')}`;

  const bs = events.map(e => e.bpm);
  const bpmMin = bs.length ? Math.min(...bs) : 0;
  const bpmMax = bs.length ? Math.max(...bs) : 0;
  const bpmRange = bs.length ? (bpmMin === bpmMax ? bpmMin.toFixed(2) : `${bpmMin.toFixed(2)} – ${bpmMax.toFixed(2)}`) : '—';

  return {
    btChip, btHold, fxChip, fxHold,
    btTotal: btChip + btHold, fxTotal: fxChip + fxHold,
    segL, segR, slamL, slamR, pointsL, pointsR,
    totalNotes, totalMeas, peak, peakMeas, avgDens, durStr, durSec,
    coverL, coverR,
    bpmMin, bpmMax, bpmRange,
    bpmCount: chart.bpmEvents.length,
    sectionCount: (chart.sections || []).length,
  };
}

// ── Quantize / Nudge engine ──────────────────────────────────────────────────
// Shared, side-effect-isolated tick math used by the Tools Hub "Quantize" tool.
// Kept here (not in tools.js) so it can be unit-tested without a DOM, and so any
// future caller (menu, shortcut) uses one source of truth — mirrors the pattern
// established by flipHorizontalRange / computeChartStats.

// Snap a single tick toward the nearest multiple of `step`. `strength` (0..1)
// allows partial / "humanize"-style quantize: 1 = full snap, 0 = no change.
export function quantizeTickValue(tick, step, strength = 1) {
  if (!(step > 0)) return tick;
  const snapped = Math.round(tick / step) * step;
  const s = Math.max(0, Math.min(1, strength));
  return Math.round(tick + (snapped - tick) * s);
}

// Quantize every object whose anchor tick lies in [lo, hi) to the grid defined by
// `step` ticks. Returns the number of objects whose position actually changed.
// opts: { lo, hi, step, strength, bt, fx, lasers, holdEnds }
//  - bt/fx/lasers: include that object class (default true)
//  - holdEnds: also snap the END of BT/FX holds (default true); off = preserve length
// Laser sections keep their first point at ry 0 automatically and stay monotonic.
export function quantizeRange(chart, opts = {}) {
  if (!chart) return 0;
  const lo = opts.lo == null ? -Infinity : opts.lo;
  const hi = opts.hi == null ?  Infinity : opts.hi;
  const step = opts.step;
  if (!(step > 0)) return 0;
  const strength = opts.strength == null ? 1 : opts.strength;
  const doBt = opts.bt !== false, doFx = opts.fx !== false;
  const doLasers = opts.lasers !== false, holdEnds = opts.holdEnds !== false;
  const q = t => quantizeTickValue(t, step, strength);
  let moved = 0;

  const snapNotes = (lanes) => {
    for (const lane of lanes) {
      for (const n of lane) {
        if (n.y < lo || n.y >= hi) continue;
        const ny = q(n.y);
        if (holdEnds && n.len > 0) {
          const end = q(n.y + n.len);
          n.len = Math.max(0, end - ny);
        }
        if (ny !== n.y) moved++;
        n.y = ny;
      }
      lane.sort((a, b) => a.y - b.y);
    }
  };
  if (doBt) snapNotes(chart.bt);
  if (doFx) snapNotes(chart.fx);

  if (doLasers) {
    for (const side of chart.lasers) {
      for (const sec of side) {
        if (sec.y < lo || sec.y >= hi) continue;
        const oldY = sec.y;
        const newY = q(oldY);
        let changed = newY !== oldY;
        let prev = 0;
        for (const pt of sec.points) {
          let nr = q(oldY + pt.ry) - newY;
          if (nr < prev) nr = prev;   // enforce ry >= 0 and non-decreasing order
          if (nr !== pt.ry) changed = true;
          pt.ry = nr;
          prev = nr;
        }
        sec.y = newY;
        if (changed) moved++;
      }
      side.sort((a, b) => a.y - b.y);
    }
  }
  return moved;
}

// Shift every object whose anchor tick lies in [lo, hi) by `delta` ticks (may be
// negative). Anchors are clamped at 0. Laser points are relative to the section
// anchor so only the section `y` moves. Returns the count of shifted objects.
export function nudgeRange(chart, opts = {}) {
  if (!chart || !opts.delta) return 0;
  const lo = opts.lo == null ? -Infinity : opts.lo;
  const hi = opts.hi == null ?  Infinity : opts.hi;
  const delta = opts.delta;
  const doBt = opts.bt !== false, doFx = opts.fx !== false, doLasers = opts.lasers !== false;
  let moved = 0;

  const shiftNotes = (lanes) => {
    for (const lane of lanes) {
      for (const n of lane) {
        if (n.y < lo || n.y >= hi) continue;
        n.y = Math.max(0, n.y + delta);
        moved++;
      }
      lane.sort((a, b) => a.y - b.y);
    }
  };
  if (doBt) shiftNotes(chart.bt);
  if (doFx) shiftNotes(chart.fx);
  if (doLasers) {
    for (const side of chart.lasers) {
      for (const sec of side) {
        if (sec.y < lo || sec.y >= hi) continue;
        sec.y = Math.max(0, sec.y + delta);
        moved++;
      }
      side.sort((a, b) => a.y - b.y);
    }
  }
  return moved;
}

export class ChartData {
  constructor() {
    this.meta = {
      title: '', artist: '', effect: '', illust: '',
      difficulty: 'infinite', level: 10,
      bpm: 180, music: '', offset: 0,
      previewStart: 0, previewDuration: 15000,
      jacket: '', bg: '0', layer: '',
    };
    this.totalMeasures = 64;
    this.laserSettings = { filter: 'peak', gain: 50, wide: false };
    this.camera = { tilt: 'normal', zoomTop: 0, zoomBot: 0, rotation: 0, split: 0 };

    // Note arrays. bt[0..3] = BT-A..D, fx[0..1] = FX-L/R
    // Each note: { y, len } where len=0 is chip
    this.bt = [[], [], [], []];
    this.fx = [[], []];

    // Laser sections. lasers[0]=L, lasers[1]=R
    // Each section: { y, points: [{ry, v}], wide }
    // ry = relative tick from section start, v = 0..1 position
    this.lasers = [[], []];

    // BPM events: { y, bpm }
    this.bpmEvents = [{ y: 0, bpm: 180 }];

    // Time signature events: { measure, num, den }
    this.timeSigEvents = [{ measure: 0, num: 4, den: 4 }];

    // FX effect chains: [L-chain[], R-chain[]]
    this.fxChains = [[], []];

    // Camera animation events: [{ y, type, value }]
    // type: 'zoom_top' | 'zoom_bottom' | 'zoom_side' | 'tilt' | 'lane_toggle' | 'center_split'
    this.cameraEvents = [];

    // Stop events: [{ y, len }]  len in ticks
    this.stopEvents = [];

    // Chart Velocity (visual scroll speed multiplier).
    // Affects how fast notes/lasers travel down the lane in the 3D preview;
    // does NOT change BPM or chart timing. Multiplier of 1.0 = default speed,
    // 2.0 = twice as fast, 0.5 = half speed. Notes BEFORE a velocity-change
    // event keep their previous speed; notes after run at the new speed.
    this.scrollSpeedEvents = [{ y: 0, speed: 1.0 }];

    // Glitch intensity events. Each: { y: tick, level: 0-10 }
    // level 0 = no glitch, 1-10 = increasing intensity.
    // Sampled at playback time to drive PowerGlitch dynamically.
    this.glitchEvents = [{ y: 0, level: 0 }];

    // Chart Section Labels. Each: { y: startTick, endY: endTick, label: string, color: string }
    // Stored as _sections in KSON custom extension field.
    this.sections = [];
  }

  // Returns the effective scroll speed multiplier at tick y, supporting
  // linear interpolation between consecutive events.
  // Each event's .interp field ('step' | 'linear', default 'step') describes
  // the transition FROM that event TO the next one.
  getScrollSpeedAt(y) {
    const evs = this.scrollSpeedEvents;
    if (!evs || !evs.length) return 1.0;
    for (let i = 0; i < evs.length - 1; i++) {
      const ev0 = evs[i], ev1 = evs[i + 1];
      if (y < ev1.y) {
        if ((ev0.interp ?? 'step') === 'linear' && ev1.y > ev0.y) {
          const t = (y - ev0.y) / (ev1.y - ev0.y);
          return ev0.speed + t * (ev1.speed - ev0.speed);
        }
        return ev0.speed;
      }
    }
    return evs[evs.length - 1].speed;
  }

  // Integrated visual scroll distance from tick 0 to y.
  // Uses trapezoidal integration for linear segments, rectangular for step.
  scrollDistanceTo(y) {
    const evs = this.scrollSpeedEvents;
    if (!evs || evs.length === 0) return y;
    let dist = 0;
    for (let i = 0; i < evs.length - 1; i++) {
      const ev0 = evs[i], ev1 = evs[i + 1];
      if (ev1.y >= y) {
        // y falls within this segment
        const seg = y - ev0.y;
        if ((ev0.interp ?? 'step') === 'linear' && ev1.y > ev0.y) {
          const t = seg / (ev1.y - ev0.y);
          const speedAtY = ev0.speed + t * (ev1.speed - ev0.speed);
          dist += (ev0.speed + speedAtY) / 2 * seg;
        } else {
          dist += ev0.speed * seg;
        }
        return dist;
      }
      // Complete segment
      if ((ev0.interp ?? 'step') === 'linear') {
        dist += (ev0.speed + ev1.speed) / 2 * (ev1.y - ev0.y);
      } else {
        dist += ev0.speed * (ev1.y - ev0.y);
      }
    }
    // y is beyond all events
    dist += evs[evs.length - 1].speed * (y - evs[evs.length - 1].y);
    return dist;
  }

  // dt-equivalent distance from `from` (default playhead) to `to`.
  scrollDistanceBetween(to, from) {
    return this.scrollDistanceTo(to) - this.scrollDistanceTo(from);
  }

  // interp: 'step' | 'linear' — transition FROM this event TO the next.
  addScrollSpeedEvent(y, speed, interp = 'step') {
    if (!Number.isFinite(speed) || speed <= 0) return;
    if (!Array.isArray(this.scrollSpeedEvents)) this.scrollSpeedEvents = [];
    // Preserve existing interp when replacing an event at the same tick
    const existing = this.scrollSpeedEvents.find(e => e.y === y);
    const resolvedInterp = interp ?? existing?.interp ?? 'step';
    this.scrollSpeedEvents = this.scrollSpeedEvents.filter(e => e.y !== y);
    this.scrollSpeedEvents.push({ y, speed, interp: resolvedInterp });
    this.scrollSpeedEvents.sort((a, b) => a.y - b.y);
    if (!this.scrollSpeedEvents.length || this.scrollSpeedEvents[0].y !== 0) {
      this.scrollSpeedEvents.unshift({ y: 0, speed: 1.0, interp: 'step' });
    }
  }

  removeScrollSpeedEvent(y) {
    if (y === 0) return; // anchor event at tick 0 is required
    this.scrollSpeedEvents = (this.scrollSpeedEvents || []).filter(e => e.y !== y);
  }

  // Set the interpolation type for the segment starting at tick y.
  setScrollSpeedInterp(y, interp) {
    const ev = (this.scrollSpeedEvents || []).find(e => e.y === y);
    if (ev) ev.interp = interp === 'linear' ? 'linear' : 'step';
  }

  // ── Glitch events ────────────────────────────────────────────────────────

  addGlitchEvent(y, level) {
    if (!Array.isArray(this.glitchEvents)) this.glitchEvents = [];
    this.glitchEvents = this.glitchEvents.filter(e => e.y !== y);
    this.glitchEvents.push({ y, level: Math.max(0, Math.min(10, level)) });
    this.glitchEvents.sort((a, b) => a.y - b.y);
    if (!this.glitchEvents.length || this.glitchEvents[0].y !== 0) {
      this.glitchEvents.unshift({ y: 0, level: 0 });
    }
  }

  removeGlitchEvent(y) {
    if (y === 0) return;
    this.glitchEvents = (this.glitchEvents || []).filter(e => e.y !== y);
  }

  getGlitchLevelAt(y) {
    const evs = this.glitchEvents;
    if (!evs || !evs.length) return 0;
    let last = evs[0];
    for (const ev of evs) {
      if (ev.y > y) break;
      last = ev;
    }
    return last.level;
  }

  // Convert measure+beat (0-indexed) to tick
  measureBeatToTick(measure, beat = 0, subbeat = 0) {
    return measure * TICKS_PER_MEASURE + beat * TICKS_PER_BEAT + subbeat;
  }

  tickToMeasure(y) { return Math.floor(y / TICKS_PER_MEASURE); }
  tickToBeat(y)    { return Math.floor((y % TICKS_PER_MEASURE) / TICKS_PER_BEAT); }

  totalTicks() { return this.totalMeasures * TICKS_PER_MEASURE; }

  getBpmAt(y) {
    let bpm = this.bpmEvents[0]?.bpm ?? 120;
    for (const ev of this.bpmEvents) {
      if (ev.y <= y) bpm = ev.bpm;
      else break;
    }
    return bpm;
  }

  addBtNote(laneIdx, y, len = 0) {
    const arr = this.bt[laneIdx];
    this._removeOverlap(arr, y, len);
    arr.push({ y, len });
    arr.sort((a, b) => a.y - b.y);
  }

  addFxNote(laneIdx, y, len = 0) {
    const arr = this.fx[laneIdx];
    this._removeOverlap(arr, y, len);
    arr.push({ y, len });
    arr.sort((a, b) => a.y - b.y);
  }

  removeNote(arr, y) {
    const idx = arr.findIndex(n => n.y === y || (n.len > 0 && y >= n.y && y <= n.y + n.len));
    if (idx >= 0) arr.splice(idx, 1);
  }

  _removeOverlap(arr, y, len) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const n = arr[i];
      const nEnd = n.y + Math.max(n.len, 1);
      const newEnd = y + Math.max(len, 1);
      if (n.y < newEnd && nEnd > y) arr.splice(i, 1);
    }
  }

  // isSlam:  explicit slam flag (set by KSH/KSON import when adjacent laser chars
  //          detected). Pass the string 'auto' to auto-detect a slam from the gap
  //          to the previous point — this is what the drag/pen tools use so that
  //          placing a laser horizontally (a near-instant left/right move) is
  //          registered as a slam, the way Sound Voltex does it.
  // forceNew: always start a new section (used after a '-' gap in the source format)
  // interp:  outgoing interpolation type FROM this point to the next:
  //          'linear' | 'bezier' | 'step'  (defaults to 'linear')
  // curve:   bezier curve parameter 0-1 (0.5 = symmetric S-curve, default)
  addLaserPoint(side, y, v, isSlam = false, forceNew = false,
                interp = 'linear', curve = 0.5) {
    const arr = this.lasers[side];

    if (!forceNew) {
      // Find the most-recent section whose last tick is close enough to continue.
      // Iterate in reverse so we pick the LATEST section (not the oldest one).
      const CONNECT_THRESHOLD = 192; // 1 full measure — generous threshold for drag-tool continuity
      let section = null;
      for (let i = arr.length - 1; i >= 0; i--) {
        const s = arr[i];
        const last = s.points[s.points.length - 1];
        const lastTick = s.y + last.ry;
        if (lastTick <= y && y - lastTick <= CONNECT_THRESHOLD) {
          section = s; break;
        }
      }
      if (section) {
        const prev = section.points[section.points.length - 1];
        let slamFlag = isSlam;
        if (isSlam === 'auto') {
          // Horizontal placement = slam: small time gap + real position change.
          const dt = y - (section.y + prev.ry);
          slamFlag = (dt >= 0) && (dt <= LASER_SLAM_TICKS) &&
                     (Math.abs(v - prev.v) > LASER_SLAM_V_EPS);
        }
        let ry = y - section.y;
        // A slam needs two points at DISTINCT pulses (a same-pulse pair is
        // ambiguous and breaks KSON export). If a slam lands on/before the
        // previous point's tick, nudge it a hair later — the importer convention.
        if (slamFlag && ry <= prev.ry) {
          ry = prev.ry + Math.max(1, Math.floor(LASER_SLAM_TICKS / 2));
        }
        // A slam jumps instantly, so the previous point holds its value until the
        // jump — mark its outgoing interp as 'step' (matches import/export).
        if (slamFlag && prev.interp === 'linear') prev.interp = 'step';
        section.points.push({ ry, v, slam: slamFlag, interp, curve });
        return;
      }
    }

    // Start a new section
    const section = {
      y,
      points: [{ ry: 0, v, slam: false, interp: 'linear', curve: 0.5 }],
      wide: this.laserSettings.wide,
    };
    arr.push(section);
    arr.sort((a, b) => a.y - b.y);
  }

  // ── Auto-connect adjacent laser sections ──────────────────────────────────
  // When the END of one section coincides with the START of the next (same
  // absolute tick within tickEps, same position within LASER_SLAM_V_EPS), the
  // two are really one continuous laser that happened to be authored as two
  // pieces. Merge them so the path is continuous — whether the junction is a
  // slam, a smooth/bezier curve, or a normal segment. This mirrors how SDVX /
  // KSON treats touching laser segments as a single connected laser.
  //
  // Returns the number of merges performed (0 if nothing changed).
  autoConnectLasers(side, tickEps = 1) {
    const arr = this.lasers[side];
    if (!arr || arr.length < 2) return 0;
    arr.sort((a, b) => a.y - b.y);

    let merges = 0;
    let i = 0;
    while (i < arr.length - 1) {
      const a = arr[i], b = arr[i + 1];
      if (!a.points.length || !b.points.length) { i++; continue; }

      const aLast    = a.points[a.points.length - 1];
      const aLastTick = a.y + aLast.ry;
      const bFirst   = b.points[0];
      const bFirstTick = b.y + bFirst.ry;

      const touching = Math.abs(bFirstTick - aLastTick) <= tickEps;
      const sameV    = Math.abs(bFirst.v - aLast.v) <= LASER_SLAM_V_EPS;

      if (touching && sameV) {
        // Append b's points (after its first, which duplicates a's last) onto a,
        // rebasing their ry to a's origin. Preserve interp/curve/slam flags.
        for (let pi = 1; pi < b.points.length; pi++) {
          const p = b.points[pi];
          a.points.push({
            ry:    (b.y + p.ry) - a.y,
            v:     p.v,
            slam:  p.slam,
            interp: p.interp ?? 'linear',
            curve:  p.curve  ?? 0.5,
          });
        }
        a.wide = a.wide || b.wide;
        // Preserve an active-draw / mirror reference tag if `b` carried one so
        // callers can re-point their section references to the survivor `a`.
        if (b.__keep && !a.__keep) a.__keep = b.__keep;
        arr.splice(i + 1, 1); // remove b; re-test a against the new next section
        merges++;
      } else {
        i++;
      }
    }
    return merges;
  }

  // ── Slam query interface ─────────────────────────────────────────────────
  // Returns all slam events for one laser side as first-class structured objects:
  //   { y, endY, startV, endV, side }
  // Priority: explicit .slam===true flag (preserved through import/export) first,
  // then tick-distance heuristic for externally-created points that lack the flag.
  // Points explicitly marked .slam===false are never slams (not subject to heuristic).
  getSlamEvents(side, threshold = LASER_SLAM_TICKS) {
    const results = [];
    for (const sec of this.lasers[side]) {
      for (let pi = 1; pi < sec.points.length; pi++) {
        const p0 = sec.points[pi - 1], p1 = sec.points[pi];
        let isSlam = false;
        if (p1.slam === true) {
          isSlam = true;                          // explicit flag (editor import)
        } else if (p1.slam !== false) {
          // heuristic fallback (legacy data lacking an explicit flag): close in
          // time AND an actual horizontal jump
          isSlam = (p1.ry - p0.ry) <= threshold &&
                   Math.abs(p1.v - p0.v) > LASER_SLAM_V_EPS;
        }
        if (isSlam) {
          results.push({ y: sec.y + p0.ry, endY: sec.y + p1.ry,
                         startV: p0.v, endV: p1.v, side });
        }
      }
    }
    return results;
  }

  // Lightweight per-point slam predicate used by renderers.
  // Equivalent to the inline expressions in game.js / renderer.js but consistent.
  static isPointSlam(p0, p1, threshold = LASER_SLAM_TICKS) {
    if (p1.slam === true)  return true;
    if (p1.slam === false) return false;      // explicit non-slam wins over heuristic
    return (p1.ry - p0.ry) <= threshold &&
           Math.abs(p1.v - p0.v) > LASER_SLAM_V_EPS;
  }

  removeLaserAt(side, y) {
    const arr = this.lasers[side];
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      const end = s.y + (s.points[s.points.length - 1]?.ry ?? 0);
      if (y >= s.y && y <= end) { arr.splice(i, 1); return; }
    }
  }

  addBpmEvent(y, bpm) {
    this.bpmEvents = this.bpmEvents.filter(e => e.y !== y);
    this.bpmEvents.push({ y, bpm });
    this.bpmEvents.sort((a, b) => a.y - b.y);
  }

  addTimeSigEvent(measure, num, den) {
    this.timeSigEvents = this.timeSigEvents.filter(e => e.measure !== measure);
    this.timeSigEvents.push({ measure, num, den });
    this.timeSigEvents.sort((a, b) => a.measure - b.measure);
  }
}
