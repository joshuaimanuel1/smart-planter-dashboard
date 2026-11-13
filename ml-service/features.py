import numpy as np
import pandas as pd

SENSOR_COLS = [
    "temperature",
    "humidity",
    "soil_moisture",
    "soil_temperature",
    "ldr_light",
    "uv_index",
]
# Node/Prisma mengirim history dengan nama camelCase; model dilatih dengan snake_case.
CAMEL_TO_SNAKE = {
    "soilMoisture": "soil_moisture",
    "soilTemperature": "soil_temperature",
    "ldrLight": "ldr_light",
    "uvIndex": "uv_index",
}


def build_features(history: list[dict], current: dict, feature_cols: list) -> pd.DataFrame:
    hist = pd.DataFrame(history).rename(columns=CAMEL_TO_SNAKE)
    hist = hist.reindex(columns=SENSOR_COLS)  # kolom hilang -> NaN, kolom asing dibuang
    df = pd.concat([hist, pd.DataFrame([current])[SENSOR_COLS]], ignore_index=True)

    df["soil_temperature"] = (
        df["soil_temperature"].replace(0, np.nan).ffill().fillna(25.0)
    )
    svp = 0.61078 * np.exp((17.27 * df["temperature"]) / (df["temperature"] + 237.3))
    df["vpd_kpa"] = svp * (1.0 - (df["humidity"] / 100.0))
    df["temp_diff"] = df["temperature"] - df["soil_temperature"]
    df["light_composite_index"] = (df["ldr_light"] * 0.7) + (df["uv_index"] * 3.0)

    for col in SENSOR_COLS:
        df[f"{col}_lag1"] = df[col].shift(1).fillna(df[col])
        df[f"{col}_diff1"] = df[col].diff(1).fillna(0)
        df[f"{col}_roll_mean5"] = df[col].rolling(5, min_periods=1).mean()
        df[f"{col}_roll_std5"] = df[col].rolling(5, min_periods=1).std().fillna(0)

    return df.iloc[-1:][feature_cols]