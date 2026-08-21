[English](README.md) | [Español](README.es.md) | [简体中文](README.zh-CN.md)

> **0.7.5 behavior:** the **Review Changes** tree now offers `✓ Accept all changes in file` and `↶ Reject all changes in file` as optional file-level bulk shortcuts. Inline review remains strictly hunk-scoped.

> **0.7.4 behavior:** keeps the 0.7.3 new-change-only review gate and fixes **Request correction** so the selected block feedback reaches the coding agent as one terminal message.


> **0.7.2 fix:** opening a file does not create phantom whole-file changes when Git and the working tree use different line endings. Review decisions remain hunk-scoped.

# CodeBender

**Human-in-the-loop code review for AI coding agents — directly inside VS Code.**

CodeBender turns edits made by AI coding agents into reviewable inline change blocks inside the original source file. You can accept or reject each block independently, optionally stage accepted code, send a block back to an agent with feedback, navigate pending changes, and keep lightweight Git-backed review history.

> CodeBender is provider-neutral. It can work with Claude Code, Codex, Kimi Code, Gemini CLI, OpenCode, the active VS Code terminal, or a custom CLI adapter.

## What CodeBender is for

AI coding agents can modify many files very quickly. CodeBender adds a human approval layer between those edits and the final state of your codebase.

```text
AI coding agent
      ↓
changes workspace files
      ↓
CodeBender detects changed blocks
      ↓
┌────────────────────────────────────────────┐
│  AI: Claude Code · block 2/5              │
│                                            │
│  ✓ Accept     ⎇ Accept + Stage            │
│  ↶ Reject     💬 Request correction        │
│                                            │
│  changed code                              │
└────────────────────────────────────────────┘
      ↓
human decision
      ↓
Git / agent feedback loop
```

The goal is similar to the block-by-block review experience used by AI coding assistants, while staying provider-neutral and using public VS Code extension APIs.

---

## What's new in CodeBender 0.7.2

Version 0.7.2 keeps the fast Git-first startup from 0.7.0 and restores the review model to **strict block-level decisions**.

### Block-level review with optional file bulk shortcuts

Inline review remains strictly hunk-scoped. Open a file and decide directly on each hunk:

- **Accept** — accepts only the selected block.
- **Accept + Stage** — accepts and stages only the selected block.
- **Reject** — restores only the selected block.
- **Request correction** — sends only that block back to the configured agent.

From the **Review Changes** tree, CodeBender also offers two explicit bulk shortcuts for normal files: **Accept all changes in file** and **Reject all changes in file**. These shortcuts decide every pending block in that file without opening it; they do not change the per-block behavior of the inline controls.

A fully deleted file is treated as one deletion block because there is no source document left in which to render CodeLens controls; the tree exposes block actions for that special case.

### Fixed Accept + Stage

The 0.7.0 fast baseline could differ from the real Git index when work already existed before the review session. The old safety check rejected those cases too aggressively.

0.7.2 now applies the selected review hunk onto the **current Git index content**, instead of replacing the staged file with the full review baseline. This preserves unrelated staged changes and does not stage pre-existing unstaged work. If the selected block overlaps an incompatible staged/pre-session change, CodeBender aborts before writing the index.

### Automated regression tests

The source archive now includes Node tests covering independent hunks, Accept + Stage, pre-existing staged and unstaged changes, insertions, deletions, and safe conflict handling.

---

## What's new in CodeBender 0.7.0

Version 0.7.0 focuses on **startup performance, Git-first versioning, and snapshot reliability**.

### Git-first lazy baseline

In a Git workspace, CodeBender no longer copies the entire project into VS Code global storage when a review session starts.

#### Clean repository

CodeBender can reuse the current `HEAD` as the review baseline.

```text
Start Review Session
        ↓
Git repository detected
        ↓
working tree is clean
        ↓
HEAD becomes baseline
        ↓
ready
```

No full-project backup is required.

#### Repository with pre-existing local changes

If you already have uncommitted work, CodeBender preserves the exact starting state using an **isolated temporary Git index** and an internal checkpoint.

