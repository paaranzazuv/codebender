# Security Policy

## Reporting a vulnerability

Please do not publish exploit details in a public issue before a maintainer has had a reasonable opportunity to investigate. Use the repository's private security-reporting channel when enabled.

## Security model

CodeBender manipulates working-tree files, review snapshots, integrated terminals and—only for explicit staging actions—the Git index. Contributions touching these surfaces should be reviewed carefully.

CodeBender does not require an external backend or AI API key. Third-party coding agents launched or used through the terminal have their own security and privacy models.
