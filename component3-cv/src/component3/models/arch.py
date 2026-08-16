"""CNN architectures used by the stretch face-crop classifier and expression head."""

from __future__ import annotations

from typing import Any


def _torch():
    import torch
    from torch import nn
    from torch.nn import functional as F

    return torch, nn, F


class SmallFocusCNN:
    """Lazy wrapper so importing this module does not require torch at collection time.

    Architecture (64×64 grayscale): 3 conv blocks → GAP → binary logit.
    """

    def __new__(cls, *args: Any, **kwargs: Any):
        torch, nn, _F = _torch()

        class _Net(nn.Module):
            def __init__(self) -> None:
                super().__init__()
                self.features = nn.Sequential(
                    nn.Conv2d(1, 16, 3, padding=1),
                    nn.BatchNorm2d(16),
                    nn.ReLU(inplace=True),
                    nn.MaxPool2d(2),
                    nn.Conv2d(16, 32, 3, padding=1),
                    nn.BatchNorm2d(32),
                    nn.ReLU(inplace=True),
                    nn.MaxPool2d(2),
                    nn.Conv2d(32, 64, 3, padding=1),
                    nn.BatchNorm2d(64),
                    nn.ReLU(inplace=True),
                    nn.AdaptiveAvgPool2d(1),
                )
                self.head = nn.Linear(64, 1)

            def forward(self, x):
                x = self.features(x)
                x = x.flatten(1)
                return self.head(x).squeeze(1)

        return _Net(*args, **kwargs)


class MobileNetExpressionNet:
    def __new__(cls, n_classes: int = 4, *args: Any, **kwargs: Any):
        torch, nn, _F = _torch()
        from torchvision.models import MobileNet_V2_Weights, mobilenet_v2

        class _Net(nn.Module):
            def __init__(self, n_classes: int) -> None:
                super().__init__()
                try:
                    backbone = mobilenet_v2(weights=MobileNet_V2_Weights.IMAGENET1K_V1)
                except Exception:
                    backbone = mobilenet_v2(weights=None)
                in_features = backbone.classifier[1].in_features
                backbone.classifier[1] = nn.Linear(in_features, n_classes)
                self.backbone = backbone

            def forward(self, x):
                return self.backbone(x)

        return _Net(n_classes, *args, **kwargs)
