'use strict';

// ── Console banner ────────────────────────────────────────────────────────────
console.log(
  '%c vibe-editr %c vibecoded by gamboiuwu ',
  'background:#1255e8;color:#fff;font-weight:bold;font-size:13px;padding:3px 8px;border-radius:4px 0 0 4px',
  'background:#e000b8;color:#fff;font-weight:bold;font-size:13px;padding:3px 8px;border-radius:0 4px 4px 0'
);
console.log('%cSDVX Chart Editor  ·  vibe-editr', 'color:#6668a0;font-size:11px');

// ── Tabs ──────────────────────────────────────────────────────────────────────
const tabs = [{ name: 'Chart 1', chart: new ChartData(), audioBuffer: null }];
let activeTabIdx = 0;

// ── State ─────────────────────────────────────────────────────────────────────
let chart    = tabs[0].chart;
let renderer = null;
let tool     = 'select';
let snap     = 12;

const drag = { active: false, lane: -1, laneType: '', startTick: 0, side: 0, localX: 0, laserSec: null };
const sel  = { active: false, dragging: false, startTick: 0, endTick: 0, clipboard: null };
const undoStack = [], redoStack = [];
let MAX_UNDO = 100; // adjustable via preferences

// ── Camera tilt mode (updated by updateCameraFromEvents) ──────────────────────
let _tiltMode = 'zero'; // 'zero' | 'normal' | 'reverse' | 'keep'

// ── Chart annotation overlay ──────────────────────────────────────────────────
// Populated by tools (Hand Optimizer, Validity Checker) to show animated warning
// markers in both the 2D editor and SDVX game preview.
// Each entry: { tick, label, severity ('error'|'warn'), source, createdAt }
const _chartAnnotations = [];
const _ANN_LIFETIME = 7000; // ms visible (last 1200ms = fade-out)
const _ANN_FADE     = 1200; // ms of fade at end

function addChartAnnotation({ tick, label, severity, source }) {
  // Deduplicate by tick+source
  const idx = _chartAnnotations.findIndex(a => a.tick === tick && a.source === source);
  if (idx >= 0) _chartAnnotations.splice(idx, 1);
  _chartAnnotations.push({ tick: Math.round(tick), label, severity, source, createdAt: Date.now() });
  // Keep at most 30 live annotations
  while (_chartAnnotations.length > 30) _chartAnnotations.shift();
  // Kick the animation loop if not already running
  if (typeof _startAnnotationLoop === 'function') _startAnnotationLoop();
}

function _pruneAnnotations() {
  const cutoff = Date.now() - _ANN_LIFETIME;
  for (let i = _chartAnnotations.length - 1; i >= 0; i--) {
    if (_chartAnnotations[i].createdAt < cutoff) _chartAnnotations.splice(i, 1);
  }
}

function _annAlpha(ann) {
  const age = Date.now() - ann.createdAt;
  if (age >= _ANN_LIFETIME) return 0;
  if (age < _ANN_LIFETIME - _ANN_FADE) return 1;
  return 1 - (age - (_ANN_LIFETIME - _ANN_FADE)) / _ANN_FADE;
}

// Keep annotation animations alive even when nothing else is rendering.
// Runs at ~30 fps while annotations exist (bouncing markers need constant redraw).
let _annAnimActive  = false;
let _annLastFrame   = 0;
const _ANN_FPS      = 30;
function _startAnnotationLoop() {
  if (_annAnimActive) return;
  _annAnimActive = true;
  const loop = (now) => {
    _pruneAnnotations();
    if (_chartAnnotations.length === 0) { _annAnimActive = false; return; }
    // Throttle to ~30fps
    if (now - _annLastFrame >= 1000 / _ANN_FPS) {
      _annLastFrame = now;
      // Full chart redraw so annotations don't smear onto stale pixels
      renderer?.draw();
      renderer?.drawAnnotations?.(_chartAnnotations, _annAlpha);
      if (gameView && viewMode !== 'edit') {
        gameView.draw();
        gameView.drawAnnotations?.(_chartAnnotations, _annAlpha);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ── Camera-pill hover popup state ─────────────────────────────────────────────
// _camPopupPinned: true while the mouse is inside the popup (prevents auto-hide)
let _camPopupPinned = false;
// _camPopupFixedTick: the tick whose popup is currently pinned open (null = closed)
let _camPopupFixedTick = null;
// _fxPopupFixedLane: 0 or 1 while FX hold popup is open, null when closed
let _fxPopupFixedLane = null;

// ── Audio ─────────────────────────────────────────────────────────────────────
let audioCtx         = null;
let audioBuffer      = null;
let audioArrayBuffer = null; // raw bytes preserved before decodeAudioData (for IDB)
let audioSource      = null;
let audioStartAcTime = 0;
let audioStartChartSec = 0;
let laserFilterNode  = null;
let masterGainNode   = null;
let slamBuffer       = null;
let clapBuffer       = null;
let tickBuffer       = null;
let slamGainNode     = null;
let tickGainNode     = null;
let musicGainNode    = null;

// ── FX Effect Audio Nodes ────────────────────────────────────────────────────
// Wet/dry routing:  laserFilterNode → fxDryGain ─────────────────────────┐
//                                  → fxWetIn → [effect] → fxWetGain → mixOut → musicGainNode
let _fxDryGain    = null; // bypasses effect
let _fxWetIn      = null; // input to effect chain
let _fxWetGain    = null; // output mix control
let _fxMixOut     = null; // common output → musicGainNode
let _fxEffectType = null; // currently active effect type string

// ── FX chip SE (per-chart custom sounds from KSH fx-l_se / fx-r_se) ──────────
let fxChipSEBuffers = [null, null]; // [L, R] AudioBuffers
// Effect-specific nodes (created lazily)
let _fxWobbleFilter = null, _fxWobbleLFO = null, _fxWobbleLFOGain = null;
let _fxGateGain     = null, _fxGateTimer = null;
let _fxEchoDelay    = null, _fxEchoFB    = null, _fxEchoWet = null;
let _fxScGain       = null, _fxScTimer   = null;
let _fxFlangerDelay = null, _fxFlangerLFO = null, _fxFlangerLFOGain = null, _fxFlangerFB = null;
let _fxPhaserFilters = null, _fxPhaserLFO = null, _fxPhaserLFOGain = null;
let _fxBitcrusherProc = null;
let _fxRetriggerProc  = null;
let _fxTapeStopActive = false;

function ensureAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    masterGainNode = audioCtx.createGain();
    // Actual value set below after prefs are applied
    masterGainNode.connect(audioCtx.destination);

    // Music chain:
    //   audioSource → laserFilter → fxDryGain ──────────────────────┐
    //                             → fxWetIn → [effects] → fxWetGain → fxMixOut → musicGain → master
    musicGainNode = audioCtx.createGain();
    musicGainNode.connect(masterGainNode);

    _fxMixOut = audioCtx.createGain();
    _fxMixOut.gain.value = 1.0;
    _fxMixOut.connect(musicGainNode);

    _fxDryGain = audioCtx.createGain();
    _fxDryGain.gain.value = 1.0;
    _fxDryGain.connect(_fxMixOut);

    _fxWetIn = audioCtx.createGain();
    _fxWetIn.gain.value = 1.0;

    _fxWetGain = audioCtx.createGain();
    _fxWetGain.gain.value = 0.0; // silent until an effect is active
    _fxWetGain.connect(_fxMixOut);

    laserFilterNode = audioCtx.createBiquadFilter();
    laserFilterNode.type = 'lowpass';
    laserFilterNode.frequency.value = 20000;
    laserFilterNode.Q.value = 1.5;
    laserFilterNode.connect(_fxDryGain);
    laserFilterNode.connect(_fxWetIn);

    // SFX chains: slamGain → master, tickGain → master
    slamGainNode = audioCtx.createGain();
    slamGainNode.connect(masterGainNode);
    tickGainNode = audioCtx.createGain();
    tickGainNode.connect(masterGainNode);

    // ── Apply saved volume prefs immediately on first audio init ─────────────
    // prefs is already loaded from localStorage by this point, so we can use
    // whatever the user last saved. Fall back to safer defaults (slams/ticks
    // are naturally loud; ship them quieter than music by default).
    masterGainNode.gain.value = prefs.volMaster ?? 0.85;
    musicGainNode.gain.value  = prefs.volMusic  ?? 0.80;
    slamGainNode.gain.value   = prefs.volSlam   ?? 0.28;
    tickGainNode.gain.value   = prefs.volTick   ?? 0.22;

    navigator.mediaDevices?.addEventListener('devicechange', async () => {
      if (audioCtx?.state === 'suspended') await audioCtx.resume();
    });
    // Load slam sound
    fetch('sounds/slam.ogg').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { slamBuffer = buf; }).catch(() => {});
    // Load clap sound for FX chips
    fetch('sounds/tick.wav').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { clapBuffer = buf; }).catch(() => {});
    // Load tick sound for BT/FX hits
    fetch('sounds/tick.ogg').then(r => r.arrayBuffer()).then(b => audioCtx.decodeAudioData(b)).then(buf => { tickBuffer = buf; }).catch(() => {});
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

async function loadAudioFile(file) {
  _loadingShow(`Loading audio: ${file.name}`, 20);
  ensureAudioCtx();
  const buf = await file.arrayBuffer();
  _loadingShow('Decoding audio…', 55);
  audioArrayBuffer = buf.slice(0); // preserve bytes before decodeAudioData may transfer ownership
  audioBuffer = await audioCtx.decodeAudioData(buf);
  document.getElementById('audio-status').textContent = `Audio: ${file.name}`;
  _loadingDone();
}

// ── Playback ──────────────────────────────────────────────────────────────────
let playing        = false;
let playStartPerf  = 0;
let playStartTickV = 0;
let chartSpeed     = 1.0;  // hispeed: visual scroll density only
let prevPlayTick   = 0;

// ── View mode ─────────────────────────────────────────────────────────────────
let viewMode = 'split'; // start with 3D lane visible by default
let gameView = null;
const settings = { tickSound: false };

// Apply a new beats-per-lane value and update all related UI.
function applyBeatsPerLane(beats) {
  if (!renderer) return;
  renderer.beatsPerCol = beats;
  const bplSlider = document.getElementById('beats-per-lane');
  const bplLabel  = document.getElementById('beats-per-lane-label');
  if (bplSlider) bplSlider.value = renderer.beatsPerCol;
  if (bplLabel) {
    const b = renderer.beatsPerCol;
    const frac = b % 4 === 0
      ? `${b / 4} meas`
      : b % 2 === 0
        ? `${b / 2} half-meas`
        : `${b} beat${b !== 1 ? 's' : ''}`;
    bplLabel.textContent = `${b} (${frac})`;
  }
  renderer.resize();
  render();
  if (typeof updateSeekbar === 'function') updateSeekbar(renderer.playTick);
}

// ── Tab management ────────────────────────────────────────────────────────────
function switchToTab(idx) {
  tabs[activeTabIdx].chart = chart;
  tabs[activeTabIdx].audioBuffer = audioBuffer;
  activeTabIdx = idx;
  chart = tabs[activeTabIdx].chart;
  audioBuffer = tabs[activeTabIdx].audioBuffer || null;
  if (renderer) {
    renderer.chart = chart;
    renderer.scrollCol = 0;
    renderer.playTick  = 0;
  }
  if (gameView) gameView.chart = chart;
  pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList();
  renderFxChain(0); renderFxChain(1);
  renderTabBar();
  render();
  updateSeekbar(renderer ? renderer.playTick : 0);
}

function addTab() {
  tabs.push({ name: `Chart ${tabs.length + 1}`, chart: new ChartData(), audioBuffer: null });
  switchToTab(tabs.length - 1);
}

function closeTab(idx) {
  if (tabs.length <= 1) return; // can't close last tab
  tabs.splice(idx, 1);
  const newIdx = Math.max(0, Math.min(idx, tabs.length - 1));
  // Don't use switchToTab which tries to save the current (now removed) tab
  activeTabIdx = newIdx;
  chart = tabs[activeTabIdx].chart;
  audioBuffer = tabs[activeTabIdx].audioBuffer || null;
  if (renderer) { renderer.chart = chart; renderer.scrollCol = 0; renderer.playTick = 0; }
  if (gameView) gameView.chart = chart;
  pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList();
  renderFxChain(0); renderFxChain(1);
  renderTabBar();
  render();
}

let _tabDragIdx = -1;

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.innerHTML = '';
  tabs.forEach((t, i) => {
    const tab = document.createElement('div');
    tab.className = 'tab-item' + (i === activeTabIdx ? ' active' : '');
    tab.draggable = true;
    tab.dataset.idx = i;
    tab.innerHTML = `<span class="tab-name" title="Double-click to rename">${t.name}</span><button class="tab-close" data-close="${i}" title="Close tab">✕</button>`;

    tab.querySelector('.tab-close').addEventListener('click', e => {
      e.stopPropagation();
      closeTab(+e.currentTarget.dataset.close);
    });
    tab.querySelector('.tab-name').addEventListener('dblclick', () => renameTab(i));
    tab.addEventListener('click', e => { if (!e.target.closest('.tab-close')) switchToTab(i); });

    // Drag-and-drop reorder
    tab.addEventListener('dragstart', e => {
      _tabDragIdx = i;
      tab.classList.add('tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    tab.addEventListener('dragend', () => {
      _tabDragIdx = -1;
      bar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-dragging', 'tab-dragover'));
    });
    tab.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      bar.querySelectorAll('.tab-item').forEach(el => el.classList.remove('tab-dragover'));
      tab.classList.add('tab-dragover');
    });
    tab.addEventListener('drop', e => {
      e.preventDefault();
      const from = _tabDragIdx;
      const to   = i;
      if (from < 0 || from === to) return;
      const moved = tabs.splice(from, 1)[0];
      tabs.splice(to, 0, moved);
      const newActive = from === activeTabIdx ? to : (activeTabIdx >= Math.min(from, to) && activeTabIdx <= Math.max(from, to)) ? activeTabIdx + (from < to ? -1 : 1) : activeTabIdx;
      activeTabIdx = Math.max(0, Math.min(newActive, tabs.length - 1));
      renderTabBar();
    });

    bar.appendChild(tab);
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'tab-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'New tab';
  addBtn.addEventListener('click', addTab);
  bar.appendChild(addBtn);
}

function renameTab(idx) {
  const name = prompt('Tab name:', tabs[idx].name);
  if (name) { tabs[idx].name = name; renderTabBar(); }
}

// ── Tick / Second conversion (uses chartSpeed) ───────────────────────────────
function tickToSeconds(tick) {
  let seconds = 0;
  let prevTick = 0;
  let prevBpm  = Math.max(1, chart.bpmEvents[0]?.bpm || 120);
  for (const ev of chart.bpmEvents) {
    if (ev.y >= tick) break;
    // Add time for the segment [prevTick, ev.y] at the PREVIOUS BPM (active before this event)
    seconds  += (ev.y - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
    prevTick  = ev.y;
    prevBpm   = Math.max(1, ev.bpm || 120);
  }
  // Remaining ticks after the last BPM event before `tick`
  seconds += (tick - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
  return seconds;
}

function secondsToTick(sec) {
  let t = 0, prevSec = 0;
  let prevBpm = Math.max(1, chart.bpmEvents[0]?.bpm || 120);
  for (const ev of chart.bpmEvents) {
    const evSec = tickToSeconds(ev.y);
    if (evSec >= sec) break;
    t = ev.y; prevSec = evSec; prevBpm = Math.max(1, ev.bpm || 120);
  }
  t += (sec - prevSec) * prevBpm / 60 * TICKS_PER_BEAT;
  return t;
}

// ── Stop-aware visual tick ────────────────────────────────────────────────────
// During a stop event the visual tick freezes at stop.y while audio (and real
// time) continue to advance.  This function converts elapsed seconds → visual
// tick, skipping over any stop durations that have been consumed.
function computeVisualTickWithStops(elapsedSec) {
  if (!chart?.stopEvents?.length) return secondsToTick(elapsedSec);

  // Sort stops by position so we can walk them in order
  const stops = [...chart.stopEvents].sort((a, b) => a.y - b.y);

  let remSec  = elapsedSec;
  let visTick = 0;

  for (const stop of stops) {
    // Time to reach this stop from current visual position
    const secToStop = tickToSeconds(stop.y) - tickToSeconds(visTick);
    if (secToStop > remSec) break; // stop is beyond our elapsed time
    remSec  -= secToStop;
    visTick  = stop.y;

    // Compute stop duration in seconds at current BPM
    const bpmAtStop  = chart.getBpmAt(stop.y);
    const stopDurSec = stop.len / TICKS_PER_BEAT * (60 / bpmAtStop);

    if (remSec < stopDurSec) {
      // We are INSIDE this stop — visual tick is frozen at stop.y
      return visTick;
    }
    remSec -= stopDurSec;
    // After the stop, advance past it (visual tick stays at stop.y; no ticks consumed)
    // so continue the loop from the same visTick position but with less remSec
  }

  // No more stops — advance normally from visTick using remaining seconds
  return secondsToTick(tickToSeconds(visTick) + remSec);
}

// ── Playback functions ────────────────────────────────────────────────────────
function togglePlay() {
  playing ? stopPlay() : startPlay();
}

let playStopTick = -1; // -1 = play until end

function startPlay(stopAtTick = -1) {
  playStopTick      = stopAtTick;
  ensureAudioCtx();
  playing           = true;
  renderer.playing  = true;
  playStartPerf     = performance.now();
  playStartTickV    = renderer.playTick;
  prevPlayTick      = renderer.playTick;

  const chartSec = tickToSeconds(renderer.playTick);
  const offset   = (+(chart.meta.offset) || 0) / 1000; // guard NaN from bad metadata

  if (audioBuffer) {
    if (audioSource) { try { audioSource.stop(); } catch(e) {} }
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.playbackRate.value = 1.0;
    audioSource.connect(laserFilterNode || audioCtx.destination);

    // Add user-calibrated global audio delay (System Preferences > Audio)
    const userDelay      = (prefs.audioDelay ?? 0) / 1000;
    const rawSeek        = chartSec + offset + userDelay;
    // Guard: NaN / ±Infinity from bad BPM/offset data must not reach the AudioNode
    const audioSeek      = isFinite(rawSeek) ? rawSeek : 0;
    audioStartAcTime     = audioCtx.currentTime;
    audioStartChartSec   = isFinite(chartSec) ? chartSec : 0;

    if (audioSeek >= 0) {
      audioSource.start(audioCtx.currentTime, audioSeek);
    } else {
      const delay = -audioSeek;
      audioSource.start(audioCtx.currentTime + delay);
      audioStartAcTime += delay;
    }
    audioSource.onended = () => { if (playing) stopPlay(); };
  }

  updatePlayBtn(true);
  // Ensure radar animation loop is running if window is open
  if (typeof _startRdrLoop === 'function' && typeof _rdrVisible !== 'undefined' && _rdrVisible) {
    _startRdrLoop();
  }
  requestAnimationFrame(playFrame);
}

function stopPlay() {
  playing = false;
  renderer.playing = false;
  if (audioSource) { try { audioSource.stop(); } catch(e) {} audioSource = null; }
  // Reset live camera so the view snaps back to static chart.camera
  if (gameView) gameView._liveCamera = null;
  _tiltMode = 'zero';
  // Tear down any active FX effect and restore dry signal
  _teardownFxEffect();
  if (_fxWetGain)  _fxWetGain.gain.setTargetAtTime(0, audioCtx?.currentTime ?? 0, 0.05);
  if (_fxDryGain)  _fxDryGain.gain.setTargetAtTime(1, audioCtx?.currentTime ?? 0, 0.05);
  updatePlayBtn(false);
  updateSeekbar(renderer ? renderer.playTick : 0);
  render();
  // Flush any autosave that was deferred during playback
  if (_pendingAutosaveAfterPlay) {
    _pendingAutosaveAfterPlay = false;
    setTimeout(_idbAutosave, 600); // brief grace period so RAF has time to settle
  }
}
let _pendingAutosaveAfterPlay = false;

function playFrame(now) {
  if (!playing) return;

  let currentTick;
  // Video delay: shift the *visual* tick by N ms relative to audio (positive = visuals appear later)
  const videoOffsetSec = (prefs.videoDelay ?? 0) / 1000;
  if (audioBuffer && audioCtx) {
    const acElapsed = audioCtx.currentTime - audioStartAcTime;
    const audioChartSec = audioStartChartSec + acElapsed - videoOffsetSec;
    // Use stop-aware conversion so the visual chart freezes during stop events
    currentTick = computeVisualTickWithStops(audioChartSec);
  } else {
    // Note: chartSpeed (hispeed) is purely visual — it must NOT affect playback timing.
    // Real-time BPM-aware advancement; no chartSpeed divisor here.
    const elapsed = (now - playStartPerf) / 1000;
    currentTick = playStartTickV;
    let remSec = elapsed, prevTick2 = playStartTickV;
    for (const ev of chart.bpmEvents) {
      if (ev.y <= prevTick2) continue;
      const segSec = (ev.y - prevTick2) / TICKS_PER_BEAT * (60 / chart.getBpmAt(prevTick2));
      if (remSec <= segSec) break;
      remSec -= segSec; currentTick = ev.y; prevTick2 = ev.y;
    }
    currentTick += remSec * TICKS_PER_BEAT * chart.getBpmAt(currentTick) / 60;
  }

  renderer.playTick = Math.max(0, currentTick);
  if (gameView) {
    gameView.playTick = renderer.playTick;
    gameView.chain = gameView.countChain(chart, renderer.playTick);
  }

  // Auto-scroll
  const colLen = renderer.measPerCol * TICKS_PER_MEASURE;
  const targetCol = Math.floor(renderer.playTick / colLen);
  if (targetCol >= renderer.scrollCol + renderer.numCols) renderer.scrollCol = targetCol - renderer.numCols + 1;
  else if (targetCol < renderer.scrollCol) renderer.scrollCol = targetCol;

  // Slam + FX chip + BT tick sounds
  detectSlams(prevPlayTick, renderer.playTick);
  detectFxHits(prevPlayTick, renderer.playTick);
  detectBtHits(prevPlayTick, renderer.playTick);
  prevPlayTick = renderer.playTick;

  // Laser filter + FX audio effects
  updateLaserFilter(renderer.playTick);
  updateFxEffects(renderer.playTick);

  // Live camera animation from KSH cameraEvents
  updateCameraFromEvents(renderer.playTick);

  const stopAt = playStopTick > 0 ? playStopTick : chart.totalTicks();
  if (renderer.playTick >= stopAt) { renderer.playTick = stopAt; stopPlay(); return; }

  updatePlayStatus();
  render();
  if (gameView && viewMode !== 'edit') {
    const minInterval = 1000 / (prefs.fpsCap || 60);
    if (!_lastGameFrameTime || now - _lastGameFrameTime >= minInterval) {
      gameView.draw();
      // Draw annotation markers on top of the game view
      _pruneAnnotations();
      gameView.drawAnnotations?.(_chartAnnotations, _annAlpha);
      _lastGameFrameTime = now;
    }
  }
  // Update radar every playback frame regardless of view mode
  if (typeof updateRadar === 'function') updateRadar();
  requestAnimationFrame(playFrame);
}
let _lastGameFrameTime = 0;

function detectSlams(prevTick, curTick) {
  for (let side = 0; side < 2; side++) {
    for (const sec of chart.lasers[side]) {
      const pts = sec.points;
      for (let pi = 0; pi < pts.length - 1; pi++) {
        const p0 = pts[pi], p1 = pts[pi + 1];
        const t0 = sec.y + p0.ry;
        const t1 = sec.y + p1.ry;
        if (ChartData.isPointSlam(p0, p1) && t0 >= prevTick && t0 < curTick) {
          // ── Audio: play slam scratch sound ──────────────────────────────
          if (slamBuffer && audioCtx) {
            const src = audioCtx.createBufferSource();
            src.buffer = slamBuffer;
            src.connect(slamGainNode || audioCtx.destination);
            src.start();
          }
          // ── Visual: brief burst on the game view judgment line ──────────
          gameView?.addSlamFlash(side, p0.v, p1.v, sec.wide);
        }
      }
    }
  }
}

function detectFxHits(prevTick, curTick) {
  if (!audioCtx) return;
  for (let li = 0; li < 2; li++) {
    for (const n of chart.fx[li]) {
      if (n.len === 0 && n.y >= prevTick && n.y < curTick) {
        // Prefer per-chart SE buffer (loaded from fx-l_se / fx-r_se), then fallback
        const buf = fxChipSEBuffers[li] || clapBuffer;
        if (!buf) continue;
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(tickGainNode || audioCtx.destination);
        src.start();
      }
    }
  }
}

// ── Camera animation from KSH cameraEvents ───────────────────────────────────
// Interpolates zoom_top / zoom_bottom / zoom_side / tilt / center_split values
// between consecutive KSH camera events and pushes the result into
// gameView._liveCamera so _params() picks it up each draw frame.
//
// KSH camera value conventions:
//   zoom_top / zoom_bottom / zoom_side : integer, typical range −300…+300
//   center_split                        : integer, typical range −300…+300
//   tilt                                : numeric (degrees × 1/6 approx) or
//                                         string "normal" / "reverse" / "keep" / "zero"

function _parseCamValue(val) {
  const n = parseFloat(val);
  if (!isNaN(n)) return n;
  // string tilt keywords → numeric degrees
  switch ((val ?? '').toLowerCase()) {
    case 'zero':    return 0;
    case 'normal':  return 0;    // static no-tilt
    case 'reverse': return 0;    // direction handled by caller if needed
    default:        return 0;
  }
}

function updateCameraFromEvents(tick) {
  if (!gameView) return;
  if (!chart?.cameraEvents?.length) { gameView._liveCamera = null; return; }

  const evs = chart.cameraEvents;
  // Interpolate a single camera parameter type at the given tick.
  // Between two events: linear ramp. Beyond last event: hold last value.
  const interp = (type) => {
    let prev = null, next = null;
    for (const ev of evs) {
      if (ev.type !== type) continue;
      if (ev.y <= tick) prev = ev;
      else if (next === null || ev.y < next.y) next = ev;
    }
    if (!prev) return 0;
    const pv = _parseCamValue(prev.value);
    if (!next) return pv;
    const nv = _parseCamValue(next.value);
    const t  = Math.max(0, Math.min(1, (tick - prev.y) / (next.y - prev.y)));
    return pv + (nv - pv) * t;
  };

  // ── Tilt mode: handle string keywords from tilt camera events ─────────────
  // Walk tilt events in order; last one at or before tick determines mode/value
  let tiltDeg = 0;
  let tiltNumericRaw = 0; // used when mode ends up numeric/zero
  for (const ev of evs) {
    if (ev.type !== 'tilt') continue;
    if (ev.y > tick) continue;
    const raw = (ev.value ?? '').toString().trim().toLowerCase();
    const num = parseFloat(raw);
    if (!isNaN(num)) {
      // Numeric value — keep _tiltMode as-is but record numeric
      tiltNumericRaw = num;
    } else if (raw === 'normal')  { _tiltMode = 'normal'; }
    else if (raw === 'reverse')   { _tiltMode = 'reverse'; }
    else if (raw === 'keep')      { /* do not change _tiltMode */ }
    else if (raw === 'zero')      { _tiltMode = 'zero'; tiltNumericRaw = 0; }
  }

  // Compute final tilt angle
  // Convention (matching SDVX arcade):
  //   VOL-R → LEFT (rv=0) means the lane rotates CLOCKWISE  (positive ctx.rotate)
  //   VOL-R → RIGHT (rv=1) means the lane rotates COUNTER-CLOCKWISE (negative)
  // i.e. laserTilt = −(laser position − 0.5) × scale
  if (_tiltMode === 'normal' || _tiltMode === 'reverse') {
    const lv = getLaserPosAt(0, tick); // null if no laser
    const rv = getLaserPosAt(1, tick);
    let laserTilt = 0;
    if (lv !== null && rv !== null) {
      laserTilt = -((lv - 0.5) * 5 + (rv - 0.5) * 5) / 2;
    } else if (lv !== null) {
      laserTilt = -(lv - 0.5) * 5;
    } else if (rv !== null) {
      laserTilt = -(rv - 0.5) * 5;
    }
    tiltDeg = _tiltMode === 'reverse' ? -laserTilt : laserTilt;
  } else {
    // 'zero' or numeric — use interpolated numeric tilt × 2 (subtle rotation)
    tiltDeg = interp('tilt') * 2;
  }

  gameView._liveCamera = {
    zoomTop  : interp('zoom_top'),
    zoomBot  : interp('zoom_bottom'),
    zoomSide : interp('zoom_side'),
    tilt     : tiltDeg,
    split    : interp('center_split'),
  };
}

function updateLaserFilter(tick) {
  if (!laserFilterNode || !audioCtx) return;
  const lv = getLaserPosAt(0, tick);
  const rv = getLaserPosAt(1, tick);
  const li = lv !== null ? (1 - lv) : 0;
  const ri = rv !== null ? (1 - rv) : 0;
  const intensity = Math.max(li, ri);
  const filterType = chart.laserSettings.filter;
  if (filterType === 'lpf1') {
    laserFilterNode.type = 'lowpass';
    laserFilterNode.frequency.setTargetAtTime(20000 - intensity * 18000, audioCtx.currentTime, 0.02);
  } else if (filterType === 'hpf1') {
    laserFilterNode.type = 'highpass';
    laserFilterNode.frequency.setTargetAtTime(50 + intensity * 4000, audioCtx.currentTime, 0.02);
  } else if (filterType === 'peak') {
    laserFilterNode.type = 'peaking';
    laserFilterNode.frequency.setTargetAtTime(500 + intensity * 4000, audioCtx.currentTime, 0.02);
    laserFilterNode.gain.setTargetAtTime(intensity * 20, audioCtx.currentTime, 0.02);
  } else {
    laserFilterNode.frequency.setTargetAtTime(20000, audioCtx.currentTime, 0.02);
  }
}

// ── FX Effect Audio Processing ────────────────────────────────────────────────
// Called every playFrame; applies the currently active FX chain effect to the
// music via Web Audio API wet/dry routing built in ensureAudioCtx().
function updateFxEffects(tick) {
  if (!audioCtx || !_fxWetGain || !chart) return;

  // Find the highest-priority active FX hold and its effect chain
  let activeEffect = null;
  for (let li = 0; li < 2; li++) {
    const hold = chart.fx[li].find(n => n.len > 0 && n.y <= tick && tick <= n.y + n.len);
    if (hold && chart.fxChains[li]?.length) {
      activeEffect = { inst: chart.fxChains[li][0], hold };
      break;
    }
  }

  const bpm     = chart.getBpmAt(Math.floor(tick)) || 120;
  const nowAC   = audioCtx.currentTime;
  const type    = activeEffect?.inst?.type ?? null;
  const mix     = activeEffect ? (activeEffect.inst.params.mix ?? 80) / 100 : 0;
  const params  = activeEffect?.inst?.params ?? {};

  // ── Wobble: LFO-modulated lowpass filter ──────────────────────────────────
  if (type === 'wobble') {
    if (_fxEffectType !== 'wobble') { _teardownFxEffect(); _fxEffectType = 'wobble'; }
    if (!_fxWobbleFilter) {
      _fxWobbleFilter = audioCtx.createBiquadFilter();
      _fxWobbleFilter.type = 'lowpass';
      _fxWobbleFilter.Q.value = Math.max(0.5, params.q ?? 1);

      _fxWobbleLFOGain = audioCtx.createGain();
      const loF = params.loFreq ?? 500, hiF = params.hiFreq ?? 20000;
      _fxWobbleFilter.frequency.value = (loF + hiF) / 2;
      _fxWobbleLFOGain.gain.value     = (hiF - loF) / 2;

      _fxWobbleLFO = audioCtx.createOscillator();
      _fxWobbleLFO.type = 'sine';
      const hz = bpm / 60 / (params.waveLength ?? 12) * 4;
      _fxWobbleLFO.frequency.value = Math.max(0.05, hz);
      _fxWobbleLFO.connect(_fxWobbleLFOGain);
      _fxWobbleLFOGain.connect(_fxWobbleFilter.frequency);
      _fxWobbleLFO.start();

      _fxWetIn.connect(_fxWobbleFilter);
      _fxWobbleFilter.connect(_fxWetGain);
    }
  }

  // ── Gate: periodic amplitude gating ──────────────────────────────────────
  else if (type === 'gate') {
    if (_fxEffectType !== 'gate') { _teardownFxEffect(); _fxEffectType = 'gate'; }
    if (!_fxGateGain) {
      _fxGateGain = audioCtx.createGain();
      _fxGateGain.gain.value = 0;
      _fxWetIn.connect(_fxGateGain);
      _fxGateGain.connect(_fxWetGain);
      // Schedule gate envelope
      const period  = (60 / bpm) * 4 / (params.waveLength ?? 8);
      const rate    = (params.rate ?? 60) / 100;
      const now     = nowAC;
      const cycles  = 32; // schedule 32 cycles ahead
      for (let i = 0; i < cycles; i++) {
        const t0 = now + i * period;
        _fxGateGain.gain.setValueAtTime(1,   t0);
        _fxGateGain.gain.setValueAtTime(0,   t0 + period * rate);
      }
      _fxGateTimer = setInterval(() => {
        if (!_fxGateGain) { clearInterval(_fxGateTimer); return; }
        const t = audioCtx.currentTime;
        for (let i = 0; i < 8; i++) {
          const t0 = t + i * period;
          _fxGateGain.gain.setValueAtTime(1, t0);
          _fxGateGain.gain.setValueAtTime(0, t0 + period * rate);
        }
      }, period * 4 * 1000);
    }
  }

  // ── Echo: delay with feedback ─────────────────────────────────────────────
  else if (type === 'echo') {
    if (_fxEffectType !== 'echo') { _teardownFxEffect(); _fxEffectType = 'echo'; }
    if (!_fxEchoDelay) {
      const delayTime = (60 / bpm) * 4 / (params.waveLength ?? 4);
      _fxEchoDelay = audioCtx.createDelay(Math.min(2, delayTime * 2 + 0.1));
      _fxEchoDelay.delayTime.value = delayTime;
      _fxEchoFB  = audioCtx.createGain();
      _fxEchoFB.gain.value = Math.min(0.85, (params.feedback ?? 60) / 100);
      _fxEchoWet = audioCtx.createGain();
      _fxEchoWet.gain.value = 0.8;
      _fxWetIn.connect(_fxEchoDelay);
      _fxEchoDelay.connect(_fxEchoFB);
      _fxEchoFB.connect(_fxEchoDelay);   // feedback loop
      _fxEchoDelay.connect(_fxEchoWet);
      _fxEchoWet.connect(_fxWetGain);
    }
  }

  // ── SideChain: pumping gain ───────────────────────────────────────────────
  else if (type === 'sidechain') {
    if (_fxEffectType !== 'sidechain') { _teardownFxEffect(); _fxEffectType = 'sidechain'; }
    if (!_fxScGain) {
      _fxScGain = audioCtx.createGain();
      _fxScGain.gain.value = 0;
      _fxWetIn.connect(_fxScGain);
      _fxScGain.connect(_fxWetGain);
      const period   = (60 / bpm) * 4 / (params.period ?? 8);
      const holdSec  = (params.holdTime ?? 50)    / 1000;
      const atkSec   = (params.attackTime ?? 10)  / 1000;
      const relSec   = (params.releaseTime ?? 60) / 1000;
      const now      = nowAC;
      for (let i = 0; i < 16; i++) {
        const t0 = now + i * period;
        _fxScGain.gain.setValueAtTime(0,    t0);
        _fxScGain.gain.setValueAtTime(0,    t0 + holdSec);
        _fxScGain.gain.linearRampToValueAtTime(1, t0 + holdSec + atkSec);
        _fxScGain.gain.setValueAtTime(1,    t0 + holdSec + atkSec);
        _fxScGain.gain.linearRampToValueAtTime(0, t0 + holdSec + atkSec + relSec);
      }
      _fxScTimer = setInterval(() => {
        if (!_fxScGain) { clearInterval(_fxScTimer); return; }
        const t = audioCtx.currentTime;
        for (let i = 0; i < 8; i++) {
          const t0 = t + i * period;
          _fxScGain.gain.setValueAtTime(0,    t0);
          _fxScGain.gain.setValueAtTime(0,    t0 + holdSec);
          _fxScGain.gain.linearRampToValueAtTime(1, t0 + holdSec + atkSec);
          _fxScGain.gain.linearRampToValueAtTime(0, t0 + holdSec + atkSec + relSec);
        }
      }, period * 4 * 1000);
    }
  }

  // ── Retrigger: loop a buffer segment ─────────────────────────────────────
  else if (type === 'retrigger') {
    if (_fxEffectType !== 'retrigger') { _teardownFxEffect(); _fxEffectType = 'retrigger'; }
    if (!_fxRetriggerProc) {
      const loopSec = (60 / bpm) / (params.waveLength ?? 8) * 4;
      const loopSamples = Math.max(1, Math.round(loopSec * audioCtx.sampleRate));
      const buf = [new Float32Array(loopSamples), new Float32Array(loopSamples)];
      let writePos = 0, readPos = 0, recording = true;
      _fxRetriggerProc = audioCtx.createScriptProcessor(2048, 2, 2);
      _fxRetriggerProc.onaudioprocess = e => {
        const iL = e.inputBuffer.getChannelData(0), iR = e.inputBuffer.getChannelData(1);
        const oL = e.outputBuffer.getChannelData(0), oR = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < iL.length; i++) {
          if (recording) {
            buf[0][writePos] = iL[i]; buf[1][writePos] = iR[i];
            oL[i] = iL[i]; oR[i] = iR[i];
            writePos++;
            if (writePos >= loopSamples) { recording = false; readPos = 0; }
          } else {
            oL[i] = buf[0][readPos]; oR[i] = buf[1][readPos];
            readPos = (readPos + 1) % loopSamples;
          }
        }
      };
      _fxWetIn.connect(_fxRetriggerProc);
      _fxRetriggerProc.connect(_fxWetGain);
    }
  }

  // ── Flanger: LFO-modulated short delay with feedback ─────────────────────
  else if (type === 'flanger') {
    if (_fxEffectType !== 'flanger') { _teardownFxEffect(); _fxEffectType = 'flanger'; }
    if (!_fxFlangerDelay) {
      const baseMs  = Math.max(0.5, params.delay    ?? 30) / 1000;
      const depth   = Math.max(0.1, params.depth    ?? 60) / 100 * baseMs;
      const fb      = Math.min(0.8, (params.feedback ?? 60) / 100);
      const lfoHz   = bpm / 60 / Math.max(1, params.period ?? 2);

      _fxFlangerDelay = audioCtx.createDelay(0.05);
      _fxFlangerDelay.delayTime.value = baseMs;

      _fxFlangerFB = audioCtx.createGain();
      _fxFlangerFB.gain.value = fb;

      _fxFlangerLFOGain = audioCtx.createGain();
      _fxFlangerLFOGain.gain.value = depth;

      _fxFlangerLFO = audioCtx.createOscillator();
      _fxFlangerLFO.type = 'sine';
      _fxFlangerLFO.frequency.value = Math.max(0.05, lfoHz);
      _fxFlangerLFO.connect(_fxFlangerLFOGain);
      _fxFlangerLFOGain.connect(_fxFlangerDelay.delayTime);
      _fxFlangerLFO.start();

      _fxWetIn.connect(_fxFlangerDelay);
      _fxFlangerDelay.connect(_fxFlangerFB);
      _fxFlangerFB.connect(_fxFlangerDelay);  // feedback loop
      _fxFlangerDelay.connect(_fxWetGain);
    }
  }

  // ── Phaser: allpass filter chain with LFO ────────────────────────────────
  else if (type === 'phaser') {
    if (_fxEffectType !== 'phaser') { _teardownFxEffect(); _fxEffectType = 'phaser'; }
    if (!_fxPhaserFilters) {
      const stages  = Math.min(12, Math.max(2, Math.round(params.stages ?? 6)));
      const lfoHz   = bpm / 60 / Math.max(1, params.period ?? 4);

      _fxPhaserFilters = [];
      let prev = _fxWetIn;
      for (let i = 0; i < stages; i++) {
        const f = audioCtx.createBiquadFilter();
        f.type = 'allpass'; f.frequency.value = 1000 + i * 200; f.Q.value = 0.5;
        prev.connect(f); _fxPhaserFilters.push(f); prev = f;
      }
      prev.connect(_fxWetGain);

      _fxPhaserLFOGain = audioCtx.createGain();
      _fxPhaserLFOGain.gain.value = 900;
      _fxPhaserLFO = audioCtx.createOscillator();
      _fxPhaserLFO.type = 'sine';
      _fxPhaserLFO.frequency.value = Math.max(0.05, lfoHz);
      _fxPhaserLFO.connect(_fxPhaserLFOGain);
      _fxPhaserFilters.forEach(f => _fxPhaserLFOGain.connect(f.frequency));
      _fxPhaserLFO.start();
    }
  }

  // ── BitCrusher: sample-rate reduction via ScriptProcessor ────────────────
  else if (type === 'bitcrusher') {
    if (_fxEffectType !== 'bitcrusher') { _teardownFxEffect(); _fxEffectType = 'bitcrusher'; }
    if (!_fxBitcrusherProc) {
      const reduction = Math.max(2, Math.round((params.reduction ?? 60) / 100 * 64));
      let phase = 0, lastL = 0, lastR = 0;
      _fxBitcrusherProc = audioCtx.createScriptProcessor(2048, 2, 2);
      _fxBitcrusherProc.onaudioprocess = e => {
        const iL = e.inputBuffer.getChannelData(0), iR = e.inputBuffer.getChannelData(1);
        const oL = e.outputBuffer.getChannelData(0), oR = e.outputBuffer.getChannelData(1);
        for (let i = 0; i < iL.length; i++) {
          if (++phase >= reduction) { phase = 0; lastL = iL[i]; lastR = iR[i]; }
          oL[i] = lastL; oR[i] = lastR;
        }
      };
      _fxWetIn.connect(_fxBitcrusherProc);
      _fxBitcrusherProc.connect(_fxWetGain);
    }
  }

  // ── TapeStop: exponential playback rate ramp ──────────────────────────────
  else if (type === 'tapestop') {
    if (_fxEffectType !== 'tapestop') {
      _teardownFxEffect(); _fxEffectType = 'tapestop'; _fxTapeStopActive = true;
      const dur = 1.5 * (1 - Math.min(0.99, (params.speed ?? 50) / 100)) + 0.05;
      if (audioSource) {
        audioSource.playbackRate.cancelScheduledValues(nowAC);
        audioSource.playbackRate.setValueAtTime(1.0, nowAC);
        audioSource.playbackRate.exponentialRampToValueAtTime(0.01, nowAC + dur);
      }
    }
    // Tapestop routes dry (rate change IS the effect); wet stays 0
  }

  // ── No active effect — bypass ─────────────────────────────────────────────
  else {
    if (_fxEffectType === 'tapestop' || _fxTapeStopActive) {
      if (audioSource) {
        audioSource.playbackRate.cancelScheduledValues(nowAC);
        audioSource.playbackRate.setTargetAtTime(1.0, nowAC, 0.05);
      }
      _fxTapeStopActive = false;
    }
    if (_fxEffectType) _teardownFxEffect();
  }

  // Wet/dry mix — tapestop is purely a rate effect, no wet routing needed
  const wetNow = (type && type !== 'tapestop') ? mix : 0;
  const dryNow = type === 'tapestop' ? 1.0 : (1 - wetNow);
  _fxWetGain.gain.setTargetAtTime(wetNow, nowAC, 0.02);
  _fxDryGain.gain.setTargetAtTime(dryNow, nowAC, 0.02);
}

function _teardownFxEffect() {
  _fxEffectType = null;
  // Clear gate/sidechain timers
  if (_fxGateTimer) { clearInterval(_fxGateTimer); _fxGateTimer = null; }
  if (_fxScTimer)   { clearInterval(_fxScTimer);   _fxScTimer   = null; }
  // Stop and disconnect all LFOs / oscillators
  try { _fxWobbleLFO?.stop(); } catch(_) {}
  try { _fxFlangerLFO?.stop(); } catch(_) {}
  try { _fxPhaserLFO?.stop(); } catch(_) {}
  // Disconnect original effect nodes
  [_fxWobbleLFO, _fxWobbleLFOGain, _fxWobbleFilter,
   _fxGateGain, _fxEchoDelay, _fxEchoFB, _fxEchoWet, _fxScGain]
    .forEach(n => { try { n?.disconnect(); } catch(_) {} });
  _fxWobbleFilter = _fxWobbleLFO = _fxWobbleLFOGain = null;
  _fxGateGain = _fxEchoDelay = _fxEchoFB = _fxEchoWet = _fxScGain = null;
  // Disconnect new effect nodes
  [_fxFlangerDelay, _fxFlangerLFO, _fxFlangerLFOGain, _fxFlangerFB,
   _fxPhaserLFO, _fxPhaserLFOGain]
    .forEach(n => { try { n?.disconnect(); } catch(_) {} });
  if (_fxPhaserFilters) { _fxPhaserFilters.forEach(n => { try { n?.disconnect(); } catch(_) {} }); _fxPhaserFilters = null; }
  if (_fxBitcrusherProc) { try { _fxBitcrusherProc.disconnect(); } catch(_) {} _fxBitcrusherProc = null; }
  if (_fxRetriggerProc)  { try { _fxRetriggerProc.disconnect();  } catch(_) {} _fxRetriggerProc = null; }
  _fxFlangerDelay = _fxFlangerLFO = _fxFlangerLFOGain = _fxFlangerFB = null;
  _fxPhaserLFO = _fxPhaserLFOGain = null;
  _fxTapeStopActive = false;
}

function getLaserPosAt(side, tick) {
  for (const sec of chart.lasers[side]) {
    if (tick < sec.y) continue;
    const pts = sec.points;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      const t0 = sec.y + pts[pi].ry, t1 = sec.y + pts[pi+1].ry;
      if (tick >= t0 && tick <= t1) {
        const ratio = t1 === t0 ? 0 : (tick - t0) / (t1 - t0);
        return pts[pi].v + (pts[pi+1].v - pts[pi].v) * ratio;
      }
    }
    const last = pts[pts.length - 1];
    if (last && sec.y + last.ry >= tick) return last.v;
  }
  return null;
}

function updatePlayBtn(isPlaying) {
  // Use localized strings, falling back to English defaults
  const label = isPlaying
    ? (typeof t === 'function' ? t('tool.stop') : '⏹ Stop')
    : (typeof t === 'function' ? t('tool.play') : '▶ Play');
  ['btn-play', 'btn-play-top'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = label;
    btn.classList.toggle('playing', isPlaying);
    // Set the data-i18n key dynamically so applyLocalization picks up state changes
    btn.setAttribute('data-i18n', isPlaying ? 'tool.stop' : 'tool.play');
  });
}

function updatePlayStatus() {
  const tick    = Math.round(renderer.playTick);
  const measure = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const beat    = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
  document.getElementById('status-tick').textContent    = `Tick: ${tick}`;
  document.getElementById('status-measure').textContent = `Measure: ${measure}`;
  document.getElementById('status-beat').textContent    = `Beat: ${beat}`;
  updateSeekbar(tick);
}

// ── Seekbar / scrub ───────────────────────────────────────────────────────────
let _seekScrubbing = false;
let _seekWasPlaying = false;

function _fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateSeekbar(tick) {
  const fill  = document.getElementById('game-seekbar-fill');
  const thumb = document.getElementById('game-seekbar-thumb');
  const label = document.getElementById('game-seekbar-time');
  if (!fill || !thumb || !label) return;

  const total = chart ? chart.totalTicks() : 0;
  const pct   = total > 0 ? Math.min(1, Math.max(0, tick / total)) : 0;
  fill.style.width  = `${pct * 100}%`;
  thumb.style.left  = `${pct * 100}%`;

  const curSec   = tickToSeconds(tick);
  const totSec   = tickToSeconds(total);
  label.textContent = `${_fmtTime(curSec)} / ${_fmtTime(totSec)}`;
}

function _seekbarTickFromEvent(e) {
  const track = document.getElementById('game-seekbar-track');
  if (!track) return null;
  const rect = track.getBoundingClientRect();
  const pct  = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  return Math.round(pct * (chart ? chart.totalTicks() : 0));
}

function _seekTo(tick) {
  if (!chart) return;
  renderer.playTick = Math.max(0, Math.min(tick, chart.totalTicks()));
  if (gameView) gameView.playTick = renderer.playTick;
  // Scroll the 2D editor to follow
  const colLen = renderer.measPerCol * TICKS_PER_MEASURE;
  renderer.scrollCol = Math.floor(renderer.playTick / colLen);
  updatePlayStatus();
  render();
  if (gameView && viewMode !== 'edit') gameView.draw();
}

function initSeekbar() {
  const track = document.getElementById('game-seekbar-track');
  if (!track) return;

  track.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    _seekScrubbing = true;
    _seekWasPlaying = playing;
    track.classList.add('scrubbing');
    if (playing) {
      // Pause audio without changing playTick
      playing = false;
      renderer.playing = false;
      if (audioSource) { try { audioSource.stop(); } catch(_) {} audioSource = null; }
      updatePlayBtn(false);
    }
    const tick = _seekbarTickFromEvent(e);
    if (tick !== null) _seekTo(tick);
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!_seekScrubbing) return;
    const tick = _seekbarTickFromEvent(e);
    if (tick !== null) _seekTo(tick);
  });

  document.addEventListener('mouseup', e => {
    if (!_seekScrubbing) return;
    _seekScrubbing = false;
    document.getElementById('game-seekbar-track')?.classList.remove('scrubbing');
    if (_seekWasPlaying) {
      // Resume playback from the new position
      startPlay(playStopTick);
    }
    _seekWasPlaying = false;
  });

  // Initial render
  updateSeekbar(renderer ? renderer.playTick : 0);
}

