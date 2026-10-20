"""Vercel Python function for chronological-age inference.

The existing Keras network is executed with NumPy weights, avoiding a large
TensorFlow dependency in the deployed function. No user submissions are saved.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import joblib
import numpy as np
import pandas as pd


BASE = Path(__file__).resolve().parents[1]
MODELS = BASE / "models"
_behavior_model = None
_full_artifacts = None
_weights = None


def _load_models():
    global _behavior_model, _full_artifacts, _weights
    if _behavior_model is None:
        _behavior_model = joblib.load(MODELS / "behavior_model.joblib")
    if _full_artifacts is None:
        _full_artifacts = joblib.load(MODELS / "plasma_behavior_preprocessing.joblib")
    if _weights is None:
        _weights = dict(np.load(MODELS / "plasma_behavior_weights.npz"))


def _number(value, name):
    if value is None or value == "":
        return np.nan
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not np.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _identity(payload):
    sex = str(payload.get("sex", "")).strip()
    line = str(payload.get("line", "")).strip()
    if sex not in {"Male", "Female"}:
        raise ValueError("Sex must be Male or Female")
    if not line:
        raise ValueError("Line is required")
    return sex, line


def _dense(x, name, relu=True):
    z = x @ _weights[f"{name}_0"] + _weights[f"{name}_1"]
    return np.maximum(z, 0) if relu else z


def _batch_norm(x, name):
    gamma, beta, mean, variance = (_weights[f"{name}_{i}"] for i in range(4))
    return gamma * (x - mean) / np.sqrt(variance + 0.001) + beta


def _full_network(plasma, behavior):
    p = _batch_norm(_dense(plasma, "dense"), "batch_normalization")
    p = _batch_norm(_dense(p, "dense_1"), "batch_normalization_1")
    b = _dense(_dense(behavior, "dense_2"), "dense_3")
    x = _dense(np.concatenate([p, b], axis=1), "dense_4")
    return float(_dense(x, "predicted_age_months", relu=False)[0, 0])


def predict(payload):
    _load_models()
    sex, line = _identity(payload)
    mode = payload.get("mode")
    values = payload.get("behavior", {})
    if not isinstance(values, dict):
        raise ValueError("Behavior must be an object of measure names and numeric values")

    if mode == "behavior":
        names = _behavior_model["features"]
        row = {name: _number(values.get(name), name) for name in names}
        if sum(np.isfinite(v) for v in row.values()) < 4:
            raise ValueError("Enter at least four behavior measurements")
        x = pd.DataFrame([{**row, "Sex": sex, "Line": line}])
        matrix = _behavior_model["prep"].transform(x)
        weight = _behavior_model["linear_weight"]
        age = float(((1 - weight) * _behavior_model["boosted"].predict(matrix) + weight * _behavior_model["linear"].predict(matrix))[0])
        return {"predicted_age_months": round(age, 2), "model": "behavior", "input_measures": int(sum(np.isfinite(v) for v in row.values()))}

    if mode != "full":
        raise ValueError("Mode must be behavior or full")
    artifacts = _full_artifacts
    names = artifacts["behavior_measures"]
    row = {name: _number(values.get(name), name) for name in names}
    if sum(np.isfinite(v) for v in row.values()) < 5:
        raise ValueError("Full-model predictions need at least five behavior measurements")
    x = pd.DataFrame([{**row, "Sex": sex, "Line": line}])
    numeric = artifacts["numeric_imputer"].transform(x[names])
    categories = artifacts["category_encoder"].transform(x[["Sex", "Line"]])
    x_behavior = artifacts["tabular_scaler"].transform(np.column_stack([numeric, categories])).astype("float32")

    quantities = payload.get("plasma")
    if not isinstance(quantities, dict):
        raise ValueError("Plasma must be an object mapping protein accession to quantity")
    protein_names = artifacts["protein_names"]
    measured = {}
    for name in protein_names:
        if name in quantities:
            value = _number(quantities[name], name)
            if np.isfinite(value) and value > 0:
                measured[name] = value
    if len(measured) < 800:
        raise ValueError(f"Only {len(measured)} usable proteins matched; at least 800 are required")
    normalization_names = set(artifacts["normalization_protein_names"])
    normalization_values = [float(value) for name, value in quantities.items() if name in normalization_names and isinstance(value, (float, int)) and np.isfinite(value) and value > 0]
    if not normalization_values:
        raise ValueError("No valid plasma quantities were found")
    sample_median = float(np.median(np.log2(normalization_values)))
    plasma = pd.DataFrame([{name: measured.get(name, np.nan) for name in protein_names}])
    plasma = np.log2(plasma).sub(sample_median).add(artifacts["protein_log2_reference"])
    x_plasma = artifacts["protein_scaler"].transform(artifacts["protein_imputer"].transform(plasma)).astype("float32")
    age = _full_network(x_plasma, x_behavior)
    return {"predicted_age_months": round(age, 2), "model": "full", "matched_proteins": len(measured), "input_measures": int(sum(np.isfinite(v) for v in row.values()))}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2_000_000:
                raise ValueError("Request must contain JSON smaller than 2 MB")
            payload = json.loads(self.rfile.read(length))
            result = predict(payload)
            status = 200
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            result = {"error": str(exc)}
            status = 400
        except Exception:
            result = {"error": "Prediction failed. Check the uploaded file format and try again."}
            status = 500
        body = json.dumps(result).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
