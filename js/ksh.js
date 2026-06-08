import { effectToKsh } from './effects.js';
import { TICKS_PER_BEAT, TICKS_PER_MEASURE, ChartData, LASER_CHARS, laserCharToPos, laserPosToChar, LANE, LASER_SLAM_TICKS } from './chart.js';

// ── KSH EXPORT ──────────────────────────────────────────────────────────────

// KSM/KSH does not support bezier (smooth) laser curves — it only has linear
// interpolation between anchor points.  Expand any bezier segment into dense
// 1/32-note (24-tick) linear samples so the exported chart visually matches
// the KSON source.
const _KSH_BEZ_SAMPLE = 24; // 1/32 note at 192 ticks/beat

function _kshExpandBezier(sec) {
  if (!sec.points.some(p => p.interp === 'bezier')) return sec;
  const pts = sec.points;
  const flat = [];
  for (let pi = 0; pi < pts.length; pi++) {
    const p0 = pts[pi];
    if (pi === pts.length - 1 || p0.interp !== 'bezier') {
      flat.push({ ry: p0.ry, v: p0.v, slam: p0.slam ?? false, interp: p0.interp ?? 'linear' });
      continue;
    }
    const p1  = pts[pi + 1];
    const t0  = sec.y + p0.ry;
    const t1  = sec.y + p1.ry;
    if (t1 <= t0) {
      flat.push({ ry: p0.ry, v: p0.v, slam: p0.slam ?? false, interp: 'linear' });
      continue;
    }
    const curve  = p0.curve ?? 0.5;
    const tCtrl  = t0 + (t1 - t0) * curve;
    const bzTick = t => t0*(1-t)**3 + tCtrl*3*t*(1-t) + t1*t**3;
    const bzV    = t => p0.v*(1-t)**2*(1+2*t) + p1.v*t**2*(3-2*t);
    // Emit the start anchor
    flat.push({ ry: p0.ry, v: p0.v, slam: p0.slam ?? false, interp: 'linear' });
    // Emit a sample at every 1/32-note boundary strictly inside [t0, t1)
    const first = Math.ceil((t0 + 1) / _KSH_BEZ_SAMPLE) * _KSH_BEZ_SAMPLE;
    for (let T = first; T < t1; T += _KSH_BEZ_SAMPLE) {
      // Binary-search the bezier parameter t such that bzTick(t) ≈ T
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) * 0.5;
        if (bzTick(mid) < T) lo = mid; else hi = mid;
      }
      const v = Math.max(0, Math.min(1, bzV((lo + hi) * 0.5)));
      flat.push({ ry: T - sec.y, v, slam: false, interp: 'linear' });
    }
    // p1 is emitted on the next iteration (or as the final point)
  }
  return { ...sec, points: flat };
}

