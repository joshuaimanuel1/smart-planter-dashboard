export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export type Latest = {
  temperature: number;
  humidity: number;
  soil_moisture: number;
  soil_status: string;
  ldr_light: number;
  uv_index: number;
  pump_on: boolean;
  growlight_on: boolean;
  mode: "AUTO" | "MANUAL";
  updatedAt: string;
};
export type Point = {
  t: string;
  soil: number;
  ldr: number;
  temp: number;
  hum: number;
  uv: number;
};
export type Thresholds = {
  pumpOn: number;
  pumpOff: number;
  lightOn: number;
  lightOff: number;
};
export type Alert = { level: "critical" | "warning" | "info"; text: string };
export type Dash = {
  latest: Latest | null;
  online: boolean;
  series: Point[];
  alerts?: Alert[];
  thresholds?: Thresholds;
  events: { t: string; pump: boolean; light: boolean; mode: string }[];
  stats: {
    pumpMinutes?: number;
    lightMinutes?: number;
    avg: Record<string, number | null>;
    max: Record<string, number | null>;
    min: Record<string, number | null>;
    samples: number;
    totalRecords: number;
  };
};
export const getDashboard = async (range: string): Promise<Dash> => {
  const r = await fetch(`${API}/api/dashboard?range=${range}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error("Gagal memuat data");
  return r.json();
};
export const sendControl = (
  body: Partial<Pick<Latest, "mode" | "pump_on" | "growlight_on">>,
) =>
  fetch(`${API}/api/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const exportUrl = (p: { from?: string; to?: string }, count = false) => {
  const q = new URLSearchParams();
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (count) q.set("count", "1");
  return `${API}/api/export-csv?${q}`;
};
