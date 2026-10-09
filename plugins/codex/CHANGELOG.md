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
- Replaced the `codex:codex-rescue` subagent and its helper skills with a `codex:delegate` skill. Claude now runs the companion itself, so errors such as an unsupported model reach the user instead of being dropped by the forwarding subagent.
- Claude can consult Codex on its own for design challenges, diagnoses, fresh attempts when it is stuck, and second-opinion reviews. Runs it starts are read-only unless it asks Codex to make a change, and it waits for any run that can edit files. The README includes rules you can add to `CLAUDE.md`.
- `/codex:rescue` turns the request into a structured Codex prompt that ends with the original wording, waits for the result by default, and runs read-only with `--background`. Claude no longer invokes `/codex:rescue` or `/codex:setup` on its own.
- Replaced the GPT-5.4 prompting guidance with guidance for GPT-6 models.
- Delegated prompts are passed through a quoted heredoc, so the shell no longer expands backticks or `$(...)` in a request.
- `result` accepts `--wait` and `--timeout-ms` to wait for a running job to finish.
- `task` accepts `--resume-job <job-id>` to continue the Codex thread of a specific earlier run, so a follow-up reaches the right thread when several runs have finished.
- Reading a prompt from stdin no longer fails when the caller's stdin is non-blocking and empty, as in Claude Code's Bash tool.
- Requires Node.js 22 or later.

Versions 1.0.0 through 1.0.6 were released upstream; only 1.0.0 has an entry here.

## 1.0.0

- Initial version of the Codex plugin for Claude Code
