import test from "node:test";
import assert from "node:assert/strict";

import {
  modelDefaultsEnabled,
  normalizeReasoningEffort,
  normalizeRequestedModel,
  resolveModelSelection
} from "../plugins/codex/scripts/lib/models.mjs";

const NO_ENV = {};

test("normalizeRequestedModel resolves aliases case-insensitively and passes other ids through", () => {
  assert.equal(normalizeRequestedModel("sol"), "gpt-6.1-sol");
  assert.equal(normalizeRequestedModel("Astra"), "gpt-6-astra");
  assert.equal(normalizeRequestedModel(" luna "), "gpt-6-luna");
  assert.equal(normalizeRequestedModel("custom-model-id"), "custom-model-id");
  assert.equal(normalizeRequestedModel(""), null);
  assert.equal(normalizeRequestedModel(undefined), null);
});

test("normalizeRequestedModel rejects the retired spark alias with a replacement", () => {
  assert.throws(() => normalizeRequestedModel("spark"), /retired.*--model luna/);
  assert.throws(() => normalizeRequestedModel(" Spark "), /retired/);
});

test("normalizeReasoningEffort accepts current levels and rejects others", () => {
  for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"]) {
    assert.equal(normalizeReasoningEffort(effort.toUpperCase()), effort);
  }
  assert.equal(normalizeReasoningEffort(null), null);
  assert.equal(normalizeReasoningEffort(""), null);
  assert.throws(() => normalizeReasoningEffort("none"), /Unsupported reasoning effort "none"/);
  assert.throws(() => normalizeReasoningEffort("minimal"), /Unsupported reasoning effort "minimal"/);
});

test("resolveModelSelection applies command defaults and replaces only what is requested", () => {
  assert.deepEqual(resolveModelSelection("task", {}, NO_ENV), { model: "gpt-6.1-sol", effort: "xhigh" });
  assert.deepEqual(resolveModelSelection("review", {}, NO_ENV), { model: "gpt-6-astra", effort: "xhigh" });
  assert.deepEqual(resolveModelSelection("adversarial-review", { effort: "high" }, NO_ENV), { model: "gpt-6-astra", effort: "high" });
  assert.deepEqual(resolveModelSelection("task", { model: "gpt-6.1-sol" }, NO_ENV), { model: "gpt-6.1-sol", effort: "xhigh" });
  assert.deepEqual(resolveModelSelection("task", { model: "luna" }, NO_ENV), { model: "gpt-6-luna", effort: "xhigh" });
  assert.deepEqual(resolveModelSelection("review", { model: "luna", effort: "low" }, NO_ENV), { model: "gpt-6-luna", effort: "low" });
  assert.deepEqual(resolveModelSelection(null, {}, NO_ENV), { model: null, effort: null });
  assert.deepEqual(resolveModelSelection(null, { model: "sol" }, NO_ENV), { model: "gpt-6.1-sol", effort: null });
});

test("CODEX_COMPANION_MODEL_DEFAULTS=off disables the defaults but keeps explicit choices", () => {
  for (const value of ["off", "OFF", "false", "0", "no"]) {
    assert.equal(modelDefaultsEnabled({ CODEX_COMPANION_MODEL_DEFAULTS: value }), false, value);
  }
  assert.equal(modelDefaultsEnabled({}), true);
  assert.equal(modelDefaultsEnabled({ CODEX_COMPANION_MODEL_DEFAULTS: "on" }), true);
  const off = { CODEX_COMPANION_MODEL_DEFAULTS: "off" };
  assert.deepEqual(resolveModelSelection("task", {}, off), { model: null, effort: null });
  assert.deepEqual(resolveModelSelection("review", { model: "astra" }, off), { model: "gpt-6-astra", effort: null });
});
