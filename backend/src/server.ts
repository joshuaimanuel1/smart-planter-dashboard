import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import mqtt from "mqtt";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import axios from "axios";

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
const ML_TIMEOUT_MS = 1000; // Harus < timeout HTTP ESP32 (1,5 dtk) agar ESP32 tidak menunggu sia-sia
const BATAS_POMPA_OFF = 70;

const prisma = new PrismaClient();
const app = express();
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "20kb" }));

// ---------- Validation & Payload Mapper ----------
const CAMEL: Record<string, string> = {
  deviceId: "device_id",
  soilMoisture: "soil_moisture",
  soilTemperature: "soil_temperature",
  soilStatus: "soil_status",
  ldrLight: "ldr_light",
  uvIndex: "uv_index",
  pumpOn: "pump_on",
  growlightOn: "growlight_on",
  predictedMoisture10min: "predicted_moisture_10min",
  pumpConfidence: "pump_confidence",
  lightConfidence: "light_confidence",
  forecastBand: "forecast_band",
  pumpRule: "pump_rule",
  lightRule: "light_rule",
  controlSource: "control_source",
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
  soil_temperature: num,
  ldr_light: num.pipe(z.number().int().min(0).max(100)),
  uv_index: num.min(0),
  pump_on: z.boolean(),
  growlight_on: z.boolean(),
  mode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
  predicted_moisture_10min: num.optional(),
  pump_confidence: num.optional(),
  light_confidence: num.optional(),
  forecast_band: num.optional(),
  pump_rule: z.boolean().optional(),
  light_rule: z.boolean().optional(),
  control_source: z.enum(["AI", "RULE", "MANUAL"]).optional(),
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
      soilTemperature: p.soil_temperature,
      soilStatus: p.soil_status,
      ldrLight: p.ldr_light,
      uvIndex: p.uv_index,
      pumpOn: p.pump_on,
      growlightOn: p.growlight_on,
      mode: p.mode,
      predictedMoisture10min: p.predicted_moisture_10min,
      pumpConfidence: p.pump_confidence,
      lightConfidence: p.light_confidence,
      pumpRule: p.pump_rule,
      lightRule: p.light_rule,
      controlSource: p.control_source,
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

// Integrasi Machine Learning API
app.post(
  "/api/telemetry",
  wrap(async (req, res) => {
    if (env.DEVICE_API_KEY && req.header("x-api-key") !== env.DEVICE_API_KEY)
      return res.status(401).json({ error: "Unauthorized" });

    const rawData = req.body;

    // Ambil status kontrol terakhir dari database
    const state = await prisma.deviceState.findUnique({
      where: { deviceId: DEVICE },
    });

    const mode = state?.mode ?? "AUTO";
    let pumpOn = state?.pumpOn ?? false;
    let growlightOn = state?.growlightOn ?? false;
    let predictedMoisture10min: number | undefined;
    let pumpConfidence: number | undefined;
    let lightConfidence: number | undefined;
    let forecastBand: number | undefined;
    let aiOk = false;
    let controlSource: "AI" | "RULE" | "MANUAL" =
      mode === "MANUAL" ? "MANUAL" : "RULE";

    // JIKA MODE AUTO: Panggil API Machine Learning Python
    if (mode === "AUTO") {
      try {
        // 1. Ambil riwayat 7 menit terakhir (berbasis WAKTU, bukan jumlah baris)
        const history = await prisma.telemetryLog.findMany({
          where: {
            deviceId: DEVICE,
            createdAt: { gte: new Date(Date.now() - 7 * 60_000) },
          },
          orderBy: { createdAt: "desc" },
          take: 300,
          select: {
            createdAt: true,
            temperature: true,
            humidity: true,
            soilMoisture: true,
            soilTemperature: true,
            ldrLight: true,
            uvIndex: true,
            pumpOn: true,
          },
        });

        // 2. Minta Prediksi ke Python Microservice
        const mlResponse = await axios.post(
          "http://localhost:5001/predict",
          {
            temperature: rawData.temperature,
            humidity: rawData.humidity,
            soilMoisture: rawData.soilMoisture,
            soilTemperature: rawData.soilTemperature,
            ldrLight: rawData.ldrLight,
            uvIndex: rawData.uvIndex,
            timestamp: new Date().toISOString(),
            history: history.reverse(),
          },
          { timeout: ML_TIMEOUT_MS },
        );

        // 3. Terapkan prediksi ML ke aktuator
        const predictions = mlResponse.data.predictions;
        if (
          typeof predictions?.pump_on !== "boolean" ||
          typeof predictions?.growlight_on !== "boolean"
        )
          throw new Error("Respons ML tidak valid");

        pumpOn = predictions.pump_on;
        growlightOn = predictions.growlight_on;

        // Pengaman keras: jangan menyiram tanah yang sudah basah, apa pun keputusan model.
        if (Number(rawData.soilMoisture) > BATAS_POMPA_OFF) pumpOn = false;

        aiOk = true;
        controlSource = "AI";
        const numOrUndef = (v: unknown) =>
          typeof v === "number" ? v : undefined;
        predictedMoisture10min = numOrUndef(
          predictions.predicted_moisture_10min,
        );
        pumpConfidence = numOrUndef(predictions.pump_confidence);
        lightConfidence = numOrUndef(predictions.light_confidence);
        forecastBand = numOrUndef(predictions.forecast_band);

        console.log(
          `[ML PREDICT] Pump: ${pumpOn}, Light: ${growlightOn}, Next Moist: ${predictions.predicted_moisture_10min}%`,
        );
      } catch (error: any) {
        console.error(
          "[ML Error] Gagal menghubungi Python Microservice, menggunakan rule-based fallback.",
          error.message,
        );
        pumpOn = rawData.pumpRule ?? rawData.pumpOn;
        growlightOn = rawData.lightRule ?? rawData.growlightOn;
        controlSource = "RULE";
      }
    }

    rawData.pumpOn = pumpOn;
    rawData.growlightOn = growlightOn;
    rawData.mode = mode;
    rawData.predictedMoisture10min = predictedMoisture10min;
    rawData.pumpConfidence = pumpConfidence;
    rawData.lightConfidence = lightConfidence;
    rawData.forecastBand = forecastBand;
    rawData.controlSource = controlSource;

    await ingest(rawData);

    res.json({
      status: "ok",
      mode: mode,
      pumpOn: pumpOn,
      growlightOn: growlightOn,
      aiOk,
      controlSource,
    });
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
          soilTemperature: true,
          ldrLight: true,
          uvIndex: true,
        },
        _max: {
          temperature: true,
          soilMoisture: true,
          soilTemperature: true,
          uvIndex: true,
        },
        _min: {
          temperature: true,
          soilMoisture: true,
          soilTemperature: true,
        },
      }),
      prisma.telemetryLog.count({ where: { deviceId: DEVICE } }),
    ]);

    // Prediksi yang dibuat 10 menit SEBELUM tiap titik, supaya bisa dibandingkan dengan nilai aktual.
    const MS10 = 10 * 60_000,
      TOL = 20_000;
    let jp = 0;
    const originSoil: (number | null)[] = [];
    const predPrev = rows.map((r) => {
      const target = r.createdAt.getTime() - MS10;
      while (jp < rows.length - 1 && rows[jp + 1].createdAt.getTime() <= target)
        jp++;
      const c = rows[jp];
      const ok =
        Math.abs(c.createdAt.getTime() - target) <= TOL &&
        c.predictedMoisture10min != null;
      originSoil.push(ok ? c.soilMoisture : null);
      return ok ? (c.predictedMoisture10min as number) : null;
    });

    const pairs = rows.flatMap((r, i) => {
      const o = originSoil[i];
      return predPrev[i] != null && r.soilMoisture > 0 && o != null && o > 0
        ? [
            {
              model: Math.abs(r.soilMoisture - (predPrev[i] as number)),
              naive: Math.abs(r.soilMoisture - o),
            },
          ]
        : [];
    });
    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const forecast = {
      n: pairs.length,
      mae: mean(pairs.map((x) => x.model)),
      naiveMae: mean(pairs.map((x) => x.naive)),
    };

    // Perbandingan AI vs aturan pada baris yang diputuskan AI
    const cmpRows = rows.filter(
      (r) =>
        r.mode === "AUTO" &&
        r.controlSource === "AI" &&
        r.pumpRule != null &&
        r.lightRule != null,
    );
    const share = (k: number) => (cmpRows.length ? k / cmpRows.length : null);
    const toggles = (xs: boolean[]) =>
      xs.reduce((n, v, i) => (i > 0 && v !== xs[i - 1] ? n + 1 : n), 0);
    const aiVsRule = {
      n: cmpRows.length,
      pumpAgreement: share(
        cmpRows.filter((r) => r.pumpOn === r.pumpRule).length,
      ),
      lightAgreement: share(
        cmpRows.filter((r) => r.growlightOn === r.lightRule).length,
      ),
      aiToggles: {
        pump: toggles(cmpRows.map((r) => r.pumpOn)),
        light: toggles(cmpRows.map((r) => r.growlightOn)),
      },
      ruleToggles: {
        pump: toggles(cmpRows.map((r) => r.pumpRule as boolean)),
        light: toggles(cmpRows.map((r) => r.lightRule as boolean)),
      },
    };

    const step = Math.max(1, Math.ceil(rows.length / 150));
    const series = rows
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => i % step === 0)
      .map(({ r, i }) => ({
        t: r.createdAt.toISOString(),
        soil: r.soilMoisture,
        soilTemperature: r.soilTemperature,
        ldr: r.ldrLight,
        temp: r.temperature,
        hum: r.humidity,
        uv: r.uvIndex,
        predicted: predPrev[i],
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
        forecast,
        aiVsRule,
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
      "id,timestamp,temperature,humidity,soil_moisture,soil_temperature,soil_status,ldr_light,uv_index,pump_on,growlight_on,mode,predicted_moisture_10min,pump_confidence,light_confidence,pump_rule,light_rule,control_source\n",
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
              r.soilTemperature,
              r.soilStatus,
              r.ldrLight,
              r.uvIndex,
              +r.pumpOn,
              +r.growlightOn,
              r.mode,
              r.predictedMoisture10min ?? "",
              r.pumpConfidence ?? "",
              r.lightConfidence ?? "",
              r.pumpRule == null ? "" : +r.pumpRule,
              r.lightRule == null ? "" : +r.lightRule,
              r.controlSource ?? "",
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
      soil_temperature: last.soilTemperature,
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
