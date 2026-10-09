import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { readStdinIfPiped } from "../plugins/codex/scripts/lib/fs.mjs";

function withPipedStdin(t, readFileSync) {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  t.after(() => {
    if (descriptor) {
      Object.defineProperty(process.stdin, "isTTY", descriptor);
    } else {
      delete process.stdin.isTTY;
    }
  });
  t.mock.method(fs, "readFileSync", readFileSync);
}

test("readStdinIfPiped treats a non-blocking stdin with no data as no input", (t) => {
  withPipedStdin(t, () => {
    throw Object.assign(new Error("EAGAIN: resource temporarily unavailable, read"), { code: "EAGAIN" });
  });

  assert.equal(readStdinIfPiped(), "");
});

test("readStdinIfPiped returns piped text and rethrows other read errors", (t) => {
  let fail = false;
  withPipedStdin(t, () => {
    if (fail) {
      throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
    }
    return "prompt from a heredoc\n";
  });

  assert.equal(readStdinIfPiped(), "prompt from a heredoc\n");
  fail = true;
  assert.throws(() => readStdinIfPiped(), /EIO/);
});
