import { TICKS_PER_BEAT, TICKS_PER_MEASURE, ChartData, LASER_SLAM_TICKS } from './chart.js';
import { EFFECT_DEFS } from './effects.js';

// KSON uses 240 ticks per beat (960 per 4/4 measure)
export const KSON_TPB = 240;
export const KSH_TO_KSON = KSON_TPB / TICKS_PER_BEAT; // 5x

// ── Export ──────────────────────────────────────────────────────────────────
//
// KSON v0.8.0 reference: https://github.com/kshootmania/ksm-chart-format
//
// IMPORTANT FORMAT NOTES (these were getting written as objects before, which
// is why other readers couldn't parse FX/laser/bpm correctly):
//
//  • ByPulse<T>      → JSON array [y, v]            (NOT {y: ..., v: ...})
//  • ByMeasureIdx<T> → JSON array [idx, v]
//  • LaserSection    → JSON array [y, points[], w]
//  • GraphSectionPoint
//                    → [ry, v]            for a regular point
//                    → [ry, [v_in, v_out]] for a slam (GraphValue form)
//                    → optional [a, b]    curve as third element
//  • DefKeyValuePair → [name, def]                  (NOT {name, ...})
//  • meta.difficulty → uint                         (NOT an object)
//
// A slam in our internal model is two adjacent points where the second has
// slam=true. In KSON it's ONE point at the slam's target pulse with v in
// GraphValue form [v_in, v_out]. exportKson merges the pair; importKson
// splits it back.