// ── View mode ─────────────────────────────────────────────────────────────────
function setViewMode(mode) {
  viewMode = mode;
  const editWrap = document.getElementById('main');
  const gameWrap = document.getElementById('game-wrap');
  if (mode === 'edit') {
    editWrap.style.display = 'flex'; gameWrap.style.display = 'none';
    // Force layout recalculation so renderer gets correct dimensions
    requestAnimationFrame(() => { renderer?.resize(); render(); });
  } else if (mode === 'game') {
    editWrap.style.display = 'none'; gameWrap.style.display = 'flex';
  } else { // split
    editWrap.style.display = 'flex'; gameWrap.style.display = 'flex';
    editWrap.style.flex = '1'; gameWrap.style.flex = '1';
    requestAnimationFrame(() => { renderer?.resize(); render(); });
  }
  if (gameView) { gameView.resize(); gameView.draw(); }
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
}

// ── Multiple-chart picker modal ────────────────────────────────────────────────
function showMultiChartPicker(chartMetas, onConfirm) {
  // Build or reuse the modal element
  let modal = document.getElementById('modal-multi-chart');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id        = 'modal-multi-chart';
  modal.className = 'modal';
  modal.style.display = 'flex';

  // Track selection and mode
  let splitMode  = false;
  let selectedIdx = new Set();

  const render = () => {
    const cards = chartMetas.map((m, i) => {
      const sel = selectedIdx.has(i);
      return `
        <div class="mcp-card${sel ? ' mcp-card-selected' : ''}" data-idx="${i}">
          <div class="mcp-jacket">${m.jacketURL
            ? `<img src="${m.jacketURL}" alt="jacket">`
            : '<div class="mcp-jacket-placeholder">♪</div>'}</div>
          <div class="mcp-info">
            <div class="mcp-title">${m.title || m.file.name}</div>
            <div class="mcp-sub">
              ${m.diff ? `<span class="mcp-diff">${m.diff.toUpperCase()}</span>` : ''}
              ${m.level ? `<span class="mcp-level">Lv.${m.level}</span>` : ''}
            </div>
            <div class="mcp-filename">${m.file.name}</div>
          </div>
          ${sel ? '<div class="mcp-check">✓</div>' : ''}
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal-box mcp-box">
        <div class="mcp-header">
          <span class="mcp-icon">⚡</span> Multiple Charts Detected
        </div>
        <div class="mcp-mode-row">
          <button class="mcp-mode-btn${!splitMode ? ' active' : ''}" id="mcp-btn-normal">◉ Normal</button>
          <button class="mcp-mode-btn${splitMode  ? ' active' : ''}" id="mcp-btn-split">⧉ Split</button>
          <span class="mcp-mode-hint">${splitMode
            ? 'Select 2 charts — opens side-by-side'
            : 'Select 1 chart — opens in current tab'}</span>
        </div>
        <div class="mcp-cards">${cards}</div>
        <div class="mcp-actions">
          <button class="mcp-open-btn" id="mcp-open" ${selectedIdx.size === 0 ? 'disabled' : ''}>
            ${splitMode ? '⧉ Open in Split View' : '▶ Open'}
          </button>
          <button class="mcp-cancel-btn" id="mcp-cancel">Cancel</button>
        </div>
      </div>`;

    // Re-bind events after re-render
    modal.querySelectorAll('.mcp-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = +card.dataset.idx;
        if (splitMode) {
          if (selectedIdx.has(idx)) selectedIdx.delete(idx);
          else if (selectedIdx.size < 2) selectedIdx.add(idx);
        } else {
          selectedIdx = new Set([idx]);
        }
        render();
      });
    });
    modal.querySelector('#mcp-btn-normal')?.addEventListener('click', () => {
      splitMode = false; selectedIdx = new Set(); render();
    });
    modal.querySelector('#mcp-btn-split')?.addEventListener('click', () => {
      splitMode = true; selectedIdx = new Set(); render();
    });
    modal.querySelector('#mcp-open')?.addEventListener('click', () => {
      if (!selectedIdx.size) return;
      modal.style.display = 'none';
      const chosen = [...selectedIdx].map(i => chartMetas[i]);
      onConfirm(chosen, splitMode);
    });
    modal.querySelector('#mcp-cancel')?.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  };

  document.body.appendChild(modal);
  render();
}

// ── Loading overlay helpers ────────────────────────────────────────────────────
function _loadingShow(stage, pct) {
  const ov  = document.getElementById('loading-overlay');
  const st  = document.getElementById('loading-stage');
  const bar = document.getElementById('loading-bar');
  const pctEl = document.getElementById('loading-pct');
  if (!ov) return;
  ov.style.display   = 'flex';
  ov.style.opacity   = '1';
  ov.style.pointerEvents = 'all';
  if (st)    st.textContent    = stage || '';
  if (bar)   bar.style.width   = (pct ?? 0) + '%';
  if (pctEl) pctEl.textContent = (pct ?? 0) + '%';
}

