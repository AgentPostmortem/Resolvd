import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { triage } from "@/lib/agent";
import { decide } from "@/lib/policy";
import { executeResolution, sampleShopAdapter } from "@/lib/execute";
import type { InboundPayload } from "@/lib/types";

export const runtime = "nodejs";

// Senders must stay inside DEMO_SENDERS (lib/demo.ts) so the dashboard can
// badge these rows as demo. Do not use realistic addresses here.
const SAMPLES: InboundPayload[] = [
  { sender: "sam@buyer.com", subject: "Where is my order?", body: "Hi, can you tell me the status of my order?", orderId: "1042" },
  { sender: "jo@buyer.com", subject: "Refund please", body: "please refund $18 for the damaged item" },
  { sender: "al@buyer.com", subject: "Refund now", body: "I want a $640 refund now, the order never arrived" },
  { sender: "mia@buyer.com", subject: "Worst service", body: "this is the worst service ever, I am furious and want answers" },
];

// POST /api/demo, public, no token. Lets a website visitor inject one realistic
// support ticket so they can watch the triage + policy decision happen live.
// Runs against an explicitly fake sample store (never touches real systems);
// the dashboard badges these rows as demo.
export async function POST() {
  const pick = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
  const t = await triage(pick.subject ?? "", pick.body);
  const decision = decide(t, pick, { shopify: true, email: false });

  let status = decision.status;
  let proposedAction = decision.proposedAction;
  let actionTaken = decision.actionTaken;
  let reason = decision.reason;
  if (decision.status === "resolved" && decision.execution) {
    const result = await executeResolution(
      decision,
      {
        sender: pick.sender,
        subject: pick.subject ?? "",
        orderRef: pick.orderId ?? null,
      },
      sampleShopAdapter(),
      null,
      true,
    );
    if (result.ok) {
      actionTaken = result.actionTaken;
    } else {
      status = "escalated";
      proposedAction = result.proposedAction;
      reason = result.reason;
    }
  }

  const supabase = db();
  const { data } = await supabase
    .from("rv_tickets")
    .insert({
      sender: pick.sender,
      subject: pick.subject ?? null,
      body: pick.body,
      order_id: pick.orderId ?? null,
      category: t.category,
      urgency: t.urgency,
      sentiment: t.sentiment,
      status,
      proposed_action: proposedAction,
      action_taken: actionTaken,
      draft_reply: decision.draftReply,
      reason,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  // Prune to cap.
  const CAP = 60;
  const { data: edge } = await supabase
    .from("rv_tickets")
    .select("created_at")
    .order("created_at", { ascending: false })
    .range(CAP, CAP);
  const cutoff = (edge as { created_at: string }[] | null)?.[0]?.created_at;
  if (cutoff) await supabase.from("rv_tickets").delete().lt("created_at", cutoff);

  return NextResponse.json({
    ok: true,
    id: (data as { id: string }).id,
    subject: pick.subject,
    category: t.category,
    status,
    proposedAction,
    actionTaken,
    reason,
  });
}
