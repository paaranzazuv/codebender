# CodeBender 0.7.0

This release focuses on startup performance and snapshot reliability.

## What changed

- Git-first lazy baselines replace full-project copies for Git workspaces.
- Clean repositories reuse HEAD directly.
- Dirty repositories preserve the exact starting worktree in an isolated temporary-index checkpoint.
- Baseline contents are loaded and cached only for files that actually change.
- Full refresh asks Git for changed paths.
- Non-Git and uncovered multi-root folders still use snapshot fallback.
- Snapshot storage directories are created before concurrent work begins, fixing the observed `ENOENT` failure.
- Automatic checkpoint-after-every-decision is now off by default to reduce repeated Git work.