function _loadingDone() {
  const ov = document.getElementById('loading-overlay');
  if (!ov) return;
  ov.style.opacity = '0';
  ov.style.pointerEvents = 'none';
  setTimeout(() => { if (ov) ov.style.display = 'none'; }, 420);
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  _loadingShow('Initializing editor…', 5);
  buildLaneHeader();

  const canvas = document.getElementById('chart-canvas');
  renderer = new Renderer(canvas);
  renderer.chart = chart;

  // Restore session state (zoom, scroll, cursor, view mode)
  _restoreSession();

  // Initial zoom from slider (100% on slider = 1.2× internal zoom)
  const zs = document.getElementById('zoom-slider');
  renderer.zoom = +zs.value / 100 * 1.2;
  renderer.resize();

  // Game view
  const gameCanvas = document.getElementById('game-canvas');
  if (gameCanvas) {
    gameView = new GameView(gameCanvas);
    gameView.chart = chart;
    gameView.resize();
    gameCanvas.addEventListener('contextmenu', e => { e.preventDefault(); showGameCtxMenu(e.clientX, e.clientY); });
  }

  // Seekbar / scrub
  initSeekbar();

  // Chart speed slider — visual hi-speed only; playback timing is always BPM-accurate
  const speedSlider = document.getElementById('chart-speed');
  if (speedSlider) {
    const initHs = +speedSlider.value;
    chartSpeed = initHs;
    document.getElementById('chart-speed-label').textContent = initHs.toFixed(2) + '×';
    speedSlider.addEventListener('input', e => {
      const hs = +e.target.value;
      chartSpeed = hs; // kept for legacy references; does NOT affect timing
      document.getElementById('chart-speed-label').textContent = hs.toFixed(2) + '×';
      // Mirror to preview panel
      const pvSl  = document.getElementById('pvc-hispeed');
      const pvLbl = document.getElementById('pvc-hispeed-label');
      if (pvSl)  pvSl.value = hs;
      if (pvLbl) pvLbl.textContent = hs.toFixed(1) + '×';
      if (gameView) { gameView.hispeed = hs; if (!playing) gameView.draw(); }
    });
  }
  if (gameView) gameView.hispeed = chartSpeed;

  // BT Width slider
  const btWidthSlider = document.getElementById('pvc-bt-width');
  const btWidthLabel  = document.getElementById('pvc-bt-width-label');
  if (btWidthSlider) {
    btWidthSlider.addEventListener('input', e => {
      const bw = +e.target.value;
      if (btWidthLabel) btWidthLabel.textContent = bw.toFixed(2) + '×';
      if (gameView) { gameView.btWidthScale = bw; if (!playing) gameView.draw(); }
    });
  }
  if (gameView) gameView.btWidthScale = 1.0;

  // View mode buttons (toolbar + menu items share same logic)
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Edit menu buttons
  document.getElementById('btn-undo')?.addEventListener('click', undo);
  document.getElementById('btn-redo')?.addEventListener('click', redo);
  document.getElementById('btn-cut')?.addEventListener('click',  () => { selCut(); render(); });
  document.getElementById('btn-copy')?.addEventListener('click', selCopy);
  document.getElementById('btn-paste')?.addEventListener('click', selPaste);
  document.getElementById('btn-mirror-all')?.addEventListener('click', () => selMirror('all'));
  document.getElementById('btn-mirror-bt')?.addEventListener('click',  () => selMirror('bt'));
  document.getElementById('btn-mirror-fx')?.addEventListener('click',  () => selMirror('fx'));
  document.getElementById('btn-mirror-vol')?.addEventListener('click', () => selMirror('vol'));
  document.getElementById('btn-speed-half')?.addEventListener('click',   () => selAdjustSpeed(0.5));
  document.getElementById('btn-speed-double')?.addEventListener('click', () => selAdjustSpeed(2.0));
  document.getElementById('btn-ripple-delete')?.addEventListener('click', selRippleDelete);

  _loadingShow('Building renderer…', 60);
  syncMetaToChart();
  renderTabBar();
  render();

  _loadingShow('Ready', 100);
  // Dismiss loading overlay after a brief frame — everything is painted
  requestAnimationFrame(() => requestAnimationFrame(_loadingDone));

  // Seed the IndexedDB immediately so recovery is always available
  setTimeout(() => _idbAutosave(), 3000);

  // Canvas mouse
  canvas.addEventListener('mousedown',   onMouseDown);
  canvas.addEventListener('mousemove',   onMouseMove);
  canvas.addEventListener('mouseup',     onMouseUp);
  canvas.addEventListener('contextmenu', onRightClick);
  canvas.addEventListener('dblclick',    onDblClick);
  canvas.addEventListener('mouseleave', () => {
    // Clear hover highlight when leaving canvas; popup stays open (click-to-close)
    if (renderer && renderer._hoveredCamTick !== null) {
      renderer._hoveredCamTick = null;
      render();
    }
  });
  document.getElementById('canvas-wrap').addEventListener('wheel', onWheel, { passive: false });

  // Camera popup — click-to-open, click-outside to close.
  // Allow clicking the ✕ close button inside the popup to dismiss it.
  const _camPop = document.getElementById('cam-hover-popup');
  if (_camPop) {
    _camPop.addEventListener('click', ev => {
      if (ev.target.classList.contains('cam-pop-close')) {
        _camPopupFixedTick = null;
        _hideCamPopup();
      }
    });
  }

  // Play buttons (toolbar + topbar)
  document.getElementById('btn-play')?.addEventListener('click', togglePlay);
  document.getElementById('btn-play-top')?.addEventListener('click', togglePlay);

  // Topbar view buttons
  document.querySelectorAll('.topbar-view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Load audio button
  document.getElementById('btn-load-audio')?.addEventListener('click', () => {
    document.getElementById('audio-file-input').click();
  });
  document.getElementById('audio-file-input')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (f) { await loadAudioFile(f); tabs[activeTabIdx].audioBuffer = audioBuffer; }
    e.target.value = '';
  });

  // Measures per column
  // Tool buttons
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // Snap
  document.getElementById('snap-select').addEventListener('change', e => { snap = parseFloat(e.target.value); syncSnapUI(); });

  // Zoom slider (100% = 1.2× internal zoom)
  document.getElementById('zoom-slider').addEventListener('input', e => {
    renderer.zoom = +e.target.value / 100 * 1.2;
    document.getElementById('zoom-label').textContent = e.target.value + '%';
    renderer.resize();
    render();
  });

  // Beats per lane slider
  const bplSlider = document.getElementById('beats-per-lane');
  bplSlider?.addEventListener('input', () => applyBeatsPerLane(+bplSlider.value));
  // Legacy meas-per-col input (Chart menu) — keep both in sync
  document.getElementById('meas-per-col')?.addEventListener('change', e => {
    const mpc = Math.max(1, Math.min(16, +e.target.value));
    renderer.measPerCol = mpc;
    applyBeatsPerLane(renderer.beatsPerCol);
  });

  // Metadata
  document.querySelectorAll('#panel-meta input, #panel-meta select').forEach(el => {
    el.addEventListener('change', syncMetaToChart);
    el.addEventListener('input',  syncMetaToChart);
  });

  // Export
  document.getElementById('btn-export-ksh').addEventListener('click', () => {
    downloadText((chart.meta.title.replace(/[^a-zA-Z0-9_]/g, '_') || 'chart') + '.ksh', exportKsh(chart));
  });
  document.getElementById('btn-export-kson').addEventListener('click', () => {
    downloadText((chart.meta.title.replace(/[^a-zA-Z0-9_]/g, '_') || 'chart') + '.kson', exportKson(chart));
  });

  // Open file
  document.getElementById('btn-open-ksh').addEventListener('click', () => {
    const fi = document.getElementById('file-input'); fi.accept = '.ksh'; fi.click();
  });
  document.getElementById('btn-open-kson').addEventListener('click', () => {
    const fi = document.getElementById('file-input'); fi.accept = '.kson'; fi.click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      _loadingShow(`Parsing ${file.name}…`, 30);
      try {
        // KSH files may be Shift-JIS encoded — pass ArrayBuffer so importKsh
        // can auto-detect. KSON is always UTF-8 JSON → read as text.
        const result = ev.target.result;
        chart = file.name.endsWith('.kson') ? importKson(result) : importKsh(result);
        tabs[activeTabIdx].chart = chart;
        // Set tab name to "Title - DIFFICULTY" format (sketch item 17)
        if (chart.meta.title) {
          const _diff = chart.meta.difficulty ? chart.meta.difficulty.toUpperCase() : '';
          tabs[activeTabIdx].name = _diff ? `${chart.meta.title} - ${_diff}` : chart.meta.title;
        }
        renderer.chart = chart;
        renderer.scrollCol = 0;
        renderer.playTick  = 0;
        if (gameView) { gameView.chart = chart; gameView._liveCamera = null; }
        // Reset per-chart SE buffers (no folder context for single file)
        fxChipSEBuffers = [null, null];
        pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList();
        renderFxChain(0); renderFxChain(1);
        renderTabBar();
        render();
        updateSeekbar(0);
        _loadingDone();
        _idbAutosave(); // immediately persist imported chart
      } catch(err) { _loadingDone(); alert('Error loading file:\n' + err.message); }
    };
    // Use ArrayBuffer for KSH (Shift-JIS auto-detect); text for KSON
    if (file.name.endsWith('.kson')) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  });

  // New chart
  document.getElementById('btn-new').addEventListener('click', () => {
    if (!confirm('Start a new chart? Unsaved changes will be lost.')) return;
    chart = new ChartData();
    tabs[activeTabIdx].chart = chart;
    renderer.chart = chart;
    renderer.scrollCol = 0; renderer.playTick = 0;
    if (gameView) gameView.chart = chart;
    pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList();
    renderFxChain(0); renderFxChain(1); render();
    updateSeekbar(0);
  });

  // FX chain
  document.querySelectorAll('.add-fx-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lane = btn.dataset.lane === 'l' ? 0 : 1;
      saveUndo('Added FX Effect');
      chart.fxChains[lane].push(makeEffectInstance(document.getElementById('fx-type-select').value));
      renderFxChain(lane);
    });
  });

  // Song Metadata modal
  document.getElementById('btn-song-meta')?.addEventListener('click', openSongMetaModal);
  document.getElementById('sm-save')?.addEventListener('click', saveSongMetaModal);
  document.getElementById('sm-cancel')?.addEventListener('click', () => document.getElementById('modal-song-meta').style.display = 'none');

  // Import audio from inside Song Metadata modal
  document.getElementById('sm-btn-import-audio')?.addEventListener('click', () => {
    document.getElementById('sm-audio-import-input').click();
  });
  document.getElementById('sm-audio-import-input')?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // Close the metadata modal first so the import-progress modal is visible
    document.getElementById('modal-song-meta').style.display = 'none';
    await importAudioFile(f);
    // Re-sync the music filename back into the modal field
    document.getElementById('sm-music').value = chart.meta.music || '';
  });

  // Calibrate from inside Song Metadata modal
  document.getElementById('sm-btn-calibrate')?.addEventListener('click', () => {
    if (!audioBuffer) {
      alert('Load an audio file first before calibrating.');
      return;
    }
    // Close modal temporarily; calibration window is a full-screen overlay
    document.getElementById('modal-song-meta').style.display = 'none';
    calibrationWindow.open(audioBuffer, chart, (markerSec, calibBpm) => {
      const ms = Math.round(markerSec * 1000);
      chart.meta.offset = ms;
      document.getElementById('meta-offset').value  = ms;
      document.getElementById('sm-offset').value    = ms;
      pushMeta();
      // Apply BPM if changed
      if (calibBpm && chart.bpmEvents?.length) {
        const oldBpm = chart.bpmEvents[0].bpm;
        if (Math.abs(calibBpm - oldBpm) > 0.01) {
          chart.bpmEvents[0].bpm = calibBpm;
        }
      }
      saveUndo('Calibrated audio offset (from metadata modal)');
      // Re-open metadata modal after calibration
      openSongMetaModal();
    });
  });
  document.getElementById('sm-btn-jacket')?.addEventListener('click', () => document.getElementById('sm-jacket-picker').click());
  document.getElementById('sm-jacket-picker')?.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    document.getElementById('sm-jacket').value = f.name;
    const img = document.getElementById('meta-jacket-img-modal');
    const ph  = document.getElementById('meta-jacket-placeholder');
    img.src = URL.createObjectURL(f); img.style.display = 'block'; ph.style.display = 'none';
    // also sync to main jacket preview
    const main = document.getElementById('jacket-preview');
    if (main) { main.src = img.src; main.style.display = 'block'; }
  });

  // BPM modal
  document.getElementById('btn-add-bpm').addEventListener('click', () => document.getElementById('modal-bpm').style.display = 'flex');
  document.getElementById('bpm-ev-cancel').addEventListener('click', () => document.getElementById('modal-bpm').style.display = 'none');
  document.getElementById('bpm-ev-ok').addEventListener('click', () => {
    const measure = +document.getElementById('bpm-ev-measure').value - 1;
    const beat    = +document.getElementById('bpm-ev-beat').value - 1;
    const bpm     = +document.getElementById('bpm-ev-value').value;
    saveUndo(`Added BPM ${bpm} at M${measure+1}`);
    chart.addBpmEvent(measure * TICKS_PER_MEASURE + beat * TICKS_PER_BEAT, bpm);
    document.getElementById('modal-bpm').style.display = 'none';
    updateBpmList(); render();
  });

  // TimeSig modal
  document.getElementById('btn-add-timesig').addEventListener('click', () => document.getElementById('modal-timesig').style.display = 'flex');
  document.getElementById('ts-ev-cancel').addEventListener('click', () => document.getElementById('modal-timesig').style.display = 'none');
  document.getElementById('ts-ev-ok').addEventListener('click', () => {
    const measure = +document.getElementById('ts-ev-measure').value - 1;
    saveUndo(`Added Time Signature at M${measure+1}`);
    chart.addTimeSigEvent(measure, +document.getElementById('ts-ev-num').value, +document.getElementById('ts-ev-den').value);
    document.getElementById('modal-timesig').style.display = 'none';
    updateTimeSigList();
  });

  // Open song folder
  document.getElementById('btn-open-folder')?.addEventListener('click', () => {
    document.getElementById('folder-input').click();
  });
  document.getElementById('folder-input')?.addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const readText = (file) => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsText(file, 'utf-8');
    });
    // Read as ArrayBuffer for KSH (Shift-JIS auto-detect)
    const readBinary = (file) => new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsArrayBuffer(file);
    });

    // Collect ALL chart files in the folder
    const chartFiles = files.filter(f => f.name.endsWith('.ksh') || f.name.endsWith('.kson'));
    if (!chartFiles.length) { alert('No .ksh or .kson file found in folder.'); return; }

    // Helper: load one chart file into the editor
    const loadOneChart = async (chartFile) => {
      const data = chartFile.name.endsWith('.kson')
        ? await readText(chartFile)
        : await readBinary(chartFile);
      const loaded = chartFile.name.endsWith('.kson') ? importKson(data) : importKsh(data);
      tabs[activeTabIdx].chart = loaded;
      chart = loaded;
      // Set tab name to "Title - DIFFICULTY" format (sketch item 17)
      if (chart.meta.title) {
        const _diff = chart.meta.difficulty ? chart.meta.difficulty.toUpperCase() : '';
        tabs[activeTabIdx].name = _diff ? `${chart.meta.title} - ${_diff}` : chart.meta.title;
      }
      renderer.chart = chart;
      renderer.scrollCol = 0; renderer.playTick = 0;
      if (gameView) gameView.chart = chart;
      pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList();
      renderFxChain(0); renderFxChain(1);
      renderTabBar();
      updateSeekbar(0);
      _idbAutosave();

      // Audio
      const audioExts = ['.ogg', '.mp3', '.wav'];
      const musicName = chart.meta.music?.split(/[\\/]/).pop();
      const audioFile = (musicName && files.find(f => f.name === musicName))
                     || files.find(f => audioExts.some(x => f.name.toLowerCase().endsWith(x)));
      if (audioFile) { await loadAudioFile(audioFile); tabs[activeTabIdx].audioBuffer = audioBuffer; }

      // Jacket
      const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const jacketName = chart.meta.jacket?.split(/[\\/]/).pop();
      const jacketFile = (jacketName && files.find(f => f.name === jacketName))
                      || files.find(f => imgExts.some(x => f.name.toLowerCase().endsWith(x)));
      if (jacketFile) {
        const img = document.getElementById('jacket-preview');
        img.src = URL.createObjectURL(jacketFile); img.style.display = 'block';
      }

      // FX chip SE sounds (KSH fx-l_se / fx-r_se)
      fxChipSEBuffers = [null, null];
      if (chart.meta.fxLSE || chart.meta.fxRSE) {
        await ensureAudioCtx();
        const loadSE = async (filename, idx) => {
          if (!filename) return;
          const baseName = filename.split(/[\\/]/).pop();
          const seFile   = files.find(f => f.name === baseName);
          if (!seFile) return;
          try {
            const ab  = await readBinary(seFile);
            fxChipSEBuffers[idx] = await audioCtx.decodeAudioData(ab);
          } catch (_) {}
        };
        await Promise.all([
          loadSE(chart.meta.fxLSE, 0),
          loadSE(chart.meta.fxRSE, 1),
        ]);
      }

      render();
    };

    // Only one chart: load it immediately
    if (chartFiles.length === 1) {
      try { await loadOneChart(chartFiles[0]); }
      catch(err) { alert('Error loading chart:\n' + err.message); }
      e.target.value = ''; return;
    }

    // Multiple charts: read quick metadata from each, then show picker
    const chartMetas = [];
    for (const cf of chartFiles) {
      try {
        const text = await readText(cf);
        // Quick-parse just enough metadata without full import
        let title = cf.name, diff = '', level = '', jacket = '';
        if (cf.name.endsWith('.kson')) {
          try {
            const j = JSON.parse(text);
            title  = j.meta?.title       || cf.name;
            diff   = j.meta?.difficulty?.name || '';
            level  = j.meta?.level != null ? String(j.meta.level) : '';
            jacket = j.meta?.jacket_filename || '';
          } catch(_) {}
        } else {
          // KSH: parse header lines
          for (const line of text.split('\n').slice(0, 60)) {
            const [k, v] = line.split('=');
            if (!k || !v) continue;
            const key = k.trim().toLowerCase();
            if (key === 'title')      title  = v.trim();
            if (key === 'difficulty') diff   = v.trim();
            if (key === 'level')      level  = v.trim();
            if (key === 'jacket')     jacket = v.trim();
          }
        }
        // Try to find jacket file
        const imgExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
        const jacketBaseName = jacket?.split(/[\\/]/).pop();
        const jacketFile = (jacketBaseName && files.find(f => f.name === jacketBaseName))
                        || files.find(f => imgExts.some(x => f.name.toLowerCase().endsWith(x)));
        const jacketURL = jacketFile ? URL.createObjectURL(jacketFile) : null;
        chartMetas.push({ file: cf, title, diff, level, jacketURL });
      } catch(_) {
        chartMetas.push({ file: cf, title: cf.name, diff: '', level: '', jacketURL: null });
      }
    }

    // Show picker modal
    showMultiChartPicker(chartMetas, async (chosen, splitMode) => {
      if (!chosen.length) return;
      try {
        if (splitMode && chosen.length >= 2) {
          // Open first chart in current tab, second in a new tab
          await loadOneChart(chosen[0].file);
          addTab();
          await loadOneChart(chosen[1].file);
          setViewMode('split');
        } else {
          await loadOneChart(chosen[0].file);
        }
      } catch(err) { alert('Error loading chart:\n' + err.message); }
    });

    e.target.value = '';
  });

  // Music browse
  document.getElementById('btn-pick-music').addEventListener('click', () => document.getElementById('music-file-picker').click());
  document.getElementById('music-file-picker').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { document.getElementById('meta-music').value = f.name; syncMetaToChart(); }
  });

  // Jacket
  document.getElementById('btn-pick-jacket').addEventListener('click', () => document.getElementById('jacket-file-picker').click());
  document.getElementById('jacket-file-picker').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    document.getElementById('meta-jacket').value = f.name;
    const img = document.getElementById('jacket-preview');
    img.src = URL.createObjectURL(f); img.style.display = 'block';
    syncMetaToChart();
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    renderer.resize();
    if (gameView) gameView.resize();
    render();
  });

  updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); renderFxChain(0); renderFxChain(1);

  // Settings toggles
  document.getElementById('setting-tick')?.addEventListener('change', e => {
    settings.tickSound = e.target.checked;
  });

  // Volume sliders — bidirectional sync with prefs
  const volSliders = [
    { id: 'vol-master', lbl: 'vol-master-label', prefKey: 'volMaster', fn: v => { if (masterGainNode) masterGainNode.gain.value = v; } },
    { id: 'vol-music',  lbl: 'vol-music-label',  prefKey: 'volMusic',  fn: v => { if (musicGainNode)  musicGainNode.gain.value  = v; } },
    { id: 'vol-slam',   lbl: 'vol-slam-label',   prefKey: 'volSlam',   fn: v => { if (slamGainNode)   slamGainNode.gain.value   = v; } },
    { id: 'vol-tick',   lbl: 'vol-tick-label',   prefKey: 'volTick',   fn: v => { if (tickGainNode)   tickGainNode.gain.value   = v; } },
  ];
  volSliders.forEach(({ id, lbl, prefKey, fn }) => {
    const el = document.getElementById(id);
    const lb = document.getElementById(lbl);
    if (!el) return;
    // Initial value comes from prefs (which has been loaded by now)
    if (prefs[prefKey] != null) {
      el.value = prefs[prefKey];
      if (lb) lb.textContent = Math.round(prefs[prefKey] * 100) + '%';
    }
    el.addEventListener('input', () => {
      const v = +el.value;
      lb && (lb.textContent = Math.round(v * 100) + '%');
      ensureAudioCtx();
      fn(v);
      // Sync into prefs and persist
      prefs[prefKey] = v;
      try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
    });
  });

  // Error badge click
  document.getElementById('error-badge')?.addEventListener('click', () => logger.showModal());

  // Apply default view mode (shows 3D game preview by default)
  setViewMode(viewMode);

  // Preferences load
  loadPreferences();
  initHistoryPanel();

  // ── Calibration button ───────────────────────────────────────────────────
  document.getElementById('btn-calibrate')?.addEventListener('click', () => {
    if (!audioBuffer) {
      alert('Load an audio file first before calibrating.\n\nUse the 📂 Import button or Load Audio File to add music.');
      return;
    }
    calibrationWindow.open(audioBuffer, chart, (markerSec, calibBpm) => {
      if (markerSec === null) return;
      const ms = Math.round(markerSec * 1000);
      chart.meta.offset = ms;
      const el = document.getElementById('meta-offset');
      if (el) { el.value = ms; }
      syncMetaToChart();
      // Apply BPM if changed
      if (calibBpm && chart.bpmEvents?.length) {
        const oldBpm = chart.bpmEvents[0].bpm;
        if (Math.abs(calibBpm - oldBpm) > 0.01) {
          chart.bpmEvents[0].bpm = calibBpm;
        }
      }
      saveUndo('Calibrated audio offset');
      // Flash status
      const st = document.getElementById('audio-status');
      if (st) {
        const prev = st.textContent;
        st.textContent = `✓ Offset set to ${ms} ms`;
        setTimeout(() => { st.textContent = prev; }, 2500);
      }
    });
  });

  // ── Audio import button ───────────────────────────────────────────────────
  document.getElementById('btn-import-audio')?.addEventListener('click', () => {
    document.getElementById('audio-import-input').click();
  });
  document.getElementById('audio-import-input')?.addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importAudioFile(f);
  });

  // Import error modal retry/choose buttons (wired dynamically — see importAudioFile)
  document.getElementById('import-error-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-import-error').style.display = 'none';
  });

  // Cancel in-progress OGG encoding
  document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
    if (_encodeStop) {
      _encodeStop();    // abort MediaRecorder, rejects the _encodeToOgg promise
      _encodeStop = null;
    }
    _hideImportProgress();
  });
});

// ── Song Import System ────────────────────────────────────────────────────────
// Supports: .ogg (direct link), .flac/.wav/.mp3/.aac/.m4a (→ OGG via MediaRecorder)

let _importLastFile = null; // retained so Retry works
let _encodeStop     = null; // callable to abort in-progress OGG encoding

async function importAudioFile(file) {
  _importLastFile = file;
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'ogg') {
    // Direct link — no conversion needed
    _showImportStage('Loading OGG file…', 10);
    try {
      await _linkAudioFile(file);
      _hideImportProgress();
      _flashStatus(`✓ Imported ${file.name}`);
    } catch (err) {
      _hideImportProgress();
      _showImportError(file.name, String(err));
    }
    return;
  }

  // Non-OGG: show confirmation before converting
  const ok = await _showImportConfirm(file.name, ext);
  if (!ok) return;

  // Conversion pipeline
  document.getElementById('modal-import-progress').style.display = 'flex';
  try {
    _showImportStage('Loading audio file…', 5);
    const arrayBuf = await file.arrayBuffer();

    _showImportStage('Decoding audio source…', 15);
    ensureAudioCtx();
    let decoded;
    try {
      decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
    } catch(decErr) {
      throw new Error(`Could not decode "${file.name}": ${decErr.message || decErr}`);
    }

    _showImportStage(`Encoding to OGG format… (song is ${decoded.duration.toFixed(1)}s)`, 20);
    const oggBlob = await _encodeToOgg(decoded);

    _showImportStage('Finalizing and linking to project…', 95);
    const newName = file.name.replace(/\.[^.]+$/, '.ogg');
    const oggFile = new File([oggBlob], newName, { type: oggBlob.type });
    await _linkAudioFile(oggFile, decoded);

    _hideImportProgress();
    _flashStatus(`✓ Imported & converted ${newName}`);
  } catch (err) {
    _hideImportProgress();
    if (err.message === 'Import cancelled') return; // user cancelled — no error modal
    _showImportError(file.name, err.message || String(err));
  }
}

// Show the format-conversion confirmation modal, returns Promise<boolean>
function _showImportConfirm(filename, fromExt) {
  return new Promise(resolve => {
    const modal  = document.getElementById('modal-import-confirm');
    const msgEl  = document.getElementById('import-confirm-msg');
    const btnOk  = document.getElementById('import-confirm-ok');
    const btnNo  = document.getElementById('import-confirm-cancel');

    msgEl.textContent =
      `"${filename}" is a ${fromExt.toUpperCase()} file. ` +
      `vibe-editr will convert it to OGG/Opus format so it works with the chart engine. ` +
      `The original file will not be changed.`;
    modal.style.display = 'flex';

    const ok = () => { cleanup(); modal.style.display = 'none'; resolve(true);  };
    const no = () => { cleanup(); modal.style.display = 'none'; resolve(false); };
    const cleanup = () => {
      btnOk.removeEventListener('click', ok);
      btnNo.removeEventListener('click', no);
    };
    btnOk.addEventListener('click', ok);
    btnNo.addEventListener('click', no);
  });
}

// Encode a decoded AudioBuffer to OGG (Opus or WebM Opus) via MediaRecorder.
// Sets _encodeStop to a callable that aborts encoding and rejects the promise.
function _encodeToOgg(decoded) {
  return new Promise((resolve, reject) => {
    const mimeTypes = [
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
    const mime = mimeTypes.find(m => {
      try { return MediaRecorder.isTypeSupported(m); } catch(_) { return false; }
    }) || 'audio/webm';

    // Play decoded buffer through a MediaStreamDestination → capture with MediaRecorder
    const encCtx = new (window.AudioContext || window.webkitAudioContext)();
    const dest   = encCtx.createMediaStreamDestination();
    const src    = encCtx.createBufferSource();
    src.buffer   = decoded;
    src.connect(dest);

    let recorder;
    try {
      recorder = new MediaRecorder(dest.stream, { mimeType: mime });
    } catch (e) {
      encCtx.close();
      reject(new Error('MediaRecorder not supported in this browser: ' + e.message));
      return;
    }

    const chunks   = [];
    const startMs  = performance.now();
    const totalSec = decoded.duration;
    let cancelled  = false;

    // Expose abort hook so the Cancel button can stop encoding mid-flight
    _encodeStop = () => {
      cancelled = true;
      clearInterval(progressTimer);
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch(_) {}
      try { src.disconnect(); } catch(_) {}
      try { encCtx.close(); } catch(_) {}
      _encodeStop = null;
      reject(new Error('Import cancelled'));
    };

    // Progress update during real-time encoding
    const progressTimer = setInterval(() => {
      const elapsed = (performance.now() - startMs) / 1000;
      const pct = Math.min(92, 20 + Math.round((elapsed / totalSec) * 72));
      const rem = Math.max(0, Math.round(totalSec - elapsed));
      _showImportStage(`Encoding to OGG… (~${rem}s remaining)`, pct);
    }, 400);

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(progressTimer);
      _encodeStop = null;
      try { encCtx.close(); } catch(_) {}
      if (cancelled) return; // reject already called by _encodeStop
      if (chunks.length === 0) { reject(new Error('MediaRecorder produced no data.')); return; }
      resolve(new Blob(chunks, { type: mime }));
    };
    recorder.onerror = e => {
      clearInterval(progressTimer);
      _encodeStop = null;
      try { encCtx.close(); } catch(_) {}
      if (cancelled) return;
      reject(e.error || new Error('MediaRecorder error'));
    };

    recorder.start(250); // collect chunks every 250 ms
    src.start(0);
    src.onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };

    // Safety: stop after duration + 4s buffer
    setTimeout(() => {
      if (!cancelled && recorder.state !== 'inactive') recorder.stop();
    }, (totalSec + 4) * 1000);
  });
}

// Link a file (OGG or converted Blob) to the chart
async function _linkAudioFile(file, decodedBuffer = null) {
  // Update metadata fields
  document.getElementById('meta-music').value = file.name;
  syncMetaToChart();

  // Load audio buffer
  if (decodedBuffer) {
    audioBuffer = decodedBuffer;
    // decodedBuffer already in memory; raw bytes were set by the caller's arrayBuffer() call
  } else {
    ensureAudioCtx();
    const ab = await file.arrayBuffer();
    audioArrayBuffer = ab.slice(0); // preserve before decodeAudioData may transfer ownership
    audioBuffer = await audioCtx.decodeAudioData(ab);
  }
  tabs[activeTabIdx].audioBuffer = audioBuffer;
  document.getElementById('audio-status').textContent = `Audio: ${file.name}`;
  _idbAutosave();
}

// Progress modal helpers
function _showImportStage(msg, pct) {
  const lbl = document.getElementById('import-stage-label');
  const bar = document.getElementById('import-progress-bar');
  const pct2 = document.getElementById('import-progress-pct');
  if (lbl) lbl.textContent = msg;
  if (bar) bar.style.width = pct + '%';
  if (pct2) pct2.textContent = pct + '%';
}

