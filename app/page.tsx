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
const withT = (n: Negotiation, t: number): Negotiation => ({
  ...n, t, progress: Math.min(100, (t / CLOSE_AT) * 100),
  offer: +(n.ask - ((n.ask - n.finalPrice) * Math.min(t, 5)) / 5).toFixed(2), log: baseLog(n, t),
});
const mkNeg = (d: Deal, i: number): Negotiation =>
  withT({ ...d, id: `N-${80 + i}`, rfq: `RFQ-${2300 + i}`, offer: d.ask, finalPrice: +(d.target + (d.ask - d.target) * 0.3).toFixed(2), progress: 0, t: 0, log: "" }, 0);

type FeeEvent = { id: string; contract: string; kind: "Transaction" | "Escrow" | "Savings"; amount: number; at: number };
type EState = { negs: Negotiation[]; contracts: Contract[]; ledger: FeeEvent[]; today: number; seq: number; nd: number };
type EAction = { type: "tick"; at: number } | { type: "log"; id: string; t: number; text: string };

const initState = (): EState => ({
  negs: [4, 2, 6].map((t, i) => withT(mkNeg(CATALOG[i], i), t)),
  contracts: mock.contracts, ledger: [], today: 18420, seq: 0, nd: 3,
});

function reduce(s: EState, a: EAction): EState {
  if (a.type === "log") return { ...s, negs: s.negs.map((n) => (n.id === a.id && n.t === a.t ? { ...n, log: a.text } : n)) };
  let { seq, nd, today } = s;
  const ledger = [...s.ledger];
  const add = (c: Contract, kind: FeeEvent["kind"], amount: number) => {
    ledger.unshift({ id: `${c.id}-${kind}-${seq++}`, contract: c.id, kind, amount, at: a.at });
    today += amount;
  };
  let contracts = s.contracts.map((c) => {
    const age = c.age + 1;
    if (c.milestones[0] < c.milestones[1] && age % 4 === 0) {
      const next: Contract = { ...c, age, milestones: [c.milestones[0] + 1, c.milestones[1]] };
      next.status = next.milestones[0] === next.milestones[1] ? "Completed" : "In transit";
      add(next, "Escrow", (c.valueUsd * ESCROW_RATE) / c.milestones[1]);
      return next;
    }
    return { ...c, age };
  });
  const negs: Negotiation[] = [];
  for (const n of s.negs) {
    if (n.t + 1 >= CLOSE_AT) {
      const c: Contract = {
        id: `C-${5600 + seq}`, parties: `${n.supplier} → ${n.buyer}`,
        valueUsd: Math.round(n.finalPrice * n.qty), savingUsd: Math.round((n.ask - n.finalPrice) * n.qty),
        incoterm: `${n.incoterm} ${n.to}`, milestones: [0, 4], status: "Escrow funded", from: n.from, to: n.to, age: 0,
      };
      seq++;
      add(c, "Transaction", c.valueUsd * txRate(c.valueUsd));
      add(c, "Savings", c.savingUsd * SAVINGS_SHARE);
      contracts = [c, ...contracts];
      negs.push(mkNeg(CATALOG[nd % CATALOG.length], nd++));
    } else negs.push(withT(n, n.t + 1));
  }
  return { negs, contracts: contracts.slice(0, 12), ledger: ledger.slice(0, 40), today, seq, nd };
}

type Ctx = { negotiations: Negotiation[]; contracts: Contract[]; ledger: FeeEvent[]; today: number; llm: boolean };
const TaraxCtx = createContext<Ctx | null>(null);
const useTarax = (): Ctx => {
  const c = useContext(TaraxCtx);
  if (!c) throw new Error("TaraxProvider is missing");
  return c;
};

function TaraxProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reduce, undefined, initState);
  const llm = useMemo(() => !!getOpenAIKey(), []);
  useEffect(() => {
    const t = setInterval(() => dispatch({ type: "tick", at: Date.now() }), 1800);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { // OpenAI narrates agent updates at phase changes only, to limit API calls
    if (!llm) return;
    s.negs.forEach((n) => {
      if ([2, 5, 7].includes(n.t))
        askLLM(`Deal: ${n.item}, ask ${n.ask}, offer ${n.offer} ${n.currency}. Status: ${n.log}. Give a one-sentence update.`, n.log)
          .then((text) => dispatch({ type: "log", id: n.id, t: n.t, text }));
    });
  }, [s.negs, llm]);
  const value = useMemo(() => ({ negotiations: s.negs, contracts: s.contracts, ledger: s.ledger, today: s.today, llm }), [s, llm]);
  return <TaraxCtx.Provider value={value}>{children}</TaraxCtx.Provider>;
}