```text
HEAD
 +
pre-existing working-tree changes
        ↓
temporary Git index
        ↓
CodeBender baseline checkpoint
```

The real Git staging area is not used to create that checkpoint.

#### Lazy content loading

Original file content is loaded only when that file actually becomes relevant to a review decision.

For example, if a repository contains 10,000 files and the coding agent modifies 4 files, CodeBender does not need to read and copy all 10,000 source files first.

```text
10,000-file Git repository
        ↓
Git baseline
        ↓
agent modifies auth.ts
        ↓
load baseline for auth.ts only
        ↓
calculate review blocks
```

### Faster refresh

For Git-backed roots, CodeBender asks Git for changed paths instead of blindly rescanning and hashing the entire workspace whenever possible.

### Reliable snapshot fallback

Folders not covered by Git still use the file-snapshot engine. In 0.7.0:

- snapshot storage directories are created before concurrent workers start;
- snapshot and undo directories are initialized once rather than repeatedly per file;
- common generated/dependency folders remain excluded by default;
- the previous `ENOENT ... globalStorage/.../snapshots/...` startup race is avoided.

### Less automatic Git work

`codeBender.git.checkpointOnDecision` now defaults to `false`.

Accepting or rejecting every individual block therefore does not automatically create another Git checkpoint unless you explicitly enable that behavior.

---

## Core features

### Inline block review

Independent changes in the same source file stay independent review decisions.

Each pending hunk can expose CodeLens actions directly above the changed code and a marker in the editor gutter.

- **Accept** — keep only that block as part of the review baseline.
- **Accept + Stage** — accept the block and safely stage the resulting accepted state when the Git safety checks pass.
- **Reject** — restore only that block to its baseline state.
- **Request correction** — build feedback for the block and send it to a selected coding-agent terminal.

Example:

```text
file: src/auth.ts

✓ Accept   ⎇ Accept + Stage   ↶ Reject   💬 Request correction
──────────────────────────────────────────────────────────────
Block 1
changed authentication logic

...

✓ Accept   ⎇ Accept + Stage   ↶ Reject   💬 Request correction
──────────────────────────────────────────────────────────────
Block 2
changed validation logic
```

Accepting or rejecting Block 1 does not automatically decide Block 2.

### Gutter indicators

Pending inline changes are marked in the editor gutter so you can see where review decisions remain without opening a traditional full-file diff view.

### Explorer badges

Files with pending review changes can receive a badge in the VS Code Explorer.

Disable them with:

```json
{
  "codeBender.explorer.badges": false
}
```

### Change navigation

Default shortcuts:

| Action | Windows / Linux | macOS |
|---|---|---|
| Next pending change | `Alt+Shift+Down` | `Alt+Shift+Down` |
| Previous pending change | `Alt+Shift+Up` | `Alt+Shift+Up` |
| Undo last decision | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

### Undo review decisions

**CodeBender: Undo Last Decision** restores the previous CodeBender review state.

For an `Accept + Stage` decision, CodeBender also records enough Git-index state to restore the previous index entry when possible.

---

## Git integration and versioning

CodeBender uses Git for two different purposes:

1. **Review baseline / checkpoints** — internal versioning that should not move your current branch or `HEAD`.
2. **Accept + Stage** — an explicit action that intentionally updates the real Git index for the accepted state.

### Internal checkpoints

CodeBender checkpoints can live under internal refs such as:

```text
refs/codebender/<session>/checkpoints/00001
```

Creating a CodeBender checkpoint does not require switching branches.

### Temporary Git index

Checkpoint creation uses a temporary `GIT_INDEX_FILE` so normal staged work is not replaced just to capture a CodeBender baseline.

Conceptually:

```text
Your normal index
      │
      └── untouched by checkpoint creation

CodeBender
      │
      └── temporary index → tree → internal checkpoint
```

### Accept + Stage safety

`Accept + Stage` intentionally modifies Git's real index for the selected accepted state.

Before doing so, CodeBender checks whether the existing index for that file still matches the review baseline it expects. If the state is ambiguous, the operation is refused rather than silently overwriting unrelated staged work.

### Git Timeline

The Git-related view can expose:

