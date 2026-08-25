<p align="center">
  <img src="media/icon.png" alt="CodeBender" width="112" />
</p>

<h1 align="center">CodeBender</h1>

<p align="center">
  <strong>Human-in-the-loop code review for AI coding agents, directly inside VS Code.</strong>
</p>

<p align="center">
  Review AI-generated edits as independent inline blocks. Accept, reject, stage, or send a specific block back to the agent without losing control of the rest of the file.
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%5E1.85.0-007ACC?logo=visualstudiocode&logoColor=white" />
  <img alt="Version" src="https://img.shields.io/badge/version-0.7.7-4C8BF5" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="Git-first" src="https://img.shields.io/badge/baseline-Git--first-F05032?logo=git&logoColor=white" />
  <img alt="Provider neutral" src="https://img.shields.io/badge/agents-provider--neutral-7B61FF" />
</p>

---

## Why CodeBender

AI coding agents can change a codebase faster than a human can comfortably review it. The problem is not generating code — it is keeping **precise human control over what actually stays**.

CodeBender adds a review layer between an AI agent and your workspace:

```text
AI coding agent
      ↓
modifies workspace files
      ↓
CodeBender detects only new session changes
      ↓
┌──────────────────────────────────────────────┐
│ Block 1                                      │
│ ✓ Accept   ⎇ Accept + Stage   ↶ Reject      │
│ 💬 Request correction                        │
└──────────────────────────────────────────────┘
      ↓
┌──────────────────────────────────────────────┐
│ Block 2                                      │
│ ✓ Accept   ⎇ Accept + Stage   ↶ Reject      │
│ 💬 Request correction                        │
└──────────────────────────────────────────────┘
      ↓
human-controlled result
```

A file with three independent edits remains **three independent review decisions**.

CodeBender is designed to feel close to the block-review workflow popularized by AI coding assistants while remaining **provider-neutral** and built on public VS Code extension APIs.

---

## Highlights

### Review changes block by block

Each new hunk can be reviewed directly in the original source file:

- **Accept** — keep only the selected block.
- **Accept + Stage** — accept and stage only that block.
- **Reject** — restore only that block to the session baseline.
- **Request correction** — send only that block, its context, and your instruction back to the selected coding agent.

Accepting one block does not automatically accept the rest of the file.

### Bulk actions without opening the file

The **Review Changes** view also exposes optional file-level shortcuts:

```text
src/auth.ts                         ✓   ↶
src/api/users.ts                    ✓   ↶
src/components/Login.tsx            ✓   ↶
```

- `✓` **Accept all changes in file**
- `↶` **Reject all changes in file**

These are explicit bulk actions. Inline review remains hunk-scoped.

### Git-first startup

For Git repositories, CodeBender avoids copying the whole project before a session begins.

```text
Start Review Session
        ↓
Git repository detected
        ↓
clean tree? ── yes ──→ reuse HEAD as baseline
        │
        no
        ↓
capture exact starting state with isolated Git index
        ↓
ready
```

Original content is loaded lazily only for files that become relevant to the review.

### New-change-only review

The session baseline is frozen when you press **Start Review Session**.

Opening, activating, switching to, or merely viewing a file does **not** create review actions. CodeBender only decorates changes that appear after the session starts.

### Safe partial staging

`Accept + Stage` operates on the selected hunk rather than staging the complete file. Existing staged work is preserved when the selected block can be applied safely.

If CodeBender detects an unsafe overlap, it stops before mutating the Git index.

### Send a block back to the agent

`Request correction` sends one structured message containing:

- your instruction first;
- the selected file and block;
- the changed code;
- minimal surrounding context;
- explicit rules not to rewrite unrelated pending blocks.

Multiline prompts are sent as a single terminal input using bracketed paste semantics.

---

## Supported coding agents

CodeBender is provider-neutral. Built-in terminal adapters support:

| Agent | Default command |
|---|---|
| Claude Code | `claude` |
| OpenAI Codex | `codex` |
| Kimi Code | `kimi` |
| Gemini CLI | `gemini` |
| OpenCode | `opencode` |
| Active terminal | Existing VS Code terminal |
| Custom CLI | Configurable adapter |

CodeBender does not require an API key for these integrations. It talks to the agent through the local terminal workflow you already use.

---

## Installation

### Install from VSIX

1. Download `codebender-0.7.7.vsix`.
2. Open VS Code.
3. Press `Ctrl+Shift+P` / `Cmd+Shift+P`.
4. Run **Extensions: Install from VSIX...**.
5. Select the downloaded file.
6. Run **Developer: Reload Window** if VS Code does not reload automatically.

### Requirements