/* ───────────── Primitives ───────────── */
const Glass = ({ className = "", children }: { className?: string; children: React.ReactNode }) => (
  <div className={`rounded-2xl border border-[#FFD700]/25 bg-[rgba(255,159,28,0.05)] backdrop-blur-[16px] shadow-[0_0_0_1px_rgba(255,215,0,0.04),0_0_28px_-8px_rgba(255,159,28,0.45)] ${className}`}>
    {children}
  </div>
);
const Title = ({ icon: I, children, sub }: { icon: typeof Globe2; children: React.ReactNode; sub?: string }) => (
  <div className="mb-4 flex items-center gap-3">
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#FFD700]/25 to-[#E76F51]/20 text-[#FFD700]"><I size={18} /></span>
    <div>
      <h2 className="font-display text-xl leading-tight text-[#FBEFD5]">{children}</h2>
      {sub && <p className="text-sm text-[#FBEFD5]/55">{sub}</p>}
    </div>
  </div>
);
const tip = { background: "#12131C", border: "1px solid rgba(255,159,28,.3)", borderRadius: 12, color: "#FBEFD5", fontSize: 12 };

/* ───────────── Trade engine ───────────── */
const AGENTS: { k: AgentKey; label: string; icon: typeof Scale; role: string }[] = [
  { k: "negotiator", label: "Negotiator", icon: Handshake, role: "Bargains price" },
  { k: "compliance", label: "Compliance", icon: ShieldCheck, role: "ISO / CE / FDA" },
  { k: "logistics", label: "Logistics", icon: Truck, role: "Incoterms routing" },
  { k: "finance", label: "Finance", icon: Coins, role: "Escrow & milestones" },
];
const stateStyle: Record<AgentState, string> = {
  idle: "border-white/10 text-white/40",
  working: "border-[#FF9F1C]/60 bg-[#FF9F1C]/10 text-[#FFB547] animate-pulse",
  done: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  flagged: "border-[#E76F51]/70 bg-[#E76F51]/15 text-[#FF8F73]",
};

