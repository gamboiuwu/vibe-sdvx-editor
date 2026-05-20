import { TICKS_PER_BEAT, BEATS_PER_MEASURE } from './chart.js';

// ── CalibrationWindow ─────────────────────────────────────────────────────────
// Floating calibration editor: load audio, set Beat 1.0 marker, output offset.
// Usage:
//   calibrationWindow.open(audioBuffer, chart, (markerSec) => { /* apply */ });

export class CalibrationWindow {
  constructor() {
    this._audioBuffer  = null;
    this._chart        = null;
    this._onClose      = null;
    this._totalSec     = 0;

    // Waveform bins
    this._binsMin  = null;
    this._binsMax  = null;
    this._numBins  = 0;

    // View state
    this._pixelsPerSec = 200;
    this._scrollSec    = 0;

    // Markers
    this._calibMarker = null;   // seconds — Beat 1.0 position in audio
    this._loopStart   = null;
    this._loopEnd     = null;
    this._loopEnabled = false;

    // Playback
    this._acCtx       = null;
    this._source      = null;
    this._playing     = false;
    this._startAcTime = 0;
    this._startOff    = 0;
    this._curSec      = 0;

    // Metronome
    this._metronomeEnabled  = false;
    this._metroNextBeatTick = 0;  // next beat to schedule (in chart ticks, tick-0 = calibMarker)

    // Waveform interaction state
    this._spaceHeld     = false; // true while Space is held
    this._spaceDragged  = false; // turned true if mouse dragged while Space held
    this._scrubStartX   = 0;    // cssX where Space+drag started
    this._scrubStartScroll = 0; // scrollSec at drag start
    this._clickTimer    = null; // for single vs double-click discrimination

    // BPM panel state
    this._bpmValue    = 120;    // current working BPM (editable in panel)
    this._bpmDetected = null;   // estimated BPM from auto-detect (awaiting confirmation)
    this._bpmDetecting = false; // true while detection is running

    // Tap tempo state
    this._tapTempoTimes = [];   // performance.now() timestamps of recent taps
    this._tapTempoReset = null; // setTimeout handle — resets tap sequence after inactivity

    // DOM
    this._wrap       = null;
    this._canvas     = null;
    this._ctx2d      = null;
    this._dragMode   = null;
    this._rafId        = null;
    this._keyHandler   = null;
    this._keyUpHandler = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  open(audioBuffer, chart, onClose) {
    if (this._wrap) this._destroy();
    this._audioBuffer  = audioBuffer;
    this._chart        = chart;
    this._onClose      = onClose;
    // Initialize BPM from chart's first BPM event
    this._bpmValue    = chart?.bpmEvents?.[0]?.bpm ?? 120;
    this._bpmDetected = null;
    this._bpmDetecting = false;
    this._tapTempoTimes = [];
    if (this._tapTempoReset) { clearTimeout(this._tapTempoReset); this._tapTempoReset = null; }
    this._totalSec     = audioBuffer.duration;
    this._calibMarker  = null;
    this._loopStart    = null;
    this._loopEnd      = null;
    this._loopEnabled  = false;
    this._playing      = false;
    this._curSec       = 0;
    this._scrollSec    = 0;
    // Default zoom: fit whole track, min 20px/s, max 400px/s
    this._pixelsPerSec = Math.max(20, Math.min(400, 800 / this._totalSec));

    this._buildBins();
    this._createDom();
    this._startRaf();
  }

  // ── Waveform bin builder ───────────────────────────────────────────────────
  _buildBins() {
    const buf   = this._audioBuffer;
    const nCh   = buf.numberOfChannels;
    const nSmp  = buf.length;
    const MAX   = 50000;
    const spb   = Math.max(1, Math.ceil(nSmp / MAX));
    const nBins = Math.ceil(nSmp / spb);

    this._numBins = nBins;
    this._binsMin = new Float32Array(nBins);
    this._binsMax = new Float32Array(nBins);

    const chs = [];
    for (let c = 0; c < nCh; c++) chs.push(buf.getChannelData(c));

    for (let b = 0; b < nBins; b++) {
      const s0 = b * spb;
      const s1 = Math.min(nSmp, s0 + spb);
      let mn = 0, mx = 0;
      for (let i = s0; i < s1; i++) {
        let v = 0;
        for (let c = 0; c < nCh; c++) v += chs[c][i];
        v /= nCh;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      this._binsMin[b] = mn;
      this._binsMax[b] = mx;
    }
  }

  // ── DOM construction ───────────────────────────────────────────────────────
  _createDom() {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;background:rgba(0,0,0,.78);',
      'z-index:9999;display:flex;align-items:center;justify-content:center;',
    ].join('');

    const win = document.createElement('div');
    win.style.cssText = [
      'background:#0e0e1b;border:1px solid #2a2a48;border-radius:8px;',
      'width:min(980px,96vw);display:flex;flex-direction:column;',
      'box-shadow:0 10px 50px rgba(0,0,0,.95);user-select:none;overflow:hidden;',
    ].join('');

    // ── Title bar ───────────────────────────────────────────────────────────
    const titleBar = document.createElement('div');
    titleBar.style.cssText = [
      'display:flex;align-items:center;justify-content:space-between;',
      'padding:8px 14px;background:#13131f;border-bottom:1px solid #2a2a44;',
    ].join('');
    titleBar.innerHTML = `
      <span style="font-weight:700;font-size:13px;color:#00cfff;letter-spacing:.8px">
        ⎍ CALIBRATION MODE
      </span>
      <span style="font-size:11px;color:#6668a0">
        Click waveform → set Beat 1.0 &nbsp;·&nbsp; Alt+drag → loop region &nbsp;·&nbsp; Scroll → zoom
      </span>
    `;

    // ── Transport ───────────────────────────────────────────────────────────
    const transport = document.createElement('div');
    transport.style.cssText = [
      'display:flex;align-items:center;gap:6px;padding:5px 12px;',
      'background:#0b0b18;border-bottom:1px solid #1a1a2e;',
    ].join('');

    const mkBtn = (txt, title, id) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.title = title;
      if (id) b.id = id;
      b.style.cssText = [
        'background:#1a1a2e;border:1px solid #2a2a44;color:#d8d8f0;',
        'padding:3px 9px;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;',
      ].join('');
      return b;
    };

    const bRew   = mkBtn('⏮', 'Rewind to start');
    const bPlay  = mkBtn('▶', 'Play / Pause  [Space]', 'cal-play-btn');
    const bLoop  = mkBtn('⟳', 'Toggle loop region', 'cal-loop-btn');
    const bMetro = mkBtn('♩ Metro', 'Toggle metronome  [M]', 'cal-metro-btn');
    const tDisp  = document.createElement('span');
    tDisp.id = 'cal-time-disp';
    tDisp.style.cssText = 'font-family:monospace;font-size:13px;color:#d8d8f0;min-width:90px;margin-left:8px;';
    tDisp.textContent = '00:00.000';
    const zDisp = document.createElement('span');
    zDisp.id = 'cal-zoom-disp';
    zDisp.style.cssText = 'margin-left:auto;font-size:10px;color:#5558a0;';
    zDisp.textContent = `${this._pixelsPerSec.toFixed(0)} px/s  ·  scroll to zoom`;

    transport.append(bRew, bPlay, bLoop, bMetro, tDisp, zDisp);

    // ── Waveform canvas ─────────────────────────────────────────────────────
    const cwrap = document.createElement('div');
    cwrap.style.cssText = 'position:relative;height:200px;cursor:crosshair;overflow:hidden;flex-shrink:0;';
    const cv = document.createElement('canvas');
    cv.style.cssText = 'width:100%;height:100%;display:block;';
    cwrap.appendChild(cv);
    this._canvas = cv;

    // ── Calibration tools ───────────────────────────────────────────────────
    const ctb = document.createElement('div');
    ctb.style.cssText = [
      'display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
      'padding:8px 12px;background:#0b0b18;border-top:1px solid #1a1a2e;',
    ].join('');

    const mLbl = document.createElement('span');
    mLbl.id = 'cal-marker-lbl';
    mLbl.style.cssText = 'font-size:12px;color:#d8d8f0;white-space:nowrap;';
    mLbl.textContent = 'Beat 1.0: double-click waveform to set';

    const oLbl = document.createElement('span');
    oLbl.id = 'cal-offset-lbl';
    oLbl.style.cssText = 'font-size:12px;color:#00cfff;min-width:90px;white-space:nowrap;';
    oLbl.textContent = 'Offset: —';

    const vsep = () => {
      const s = document.createElement('span');
      s.style.cssText = 'width:1px;height:16px;background:#2a2a44;flex-shrink:0;';
      return s;
    };

    const b10N = mkBtn('−10 ms', '−10 milliseconds');
    const b1N  = mkBtn('−1 ms',  '−1 millisecond');
    const b1P  = mkBtn('+1 ms',  '+1 millisecond');
    const b10P = mkBtn('+10 ms', '+10 milliseconds');

    const oIn = document.createElement('input');
    oIn.type = 'number';
    oIn.id   = 'cal-offset-in';
    oIn.placeholder = 'ms';
    oIn.title = 'Type offset in milliseconds directly';
    oIn.style.cssText = [
      'width:76px;background:#13131f;border:1px solid #2a2a44;',
      'color:#d8d8f0;padding:3px 6px;border-radius:4px;font-size:12px;',
    ].join('');

    const bApply = mkBtn('✓ Apply & Close', 'Apply offset and close');
    bApply.style.cssText += ';margin-left:auto;background:#0c240c;border-color:#39ff14;color:#39ff14;font-weight:600;';
    const bCancel = mkBtn('✕ Cancel', 'Close without applying');
    bCancel.style.cssText += ';border-color:#882244;color:#ff4466;';

    ctb.append(mLbl, vsep(), oLbl, vsep(), b10N, b1N, b1P, b10P, oIn, vsep(), bApply, bCancel);

    // ── BPM Panel ───────────────────────────────────────────────────────────────
    const bpmPanel = document.createElement('div');
    bpmPanel.id = 'cal-bpm-panel';
    bpmPanel.style.cssText = [
      'display:flex;align-items:center;gap:8px;flex-wrap:wrap;',
      'padding:7px 12px;background:#070714;border-top:1px solid #1a1a2e;',
    ].join('');

    const bpmSectionLbl = document.createElement('span');
    bpmSectionLbl.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#ffcc00;';
    bpmSectionLbl.textContent = 'BPM';

    const bpmLbl = document.createElement('span');
    bpmLbl.style.cssText = 'font-size:12px;color:#d8d8f0;white-space:nowrap;';
    bpmLbl.textContent = 'Chart BPM:';

    const bpmInput = document.createElement('input');
    bpmInput.type = 'number';
    bpmInput.id = 'cal-bpm-input';
    bpmInput.min = 30; bpmInput.max = 960; bpmInput.step = 0.5;
    bpmInput.value = this._bpmValue.toFixed(2);
    bpmInput.style.cssText = [
      'width:80px;background:#13131f;border:1px solid #2a2a44;',
      'color:#ffcc00;padding:3px 6px;border-radius:4px;font-size:12px;font-weight:600;',
    ].join('');

    const bpmDetectBtn = mkBtn('🔍 Auto-Detect', 'Analyze waveform to estimate BPM', 'cal-bpm-detect-btn');

    const tapTempoBtn = mkBtn('🥁 Tap Tempo', 'Tap repeatedly (or press T) to measure BPM from your tapping rhythm', 'cal-tap-tempo-btn');

    const tapTempoLbl = document.createElement('span');
    tapTempoLbl.id = 'cal-tap-tempo-lbl';
    tapTempoLbl.style.cssText = 'font-size:11px;color:#aaaaee;min-width:165px;white-space:nowrap;';
    tapTempoLbl.textContent = 'Tap: click to start';

    const bpmSuggestionLbl = document.createElement('span');
    bpmSuggestionLbl.id = 'cal-bpm-suggestion';
    bpmSuggestionLbl.style.cssText = 'font-size:12px;color:#aaffaa;display:none;white-space:nowrap;';

    const bpmConfirmBtn = mkBtn('✓ Apply', 'Apply suggested BPM', 'cal-bpm-confirm-btn');
    bpmConfirmBtn.style.cssText += ';display:none;background:#0a2210;border-color:#39ff14;color:#39ff14;';

    const bpmDismissBtn = mkBtn('✕', 'Dismiss suggestion', 'cal-bpm-dismiss-btn');
    bpmDismissBtn.style.cssText += ';display:none;border-color:#882244;color:#ff4466;';

    const bpmGridNote = document.createElement('span');
    bpmGridNote.style.cssText = 'margin-left:auto;font-size:10px;color:#5558a0;';
    bpmGridNote.textContent = 'BPM controls beat grid spacing';

    bpmPanel.append(bpmSectionLbl, bpmLbl, bpmInput, bpmDetectBtn, vsep(), tapTempoBtn, tapTempoLbl, bpmSuggestionLbl, bpmConfirmBtn, bpmDismissBtn, bpmGridNote);

    win.append(titleBar, transport, cwrap, ctb, bpmPanel);
    overlay.appendChild(win);
    document.body.appendChild(overlay);
    this._wrap = overlay;

    // Initialise canvas dimensions after layout
    requestAnimationFrame(() => {
      const r = cv.getBoundingClientRect();
      cv.width  = Math.round(r.width);
      cv.height = Math.round(r.height);
      this._ctx2d = cv.getContext('2d');
      this._draw();
    });

    // ── Event wiring ─────────────────────────────────────────────────────────
    bRew.addEventListener('click', () => {
      this._stop(); this._curSec = 0; this._scrollSec = 0; this._draw();
    });
    bPlay.addEventListener('click', () => this._togglePlay());
    bLoop.addEventListener('click', () => {
      this._loopEnabled = !this._loopEnabled;
      bLoop.style.color       = this._loopEnabled ? '#39ff14' : '#d8d8f0';
      bLoop.style.borderColor = this._loopEnabled ? '#39ff14' : '#2a2a44';
    });

    bMetro.addEventListener('click', () => {
      this._metronomeEnabled = !this._metronomeEnabled;
      bMetro.style.color       = this._metronomeEnabled ? '#ffcc00' : '#d8d8f0';
      bMetro.style.borderColor = this._metronomeEnabled ? '#ffcc00' : '#2a2a44';
    });

    cv.addEventListener('mousedown',  e => this._wfDown(e));
    cv.addEventListener('mousemove',  e => this._wfMove(e));
    cv.addEventListener('mouseup',    e => this._wfUp(e));
    cv.addEventListener('mouseleave', e => { if (this._dragMode) this._wfUp(e); });
    cv.addEventListener('wheel', e => { e.preventDefault(); this._wfWheel(e); }, { passive: false });
    cv.addEventListener('dblclick',   e => this._wfDblClick(e));

    b10N.addEventListener('click', () => this._nudge(-10));
    b1N.addEventListener('click',  () => this._nudge(-1));
    b1P.addEventListener('click',  () => this._nudge(1));
    b10P.addEventListener('click', () => this._nudge(10));

    oIn.addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v)) {
        this._calibMarker = Math.max(0, Math.min(this._totalSec, v / 1000));
        this._updateLabels(); this._draw();
      }
    });

    bApply.addEventListener('click',  () => this._close(true));
    bCancel.addEventListener('click', () => this._close(false));
    overlay.addEventListener('click', e => { if (e.target === overlay) this._close(false); });

    // Keyboard — capture phase so Space doesn't bubble to main app
    window.addEventListener('keydown', this._keyHandler = e => {
      if (!this._wrap) return;
      if (e.code === 'Space') {
        e.preventDefault(); e.stopPropagation();
        // Space held = enable scrub mode on next mouse drag; release decides play/pause
        this._spaceHeld = true;
      }
      if (e.code === 'Escape') { e.preventDefault(); this._close(false); }
      if (e.code === 'KeyM') {
        e.preventDefault(); e.stopPropagation();
        this._metronomeEnabled = !this._metronomeEnabled;
        const b = document.getElementById('cal-metro-btn');
        if (b) {
          b.style.color       = this._metronomeEnabled ? '#ffcc00' : '#d8d8f0';
          b.style.borderColor = this._metronomeEnabled ? '#ffcc00' : '#2a2a44';
        }
      }
      if (e.code === 'KeyT') {
        e.preventDefault(); e.stopPropagation();
        this._handleTapTempo();
        // Briefly flash the tap button so keyboard use is visually confirmed
        const tb = document.getElementById('cal-tap-tempo-btn');
        if (tb) {
          tb.style.background   = '#1a1a3e';
          tb.style.borderColor  = '#aa88ff';
          tb.style.color        = '#cc99ff';
          setTimeout(() => {
            if (tb) {
              tb.style.background  = '#1a1a2e';
              tb.style.borderColor = '#2a2a44';
              tb.style.color       = '#d8d8f0';
            }
          }, 120);
        }
      }
    }, true);

    window.addEventListener('keyup', this._keyUpHandler = e => {
      if (!this._wrap) return;
      if (e.code === 'Space') {
        e.preventDefault(); e.stopPropagation();
        this._spaceHeld = false;
        if (!this._spaceDragged) {
          // Space released without dragging → treat as play/pause
          this._togglePlay();
        }
        this._spaceDragged = false;
      }
    }, true);

    // BPM manual input — live update beat grid
    bpmInput.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (v >= 30 && v <= 960 && !isNaN(v)) {
        this._bpmValue = v;
        this._draw();
      }
    });
    bpmInput.addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (v >= 30 && v <= 960 && !isNaN(v)) {
        this._bpmValue = v;
        this._draw();
      }
    });

    // Auto-detect button
    bpmDetectBtn.addEventListener('click', () => {
      if (this._bpmDetecting) return;
      this._bpmDetecting = true;
      bpmDetectBtn.textContent = '⏳ Detecting…';
      bpmDetectBtn.disabled = true;
      // Run in next tick to allow UI update
      setTimeout(() => {
        const est = this._autoBpm();
        this._bpmDetecting = false;
        bpmDetectBtn.textContent = '🔍 Auto-Detect';
        bpmDetectBtn.disabled = false;
        if (est !== null) {
          this._bpmDetected = est;
          const sug = document.getElementById('cal-bpm-suggestion');
          const cnf = document.getElementById('cal-bpm-confirm-btn');
          const dsm = document.getElementById('cal-bpm-dismiss-btn');
          if (sug) { sug.textContent = `Detected: ~${est.toFixed(1)} BPM`; sug.style.display = 'inline'; }
          if (cnf) cnf.style.display = 'inline';
          if (dsm) dsm.style.display = 'inline';
        } else {
          const sug = document.getElementById('cal-bpm-suggestion');
          if (sug) { sug.textContent = 'Detection inconclusive — enter BPM manually'; sug.style.display = 'inline'; }
        }
      }, 50);
    });

    // Confirm suggestion
    bpmConfirmBtn.addEventListener('click', () => {
      if (this._bpmDetected !== null) {
        this._bpmValue = this._bpmDetected;
        const inp = document.getElementById('cal-bpm-input');
        if (inp) inp.value = this._bpmDetected.toFixed(2);
      }
      const sug = document.getElementById('cal-bpm-suggestion');
      const cnf = document.getElementById('cal-bpm-confirm-btn');
      const dsm = document.getElementById('cal-bpm-dismiss-btn');
      if (sug) sug.style.display = 'none';
      if (cnf) cnf.style.display = 'none';
      if (dsm) dsm.style.display = 'none';
      this._bpmDetected = null;
      this._draw();
    });

    // Tap Tempo
    tapTempoBtn.addEventListener('click', () => this._handleTapTempo());

    // Dismiss suggestion
    bpmDismissBtn.addEventListener('click', () => {
      this._bpmDetected = null;
      const sug = document.getElementById('cal-bpm-suggestion');
      const cnf = document.getElementById('cal-bpm-confirm-btn');
      const dsm = document.getElementById('cal-bpm-dismiss-btn');
      if (sug) sug.style.display = 'none';
      if (cnf) cnf.style.display = 'none';
      if (dsm) dsm.style.display = 'none';
    });

    this._updateLabels();
  }

  // ── Coordinate helpers ──────────────────────────────────────────────────────
  // _pixelsPerSec is in CSS pixels per second (canvas.width == rect.width assumed).
  _xToSec(cssX)  { return cssX / this._pixelsPerSec + this._scrollSec; }
  _secToX(sec)   { return (sec - this._scrollSec) * this._pixelsPerSec; }
  _cssX(e) {
    const r = this._canvas.getBoundingClientRect();
    return e.clientX - r.left;
  }

  // ── Waveform mouse events (DAW-style) ─────────────────────────────────────
  // • Single click          → move playhead cursor (seek without committing marker)
  // • Double-click          → set Beat 1.0 marker at clicked position
  // • Space + drag          → pan (scrub) the waveform view horizontally
  // • Alt + drag            → define loop region
  // ──────────────────────────────────────────────────────────────────────────

  _wfDown(e) {
    const cssX = this._cssX(e);

    if (this._spaceHeld) {
      // Space+drag = waveform pan/scrub
      this._dragMode        = 'scrub';
      this._scrubStartX     = cssX;
      this._scrubStartScroll = this._scrollSec;
      this._spaceDragged    = false;
      this._draw();
      return;
    }

    if (e.altKey) {
      // Alt+drag = define loop region
      const sec = Math.max(0, Math.min(this._totalSec, this._xToSec(cssX)));
      this._dragMode  = 'loop';
      this._loopStart = sec;
      this._loopEnd   = sec;
      this._draw();
      return;
    }

    // Plain click — will be resolved as cursor-seek on mouseUp (unless double-click follows)
    this._dragMode   = 'seek';
    this._seekStartX = cssX;
  }

  _wfMove(e) {
    if (!this._dragMode) return;
    const cssX = this._cssX(e);
    const sec  = Math.max(0, Math.min(this._totalSec, this._xToSec(cssX)));

    if (this._dragMode === 'scrub') {
      const dx = cssX - this._scrubStartX;
      if (Math.abs(dx) > 2) this._spaceDragged = true;
      const dSec = -dx / this._pixelsPerSec;
      const maxScroll = Math.max(0, this._totalSec - (this._canvas.getBoundingClientRect().width / this._pixelsPerSec));
      this._scrollSec = Math.max(0, Math.min(maxScroll, this._scrubStartScroll + dSec));
    } else if (this._dragMode === 'loop') {
      this._loopEnd = sec;
    } else if (this._dragMode === 'seek') {
      // No drag action on seek mode (cursor snap happens on mouseUp)
    }
    this._draw();
  }

  _wfUp(e) {
    if (this._dragMode === 'seek') {
      // Commit cursor seek — resolved as single click (double-click overrides via _wfDblClick)
      const sec = Math.max(0, Math.min(this._totalSec, this._xToSec(this._cssX(e))));
      // Use a short timer so double-click can cancel before we seek
      if (this._clickTimer) clearTimeout(this._clickTimer);
      this._clickTimer = setTimeout(() => {
        this._clickTimer = null;
        this._curSec = sec;
        // Seek audio if playing
        if (this._playing) {
          this._stop();
          this._curSec = sec;
          this._play();
        }
        this._draw();
      }, 220);
    }
    this._dragMode = null;
    this._draw();
  }

  // Double-click = set Beat 1.0 marker (the primary calibration action)
  _wfDblClick(e) {
    if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
    const sec = Math.max(0, Math.min(this._totalSec, this._xToSec(this._cssX(e))));
    this._calibMarker = sec;
    this._updateLabels();
    this._draw();
  }

  _wfWheel(e) {
    const r     = this._canvas.getBoundingClientRect();
    const cssX  = e.clientX - r.left;
    const atSec = this._xToSec(cssX);

    const factor = e.deltaY < 0 ? 1.18 : (1 / 1.18);
    this._pixelsPerSec = Math.max(10, Math.min(20000, this._pixelsPerSec * factor));

    this._scrollSec = Math.max(0, atSec - cssX / this._pixelsPerSec);
    const maxScroll = Math.max(0, this._totalSec - r.width / this._pixelsPerSec);
    if (this._scrollSec > maxScroll) this._scrollSec = maxScroll;

    const zd = document.getElementById('cal-zoom-disp');
    if (zd) zd.textContent = `${this._pixelsPerSec.toFixed(0)} px/s`;
    this._draw();
  }

  // ── Draw ───────────────────────────────────────────────────────────────────
  _draw() {
    const cv  = this._canvas;
    const ctx = this._ctx2d;
    if (!ctx || !cv.width || !cv.height) return;

    const W = cv.width, H = cv.height;
    const RH  = 22;            // ruler height
    const WY  = RH;            // waveform top
    const WH  = H - RH;        // waveform height
    const MID = WY + WH / 2;  // waveform centre

    // Background
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);

    // Layers
    this._drawWaveform(ctx, W, WY, WH, MID);
    this._drawRuler(ctx, W, RH);
    if (this._calibMarker !== null && this._chart) {
      this._drawBeatGrid(ctx, W, WY, WH);
    }
    this._drawLoopRegion(ctx, W, WY, WH, H);
    this._drawCalibMarker(ctx, W, RH, WY, WH, H);
    this._drawPlayhead(ctx, W, H);

    // Update time display
    const td = document.getElementById('cal-time-disp');
    if (td) td.textContent = this._fmtTime(this._curSec);
  }

  _drawWaveform(ctx, W, wvY, wvH, mid) {
    if (!this._binsMin || !this._numBins) return;

    const secPerBin = this._totalSec / this._numBins;
    const endSec    = this._scrollSec + W / this._pixelsPerSec;
    const b0 = Math.max(0, Math.floor(this._scrollSec / secPerBin));
    const b1 = Math.min(this._numBins - 1, Math.ceil(endSec / secPerBin));
    if (b0 > b1) return;

    const binsPerPx = Math.max(1e-6, (b1 - b0 + 1) / W);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, wvY, 0, wvY + wvH);
    grad.addColorStop(0,   'rgba(0,170,230,0.9)');
    grad.addColorStop(0.5, 'rgba(0,207,255,0.45)');
    grad.addColorStop(1,   'rgba(0,170,230,0.9)');

    // Build filled path: top edge left→right, bottom edge right→left
    ctx.beginPath();
    let firstPt = true;
    for (let px = 0; px < W; px++) {
      const bi0 = Math.floor(b0 + px * binsPerPx);
      const bi1 = Math.min(this._numBins - 1, Math.floor(b0 + (px + 1) * binsPerPx));
      let mx = 0;
      for (let b = bi0; b <= bi1; b++) if (this._binsMax[b] > mx) mx = this._binsMax[b];
      const y = mid - mx * (wvH * 0.48);
      if (firstPt) { ctx.moveTo(px, y); firstPt = false; }
      else ctx.lineTo(px, y);
    }
    for (let px = W - 1; px >= 0; px--) {
      const bi0 = Math.floor(b0 + px * binsPerPx);
      const bi1 = Math.min(this._numBins - 1, Math.floor(b0 + (px + 1) * binsPerPx));
      let mn = 0;
      for (let b = bi0; b <= bi1; b++) if (this._binsMin[b] < mn) mn = this._binsMin[b];
      ctx.lineTo(px, mid - mn * (wvH * 0.48));
    }
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Centre line
    ctx.strokeStyle = 'rgba(0,207,255,0.25)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
  }

  _drawRuler(ctx, W, RH) {
    ctx.fillStyle = '#0c0c1c';
    ctx.fillRect(0, 0, W, RH);
    ctx.strokeStyle = '#2a2a44';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, RH); ctx.lineTo(W, RH); ctx.stroke();

    const vis   = W / this._pixelsPerSec;
    const STEPS = [0.001,0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2,5,10,30,60,120,300,600];
    const step  = STEPS.find(s => s * this._pixelsPerSec >= 65) || 600;
    const sub   = step / 5;
    const t0    = Math.floor(this._scrollSec / step) * step;

    ctx.font      = '9px monospace';
    ctx.textAlign = 'left';

    for (let t = t0; t < this._scrollSec + vis + step; t = +(t + step).toFixed(9)) {
      const x = this._secToX(t);
      if (x < -2 || x > W + 2) continue;

      // Major tick
      ctx.strokeStyle = '#3a3a64';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, RH); ctx.stroke();

      // Sub-ticks
      for (let si = 1; si < 5; si++) {
        const sx = this._secToX(t + si * sub);
        if (sx < 0 || sx > W) continue;
        ctx.strokeStyle = '#1e1e38';
        ctx.beginPath(); ctx.moveTo(sx, RH - 5); ctx.lineTo(sx, RH); ctx.stroke();
      }

      // Label
      if (x > 0 && x < W - 22) {
        ctx.fillStyle = '#7070a0';
        ctx.fillText(this._fmtTime(t), x + 2, RH - 4);
      }
    }
  }

  _drawBeatGrid(ctx, W, wvY, wvH) {
    const marker  = this._calibMarker;
    const chart   = this._chart;
    if (!chart?.bpmEvents?.length) return;

    const TPBEAT = 48, TPMEAS = 192;
    // Use _bpmValue as a local override for the first BPM event (does NOT mutate chart data)
    const bpmEvs = chart.bpmEvents.map((ev, i) =>
      i === 0 ? Object.assign({}, ev, { bpm: this._bpmValue }) : ev
    );

    // Build audio-time position for each BPM segment.
    // Tick 0 corresponds to calibMarker (seconds in the audio file).
    let prevTick = 0, prevAudSec = marker, prevBpm = bpmEvs[0].bpm;
    const segs = [{ audSec: marker, tick: 0, bpm: bpmEvs[0].bpm }];
    for (let i = 1; i < bpmEvs.length; i++) {
      const ev = bpmEvs[i];
      const dt = (ev.y - prevTick) / TPBEAT * (60 / prevBpm);
      prevAudSec += dt;
      segs.push({ audSec: prevAudSec, tick: ev.y, bpm: ev.bpm });
      prevTick = ev.y; prevBpm = ev.bpm;
    }

    const visStart = this._scrollSec;
    const visEnd   = this._scrollSec + W / this._pixelsPerSec;

    ctx.save();
    for (let si = 0; si < segs.length; si++) {
      const seg      = segs[si];
      const nextAud  = si + 1 < segs.length ? segs[si + 1].audSec : this._totalSec + 10;
      if (seg.audSec > visEnd + 1)  break;
      if (nextAud    < visStart - 1) continue;

      const spBeat = 60 / seg.bpm;
      const bOff0  = Math.max(0, Math.floor((visStart - seg.audSec) / spBeat) - 1);
      const bOff1  = Math.ceil((Math.min(visEnd, nextAud) - seg.audSec) / spBeat) + 2;

      for (let bi = bOff0; bi <= bOff1; bi++) {
        const bSec  = seg.audSec + bi * spBeat;
        const bTick = seg.tick + bi * TPBEAT;
        if (bSec < visStart - spBeat || bSec > visEnd + spBeat) continue;

        const x       = this._secToX(bSec);
        const isMeas  = bTick % TPMEAS === 0;
        if (x < 0 || x > W) continue;

        ctx.strokeStyle = isMeas
          ? 'rgba(255,200,80,0.6)'
          : 'rgba(90,90,190,0.38)';
        ctx.lineWidth = isMeas ? 1.5 : 0.75;
        ctx.beginPath(); ctx.moveTo(x, wvY); ctx.lineTo(x, wvY + wvH); ctx.stroke();

        if (isMeas) {
          const mNum = Math.floor(bTick / TPMEAS) + 1;
          ctx.fillStyle  = 'rgba(255,200,80,.7)';
          ctx.font       = '9px monospace';
          ctx.textAlign  = 'left';
          ctx.fillText(`M${mNum}`, x + 2, wvY + 12);
        }
      }
    }
    ctx.restore();
  }

  _drawLoopRegion(ctx, W, wvY, wvH, H) {
    if (this._loopStart === null || this._loopEnd === null) return;
    const a  = Math.min(this._loopStart, this._loopEnd);
    const b  = Math.max(this._loopStart, this._loopEnd);
    const x0 = Math.max(0, this._secToX(a));
    const x1 = Math.min(W, this._secToX(b));
    ctx.fillStyle = 'rgba(57,255,20,.09)';
    ctx.fillRect(x0, wvY, x1 - x0, wvH);
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 1.5;
    for (const x of [x0, x1]) {
      if (x < 0 || x > W) continue;
      ctx.beginPath(); ctx.moveTo(x, wvY); ctx.lineTo(x, H); ctx.stroke();
    }
  }

  _drawCalibMarker(ctx, W, RH, wvY, wvH, H) {
    if (this._calibMarker === null) return;
    const mx = this._secToX(this._calibMarker);
    if (mx < -4 || mx > W + 4) return;

    // Dashed vertical line
    ctx.strokeStyle = '#ff3aad';
    ctx.lineWidth   = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(mx, wvY); ctx.lineTo(mx, H); ctx.stroke();
    ctx.setLineDash([]);

    // Diamond on ruler
    if (mx >= -6 && mx <= W + 6) {
      ctx.fillStyle = '#ff3aad';
      ctx.beginPath();
      ctx.moveTo(mx,     RH);
      ctx.lineTo(mx + 5, RH - 6);
      ctx.lineTo(mx,     RH - 12);
      ctx.lineTo(mx - 5, RH - 6);
      ctx.closePath();
      ctx.fill();
    }

    // Label at bottom of waveform
    if (mx > 0 && mx < W) {
      ctx.fillStyle  = '#ff3aad';
      ctx.font       = 'bold 10px monospace';
      const rightSide = mx + 75 < W;
      ctx.textAlign  = rightSide ? 'left' : 'right';
      ctx.fillText('♦ Beat 1.0', mx + (rightSide ? 4 : -4), H - 4);
      ctx.textAlign  = 'left';
    }
  }

  _drawPlayhead(ctx, W, H) {
    const px = this._secToX(this._curSec);
    if (px < 0 || px > W) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 10);
    ctx.closePath();
    ctx.fill();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  _fmtTime(sec) {
    if (sec < 0) sec = 0;
    const m  = Math.floor(sec / 60);
    const s  = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  _updateLabels() {
    const ml = document.getElementById('cal-marker-lbl');
    const ol = document.getElementById('cal-offset-lbl');
    const oi = document.getElementById('cal-offset-in');
    if (this._calibMarker !== null) {
      const ms = Math.round(this._calibMarker * 1000);
      if (ml) ml.textContent = `Beat 1.0: ${this._fmtTime(this._calibMarker)} (${ms} ms)`;
      if (ol) ol.textContent = `Offset: ${ms} ms`;
      if (oi) oi.value = ms;
    } else {
      if (ml) ml.textContent = 'Beat 1.0: double-click waveform to set';
      if (ol) ol.textContent = 'Offset: —';
      if (oi) oi.value = '';
    }
  }

  _nudge(ms) {
    if (this._calibMarker === null) this._calibMarker = 0;
    this._calibMarker = Math.max(0, Math.min(this._totalSec, this._calibMarker + ms / 1000));
    this._updateLabels(); this._draw();
  }

  // ── Auto BPM detection ─────────────────────────────────────────────────────
  // Uses autocorrelation on the waveform envelope to find dominant rhythmic period.
  // Returns estimated BPM (rounded to nearest 0.5) or null on failure.
  _autoBpm() {
    const bins = this._binsMax;
    if (!bins || bins.length < 10) return null;

    const n          = bins.length;
    const secPerBin  = this._totalSec / n;

    // Normalize to [0,1]
    let maxVal = 0;
    for (let i = 0; i < n; i++) if (bins[i] > maxVal) maxVal = bins[i];
    if (maxVal < 1e-6) return null;

    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = bins[i] / maxVal;

    // BPM search range: 60–300 BPM
    const lagMin = Math.max(1, Math.floor(60 / 300 / secPerBin));
    const lagMax = Math.min(Math.floor(n / 2), Math.ceil(60 / 60 / secPerBin));

    let bestCorr = -Infinity, bestLag = lagMin;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let corr = 0;
      const len = n - lag;
      for (let i = 0; i < len; i++) corr += sig[i] * sig[i + lag];
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    }

    if (bestCorr < 0) return null;

    const period = bestLag * secPerBin;
    if (period < 0.01) return null;

    let bpm = 60 / period;

    // Bring into 80–300 range by halving/doubling
    while (bpm > 300) bpm /= 2;
    while (bpm < 80)  bpm *= 2;

    // Round to nearest 0.5 BPM
    return Math.round(bpm * 2) / 2;
  }

  // ── Tap Tempo ──────────────────────────────────────────────────────────────
  // User taps the button (or T key) repeatedly to the beat. After ≥2 taps the
  // average inter-tap interval determines the BPM. After ≥4 taps the result is
  // promoted to a confirmable suggestion (reusing the same suggestion UI as
  // auto-detect). The tap sequence auto-resets after 3 s of inactivity.
  _handleTapTempo() {
    const now = performance.now();

    // Start fresh if the last tap was more than 3 seconds ago
    if (this._tapTempoTimes.length > 0 &&
        now - this._tapTempoTimes[this._tapTempoTimes.length - 1] > 3000) {
      this._tapTempoTimes = [];
    }

    this._tapTempoTimes.push(now);
    if (this._tapTempoTimes.length > 16) this._tapTempoTimes.shift(); // rolling window

    // Reset inactivity timer
    if (this._tapTempoReset) clearTimeout(this._tapTempoReset);
    this._tapTempoReset = setTimeout(() => {
      this._tapTempoTimes = [];
      this._tapTempoReset = null;
      const lbl = document.getElementById('cal-tap-tempo-lbl');
      if (lbl) lbl.textContent = 'Tap: click to start';
    }, 3000);

    const count = this._tapTempoTimes.length;
    const lbl   = document.getElementById('cal-tap-tempo-lbl');

    if (count < 2) {
      if (lbl) lbl.textContent = 'Tap: 1 — keep tapping…';
      return;
    }

    // Average inter-tap interval in ms
    let totalMs = 0;
    for (let i = 1; i < count; i++) {
      totalMs += this._tapTempoTimes[i] - this._tapTempoTimes[i - 1];
    }
    const avgMs = totalMs / (count - 1);
    if (avgMs < 10) return; // guard against double-fire

    let bpm = 60000 / avgMs;
    // Bring into 60–300 range (half/double as needed)
    while (bpm > 300) bpm /= 2;
    while (bpm < 60)  bpm *= 2;
    bpm = Math.round(bpm * 2) / 2; // round to nearest 0.5 BPM

    if (lbl) lbl.textContent = `Tap: ${count} | ${bpm.toFixed(1)} BPM`;

    // After 4+ taps promote to a confirmable suggestion
    if (count >= 4) {
      this._bpmDetected = bpm;
      const sug = document.getElementById('cal-bpm-suggestion');
      const cnf = document.getElementById('cal-bpm-confirm-btn');
      const dsm = document.getElementById('cal-bpm-dismiss-btn');
      if (sug) { sug.textContent = `Tap tempo: ~${bpm.toFixed(1)} BPM`; sug.style.display = 'inline'; }
      if (cnf) cnf.style.display = 'inline';
      if (dsm) dsm.style.display = 'inline';
    }
  }

  // ── Playback ───────────────────────────────────────────────────────────────
  _togglePlay() { this._playing ? this._stop() : this._play(); }

  _play() {
    if (this._playing || !this._audioBuffer) return;
    if (!this._acCtx) {
      this._acCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._acCtx.state === 'suspended') this._acCtx.resume();

    const src = this._acCtx.createBufferSource();
    src.buffer = this._audioBuffer;
    src.connect(this._acCtx.destination);

    const loopA = this._loopEnabled && this._loopStart !== null
      ? Math.min(this._loopStart, this._loopEnd) : null;
    const loopB = this._loopEnabled && this._loopEnd   !== null
      ? Math.max(this._loopStart, this._loopEnd) : null;

    if (loopA !== null && loopB !== null && loopB > loopA) {
      src.loop = true; src.loopStart = loopA; src.loopEnd = loopB;
      if (this._curSec < loopA || this._curSec > loopB) this._curSec = loopA;
    }

    const startAt      = Math.max(0, Math.min(this._audioBuffer.duration - 0.01, this._curSec));
    src.start(this._acCtx.currentTime, startAt);
    this._source      = src;
    this._startAcTime = this._acCtx.currentTime;
    this._startOff    = startAt;
    this._playing     = true;

    // Prime metronome scheduler to the beat nearest to the playback start position
    if (this._calibMarker !== null && this._chart) {
      const bpm0 = this._chart.getBpmAt?.(0) ?? 120;
      const relSec = Math.max(0, startAt - this._calibMarker);
      const approxTick = Math.floor(relSec * bpm0 / 60 * TICKS_PER_BEAT);
      // Round down to nearest beat boundary
      this._metroNextBeatTick = Math.max(0, Math.floor(approxTick / TICKS_PER_BEAT) * TICKS_PER_BEAT);
    } else {
      this._metroNextBeatTick = 0;
    }

    src.onended = () => { if (this._playing) this._stop(); };

    const b = document.getElementById('cal-play-btn');
    if (b) b.textContent = '⏸';
  }

  _stop() {
    if (this._source) { try { this._source.stop(); } catch(e) {} this._source = null; }
    this._playing = false;
    const b = document.getElementById('cal-play-btn');
    if (b) b.textContent = '▶';
  }

  // ── RAF loop ───────────────────────────────────────────────────────────────
  _startRaf() {
    const tick = () => {
      if (!this._wrap) return;
      if (this._playing && this._acCtx) {
        this._curSec = this._startOff + (this._acCtx.currentTime - this._startAcTime);
        this._scheduleMetronome(); // schedule upcoming beat clicks with lookahead
        // Auto-scroll: keep playhead in view
        const r = this._canvas.getBoundingClientRect();
        if (r.width > 0) {
          const vis = r.width / this._pixelsPerSec;
          const edge = vis * 0.82;
          if (this._curSec > this._scrollSec + edge) {
            this._scrollSec = Math.max(0, this._curSec - vis * 0.18);
          }
        }
      }
      this._draw();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // ── Metronome ──────────────────────────────────────────────────────────────

  // Convert chart ticks (tick 0 = calibMarker) to absolute audio seconds
  _tickToAudioSec(tick) {
    const events = (this._chart?.bpmEvents ?? []).slice().sort((a, b) => a.y - b.y);
    const bpm0   = events.length > 0 ? events[0].bpm : 120;
    let sec      = (this._calibMarker ?? 0);
    let prevTick = 0;
    let prevBpm  = bpm0;
    for (const ev of events) {
      if (ev.y >= tick) break;
      sec      += (ev.y - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
      prevTick  = ev.y;
      prevBpm   = ev.bpm;
    }
    sec += (tick - prevTick) / TICKS_PER_BEAT * (60 / prevBpm);
    return sec;
  }

  // Schedule metronome beeps for the next LOOKAHEAD seconds
  _scheduleMetronome() {
    if (!this._metronomeEnabled || !this._acCtx || this._calibMarker === null) return;
    const LOOKAHEAD = 0.25; // seconds ahead to look
    const acNow     = this._acCtx.currentTime;
    const audioNow  = this._startOff + (acNow - this._startAcTime);

    const BEATS = BEATS_PER_MEASURE;
    const TPBEAT = TICKS_PER_BEAT;
    const MAX_ITER = 512; // guard against infinite loop if BPM is 0

    let iter = 0;
    while (iter++ < MAX_ITER) {
      const beatAudioSec = this._tickToAudioSec(this._metroNextBeatTick);
      if (beatAudioSec > audioNow + LOOKAHEAD) break; // beyond lookahead window
      if (beatAudioSec >= audioNow - 0.01) {          // don't fire beats in the past
        const acFire = acNow + (beatAudioSec - audioNow);
        if (acFire >= acNow) {
          const beatIdx   = Math.round(this._metroNextBeatTick / TPBEAT) % BEATS;
          this._playMetroBeep(acFire, beatIdx === 0);
        }
      }
      this._metroNextBeatTick += TPBEAT;
    }
  }

  // Synthesize a short click using an oscillator + gain envelope
  _playMetroBeep(acTime, isDownbeat) {
    if (!this._acCtx) return;
    const osc  = this._acCtx.createOscillator();
    const env  = this._acCtx.createGain();
    osc.type             = 'sine';
    osc.frequency.value  = isDownbeat ? 880 : 660; // metro_A (beat 1) higher, metro_B lower
    osc.connect(env);
    env.connect(this._acCtx.destination);
    env.gain.setValueAtTime(isDownbeat ? 0.55 : 0.30, acTime);
    env.gain.exponentialRampToValueAtTime(0.0001, acTime + 0.075);
    osc.start(acTime);
    osc.stop(acTime + 0.08);
  }

  // ── Close ──────────────────────────────────────────────────────────────────
  _close(apply) {
    this._stop();
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._clickTimer) { clearTimeout(this._clickTimer); this._clickTimer = null; }
    if (this._tapTempoReset) { clearTimeout(this._tapTempoReset); this._tapTempoReset = null; }
    this._tapTempoTimes = [];
    if (this._keyHandler) {
      window.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this._keyUpHandler) {
      window.removeEventListener('keyup', this._keyUpHandler, true);
      this._keyUpHandler = null;
    }
    if (this._wrap) { this._wrap.remove(); this._wrap = null; }
    if (apply && this._onClose) this._onClose(this._calibMarker, this._bpmValue);
  }

  _destroy() { this._close(false); }
}

// Global singleton — one calibration session at a time
export const calibrationWindow = new CalibrationWindow();