- VS Code `1.85.0` or newer.
- Git is strongly recommended for the fast baseline, history, checkpoints, and partial staging features.
- A supported local coding-agent CLI is optional and only required for **Request correction**.

---

## Quick start

### 1. Open a project

Open the project folder — not only an individual file.

### 2. Start a review session

Run:

```text
CodeBender: Iniciar sesión de revisión
```

The current workspace state becomes the session baseline.

### 3. Let your coding agent work

Use Claude Code, Codex, Kimi, Gemini CLI, OpenCode, another terminal agent, or edit manually.

### 4. Review only the new blocks

Inside the changed file:

```text
✓ Accept   ⎇ Accept + Stage   ↶ Reject   💬 Request correction
──────────────────────────────────────────────────────────────
changed block
```

Or use the **Review Changes** side view to accept/reject all pending blocks of one file without opening it.

### 5. Continue until no pending changes remain

You can then continue working, create a Git checkpoint, inspect history, or finish the session.

---

## Review model

### The session baseline

CodeBender always compares new work against the state captured when the review session started.

That starting point may already contain:

- committed code;
- unstaged edits;
- staged edits;
- open editor buffers with unsaved content.

Those pre-existing states are treated as **baseline**, not as new AI changes.

### Hunk isolation

If a file contains separate edits:

```text
Block A   → pending
Block B   → pending
Block C   → pending
```

then:

```text
Accept A
Reject B
Accept + Stage C
```

produces three independent decisions. CodeBender does not intentionally collapse them into a single file-level decision.

### Deleted files

A fully deleted file has no editor buffer in which to render CodeLens actions. CodeBender therefore represents a complete deletion as one deletion block in **Review Changes**, where it can be accepted, accepted + staged, or rejected.

---

## Review Changes view

The side view is intended to answer two questions quickly:

1. **Which files still contain pending review blocks?**
2. **Do I want to review this file block-by-block or decide all its remaining blocks at once?**

For a normal changed file:

```text
src/services/user.ts       3 blocks        ✓   ↶
```

- Click the file → open it and review blocks inline.
- Click `✓` → accept all pending blocks in that file.
- Click `↶` → reject all pending blocks in that file.

Bulk actions affect only the selected file.

---

## Inline editor experience

CodeBender uses VS Code decorations, gutter indicators, and CodeLens controls to keep review decisions near the changed code.

### Gutter markers

Pending blocks receive a gutter indicator so review locations remain visible while navigating the source.

### Navigation

| Action | Windows / Linux | macOS |
|---|---|---|
| Next pending change | `Alt+Shift+Down` | `Alt+Shift+Down` |
| Previous pending change | `Alt+Shift+Up` | `Alt+Shift+Up` |
| Undo last decision | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

### Explorer badges

Files with pending review work can display a badge in the normal VS Code Explorer.

Disable it with:

```json
{
  "codeBender.explorer.badges": false
}
```

---

## Accept + Stage

`Accept + Stage` is intentionally different from `git add <file>`.

It is designed to stage **only the accepted review block**.

Example:

```text
src/auth.ts

Block 1 → Accept + Stage
Block 2 → pending
Block 3 → pending
```

Expected Git state:

```text
STAGED
└── Block 1

WORKING TREE
├── Block 2
└── Block 3
```

### Index safety

CodeBender reads the current Git index, applies the selected review hunk to that indexed content, and writes the updated index only when the operation is unambiguous.

This design helps preserve:

- staged work that existed before CodeBender;
- unrelated staged blocks;
- unstaged work that predates the session;
- pending CodeBender blocks in the same file.

---

## Git-first baseline and versioning

CodeBender uses Git for two separate purposes.

### 1. Review baseline and checkpoints

Internal review state can be represented by Git objects and internal refs without moving your branch.

Conceptually:

```text
refs/codebender/<session>/checkpoints/<id>
```

### 2. Explicit staging

Only `Accept + Stage` intentionally updates the real Git index.

### Clean repository

When possible, CodeBender reuses `HEAD` directly as the baseline.

### Repository with local work

If the workspace already contains uncommitted changes, CodeBender can capture the exact starting state through an isolated temporary `GIT_INDEX_FILE`.

```text
real Git index        → preserved
CodeBender temp index → baseline tree/checkpoint
```

This prevents baseline creation from replacing your staging area.

---

## Non-Git workspaces

Git is recommended but not required.

Folders outside Git use the snapshot fallback engine. CodeBender:

- excludes common dependency/build folders;
- limits snapshot size and file count;
- creates snapshot storage before concurrent workers start;
- avoids the previous `globalStorage/.../snapshots/... ENOENT` race;
- preserves the starting state needed for block rejection.

Default exclusions include folders such as `.git`, `node_modules`, `.next`, `dist`, `build`, `target`, `vendor`, virtual environments, and coverage output.