export function exportKsh(chart) {
  const m = chart.meta;
  const lines = [];
  // Bezier segments expanded to 1/32-note linear samples for KSH compatibility
  const exportLasers = chart.lasers.map(side => side.map(_kshExpandBezier));

  // Header
  lines.push(`title=${m.title}`);
  lines.push(`artist=${m.artist}`);
  lines.push(`effect=${m.effect}`);
  lines.push(`jacket=${m.jacket}`);
  lines.push(`illustrator=${m.illust}`);
  lines.push(`difficulty=${m.difficulty}`);
  lines.push(`level=${m.level}`);
  lines.push(`t=${m.bpm}`);
  lines.push(`m=${m.music}`);
  lines.push(`o=${m.offset}`);
  lines.push(`bg=${m.bg}`);
  if (m.layer) lines.push(`layer=${m.layer}`);
  lines.push(`po=${m.previewStart}`);
  lines.push(`plength=${m.previewDuration}`);
  lines.push(`filtertype=${chart.laserSettings.filter}`);
  lines.push(`pfiltergain=${chart.laserSettings.gain}`);
  if (chart.laserSettings.wide) lines.push('laserrange=2x');
  lines.push(`ver=167`);

  // FX chain effect defines
  for (let side = 0; side < 2; side++) {
    const key = side === 0 ? 'fx-l' : 'fx-r';
    const chain = chart.fxChains[side];
    if (chain.length > 0) {
      lines.push(`${key}=${effectToKsh(chain[0])}`);
    }
  }

  lines.push('--');

  // Walking time-sig pointer so each measure knows its own length.
  let tsEvIdx = 0;
  let curTs   = getTimeSigAt(chart, 0);
  let measureStartY = 0;

  // Body — iterate measure by measure
  for (let measure = 0; measure < chart.totalMeasures; measure++) {
    // Advance time-sig if a new one starts at this measure
    while (tsEvIdx + 1 < chart.timeSigEvents.length &&
           chart.timeSigEvents[tsEvIdx + 1].measure <= measure) {
      tsEvIdx++;
      curTs = chart.timeSigEvents[tsEvIdx];
    }
    // Ticks in this measure depend on the live TS, not the global default
    const measTicks = Math.round((curTs.num / curTs.den) * 4 * TICKS_PER_BEAT);
    const startY = measureStartY;
    const endY   = startY + measTicks;

    // Collect every tick (relative offset from startY) that carries content.
    // We will write evenly-spaced lines per measure with spacing chosen so
    // every offset lands exactly on a line — fixing the round-trip bug where
    // 1/16 / 1/24 notes were quantised to 1/8 because the KSH importer
    // assumes lines are equispaced across the measure.
    const offsets = new Set([0]);

    const addNotes = (arr) => {
      for (const n of arr) {
        if (n.y >= startY && n.y < endY)               offsets.add(n.y - startY);
        if (n.len > 0) {
          // Tail crossing into this measure → end-of-hold marker
          const endTick = n.y + n.len;
          if (endTick > startY && endTick <= endY)     offsets.add(endTick - startY);
        }
      }
    };
    for (let li = 0; li < 4; li++) addNotes(chart.bt[li]);
    for (let li = 0; li < 2; li++) addNotes(chart.fx[li]);

    // Laser anchor points
    for (let side = 0; side < 2; side++) {
      for (const sec of exportLasers[side]) {
        for (const pt of sec.points) {
          const t = sec.y + pt.ry;
          if (t >= startY && t < endY) offsets.add(t - startY);
        }
      }
    }

    // BPM changes
    for (const ev of chart.bpmEvents) {
      if (ev.y >= startY && ev.y < endY) offsets.add(ev.y - startY);
    }

    // Camera / lane effect events (zoom_top, tilt, lane_toggle, …). These are
    // emitted as standalone key=value body lines, so their ticks must land on
    // the line grid or they would be quantised to the wrong position.
    for (const ev of (chart.cameraEvents ?? [])) {
      if (ev.y >= startY && ev.y < endY) offsets.add(ev.y - startY);
    }

    // Stop (beat-stop) events. Emitted as standard `stop=<len>` body lines, so
    // their start ticks must land on the line grid like camera events or they
    // would be quantised to the wrong position on round-trip.
    for (const ev of (chart.stopEvents ?? [])) {
      if (ev.y >= startY && ev.y < endY) offsets.add(ev.y - startY);
    }

    // ── Choose line spacing ─────────────────────────────────────────────
    // step = gcd(measTicks, all_offsets). The number of lines per measure
    // is measTicks / step. We cap the step to at least 1/192 of the
    // measure so very dense charts still round-trip cleanly.
    let step = measTicks;
    for (const o of offsets) if (o > 0) step = gcd(step, o);
    // Minimum density: ensure at least 8 lines per beat (1/32 resolution)
    // for empty measures, which avoids a degenerate "1 line per measure"
    // when the measure is empty.
    const minLines = (curTs.num / curTs.den) * 4 * 8;
    while (measTicks / step < minLines) step = step / 2;
    // Safety against fractional step (shouldn't happen with sane charts).
    step = Math.max(1, Math.round(step));
    const lineCount = Math.round(measTicks / step);

    // Time sig
    if (measure === 0 || !timeSigEqual(getTimeSigAt(chart, measure - 1), curTs)) {
      lines.push(`beat=${curTs.num}/${curTs.den}`);
    }

    // BPM events at measure start
    for (const ev of chart.bpmEvents) {
      if (ev.y >= startY && ev.y < endY && ev.y === startY) {
        lines.push(`t=${ev.bpm}`);
      }
    }

    // ── Emit equispaced lines ──────────────────────────────────────────
    for (let i = 0; i < lineCount; i++) {
      const tick = startY + i * step;

      // Inline BPM change if it falls on this line (and isn't at measure start)
      if (i > 0) {
        for (const ev of chart.bpmEvents) {
          if (ev.y === tick) lines.push(`t=${ev.bpm}`);
        }
      }

      const btStr = [0, 1, 2, 3].map(li => {
        const note = chart.bt[li].find(n =>
          n.y === tick || (n.len > 0 && tick > n.y && tick < n.y + n.len)
        );
        if (!note) return '0';
        if (note.y === tick) return note.len === 0 ? '1' : '2';
        return '2';
      }).join('');

      const fxStr = [0, 1].map(li => {
        const note = chart.fx[li].find(n =>
          n.y === tick || (n.len > 0 && tick > n.y && tick < n.y + n.len)
        );
        if (!note) return '0';
        if (note.y === tick) return note.len === 0 ? '2' : '1';
        return '1';
      }).join('');

      const laserStr = [0, 1].map(side => {
        for (const sec of exportLasers[side]) {
          for (const pt of sec.points) {
            if (sec.y + pt.ry === tick) return laserPosToChar(pt.v);
          }
          const pts = sec.points;
          if (pts.length >= 2) {
            for (let pi = 0; pi < pts.length - 1; pi++) {
              const ta = sec.y + pts[pi].ry;
              const tb = sec.y + pts[pi + 1].ry;
              if (tick > ta && tick < tb) return ':';
            }
          }
        }
        return '-';
      }).join('');

      // Camera / lane effect events for this tick — written immediately before
      // the note line so the importer (which attaches pending events to the
      // next note line) resolves them to exactly this tick.
      for (const ev of (chart.cameraEvents ?? [])) {
        if (ev.y === tick) lines.push(`${ev.type}=${ev.value}`);
      }

      // Stop events for this tick — written immediately before the note line
      // so the importer (which attaches pending events to the next note line)
      // resolves them to exactly this tick. len is in editor ticks (192/measure),
      // which matches KSH's own resolution, so no scaling is needed.
      for (const ev of (chart.stopEvents ?? [])) {
        if (ev.y === tick) lines.push(`stop=${ev.len}`);
      }

      lines.push(`${btStr}|${fxStr}|${laserStr}`);
    }

    lines.push('--');
    measureStartY = endY;
  }

  return lines.join('\n');
}

