import { beforeEach, describe, expect, it } from "vitest";
import { triage } from "./agent";

beforeEach(() => {
  // Force the keyword-heuristic path: no model calls in unit tests.
  delete process.env.ANTHROPIC_API_KEY;
});

describe("heuristic triage", () => {
  it("detects refunds and parses the dollar amount", async () => {
    const t = await triage(
      "Refund please",
      "please refund $18 for the damaged item",
    );
    expect(t.category).toBe("refund");
    expect(t.refundAmount).toBe(18);
  });

  it("detects order status questions", async () => {
    const t = await triage("Where is my order?", "can you track my package?");
    expect(t.category).toBe("order_status");
  });

  it("marks angry language as negative, high urgency, complaint", async () => {
    const t = await triage(
      "Worst service",
      "this is the worst service ever, I am furious",
    );
    expect(t.category).toBe("complaint");
    expect(t.sentiment).toBe("negative");
    expect(t.urgency).toBe("high");
  });

  it("treats urgency words as high urgency", async () => {
    const t = await triage("Question", "need this resolved asap please");
    expect(t.urgency).toBe("high");
  });

  it("defaults unknown mail to neutral, normal, other", async () => {
    const t = await triage("Hello", "just saying hi, love the product photos");
    expect(t.category).toBe("other");
    expect(t.sentiment).toBe("positive");
    expect(t.urgency).toBe("normal");
  });
});
