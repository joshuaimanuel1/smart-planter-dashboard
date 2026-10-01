import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import mqtt from "mqtt";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

const env = z
  .object({
    PORT: z.coerce.number().default(4000),
    MQTT_BROKER: z.string().default("mqtt://broker.hivemq.com:1883"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    SAVE_INTERVAL_MS: z.coerce.number().default(5000),
    DEVICE_API_KEY: z.string().optional(),
  })
  .parse(process.env);

const DEVICE = "esp32-planter-01";
const TOPIC_TELEMETRY = "smartplanter/jojo/telemetry";
const TOPIC_COMMAND = "smartplanter/jojo/command";
const ONLINE_MS = 15_000;

const prisma = new PrismaClient();
const app = express();
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "20kb" }));

// ---------- Validation & Payload Mapper ----------
const CAMEL: Record<string, string> = {
  deviceId: "device_id",
  soilMoisture: "soil_moisture",
  soilStatus: "soil_status",
  ldrLight: "ldr_light",
  uvIndex: "uv_index",
  pumpOn: "pump_on",
  growlightOn: "growlight_on",
};

const camelToSnake = (b: unknown) =>
  b && typeof b === "object"
    ? Object.fromEntries(Object.entries(b).map(([k, v]) => [CAMEL[k] ?? k, v]))
    : b;

const num = z.coerce.number().finite();
const telemetrySchema = z.object({
  device_id: z.string().max(64).default(DEVICE),
  temperature: num,
  humidity: num,
  soil_moisture: num.pipe(z.number().int().min(0).max(100)),
  soil_status: z.enum(["KERING", "LEMBAB", "BASAH"]),
  ldr_light: num.pipe(z.number().int().min(0).max(100)),
  uv_index: num.min(0),
  pump_on: z.boolean(),
  growlight_on: z.boolean(),
  mode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
});
type Telemetry = z.infer<typeof telemetrySchema>;

const controlSchema = z
  .object({
    mode: z.enum(["AUTO", "MANUAL"]).optional(),
    pump_on: z.boolean().optional(),
    growlight_on: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Empty command");

// ---------- State & realtime (SSE) ----------
let latest: (Telemetry & { updatedAt: string }) | null = null;
let lastSeen = 0,
  lastSaved = 0;
const clients = new Set<Response>();

const broadcast = () => {
  const msg = `event: telemetry\ndata: ${JSON.stringify({ latest, online: isOnline() })}\n\n`;
  clients.forEach((c) => c.write(msg));
};
const isOnline = () => Date.now() - lastSeen < ONLINE_MS;

async function ingest(raw: unknown) {
  // Parsing menggunakan mapper camelToSnake
  const p = telemetrySchema.parse(camelToSnake(raw));
  latest = { ...p, updatedAt: new Date().toISOString() };
  lastSeen = Date.now();
  broadcast();

  if (lastSeen - lastSaved < env.SAVE_INTERVAL_MS) return;
  lastSaved = lastSeen;

  await prisma.telemetryLog.create({
    data: {
      deviceId: p.device_id,
      temperature: p.temperature,
      humidity: p.humidity,
      soilMoisture: p.soil_moisture,
      soilStatus: p.soil_status,
      ldrLight: p.ldr_light,
      uvIndex: p.uv_index,
      pumpOn: p.pump_on,
      growlightOn: p.growlight_on,
      mode: p.mode,
    },
  });
}

// ---------- MQTT ----------
const mqttClient = mqtt.connect(env.MQTT_BROKER, { reconnectPeriod: 3000 });
mqttClient.on("connect", () => {
  console.log("[MQTT] connected");
  mqttClient.subscribe(TOPIC_TELEMETRY);
});
mqttClient.on("error", (e) => console.error("[MQTT]", e.message));
mqttClient.on("message", (_t, m) => {
  try {
    void ingest(JSON.parse(m.toString())).catch((e) =>
      console.error("[ingest]", e.message),
    );
  } catch {
    console.warn("[MQTT] invalid payload dropped");
  }
});

// ---------- Routes ----------
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get(
  "/api/health",
  wrap(async (_q, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      mqtt: mqttClient.connected,
      deviceOnline: isOnline(),
    });
  }),
);

app.post(
  "/api/telemetry",
  wrap(async (req, res) => {
    if (env.DEVICE_API_KEY && req.header("x-api-key") !== env.DEVICE_API_KEY)
      return res.status(401).json({ error: "Unauthorized" });
    await ingest(req.body);
    res.json({ status: "ok" });
  }),
);

app.get("/api/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(
    `event: telemetry\ndata: ${JSON.stringify({ latest, online: isOnline() })}\n\n`,
  );
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

const RANGES: Record<string, number> = {
  "1h": 36e5,
  "6h": 216e5,
  "24h": 864e5,
  "7d": 6048e5,
};