// ── KSH effect string → makeEffectInstance ─────────────────────────────────
// Parses "Wobble;12" / "Gate;8" / "Retrigger;4" / "Echo;4;60" etc.
export function _kshEffectFromStr(str) {
  if (!str || typeof makeEffectInstance !== 'function') return null;
  const parts = str.split(';');
  const name  = (parts[0] || '').trim().toLowerCase();
  const typeMap = {
    'retrigger': 'retrigger', 'gate': 'gate', 'flanger': 'flanger',
    'pitchshift': 'pitchshift', 'bitcrusher': 'bitcrusher', 'phaser': 'phaser',
    'wobble': 'wobble', 'tapestop': 'tapestop', 'echo': 'echo', 'sidechain': 'sidechain',
  };
  const type = typeMap[name];
  if (!type) return null;
  const inst = makeEffectInstance(type);
  if (!inst) return null;
  // Apply positional params per type
  if (type === 'retrigger' && parts[1]) inst.params.waveLength = +parts[1] || inst.params.waveLength;
  if (type === 'gate'       && parts[1]) inst.params.waveLength = +parts[1] || inst.params.waveLength;
  if (type === 'pitchshift' && parts[1]) inst.params.pitch      = +parts[1] || inst.params.pitch;
  if (type === 'bitcrusher' && parts[1]) inst.params.reduction  = +parts[1] || inst.params.reduction;
  if (type === 'wobble'     && parts[1]) inst.params.waveLength = +parts[1] || inst.params.waveLength;
  if (type === 'tapestop'   && parts[1]) inst.params.speed      = +parts[1] || inst.params.speed;
  if (type === 'echo') {
    if (parts[1]) inst.params.waveLength = +parts[1] || inst.params.waveLength;
    if (parts[2]) inst.params.feedback   = +parts[2] || inst.params.feedback;
  }
  return inst;
}

