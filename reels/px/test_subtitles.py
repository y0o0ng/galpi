"""갈무리11 자막의 원고·박스·커서·시간·출력 격자 회귀 검증."""
import json
from pathlib import Path
import sys
import subprocess
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from px import engine as E, lint


class SubtitleTest(unittest.TestCase):
    def test_measured_width_and_script_gate(self):
        for text, width in [("가", 12), (" ", 5), (",", 4), (".", 4)]:
            self.assertEqual(E.text_w(text, E.CARD_FONT), width)
        cases = [
            ("기어 위치로 숫자를 기억해요.", 0, "PASS"),
            ("가" * 11 + " / " + "나" * 11 + ".", 0, "PASS"),
            ("길이가 서로 다른 톱니 아홉 개를 계단처럼 붙였죠.", 1, "NEEDS_SPLIT"),
            ("가" * 12 + " " + "나" * 12, 1, "NEEDS_SPLIT"),
            ("가" * 13, 1, "자막 줄 폭 초과"),
        ]
        for sentence, code, message in cases:
            with self.subTest(sentence=sentence):
                result = subprocess.run([sys.executable, str(ROOT / "px/secs.py"), sentence],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, code)
                self.assertIn(message, result.stdout + result.stderr)
        with self.assertRaises(ValueError):
            E.split_cards("가" * 13)

    def test_existing_scripts_fit_without_changing_words(self):
        count = 0
        for path in (ROOT / "episodes").glob("*_px/narration.ko.json"):
            for sentences in json.loads(path.read_text())["scenes"].values():
                for sentence in sentences:
                    count += 1
                    cards = E.split_cards(sentence)
                    self.assertEqual("".join("".join(c) for c in cards).replace(" ", ""),
                                     E.clean(sentence).replace(" ", ""))
                    for card in cards:
                        self.assertLessEqual(len(card), 2)
                        for line in card:
                            self.assertLessEqual(E.text_w(line, E.CARD_FONT), E.CARD_INNER_W)
                        duration = E.card_secs(card)
                        self.assertLessEqual(E.char_times(card, 0, duration)[-1], duration)
                    plan = E.plan([sentence])
                    self.assertAlmostEqual(plan[-1][1] + plan[-1][2],
                                           E.LEAD + E.sentence_secs(sentence))
        self.assertGreater(count, 0)

    def test_two_lines_and_cursor_stay_inside_box(self):
        self.assertEqual(E.FONT[E.CARD_FONT].getname(), ("Galmuri11", "Regular"))
        card = ["가" * 12, "힣" * 12]
        base = E.background()
        E.draw_card(base, [], 0)
        for typed in (0, 12, 13, 24):
            image = E.background()
            E.draw_card(image, card, typed, cursor=True)
            yy, xx = np.where(np.any(np.asarray(image) != np.asarray(base), axis=2))
            x0, y0, x1, y1 = E.CARD_BOX
            self.assertTrue((xx > x0).all() and (xx < x1).all())
            self.assertTrue((yy > y0).all() and (yy < y1).all())
            self.assertEqual(lint.check_canvas(image, E.PALETTE)[0], 0)
            self.assertTrue(lint.check_output(E.to_output(image), E.SCALE))


if __name__ == "__main__":
    unittest.main()
