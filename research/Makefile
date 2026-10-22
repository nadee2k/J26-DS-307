PY := .venv/bin/python
CONFIG := configs/c1_proposed.yaml
SIM_BUILD := .sim-build

.PHONY: setup data sim-data states all test experiments quick export notebooks clean

setup:
	uv venv --python 3.12 .venv
	uv pip install --python $(PY) -e ".[dev]"

data:
	$(PY) scripts/build_features.py --config $(CONFIG)

states:
	$(PY) scripts/run_states.py --config $(CONFIG)

all: data states

experiments:
	$(PY) scripts/run_experiments.py --config $(CONFIG) --output artifacts/runs/latest

export:
	$(PY) scripts/export_web_model.py --config $(CONFIG)

quick:
	$(PY) scripts/run_experiments.py --quick --output artifacts/runs/quick

# Rebuild the frozen snapshot from the current PP1 simulator (requires node + npx).
sim-data:
	cd ../FocusTrack_PP1_Demo/frontend && npx tsc lib/sim/types.ts lib/sim/rng.ts lib/sim/generate.ts --outDir ../../research/$(SIM_BUILD) --module commonjs --target es2020 --skipLibCheck
	node scripts/export_simulated.js data/raw/simulated_seed2026 2026 $(SIM_BUILD)

test:
	$(PY) -m pytest

notebooks:
	$(PY) -m jupyter nbconvert --to html --execute notebooks/*.ipynb \
		--output-dir artifacts/reports

clean:
	rm -rf data/interim/* data/processed/* artifacts/runs/* artifacts/models/* artifacts/reports/* $(SIM_BUILD)
