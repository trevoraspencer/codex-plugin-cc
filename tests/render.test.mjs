import test from "node:test";
import assert from "node:assert/strict";

import { renderReviewResult, renderStoredJobResult } from "../plugins/codex/scripts/lib/render.mjs";

test("renderReviewResult shows a finding confidence and drops a value outside 0 to 1", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "needs-attention",
        summary: "Ship risk.",
        findings: [
          {
            severity: "high",
            title: "Lost update",
            body: "Two writers drop a job.",
            file: "state.mjs",
            line_start: 12,
            line_end: 18,
            confidence: 0.91,
            recommendation: "Lock the state file."
          },
          {
            severity: "low",
            title: "Unscored note",
            body: "No score was provided.",
            file: "notes.md",
            line_start: 1,
            line_end: 1,
            confidence: 2,
            recommendation: ""
          }
        ],
        next_steps: []
      },
      rawOutput: "{}",
      parseError: null
    },
    { reviewLabel: "Adversarial Review", targetLabel: "working tree diff" }
  );

  assert.match(output, /Confidence: 0\.91/);
  assert.match(output, /state\.mjs:12-18/);
  assert.doesNotMatch(output, /Confidence: 2/);
  assert.match(output, /Unscored note/);
});

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine."
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine."
      }),
      parseError: null
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff"
    }
  );

  assert.match(output, /Codex returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured review jobs", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Codex Adversarial Review",
      jobClass: "review",
      threadId: "thr_123"
    },
    {
      threadId: "thr_123",
      rendered: "# Codex Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: []
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Codex Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Codex session ID: thr_123/);
  assert.match(output, /Resume in Codex: codex resume thr_123/);
});
