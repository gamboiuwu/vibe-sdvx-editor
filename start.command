#!/usr/bin/env bash
# vibe-editr — double-click launcher for macOS
# vibecoded by gamboiuwu

# Ensure this script itself is executable (self-bootstrap)
chmod +x "$0" 2>/dev/null

# Change to the folder containing this script
cd "$(dirname "$0")"

echo ""
echo "  ┌──────────────────────────────────────────────────────┐"
echo "  │          vibe-editr  ·  vibecoded by gamboiuwu       │"
echo "  └──────────────────────────────────────────────────────┘"
echo ""

# ── Try Node.js ───────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  echo "  ▶  Starting with Node.js…"
  echo "     http://localhost:3000"
  echo ""
  node server.js
  exit 0
fi

# ── Try Python 3 ──────────────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
  echo "  ▶  Starting with Python 3 (Node.js not found)…"
  echo "     http://localhost:3000"
  echo "     [Ctrl+C to stop]"
  echo ""
  (sleep 1 && open "http://localhost:3000" 2>/dev/null) &
  python3 -m http.server 3000
  exit 0
fi

# ── Nothing found ─────────────────────────────────────────────────────────────
echo "  ✗  Neither Node.js nor Python 3 was found."
echo ""
echo "  To fix this, install ONE of the following:"
echo ""
echo "  [RECOMMENDED]  Node.js  (free):"
echo "    https://nodejs.org  → click LTS → run the .pkg installer"
echo ""
echo "  [ALTERNATIVE]  Python 3  (free):"
echo "    https://www.python.org/downloads/"
echo ""
echo "  After installing, double-click start.command again."
echo ""
open "https://nodejs.org" 2>/dev/null
read -n1 -r -p "  Press any key to close…"
echo ""
exit 1
