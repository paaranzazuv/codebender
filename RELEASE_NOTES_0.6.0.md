# CodeBender 0.6.0

CodeBender 0.6.0 turns the earlier proof of concept into a provider-neutral human-in-the-loop review layer for coding agents.

## Main additions

- CodeBender branding and public `codeBender.*` commands/settings.
- Accept / Reject / Request correction per inline block.
- **Accept + Stage** with safe partial Git staging.
- Undo review decisions, including prior index state for staged blocks.
- Next/previous change navigation.
- Best-effort AI / manual / mixed block attribution.
- Claude Code, Codex, Kimi Code, Gemini CLI, OpenCode and custom CLI adapters.
- Review Sessions and review log.
- Explorer badges.
- Persistent session recovery, pause/resume and Git checkpoints retained.

## Install

```bash
code --install-extension codebender-0.6.0.vsix
```

For users of the pre-CodeBender local VSIX builds, see `MIGRATION.md`.
