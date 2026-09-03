import type { ShopAdapter, ShopOrder } from "./execute";

const API_VERSION = "2024-07";

// Custom app needs: read_orders (lookup) + write_orders (refunds).
export function shopifyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SHOPIFY_SHOP_DOMAIN && env.SHOPIFY_ACCESS_TOKEN);
}

// Base URL override for local verification against a mock store.
// Plain http is only ever allowed for loopback; anything else must be https.
export function resolveApiBase(
  shop: string,
  override?: string,
): string {
  if (!override) return `https://${shop}/admin/api/${API_VERSION}`;
  const base = override.replace(/\/+$/, "");
  if (/^http:\/\/localhost(:\d+)?$/i.test(base) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(base)) {
    return `${base}/admin/api/${API_VERSION}`;
  }
  if (/^https:\/\//i.test(base)) return `${base}/admin/api/${API_VERSION}`;
  throw new Error("SHOPIFY_API_BASE must be https, or http loopback for local tests");
}

async function adminFetch(
  shop: string,
  token: string,
  path: string,
  init?: RequestInit,
  baseOverride?: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  let base: string;
  try {
    base = resolveApiBase(shop, baseOverride);
  } catch (e) {
    return { ok: false, status: 0, json: { error: (e as Error).message } };
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "X-Shopify-Access-Token": token,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (e) {
    return { ok: false, status: 0, json: { error: (e as Error).message } };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON error pages still surface as failures below.
  }
  return { ok: res.ok, status: res.status, json };
}

interface ShopifyOrderJson {
  id: number;
  name: string;
  email?: string | null;
  currency?: string;
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  total_price?: string;
}

/** Human status from Shopify's fulfillment + financial state. Pure, tested. */
export function displayStatus(o: {
  cancelled_at?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
}): string {
  if (o.cancelled_at) return "cancelled";
  if (o.financial_status === "refunded" || o.financial_status === "partially_refunded")
    return o.financial_status.replace("_", " ");
  if (o.fulfillment_status === "fulfilled") return "shipped";
  if (o.fulfillment_status === "partial") return "partially shipped";
  return "processing";
}

function toOrder(o: ShopifyOrderJson): ShopOrder {
  return {
    id: String(o.id),
    name: o.name,
    email: o.email ?? null,
    currency: o.currency ?? "USD",
    total: o.total_price ?? null,
    status: displayStatus(o),
  };
}

function singleOrder(json: unknown): ShopOrder | null {
  const orders = (json as { orders?: ShopifyOrderJson[] })?.orders;
  if (!orders || orders.length === 0) return null;
  return toOrder(orders[0]);
}

export function realShopAdapter(
  shop: string,
  token: string,
  baseOverride?: string,
): ShopAdapter {
  return {
    async lookupByName(name: string): Promise<ShopOrder | null> {
      const ref = name.trim().startsWith("#") ? name.trim() : `#${name.trim()}`;
      const r = await adminFetch(
        shop,
        token,
        `/orders.json?name=${encodeURIComponent(ref)}&status=any&limit=1`,
        undefined,
        baseOverride,
      );
      if (!r.ok) throw new Error(`Shopify lookup failed (HTTP ${r.status})`);
      return singleOrder(r.json);
    },

    async lookupByEmail(email: string): Promise<ShopOrder[]> {
      const r = await adminFetch(
        shop,
        token,
        `/orders.json?email=${encodeURIComponent(email.trim())}&status=any&limit=5&order=created_at+desc`,
        undefined,
        baseOverride,
      );
      if (!r.ok) throw new Error(`Shopify lookup failed (HTTP ${r.status})`);
      const orders = (r.json as { orders?: ShopifyOrderJson[] })?.orders ?? [];
      return orders.map(toOrder);
    },

    async createRefund(
      orderId: string,
      amount: number,
      currency: string,
    ): Promise<{ refundId: string }> {
      const r = await adminFetch(
        shop,
        token,
        `/orders/${orderId}/refunds.json`,
        {
          method: "POST",
          body: JSON.stringify({
            refund: {
              notify: true,
              note: "Refund issued by Resolvd within policy",
              transactions: [{ order_id: orderId, kind: "refund", amount: String(amount), currency }],
            },
          }),
        },
        baseOverride,
      );
      if (!r.ok) {
        const detail =
          (r.json as { errors?: unknown })?.errors ?? `HTTP ${r.status}`;
        throw new Error(`Shopify refund failed: ${JSON.stringify(detail).slice(0, 200)}`);
      }
      const refund = (r.json as { refund?: { id?: number } })?.refund;
      return { refundId: String(refund?.id ?? "unknown") };
    },
  };
}
