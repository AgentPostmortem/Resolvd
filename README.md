# Resolvd

An end-to-end inbox operator. Most "AI support" tools just draft a reply and make
a human re-read and click every action. Resolvd **triages, drafts, and acts**
within policy, issues the refund, sends the order status, closes the ticket, and
escalates only the cases that genuinely need a person, with the proposed action
already attached.

## Demo

[![Resolvd demo](assets/demo-thumb.png)](assets/demo.mp4)

▶ [Watch the demo](assets/demo.mp4) · Live: https://resolvd.agentpostmortem.com

## Flow

1. A message hits `POST /api/inbound` (helpdesk webhook or email forwarder).
2. **Triage** classifies category, urgency, sentiment, and drafts a reply
   (Claude when `ANTHROPIC_API_KEY` is set; a keyword heuristic otherwise).
3. **Policy** (the guardrail) decides:
   - `order_status` with an order id -> auto-resolve (live Shopify lookup + reply)
   - `refund` at or under `REFUND_AUTO_LIMIT`, pinned to one order -> auto-issue + reply
   - refund over the limit, ambiguous orders, complaints, or negative+high-urgency
     -> **escalate** with the proposed action attached
   - anything needing an unconnected integration -> **escalate** with instructions
     instead of acting
4. A human approves/rejects escalations via `POST /api/approve`. Approving an
   executable action runs it for real (refund/order lookup) and records the result.

## Integrations

| Integration | Env | Without it |
|---|---|---|
| Shopify store | `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN` (custom app: `read_orders` + `write_orders`) | order/refund work escalates with instructions |
| Reply email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified sender) | replies saved as drafts for a human to send |

Refunds resolve the order by explicit reference first, then by sender email only
on an unambiguous single match. Multiple matches escalate rather than guess.

The dashboard shows every ticket, the auto-resolution rate, what action was
taken (or proposed), and the reason.

## Stack

Next.js 14 + Supabase (`rv_*` tables in the shared project) + Cloudflare Workers
(OpenNext).

## Run

```bash
npm install
cp .env.example .env.local   # SUPABASE_*, RESOLVD_INBOUND_TOKEN, REFUND_AUTO_LIMIT
npm run dev
npm run deploy
```

Apply `supabase/schema.sql` in the Supabase SQL editor once. On an existing
database, also apply `supabase/migrations/002_add_source.sql` so demo rows
get an explicit `source = 'demo'` tag (the dashboard also recognizes the
built-in demo senders, so this is optional but recommended).

Demo tickets are badged DEMO in the dashboard and can be hidden with the
"Hide demo tickets" toggle, so evaluation traffic never mixes with live work.

```bash
npm test   # policy + triage unit tests
```

## Examples

```bash
# auto-resolved: order status with an order id
curl -X POST "$URL/api/inbound" -H "x-resolvd-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"sender":"sam@x.com","subject":"where is my order","body":"status?","orderId":"1042"}'

# auto-resolved: small refund under the limit
curl -X POST "$URL/api/inbound" -H "x-resolvd-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"sender":"jo@x.com","subject":"refund","body":"please refund $20 for the damaged item"}'

# escalated: refund over the limit -> waits for human approval
curl -X POST "$URL/api/inbound" -H "x-resolvd-token: $TOKEN" \
  -H "content-type: application/json" \
  -d '{"sender":"al@x.com","subject":"refund","body":"I want a $900 refund now"}'
```
