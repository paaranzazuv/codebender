# CodeBender 0.7.2

Maintenance release focused on inline hunk accuracy.

## Fixed

- Opening a file no longer marks the whole file as changed when Git stores LF but the working tree/editor uses CRLF.
- BOM-only representation differences no longer create phantom hunks.
- Rejecting a hunk preserves the working file's line-ending style.
- `Accept + Stage` remains block-scoped across LF/CRLF differences and lets Git apply path-specific clean filters.

## Validation

The automated suite includes regression coverage for multiple independent hunks, partial staging, pre-existing staged/unstaged work, insertions, deletions, LF/CRLF and BOM handling.