// ── KSH IMPORT ──────────────────────────────────────────────────────────────
// Accepts either a UTF-8 string OR an ArrayBuffer (for Shift-JIS auto-detection).

export function importKsh(input) {
  // ── Decode ──────────────────────────────────────────────────────────────────
  let text;
  if (typeof input === 'string') {
    text = input;
  } else {
    // ArrayBuffer: try strict UTF-8 first; fall back to Shift-JIS on failure
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch (_) {
      try {
        text = new TextDecoder('shift-jis', { fatal: false }).decode(input);
      } catch (_2) {
        text = new TextDecoder('utf-8', { fatal: false }).decode(input);
      }
    }
  }

  const chart   = new ChartData();
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // ── State ───────────────────────────────────────────────────────────────────
  let inBody        = false;
  let measureNum    = 0;          // logical measure index
  let measureStartTick = 0;       // absolute tick at the start of current measure

  // Current time signature (may change per-measure via beat= lines)
  let curTimeSig = { num: 4, den: 4 };
  const ticksInMeasure = () => Math.round((curTimeSig.num / curTimeSig.den) * 4 * TICKS_PER_BEAT);

  // Per-side laser wide mode (can change mid-chart via laserrange_l/r)
  const laserWide = [chart.laserSettings.wide, chart.laserSettings.wide];

  // Hold state (persists across measure boundaries)
  const holdBt = [null, null, null, null];
  const holdFx = [null, null];

  // Laser state (persists across measure boundaries)
  const laserActive    = [false, false];
  const prevWasChar    = [false, false];
  const prevCharTick   = [-9999, -9999];
  const currentSection = [null, null];

  // Per-measure line buffer
  // Each entry: { type: 'note'|'event', content?, key?, val? }
  let measureBuffer = [];

  // ── Hold helpers ─────────────────────────────────────────────────────────────
  const finalizeBtHold = (li, endTick) => {
    if (holdBt[li] === null) return;
    const len = endTick - holdBt[li];
    if (len > 0) chart.addBtNote(li, holdBt[li], len);
    holdBt[li] = null;
  };
  const finalizeFxHold = (li, endTick) => {
    if (holdFx[li] === null) return;
    const len = endTick - holdFx[li];
    if (len > 0) chart.addFxNote(li, holdFx[li], len);
    holdFx[li] = null;
  };

  // ── Apply one body key=value at a resolved absolute tick ─────────────────────
  const applyBodyEvent = (key, val, atTick) => {
    switch (key) {
      case 't': {
        const bpm = parseFloat(val);
        if (!isNaN(bpm) && bpm > 0) chart.addBpmEvent(atTick, bpm);
        break;
      }
      case 'stop': {
        const n = parseInt(val, 10);
        if (!isNaN(n) && n > 0) chart.stopEvents.push({ y: atTick, len: n });
        break;
      }
      case 'zoom_top': case 'zoom_bottom': case 'zoom_side':
      case 'tilt': case 'lane_toggle': case 'center_split': {
        chart.cameraEvents.push({ y: atTick, type: key, value: val });
        break;
      }
      case 'laserrange_l': laserWide[0] = (val === '2x'); break;
      case 'laserrange_r': laserWide[1] = (val === '2x'); break;
      case 'laserrange':   laserWide[0] = laserWide[1] = (val === '2x'); break;
      case 'fx-l_se': chart.meta.fxLSE = val; break;
      case 'fx-r_se': chart.meta.fxRSE = val; break;
      // FX effect change mid-chart (e.g. fx-l=Wobble;8 inside body)
      case 'fx-l': case 'fx-r': {
        const side = key === 'fx-l' ? 0 : 1;
        const inst = _kshEffectFromStr(val);
        if (inst) chart.fxChains[side] = [inst];
        break;
      }
      default: break; // total=, information=, chokkakuse=, etc. are header-only
    }
  };

  // ── Process one note line at a given absolute tick ────────────────────────────
  const processNoteLine = (content, tick) => {
    const parts = content.split('|');
    if (parts.length < 3) return;
    const [btStr, fxStr, laserStr] = parts;

    // BT: '1'=chip, '2'=hold, else=end-hold
    for (let li = 0; li < 4 && li < btStr.length; li++) {
      const ch = btStr[li];
      if (ch === '1') {
        finalizeBtHold(li, tick);
        chart.addBtNote(li, tick, 0);
      } else if (ch === '2') {
        if (holdBt[li] === null) holdBt[li] = tick;
      } else {
        finalizeBtHold(li, tick);
      }
    }

    // FX (inverted encoding vs BT): '2'=chip, '1'=hold, else=end-hold
    for (let li = 0; li < 2 && li < fxStr.length; li++) {
      const ch = fxStr[li];
      if (ch === '2') {
        finalizeFxHold(li, tick);
        chart.addFxNote(li, tick, 0);
      } else if (ch === '1') {
        if (holdFx[li] === null) holdFx[li] = tick;
      } else {
        finalizeFxHold(li, tick);
      }
    }

    // Lasers
    for (let side = 0; side < 2; side++) {
      const ch = laserStr?.[side];
      if (ch && ch !== '-' && ch !== ':') {
        const v = laserCharToPos(ch);
        if (v !== null) {
          if (!laserActive[side] || !currentSection[side]) {
            // New laser section — use per-side wide flag
            const sec = { y: tick, points: [{ ry: 0, v, slam: false, interp: 'linear', curve: 0.5 }], wide: laserWide[side] };
            chart.lasers[side].push(sec);
            chart.lasers[side].sort((a, b) => a.y - b.y);
            currentSection[side] = sec;
          } else {
            // Slam detection: two consecutive laser chars with no ':' between them
            // Guard: tick distance must be ≤ LASER_SLAM_TICKS × 4 to avoid false positives
            const tickDist = tick - prevCharTick[side];
            const isSlam   = prevWasChar[side] && tickDist <= (LASER_SLAM_TICKS * 4);
            currentSection[side].points.push({ ry: tick - currentSection[side].y, v, slam: isSlam, interp: 'linear', curve: 0.5 });
            if (isSlam) {
              const pts = currentSection[side].points;
              const p0  = pts[pts.length - 2];
              if (p0 && p0.interp === 'linear') p0.interp = 'step';
            }
          }
          laserActive[side]  = true;
          prevWasChar[side]  = true;
          prevCharTick[side] = tick;
        }
      } else if (ch === '-') {
        laserActive[side]  = false;
        prevWasChar[side]  = false;
        prevCharTick[side] = -9999;
        currentSection[side] = null;
      } else {
        // ':' continuation — keeps section active but not a slam trigger
        prevWasChar[side] = false;
      }
    }
  };

  // ── Flush one measure from the buffer ─────────────────────────────────────────
  const flushMeasure = () => {
    const noteEntries = measureBuffer.filter(e => e.type === 'note');
    const count = noteEntries.length;

    if (count > 0) {
      const measTicks = ticksInMeasure();

      // Pre-compute absolute tick for each note line
      const noteTicks = noteEntries.map((_, i) =>
        measureStartTick + Math.round((i / count) * measTicks)
      );

      // Walk the buffer in order; events are "pending" until the next note line
      let noteIdx = 0;
      let pending = [];   // accumulated events waiting for next note-line tick

      for (const entry of measureBuffer) {
        if (entry.type === 'event') {
          pending.push(entry);
        } else {
          const tick = noteTicks[noteIdx];
          // Flush pending events at this tick
          for (const ev of pending) applyBodyEvent(ev.key, ev.val, tick);
          pending = [];
          processNoteLine(entry.content, tick);
          noteIdx++;
        }
      }

      // Any events after the last note line → apply at end of measure
      const endOfMeasure = measureStartTick + measTicks;
      for (const ev of pending) applyBodyEvent(ev.key, ev.val, endOfMeasure);

      measureStartTick += measTicks;
    }
    // (if count === 0 but measure separator reached, still bump measure index)

    measureNum++;
    measureBuffer = [];
  };

  // ── Header parser ─────────────────────────────────────────────────────────────
  const parseHeaderLine = (key, val) => {
    switch (key) {
      case 'title':        chart.meta.title          = val; break;
      case 'artist':       chart.meta.artist         = val; break;
      case 'effect':       chart.meta.effect         = val; break;
      case 'jacket':       chart.meta.jacket         = val; break;
      case 'illustrator':  chart.meta.illust         = val; break;
      case 'difficulty':   chart.meta.difficulty     = val; break;
      case 'level':        chart.meta.level          = +val; break;
      case 't':            chart.meta.bpm = +val; chart.bpmEvents[0].bpm = +val; break;
      case 'm':            chart.meta.music          = val; break;
      case 'o':            chart.meta.offset         = +val; break;
      case 'bg':           chart.meta.bg             = val; break;
      case 'layer':        chart.meta.layer          = val; break;
      case 'po':           chart.meta.previewStart   = +val; break;
      case 'plength':      chart.meta.previewDuration= +val; break;
      case 'filtertype':   chart.laserSettings.filter= val; break;
      case 'pfiltergain':  chart.laserSettings.gain  = +val; break;
      case 'laserrange':
        chart.laserSettings.wide = (val === '2x');
        laserWide[0] = laserWide[1] = (val === '2x');
        break;
      case 'laserrange_l': laserWide[0] = (val === '2x'); break;
      case 'laserrange_r': laserWide[1] = (val === '2x'); break;
      case 'beat': {
        const [n, d] = val.split('/').map(Number);
        if (n > 0 && d > 0) { curTimeSig = { num: n, den: d }; chart.addTimeSigEvent(0, n, d); }
        break;
      }
      case 'fx-l': case 'fx-r': {
        const side = key === 'fx-l' ? 0 : 1;
        const inst = _kshEffectFromStr(val);
        if (inst) chart.fxChains[side] = [inst];
        break;
      }
      case 'fx-l_se':      chart.meta.fxLSE         = val; break;
      case 'fx-r_se':      chart.meta.fxRSE         = val; break;
      case 'total':        chart.meta.total         = +val; break;
      case 'information':  chart.meta.information   = val; break;
      case 'ver':          chart.meta.ver           = val; break;
      case 'chokkakuse':   chart.meta.chokkakuse    = +val; break;
      case 'chokkakuvol':  chart.meta.chokkakuvol   = +val; break;
      default: break;
    }
  };

  // ── Main parse loop ───────────────────────────────────────────────────────────
  for (const raw of rawLines) {
    const ln = raw.trim();

    if (!inBody) {
      // ─ Header section ─
      if (ln === '--') { inBody = true; continue; }
      if (ln.startsWith('//') || ln === '') continue;
      const eq = ln.indexOf('=');
      if (eq < 0) continue;
      parseHeaderLine(ln.slice(0, eq).trim(), ln.slice(eq + 1).trim());

    } else {
      // ─ Body section ─
      if (ln === '--') { flushMeasure(); continue; }
      if (ln.startsWith('//') || ln === '') continue;

      if (ln.includes('|')) {
        // Note line
        measureBuffer.push({ type: 'note', content: ln });
      } else if (ln.includes('=')) {
        const eq = ln.indexOf('=');
        const key = ln.slice(0, eq).trim();
        const val = ln.slice(eq + 1).trim();
        // beat= changes the measure length and is applied immediately
        // (it must precede note lines in that measure per KSH spec)
        if (key === 'beat') {
          const [n, d] = val.split('/').map(Number);
          if (n > 0 && d > 0) {
            curTimeSig = { num: n, den: d };
            chart.addTimeSigEvent(measureNum, n, d);
          }
        } else {
          // All other events are buffered — applied at the next note-line tick
          measureBuffer.push({ type: 'event', key, val });
        }
      }
    }
  }

  // Flush final measure (file may not end with --)
  if (measureBuffer.length > 0) flushMeasure();

  // Finalize any holds that reached the end of the chart
  const endTick = measureStartTick;
  for (let li = 0; li < 4; li++) finalizeBtHold(li, endTick);
  for (let li = 0; li < 2; li++) finalizeFxHold(li, endTick);

  // Ensure chart spans at least as many measures as the data
  chart.totalMeasures = Math.max(measureNum, chart.totalMeasures);

  return chart;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

export function getTimeSigAt(chart, measure) {
  let ts = { num: 4, den: 4 };
  for (const ev of chart.timeSigEvents) {
    if (ev.measure <= measure) ts = ev;
    else break;
  }
  return ts;
}

export function timeSigEqual(a, b) { return a.num === b.num && a.den === b.den; }

export function downloadText(filename, text) {
  // Firefox (and some Safari builds) refuse to fire downloads when the anchor
  // isn't part of the DOM, and revoking the object URL synchronously can
  // cancel the transfer mid-flight. Attach, click, then revoke on a delay.
  try {
    const blob = new Blob([text], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');

    a.href     = url;
    a.download = filename;
    a.rel      = 'noopener';
    a.style.display = 'none';

    console.log(`[Download] Creating download: ${filename}, blob size: ${blob.size} bytes`);
    console.log(`[Download] Object URL: ${url.substring(0, 60)}...`);

    document.body.appendChild(a);
    console.log(`[Download] Anchor appended to DOM`);

    // Use requestAnimationFrame to ensure DOM update before click
    let hasClickSucceeded = false;
    requestAnimationFrame(() => {
      try {
        a.click();
        hasClickSucceeded = true;
        console.log(`[Download] click() invoked successfully`);
      } catch (clickErr) {
        console.error(`[Download] click() threw exception:`, clickErr);
      }

      // Provide fallback: create visible download link if click appears to fail
      if (!hasClickSucceeded) {
        console.warn(`[Download] Programmatic click failed, creating fallback link`);
        const fallbackA = document.createElement('a');
        fallbackA.href = url;
        fallbackA.download = filename;
        fallbackA.textContent = `📥 Download ${filename}`;
        fallbackA.style.cssText = 'display:block;padding:12px 16px;background:#0066cc;color:white;text-decoration:none;border-radius:4px;text-align:center;z-index:99999;position:fixed;bottom:24px;right:24px;font-family:system-ui;font-size:14px;box-shadow:0 4px 8px rgba(0,0,0,0.3);';
        document.body.appendChild(fallbackA);
        console.log(`[Download] Fallback link added to page`);

        // Auto-remove fallback after 60 seconds (user has time to click)
        setTimeout(() => {
          try { document.body.removeChild(fallbackA); } catch(_) {}
          URL.revokeObjectURL(url);
          console.log(`[Download] Fallback timeout, URL revoked`);
        }, 60000);
      } else {
        // Normal cleanup: remove anchor and revoke URL after 4 seconds
        setTimeout(() => {
          try {
            if (document.body.contains(a)) {
              document.body.removeChild(a);
            }
          } catch (removeErr) {
            console.warn(`[Download] Could not remove anchor:`, removeErr);
          }
          URL.revokeObjectURL(url);
          console.log(`[Download] Object URL revoked`);
        }, 4000);
      }
    });

    console.log(`[Download] Download sequence initiated: ${filename}`);
  } catch (err) {
    console.error(`[Download] Fatal error:`, err);
    alert(`Download failed: ${err.message}`);
  }
}
