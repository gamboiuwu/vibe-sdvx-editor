Register an existing DOM element as a dockable panel in vibe-editr.

Panel to register: $ARGUMENTS
(Provide: element ID, label, icon, and preferred default region: left|right|bottom|float)

Steps:
1. Read the bottom of js/app.js (last ~100 lines) to find the `setTimeout(() => {...}, 150)` dock registration block.
2. Inside that block, add a `dockRegister` call:
   ```js
   const myPanel = document.getElementById('your-element-id');
   if (myPanel) {
     dockRegister('your-element-id', myPanel, 'Label', '⊛', 'right');
   }
   ```
   - Use `nativeFloat: true` option ONLY for `.tw-window` flex-column floating windows (like Tools Hub).
   - Use `floatW` / `floatH` options to set initial float dimensions if `defaultRegion` is `'float'`.
3. If a Window menu toggle button exists or should exist in index.html, wire it:
   ```js
   document.getElementById('btn-toggle-your-panel')?.addEventListener('click', () => dockToggle('your-element-id'));
   ```
4. Optionally add a Window menu item in index.html if one doesn't exist yet.
5. `dockApplyLayout()` is already called at the end of the block — no need to add it again.
6. Report what was changed.
