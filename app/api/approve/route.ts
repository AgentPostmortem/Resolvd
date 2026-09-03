import { NextRequest, NextResponse } from "next/server";
import { db, checkInboundToken } from "@/lib/supabase";
import { executeResolution, liveAdapters } from "@/lib/execute";
import { readIntegrations } from "@/lib/policy";
import type { Decision } from "@/lib/policy";

export const runtime = "nodejs";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-resolvd-token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

// POST /api/approve, a human approves (or rejects) an escalated ticket's
// proposed action. On approve, the action is recorded and the ticket resolved.
export async function POST(req: NextRequest) {
  if (!checkInboundToken(req.headers.get("x-resolvd-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  const { id, approve } = (await req.json().catch(() => ({}))) as {
    id?: string;
    approve?: boolean;
  };
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const supabase = db();
  const { data: ticket } = await supabase
    .from("rv_tickets")
    .select(
      "proposed_action, status, category, sender, subject, body, order_id, draft_reply",
    )
    .eq("id", id)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const row = ticket as {
    proposed_action: string | null;
    status: string;
    category: string | null;
    sender: string;
    subject: string | null;
    body: string;
    order_id: string | null;
    draft_reply: string | null;
  };
  const proposed = row.proposed_action;

  let actionTaken: string;
  if (!approve) {
    actionTaken = "Rejected by human";
  } else {
    // A human approval also executes the action when it is executable and
    // the store is connected. Anything that cannot run stays a manual task.
    actionTaken = `Approved by human: ${proposed ?? "action"}`;
    const integrations = readIntegrations();
    const amountMatch = row.body.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
    const executable: Decision["execution"] =
      row.category === "refund" && amountMatch
        ? { kind: "refund", amount: parseFloat(amountMatch[1]) }
        : row.category === "order_status" && row.order_id
          ? { kind: "order_lookup" }
          : null;
    if (executable && integrations.shopify) {
      const decision: Decision = {
        status: "resolved",
        proposedAction: proposed ?? "approved action",
        actionTaken: null,
        reason: "approved by human",
        draftReply: row.draft_reply ?? "",
        execution: executable,
      };
      const { shop, mail } = liveAdapters();
      const result = await executeResolution(
        decision,
        {
          sender: row.sender,
          subject: row.subject ?? "",
          orderRef: row.order_id,
        },
        shop,
        integrations.email ? mail : null,
        false,
      );
      actionTaken = result.ok
        ? `Approved by human: ${result.actionTaken}`
        : `Approved by human, execution failed (${result.reason}); handle manually`;
    }
  }

  const { error } = await supabase
    .from("rv_tickets")
    .update({
      status: "resolved",
      action_taken: actionTaken,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, approved: !!approve }, { headers: CORS });
}