export function exportKson(chart) {
  const m = chart.meta;

  const DIFF_TABLE = ['light', 'challenge', 'extended', 'infinite'];
  const diffIdx = Math.max(0, DIFF_TABLE.indexOf(m.difficulty));

  // ── Lasers: convert each section to [y, points[], w] form ───────────────
  // Slam pairs are merged into a single GraphValue point per the spec.
  const buildLaserSections = (sections) => sections.map(sec => {
    const pts = sec.points || [];
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const prev = i > 0 ? pts[i - 1] : null;
      const ry = Math.round(pt.ry * KSH_TO_KSON);
      let v;
      // Use the shared slam predicate so heuristic slams (close points without an
      // explicit flag, e.g. older drag-placed data) export correctly too.
      if (prev && ChartData.isPointSlam(prev, pt)) {
        // Slam at this pulse: laser jumps from prev.v to pt.v
        v = [prev.v, pt.v];
      } else {
        v = pt.v;
      }
      const point = [ry, v];
      // Curve element [a, b]. Spec default is [0, 0]. We use it to encode
      // bezier curvature; readers that don't understand the value treat it
      // as a normal interpolation hint.
      if (pt.interp === 'bezier') {
        const c = pt.curve ?? 0.5;
        point.push([c, c]);
      } else if (pt.interp === 'step') {
        // 'step' isn't part of standard KSON. Use [1, 0] (max bias) as a
        // hint; we ALSO write a sibling _interp field so vibe-editr can
        // recover the exact mode on round-trip.
        point.push([1.0, 0.0]);
      }
      out.push(point);
    }
    return [Math.round(sec.y * KSH_TO_KSON), out, sec.wide ? 2 : 1];
  });

  // ── FX effects: def + long_event for per-hold attachment ─────────────────
  // Per the spec, fxChains aren't tied to individual notes — they're attached
  // to long FX notes via audio_effect.fx.long_event[<def_name>] = [[y, 0 or
  // params_dict], ...].  Default mapping: every long FX note on lane L gets
  // every effect in chart.fxChains[0]; same for R.
  const fxDef = [];
  const longEvent = {};
  for (let side = 0; side < 2; side++) {
    const chain = chart.fxChains[side] || [];
    if (!chain.length) continue;
    const sideKey = side === 0 ? 'l' : 'r';
    const longNotes = chart.fx[side].filter(n => n.len > 0);
    for (let i = 0; i < chain.length; i++) {
      const inst = chain[i];
      const defName = `fx_${sideKey}_${i}`;
      // Param values are spec'd as strings; stringify cleanly.
      const vDict = {};
      for (const [k, val] of Object.entries(inst.params || {})) {
        vDict[k] = String(val);
      }
      fxDef.push([defName, { type: inst.type, v: vDict }]);
      if (longNotes.length) {
        longEvent[defName] = longNotes.map(n => [
          Math.round(n.y * KSH_TO_KSON),
          0, // 0 = invoke with the def's default params
        ]);
      }
    }
  }

  const kson = {
    version: '0.8.0',
    meta: {
      title:           m.title,
      artist:          m.artist,
      chart_author:    m.effect,
      difficulty:      diffIdx,           // spec: uint, NOT an object
      level:           m.level,
      disp_bpm:        String(m.bpm),
      std_bpm:         m.bpm,
      jacket_filename: m.jacket,
      jacket_author:   m.illust,
      icon_filename:   '',
      information:     '',
    },
    beat: {
      bpm:          chart.bpmEvents.map(ev => [Math.round(ev.y * KSH_TO_KSON), ev.bpm]),
      time_sig:     chart.timeSigEvents.map(ev => [ev.measure, [ev.num, ev.den]]),
      scroll_speed: (chart.scrollSpeedEvents || []).map(ev => {
        const entry = [Math.round(ev.y * KSH_TO_KSON), ev.speed];
        if (ev.interp === 'linear') entry.push('l'); // 'l' = linear interpolation
        return entry;
      }),
    },
    _glitchEvents: (chart.glitchEvents || []).map(ev => [ev.y, ev.level]),
    // Camera / lane effect events (zoom_top/bottom/side, tilt, lane_toggle,
    // center_split). Stored verbatim in raw editor ticks so the editor's own
    // KSON round-trip (incl. autosave) is lossless. Native KSON readers ignore
    // this field; the KSH exporter writes the equivalent standard body lines.
    _cameraEvents: (chart.cameraEvents && chart.cameraEvents.length)
      ? chart.cameraEvents.map(ev => [ev.y, ev.type, String(ev.value)])
      : undefined,
    _sections: (chart.sections && chart.sections.length)
      ? chart.sections.map(s => [s.y, s.endY, s.label || '', s.color || '#4488ff'])
      : undefined,
    _fxAutomation: (() => {
      const fa = chart._fxAutomation;
      if (!fa) return undefined;
      const hasL = fa.L && fa.L.length > 0;
      const hasR = fa.R && fa.R.length > 0;
      if (!hasL && !hasR) return undefined;
      return {
        L: (fa.L || []).map(p => [p.y, p.v, p.m === 'linear' ? 1 : 0]),
        R: (fa.R || []).map(p => [p.y, p.v, p.m === 'linear' ? 1 : 0]),
      };
    })(),
    note: {
      bt: chart.bt.map(lane =>
        lane.map(n => [Math.round(n.y * KSH_TO_KSON), Math.round((n.len || 0) * KSH_TO_KSON)])
      ),
      fx: chart.fx.map(lane =>
        lane.map(n => [Math.round(n.y * KSH_TO_KSON), Math.round((n.len || 0) * KSH_TO_KSON)])
      ),
      laser: chart.lasers.map(buildLaserSections),
    },
    audio: {
      bgm: {
        filename: m.music,
        vol:      1.0,
        offset:   m.offset,
        preview: {
          offset:   m.previewStart,
          duration: m.previewDuration,
        },
      },
      key_sound: { laser: { vol: 0.5 }, button: { vol: 1.0 } },
      audio_effect: {
        fx: {
          def:          fxDef,
          param_change: {},
          long_event:   longEvent,
        },
        laser: {
          def: [['laser_filter', {
            type: chart.laserSettings.filter,
            v:    { gain: String(chart.laserSettings.gain / 100) },
          }]],
          param_change:         {},
          pulse_event:          {},
          peaking_filter_delay: 0,
        },
      },
    },
    camera: {
      tilt: { manual: [], keep: false, scale: [[0, 1.0]] },
      cam: {
        body:    { zoom: [], shift_x: [], rotation_x: [], rotation_z: [] },
        pattern: { laser: { slam_event: { spin: [], half_spin: [], swing: [] } } },
      },
    },
    bg: { filename: m.bg, offset: 0 },
  };

  return JSON.stringify(kson, null, 2);
}

