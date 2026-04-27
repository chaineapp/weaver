# Changelog

## [0.4.0](https://github.com/chaineapp/weaver/compare/v0.3.0...v0.4.0) (2026-04-27)


### Features

* **autoroute:** per-block options syntax (binary/bypass/model/cwd) ([e79a99e](https://github.com/chaineapp/weaver/commit/e79a99e4266727cb48dd9827e537f44daff6ac07))
* **clean:** --close-windows flag closes orphan Ghostty tabs ([8bfb5d6](https://github.com/chaineapp/weaver/commit/8bfb5d65a31b18f617161c89601c7bd2de20acc6))
* **cli:** config, version check, first-run wizard, richer help ([3c79705](https://github.com/chaineapp/weaver/commit/3c79705b3829bcb14e941b3ac65c86ec44920305))
* **cli:** in-Ghostty F12 menu + restart-planner + agent-binary swap ([00e7cee](https://github.com/chaineapp/weaver/commit/00e7ceea0695646749f22e8cee04261611e99f03))
* **cli:** planner-left + workers-grid-right layout for weave up ([cbeb153](https://github.com/chaineapp/weaver/commit/cbeb153c6ae08eec5bc4bb31687ce0b5fc3b91a1))
* **cli:** show project name in tmux status bar ([269ca45](https://github.com/chaineapp/weaver/commit/269ca45e56c137a34ef9810ca8e5488bb2d562d2))
* **cli:** tabs over windows in Ghostty + interactive weave new + spider banner ([12a4d1b](https://github.com/chaineapp/weaver/commit/12a4d1be7ea320d92c0b3589d5badd1e01ea8ed6))
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
* workers run real interactive codex/claude TUI by default ([09e85ec](https://github.com/chaineapp/weaver/commit/09e85ecc0e4ff55f70eab0f334e8175bcd968298))


### Bug Fixes

* --cwd dispatch + CHA-1150 + CHA-1151 + dispatch-discipline brief ([f3b83de](https://github.com/chaineapp/weaver/commit/f3b83de022275cfd8c5b93e24edbe0d78876387a))
* **autoroute:** read claude session log instead of pipe-paned TUI; surgical eval cleanup ([1f3f328](https://github.com/chaineapp/weaver/commit/1f3f328fb7388106210ae193b5b7c67d7c7175cc))
* **autoroute:** seed processed-set on startup so historical blocks don't refire ([e0e70b2](https://github.com/chaineapp/weaver/commit/e0e70b2b995b2e46b98a1aaeb383d7d51ada6f27))
* **cli:** weave up bugs that broke the planner launch + add e2e tests + cleanup ([f1a737a](https://github.com/chaineapp/weaver/commit/f1a737a62f667a2197e512cbeafac1114ad87196))
* **dispatch:** --cwd defaults to caller's process.cwd() ([8691ab1](https://github.com/chaineapp/weaver/commit/8691ab162665a972eb66563acd790a128fd3edbf))
* **dispatch:** kill running codex/claude in pane before re-dispatch ([cdf9562](https://github.com/chaineapp/weaver/commit/cdf95629b03e9030b9dee6c1cbf24d972d0e7ebe))
* **dispatch:** reset tail offset on dispatch (was reading stale events) ([e803611](https://github.com/chaineapp/weaver/commit/e803611f0790d8d7ef3b1bafb7383e6d02b3c032))
* **panes:** mkdir-spinlock around panes.json read-modify-write ([3b9ed4d](https://github.com/chaineapp/weaver/commit/3b9ed4de7b2a9f19996a00e0b98c68616ad16c63))
* **spawn:** always pass --skip-git-repo-check to codex workers ([5365715](https://github.com/chaineapp/weaver/commit/53657152935a544fb929e4c061aa6351b1077000))
* **tail:** skip codex status lines (`• Booting MCP server` etc) when extracting ([7c1bbd0](https://github.com/chaineapp/weaver/commit/7c1bbd08e56d8251b9376789b3d16ba9b5a9236d))
* **tail:** TUI capture + extract codex response marker, skip placeholder prompts ([15d9732](https://github.com/chaineapp/weaver/commit/15d973212acacf350085427451a24a275e305b34))
* **test:** clean-isolation guards behind WEAVER_RUN_CLEAN_ISOLATION + skipIf ([5e3a18f](https://github.com/chaineapp/weaver/commit/5e3a18ffc7c9172541e341e7f977fbe3fcf90a59))
* **test:** isolate tmux socket so tests cannot touch user's real sessions ([33aafd9](https://github.com/chaineapp/weaver/commit/33aafd96bc354c196ed6e46a184211b15bf4a080))
* **test:** pin e2e fake repo's initial branch to main ([2a9e231](https://github.com/chaineapp/weaver/commit/2a9e231619523d19c0c0a9891513dd778106c650))
* **tmux:** mouse on + focus-events on + planner gets focus on up ([8095d7b](https://github.com/chaineapp/weaver/commit/8095d7b36f20e870395a05bd0b9c0187324afd89))
* **tmux:** pass Ghostty -e args as separate argv, not a joined string ([43887cf](https://github.com/chaineapp/weaver/commit/43887cfeab9655652e6aefc169bcbfed20ded5ae))
* **tmux:** use absolute tmux path in Ghostty -e command ([410bfad](https://github.com/chaineapp/weaver/commit/410bfada5e3f418211a830d2b2fb174802ac04c5))
* **up:** friendly error when planner binary exits immediately ([ea72cb8](https://github.com/chaineapp/weaver/commit/ea72cb87b5cbf5b63c9736e9a8001f907ac51f22))


### Performance

* **tail:** fast-path wait-done on codex `•` marker (cuts ~25s of dead wait) ([9033f23](https://github.com/chaineapp/weaver/commit/9033f2351202be9ed7425274f6f0f99450d48245))


### Refactoring

* rip out autoroute (replaced by Claude Code plugin) ([85cb34e](https://github.com/chaineapp/weaver/commit/85cb34e5070bba02e6cbfd80d39ba515eda4faa2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @weaver/codex-adapter bumped to 0.4.0
    * @weaver/core bumped to 0.4.0
    * @weaver/mcp-orchestrator bumped to 0.4.0
    * @weaver/tmux bumped to 0.4.0
