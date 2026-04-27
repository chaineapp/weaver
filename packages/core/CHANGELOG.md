# Changelog

## [0.4.0](https://github.com/chaineapp/weaver/compare/v0.3.0...v0.4.0) (2026-04-27)


### Features

* **autoroute:** per-block options syntax (binary/bypass/model/cwd) ([e79a99e](https://github.com/chaineapp/weaver/commit/e79a99e4266727cb48dd9827e537f44daff6ac07))
* **cli:** config, version check, first-run wizard, richer help ([3c79705](https://github.com/chaineapp/weaver/commit/3c79705b3829bcb14e941b3ac65c86ec44920305))
* **cli:** in-Ghostty F12 menu + restart-planner + agent-binary swap ([00e7cee](https://github.com/chaineapp/weaver/commit/00e7ceea0695646749f22e8cee04261611e99f03))
* complete P1 MVP — core, mcp-orchestrator, cli, seed playbooks ([abcedd3](https://github.com/chaineapp/weaver/commit/abcedd3f8342c7b93975b24ebbf2071cc1ae2ed1))
* **dispatch:** worker dispatch via Bash + per-project planner binary ([a4771d0](https://github.com/chaineapp/weaver/commit/a4771d08e795576bf7917a0c20fe3977555eb5a3))
* human-readable project ids + --bypass for claude permissions ([6948dff](https://github.com/chaineapp/weaver/commit/6948dffa2dea39f87ce9d8190d899519eaaace4f))
* **memory:** MCP tools for the memory layer + auto-remember playbook ([a097b0d](https://github.com/chaineapp/weaver/commit/a097b0df5dbefdff3570083e4d46947f0ab9f29f))
* per-project CLAUDE.md so planners actually know about Weaver ([9d172e5](https://github.com/chaineapp/weaver/commit/9d172e5e3edcecc4ad8175807296f5e7539b0bf4))
* **plugin:** /weaver:dispatch-batch — Claude Code plugin replacing @@DISPATCH protocol ([98cbac8](https://github.com/chaineapp/weaver/commit/98cbac876439656e7767cda052f2c925c6347348))
* **up:** regenerate CLAUDE.md+AGENTS.md from latest template every run ([0695686](https://github.com/chaineapp/weaver/commit/06956865cd94e295aa2903a128237fd7e8d45fec))
* USER.md (Weaver philosophy + user voice) + eval framework ([e9f0b8b](https://github.com/chaineapp/weaver/commit/e9f0b8b0e7b373193558e1a3f623be2312f429e7))
* **v0.2:** global state, auto-registered projects, auto-loop primitive ([ba949b9](https://github.com/chaineapp/weaver/commit/ba949b9ec83bdd07d6a17e02dd74647868c2f1bc))
* **v0.3:** Session-as-top-level, workspaces + projects, auto-worktree creation ([faee851](https://github.com/chaineapp/weaver/commit/faee851cf18a67b4a6c25fbd53cd4c7106befc9d))
* weave autoroute — autonomous planner↔worker loop via structured blocks ([a8eb9f0](https://github.com/chaineapp/weaver/commit/a8eb9f05f4aa1ca934c506aa1221c617f7814ccb))


### Bug Fixes

* --cwd dispatch + CHA-1150 + CHA-1151 + dispatch-discipline brief ([f3b83de](https://github.com/chaineapp/weaver/commit/f3b83de022275cfd8c5b93e24edbe0d78876387a))
* **cli:** weave up bugs that broke the planner launch + add e2e tests + cleanup ([f1a737a](https://github.com/chaineapp/weaver/commit/f1a737a62f667a2197e512cbeafac1114ad87196))
* **core:** strip % from run file names (tmux pipe-pane strftime eats them) ([755f4c0](https://github.com/chaineapp/weaver/commit/755f4c04e38d83a6d96e2f74e7387a975c83b5f8))
* **dispatch:** --cwd defaults to caller's process.cwd() ([8691ab1](https://github.com/chaineapp/weaver/commit/8691ab162665a972eb66563acd790a128fd3edbf))
* **panes:** mkdir-spinlock around panes.json read-modify-write ([3b9ed4d](https://github.com/chaineapp/weaver/commit/3b9ed4de7b2a9f19996a00e0b98c68616ad16c63))
* pre-trust project dirs in codex config + clarify dispatch interpretation ([9ead4fc](https://github.com/chaineapp/weaver/commit/9ead4fc7d6b4f1ffbe526913a2ce13a96aa72370))


### Refactoring

* rip out autoroute (replaced by Claude Code plugin) ([85cb34e](https://github.com/chaineapp/weaver/commit/85cb34e5070bba02e6cbfd80d39ba515eda4faa2))


### Documentation

* **USER.md template:** teach planner the @@DISPATCH protocol ([df20c77](https://github.com/chaineapp/weaver/commit/df20c777d92ef78ac3c98d3ba8b711efdd821ba1))
* **USER.md:** note per-repo AGENTS.md/CLAUDE.md override pattern ([9c5b66e](https://github.com/chaineapp/weaver/commit/9c5b66e89ce9e902b4bac0e0df5478e0749a5333))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @weaver/codex-adapter bumped to 0.4.0
