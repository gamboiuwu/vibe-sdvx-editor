'use strict';

// KSON uses 240 ticks per beat (960 per 4/4 measure)
const KSON_TPB = 240;
const KSH_TO_KSON = KSON_TPB / TICKS_PER_BEAT; // 5x

function exportKson(chart) {
  const m = chart.meta;

  const kson = {
    version: '0.8.0',
    meta: {
      title:      m.title,
      artist:     m.artist,
      chart_author: m.effect,
      difficulty: {
        name:  m.difficulty.toUpperCase(),
        short_name: m.difficulty.slice(0, 3).toUpperCase(),
        idx:   ['light','challenge','extended','infinite'].indexOf(m.difficulty),
      },
      level:      m.level,
      disp_bpm:   String(m.bpm),
      std_bpm:    m.bpm,
      jacket_filename: m.jacket,
      jacket_author:   m.illust,
      icon_filename:   '',
      information:     '',
    },
    beat: {
      bpm: chart.bpmEvents.map(ev => ({ y: ev.y * KSH_TO_KSON, v: ev.bpm })),
      time_sig: chart.timeSigEvents.map(ev => ({
        idx: ev.measure,
        v:   [ev.num, ev.den],
      })),
      scroll_speed: [{ y: 0, v: 1.0 }],
    },
    note: {
      bt: chart.bt.map(lane =>
        lane.map(n => n.len === 0 ? [n.y * KSH_TO_KSON, 0]
                                   : [n.y * KSH_TO_KSON, n.len * KSH_TO_KSON])
      ),
      fx: chart.fx.map(lane =>
        lane.map(n => n.len === 0 ? [n.y * KSH_TO_KSON, 0]
                                   : [n.y * KSH_TO_KSON, n.len * KSH_TO_KSON])
      ),
      laser: chart.lasers.map((sections, side) =>
        sections.map(sec => ({
          y:    sec.y * KSH_TO_KSON,
          // Interpolation and slam preserved for lossless round-trips.
          // a/b encode the curve shape; 'step' stored as non-standard 'interp'
          // field which KSON-compliant readers safely ignore.
          v:    sec.points.map(pt => {
            const interp = pt.interp ?? 'linear';
            const curve  = pt.curve  ?? 0.5;
            const kpt = { ry: pt.ry * KSH_TO_KSON, v: pt.v };
            if (interp === 'bezier') {
              kpt.a = curve; kpt.b = curve;
            } else if (interp === 'step') {
              kpt.a = 0.5; kpt.b = 0.5;
              kpt.interp = 'step'; // round-trip marker
            } else {
              kpt.a = 0.5; kpt.b = 0.5;
            }
            if (pt.slam === true) kpt.slam = true;
            return kpt;
          }),
          wide: sec.wide ? 2 : 1,
        }))
      ),
    },
    audio: {
      bgm: {
        filename:  m.music,
        vol:       1.0,
        offset:    m.offset,
        preview: {
          offset: m.previewStart,
          duration: m.previewDuration,
        },
      },
      key_sound: { laser: { vol: 0.5 }, button: { vol: 1.0 } },
      audio_effect: {
        fx: {
          def: chart.fxChains.flatMap((chain, side) =>
            chain.map((inst, i) => ({
              name: `fx_${side === 0 ? 'l' : 'r'}_${i}`,
              type: inst.type,
              v:    inst.params,
            }))
          ),
          param_change: {},
        },
        laser: {
          def: [{
            name:  'laser_filter',
            type:  chart.laserSettings.filter,
            v:     { gain: chart.laserSettings.gain / 100 },
          }],
          param_change: {},
        },
      },
    },
    camera: {
      tilt: {
        manual:    [],
        keep:      false,
        scale:     [{ y: 0, v: 1.0 }],
      },
      cam: {
        body: {
          zoom:   [],
          shift_x:[],
          rotation_x: [],
          rotation_z: [],
        },
        pattern: { laser: { slam_event: { spin: [], half_spin: [], swing: [] } } },
      },
    },
    bg: {
      filename: m.bg,
      offset:   0,
    },
  };

  return JSON.stringify(kson, null, 2);
}

