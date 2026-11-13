import glob
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

MIN_POS = 30          # Minimal kejadian kelas positif agar metrik bermakna penuh
HORIZON_S = 600       # 10 menit sungguhan (600 detik)
TOL_S = 20            # Toleransi pencocokan waktu (data ~5-6 detik sekali)
SESSION_GAP_S = 120   # Jeda > 2 menit dianggap sesi baru (ESP32 sempat offline)


def reconstruct_rules(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    if "pump_rule" not in d.columns:
        d["pump_rule"] = np.nan
    if "light_rule" not in d.columns:
        d["light_rule"] = np.nan

    d["sess"] = (d["timestamp"].diff().dt.total_seconds().fillna(0) > SESSION_GAP_S).cumsum()

    pump_rules, light_rules = [], []
    for _, g in d.groupby("sess", sort=False):
        p_state, l_state = 0, 0
        for soil, ldr, uv in zip(g["soil_moisture"].values, g["ldr_light"].values, g["uv_index"].values):
            if 0 < soil < 30:
                p_state = 1
            elif soil > 70:
                p_state = 0
            pump_rules.append(p_state)

            if uv >= 6.0 or ldr > 80:
                l_state = 0
            elif ldr < 60 and uv < 4.0:
                l_state = 1
            light_rules.append(l_state)

    d["pump_rule"] = d["pump_rule"].fillna(pd.Series(pump_rules, index=d.index))
    d["light_rule"] = d["light_rule"].fillna(pd.Series(light_rules, index=d.index))
    return d


def confusion(rule: np.ndarray, ai: np.ndarray):
    tn = int(((rule == 0) & (ai == 0)).sum())
    fp = int(((rule == 0) & (ai == 1)).sum())
    fn = int(((rule == 1) & (ai == 0)).sum())
    tp = int(((rule == 1) & (ai == 1)).sum())
    return tn, fp, fn, tp


def kappa(rule: np.ndarray, ai: np.ndarray):
    n = len(rule)
    if n == 0:
        return None
    po = (rule == ai).mean()
    pe = sum(((rule == k).mean() * (ai == k).mean()) for k in (0, 1))
    return None if pe == 1 else round(float((po - pe) / (1 - pe)), 4)


def toggles(x: np.ndarray) -> int:
    return int((x[1:] != x[:-1]).sum()) if len(x) > 1 else 0


def hours(ts: pd.Series):
    return max((ts.iloc[-1] - ts.iloc[0]).total_seconds() / 3600.0, 1e-9) if len(ts) > 1 else None


def actuator_report(df: pd.DataFrame, ai_col: str, rule_col: str, name: str) -> dict:
    d = df.dropna(subset=[ai_col, rule_col]).copy()
    ai, rule = d[ai_col].astype(int).values, d[rule_col].astype(int).values
    out = {"n": int(len(d))}
    if len(d) == 0:
        return out

    tn, fp, fn, tp = confusion(rule, ai)
    h = hours(d["timestamp"])
    prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) > 0 else 0.0

    out.update(
        agreement=round(float((rule == ai).mean()), 4),
        kappa=kappa(rule, ai),
        precision_vs_rule=round(float(prec), 4),
        recall_vs_rule=round(float(rec), 4),
        f1_vs_rule=round(float(f1), 4),
        confusion_rule_vs_ai={"rule0_ai0_TN": tn, "rule0_ai1_FP": fp, "rule1_ai0_FN": fn, "rule1_ai1_TP": tp},
        positives_rule=int(rule.sum()),
        positives_ai=int(ai.sum()),
        toggles_ai=toggles(ai),
        toggles_rule=toggles(rule),
        toggles_per_hour_ai=None if h is None else round(toggles(ai) / h, 2),
        toggles_per_hour_rule=None if h is None else round(toggles(rule) / h, 2),
    )
    conf_col = "pump_confidence" if name == "pompa" else "light_confidence"
    if conf_col in d.columns and d[conf_col].notna().any():
        out["mean_confidence"] = round(float(d[conf_col].mean()), 4)

    out["warning"] = (
        f"Kelas positif < {MIN_POS}: metrik belum bermakna penuh, kumpulkan siklus nyata lebih banyak."
        if min(out["positives_rule"], out["positives_ai"]) < MIN_POS
        else None
    )
    return out


