# Migrating from Claude Change Review 0.5.x to CodeBender 0.6.0

CodeBender is the new public project identity.

The extension package identifier changes to `paaranzazuv.codebender`. Because the previous builds were local development packages, VS Code may keep both installed.

Recommended migration:

1. Finish or discard any active review session in the old extension.
2. Uninstall **Claude Change Review** from VS Code.
3. Install `codebender-0.6.0.vsix`.
4. Reload VS Code.
5. Start a fresh CodeBender review session.

CodeBender still registers compatibility command aliases for `claudeChangeReview.*` and `patchPilot.*` during the 0.6 line, but old extension storage is not automatically migrated across extension IDs.