// ── Import ──────────────────────────────────────────────────────────────────
//
// Accepts BOTH array form (spec-compliant, what we now write) and the legacy
// object form ({y, v}, {ry, v, slam, a, b}, etc.) so older vibe-editr exports
// still load.

export function importKson(text) {
  const data  = JSON.parse(text);
  const chart = new ChartData();

  // ── Tiny helpers for the dual-form readers ───────────────────────────────
  // ByPulse<T>: [y, v] OR {y, v}
  const readByPulse = (raw) => Array.isArray(raw)
    ? { y: raw[0], v: raw[1] }
    : { y: raw.y, v: raw.v };
  // ByMeasureIdx<T>: [idx, v] OR {idx, v}
  const readByMeasure = (raw) => Array.isArray(raw)
    ? { idx: raw[0], v: raw[1] }
    : { idx: raw.idx, v: raw.v };

  // ── Meta ────────────────────────────────────────────────────────────────
  const meta = data.meta ?? {};
  chart.meta.title   = meta.title   ?? '';
  chart.meta.artist  = meta.artist  ?? '';
  chart.meta.effect  = meta.chart_author ?? '';
  chart.meta.jacket  = meta.jacket_filename ?? '';
  chart.meta.illust  = meta.jacket_author ?? '';
  chart.meta.level   = meta.level   ?? 10;
  chart.meta.bpm     = meta.std_bpm ?? 180;
  // difficulty is a number per spec, but older vibe-editr exports used
  // {name, short_name, idx}. Handle both.
  if (typeof meta.difficulty === 'number') {
    chart.meta.difficulty =
      ['light','challenge','extended','infinite'][meta.difficulty] ?? 'infinite';
  } else if (meta.difficulty?.name) {
    chart.meta.difficulty = meta.difficulty.name.toLowerCase();
  }

  // ── Beat ────────────────────────────────────────────────────────────────
  const beat = data.beat ?? {};
  if (Array.isArray(beat.bpm) && beat.bpm.length) {
    chart.bpmEvents = beat.bpm.map(e => {
      const p = readByPulse(e);
      return { y: Math.round(p.y / KSH_TO_KSON), bpm: Number(p.v) };
    });
    if (chart.bpmEvents.length) chart.meta.bpm = chart.bpmEvents[0].bpm;
  }
  if (Array.isArray(beat.time_sig) && beat.time_sig.length) {
    chart.timeSigEvents = beat.time_sig.map(e => {
      const r = readByMeasure(e);
      const v = r.v;
      return {
        measure: r.idx,
        num: Array.isArray(v) ? v[0] : v.num,
        den: Array.isArray(v) ? v[1] : v.den,
      };
    });
  }
  // Chart Velocity (scroll_speed): visual speed multiplier events
  if (Array.isArray(beat.scroll_speed) && beat.scroll_speed.length) {
    chart.scrollSpeedEvents = beat.scroll_speed.map(e => {
      const p = readByPulse(e);
      const interp = Array.isArray(e) && e[2] === 'l' ? 'linear' : 'step';
      return { y: Math.round(p.y / KSH_TO_KSON), speed: Number(p.v) || 1.0, interp };
    });
    // Ensure anchor at y=0
    if (!chart.scrollSpeedEvents.some(ev => ev.y === 0)) {
      chart.scrollSpeedEvents.unshift({ y: 0, speed: 1.0 });
      chart.scrollSpeedEvents.sort((a, b) => a.y - b.y);
    }
  }

  // Glitch events (custom field)
  if (Array.isArray(data._glitchEvents) && data._glitchEvents.length) {
    chart.glitchEvents = data._glitchEvents.map(e => ({ y: e[0], level: e[1] ?? 0 }));
    if (!chart.glitchEvents.some(ev => ev.y === 0)) {
      chart.glitchEvents.unshift({ y: 0, level: 0 });
      chart.glitchEvents.sort((a, b) => a.y - b.y);
    }
  }

  // Camera / lane effect events (custom field)
  if (Array.isArray(data._cameraEvents) && data._cameraEvents.length) {
    const CAM_TYPES = new Set([
      'zoom_top', 'zoom_bottom', 'zoom_side', 'tilt', 'lane_toggle', 'center_split',
    ]);
    chart.cameraEvents = data._cameraEvents
      .filter(e => Array.isArray(e) && CAM_TYPES.has(e[1]))
      .map(e => ({ y: e[0] ?? 0, type: e[1], value: String(e[2] ?? '0') }))
      .sort((a, b) => a.y - b.y);
  }

  // Section labels (custom field)
  if (Array.isArray(data._sections) && data._sections.length) {
    chart.sections = data._sections.map(s => ({
      y:     s[0] ?? 0,
      endY:  s[1] ?? 0,
      label: s[2] ?? '',
      color: s[3] ?? '#4488ff',
    })).filter(s => s.endY > s.y);
    chart.sections.sort((a, b) => a.y - b.y);
  }

  // FX automation (custom field)
  if (data._fxAutomation) {
    const parseSide = arr => Array.isArray(arr)
      ? arr.map(p => ({ y: p[0] ?? 0, v: p[1] ?? 1, m: p[2] ? 'linear' : 'step' }))
            .sort((a, b) => a.y - b.y)
      : [];
    chart._fxAutomation = {
      L: parseSide(data._fxAutomation.L),
      R: parseSide(data._fxAutomation.R),
    };
  }

  // ── Notes: BT / FX ──────────────────────────────────────────────────────
  const note = data.note ?? {};
  if (note.bt) {
    note.bt.forEach((lane, li) => {
      lane.forEach(n => {
        const y   = Math.round(n[0] / KSH_TO_KSON);
        const len = Math.round((n[1] || 0) / KSH_TO_KSON);
        chart.addBtNote(li, y, len);
      });
    });
  }
  if (note.fx) {
    note.fx.forEach((lane, li) => {
      lane.forEach(n => {
        const y   = Math.round(n[0] / KSH_TO_KSON);
        const len = Math.round((n[1] || 0) / KSH_TO_KSON);
        chart.addFxNote(li, y, len);
      });
    });
  }

  // ── Lasers ──────────────────────────────────────────────────────────────
  // Each section is either spec form [y, points[], w] or legacy
  // {y, v: points, wide}. Each point is either spec form [ry, v, [a, b]?]
  // or legacy {ry, v, slam, a, b, interp}.
  if (note.laser) {
    note.laser.forEach((sections, side) => {
      sections.forEach(rawSec => {
        // Unpack section header
        let startY, rawPts, wideFlag;
        if (Array.isArray(rawSec)) {
          startY   = rawSec[0];
          rawPts   = rawSec[1] || [];
          wideFlag = rawSec[2] === 2;
        } else {
          startY   = rawSec.y;
          rawPts   = rawSec.v || [];
          wideFlag = rawSec.wide === 2;
        }
        if (!rawPts.length) return;
        startY = Math.round(startY / KSH_TO_KSON);

        // First pass: read each point into a uniform shape
        // { ry, v, slam, vIn?, interp, curve }
        const points = [];
        for (let pi = 0; pi < rawPts.length; pi++) {
          const rawPt = rawPts[pi];
          let ry, vRaw, curveRaw, legacySlam, legacyInterp;
          if (Array.isArray(rawPt)) {
            ry      = rawPt[0];
            vRaw    = rawPt[1];
            curveRaw = rawPt[2];
          } else {
            ry      = rawPt.ry;
            vRaw    = (rawPt.vf !== undefined) ? [rawPt.v, rawPt.vf] : rawPt.v;
            curveRaw = (rawPt.a !== undefined) ? [rawPt.a, rawPt.b ?? rawPt.a] : undefined;
            legacySlam   = rawPt.slam;
            legacyInterp = rawPt.interp;
          }
          ry = Math.round(ry / KSH_TO_KSON);

          let isSlam = false;
          let vIn    = null;
          let vOut;
          if (Array.isArray(vRaw)) {
            // Spec slam form: v = [v_in, v_out]
            vIn    = vRaw[0];
            vOut   = vRaw[1];
            isSlam = true;
          } else {
            vOut = vRaw;
          }

          // Interpolation: bezier if curve[0] non-default, step if our marker
          let interp = 'linear';
          let curve  = 0.5;
          if (Array.isArray(curveRaw)) {
            if (curveRaw[0] === 1.0 && curveRaw[1] === 0.0) {
              interp = 'step';
            } else if (Math.abs(curveRaw[0] - 0.5) > 0.01) {
              interp = 'bezier';
              curve  = (curveRaw[0] + (curveRaw[1] ?? curveRaw[0])) / 2;
            }
          }
          if (legacyInterp === 'step') interp = 'step';
          if (legacySlam === true)     isSlam = true;
          if (legacySlam === false)    isSlam = false;

          points.push({ ry, v: vOut, slam: isSlam, vIn, interp, curve });
        }

        // Second pass: split slam points (one point with [v_in, v_out]) into
        // the two-point form our editor uses internally.
        // A slam at ry with vIn=A, vOut=B becomes:
        //   (ry - δ, v=A, slam=false)
        //   (ry,     v=B, slam=true)
        // Where δ is small enough to still be detected as a slam by
        // LASER_SLAM_TICKS-distance checks.
        const SLAM_GAP = Math.max(1, Math.floor((LASER_SLAM_TICKS ?? 6) / 2));
        const splitPoints = [];
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          if (pt.slam && pt.vIn !== null) {
            // Only split if there isn't already a preceding point near `ry`.
            // Otherwise the prior point already supplies v_in.
            const prior = splitPoints[splitPoints.length - 1];
            const priorIsClose = prior && (pt.ry - prior.ry) <= LASER_SLAM_TICKS;
            if (!priorIsClose || Math.abs(prior.v - pt.vIn) > 0.001) {
              splitPoints.push({
                ry: Math.max(0, pt.ry - SLAM_GAP),
                v: pt.vIn, slam: false, interp: pt.interp, curve: pt.curve,
              });
            }
          }
          splitPoints.push({
            ry: pt.ry, v: pt.v, slam: pt.slam,
            interp: pt.interp, curve: pt.curve,
          });
        }

        // Slams must render as step (hold-then-jump). The interp lives on p0
        // (outgoing) but slam is flagged on p1 (incoming). Patch the
        // outgoing interp for any unconverted segment.
        for (let i = 1; i < splitPoints.length; i++) {
          if (splitPoints[i].slam && splitPoints[i - 1].interp === 'linear') {
            splitPoints[i - 1].interp = 'step';
          }
        }

        chart.lasers[side].push({ y: startY, points: splitPoints, wide: wideFlag });
        chart.lasers[side].sort((a, b) => a.y - b.y);
      });
    });
  }

  // ── Audio / BGM ─────────────────────────────────────────────────────────
  const bgm = data.audio?.bgm;
  if (bgm) {
    chart.meta.music  = bgm.filename ?? '';
    chart.meta.offset = bgm.offset   ?? 0;
    chart.meta.previewStart    = bgm.preview?.offset   ?? 0;
    chart.meta.previewDuration = bgm.preview?.duration ?? 15000;
  }

  // ── FX effect chains: rebuild from audio_effect.fx.def ──────────────────
  // def is [[name, {type, v}], ...] in spec form, or [{name, type, v}, ...]
  // in legacy form. The name encodes which lane the effect belongs to
  // (fx_l_* → left, fx_r_* → right).
  const fxAE = data.audio?.audio_effect?.fx?.def;
  if (Array.isArray(fxAE)) {
    chart.fxChains = [[], []];
    for (const entry of fxAE) {
      let name, body;
      if (Array.isArray(entry)) { name = entry[0]; body = entry[1]; }
      else                      { name = entry.name; body = entry; }
      const side = /^fx_r_/.test(name) ? 1 : 0;
      // Convert string param values back into numbers when possible.
      const params = {};
      for (const [k, val] of Object.entries(body?.v || {})) {
        const n = Number(val);
        params[k] = Number.isFinite(n) && String(n) === String(val) ? n : val;
      }
      chart.fxChains[side].push({ type: body?.type, params });
    }
  }

  chart.totalMeasures = Math.max(64,
    Math.ceil(chart.bt.flat().reduce((m, n) => Math.max(m, n.y + n.len), 0) / TICKS_PER_MEASURE) + 4
  );

  return chart;
}

