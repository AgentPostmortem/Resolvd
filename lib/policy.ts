import type { InboundPayload, Triage } from "./types";

export interface Decision {
  status: "resolved" | "escalated";
  proposedAction: string;
  actionTaken: string | null; // set only when auto-resolved
  reason: string;
  draftReply: string;
}

// The guardrail layer. Decides whether the agent may act on its own or must
// escalate to a human, given the triage and configured limits.
export function decide(triage: Triage, payload: InboundPayload): Decision {
  const refundAutoLimit = Number(
    process.env.REFUND_AUTO_LIMIT ?? "50",
  );

  // Negative + high urgency always goes to a human, regardless of category.
  if (triage.sentiment === "negative" && triage.urgency === "high") {
    return {
      status: "escalated",
      proposedAction: "Personal apology + offer remedy",
      actionTaken: null,
      reason: "negative sentiment at high urgency, needs a human touch",
      draftReply: triage.draftReply,
    };
  }

  switch (triage.category) {
    case "order_status": {
      if (!payload.orderId) {
        return {
          status: "escalated",
          proposedAction: "Ask customer for their order number",
          actionTaken: null,
          reason: "order status request without an order id",
          draftReply: triage.draftReply,
        };
      }
      // Safe, read-only auto-resolution: look up status and reply.
      const status = lookupOrderStatus(payload.orderId);
      return {
        status: "resolved",
        proposedAction: `Reply with status for ${payload.orderId}`,
        actionTaken: `Sent order status (${status}) for ${payload.orderId}`,
        reason: "read-only lookup, safe to auto-handle",
        draftReply: `Hi, your order ${payload.orderId} is currently "${status}". ${triage.draftReply}`,
      };
    }

    case "refund": {
      const amount = triage.refundAmount ?? null;
      if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
        return {
          status: "escalated",
          proposedAction: "Confirm a valid refund amount, then approve",
          actionTaken: null,
          reason: "refund amount must be finite and greater than zero",
          draftReply: triage.draftReply,
        };
      }
      if (amount != null && amount <= refundAutoLimit) {
        return {
          status: "resolved",
          proposedAction: `Issue refund of $${amount}`,
          actionTaken: `Issued refund of $${amount} (within $${refundAutoLimit} auto-limit)`,
          reason: `refund $${amount} <= auto-limit $${refundAutoLimit}`,
          draftReply: `Hi, we've issued your refund of $${amount}. ${triage.draftReply}`,
        };
      }
      return {
        status: "escalated",
        proposedAction:
          amount != null
            ? `Approve refund of $${amount}`
            : "Confirm refund amount, then approve",
        actionTaken: null,
        reason:
          amount != null
            ? `refund $${amount} exceeds auto-limit $${refundAutoLimit}`
            : "refund amount not stated",
        draftReply: triage.draftReply,
      };
    }

    case "complaint":
      return {
        status: "escalated",
        proposedAction: "Review complaint and respond personally",
        actionTaken: null,
        reason: "complaints are routed to a human by policy",
        draftReply: triage.draftReply,
      };

    default:
      return {
        status: "escalated",
        proposedAction: "Human review (uncategorized)",
        actionTaken: null,
        reason: "could not confidently categorize",
        draftReply: triage.draftReply,
      };
  }
}

// Stub order lookup. A real deployment calls Shopify / the OMS here (or routes
// through Bridgekit). Deterministic so demos are stable.
function lookupOrderStatus(orderId: string): string {
  const states = ["processing", "shipped", "out for delivery", "delivered"];
  const n = orderId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return states[n % states.length];
}
