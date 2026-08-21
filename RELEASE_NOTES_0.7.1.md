# CodeBender 0.7.1

## Block-level review restored

- Review actions are now exposed at hunk/block level instead of whole-file level.
- Whole-file Accept/Reject actions were removed from the normal Review Changes UI.
- Fully deleted files are treated as a single deletion block and keep block-level actions in the tree because no editor document remains.

## Accept + Stage fixed

- Partial staging now applies only the selected review hunk to the current Git index.
- Existing unrelated staged changes in the same file are preserved.
- Pre-existing unstaged work is not automatically staged.
- Ambiguous or overlapping changes abort safely before the Git index is modified.

## Validation

- Added automated Node regression tests for independent hunks, partial staging, staged/unstaged pre-session work, insertions, deletions, and conflict handling.
- Keeps the Git-first fast startup introduced in 0.7.0.