- current branch;
- staged / modified / untracked counts;
- recent normal Git commits;
- CodeBender internal checkpoints.

### Recommended Git workflow

```text
Start Review Session
        ↓
agent edits code
        ↓
review inline blocks
        ├── Accept
        ├── Accept + Stage
        ├── Reject
        └── Request correction
        ↓
all intended blocks reviewed
        ↓
run tests / build
        ↓
commit using your normal Git workflow
        ↓
push only when you choose
```

CodeBender does not need to automatically `push` your code.

---

## Agent feedback loop

CodeBender can send a selected review block back to a coding agent with reviewer feedback.

The generated context can include:

- workspace and file path;
- changed line range;
- original block;
- current block;
- reviewer annotation;
- optional nearby context or full-file context.

By default, CodeBender inserts the generated prompt into the selected integrated terminal **without automatically pressing Enter**.

This keeps the user in control before the agent receives the instruction.

### Built-in agent adapters

- Claude Code
- Codex
- Kimi Code
- Gemini CLI
- OpenCode
- Active integrated terminal

### Custom CLI adapter

Add custom agents through `settings.json`:

```json
{
  "codeBender.agent.adapters": [
    {
      "id": "my-agent",
      "label": "My Agent",
      "command": "my-agent-cli",
      "matchers": ["my agent", "my-agent"]
    }
  ]
}
```

CodeBender itself does not require an Anthropic, OpenAI, Moonshot, Google, or other AI API key.

---

## Change attribution

CodeBender supports best-effort attribution for review blocks, such as:

- **Manual**
- a selected coding agent
- **Mixed** when overlapping edits are associated with more than one source

Use **CodeBender: Select Change Source** to indicate who is producing the next edits.

Sending feedback to an agent can also switch the active source to that agent.

> VS Code does not expose a cryptographically reliable signal identifying exactly which external process wrote each character. Attribution is therefore best-effort and should not be treated as audit-grade authorship evidence.

---

## Pause and resume tracking

Pause CodeBender when you want to make manual edits that should not automatically become new review blocks.

When tracking resumes, edits made during the pause can be incorporated into the baseline according to the configured conflict strategy.

Available strategies:

- `ask`
- `keep-pending`
- `absorb-all`

---

## Review sessions

The **Review Sessions** view stores lightweight session summaries such as:

- accepted decisions;
- rejected decisions;
- staged decisions;
- feedback sent;
- undo operations;
- pending files when the session ended.

The active session is persisted so CodeBender can recover review state after a VS Code restart.

---

## Installation

### Install the packaged VSIX

1. Download `codebender-0.7.2.vsix`.
2. Open VS Code.
3. Press `Ctrl+Shift+P`.
4. Run **Extensions: Install from VSIX...**.
5. Select `codebender-0.7.2.vsix`.
6. Run **Developer: Reload Window** if VS Code requests it.

From a shell with the VS Code CLI:

```bash
code --install-extension codebender-0.7.2.vsix
```

### Upgrade from an earlier version

Install the new VSIX over the existing extension and reload VS Code.

Before testing a new development build on important repositories, it is still recommended to have a normal Git commit or another independent backup of valuable work.

### Run from source

```bash
git clone <your-codebender-repository>
cd codebender
npm run check
code .
```

Then press `F5` to launch an Extension Development Host.

The 0.7.2 source archive includes the extension source, validation script, and automated Node regression tests. Run `npm test` to execute them.

---

## Quick start

1. Open a project folder in VS Code.
2. Open the **CodeBender** activity-bar view.
3. Click **Start Review Session**.
4. If Git is available and `codeBender.git.fastBaseline` is enabled, CodeBender initializes the Git-first baseline.
5. Let Claude Code or another coding agent edit the workspace.
6. Open a changed source file.
7. Review the inline blocks using **Accept**, **Accept + Stage**, **Reject**, or **Request correction**.
8. Navigate remaining changes from the editor or CodeBender views.
9. Finish the review session when the intended changes are resolved.
10. Commit using your normal Git workflow when appropriate.

---

## Recommended workflow with Claude Code

