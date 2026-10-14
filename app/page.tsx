"use client";
/**
 * TARAX AI — Autonomous B2B Global Trade & Multi-Agent Negotiation Engine
 * Next.js (App Router) · Tailwind CSS · lucide-react · recharts
 *
 * npm i lucide-react recharts
 * Data layer: see `api` + `useLive` below. Set NEXT_PUBLIC_TARAX_API to your engine URL.
 * With no backend reachable, the UI falls back to the mock data so you can develop offline.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Anchor, BadgeCheck, Building2, Crown, Network, Wallet, Coins, FileSignature, Flame, Gauge, Globe2,
  Handshake, LayoutDashboard, Menu, Package, Radar, Scale, ShieldCheck, Ship,
  TrendingDown, TrendingUp, TriangleAlert, Truck, X,
} from "lucide-react";

/* ───────────── Types (align with your engine's models) ───────────── */
type AgentKey = "negotiator" | "compliance" | "logistics" | "finance";
type AgentState = "idle" | "working" | "done" | "flagged";
type Negotiation = {
  id: string; rfq: string; supplier: string; buyer: string; item: string; qty: number; ask: number; offer: number;
  finalPrice: number; target: number; currency: string; incoterm: "CIF" | "FOB" | "DDP"; progress: number; t: number;
  certs: string[]; flag: boolean; from: string; to: string; log: string;
};
type Supplier = { id: string; name: string; country: string; score: number; certs: string[]; category: string };
type RFQ = { id: string; buyer: string; item: string; qty: string; target: string; deadline: string };
type Contract = { id: string; parties: string; valueUsd: number; savingUsd: number; incoterm: string; milestones: [number, number]; status: string; from: string; to: string; age: number };

/* Commission engine rules */
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const txRate = (v: number) => (v < 250_000 ? 0.015 : v < 750_000 ? 0.0125 : 0.01); // dynamic 1.0%–1.5%
const ESCROW_RATE = 0.003; // 0.3% of each milestone tranche released
const SAVINGS_SHARE = 0.1; // 10% of negotiator savings
const fees = (c: Contract) => {
  const tx = c.valueUsd * txRate(c.valueUsd);
  const escrow = c.valueUsd * ESCROW_RATE * (c.milestones[0] / c.milestones[1]);
  const sav = c.savingUsd * SAVINGS_SHARE;
  return { tx, escrow, sav, total: tx + escrow + sav };
};

/* ───────────── Data layer ───────────── */
// Safe in any browser runtime: `process` only exists under Next.js/Node builds.
// Next.js inlines NEXT_PUBLIC_* at build time, so the guarded literal below still works there.
const API: string =
  (typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_TARAX_API) || "/api/tarax";

const mock = {
  suppliers: [
    { id: "S-101", name: "Shenzhen Nova Polymers", country: "China", score: 94, certs: ["ISO 9001", "CE"], category: "Polymers" },
    { id: "S-102", name: "Gujarat Steelworks Ltd", country: "India", score: 88, certs: ["ISO 14001", "CE"], category: "Metals" },
    { id: "S-103", name: "Istanbul MedTex", country: "Türkiye", score: 91, certs: ["FDA", "ISO 13485"], category: "Medical" },
  ] as Supplier[],
  rfqs: [
    { id: "RFQ-2291", buyer: "Hamburg Industrie GmbH", item: "HDPE granules, food grade", qty: "240 t", target: "$1,180 / t", deadline: "3 days" },
    { id: "RFQ-2297", buyer: "Nairobi BuildCo", item: "Rebar B500B", qty: "1,800 t", target: "$612 / t", deadline: "6 days" },
    { id: "RFQ-2302", buyer: "Dubai MedSupply", item: "Nitrile gloves, FDA 510(k)", qty: "40 containers", target: "$7,900 / box", deadline: "9 days" },
  ] as RFQ[],
  contracts: [
    { id: "C-5580", parties: "Nova Polymers → Hamburg Industrie", valueUsd: 283200, savingUsd: 20400, incoterm: "CIF Hamburg", milestones: [2, 4], status: "In transit", from: "SHA", to: "HAM", age: 0 },
    { id: "C-5574", parties: "Gujarat Steel → Nairobi BuildCo", valueUsd: 1100000, savingUsd: 50400, incoterm: "FOB Mundra", milestones: [1, 4], status: "Escrow funded", from: "BOM", to: "NBO", age: 1 },
    { id: "C-5569", parties: "Istanbul MedTex → Dubai MedSupply", valueUsd: 612000, savingUsd: 18000, incoterm: "DDP Dubai", milestones: [4, 4], status: "Completed", from: "IST", to: "DXB", age: 4 },
  ] as Contract[],
  bdi: Array.from({ length: 24 }, (_, i) => ({ d: `W${i + 1}`, bdi: 1400 + Math.round(Math.sin(i / 3) * 260 + i * 18), scfi: 1900 + Math.round(Math.cos(i / 4) * 340) })),
  commodities: [
    { n: "Copper", p: "$9,840 / t", c: 1.8 }, { n: "Aluminium", p: "$2,610 / t", c: -0.6 },
    { n: "Brent crude", p: "$81.20 / bbl", c: 2.4 }, { n: "HDPE (Asia)", p: "$1,140 / t", c: -1.1 },
    { n: "Natural gas (TTF)", p: "€34.5 / MWh", c: 3.2 }, { n: "Iron ore", p: "$108 / t", c: -0.3 },
  ],
  fx: [
    { pair: "USD/CNY", v: 7.24, vol: 4.1, alert: false }, { pair: "EUR/USD", v: 1.081, vol: 5.6, alert: false },
    { pair: "USD/INR", v: 83.4, vol: 3.2, alert: false }, { pair: "USD/TRY", v: 32.1, vol: 18.4, alert: true },
    { pair: "USD/KES", v: 129.5, vol: 12.9, alert: true },
  ],
  ports: [
    { port: "Shanghai", wait: 2.1, level: "ok" }, { port: "Rotterdam", wait: 3.4, level: "watch" },
    { port: "Los Angeles", wait: 4.8, level: "watch" }, { port: "Jebel Ali", wait: 1.6, level: "ok" },
    { port: "Red Sea transit", wait: 9.5, level: "critical" },
  ],
  macro: [
    { country: "China", risk: 42 }, { country: "USA", risk: 31 }, { country: "Germany", risk: 36 },
    { country: "India", risk: 39 }, { country: "Türkiye", risk: 71 }, { country: "Kenya", risk: 64 },
  ],
};

