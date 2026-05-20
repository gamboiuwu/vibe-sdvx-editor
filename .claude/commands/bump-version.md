Bump the vibe-editr version number and update all version references.

The new version to use is: $ARGUMENTS

Steps:
1. Read js/app.js lines 47-200 to see current APP_VERSION and the top of CHANGELOG.
2. In js/app.js:
   - Line 47: change `APP_VERSION` to the new version string
   - Line 48+: prepend a new entry at the TOP of the CHANGELOG array in this format:
     ```js
     { v: 'NEW_VERSION', date: 'YYYY-MM-DD', notes: [
       'Brief description of what changed in this version',
     ]},
     ```
3. In vibe-editr-docs.html: find and update the version badge (search for the current version string) and prepend a new entry in the update log section.
4. Report what was changed and where.

Do NOT bump any ?v= cache-busting query strings — those are bumped separately when the file content changes.