// ─────────────────────────────────────────────────────────────────────────────
// vibe-editr KSON pack format (.ksonpack)
//
// A simple wrapper that bundles multiple KSON charts into one file. The
// structure mirrors a regular .kson file but adds top-level metadata and an
// array of full chart objects (each one is whatever exportKson would write).
//
// {
//   "format":  "ksonpack",
//   "version": "0.1.0",
//   "meta":    { "title": "...", "artist": "...", "description": "...",
//                "created": "ISO-8601 timestamp" },
//   "charts":  [ <kson chart>, <kson chart>, ... ]
// }
//
// Designed so a standard KSON parser CAN extract any individual chart by
// reading `charts[i]` and serialising that subtree back out as KSON.
// ─────────────────────────────────────────────────────────────────────────────

export function exportKsonPack(charts, packMeta = {}, tabNames = []) {
  // Reuse exportKson then re-parse so each chart sits as a JS object inside
  // the bundle. Slightly wasteful but keeps a single export code path.
  const validCharts = charts.filter(c => c && c.meta);
  const entries = validCharts.map((c, i) => {
    const obj = JSON.parse(exportKson(c));
    const name = tabNames[i];
    if (name) obj._tabName = name;
    return obj;
  });

  // Collect all distinct audio filenames across all charts (basename only).
  // Stored in meta so the folder auto-loader can find them without unpacking charts.
  const audioFilenames = [...new Set(
    validCharts
      .map(c => c.meta?.music?.split(/[\\/]/).pop())
      .filter(Boolean)
  )];

  const pack = {
    format:  'ksonpack',
    version: '0.1.0',
    meta: {
      title:           packMeta.title       || 'Untitled Pack',
      artist:          packMeta.artist      || '',
      description:     packMeta.description || '',
      created:         new Date().toISOString(),
      chartCount:      entries.length,
      // Hint for folder-based auto-load: list of audio basenames used by charts.
      audioFilenames:  audioFilenames,
    },
    charts: entries,
  };
  return JSON.stringify(pack, null, 2);
}

export function importKsonPack(text) {
  const data = JSON.parse(text);
  if (data.format !== 'ksonpack' || !Array.isArray(data.charts)) {
    throw new Error('Not a ksonpack file (missing format:"ksonpack" or charts[]).');
  }
  const tabNames = data.charts.map(c => c._tabName || null);
  const charts = data.charts.map(c => importKson(JSON.stringify(c)));
  // audioFilenames: explicit list saved at export time; fall back to per-chart music fields.
  const audioFilenames = data.meta?.audioFilenames
    || [...new Set(data.charts.map(c => c.audio?.bgm?.filename?.split(/[\\/]/).pop()).filter(Boolean))];
  return { meta: data.meta || {}, charts, tabNames, audioFilenames };
}
