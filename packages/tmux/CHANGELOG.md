# Changelog

## [0.4.0](https://github.com/chaineapp/weaver/compare/v0.3.0...v0.4.0) (2026-04-27)


### Features

* **cli:** in-Ghostty F12 menu + restart-planner + agent-binary swap ([00e7cee](https://github.com/chaineapp/weaver/commit/00e7ceea0695646749f22e8cee04261611e99f03))
* **cli:** planner-left + workers-grid-right layout for weave up ([cbeb153](https://github.com/chaineapp/weaver/commit/cbeb153c6ae08eec5bc4bb31687ce0b5fc3b91a1))
* **cli:** show project name in tmux status bar ([269ca45](https://github.com/chaineapp/weaver/commit/269ca45e56c137a34ef9810ca8e5488bb2d562d2))
* **cli:** tabs over windows in Ghostty + interactive weave new + spider banner ([12a4d1b](https://github.com/chaineapp/weaver/commit/12a4d1be7ea320d92c0b3589d5badd1e01ea8ed6))
* **dispatch:** worker dispatch via Bash + per-project planner binary ([a4771d0](https://github.com/chaineapp/weaver/commit/a4771d08e795576bf7917a0c20fe3977555eb5a3))
* per-project CLAUDE.md so planners actually know about Weaver ([9d172e5](https://github.com/chaineapp/weaver/commit/9d172e5e3edcecc4ad8175807296f5e7539b0bf4))
* **tmux:** thin wrappers around tmux CLI + Ghostty launcher ([6a4976a](https://github.com/chaineapp/weaver/commit/6a4976a0f87c6ba78053c4f383f1ec8a88f3e755))


### Bug Fixes

* --cwd dispatch + CHA-1150 + CHA-1151 + dispatch-discipline brief ([f3b83de](https://github.com/chaineapp/weaver/commit/f3b83de022275cfd8c5b93e24edbe0d78876387a))
* **cli:** weave up bugs that broke the planner launch + add e2e tests + cleanup ([f1a737a](https://github.com/chaineapp/weaver/commit/f1a737a62f667a2197e512cbeafac1114ad87196))
* **test:** isolate tmux socket so tests cannot touch user's real sessions ([33aafd9](https://github.com/chaineapp/weaver/commit/33aafd96bc354c196ed6e46a184211b15bf4a080))
* **tmux:** mouse on + focus-events on + planner gets focus on up ([8095d7b](https://github.com/chaineapp/weaver/commit/8095d7b36f20e870395a05bd0b9c0187324afd89))
* **tmux:** pass Ghostty -e args as separate argv, not a joined string ([43887cf](https://github.com/chaineapp/weaver/commit/43887cfeab9655652e6aefc169bcbfed20ded5ae))
* **tmux:** use absolute tmux path in Ghostty -e command ([410bfad](https://github.com/chaineapp/weaver/commit/410bfada5e3f418211a830d2b2fb174802ac04c5))
