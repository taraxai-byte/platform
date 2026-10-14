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
  Anchor, Building2, Network, Wallet, Coins, FileSignature, Flame, Gauge, Globe2,
  Handshake, LayoutDashboard, Menu, Package, Radar, Scale, Truck, X,
  CheckCircle2, AlertTriangle, ShieldCheck
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
    { id: "C-5580", parties: "Nova Polymers → Hamburg Industrie", valueUsd: 283200, savingUsd: 20400, incoterm: "CIF Hamburg", milestones:, status: "In transit", from: "SHA", to: "HAM", age: 0 },
    { id: "C-5574", parties: "Gujarat Steel → Nairobi BuildCo", valueUsd: 1100000, savingUsd: 50400, incoterm: "FOB Mundra", milestones:, status: "Escrow funded", from: "BOM", to: "NBO", age: 1 },
    { id: "C-5569", parties: "Istanbul MedTex → Dubai MedSupply", valueUsd: 612000, savingUsd: 18000, incoterm: "DDP Dubai", milestones:, status: "Completed", from: "IST", to: "DXB", age: 4 },
  ] as Contract[],
  bdi: Array.from({ length: 24 }, (_, i) => ({ d: `W${i + 1}`, bdi: 1400 + Math.round(Math.sin(i / 3) * 260 + i * 18), scfi: 1900 + Math.round(Math.cos(i / 4) * 340) })),
  commodities: [
    { n: "Copper", p: "$9,840 / t", c: 1.8 }, { n: "Aluminium", p: "$2,610 / t", c: -0.6 },
    { n: "Brent crude", p: "$81.20 / bbl", c: 2.4 }, { n: "HDPE (Asia)", p: "$1,140 / t", c: -1.1 },
    { n: "Natural gas (TTF)", p: "€34.5 / MWh", c: 3.2 }, { n: "Iron ore", p: "$108 / t", c: -0.3 },
  ],
  fx: [
    { pair: "USD/CNY", v: 7.24, vol: 4.1, alert: false }, 
    { pair: "EUR/USD", v: 1.081, vol: 5.6, alert: false },
    { pair: "USD/INR", v: 83.4, vol: 3.2, alert: false }
  ],
};

/* ───────────── State & Reducer Setup ───────────── */
type AppState = {
  negotiations: Negotiation[];
  suppliers: Supplier[];
  rfqs: RFQ[];
  contracts: Contract[];
  activeAgent: AgentKey | "all";
  agentStates: Record<AgentKey, AgentState>;
  loading: boolean;
};

type AppAction =
  | { type: "SET_DATA"; payload: Partial<AppState> }
  | { type: "UPDATE_NEGOTIATION"; payload: Negotiation }

  | { type: "SET_ACTIVE_AGENT"; payload: AgentKey | "all" }
  | { type: "SET_AGENT_STATE"; payload: { agent: AgentKey; state: AgentState } };

const initialState: AppState = {
  negotiations: [],
  suppliers: mock.suppliers,
  rfqs: mock.rfqs,
  contracts: mock.contracts,
  activeAgent: "all",
  agentStates: {
    negotiator: "idle",
    compliance: "idle",
    logistics: "idle",
    finance: "idle",
  },
  loading: true,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_DATA":
      return { ...state, ...action.payload };
    case "UPDATE_NEGOTIATION":
      return {
        ...state,
        negotiations: state.negotiations.map((n) =>
          n.id === action.payload.id ? action.payload : n
        ),
      };
    case "SET_ACTIVE_AGENT":
      return { ...state, activeAgent: action.payload };
    case "SET_AGENT_STATE":
      return {
        ...state,
        agentStates: {
          ...state.agentStates,
          [action.payload.agent]: action.payload.state,
        },
      };
    default:
      return state;
  }
}

/* ───────────── Live Hook Data Layer ───────────── */
export function useLiveEngine() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    let active = true;
    async function fetchEngineData() {
      try {
        const res = await fetch(`${API}/status`);
        if (!res.ok) throw new Error("Backend offline");
        const data = await res.json();
        if (active) {
          dispatch({
            type: "SET_DATA",
            payload: {
              negotiations: data.negotiations || [],
              contracts: data.contracts || mock.contracts,
              loading: false,
            },
          });
        }
      } catch (err) {
        console.warn("TARAX Engine unreachable, using local fallback UI.");
        if (active) {
          dispatch({
            type: "SET_DATA",
            payload: { negotiations: [], loading: false },
          });
        }
      }
    }

    fetchEngineData();
    const interval = setInterval(fetchEngineData, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { state, dispatch };
}

/* ───────────── Main Dashboard Interface Component ───────────── */
export default function TaraxDashboard() {
  const { state, dispatch } = useLiveEngine();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (state.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm font-medium tracking-wide text-slate-400">Booting Tarax Multi-Agent Core Engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      {/* 1. Header Section */}
      <header className="border-b border-slate-800 bg-slate-900/50 p-4 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Network className="h-6 w-6 text-blue-500 animate-pulse" />
            <h1 className="text-xl font-bold tracking-tight">
              TARAX AI Core <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20 ml-2">Multi-Agent v1.0</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="text-xs text-slate-400 font-mono">ENGINE: LIVE</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        {/* 2. Autonomous Agent Grid */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wider text-slate-400 uppercase flex items-center gap-2">
            <Gauge className="h-4 w-4 text-slate-400" /> Autonomous Agent Grid
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(state.agentStates).map(([agent, status]) => (
              <div key={agent} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between h-28 hover:border-slate-700 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold capitalize text-slate-200">{agent}</span>
                  <div className={`h-2 w-2 rounded-full ${