function _hideImportProgress() {
  document.getElementById('modal-import-progress').style.display = 'none';
  _showImportStage('', 0);
}

function _showImportError(filename, reason) {
  document.getElementById('import-error-file').textContent = `File: ${filename}`;
  document.getElementById('import-error-msg').textContent  = reason;
  document.getElementById('modal-import-error').style.display = 'flex';

  // Wire Retry button (replace each time to avoid stale listeners)
  const retryBtn  = document.getElementById('import-error-retry');
  const chooseBtn = document.getElementById('import-error-choose');
  const newRetry  = retryBtn.cloneNode(true);
  const newChoose = chooseBtn.cloneNode(true);
  retryBtn.replaceWith(newRetry);
  chooseBtn.replaceWith(newChoose);

  newRetry.addEventListener('click', async () => {
    document.getElementById('modal-import-error').style.display = 'none';
    if (_importLastFile) await importAudioFile(_importLastFile);
  });
  newChoose.addEventListener('click', () => {
    document.getElementById('modal-import-error').style.display = 'none';
    document.getElementById('audio-import-input').click();
  });
}

function _flashStatus(msg) {
  const st = document.getElementById('audio-status');
  if (!st) return;
  const prev = st.textContent;
  st.textContent = msg;
  setTimeout(() => { st.textContent = prev; }, 3000);
}

// ── FX Hover Tooltip ──────────────────────────────────────────────────────────
const FX_EFFECT_OPTIONS = [
  { value: 'none',        label: 'None'       },
  { value: 'retrigger',   label: 'Retrigger'  },
  { value: 'gate',        label: 'Gate'       },
  { value: 'flanger',     label: 'Flanger'    },
  { value: 'pitchshift',  label: 'PitchShift' },
  { value: 'bitcrusher',  label: 'BitCrusher' },
  { value: 'phaser',      label: 'Phaser'     },
  { value: 'wobble',      label: 'Wobble'     },
  { value: 'tapestop',    label: 'TapeStop'   },
  { value: 'echo',        label: 'Echo'       },
  { value: 'sidechain',   label: 'SideChain'  },
];

let fxTooltipEl   = null;
let fxTooltipNote = null;

function ensureFxTooltip() {
  if (fxTooltipEl) return;
  fxTooltipEl = document.createElement('div');
  fxTooltipEl.className = 'fx-tooltip';
  document.body.appendChild(fxTooltipEl);
  fxTooltipEl.addEventListener('mouseleave', hideFxTooltip);
}

let _fxHoverTimer = null;
let _fxPinned = false;

function showFxTooltip(clientX, clientY, note, lane) {
  ensureFxTooltip();
  if (_fxPinned && fxTooltipNote === note) return; // already pinned on this note
  if (_fxPinned) return; // pinned on different note, don't change
  clearTimeout(_fxHoverTimer);
  _fxHoverTimer = setTimeout(() => {
    _doShowFxTooltip(clientX, clientY, note, lane);
  }, 900);
}

function _doShowFxTooltip(clientX, clientY, note, lane) {
  ensureFxTooltip();
  fxTooltipNote = note;
  _fxPinned = true;
  const current = note.effect || 'none';
  const opts = FX_EFFECT_OPTIONS.map(e =>
    `<option value="${e.value}"${e.value === current ? ' selected' : ''}>${e.label}</option>`
  ).join('');
  fxTooltipEl.innerHTML = `
    <div class="fx-tt-label">FX-${lane === 0 ? 'L' : 'R'} Effect</div>
    <select class="fx-tt-select">${opts}</select>
    <div class="fx-tt-close" title="Close">✕</div>
  `;
  fxTooltipEl.querySelector('.fx-tt-select').addEventListener('change', ev => {
    if (fxTooltipNote) fxTooltipNote.effect = ev.target.value || null;
    render();
  });
  fxTooltipEl.querySelector('.fx-tt-close').addEventListener('click', () => {
    _fxPinned = false;
    hideFxTooltip();
  });
  fxTooltipEl.style.display = 'block';
  // Position after display so offsetWidth is valid
  requestAnimationFrame(() => {
    const tw = fxTooltipEl.offsetWidth, th = fxTooltipEl.offsetHeight;
    fxTooltipEl.style.left = Math.min(clientX + 14, window.innerWidth  - tw - 8) + 'px';
    fxTooltipEl.style.top  = Math.min(clientY - 10, window.innerHeight - th - 8) + 'px';
  });
}

function hideFxTooltip() {
  if (_fxPinned) return; // don't hide while pinned
  clearTimeout(_fxHoverTimer);
  if (fxTooltipEl) fxTooltipEl.style.display = 'none';
  fxTooltipNote = null;
}

function checkFxHover(e) {
  if (_fxPinned) return; // tooltip is pinned, don't interfere
  const h = getHit(e);
  const { tick, laneIdx } = h;
  if (laneIdx < 0 || laneIdx > 3) { clearTimeout(_fxHoverTimer); hideFxTooltip(); return; }
  const fxLane = laneIdx <= 1 ? 0 : 1;
  const note = chart.fx[fxLane].find(n => tick >= n.y && tick <= n.y + Math.max(n.len, 1));
  if (!note) { clearTimeout(_fxHoverTimer); hideFxTooltip(); return; }
  showFxTooltip(e.clientX, e.clientY, note, fxLane);
}

// ── Tool ──────────────────────────────────────────────────────────────────────
function setTool(t) {
  tool = t;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  document.getElementById('status-tool').textContent = 'Tool: ' + t;
  // Show laser anchor dots only when a laser tool is active (edit layer gate)
  if (renderer) {
    renderer.showLaserDots = (t === 'laser-l' || t === 'laser-r');
    if (!renderer.showLaserDots) {
      renderer.activeLaserSec     = null;
      renderer.selectedLaserPoint = null;
      _laserSel = null;
    }
  }
  // Show/hide cam-event subpanel
  const camSub = document.getElementById('cam-subpanel');
  if (camSub) camSub.classList.toggle('visible', t === 'cam-event');
  // Update context palette (dock.js)
  if (typeof updateContextPalette === 'function') updateContextPalette(t);
}

let _renderScheduled = false;
function render() {
  autoDetectMeasures();
  checkLaserOverlap();
  if (playing) {
    // During playback, draw immediately (we're already inside a RAF from playFrame)
    renderer?.draw();
    renderer?.drawSelection(sel);
    return;
  }
  // Outside playback, coalesce rapid calls into one RAF frame
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(() => {
    _renderScheduled = false;
    renderer?.draw();
    renderer?.drawSelection(sel);
    // Annotation overlay (warn/error markers from tools)
    _pruneAnnotations();
    renderer?.drawAnnotations(_chartAnnotations, _annAlpha);
    // Keep the SDVX preview in sync with every chart edit
    if (gameView && viewMode !== 'edit') gameView.draw();
    // Update pattern radar (live, no-op if window is hidden)
    if (typeof updateRadar === 'function') updateRadar();
  });
}
function snapTick(t) {
  if (!snap) return Math.round(t);               // Free = nearest integer tick
  return Math.round(Math.round(t / snap) * snap); // snap then force integer
}

// ── Selection helpers ─────────────────────────────────────────────────────────
function selTickRange() {
  const lo = Math.min(sel.startTick, sel.endTick);
  const hi = Math.max(sel.startTick, sel.endTick);
  return [lo, hi];
}

function selCopy() {
  if (!sel.active) return;
  const [lo, hi] = selTickRange();
  sel.clipboard = {
    bt:     chart.bt.map(l   => l.filter(n => n.y >= lo && n.y <= hi).map(n => ({...n, y: n.y - lo}))),
    fx:     chart.fx.map(l   => l.filter(n => n.y >= lo && n.y <= hi).map(n => ({...n, y: n.y - lo}))),
    lasers: chart.lasers.map(arr => arr.filter(s => s.y >= lo && s.y <= hi).map(s => ({...s, y: s.y - lo, points: s.points.map(p => ({...p}))}))),
    dur: hi - lo,
  };
}

function selCut() {
  if (!sel.active) return;
  selCopy();
  const [lo, hi] = selTickRange();
  saveUndo('Cut Selection');
  for (let li = 0; li < 4; li++) chart.bt[li] = chart.bt[li].filter(n => !(n.y >= lo && n.y <= hi));
  for (let li = 0; li < 2; li++) chart.fx[li] = chart.fx[li].filter(n => !(n.y >= lo && n.y <= hi));
  for (let s  = 0; s  < 2; s++)  chart.lasers[s] = chart.lasers[s].filter(sec => !(sec.y >= lo && sec.y <= hi));
  sel.active = false; render();
}

