# CodeBender 0.7.7

This maintenance release fixes a restart false-positive in Git-fast sessions.

- If a persisted session was missing the data a Git-fast/hybrid baseline needs (`baselineMode`, or a repo's `baselineCommit`) — for example a `session.json` written by an older CodeBender build — reopening VS Code would silently fall back to a full-workspace snapshot comparison. Because a Git-fast baseline only tracks files that were actually touched, every other file then looked newly "created", flagging the whole repository as pending.
- CodeBender now checks that a persisted session's baseline data is actually usable before restoring it. If it is not, the session is discarded instead of being loaded into a broken state, and you are prompted to start a new review session.
- Added regression tests for the new check, verified against the exact kind of persisted session that triggered the bug.
