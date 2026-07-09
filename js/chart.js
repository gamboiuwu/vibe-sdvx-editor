
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

// ── Groove / Swing Quantize ──────────────────────────────────────────────────
// Built-in groove templates. Each entry is a per-step offset table: value[i] is
// a fractional offset of ONE grid step applied to the step whose snapped index
// (mod the table length) is i. Index 0 is the on-grid / downbeat step and stays
// at 0 so strong beats never drift. Positive = push later, negative = pull
// earlier. e.g. at a 1/8 grid, [0, 0.33] pushes every off-eighth a third of a
// step late → a triplet "swing" feel.
export const GROOVE_PRESETS = {
  'straight':      [0, 0],
  'swing-light':   [0, 0.15],
  'swing-med':     [0, 0.25],
  'swing-heavy':   [0, 0.33],
  'shuffle':       [0, 0.50],
  'reverse-swing': [0, -0.15],
};

// Snap `tick` to the `step` grid, then apply a cyclic per-step groove offset.
// `pattern` is an array of fractional step offsets (see GROOVE_PRESETS). The
// step index is taken from the SNAPPED position so a note always picks the same
// groove slot regardless of which side it rounded from. `strength` blends the
// original tick toward the groove target (0 = unchanged, 1 = full groove).
export function grooveTickValue(tick, step, pattern, strength = 1) {
  if (!(step > 0)) return tick;
  const snapped = Math.round(tick / step) * step;
  let off = 0;
  if (Array.isArray(pattern) && pattern.length) {
    const n = pattern.length;
    const idx = ((Math.round(snapped / step) % n) + n) % n;
    off = (pattern[idx] || 0) * step;
  }
  const target = snapped + off;
  const s = Math.max(0, Math.min(1, strength));
  return Math.round(tick + (target - tick) * s);
}