function NegotiationCard({ n }: { n: Negotiation }) {
  const gap = ((n.ask - n.offer) / n.ask) * 100;
  return (
    <Glass className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg text-[#FBEFD5]">{n.supplier} <span className="text-[#FBEFD5]/40">with</span> {n.buyer}</p>
          <p className="text-sm text-[#FBEFD5]/50">{n.rfq} · {n.incoterm}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums text-[#FFD700]">{n.offer.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p className="text-xs text-[#FBEFD5]/50">asking {n.ask.toLocaleString()} {n.currency} · gap {gap.toFixed(1)}%</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {AGENTS.map(({ k, label, icon: I, role }) => (
          <div key={k} className={`rounded-xl border px-3 py-2 text-xs ${stateStyle[agentState(n, k)]}`}>
            <div className="flex items-center gap-1.5 font-medium"><I size={14} />{label}</div>
            <div className="mt-0.5 opacity-70">{agentState(n, k) === "flagged" ? "Needs review" : agentState(n, k) === "done" ? "Cleared" : agentState(n, k) === "idle" ? "Waiting" : role}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-[#E76F51] via-[#FF9F1C] to-[#FFD700] transition-all duration-1000" style={{ width: `${n.progress}%` }} />
      </div>
      <p className="mt-2 text-sm text-[#FBEFD5]/60">{n.log}</p>
    </Glass>
  );
}

function TradeEngine() {
  const { negotiations, contracts } = useTarax();
  const suppliers = useLive<Supplier[]>("/suppliers", mock.suppliers);
  const rfqs = useLive<RFQ[]>("/rfqs", mock.rfqs);
  const [tab, setTab] = useState<"s" | "r" | "c">("s");
  const tabs = [["s", "Suppliers", Building2], ["r", "Buyer RFQs", Package], ["c", "Contracts", FileSignature]] as const;

  return (
    <div className="space-y-8">
      <section>
        <Title icon={Handshake} sub="Four agents work every deal in parallel">Live negotiations</Title>
        <div className="grid gap-4 xl:grid-cols-2">{negotiations.map((n) => <NegotiationCard key={n.id} n={n} />)}</div>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap gap-2">
          {tabs.map(([k, label, I]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD700] ${tab === k ? "border-[#FFD700]/60 bg-[#FFD700]/10 text-[#FFD700]" : "border-white/10 text-[#FBEFD5]/60 hover:border-amber-400/40"}`}>
              <I size={15} />{label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tab === "s" && suppliers.map((s) => (
            <Glass key={s.id} className="p-5">
              <div className="flex items-start justify-between">
                <div><p className="font-display text-lg text-[#FBEFD5]">{s.name}</p><p className="text-sm text-[#FBEFD5]/50">{s.country} · {s.category}</p></div>
                <span className="rounded-lg bg-[#FFD700]/10 px-2 py-1 text-sm font-semibold text-[#FFD700]">{s.score}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{s.certs.map((c) => <span key={c} className="flex items-center gap-1 rounded-full border border-[#4CC9F0]/30 px-2.5 py-1 text-xs text-[#4CC9F0]"><BadgeCheck size={12} />{c}</span>)}</div>
            </Glass>
          ))}
          {tab === "r" && rfqs.map((r) => (
            <Glass key={r.id} className="p-5">
              <p className="text-sm text-[#FBEFD5]/50">{r.id} · {r.buyer}</p>
              <p className="mt-1 font-display text-lg text-[#FBEFD5]">{r.item}</p>
              <div className="mt-3 flex justify-between text-sm"><span className="text-[#FBEFD5]/60">{r.qty}</span><span className="text-[#FFD700]">Target {r.target}</span></div>
              <p className="mt-2 text-xs text-[#FF9F1C]">Closes in {r.deadline}</p>
            </Glass>
          ))}
          {tab === "c" && contracts.map((c) => (
            <Glass key={c.id} className="p-5">
              <div className="flex justify-between"><p className="text-sm text-[#FBEFD5]/50">{c.id} · {c.incoterm}</p><span className="text-xs text-[#4CC9F0]">{c.status}</span></div>
              <p className="mt-1 font-display text-lg text-[#FBEFD5]">{c.parties}</p>
              <p className="mt-2 text-2xl font-semibold text-[#FFD700]">{usd(c.valueUsd)}</p>
              <div className="mt-3 flex gap-1.5" aria-label={`${c.milestones[0]} of ${c.milestones[1]} escrow milestones released`}>
                {Array.from({ length: c.milestones[1] }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < c.milestones[0] ? "bg-[#FF9F1C]" : "bg-white/10"}`} />)}
              </div>
              <p className="mt-1.5 text-xs text-[#FBEFD5]/50">{c.milestones[0]} of {c.milestones[1]} escrow milestones released</p>
              <p className="mt-3 rounded-lg bg-[#FFD700]/10 px-3 py-2 text-sm text-[#FFD700]">TARAX earns {usd(fees(c).total)} on this deal</p>
            </Glass>
          ))}
        </div>
      </section>

      <section>
        <Title icon={Gauge} sub="Average offer vs. ask across active deals">Deal analytics</Title>
        <Glass className="h-64 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={negotiations.map((n) => ({ n: n.rfq, ask: +(n.ask / n.ask * 100).toFixed(1), offer: +((n.offer / n.ask) * 100).toFixed(1) }))}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="n" stroke="#FBEFD5" opacity={0.5} fontSize={12} />
              <YAxis domain={[80, 100]} stroke="#FBEFD5" opacity={0.5} fontSize={12} unit="%" />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,159,28,.08)" }} />
              <Bar dataKey="ask" name="Ask" fill="#E76F51" radius={[6, 6, 0, 0]} />
              <Bar dataKey="offer" name="Current offer" fill="#FFD700" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Glass>
      </section>
    </div>
  );
}

