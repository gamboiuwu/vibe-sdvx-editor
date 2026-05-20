
// Ticks per measure at 4/4 (matches KSH resolution)
export const TICKS_PER_MEASURE = 192;
export const BEATS_PER_MEASURE = 4;
export const TICKS_PER_BEAT    = TICKS_PER_MEASURE / BEATS_PER_MEASURE; // 48
// Sketch spec: "any laser ≤ 1/16 point is a SLAM" — 1/16 = 192/16 = 12 ticks
export let LASER_SLAM_TICKS = 12; // mutable — adjusted by Gameplay preferences

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

  // isSlam:  explicit slam flag (set by KSH/KSON import when adjacent laser chars detected)
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
        section.points.push({ ry: y - section.y, v, slam: isSlam, interp, curve });
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
          isSlam = (p1.ry - p0.ry) <= threshold; // heuristic fallback (drag tool, etc.)
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
    return (p1.ry - p0.ry) <= threshold;
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
