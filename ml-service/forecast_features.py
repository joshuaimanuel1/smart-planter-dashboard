import numpy as np
import pandas as pd

HORIZON_S = 600       # 10 menit sungguhan
HIST_S = 300          # riwayat minimum (5 menit) sebelum prediksi dikeluarkan
SESSION_GAP_S = 120   # jeda > ini = ESP32 sempat offline -> sesi baru (jendela tidak boleh melompati jeda)
TOL_S = 20            # toleransi pencocokan waktu (data ~6 detik sekali)

CAMEL_TO_SNAKE = {
    "soilMoisture": "soil_moisture",
    "soilTemperature": "soil_temperature",
    "ldrLight": "ldr_light",
    "uvIndex": "uv_index",
    "pumpOn": "pump_on",
    "createdAt": "timestamp",
}
SENSORS = ["temperature", "humidity", "soil_moisture", "soil_temperature", "ldr_light", "uv_index"]

FEATURES_REL = [
    "soil_d1m", "soil_d3m", "soil_d5m", "soil_m1_gap", "soil_m5_gap",
    "soil_std5m", "soil_dev_med5m", "pump_frac5m",
]
FEATURES_ENV = [
    "temperature", "humidity", "vpd_kpa", "soil_temperature",
    "ldr_light", "ldr_mean5m", "uv_mean5m", "temp_mean5m",
]
FEATURES = FEATURES_REL + FEATURES_ENV


def _lag(s: pd.Series, secs: int) -> np.ndarray:
    return s.reindex(
        s.index - pd.Timedelta(seconds=secs),
        method="nearest",
        tolerance=pd.Timedelta(seconds=TOL_S),
    ).values


def _session_features(g: pd.DataFrame) -> pd.DataFrame:
    g = g.set_index("timestamp")
    soil = g["soil_moisture"].where(g["soil_moisture"] > 0)  # 0 = glitch sensor -> NaN
    pump = g["pump_on"].astype(float) if "pump_on" in g else pd.Series(0.0, index=g.index)
    f = pd.DataFrame(index=g.index)
    f["soil"] = soil
    f["soil_d1m"] = soil - _lag(soil, 60)
    f["soil_d3m"] = soil - _lag(soil, 180)
    f["soil_d5m"] = soil - _lag(soil, 300)
    f["soil_mean1m"] = soil.rolling("60s").mean()
    f["soil_mean5m"] = soil.rolling("300s").mean()
    f["soil_std5m"] = soil.rolling("300s").std().fillna(0)
    f["soil_dev_med5m"] = soil - soil.rolling("300s").median()
    f["soil_m1_gap"] = f["soil_mean1m"] - soil
    f["soil_m5_gap"] = f["soil_mean5m"] - soil
    f["temperature"] = g["temperature"]
    f["humidity"] = g["humidity"]
    f["vpd_kpa"] = g["vpd_kpa"]
    f["soil_temperature"] = g["soil_temperature"]
    f["ldr_light"] = g["ldr_light"]
    f["ldr_mean5m"] = g["ldr_light"].rolling("300s").mean()
    f["uv_mean5m"] = g["uv_index"].rolling("300s").mean()
    f["temp_mean5m"] = g["temperature"].rolling("300s").mean()
    f["pump_frac5m"] = pump.shift(1).fillna(0).rolling("300s").mean()
    span = (g.index - g.index[0]).total_seconds()
    f["ready"] = (span >= HIST_S - TOL_S) & f["soil_d5m"].notna() & soil.notna().values
    return f


def add_forecast_features(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    d["timestamp"] = pd.to_datetime(d["timestamp"], utc=True, format="ISO8601")
    d = d.sort_values("timestamp").drop_duplicates("timestamp", keep="last").reset_index(drop=True)
    st = d["soil_temperature"].where(d["soil_temperature"] > 5) 
    d["soil_temperature"] = st.ffill().bfill().fillna(25.0)
    svp = 0.61078 * np.exp((17.27 * d["temperature"]) / (d["temperature"] + 237.3))
    d["vpd_kpa"] = svp * (1.0 - d["humidity"] / 100.0)
    d["sess"] = (d["timestamp"].diff().dt.total_seconds().fillna(0) > SESSION_GAP_S).cumsum()
    parts = []
    for _, g in d.groupby("sess", sort=False):
        f = _session_features(g)
        f.index = g.index
        parts.append(f)
    feats = pd.concat(parts)
    for c in ("soil_d1m", "soil_d3m"):
        feats[c] = feats[c].fillna(0.0) 
    new_cols = [c for c in feats.columns if c not in d.columns] 
    return d.join(feats[new_cols])


def add_target(d: pd.DataFrame, horizon_s: int = HORIZON_S) -> pd.DataFrame:
    y = pd.Series(np.nan, index=d.index)
    for _, g in d.groupby("sess", sort=False):
        s = g.set_index("timestamp")["soil"]
        fut = s.reindex(
            s.index + pd.Timedelta(seconds=horizon_s),
            method="nearest",
            tolerance=pd.Timedelta(seconds=TOL_S),
        )
        y.loc[g.index] = fut.values
    d = d.copy()
    d["y_future"] = y
    d["y_delta"] = y - d["soil"]
    return d


def build_forecast_row(history: list, current: dict, timestamp):
    h = pd.DataFrame(history).rename(columns=CAMEL_TO_SNAKE)
    cur = dict(current)
    cur["timestamp"] = timestamp if timestamp is not None else pd.Timestamp.now(tz="UTC")
    cur["pump_on"] = 0
    df = pd.concat([h, pd.DataFrame([cur])], ignore_index=True)
    if "pump_on" not in df:
        df["pump_on"] = 0
    df["pump_on"] = df["pump_on"].fillna(0)
    d = add_forecast_features(df[["timestamp", *SENSORS, "pump_on"]])
    last = d.iloc[[-1]]
    return last[FEATURES], bool(last["ready"].iloc[0]) and not last[FEATURES].isna().any(axis=None)


class GapBaseline:

    def fit(self, X, y=None):
        return self

    def predict(self, X):
        return np.asarray(X["soil_m5_gap"], dtype=float)