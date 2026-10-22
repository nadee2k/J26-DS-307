"""Unit tests for the FocusTrack C1 desktop agent (run from this directory):

    python -m unittest test_desktop_agent -v

They exercise the privacy rules and the event buffer without starting pynput, D-Bus or
the HTTP server, so they run on any machine.
"""

import unittest

import desktop_agent as agent


class AppNameTests(unittest.TestCase):
    def test_known_processes_are_mapped(self):
        self.assertEqual(agent.normalize_app_name("code"), "VS Code")
        self.assertEqual(agent.normalize_app_name("google-chrome"), "Chrome")
        self.assertEqual(agent.normalize_app_name("firefox.exe"), "Firefox")
        self.assertEqual(agent.normalize_app_name("org.kde.konsole"), "Terminal")
        self.assertEqual(agent.normalize_app_name("app.zen_browser.zen"), "Zen Browser")

    def test_empty_and_unknown_values_are_handled(self):
        self.assertIsNone(agent.normalize_app_name(None))
        self.assertIsNone(agent.normalize_app_name("   "))
        self.assertIsNone(agent.normalize_app_name("false"))
        self.assertEqual(agent.normalize_app_name("My Custom App"), "My Custom App")

    def test_titles_are_never_needed_to_get_a_name(self):
        # The function receives an application id, not a window title; a dotted desktop id
        # resolves through its final segment.
        self.assertEqual(agent.normalize_app_name("org.kde.dolphin"), "Files")


class EventStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = agent.EventStore()

    def test_events_are_ignored_until_a_session_starts(self):
        self.assertFalse(self.store.record("key"))
        self.store.start(mode="screen", task="coding", epoch_sec=15)
        self.assertTrue(self.store.record("key"))

    def test_start_clears_previous_events_and_resets_the_cursor(self):
        self.store.start()
        self.store.record("key")
        first = self.store.snapshot(since=0)
        self.assertEqual(len(first["events"]), 1)
        self.assertEqual(first["cursor"], 1)
        self.store.start()
        second = self.store.snapshot(since=0)
        self.assertEqual(second["events"], [])
        self.assertEqual(second["cursor"], 0)

    def test_backspace_and_key_are_distinct_but_never_carry_content(self):
        self.store.start()
        self.store.record("key")
        self.store.record("back")
        events = self.store.snapshot(since=0)["events"]
        self.assertEqual([e["kind"] for e in events], ["key", "back"])
        for event in events:
            self.assertNotIn("char", event)
            self.assertNotIn("key", event)

    def test_move_requires_a_positive_distance(self):
        self.store.start()
        self.assertFalse(self.store.record("move"))
        self.assertFalse(self.store.record("move", dist=0))
        self.assertTrue(self.store.record("move", dist=12.5))

    def test_sequence_numbers_are_monotonic_even_for_same_millisecond_events(self):
        self.store.start()
        for _ in range(20):
            self.store.record("key")
        events = self.store.snapshot(since=0)["events"]
        self.assertEqual([e["seq"] for e in events], list(range(1, 21)))
        timestamps = [e["t"] for e in events]
        self.assertEqual(timestamps, sorted(timestamps))

    def test_snapshot_uses_an_exclusive_cursor_and_reports_more(self):
        self.store.start()
        for _ in range(5):
            self.store.record("key")
        page = self.store.snapshot(since=0, limit=2)
        self.assertEqual(len(page["events"]), 2)
        self.assertTrue(page["more"])
        self.assertEqual(page["cursor"], 2)
        rest = self.store.snapshot(since=page["cursor"], limit=10)
        self.assertEqual([e["seq"] for e in rest["events"]], [3, 4, 5])
        self.assertFalse(rest["more"])

    def test_app_switch_is_only_recorded_between_two_known_apps(self):
        self.store.set_active_app("code")
        self.store.start()
        self.store.set_active_app("code")  # no change -> no event
        self.store.set_active_app("firefox")
        events = self.store.snapshot(since=0)["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["kind"], "switch")
        self.assertEqual(events[0]["app"], "Firefox")

    def test_no_switch_while_not_recording(self):
        self.store.set_active_app("code")
        self.store.set_active_app("firefox")
        self.store.start()
        events = self.store.snapshot(since=0)["events"]
        self.assertEqual(events, [])
        self.assertEqual(self.store.status()["activeApp"], "Firefox")

    def test_stop_freezes_the_recording_flag(self):
        self.store.start()
        self.store.record("key")
        self.store.stop()
        self.assertFalse(self.store.record("key"))
        self.assertEqual(self.store.status()["count"], 1)

    def test_status_reports_readiness_and_privacy_metadata(self):
        self.store.set_input_status(True, "libinput")
        self.store.set_window_status(True, "kwin-script")
        status = self.store.status()
        self.assertTrue(status["ready"])
        self.assertEqual(status["input"]["backend"], "libinput")
        self.assertEqual(status["window"]["backend"], "kwin-script")
        self.assertNotIn("title", status)


if __name__ == "__main__":
    unittest.main()
