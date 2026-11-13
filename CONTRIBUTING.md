# Contributing

Bug reports and feature requests go in [issues](https://github.com/camadkins/obsidian-canvas-connect/issues). For a bug, say what you did, what you expected, and your Obsidian version.

## Building

```
bun install
bun run build
```

Copy `main.js` and `manifest.json` into `.obsidian/plugins/canvas-connect/` in a test vault and reload Obsidian.

## Pull requests

- Branch from `main` as `fix/issue-<n>-<slug>` or `feat/issue-<n>-<slug>`
- Keep it to one change and make sure `bun run build` passes
- Say how you tested it in the PR
