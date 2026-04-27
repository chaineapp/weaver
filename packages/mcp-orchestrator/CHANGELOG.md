# Changelog

## [0.4.0](https://github.com/chaineapp/weaver/compare/v0.3.0...v0.4.0) (2026-04-27)


### Features

* **cli:** config, version check, first-run wizard, richer help ([3c79705](https://github.com/chaineapp/weaver/commit/3c79705b3829bcb14e941b3ac65c86ec44920305))
* **cli:** in-Ghostty F12 menu + restart-planner + agent-binary swap ([00e7cee](https://github.com/chaineapp/weaver/commit/00e7ceea0695646749f22e8cee04261611e99f03))
* complete P1 MVP — core, mcp-orchestrator, cli, seed playbooks ([abcedd3](https://github.com/chaineapp/weaver/commit/abcedd3f8342c7b93975b24ebbf2071cc1ae2ed1))
* **dispatch:** worker dispatch via Bash + per-project planner binary ([a4771d0](https://github.com/chaineapp/weaver/commit/a4771d08e795576bf7917a0c20fe3977555eb5a3))
* human-readable project ids + --bypass for claude permissions ([6948dff](https://github.com/chaineapp/weaver/commit/6948dffa2dea39f87ce9d8190d899519eaaace4f))
* **memory:** MCP tools for the memory layer + auto-remember playbook ([a097b0d](https://github.com/chaineapp/weaver/commit/a097b0df5dbefdff3570083e4d46947f0ab9f29f))
* **v0.2:** global state, auto-registered projects, auto-loop primitive ([ba949b9](https://github.com/chaineapp/weaver/commit/ba949b9ec83bdd07d6a17e02dd74647868c2f1bc))
* **v0.3:** Session-as-top-level, workspaces + projects, auto-worktree creation ([faee851](https://github.com/chaineapp/weaver/commit/faee851cf18a67b4a6c25fbd53cd4c7106befc9d))
* workers run real interactive codex/claude TUI by default ([09e85ec](https://github.com/chaineapp/weaver/commit/09e85ecc0e4ff55f70eab0f334e8175bcd968298))


### Bug Fixes

* --cwd dispatch + CHA-1150 + CHA-1151 + dispatch-discipline brief ([f3b83de](https://github.com/chaineapp/weaver/commit/f3b83de022275cfd8c5b93e24edbe0d78876387a))
* **dispatch:** buildCodexCommand handles claude binary with -p flag ([12dc79c](https://github.com/chaineapp/weaver/commit/12dc79cf3a07bf3b61745500b1bb0d3d1b1f26e3))
* **spawn:** always pass --skip-git-repo-check to codex workers ([5365715](https://github.com/chaineapp/weaver/commit/53657152935a544fb929e4c061aa6351b1077000))
* **tail:** TUI capture + extract codex response marker, skip placeholder prompts ([15d9732](https://github.com/chaineapp/weaver/commit/15d973212acacf350085427451a24a275e305b34))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @weaver/codex-adapter bumped to 0.4.0
    * @weaver/core bumped to 0.4.0
    * @weaver/tmux bumped to 0.4.0
