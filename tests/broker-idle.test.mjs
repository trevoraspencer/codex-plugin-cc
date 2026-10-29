import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import test from "node:test";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { makeTempDir } from "./helpers.mjs";
import { ensureBrokerSession, loadBrokerSession, teardownBrokerSession } from "../plugins/codex/scripts/lib/broker-lifecycle.mjs";
import { parseBrokerEndpoint } from "../plugins/codex/scripts/lib/broker-endpoint.mjs";
import { terminateProcessTree } from "../plugins/codex/scripts/lib/process.mjs";

const IDLE_TIMEOUT_MS = 300;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function startBroker(idleTimeout) {
  const binDir = makeTempDir();
  installFakeCodex(binDir);
  const cwd = makeTempDir("cxc-test-idle-");
  const env = { ...buildEnv(binDir), CODEX_COMPANION_BROKER_IDLE_TIMEOUT_MS: String(idleTimeout) };
  const session = await ensureBrokerSession(cwd, { env, timeoutMs: 5000 });
  assert.notEqual(session, null, "broker should start");
  return { cwd, session };
}

function stopBroker(session) {
  teardownBrokerSession({ ...session, killProcess: terminateProcessTree });
}

async function connect(endpoint) {
  const socket = net.createConnection({ path: parseBrokerEndpoint(endpoint).path });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

test("broker exits on its own and removes its record after the idle timeout", async () => {
  const { cwd, session } = await startBroker(IDLE_TIMEOUT_MS);
  try {
    assert.equal(await waitFor(() => !isAlive(session.pid)), true, "idle broker should exit");
    assert.equal(loadBrokerSession(cwd), null, "broker record should be removed");
    assert.equal(fs.existsSync(parseBrokerEndpoint(session.endpoint).path), false, "socket should be removed");
    assert.equal(fs.existsSync(session.sessionDir), false, "session directory should be removed");
  } finally {
    stopBroker(session);
  }
});

test("broker stays up while a client is connected and exits after it disconnects", async () => {
  const { session } = await startBroker(IDLE_TIMEOUT_MS);
  try {
    const socket = await connect(session.endpoint);
    await new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT_MS * 3));
    assert.equal(isAlive(session.pid), true, "broker with a connected client should keep running");

    socket.end();
    assert.equal(await waitFor(() => !isAlive(session.pid)), true, "broker should exit once idle");
  } finally {
    stopBroker(session);
  }
});

test("an idle timeout of 0 keeps the broker running", async () => {
  const { cwd, session } = await startBroker(0);
  try {
    await new Promise((resolve) => setTimeout(resolve, IDLE_TIMEOUT_MS * 3));
    assert.equal(isAlive(session.pid), true);
    assert.notEqual(loadBrokerSession(cwd), null);
  } finally {
    stopBroker(session);
  }
});
