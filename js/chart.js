
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

  // Inverse of reactionWindowMs: given a TARGET green number (`targetMs`, the ms a
  // note should be on screen), return the HiSpeed multiplier that achieves it at
  // tempo `bpm` and practice `rate`. `visibleTicksAt1x` is the visible scroll
  // distance at HiSpeed 1× (GameView.VISIBLE_TICKS × hispeed = TICKS_PER_MEASURE×4
  // = 768), since VISIBLE_TICKS(h) = visibleTicksAt1x / h. Solving
  //   targetMs = reactionWindowMs(visibleTicksAt1x / h, bpm, rate)
  // for h gives the closed form below — an exact round-trip with reactionWindowMs.
  // This is how a rhythm-game player picks HiSpeed by target green number (IIDX
  // float hi-speed). DOM-free single source of truth; never touches chart data.
  hispeedForReactionMs(targetMs, bpm, rate = 1, visibleTicksAt1x = TICKS_PER_MEASURE * BEATS_PER_MEASURE) {
    const t   = Math.max(1,    Number(targetMs) || 1);
    const b   = Math.max(1,    Number(bpm) || 120);
    const r   = Math.max(0.01, Number(rate) || 1);
    const vt1 = Math.max(1,    Number(visibleTicksAt1x) || 1);
    return vt1 / TICKS_PER_BEAT * (60 / b) * 1000 / r / t;
  }

  // ── Reachability report for the target-green→HiSpeed solver (v0.0.65) ────────
  // The v0.0.58 solver (applyGreenTarget) silently clamps the solved HiSpeed to the
  // slider's [lo, hi] range: a target BELOW the window reachable at max HiSpeed needs
  // a faster scroll than the slider allows (clamped to `hi`, so the real window stays
  // LONGER than asked), and a target ABOVE the window at min HiSpeed needs a slower
  // scroll than allowed (clamped to `lo`, so the window comes out SHORTER). Until now
  // the field still looked "solved". This DOM-free companion to hispeedForReactionMs
  // reports what the clamp actually achieves so the UI can flag it — the HiSpeed twin
  // of coverForReactionReport (v0.0.64). Given the target window (ms), the reference
  // BPM, the practice rate, the visible ticks at 1× (already folded through any active
  // cover by the caller) and the slider bounds, it returns: `rawHs` — the ideal
  // unclamped HiSpeed; `hs` — the applied HiSpeed after clamp + 0.1 snap (IDENTICAL to
  // what applyGreenTarget sets); `achievedMs` — the window that actually results; and
  // `status`: 'ok' (reachable), 'above-max' (needs a faster scroll than the slider max,
  // so the window can't shrink to the target — raise the HiSpeed cap or add cover) or
  // 'below-min' (needs a slower scroll than the slider min). `reachable` is status==='ok'.
  // The achieved bound is shown with a ≥ prefix for 'above-max' (window is at least this)
  // and a ≤ prefix for 'below-min' (window is at most this). Unit-tested; never touches data.
  hispeedForReactionReport(targetMs, bpm, rate = 1, visibleTicksAt1x = TICKS_PER_MEASURE * BEATS_PER_MEASURE, loHs = 0.2, hiHs = 10) {
    const t     = Math.max(1, Number(targetMs) || 1);
    const lo    = Math.max(0.01, Number(loHs) || 0.2);
    const hi    = Math.max(lo,   Number(hiHs) || 10);
    const vt1   = Math.max(1,    Number(visibleTicksAt1x) || 1);
    const rawHs = this.hispeedForReactionMs(t, bpm, rate, vt1);
    const hs    = Math.max(lo, Math.min(hi, Math.round(rawHs * 10) / 10)); // snap to 0.1 step
    // achievedMs is the window the APPLIED HiSpeed yields — the exact round-trip.
    const achievedMs = this.reactionWindowMs(vt1 / hs, bpm, rate);
    let status;
    if (rawHs > hi + 1e-9)      status = 'above-max'; // can't scroll fast enough → window too long
    else if (rawHs < lo - 1e-9) status = 'below-min'; // can't scroll slow enough → window too short
    else                        status = 'ok';
    return { rawHs, hs, achievedMs, status, reachable: status === 'ok' };
  }

  // ── Cover-adjusted reaction window (SUD+/HID+/LIFT green number) ───────────
  // The Sudden+/Hidden+ track covers hide the far/top end (sud) and the near/
  // bottom end (hid) of the runway, and LIFT (v0.0.62) raises the judgment line
  // from the bottom (lift) — an IIDX-style modifier distinct from Hidden+: HID+
  // blanks a strip but keeps the judgment line at the bottom, while LIFT moves
  // the judgment line up so the note's visible travel ends higher. All three
  // shorten the strip a note is actually seen crossing. Because the reaction
  // window is proportional to that visible distance, an active cover shrinks it
  // by exactly the uncovered fraction — this is the real-world "SUD+ green
  // number" IIDX/SDVX players read. Returns the fraction (0..1) of the runway
  // still visible. DOM-free single source of truth shared by the green-number
  // readout AND the target-green→HiSpeed solver, so the two never disagree under
  // a cover. `coverLift` is optional so existing callers keep working. Never
  // touches chart data.
  coverVisibleFraction(coverSudden = 0, coverHidden = 0, coverLift = 0) {
    const s = Math.max(0, Math.min(0.9, Number(coverSudden) || 0));
    const h = Math.max(0, Math.min(0.9, Number(coverHidden) || 0));
    const l = Math.max(0, Math.min(0.9, Number(coverLift)   || 0));
    return Math.max(0, Math.min(1, 1 - s - h - l));
  }

  // ── Cover-stack legibility guard (v0.0.67) ─────────────────────────────────
  // Sudden+, Hidden+ and LIFT are each individually capped at 0.9, but they
  // STACK: coverVisibleFraction(sud,hid,lift) = clamp(1 − sud − hid − lift) can
  // fall to near zero when two or three are dialled up together, leaving an
  // unreadable near-blank reading strip with no feedback. This DOM-free source of
  // truth turns the three cover fractions into a legibility verdict the UI can
  // surface: `visible` (0..1, the coverVisibleFraction), `total` (clamped sum of
  // the three, 0..1), and a `status` of 'ok' (visible ≥ WARN), 'tight' (BLANK ≤
  // visible < WARN — legible but cramped) or 'blank' (visible < BLANK — the lane
  // is effectively unreadable). `visiblePct` is the rounded percentage for the
  // badge. Thresholds are shared constants so the engine and any test agree.
  // Render-only; never touches chart data.
  coverStackReport(coverSudden = 0, coverHidden = 0, coverLift = 0) {
    const WARN  = 0.25;   // below this the reading strip is cramped
    const BLANK = 0.08;   // below this the lane is effectively unreadable
    const s = Math.max(0, Math.min(0.9, Number(coverSudden) || 0));
    const h = Math.max(0, Math.min(0.9, Number(coverHidden) || 0));
    const l = Math.max(0, Math.min(0.9, Number(coverLift)   || 0));
    const visible = this.coverVisibleFraction(s, h, l);
    const total   = Math.max(0, Math.min(1, s + h + l));
    let status;
    if (visible < BLANK)     status = 'blank';
    else if (visible < WARN) status = 'tight';
    else                     status = 'ok';
    return { visible, total, status, visiblePct: Math.round(visible * 100), warn: WARN, blank: BLANK };
  }

  // ── Reaction-window range across the whole chart (v0.0.68) ─────────────────
  // The green number (reactionWindowMs) shown in the preview panel is the window
  // AT THE PLAYHEAD only. On a soflan chart the reading window swings between
  // sections and that instantaneous readout hides it: a chartist can't tell that
  // the hardest-to-read part demands, say, a 260 ms reaction while the rest sits
  // at 900 ms. This DOM-free source of truth sweeps every BPM segment in the
  // chart and returns the MIN (fastest-reading / hardest) and MAX (slowest /
  // easiest) reaction window, the tick + tempo each occurs at, and the span
  // between them. `visibleTicks` and `rate` are the same inputs the readout uses
  // (fold any active Sudden+/Hidden+/LIFT cover into visibleTicks before calling,
  // exactly as updateReactionReadout does), so the range agrees with the live
  // number. `bpmList` overrides this.bpmEvents (C-Mode passes a single constant
  // reference BPM so min === max and `constant` is true). reactionWindowMs is
  // strictly decreasing in BPM for fixed visibleTicks/rate — min ms rides the
  // fastest tempo, max ms the slowest — but we sweep segments directly so the
  // tick anchors are exact and the readout can seek to the worst section. The
  // `ratio` (max/min) drives the "large swing" cue. Render-only; never mutates.
  reactionWindowExtremes(visibleTicks, rate = 1, bpmList = null) {
    const src = (Array.isArray(bpmList) && bpmList.length) ? bpmList
      : ((Array.isArray(this.bpmEvents) && this.bpmEvents.length) ? this.bpmEvents : [{ y: 0, bpm: 120 }]);
    const evs = src
      .map(e => ({ y: Math.max(0, Number(e.y) || 0), bpm: Math.max(1, Number(e.bpm) || 120) }))
      .sort((p, q) => p.y - q.y);
    let minMs = Infinity, maxMs = -Infinity;
    let minTick = 0, maxTick = 0, minBpm = 0, maxBpm = 0;
    for (const ev of evs) {
      const ms = this.reactionWindowMs(visibleTicks, ev.bpm, rate);
      if (ms < minMs) { minMs = ms; minTick = ev.y; minBpm = ev.bpm; }
      if (ms > maxMs) { maxMs = ms; maxTick = ev.y; maxBpm = ev.bpm; }
    }
    if (!Number.isFinite(minMs)) {
      minMs = maxMs = this.reactionWindowMs(visibleTicks, 120, rate);
      minBpm = maxBpm = 120;
    }
    const spanMs = Math.max(0, maxMs - minMs);
    return {
      minMs, maxMs, spanMs, minTick, maxTick, minBpm, maxBpm,
      ratio: minMs > 0 ? maxMs / minMs : 1,
      constant: evs.length <= 1 || spanMs < 0.5,
    };
  }

  // ── Per-measure reaction-window profile (v0.0.69) ──────────────────────────
  // The reaction RANGE readout (v0.0.68) collapses the whole chart to two numbers
  // (min / max ms). This turns that same per-segment idea into a full CURVE: it
  // samples reactionWindowMs once per measure across the chart, so a chartist can
  // see EXACTLY WHERE the hard-to-read (short-window) spikes sit — a green-number
  // heatmap — not merely that a swing exists. It shares every input with the live
  // green number and the range readout: `visibleTicks` already folds in HiSpeed
  // and any Sudden+/Hidden+/LIFT cover (fold it in before calling, exactly as
  // updateReactionReadout does), and `rate` is the practice rate — so all three
  // agree by construction. `opts.lastTick` bounds the sweep (caller passes
  // chartLastTick); `opts.measureTicks` defaults to TICKS_PER_MEASURE and matches
  // tickToMeasure. Each sample carries its measure index, start tick, the local
  // BPM (getBpmAt, so soflan shows through), the window ms, and a `norm` in
  // 0..1 where 1 = the shortest window (hardest to read) and 0 = the longest
  // (easiest) — the value the strip colours by. `opts.bpmList` (a one-BPM list,
  // as C-mode passes) flattens the curve to the constant reference window. The
  // sample count is hard-capped (opts.maxSamples, default 512) and the sweep
  // strides so a very long chart can never produce an unbounded array. Returns
  // { samples, minMs, maxMs, minIdx, count, stride, measureTicks }. reuses
  // reactionWindowMs, DOM-free, unit-tested. Render-only; never mutates chart data.
  reactionWindowProfile(visibleTicks, rate = 1, opts = {}) {
    const measureTicks = Math.max(1, Number(opts.measureTicks) || TICKS_PER_MEASURE);
    const lastTick     = Math.max(0, Number(opts.lastTick) || 0);
    const MAX_SAMPLES  = Math.max(1, Math.floor(Number(opts.maxSamples) || 512));
    const constBpm     = (Array.isArray(opts.bpmList) && opts.bpmList.length)
      ? Math.max(1, Number(opts.bpmList[0].bpm) || 120) : null;
    const measureCount = Math.max(1, Math.floor(lastTick / measureTicks) + 1);
    // Stride so the sample array never exceeds the cap on a very long chart.
    const stride  = Math.max(1, Math.ceil(measureCount / MAX_SAMPLES));
    const samples = [];
    let minMs = Infinity, maxMs = -Infinity, minIdx = 0;
    for (let m = 0; m < measureCount; m += stride) {
      const tick = m * measureTicks;
      const bpm  = constBpm != null ? constBpm : this.getBpmAt(tick);
      const ms   = this.reactionWindowMs(visibleTicks, bpm, rate);
      if (ms < minMs) { minMs = ms; minIdx = samples.length; }
      if (ms > maxMs) { maxMs = ms; }
      samples.push({ measure: m, tick, bpm, ms, norm: 0 });
    }
    if (!samples.length || !Number.isFinite(minMs)) {
      const ms = this.reactionWindowMs(visibleTicks, constBpm ?? 120, rate);
      samples.length = 0;
      samples.push({ measure: 0, tick: 0, bpm: constBpm ?? 120, ms, norm: 0 });
      minMs = maxMs = ms; minIdx = 0;
    }
    const span = maxMs - minMs;
    for (const s of samples) s.norm = span > 1e-6 ? (maxMs - s.ms) / span : 0;
    return { samples, minMs, maxMs, minIdx, count: samples.length, stride, measureTicks };
  }

  // ── Reading-strip pointer hit-test (v0.0.70) ───────────────────────────────
  // Maps a 0..1 horizontal fraction across a reactionWindowProfile() result back
  // to the sample under that fraction, so both the strip's click-to-seek AND its
  // hover readout resolve the same column from the same math and can never point
  // at different measures. Given the profile (or just its sample count) and a
  // fraction, returns the clamped sample index in [0, count-1], or -1 when there
  // are no samples. Pure, DOM-free, unit-tested. Never touches chart data.
  profileIndexAtFraction(profile, frac) {
    const n = (profile && Array.isArray(profile.samples)) ? profile.samples.length
            : (Number.isFinite(profile) ? Math.floor(profile) : 0);
    if (!Number.isFinite(n) || n <= 0) return -1;
    const f = Math.max(0, Math.min(0.999999, Number(frac) || 0));
    return Math.min(n - 1, Math.max(0, Math.floor(f * n)));
  }

  // ── Solve cover for a target green number (v0.0.63) ────────────────────────
  // Inverse of coverVisibleFraction for the green number. Given the FULL-LANE
  // reaction window (ms a note is on screen at the CURRENT HiSpeed, no cover) and
  // a TARGET visible green number (ms), return the TOTAL covered fraction (0..0.9)
  // that shrinks the window to the target: visible = fullLaneMs × (1 − covered),
  // so covered = 1 − target / fullLaneMs. This is the reciprocal move to the
  // v0.0.58 target→HiSpeed solver — instead of changing scroll speed you dial the
  // reading window by cover (Sudden+ / LIFT) at a FIXED HiSpeed, the way an
  // IIDX/SDVX player who's comfortable at one speed tunes their SUD+ green number.
  // A cover can only SHORTEN the window, so a target ≥ the full-lane window needs
  // no cover (returns 0 — you'd lower HiSpeed instead). Capped at 0.9 to match the
  // slider clamps and coverVisibleFraction. DOM-free single source of truth,
  // unit-tested, and an exact round-trip with coverVisibleFraction:
  // coverVisibleFraction(coverForReactionMs(t, full)) × full === t whenever the
  // target is reachable (t within [0.1·full, full]). Never touches chart data.
  coverForReactionMs(targetMs, fullLaneMs) {
    const t    = Math.max(0,    Number(targetMs)  || 0);
    const full = Math.max(1e-6, Number(fullLaneMs) || 0);
    if (t >= full) return 0;                       // can't lengthen the window by covering
    return Math.max(0, Math.min(0.9, 1 - t / full));
  }

  // ── Reachability report for the Cover→target solver (v0.0.64) ───────────────
  // The Cover →ms solver (v0.0.63) silently clamps: a cover fraction is capped at
  // 0.9 per channel, so a target BELOW 10% of the full-lane window can't be met by
  // cover alone, and a target ABOVE the full-lane window can't be met at all (a
  // cover only shortens the window). This report tells the UI what the chosen
  // channel can actually achieve so it can flag an unreachable target instead of
  // leaving the field looking "solved". Given the target window (ms), the full-lane
  // window (ms) and the cover already summed on the OTHER two channels (0..0.9), it
  // returns: `chosen` — the fraction the chosen channel is set to (identical to what
  // applyCoverTarget applies); `appliedTotal` — the effective total cover after the
  // per-channel clamp; `achievedMs` — the visible window that actually results; and
  // `status`: 'ok' (target met within tolerance), 'too-small' (below the 0.9 clamp —
  // raise HiSpeed too) or 'above-lane' (≥ full lane — lower HiSpeed instead). `bound`
  // is the ms limit to show with a ≥ (too-small) or ≤ (above-lane) prefix. DOM-free,
  // unit-tested, an exact companion to coverForReactionMs; never touches chart data.
  coverForReactionReport(targetMs, fullLaneMs, otherCoverFraction = 0) {
    const t      = Math.max(0,    Number(targetMs)  || 0);
    const full   = Math.max(1e-6, Number(fullLaneMs) || 0);
    const others = Math.max(0, Math.min(0.9, Number(otherCoverFraction) || 0));
    const wantTotal    = 1 - t / full;                       // unclamped ideal total cover
    const totalCov     = this.coverForReactionMs(t, full);   // clamped [0, 0.9]
    const chosen       = Math.max(0, Math.min(0.9, totalCov - others));
    const appliedTotal = Math.max(0, Math.min(1, others + chosen));
    const achievedMs   = full * (1 - appliedTotal);
    const tol          = Math.max(0.5, t * 0.005);
    let status;
    if (t >= full)                       status = 'above-lane'; // can't lengthen by cover
    else if (wantTotal > 0.9 + 1e-9)     status = 'too-small';  // hit the 0.9 clamp
    else if (Math.abs(achievedMs - t) > tol) status = 'clamped'; // other channels over-cover
    else                                 status = 'ok';
    return { totalCov, chosen, appliedTotal, achievedMs, status, reachable: status === 'ok' };
  }

  // ── Nearest reachable target for a clamped →ms solve (v0.0.66) ──────────────
  // Both →ms solvers (v0.0.64 cover, v0.0.65 HiSpeed) clamp against a hard bound
  // and report the window the clamp actually achieves (`achievedMs`). This turns
  // that bound into the nearest TARGET ms a re-solve reports as 'ok', so the UI
  // can offer a one-tap "Fit to range" that accepts the clamp. The achievable
  // side depends on the direction of the clamp: an "at least" bound ('≥': the
  // window can't get shorter than achievedMs — 'above-max' / 'too-small' / a
  // 'clamped' over-cover) rounds UP into the reachable region; an "at most" bound
  // ('≤': the window can't get longer — 'below-min') rounds DOWN. 'above-lane'
  // (target ≥ the whole lane, cover only shortens) must land STRICTLY under the
  // full lane, so it steps one ms below achievedMs. Returns null for a reachable
  // report or a non-finite achieved window. DOM-free; never touches chart data.
  fitReachableMs(report) {
    if (!report || report.reachable) return null;
    const a = Number(report.achievedMs);
    if (!Number.isFinite(a)) return null;
    if (report.status === 'above-lane') return Math.max(1, Math.floor(a) - 1);
    if (report.status === 'below-min')  return Math.floor(a);
    return Math.ceil(a);   // above-max / too-small / clamped ('≥' bound)
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
