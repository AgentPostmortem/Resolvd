import Link from "next/link";
import { db } from "@/lib/supabase";
import type { Ticket } from "@/lib/types";
import { demoExclusionFilter, isDemoTicket } from "@/lib/demo";
import { DemoButton } from "@/components/DemoButton";
import { AiDigest } from "@/components/AiDigest";

export const dynamic = "force-dynamic";

const PER_PAGE = 15;
const FILTERS = [
  { key: "all", label: "All" },
  { key: "escalated", label: "Escalated" },
  { key: "resolved", label: "Resolved" },
] as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; demo?: string }>;
}) {
  const supabase = db();
  const params = await searchParams;
  const status =
    params.status === "escalated" || params.status === "resolved"
      ? params.status
      : "all";
  // Demo rows are labeled, and a buyer can hide them to see live traffic only.
  const hideDemo = params.demo === "hide";
  const page = Math.max(1, parseInt(params.page ?? "1") || 1);
  const from = (page - 1) * PER_PAGE;
  const to = from + PER_PAGE - 1;

  const countOf = async (s?: string) => {
    let q = supabase
      .from("rv_tickets")
      .select("*", { count: "exact", head: true });
    if (s) q = q.eq("status", s);
    if (hideDemo) q = q.not("sender", "in", demoExclusionFilter());
    return (await q).count ?? 0;
  };
  // Same queries, run concurrently so SSR TTFB is one roundtrip, not three.
  const [total, resolved, escalated] = await Promise.all([
    countOf(),
    countOf("resolved"),
    countOf("escalated"),
  ]);
  const pending = Math.max(0, total - resolved - escalated);
  const autoRate = total ? Math.round((resolved / total) * 100) : 0;

  const counts: Record<string, number> = { all: total, escalated, resolved };
  const filtered = counts[status];
  const totalPages = Math.max(1, Math.ceil(filtered / PER_PAGE));

  let listQ = supabase
    .from("rv_tickets")
    .select("*")
    .order("created_at", { ascending: false });
  if (status !== "all") listQ = listQ.eq("status", status);
  if (hideDemo) listQ = listQ.not("sender", "in", demoExclusionFilter());
  const { data } = await listQ.range(from, to);
  const tickets = (data ?? []) as Ticket[];
  const demoParam = hideDemo ? "&demo=hide" : "";

  return (
    <div className="space-y-6">
      {/* One-line orientation for non-technical visitors. */}
      <p className="text-center font-display text-[16px] tracking-wide text-muted animate-fade-in sm:text-[18px]">
        Your support inbox, triaged and acted on by an agent,{" "}
        <span className="text-accent">safely</span>.
      </p>

      {/* ---- Compact hero: two columns on desktop (copy + CTAs left, live
           triage summary right). Collapses to a single column on mobile. ---- */}
      <section className="grid items-stretch gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="glass relative flex flex-col overflow-hidden rounded-2xl p-6 animate-fade-up">
          <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-accent/20 blur-3xl" />
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[11px] uppercase tracking-widest text-muted">
            AI support inbox
          </span>
          <h1 className="gradient-text relative mt-3 text-[2.1rem] font-semibold leading-tight tracking-tight sm:text-[2.65rem]">
            Reads <em className="font-display font-normal not-italic">every ticket</em>,
            decides what can safely move.
          </h1>
          <p className="relative mt-3 max-w-2xl text-[14px] leading-relaxed text-muted">
            Resolvd triages each message (category, urgency, sentiment),
            auto-handles the safe cases end to end, and escalates the risky ones
            to a human with a proposed action attached.
          </p>

          <div className="mt-auto pt-5">
            <div className="flex flex-wrap items-start gap-2.5">
              <DemoButton />
              <AiDigest
                total={total}
                resolved={resolved}
                escalated={escalated}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
              <span>
                <span className="font-semibold text-text tabular-nums">
                  {autoRate}%
                </span>{" "}
                auto-resolved
              </span>
              <span>
                <span className="font-semibold text-text tabular-nums">
                  {escalated}
                </span>{" "}
                waiting on a human
              </span>
              <span>
                <span className="font-semibold text-text tabular-nums">
                  {total}
                </span>{" "}
                tickets handled
              </span>
            </div>
          </div>
        </div>

        <TriagePanel
          resolved={resolved}
          escalated={escalated}
          pending={pending}
          autoRate={autoRate}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <FlowStep
          step="01"
          title="Triage"
          body="Classify category, urgency, sentiment, and policy risk."
        />
        <FlowStep
          step="02"
          title="Act"
          body="Auto-resolve safe tickets with the approved workflow."
        />
        <FlowStep
          step="03"
          title="Escalate"
          body="Hand off risky cases with context and proposed action."
        />
      </section>

      {/* ---- Inbox: filters + ticket list. Desktop = sidebar + list,
           tablet/mobile = horizontal filter tabs above a full-width list. ---- */}
      <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
        <aside className="flex flex-row flex-wrap gap-2 lg:flex-col lg:gap-1.5 lg:sticky lg:top-20 lg:self-start">
          {FILTERS.map((f) => {
            const active = status === f.key;
            return (
              <Link
                key={f.key}
                href={f.key === "all" ? `/${demoParam ? `?demo=hide` : ""}` : `/?status=${f.key}${demoParam}`}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition lg:justify-between ${
                  active
                    ? "border-accent/50 bg-accent/10 text-text"
                    : "border-border bg-surface text-muted hover:border-accent/30 hover:text-text lg:border-transparent lg:bg-transparent lg:hover:bg-surface"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Dot k={f.key} />
                  {f.label}
                </span>
                <span className="tabular-nums">{counts[f.key]}</span>
              </Link>
            );
          })}
          <div className="hidden rounded-lg border border-border bg-surface p-3 text-[12px] leading-relaxed text-muted lg:mt-3 lg:block">
            New messages are triaged automatically. Safe cases are actioned;
            risky ones land in <span className="text-warn">Escalated</span>.
          </div>
          <div className="hidden rounded-lg border border-border bg-surface p-3 text-[12px] leading-relaxed text-muted lg:block">
            <span className="font-medium text-text">Integrations</span>
            <ul className="mt-1.5 space-y-1">
              <IntegrationRow
                ok={Boolean(
                  process.env.SHOPIFY_SHOP_DOMAIN &&
                    process.env.SHOPIFY_ACCESS_TOKEN,
                )}
                label="Shopify store"
              />
              <IntegrationRow
                ok={Boolean(
                  process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL,
                )}
                label="Reply email"
              />
            </ul>
            <p className="mt-2">
              Unconnected work escalates with instructions instead of acting.
            </p>
          </div>
          <Link
            href={
              hideDemo
                ? status === "all"
                  ? "/"
                  : `/?status=${status}`
                : status === "all"
                  ? "/?demo=hide"
                  : `/?status=${status}&demo=hide`
            }
            className="rounded-lg border border-dashed border-border bg-transparent px-3 py-2 text-[13px] text-muted transition hover:border-accent/50 hover:text-text"
          >
            {hideDemo ? "Show demo tickets" : "Hide demo tickets"}
          </Link>
        </aside>

        <section className="min-w-0 space-y-3">
          {tickets.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="stagger glass overflow-hidden rounded-2xl">
              {tickets.map((t) => (
                <TicketRow key={t.id} t={t} />
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <Pagination
              status={status}
              page={page}
              totalPages={totalPages}
              demoParam={demoParam}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/* Single ticket row: clear visual hierarchy (subject -> sender -> preview ->
   action), with category + urgency badges and a hover state. */
function TicketRow({ t }: { t: Ticket }) {
  const dotColor =
    t.status === "escalated"
      ? "bg-warn"
      : t.status === "resolved"
        ? "bg-good"
        : "bg-muted";
  return (
    <article className="group border-b border-border-soft p-4 transition last:border-0 hover:bg-surface-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {t.subject || "(no subject)"}
              </span>
              {t.urgency === "high" && <Pill>high</Pill>}
            </div>
            <div className="text-[12px] text-muted">{t.sender}</div>
          </div>
        </div>
        {isDemoTicket(t) && (
          <span
            title="Sample ticket from the public demo, not real support work"
            className="shrink-0 rounded-md border border-dashed border-border-soft bg-transparent px-2 py-0.5 text-[11px] uppercase tracking-wider text-muted"
          >
            demo
          </span>
        )}
        {t.category && (
          <span className="shrink-0 rounded-md border border-border-soft bg-bg px-2 py-0.5 text-[11px] text-muted">
            {t.category}
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-1 pl-[18px] text-[13px] text-muted">
        {t.body}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 pl-[18px] text-[12px]">
        <span className={t.status === "resolved" ? "text-good" : "text-warn"}>
          {t.action_taken
            ? `✓ ${t.action_taken}`
            : `→ ${t.proposed_action ?? "review"}`}
        </span>
        {t.reason && <span className="text-muted">· {t.reason}</span>}
      </div>
    </article>
  );
}

function FlowStep({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/12 font-mono text-[12px] font-semibold text-accent">
          {step}
        </span>
        <div>
          <div className="font-medium">{title}</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted">{body}</p>
        </div>
      </div>
    </div>
  );
}

/* Compact triage summary that lives in the hero's right column:
   donut on top, clearly-labelled legend below, all in one short card. */
function TriagePanel({
  resolved,
  escalated,
  pending,
  autoRate,
}: {
  resolved: number;
  escalated: number;
  pending: number;
  autoRate: number;
}) {
  const total = resolved + escalated + pending;
  const segs = [
    {
      label: "Auto-resolved",
      value: resolved,
      color: "rgb(var(--good))",
    },
    {
      label: "Escalated",
      value: escalated,
      color: "rgb(var(--accent))",
    },
    {
      label: "Waiting on human",
      value: pending,
      color: "rgb(var(--muted))",
    },
  ].filter((s) => s.value > 0);

  let cum = 0;
  return (
    <section className="glass flex flex-col rounded-2xl p-5 animate-fade-up">
      <h2 className="flex items-center justify-between gap-2 text-[13px] font-medium text-muted">
        Triage outcomes
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          live
        </span>
      </h2>

      {total === 0 ? (
        <p className="mt-6 text-[13px] text-muted">No tickets yet.</p>
      ) : (
        <div className="mt-3 flex items-center gap-5">
          <div className="relative h-[112px] w-[112px] shrink-0">
            <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
              <circle
                cx="80"
                cy="80"
                r="62"
                fill="none"
                stroke="rgb(var(--text) / 0.06)"
                strokeWidth="14"
              />
              {segs.map((s, i) => {
                const off = cum;
                cum += (s.value / total) * 100;
                return (
                  <circle
                    key={s.label}
                    cx="80"
                    cy="80"
                    r="62"
                    fill="none"
                    stroke={s.color}
                    strokeWidth="14"
                    pathLength={100}
                    strokeDashoffset={-off}
                    className="donut-seg"
                    strokeLinecap="round"
                    style={
                      {
                        "--p": ((s.value / total) * 100).toFixed(2),
                        animationDelay: `${(i * 0.2).toFixed(2)}s`,
                      } as React.CSSProperties
                    }
                  />
                );
              })}
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-xl font-semibold tabular-nums">
                  {autoRate}%
                </div>
                <div className="text-[10px] text-muted">auto</div>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 flex-1 gap-2">
            {segs.map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-2.5 text-[12.5px]"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: s.color }}
                />
                <span className="min-w-0 flex-1 truncate text-muted">
                  {s.label}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-border-soft pt-3 text-[11px] text-muted">
        Updated automatically as new tickets arrive.
      </p>
    </section>
  );
}

function IntegrationRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-good" : "bg-muted"}`}
      />
      <span>
        {label}: {ok ? "connected" : "not connected"}
      </span>
    </li>
  );
}

function Dot({ k }: { k: string }) {
  const c =
    k === "escalated" ? "bg-warn" : k === "resolved" ? "bg-good" : "bg-accent";
  return <span className={`h-1.5 w-1.5 rounded-full ${c}`} />;
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-bad/12 px-2 py-0.5 text-[11px] font-medium text-bad">
      {children}
    </span>
  );
}

function Pagination({
  status,
  page,
  totalPages,
  demoParam,
}: {
  status: string;
  page: number;
  totalPages: number;
  demoParam: string;
}) {
  const base =
    status === "all"
      ? demoParam
        ? `/?demo=hide&`
        : "/?"
      : `/?status=${status}${demoParam}&`;
  const linkCls =
    "rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] transition hover:border-accent/50 hover:text-text";
  // At either edge the control is omitted entirely (empty spacer keeps the
  // layout): no dimmed pseudo-link to fail contrast or confuse keyboard users.
  return (
    <nav className="flex items-center justify-between pt-1 text-muted">
      {page <= 1 ? (
        <span aria-hidden="true" />
      ) : (
        <a href={`${base}page=${page - 1}`} className={linkCls}>
          ← Newer
        </a>
      )}
      <span className="text-[12px]">
        Page {page} of {totalPages}
      </span>
      {page >= totalPages ? (
        <span aria-hidden="true" />
      ) : (
        <a href={`${base}page=${page + 1}`} className={linkCls}>
          Older →
        </a>
      )}
    </nav>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-sm shadow-card">
      <p className="font-medium">No tickets here.</p>
      <p className="mt-1 text-muted">
        Hit “Send a test ticket” above, or POST one to{" "}
        <span className="font-mono text-text">/api/inbound</span>.
      </p>
    </div>
  );
}
