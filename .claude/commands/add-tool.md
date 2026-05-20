Add a new tool to the vibe-editr Tools Hub.

Tool to add: $ARGUMENTS

Steps:
1. Read js/tools.js lines 1-120 to see the TOOL_REGISTRY array structure and TOOL_SETTINGS schema.
2. Add an entry to TOOL_REGISTRY (js/tools.js ~line 7):
   ```js
   { id: 'your-id', cat: 'Edit|Analysis|Audio|Metadata|Validate', label: 'Tool Name', icon: '⚙' },
   ```
   Keep total tool count at 22 unless explicitly asked to change it.
3. If the tool needs configurable settings, add to TOOL_SETTINGS (js/tools.js ~line 39):
   ```js
   'your-id': {
     keyName: { label: 'UI Label', type: 'toggle|number|select', def: defaultVal, ... }
   }
   ```
4. Find the `_renderTool(c)` switch statement in tools.js and add a case:
   ```js
   case 'your-id': _toolYourTool(c); break;
   ```
5. Implement `function _toolYourTool(c)` that builds the tool UI into the `c` (content div) parameter.
   - Use `_getTS('your-id', 'key')` to read settings, `_setTS('your-id', 'key', val)` to save.
   - Call `saveUndo('label')` before any chart mutations, then `render()` after.
   - Access the active chart via the global `chart`, renderer via `renderer`.
6. Report what was added and where.
