import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../lib/policy.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "lib/policy.ts",
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(
  compiled.outputText,
).toString("base64")}`;
const { decide } = await import(moduleUrl);

const originalLimit = process.env.REFUND_AUTO_LIMIT;
process.env.REFUND_AUTO_LIMIT = "50";
after(() => {
  if (originalLimit === undefined) delete process.env.REFUND_AUTO_LIMIT;
  else process.env.REFUND_AUTO_LIMIT = originalLimit;
});

function refundTriage(refundAmount) {
  return {
    category: "refund",
    urgency: "normal",
    sentiment: "neutral",
    refundAmount,
    draftReply: "We are reviewing your request.",
    summary: "Refund request",
  };
}

const payload = {
  sender: "customer@example.com",
  body: "Please refund this order.",
};

test("auto-resolves valid positive refunds at or below the configured limit", () => {
  for (const amount of [0.01, 20, 50]) {
    const decision = decide(refundTriage(amount), payload);
    assert.equal(decision.status, "resolved", `expected $${amount} to resolve`);
    assert.match(decision.reason, /<= auto-limit/);
  }
});

test("escalates valid refunds above the configured limit", () => {
  const decision = decide(refundTriage(50.01), payload);
  assert.equal(decision.status, "escalated");
  assert.equal(decision.actionTaken, null);
  assert.equal(decision.reason, "refund $50.01 exceeds auto-limit $50");
});

test("escalates non-positive and non-finite refund amounts as invalid", () => {
  const invalidAmounts = [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const amount of invalidAmounts) {
    const decision = decide(refundTriage(amount), payload);
    assert.equal(decision.status, "escalated", `expected ${amount} to escalate`);
    assert.equal(decision.actionTaken, null);
    assert.equal(
      decision.proposedAction,
      "Confirm a valid refund amount, then approve",
    );
    assert.equal(
      decision.reason,
      "refund amount must be finite and greater than zero",
    );
  }
});

test("preserves the missing-amount escalation", () => {
  const decision = decide(refundTriage(undefined), payload);
  assert.equal(decision.status, "escalated");
  assert.equal(decision.proposedAction, "Confirm refund amount, then approve");
  assert.equal(decision.reason, "refund amount not stated");
});
