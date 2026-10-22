"""Per-fold pipeline (proposal 3.8).

Phase 4: fit the scaler, the HMM and the classifier inside each training fold;
transform the held-out participant with those fitted objects only.
"""
