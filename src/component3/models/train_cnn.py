"""Stretch: small CNN on face crops (built after the engineered-feature baseline).

With 20–25 participants this model is a real overfitting risk. Report validation
performance honestly if it underperforms RF/XGBoost — that is a legitimate finding.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from component3.config import load_config, resolve_path
from component3.models.arch import SmallFocusCNN


def _iter_labeled_crops(root: Path) -> tuple[list[Path], list[int]]:
    """Expect root/focused/*.jpg and root/distracted/*.jpg."""
    paths: list[Path] = []
    labels: list[int] = []
    for label, name in ((1, "focused"), (0, "distracted")):
        folder = root / name
        if not folder.exists():
            continue
        for p in sorted(folder.glob("*")):
            if p.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                paths.append(p)
                labels.append(label)
    return paths, labels


def train_cnn(
    cfg: dict[str, Any],
    crops_dir: Path,
    epochs: int | None = None,
) -> dict[str, Any]:
    import cv2
    import torch
    from torch.utils.data import DataLoader, Dataset, random_split

    paths, labels = _iter_labeled_crops(Path(crops_dir))
    if len(paths) < 20:
        raise FileNotFoundError(
            f"Need labelled face crops under {crops_dir}/focused and {crops_dir}/distracted "
            f"(found {len(paths)}). Train the engineered-feature baseline first."
        )
    size = int(cfg["model"].get("cnn_image_size", 64))
    epochs = int(epochs if epochs is not None else cfg["model"].get("cnn_epochs", 15))
    batch = int(cfg["model"].get("cnn_batch_size", 32))
    lr = float(cfg["model"].get("cnn_lr", 0.001))

    class CropDS(Dataset):
        def __init__(self, paths, labels):
            self.paths = paths
            self.labels = labels

        def __len__(self):
            return len(self.paths)

        def __getitem__(self, idx):
            img = cv2.imread(str(self.paths[idx]), cv2.IMREAD_GRAYSCALE)
            if img is None:
                img = np.zeros((size, size), dtype=np.uint8)
            img = cv2.resize(img, (size, size))
            x = torch.from_numpy(img.astype(np.float32) / 255.0).unsqueeze(0)
            y = torch.tensor(self.labels[idx], dtype=torch.float32)
            return x, y

    ds = CropDS(paths, labels)
    n_val = max(1, int(0.2 * len(ds)))
    n_train = len(ds) - n_val
    train_ds, val_ds = random_split(
        ds, [n_train, n_val],
        generator=torch.Generator().manual_seed(int(cfg["model"]["random_state"])),
    )
    train_loader = DataLoader(train_ds, batch_size=batch, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=batch)

    device = torch.device("cpu")
    model = SmallFocusCNN().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    pos = max(sum(labels), 1)
    neg = max(len(labels) - sum(labels), 1)
    pos_weight = torch.tensor([neg / pos], dtype=torch.float32)
    loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    history = []
    best_val = -1.0
    best_state = None
    for epoch in range(epochs):
        model.train()
        train_loss = 0.0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            logits = model(xb)
            loss = loss_fn(logits, yb)
            loss.backward()
            opt.step()
            train_loss += float(loss.item()) * len(xb)
        model.eval()
        correct = 0
        total = 0
        with torch.no_grad():
            for xb, yb in val_loader:
                logits = model(xb)
                pred = (torch.sigmoid(logits) >= 0.5).float()
                correct += int((pred == yb).sum().item())
                total += len(yb)
        val_acc = correct / max(total, 1)
        history.append({"epoch": epoch, "train_loss": train_loss / max(n_train, 1), "val_acc": val_acc})
        if val_acc >= best_val:
            best_val = val_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    artifacts = resolve_path(cfg, "artifacts_dir")
    artifacts.mkdir(parents=True, exist_ok=True)
    out = artifacts / "focus_cnn.pt"
    torch.save(best_state or model.state_dict(), out)
    payload = {
        "n_images": len(paths),
        "best_val_accuracy": best_val,
        "history": history,
        "weights": str(out),
        "caveat": (
            "Small-sample CNN on face crops; compare against RF/XGBoost LNPO numbers. "
            "Do not prefer this model solely because it is a neural net."
        ),
    }
    reports = resolve_path(cfg, "reports_dir")
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "cnn_train.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Stretch CNN on face crops")
    parser.add_argument("--crops-dir", required=True)
    parser.add_argument("--config", default=None)
    parser.add_argument("--epochs", type=int, default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    payload = train_cnn(cfg, Path(args.crops_dir), epochs=args.epochs)
    print(json.dumps({k: v for k, v in payload.items() if k != "history"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