```text
Open Git repository
        ↓
Start CodeBender Review Session
        ↓
Select source: Claude Code
        ↓
Claude edits files
        ↓
CodeBender marks inline blocks
        ↓
┌───────────────────────────────┐
│ ✓ Accept                      │
│ ⎇ Accept + Stage             │
│ ↶ Reject                      │
│ 💬 Request correction         │
└───────────────────────────────┘
        ↓
Claude can correct rejected block
        ↓
review remaining blocks
        ↓
tests / build
        ↓
Git commit
```

---

## Settings

| Setting | Default | Purpose |
|---|---:|---|
| `codeBender.excludeGlob` | generated/dependency folders | Paths excluded from snapshot fallback/session scanning |
| `codeBender.maxFileSizeMB` | `10` | Maximum file size handled for backup/restoration |
| `codeBender.maxFiles` | `20000` | Maximum files considered in a session |
| `codeBender.confirmReject` | `true` | Confirm full-file or reject-all operations |
| `codeBender.inlineReview.enabled` | `true` | Enable inline block review |
| `codeBender.inlineReview.showCodeLens` | `true` | Show review controls above hunks |
| `codeBender.inlineReview.maxLines` | `25000` | Inline diff line limit |
| `codeBender.explorer.badges` | `true` | Show pending-change Explorer badges |
| `codeBender.git.enabled` | `true` | Enable Git checkpoints and staging integration |
| `codeBender.git.fastBaseline` | `true` | Use Git-first lazy baseline when available |
| `codeBender.git.checkpointOnDecision` | `false` | Create a Git checkpoint after every review decision |
| `codeBender.git.maxCheckpoints` | `100` | Maximum session checkpoints displayed |
| `codeBender.git.historyLimit` | `20` | Recent Git commits displayed |
| `codeBender.pause.conflictStrategy` | `ask` | Resolve edits made while tracking was paused |
| `codeBender.agent.default` | `ask` | Default agent / adapter |
| `codeBender.agent.autoCreateTerminal` | `false` | Create an agent terminal if one is missing |
| `codeBender.agent.executePrompt` | `false` | Automatically press Enter after inserting feedback |
| `codeBender.agent.contextMode` | `block+context` | Feedback context: block, nearby context, or file |
| `codeBender.agent.contextLines` | `40` | Nearby context line count |
| `codeBender.agent.maxFragmentChars` | `12000` | Maximum prompt fragment length |

### Recommended performance settings

For normal Git repositories:

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true,
  "codeBender.git.checkpointOnDecision": false,
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

---

## Performance model

### Git repository

Preferred 0.7.0 path:

```text
Start session
   ↓
detect Git
   ↓
resolve baseline
   ↓
watch for relevant changes
   ↓
load baseline content lazily per changed file
```

This avoids the old pattern of eagerly reading, hashing, and writing a physical copy of every file in a Git repository.

### Non-Git folder

Fallback path:

```text
Start session
   ↓
create snapshot storage safely
   ↓
scan allowed files
   ↓
store baseline snapshots
   ↓
watch for changes
```

For best performance in non-Git projects, keep generated folders and dependency trees excluded.

---

## Privacy and security

CodeBender is designed to be local-first:

- no CodeBender backend is required;
- no CodeBender telemetry service is implemented by the extension;
- no AI API key is required by CodeBender itself;
- Git-first baselines are stored through local Git objects/internal refs;
- file snapshots are used as a fallback for non-Git/uncovered folders;
- agent feedback is sent only to the selected integrated terminal or configured CLI adapter;
- checkpoint creation uses temporary Git indexes rather than replacing the user's normal index.

The coding agent itself may have its own network, telemetry, retention, and privacy behavior. CodeBender does not change the privacy guarantees of Claude Code, Codex, Kimi Code, Gemini CLI, OpenCode, or custom tools.

---

## Safety model

### CodeBender does not need to use destructive Git commands for normal review

The review design avoids relying on broad destructive operations such as:

```text
git reset --hard
git clean -fd
git checkout .
```

for ordinary block-level review decisions.

### Existing staged work

