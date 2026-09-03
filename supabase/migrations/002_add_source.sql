-- Tags demo rows explicitly. Apply once in the Supabase SQL editor.
-- Until this is applied, the dashboard falls back to matching the known demo
-- sender addresses (see lib/demo.ts), so nothing breaks either way.

alter table rv_tickets
  add column if not exists source text not null default 'api';

create index if not exists rv_tickets_source_idx
  on rv_tickets (source, created_at desc);

-- Backfill: every demo row ever written used one of these fake senders.
update rv_tickets set source = 'demo' where sender in (
  'sam@buyer.com', 'jo@buyer.com', 'al@buyer.com', 'mia@buyer.com'
);
