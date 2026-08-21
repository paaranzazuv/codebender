# CodeBender 0.7.4

This release fixes the **Request correction** feedback path to coding-agent terminals.

## Fixed

- Multiline prompts are sent as one bracketed-paste transaction, preventing Claude Code and other interactive CLIs from interpreting embedded newlines as separate messages.
- The reviewer instruction is now the first actionable instruction in the prompt.
- The prompt explicitly tells the agent to modify only the selected pending block and leave all other pending blocks untouched.
- Terminal control characters are removed from reviewer-authored text before transport.

## Preserved

- Git-first fast startup.
- New-change-only inline gating.
- Block-level Accept, Reject and Accept + Stage.
- LF/CRLF and BOM normalization.
