# CodeBender 0.7.3

This maintenance release fixes startup false-positive review blocks.

- Starting a session never exposes review actions for pre-existing content.
- Opening or activating a file does not create a change.
- Only changes registered after the session starts receive inline Accept, Accept + Stage, Reject and correction actions.
- Open documents, including unsaved buffers, are captured as part of the session baseline.
- Keeps Git-first startup, CRLF/BOM normalization, block-level review and partial staging.
