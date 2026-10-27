import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { teardownBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

// Each test process gets its own plugin data folder, so brokers the companion starts during the
// tests are recorded there instead of in the real plugin data folder. They are stopped on exit,
// because nothing else ends a broker once the test that started it has finished.
const TEST_PLUGIN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plugin-test-data-"));
// The calling Claude session's companion variables would otherwise leak into tests: a session ID
// filters job lookups, and CLAUDE_ENV_FILE would let a SessionStart hook write into that session.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("CODEX_COMPANION_") || key === "CLAUDE_ENV_FILE") {
    delete process.env[key];
  }
}
process.env.CLAUDE_PLUGIN_DATA = TEST_PLUGIN_DATA_DIR;
process.on("exit", stopTestBrokersAndCleanUp);

function stopTestBrokersAndCleanUp() {
  const stateRoot = path.join(TEST_PLUGIN_DATA_DIR, "state");
  if (fs.existsSync(stateRoot)) {
    for (const entry of fs.readdirSync(stateRoot)) {
      const stateFile = path.join(stateRoot, entry, "broker.json");
      if (!fs.existsSync(stateFile)) {
        continue;
      }
      try {
        const record = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        teardownBrokerSession({
          endpoint: record.endpoint ?? null,
          pidFile: record.pidFile ?? null,
          logFile: record.logFile ?? null,
          sessionDir: record.sessionDir ?? null,
          pid: record.pid ?? null,
          killProcess: terminateProcessTree
        });
      } catch {
        // A broker that is already gone has nothing left to stop.
      }
    }
  }
  fs.rmSync(TEST_PLUGIN_DATA_DIR, { recursive: true, force: true });
}

export function makeTempDir(prefix = "codex-plugin-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeExecutable(filePath, source) {
  fs.writeFileSync(filePath, source, { encoding: "utf8", mode: 0o755 });
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    shell: options.shell ?? (process.platform === "win32" && !path.isAbsolute(command)),
    windowsHide: true
  });
}

export function initGitRepo(cwd) {
  run("git", ["init", "-b", "main"], { cwd });
  run("git", ["config", "user.name", "Codex Plugin Tests"], { cwd });
  run("git", ["config", "user.email", "tests@example.com"], { cwd });
  run("git", ["config", "commit.gpgsign", "false"], { cwd });
  run("git", ["config", "tag.gpgsign", "false"], { cwd });
}
