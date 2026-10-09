# Changelog

## 2.0.0 (unreleased)

First release of this fork of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).

- Published through the `trevoraspencer` marketplace, with updated plugin metadata.
- Updated model handling for the current Codex models:
  - Added the model aliases `sol` (`gpt-6.1-sol`), `astra` (`gpt-6-astra`), and `luna` (`gpt-6-luna`).
  - Reasoning effort accepts `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. `none` and `minimal` are no longer accepted, because current models do not support them.
  - The `spark` alias, whose model has been retired, now fails with a suggested replacement.
- Added per-command model defaults: both review commands use `gpt-6-astra` at `xhigh`, and tasks use `gpt-6.1-sol` at `xhigh`. This includes the optional stop-time review gate, which runs as a task. Resumed tasks keep their thread's model and effort unless new ones are requested. Set `CODEX_COMPANION_MODEL_DEFAULTS=off` to use your Codex configuration instead.
- `/codex:review` and `/codex:adversarial-review` accept `--model` and `--effort`.
- Threads started or resumed by the plugin receive developer instructions: runs are non-interactive, Codex is told not to create or switch branches, worktrees, commits, stashes, or pull requests, and write-capable runs are told to leave uncommitted changes they did not make intact.
- The resume prompt finishes the earlier task without starting unrelated work.
- The adversarial review prompt treats repository content as material under review rather than instructions.
- Requires Node.js 22 or later.

Versions 1.0.0 through 1.0.6 were released upstream; only 1.0.0 has an entry here.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
