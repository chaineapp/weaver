# Contributing

## Commits

Conventional Commits (https://www.conventionalcommits.org/). The release automation reads every commit message on main and decides version bumps from it, so the prefix matters.

| Prefix | What | Release effect |
|---|---|---|
| `feat:` | New user-visible capability | Minor bump (0.x.0 → 0.(x+1).0) |
| `fix:` | Bug fix | Patch bump (0.x.y → 0.x.(y+1)) |
| `perf:` | Performance improvement | Patch bump |
| `refactor:` | Code restructure, no behavior change | No release |
| `docs:` | Docs only | No release, but shows in CHANGELOG |
| `test:` | Tests only | No release |
| `ci:`, `build:`, `chore:` | Infra / tooling | Hidden from CHANGELOG |
| `feat!:` or `BREAKING CHANGE:` footer | Breaks users | Major bump (once out of 0.x) |

Scope is optional: `feat(cli): ...`, `fix(tmux): ...`.

Examples:

```
feat(cli): weave up --bypass for claude dangerous permissions
fix(tmux): strip % from run file names — strftime eats them
feat!: project ids are now name-derived, ulid removed
```

## Release flow

1. PR merges to main with conventional-commit title / messages.
2. [release-please](.github/workflows/release.yml) opens a `chore(release): release vX.Y.Z` PR with:
   - Version bumps in every `package.json`
   - Updated `CHANGELOG.md` entries
   - `.release-please-manifest.json` bumped
3. Merge that PR.
4. release-please tags `vX.Y.Z` on main and creates a GitHub Release with the generated notes.

No manual version bumps. No hand-written changelogs.

## Local dev

```bash
bun install
bun test
bun run typecheck
bun link      # makes `weave` available globally from this checkout
```

Push to main directly — solo push-to-main is fine per AGENTS.md. When collaborating, open a PR and let release-please do its thing on merge.

## Scopes to use

- `cli` — `weave` user-facing commands
- `core` — `@weaver/core` workspace, project, memory, cleanup
- `tmux` — tmux/ghostty wrappers, layout
- `mcp` — mcp-orchestrator tools + server
- `codex` — codex-adapter (JSONL parser/summarizer)
- `ci` — GitHub Actions, release automation