function selPaste() {
  if (!sel.clipboard) return;
  saveUndo('Pasted Notes');
  const at = sel.active ? Math.min(sel.startTick, sel.endTick) : renderer.playTick;
  const { bt, fx, lasers } = sel.clipboard;
  for (let li = 0; li < 4; li++) bt[li].forEach(n => chart.addBtNote(li, snapTick(at + n.y), n.len));
  for (let li = 0; li < 2; li++) fx[li].forEach(n => chart.addFxNote(li, snapTick(at + n.y), n.len));
  for (let s = 0; s < 2; s++) {
    lasers[s].forEach(sec => {
      chart.lasers[s].push({ y: snapTick(at + sec.y), points: sec.points.map(p => ({...p})), wide: sec.wide });
    });
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  render();
}

function selMirror(what) {
  if (!sel.active) return;
  saveUndo(`Mirrored ${what.toUpperCase()}`);
  const [lo, hi] = selTickRange();
  const inSel = y => y >= lo && y <= hi;

  if (what === 'all' || what === 'bt') {
    const snap0 = chart.bt[0].filter(n => inSel(n.y)), snap3 = chart.bt[3].filter(n => inSel(n.y));
    const snap1 = chart.bt[1].filter(n => inSel(n.y)), snap2 = chart.bt[2].filter(n => inSel(n.y));
    chart.bt[0] = [...chart.bt[0].filter(n => !inSel(n.y)), ...snap3];
    chart.bt[1] = [...chart.bt[1].filter(n => !inSel(n.y)), ...snap2];
    chart.bt[2] = [...chart.bt[2].filter(n => !inSel(n.y)), ...snap1];
    chart.bt[3] = [...chart.bt[3].filter(n => !inSel(n.y)), ...snap0];
    for (let li = 0; li < 4; li++) chart.bt[li].sort((a, b) => a.y - b.y);
  }
  if (what === 'all' || what === 'fx') {
    const snapL = chart.fx[0].filter(n => inSel(n.y)), snapR = chart.fx[1].filter(n => inSel(n.y));
    chart.fx[0] = [...chart.fx[0].filter(n => !inSel(n.y)), ...snapR];
    chart.fx[1] = [...chart.fx[1].filter(n => !inSel(n.y)), ...snapL];
    for (let li = 0; li < 2; li++) chart.fx[li].sort((a, b) => a.y - b.y);
  }
  if (what === 'all' || what === 'vol') {
    const flipPts = s => ({ ...s, points: s.points.map(p => ({ ...p, v: 1 - p.v })) });
    const snapLL = chart.lasers[0].filter(s => inSel(s.y)).map(flipPts);
    const snapRL = chart.lasers[1].filter(s => inSel(s.y)).map(flipPts);
    chart.lasers[0] = [...chart.lasers[0].filter(s => !inSel(s.y)), ...snapRL];
    chart.lasers[1] = [...chart.lasers[1].filter(s => !inSel(s.y)), ...snapLL];
    for (let s = 0; s < 2; s++) chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  render();
}

function selAdjustSpeed(factor) {
  // factor > 1 = compress (2x speed = notes take half as many ticks)
  // factor < 1 = expand  (0.5x speed = notes take twice as many ticks)
  if (!sel.active) return;
  saveUndo(`Adjusted Speed ×${factor}`);
  const [lo, hi] = selTickRange();
  const oldDur = hi - lo;
  const newDur = Math.round(oldDur * factor);
  const delta  = newDur - oldDur;

  const scaleY = y => {
    if (y < lo) return y;
    if (y >= hi) return y + delta;
    return lo + Math.round((y - lo) * factor);
  };

  for (let li = 0; li < 4; li++) {
    chart.bt[li] = chart.bt[li].map(n => ({ ...n, y: scaleY(n.y), len: n.len > 0 ? Math.round(n.len * factor) : 0 }));
    chart.bt[li].sort((a, b) => a.y - b.y);
  }
  for (let li = 0; li < 2; li++) {
    chart.fx[li] = chart.fx[li].map(n => ({ ...n, y: scaleY(n.y), len: n.len > 0 ? Math.round(n.len * factor) : 0 }));
    chart.fx[li].sort((a, b) => a.y - b.y);
  }
  for (let s = 0; s < 2; s++) {
    chart.lasers[s] = chart.lasers[s].map(sec => ({
      ...sec,
      y: scaleY(sec.y),
      points: sec.points.map(p => ({ ...p, ry: Math.round(p.ry * factor) })),
    }));
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }
  chart.bpmEvents = chart.bpmEvents.map(ev => ({ ...ev, y: scaleY(ev.y) }));
  chart.bpmEvents.sort((a, b) => a.y - b.y);

  sel.startTick = lo;
  sel.endTick   = lo + newDur;
  updateBpmList(); render();
}

// ── Ripple Delete ─────────────────────────────────────────────────────────────
// Delete everything in the selected region [lo, hi) and shift all content that
// sits AFTER hi backward by (hi − lo) ticks, closing the gap like a splice cut.
//
// Boundary handling:
//   • Notes/holds that START inside [lo, hi)         → deleted entirely
//   • Chips/holds that start before lo and end in [lo, hi)
//                                                    → hold truncated to end at lo
//   • Holds that straddle the entire region (start < lo, end > hi)
//                                                    → hold shortened by (hi-lo), tail shifted
//   • Everything that starts at tick ≥ hi            → shifted back by (hi-lo)
//   • BPM, time-sig, camera, stop events follow the same rules
function selRippleDelete() {
  if (!sel.active) return;
  const [lo, hi] = selTickRange();
  if (hi <= lo) return;
  const span = hi - lo;
  saveUndo('Ripple Delete');

  // ── BT notes ─────────────────────────────────────────────────────────────
  for (let li = 0; li < 4; li++) {
    chart.bt[li] = chart.bt[li].reduce((acc, n) => {
      const end = n.y + n.len;
      if (n.y >= hi) {
        // Entirely after region — shift
        acc.push({ ...n, y: n.y - span });
      } else if (n.y >= lo) {
        // Starts inside region — delete
      } else if (end <= lo) {
        // Entirely before region — keep
        acc.push(n);
      } else if (end <= hi) {
        // Starts before, ends inside — truncate hold at lo
        acc.push({ ...n, len: lo - n.y });
      } else {
        // Straddles entire region — shorten by span, tail shifts
        acc.push({ ...n, len: n.len - span });
      }
      return acc;
    }, []);
    chart.bt[li].sort((a, b) => a.y - b.y);
  }

  // ── FX notes ─────────────────────────────────────────────────────────────
  for (let li = 0; li < 2; li++) {
    chart.fx[li] = chart.fx[li].reduce((acc, n) => {
      const end = n.y + n.len;
      if (n.y >= hi) {
        acc.push({ ...n, y: n.y - span });
      } else if (n.y >= lo) {
        // Inside — delete
      } else if (end <= lo) {
        acc.push(n);
      } else if (end <= hi) {
        acc.push({ ...n, len: lo - n.y });
      } else {
        acc.push({ ...n, len: n.len - span });
      }
      return acc;
    }, []);
    chart.fx[li].sort((a, b) => a.y - b.y);
  }

  // ── Laser sections ────────────────────────────────────────────────────────
  for (let s = 0; s < 2; s++) {
    chart.lasers[s] = chart.lasers[s].reduce((acc, sec) => {
      const lastPt  = sec.points[sec.points.length - 1];
      const secEnd  = sec.y + (lastPt?.ry ?? 0);

      if (sec.y >= hi) {
        // Entirely after — shift
        acc.push({ ...sec, y: sec.y - span });
      } else if (sec.y >= lo) {
        // Starts inside — delete
      } else if (secEnd <= lo) {
        // Entirely before — keep
        acc.push(sec);
      } else {
        // Starts before lo — overlaps the cut boundary.
        const baseY = sec.y;
        const cutRy = lo - baseY;  // relative tick at the lo boundary

        // ── Helper: interpolate laser v at a given relative tick ───────────
        const interpV = (ry) => {
          const pb = [...sec.points].reverse().find(p => p.ry <= ry);
          const pa = sec.points.find(p => p.ry > ry);
          if (pb && pa) return pb.v + (ry - pb.ry) / (pa.ry - pb.ry) * (pa.v - pb.v);
          return pb?.v ?? pa?.v ?? 0;
        };

        // ── Head: keep all points before the cut, cap at lo ───────────────
        const headPts = sec.points.filter(p => p.ry < cutRy);
        headPts.push({ ry: cutRy, v: interpV(cutRy) });
        if (headPts.length >= 2) acc.push({ ...sec, points: headPts });

        // ── Tail: section extends past hi — emit a new section from lo ────
        if (secEnd > hi) {
          const hiRy    = hi - baseY;
          const tailV0  = interpV(hiRy);
          // All points with ry > hiRy, re-based relative to the new section start (lo)
          const tailPts = sec.points
            .filter(p => p.ry > hiRy)
            .map(p => ({ ...p, ry: p.ry - hiRy }));
          if (tailPts.length >= 1) {
            acc.push({ ...sec, y: lo, points: [{ ry: 0, v: tailV0 }, ...tailPts] });
          }
        }
      }
      return acc;
    }, []);
    chart.lasers[s].sort((a, b) => a.y - b.y);
  }

  // ── BPM events ────────────────────────────────────────────────────────────
  // Delete BPM changes inside the region; shift those after hi.
  // The BPM that was active at lo is still in effect via the event before lo,
  // so no sentinel needs to be re-inserted.
  chart.bpmEvents = chart.bpmEvents.reduce((acc, ev) => {
    if (ev.y < lo)        acc.push(ev);
    else if (ev.y < hi) { /* delete */ }
    else                  acc.push({ ...ev, y: ev.y - span });
    return acc;
  }, []);
  chart.bpmEvents.sort((a, b) => a.y - b.y);

  // ── Time-sig events ───────────────────────────────────────────────────────
  // timeSigEvents use { measure, num, den } — convert to ticks for comparison,
  // then shift measure index (not a raw tick) when moving events past the cut.
  if (chart.timeSigEvents?.length) {
    chart.timeSigEvents = chart.timeSigEvents.reduce((acc, ev) => {
      const evTick = ev.measure * TICKS_PER_MEASURE;
      if (evTick < lo)        acc.push(ev);
      else if (evTick < hi) { /* delete — inside cut region */ }
      else                    acc.push({ ...ev, measure: ev.measure - Math.round(span / TICKS_PER_MEASURE) });
      return acc;
    }, []);
    chart.timeSigEvents.sort((a, b) => a.measure - b.measure);
  }

  // ── Camera events ─────────────────────────────────────────────────────────
  if (chart.cameraEvents?.length) {
    chart.cameraEvents = chart.cameraEvents.reduce((acc, ev) => {
      if (ev.y < lo)        acc.push(ev);
      else if (ev.y < hi) { /* delete */ }
      else                  acc.push({ ...ev, y: ev.y - span });
      return acc;
    }, []);
    chart.cameraEvents.sort((a, b) => a.y - b.y);
  }

  // ── Stop events ───────────────────────────────────────────────────────────
  if (chart.stopEvents?.length) {
    chart.stopEvents = chart.stopEvents.reduce((acc, ev) => {
      if (ev.y < lo)        acc.push(ev);
      else if (ev.y < hi) { /* delete */ }
      else                  acc.push({ ...ev, y: ev.y - span });
      return acc;
    }, []);
    chart.stopEvents.sort((a, b) => a.y - b.y);
  }

  // ── Deselect and refresh ──────────────────────────────────────────────────
  sel.active = false;
  updateBpmList?.();
  updateCameraEventList?.();
  updateStopEventList?.();
  render();
}

// ── Random ────────────────────────────────────────────────────────────────────
function selRandom(what) {
  saveUndo(`Randomized ${what.toUpperCase()}`);
  const [lo, hi] = sel.active ? selTickRange() : [0, chart.totalTicks()];

  const shuffleArr = arr => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  if (what === 'bt' || what === 'all') {
    // Collect BT columns of notes in range, shuffle lane assignments
    const inRange = [];
    for (let li = 0; li < 4; li++) {
      for (const n of chart.bt[li]) {
        if (n.y >= lo && n.y < hi) inRange.push({ li, n });
      }
    }
    const laneMap = shuffleArr([0,1,2,3]);
    for (const { li, n } of inRange) {
      chart.bt[li] = chart.bt[li].filter(x => x !== n);
    }
    for (const { li, n } of inRange) {
      chart.bt[laneMap[li]].push({ ...n });
      chart.bt[laneMap[li]].sort((a,b) => a.y - b.y);
    }
  }

  if (what === 'fx' || what === 'all') {
    // Swap FX-L and FX-R in range randomly
    if (Math.random() < 0.5) {
      const tmp = chart.fx[0].filter(n => n.y >= lo && n.y < hi);
      const tmp2 = chart.fx[1].filter(n => n.y >= lo && n.y < hi);
      chart.fx[0] = [...chart.fx[0].filter(n => n.y < lo || n.y >= hi), ...tmp2].sort((a,b)=>a.y-b.y);
      chart.fx[1] = [...chart.fx[1].filter(n => n.y < lo || n.y >= hi), ...tmp].sort((a,b)=>a.y-b.y);
    }
  }

  if (what === 'vol' || what === 'all') {
    // VOL random: either mirror or swap sides (preserve playability)
    const choice = Math.random() < 0.5 ? 'mirror' : 'swap';
    if (choice === 'mirror') {
      for (let s = 0; s < 2; s++) {
        for (const sec of chart.lasers[s]) {
          if (sec.y < lo || sec.y >= hi) continue;
          sec.points = sec.points.map(p => ({ ...p, v: 1 - p.v }));
        }
      }
    } else {
      // Swap L and R sections that are in range
      const lInRange = chart.lasers[0].filter(s => s.y >= lo && s.y < hi);
      const rInRange = chart.lasers[1].filter(s => s.y >= lo && s.y < hi);
      chart.lasers[0] = [...chart.lasers[0].filter(s => s.y < lo || s.y >= hi),
                         ...rInRange.map(s => ({ ...s, points: s.points.map(p => ({...p, v: 1-p.v})) }))].sort((a,b)=>a.y-b.y);
      chart.lasers[1] = [...chart.lasers[1].filter(s => s.y < lo || s.y >= hi),
                         ...lInRange.map(s => ({ ...s, points: s.points.map(p => ({...p, v: 1-p.v})) }))].sort((a,b)=>a.y-b.y);
    }
  }

  render();
}

// ── VOL overlap detection ─────────────────────────────────────────────────────
function checkLaserOverlap() {
  for (let side = 0; side < 2; side++) {
    const secs = chart.lasers[side];
    const toRemove = new Set();
    for (let i = 0; i < secs.length; i++) {
      const a = secs[i];
      const aEnd = a.y + (a.points[a.points.length - 1]?.ry ?? 0);
      for (let j = i + 1; j < secs.length; j++) {
        const b = secs[j];
        if (b.y > aEnd) break; // sorted by y, no more overlap possible
        if (b.y < aEnd) {
          // Overlap detected — flash red on renderer then remove later section
          toRemove.add(j);
          renderer?.flashLaserOverlap?.(side, b.y);
        }
      }
    }
    // Remove in reverse order to keep indices valid
    Array.from(toRemove).sort((a,b)=>b-a).forEach(idx => secs.splice(idx,1));
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────
let ctxMenuEl = null;

function ensureCtxMenu() {
  if (ctxMenuEl) return;
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.display = 'none';
  ctxMenuEl.innerHTML = `
    <div class="ctx-item" data-act="cut">Cut</div>
    <div class="ctx-item" data-act="copy">Copy</div>
    <div class="ctx-item" data-act="paste">Paste</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item ctx-has-sub">Modify Style
      <div class="ctx-sub">
        <div class="ctx-item ctx-has-sub">Mirror
          <div class="ctx-sub">
            <div class="ctx-item" data-act="mirror-all">Mirror All</div>
            <div class="ctx-item" data-act="mirror-fx">Mirror FX</div>
            <div class="ctx-item" data-act="mirror-bt">Mirror BT</div>
            <div class="ctx-item" data-act="mirror-vol">Mirror VOL</div>
          </div>
        </div>
      </div>
    </div>
    <div class="ctx-item ctx-has-sub">Adjust Speed
      <div class="ctx-sub">
        <div class="ctx-item" data-act="speed-half">Speed ½× (slower)</div>
        <div class="ctx-item" data-act="speed-double">Speed 2× (faster)</div>
      </div>
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item ctx-has-sub">Random
      <div class="ctx-sub">
        <div class="ctx-item" data-act="rand-all">Random All</div>
        <div class="ctx-item" data-act="rand-bt">Random BT</div>
        <div class="ctx-item" data-act="rand-fx">Random FX</div>
        <div class="ctx-item" data-act="rand-vol">Random VOL</div>
      </div>
    </div>
  `;
  document.body.appendChild(ctxMenuEl);

  ctxMenuEl.addEventListener('click', e => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    ctxMenuEl.style.display = 'none';
    const act = item.dataset.act;
    if (act === 'cut')          selCut();
    else if (act === 'copy')    selCopy();
    else if (act === 'paste')   selPaste();
    else if (act === 'mirror-all') selMirror('all');
    else if (act === 'mirror-fx')  selMirror('fx');
    else if (act === 'mirror-bt')  selMirror('bt');
    else if (act === 'mirror-vol') selMirror('vol');
    else if (act === 'speed-half')   selAdjustSpeed(0.5);
    else if (act === 'speed-double') selAdjustSpeed(2.0);
    else if (act === 'rand-all') selRandom('all');
    else if (act === 'rand-bt')  selRandom('bt');
    else if (act === 'rand-fx')  selRandom('fx');
    else if (act === 'rand-vol') selRandom('vol');
  });

  document.addEventListener('click', () => { if (ctxMenuEl) ctxMenuEl.style.display = 'none'; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ctxMenuEl) ctxMenuEl.style.display = 'none'; });
}

function showCtxMenu(x, y) {
  ensureCtxMenu();
  ctxMenuEl.style.display = 'block';
  const tw = ctxMenuEl.offsetWidth || 160, th = ctxMenuEl.offsetHeight || 200;
  ctxMenuEl.style.left = Math.min(x, window.innerWidth  - tw - 8) + 'px';
  ctxMenuEl.style.top  = Math.min(y, window.innerHeight - th - 8) + 'px';
}

function openContextMenuCenter() {
  const canvas = document.getElementById('chart-canvas');
  if (canvas && viewMode !== 'game') {
    const r = canvas.getBoundingClientRect();
    showCtxMenu(r.left + r.width / 2, r.top + r.height / 2);
  } else {
    const gw = document.getElementById('game-canvas');
    if (gw) {
      const r = gw.getBoundingClientRect();
      showGameCtxMenu(r.left + r.width / 2, r.top + r.height / 2);
    }
  }
}

// ── Laser envelope interaction ────────────────────────────────────────────────

// Track which anchor point is currently selected for interpolation editing.
let _laserSel = null; // { side, sec, ptIndex }

// Bezier handle drag state — set when user grabs a diamond handle
let _curveDrag = null; // { sec, ptIndex, t0, t1, colIdx, colLen }

// Show the laser interpolation popup menu at (x, y) for a given anchor point.
function showLaserInterpMenu(screenX, screenY, side, sec, ptIndex) {
  const menu = document.getElementById('laser-interp-menu');
  if (!menu) return;
  const pt      = sec.points[ptIndex];
  const current = pt?.interp ?? 'linear';

  // Mark active item
  menu.querySelectorAll('.lim-item').forEach(el => {
    el.classList.toggle('lim-active', el.dataset.type === current);
  });

  menu.style.left    = screenX + 'px';
  menu.style.top     = screenY + 'px';
  menu.style.display = 'block';

  // Remove old handler, add fresh one
  const handler = e => {
    const item = e.target.closest('.lim-item');
    if (!item) return;
    const type = item.dataset.type;
    if (type && sec.points[ptIndex]) {
      saveUndo('Set interp ' + type);
      sec.points[ptIndex].interp = type;
      // Sync curve to sensible default when switching to bezier
      if (type === 'bezier' && !(sec.points[ptIndex].curve ?? 0.5)) {
        sec.points[ptIndex].curve = 0.5;
      }
      render();
    }
    menu.style.display = 'none';
    menu.removeEventListener('click', handler);
  };
  menu.addEventListener('click', handler);
}

// Cycle through interpolation types: linear → bezier → step → linear
function cycleInterpType(sec, ptIndex) {
  if (!sec?.points[ptIndex]) return;
  const pt   = sec.points[ptIndex];
  const cycle = ['linear', 'bezier', 'step'];
  const next  = cycle[(cycle.indexOf(pt.interp ?? 'linear') + 1) % cycle.length];
  saveUndo('Cycle interp → ' + next);
  pt.interp = next;
  if (next === 'bezier' && pt.curve == null) pt.curve = 0.5;
  render();
}

// Close laser interp menu when clicking elsewhere
document.addEventListener('click', e => {
  const menu = document.getElementById('laser-interp-menu');
  if (menu && !menu.contains(e.target)) menu.style.display = 'none';
});

// ── Game preview context menu ─────────────────────────────────────────────────
let gameCtxEl = null;
let _gameEditMode = false;

function ensureGameCtxMenu() {
  if (gameCtxEl) return;
  gameCtxEl = document.createElement('div');
  gameCtxEl.className = 'ctx-menu';
  gameCtxEl.style.display = 'none';
  gameCtxEl.innerHTML = `
    <div class="ctx-item" data-act="edit-mode">✏ Edit Chart in Preview</div>
    <div class="ctx-item" data-act="exit-edit">✕ Exit Edit Mode</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" data-act="to-edit">Open Full Edit View</div>
    <div class="ctx-item" data-act="to-split">Split View</div>
  `;
  document.body.appendChild(gameCtxEl);
  gameCtxEl.addEventListener('click', e => {
    const item = e.target.closest('[data-act]');
    if (!item) return;
    gameCtxEl.style.display = 'none';
    const act = item.dataset.act;
    if (act === 'edit-mode')  enableGameEditMode();
    else if (act === 'exit-edit') disableGameEditMode();
    else if (act === 'to-edit')  setViewMode('edit');
    else if (act === 'to-split') setViewMode('split');
  });
  document.addEventListener('click', ev => {
    if (gameCtxEl && !gameCtxEl.contains(ev.target)) gameCtxEl.style.display = 'none';
  });
}

function showGameCtxMenu(x, y) {
  ensureGameCtxMenu();
  // Toggle edit/exit items
  gameCtxEl.querySelector('[data-act="edit-mode"]').style.display  = _gameEditMode ? 'none' : '';
  gameCtxEl.querySelector('[data-act="exit-edit"]').style.display  = _gameEditMode ? '' : 'none';
  gameCtxEl.style.display = 'block';
  const tw = gameCtxEl.offsetWidth || 180, th = gameCtxEl.offsetHeight || 120;
  gameCtxEl.style.left = Math.min(x, window.innerWidth  - tw - 8) + 'px';
  gameCtxEl.style.top  = Math.min(y, window.innerHeight - th - 8) + 'px';
}

function enableGameEditMode() {
  _gameEditMode = true;
  const ov = document.getElementById('game-edit-overlay');
  if (ov) ov.style.display = 'flex';
}

function disableGameEditMode() {
  _gameEditMode = false;
  const ov = document.getElementById('game-edit-overlay');
  if (ov) ov.style.display = 'none';
}

// ── Tick sound ────────────────────────────────────────────────────────────────
function detectBtHits(prevTick, curTick) {
  if (!tickBuffer || !audioCtx || !settings.tickSound) return;
  for (let li = 0; li < 4; li++) {
    for (const n of chart.bt[li]) {
      const hitTick = n.y;
      if (hitTick >= prevTick && hitTick < curTick) {
        const src = audioCtx.createBufferSource();
        src.buffer = tickBuffer;
        src.connect(tickGainNode || audioCtx.destination);
        src.start();
      }
    }
  }
}

// ── Mouse handlers ─────────────────────────────────────────────────────────────
function getHit(e) {
  const rect = renderer.canvas.getBoundingClientRect();
  const cx   = e.clientX - rect.left;
  const cy   = e.clientY - rect.top;
  const hit  = renderer.canvasToTick(cx, cy);
  hit.tick   = Math.max(0, snapTick(hit.tick));
  hit.cx     = cx; hit.cy = cy;
  return hit;
}

function onMouseDown(e) {
  e.preventDefault();

  // ── Camera-pill click: open popup at fixed position (left-click only) ────
  // Check this FIRST so clicking a pill doesn't also place notes etc.
  if (e.button === 0 && renderer) {
    const camHit = _findCamPillAt(e.offsetX, e.offsetY);
    if (camHit !== null) {
      // Toggle: clicking the same tick closes, clicking a different tick opens
      const currentTick = _camPopupFixedTick;
      if (_camPopupFixedTick === camHit.tick) {
        _camPopupFixedTick = null;
        _hideCamPopup();
      } else {
        _camPopupFixedTick = camHit.tick;
        _showCamPopup(camHit.tick, e.clientX, e.clientY);
      }
      return;
    } else {
      // Clicked somewhere that isn't a pill — close popup if open
      if (_camPopupFixedTick !== null) {
        _camPopupFixedTick = null;
        _hideCamPopup();
      }
    }
  }

  // ── FX hold click: open param popup (left-click, not during playback) ────
  if (e.button === 0 && renderer && !playing) {
    const fxHit = _findFxHoldAt(e.offsetX, e.offsetY);
    if (fxHit !== null) {
      if (_fxPopupFixedLane === fxHit.li) {
        // Clicking the same lane's hold closes the popup
        _fxPopupFixedLane = null;
        _hideFxPopup();
        renderer._hoveredFxHold = null;
      } else {
        _fxPopupFixedLane = fxHit.li;
        _showFxPopup(fxHit.li, e.clientX, e.clientY);
        renderer._hoveredFxHold = { li: fxHit.li, note: fxHit.note };
      }
      render();
      return;
    } else if (_fxPopupFixedLane !== null) {
      _fxPopupFixedLane = null;
      _hideFxPopup();
      renderer._hoveredFxHold = null;
    }
  }

  // Middle mouse = start selection drag
  if (e.button === 1) {
    const h = getHit(e);
    sel.dragging = true;
    sel._dragStartX = e.clientX;
    sel._dragStartY = e.clientY;
    sel.startTick = snapTick(h.tick);
    sel.endTick   = sel.startTick;
    render();
    return;
  }
  if (e.button !== 0) return;
  _fxPinned = false;
  hideFxTooltip();
  const h = getHit(e);
  const { tick, laneIdx, localX } = h;
  if (laneIdx < 0) return;

  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  if (tool === 'erase')    saveUndo(`Erased at M${m}`);
  else if (tool === 'bt')  saveUndo(`Added BT note at M${m}`);
  else if (tool === 'fx')  saveUndo(`Added FX note at M${m}`);
  else if (tool === 'laser-l') saveUndo(`Added VOL-L at M${m}`);
  else if (tool === 'laser-r') saveUndo(`Added VOL-R at M${m}`);
  else saveUndo();

  if (tool === 'erase') { eraseAt(laneIdx, tick); render(); return; }

  if (tool === 'cam-event') {
    const type = document.getElementById('cam-type-sel')?.value ?? 'zoom_bottom';
    const val  = String(parseFloat(document.getElementById('cam-val-inp')?.value ?? '0') || 0);
    chart.cameraEvents = chart.cameraEvents ?? [];
    chart.cameraEvents.push({ y: tick, type, value: val });
    chart.cameraEvents.sort((a, b) => a.y - b.y);
    updateCameraEventList();
    render();
    return;
  }

  if (tool === 'stop-event') {
    Object.assign(drag, { active: true, lane: -1, laneType: 'stop', startTick: tick });
    return;
  }

  if (tool === 'bt' && laneIdx >= 0 && laneIdx <= 3) {
    Object.assign(drag, { active: true, lane: laneIdx, laneType: 'bt', startTick: tick });
    chart.addBtNote(laneIdx, tick, 0); render(); return;
  }

  if (tool === 'fx' && laneIdx >= 0 && laneIdx <= 3) {
    const li = laneIdx <= 1 ? 0 : 1;
    Object.assign(drag, { active: true, lane: li, laneType: 'fx', startTick: tick });
    chart.addFxNote(li, tick, 0); render(); return;
  }

  if ((tool === 'laser-l' || tool === 'laser-r') && laneIdx !== -1) {
    const side = tool === 'laser-l' ? 0 : 1;
    const wide = chart.laserSettings.wide || laserWideMode;

    // ── Alt+click: cycle interpolation on nearest anchor dot ──────────────
    if (e.altKey) {
      const hit = renderer?.getLaserPointAt(e.offsetX, e.offsetY, side);
      if (hit) {
        cycleInterpType(hit.sec, hit.ptIndex);
        _laserSel = { side: hit.side, sec: hit.sec, ptIndex: hit.ptIndex };
        if (renderer) renderer.selectedLaserPoint = _laserSel;
        render(); return;
      }
    }

    // ── Grab bezier diamond handle → start curve drag ──────────────────────
    {
      const hit = renderer?.getBezierHandleAt(e.offsetX, e.offsetY, side);
      if (hit) {
        _curveDrag = { sec: hit.sec, ptIndex: hit.ptIndex, t0: hit.t0, t1: hit.t1 };
        if (renderer) renderer.activeBezierHandle = { sec: hit.sec, ptIndex: hit.ptIndex };
        const canvas = document.getElementById('chart-canvas');
        if (canvas) canvas.style.cursor = 'grabbing';
        render(); return;
      }
    }

    // ── Default: draw a new laser section / add point ─────────────────────
    const v       = renderer.localXToLaserPos(localX, wide);
    const freehand = e.shiftKey;
    const newSec  = { y: tick, points: [{ ry: 0, v, slam: false, interp: 'linear', curve: 0.5 }], wide };
    chart.lasers[side].push(newSec);
    chart.lasers[side].sort((a, b) => a.y - b.y);
    // Deselect previous selection
    _laserSel = null;
    if (renderer) renderer.selectedLaserPoint = null;
    Object.assign(drag, { active: true, lane: laneIdx, laneType: 'laser', side, startTick: tick, laserSec: newSec, freehand });
    if (renderer) renderer.activeLaserSec = newSec;
    render(); return;
  }

  // Click to set cursor position in select mode
  if (tool === 'select') {
    renderer.playTick = tick;
    updateSeekbar(tick);
    render();
  }
}

function onMouseMove(e) {
  // ── Bezier handle drag ───────────────────────────────────────────────────
  if (_curveDrag) {
    const h = getHit(e);
    const { sec, ptIndex, t0, t1 } = _curveDrag;
    const span = t1 - t0;
    if (span > 0) {
      const rawCurve = (h.tick - t0) / span;
      sec.points[ptIndex].curve = Math.max(0.01, Math.min(0.99, rawCurve));
    }
    const canvas = document.getElementById('chart-canvas');
    if (canvas) canvas.style.cursor = 'grabbing';
    render();
    return;
  }
  if (sel.dragging) {
    const h = getHit(e);
    sel.endTick = snapTick(h.tick);
    render();
    updateStatusFromEvent(e);
    return;
  }
  if (!drag.active) {
    updateStatusFromEvent(e);
    if (tool === 'select') checkFxHover(e);
    else hideFxTooltip();
    // Show grab cursor and highlight handle when hovering over a bezier diamond
    if ((tool === 'laser-l' || tool === 'laser-r') && renderer) {
      const side = tool === 'laser-l' ? 0 : 1;
      const handleHit = renderer.getBezierHandleAt(e.offsetX, e.offsetY, side);
      const canvas = document.getElementById('chart-canvas');
      if (canvas) canvas.style.cursor = handleHit ? 'grab' : '';
      const prev = renderer.activeBezierHandle;
      renderer.activeBezierHandle = handleHit
        ? { sec: handleHit.sec, ptIndex: handleHit.ptIndex }
        : null;
      // Only re-render if highlight state changed
      if (!!prev !== !!renderer.activeBezierHandle ||
          (prev && renderer.activeBezierHandle &&
           (prev.sec !== renderer.activeBezierHandle.sec ||
            prev.ptIndex !== renderer.activeBezierHandle.ptIndex))) {
        render();
      }
    }

    // ── Camera-pill highlight (hover only — popup triggered by click) ─────
    if (renderer) {
      const camHit = _findCamPillAt(e.offsetX, e.offsetY);
      const prevTick = renderer._hoveredCamTick;
      renderer._hoveredCamTick = camHit !== null ? camHit.tick : null;
      if (prevTick !== renderer._hoveredCamTick) render();
    }

    // ── FX hold highlight (hover only — popup fixed by click) ─────────────
    if (renderer && _fxPopupFixedLane === null) {
      const fxHit = _findFxHoldAt(e.offsetX, e.offsetY);
      const prevFxHold = renderer._hoveredFxHold;
      renderer._hoveredFxHold = fxHit ? { li: fxHit.li, note: fxHit.note } : null;
      // Update cursor
      const canvas = document.getElementById('chart-canvas');
      if (canvas) canvas.style.cursor = fxHit ? 'pointer' : '';
      if (prevFxHold !== renderer._hoveredFxHold) render();
    }

    return;
  }
  const h = getHit(e);
  const { tick, localX } = h;

  if (drag.laneType === 'bt') {
    const st  = Math.min(drag.startTick, tick);
    const len = Math.abs(tick - drag.startTick);
    chart.addBtNote(drag.lane, st, len);
  } else if (drag.laneType === 'fx') {
    const st  = Math.min(drag.startTick, tick);
    const len = Math.abs(tick - drag.startTick);
    chart.addFxNote(drag.lane, st, len);
  } else if (drag.laneType === 'laser' && drag.laserSec) {
    const wide = drag.laserSec.wide || laserWideMode;
    const v  = renderer.localXToLaserPos(localX, wide);
    const ry = Math.round(tick) - drag.laserSec.y;
    const lastRy = drag.laserSec.points[drag.laserSec.points.length - 1]?.ry ?? -1;
    if (drag.freehand) {
      // Freehand mode (Shift held): sample every point for smoothing on mouseUp
      if (ry > lastRy) drag.laserSec.points.push({ ry, v });
      else if (ry === lastRy) drag.laserSec.points[drag.laserSec.points.length - 1].v = v;
    } else {
      if (ry > lastRy) drag.laserSec.points.push({ ry, v });
      else if (ry === lastRy) drag.laserSec.points[drag.laserSec.points.length - 1].v = v;
    }
  }
  render();
  updateStatusFromEvent(e);
}

function onMouseUp(e) {
  // End bezier handle drag — save undo snapshot
  if (_curveDrag) {
    _curveDrag = null;
    if (renderer) renderer.activeBezierHandle = null;
    const canvas = document.getElementById('chart-canvas');
    if (canvas) canvas.style.cursor = '';
    saveUndo('Adjusted laser curve');
    render();
    return;
  }
  if (e?.button === 1) {
    sel.dragging = false;
    const dx = e.clientX - (sel._dragStartX ?? e.clientX);
    const dy = e.clientY - (sel._dragStartY ?? e.clientY);
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist < 5) {
      // Single click — just set cursor position
      renderer.playTick = sel.startTick;
      updateSeekbar(sel.startTick);
      sel.active = false;
    } else {
      sel.active = true;
      if (Math.abs(sel.endTick - sel.startTick) < snap) {
        sel.startTick = Math.min(sel.startTick, sel.endTick);
        sel.endTick   = sel.startTick + snap;
      }
    }
    updateSelStatus();
    render();
    return;
  }
  // Handle stop-event drag end
  if (drag.laneType === 'stop' && drag.active) {
    const h = getHit(e);
    const endTick = snapTick(h.tick);
    const minLen  = Math.round(TICKS_PER_BEAT / 4);
    const len     = Math.max(minLen, Math.abs(endTick - drag.startTick));
    const y       = Math.min(drag.startTick, endTick);
    chart.stopEvents = chart.stopEvents ?? [];
    chart.stopEvents.push({ y, len });
    chart.stopEvents.sort((a, b) => a.y - b.y);
    updateStopEventList();
    drag.active = false;
    drag.laneType = '';
    render();
    return;
  }

  // Apply RDP simplification if freehand laser was drawn
  if (drag.freehand && drag.laserSec && drag.laserSec.points.length > 3) {
    drag.laserSec.points = _rdpSimplify(drag.laserSec.points, 0.04);
    render();
  }
  drag.active = false;
  drag.freehand = false;
  drag.laserSec = null;
  if (renderer) renderer.activeLaserSec = null;
}

// ── Double-click: laser anchor X-position editor (sketch item 14) ────────────
// Opens a small floating popup for precision X (v) editing of any laser anchor dot.
function onDblClick(e) {
  if (e.button !== 0) return;
  if (tool !== 'laser-l' && tool !== 'laser-r') return;
  const side = tool === 'laser-l' ? 0 : 1;
  const hit  = renderer?.getLaserPointAt(e.offsetX, e.offsetY, side);
  if (!hit) return;

  e.preventDefault();

  // Remove stale popup if any
  document.getElementById('laser-pt-popup')?.remove();
  document.getElementById('laser-pt-overlay')?.remove();

  const pt  = hit.sec.points[hit.ptIndex];
  const absY = hit.sec.y + pt.ry;
  const m   = Math.floor(absY / TICKS_PER_MEASURE) + 1;
  const b   = Math.floor((absY % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

  // ── Overlay (click-outside closes) ───────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'laser-pt-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99997';

  // ── Popup ─────────────────────────────────────────────────────────────────
  const pop = document.createElement('div');
  pop.id = 'laser-pt-popup';
  pop.style.cssText =
    'position:fixed;z-index:99998;background:#0c0c20;border:1.5px solid #3344aa;' +
    'border-radius:8px;padding:12px 14px;box-shadow:0 6px 24px #000c;' +
    'display:flex;flex-direction:column;gap:8px;min-width:180px;font-family:inherit;color:#e0e8ff;font-size:12px';

  const sideLabel = side === 0 ? 'VOL-L' : 'VOL-R';
  const sideColor = side === 0 ? '#0088ff' : '#ff1177';

  pop.innerHTML = `
    <div style="font-weight:bold;color:${sideColor}">${sideLabel} Anchor — M${m} B${b}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <label style="color:#8899cc;min-width:20px">X:</label>
      <input id="lpt-x" type="number" min="0" max="1" step="0.0001" value="${pt.v.toFixed(4)}"
        style="background:#161630;border:1px solid #3344aa;border-radius:4px;color:#e0e8ff;
               font-size:12px;padding:4px 7px;outline:none;width:90px">
      <span style="color:#556">(0–1)</span>
    </div>
    <div style="color:#556;font-size:10px">Tick: ${absY}</div>
    <div style="display:flex;gap:8px;margin-top:2px">
      <button id="lpt-ok"     style="flex:1;background:#2233aa;color:#e0e8ff;border:1px solid #3344cc;border-radius:4px;padding:5px;cursor:pointer;font-size:11px">Apply</button>
      <button id="lpt-cancel" style="flex:1;background:#161630;color:#778;border:1px solid #2a2a55;border-radius:4px;padding:5px;cursor:pointer;font-size:11px">Cancel</button>
    </div>`;

  // Position near cursor, keep on-screen
  const vw = window.innerWidth, vh = window.innerHeight;
  let px = e.clientX + 12, py = e.clientY - 10;
  if (px + 200 > vw) px = e.clientX - 200;
  if (py + 130 > vh) py = e.clientY - 130;
  pop.style.left = px + 'px';
  pop.style.top  = py + 'px';

  const close = () => { overlay.remove(); pop.remove(); };

  pop.querySelector('#lpt-ok').addEventListener('click', () => {
    const newV = parseFloat(pop.querySelector('#lpt-x').value);
    if (!isNaN(newV)) {
      saveUndo('Adjusted laser anchor X');
      pt.v = Math.max(0, Math.min(1, newV));
      render();
    }
    close();
  });
  pop.querySelector('#lpt-cancel').addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Enter key submits
  pop.querySelector('#lpt-x').addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); pop.querySelector('#lpt-ok').click(); }
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });

  document.body.appendChild(overlay);
  document.body.appendChild(pop);
  setTimeout(() => pop.querySelector('#lpt-x')?.select(), 10);
}

// Ramer-Douglas-Peucker simplification for laser points {ry, v}
function _rdpSimplify(pts, epsilon) {
  if (pts.length <= 2) return pts;
  // Find point with max perpendicular distance from line between first and last
  const [first, last] = [pts[0], pts[pts.length - 1]];
  const dy = last.ry - first.ry, dx = last.v - first.v;
  const len = Math.sqrt(dy * dy + dx * dx);
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len === 0 ? Math.sqrt((pts[i].ry - first.ry) ** 2 + (pts[i].v - first.v) ** 2)
      : Math.abs(dy * (first.v - pts[i].v) - dx * (first.ry - pts[i].ry)) / len;
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    return [
      ..._rdpSimplify(pts.slice(0, maxIdx + 1), epsilon),
      ..._rdpSimplify(pts.slice(maxIdx), epsilon).slice(1),
    ];
  }
  return [first, last];
}

function updateSelStatus() {
  const el = document.getElementById('status-sel');
  if (!el) return;
  if (!sel.active) { el.textContent = ''; return; }
  const [lo, hi] = selTickRange();
  const mLo = Math.floor(lo / TICKS_PER_MEASURE) + 1;
  const mHi = Math.floor(hi / TICKS_PER_MEASURE) + 1;
  el.textContent = `Selection: M${mLo}–M${mHi} (${hi - lo} ticks) | Space=play sel | Ctrl+C/X/V | Ctrl+RClick=menu | Esc=clear`;
  const hint = document.getElementById('play-region-hint');
  if (hint) hint.textContent = sel.active ? '(plays selection)' : '';
}

function onRightClick(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    showCtxMenu(e.clientX, e.clientY);
    return;
  }

  // Right-click on laser anchor dot → show interpolation menu (laser tools)
  if (tool === 'laser-l' || tool === 'laser-r') {
    const side = tool === 'laser-l' ? 0 : 1;
    const hit  = renderer?.getLaserPointAt(e.offsetX, e.offsetY, side);
    if (hit) {
      // Select the dot first
      _laserSel = { side: hit.side, sec: hit.sec, ptIndex: hit.ptIndex };
      if (renderer) {
        renderer.selectedLaserPoint = _laserSel;
        renderer.activeLaserSec     = hit.sec;
      }
      render();
      showLaserInterpMenu(e.clientX, e.clientY, hit.side, hit.sec, hit.ptIndex);
      return;
    }
  }

  // Default: delete note at cursor
  const h = getHit(e);
  if (h.laneIdx < 0) return;
  saveUndo(`Deleted at M${Math.floor(h.tick / TICKS_PER_MEASURE) + 1}`);
  eraseAt(h.laneIdx, h.tick);
  // Clear selection if we erased a laser
  if (h.laneIdx === 4 || h.laneIdx === 5) {
    _laserSel = null;
    if (renderer) renderer.selectedLaserPoint = null;
  }
  render();
}

function eraseAt(laneIdx, tick) {
  // Also erase camera/stop events near tick (within half a beat)
  const hitRadius = TICKS_PER_BEAT / 2;
  const prevCamLen = (chart.cameraEvents ?? []).length;
  chart.cameraEvents = (chart.cameraEvents ?? []).filter(ev => Math.abs(ev.y - tick) > hitRadius);
  const prevStopLen = (chart.stopEvents ?? []).length;
  chart.stopEvents   = (chart.stopEvents ?? []).filter(ev => !(tick >= ev.y && tick <= ev.y + ev.len));
  if ((chart.cameraEvents ?? []).length !== prevCamLen)  updateCameraEventList();
  if ((chart.stopEvents   ?? []).length !== prevStopLen) updateStopEventList();

  if (laneIdx >= 0 && laneIdx <= 3) {
    chart.removeNote(chart.bt[laneIdx], tick);
    chart.removeNote(chart.fx[laneIdx <= 1 ? 0 : 1], tick);
  } else if (laneIdx === 4) {
    chart.removeLaserAt(0, tick);
  } else if (laneIdx === 5) {
    chart.removeLaserAt(1, tick);
  }
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+scroll: coarse zoom
    adjustZoom(e.deltaY < 0 ? 10 : -10);
  } else if (e.shiftKey) {
    // Shift+scroll: Ableton-style vertical zoom anchored to the tick under the cursor.
    //
    // How it works:
    //  1. Find which tick (within the column) is currently under the mouse cursor.
    //  2. Scale renderer.zoom by a smooth multiplier.
    //  3. After resize, scroll canvas-wrap so that same tick is still at the same screen Y.
    //
    // This feels exactly like Ableton track zoom: scroll up = zoom in (notes spread apart),
    // scroll down = zoom out (more chart visible), cursor position stays fixed.

    const canvasWrap = document.getElementById('canvas-wrap');
    const wrapRect   = canvasWrap.getBoundingClientRect();

    // Cursor Y relative to the viewport of canvas-wrap (0 = top of visible area)
    const screenY  = e.clientY - wrapRect.top;
    // Cursor Y relative to the canvas origin (accounts for vertical scroll)
    const canvasY  = screenY + canvasWrap.scrollTop;

    const oldZoom = renderer.zoom;
    const oldColH = renderer.colH;   // colTicks * oldZoom

    // Tick within the column that is under the cursor.
    // Canvas Y=0 is the TOP (highest tick); Y=colH is the BOTTOM (tick 0 of column).
    const tickUnderCursor = Math.max(0, (oldColH - canvasY) / oldZoom);

    // Smooth 12% per scroll notch — fine-grained like Ableton
    const FACTOR  = 1.12;
    const newZoom = Math.max(0.08, Math.min(8.0,
      e.deltaY < 0 ? oldZoom * FACTOR : oldZoom / FACTOR
    ));

    if (Math.abs(newZoom - oldZoom) > 0.0001) {
      renderer.zoom = newZoom;

      // Sync the zoom slider + label so the UI reflects the change
      const sliderVal = Math.round(newZoom / 1.2 * 100);
      const slider    = document.getElementById('zoom-slider');
      if (slider) {
        slider.value = Math.max(+slider.min, Math.min(+slider.max, sliderVal));
        const lbl = document.getElementById('zoom-label');
        if (lbl) lbl.textContent = slider.value + '%';
      }

      // Resize the canvas (sets canvas.height = newColH = colTicks * newZoom)
      renderer.resize();

      // Re-anchor: compute where tickUnderCursor lands in the new canvas and
      // set scrollTop so it appears at the same screenY.
      const newColH    = renderer.colH;                           // colTicks * newZoom
      const newCanvasY = newColH - tickUnderCursor * newZoom;     // new canvas Y of that tick
      canvasWrap.scrollTop = Math.max(0,
        Math.min(canvasWrap.scrollHeight - canvasWrap.clientHeight, newCanvasY - screenY)
      );

      render();
    }
  } else {
    const dir = e.deltaY > 0 ? -1 : 1;
    renderer.scrollCol = Math.max(0, Math.min(renderer.totalCols() - 1, renderer.scrollCol - dir));
    render();
  }
}

