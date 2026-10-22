import numpy as np
import pytest

from focustrack.models.registry import MODEL_NAMES, build_classifier


def data():
    rng = np.random.default_rng(0)
    X = np.vstack([rng.normal(-2, 0.5, (20, 3)), rng.normal(2, 0.5, (20, 3))])
    y = np.array([0] * 20 + [1] * 20)
    return X, y


@pytest.mark.parametrize("name", ["majority", "logreg", "svm", "random_forest", "xgboost"])
def test_classifier_contract(name):
    X, y = data()
    model = build_classifier(name, seed=0, y=y)
    model.fit(X, y)
    probability = model.predict_proba(X)

    assert probability.shape == (len(X), 2)
    assert np.all((probability >= 0) & (probability <= 1))
    if name == "majority":
        # a majority baseline is allowed to be wrong on the minority class
        assert np.allclose(probability[:, 1], probability[0, 1])
    else:
        assert np.mean((probability[:, 1] >= 0.5).astype(int) == y) > 0.8


def test_unknown_model_is_rejected():
    with pytest.raises(ValueError):
        build_classifier("transformer")
    assert "svm" in MODEL_NAMES
