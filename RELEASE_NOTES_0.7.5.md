# CodeBender 0.7.5

## Bulk file actions from Review Changes

CodeBender 0.7.5 adds two quick actions directly to each normal file in the **Review Changes** tree:

- **Accept all changes in file** (`✓`) — accepts every pending review block in that file without opening it.
- **Reject all changes in file** (`↶`) — restores that file to the session baseline without opening it. The existing reject confirmation still applies when enabled.

These are intentionally **file-level bulk shortcuts**. They do not change the inline model: when a file is opened, **Accept**, **Accept + Stage**, **Reject**, and **Request correction** still operate on one selected block at a time.

A fully deleted file continues to use its existing deletion-block actions in the tree.
