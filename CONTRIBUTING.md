# Contributing to CodeBender

Thanks for helping build a provider-neutral human-in-the-loop review layer for coding agents.

## Local development

Requirements:

- VS Code 1.85+
- Node.js 18+
- Git

Run:

```bash
npm test
npm run check
```

Open the repository in VS Code and press `F5` to launch an Extension Development Host.

## Pull requests

Please keep changes focused and include tests for pure logic whenever possible. Changes involving Git must preserve existing staged work unless the action explicitly documents that it modifies the real index.

Before submitting:

```bash
npm test
npm run check
```

## Design principles

- Human approval before irreversible decisions.
- Local-first by default.
- Provider-neutral agent integration.
- No mandatory AI API keys.
- Git safety over convenience.
- Be explicit when attribution or automation is best-effort.