function updateStatusFromEvent(e) {
  const h = getHit(e);
  const tick    = Math.max(0, Math.round(h.tick));
  const measure = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const beat    = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
  document.getElementById('status-tick').textContent    = `Tick: ${tick}`;
  document.getElementById('status-measure').textContent = `Measure: ${measure}`;
  document.getElementById('status-beat').textContent    = `Beat: ${beat}`;
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
const TOOL_ORDER  = ['select', 'bt', 'fx', 'laser-l', 'laser-r', 'erase', 'cam-event', 'stop-event'];
// Snap entries: v = ticks (may be fractional), l = display label
// 192 ticks/measure; integer values: 48,24,16,12,8,6,4,3,2,1
// Sub-tick values (1.5, 0.75, 0.5, 0.375) are rounded to int by snapTick()
const SNAP_ENTRIES = [
  { v: 48,    l: '1/4'   },
  { v: 24,    l: '1/8'   },
  { v: 16,    l: '1/12'  },
  { v: 12,    l: '1/16'  },
  { v: 8,     l: '1/24'  },
  { v: 6,     l: '1/32'  },
  { v: 4,     l: '1/48'  },
  { v: 3,     l: '1/64'  },
  { v: 2,     l: '1/96'  },
  { v: 1.5,   l: '1/128' },
  { v: 1,     l: '1/192' },
  { v: 0.75,  l: '1/256' },
  { v: 0.5,   l: '1/384' },
  { v: 0.375, l: '1/512' },
  { v: 0,     l: 'Free'  },
];
const SNAP_VALUES = SNAP_ENTRIES.map(e => e.v);
const SNAP_LABELS = Object.fromEntries(SNAP_ENTRIES.map(e => [e.v, e.l]));

function onKeyDown(e) {
  if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
  const ctrl = e.ctrlKey || e.metaKey;

  switch (e.key) {
    case '1': setTool('select');     break;
    case '2': setTool('bt');         break;
    case '3': setTool('fx');         break;
    case '4': setTool('laser-l');    break;
    case '5': setTool('laser-r');    break;
    case '6': setTool('cam-event');  break;
    case '7': setTool('stop-event'); break;
    case 'e': case 'E': setTool('erase'); break;

    case 'Tab':
      e.preventDefault();
      { const i = TOOL_ORDER.indexOf(tool);
        setTool(TOOL_ORDER[(i + (e.shiftKey ? -1 : 1) + TOOL_ORDER.length) % TOOL_ORDER.length]); }
      break;

    case ' ':
      e.preventDefault();
      if (sel.active && !playing) {
        const [lo, hi] = selTickRange();
        renderer.playTick = lo;
        startPlay(hi);
      } else {
        togglePlay();
      }
      break;

    case 'z': case 'Z':
      e.preventDefault();
      if (ctrl) undo();
      break;
    case 'y': case 'Y':
      e.preventDefault();
      if (ctrl) redo();
      break;

    case 's': case 'S':
      if (ctrl) { e.preventDefault();
        downloadText((chart.meta.title.replace(/[^a-zA-Z0-9_]/g,'_')||'chart')+'.ksh', exportKsh(chart)); }
      break;

    case 'h': case 'H':
      if (!ctrl) {
        e.preventDefault();
        const hp = document.getElementById('history-panel');
        if (hp) hp.style.display = hp.style.display === 'none' ? 'flex' : 'none';
      }
      break;

    case 'c': case 'C':
      if (ctrl) { e.preventDefault(); selCopy(); }
      else { e.preventDefault(); openContextMenuCenter(); }
      break;
    case 'x': case 'X':
      if (ctrl) { e.preventDefault(); selCut(); render(); } break;
    case 'v': case 'V':
      if (ctrl) { e.preventDefault(); selPaste(); } break;

    case 'Escape':
      sel.active = false; sel.dragging = false;
      updateSelStatus(); render(); break;

    // Column navigation
    case 'ArrowLeft':
      e.preventDefault();
      renderer.scrollCol = Math.max(0, renderer.scrollCol - (ctrl ? renderer.numCols : 1));
      if (!playing) { renderer.playTick = renderer.scrollCol * renderer.measPerCol * TICKS_PER_MEASURE; updateSeekbar(renderer.playTick); }
      render(); break;
    case 'ArrowRight':
      e.preventDefault();
      renderer.scrollCol = Math.min(renderer.totalCols() - 1, renderer.scrollCol + (ctrl ? renderer.numCols : 1));
      if (!playing) { renderer.playTick = renderer.scrollCol * renderer.measPerCol * TICKS_PER_MEASURE; updateSeekbar(renderer.playTick); }
      render(); break;

    case 'Home':
      e.preventDefault(); stopPlay();
      renderer.scrollCol = 0; renderer.playTick = 0; updateSeekbar(0); render(); break;
    case 'End':
      e.preventDefault(); stopPlay();
      renderer.scrollCol = Math.max(0, renderer.totalCols() - renderer.numCols);
      renderer.playTick  = chart.totalTicks(); updateSeekbar(renderer.playTick); render(); break;

    case 'PageDown':
      e.preventDefault();
      renderer.scrollCol = Math.max(0, renderer.scrollCol - renderer.numCols);
      render(); break;
    case 'PageUp':
      e.preventDefault();
      renderer.scrollCol = Math.min(renderer.totalCols() - 1, renderer.scrollCol + renderer.numCols);
      render(); break;

    case '[':
      { const i = SNAP_VALUES.findIndex(v => Math.abs(v - snap) < 0.001);
        if (i < SNAP_VALUES.length - 1) { snap = SNAP_VALUES[i + 1]; syncSnapUI(); } }
      break;
    case ']':
      { const i = SNAP_VALUES.findIndex(v => Math.abs(v - snap) < 0.001);
        if (i > 0) { snap = SNAP_VALUES[i - 1]; syncSnapUI(); } }
      break;

    case '=': case '+':
      if (ctrl) { e.preventDefault(); adjustZoom(+15); } break;
    case '-':
      if (ctrl) { e.preventDefault(); adjustZoom(-15); } break;

    case 'Delete': case 'Backspace':
      if (e.shiftKey && sel.active) {
        e.preventDefault();
        selRippleDelete();
      }
      break;

    case 'G':
      if (e.shiftKey) { e.preventDefault(); openGotoBeatModal(); }
      break;
  }
}

function openGotoBeatModal() {
  // Remove any stale instance
  const existing = document.getElementById('go-to-beat-modal');
  if (existing) { existing.previousElementSibling?.remove(); existing.remove(); }

  // ── Helper: jump to an absolute tick ──────────────────────────────────────
  function jumpToTick(tick) {
    if (isNaN(tick) || tick < 0) return;
    const col = Math.floor(tick / (renderer.measPerCol * TICKS_PER_MEASURE));
    renderer.scrollCol = Math.max(0, Math.min(renderer.totalCols() - 1, col));
    renderer.playTick  = tick;
    updateSeekbar(tick);
    render();
    // Center the target beat vertically in canvas-wrap
    requestAnimationFrame(() => {
      const cw  = document.getElementById('canvas-wrap');
      const pos = renderer.tickToCanvas(tick);
      if (cw && pos) cw.scrollTop = Math.max(0, pos.cy - cw.clientHeight * 0.5);
    });
  }

  // ── Modal shell ───────────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id = 'go-to-beat-modal';
  modal.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:#0c0c20;border:1.5px solid #3344aa;border-radius:10px;' +
    'padding:18px 22px;z-index:99999;box-shadow:0 8px 32px #000c;' +
    'display:flex;flex-direction:column;gap:14px;min-width:260px;font-family:inherit;color:#e0e8ff';

  const inpCSS =
    'background:#161630;border:1px solid #3344aa;border-radius:4px;' +
    'color:#e0e8ff;font-size:13px;padding:6px 10px;outline:none;width:100%;box-sizing:border-box';

  // ── Section A: Go to Measure ──────────────────────────────────────────────
  const measTitle = document.createElement('div');
  measTitle.textContent = 'Go to Measure';
  measTitle.style.cssText = 'font-size:13px;font-weight:bold;color:#aabbff;letter-spacing:0.04em';

  const measRow = document.createElement('div');
  measRow.style.cssText = 'display:flex;gap:8px;align-items:center';
  const measInput = document.createElement('input');
  measInput.type = 'number'; measInput.min = '1'; measInput.placeholder = 'Measure (1-based)';
  measInput.style.cssText = inpCSS;
  const measOk = document.createElement('button');
  measOk.textContent = 'Go';
  measOk.style.cssText =
    'background:#2233aa;color:#e0e8ff;border:1px solid #3344cc;border-radius:4px;' +
    'padding:6px 14px;cursor:pointer;font-size:12px;white-space:nowrap';
  measRow.append(measInput, measOk);

  const totalMeasures = renderer?.totalCols() * renderer?.measPerCol ?? '?';
  const measHint = document.createElement('div');
  measHint.style.cssText = 'font-size:9px;color:#445;margin-top:-8px';
  measHint.textContent = `Chart has ~${Math.ceil(chart?.totalTicks?.() / TICKS_PER_MEASURE ?? 0)} measures`;

  // ── Divider ───────────────────────────────────────────────────────────────
  const divider = document.createElement('div');
  divider.style.cssText = 'border-top:1px solid #1a1a3a;margin:0 -4px';

  // ── Section B: Go to Beat ─────────────────────────────────────────────────
  const beatTitle = document.createElement('div');
  beatTitle.textContent = 'Or go to Beat';
  beatTitle.style.cssText = 'font-size:11px;font-weight:bold;color:#8899cc;letter-spacing:0.04em';

  const beatRow = document.createElement('div');
  beatRow.style.cssText = 'display:flex;gap:8px;align-items:center';
  const beatInput = document.createElement('input');
  beatInput.type = 'number'; beatInput.min = '1'; beatInput.placeholder = 'Beat (1-based)';
  beatInput.style.cssText = inpCSS.replace('font-size:13px', 'font-size:12px');
  const beatOk = document.createElement('button');
  beatOk.textContent = 'Go';
  beatOk.style.cssText =
    'background:#1a2a66;color:#aabbff;border:1px solid #2a3a88;border-radius:4px;' +
    'padding:5px 12px;cursor:pointer;font-size:12px;white-space:nowrap';
  beatRow.append(beatInput, beatOk);

  const totalBeats = Math.ceil((chart?.totalTicks?.() ?? 0) / TICKS_PER_BEAT);
  const beatHint = document.createElement('div');
  beatHint.style.cssText = 'font-size:9px;color:#445;margin-top:-8px';
  beatHint.textContent = `Chart has ~${totalBeats} beats  ·  4 beats = 1 measure`;

  // ── Cancel row ────────────────────────────────────────────────────────────
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText =
    'background:#161630;color:#778;border:1px solid #2a2a55;border-radius:4px;' +
    'padding:5px 12px;cursor:pointer;font-size:12px;align-self:flex-end';

  // ── Overlay ───────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99998';

  const closeAll = () => { overlay.remove(); modal.remove(); };

  // ── Event handlers ────────────────────────────────────────────────────────
  const doMeasure = () => {
    const mNum = parseFloat(measInput.value);
    if (!isNaN(mNum) && mNum >= 1) jumpToTick(Math.round((mNum - 1) * TICKS_PER_MEASURE));
    closeAll();
  };
  const doBeat = () => {
    const bNum = parseFloat(beatInput.value);
    if (!isNaN(bNum) && bNum >= 1) jumpToTick(Math.round((bNum - 1) * TICKS_PER_BEAT));
    closeAll();
  };

  measOk.addEventListener('click', doMeasure);
  beatOk.addEventListener('click', doBeat);
  cancelBtn.addEventListener('click', closeAll);
  overlay.addEventListener('click', closeAll);

  measInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); doMeasure(); }
    if (ev.key === 'Escape') { ev.preventDefault(); closeAll(); }
    if (ev.key === 'Tab')    { ev.preventDefault(); beatInput.focus(); }
  });
  beatInput.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); doBeat(); }
    if (ev.key === 'Escape') { ev.preventDefault(); closeAll(); }
  });

  modal.append(measTitle, measRow, measHint, divider, beatTitle, beatRow, beatHint, cancelBtn);
  document.body.appendChild(overlay);
  document.body.appendChild(modal);
  setTimeout(() => measInput.focus(), 10);
}

function syncSnapUI() {
  document.getElementById('snap-select').value = snap;
  const entry = SNAP_ENTRIES.find(e => Math.abs(e.v - snap) < 0.001);
  document.getElementById('status-tool').textContent = `Tool: ${tool}  Snap: ${entry?.l ?? snap}`;
  // Update context palette snap display (dock.js)
  if (typeof updateSnapDisplay === 'function') updateSnapDisplay(entry?.l ?? String(snap));
}

function adjustZoom(delta) {
  const slider = document.getElementById('zoom-slider');
  slider.value = Math.max(+slider.min, Math.min(+slider.max, +slider.value + delta));
  renderer.zoom = +slider.value / 100 * 1.2;
  document.getElementById('zoom-label').textContent = slider.value + '%';
  renderer.resize();
  render();
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────
// saveUndo is defined later (history-panel aware version)
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(serialize()));
  const snap = undoStack.pop();
  historyCurrentIdx = Math.max(0, historyCurrentIdx - 1);
  deserialize(JSON.parse(snap));
  refreshHistoryPanel();
  render();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(serialize()));
  const snap = redoStack.pop();
  historyCurrentIdx = Math.min(historyEntries.length - 1, historyCurrentIdx + 1);
  deserialize(JSON.parse(snap));
  refreshHistoryPanel();
  render();
}
function serialize() {
  return {
    bt: chart.bt.map(l => l.map(n => ({...n}))),
    fx: chart.fx.map(l => l.map(n => ({...n}))),
    lasers: JSON.parse(JSON.stringify(chart.lasers)),
    bpmEvents: chart.bpmEvents.map(e => ({...e})),
    timeSigEvents: chart.timeSigEvents.map(e => ({...e})),
    fxChains: JSON.parse(JSON.stringify(chart.fxChains)),
    cameraEvents: JSON.parse(JSON.stringify(chart.cameraEvents ?? [])),
    stopEvents:   JSON.parse(JSON.stringify(chart.stopEvents   ?? [])),
  };
}
function deserialize(d) {
  chart.bt = d.bt.map(l => l.map(n => ({...n})));
  chart.fx = d.fx.map(l => l.map(n => ({...n})));
  chart.lasers = JSON.parse(JSON.stringify(d.lasers));
  chart.bpmEvents = d.bpmEvents.map(e => ({...e}));
  chart.timeSigEvents = d.timeSigEvents.map(e => ({...e}));
  chart.fxChains = JSON.parse(JSON.stringify(d.fxChains));
  // Restore camera & stop events if they were saved (legacy snapshots won't have them)
  if (d.cameraEvents) chart.cameraEvents = JSON.parse(JSON.stringify(d.cameraEvents));
  if (d.stopEvents)   chart.stopEvents   = JSON.parse(JSON.stringify(d.stopEvents));
  updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList(); renderFxChain(0); renderFxChain(1);
}

// ── Metadata sync ─────────────────────────────────────────────────────────────
function autoDetectMeasures() {
  let maxTick = 0;
  for (let li = 0; li < 4; li++) for (const n of chart.bt[li]) maxTick = Math.max(maxTick, n.y + n.len);
  for (let li = 0; li < 2; li++) for (const n of chart.fx[li]) maxTick = Math.max(maxTick, n.y + n.len);
  for (let s = 0; s < 2; s++) for (const sec of chart.lasers[s]) {
    const last = sec.points[sec.points.length - 1];
    if (last) maxTick = Math.max(maxTick, sec.y + last.ry);
  }
  for (const ev of chart.bpmEvents) maxTick = Math.max(maxTick, ev.y);
  chart.totalMeasures = Math.max(8, Math.ceil(maxTick / TICKS_PER_MEASURE) + 2);
  const el = document.getElementById('meta-measures-display');
  if (el) el.textContent = chart.totalMeasures;
  return chart.totalMeasures;
}

function syncMetaToChart() {
  const m = chart.meta;
  m.title   = document.getElementById('meta-title').value;
  m.artist  = document.getElementById('meta-artist').value;
  m.effect  = document.getElementById('meta-effect').value;
  m.illust  = document.getElementById('meta-illust').value;
  m.difficulty = document.getElementById('meta-diff').value;
  m.level   = +document.getElementById('meta-level').value;
  m.bpm     = +document.getElementById('meta-bpm').value;
  m.music   = document.getElementById('meta-music').value;
  m.offset  = +document.getElementById('meta-offset').value;
  m.previewStart    = +document.getElementById('meta-preview-start').value;
  m.previewDuration = +document.getElementById('meta-preview-dur').value;
  m.jacket  = document.getElementById('meta-jacket').value;
  m.bg      = document.getElementById('meta-bg').value;
  m.layer   = document.getElementById('meta-layer').value;
  autoDetectMeasures();
  chart.laserSettings.filter = document.getElementById('laser-filter').value;
  chart.laserSettings.gain   = +document.getElementById('laser-gain').value;
  chart.laserSettings.wide   = document.getElementById('laser-wide').checked;
  if (chart.bpmEvents[0]?.y === 0) chart.bpmEvents[0].bpm = m.bpm;
  updateBpmList();
}

function pushMeta() {
  const m = chart.meta;
  document.getElementById('meta-title').value  = m.title;
  document.getElementById('meta-artist').value = m.artist;
  document.getElementById('meta-effect').value = m.effect;
  document.getElementById('meta-illust').value = m.illust;
  document.getElementById('meta-diff').value   = m.difficulty;
  document.getElementById('meta-level').value  = m.level;
  document.getElementById('meta-bpm').value    = m.bpm;
  document.getElementById('meta-music').value  = m.music;
  document.getElementById('meta-offset').value = m.offset;
  document.getElementById('meta-preview-start').value = m.previewStart;
  document.getElementById('meta-preview-dur').value   = m.previewDuration;
  document.getElementById('meta-jacket').value = m.jacket;
  document.getElementById('meta-bg').value     = m.bg;
  document.getElementById('meta-layer').value  = m.layer || '';
  autoDetectMeasures();
  document.getElementById('laser-filter').value  = chart.laserSettings.filter;
  document.getElementById('laser-gain').value    = chart.laserSettings.gain;
  document.getElementById('laser-wide').checked  = chart.laserSettings.wide;
}

// ── Song Metadata popup ────────────────────────────────────────────────────────
function openSongMetaModal() {
  const m = chart.meta;
  document.getElementById('sm-title').value  = m.title;
  document.getElementById('sm-artist').value = m.artist;
  document.getElementById('sm-effect').value = m.effect;
  document.getElementById('sm-illust').value = m.illust;
  document.getElementById('sm-diff').value   = m.difficulty;
  document.getElementById('sm-level').value  = m.level;
  document.getElementById('sm-bpm').value    = m.bpm;
  document.getElementById('sm-music').value  = m.music;
  document.getElementById('sm-offset').value = m.offset;
  document.getElementById('sm-preview-start').value = m.previewStart;
  document.getElementById('sm-preview-dur').value   = m.previewDuration;
  document.getElementById('sm-jacket').value = m.jacket;
  document.getElementById('sm-bg').value     = m.bg;
  document.getElementById('sm-layer').value  = m.layer || '';
  // Show jacket preview if available
  const img = document.getElementById('meta-jacket-img-modal');
  const ph  = document.getElementById('meta-jacket-placeholder');
  const srcImg = document.getElementById('jacket-preview');
  if (srcImg && srcImg.src && srcImg.src !== window.location.href) {
    img.src = srcImg.src; img.style.display = 'block'; ph.style.display = 'none';
  } else { img.style.display = 'none'; ph.style.display = 'flex'; }
  document.getElementById('modal-song-meta').style.display = 'flex';
}

function saveSongMetaModal() {
  const m = chart.meta;
  m.title  = document.getElementById('sm-title').value;
  m.artist = document.getElementById('sm-artist').value;
  m.effect = document.getElementById('sm-effect').value;
  m.illust = document.getElementById('sm-illust').value;
  m.difficulty = document.getElementById('sm-diff').value;
  m.level  = +document.getElementById('sm-level').value;
  m.bpm    = +document.getElementById('sm-bpm').value;
  m.music  = document.getElementById('sm-music').value;
  m.offset = +document.getElementById('sm-offset').value;
  m.previewStart    = +document.getElementById('sm-preview-start').value;
  m.previewDuration = +document.getElementById('sm-preview-dur').value;
  m.jacket = document.getElementById('sm-jacket').value;
  m.bg     = document.getElementById('sm-bg').value;
  m.layer  = document.getElementById('sm-layer').value;
  // Only update the tick-0 BPM event if the value actually changed, to avoid
  // accidentally corrupting a tempo map that has diverged from the header BPM.
  const newBpm = +document.getElementById('sm-bpm').value;
  if (chart.bpmEvents[0]?.y === 0 && chart.bpmEvents[0].bpm !== newBpm) {
    chart.bpmEvents[0].bpm = newBpm;
    updateBpmList();
  }
  pushMeta(); // sync back to left panel
  saveUndo('Updated song metadata');
  document.getElementById('modal-song-meta').style.display = 'none';
  render();
}

