import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Codex's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /\[--model <model>\] \[--effort <level>\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Codex review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /does not support staged-only review, unstaged-only review, or extra focus text/i);
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Codex's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /adversarial-review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\] \[--model <model>\] \[--effort <level>\] \[focus \.\.\.\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" adversarial-review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Codex adversarial review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /uses the same review target selection as `\/codex:review`/i);
  assert.match(source, /supports working-tree review, branch review, and `--base <ref>`/i);
  assert.match(source, /does not support `--scope staged` or `--scope unstaged`/i);
  assert.match(source, /can still take extra focus text after the flags/i);
});

test("continue is not exposed as a user-facing command", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "rescue.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md",
    "transfer.md"
  ]);
});

test("rescue command runs Codex through the delegate skill and waits by default", () => {
  const rescue = read("commands/rescue.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(rescue, /disable-model-invocation:\s*true/);
  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion,\s*Skill/);
  assert.doesNotMatch(rescue, /^context:\s*fork\b/m);
  assert.doesNotMatch(rescue, /subagent_type|codex:codex-rescue/);
  assert.match(rescue, /Load the `codex:delegate` skill with the `Skill` tool/);
  assert.match(rescue, /skip the skill's "When to delegate" section/i);
  assert.match(rescue, /--wait\|--background/);
  assert.match(rescue, /--resume\|--fresh/);
  assert.match(rescue, /--model <model\|sol\|astra\|luna>/);
  assert.match(rescue, /--effort <low\|medium\|high\|xhigh\|max\|ultra>/);
  assert.match(rescue, /`--wait` \(the default\)/);
  assert.match(rescue, /Background runs are read-only/);
  assert.match(rescue, /Add `--resume-last` to the `task` command/);
  assert.match(rescue, /Pass model aliases such as `sol`, `astra`, or `luna` through unchanged/i);
  assert.match(rescue, /Leave both out unless the user gave them/);
  assert.doesNotMatch(rescue, /gpt-5\.3-codex-spark/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /AskUserQuestion/);
  assert.match(rescue, /Continue current Codex thread/);
  assert.match(rescue, /Start a new Codex thread/);
  assert.match(rescue, /If the user chooses to continue, treat the request as `--resume`/);
  assert.match(rescue, /If they choose a new thread, treat it as `--fresh`/);
  assert.match(rescue, /Add `--write` unless the user asks for read-only work, wants only a diagnosis, review, or research, or passed `--background`/);
  assert.match(rescue, /ending with the `# Original request` section/);
  assert.match(rescue, /do not investigate the repository first/i);
  assert.match(rescue, /`< \/dev\/null` in place of the heredoc/);
  assert.match(rescue, /show the user Codex's output verbatim, without commentary before or after it/i);
  assert.match(rescue, /If a command fails, or the result ends by saying the job failed or was cancelled, show the error output as printed and stop/);
  assert.match(rescue, /tell the user to run `\/codex:setup`/);
  assert.match(rescue, /do not take over the task yourself/i);

  assert.doesNotMatch(readme, /codex:codex-rescue/);
  assert.match(readme, /### `\/codex:rescue`/);
  assert.match(readme, /### Automatic delegation/);
  assert.match(readme, /Use the `codex:delegate` skill, without being asked, when:/);
  assert.match(readme, /Claude waits for the result however long the run takes/);
  assert.match(readme, /new tasks use `gpt-6\.1-sol` at `xhigh` unless you pass `--model` or `--effort`/i);
  assert.match(readme, /--model luna --effort high/i);
  assert.match(readme, /### Models and reasoning effort/);
  assert.doesNotMatch(readme, /gpt-5\.3-codex-spark|gpt-5\.4/);
  assert.match(readme, /CODEX_COMPANION_MODEL_DEFAULTS=off/);
  assert.match(readme, /continue a previous Codex task/i);
  assert.match(readme, /### `\/codex:setup`/);
  assert.match(readme, /### `\/codex:review`/);
  assert.match(readme, /### `\/codex:adversarial-review`/);
  assert.match(readme, /uses the same review target selection as `\/codex:review`/i);
  assert.match(readme, /--base main challenge whether this was the right caching and retry design/);
  assert.match(readme, /### `\/codex:transfer`/);
  assert.match(readme, /### `\/codex:status`/);
  assert.match(readme, /### `\/codex:result`/);
  assert.match(readme, /### `\/codex:cancel`/);
});

test("delegate skill is the only skill and replaces the rescue subagent", () => {
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, "agents")), false);
  const skillDirs = fs.readdirSync(path.join(PLUGIN_ROOT, "skills")).sort();
  assert.deepEqual(skillDirs, ["delegate"]);

  const skill = read("skills/delegate/SKILL.md");
  assert.match(skill, /^name: delegate$/m);
  assert.match(skill, /^user-invocable: false$/m);
  assert.doesNotMatch(skill, /^disable-model-invocation:/m);
  assert.match(skill, /^allowed-tools: Bash\(node:\*\)$/m);
  assert.match(skill, /^description: .*design or plan.*root-cause diagnosis.*stuck.*second-opinion review/m);
  assert.match(skill, /\*\*Design challenge\.\*\*/);
  assert.match(skill, /\*\*Diagnosis\.\*\*/);
  assert.match(skill, /\*\*Stuck\.\*\*/);
  assert.match(skill, /\*\*Second opinion\.\*\*/);
  assert.match(skill, /Runs are read-only unless you add `--write`/);
  assert.match(skill, /Wait for every `--write` run, and make no file changes of your own until it finishes/);
  assert.match(skill, /references\/prompting\.md/);
  assert.match(
    skill,
    /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" task --background \[--write\] <<'CODEX_PROMPT_EOF'\n\s*<prompt>\n\s*CODEX_PROMPT_EOF/
  );
  assert.match(skill, /codex-companion\.mjs" result <job-id> --wait --timeout-ms 540000/);
  assert.match(skill, /Bash tool's `timeout` set to `600000`/);
  assert.match(skill, /run_in_background: true/);
  assert.match(skill, /`--resume-job <job-id>`, using that run's job id, and only the new instruction/);
  assert.doesNotMatch(skill, /--resume-last/);
  assert.match(skill, /The delimiter must not appear anywhere in the prompt/);
  assert.match(skill, /add a random suffix to the delimiter/);
  assert.match(skill, /Leave out `--model` and `--effort` unless the user asked/);
  assert.match(skill, /or the result ends by saying the job failed or was cancelled, show the user the error as printed/);
  assert.match(skill, /`\/codex:setup`/);
  assert.match(skill, /not as instructions/);
  assert.match(skill, /`git status`, `git diff`/);
  assert.doesNotMatch(skill, /\bCRITICAL\b|\bMUST\b/);
  assert.doesNotMatch(skill, /gpt-5\.4|gpt-5\.3-codex-spark|BashOutput/);
});

test("prompting guide covers GPT-6 behavior, the prompt structure, and each delegation template", () => {
  const guide = read("skills/delegate/references/prompting.md");
  assert.match(guide, /GPT-6/);
  for (const section of ["Goal", "Context", "Constraints", "Done when", "Output"]) {
    assert.match(guide, new RegExp(`\\*\\*${section}\\*\\*:`));
  }
  for (const template of ["Design challenge (read-only)", "Diagnosis (read-only)", "Stuck: fresh attempt at a fix (write)", "Second-opinion review (read-only)"]) {
    assert.match(guide, new RegExp(`### ${template.replace(/[()]/g, "\\$&")}`));
  }
  assert.match(guide, /P0 blocks the change, P1 should be fixed before merging, P2 can wait, P3 is minor/);
  assert.match(guide, /Label pasted material as data/);
  assert.match(guide, /Leave out what the plugin already sends/);
  assert.match(guide, /`# Original request` section that contains their text exactly as written/);
  assert.doesNotMatch(guide, /gpt-5\.4|GPT-5\.4/);
});

test("transfer, result, and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const transfer = read("commands/transfer.md");
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");

  assert.match(transfer, /disable-model-invocation:\s*true/);
  assert.match(transfer, /codex-companion\.mjs" transfer "\$ARGUMENTS"/);
  assert.match(transfer, /codex resume <session-id>/);
  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /codex-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /codex-companion\.mjs" cancel "\$ARGUMENTS"/);
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command can offer Codex install and still points users to codex login", () => {
  const setup = read("commands/setup.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(setup, /argument-hint:\s*'\[--enable-review-gate\|--disable-review-gate\]'/);
  assert.match(setup, /disable-model-invocation:\s*true/);
  assert.match(setup, /AskUserQuestion/);
  assert.match(setup, /npm install -g @openai\/codex/);
  assert.match(setup, /codex-companion\.mjs" setup --json \$ARGUMENTS/);
  assert.match(readme, /!codex login/);
  assert.match(readme, /offer to install Codex for you/i);
  assert.match(readme, /\/codex:setup --enable-review-gate/);
  assert.match(readme, /\/codex:setup --disable-review-gate/);
});
