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
  Sprout,
  Sun,
  Thermometer,
  Wifi,
  WifiOff,
  Wind,
  X,
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
const health = (l: Latest, T: Thresholds) =>
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
      { k: "temp", n: "Suhu (°C)", c: "#FF453A" },
      { k: "hum", n: "Kelembapan udara (%)", c: "#5AC8FA" },
    ],
  },
  uv: {
    label: "Indeks UV",
    domain: [0, "auto"],
    lines: [{ k: "uv", n: "Indeks UV", c: "#AF52DE" }],
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

function Tile({
  icon: I,
  label,
  value,
  unit,
  note,
  pct,
  tint,
}: {
  icon: any;
  label: string;
  value: string;
  unit: string;
  note: string;
  pct: number;
  tint: string;
}) {
  return (
    <div className="card flex min-h-[148px] flex-col justify-between !p-5">
      <div className="flex items-center gap-2 text-sm font-medium text-sub">
        <I className="h-4 w-4" style={{ color: tint }} />
        {label}
      </div>
      <div>
        <p className="text-4xl font-semibold tabular-nums tracking-tight">
          {value}
          <span className="ml-1 text-lg font-medium text-sub">{unit}</span>
        </p>
        <div className="mt-2 h-1.5 rounded-full bg-mist">
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

function Switch({ on, disabled, tint, label, sub, icon: I, onToggle }: any) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-mist p-3">
      <div className="flex items-center gap-3">
        <span
          className="grid h-9 w-9 place-items-center rounded-xl bg-surface"
          style={{ color: tint }}
        >
          <I className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-sub">{sub}</p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={onToggle}
        className="relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-azure"
        style={{ background: on ? tint : "rgb(var(--track))" }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all"
          style={{ left: on ? 24 : 4 }}
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
        return { error: "Tanggal atau jam belum lengkap." };
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
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exp-title"
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-md space-y-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="exp-title" className="text-lg font-semibold">
              Ekspor dataset
            </h2>
            <p className="text-xs text-sub">
              Pilih periode data yang ingin diunduh sebagai CSV.
            </p>
          </div>
          <button
            aria-label="Tutup"
            onClick={onClose}
            className="pill grid h-8 w-8 place-items-center bg-mist p-0 text-sub hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className="grid grid-cols-3 rounded-2xl bg-mist p-1"
          role="tablist"
        >
          {(
            [
              ["quick", "Cepat"],
              ["range", "Tanggal & jam"],
              ["month", "Per bulan"],
            ] as [Mode, string][]
          ).map(([k, t]) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
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
          aria-live="polite"
          className={`text-sm ${params.error || count === 0 ? "text-red-600 dark:text-red-400" : "text-sub"}`}
        >
          {params.error ??
            (count === null
              ? "Menghitung…"
              : count === 0
                ? "Tidak ada data pada periode ini."
                : `${count.toLocaleString("id-ID")} rekaman akan diekspor`)}
        </p>
        <a
          href={ok ? exportUrl(params) : undefined}
          aria-disabled={!ok}
          onClick={(e) => (ok ? setTimeout(onClose, 300) : e.preventDefault())}
          className={`pill flex items-center justify-center gap-2 py-3 text-sm ${ok ? "bg-ink text-onink hover:opacity-90" : "pointer-events-none bg-mist text-sub"}`}
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
  useEffect(
    () =>
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      ),
    [],
  );
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

  const load = useCallback(
    () =>
      getDashboard(range)
        .then((x) => {
          setD(x);
          setErr("");
        })
        .catch((e) => setErr(e.message)),
    [range],
  );
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

  const l = d?.latest;
  const T = d?.thresholds ?? DEF_T;
  const M = METRICS[metric];
  const dhtOk = !!l && !(l.temperature === 0 && l.humidity === 0);
  const auto = l?.mode === "AUTO";
  const score = l ? health(l, T) : 0;
  const control = async (b: Parameters<typeof sendControl>[0]) => {
    if (l)
      setD((p) => p && p.latest && { ...p, latest: { ...p.latest, ...b } });
    await sendControl(b).catch(() => setErr("Perintah gagal dikirim"));
  };

  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-col gap-4 px-5 py-5 md:px-8 xl:h-[100dvh] xl:min-h-[700px] xl:px-10">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-onink">
            <Sprout className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight">
              Smart Indoor Planter
            </h1>
            <p className="text-xs text-sub">
              esp32-planter-01 ·{" "}
              {l ? `Diperbarui ${fmt(l.updatedAt, true)}` : "Menunggu data"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold ${d?.online ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-mist text-sub"}`}
          >
            {d?.online ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            {d?.online ? "Perangkat online" : "Perangkat offline"}
          </span>
          <button
            onClick={toggleTheme}
            aria-label={dark ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
            title={dark ? "Mode terang" : "Mode gelap"}
            className="pill grid h-9 w-9 place-items-center bg-mist p-0 text-ink hover:opacity-80"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setExporting(true)}
            className="pill flex items-center gap-2 bg-ink py-2 text-onink hover:opacity-90"
          >
            <Download className="h-3.5 w-3.5" />
            Ekspor dataset
          </button>
        </div>
      </header>

      {err && (
        <p
          role="alert"
          className="shrink-0 rounded-2xl bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400"
        >
          {err}. Pastikan backend berjalan di {API}.
        </p>
      )}
      {d?.alerts?.map((a) => (
        <p
          key={a.text}
          role="status"
          className={`flex shrink-0 items-start gap-3 rounded-2xl p-3 text-sm ${a.level === "critical" ? "bg-red-500/10 text-red-600 dark:text-red-400" : a.level === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-mist text-sub"}`}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {a.text}
        </p>
      ))}

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
                score >= 75 ? "#30D158" : score >= 50 ? "#FF9F0A" : "#FF453A"
              }
              strokeDasharray={`${(score / 100) * 326.7} 326.7`}
              className="transition-all duration-1000"
            />
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-sub">Kesehatan tanaman</p>
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
        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-9 xl:grid-cols-4">
          <Tile
            icon={Droplets}
            tint="#0A84FF"
            label="Kelembapan tanah"
            value={l ? `${l.soil_moisture}` : "–"}
            unit="%"
            pct={(l?.soil_moisture ?? 0) / 100}
            note={
              l
                ? `Tanah ${l.soil_status.toLowerCase()} · pompa ON < ${T.pumpOn}%, OFF > ${T.pumpOff}%`
                : "—"
            }
          />
          <Tile
            icon={Thermometer}
            tint="#FF453A"
            label="Suhu ruangan"
            value={dhtOk ? l!.temperature.toFixed(1) : "–"}
            unit="°C"
            pct={((l?.temperature ?? 0) - 10) / 30}
            note={
              l && !dhtOk
                ? "Sensor DHT11 tidak terbaca"
                : "Rentang ideal 20–30 °C"
            }
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
            note={
              l
                ? `UV ${l.uv_index.toFixed(2)} · lampu ON < ${T.lightOn}%, OFF > ${T.lightOff}%`
                : "—"
            }
          />
        </div>
      </div>

      <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-12 xl:grid-rows-1">
        <section className="card flex min-h-[380px] flex-col !p-5 xl:col-span-8 xl:min-h-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Tren sensor</h2>
              <p className="text-xs text-sub">
                {d
                  ? `${d.stats.samples} sampel · rata-rata tanah ${Math.round(d.stats.avg.soilMoisture ?? 0)}%, cahaya ${Math.round(d.stats.avg.ldrLight ?? 0)}%`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-full bg-mist p-1" role="tablist">
                {(Object.keys(METRICS) as (keyof typeof METRICS)[]).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={metric === k}
                    onClick={() => setMetric(k)}
                    className={`pill ${metric === k ? "bg-seg shadow-sm" : "text-sub hover:text-ink"}`}
                  >
                    {METRICS[k].label}
                  </button>
                ))}
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
                Belum ada data pada rentang ini. Nyalakan ESP32 untuk mulai
                merekam.
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
          <section className="card shrink-0 space-y-3 !p-5">
            <h2 className="text-lg font-semibold">Kontrol perangkat</h2>
            <div className="grid grid-cols-2 rounded-2xl bg-mist p-1">
              {(["AUTO", "MANUAL"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => control({ mode: m })}
                  className={`pill py-2 ${l?.mode === m ? "bg-seg shadow-sm" : "text-sub"}`}
                >
                  {m === "AUTO" ? "Otomatis" : "Manual"}
                </button>
              ))}
            </div>
            <Switch
              icon={Droplets}
              tint="#0A84FF"
              label="Pompa air"
              sub={l?.pump_on ? "Menyiram" : "Siaga"}
              on={!!l?.pump_on}
              disabled={!l || auto}
              onToggle={() => control({ pump_on: !l?.pump_on })}
            />
            <Switch
              icon={Lightbulb}
              tint="#FF9F0A"
              label="Lampu tanam"
              sub={l?.growlight_on ? "Menyala" : "Mati"}
              on={!!l?.growlight_on}
              disabled={!l || auto}
              onToggle={() => control({ growlight_on: !l?.growlight_on })}
            />
            <p className="text-xs leading-relaxed text-sub">
              {auto
                ? `Otomatis: pompa ON < ${T.pumpOn}% dan OFF > ${T.pumpOff}%; lampu ON < ${T.lightOn}% dan OFF > ${T.lightOff}%.`
                : "Manual: relay mengikuti saklar sampai Anda kembali ke Otomatis."}
            </p>
          </section>
          <section className="card min-h-[200px] flex-1 overflow-y-auto !p-5 xl:min-h-0">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Aktivitas aktuator</h2>
              <p className="text-xs text-sub">
                {d ? `${d.stats.totalRecords} rekaman` : ""}
              </p>
            </div>
            {d?.events.length ? (
              <ul className="divide-y divide-ink/[0.07]">
                {d.events.map((e) => (
                  <li
                    key={e.t}
                    className="flex items-center justify-between gap-3 py-2 text-xs"
                  >
                    <span>
                      Pompa {e.pump ? "menyala" : "mati"} · Lampu{" "}
                      {e.light ? "menyala" : "mati"}
                    </span>
                    <span className="shrink-0 text-sub">
                      {e.mode === "AUTO" ? "Otomatis" : "Manual"} ·{" "}
                      {fmt(e.t, true)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-3 text-sm leading-relaxed text-sub">{`Tidak ada perubahan status pada rentang ini. Saat ini pompa ${l?.pump_on ? "menyala" : "mati"} dan lampu ${l?.growlight_on ? "menyala" : "mati"} terus-menerus.`}</p>
            )}
          </section>
        </div>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </main>
  );
}