---

## Request correction

Use **Request correction** when a generated block is close, but not correct enough to accept.

The default message focuses the agent on the selected pending block:

```text
Reviewer correction request

Instruction: <your feedback>
File: <workspace-relative path>
Pending block: <type and current lines>

Rules:
- Correct only this pending CodeBender block.
- Do not modify unrelated pending blocks.
- Work on the real workspace file.
```

### Context modes

```json
{
  "codeBender.agent.contextMode": "block+context",
  "codeBender.agent.contextLines": 40
}
```

Available modes:

- `block` — selected block only.
- `block+context` — selected block plus nearby lines.
- `file` — block plus full file content, subject to fragment limits.

For safety, CodeBender does not press Enter automatically unless explicitly enabled.

---

## Tracking controls

CodeBender can temporarily pause tracking when you need to make unrelated manual edits.

Commands:

```text
CodeBender: Pausar seguimiento
CodeBender: Reanudar seguimiento
CodeBender: Pausar/Reanudar seguimiento
```

Conflict behavior after resuming can be configured with:

```json
{
  "codeBender.pause.conflictStrategy": "ask"
}
```

Values:

- `ask`
- `keep-pending`
- `absorb-all`

---

## Configuration

Recommended starting configuration:

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true,
  "codeBender.git.checkpointOnDecision": false,
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true,
  "codeBender.explorer.badges": true,
  "codeBender.agent.default": "ask",
  "codeBender.agent.autoCreateTerminal": false,
  "codeBender.agent.executePrompt": false,
  "codeBender.agent.contextMode": "block+context",
  "codeBender.agent.contextLines": 40
}
```

### Important settings

| Setting | Default | Purpose |
|---|---:|---|
| `codeBender.git.enabled` | `true` | Enable Git checkpoints and staging integration. |
| `codeBender.git.fastBaseline` | `true` | Use lazy Git-backed session baselines. |
| `codeBender.git.checkpointOnDecision` | `false` | Avoid creating a Git checkpoint after every review action. |
| `codeBender.inlineReview.enabled` | `true` | Enable inline block review. |
| `codeBender.inlineReview.showCodeLens` | `true` | Show actions above pending blocks. |
| `codeBender.explorer.badges` | `true` | Show pending-change badges in Explorer. |
| `codeBender.confirmReject` | `true` | Confirm destructive file/all-change rejection. |
| `codeBender.agent.default` | `ask` | Choose the target coding agent. |
| `codeBender.agent.executePrompt` | `false` | Automatically press Enter after inserting agent feedback. |
| `codeBender.agent.contextMode` | `block+context` | Amount of code sent with correction feedback. |
| `codeBender.maxFileSizeMB` | `10` | Maximum file size handled by fallback snapshots. |
| `codeBender.maxFiles` | `20000` | Maximum files included in fallback sessions. |

See `package.json` for the complete configuration schema.

---

## Commands

Main commands available from the Command Palette:

| Command | Purpose |
|---|---|
| `CodeBender: Iniciar sesión de revisión` | Freeze the current state as the review baseline. |
| `CodeBender: Finalizar sesión` | Finish the active review session. |
| `CodeBender: Actualizar cambios` | Refresh pending changes. |
| `CodeBender: Pausar seguimiento` | Temporarily stop tracking new edits. |
| `CodeBender: Reanudar seguimiento` | Resume tracking. |
| `CodeBender: Siguiente cambio` | Navigate to the next pending block. |
| `CodeBender: Cambio anterior` | Navigate to the previous pending block. |
| `CodeBender: Deshacer última decisión` | Undo the most recent CodeBender decision. |
| `CodeBender: Ver resumen de sesión` | Show review-session statistics. |
| `CodeBender: Crear checkpoint Git` | Create an explicit internal Git checkpoint. |
| `CodeBender: Ver historial Git` | Inspect available Git history/checkpoints. |

Inline and tree-view actions provide the hunk/file-specific commands.

---

## Performance model

### Previous full-snapshot approach

A large repository could require:

```text
find files
  + stat files
  + read files
  + hash files
  + write snapshot copies
  + create Git checkpoint
```

### Current Git-first approach

For a clean Git repository:

```text
Git status
   ↓
HEAD baseline
   ↓
