#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

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

// File types that benefit from gzip (text formats only)
const GZIP_EXTS = new Set(['.html', '.css', '.js', '.json', '.svg']);

// ── Banner ────────────────────────────────────────────────────────────────────
const RESET   = '\x1b[0m';
const CYAN    = '\x1b[96m';
const MAGENTA = '\x1b[95m';
const YELLOW  = '\x1b[93m';
const DIM     = '\x1b[2m';
const BOLD    = '\x1b[1m';

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

  ${DIM}[Ctrl+C to stop]   [PORT env var to change port]   [gzip enabled]${RESET}
`);
}

// ── File cache (in-memory, avoids re-reading disk on every request) ───────────
const _rawCache  = new Map(); // path → Buffer
const _gzipCache = new Map(); // path → Buffer (compressed)

function readCached(abs, cb) {
  if (_rawCache.has(abs)) return cb(null, _rawCache.get(abs));
  fs.readFile(abs, (err, data) => {
    if (!err) _rawCache.set(abs, data);
    cb(err, data);
  });
}

function gzipCached(abs, data, cb) {
  if (_gzipCache.has(abs)) return cb(null, _gzipCache.get(abs));
  zlib.gzip(data, { level: 6 }, (err, compressed) => {
    if (!err) _gzipCache.set(abs, compressed);
    cb(err, compressed);
  });
}

// Bust caches when files change on disk (dev-friendly)
if (process.env.NODE_ENV !== 'production') {
  fs.watch(ROOT, { recursive: true }, (_, filename) => {
    if (!filename) return;
    const abs = path.resolve(ROOT, filename);
    _rawCache.delete(abs);
    _gzipCache.delete(abs);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Prevent path traversal
  const abs = path.resolve(ROOT, '.' + urlPath);
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const ext  = path.extname(abs).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const acceptsGzip = GZIP_EXTS.has(ext) &&
                      (req.headers['accept-encoding'] || '').includes('gzip');

  const baseHeaders = {
    'Content-Type': mime,
    // SharedArrayBuffer requirement for Web Audio precision
    'Cross-Origin-Opener-Policy':   'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    // Aggressive caching for versioned JS/CSS assets; no-cache for HTML
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  };

  readCached(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + urlPath);
      return;
    }

    if (acceptsGzip) {
      gzipCached(abs, data, (gzErr, compressed) => {
        if (gzErr) {
          res.writeHead(200, baseHeaders);
          res.end(data);
          return;
        }
        res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip' });
        res.end(compressed);
      });
    } else {
      res.writeHead(200, baseHeaders);
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  printBanner(url);

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
