import numpy as np
import pandas as pd

from focustrack.labels.probes import RatingNormaliser, label_epochs


def epochs(n=30, pid="p01", sid="s1"):
    return pd.DataFrame(
        {
            "session_id": sid,
            "participant_id": pid,
            "epoch_index": range(n),
            "epoch_start_s": [i * 60 for i in range(n)],
            "epoch_end_s": [(i + 1) * 60 for i in range(n)],
            "study_mode": "screen",
            "task": "coding",
            "typing_rate": 50.0,
        }
    )


def probes(pid="p01", sid="s1", rows=((10, 2), (20, 4))):
    return pd.DataFrame(
        {
            "session_id": [sid] * len(rows),
            "participant_id": [pid] * len(rows),
            "epoch_index": [r[0] for r in rows],
            "rating": [r[1] for r in rows],
        }
    )


def test_probe_labels_preceding_window(cfg):
    labelled = label_epochs(epochs(), probes(), cfg)
    assert len(labelled) == 10
    assert list(labelled["epoch_index"]) == list(range(5, 10)) + list(range(15, 20))

    first = labelled[labelled["epoch_index"] < 10]
    second = labelled[labelled["epoch_index"] >= 15]
    assert (first["rating_z"] == -1).all() and (first["focus_label"] == 0).all()
    assert (first["drop_label"] == 1).all()
    assert (second["rating_z"] == 1).all() and (second["focus_label"] == 1).all()


def test_held_out_participant_uses_training_fallback(cfg):
    train_probes = probes()
    norm = RatingNormaliser().fit(train_probes)

    # p02 rated every probe 5: their own mean would give z = 0, masking focus.
    unseen = probes(pid="p02", rows=((10, 5),))
    transformed = norm.transform(unseen)
    assert transformed["rating_z"].iloc[0] == 2.0  # (5 - 3) / 1 from training stats
    assert "p02" not in norm.stats


def test_no_matching_epochs_is_an_error(cfg):
    bad = probes(rows=((0, 3),))
    try:
        label_epochs(epochs(), bad, cfg)
    except ValueError as exc:
        assert "no epochs matched" in str(exc)
    else:
        raise AssertionError("expected ValueError")
