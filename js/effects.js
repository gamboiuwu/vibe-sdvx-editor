'use strict';

// All KSH/KSON effect types with display names and parameter schemas.
// min/max/step/default are for UI sliders/inputs.
const EFFECT_DEFS = {
  retrigger: {
    label: 'Retrigger',
    kshName: 'Retrigger',
    params: {
      waveLength:  { label: 'Wave Length', min: 1,   max: 64,  step: 1,    def: 8,   unit: '/beat' },
      rate:        { label: 'Rate',         min: 0,   max: 100, step: 1,    def: 70,  unit: '%' },
      updatePeriod:{ label: 'Update Period',min: 1,   max: 32,  step: 1,    def: 1,   unit: '/beat' },
      mix:         { label: 'Mix',          min: 0,   max: 100, step: 1,    def: 100, unit: '%' },
    }
  },
  gate: {
    label: 'Gate',
    kshName: 'Gate',
    params: {
      waveLength: { label: 'Wave Length', min: 1,  max: 64,  step: 1, def: 8,  unit: '/beat' },
      rate:       { label: 'Rate',        min: 0,  max: 100, step: 1, def: 60, unit: '%' },
      mix:        { label: 'Mix',         min: 0,  max: 100, step: 1, def: 90, unit: '%' },
    }
  },
  flanger: {
    label: 'Flanger',
    kshName: 'Flanger',
    params: {
      period:   { label: 'Period',    min: 1,   max: 64,  step: 1,   def: 2,   unit: '/beat' },
      delay:    { label: 'Delay',     min: 0,   max: 100, step: 1,   def: 30,  unit: 'ms' },
      depth:    { label: 'Depth',     min: 0,   max: 100, step: 1,   def: 60,  unit: '%' },
      feedback: { label: 'Feedback',  min: 0,   max: 100, step: 1,   def: 60,  unit: '%' },
      stereoWidth: { label: 'Stereo', min: 0,   max: 100, step: 1,   def: 0,   unit: '%' },
      mix:      { label: 'Mix',       min: 0,   max: 100, step: 1,   def: 80,  unit: '%' },
    }
  },
  pitchshift: {
    label: 'PitchShift',
    kshName: 'PitchShift',
    params: {
      pitch:     { label: 'Pitch',     min: -24, max: 24,  step: 1,   def: 0,   unit: 'st' },
      chunkSize: { label: 'Chunk',     min: 32,  max: 4096,step: 32,  def: 700, unit: 'ms' },
      overlap:   { label: 'Overlap',   min: 1,   max: 100, step: 1,   def: 20,  unit: '%' },
      mix:       { label: 'Mix',       min: 0,   max: 100, step: 1,   def: 100, unit: '%' },
    }
  },
  bitcrusher: {
    label: 'BitCrusher',
    kshName: 'BitCrusher',
    params: {
      reduction: { label: 'Reduction', min: 0,   max: 100, step: 1,   def: 60,  unit: 'smp' },
      mix:       { label: 'Mix',       min: 0,   max: 100, step: 1,   def: 100, unit: '%' },
    }
  },
  phaser: {
    label: 'Phaser',
    kshName: 'Phaser',
    params: {
      period:   { label: 'Period',   min: 1,   max: 64,  step: 1,   def: 4,   unit: '/beat' },
      stages:   { label: 'Stages',   min: 1,   max: 12,  step: 1,   def: 6,   unit: '' },
      feedback: { label: 'Feedback', min: 0,   max: 100, step: 1,   def: 35,  unit: '%' },
      mix:      { label: 'Mix',      min: 0,   max: 100, step: 1,   def: 50,  unit: '%' },
    }
  },
  wobble: {
    label: 'Wobble',
    kshName: 'Wobble',
    params: {
      waveLength: { label: 'Wave Length', min: 1,   max: 64,  step: 1,   def: 12,  unit: '/beat' },
      loFreq:     { label: 'Lo Freq',     min: 100, max: 2000,step: 10,  def: 500, unit: 'Hz' },
      hiFreq:     { label: 'Hi Freq',     min: 1000,max: 20000,step: 100,def: 20000,unit:'Hz' },
      q:          { label: 'Q',           min: 1,   max: 100, step: 1,   def: 1,   unit: '' },
      mix:        { label: 'Mix',         min: 0,   max: 100, step: 1,   def: 50,  unit: '%' },
    }
  },
  tapestop: {
    label: 'TapeStop',
    kshName: 'TapeStop',
    params: {
      speed:  { label: 'Speed',  min: 1,  max: 100, step: 1, def: 50, unit: '%' },
      mix:    { label: 'Mix',    min: 0,  max: 100, step: 1, def: 100,unit: '%' },
    }
  },
  echo: {
    label: 'Echo',
    kshName: 'Echo',
    params: {
      waveLength: { label: 'Wave Length', min: 1,   max: 64,  step: 1,   def: 4,   unit: '/beat' },
      feedback:   { label: 'Feedback',    min: 0,   max: 100, step: 1,   def: 60,  unit: '%' },
      mix:        { label: 'Mix',         min: 0,   max: 100, step: 1,   def: 50,  unit: '%' },
    }
  },
  sidechain: {
    label: 'SideChain',
    kshName: 'SideChain',
    params: {
      period:    { label: 'Period',    min: 1,  max: 64,  step: 1, def: 8,  unit: '/beat' },
      holdTime:  { label: 'Hold',      min: 0,  max: 100, step: 1, def: 50, unit: 'ms' },
      attackTime:{ label: 'Attack',    min: 0,  max: 100, step: 1, def: 10, unit: 'ms' },
      releaseTime:{ label: 'Release',  min: 0,  max: 500, step: 1, def: 60, unit: 'ms' },
      mix:       { label: 'Mix',       min: 0,  max: 100, step: 1, def: 90, unit: '%' },
    }
  },
};

// Build a default parameter set for an effect type
function makeEffectInstance(type) {
  const def = EFFECT_DEFS[type];
  if (!def) return null;
  const params = {};
  for (const [k, p] of Object.entries(def.params)) params[k] = p.def;
  return { type, enabled: true, params };
}

// KSH fx-l/fx-r string representation
function effectToKsh(inst) {
  const def = EFFECT_DEFS[inst.type];
  if (!def) return '';
  const p = inst.params;
  switch (inst.type) {
    case 'retrigger':  return `Retrigger;${p.waveLength}`;
    case 'gate':       return `Gate;${p.waveLength}`;
    case 'flanger':    return 'Flanger';
    case 'pitchshift': return `PitchShift;${p.pitch}`;
    case 'bitcrusher': return `BitCrusher;${p.reduction}`;
    case 'phaser':     return 'Phaser';
    case 'wobble':     return `Wobble;${p.waveLength}`;
    case 'tapestop':   return `TapeStop;${p.speed}`;
    case 'echo':       return `Echo;${p.waveLength};${p.feedback}`;
    case 'sidechain':  return 'SideChain';
    default:           return def.kshName;
  }
}
