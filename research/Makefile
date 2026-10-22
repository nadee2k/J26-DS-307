PY := .venv/bin/python
CONFIG := configs/c1_proposed.yaml

.PHONY: setup data test notebooks clean

setup:
	uv venv --python 3.12 .venv
	uv pip install --python $(PY) -e ".[dev]"

data:
	$(PY) scripts/build_features.py --config $(CONFIG)

test:
	$(PY) -m pytest

notebooks:
	$(PY) -m jupyter nbconvert --to html --execute notebooks/*.ipynb \
		--output-dir artifacts/reports

clean:
	rm -rf data/interim/* data/processed/* artifacts/runs/* artifacts/models/* artifacts/reports/*
