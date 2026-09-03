import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realShopAdapter, resolveApiBase } from "./shopify";
import { executeResolution } from "./execute";
import type { Decision } from "./policy";

// Tiny in-process Shopify stand-in: implements just the three Admin API calls
// the client makes, so the whole HTTP roundtrip is verified with no accounts.
const ORDERS = [
  {
    id: 1042,
    name: "#1042",
    email: "sam@buyer.com",
    currency: "USD",
    total_price: "84.00",
    financial_status: "paid",
    fulfillment_status: "fulfilled",
  },
  {
    id: 1043,
    name: "#1043",
    email: "jo@buyer.com",
    currency: "USD",
    total_price: "18.00",
    financial_status: "paid",
    fulfillment_status: null,
  },
];

let server: Server;
let base = "";
const refunds: Array<{ orderId: string; amount: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    if (req.method === "GET" && url.pathname.endsWith("/orders.json")) {
      const name = url.searchParams.get("name");
      const email = url.searchParams.get("email");
      const found = ORDERS.filter(
        (o) => (name && o.name === name) || (email && o.email === email),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ orders: found }));
      return;
    }
    const refundMatch =
      req.method === "POST" &&
      url.pathname.match(/\/orders\/(\d+)\/refunds\.json$/);
    if (refundMatch) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const orderId = refundMatch[1];
        if (orderId === "500") {
          res.writeHead(422, { "content-type": "application/json" });
          res.end(JSON.stringify({ errors: "already refunded" }));
          return;
        }
        const amount =
          JSON.parse(body).refund?.transactions?.[0]?.amount ?? "0";
        refunds.push({ orderId, amount });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ refund: { id: 777 } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});

const adapter = () => realShopAdapter("mock.test", "tok", base);

describe("resolveApiBase", () => {
  it("defaults to the shop's https base", () => {
    expect(resolveApiBase("x.myshopify.com", undefined)).toBe(
      "https://x.myshopify.com/admin/api/2024-07",
    );
  });
  it("allows loopback http and any https, rejects the rest", () => {
    expect(resolveApiBase("x", "http://127.0.0.1:4010/")).toBe(
      "http://127.0.0.1:4010/admin/api/2024-07",
    );
    expect(resolveApiBase("x", "https://staging.internal/")).toBe(
      "https://staging.internal/admin/api/2024-07",
    );
    expect(() => resolveApiBase("x", "http://evil.example.com")).toThrow();
    expect(() => resolveApiBase("x", "ftp://x")).toThrow();
  });
});

describe("Shopify roundtrip against the mock store", () => {
  it("looks up orders by reference and email", async () => {
    const shop = adapter();
    const byName = await shop.lookupByName("1042");
    expect(byName?.status).toBe("shipped");
    expect(byName?.currency).toBe("USD");
    expect(await shop.lookupByName("#0000")).toBeNull();
    const byEmail = await shop.lookupByEmail("jo@buyer.com");
    expect(byEmail.map((o) => o.name)).toEqual(["#1043"]);
  });

  it("creates refunds and surfaces store errors", async () => {
    const shop = adapter();
    const ok = await shop.createRefund("1043", 18, "USD");
    expect(ok.refundId).toBe("777");
    expect(refunds.at(-1)).toEqual({ orderId: "1043", amount: "18" });
    await expect(shop.createRefund("500", 5, "USD")).rejects.toThrow(
      /already refunded/,
    );
  });

  it("runs the full refund execution loop", async () => {
    const decision: Decision = {
      status: "resolved",
      proposedAction: "Issue refund of $18",
      actionTaken: null,
      reason: "test",
      draftReply: "Sorry about that.",
      execution: { kind: "refund", amount: 18 },
    };
    const r = await executeResolution(
      decision,
      { sender: "jo@buyer.com", subject: "Refund", orderRef: null },
      adapter(),
      null,
      false,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.actionTaken).toMatch(/Refunded \$18 on #1043/);
      expect(r.actionTaken).toMatch(/refund 777/);
    }
  });

  it("runs the full order-lookup loop with live status", async () => {
    const decision: Decision = {
      status: "resolved",
      proposedAction: "Reply with status",
      actionTaken: null,
      reason: "test",
      draftReply: "Here you go.",
      execution: { kind: "order_lookup" },
    };
    const r = await executeResolution(
      decision,
      { sender: "sam@buyer.com", subject: "Where?", orderRef: "1042" },
      adapter(),
      null,
      false,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.actionTaken).toMatch(/"shipped" for #1042/);
  });

  it("escalates when the store call fails", async () => {
    const decision: Decision = {
      status: "resolved",
      proposedAction: "Issue refund of $5",
      actionTaken: null,
      reason: "test",
      draftReply: "Sorry.",
      execution: { kind: "refund", amount: 5 },
    };
    const failing = {
      ...adapter(),
      lookupByName: async () => ({
        id: "500",
        name: "#500",
        email: null,
        currency: "USD",
        total: null,
        status: "processing",
      }),
    };
    const r = await executeResolution(
      decision,
      { sender: "x@y.com", subject: "Refund", orderRef: "#500" },
      failing,
      null,
      false,
    );
    expect(r.ok).toBe(false);
  });
});
