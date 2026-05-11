'use strict';

class ErrorLogger {
  constructor() {
    this.errors = [];
    this.MAX = 200;
    this._load();
    // Hook after DOM ready
    window.addEventListener('DOMContentLoaded', () => this._refreshBadge());
  }

  hookGlobal() {
    window.addEventListener('error', e => {
      this.push(e.message, e.filename?.split('/').pop() || '', e.lineno);
    });
    window.addEventListener('unhandledrejection', e => {
      this.push(String(e.reason?.message ?? e.reason), 'Promise', 0);
    });
  }

  push(msg, source, line) {
    this.errors.unshift({ t: new Date().toLocaleTimeString(), msg: String(msg), src: String(source || ''), ln: line || 0 });
    if (this.errors.length > this.MAX) this.errors.length = this.MAX;
    this._save();
    this._refreshBadge();
  }

  clear() { this.errors = []; this._save(); this._refreshBadge(); }

  _save() { try { localStorage.setItem('sdvx_err', JSON.stringify(this.errors)); } catch {} }

  _load() { try { const d = localStorage.getItem('sdvx_err'); if (d) this.errors = JSON.parse(d); } catch {} }

  _refreshBadge() {
    const el = document.getElementById('error-badge');
    if (!el) return;
    const n = this.errors.length;
    el.textContent = `Errors: ${n}`;
    el.className = 'error-badge' + (n > 0 ? ' has-errors' : '');
  }

  showModal() {
    let modal = document.getElementById('error-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'error-modal';
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-box" style="min-width:560px;max-width:780px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <h3 style="margin:0">Error Log</h3>
            <div style="display:flex;gap:6px">
              <button id="err-clear" class="tb-btn" style="font-size:11px;padding:2px 8px">Clear</button>
              <button id="err-copy"  class="tb-btn" style="font-size:11px;padding:2px 8px">Copy All</button>
              <button id="err-close" class="tb-btn" style="font-size:11px;padding:2px 8px">✕</button>
            </div>
          </div>
          <div id="err-list" class="err-list"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
      document.getElementById('err-close').addEventListener('click', () => { modal.style.display = 'none'; });
      document.getElementById('err-clear').addEventListener('click', () => { this.clear(); this._fillModal(); });
      document.getElementById('err-copy').addEventListener('click', () => {
        const txt = this.errors.map(e => `[${e.t}] ${e.src}:${e.ln} — ${e.msg}`).join('\n');
        navigator.clipboard.writeText(txt).catch(() => { prompt('Copy this:', txt); });
      });
    }
    this._fillModal();
    modal.style.display = 'flex';
  }

  _fillModal() {
    const list = document.getElementById('err-list');
    if (!list) return;
    if (!this.errors.length) { list.innerHTML = '<div class="err-empty">No errors recorded.</div>'; return; }
    list.innerHTML = this.errors.map(e => `
      <div class="err-entry">
        <span class="err-time">${e.t}</span>
        <span class="err-src">${e.src}:${e.ln}</span>
        <span class="err-msg">${escHtml(e.msg)}</span>
      </div>`).join('');
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const logger = new ErrorLogger();
logger.hookGlobal();
