/**
 * Model and reasoning-effort selection for Codex runs started by the plugin.
 *
 * Each command has a default model and effort. An explicit `--model` or
 * `--effort` flag replaces only that value, so `--model luna` still runs at the
 * command's default effort. Setting CODEX_COMPANION_MODEL_DEFAULTS=off turns
 * the defaults off, leaving unset values to the user's Codex configuration.
 */

export const REASONING_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]);

export const MODEL_ALIASES = new Map([
  ["sol", "gpt-6.1-sol"],
  ["astra", "gpt-6-astra"],
  ["luna", "gpt-6-luna"]
]);

export const MODEL_DEFAULTS_ENV = "CODEX_COMPANION_MODEL_DEFAULTS";

const RETIRED_MODEL_ALIASES = new Map([
  [
    "spark",
    "The `spark` alias pointed to gpt-5.3-codex-spark, which OpenAI retired on 2026-09-14. Use `--model luna` for a fast model."
  ]
]);

export const COMMAND_MODEL_DEFAULTS = Object.freeze({
  review: Object.freeze({ model: "gpt-6-astra", effort: "xhigh" }),
  "adversarial-review": Object.freeze({ model: "gpt-6-astra", effort: "xhigh" }),
  task: Object.freeze({ model: "gpt-6.1-sol", effort: "xhigh" })
});

export function normalizeRequestedModel(model) {
  if (model == null) {
    return null;
  }
  const normalized = String(model).trim();
  if (!normalized) {
    return null;
  }
  const key = normalized.toLowerCase();
  const retiredMessage = RETIRED_MODEL_ALIASES.get(key);
  if (retiredMessage) {
    throw new Error(retiredMessage);
  }
  return MODEL_ALIASES.get(key) ?? normalized;
}

export function normalizeReasoningEffort(effort) {
  if (effort == null) {
    return null;
  }
  const normalized = String(effort).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!REASONING_EFFORTS.includes(normalized)) {
    throw new Error(`Unsupported reasoning effort "${effort}". Use one of: ${REASONING_EFFORTS.join(", ")}.`);
  }
  return normalized;
}

export function modelDefaultsEnabled(env = process.env) {
  const value = String(env?.[MODEL_DEFAULTS_ENV] ?? "").trim().toLowerCase();
  return !["off", "false", "0", "no"].includes(value);
}

/**
 * Resolve the model and effort for one command invocation.
 *
 * @param {string | null} command A key of COMMAND_MODEL_DEFAULTS, or null for no defaults.
 * @param {{ model?: string | null, effort?: string | null }} requested
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ model: string | null, effort: string | null }}
 */
export function resolveModelSelection(command, requested = {}, env = process.env) {
  const model = normalizeRequestedModel(requested.model);
  const effort = normalizeReasoningEffort(requested.effort);
  const defaults = command ? COMMAND_MODEL_DEFAULTS[command] : null;
  if (!defaults || !modelDefaultsEnabled(env)) {
    return { model, effort };
  }
  return {
    model: model ?? defaults.model,
    effort: effort ?? defaults.effort
  };
}
