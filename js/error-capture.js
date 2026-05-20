// Loaded in <head> BEFORE all other scripts — catches errors from every script
// on the page, including those that load before app.js.
// Uses var (not const/let) so these become true globals accessible from strict-mode files.

/* jshint esversion:5 */
var _initErrors = [];
var _initPhase  = 'loading-scripts';

// Minimal _showInitError — updated by the full version in app.js once it loads.
function _showInitError(msg, file, line, col, err) {
  _initErrors.push({ msg: msg, file: file, line: line, col: col, err: err });
  // DOM may not be ready yet; all calls are safely guarded.
  var errBox  = document.getElementById('loading-errors');
  var errList = document.getElementById('loading-error-list');
  var contBtn = document.getElementById('loading-continue-btn');
  var stageEl = document.getElementById('loading-stage');
  if (errBox)  errBox.style.display = '';
  if (errList) {
    var src = file ? file.split('/').pop() : '';
    var loc = src ? (line ? '[' + src + ':' + line + ']' : '[' + src + ']') : '';
    var txt = (loc ? loc + ' ' : '') + (msg || 'Unknown error');
    errList.textContent += (errList.textContent ? '\n' : '') + txt;
  }
  if (contBtn && contBtn.style.display === 'none') contBtn.style.display = '';
  if (stageEl) stageEl.textContent = '⚠ Error during: ' + _initPhase;
}

// Flush buffered errors into the loading overlay once the DOM is ready.
// This covers the window where errors fired before the body was parsed.
document.addEventListener('DOMContentLoaded', function () {
  if (_initErrors.length === 0) return;
  _initErrors.forEach(function (e) { _showInitError(e.msg, e.file, e.line, e.col, e.err); });
}, { once: true });

window.addEventListener('error', function (ev) {
  _showInitError(ev.message, ev.filename, ev.lineno, ev.colno, ev.error);
});
window.addEventListener('unhandledrejection', function (ev) {
  var msg = (ev.reason instanceof Error)
    ? ev.reason.message
    : String(ev.reason != null ? ev.reason : 'Unknown rejection');
  _showInitError('Unhandled Promise — ' + msg, '', 0, 0, ev.reason);
});
