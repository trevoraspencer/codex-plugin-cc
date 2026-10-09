---
description: Hand a task to Codex and wait for its answer
argument-hint: "[--wait|--background] [--resume|--fresh] [--model <model|sol|astra|luna>] [--effort <low|medium|high|xhigh|max|ultra>] [what Codex should investigate, solve, or continue]"
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion, Skill
---

Hand the user's request below to Codex. Load the `codex:delegate` skill with the `Skill` tool and follow its prompt and run steps, using the choices in this command. The user asked for Codex directly, so skip the skill's "When to delegate" section.

Raw user request:
$ARGUMENTS

If the request has no task text and no `--resume`, ask the user what Codex should investigate or fix.

## Flags

Remove these flags from the task text before writing the prompt.

- `--wait` (the default): wait for the result before replying.
- `--background`: start the run, then run the skill's wait command with `run_in_background: true`. Tell the user the job id and that `/codex:status` shows progress, and show the result when it arrives. Background runs are read-only.
- `--resume`: continue the latest Codex task thread. Add `--resume-last` to the `task` command.
- `--fresh`: start a new Codex thread.
- `--model` and `--effort`: add them to the `task` command unchanged. Pass model aliases such as `sol`, `astra`, or `luna` through unchanged; the companion resolves them and rejects values it does not support. Leave both out unless the user gave them.

## Thread

If the request has neither `--resume` nor `--fresh`, check for a Codex thread from this Claude session that could be continued:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task-resume-candidate --json
```

- If it reports `available: true`, use `AskUserQuestion` once to ask whether to continue that thread or start a new one, with the choices `Continue current Codex thread` and `Start a new Codex thread`. Put `Continue current Codex thread (Recommended)` first when the request is a follow-up such as "continue", "keep going", "apply the top fix", or "dig deeper"; otherwise put `Start a new Codex thread (Recommended)` first.
- If the user chooses to continue, treat the request as `--resume`. If they choose a new thread, treat it as `--fresh`.
- If it reports `available: false`, start a new thread without asking.

## Write access

Add `--write` unless the user asks for read-only work, wants only a diagnosis, review, or research, or passed `--background`.

## Prompt

- For a new thread, restructure the request into a Codex prompt as the skill's prompting guide describes, ending with the `# Original request` section. Use what this conversation already shows as context; do not investigate the repository first, because Codex will.
- For `--resume`, send the user's text as the new instruction, unchanged. If there is no text, run the command with `< /dev/null` in place of the heredoc.

## Reply

- When the result arrives, show the user Codex's output verbatim, without commentary before or after it.
- If a command fails, or the result ends by saying the job failed or was cancelled, show the error output as printed and stop. If the error says Codex is not installed or not signed in, tell the user to run `/codex:setup`.
- If Codex fails or stops short, report that and let the user decide what to do next; do not take over the task yourself.