// ── BPM / TimeSig event lists ─────────────────────────────────────────────────
function updateBpmList() {
  const list = document.getElementById('bpm-event-list');
  list.innerHTML = '';
  chart.bpmEvents.forEach(ev => {
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((ev.y % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.innerHTML = `<span>M${m} B${b}: <b>${ev.bpm}</b></span><button class="ev-del" data-y="${ev.y}">✕</button>`;
    row.querySelector('.ev-del').addEventListener('click', de => {
      const y = +de.target.dataset.y;
      if (y === 0) return;
      saveUndo(`Deleted BPM at M${Math.floor(y/TICKS_PER_MEASURE)+1}`); chart.bpmEvents = chart.bpmEvents.filter(e => e.y !== y);
      updateBpmList(); render();
    });
    list.appendChild(row);
  });
}

function updateTimeSigList() {
  const list = document.getElementById('timesig-event-list');
  list.innerHTML = '';
  chart.timeSigEvents.forEach(ev => {
    const row = document.createElement('div');
    row.className = 'ev-row';
    row.innerHTML = `<span>M${ev.measure + 1}: <b>${ev.num}/${ev.den}</b></span><button class="ev-del" data-m="${ev.measure}">✕</button>`;
    row.querySelector('.ev-del').addEventListener('click', de => {
      const m = +de.target.dataset.m;
      if (m === 0) return;
      saveUndo(`Deleted Time Signature at M${m+1}`); chart.timeSigEvents = chart.timeSigEvents.filter(e => e.measure !== m);
      updateTimeSigList();
    });
    list.appendChild(row);
  });
}

function updateCameraEventList() {
  const list = document.getElementById('camera-event-list');
  if (!list) return;
  list.innerHTML = '';
  const evs = chart.cameraEvents ?? [];
  const CAM_COLORS = {
    zoom_top: '#00ffaa', zoom_bottom: '#00ccff', zoom_side: '#ffcc00',
    tilt: '#ff8844', center_split: '#cc88ff', lane_toggle: '#ff4466',
  };
  evs.forEach((ev, idx) => {
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const b = Math.floor((ev.y % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;
    const pill = document.createElement('div');
    pill.className = 'cam-ev-pill';
    const col = CAM_COLORS[ev.type] ?? '#aaaaaa';
    pill.innerHTML = `<span style="color:${col};font-weight:bold">${ev.type}</span> <span style="color:#888">M${m}B${b}</span> <span style="color:#ddf">${ev.value}</span><span class="cam-ev-del" data-idx="${idx}">✕</span>`;
    pill.querySelector('.cam-ev-del').addEventListener('click', () => {
      saveUndo('Deleted camera event');
      chart.cameraEvents.splice(idx, 1);
      updateCameraEventList();
      render();
    });
    list.appendChild(pill);
  });
}

// ── Camera-pill hover popup ───────────────────────────────────────────────────

const _CAM_POPUP_COLORS = {
  zoom_top: '#00ffaa', zoom_bottom: '#00ccff', zoom_side: '#ffcc00',
  tilt: '#ff8844', center_split: '#cc88ff', lane_toggle: '#ff4466',
};
const _CAM_POPUP_LABELS = {
  zoom_top: 'Zoom Top', zoom_bottom: 'Zoom Bottom', zoom_side: 'Zoom Side',
  tilt: 'Tilt', center_split: 'Center Split', lane_toggle: 'Lane Toggle',
};
// Slider ranges per camera type
const _CAM_RANGES = {
  zoom_top:     { min: -300, max: 300, step: 5  },
  zoom_bottom:  { min: -300, max: 300, step: 5  },
  zoom_side:    { min: -300, max: 300, step: 5  },
  tilt:         { min: -3,   max: 3,   step: 0.05 },
  center_split: { min: -300, max: 300, step: 5  },
  lane_toggle:  null,  // boolean — handled separately
};

// Find which camera pill (if any) is under canvas-relative coords (cx, cy).
// Returns the first matching hit zone or null.
function _findCamPillAt(cx, cy) {
  if (!renderer?._camPillHitZones?.length) return null;
  for (const z of renderer._camPillHitZones) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

// Build and display the hover popup for all camera events at `tick`.
// Positioned near (clientX, clientY) in viewport space.
function _showCamPopup(tick, clientX, clientY) {
  const pop = document.getElementById('cam-hover-popup');
  if (!pop) return;

  const eventsAtTick = (chart?.cameraEvents ?? [])
    .map((ev, i) => ({ ev, i }))
    .filter(({ ev }) => ev.y === tick);
  if (!eventsAtTick.length) { pop.style.display = 'none'; return; }

  const m = Math.floor(tick / TICKS_PER_MEASURE) + 1;
  const b = Math.floor((tick % TICKS_PER_MEASURE) / TICKS_PER_BEAT) + 1;

  let html = `<div class="cam-pop-header">M${m} &mdash; beat ${b}<button class="cam-pop-close" title="Close">✕</button></div>`;

  for (const { ev, i } of eventsAtTick) {
    const col    = _CAM_POPUP_COLORS[ev.type] ?? '#aaa';
    const label  = _CAM_POPUP_LABELS[ev.type] ?? ev.type;
    const range  = _CAM_RANGES[ev.type];
    const numVal = parseFloat(ev.value);
    const isNum  = !isNaN(numVal) && range !== null;

    html += `<div class="cam-pop-row">`;
    html += `<div class="cam-pop-title"><span class="cam-pop-dot" style="background:${col}"></span>`;
    html += `<span class="cam-pop-label" style="color:${col}">${label}</span></div>`;

    if (range === null) {
      // Boolean toggle (lane_toggle)
      const on = ev.value !== '0' && ev.value !== '';
      html += `<div class="cam-pop-ctrl">`;
      html += `<button class="cam-pop-toggle${on ? ' active' : ''}" data-idx="${i}">${on ? 'ON' : 'OFF'}</button>`;
      html += `</div>`;
    } else {
      // Numeric: slider + number input
      const curVal = isNum ? numVal : 0;
      html += `<div class="cam-pop-ctrl">`;
      html += `<span class="cam-pop-range-min">${range.min}</span>`;
      html += `<input type="range" class="cam-pop-slider" data-idx="${i}"
                 min="${range.min}" max="${range.max}" step="${range.step}"
                 value="${curVal}" style="--col:${col}">`;
      html += `<span class="cam-pop-range-max">${range.max}</span>`;
      html += `<input type="number" class="cam-pop-num" data-idx="${i}"
                 min="${range.min}" max="${range.max}" step="${range.step}"
                 value="${curVal}">`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  pop.innerHTML = html;

  // ── Wire up controls ──────────────────────────────────────────────────────
  const _syncAndRender = (idx, val) => {
    const v = Math.max(
      _CAM_RANGES[chart.cameraEvents[idx]?.type]?.min ?? -300,
      Math.min(_CAM_RANGES[chart.cameraEvents[idx]?.type]?.max ?? 300, parseFloat(val) || 0)
    );
    chart.cameraEvents[idx].value = String(v);
    // Sync sibling controls
    pop.querySelectorAll(`[data-idx="${idx}"]`).forEach(el => {
      if (el !== document.activeElement) el.value = v;
    });
    updateCameraEventList();
    render();
  };

  pop.querySelectorAll('.cam-pop-slider').forEach(sl => {
    sl.addEventListener('input', () => _syncAndRender(+sl.dataset.idx, sl.value));
  });
  pop.querySelectorAll('.cam-pop-num').forEach(ni => {
    ni.addEventListener('input', () => _syncAndRender(+ni.dataset.idx, ni.value));
  });
  pop.querySelectorAll('.cam-pop-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const cur = chart.cameraEvents[idx].value;
      chart.cameraEvents[idx].value = (cur === '0' || cur === '') ? '1' : '0';
      btn.textContent = chart.cameraEvents[idx].value === '0' ? 'OFF' : 'ON';
      btn.classList.toggle('active', chart.cameraEvents[idx].value !== '0');
      updateCameraEventList(); render();
    });
  });

  // ── Position popup near cursor, keeping it fully on-screen ───────────────
  pop.style.display = 'block';
  const pr = pop.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let px = clientX + 16, py = clientY - 8;
  if (px + pr.width  > vw - 6) px = clientX - pr.width - 12;
  if (py + pr.height > vh - 6) py = Math.max(4, clientY - pr.height);
  pop.style.left = px + 'px';
  pop.style.top  = py + 'px';
}

function _hideCamPopup() {
  const pop = document.getElementById('cam-hover-popup');
  if (pop) pop.style.display = 'none';
}

// ── FX hold click popup ───────────────────────────────────────────────────────

function _findFxHoldAt(cx, cy) {
  if (!renderer?._fxHoldHitZones?.length) return null;
  for (const z of renderer._fxHoldHitZones) {
    if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) return z;
  }
  return null;
}

function _showFxPopup(li, clientX, clientY) {
  const pop = document.getElementById('fx-hold-popup');
  if (!pop) return;
  const chain = chart?.fxChains?.[li];
  if (!chain?.length) { pop.style.display = 'none'; return; }

  const laneName = li === 0 ? 'FX-L' : 'FX-R';
  let html = `<div class="cam-pop-header">${laneName} Effect<button class="cam-pop-close" title="Close">✕</button></div>`;

  chain.forEach((inst, idx) => {
    const def = EFFECT_DEFS[inst.type];
    if (!def) return;
    html += `<div class="fx-pop-effect-title">${def.label}</div>`;
    for (const [k, p] of Object.entries(def.params)) {
      const val = inst.params[k] ?? p.def;
      html += `<div class="cam-pop-row">`;
      html += `<div class="cam-pop-title"><span class="cam-pop-label">${p.label}</span></div>`;
      html += `<div class="cam-pop-ctrl">`;
      if (p.min !== undefined) {
        html += `<span class="cam-pop-range-min">${p.min}</span>`;
        html += `<input type="range" class="cam-pop-slider fx-pop-slider" data-chain="${li}" data-idx="${idx}" data-key="${k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">`;
        html += `<span class="cam-pop-range-max">${p.max}</span>`;
        html += `<input type="number" class="cam-pop-num fx-pop-num" data-chain="${li}" data-idx="${idx}" data-key="${k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}">`;
        html += `<span class="fx-pop-unit">${p.unit || ''}</span>`;
      }
      html += `</div></div>`;
    }
  });

  pop.innerHTML = html;

  // Wire sliders and number inputs
  const sync = (li, idx, k, val) => {
    const inst = chart.fxChains[li]?.[idx];
    if (!inst) return;
    const def = EFFECT_DEFS[inst.type];
    const p = def?.params?.[k];
    if (!p) return;
    const v = Math.max(p.min, Math.min(p.max, parseFloat(val) || 0));
    inst.params[k] = v;
    pop.querySelectorAll(`[data-chain="${li}"][data-idx="${idx}"][data-key="${k}"]`)
       .forEach(el => { if (el !== document.activeElement) el.value = v; });
    renderFxChain(li);
  };
  pop.querySelectorAll('.fx-pop-slider').forEach(sl => {
    sl.addEventListener('input', () => sync(+sl.dataset.chain, +sl.dataset.idx, sl.dataset.key, sl.value));
  });
  pop.querySelectorAll('.fx-pop-num').forEach(ni => {
    ni.addEventListener('input', () => sync(+ni.dataset.chain, +ni.dataset.idx, ni.dataset.key, ni.value));
  });
  pop.querySelector('.cam-pop-close')?.addEventListener('click', () => {
    _fxPopupFixedLane = null;
    _hideFxPopup();
    if (renderer) { renderer._hoveredFxHold = null; render(); }
  });

  // Position popup near cursor, keeping it fully on-screen
  pop.style.display = 'block';
  const pr = pop.getBoundingClientRect();
  let px = clientX + 16, py = clientY - 8;
  if (px + pr.width  > window.innerWidth  - 6) px = clientX - pr.width - 12;
  if (py + pr.height > window.innerHeight - 6) py = Math.max(4, clientY - pr.height);
  pop.style.left = px + 'px'; pop.style.top = py + 'px';
}

function _hideFxPopup() {
  const pop = document.getElementById('fx-hold-popup');
  if (pop) pop.style.display = 'none';
}

function updateStopEventList() {
  const list = document.getElementById('stop-event-list');
  if (!list) return;
  list.innerHTML = '';
  const evs = chart.stopEvents ?? [];
  evs.forEach((ev, idx) => {
    const m = Math.floor(ev.y / TICKS_PER_MEASURE) + 1;
    const pill = document.createElement('div');
    pill.className = 'stop-ev-pill';
    pill.innerHTML = `<span>M${m}</span> <span style="color:#ffaaaa">${ev.len}t</span><span class="stop-ev-del" data-idx="${idx}">✕</span>`;
    pill.querySelector('.stop-ev-del').addEventListener('click', () => {
      saveUndo('Deleted stop event');
      chart.stopEvents.splice(idx, 1);
      updateStopEventList();
      render();
    });
    list.appendChild(pill);
  });
}

// ── FX Chain UI ───────────────────────────────────────────────────────────────
function renderFxChain(side) {
  const id = side === 0 ? 'fx-chain-l' : 'fx-chain-r';
  const el = document.getElementById(id);
  el.innerHTML = '';
  chart.fxChains[side].forEach((inst, idx) => {
    const def = EFFECT_DEFS[inst.type];
    if (!def) return;
    const slot = document.createElement('div');
    slot.className = 'fx-slot';
    const hdr = document.createElement('div');
    hdr.className = 'fx-slot-header';
    const led = document.createElement('div');
    led.className = 'fx-led' + (inst.enabled ? '' : ' off');
    led.addEventListener('click', ev => { ev.stopPropagation(); inst.enabled = !inst.enabled; led.className = 'fx-led' + (inst.enabled ? '' : ' off'); });
    const name = document.createElement('span');
    name.className = 'fx-name'; name.textContent = def.label;
    const rm = document.createElement('button');
    rm.className = 'fx-remove'; rm.textContent = '✕';
    rm.addEventListener('click', ev => { ev.stopPropagation(); saveUndo('Removed FX Effect'); chart.fxChains[side].splice(idx, 1); renderFxChain(side); });
    hdr.append(led, name, rm);
    const params = document.createElement('div');
    params.className = 'fx-params';
    for (const [k, p] of Object.entries(def.params)) {
      const row = document.createElement('div'); row.className = 'fx-param-row';
      const lbl = document.createElement('label'); lbl.textContent = p.label;
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = p.min; slider.max = p.max; slider.step = p.step; slider.value = inst.params[k] ?? p.def;
      const val = document.createElement('span'); val.textContent = slider.value + (p.unit || '');
      slider.addEventListener('input', () => { inst.params[k] = +slider.value; val.textContent = slider.value + (p.unit || ''); });
      row.append(lbl, slider, val); params.appendChild(row);
    }
    hdr.addEventListener('click', () => params.classList.toggle('open'));
    slot.append(hdr, params); el.appendChild(slot);
  });
}

// downloadText is defined in ksh.js

// ── History Panel ─────────────────────────────────────────────────────────────
// Each entry: { label, snapshot (JSON string) }
const historyEntries = [];
let historyCurrentIdx = -1; // index into historyEntries of current state

function saveUndo(label = null) {
  const snap = JSON.stringify(serialize());
  const m = Math.floor((renderer?.playTick ?? 0) / TICKS_PER_MEASURE) + 1;
  const entry = { label: label ?? `Edit @ M${m}`, snap };
  // Prune any "future" entries (redos) when a new action is taken
  historyEntries.splice(historyCurrentIdx + 1);
  historyEntries.push(entry);
  if (historyEntries.length > MAX_UNDO) historyEntries.shift();
  historyCurrentIdx = historyEntries.length - 1;
  // Keep legacy stacks in sync for undo/redo
  undoStack.push(snap);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  refreshHistoryPanel();
  _scheduleAutosave(); // queue a background autosave after each edit
}

function initHistoryPanel() {
  const panel = document.getElementById('history-panel');
  if (!panel) return;

  // Make draggable by header
  const hdr = panel.querySelector('.float-panel-header');
  let _dx = 0, _dy = 0, _dragging = false;
  hdr.addEventListener('mousedown', ev => {
    if (ev.target.closest('button, input, select')) return;
    _dragging = true;
    _dx = ev.clientX - panel.offsetLeft;
    _dy = ev.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', ev => {
    if (!_dragging) return;
    panel.style.left = (ev.clientX - _dx) + 'px';
    panel.style.top  = (ev.clientY - _dy) + 'px';
    panel.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { _dragging = false; });

  // Close button
  document.getElementById('history-panel-close')?.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Tab switching
  panel.querySelectorAll('.fpanel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.fpanel-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      document.getElementById('fpanel-history').style.display   = which === 'history'   ? '' : 'none';
      document.getElementById('fpanel-split-opts').style.display = which === 'split-opts' ? '' : 'none';
    });
  });

  // Window menu buttons
  document.getElementById('btn-gameplay-panel')?.addEventListener('click', () => {
    if (typeof toggleGameplayPanel === 'function') toggleGameplayPanel();
  });
  document.getElementById('btn-tools-window')?.addEventListener('click', () => {
    if (typeof dockToggle === 'function') dockToggle('tools-hub');
    else if (typeof openToolsWindow === 'function') openToolsWindow();
  });
  document.getElementById('btn-radar-window')?.addEventListener('click', () => {
    if (typeof openRadarWindow === 'function') openRadarWindow();
  });
  document.getElementById('btn-handsim-window')?.addEventListener('click', () => {
    if (typeof openHandSimWindow === 'function') openHandSimWindow();
  });
  document.getElementById('btn-history-panel')?.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('btn-split-opts')?.addEventListener('click', () => {
    panel.style.display = 'flex';
    // Switch to split-opts tab
    panel.querySelectorAll('.fpanel-tab').forEach(t => t.classList.remove('active'));
    panel.querySelector('[data-tab="split-opts"]')?.classList.add('active');
    document.getElementById('fpanel-history').style.display    = 'none';
    document.getElementById('fpanel-split-opts').style.display = '';
  });

  // Split view option controls
  const laneSlider = document.getElementById('split-lane-count');
  const laneLabel  = document.getElementById('split-lane-label');
  laneSlider?.addEventListener('input', () => {
    laneLabel.textContent = laneSlider.value + ' lanes';
    // split-lane-count is "measures per column" — convert to beats and apply
    if (renderer) {
      renderer.measPerCol = Math.max(1, +laneSlider.value);
      applyBeatsPerLane(renderer.beatsPerCol);
    }
  });

  const widthSlider = document.getElementById('split-edit-width');
  const widthLabel  = document.getElementById('split-edit-width-label');
  widthSlider?.addEventListener('input', () => {
    widthLabel.textContent = widthSlider.value + '%';
    const main = document.getElementById('main');
    const gameWrap = document.getElementById('game-wrap');
    if (main && gameWrap && viewMode === 'split') {
      main.style.flex    = widthSlider.value;
      gameWrap.style.flex = (100 - +widthSlider.value) + '';
    }
  });

  refreshHistoryPanel();
}

function refreshHistoryPanel() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '';
  if (!historyEntries.length) {
    list.innerHTML = '<div style="padding:12px;font-size:11px;color:#5558a0;text-align:center">No history yet</div>';
    return;
  }
  historyEntries.forEach((entry, i) => {
    const div = document.createElement('div');
    div.className = 'history-entry' +
      (i === historyCurrentIdx ? ' current' : '') +
      (i >  historyCurrentIdx ? ' future'  : '');
    div.innerHTML = `<span class="history-entry-idx">${i + 1}</span>
      <span class="history-entry-icon">${i === historyCurrentIdx ? '▶' : '○'}</span>
      <span>${entry.label}</span>`;
    div.addEventListener('click', () => jumpHistory(i));
    list.appendChild(div);
  });
  // Scroll current into view
  list.querySelectorAll('.history-entry.current')[0]?.scrollIntoView({ block: 'nearest' });
}

function jumpHistory(idx) {
  if (idx < 0 || idx >= historyEntries.length) return;
  historyCurrentIdx = idx;
  deserialize(JSON.parse(historyEntries[idx].snap));
  render();
  refreshHistoryPanel();
}

// ── Preferences ───────────────────────────────────────────────────────────────
// Global rendering quality flag — read by renderer.js and game.js at draw time.
// true  = full glow/shadow effects (GPU-heavy)
// false = flat rendering, no shadowBlur (fast, accurate for flat preview)
let highQualityRendering = true;

const prefs = {
  // Audio
  audioDelay:       0,      // ms — global audio offset for monitor latency
  tickEnabled:      true,   // tick sounds on by default
  volMaster:        0.85,   // master bus
  volMusic:         0.80,   // song track
  volSlam:          0.28,   // laser slam scratch sound
  volTick:          0.22,   // BT/FX hit tick
  // Video
  videoDelay:       0,      // ms — display offset
  fpsCap:           60,
  highQuality:      true,
  showLaserDir:     true,
  showLaserDots:    false,
  // General
  language:         'en',
  // Gameplay
  autoplay:         true,   // game preview auto-plays score chain
  slamThreshold:    12,     // LASER_SLAM_TICKS (≤1/16 note by default)
  defaultSnap:      8,      // default snap divisor
  // Autosave / history
  autosaveInterval: 60,
  savePath:         'Downloads',
  historyDepth:     100,
};
let _autosaveTimer = null;

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem('vibe-editr-prefs') || '{}');
    Object.assign(prefs, saved);
  } catch(e) {}
  applyPreferences();

  // ── Wire preferences modal ───────────────────────────────────────────────
  document.getElementById('btn-preferences')?.addEventListener('click', openPreferences);
  document.getElementById('pref-save')?.addEventListener('click', savePreferences);
  document.getElementById('pref-cancel')?.addEventListener('click', () => {
    document.getElementById('modal-prefs').style.display = 'none';
  });

  // Tab switching in System Preferences
  document.querySelectorAll('.sysprefs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sysprefs-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sysprefs-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pref-tab-' + btn.dataset.tab)?.classList.add('active');
    });
  });

  // Live-update labels for prefs sliders
  const _liveSlider = (id, lblId, fmt) => {
    const sl = document.getElementById(id);
    const lb = document.getElementById(lblId);
    if (!sl || !lb) return;
    sl.addEventListener('input', () => { lb.textContent = fmt(+sl.value); });
  };
  _liveSlider('pref-vol-master',        'pref-vol-master-label',        v => Math.round(v*100) + '%');
  _liveSlider('pref-vol-music',         'pref-vol-music-label',         v => Math.round(v*100) + '%');
  _liveSlider('pref-vol-slam',          'pref-vol-slam-label',          v => Math.round(v*100) + '%');
  _liveSlider('pref-vol-tick',          'pref-vol-tick-label',          v => Math.round(v*100) + '%');
  _liveSlider('pref-slam-threshold',    'pref-slam-threshold-label',    v => v + ' ticks');
  _liveSlider('pref-laser-opacity',     'pref-laser-opacity-label',     v => v + '%');

  // Reset to defaults button
  document.getElementById('btn-reset-prefs-defaults')?.addEventListener('click', _resetPrefsDefaults);

  // Live language switch — apply translations immediately when the user picks a language
  document.getElementById('pref-language')?.addEventListener('change', e => {
    if (typeof applyLocalization === 'function') applyLocalization(e.target.value);
  });
}

function openPreferences() {
  // ── Audio ──────────────────────────────────────────────
  _setEl('pref-audio-delay',  prefs.audioDelay);
  _setChk('pref-tick-enabled', prefs.tickEnabled !== false);
  _setVol('pref-vol-master', prefs.volMaster, 'pref-vol-master-label');
  _setVol('pref-vol-music',  prefs.volMusic,  'pref-vol-music-label');
  _setVol('pref-vol-slam',   prefs.volSlam,   'pref-vol-slam-label');
  _setVol('pref-vol-tick',   prefs.volTick,   'pref-vol-tick-label');
  // ── Video ──────────────────────────────────────────────
  _setEl('pref-video-delay',       prefs.videoDelay);
  _setEl('pref-fps-cap',           prefs.fpsCap);
  _setChk('pref-high-quality',     prefs.highQuality !== false);
  _setChk('pref-show-laser-dir',   prefs.showLaserDir !== false);
  _setChk('pref-show-laser-dots',  !!prefs.showLaserDots);
  const opSl  = document.getElementById('pref-laser-opacity');
  const opLbl = document.getElementById('pref-laser-opacity-label');
  if (opSl)  opSl.value = Math.round(laserOpacity * 100);
  if (opLbl) opLbl.textContent = Math.round(laserOpacity * 100) + '%';
  _setEl('pref-laser-color-l', laserColors.L);
  _setEl('pref-laser-color-r', laserColors.R);
  const swL = document.getElementById('lcp-swatch-l');
  const swR = document.getElementById('lcp-swatch-r');
  if (swL) swL.style.background = laserColors.L;
  if (swR) swR.style.background = laserColors.R;
  // ── General ────────────────────────────────────────────
  _setEl('pref-language', prefs.language || 'en');
  // ── Gameplay ───────────────────────────────────────────
  _setChk('pref-autoplay', prefs.autoplay !== false);
  const stSl  = document.getElementById('pref-slam-threshold');
  const stLbl = document.getElementById('pref-slam-threshold-label');
  if (stSl)  { stSl.value = prefs.slamThreshold; }
  if (stLbl) { stLbl.textContent = prefs.slamThreshold + ' ticks'; }
  _setEl('pref-default-snap', prefs.defaultSnap);
  // ── Autosave ───────────────────────────────────────────
  _setEl('pref-autosave-interval', prefs.autosaveInterval);
  _setEl('pref-save-path',         prefs.savePath);
  _setEl('pref-history-depth',     prefs.historyDepth);

  document.getElementById('modal-prefs').style.display = 'flex';
}

function savePreferences() {
  // ── Audio ──────────────────────────────────────────────
  prefs.audioDelay   = +(_el('pref-audio-delay')?.value  ?? 0);
  prefs.tickEnabled  = !!_chk('pref-tick-enabled');
  prefs.volMaster    = +(_el('pref-vol-master')?.value    ?? 1);
  prefs.volMusic     = +(_el('pref-vol-music')?.value     ?? 1);
  prefs.volSlam      = +(_el('pref-vol-slam')?.value      ?? 0.5);
  prefs.volTick      = +(_el('pref-vol-tick')?.value      ?? 0.5);
  // ── Video ──────────────────────────────────────────────
  prefs.videoDelay   = +(_el('pref-video-delay')?.value   ?? 0);
  prefs.fpsCap       = +(_el('pref-fps-cap')?.value       ?? 60);
  prefs.highQuality  = !!_chk('pref-high-quality');
  prefs.showLaserDir = !!_chk('pref-show-laser-dir');
  prefs.showLaserDots = !!_chk('pref-show-laser-dots');
  // ── General ────────────────────────────────────────────
  prefs.language     = _el('pref-language')?.value || 'en';
  // ── Gameplay ───────────────────────────────────────────
  prefs.autoplay      = !!_chk('pref-autoplay');
  prefs.slamThreshold = +(_el('pref-slam-threshold')?.value ?? 6);
  prefs.defaultSnap   = +(_el('pref-default-snap')?.value   ?? 8);
  // ── Autosave ───────────────────────────────────────────
  prefs.autosaveInterval = +(_el('pref-autosave-interval')?.value ?? 60);
  prefs.savePath         =   _el('pref-save-path')?.value         ?? 'Downloads';
  prefs.historyDepth     = +(_el('pref-history-depth')?.value     ?? 100);

  localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs));
  applyPreferences();
  document.getElementById('modal-prefs').style.display = 'none';
}

// ── Tiny DOM helpers used by prefs ───────────────────────────────────────────
const _el  = id => document.getElementById(id);
const _chk = id => document.getElementById(id)?.checked;
const _setEl  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
const _setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
const _setVol = (id, v, lblId) => {
  const el = document.getElementById(id);
  if (el) { el.value = v; }
  const lb = document.getElementById(lblId);
  if (lb) lb.textContent = Math.round(v * 100) + '%';
};

function _resetPrefsDefaults() {
  if (!confirm('Reset all preferences to factory defaults?')) return;
  Object.assign(prefs, {
    audioDelay: 0, tickEnabled: true, volMaster: 1, volMusic: 1, volSlam: 0.5, volTick: 0.5,
    videoDelay: 0, fpsCap: 60, highQuality: true, showLaserDir: true, showLaserDots: false,
    language: 'en', autoplay: true, slamThreshold: 12, defaultSnap: 8,
    autosaveInterval: 60, savePath: 'Downloads', historyDepth: 100,
  });
  localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs));
  applyPreferences();
  openPreferences(); // re-populate UI
}

function applyPreferences() {
  MAX_UNDO = prefs.historyDepth;
  highQualityRendering = prefs.highQuality !== false;

  // Slam threshold (1–16 ticks)
  LASER_SLAM_TICKS = prefs.slamThreshold ?? 6;

  // Tick sound enabled gate (used by detectFxHits/detectBtHits via settings.tickSound)
  settings.tickSound = !!prefs.tickEnabled;
  const stEl = document.getElementById('setting-tick');
  if (stEl) stEl.checked = settings.tickSound;

  // Volume nodes
  if (masterGainNode) masterGainNode.gain.value = prefs.volMaster ?? 1.0;
  if (musicGainNode)  musicGainNode.gain.value  = prefs.volMusic  ?? 1.0;
  if (slamGainNode)   slamGainNode.gain.value   = prefs.volSlam   ?? 0.5;
  if (tickGainNode)   tickGainNode.gain.value   = prefs.volTick   ?? 0.5;

  // Sync menu volume sliders with prefs
  const _syncSidebar = (id, lblId, v) => {
    const sl = document.getElementById(id);
    const lb = document.getElementById(lblId);
    if (sl) sl.value = v;
    if (lb) lb.textContent = Math.round(v * 100) + '%';
  };
  _syncSidebar('vol-master', 'vol-master-label', prefs.volMaster ?? 1);
  _syncSidebar('vol-music',  'vol-music-label',  prefs.volMusic  ?? 1);
  _syncSidebar('vol-slam',   'vol-slam-label',   prefs.volSlam   ?? 0.5);
  _syncSidebar('vol-tick',   'vol-tick-label',   prefs.volTick   ?? 0.5);

  // Show laser anchor dots in 2D editor always
  if (renderer) renderer.showLaserDots = prefs.showLaserDots ?? false;

  // Default snap divisor — apply to global snap variable
  // 4 → 1/4 (48 ticks), 8 → 1/8 (24), 16 → 1/16 (12), 32 → 1/32 (6)
  const snapMap = { 4: 48, 8: 24, 16: 12, 32: 6 };
  if (typeof snap !== 'undefined' && snapMap[prefs.defaultSnap]) {
    snap = snapMap[prefs.defaultSnap];
    if (typeof syncSnapUI === 'function') try { syncSnapUI(); } catch(_) {}
  }

  // Autosave
  if (_autosaveTimer) clearInterval(_autosaveTimer);
  if (prefs.autosaveInterval > 0) {
    _autosaveTimer = setInterval(() => _idbAutosave(), prefs.autosaveInterval * 1000);
  }

  // Localization
  if (typeof applyLocalization === 'function') applyLocalization(prefs.language || 'en');
}

// ── IndexedDB autosave ────────────────────────────────────────────────────────
let _idb = null;

function _openIDB() {
  if (_idb && _idb.objectStoreNames.contains('autosave')) return Promise.resolve(_idb);
  return new Promise((res, rej) => {
    // Use version 2 to ensure fresh object store creation if needed
    const req = indexedDB.open('vibe-editr', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('autosave')) {
        db.createObjectStore('autosave');
      }
    };
    req.onsuccess = e => { _idb = e.target.result; res(_idb); };
    req.onerror   = e => { console.warn('IDB open failed:', e.target.error); rej(e.target.error); };
    req.onblocked = () => { console.warn('IDB blocked — close other tabs'); };
  });
}

// Properly await the IDB put transaction
function _idbPut(db, key, data) {
  return new Promise((res, rej) => {
    const tx  = db.transaction('autosave', 'readwrite');
    const req = tx.objectStore('autosave').put(data, key);
    tx.oncomplete = () => res();
    tx.onerror    = e  => rej(e.target.error);
    tx.onabort    = e  => rej(e.target.error);
  });
}

function _idbGet(db, key) {
  return new Promise((res, rej) => {
    const tx  = db.transaction('autosave', 'readonly');
    const req = tx.objectStore('autosave').get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror   = e  => rej(e.target.error);
  });
}

async function _idbAutosave() {
  // Never stall the audio/RAF thread during playback — defer to after stop
  if (playing) {
    _pendingAutosaveAfterPlay = true;
    return;
  }
  try {
    // Yield to the browser first so the main thread isn't blocked during frame rendering.
    // exportKsh is synchronous and can take 10-30ms on large charts.
    const ksh = await new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(exportKsh(chart)), { timeout: 3000 });
      } else {
        setTimeout(() => resolve(exportKsh(chart)), 0);
      }
    });
    const db   = await _openIDB();
    const data = {
      ksh,
      title:      chart.meta.title || 'Untitled',
      audioName:  chart.meta.music || null,
      ts:         Date.now(),
    };
    await _idbPut(db, 'latest', data);
    // Also persist the raw audio bytes so they survive a page reload
    if (audioArrayBuffer) {
      await _idbPut(db, 'audio', audioArrayBuffer.slice(0)).catch(() => {});
    }
    // Flash status bar
    const st = document.getElementById('audio-status');
    if (st) {
      const prev = st.textContent;
      st.textContent = '✔ Autosaved';
      setTimeout(() => { if (st.textContent === '✔ Autosaved') st.textContent = prev; }, 2000);
    }
  } catch(e) { console.warn('Autosave failed:', e); }
}

async function _idbRestore() {
  try {
    const db = await _openIDB();
    return await _idbGet(db, 'latest');
  } catch(e) { console.warn('Restore failed:', e); return null; }
}

// Debounced autosave — called on every saveUndo (max once per 10s)
let _autosaveDebounce = null;
function _scheduleAutosave() {
  if (_autosaveDebounce) clearTimeout(_autosaveDebounce);
  _autosaveDebounce = setTimeout(() => { _autosaveDebounce = null; _idbAutosave(); }, 10000);
}

// Recover last autosave (File menu / Preferences button)
async function recoverAutosave() {
  const data = await _idbRestore();
  if (!data) {
    alert('No autosave found.\n\nAutosaves happen automatically after each edit (10-second debounce) and periodically via the interval in Preferences.');
    return;
  }
  const ago  = Math.round((Date.now() - data.ts) / 60000);
  const when = ago < 1 ? 'just now' : `${ago} minute${ago === 1 ? '' : 's'} ago`;
  if (!confirm(`Restore autosave of "${data.title}"\nSaved: ${when}\n\nThis will replace the current chart. Continue?`)) return;
  try {
    chart = importKsh(data.ksh);
    tabs[activeTabIdx].chart = chart;
    if (renderer) renderer.chart = chart;
    if (gameView) gameView.chart = chart;
    pushMeta(); updateBpmList(); updateTimeSigList(); updateCameraEventList(); updateStopEventList();
    renderFxChain(0); renderFxChain(1); render();
    saveUndo('Restored Autosave');

    // Attempt to restore audio from IDB
    try {
      const db = await _openIDB();
      const savedAudio = await _idbGet(db, 'audio');
      if (savedAudio && data.audioName) {
        ensureAudioCtx();
        audioArrayBuffer = savedAudio;
        audioBuffer = await audioCtx.decodeAudioData(savedAudio.slice(0));
        tabs[activeTabIdx].audioBuffer = audioBuffer;
        document.getElementById('audio-status').textContent = `Audio: ${data.audioName} (restored)`;
      }
    } catch(audioErr) {
      console.warn('Could not restore autosaved audio:', audioErr);
    }
  } catch(e) { alert('Could not restore autosave:\n' + e.message); }
}

// ── Game edit overlay wiring ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('geo-exit')?.addEventListener('click', disableGameEditMode);
  document.querySelectorAll('.geo-tool[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.geo-tool[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setTool(btn.dataset.tool);
    });
  });

  // Game canvas click-to-place in edit mode
  const gameCanvas = document.getElementById('game-canvas');
  gameCanvas?.addEventListener('mousedown', ev => {
    if (!_gameEditMode || ev.button !== 0) return;
    const p = gameView?._params();
    if (!p) return;
    // Convert screen Y → tick offset
    const rect = gameCanvas.getBoundingClientRect();
    const sy = ev.clientY - rect.top;
    const prog = Math.max(0, Math.min(1, (sy - p.vanishY) / (p.judgeY - p.vanishY)));
    const dt = gameView.VISIBLE_TICKS * (1 - prog);
    const tick = Math.round((gameView.playTick + dt) / 12) * 12;
    // Convert screen X → lane
    const sx = ev.clientX - rect.left;
    const hw = gameView._halfW(sy, p);
    const norm = (sx - (p.cx - hw)) / (hw * 2);
    const laneIdx = Math.min(3, Math.max(0, Math.floor(norm * 4)));
    const _pLabel = tool === 'bt' ? 'Added BT note' : tool === 'fx' ? 'Added FX note' : 'Erased';
    saveUndo(`${_pLabel} at M${Math.floor(tick/TICKS_PER_MEASURE)+1} (Preview)`);
    if (tool === 'bt')    chart.addBtNote(laneIdx, tick, 0);
    else if (tool === 'fx') chart.addFxNote(laneIdx <= 1 ? 0 : 1, tick, 0);
    else if (tool === 'erase') eraseAt(laneIdx, tick);
    render();
    if (gameView) gameView.draw();
  });
});

