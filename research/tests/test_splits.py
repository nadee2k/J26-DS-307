import pandas as pd

from focustrack.evaluation.splits import assert_disjoint, leave_one_task_out, lopo


def sessions():
    return pd.DataFrame(
        {
            "session_id": ["s1", "s2", "s3", "s4", "s5"],
            "participant_id": ["p1", "p1", "p2", "p2", "p3"],
            "study_mode": ["screen", "screen", "screen", "non-screen", "screen"],
            "task": ["coding", "writing", "coding", "reading", "coding"],
        }
    )


def test_lopo_has_no_participant_overlap():
    folds = lopo(["p1", "p2", "p3"])
    assert len(folds) == 3
    for train, test in folds:
        assert len(test) == 1
        assert_disjoint(train, test, "lopo")


def test_loto_uses_computer_tasks_only():
    folds = leave_one_task_out(sessions(), tasks=("coding", "writing"))
    tasks = {task for _, _, task in folds}
    assert tasks == {"coding", "writing"}
    for train, test, _ in folds:
        assert_disjoint(train, test, "loto")
        # reading is never used as a test fold
        assert "s4" not in test
