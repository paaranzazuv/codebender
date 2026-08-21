# Changelog

## 0.7.5

- Added `✓ Accept all changes in file` and `↶ Reject all changes in file` quick actions to each normal changed file in the Review Changes tree.
- File-level bulk actions work without opening the file.
- Inline review remains strictly per hunk; Accept + Stage and Request correction are still block-scoped.

## 0.7.4

- Fixed agent feedback transport so multiline correction prompts are delivered as one bracketed-paste message instead of being split into multiple terminal submissions.
- Reviewer instructions now appear first in the agent prompt and the prompt explicitly limits the agent to the selected CodeBender block.
- Sanitizes terminal control characters in reviewer annotations before sending them to an agent terminal.
- Added regression tests for agent prompt construction and terminal transport.

## 0.7.3

- Fixed startup false positives: opening or activating an unchanged file no longer shows inline review actions.
- Inline Accept/Reject/Accept + Stage actions are now gated to changes actually registered after the review session starts.
- Open VS Code documents are absorbed into the session baseline at startup, including unsaved content.
- Text-document metadata events without content changes no longer trigger review refreshes.
- Preserves the Git-first fast startup and block-level decisions from 0.7.2.

## 0.7.2

- Corrige el falso positivo que marcaba un archivo completo como cambiado al abrirlo cuando el baseline Git usaba LF y el working tree CRLF.
- La comparación inline ahora normaliza LF/CRLF/CR y BOM solo para detectar cambios, sin modificar el formato real del archivo.
- Abrir, activar o cerrar un archivo sin editarlo ya no genera bloques de revisión.
- Rechazar un bloque conserva el estilo EOL del archivo de trabajo.
- `Accept + Stage` aplica los filtros/EOL de Git mediante `hash-object --path` y mantiene el stage estrictamente por bloque.
- Añade regresiones automáticas para EOL, BOM, hunks parciales y staging CRLF.

All notable CodeBender changes are documented here.

## 0.7.1

- Restored strict hunk-level review actions in the normal Review Changes UI.
- Removed whole-file Accept/Reject controls from changed-file items and view title actions.
- Fixed `Accept + Stage` so only the selected hunk is applied to the current Git index.
- Preserves unrelated staged changes and avoids staging pre-existing unstaged work.
- Added safe ambiguity/overlap detection before index writes.
- Added block actions for fully deleted files, treated as a single deletion hunk.
- Added automated regression tests for hunk independence and partial Git staging.
- Retains the Git-first lazy startup from 0.7.0.

## 0.7.0

### Performance
- Added **Git Fast Baseline**: Git repositories no longer require a full per-file snapshot at session start.
- Clean repositories reuse `HEAD` directly as the baseline with no new Git objects.
- Dirty repositories create one isolated temporary-index checkpoint without touching the real staging area.
- Baseline file contents are loaded lazily only when a file actually changes.
- Added an in-memory baseline content cache for reviewed files.
- Full refresh uses Git to discover changed paths instead of scanning and hashing the entire repository.
- Git commit history is no longer loaded during initial session startup.
- Per-decision Git checkpoints are disabled by default; manual checkpoints remain available.

### Reliability
- Fixed `ENOENT` errors under `globalStorage/.../snapshots` by creating storage directories once before workers start.
- Snapshot fallback now runs only for workspace folders that are not covered by Git.
- Git-ignored files are skipped by the fast baseline path instead of being misclassified as newly created files.
- Accepted deletions are tracked as baseline tombstones so lazy Git resolution does not resurrect them.

### Compatibility
- Non-Git workspaces keep the classic snapshot mode.
- Multi-root workspaces can run in hybrid mode: Git-fast for repositories and snapshots only for uncovered folders.

## 0.6.0

### Brand
- Renamed the project and UI to **CodeBender**.
- Added `codeBender.*` commands and settings.
- Kept command aliases for earlier local `claudeChangeReview.*` / `patchPilot.*` workflows where possible.

### Review
- Added previous/next hunk navigation.
- Added **Accept + Stage** for safe partial staging.
- Added **Undo Last Decision** with Git index restoration for staged decisions.
- Added best-effort per-hunk origin metadata: manual, agent, or mixed.
- Added Explorer badges for pending review files.
- Added persistent review session summaries and review log.

### Agents
- Added built-in Gemini CLI and OpenCode adapters.
- Added configurable custom CLI adapters.
- Added selectable prompt context: block, nearby context, or full file.
- Sending feedback records the review comment and selects that agent as the current change source.

### Git
- New checkpoints use `refs/codebender/...`.
- Legacy `refs/claude-change-review/...` cleanup remains supported.
- Partial staging refuses to overwrite an index that differs from the CodeBender review baseline.

### Quality
- 38 automated tests pass.
- Added tests for safe partial staging, index restoration, custom adapters, origin attribution merging, navigation, and session summaries.

## 0.5.0
- Pause/resume tracking.
- Visible Git state/history.
- Review checkpoints and safe content rollback.
- Inline hunk review and terminal feedback flow.
