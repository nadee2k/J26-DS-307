import json
from pathlib import Path

import numpy as np
import pandas as pd

from focustrack.export.web_model import build_live_rows

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + np.exp(-z))


def test_contract_fixture_matches_model():
    contract = json.loads((ROOT / "contracts" / "c1_features.json").read_text())
    fixture = json.loads((ROOT / "contracts" / "c1_fixture.json").read_text())
    model_path = REPO / contract["model"]
    model = json.loads(model_path.read_text())["model"]

    assert len(contract["vector"]) == len(model["names"]) == 10
    assert len(fixture["x"]) == len(model["names"])

    z = model["w"][0] + sum(
        model["w"][j + 1] * ((fixture["x"][j] - model["mu"][j]) / (model["sg"][j] or 1.0))
        for j in range(len(model["names"]))
    )
    assert abs(_sigmoid(z) - fixture["expectedProbability"]) < fixture["tolerance"]


def test_live_rows_replicate_app_smoothing(cfg):
    raw = ROOT / "data" / "raw" / "simulated_seed2026"
    rows = build_live_rows(
        pd.read_csv(raw / "epochs.csv"),
        pd.read_csv(raw / "probes.csv"),
        pd.read_csv(raw / "sessions.csv"),
        cfg,
    )

    assert len(rows) == 2870
    assert set(rows["focus_label"].unique()) == {0, 1}
    assert all(len(x) == 10 for x in rows["x"].head(20))
