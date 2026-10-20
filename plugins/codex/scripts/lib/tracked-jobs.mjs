import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { ensureStateDir, readJobFile, resolveJobFile, resolveJobLogFile, resolveJobsDir, upsertJob, writeJobFile } from "./state.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
const LOCK_WAIT_MS = 10_000;
const STALE_LOCK_MS = 30_000;
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function nowIso() {
  return new Date().toISOString();
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withJobLock(workspaceRoot, jobId, fn) {
  ensureStateDir(workspaceRoot);
  const lockFile = path.join(resolveJobsDir(workspaceRoot), `${jobId}.lock`);
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd;

  while (!fd) {
    try {
      fd = fs.openSync(lockFile, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      let stale = false;
      try {
        stale = Date.now() - fs.statSync(lockFile).mtimeMs > STALE_LOCK_MS;
      } catch (statError) {
        if (statError?.code !== "ENOENT") {
          throw statError;
        }
      }
      if (stale) {
        try {
          fs.unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError?.code !== "ENOENT") {
            throw unlinkError;
          }
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting to update job ${jobId}. Retry the command.`);
      }
      sleepMs(20);
    }
  }

  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  try {
    fs.writeFileSync(fd, `${token}\n`);
    return fn();
  } finally {
    fs.closeSync(fd);
    try {
      if (fs.readFileSync(lockFile, "utf8").trim() === token) {
        fs.unlinkSync(lockFile);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function normalizeProgressEvent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      message: String(value.message ?? "").trim(),
      phase: typeof value.phase === "string" && value.phase.trim() ? value.phase.trim() : null,
      threadId: typeof value.threadId === "string" && value.threadId.trim() ? value.threadId.trim() : null,
      turnId: typeof value.turnId === "string" && value.turnId.trim() ? value.turnId.trim() : null,
      stderrMessage: value.stderrMessage == null ? null : String(value.stderrMessage).trim(),
      logTitle: typeof value.logTitle === "string" && value.logTitle.trim() ? value.logTitle.trim() : null,
      logBody: value.logBody == null ? null : String(value.logBody).trimEnd()
    };
  }

  return {
    message: String(value ?? "").trim(),
    phase: null,
    threadId: null,
    turnId: null,
    stderrMessage: String(value ?? "").trim(),
    logTitle: null,
    logBody: null
  };
}

export function appendLogLine(logFile, message) {
  const normalized = String(message ?? "").trim();
  if (!logFile || !normalized) {
    return;
  }
  fs.appendFileSync(logFile, `[${nowIso()}] ${normalized}\n`, "utf8");
}

export function appendLogBlock(logFile, title, body) {
  if (!logFile || !body) {
    return;
  }
  fs.appendFileSync(logFile, `\n[${nowIso()}] ${title}\n${String(body).trimEnd()}\n`, "utf8");
}

export function createJobLogFile(workspaceRoot, jobId, title) {
  const logFile = resolveJobLogFile(workspaceRoot, jobId);
  fs.writeFileSync(logFile, "", "utf8");
  if (title) {
    appendLogLine(logFile, `Starting ${title}.`);
  }
  return logFile;
}

export function createJobRecord(base, options = {}) {
  const env = options.env ?? process.env;
  const sessionId = env[options.sessionIdEnv ?? SESSION_ID_ENV];
  return {
    ...base,
    createdAt: nowIso(),
    ...(sessionId ? { sessionId } : {})
  };
}

export function createJobProgressUpdater(workspaceRoot, jobId) {
  let lastPhase = null;
  let lastThreadId = null;
  let lastTurnId = null;

  return (event) => {
    const normalized = normalizeProgressEvent(event);
    const patch = { id: jobId };
    let changed = false;

    if (normalized.phase && normalized.phase !== lastPhase) {
      lastPhase = normalized.phase;
      patch.phase = normalized.phase;
      changed = true;
    }

    if (normalized.threadId && normalized.threadId !== lastThreadId) {
      lastThreadId = normalized.threadId;
      patch.threadId = normalized.threadId;
      changed = true;
    }

    if (normalized.turnId && normalized.turnId !== lastTurnId) {
      lastTurnId = normalized.turnId;
      patch.turnId = normalized.turnId;
      changed = true;
    }

    if (!changed) {
      return;
    }

    withJobLock(workspaceRoot, jobId, () => {
      const storedJob = readStoredJobOrNull(workspaceRoot, jobId);
      if (storedJob && TERMINAL_JOB_STATUSES.has(storedJob.status)) {
        return;
      }

      upsertJob(workspaceRoot, patch);
      if (!storedJob) {
        return;
      }
      writeJobFile(workspaceRoot, jobId, {
        ...storedJob,
        ...patch
      });
    });
  };
}

export function createProgressReporter({ stderr = false, logFile = null, onEvent = null } = {}) {
  if (!stderr && !logFile && !onEvent) {
    return null;
  }

  return (eventOrMessage) => {
    const event = normalizeProgressEvent(eventOrMessage);
    const stderrMessage = event.stderrMessage ?? event.message;
    if (stderr && stderrMessage) {
      process.stderr.write(`[codex] ${stderrMessage}\n`);
    }
    appendLogLine(logFile, event.message);
    appendLogBlock(logFile, event.logTitle, event.logBody);
    onEvent?.(event);
  };
}

function readStoredJobOrNull(workspaceRoot, jobId) {
  const jobFile = resolveJobFile(workspaceRoot, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJobFile(jobFile);
}

function storeJobUpdate(workspaceRoot, jobId, record, indexPatch) {
  writeJobFile(workspaceRoot, jobId, record);
  upsertJob(workspaceRoot, indexPatch);
}

export function markJobCancelled(workspaceRoot, job, completedAt = nowIso()) {
  return withJobLock(workspaceRoot, job.id, () => {
    const existing = readStoredJobOrNull(workspaceRoot, job.id) ?? {};
    if (TERMINAL_JOB_STATUSES.has(existing.status)) {
      return { job: existing, applied: false };
    }

    const nextJob = {
      ...existing,
      ...job,
      status: "cancelled",
      phase: "cancelled",
      pid: null,
      completedAt,
      cancelledAt: completedAt,
      errorMessage: "Cancelled by user."
    };
    storeJobUpdate(workspaceRoot, job.id, nextJob, {
      id: job.id,
      status: "cancelled",
      phase: "cancelled",
      pid: null,
      errorMessage: "Cancelled by user.",
      completedAt
    });
    return { job: nextJob, applied: true };
  });
}

export async function runTrackedJob(job, runner, options = {}) {
  const started = withJobLock(job.workspaceRoot, job.id, () => {
    const existing = readStoredJobOrNull(job.workspaceRoot, job.id);
    if (existing?.status === "cancelled") {
      return { cancelled: true, runningRecord: existing };
    }

    const runningRecord = {
      ...(existing ?? {}),
      ...job,
      status: "running",
      startedAt: existing?.startedAt ?? nowIso(),
      phase: "starting",
      pid: process.pid,
      logFile: options.logFile ?? job.logFile ?? existing?.logFile ?? null
    };
    storeJobUpdate(job.workspaceRoot, job.id, runningRecord, runningRecord);
    return { cancelled: false, runningRecord };
  });

  if (started.cancelled) {
    return {
      exitStatus: 1,
      threadId: started.runningRecord.threadId ?? null,
      turnId: started.runningRecord.turnId ?? null,
      payload: null,
      rendered: "",
      summary: "Cancelled by user."
    };
  }

  const runningRecord = started.runningRecord;

  try {
    const execution = await runner();
    const preservedCancel = withJobLock(job.workspaceRoot, job.id, () => {
      const existing = readStoredJobOrNull(job.workspaceRoot, job.id);
      if (existing?.status === "cancelled") {
        return true;
      }

      const completionStatus = execution.exitStatus === 0 ? "completed" : "failed";
      const completedAt = nowIso();
      const finished = {
        ...runningRecord,
        status: completionStatus,
        threadId: execution.threadId ?? null,
        turnId: execution.turnId ?? null,
        pid: null,
        phase: completionStatus === "completed" ? "done" : "failed",
        completedAt,
        result: execution.payload,
        rendered: execution.rendered
      };
      storeJobUpdate(job.workspaceRoot, job.id, finished, {
        id: job.id,
        status: completionStatus,
        threadId: execution.threadId ?? null,
        turnId: execution.turnId ?? null,
        summary: execution.summary,
        phase: completionStatus === "completed" ? "done" : "failed",
        pid: null,
        completedAt
      });
      return false;
    });
    if (!preservedCancel) {
      appendLogBlock(options.logFile ?? job.logFile ?? null, "Final output", execution.rendered);
    }
    return execution;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    withJobLock(job.workspaceRoot, job.id, () => {
      const existing = readStoredJobOrNull(job.workspaceRoot, job.id) ?? runningRecord;
      if (existing.status === "cancelled") {
        return;
      }

      const completedAt = nowIso();
      const failed = {
        ...existing,
        status: "failed",
        phase: "failed",
        errorMessage,
        pid: null,
        completedAt,
        logFile: options.logFile ?? job.logFile ?? existing.logFile ?? null
      };
      storeJobUpdate(job.workspaceRoot, job.id, failed, {
        id: job.id,
        status: "failed",
        phase: "failed",
        pid: null,
        errorMessage,
        completedAt
      });
    });
    throw error;
  }
}