const api = async <T,>(path: string, fallback: T): Promise<T> => {
  try {
    const r = await fetch(`${API}${path}`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } catch { return fallback; }
};

function useLive<T>(path: string, fallback: T, pollMs = 0) {
  const [data, setData] = useState<T>(fallback);
  useEffect(() => {
    let on = true;
    const load = () => api(path, fallback).then((d) => on && setData(d));
    load();
    const t = pollMs ? setInterval(load, pollMs) : undefined;
    return () => { on = false; t && clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pollMs]);
  return data;
}

/* ───────────── TARAX multi-agent engine (embedded) ───────────── */
// SECURITY: any NEXT_PUBLIC_* key is shipped to every visitor's browser. Fine for a demo;
// in production, call OpenAI from a server route and keep the key server-side.
const getOpenAIKey = (): string => {
  try {
    if (typeof process !== "undefined" && process.env) return process.env.NEXT_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  } catch { /* browser runtime without process */ }
  return "";
};

async function askLLM(prompt: string, fallback: string): Promise<string> {
  const key = getOpenAIKey();
  if (!key) return fallback;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 40, messages: [
        { role: "system", content: "You are a TARAX AI trade agent. Reply with one short sentence, no quotes." },
        { role: "user", content: prompt }] }),
    });
    if (!r.ok) return fallback;
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || fallback;
  } catch { return fallback; }
}

type Deal = Pick<Negotiation, "supplier" | "buyer" | "item" | "qty" | "ask" | "target" | "currency" | "incoterm" | "certs" | "flag" | "from" | "to">;
const CATALOG: Deal[] = [
  { supplier: "Nova Polymers", buyer: "Hamburg Industrie", item: "HDPE granules", qty: 240, ask: 1265, target: 1180, currency: "USD/t", incoterm: "CIF", certs: ["ISO 9001", "CE"], flag: false, from: "SHA", to: "HAM" },
  { supplier: "Gujarat Steelworks", buyer: "Nairobi BuildCo", item: "Rebar B500B", qty: 1800, ask: 640, target: 612, currency: "USD/t", incoterm: "FOB", certs: ["ISO 14001", "CE"], flag: false, from: "BOM", to: "NBO" },
  { supplier: "Istanbul MedTex", buyer: "Dubai MedSupply", item: "Nitrile gloves", qty: 40, ask: 8100, target: 7900, currency: "USD/box", incoterm: "DDP", certs: ["FDA 510(k)"], flag: true, from: "IST", to: "DXB" },
  { supplier: "Santos AgroPack", buyer: "Hamburg Roasters", item: "Green coffee", qty: 60, ask: 4200, target: 3950, currency: "USD/t", incoterm: "CIF", certs: ["ISO 22000"], flag: false, from: "SAO", to: "HAM" },
  { supplier: "Shenzhen CellTech", buyer: "Pacific Mobility", item: "Lithium cells", qty: 9000, ask: 118, target: 109, currency: "USD/unit", incoterm: "FOB", certs: ["UN 38.3", "CE"], flag: true, from: "SHA", to: "LAX" },
  { supplier: "Dubai Alloy Trading", buyer: "Mumbai Fabricators", item: "Aluminium billets", qty: 500, ask: 2680, target: 2590, currency: "USD/t", incoterm: "CIF", certs: ["ISO 9001"], flag: false, from: "DXB", to: "BOM" },
];

const CLOSE_AT = 9;
const agentState = (n: Negotiation, k: AgentKey): AgentState => {
  const t = n.t;
  if (k === "negotiator") return t < 5 ? "working" : "done";
  if (k === "compliance") return t < 1 ? "idle" : n.flag && t >= 2 && t < 4 ? "flagged" : t < 4 ? "working" : "done";
  if (k === "logistics") return t < 4 ? "idle" : t < 7 ? "working" : "done";
  return t < 6 ? "idle" : t < CLOSE_AT ? "working" : "done";
};
const baseLog = (n: Negotiation, t: number) =>
  n.flag && t >= 2 && t < 4 ? `Compliance: ${n.certs[0]} certificate needs re-verification`
  : t < 1 ? "Negotiator opened at the supplier ask"
  : t < 5 ? `Negotiator countering, round ${t} of 4. Compliance checking ${n.certs.join(", ")}`
  : t < 7 ? `Logistics routing ${n.from} to ${n.to} under ${n.incoterm}`
  : t < CLOSE_AT ? "Finance building a 4-milestone escrow schedule"
  : "Contract executed";
const withT = (n: Negotiation, t: number): Negotiation =
