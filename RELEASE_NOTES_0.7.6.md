# CodeBender 0.7.6

This maintenance release fixes two false-positive sources in pause/resume tracking.

- Pausing and resuming no longer surfaces Git-ignored files (e.g. `.vscode/settings.json` rewritten by another extension) as pending changes to accept/reject. A file with no prior baseline that Git ignores is skipped, the same way live tracking already behaved.
- The pause/resume "did this change while paused?" check now uses the same EOL/BOM-normalized comparison as the rest of the review engine, instead of a raw content hash. A file whose only difference during the pause was its line endings (e.g. from a Git checkout with `autocrlf`) is no longer silently treated as a real edit.
- Added regression tests covering both scenarios.
