import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { makeTempDir } from "./helpers.mjs";
import { ensureBrokerSession, loadBrokerSession, saveBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(TESTS_DIR, "../plugins/codex/scripts/session-lifecycle-hook.mjs");
const FAKE_BROKER_PATH = path.resolve(TESTS_DIR, "fake-broker-fixture.mjs");
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_ID = "22222222-2222-4222-8222-222222222222";

function withPluginData(pluginDataDir, fn) {
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  }
}

// The hook must not see a live companion's environment, or it could shut down a real broker.
function hookEnv(pluginDataDir) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: pluginDataDir };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CODEX_COMPANION_") || key === "CLAUDE_ENV_FILE") {
      delete env[key];
    }
  }
  return env;
}

function runSessionEnd(input, pluginDataDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK_PATH, "SessionEnd"], {
      env: hookEnv(pluginDataDir),
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

// Stands in for the broker's process. Detached so teardown can signal its process group.
function startSleeper() {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return child;
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function waitForExit(child, timeoutMs = 3000) {
  if (!isRunning(child)) {
    return;
  }
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

function stopSleeper(child) {
  if (isRunning(child)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

async function startFakeBroker(socketPath) {
  const broker = { shutdownRequests: 0, server: null };
  broker.server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const message = JSON.parse(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        if (message.method === "broker/shutdown") {
          broker.shutdownRequests += 1;
          socket.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    broker.server.once("error", reject);
    broker.server.listen(socketPath, resolve);
  });
  return broker;
}

function recordBroker({ pluginDataDir, workingDir, socketPath, sleeper, sessionId }) {
  const sessionDir = path.dirname(socketPath);
  withPluginData(pluginDataDir, () =>
    saveBrokerSession(workingDir, {
      endpoint: `unix:${socketPath}`,
      pidFile: path.join(sessionDir, "broker.pid"),
      logFile: path.join(sessionDir, "broker.log"),
      sessionDir,
      pid: sleeper.pid,
      sessionId
    })
  );
}

function brokerRecordFor(pluginDataDir, workingDir) {
  return withPluginData(pluginDataDir, () => loadBrokerSession(workingDir));
}

test("ensureBrokerSession records the companion session ID with the broker", async () => {
  const pluginDataDir = makeTempDir("cxc-test-data-");
  const brokerCwd = makeTempDir("cxc-test-broker-");
  const env = { ...hookEnv(pluginDataDir), CODEX_COMPANION_SESSION_ID: SESSION_ID };
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;
  let session = null;
  try {
    session = await ensureBrokerSession(brokerCwd, { env, scriptPath: FAKE_BROKER_PATH, timeoutMs: 5000 });

    assert.notEqual(session, null);
    assert.equal(session.sessionId, SESSION_ID);
    assert.equal(loadBrokerSession(brokerCwd).sessionId, SESSION_ID);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
    if (session?.pid) {
      try {
        process.kill(-session.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
});

test("SessionEnd tears down the broker recorded for its session even when the session ends in another directory", async () => {
  const pluginDataDir = makeTempDir("cxc-test-data-");
  const brokerCwd = path.join(makeTempDir("cxc-test-broker-"), "arena-codex");
  const sessionCwd = makeTempDir("cxc-test-session-");
  const socketPath = path.join(makeTempDir("cxc-sock-"), "b.sock");
  fs.mkdirSync(brokerCwd, { recursive: true });
  const sleeper = startSleeper();
  const broker = await startFakeBroker(socketPath);
  try {
    recordBroker({ pluginDataDir, workingDir: brokerCwd, socketPath, sleeper, sessionId: SESSION_ID });

    const result = await runSessionEnd({ session_id: SESSION_ID, cwd: sessionCwd, hook_event_name: "SessionEnd" }, pluginDataDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(broker.shutdownRequests, 1);
    await waitForExit(sleeper);
    assert.equal(isRunning(sleeper), false, "broker process should be torn down");
    assert.equal(brokerRecordFor(pluginDataDir, brokerCwd), null, "broker record should be removed");
  } finally {
    broker.server.close();
    stopSleeper(sleeper);
  }
});

test("SessionEnd leaves a broker recorded for a different session alone", async () => {
  const pluginDataDir = makeTempDir("cxc-test-data-");
  const brokerCwd = path.join(makeTempDir("cxc-test-broker-"), "arena-codex");
  const sessionCwd = makeTempDir("cxc-test-session-");
  const socketPath = path.join(makeTempDir("cxc-sock-"), "b.sock");
  fs.mkdirSync(brokerCwd, { recursive: true });
  const sleeper = startSleeper();
  const broker = await startFakeBroker(socketPath);
  try {
    recordBroker({ pluginDataDir, workingDir: brokerCwd, socketPath, sleeper, sessionId: OTHER_SESSION_ID });

    const result = await runSessionEnd({ session_id: SESSION_ID, cwd: sessionCwd, hook_event_name: "SessionEnd" }, pluginDataDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(broker.shutdownRequests, 0);
    assert.equal(isRunning(sleeper), true, "broker of another session should keep running");
    assert.notEqual(brokerRecordFor(pluginDataDir, brokerCwd), null, "broker of another session should keep its record");
  } finally {
    broker.server.close();
    stopSleeper(sleeper);
  }
});

test("SessionEnd tears down a broker recorded for the directory the session ends in", async () => {
  const pluginDataDir = makeTempDir("cxc-test-data-");
  const sessionCwd = makeTempDir("cxc-test-session-");
  const socketPath = path.join(makeTempDir("cxc-sock-"), "b.sock");
  const sleeper = startSleeper();
  const broker = await startFakeBroker(socketPath);
  try {
    recordBroker({ pluginDataDir, workingDir: sessionCwd, socketPath, sleeper, sessionId: undefined });

    const result = await runSessionEnd({ session_id: SESSION_ID, cwd: sessionCwd, hook_event_name: "SessionEnd" }, pluginDataDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(broker.shutdownRequests, 1);
    await waitForExit(sleeper);
    assert.equal(isRunning(sleeper), false, "broker process should be torn down");
  } finally {
    broker.server.close();
    stopSleeper(sleeper);
  }
});
