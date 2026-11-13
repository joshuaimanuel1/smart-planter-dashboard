"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Download,
  Droplets,
  Lightbulb,
  Moon,
  Sparkles,
  Sprout,
  Sun,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
  X,
  Activity,
  Bot,
} from "lucide-react";
import {
  API,
  Dash,
  Latest,
  Thresholds,
  exportUrl,
  getDashboard,
  sendControl,
} from "@/lib/api";
import PlantHero from "./PlantHero";

type LatestWithSoilTemp = Latest & {
  soil_temperature?: number;
  predicted_moisture_10min?: number;
  pump_confidence?: number;
  light_confidence?: number;
  forecast_band?: number;
};

const RANGES = ["1h", "6h", "24h", "7d"] as const;
const DEF_T: Thresholds = {
  pumpOn: 30,
  pumpOff: 70,
  lightOn: 60,
  lightOff: 80,
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const near = (v: number, lo: number, hi: number, span: number) =>
  v >= lo && v <= hi
    ? 1
    : clamp(1 - Math.min(Math.abs(v - lo), Math.abs(v - hi)) / span);
const health = (l: LatestWithSoilTemp, T: Thresholds) =>
  Math.round(
    100 *
      (0.4 * near(l.soil_moisture, T.pumpOn, T.pumpOff, 30) +
        0.3 * near(l.temperature, 20, 30, 10) +
        0.3 * clamp(l.ldr_light / T.lightOn)),
  );

const METRICS = {
  tanah: {
    label: "Tanah & cahaya",
    domain: [0, 100],
    lines: [
      { k: "soil", n: "Tanah (%)", c: "#0A84FF" },
      { k: "ldr", n: "Cahaya (%)", c: "#FF9F0A" },
    ],
  },
  iklim: {
    label: "Iklim",
    domain: ["auto", "auto"],
    lines: [
      { k: "temp", n: "Suhu ruangan (°C)", c: "#FF453A" },
      { k: "soilTemperature", n: "Suhu tanah (°C)", c: "#FF8C00" },
      { k: "hum", n: "Kelembapan udara (%)", c: "#5AC8FA" },
    ],
  },
  uv: {
    label: "Indeks UV",
    domain: [0, "auto"],
    lines: [{ k: "uv", n: "Indeks UV", c: "#AF52DE" }],
  },
  ml: {
    label: "Analisis AI",
    domain: [0, 100],
    lines: [
      { k: "soil", n: "Aktual (%)", c: "#0A84FF" },
      { k: "predicted", n: "Prediksi 10 mnt lalu (%)", c: "#AF52DE" },
    ],
  },
} as const;

const fmt = (t: string, long = false) =>
  new Date(t).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    ...(long ? { second: "2-digit" } : {}),
  });
const pad = (n: number) => String(n).padStart(2, "0");
const localInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const field =
  "w-full rounded-xl bg-mist px-3 py-2.5 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-azure";

