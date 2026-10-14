"""효과음 배치(place_sfx)의 역할별 간격 회귀 검증."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from px import audio


def kinds(events):
    return [e[1] for e in audio.place_sfx(events, 10)[1]]


class SfxRoleTest(unittest.TestCase):
    def test_untagged_keeps_old_rule(self):
        self.assertEqual(kinds([(0, "pop"), (0.5, "click"), (1.1, "thud"), (1.3, "jingle")]), ["pop", "thud", "jingle"])

    def test_motion_and_event_have_no_gap(self):
        self.assertEqual(kinds([(0, "pop"), (0.2, "click", "event"), (0.4, "click", "event"), (0.5, "ticks", "motion")]),
                         ["pop", "click", "click", "ticks"])

    def test_accent_gap_counts_only_accents(self):
        ev = [(0, "pop", "accent"), (0.5, "thud", "event"), (1.5, "sparkle", "accent"), (2.1, "pop", "accent")]
        self.assertEqual(kinds(ev), ["pop", "thud", "pop"])
        self.assertEqual(audio.place_sfx(ev, 10)[1][1], (0.5, "thud", "event"))

    def test_unknown_role_fails(self):
        with self.assertRaises(ValueError):
            audio.place_sfx([(0, "pop", "boom")], 1)


if __name__ == "__main__":
    unittest.main()
