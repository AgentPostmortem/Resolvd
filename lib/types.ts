export type Category = "order_status" | "refund" | "complaint" | "other";
export type Urgency = "low" | "normal" | "high";
export type Sentiment = "positive" | "neutral" | "negative";
export type Status = "resolved" | "escalated" | "pending";

export interface Triage {
  category: Category;
  urgency: Urgency;
  sentiment: Sentiment;
  // For refunds, the amount the customer is asking for, if stated.
  refundAmount?: number;
  draftReply: string;
  summary: string;
}

export interface Ticket {
  id: string;
  sender: string;
  subject: string | null;
  body: string;
  order_id: string | null;
  category: Category | null;
  urgency: Urgency | null;
  sentiment: Sentiment | null;
  status: Status;
  proposed_action: string | null;
  action_taken: string | null;
  draft_reply: string | null;
  reason: string | null;
  created_at: string;
  resolved_at: string | null;
  // Set once supabase/migrations/002_add_source.sql has been applied.
  // Until then the dashboard falls back to matching demo senders.
  source?: string | null;
}

export interface InboundPayload {
  sender: string;
  subject?: string;
  body: string;
  orderId?: string;
}