ready
```

If only four files change in a 10,000-file repository, CodeBender can focus review work on those files instead of duplicating the whole workspace first.

---

## Line endings and encoding

CodeBender normalizes comparison semantics so ordinary `LF` versus `CRLF` differences do not create phantom whole-file review blocks.

The review engine also avoids treating a UTF-8 BOM difference as a code change.

Opening a CRLF file whose Git baseline is LF should therefore produce **zero review blocks** until real content changes occur.

---

## Safety principles

CodeBender is intentionally conservative around destructive operations.

### It does not need to

- run `git reset --hard` to start a session;
- run `git clean` to manage review state;
- switch branches for internal checkpoints;
- replace your real Git index merely to create a baseline;
- accept an entire file when you choose an inline block action.

### Before a destructive bulk rejection

File-level rejection can be configured to require confirmation:

```json
{
  "codeBender.confirmReject": true
}
```

### Agent prompts

CodeBender inserts correction prompts into local terminals. Automatic execution is disabled by default:

```json
{
  "codeBender.agent.executePrompt": false
}
```

This gives you an opportunity to inspect the message before sending it.

---

## Architecture

```text
┌───────────────────────────────────────────────────────┐
│                       VS Code                         │
│                                                       │
│  Workspace ── File watchers ── Review-state gate      │
│      │                               │                │
│      │                               ▼                │
│      │                         Hunk engine             │
│      │                               │                │
│      │                  ┌────────────┴────────────┐   │
│      │                  │                         │   │
│      ▼                  ▼                         ▼   │
│ Git baseline       Inline review             Tree view│
│ / snapshots        + CodeLens                bulk ops │
│      │                  │                         │   │
│      └──────────────┬───┴──────────────┬─────────┘   │
│                     │                  │             │
│                Git staging       Agent feedback      │
│                     │                  │             │
│                     ▼                  ▼             │
│                  Git index        Local terminal     │
└───────────────────────────────────────────────────────┘
```

Core modules:

| Module | Responsibility |
|---|---|
| `extension.js` | VS Code lifecycle, commands, views, decorations, session orchestration. |
| `hunks.js` | Block detection and hunk-level operations. |
| `review-state.js` | New-change-only review gating and session review state. |
| `git-versioning.js` | Git-first baselines, checkpoints, history. |
| `git-staging.js` | Safe partial staging of accepted hunks. |
| `agent-send.js` | Agent selection, correction prompt construction, terminal transport. |
| `tracking-pause.js` | Pause/resume behavior and conflict handling. |

More detail is available in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Testing

From the source directory:

```bash
npm test
npm run check
```

The regression suite covers the critical review paths, including:

- independent hunks in the same file;
- hunk-level accept and reject;
- partial `Accept + Stage`;
- preservation of pre-existing staged/unstaged work;
- insertions and deletions;
- LF/CRLF handling;
- BOM handling;
- new-change-only review gating;
- agent prompt transport;
- file-level bulk accept/reject actions.

---

## Troubleshooting

### Opening a file shows changes even though I did not edit it

Make sure you are running a build that includes the new-change-only gate and EOL normalization. Current builds ensure that simply opening or activating a file does not create review actions.

If the problem persists, inspect repository-specific transformations such as `.gitattributes`, format-on-open/save extensions, generated files, or non-standard encodings.

### `Accept + Stage` fails

CodeBender intentionally aborts if the selected hunk cannot be applied safely to the current Git index. Check whether the same lines already contain staged or pre-session edits.

### `Request correction` appears as multiple terminal messages

0.7.4+ uses bracketed-paste transport for multiline prompts. Confirm that you are using the current build and that the target terminal supports standard bracketed paste behavior.

### Snapshot startup error: `ENOENT ... globalStorage/.../snapshots`

Current builds create snapshot directories before concurrent fallback workers start. Reload VS Code after updating from an older build.

### No inline controls appear

Check:

```json
{
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

Also confirm that a review session is active and that the edit happened after the session started.

---

## Project status

CodeBender is under active development. The current design focuses on dependable local review semantics before adding broader automation.

### Current priorities

- make hunk identity more resilient as agents repeatedly edit the same region;
- improve visual parity with native AI-edit review experiences;
- strengthen multi-root workspace behavior;
- improve agent attribution and session analytics;
- add richer Git checkpoint/history UX;
- expand automated integration coverage inside a real VS Code Extension Host.

---

## Contributing

Contributions, bug reports, reproducible edge cases, and design proposals are welcome.

Before opening a pull request, please read [`CONTRIBUTING.md`](CONTRIBUTING.md).

Useful reports include:

- VS Code version;
- operating system;
- Git version;
- whether the repository was clean or dirty at session start;
- line-ending configuration (`.gitattributes`, `core.autocrlf`);
- exact CodeBender action used;
- minimal reproduction steps.

---

## Security

Please do not publish sensitive vulnerability details in a public issue. See [`SECURITY.md`](SECURITY.md) for the project security process.

---

## License

CodeBender is released under the [MIT License](LICENSE).

---

<p align="center">
  <strong>Keep the speed of AI coding agents. Keep the final decision human.</strong>
</p>
