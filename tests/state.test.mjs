import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTempDir } from "./helpers.mjs";
import { loadState, resolveJobFile, resolveJobLogFile, resolveStateDir, resolveStateFile, saveState, upsertJob } from "../plugins/codex/scripts/lib/state.mjs";

const STATE_MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugins/codex/scripts/lib/state.mjs");

test("resolveStateDir uses a temp-backed per-workspace directory", () => {
  const workspace = makeTempDir();
  const stateDir = resolveStateDir(workspace);

  assert.equal(stateDir.startsWith(os.tmpdir()), true);
  assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
  assert.match(stateDir, new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("resolveStateDir uses CLAUDE_PLUGIN_DATA when it is provided", () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(
      stateDir,
      new RegExp(`^${path.join(pluginDataDir, "state").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  } finally {
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("saveState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const jobs = Array.from({ length: 51 }, (_, index) => {
    const jobId = `job-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
    const logFile = resolveJobLogFile(workspace, jobId);
    const jobFile = resolveJobFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: "completed" }, null, 2), "utf8");
    return {
      id: jobId,
      status: "completed",
      logFile,
      updatedAt,
      createdAt: updatedAt
    };
  });

  fs.writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        version: 1,
        config: { stopReviewGate: false },
        jobs
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  saveState(workspace, {
    version: 1,
    config: { stopReviewGate: false },
    jobs
  });

  const prunedJobFile = resolveJobFile(workspace, "job-0");
  const prunedLogFile = resolveJobLogFile(workspace, "job-0");
  const retainedJobFile = resolveJobFile(workspace, "job-50");
  const retainedLogFile = resolveJobLogFile(workspace, "job-50");
  const jobsDir = path.dirname(prunedJobFile);

  assert.equal(fs.existsSync(retainedJobFile), true);
  assert.equal(fs.existsSync(retainedLogFile), true);

  const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(savedState.jobs.length, 50);
  assert.deepEqual(
    savedState.jobs.map((job) => job.id),
    Array.from({ length: 50 }, (_, index) => `job-${50 - index}`)
  );
  assert.deepEqual(
    fs.readdirSync(jobsDir).sort(),
    Array.from({ length: 50 }, (_, index) => `job-${index + 1}`)
      .flatMap((jobId) => [`${jobId}.json`, `${jobId}.log`])
      .sort()
  );
});

test("saveState keeps a running job when finished history exceeds the cap", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const jobs = Array.from({ length: 51 }, (_, index) => {
    const jobId = `job-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
    const logFile = resolveJobLogFile(workspace, jobId);
    const jobFile = resolveJobFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: index === 0 ? "running" : "completed" }, null, 2), "utf8");
    return {
      id: jobId,
      status: index === 0 ? "running" : "completed",
      logFile,
      updatedAt,
      createdAt: updatedAt
    };
  });

  fs.writeFileSync(
    stateFile,
    `${JSON.stringify({ version: 1, config: { stopReviewGate: false }, jobs }, null, 2)}\n`,
    "utf8"
  );

  saveState(workspace, { version: 1, config: { stopReviewGate: false }, jobs });

  const savedIds = loadState(workspace).jobs.map((job) => job.id);
  assert.equal(savedIds.includes("job-0"), true);
  assert.equal(savedIds.includes("job-1"), false);
  assert.equal(savedIds.length, 50);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-0")), true);
  assert.equal(fs.existsSync(resolveJobLogFile(workspace, "job-0")), true);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-1")), false);
  assert.equal(fs.existsSync(resolveJobLogFile(workspace, "job-1")), false);
  assert.equal(loadState(workspace).jobs.find((job) => job.id === "job-0").status, "running");
});

test("saveState keeps every running job when active jobs exceed the cap", () => {
  const workspace = makeTempDir();
  const jobs = Array.from({ length: 51 }, (_, index) => ({
    id: `run-${index}`,
    status: "running",
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString()
  }));

  saveState(workspace, { version: 1, config: { stopReviewGate: false }, jobs });

  assert.deepEqual(
    loadState(workspace).jobs.map((job) => job.id),
    Array.from({ length: 51 }, (_, index) => `run-${50 - index}`)
  );
});

test("concurrent job updates all remain in the state file", async () => {
  const workspace = makeTempDir();
  const workerPath = path.join(workspace, "worker.mjs");
  fs.writeFileSync(
    workerPath,
    [
      `import { upsertJob } from ${JSON.stringify(STATE_MODULE)};`,
      "const id = process.argv[2];",
      "const workspace = process.argv[3];",
      "for (let attempt = 0; attempt < 15; attempt += 1) {",
      "  upsertJob(workspace, { id, status: 'completed', summary: id });",
      "}",
      ""
    ].join("\n")
  );

  const ids = ["job-a", "job-b", "job-c", "job-d", "job-e", "job-f", "job-g", "job-h"];
  const exits = await Promise.all(
    ids.map(
      (id) =>
        new Promise((resolve) => {
          const child = spawn(process.execPath, [workerPath, id, workspace], { stdio: "inherit" });
          child.on("exit", (code) => resolve(code));
        })
    )
  );

  assert.deepEqual(exits, [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    loadState(workspace).jobs.map((job) => job.id).sort(),
    ["job-a", "job-b", "job-c", "job-d", "job-e", "job-f", "job-g", "job-h"]
  );
});

test("a corrupt state file is left unchanged", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const original = "{ not json";
  fs.writeFileSync(stateFile, original);

  assert.throws(
    () => upsertJob(workspace, { id: "job-new", status: "completed" }),
    /Codex job state is unreadable/
  );
  assert.equal(fs.readFileSync(stateFile, "utf8"), original);
});

test("a stale state lock does not block the next update", () => {
  const workspace = makeTempDir();
  const lockFile = path.join(resolveStateDir(workspace), "state.lock");
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "999999\n");
  const stale = new Date(Date.now() - 60_000);
  fs.utimesSync(lockFile, stale, stale);

  upsertJob(workspace, { id: "job-after-stale-lock", status: "completed" });

  assert.equal(loadState(workspace).jobs.map((job) => job.id).join(","), "job-after-stale-lock");
  assert.equal(fs.existsSync(lockFile), false);
});
