import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import { loadState, resolveJobFile } from "../plugins/codex/scripts/lib/state.mjs";
import { createJobProgressUpdater, markJobCancelled, runTrackedJob } from "../plugins/codex/scripts/lib/tracked-jobs.mjs";

function jobRecord(workspace) {
  return {
    id: "task-cancel",
    workspaceRoot: workspace,
    status: "queued",
    jobClass: "task",
    title: "Codex Task",
    summary: "investigate the failing test",
    logFile: null
  };
}

function readStored(workspace, jobId = "task-cancel") {
  return JSON.parse(fs.readFileSync(resolveJobFile(workspace, jobId), "utf8"));
}

function indexStatus(workspace, jobId = "task-cancel") {
  return loadState(workspace).jobs.find((job) => job.id === jobId)?.status ?? null;
}

test("a finished run is stored as completed", async () => {
  const workspace = makeTempDir();
  const execution = await runTrackedJob(jobRecord(workspace), async () => ({
    exitStatus: 0,
    threadId: "thr_done",
    turnId: "turn_done",
    payload: { ok: true },
    rendered: "done\n",
    summary: "done"
  }));

  assert.equal(execution.threadId, "thr_done");
  assert.equal(readStored(workspace).status, "completed");
  assert.equal(readStored(workspace).threadId, "thr_done");
  assert.equal(readStored(workspace).rendered, "done\n");
  assert.equal(indexStatus(workspace), "completed");
});

test("a cancel recorded during the run stays cancelled after the run returns", async () => {
  const workspace = makeTempDir();
  await runTrackedJob(jobRecord(workspace), async () => {
    markJobCancelled(workspace, { id: "task-cancel", title: "Codex Task", summary: "investigate the failing test" });
    return {
      exitStatus: 0,
      threadId: "thr_late",
      turnId: "turn_late",
      payload: { ok: true },
      rendered: "done\n",
      summary: "done"
    };
  });

  assert.equal(readStored(workspace).status, "cancelled");
  assert.equal(readStored(workspace).errorMessage, "Cancelled by user.");
  assert.equal(readStored(workspace).rendered, undefined);
  assert.equal(indexStatus(workspace), "cancelled");
});

test("a failure after cancel does not replace the cancelled job", async () => {
  const workspace = makeTempDir();
  await assert.rejects(
    runTrackedJob(jobRecord(workspace), async () => {
      markJobCancelled(workspace, { id: "task-cancel" });
      throw new Error("worker exited");
    }),
    /worker exited/
  );

  assert.equal(readStored(workspace).status, "cancelled");
  assert.equal(readStored(workspace).errorMessage, "Cancelled by user.");
  assert.equal(indexStatus(workspace), "cancelled");
});

test("a cancelled job does not start again", async () => {
  const workspace = makeTempDir();
  markJobCancelled(workspace, jobRecord(workspace));
  let ran = false;
  const execution = await runTrackedJob(jobRecord(workspace), async () => {
    ran = true;
    return {
      exitStatus: 0,
      threadId: "thr_again",
      turnId: "turn_again",
      payload: { ok: true },
      rendered: "done\n",
      summary: "done"
    };
  });

  assert.equal(ran, false);
  assert.equal(execution.summary, "Cancelled by user.");
  assert.equal(readStored(workspace).status, "cancelled");
  assert.equal(indexStatus(workspace), "cancelled");
});

test("cancel does not overwrite a completed job", async () => {
  const workspace = makeTempDir();
  const job = jobRecord(workspace);
  await runTrackedJob(job, async () => ({
    exitStatus: 0,
    threadId: "thr_done",
    turnId: "turn_done",
    payload: { ok: true },
    rendered: "finished output\n",
    summary: "finished"
  }));

  const marked = markJobCancelled(workspace, job);
  assert.equal(marked.applied, false);
  assert.equal(readStored(workspace).status, "completed");
  assert.equal(readStored(workspace).rendered, "finished output\n");
  assert.equal(indexStatus(workspace), "completed");
});

test("a late progress update does not revive a cancelled job", () => {
  const workspace = makeTempDir();
  markJobCancelled(workspace, jobRecord(workspace));
  const update = createJobProgressUpdater(workspace, "task-cancel");
  update({ message: "Applying 1 file change(s).", phase: "editing", threadId: "thr_late", turnId: "turn_late" });

  assert.equal(readStored(workspace).status, "cancelled");
  assert.equal(readStored(workspace).phase, "cancelled");
  assert.equal(indexStatus(workspace), "cancelled");
});
