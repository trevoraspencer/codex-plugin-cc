#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import { parseArgs } from "./lib/args.mjs";
import { BROKER_BUSY_RPC_CODE, CodexAppServerClient } from "./lib/app-server.mjs";
import { parseBrokerEndpoint } from "./lib/broker-endpoint.mjs";
import { clearBrokerSession, loadBrokerSession, teardownBrokerSession } from "./lib/broker-lifecycle.mjs";

const STREAMING_METHODS = new Set(["turn/start", "review/start", "thread/compact/start"]);
const IDLE_TIMEOUT_ENV = "CODEX_COMPANION_BROKER_IDLE_TIMEOUT_MS";
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// SessionEnd does not run when Claude Code crashes or is force-quit, so the broker also exits on
// its own after this long with no clients and no request in flight. 0 turns this off.
function resolveIdleTimeoutMs(env = process.env) {
  const raw = env[IDLE_TIMEOUT_ENV];
  if (raw === undefined || raw === "") {
    return DEFAULT_IDLE_TIMEOUT_MS;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_IDLE_TIMEOUT_MS;
}

function buildStreamThreadIds(method, params, result) {
  const threadIds = new Set();
  if (params?.threadId) {
    threadIds.add(params.threadId);
  }
  if (method === "review/start" && result?.reviewThreadId) {
    threadIds.add(result.reviewThreadId);
  }
  return threadIds;
}

function buildJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function send(socket, message) {
  if (socket.destroyed) {
    return;
  }
  socket.write(`${JSON.stringify(message)}\n`);
}

function isInterruptRequest(message) {
  return message?.method === "turn/interrupt";
}

function writePidFile(pidFile) {
  if (!pidFile) {
    return;
  }
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (subcommand !== "serve") {
    throw new Error("Usage: node scripts/app-server-broker.mjs serve --endpoint <value> [--cwd <path>] [--pid-file <path>]");
  }

  const { options } = parseArgs(argv, {
    valueOptions: ["cwd", "pid-file", "endpoint"]
  });

  if (!options.endpoint) {
    throw new Error("Missing required --endpoint.");
  }

  const cwd = options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
  const endpoint = String(options.endpoint);
  const listenTarget = parseBrokerEndpoint(endpoint);
  const pidFile = options["pid-file"] ? path.resolve(options["pid-file"]) : null;
  writePidFile(pidFile);

  const appClient = await CodexAppServerClient.connect(cwd, { disableBroker: true });
  let activeRequestSocket = null;
  let activeStreamSocket = null;
  let activeStreamThreadIds = null;
  let inFlightRequests = 0;
  const sockets = new Set();
  const idleTimeoutMs = resolveIdleTimeoutMs();
  let idleTimer = null;

  function stopIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function startIdleTimerIfIdle() {
    stopIdleTimer();
    if (idleTimeoutMs > 0 && sockets.size === 0 && inFlightRequests === 0) {
      idleTimer = setTimeout(shutdownIdle, idleTimeoutMs);
    }
  }

  async function request(method, params) {
    inFlightRequests += 1;
    try {
      return await appClient.request(method, params);
    } finally {
      inFlightRequests -= 1;
      startIdleTimerIfIdle();
    }
  }

  function clearSocketOwnership(socket) {
    if (activeRequestSocket === socket) {
      activeRequestSocket = null;
    }
    if (activeStreamSocket === socket) {
      activeStreamSocket = null;
      activeStreamThreadIds = null;
    }
  }

  function routeNotification(message) {
    const target = activeRequestSocket ?? activeStreamSocket;
    if (!target) {
      return;
    }
    send(target, message);
    if (message.method === "turn/completed" && activeStreamSocket === target) {
      const threadId = message.params?.threadId ?? null;
      if (!threadId || !activeStreamThreadIds || activeStreamThreadIds.has(threadId)) {
        activeStreamSocket = null;
        activeStreamThreadIds = null;
        if (activeRequestSocket === target) {
          activeRequestSocket = null;
        }
      }
    }
  }

  async function shutdown(server) {
    for (const socket of sockets) {
      socket.end();
    }
    await appClient.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    if (listenTarget.kind === "unix" && fs.existsSync(listenTarget.path)) {
      fs.unlinkSync(listenTarget.path);
    }
    if (pidFile && fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  }

  // Also removes this broker's record, so a later SessionEnd does not signal its pid after the
  // system has given that pid to another process.
  async function shutdownIdle() {
    idleTimer = null;
    const record = loadBrokerSession(cwd);
    await shutdown(server);
    if (record?.endpoint === endpoint) {
      clearBrokerSession(cwd);
      teardownBrokerSession({
        endpoint,
        pidFile: record.pidFile ?? null,
        logFile: record.logFile ?? null,
        sessionDir: record.sessionDir ?? null
      });
    }
    process.exit(0);
  }

  appClient.setNotificationHandler(routeNotification);

  const server = net.createServer((socket) => {
    stopIdleTimer();
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        if (!line.trim()) {
          continue;
        }

        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          send(socket, {
            id: null,
            error: buildJsonRpcError(-32700, `Invalid JSON: ${error.message}`)
          });
          continue;
        }

        if (message.id !== undefined && message.method === "initialize") {
          send(socket, {
            id: message.id,
            result: {
              userAgent: "codex-companion-broker"
            }
          });
          continue;
        }

        if (message.method === "initialized" && message.id === undefined) {
          continue;
        }

        if (message.id !== undefined && message.method === "broker/shutdown") {
          send(socket, { id: message.id, result: {} });
          await shutdown(server);
          process.exit(0);
        }

        if (message.id === undefined) {
          continue;
        }

        const allowInterruptDuringActiveStream =
          isInterruptRequest(message) && activeStreamSocket && activeStreamSocket !== socket && !activeRequestSocket;

        if (
          ((activeRequestSocket && activeRequestSocket !== socket) || (activeStreamSocket && activeStreamSocket !== socket)) &&
          !allowInterruptDuringActiveStream
        ) {
          send(socket, {
            id: message.id,
            error: buildJsonRpcError(BROKER_BUSY_RPC_CODE, "Shared Codex broker is busy.")
          });
          continue;
        }

        if (allowInterruptDuringActiveStream) {
          try {
            const result = await request(message.method, message.params ?? {});
            send(socket, { id: message.id, result });
          } catch (error) {
            send(socket, {
              id: message.id,
              error: buildJsonRpcError(error.rpcCode ?? -32000, error.message)
            });
          }
          continue;
        }

        const isStreaming = STREAMING_METHODS.has(message.method);
        activeRequestSocket = socket;

        try {
          const result = await request(message.method, message.params ?? {});
          send(socket, { id: message.id, result });
          if (isStreaming) {
            activeStreamSocket = socket;
            activeStreamThreadIds = buildStreamThreadIds(message.method, message.params ?? {}, result);
          }
          if (activeRequestSocket === socket) {
            activeRequestSocket = null;
          }
        } catch (error) {
          send(socket, {
            id: message.id,
            error: buildJsonRpcError(error.rpcCode ?? -32000, error.message)
          });
          if (activeRequestSocket === socket) {
            activeRequestSocket = null;
          }
          if (activeStreamSocket === socket && !isStreaming) {
            activeStreamSocket = null;
          }
        }
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
      clearSocketOwnership(socket);
      startIdleTimerIfIdle();
    });

    socket.on("error", () => {
      sockets.delete(socket);
      clearSocketOwnership(socket);
      startIdleTimerIfIdle();
    });
  });

  process.on("SIGTERM", async () => {
    await shutdown(server);
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    await shutdown(server);
    process.exit(0);
  });

  server.listen(listenTarget.path);
  startIdleTimerIfIdle();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
