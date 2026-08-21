# Publishing CodeBender

## Before release

```bash
npm test
npm run check
```

Update:

- `package.json` version
- `CHANGELOG.md`
- release notes

Package the VSIX with the official VS Code extension packaging tooling when publishing to Marketplace.

The package currently uses:

```text
publisher: paaranzazuv
name: codebender
```

The Marketplace publisher must exist and be controlled by the maintainer before publication.

Recommended Git release flow:

```bash
git tag -a v0.6.0 -m "CodeBender v0.6.0"
git push origin v0.6.0
```

Attach `release/codebender-0.6.0.vsix` and the source ZIP to the GitHub release.
