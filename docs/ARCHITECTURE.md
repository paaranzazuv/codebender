# Architecture

CodeBender is a VS Code extension with no runtime npm dependencies.

## Modules

- `extension.js` — VS Code integration, sessions, UI, inline controls, undo, attribution.
- `hunks.js` — line-preserving Myers diff and per-hunk accept/reject transformations.
- `git-versioning.js` — internal checkpoint commits, history/status and content restoration.
- `git-staging.js` — safe index-level staging and index-state restoration.
- `agent-send.js` — built-in/custom agent adapters and prompt construction.
- `tracking-pause.js` — pause/resume reconciliation logic.
- `review-state.js` — pure origin, navigation and session-summary logic.

## Baseline model

A review session snapshots the starting workspace. Pending hunks are computed between the current baseline and current file content. Accepting a hunk advances only that part of the baseline; rejecting a hunk restores only that part of the current file.

## Git checkpoints

Checkpoint commits are created with a temporary `GIT_INDEX_FILE` and stored under `refs/codebender/...`, preventing checkpoint creation from modifying the real index.

## Partial staging

For `Accept + Stage`, CodeBender first verifies that the real index version of the file matches the current review baseline. It then writes the accepted state as the index blob. If the index differs, the operation is refused.

## Attribution

The extension tracks a user-selected current change source and merges source metadata when overlapping hunks evolve. This is best-effort metadata, not cryptographic authorship evidence.
