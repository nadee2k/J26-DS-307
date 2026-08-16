"""Unified CLI: python -m component3 <command> ..."""

from __future__ import annotations

import sys


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in {"-h", "--help"}:
        print(
            "Usage: python -m component3 <command> [args]\n\n"
            "Commands:\n"
            "  capture          Live/file session capture (consent-gated)\n"
            "  calibrate        9-point per-participant gaze calibration\n"
            "  train            RF/XGBoost LNPO baseline\n"
            "  train-cnn        Stretch CNN on face crops\n"
            "  evaluate         End-to-end + majority baseline report\n"
            "  ablation         Visual contribution vs mocked Comp 1/2\n"
            "  benchmark        Real-time throughput check\n"
            "  export-schema    Write schema/window_record.schema.json\n"
            "  finetune-phone   YOLOv8n occlusion-aware fine-tune\n"
            "  synthetic        Generate labelled synthetic windows\n"
            "  web              Launch the management web app (recommended)\n"
        )
        return 0
    cmd, rest = argv[0], argv[1:]
    dispatch = {
        "capture": ("component3.capture", "main"),
        "calibrate": ("component3.features.gaze_calibration", "main"),
        "train": ("component3.models.train_baseline", "main"),
        "train-cnn": ("component3.models.train_cnn", "main"),
        "evaluate": ("component3.evaluate", "main"),
        "ablation": ("component3.ablation", "main"),
        "benchmark": ("component3.benchmark", "main"),
        "export-schema": ("component3.export_schema", "main"),
        "finetune-phone": ("component3.features.phone_detect", "main"),
        "synthetic": ("component3.synthetic", "main"),
        "web": ("component3.web.app", "main"),
    }
    if cmd not in dispatch:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        return 2
    mod_name, fn_name = dispatch[cmd]
    import importlib

    mod = importlib.import_module(mod_name)
    fn = getattr(mod, fn_name)
    return int(fn(rest) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