function importKson(text) {
  const data  = JSON.parse(text);
  const chart = new ChartData();

  const meta = data.meta ?? {};
  chart.meta.title   = meta.title   ?? '';
  chart.meta.artist  = meta.artist  ?? '';
  chart.meta.effect  = meta.chart_author ?? '';
  chart.meta.jacket  = meta.jacket_filename ?? '';
  chart.meta.illust  = meta.jacket_author ?? '';
  chart.meta.level   = meta.level   ?? 10;
  chart.meta.bpm     = meta.std_bpm ?? 180;
  if (meta.difficulty) {
    chart.meta.difficulty = meta.difficulty.name?.toLowerCase() ?? 'infinite';
  }

  const beat = data.beat ?? {};
  if (beat.bpm) {
    chart.bpmEvents = beat.bpm.map(e => ({
      y:   Math.round(e.y / KSH_TO_KSON),
      bpm: e.v,
    }));
    if (chart.bpmEvents.length) chart.meta.bpm = chart.bpmEvents[0].bpm;
  }
  if (beat.time_sig) {
    chart.timeSigEvents = beat.time_sig.map(e => ({
      measure: e.idx,
      num:     e.v[0],
      den:     e.v[1],
    }));
  }

  const note = data.note ?? {};
  if (note.bt) {
    note.bt.forEach((lane, li) => {
      lane.forEach(n => {
        const y   = Math.round(n[0] / KSH_TO_KSON);
        const len = Math.round(n[1] / KSH_TO_KSON);
        chart.addBtNote(li, y, len);
      });
    });
  }
  if (note.fx) {
    note.fx.forEach((lane, li) => {
      lane.forEach(n => {
        const y   = Math.round(n[0] / KSH_TO_KSON);
        const len = Math.round(n[1] / KSH_TO_KSON);
        chart.addFxNote(li, y, len);
      });
    });
  }
  if (note.laser) {
    note.laser.forEach((sections, side) => {
      sections.forEach(sec => {
        if (!sec.v || sec.v.length === 0) return;
        const startY = Math.round(sec.y / KSH_TO_KSON);
        // Reconstruct slam flags with a clear priority order:
        //   1. pt.slam === true  → explicit slam (our editor wrote this, trust it)
        //   2. pt.slam === false → explicit non-slam (our editor wrote this, trust it)
        //   3. pt.slam absent    → infer from tick distance using LASER_SLAM_TICKS
        // This means external KSON files (no slam field) still get reasonable detection,
        // while our own KSON files survive a lossless round-trip.
        const points = sec.v.map((pt, pi) => {
          const ry = Math.round(pt.ry / KSH_TO_KSON);
          let isSlam = false;
          if (pi > 0) {
            if (pt.slam === true) {
              isSlam = true;   // explicitly flagged slam — no heuristic needed
            } else if (pt.slam !== false) {
              // No explicit flag (external KSON) — fall back to tick-distance check.
              // Use the runtime-configurable LASER_SLAM_TICKS (default 6) so Gameplay
              // preference changes propagate here too.
              const prevRy = Math.round(sec.v[pi - 1].ry / KSH_TO_KSON);
              isSlam = (ry - prevRy) <= LASER_SLAM_TICKS;
            }
            // pt.slam === false: explicitly marked non-slam; isSlam stays false.
          }
          // Reconstruct interpolation type from a/b (or explicit 'interp' field)
          let reconInterp = 'linear';
          let reconCurve  = 0.5;
          if (pt.interp === 'step') {
            reconInterp = 'step';
          } else if (pt.a !== undefined && Math.abs(pt.a - 0.5) > 0.01) {
            reconInterp = 'bezier';
            reconCurve  = (pt.a + (pt.b ?? pt.a)) / 2;
          }
          return { ry, v: pt.v, slam: isSlam, interp: reconInterp, curve: reconCurve };
        });
        // Slam segments must render as step (hold-then-jump), not linear.
        // The interp lives on p0 (outgoing) but slam is flagged on p1 (incoming).
        // Patch any p0 whose outgoing segment is a slam and whose interp was not
        // already set to something intentional (bezier/step) by the a/b fields.
        for (let i = 1; i < points.length; i++) {
          if (points[i].slam && points[i - 1].interp === 'linear') {
            points[i - 1].interp = 'step';
          }
        }
        chart.lasers[side].push({ y: startY, points, wide: sec.wide === 2 });
        chart.lasers[side].sort((a, b) => a.y - b.y);
      });
    });
  }

  const bgm = data.audio?.bgm;
  if (bgm) {
    chart.meta.music  = bgm.filename ?? '';
    chart.meta.offset = bgm.offset   ?? 0;
    chart.meta.previewStart    = bgm.preview?.offset   ?? 0;
    chart.meta.previewDuration = bgm.preview?.duration ?? 15000;
  }

  chart.totalMeasures = Math.max(64,
    Math.ceil(chart.bt.flat().reduce((m, n) => Math.max(m, n.y + n.len), 0) / TICKS_PER_MEASURE) + 4
  );

  return chart;
}