// Apply a groove template to every object whose anchor tick lies in [lo, hi).
// Mirrors quantizeRange's range/target plumbing exactly — the only difference
// is the snap function (grooveTickValue instead of a plain grid round). Returns
// the number of objects whose position actually changed.
// opts: { lo, hi, step, pattern, strength, bt, fx, lasers, holdEnds }
export function grooveQuantizeRange(chart, opts = {}) {
  if (!chart) return 0;
  const lo = opts.lo == null ? -Infinity : opts.lo;
  const hi = opts.hi == null ?  Infinity : opts.hi;
  const step = opts.step;
  if (!(step > 0)) return 0;
  const pattern = Array.isArray(opts.pattern) ? opts.pattern : [];
  // No groove offsets at all → nothing to do (pure straight grid is Quantize's job).
  if (!pattern.some(v => v)) return 0;
  const strength = opts.strength == null ? 1 : opts.strength;
  const doBt = opts.bt !== false, doFx = opts.fx !== false;
  const doLasers = opts.lasers !== false, holdEnds = opts.holdEnds !== false;
  const g = t => grooveTickValue(t, step, pattern, strength);
  let moved = 0;

  const snapNotes = (lanes) => {
    for (const lane of lanes) {
      for (const n of lane) {
        if (n.y < lo || n.y >= hi) continue;
        const ny = g(n.y);
        if (holdEnds && n.len > 0) {
          const end = g(n.y + n.len);
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
        const newY = g(oldY);
        let changed = newY !== oldY;
        let prev = 0;
        for (const pt of sec.points) {
          let nr = g(oldY + pt.ry) - newY;
          if (nr < prev) nr = prev;   // ry >= 0 and non-decreasing, as in quantizeRange
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

// ── Stop-event quick-tool engine ───────────────────────────────────────────────
// Stop (beat-stop) events are { y: tick, len: ticks } in editor ticks, kept
// sorted by y. These DOM-free helpers are the single source of truth for the
// Stop-Event Quick Tools (Tools Hub → Edit), mirroring how quantize/groove keep
// their math here so it can be unit-tested without a browser. The Stop Events
// panel's own one-at-a-time add/delete path is unaffected.

// The last meaningful tick in a chart (end of the latest note/hold/laser/stop),
// used to bound "entire chart" stop operations. Returns 0 for an empty chart.
export function chartLastTick(chart) {
  if (!chart) return 0;
  let max = 0;
  const bump = t => { if (isFinite(t) && t > max) max = t; };
  for (const lane of (chart.bt ?? [])) for (const n of lane) bump(n.y + (n.len ?? 0));
  for (const lane of (chart.fx ?? [])) for (const n of lane) bump(n.y + (n.len ?? 0));
  for (const side of (chart.lasers ?? [])) for (const sec of side) {
    const last = sec.points?.[sec.points.length - 1];
    bump(sec.y + (last?.ry ?? 0));
  }
  for (const ev of (chart.stopEvents ?? [])) bump(ev.y + (ev.len ?? 0));
  return max;
}

// Insert one stop at `tick` lasting `len` ticks. If a stop already exists at the
// exact tick, its length is updated when replace=true, else the call is a no-op.
// Returns true iff the array changed. Keeps stopEvents sorted by y.
export function insertStopEvent(chart, tick, len, replace = true) {
  if (!chart) return false;
  if (!isFinite(tick) || tick < 0 || !isFinite(len) || len <= 0) return false;
  chart.stopEvents = chart.stopEvents ?? [];
  const existing = chart.stopEvents.find(e => e.y === tick);
  if (existing) {
    if (!replace || existing.len === len) return false;
    existing.len = len;
    return true;
  }
  chart.stopEvents.push({ y: tick, len });
  chart.stopEvents.sort((a, b) => a.y - b.y);
  return true;
}

// Add stops at a regular tick interval across [lo, hi). Each lasts `len` ticks.
// lo/hi may be -Infinity/Infinity to mean the whole chart (walked from 0 to the
// last object tick). Stops are aligned to multiples of `intervalTicks` so e.g. a
// one-measure interval lands exactly on each downbeat. Returns the count added.
export function addStopsAtInterval(chart, lo, hi, intervalTicks, len, replace = true) {
  if (!chart) return 0;
  if (!(intervalTicks > 0) || !isFinite(intervalTicks)) return 0;
  if (!(len > 0) || !isFinite(len)) return 0;
  chart.stopEvents = chart.stopEvents ?? [];
  let from = isFinite(lo) ? lo : 0;
  let to   = isFinite(hi) ? hi : chartLastTick(chart) + 1;
  if (from < 0) from = 0;
  if (to <= from) return 0;
  const start = Math.ceil(from / intervalTicks) * intervalTicks;
  let added = 0;
  for (let t = start; t < to; t += intervalTicks) {
    if (insertStopEvent(chart, t, len, replace)) added++;
  }
  return added;
}

// Remove every stop whose start tick is within [lo, hi). Defaults clear all.
// Returns the number removed.
export function clearStopEvents(chart, lo = -Infinity, hi = Infinity) {
  if (!chart) return 0;
  const evs = chart.stopEvents ?? [];
  const before = evs.length;
  chart.stopEvents = evs.filter(e => !(e.y >= lo && e.y < hi));
  return before - chart.stopEvents.length;
}

// ── Metronome / click-track beat grid ───────────────────────────────────────
// Return every beat-grid boundary whose tick falls in the half-open range
// (fromTick, toTick] — exactly the boundaries CROSSED while the playhead
// advances from fromTick to toTick during one playback frame. Each entry is
// { tick, isDownbeat, beatInMeasure, sub } where sub>0 marks a sub-beat click
// (never a downbeat). The grid respects the chart's time-signature changes
// (chart.timeSigEvents = [{measure,num,den}, ...], keyed by measure index):
// a measure in num/den has `num` beats, each TICKS_PER_MEASURE/den ticks long,
// and beat 0 of each measure is the accented downbeat.
//   div = clicks PER beat (1 = on each beat, 2 = eighths, 3 = triplets, 4 = 16ths).
// DOM-free + pure so it can be unit-tested as the single source of truth for
// the Game-Preview metronome.
export function beatGridCrossings(chart, fromTick, toTick, div = 1) {
  const out = [];
  if (!chart) return out;
  if (!(toTick > fromTick)) return out;            // no forward motion → no clicks
  div = Math.max(1, Math.round(div) || 1);
  const sigs = (chart.timeSigEvents && chart.timeSigEvents.length
    ? chart.timeSigEvents.slice()
    : [{ measure: 0, num: 4, den: 4 }]).sort((a, b) => a.measure - b.measure);

  let measureStart = 0;     // tick at the start of the current measure
  let measureIdx   = 0;     // 0-based measure index
  let sigPtr       = 0;
  let guard        = 0;
  const GUARD_MAX  = 5_000_000;
  while (measureStart <= toTick && guard++ < GUARD_MAX) {
    while (sigPtr + 1 < sigs.length && sigs[sigPtr + 1].measure <= measureIdx) sigPtr++;
    const sig = sigs[sigPtr];
    const num = Math.max(1, sig.num | 0);
    const den = Math.max(1, sig.den | 0);
    const beatLen   = TICKS_PER_MEASURE * 4 / den / 4;   // ticks per (1/den) beat
    const subLen    = beatLen / div;
    const measureLen = beatLen * num;
    for (let b = 0; b < num; b++) {
      for (let s = 0; s < div; s++) {
        const tick = measureStart + b * beatLen + s * subLen;
        if (tick > fromTick && tick <= toTick) {
          out.push({ tick, isDownbeat: b === 0 && s === 0, beatInMeasure: b, sub: s });
        }
      }
    }
    measureStart += measureLen;
    measureIdx++;
    if (measureLen <= 0) break;   // pathological sig — avoid an infinite loop
  }
  return out;
}

// ── Metronome count-in lead-in grid ─────────────────────────────────────────
// Compute the click-only lead-in that precedes playback when Count-In is on.
// Returns { durationSec, beatsPerMeasure, beatLen, clicks: [...] } where each
// click is { offsetSec, isDownbeat, isBeat, beatNo, totalBeats } and offsetSec is
// measured from the START of the lead-in (0..durationSec). The tempo + time
// signature used are the ones ACTIVE at startTick, so the count matches the music
// the chartist is about to hear. `measures` bars of `div` clicks-per-beat are
// produced (div=1 → one click per beat). Pure + DOM-free so it is the single,
// unit-testable source of truth for the Game-Preview count-in (mirrors
// beatGridCrossings, which drives the in-playback click).
export function countInGrid(chart, startTick, measures, div = 1) {
  const empty = { durationSec: 0, beatsPerMeasure: 4, beatLen: TICKS_PER_BEAT, clicks: [] };
  if (!chart || !(measures > 0)) return empty;
  measures = Math.max(1, Math.round(measures) || 0);
  div = Math.max(1, Math.round(div) || 1);
  // Resolve the time signature active at startTick by walking measures forward.
  const sigs = (chart.timeSigEvents && chart.timeSigEvents.length
    ? chart.timeSigEvents.slice()
    : [{ measure: 0, num: 4, den: 4 }]).sort((a, b) => a.measure - b.measure);
  const tgt = Math.max(0, startTick || 0);
  let measureStart = 0, measureIdx = 0, sigPtr = 0, guard = 0;
  let num = 4, den = 4, beatLen = TICKS_PER_BEAT;
  while (guard++ < 5_000_000) {
    while (sigPtr + 1 < sigs.length && sigs[sigPtr + 1].measure <= measureIdx) sigPtr++;
    num = Math.max(1, sigs[sigPtr].num | 0);
    den = Math.max(1, sigs[sigPtr].den | 0);
    beatLen = TICKS_PER_MEASURE * 4 / den / 4;       // ticks per (1/den) beat
    const measureLen = beatLen * num;
    if (measureLen <= 0) break;
    if (tgt < measureStart + measureLen) break;       // startTick lives in this measure
    measureStart += measureLen; measureIdx++;
  }
  const bpm = ((typeof chart.getBpmAt === 'function' ? chart.getBpmAt(startTick) : null)
    || chart.meta?.bpm || 120) || 120;
  const secPerTick = (60 / bpm) / TICKS_PER_BEAT;
  const subLen     = beatLen / div;
  const totalBeats = measures * num;
  const totalClicks = totalBeats * div;
  const clicks = [];
  for (let k = 0; k < totalClicks; k++) {
    clicks.push({
      offsetSec : k * subLen * secPerTick,
      isBeat    : (k % div) === 0,
      isDownbeat: (k % (num * div)) === 0,
      beatNo    : Math.floor(k / div) + 1,
      totalBeats,
    });
  }
  return { durationSec: totalBeats * beatLen * secPerTick, beatsPerMeasure: num, beatLen, clicks };
}

// ── Metronome visual beat-flash decay ────────────────────────────────────────
// Pure, DOM-free decay curve for the Game-Preview on-beat flash — the VISUAL
// companion to the audible metronome (a click-track you can read by eye). Given
// the time elapsed since a beat was crossed and a decay window (both seconds),
// return a 0..1 intensity with an instant attack and a quadratic ease-out tail;
// 0 outside the window. The renderer just multiplies a judgment-line glow by
// this value, so this is the single unit-testable source of truth for the flash
// envelope (mirrors beatGridCrossings / countInGrid).
export function beatFlashIntensity(secondsSinceBeat, decaySec) {
  if (!(secondsSinceBeat >= 0) || !(decaySec > 0)) return 0;
  const t = secondsSinceBeat / decaySec;
  if (t >= 1) return 0;
  const u = 1 - t;
  return u * u;            // ease-out (quadratic) tail
}

// ── Preview Gameplay Modifiers (non-destructive MODs) ─────────────────────────
// Pure, DOM-free lane-remap descriptors for the Game-Preview MOD system — the
// render-only equivalent of arcade SDVX play options (MIRROR / RANDOM / S-RANDOM).
// The chart data is NEVER touched; the renderer reads notes through the map this
// returns, so a chartist can audition how a pattern reads flipped or shuffled
// without committing a destructive edit. Single unit-testable source of truth
// (joins beatGridCrossings / countInGrid / beatFlashIntensity).
//
// Returns { bt:[4], fx:[2], laserSwap, laserInvert } where:
//   bt[L] = the DISPLAY column that source BT lane L (0=A..3=D) is drawn in
//   fx[L] = the DISPLAY column that source FX lane L (0=L,1=R) is drawn in
//   laserSwap   = swap VOL-L / VOL-R sides
//   laserInvert = mirror laser positions horizontally (v → 1−v)
// All four output arrays/flags are guaranteed valid permutations/booleans.

// Deterministic 32-bit PRNG (mulberry32) so RANDOM/S-RANDOM are reproducible
// from a seed — same seed always yields the same shuffle (testable, savable).
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded Fisher–Yates permutation of [0..n-1].
export function seededPermutation(n, seed) {
  const rng = mulberry32(seed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Like seededPermutation but guarantees the result is NOT the identity (used by
// S-RANDOM, where leaving a lane in place defeats the purpose). Re-rolls with a
// derived seed until at least one lane moves; n<2 trivially returns identity.
export function seededDerangedPermutation(n, seed) {
  if (n < 2) return Array.from({ length: n }, (_, i) => i);
  let s = (seed >>> 0) || 1;
  for (let guard = 0; guard < 16; guard++) {
    const p = seededPermutation(n, s);
    if (p.some((v, i) => v !== i)) return p;
    s = (s + 0x9E3779B9) >>> 0;
  }
  // Fallback: a guaranteed non-identity rotation by one.
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

export function previewModMaps(mod, seed = 1) {
  const ID = { bt: [0, 1, 2, 3], fx: [0, 1], laserSwap: false, laserInvert: false };
  switch (mod) {
    case 'mirror':
      // Left↔right reflection: BT A↔D / B↔C, FX L↔R, lasers swap + invert.
      return { bt: [3, 2, 1, 0], fx: [1, 0], laserSwap: true, laserInvert: true };
    case 'random':
      // Seeded BT lane shuffle; FX/lasers untouched (matches arcade RANDOM).
      return { bt: seededPermutation(4, seed), fx: [0, 1], laserSwap: false, laserInvert: false };
    case 'sran': {
      // Stronger shuffle: BT guaranteed to move, plus a seed-driven FX swap.
      const bt = seededDerangedPermutation(4, seed);
      const fxSwap = mulberry32((seed >>> 0) + 0x1234)() < 0.5;
      return { bt, fx: fxSwap ? [1, 0] : [0, 1], laserSwap: false, laserInvert: false };
    }
    case 'off':
    default:
      return ID;
  }
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

  // ── Tick → real-time (seconds) ─────────────────────────────────────────────
  // Integrates bpmEvents to return the elapsed musical time, in seconds, from
  // tick 0 to `tick` (BPM-only — stops and scroll-speed events are NOT applied,
  // matching the constant-scroll C-Mode use below). DOM-free single source of
  // truth used by the Game-Preview C-Mode (constant scroll). Mirrors the audio
  // path's tickToSeconds() in app.js but is bound to this chart so it can be
  // unit-tested and reused without the global `chart`.
  tickToSeconds(tick) {
    const evs = (Array.isArray(this.bpmEvents) && this.bpmEvents.length)
              ? this.bpmEvents : [{ y: 0, bpm: 120 }];
    let seconds  = 0;
    let prevTick = 0;
    let prevBpm  = Math.max(1, evs[0]?.bpm || 120);
    for (const ev of evs) {
      if (ev.y >= tick) break;
      seconds  += (ev.y - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
      prevTick  = ev.y;
      prevBpm   = Math.max(1, ev.bpm || 120);
    }
    seconds += (tick - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
    return seconds;
  }

  // Signed real-time delta (seconds) between two ticks (b - a).
  secondsBetween(a, b) { return this.tickToSeconds(b) - this.tickToSeconds(a); }

  // ── Reaction window (green number) ─────────────────────────────────────────
  // Milliseconds a note is on screen while it travels the visible field —
  // `visibleTicks` reference ticks of scroll distance (GameView.VISIBLE_TICKS) —
  // at tempo `bpm`, scaled by the practice playback `rate` (0.5× DOUBLES the
  // reading time because the lane scrolls half as fast in real time). This is
  // the rhythm-game "green number": lower = less time to react (harder). DOM-free
  // single source of truth for the Game-Preview reaction-time readout. In C-Mode
  // pass the constant reference BPM so the number stays FIXED across soflan; in
  // M-Mode pass getBpmAt(playhead) so it tracks the local tempo live.
  reactionWindowMs(visibleTicks, bpm, rate = 1) {
    const vt = Math.max(0, Number(visibleTicks) || 0);
    const b  = Math.max(1, Number(bpm) || 120);
    const r  = Math.max(0.01, Number(rate) || 1);
    return vt / TICKS_PER_BEAT * (60 / b) * 1000 / r;
  }

  // ── Target green number → HiSpeed (float hi-speed) ─────────────────────────
  // Exact inverse of reactionWindowMs: the HiSpeed multiplier that makes a note
  // stay on screen for `targetMs` milliseconds at tempo `bpm` and practice
  // `rate`. The preview's visible span is (TICKS_PER_MEASURE*4 / hispeed) ticks,
  // so with reactionWindowMs = visibleTicks/TICKS_PER_BEAT · 60000/bpm / rate,
  // solving for hispeed gives the closed form below. This is the IIDX
  // "float hi-speed" workflow — pick a reading window and derive the speed.
  // DOM-free single source of truth; guards mirror reactionWindowMs so bad
  // input returns 0 rather than NaN/Infinity. The caller clamps to the slider.
  hispeedForReactionMs(targetMs, bpm, rate = 1) {
    const ms = Number(targetMs);
    const b  = Math.max(1, Number(bpm) || 120);
    const r  = Math.max(0.01, Number(rate) || 1);
    if (!(ms > 0)) return 0;
    const fullSpanTicks = TICKS_PER_MEASURE * 4;          // VISIBLE_TICKS at hispeed = 1
    const visibleTicks  = ms * r * b * TICKS_PER_BEAT / 60000;
    if (!(visibleTicks > 0)) return 0;
    return fullSpanTicks / visibleTicks;
  }

  // ── Dominant BPM ───────────────────────────────────────────────────────────
  // Returns the tempo (BPM) that plays for the greatest total time across the
  // whole chart — the natural reference for C-Mode so the bulk of a soflan
  // chart scrolls at its "main" speed. With a single BPM this is just that BPM.
  dominantBpm() {
    const evs = (Array.isArray(this.bpmEvents) && this.bpmEvents.length)
              ? [...this.bpmEvents].sort((p, q) => p.y - q.y) : [{ y: 0, bpm: 120 }];
    const end = Math.max(this.totalTicks?.() || 0, evs[evs.length - 1].y + TICKS_PER_BEAT);
    const dur = new Map();   // bpm → total ticks at that bpm
    for (let i = 0; i < evs.length; i++) {
      const a = evs[i].y;
      const b = (i + 1 < evs.length) ? evs[i + 1].y : end;
      const span = Math.max(0, b - a);
      const bpm  = Math.max(1, evs[i].bpm || 120);
      dur.set(bpm, (dur.get(bpm) || 0) + span);
    }
    let best = evs[0].bpm || 120, bestDur = -1;
    for (const [bpm, d] of dur) {
      if (d > bestDur) { bestDur = d; best = bpm; }
    }
    return Math.max(1, best);
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

  // ── Laser range slicing (cut / copy / delete a portion of a laser) ────────
  // Laser sections are atomic-by-start in the naive model, which is wrong for
  // range edits: selecting part of a laser must trim or split the section, not
  // drop the whole thing. These helpers are the single source of truth for
  // selection Copy / Cut / Delete of lasers.

  // Value of a laser section at absolute tick `t` (clamped to the section span).
  // Approximates bezier segments linearly at the boundary — exact at anchors and
  // for linear/step/slam segments, which is what matters for clean cut edges.
  static laserVAt(sec, t) {
    const pts = sec.points;
    if (!pts || !pts.length) return 0;
    const absOf = i => sec.y + pts[i].ry;
    const last = pts.length - 1;
    if (t <= absOf(0))    return pts[0].v;
    if (t >= absOf(last)) return pts[last].v;
    for (let i = 0; i < last; i++) {
      const ta = absOf(i), tb = absOf(i + 1);
      if (t >= ta && t <= tb) {
        const pa = pts[i], pb = pts[i + 1];
        if (t === ta) return pa.v;
        if (t === tb) return pb.v;
        if (pb.slam) return pa.v;                       // slam jumps at tb; holds pa.v before it
        if ((pa.interp ?? 'linear') === 'step') return pa.v;
        if (tb === ta) return pa.v;
        return pa.v + (pb.v - pa.v) * (t - ta) / (tb - ta);
      }
    }
    return pts[last].v;
  }

  // Extract the portion of one section between absolute ticks [a, b] as a NEW
  // section (with interpolated boundary anchors), or null if it would have < 2
  // points. Preserves interior anchors' v / slam / interp / curve. The returned
  // section's `y` is the first anchor tick; ry are relative to it.
  _sliceLaserSection(sec, a, b) {
    const pts = sec.points;
    if (!pts || pts.length < 2) return null;
    const absOf = i => sec.y + pts[i].ry;
    const s0 = absOf(0), s1 = absOf(pts.length - 1);
    a = Math.max(a, s0); b = Math.min(b, s1);
    if (!(b > a)) return null;

    const segInterpAt = t => {
      for (let i = 0; i < pts.length - 1; i++) {
        if (t >= absOf(i) && t < absOf(i + 1)) return pts[i].interp ?? 'linear';
      }
      return pts[pts.length - 1].interp ?? 'linear';
    };

    const collected = [];
    collected.push({ tick: a, v: ChartData.laserVAt(sec, a), slam: false, interp: segInterpAt(a), curve: 0.5 });
    for (let i = 0; i < pts.length; i++) {
      const t = absOf(i);
      if (t > a && t < b) {
        collected.push({ tick: t, v: pts[i].v, slam: !!pts[i].slam,
                         interp: pts[i].interp ?? 'linear', curve: pts[i].curve ?? 0.5 });
      }
    }
    collected.push({ tick: b, v: ChartData.laserVAt(sec, b), slam: false, interp: 'linear', curve: 0.5 });
    if (collected.length < 2) return null;

    const baseY = collected[0].tick;
    return {
      y: baseY,
      wide: sec.wide,
      points: collected.map((p, idx) => ({
        ry: p.tick - baseY, v: p.v,
        slam: idx === 0 ? false : p.slam,
        interp: p.interp, curve: p.curve,
      })),
    };
  }

  // Return the laser portion within [lo, hi] on `side` as new sections rebased
  // so tick `lo` maps to 0 (for the clipboard). Non-destructive.
  extractLaserRange(side, lo, hi) {
    const arr = this.lasers[side] ?? [];
    const out = [];
    for (const sec of arr) {
      const s0 = sec.y, s1 = sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0);
      if (s1 < lo || s0 > hi) continue;
      const piece = this._sliceLaserSection(sec, Math.max(s0, lo), Math.min(s1, hi));
      if (piece) out.push({ ...piece, y: piece.y - lo, points: piece.points.map(p => ({ ...p })) });
    }
    return out;
  }

  // Remove the laser portion within [lo, hi] on `side` IN PLACE — trimming a
  // section that straddles a boundary and splitting one whose middle is cut, so
  // surrounding laser shape survives. Returns the number of sections affected.
  spliceLaserRange(side, lo, hi) {
    const arr = this.lasers[side];
    if (!arr || !arr.length || hi < lo) return 0;
    const out = [];
    let affected = 0;
    for (const sec of arr) {
      const s0 = sec.y, s1 = sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0);
      if (s1 < lo || s0 > hi) { out.push(sec); continue; }
      affected++;
      const before = (lo > s0) ? this._sliceLaserSection(sec, s0, lo) : null;
      const after  = (hi < s1) ? this._sliceLaserSection(sec, hi, s1) : null;
      if (before) out.push(before);
      if (after)  out.push(after);
    }
    out.sort((a, b) => a.y - b.y);
    this.lasers[side] = out;
    return affected;
  }

  // v0.0.49: Time-shift every chart object inside [lo, hi] by `delta` ticks.
  // The single DOM-free source of truth for selection Move / Nudge. Reuses the
  // v0.0.48 laser-slicing engine (extractLaserRange / spliceLaserRange) so a
  // selection that covers only PART of a VOL laser slides just that portion in
  // time (with clean interpolated edges) instead of dragging the whole section.
  //
  //  what  — { bt, fx, vol, vel, glitch } booleans (any omitted key defaults to
  //          true). vel/glitch never move the protected y=0 base event.
  //
  // delta is clamped so nothing is pushed before tick 0; the actually-applied
  // (clamped) delta is RETURNED so the caller can shift the selection range to
  // match. A zero applied-delta is a no-op (returns 0).
  shiftRange(lo, hi, delta, what = {}) {
    const w = {
      bt: what.bt !== false, fx: what.fx !== false, vol: what.vol !== false,
      vel: what.vel !== false, glitch: what.glitch !== false,
      reconnect: what.reconnect !== false,
    };
    lo = Math.min(lo, hi); hi = Math.max(lo, hi);
    if (!Number.isFinite(delta) || delta === 0) return 0;

    // Clamp so the lowest in-range object can't go below tick 0.
    let minY = Infinity;
    const scanLane = (arr) => { for (const n of arr) if (n.y >= lo && n.y <= hi && n.y < minY) minY = n.y; };
    if (w.bt) this.bt.forEach(scanLane);
    if (w.fx) this.fx.forEach(scanLane);
    if (w.vol) for (let s = 0; s < 2; s++) for (const sec of (this.lasers[s] ?? [])) {
      const s0 = sec.y, s1 = sec.y + (sec.points[sec.points.length - 1]?.ry ?? 0);
      if (s1 >= lo && s0 <= hi) minY = Math.min(minY, Math.max(s0, lo));
    }
    if (w.vel) for (const e of (this.scrollSpeedEvents ?? [])) if (e.y > 0 && e.y >= lo && e.y <= hi) minY = Math.min(minY, e.y);
    if (w.glitch) for (const e of (this.glitchEvents ?? [])) if (e.y > 0 && e.y >= lo && e.y <= hi) minY = Math.min(minY, e.y);
    if (!Number.isFinite(minY)) return 0; // nothing in range
    if (minY + delta < 0) delta = -minY;
    if (delta === 0) return 0;

    // BT / FX notes — pull in-range out, re-add shifted (addBtNote/addFxNote
    // handle overlap removal + sort so moving onto existing notes is consistent).
    const shiftNotes = (lanes, add) => {
      for (let li = 0; li < lanes.length; li++) {
        const moving = lanes[li].filter(n => n.y >= lo && n.y <= hi);
        if (!moving.length) continue;
        lanes[li] = lanes[li].filter(n => !(n.y >= lo && n.y <= hi));
        moving.forEach(n => add.call(this, li, n.y + delta, n.len ?? 0));
      }
    };
    if (w.bt) shiftNotes(this.bt, this.addBtNote);
    if (w.fx) shiftNotes(this.fx, this.addFxNote);

    // VOL lasers — slice out the in-range portion (rebased to lo), remove it in
    // place, then re-insert each piece at lo+delta. Edges stay interpolated.
    if (w.vol) {
      for (let s = 0; s < 2; s++) {
        const pieces = this.extractLaserRange(s, lo, hi); // rebased so lo -> 0
        if (!pieces.length) continue;
        this.spliceLaserRange(s, lo, hi);
        for (const p of pieces) {
          this.lasers[s].push({ ...p, y: lo + delta + p.y, points: p.points.map(pt => ({ ...pt })) });
        }
        this.lasers[s].sort((a, b) => a.y - b.y);
        // v0.0.50: a time-shift can slide a laser piece so its edge now coincides
        // exactly with an adjacent section. Merge touching same-position sections
        // so the path stays one continuous laser instead of leaving an invisible
        // seam (Point 28b). autoConnectLasers only merges genuinely-touching
        // same-v junctions, so this never fuses unrelated lasers.
        if (w.reconnect) this.autoConnectLasers(s);
      }
    }

    // Scroll-speed / glitch events — move in-range (never the y=0 base).
    if (w.vel && Array.isArray(this.scrollSpeedEvents)) {
      const moving = this.scrollSpeedEvents.filter(e => e.y > 0 && e.y >= lo && e.y <= hi);
      moving.forEach(e => this.removeScrollSpeedEvent?.(e.y));
      moving.forEach(e => this.addScrollSpeedEvent(e.y + delta, e.speed, e.interp ?? 'step'));
    }
    if (w.glitch && Array.isArray(this.glitchEvents)) {
      const moving = this.glitchEvents.filter(e => e.y > 0 && e.y >= lo && e.y <= hi);
      moving.forEach(e => this.removeGlitchEvent?.(e.y));
      moving.forEach(e => this.addGlitchEvent(e.y + delta, e.level));
    }
    return delta;
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