function Tile({ icon: I, label, value, unit, note, pct, tint }: any) {
  return (
    <div className="card flex min-h-[148px] flex-col justify-between !p-5 hover:scale-[1.02] transition-transform duration-300">
      <div className="flex items-center gap-2 text-sm font-medium text-sub">
        <I className="h-4 w-4" style={{ color: tint }} />
        {label}
      </div>
      <div>
        <p className="text-4xl font-semibold tabular-nums tracking-tight">
          {value}
          <span className="ml-1 text-lg font-medium text-sub">{unit}</span>
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-mist overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${clamp(pct) * 100}%`, background: tint }}
          />
        </div>
        <p className="mt-1.5 truncate text-xs text-sub">{note}</p>
      </div>
    </div>
  );
}

function SwitchGlass({
  on,
  disabled,
  tint,
  label,
  sub,
  icon: I,
  onToggle,
}: any) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/20 dark:bg-white/5 backdrop-blur-md p-3.5 transition-colors hover:bg-white/30 dark:hover:bg-white/10 border border-white/30 dark:border-white/5">
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-[14px] bg-white dark:bg-black/50 shadow-sm"
          style={{ color: tint }}
        >
          <I className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink dark:text-white">
            {label}
          </p>
          <p className="text-xs font-medium text-ink/70 dark:text-white/60">
            {sub}
          </p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        className="relative h-8 w-14 rounded-full transition-colors duration-300 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-azure shadow-inner"
        style={{ background: on ? tint : "rgba(0,0,0,0.25)" }}
      >
        <span
          className="absolute top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-all duration-300"
          style={{ left: on ? 28 : 4 }}
        />
      </button>
    </div>
  );
}

type Mode = "quick" | "range" | "month";
const QUICK: [string, number][] = [
  ["1 jam", 1],
  ["6 jam", 6],
  ["24 jam", 24],
  ["7 hari", 168],
  ["30 hari", 720],
  ["Semua data", 0],
];

function ExportDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("quick");
  const [hours, setHours] = useState(24);
  const [from, setFrom] = useState(() =>
    localInput(new Date(Date.now() - 864e5)),
  );
  const [to, setTo] = useState(() => localInput(new Date()));
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
  const [count, setCount] = useState<number | null>(null);

  const params = useMemo<{ from?: string; to?: string; error?: string }>(() => {
    if (mode === "quick")
      return hours
        ? { from: new Date(Date.now() - hours * 36e5).toISOString() }
        : {};
    if (mode === "range") {
      const f = new Date(from),
        t = new Date(to);
      if (isNaN(+f) || isNaN(+t))
        return { error: "Tanggal/jam belum lengkap." };
      if (f >= t) return { error: "Waktu mulai harus sebelum waktu akhir." };
      return { from: f.toISOString(), to: t.toISOString() };
    }
    const [y, m] = month.split("-").map(Number);
    if (!y || !m) return { error: "Pilih bulan terlebih dahulu." };
    return {
      from: new Date(y, m - 1, 1).toISOString(),
      to: new Date(y, m, 1).toISOString(),
    };
  }, [mode, hours, from, to, month]);

  useEffect(() => {
    setCount(null);
    if (params.error) return;
    const ac = new AbortController();
    fetch(exportUrl(params, true), { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setCount(j.count))
      .catch(() => {});
    return () => ac.abort();
  }, [params]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [onClose]);

  const ok = !params.error && count !== 0;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-md transition-opacity"
      onClick={onClose}
    >
      <div
        role="dialog"
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md space-y-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Ekspor dataset</h2>
            <p className="text-xs text-sub mt-1">
              Pilih periode data yang diunduh.
            </p>
          </div>
          <button
            onClick={onClose}
            className="pill grid h-8 w-8 place-items-center bg-mist p-0 text-sub hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 rounded-2xl bg-mist p-1">
          {(
            [
              ["quick", "Cepat"],
              ["range", "Spesifik"],
              ["month", "Per bulan"],
            ] as [Mode, string][]
          ).map(([k, t]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`pill py-2 ${mode === k ? "bg-seg shadow-sm" : "text-sub hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
        {mode === "quick" && (
          <div className="flex flex-wrap gap-2">
            {QUICK.map(([t, h]) => (
              <button
                key={t}
                onClick={() => setHours(h)}
                className={`pill px-4 py-2 ${hours === h ? "bg-ink text-onink" : "bg-mist text-sub hover:text-ink"}`}
              >
                {h ? `${t} terakhir` : t}
              </button>
            ))}
          </div>
        )}
        {mode === "range" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-sub">
              Dari
              <input
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={field}
              />
            </label>
            <label className="space-y-1 text-xs text-sub">
              Sampai
              <input
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={field}
              />
            </label>
          </div>
        )}
        {mode === "month" && (
          <label className="block space-y-1 text-xs text-sub">
            Bulan
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={field}
            />
          </label>
        )}
        <p
          className={`text-sm ${params.error || count === 0 ? "text-red-500" : "text-sub"}`}
        >
          {params.error ??
            (count === null
              ? "Menghitung…"
              : count === 0
                ? "Tidak ada data."
                : `${count.toLocaleString("id-ID")} rekaman siap diekspor`)}
        </p>
        <a
          href={ok ? exportUrl(params) : undefined}
          onClick={(e) => (ok ? setTimeout(onClose, 300) : e.preventDefault())}
          className={`pill flex items-center justify-center gap-2 py-3.5 text-sm ${ok ? "bg-ink text-onink hover:opacity-90" : "pointer-events-none bg-mist text-sub"}`}
        >
          <Download className="h-4 w-4" />
          Unduh CSV
        </a>
      </div>
    </div>
  );
}

