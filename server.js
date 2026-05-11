#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ogg':  'audio/ogg',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ico':  'image/x-icon',
};

// ── Banner ────────────────────────────────────────────────────────────────────
const RESET  = '\x1b[0m';
const CYAN   = '\x1b[96m';
const MAGENTA= '\x1b[95m';
const YELLOW = '\x1b[93m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

function printBanner(url) {
  console.clear();
  console.log(`
${CYAN}${BOLD}  ██╗   ██╗██╗██████╗ ███████╗       ███████╗██████╗ ██╗████████╗██████╗ ${RESET}
${CYAN}${BOLD}  ██║   ██║██║██╔══██╗██╔════╝       ██╔════╝██╔══██╗██║╚══██╔══╝██╔══██╗${RESET}
${MAGENTA}${BOLD}  ██║   ██║██║██████╔╝█████╗  ████   █████╗  ██║  ██║██║   ██║   ██████╔╝${RESET}
${MAGENTA}${BOLD}  ╚██╗ ██╔╝██║██╔══██╗██╔══╝  ╚═══╝   ██╔══╝  ██║  ██║██║   ██║   ██╔══██╗${RESET}
${MAGENTA}${BOLD}   ╚████╔╝ ██║██████╔╝███████╗       ███████╗██████╔╝██║   ██║   ██║  ██║${RESET}
${DIM}    ╚═══╝  ╚═╝╚═════╝ ╚══════╝       ╚══════╝╚═════╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝${RESET}

${YELLOW}${BOLD}                    vibecoded by gamboiuwu${RESET}
${DIM}              SDVX Chart Editor  ·  vibe-editr${RESET}

  ${CYAN}▶  ${BOLD}${url}${RESET}

  ${DIM}[Ctrl+C to stop]   [PORT env var to change port]${RESET}
`);
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Prevent path traversal
  const abs = path.resolve(ROOT, '.' + urlPath);
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext  = path.extname(abs).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    // Enable SharedArrayBuffer (needed for Web Audio precision)
    res.writeHead(200, {
      'Content-Type': mime,
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  printBanner(url);

  // Auto-open browser
  const cmd = process.platform === 'darwin' ? `open "${url}"`
            : process.platform === 'win32'  ? `start "${url}"`
            : `xdg-open "${url}"`;
  require('child_process').exec(cmd);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.\n  Try: PORT=3001 node server.js\n`);
    process.exit(1);
  }
  throw err;
});

process.on('SIGINT', () => {
  console.log(`\n${DIM}  Stopped. See you next time, gamboiuwu!${RESET}\n`);
  process.exit(0);
});