/* ───────────── Market intelligence ───────────── */
const levelStyle = { ok: "text-emerald-300 bg-emerald-400/10", watch: "text-[#FFB547] bg-[#FF9F1C]/10", critical: "text-[#FF8F73] bg-[#E76F51]/20" } as const;

function MarketIntel() {
  const bdi = useLive("/intel/freight", mock.bdi, 60000);
  const commodities = useLive("/intel/commodities", mock.commodities, 30000);
  const fx = useLive("/intel/fx", mock.fx, 15000);
  const ports = useLive("/intel/ports", mock.ports, 60000);
  const macro = useLive("/intel/macro", mock.macro, 3600000);
  const alerts = useMemo(() => fx.filter((f) => f.alert).length + ports.filter((p) => p.level === "critical").length, [fx, ports]);
  const last = bdi[bdi.length - 1];

  return (
    <div className="space-y-8">
      {alerts > 0 && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-[#E76F51]/50 bg-[#E76F51]/10 px-4 py-3 text-sm text-[#FFB5A3]">
          <TriangleAlert size={18} className="shrink-0" />
          {alerts} active alerts: currency swings and port delays may affect open contracts. Review the cards below.
        </div>
      )}
      <section className="grid gap-4 lg:grid-cols-3">
        <Glass className="p-4 lg:col-span-2">
          <Title icon={Ship} sub={`Baltic Dry ${last.bdi.toLocaleString()} · Container index ${last.scfi.toLocaleString()}`}>Freight and shipping</Title>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={bdi}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF9F1C" stopOpacity={0.5} /><stop offset="100%" stopColor="#FF9F1C" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                <XAxis dataKey="d" stroke="#FBEFD5" opacity={0.5} fontSize={12} interval={3} />
                <YAxis stroke="#FBEFD5" opacity={0.5} fontSize={12} />
                <Tooltip contentStyle={tip} />
                <Area dataKey="bdi" name="Baltic Dry" stroke="#FF9F1C" strokeWidth={2} fill="url(#g1)" />
                <Area dataKey="scfi" name="Container spot" stroke="#4CC9F0" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Glass>
        <Glass className="p-4">
          <Title icon={Flame} sub="Metals, energy, polymers">Commodities</Title>
          <ul className="divide-y divide-white/5">
            {commodities.map((c) => (
              <li key={c.n} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-[#FBEFD5]">{c.n}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-[#FBEFD5]/60">{c.p}</span>
                  <span className={`flex w-16 items-center justify-end gap-1 tabular-nums ${c.c >= 0 ? "text-emerald-300" : "text-[#FF8F73]"}`}>
                    {c.c >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{Math.abs(c.c).toFixed(1)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Glass>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Glass className="p-4">
          <Title icon={Coins} sub="30-day volatility, annualised">Currency alerts</Title>
          <ul className="space-y-2">
            {fx.map((f) => (
              <li key={f.pair} className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${f.alert ? "bg-[#E76F51]/15 text-[#FFB5A3]" : "bg-white/[0.03] text-[#FBEFD5]"}`}>
                <span className="font-medium">{f.pair}</span>
                <span className="tabular-nums opacity-70">{f.v}</span>
                <span className="tabular-nums">{f.vol}%{f.alert && " · high"}</span>
              </li>
            ))}
          </ul>
        </Glass>
        <Glass className="p-4">
          <Title icon={Anchor} sub="Average wait in days">Port congestion</Title>
          <ul className="space-y-2">
            {ports.map((p) => (
              <li key={p.port} className="flex items-center justify-between text-sm">
                <span className="text-[#FBEFD5]">{p.port}</span>
                <span className={`rounded-full px-3 py-1 text-xs tabular-nums ${levelStyle[p.level as keyof typeof levelStyle]}`}>{p.wait} days</span>
              </li>
            ))}
          </ul>
        </Glass>
        <Glass className="p-4">
          <Title icon={Globe2} sub="Higher means riskier">Country risk score</Title>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={macro} layout="vertical" margin={{ left: 16 }}>
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis type="category" dataKey="country" stroke="#FBEFD5" opacity={0.7} fontSize={12} width={64} />
                <Tooltip contentStyle={tip} />
                <Line dataKey="risk" stroke="transparent" dot={{ r: 6, fill: "#FFD700", stroke: "#E76F51", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Glass>
      </section>
    </div>
  );
}

/* ───────────── Revenue & commission engine ───────────── */
const TIERS = [
  { k: "gold", name: "Gold verified", price: 499, perks: "Verified badge, priority RFQ matching", color: "#FFD700" },
  { k: "platinum", name: "Platinum verified", price: 1499, perks: "Top placement, dedicated agents, lower escrow limits", color: "#4CC9F0" },
] as const;

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Glass className="p-5">
      <p className="text-sm text-[#FBEFD5]/55">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-[#FFD700]">{value}</p>
      <p className="mt-1 text-xs text-[#FBEFD5]/45">{note}</p>
    </Glass>
  );
}

function RevenueEngine() {
  const { contracts, ledger, today } = useTarax();
  const [subs, setSubs] = useState({ gold: 128, platinum: 34 });
  const rows = contracts.map((c) => ({ c, ...fees(c) }));
  const deals = rows.reduce((a, r) => a + r.total, 0);
  const mrr = subs.gold * 499 + subs.platinum * 1499;
  const saved = contracts.reduce((a, c) => a + c.savingUsd, 0);
  const chart = rows.slice(0, 6).reverse().map((r) => ({ n: r.c.id, Transaction: Math.round(r.tx), Escrow: Math.round(r.escrow), Savings: Math.round(r.sav) }));

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Deal commissions" value={usd(deals)} note="Across all executed contracts" />
        <Stat label="Subscriptions per month" value={usd(mrr)} note={`${subs.gold + subs.platinum} verified suppliers`} />
        <Stat label="Accruing today" value={usd(today)} note="Updates as milestones release" />
        <Stat label="Buyer savings delivered" value={usd(saved)} note="Found by Negotiator agents" />
      </section>

      <section>
        <Title icon={Coins} sub="Fees post the moment a deal closes or a milestone releases">Live fee feed</Title>
        <Glass className="p-4">
          <ul className="divide-y divide-white/5" aria-live="polite">
            {ledger.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-[#FBEFD5]">{e.contract} · {e.kind} fee</span>
                <span className="tabular-nums text-[#FFD700]">+{usd(e.amount)}</span>
              </li>
            ))}
            {ledger.length === 0 && <li className="py-2 text-sm text-[#FBEFD5]/50">The next deal to close will post its fees here.</li>}
          </ul>
        </Glass>
      </section>

      <section>
        <Title icon={Wallet} sub="Every rule below runs automatically on each contract">Commission rules</Title>
        <div className="grid gap-4 md:grid-cols-3">
          <Glass className="p-5">
            <p className="font-display text-lg text-[#FBEFD5]">Dynamic transaction fee</p>
            <p className="mt-1 text-3xl font-semibold text-[#FFD700]">1.0–1.5%</p>
            <ul className="mt-3 space-y-1 text-sm text-[#FBEFD5]/60">
              <li>1.5% under $250k</li><li>1.25% from $250k to $750k</li><li>1.0% above $750k</li>
            </ul>
          </Glass>
          <Glass className="p-5">
            <p className="font-display text-lg text-[#FBEFD5]">Smart escrow fee</p>
            <p className="mt-1 text-3xl font-semibold text-[#FFD700]">0.3%</p>
            <p className="mt-3 text-sm text-[#FBEFD5]/60">Charged on each milestone tranche when escrow releases it to the supplier.</p>
          </Glass>
          <Glass className="p-5">
            <p className="font-display text-lg text-[#FBEFD5]">AI negotiation savings fee</p>
            <p className="mt-1 text-3xl font-semibold text-[#FFD700]">10%</p>
            <p className="mt-3 text-sm text-[#FBEFD5]/60">Of the difference between the supplier&apos;s ask and the price the Negotiator agent closes at.</p>
          </Glass>
        </div>
      </section>

      <section>
        <Title icon={Crown} sub="Adjust supplier counts to model recurring revenue">Verified supplier subscriptions</Title>
        <div className="grid gap-4 md:grid-cols-2">
          {TIERS.map((t) => (
            <Glass key={t.k} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="flex items-center gap-2 font-display text-lg text-[#FBEFD5]"><Crown size={18} style={{ color: t.color }} />{t.name}</p>
                  <p className="mt-1 text-sm text-[#FBEFD5]/55">{t.perks}</p>
                </div>
                <p className="text-xl font-semibold tabular-nums" style={{ color: t.color }}>${t.price}<span className="text-xs text-[#FBEFD5]/45"> /mo</span></p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button aria-label={`Fewer ${t.name} suppliers`} onClick={() => setSubs((s) => ({ ...s, [t.k]: Math.max(0, s[t.k] - 5) }))} className="h-9 w-9 rounded-full border border-[#FFD700]/30 text-lg text-[#FFD700] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD700]">−</button>
                  <span className="w-12 text-center text-lg tabular-nums">{subs[t.k]}</span>
                  <button aria-label={`More ${t.name} suppliers`} onClick={() => setSubs((s) => ({ ...s, [t.k]: s[t.k] + 5 }))} className="h-9 w-9 rounded-full border border-[#FFD700]/30 text-lg text-[#FFD700] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD700]">+</button>
                </div>
                <p className="text-sm tabular-nums text-[#FBEFD5]/70">{usd(subs[t.k] * t.price)} per month</p>
              </div>
            </Glass>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Glass className="h-80 p-4 lg:col-span-2">
          <p className="mb-2 font-display text-lg text-[#FBEFD5]">Earnings by contract</p>
          <ResponsiveContainer width="100%" height="88%">
            <BarChart data={chart}>
              <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="n" stroke="#FBEFD5" opacity={0.5} fontSize={12} />
              <YAxis stroke="#FBEFD5" opacity={0.5} fontSize={12} />
              <Tooltip contentStyle={tip} cursor={{ fill: "rgba(255,159,28,.08)" }} formatter={(v: number) => usd(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Transaction" stackId="a" fill="#FFD700" />
              <Bar dataKey="Escrow" stackId="a" fill="#FF9F1C" />
              <Bar dataKey="Savings" stackId="a" fill="#4CC9F0" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Glass>
        <div className="space-y-3 lg:col-span-3">
          {rows.slice(0, 5).map((r) => (
            <Glass key={r.c.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-base text-[#FBEFD5]">{r.c.id} · {r.c.parties}</p>
                <p className="text-lg font-semibold tabular-nums text-[#FFD700]">{usd(r.total)}</p>
              </div>
              <p className="mt-1 text-xs text-[#FBEFD5]/50">Deal value {usd(r.c.valueUsd)} · {r.c.status}</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-[#FBEFD5]/50">Transaction ({(txRate(r.c.valueUsd) * 100).toFixed(2)}%)</dt><dd className="tabular-nums text-[#FFD700]">{usd(r.tx)}</dd></div>
                <div><dt className="text-xs text-[#FBEFD5]/50">Escrow (0.3%)</dt><dd className="tabular-nums text-[#FF9F1C]">{usd(r.escrow)}</dd></div>
                <div><dt className="text-xs text-[#FBEFD5]/50">Savings (10%)</dt><dd className="tabular-nums text-[#4CC9F0]">{usd(r.sav)}</dd></div>
              </dl>
            </Glass>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ───────────── Global trade matrix ───────────── */
const NODES = [
  { id: "LAX", name: "Los Angeles", x: 90, y: 150 }, { id: "SAO", name: "Santos", x: 230, y: 300 },
  { id: "HAM", name: "Hamburg", x: 390, y: 95 }, { id: "IST", name: "Istanbul", x: 470, y: 160 },
  { id: "DXB", name: "Dubai", x: 540, y: 215 }, { id: "NBO", name: "Nairobi", x: 490, y: 300 },
  { id: "BOM", name: "Mumbai", x: 625, y: 250 }, { id: "SHA", name: "Shanghai", x: 710, y: 150 },
];
const ROUTES: [string, string, number][] = [
  ["SHA", "HAM", 42], ["SHA", "LAX", 58], ["SHA", "BOM", 19], ["BOM", "DXB", 24], ["DXB", "IST", 15],
  ["IST", "HAM", 21], ["BOM", "NBO", 12], ["SAO", "HAM", 17], ["LAX", "SAO", 9],
];
const NODE: Record<string, (typeof NODES)[number]> = Object.fromEntries(NODES.map((n) => [n.id, n]));
const arc = (a: string, b: string) => {
  const A = NODE[a], B = NODE[b];
  return `M${A.x} ${A.y} Q${(A.x + B.x) / 2} ${(A.y + B.y) / 2 - Math.abs(A.x - B.x) * 0.18 - 20} ${B.x} ${B.y}`;
};

function TradeMatrix() {
  const { contracts } = useTarax();
  const [sel, setSel] = useState("SHA");
  const lanes = useMemo(() => {
    const key = (a: string, b: string) => [a, b].sort().join("-");
    const m = new Map<string, { a: string; b: string; base: number; live: number }>();
    ROUTES.forEach(([a, b, v]) => m.set(key(a, b), { a, b, base: v, live: 0 }));
    contracts.forEach((c) => {
      const k = key(c.from, c.to);
      const l = m.get(k) ?? { a: c.from, b: c.to, base: 0, live: 0 };
      l.live += c.valueUsd / 1e6;
      m.set(k, l);
    });
    return [...m.values()];
  }, [contracts]);
  const linked = lanes.filter((l) => l.a === sel || l.b === sel);
  const volume = linked.reduce((t, l) => t + l.base + l.live, 0);
  const mine = contracts.filter((c) => c.from === sel || c.to === sel);
  const earned = mine.reduce((t, c) => t + fees(c).total, 0);
  return (
    <div className="space-y-6">
      <Title icon={Network} sub="Lanes light up as live contracts execute; select a hub for details">Global trade matrix</Title>
      <Glass className="p-3 sm:p-5">
        <svg viewBox="0 0 800 360" className="w-full" role="group" aria-label="Map of trade routes between global hubs">
          {lanes.map((l) => {
            const on = l.a === sel || l.b === sel;
            return <path key={l.a + l.b} d={arc(l.a, l.b)} fill="none" className={on || l.live > 0 ? "flow" : ""}
              stroke={on ? "#FFD700" : l.live > 0 ? "rgba(255,159,28,.7)" : "rgba(255,159,28,.22)"} strokeWidth={on ? 2.5 : 1.5 + Math.min(l.live, 3)} />;
          })}
          {NODES.map((n) => {
            const on = n.id === sel || linked.some((l) => l.a === n.id || l.b === n.id);
            return (
              <g key={n.id} role="button" tabIndex={0} aria-label={`${n.name} hub`} aria-pressed={n.id === sel} className="cursor-pointer outline-none"
                onClick={() => setSel(n.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSel(n.id)}>
                <circle cx={n.x} cy={n.y} r={n.id === sel ? 22 : 15} fill="rgba(255,159,28,.12)" stroke={on ? "#FFD700" : "rgba(255,159,28,.4)"} strokeWidth={1.5} />
                <circle cx={n.x} cy={n.y} r={6} fill={n.id === sel ? "#FFD700" : "#FF9F1C"} />
                <text x={n.x} y={n.y + 36} textAnchor="middle" fontSize={17} fill={on ? "#FBEFD5" : "rgba(251,239,213,.55)"}>{n.name}</text>
              </g>
            );
          })}
        </svg>
      </Glass>
      <Glass className="p-5">
        <p className="font-display text-lg text-[#FBEFD5]">{NODE[sel].name}: {linked.length} lanes, ${volume.toFixed(1)}M trade volume</p>
        <p className="mt-1 text-sm text-[#FFD700]">TARAX has earned {usd(earned)} from {mine.length} live contracts here</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {linked.map((l) => (
            <li key={l.a + l.b} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
              <span className="text-[#FBEFD5]">{NODE[l.a].name} ↔ {NODE[l.b].name}</span>
              <span className="tabular-nums text-[#FFD700]">${(l.base + l.live).toFixed(1)}M</span>
            </li>
          ))}
        </ul>
        {mine.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-white/5 pt-3 text-sm text-[#FBEFD5]/65">
            {mine.slice(0, 4).map((c) => <li key={c.id}>{c.id} · {c.parties} · {usd(c.valueUsd)}</li>)}
          </ul>
        )}
      </Glass>
    </div>
  );
}

/* ───────────── Shell ───────────── */
const NAV = [
  { k: "engine", label: "Trade engine", icon: LayoutDashboard },
  { k: "intel", label: "Market intelligence", icon: Radar },
  { k: "revenue", label: "Revenue engine", icon: Wallet },
  { k: "matrix", label: "Trade matrix", icon: Network },
] as const;

function Shell() {
  const [view, setView] = useState<"engine" | "intel" | "revenue" | "matrix">("engine");
  const [open, setOpen] = useState(false);
  const { llm } = useTarax();

  const nav = (
    <nav className="flex flex-col gap-1 p-4">
      {NAV.map(({ k, label, icon: I }) => (
        <button key={k} onClick={() => { setView(k); setOpen(false); }} aria-current={view === k ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FFD700] ${view === k ? "bg-[#FF9F1C]/15 text-[#FFD700]" : "text-[#FBEFD5]/65 hover:bg-white/5"}`}>
          <I size={18} />{label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#0A0B0E] font-body text-[#FBEFD5] [background-image:radial-gradient(900px_420px_at_85%_-5%,rgba(255,159,28,.16),transparent),radial-gradient(700px_400px_at_0%_30%,rgba(76,201,240,.06),transparent)]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Manrope:wght@400;500;600&display=swap');
        .font-display{font-family:'Fraunces',Georgia,serif}.font-body{font-family:'Manrope',system-ui,sans-serif}
        @keyframes sheen{0%{background-position:-200% 0}100%{background-position:200% 0}}
        .badge-sheen{background-image:linear-gradient(100deg,#FFD700 0%,#FFF3B0 20%,#4CC9F0 32%,#FFD700 46%,#E76F51 70%,#FFD700 100%);background-size:250% 100%;animation:sheen 7s linear infinite}
        .flow{stroke-dasharray:6 8;animation:flow 1.4s linear infinite}@keyframes flow{to{stroke-dashoffset:-28}}
        @media (prefers-reduced-motion:reduce){.badge-sheen,.animate-pulse,.flow{animation:none}}
      `}</style>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-amber-400/10 bg-[#12131C]/80 backdrop-blur-xl lg:block">
        <div className="flex items-center gap-2 px-6 pt-7"><Flame className="text-[#FF9F1C]" /><span className="font-display text-2xl">TARAX AI</span></div>
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 bg-[#12131C]">
            <button aria-label="Close menu" onClick={() => setOpen(false)} className="absolute right-3 top-3 p-2"><X size={20} /></button>
            <div className="flex items-center gap-2 px-6 pt-7"><Flame className="text-[#FF9F1C]" /><span className="font-display text-2xl">TARAX AI</span></div>
            {nav}
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-amber-400/10 bg-[#0A0B0E]/80 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="p-2"><Menu size={22} /></button>
          <span className="font-display text-xl">TARAX AI</span>
        </header>

        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
          <section className="mb-10">
            <span className="badge-sheen inline-block rounded-full p-px">
              <span className="block rounded-full bg-[#0A0B0E] px-4 py-1.5 text-xs font-semibold tracking-wide text-[#FFD700]">
                TARAX AI · Autonomous Global B2B Trade &amp; Multi-Agent Negotiation Engine
              </span>
            </span>
            <h1 className="font-display mt-5 max-w-4xl text-3xl leading-[1.15] text-[#FBEFD5] sm:text-5xl">
              TARAX AI — The World&apos;s Most Advanced Autonomous Neural Network Connecting Global Manufacturers & Buyers.
            </h1>
            <p className="mt-4 max-w-xl text-base text-[#FBEFD5]/65">
              Negotiation, compliance, logistics and smart escrow run as one live deal suite, and TARAX collects its commission automatically at every step.
            </p>
          </section>
          {view === "engine" ? <TradeEngine /> : view === "intel" ? <MarketIntel /> : view === "revenue" ? <RevenueEngine /> : <TradeMatrix />}
          <footer className="mt-14 border-t border-white/5 pt-6 text-xs text-[#FBEFD5]/40">TARAX AI · Autonomous Global B2B Trade · {llm ? "OpenAI-assisted agents" : "Local agent engine"}</footer>
        </div>
      </main>
    </div>
  );
}

export default function TaraxApp() {
  return (
    <TaraxProvider>
      <Shell />
    </TaraxProvider>
  );
}
