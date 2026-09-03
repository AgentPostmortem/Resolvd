-- Resolvd schema. Runs in the shared AgentPostmortem Supabase project.

create table if not exists rv_tickets (
  id              uuid primary key default gen_random_uuid(),
  sender          text not null,
  subject         text,
  body            text not null,
  order_id        text,
  category        text,         -- order_status | refund | complaint | other
  urgency         text,         -- low | normal | high
  sentiment       text,         -- positive | neutral | negative
  status          text not null default 'pending', -- resolved | escalated | pending
  proposed_action text,         -- what the agent wants to do
  action_taken    text,         -- what it actually did (if auto-resolved)
  draft_reply     text,
  reason          text,         -- why it escalated / auto-resolved
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  source          text not null default 'api' -- api | demo
);

create index if not exists rv_tickets_status_idx  on rv_tickets(status, created_at desc);
create index if not exists rv_tickets_source_idx  on rv_tickets(source, created_at desc);

alter table rv_tickets enable row level security;
