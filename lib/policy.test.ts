import { describe, it, expect } from "vitest";
import { decide } from "./policy";
import type { InboundPayload, Triage } from "./types";

const baseTriage: Triage = {
  category: "refund",
  urgency: "normal",
  sentiment: "neutral",
  draftReply: "Thanks for reaching out.",
  summary: "Customer requesting a refund.",
};

const basePayload: InboundPayload = {
  sender: "customer@example.com",
  body: "I'd like a refund please.",
};

describe("decide() refund policy", () => {
  it("auto-resolves a valid refund within the auto-limit", () => {
    const result = decide(
      { ...baseTriage, refundAmount: 25 },
      basePayload,
    );

    expect(result.status).toBe("resolved");
    expect(result.actionTaken).not.toBeNull();
  });

  it("escalates a refund above the auto-limit", () => {
    const result = decide(
      { ...baseTriage, refundAmount: 500 },
      basePayload,
    );

    expect(result.status).toBe("escalated");
    expect(result.actionTaken).toBeNull();
  });

  it("escalates a zero refund amount instead of auto-resolving it", () => {
    const result = decide({ ...baseTriage, refundAmount: 0 }, basePayload);

    expect(result.status).toBe("escalated");
    expect(result.actionTaken).toBeNull();
    expect(result.reason).toMatch(/zero or negative/);
  });

  it("escalates a negative refund amount instead of auto-resolving it", () => {
    const result = decide({ ...baseTriage, refundAmount: -10 }, basePayload);

    expect(result.status).toBe("escalated");
    expect(result.actionTaken).toBeNull();
    expect(result.reason).toMatch(/zero or negative/);
  });

  it("escalates a non-finite refund amount instead of auto-resolving it", () => {
    const result = decide(
      { ...baseTriage, refundAmount: NaN },
      basePayload,
    );

    expect(result.status).toBe("escalated");
    expect(result.actionTaken).toBeNull();
    expect(result.reason).toMatch(/not a valid number/);
  });

  it("escalates when no refund amount was stated", () => {
    const result = decide({ ...baseTriage, refundAmount: undefined }, basePayload);

    expect(result.status).toBe("escalated");
    expect(result.actionTaken).toBeNull();
    expect(result.reason).toBe("refund amount not stated");
  });
});
