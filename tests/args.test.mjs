import test from "node:test";
import assert from "node:assert/strict";

import { splitRawArgumentString } from "../plugins/codex/scripts/lib/args.mjs";

test("splitRawArgumentString keeps apostrophes and later flags", () => {
  assert.deepEqual(splitRawArgumentString("fix the user's bug --model luna"), [
    "fix",
    "the",
    "user's",
    "bug",
    "--model",
    "luna"
  ]);
});

test("splitRawArgumentString keeps backslashes in a Windows path", () => {
  assert.deepEqual(splitRawArgumentString("--source C:\\Users\\me\\.claude\\projects\\session.jsonl"), [
    "--source",
    "C:\\Users\\me\\.claude\\projects\\session.jsonl"
  ]);
});

test("splitRawArgumentString still groups a quoted phrase and keeps an apostrophe inside it", () => {
  assert.deepEqual(splitRawArgumentString('--model luna "fix the user\'s bug"'), [
    "--model",
    "luna",
    "fix the user's bug"
  ]);
});

test("splitRawArgumentString splits ordinary flags on whitespace", () => {
  assert.deepEqual(splitRawArgumentString("--base main --effort=max"), ["--base", "main", "--effort=max"]);
});

test("splitRawArgumentString treats an escaped space as part of the token", () => {
  assert.deepEqual(splitRawArgumentString("hello\\ world"), ["hello world"]);
  assert.deepEqual(splitRawArgumentString("trailing\\"), ["trailing\\"]);
});
