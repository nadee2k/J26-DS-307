#!/usr/bin/env bash
# Refresh the simulator and model code from the PP1 app, then run the demo.
# The copied modules are unchanged; this script only keeps them in sync.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="../FocusTrack_PP1_Demo/frontend"

if [ ! -d "$SRC" ]; then
  echo "Cannot find $SRC. Run this from the repository that contains both demos." >&2
  exit 1
fi

cp "$SRC/lib/sim/rng.ts" "$SRC/lib/sim/types.ts" "$SRC/lib/sim/generate.ts" "$SRC/lib/sim/ml.ts" lib/sim/
cp "$SRC/lib/focus/types.ts" "$SRC/lib/focus/linear.ts" "$SRC/lib/focus/models.ts" \
   "$SRC/lib/focus/c1-model.ts" "$SRC/lib/focus/c1.ts" "$SRC/lib/focus/c2.ts" \
   "$SRC/lib/focus/c3.ts" "$SRC/lib/focus/c4.ts" "$SRC/lib/focus/buffers.ts" \
   "$SRC/lib/focus/c1-friendly.ts" "$SRC/lib/focus/vision-math.ts" lib/focus/
cp "$SRC/public/models/c1.json" public/models/

echo "Core simulator and models refreshed from $SRC."
echo "Run: npm run build"
