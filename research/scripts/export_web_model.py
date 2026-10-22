"""Export the deployable C1 model to the PP1 web app.

Usage:
    python scripts/export_web_model.py

Outputs:
    ../FocusTrack_PP1_Demo/frontend/public/models/c1.json
    contracts/c1_features.json
    contracts/c1_fixture.json
    artifacts/export/manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from focustrack.config import load_config  # noqa: E402
from focustrack.export.web_model import export_web_model  # noqa: E402


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_state() -> dict:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT.parent, capture_output=True, text=True, check=True
        ).stdout.strip()
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain"], cwd=ROOT.parent, capture_output=True, text=True, check=True
            ).stdout.strip()
        )
        return {"commit": commit, "dirty": dirty}
    except Exception:
        return {"commit": None, "dirty": None}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/c1_proposed.yaml")
    parser.add_argument(
        "--epochs", default="data/raw/simulated_seed2026/epochs.csv"
    )
    parser.add_argument(
        "--probes", default="data/raw/simulated_seed2026/probes.csv"
    )
    parser.add_argument(
        "--sessions", default="data/raw/simulated_seed2026/sessions.csv"
    )
    parser.add_argument(
        "--output",
        default="../FocusTrack_PP1_Demo/frontend/public/models/c1.json",
    )
    parser.add_argument("--contract", default="contracts/c1_features.json")
    parser.add_argument("--fixture", default="contracts/c1_fixture.json")
    args = parser.parse_args()

    cfg = load_config(ROOT / args.config)
    epochs = (ROOT / args.epochs).resolve()
    probes = (ROOT / args.probes).resolve()
    sessions = (ROOT / args.sessions).resolve()
    output = (ROOT / args.output).resolve()
    contract = (ROOT / args.contract).resolve()
    fixture = (ROOT / args.fixture).resolve()

    payload = export_web_model(
        cfg,
        epochs_path=epochs,
        probes_path=probes,
        sessions_path=sessions,
        output=output,
        contract_path=contract,
        fixture_path=fixture,
    )

    manifest_dir = cfg.artifacts_dir / "export"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "model": payload["version"],
        "output": str(output),
        "contract": str(contract),
        "fixture": str(fixture),
        "trainedOn": payload["trainedOn"],
        "evaluation": payload["evaluation"],
        "dataSha256": payload["dataSha256"],
        "contractSha256": _sha256(contract),
        "fixtureSha256": _sha256(fixture),
        "git": _git_state(),
    }
    (manifest_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )

    print(f"model:    {output}")
    print(f"contract: {contract}")
    print(f"fixture:  {fixture}")
    print(f"participants: {payload['evaluation']['participants']}")
    print(f"LOPO Macro-F1: {payload['evaluation']['lopo_macro_f1']:.3f}")


if __name__ == "__main__":
    main()