app.get(
  "/api/dashboard",
  wrap(async (req, res) => {
    const range = String(req.query.range ?? "1h");
    const since = new Date(Date.now() - (RANGES[range] ?? RANGES["1h"]));
    const where = { deviceId: DEVICE, createdAt: { gte: since } };
    const [rows, agg, total] = await Promise.all([
      prisma.telemetryLog.findMany({ where, orderBy: { createdAt: "asc" } }),
      prisma.telemetryLog.aggregate({
        where,
        _avg: {
          temperature: true,
          humidity: true,
          soilMoisture: true,
          ldrLight: true,
          uvIndex: true,
        },
        _max: { temperature: true, soilMoisture: true, uvIndex: true },
        _min: { temperature: true, soilMoisture: true },
      }),
      prisma.telemetryLog.count({ where: { deviceId: DEVICE } }),
    ]);
    const step = Math.max(1, Math.ceil(rows.length / 150)); // downsample for chart performance
    const series = rows
      .filter((_, i) => i % step === 0)
      .map((r) => ({
        t: r.createdAt.toISOString(),
        soil: r.soilMoisture,
        ldr: r.ldrLight,
        temp: r.temperature,
        hum: r.humidity,
        uv: r.uvIndex,
      }));
    const events = rows
      .filter(
        (r, i) =>
          i > 0 &&
          (r.pumpOn !== rows[i - 1].pumpOn ||
            r.growlightOn !== rows[i - 1].growlightOn),
      )
      .slice(-8)
      .reverse()
      .map((r) => ({
        t: r.createdAt.toISOString(),
        pump: r.pumpOn,
        light: r.growlightOn,
        mode: r.mode,
      }));
    res.json({
      latest,
      online: isOnline(),
      series,
      events,
      stats: {
        avg: agg._avg,
        max: agg._max,
        min: agg._min,
        samples: rows.length,
        totalRecords: total,
      },
    });
  }),
);

app.post(
  "/api/control",
  wrap(async (req, res) => {
    const cmd = controlSchema.parse(req.body);
    const payload = {
      mode: cmd.mode ?? latest?.mode ?? "AUTO",
      pump_on: cmd.pump_on ?? latest?.pump_on ?? false,
      growlight_on: cmd.growlight_on ?? latest?.growlight_on ?? false,
    };
    mqttClient.publish(TOPIC_COMMAND, JSON.stringify(payload), { qos: 1 });
    if (latest) {
      latest = { ...latest, ...payload };
      broadcast();
    }
    await prisma.deviceState.upsert({
      where: { deviceId: DEVICE },
      update: {
        mode: payload.mode,
        pumpOn: payload.pump_on,
        growlightOn: payload.growlight_on,
      },
      create: {
        deviceId: DEVICE,
        mode: payload.mode,
        pumpOn: payload.pump_on,
        growlightOn: payload.growlight_on,
      },
    });
    res.json({ status: "sent", state: payload });
  }),
);

// Streamed CSV dengan filter periode: ?from=ISO&to=ISO (opsional), ?count=1 hanya menghitung baris
const exportQuery = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    count: z.string().optional(),
  })
  .refine(
    (q) => !q.from || !q.to || q.from < q.to,
    "Waktu mulai harus sebelum waktu akhir",
  );

app.get(
  "/api/export-csv",
  wrap(async (req, res) => {
    const q = exportQuery.parse(req.query);
    const range = { ...(q.from && { gte: q.from }), ...(q.to && { lt: q.to }) };
    const where = {
      deviceId: DEVICE,
      ...(Object.keys(range).length && { createdAt: range }),
    };
    if (q.count)
      return res.json({ count: await prisma.telemetryLog.count({ where }) });

    const day = (d?: Date) => (d ? d.toISOString().slice(0, 10) : "");
    const name =
      q.from || q.to
        ? `smart_planter_${day(q.from) || "awal"}_${day(q.to) || "kini"}.csv`
        : "smart_planter_dataset.csv";
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    });
    res.write(
      "id,timestamp,temperature,humidity,soil_moisture,soil_status,ldr_light,uv_index,pump_on,growlight_on,mode\n",
    );
    let cursor = 0;
    for (;;) {
      const rows = await prisma.telemetryLog.findMany({
        where: { ...where, id: { gt: cursor } },
        orderBy: { id: "asc" },
        take: 5000,
      });
      if (!rows.length) break;
      res.write(
        rows
          .map((r) =>
            [
              r.id,
              r.createdAt.toISOString(),
              r.temperature,
              r.humidity,
              r.soilMoisture,
              r.soilStatus,
              r.ldrLight,
              r.uvIndex,
              +r.pumpOn,
              +r.growlightOn,
              r.mode,
            ].join(","),
          )
          .join("\n") + "\n",
      );
      cursor = rows[rows.length - 1].id;
    }
    res.end();
  }),
);

app.use((err: unknown, _q: Request, res: Response, _n: NextFunction) => {
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: "Invalid payload", details: err.flatten() });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

(async () => {
  const last = await prisma.telemetryLog.findFirst({
    where: { deviceId: DEVICE },
    orderBy: { createdAt: "desc" },
  });
  if (last)
    latest = {
      device_id: last.deviceId,
      temperature: last.temperature,
      humidity: last.humidity,
      soil_moisture: last.soilMoisture,
      soil_status: last.soilStatus as Telemetry["soil_status"],
      ldr_light: last.ldrLight,
      uv_index: last.uvIndex,
      pump_on: last.pumpOn,
      growlight_on: last.growlightOn,
      mode: last.mode as Telemetry["mode"],
      updatedAt: last.createdAt.toISOString(),
    };
  const server = app.listen(env.PORT, () =>
    console.log(`Backend ready on :${env.PORT}`),
  );
  const stop = async () => {
    server.close();
    mqttClient.end();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})();
