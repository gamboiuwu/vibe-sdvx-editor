#!/usr/bin/env bash
# vibe-editr startup script
# vibecoded by gamboiuwu

set -e

cd "$(dirname "$0")"

# ── Check runtime ──────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  echo ""
  echo "  Starting vibe-editr with Node.js..."
  node server.js

elif command -v python3 &>/dev/null; then
  echo ""
  echo "  ┌──────────────────────────────────────────────────┐"
  echo "  │       vibe-editr — vibecoded by gamboiuwu        │"
  echo "  │                                                  │"
  echo "  │   Python fallback server (no Node.js found)      │"
  echo "  │   → http://localhost:3000                        │"
  echo "  │                                                  │"
  echo "  │   [Ctrl+C to stop]                               │"
  echo "  └──────────────────────────────────────────────────┘"
  echo ""
  # Open browser in background then start server
  (sleep 1 && open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null) &
  python3 -m http.server 3000

else
  echo ""
  echo "  ✗ Neither Node.js nor Python 3 found."
  echo "  Install Node.js from https://nodejs.org then run:"
  echo "      node server.js"
  echo ""
  exit 1
fi
