Diagnose the current initialization error capture state in vibe-editr.

Steps:
1. Read js/app.js lines 1-40 to verify the pre-init error capture block is in place.
2. Read js/app.js — search for `_loadingDone` function and verify it handles `_initErrors.length > 0`.
3. Read index.html — search for `loading-errors`, `loading-error-list`, `loading-continue-btn` to verify the HTML elements exist in `#loading-overlay`.
4. Read js/app.js — search for `_initPhase =` to list all phase markers set during initialization.
5. Report:
   - Whether the capture system is fully wired (app.js listeners + index.html elements + _loadingDone guard)
   - All current _initPhase stage names in order
   - Any gaps where errors could occur without a phase label
   - Any errors currently in the logger (check logger.js for the stored errors array)