// ── Session persistence ───────────────────────────────────────────────────────
const SESSION_KEY = 'vibe-editr-session';

function _saveSession() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      zoom:      renderer?.zoom ?? 0.75,
      scrollCol: renderer?.scrollCol ?? 0,
      playTick:  renderer?.playTick ?? 0,
      viewMode,
      laserOpacity,
      laserWideMode,
      laserPreset: _currentLaserPreset,
      laserColorL: laserColors.L,
      laserColorR: laserColors.R,
    }));
  } catch(e) {}
}

let _currentLaserPreset = 'sdvx-default';

function _restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    if (s.zoom && renderer)      renderer.zoom      = s.zoom;
    if (s.scrollCol && renderer) renderer.scrollCol = s.scrollCol;
    if (s.playTick && renderer)  renderer.playTick  = s.playTick;
    if (s.viewMode) setTimeout(() => setViewMode(s.viewMode), 0);
    if (typeof s.laserOpacity === 'number') {
      laserOpacity = s.laserOpacity;
      const sl = document.getElementById('pref-laser-opacity');
      if (sl) sl.value = Math.round(s.laserOpacity * 100);
    }
    if (typeof s.laserWideMode === 'boolean') {
      laserWideMode = s.laserWideMode;
      const cb = document.getElementById('laser-wide');
      if (cb) cb.checked = s.laserWideMode;
    }
    if (s.laserPreset) {
      _currentLaserPreset = s.laserPreset;
      applyLaserPreset(s.laserPreset);
    }
    if (s.laserColorL) setLaserColorCustom(0, s.laserColorL);
    if (s.laserColorR) setLaserColorCustom(1, s.laserColorR);
  } catch(e) {}
}

// Save session periodically and on unload
window.addEventListener('beforeunload', _saveSession);
setInterval(_saveSession, 30000);

// ── Laser appearance wiring ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Opacity slider
  const opSl = document.getElementById('pref-laser-opacity');
  if (opSl) {
    opSl.value = Math.round(laserOpacity * 100);
    opSl.addEventListener('input', () => {
      laserOpacity = +opSl.value / 100;
      const lbl = document.getElementById('pref-laser-opacity-label');
      if (lbl) lbl.textContent = opSl.value + '%';
      render();
    });
  }

  // Wide laser checkboxes — Settings menu + View menu stay in sync
  const _syncWideCheckboxes = (checked) => {
    laserWideMode = checked;
    const cbA = document.getElementById('laser-wide');
    const cbB = document.getElementById('laser-wide-view');
    if (cbA) cbA.checked = checked;
    if (cbB) cbB.checked = checked;
    render();
  };
  document.getElementById('laser-wide')?.addEventListener('change', e => _syncWideCheckboxes(e.target.checked));
  document.getElementById('laser-wide-view')?.addEventListener('change', e => _syncWideCheckboxes(e.target.checked));

  // Recover autosave from File menu
  document.getElementById('btn-recover-autosave-file')?.addEventListener('click', recoverAutosave);

  // Color preset buttons
  document.querySelectorAll('[data-laser-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      _currentLaserPreset = btn.dataset.laserPreset;
      applyLaserPreset(_currentLaserPreset);
      // Sync custom pickers to new preset
      const p = LASER_PRESETS[_currentLaserPreset];
      if (p) {
        const cl = document.getElementById('pref-laser-color-l');
        const cr = document.getElementById('pref-laser-color-r');
        if (cl) cl.value = p.L;
        if (cr) cr.value = p.R;
      }
      render();
    });
  });

  // Custom color pickers — sync swatch circle on change
  const _syncSwatch = (side, hex) => {
    const el = document.getElementById(`lcp-swatch-${side}`);
    if (el) el.style.background = hex;
  };
  document.getElementById('pref-laser-color-l')?.addEventListener('input', e => {
    setLaserColorCustom(0, e.target.value);
    _syncSwatch('l', e.target.value);
    _currentLaserPreset = 'custom';
    render();
  });
  document.getElementById('pref-laser-color-r')?.addEventListener('input', e => {
    setLaserColorCustom(1, e.target.value);
    _syncSwatch('r', e.target.value);
    _currentLaserPreset = 'custom';
    render();
  });

  // Quick-pick R/B/G/Y buttons (per laser side)
  document.querySelectorAll('.lcp-q').forEach(btn => {
    btn.addEventListener('click', () => {
      const side  = btn.dataset.side;   // 'l' or 'r'
      const hex   = btn.dataset.color;
      const input = document.getElementById(`pref-laser-color-${side}`);
      if (input) input.value = hex;
      if (side === 'l') { setLaserColorCustom(0, hex); _syncSwatch('l', hex); }
      else              { setLaserColorCustom(1, hex); _syncSwatch('r', hex); }
      _currentLaserPreset = 'custom';
      render();
    });
  });

  // Recover autosave button
  document.getElementById('btn-recover-autosave')?.addEventListener('click', recoverAutosave);

  // ── Preview projection controls (in game-wrap panel) ──────────────────────
  _initProjectionControls();
});

function _initProjectionControls() {
  // Projection mode buttons
  document.querySelectorAll('.pvc-proj-btn[data-proj]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.proj;
      if (!gameView) return;
      gameView.projMode = mode;
      // Update active state
      document.querySelectorAll('.pvc-proj-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Intensity slider only meaningful in sdvx/hybrid modes
      const intRow = document.getElementById('pvc-intensity')?.closest('.pvc-section');
      if (intRow) intRow.style.opacity = mode === 'ortho' ? '0.4' : '1';
      if (gameView) gameView.draw();
      _saveSession();
    });
  });

  // Perspective intensity slider
  const intSl  = document.getElementById('pvc-intensity');
  const intLbl = document.getElementById('pvc-intensity-label');
  intSl?.addEventListener('input', () => {
    if (gameView) gameView.perspIntensity = +intSl.value;
    if (intLbl) intLbl.textContent = intSl.value;
    if (gameView) gameView.draw();
  });

  // HiSpeed slider — purely visual lane-scroll density; does NOT affect playback timing.
  // chartSpeed was previously misused here to also control the fallback timer; now decoupled.
  const hsSl  = document.getElementById('pvc-hispeed');
  const hsLbl = document.getElementById('pvc-hispeed-label');
  hsSl?.addEventListener('input', () => {
    const hs = +hsSl.value;
    if (hsLbl) hsLbl.textContent = hs.toFixed(1) + '×';
    // Mirror to the top-menu label only (no chartSpeed mutation — timing is independent)
    const topSl  = document.getElementById('chart-speed');
    const topLbl = document.getElementById('chart-speed-label');
    if (topSl)  topSl.value  = hs;
    if (topLbl) topLbl.textContent = hs.toFixed(2) + '×';
    // Apply exclusively to the game view's visual rendering pipeline
    if (gameView) { gameView.hispeed = hs; gameView.draw(); }
  });

  // BT Width slider (wired here so it's near the other preview controls)
  const bwSl  = document.getElementById('pvc-bt-width');
  const bwLbl = document.getElementById('pvc-bt-width-label');
  if (bwSl && !bwSl._wired) {
    bwSl._wired = true;
    bwSl.addEventListener('input', () => {
      const bw = +bwSl.value;
      if (bwLbl) bwLbl.textContent = bw.toFixed(2) + '×';
      if (gameView) { gameView.btWidthScale = bw; if (!playing) gameView.draw(); }
    });
  }

  // Judge Y slider
  const jySl  = document.getElementById('pvc-judge-y');
  const jyLbl = document.getElementById('pvc-judge-y-label');
  if (jySl && !jySl._wired) {
    jySl._wired = true;
    jySl.addEventListener('input', () => {
      const jy = +jySl.value;
      if (jyLbl) jyLbl.textContent = Math.round(jy * 100) + '%';
      if (gameView) { gameView.judgeYFrac = jy; gameView._paramDirty = true; if (!playing) gameView.draw(); }
    });
  }

  // Game canvas drag to reposition judgment line
  const gc = document.getElementById('game-canvas');
  if (gc && !gc._judgeYDragWired) {
    gc._judgeYDragWired = true;
    let _jyDragging = false;
    gc.addEventListener('mousedown', e => {
      if (!gameView || e.button !== 0) return;
      if (typeof _gameEditMode !== 'undefined' && _gameEditMode) return; // don't hijack game-edit clicks
      const p = gameView._params();
      if (Math.abs(e.offsetY - p.judgeY) < 12) {
        _jyDragging = true;
        e.preventDefault();
      }
    });
    gc.addEventListener('mousemove', e => {
      if (!_jyDragging || !gameView) return;
      const frac = Math.max(0.40, Math.min(0.90, e.offsetY / gc.height));
      gameView.judgeYFrac = frac;
      gameView._paramDirty = true;
      if (jySl)  jySl.value = frac;
      if (jyLbl) jyLbl.textContent = Math.round(frac * 100) + '%';
      if (!playing) gameView.draw();
    });
    const stopJyDrag = () => { _jyDragging = false; };
    gc.addEventListener('mouseup', stopJyDrag);
    gc.addEventListener('mouseleave', stopJyDrag);
    // Cursor: show ns-resize near judge line (only when not in game-edit mode)
    gc.addEventListener('mousemove', e => {
      if (!gameView) return;
      if (typeof _gameEditMode !== 'undefined' && _gameEditMode) return;
      const p = gameView._params();
      gc.style.cursor = Math.abs(e.offsetY - p.judgeY) < 12 ? 'ns-resize' : '';
    });
  }

  // Save Config button — persists current projection, hispeed, BT width and Judge Y to prefs
  document.getElementById('pvc-save-config')?.addEventListener('click', () => {
    if (!gameView) return;
    // Projection mode
    const activeProj = document.querySelector('.pvc-proj-btn.active');
    if (activeProj) prefs.projMode = activeProj.dataset.proj;
    // Perspective intensity
    const intEl = document.getElementById('pvc-intensity');
    if (intEl) prefs.perspIntensity = +intEl.value;
    // HiSpeed
    const hsEl = document.getElementById('pvc-hispeed');
    if (hsEl) prefs.hispeed = +hsEl.value;
    // BT Width
    const bwEl = document.getElementById('pvc-bt-width');
    if (bwEl) prefs.btWidthScale = +bwEl.value;
    // Judge Y
    const jyEl = document.getElementById('pvc-judge-y');
    if (jyEl) prefs.judgeYFrac = +jyEl.value;
    // Persist
    try { localStorage.setItem('vibe-editr-prefs', JSON.stringify(prefs)); } catch(_) {}
    // Show "Saved!" flash
    const lbl = document.getElementById('pvc-save-config-label');
    if (lbl) {
      lbl.style.opacity = '1';
      setTimeout(() => { lbl.style.opacity = '0'; }, 1600);
    }
  });

  // Restore saved preview config on load
  if (prefs.projMode) {
    const btn = document.querySelector(`.pvc-proj-btn[data-proj="${prefs.projMode}"]`);
    if (btn) btn.click();
  }
  if (prefs.perspIntensity != null) {
    const el = document.getElementById('pvc-intensity');
    const lb = document.getElementById('pvc-intensity-label');
    if (el) { el.value = prefs.perspIntensity; if (gameView) gameView.perspIntensity = prefs.perspIntensity; }
    if (lb) lb.textContent = String(prefs.perspIntensity);
  }
  if (prefs.hispeed != null) {
    const el = document.getElementById('pvc-hispeed');
    const lb = document.getElementById('pvc-hispeed-label');
    if (el) { el.value = prefs.hispeed; if (gameView) gameView.hispeed = prefs.hispeed; }
    if (lb) lb.textContent = prefs.hispeed.toFixed(1) + '×';
  }
  if (prefs.btWidthScale != null) {
    const el = document.getElementById('pvc-bt-width');
    const lb = document.getElementById('pvc-bt-width-label');
    if (el) { el.value = prefs.btWidthScale; if (gameView) gameView.btWidthScale = prefs.btWidthScale; }
    if (lb) lb.textContent = prefs.btWidthScale.toFixed(2) + '×';
  }
  if (prefs.judgeYFrac != null) {
    const el = document.getElementById('pvc-judge-y');
    const lb = document.getElementById('pvc-judge-y-label');
    if (el) { el.value = prefs.judgeYFrac; if (gameView) gameView.judgeYFrac = prefs.judgeYFrac; }
    if (lb) lb.textContent = Math.round(prefs.judgeYFrac * 100) + '%';
  }

  // Set default projection to SDVX on load (only if no saved proj mode)
  if (!prefs.projMode) document.querySelector('.pvc-proj-btn[data-proj="sdvx"]')?.click();
}

// ── Donation modal ────────────────────────────────────────────────────────────
(function initDonate() {
  const PREF_KEY = 'vibe_editr_donate_no_prompt';
  const PROMPT_DELAY_MS = 8 * 60 * 1000; // 8 minutes

  const modal   = document.getElementById('modal-donate');
  const btnOpen = document.getElementById('btn-donate');
  const btnClose= document.getElementById('donate-close');
  const cbNoPrompt = document.getElementById('donate-no-prompt');

  function openModal() {
    if (!modal) return;
    modal.style.display = 'flex';
  }
  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    if (cbNoPrompt?.checked) {
      try { localStorage.setItem(PREF_KEY, '1'); } catch(_) {}
    }
  }

  btnOpen?.addEventListener('click', openModal);
  btnClose?.addEventListener('click', closeModal);

  // Close on backdrop click
  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  // Auto-prompt after delay (skip if user opted out)
  function maybePrompt() {
    try { if (localStorage.getItem(PREF_KEY)) return; } catch(_) {}
    const btn = document.getElementById('btn-donate');
    if (btn) {
      btn.classList.add('donate-pulse');
      setTimeout(() => btn.classList.remove('donate-pulse'), 7000);
    }
    // Show the modal automatically after the delay
    setTimeout(openModal, 500); // brief pause after pulse starts
  }
  setTimeout(maybePrompt, PROMPT_DELAY_MS);
})();

// ── Dock Manager integration ──────────────────────────────────────────────────
// Register all major panels with the dock system after both dock.js and
// tools.js have loaded and initialized their DOM elements.
window.addEventListener('DOMContentLoaded', () => {
  // Give tools.js time to finish building its window, then register panels.
  // (tools.js calls initTools() at end of file which appends .tw-window to body)
  setTimeout(() => {
    if (typeof dockRegister !== 'function') return;

    // ── Register dockable panels ────────────────────────────────────────────

    // Tools Hub — nativeFloat:true tells the dock to use display:flex (not block)
    // since .tw-window is a flex column. CSS in style.css strips position:fixed
    // and the panel's own chrome when it's inside dp-float or a dock region.
    const toolsWin = document.querySelector('.tw-window');
    if (toolsWin) {
      dockRegister('tools-hub', toolsWin, 'Tools Hub', '🔧', 'float', { nativeFloat: true, floatW: 640, floatH: 460 });
    }

    // Right dock: FX Chain + Events + Shortcuts
    const fxPanel = document.getElementById('panel-fx');
    if (fxPanel) {
      fxPanel.style.width = fxPanel.style.minWidth = fxPanel.style.maxWidth = '';
      dockRegister('fx-panel', fxPanel, 'FX & Events', '⚡', 'right');
    }

    // Apply the full layout (from localStorage, or use each panel's defaultRegion)
    if (typeof dockApplyLayout === 'function') dockApplyLayout();

    // Initialise context palette with the current tool
    if (typeof updateContextPalette === 'function') updateContextPalette(tool || 'select');

    // Sync snap display
    if (typeof syncSnapUI === 'function') syncSnapUI();
  }, 150);
});

// ── Visual Calibration Window ─────────────────────────────────────────────────
// Metronome circle that blinks + plays metro_A (beat 1) / metro_B (beats 2-4).
// The user adjusts Audio/Video delay until blink and click are in sync.

(function initVisualCalib() {
  const modal    = document.getElementById('modal-visual-calib');
  const btnOpen  = document.getElementById('pref-open-visual-calib');
  const btnSave  = document.getElementById('vc-save');
  const btnCancel= document.getElementById('vc-cancel');
  const vcCanvas = document.getElementById('vc-canvas');
  const bpmInput = document.getElementById('vc-bpm');
  const audInput = document.getElementById('vc-audio-delay');
  const vidInput = document.getElementById('vc-video-delay');
  if (!modal || !vcCanvas) return;

  const ctx2 = vcCanvas.getContext('2d');
  const W = vcCanvas.width, H = vcCanvas.height;

  // ── Audio ──────────────────────────────────────────────────────────────────
  let _vcAcCtx    = null;   // own AudioContext so it can't be blocked by the main one
  let _metroA     = null;   // AudioBuffer for beat 1
  let _metroB     = null;   // AudioBuffer for beats 2-4
  let _loadedBufs = false;

  async function _ensureAudio() {
    if (_loadedBufs) return;
    if (!_vcAcCtx) _vcAcCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    if (_vcAcCtx.state === 'suspended') await _vcAcCtx.resume();
    const load = async url => {
      const res = await fetch(url);
      const ab  = await res.arrayBuffer();
      return _vcAcCtx.decodeAudioData(ab);
    };
    try {
      [_metroA, _metroB] = await Promise.all([load('sounds/metro_A.mp3'), load('sounds/metro_B.mp3')]);
      _loadedBufs = true;
    } catch(e) {
      console.warn('[VisualCalib] Could not load metro sounds:', e);
    }
  }

  function _fireClick(isDownbeat, acTime) {
    if (!_vcAcCtx) return;
    const buf = isDownbeat ? _metroA : _metroB;
    if (!buf) return;
    const src = _vcAcCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_vcAcCtx.destination);
    src.start(acTime);
  }

  // ── Scheduler ──────────────────────────────────────────────────────────────
  // We schedule audio slightly ahead (LOOKAHEAD_S) so clicks never glitch.
  // The visual blink is driven by performance.now() and is kept in sync with
  // _scheduleStart (the performance.now() timestamp when beat-0 fired).
  const LOOKAHEAD_S = 0.08; // seconds of audio lookahead
  let _schedStart   = null; // performance.now() of beat-0 (set on open / tap)
  let _nextBeat     = 0;    // index of next beat to schedule (0-based, mod 4 = measure position)
  let _schedTimer   = null;

  function _bpm()    { return Math.max(40, Math.min(400, +bpmInput.value || 120)); }
  function _beatMs() { return 60000 / _bpm(); }

  function _resetScheduler() {
    if (_schedTimer) { clearInterval(_schedTimer); _schedTimer = null; }
    _schedStart = performance.now();
    _nextBeat   = 0;
    // Immediately fire beat-0 (downbeat)
    if (_vcAcCtx) {
      if (_vcAcCtx.state === 'suspended') _vcAcCtx.resume();
      _fireClick(true, _vcAcCtx.currentTime);
    }
    // Schedule ahead every LOOKAHEAD_S / 2
    _schedTimer = setInterval(_scheduleTick, (LOOKAHEAD_S / 2) * 1000);
    _scheduleTick(); // fill the first window immediately
  }

  function _scheduleTick() {
    if (!_vcAcCtx || _schedStart === null) return;
    const beatMs  = _beatMs();
    const acNow   = _vcAcCtx.currentTime;
    const perfNow = performance.now();

    // How far ahead to schedule (in ms)
    const windowMs = LOOKAHEAD_S * 1000;

    while (true) {
      // performance.now() of next beat
      const beatPerfMs = _schedStart + _nextBeat * beatMs;
      // Already more than LOOKAHEAD ahead of now? Stop for this tick
      if (beatPerfMs > perfNow + windowMs) break;
      // Skip beats already in the past (can happen after a tab wake-up)
      if (beatPerfMs < perfNow - beatMs) { _nextBeat++; continue; }

      // Map performance.now() → AudioContext time
      const acFire = acNow + (beatPerfMs - perfNow) / 1000;
      if (acFire >= acNow - 0.005) {            // don't fire into the past
        const isDown = (_nextBeat % 4) === 0;   // beat 1 of each group of 4
        _fireClick(isDown, Math.max(acNow, acFire));
      }
      _nextBeat++;
    }
  }

  function _stopScheduler() {
    if (_schedTimer) { clearInterval(_schedTimer); _schedTimer = null; }
    _schedStart = null;
    _nextBeat   = 0;
  }

  // ── Tap measurement ────────────────────────────────────────────────────────
  // Each Space tap records how far off the user is from the nearest beat.
  // Positive offset = they tapped AFTER the flash (audio feels late to them).
  // We collect up to 8 taps and apply the rolling average to audInput.
  let _tapOffsets = [];   // ms offsets, positive = late
  let _lastTapT   = null;
  let _avgOffset  = null; // null = not enough taps yet

  const TAP_NEEDED = 3;   // taps before we start correcting
  const TAP_MAX    = 8;   // rolling window size

  function _recordTap() {
    if (_schedStart === null) return;
    const tapT   = performance.now();
    const beatMs = _beatMs();
    const elapsed = tapT - _schedStart;
    // Phase within nearest beat (-beatMs/2 … +beatMs/2)
    let phaseMs = ((elapsed % beatMs) + beatMs) % beatMs;
    if (phaseMs > beatMs / 2) phaseMs -= beatMs;
    // phaseMs > 0 → tapped after beat (audio sounds late) → reduce audio delay
    _tapOffsets.push(phaseMs);
    if (_tapOffsets.length > TAP_MAX) _tapOffsets.shift();
    _lastTapT = tapT;

    if (_tapOffsets.length >= TAP_NEEDED) {
      _avgOffset = _tapOffsets.reduce((a, b) => a + b, 0) / _tapOffsets.length;
      // Apply correction: if tapped late (+), audio is late → subtract from delay
      const correction = -Math.round(_avgOffset);
      const cur = +audInput.value || 0;
      audInput.value = Math.max(-500, Math.min(500, cur + correction));
      // Reset so next batch starts fresh (don't keep compounding)
      _tapOffsets = [];
    }
  }

  // ── Visuals ────────────────────────────────────────────────────────────────
  let _rafId = null;

  function _draw(now) {
    if (_schedStart === null) { _rafId = requestAnimationFrame(_draw); return; }

    const beatMs  = _beatMs();
    const elapsed = now - _schedStart;
    const phase   = ((elapsed % beatMs) + beatMs) % beatMs / beatMs;
    const beatIdx = Math.floor(elapsed / beatMs) % 4;
    const flash   = Math.pow(1 - phase, 2.5);
    const isDown  = beatIdx === 0;

    // Gold for beat 1, blue for 2-4
    const flashR = isDown ? 255 : 80;
    const flashG = isDown ? 210 : 150;
    const flashB = isDown ? 80  : 255;

    ctx2.clearRect(0, 0, W, H);
    ctx2.fillStyle = '#0a0a1a';
    ctx2.fillRect(0, 0, W, H);

    // Outer ring
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, 80, 0, Math.PI * 2);
    ctx2.strokeStyle = '#333366';
    ctx2.lineWidth   = 3;
    ctx2.stroke();

    // Sweep arc
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, 80, -Math.PI/2, -Math.PI/2 + phase * Math.PI * 2);
    ctx2.strokeStyle = isDown ? '#ffcc0088' : '#4488ff88';
    ctx2.lineWidth   = 3;
    ctx2.stroke();

    // Beat pips
    for (let i = 0; i < 4; i++) {
      const ang = -Math.PI/2 + i * Math.PI / 2;
      const px = W/2 + Math.cos(ang) * 80;
      const py = H/2 + Math.sin(ang) * 80;
      ctx2.beginPath();
      ctx2.arc(px, py, i === 0 ? 5 : 3, 0, Math.PI * 2);
      ctx2.fillStyle = i === beatIdx ? (isDown ? '#ffdd44' : '#88aaff') : '#1a1a44';
      ctx2.fill();
    }

    // Main flash circle
    const r = 52 + flash * 12;
    const grd = ctx2.createRadialGradient(W/2, H/2, 0, W/2, H/2, r);
    if (flash > 0.03) {
      grd.addColorStop(0,   `rgba(${flashR},${flashG},${flashB},${0.25 + flash * 0.75})`);
      grd.addColorStop(0.55,`rgba(${flashR},${flashG},${flashB},${0.15 + flash * 0.45})`);
      grd.addColorStop(1,   `rgba(${flashR},${flashG},${flashB},0)`);
    } else {
      grd.addColorStop(0, '#1a1a44'); grd.addColorStop(1, '#0a0a1a');
    }
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, r, 0, Math.PI * 2);
    ctx2.fillStyle = grd; ctx2.fill();

    // Center dot
    ctx2.beginPath();
    ctx2.arc(W/2, H/2, 7 + flash * 5, 0, Math.PI * 2);
    ctx2.fillStyle = flash > 0.03
      ? `rgba(${flashR},${flashG},${flashB},${0.6 + flash * 0.4})` : '#223355';
    ctx2.fill();

    // Beat number
    ctx2.fillStyle    = flash > 0.1 ? `rgba(255,255,255,${flash})` : '#334477';
    ctx2.font         = 'bold 22px monospace';
    ctx2.textAlign    = 'center';
    ctx2.textBaseline = 'middle';
    ctx2.fillText(beatIdx + 1, W/2, H/2);

    // BPM label
    ctx2.fillStyle    = '#5566aa';
    ctx2.font         = 'bold 11px monospace';
    ctx2.textBaseline = 'bottom';
    ctx2.fillText(_bpm() + ' BPM', W/2, H - 10);

    // Tap progress / feedback area (below circle)
    const tapsLeft = TAP_NEEDED - _tapOffsets.length;
    ctx2.textBaseline = 'top';
    ctx2.textAlign    = 'center';
    ctx2.font         = '10px monospace';
    if (_lastTapT !== null) {
      const tapAge = (performance.now() - _lastTapT) / 1000;
      if (tapAge < 2 && _tapOffsets.length === 0) {
        // Just applied a correction — show it
        const corrMs = _avgOffset !== null ? -Math.round(_avgOffset) : 0;
        const sign   = corrMs >= 0 ? '+' : '';
        ctx2.fillStyle = `rgba(100,255,150,${Math.max(0, 1 - tapAge / 2)})`;
        ctx2.fillText(`Applied ${sign}${corrMs} ms → Audio Delay`, W/2, H/2 + 28);
      } else if (_tapOffsets.length > 0) {
        // Collecting — show progress dots
        ctx2.fillStyle = '#88aaff';
        ctx2.fillText(`Tap ${TAP_NEEDED - _tapOffsets.length} more…`, W/2, H/2 + 28);
      }
    } else {
      ctx2.fillStyle = '#445566';
      ctx2.fillText('Press Space on every beat you hear', W/2, H/2 + 28);
    }

    _rafId = requestAnimationFrame(_draw);
  }

  // ── Open / Close ───────────────────────────────────────────────────────────
  async function _open() {
    bpmInput.value = chart?.bpmEvents?.[0]?.bpm?.toFixed(0) ?? 120;
    const saved = JSON.parse(localStorage.getItem('vibe-editr-prefs') || '{}');
    audInput.value = saved.audioDelay ?? (document.getElementById('pref-audio-delay')?.value ?? 0);
    vidInput.value = saved.videoDelay ?? (document.getElementById('pref-video-delay')?.value ?? 0);
    modal.style.display = 'flex';
    _lastTapT  = null;
    _tapOffsets = [];
    _avgOffset  = null;
    await _ensureAudio();
    _resetScheduler();
    if (!_rafId) _rafId = requestAnimationFrame(_draw);
  }

  function _close() {
    modal.style.display = 'none';
    _stopScheduler();
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  }

  function _save() {
    const ad = +audInput.value;
    const vd = +vidInput.value;
    const adEl = document.getElementById('pref-audio-delay');
    const vdEl = document.getElementById('pref-video-delay');
    if (adEl) { adEl.value = ad; adEl.dispatchEvent(new Event('input')); }
    if (vdEl) { vdEl.value = vd; vdEl.dispatchEvent(new Event('input')); }
    _close();
  }

  function _onKey(e) {
    if (!modal || modal.style.display === 'none') return;
    if (e.code === 'Space') {
      e.preventDefault();
      _recordTap();
    }
    if (e.code === 'Escape') _close();
  }

  btnOpen?.addEventListener('click', _open);
  btnSave?.addEventListener('click', _save);
  btnCancel?.addEventListener('click', _close);
  modal.addEventListener('click', e => { if (e.target === modal) _close(); });
  document.addEventListener('keydown', _onKey);
  // Only restart the scheduler when the user finishes editing BPM (blur / Enter)
  bpmInput?.addEventListener('change', () => { if (_schedStart !== null) _resetScheduler(); });
})();