export default function Page() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");
  const [metric, setMetric] = useState<keyof typeof METRICS>("tanah");
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  const [exporting, setExporting] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  const dark = theme === "dark";
  const toggleTheme = () => {
    const n = dark ? "light" : "dark";
    setTheme(n);
    document.documentElement.classList.toggle("dark", n === "dark");
    try {
      localStorage.setItem("theme", n);
    } catch {}
  };

  const G = dark
    ? {
        grid: "#2C2C2E",
        tick: "#98989D",
        tipBg: "#1C1C1E",
        tipFg: "#F5F5F7",
        tipBorder: "rgba(255,255,255,.12)",
        ring: "#2C2C2E",
      }
    : {
        grid: "#F0F0F2",
        tick: "#86868B",
        tipBg: "#FFFFFF",
        tipFg: "#1D1D1F",
        tipBorder: "rgba(0,0,0,.06)",
        ring: "#EDEDF0",
      };

  const load = useCallback(() => {
    getDashboard(range)
      .then((x) => {
        setD(x);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  }, [range]);

  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, [load]);

  useEffect(() => {
    const es = new EventSource(`${API}/api/stream`);
    es.addEventListener("telemetry", (e) => {
      const m = JSON.parse((e as MessageEvent).data);
      setD(
        (p) =>
          p && {
            ...p,
            latest: m.latest,
            online: m.online,
            ...(m.alerts && { alerts: m.alerts }),
          },
      );
    });
    return () => es.close();
  }, []);

  const l = d?.latest as LatestWithSoilTemp | null | undefined;
  const T = d?.thresholds ?? DEF_T;
  const M = METRICS[metric];
  const dhtOk = !!l && !(l.temperature === 0 && l.humidity === 0);
  const soilTempOk =
    !!l && typeof l.soil_temperature === "number" && l.soil_temperature > 0;
  const auto = l?.mode === "AUTO";
  const score = l ? health(l, T) : 0;

  const predictedMoisture =
    typeof l?.predicted_moisture_10min === "number"
      ? Math.round(l.predicted_moisture_10min * 10) / 10
      : null;
  const forecastBand = l?.forecast_band;
  const pumpConf = l?.pump_confidence;
  const lightConf = l?.light_confidence;
  const dstats = d?.stats as unknown as
    | {
        forecast?: {
          n: number;
          mae: number | null;
          naiveMae?: number | null;
        };
        aiVsRule?: {
          n: number;
          pumpAgreement: number | null;
          lightAgreement: number | null;
        };
      }
    | undefined;
  const fstats = dstats?.forecast;
  const cmp = dstats?.aiVsRule;

  const control = async (b: Parameters<typeof sendControl>[0]) => {
    if (l)
      setD((p) => p && p.latest && { ...p, latest: { ...p.latest, ...b } });
    await sendControl(b).catch(() => setErr("Perintah gagal dikirim"));
  };

  return (
    <div className="w-full flex flex-col bg-[rgb(var(--bg))] m-0 p-0 overflow-x-hidden">
      {/* ======================================= */}
      {/* 1. HERO SECTION (100vh)                 */}
      {/* ======================================= */}
      <section className="relative w-full h-[100vh] min-h-[750px] flex flex-col overflow-hidden m-0 p-0">
        <div className="absolute inset-0 z-0 pointer-events-none">
          <svg
            className="w-full h-full object-cover"
            viewBox="0 0 1440 800"
            preserveAspectRatio="xMidYMax slice"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="skyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  className="text-[#89b4f8] dark:text-[#0b132b]"
                  stopColor="currentColor"
                />
                <stop
                  offset="100%"
                  className="text-[#e8f0fe] dark:text-[#1c2541]"
                  stopColor="currentColor"
                />
              </linearGradient>
            </defs>
            <rect
              width="1440"
              height="800"
              fill="url(#skyGradient)"
              className="transition-colors duration-700"
            />

            <g
              className="text-white/90 dark:text-slate-800/10 transition-colors duration-700"
              fill="currentColor"
            >
              <g transform="translate(100, 100) scale(0.9)">
                <circle cx="50" cy="50" r="30" />
                <circle cx="90" cy="40" r="45" />
                <circle cx="130" cy="50" r="30" />
                <rect x="50" y="50" width="80" height="30" rx="15" />
              </g>
              <g transform="translate(750, 120) scale(1.2)">
                <circle cx="50" cy="50" r="30" />
                <circle cx="90" cy="40" r="45" />
                <circle cx="130" cy="50" r="30" />
                <rect x="50" y="50" width="80" height="30" rx="15" />
              </g>
            </g>

            <circle
              cx="720"
              cy="240"
              r="160"
              className="fill-[#FFB703]/30 dark:fill-[#94a3b8]/5 blur-2xl transition-colors duration-700"
            />
            <circle
              cx="720"
              cy="240"
              r="80"
              className="fill-[#FFD700]/50 dark:fill-[#cbd5e1]/10 blur-xl transition-colors duration-700"
            />
            <circle
              cx="720"
              cy="240"
              r="45"
              className="fill-[#FFD700] dark:fill-[#f1f5f9] transition-colors duration-700"
            />

            <path
              className="text-slate-300/60 dark:text-[#111c3a]/80 transition-colors duration-700"
              fill="currentColor"
              d="M0,550 C300,420 600,580 900,480 C1100,410 1300,480 1440,420 L1440,800 L0,800 Z"
            />
            <path
              className="text-slate-200/80 dark:text-[#0b132b]/80 transition-colors duration-700"
              fill="currentColor"
              d="M0,620 C400,520 700,660 1000,570 C1200,510 1400,580 1440,560 L1440,800 L0,800 Z"
            />

            <g transform="translate(620, 480)">
              <rect
                x="0"
                y="50"
                width="220"
                height="130"
                className="text-white dark:text-[#050b1a] transition-colors duration-700"
                fill="currentColor"
              />
              <rect
                x="-40"
                y="40"
                width="280"
                height="14"
                className="text-slate-800 dark:text-black transition-colors duration-700"
                fill="currentColor"
              />
              <rect
                x="30"
                y="70"
                width="60"
                height="110"
                className="text-sky-200/60 dark:text-amber-500/20 transition-colors duration-700"
                fill="currentColor"
              />
              <rect
                x="110"
                y="70"
                width="80"
                height="110"
                className="text-sky-200/60 dark:text-amber-500/20 transition-colors duration-700"
                fill="currentColor"
              />
              <rect
                x="-60"
                y="180"
                width="340"
                height="10"
                className="text-slate-400 dark:text-slate-900 transition-colors duration-700"
                fill="currentColor"
              />
            </g>

            <path
              className="text-[rgb(var(--bg))] transition-colors duration-700"
              fill="currentColor"
              d="M0,720 C300,670 500,690 800,660 C1100,630 1300,680 1440,660 L1440,800 L0,800 Z"
            />

            <g
              className="text-emerald-800/10 dark:text-black/30 transition-colors duration-700"
              fill="currentColor"
            >
              <polygon points="520,540 500,680 540,680" />
              <polygon points="560,500 545,620 575,620" />
              <polygon points="850,570 830,700 870,700" />
            </g>
          </svg>
        </div>

        {/* Global Header */}
        <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 mt-4 mx-4 md:mt-6 md:mx-8 lg:mt-8 lg:mx-10 rounded-full bg-white/50 dark:bg-black/20 border border-white/50 dark:border-white/10 p-2 backdrop-blur-xl shadow-sm">
          <div className="flex items-center gap-3 pl-2">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-ink dark:bg-white text-onink dark:text-black shadow-md">
              <Sprout className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight text-ink dark:text-white">
                Smart Planter
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 pr-1">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${d?.online ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400" : "bg-black/10 dark:bg-white/10 text-ink/70 dark:text-white/70"}`}
            >
              {d?.online ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {d?.online ? "Online" : "Offline"}
            </div>
            <div className="w-px h-5 bg-ink/20 dark:bg-white/10 mx-1"></div>
            <button
              onClick={toggleTheme}
              className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/60 dark:hover:bg-white/10 text-ink dark:text-white transition-colors"
            >
              {dark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => setExporting(true)}
              className="flex items-center gap-1.5 rounded-full bg-ink dark:bg-white px-4 py-1.5 text-xs font-semibold text-onink dark:text-black transition-transform hover:scale-105 shadow-md"
            >
              <Download className="h-3.5 w-3.5" /> Ekspor
            </button>
          </div>
        </header>

        {err && (
          <div className="relative z-20 mx-4 md:mx-8 mt-4 rounded-[24px] bg-red-500/80 text-white p-4 text-sm font-medium backdrop-blur-md">
            {err}
          </div>
        )}

        {/* Konten Hero */}
        <div className="relative z-10 flex-1 w-full max-w-[2400px] mx-auto px-4 md:px-8 py-8 flex flex-col lg:flex-row items-center justify-between gap-10">
          {/* KIRI: PlantHero */}
          <div className="w-full lg:w-4/12 flex items-end justify-center lg:justify-start lg:pl-10 min-h-[40vh] lg:translate-y-10">
            <PlantHero
              moisture={l?.soil_moisture ?? 0}
              health={score}
              pumpOn={!!l?.pump_on}
              lightOn={!!l?.growlight_on}
              online={!!d?.online}
              hasData={!!l}
            />
          </div>

          {/* KANAN: Fitur AI & Kontrol */}
          <div className="w-full lg:w-5/12 flex flex-col gap-6 max-w-2xl lg:pr-10 lg:ml-auto">
            <div className="rounded-[32px] bg-white/20 dark:bg-[#0b132b]/40 backdrop-blur-3xl border border-white/40 dark:border-white/10 p-6 flex flex-col justify-between shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-ink dark:text-white mb-4">
                  Kendali Cerdas
                </h2>
                <div className="grid grid-cols-2 rounded-[20px] bg-white/30 dark:bg-black/30 p-1.5 mb-5 shadow-inner border border-white/40 dark:border-transparent">
                  {(["AUTO", "MANUAL"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => control({ mode: m })}
                      className={`pill flex items-center justify-center gap-2 py-3 text-sm transition-all ${l?.mode === m ? "bg-white dark:bg-surface shadow-md text-ink font-bold" : "text-ink/70 dark:text-white/70 font-medium hover:text-ink dark:hover:text-white"}`}
                    >
                      {m === "AUTO" ? (
                        <>
                          <Sparkles className="h-4 w-4 text-emerald-500" /> AI
                          Otomatis
                        </>
                      ) : (
                        "Manual"
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <SwitchGlass
                  icon={Droplets}
                  tint="#0A84FF"
                  label="Pompa Air"
                  sub={l?.pump_on ? "Menyiram" : "Siaga"}
                  on={!!l?.pump_on}
                  disabled={!l || auto}
                  onToggle={() => control({ pump_on: !l?.pump_on })}
                />
                <SwitchGlass
                  icon={Lightbulb}
                  tint="#FF9F0A"
                  label="Lampu Tanam"
                  sub={l?.growlight_on ? "Menyala" : "Mati"}
                  on={!!l?.growlight_on}
                  disabled={!l || auto}
                  onToggle={() => control({ growlight_on: !l?.growlight_on })}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Prediksi AI */}
              <div className="rounded-[32px] bg-gradient-to-br from-white/40 to-azure/10 dark:from-azure/10 dark:to-[#0b132b]/40 backdrop-blur-3xl border border-white/40 dark:border-azure/20 p-6 flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <div className="flex items-center gap-3 mb-6">
                  <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-azure/20 dark:bg-azure/20 text-azure shadow-inner">
                    <Activity className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-ink dark:text-white">
                      Prediksi AI
                    </h2>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-end justify-between">
                    <span className="text-xs font-medium text-ink/70 dark:text-white/60">
                      Saat ini
                    </span>
                    <span className="text-3xl font-bold text-ink dark:text-white">
                      {l?.soil_moisture ?? 0}
                      <span className="text-sm font-medium ml-0.5">%</span>
                    </span>
                  </div>
                  <div className="h-px w-full bg-ink/10 dark:bg-white/10 my-1"></div>
                  <div className="flex items-end justify-between">
                    <span className="text-[10px] font-bold text-azure bg-azure/10 px-2 py-1 rounded-full flex items-center gap-1">
                      <Bot className="h-3 w-3" /> +10m
                    </span>
                    <span className="text-3xl font-bold text-azure">
                      {predictedMoisture ?? "–"}
                      <span className="text-sm font-medium ml-0.5">%</span>
                    </span>
                  </div>
                  {predictedMoisture !== null && forecastBand != null && (
                    <p className="text-right text-[11px] font-medium text-ink/60 dark:text-white/50">
                      kisaran ± {forecastBand}
                    </p>
                  )}
                  {auto && (pumpConf != null || lightConf != null) && (
                    <p className="text-[11px] font-medium text-ink/60 dark:text-white/50">
                      Keyakinan AI:{" "}
                      {pumpConf != null
                        ? `Pompa ${Math.round(pumpConf * 100)}%`
                        : ""}
                      {pumpConf != null && lightConf != null ? " · " : ""}
                      {lightConf != null
                        ? `Lampu ${Math.round(lightConf * 100)}%`
                        : ""}
                    </p>
                  )}
                  {predictedMoisture === null && (
                    <p className="text-[11px] font-medium text-ink/60 dark:text-white/50">
                      {auto
                        ? "Mengumpulkan data ±5 menit berkelanjutan untuk prediksi 10 menit."
                        : "Prediksi hanya aktif di mode AI Otomatis."}
                    </p>
                  )}
                </div>
              </div>

              {/* Log Mini */}
              <div className="rounded-[32px] bg-white/20 dark:bg-[#0b132b]/40 backdrop-blur-3xl border border-white/40 dark:border-white/10 p-5 flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <h2 className="text-lg font-bold tracking-tight text-ink dark:text-white mb-3">
                  Aktivitas Terkini
                </h2>
                <div className="overflow-y-auto max-h-[140px] pr-1">
                  {d?.events.length ? (
                    <ul className="space-y-2">
                      {d.events.slice(0, 3).map((e, idx) => {
                        const prefix = e.mode === "AUTO" ? "AI" : "Manual";
                        const logText = `${prefix}: Pompa ${e.pump ? "ON" : "OFF"} · Lampu ${e.light ? "ON" : "OFF"}`;
                        return (
                          <li
                            key={idx}
                            className="flex flex-col p-3 rounded-[16px] bg-white/40 dark:bg-black/30 border border-white/30 dark:border-white/5"
                          >
                            <span className="text-xs font-semibold text-ink dark:text-white">
                              {logText}
                            </span>
                            <span className="text-[10px] font-medium text-ink/60 dark:text-white/50">
                              {fmt(e.t, true)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="text-xs font-medium text-ink/70 dark:text-white/60 text-center mt-4">
                      Stabil.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ======================================= */}
      {/* 2. DASHBOARD SECTION                    */}
      {/* ======================================= */}
      <section className="w-full bg-[rgb(var(--bg))] pb-10 border-t border-ink/5 dark:border-white/5">
        <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-4 px-5 py-5 md:px-8 xl:min-h-[700px] xl:px-10">
          <div className="grid shrink-0 gap-4 xl:grid-cols-12">
            <section className="card flex items-center gap-5 bg-gradient-to-b from-surface to-mist/60 !p-5 xl:col-span-3">
              <svg
                viewBox="0 0 120 120"
                className="h-28 w-28 shrink-0 -rotate-90"
                role="img"
                aria-label={`Skor ${score} dari 100`}
              >
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke={G.ring}
                  strokeWidth="10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  stroke={
                    score >= 75
                      ? "#30D158"
                      : score >= 50
                        ? "#FF9F0A"
                        : "#FF453A"
                  }
                  strokeDasharray={`${(score / 100) * 326.7} 326.7`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="min-w-0">
                <p className="text-sm font-medium text-sub">
                  Kesehatan tanaman
                </p>
                <p className="text-5xl font-semibold tabular-nums tracking-tight">
                  {score}
                </p>
                <p className="text-sm text-sub">
                  {score >= 75
                    ? "Kondisi prima"
                    : score >= 50
                      ? "Perlu perhatian"
                      : "Kondisi kritis"}
                </p>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:col-span-9 xl:grid-cols-5">
              <Tile
                icon={Droplets}
                tint="#0A84FF"
                label="Kelembapan tanah"
                value={l ? `${l.soil_moisture}` : "–"}
                unit="%"
                pct={(l?.soil_moisture ?? 0) / 100}
                note={l ? `Status: ${l.soil_status}` : "—"}
              />
              <Tile
                icon={Thermometer}
                tint="#FF8C00"
                label="Suhu tanah"
                value={soilTempOk ? l!.soil_temperature!.toFixed(1) : "–"}
                unit="°C"
                pct={((l?.soil_temperature ?? 0) - 10) / 30}
                note="Sensor DS18B20"
              />
              <Tile
                icon={Thermometer}
                tint="#FF453A"
                label="Suhu ruangan"
                value={dhtOk ? l!.temperature.toFixed(1) : "–"}
                unit="°C"
                pct={((l?.temperature ?? 0) - 10) / 30}
                note="Rentang ideal 20–30 °C"
              />
              <Tile
                icon={Wind}
                tint="#5AC8FA"
                label="Kelembapan udara"
                value={dhtOk ? `${Math.round(l!.humidity)}` : "–"}
                unit="%"
                pct={(l?.humidity ?? 0) / 100}
                note="Sensor DHT11"
              />
              <Tile
                icon={Sun}
                tint="#FF9F0A"
                label="Cahaya & UV"
                value={l ? `${l.ldr_light}` : "–"}
                unit="%"
                pct={(l?.ldr_light ?? 0) / 100}
                note={l ? `UV ${l.uv_index.toFixed(2)}` : "—"}
              />
            </div>
          </div>

          <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-12 xl:grid-rows-1">
            <section className="card flex min-h-[380px] flex-col !p-5 xl:col-span-8 xl:min-h-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Tren sensor</h2>
                  <p className="text-xs text-sub">
                    {metric === "ml"
                      ? fstats?.mae != null
                        ? `Prediksi 10 menit lalu vs aktual · MAE ${fstats.mae.toFixed(1)} poin${
                            fstats.naiveMae != null
                              ? ` (naif ${fstats.naiveMae.toFixed(1)})`
                              : ""
                          } · ${fstats.n} pasangan${
                            cmp &&
                            cmp.n > 0 &&
                            cmp.pumpAgreement != null &&
                            cmp.lightAgreement != null
                              ? ` · AI sejalan dengan aturan: pompa ${Math.round(cmp.pumpAgreement * 100)}%, lampu ${Math.round(cmp.lightAgreement * 100)}% (${cmp.n} sampel)`
                              : ""
                          }`
                        : "Belum ada pasangan prediksi–aktual (butuh data ≥ 10 menit dengan AI aktif)."
                      : d
                        ? `${d.stats.samples} sampel direkam`
                        : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-full bg-mist p-1" role="tablist">
                    {(Object.keys(METRICS) as (keyof typeof METRICS)[]).map(
                      (k) => (
                        <button
                          key={k}
                          role="tab"
                          aria-selected={metric === k}
                          onClick={() => setMetric(k)}
                          className={`pill ${metric === k ? "bg-seg shadow-sm" : "text-sub hover:text-ink"}`}
                        >
                          {METRICS[k].label}
                        </button>
                      ),
                    )}
                  </div>
                  <div className="flex rounded-full bg-mist p-1" role="tablist">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        role="tab"
                        aria-selected={range === r}
                        onClick={() => setRange(r)}
                        className={`pill ${range === r ? "bg-seg shadow-sm" : "text-sub hover:text-ink"}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="min-h-[240px] flex-1">
                {d?.series.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={d.series}
                      margin={{ left: -20, right: 4, top: 4 }}
                    >
                      <CartesianGrid stroke={G.grid} vertical={false} />
                      {metric === "tanah" && (
                        <ReferenceArea
                          y1={T.pumpOn}
                          y2={T.pumpOff}
                          fill="#30D158"
                          fillOpacity={0.07}
                        />
                      )}
                      <XAxis
                        dataKey="t"
                        tickFormatter={(t) => fmt(t)}
                        tick={{ fill: G.tick, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        domain={M.domain as any}
                        tick={{ fill: G.tick, fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        labelFormatter={(t) => fmt(String(t), true)}
                        contentStyle={{
                          borderRadius: 16,
                          background: G.tipBg,
                          color: G.tipFg,
                          border: `1px solid ${G.tipBorder}`,
                          boxShadow: "0 10px 25px rgba(0,0,0,.15)",
                        }}
                      />
                      {M.lines.map((ln) => (
                        <Area
                          key={ln.k}
                          dataKey={ln.k}
                          name={ln.n}
                          stroke={ln.c}
                          strokeWidth={2}
                          fill={ln.c}
                          fillOpacity={0.08}
                          type="monotone"
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="grid h-full place-items-center text-sm text-sub">
                    Belum ada data pada rentang ini.
                  </p>
                )}
              </div>
              {metric === "tanah" && (
                <p className="mt-2 text-xs text-sub">
                  Area hijau: rentang tanah ideal {T.pumpOn}–{T.pumpOff}%.
                </p>
              )}
            </section>

            <div className="flex flex-col gap-4 xl:col-span-4 xl:min-h-0">
              <section className="card min-h-[200px] flex-1 overflow-y-auto !p-5 xl:min-h-0">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold">Aktivitas aktuator</h2>
                  <p className="text-xs text-sub">
                    {d ? `${d.stats.totalRecords} rekaman` : ""}
                  </p>
                </div>
                {d?.events.length ? (
                  <ul className="divide-y divide-ink/[0.07]">
                    {d.events.map((e, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between gap-3 py-3.5 text-sm"
                      >
                        <span>
                          Pompa {e.pump ? "menyala" : "mati"} · Lampu{" "}
                          {e.light ? "menyala" : "mati"}
                        </span>
                        <span className="shrink-0 text-xs text-sub">
                          {e.mode === "AUTO" ? "Otomatis" : "Manual"} ·{" "}
                          {fmt(e.t, true)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-3 text-sm leading-relaxed text-sub">
                    Tidak ada perubahan status pada rentang ini.
                  </p>
                )}
              </section>
            </div>
          </div>
        </div>
      </section>

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}