def forecast_report(df: pd.DataFrame, out_dir: str = ".") -> dict:
    """Pasangkan prediksi pada waktu t dengan nilai aktual pada t+10 menit (per sesi kontinu)."""
    d = df.dropna(subset=["predicted_moisture_10min"]).copy() if "predicted_moisture_10min" in df.columns else pd.DataFrame()

    # Jika di CSV belum banyak tercatat predicted_moisture_10min, coba evaluasi memakai forecaster_10min.joblib
    if len(d) < 30 and os.path.exists("forecaster_10min.joblib") and os.path.exists("forecast_features.py"):
        try:
            import joblib
            import forecast_features as ff
            fmodel = joblib.load("forecaster_10min.joblib")
            meta = json.load(open("forecaster_meta.json")) if os.path.exists("forecaster_meta.json") else {}
            feats = meta.get("features", ff.FEATURES)
            dd = ff.add_forecast_features(df)
            if "train_end_time" in meta:
                dd = dd[dd["timestamp"] > pd.Timestamp(meta["train_end_time"])]
            ready_mask = dd["ready"] & dd[feats].notna().all(axis=1)
            if ready_mask.sum() >= 30:
                deltas = fmodel.predict(dd.loc[ready_mask, feats])
                dd.loc[ready_mask, "predicted_moisture_10min"] = np.clip(dd.loc[ready_mask, "soil"] + deltas, 0, 100)
                d = dd.dropna(subset=["predicted_moisture_10min"]).copy()
        except Exception as e:
            print(f"ℹ️  Fallback model forecaster dilewati: {e}")

    if d.empty:
        return {"n": 0, "catatan": "Belum ada prediksi tersimpan di CSV."}

    full = df.copy()
    full["sess"] = (full["timestamp"].diff().dt.total_seconds().fillna(0) > SESSION_GAP_S).cumsum()
    d["sess"] = full.loc[d.index, "sess"]
    rows = []
    for sid, g in full.groupby("sess"):
        g_idx = g.set_index("timestamp")
        s = g_idx["soil_moisture"].where(g_idx["soil_moisture"] > 0)
        s = s[~s.index.duplicated()].sort_index()
        pr = d[d["sess"] == sid].set_index("timestamp")["predicted_moisture_10min"]
        pr = pr[~pr.index.duplicated()].sort_index()
        if pr.empty or s.empty:
            continue
        fut = s.reindex(pr.index + pd.Timedelta(seconds=HORIZON_S), method="nearest", tolerance=pd.Timedelta(seconds=TOL_S))
        now = s.reindex(pr.index, method="nearest", tolerance=pd.Timedelta(seconds=TOL_S))
        m5 = s.rolling("300s").mean().reindex(pr.index, method="nearest", tolerance=pd.Timedelta(seconds=TOL_S))
        rows.append(pd.DataFrame({"ts": pr.index + pd.Timedelta(seconds=HORIZON_S), "pred": pr.values, "y": fut.values, "now": now.values, "m5": m5.values}))

    if not rows:
        return {"n": 0, "catatan": "Tidak ada pasangan waktu yang cocok."}

    r = pd.concat(rows, ignore_index=True).dropna()
    if len(r) < 30:
        return {"n": int(len(r)), "catatan": "Pasangan < 30: belum cukup untuk disimpulkan (butuh >= 15 menit data kontinu)."}

    e_m, e_n, e_5 = (r.pred - r.y).abs(), (r.now - r.y).abs(), (r.m5 - r.y).abs()
    rmse_m = float(np.sqrt(((r.pred - r.y) ** 2).mean()))

    # Block Bootstrap untuk 95% Confidence Interval
    rng = np.random.default_rng(0)
    blocks, B = max(len(r) // 50, 1), 1000
    idx = np.array_split(np.arange(len(r)), blocks)
    diffs = []
    for _ in range(B):
        pick = np.concatenate([idx[i] for i in rng.integers(0, blocks, blocks)])
        diffs.append(e_n.values[pick].mean() - e_m.values[pick].mean())
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    mm, nn, ss = float(e_m.mean()), float(e_n.mean()), float(e_5.mean())
    layak = bool(mm < nn * 0.95 and mm < ss and lo > 0)

    # Simpan Grafik Prediksi vs Aktual untuk Laporan
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(1, 2, figsize=(12, 4.2))
        ax[0].plot(r["ts"], r["y"], ".", ms=3.5, label="Aktual (t+10 mnt)", color="#0A84FF")
        ax[0].plot(r["ts"], r["pred"], ".", ms=3.5, label="Prediksi AI", color="#AF52DE")
        ax[0].set_title("Evaluasi Time-Series Forecasting (Horizon 10 Menit)", fontweight="bold")
        ax[0].set_ylabel("Soil Moisture (%)")
        ax[0].legend()
        ax[0].tick_params(axis="x", rotation=25)

        ax[1].scatter(r["y"], r["pred"], s=8, alpha=0.5, color="#AF52DE")
        lim = [min(r["y"].min(), r["pred"].min()) - 1, max(r["y"].max(), r["pred"].max()) + 1]
        ax[1].plot(lim, lim, "k--", lw=1)
        ax[1].set_xlabel("Aktual (%)")
        ax[1].set_ylabel("Prediksi AI (%)")
        ax[1].set_title(f"MAE Model: {mm:.2f}% | RMSE: {rmse_m:.2f}% (n={len(r)})", fontweight="bold")
        fig.tight_layout()
        fig.savefig(os.path.join(out_dir, "forecast_vs_actual.png"), dpi=150)
        plt.close(fig)
    except Exception as e:
        print(f"ℹ️  Gagal membuat plot: {e}")

    return {
        "n": int(len(r)),
        "mae": round(mm, 3),
        "rmse": round(rmse_m, 3),
        "mae_model": round(mm, 3),
        "mae_naif": round(nn, 3),
        "mae_rata2_5mnt": round(ss, 3),
        "selisih_naif_minus_model": round(float(nn - mm), 3),
        "ci95_selisih": [round(float(lo), 3), round(float(hi), 3)],
        "layak": layak,
    }


def main(args):
    paths = []
    for a in args:
        paths.extend(sorted(glob.glob(a)))
    if not paths:
        paths = sorted(glob.glob("smart_planter*.csv"))
    if not paths:
        sys.exit("Cara pakai: python evaluate.py smart_planter_*.csv")

    print(f"📂 Memuat {len(paths)} file CSV: {paths}")
    df = pd.concat([pd.read_csv(p) for p in paths], ignore_index=True)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, format="ISO8601")
    df = df.drop_duplicates("id").sort_values("timestamp").reset_index(drop=True)

    df = reconstruct_rules(df)

    if "control_source" in df.columns and (df["control_source"] == "AI").any():
        ai_rows = df[(df["mode"] == "AUTO") & (df["control_source"] == "AI")].copy()
        sumber_dict = df["control_source"].fillna("LEGACY_AUTO").value_counts().to_dict()
    else:
        ai_rows = df[df["mode"] == "AUTO"].copy()
        sumber_dict = {"AUTO_ALL": int(len(ai_rows))}

    f_rep = forecast_report(df)
    result = {
        "baris_total": int(len(df)),
        "baris_diputuskan_AI": int(len(ai_rows)),
        "baris_per_sumber": sumber_dict,
        "pompa": actuator_report(ai_rows, "pump_on", "pump_rule", "pompa"),
        "lampu": actuator_report(ai_rows, "growlight_on", "light_rule", "lampu"),
        "forecast_10_menit": f_rep,
        "forecast": f_rep,
    }

    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    with open("eval_ai_vs_rule.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False, default=str)
    with open("eval_metrics.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False, default=str)

    print("\n✅ Tersimpan: eval_ai_vs_rule.json, eval_metrics.json, dan forecast_vs_actual.png")


if __name__ == "__main__":
    main(sys.argv[1:])