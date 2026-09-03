import { NextRequest, NextResponse } from "next/server";
import { db, checkInboundToken } from "@/lib/supabase";
import { triage } from "@/lib/agent";
import { decide, readIntegrations } from "@/lib/policy";
import { executeResolution, liveAdapters } from "@/lib/execute";
import type { InboundPayload } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/inbound, a new support message arrives (from a helpdesk webhook or
// email forwarder). Resolvd triages it, applies policy, and either auto-resolves
// (safe actions) or stores it as escalated with the proposed action attached.
export async function POST(req: NextRequest) {
  if (!checkInboundToken(req.headers.get("x-resolvd-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: InboundPayload;
  try {
    body = (await req.json()) as InboundPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.sender || !body.body) {
    return NextResponse.json(
      { error: "sender and body are required" },
      { status: 400 },
    );
  }

  const t = await triage(body.subject ?? "", body.body);
  const integrations = readIntegrations();
  const decision = decide(t, body, integrations);

  // A resolved decision carries an execution plan. Run it against the real
  // integrations; anything that fails flips back to escalated with the cause.
  let status = decision.status;
  let proposedAction = decision.proposedAction;
  let actionTaken = decision.actionTaken;
  let reason = decision.reason;
  if (decision.status === "resolved" && decision.execution) {
    const { shop, mail } = liveAdapters();
    const result = await executeResolution(
      decision,
      {
        sender: body.sender,
        subject: body.subject ?? "",
        orderRef: body.orderId ?? null,
      },
      shop,
      integrations.email ? mail : null,
      false,
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
  const { data, error } = await supabase
    .from("rv_tickets")
    .insert({
      sender: body.sender,
      subject: body.subject ?? null,
      body: body.body,
      order_id: body.orderId ?? null,
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

  if (error) {
    return NextResponse.json(
      { error: "store failed", detail: error.message },
      { status: 500 },
    );
  }

  // Cap retained tickets so the demo data plateaus instead of growing forever.
  const CAP = 60;
  const { data: edge } = await supabase
    .from("rv_tickets")
    .select("created_at")
    .order("created_at", { ascending: false })
    .range(CAP, CAP);
  const cutoff = (edge as { created_at: string }[] | null)?.[0]?.created_at;
  if (cutoff) {
    await supabase.from("rv_tickets").delete().lt("created_at", cutoff);
  }

  return NextResponse.json({
    ok: true,
    id: (data as { id: string }).id,
    status: decision.status,
    category: t.category,
    proposedAction: decision.proposedAction,
    actionTaken: decision.actionTaken,
  });
}
