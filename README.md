# vibe-editr

A browser-based chart editor for **Sound Voltex** style rhythm charts. KSON-first, with KSH import/export, real-time audio playback, an FX effect chain, and a 3D game preview that mirrors the actual gameplay perspective.

No installation, no build step — it's a static page plus an optional Node helper that serves files with the headers the Web Audio API needs.

```
  ▶  http://localhost:3000
```

---

## Quick start

Clone the repo, then pick whichever launcher matches your OS:

| Platform | Command |
| --- | --- |
| macOS  | double-click `start.command`, or `./start.sh` in a terminal |
| Linux  | `./start.sh` |
| Windows | double-click `start.bat` |
| Any    | `node server.js` (Node 18+) |

The launcher prefers Node and falls back to `python3 -m http.server` if Node isn't installed. Your browser opens automatically at `http://localhost:3000`.

You can also just open `index.html` directly from disk, but some Web Audio features need the cross-origin headers `server.js` sets — running through the server is recommended.

---

## Features

- **KSON as the source of truth.** Imported KSH charts are converted to KSON on load; the editor never mutates non-KSON formats.
- **Three view modes** — flat top-down **Edit**, side-by-side **Split**, and full-perspective **Game Preview** with a trapezoidal SDVX-style runway.
- **Multi-chart preview** — up to four charts share one synchronized playhead for comparison and difficulty review.
- **Laser pen tool** — Bézier anchor + handle editing modeled on Photoshop's Pen Tool. Shift-drag for sub-tick precision, Alt for independent handles.
- **Per-tab audio** with a real FX chain: Retrigger, Gate, Flanger, PitchShift, BitCrusher, Phaser, Wobble, TapeStop, Echo, SideChain.
- **Visual calibration** — tap `Space` on the audio to measure delay and apply the correction automatically.
- **Full undo history** — Photoshop-style History panel, click any past state to jump back to it.
- **Autosave**, S-Ran shuffles (All / BT / FX / VOL), mirror tools, ½× / 2× tick speed, and Unicode metadata.

A user-facing changelog lives at [`vibe-editr-docs.html#updates`](vibe-editr-docs.html). The roadmap (BPM detection inside calibration mode, strict 2D orthographic preview, deeper pen-tool parity) lives in [`Upcoming Changes.rtf`](Upcoming%20Changes.rtf).

---

## Format support

| Type | In | Out |
| --- | --- | --- |
| Chart | `.ksh`, `.kson` | `.ksh`, `.kson` |
| Audio | `.ogg` (native), `.flac`, `.wav`, `.mp3` | normalized to `.ogg` |

Non-`.ogg` audio triggers a conversion confirmation, then a progress dialog with decode / encode / finalize stages. The resulting `.ogg` becomes the active source and waveforms regenerate automatically. `.flac` and `.ogg` are the preferred inputs.

---

## Project layout

```
vibe-sdvx-editor/
├── index.html              # the app
├── style.css
├── server.js               # static file server with COOP/COEP headers
├── start.sh / start.command / start.bat
├── vibe-editr-docs.html    # user documentation + Updates section
├── Upcoming Changes.rtf    # roadmap notes
├── DEVELOPER.md            # internals, module map, contribution guide
├── js/
│   ├── app.js              # main app, playback loop, FX wiring
│   ├── chart.js            # ChartData model
│   ├── kson.js, ksh.js     # format readers/writers
│   ├── renderer.js         # 2D chart canvas
│   ├── game.js, gameplay.js  # 3D preview and scoring
│   ├── calibration.js      # waveform calibration window
│   ├── tools.js, effects.js, dock.js, radar.js, handsim.js, i18n.js, logger.js
└── sounds/                 # metronome and slam samples
```

See **[`DEVELOPER.md`](DEVELOPER.md)** for a full architecture map, the playback frame pipeline, the FX node graph, and instructions for adding new tools / effects / view modes.

---

## Keyboard shortcuts (selected)

| Key | Action |
| --- | --- |
| `1`–`5` | Select / BT / FX / L-Laser / R-Laser tools |
| `E` | Erase |
| `Space` | Play / Stop (plays selection if one is active) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` | Export KSH |
| `Ctrl+D` | Deselect |
| `[` / `]` | Finer / coarser snap |
| `C` or `Ctrl+RClick` | Context menu |

Full reference: [`vibe-editr-docs.html#shortcuts`](vibe-editr-docs.html).

---

## Browser support

Chrome and Edge are the primary targets. Firefox works for editing; some Web Audio effects (PitchShift in particular) behave more reliably on Chromium-based browsers. Safari is unsupported.

---

## Credits

Built by **gamboiuwu**. Verify exported charts in KShootMania or USC before submission — laser timing, BPM changes, and hold edges should always be spot-checked after export.
