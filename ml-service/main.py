import json
from typing import Optional

import joblib
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import forecast_features as ff
from features import build_features

app = FastAPI()

# Klasifikasi pompa & lampu. Gagal memuat = berhenti jelas, bukan jalan setengah rusak.
feature_cols = joblib.load("feature_columns.joblib")
pump_model = joblib.load("pump_rf_model.joblib")
light_model = joblib.load("growlight_rf_model.joblib")
print("✅ Model pompa & lampu dimuat")

# Forecaster 10 menit (dari notebook Forecaster_10min.ipynb)
forecaster, fmeta = None, {}
try:
    forecaster = joblib.load("forecaster_10min.joblib")
    with open("forecaster_meta.json") as f:
        fmeta = json.load(f)
    print(f"✅ Forecaster 10 menit dimuat: {fmeta.get('model')} | MAE uji {fmeta.get('metrics', {}).get('test_mae')}")
except Exception as e:
    print("⚠️  Forecaster 10 menit belum tersedia (jalankan Forecaster_10min.ipynb):", e)

FORECAST_FEATURES = fmeta.get("features", ff.FEATURES)
FORECAST_BAND = fmeta.get("metrics", {}).get("test_mae")  # galat rata-rata pada data uji
print(f"ℹ️  galat rata-rata forecaster (dipakai dashboard): {FORECAST_BAND}")


def _confidence(model, X, decision: bool):
    """Skor keyakinan = porsi suara pohon untuk kelas yang dipilih (bukan probabilitas terkalibrasi)."""
    try:
        proba = model.predict_proba(X)[0]
        idx = list(model.classes_).index(1 if decision else 0)
        return round(float(proba[idx]), 3)
    except Exception:
        return None

class TelemetryData(BaseModel):
    temperature: float
    humidity: float
    soilMoisture: float
    soilTemperature: float
    ldrLight: float
    uvIndex: float
    history: list[dict]  # terlama -> terbaru, tiap item: createdAt, sensor (camelCase), pumpOn
    timestamp: Optional[str] = None  # waktu data sekarang (ISO, UTC)

@app.post("/predict")
def predict(data: TelemetryData):
    current = {
        "temperature": data.temperature,
        "humidity": data.humidity,
        "soil_moisture": data.soilMoisture,
        "soil_temperature": data.soilTemperature,
        "ldr_light": data.ldrLight,
        "uv_index": data.uvIndex,
    }
    try:
        X = build_features(data.history, current, feature_cols)
        pump_on = bool(int(pump_model.predict(X)[0]))
        light_on = bool(int(light_model.predict(X)[0]))

        forecast, ready = None, False
        if forecaster is not None:
            try:
                Xf, ready = ff.build_forecast_row(data.history, current, data.timestamp)
                if ready:
                    delta = float(forecaster.predict(Xf[FORECAST_FEATURES])[0])
                    forecast = round(min(100.0, max(0.0, data.soilMoisture + delta)), 2)
            except Exception as e:  # forecaster gagal tidak boleh menjatuhkan keputusan aktuator
                print("⚠️  forecast gagal:", e)

        return {
            "status": "success",
            "predictions": {
                "pump_on": pump_on,
                "growlight_on": light_on,
                "predicted_moisture_10min": forecast,
                "forecast_ready": ready,
                "pump_confidence": _confidence(pump_model, X, pump_on),
                "light_confidence": _confidence(light_model, X, light_on),
                "forecast_band": FORECAST_BAND,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))