Checkpoint creation uses an isolated index. `Accept + Stage` is different: it explicitly targets the real Git index, so CodeBender performs a baseline compatibility check before staging.

### Independent backup still recommended

CodeBender is an early-stage extension. Git remains the primary source-control system, and important work should still be committed or backed up independently before testing development builds.

---

## Troubleshooting

### Session startup previously failed with `ENOENT ... /snapshots/*.bin`

The 0.7.0 snapshot fallback initializes its storage directories before concurrent snapshot work begins. In Git repositories, the fast baseline also avoids full-project snapshot creation in the normal path.

After upgrading:

1. Install `codebender-0.7.2.vsix`.
2. Run **Developer: Reload Window**.
3. Open a Git-backed project.
4. Start a new review session.
5. Keep `codeBender.git.fastBaseline` enabled.

### Startup is still slow

Check whether the current workspace is actually inside a Git repository.

For Git repositories, verify:

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true
}
```

For non-Git folders, review `codeBender.excludeGlob` and avoid snapshotting dependency/build directories.

### Inline controls do not appear

Verify:

```json
{
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

Then save the changed file and run **CodeBender: Refresh Changes** if necessary.

### A deleted file has no inline buttons

A deleted file has no current editor document to decorate. Deleted files remain reviewable from the CodeBender side view.

### `Accept + Stage` is refused

This is intentional when the existing Git index does not match the review baseline. The safety check prevents CodeBender from overwriting ambiguous pre-existing staged work.

---

## Known limitations

- The private inline UI used internally by GitHub Copilot is not a public reusable VS Code extension component. CodeBender reproduces the review workflow using public APIs such as CodeLens, editor decorations, gutter icons, Tree Views, file decorations, terminals, and Git.
- Change attribution is best-effort rather than cryptographically reliable.
- Binary files and files above configured limits may be handled at file level instead of line/hunk level.
- Deleted files cannot display inline controls in a document that no longer exists.
- `Accept + Stage` intentionally refuses ambiguous index states.
- Multi-root workspaces can use a hybrid of Git-backed and snapshot-backed roots.

---

## Architecture

```text
VS Code Extension Host
│
├── Session / baseline engine
│   ├── Git-first lazy baseline
│   ├── non-Git snapshot fallback
│   ├── baseline content cache
│   ├── hunk engine
│   └── pause / resume
│
├── Inline review UX
│   ├── CodeLens actions
│   ├── gutter markers
│   ├── line decorations
│   ├── Explorer badges
│   ├── Review Changes
│   └── Review Sessions
│
├── Git integration
│   ├── temporary index checkpoints
│   ├── internal refs
│   ├── Git Timeline
│   ├── safe partial staging
│   └── decision rollback
│
└── Agent adapters
    ├── Claude Code
    ├── Codex
    ├── Kimi Code
    ├── Gemini CLI
    ├── OpenCode
    ├── Active terminal
    └── Custom CLI
```

CodeBender has no runtime npm dependencies.

---

## Development

Validate JavaScript syntax with:

```bash
npm run check
```

The current 0.7.2 source archive includes automated Node regression tests for hunk independence and partial Git staging. Run `npm test` to execute them.

Recommended development flow:

```bash
npm run check
code .
```

Then press `F5` to run an Extension Development Host and test the review workflow on a disposable Git repository.

---

## Project status

CodeBender is an early open-source project. Version 0.7.2 is intended for active testing and iteration. Use normal Git commits or another independent backup for important work while evaluating development builds.

## Roadmap

- richer inline feedback threads;
- closer Copilot-like inline interaction using public VS Code APIs;
- better automatic agent-turn detection where supported;
- faster non-Git snapshot fallback;
- more robust multi-root session UX;
- test/build validation attached to accepted blocks;
- commit-message generation from accepted review history;
- session-level accepted/rejected change reports;
- optional MCP adapter layer;
- more language-aware context extraction;
- Marketplace packaging and release automation.

## Contributing

Issues and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](LICENSE).

## Trademark / affiliation

CodeBender is an independent open-source project. It is not affiliated with or endorsed by GitHub, Microsoft, Anthropic, OpenAI, Moonshot AI, Google, or OpenCode.
