"""효과음 키트(sfxkit) 회귀: 귀를 찌르지 않는 음역·끊기지 않는 끝·크기 기준, 그리고 엔진의 T.kit·bgm_gain 섞기."""
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from px import audio, sfxkit as K
from px.templates import Episode


def high_share(x, hz=2000):
    F = np.abs(np.fft.rfft(x)) ** 2
    return F[np.fft.rfftfreq(len(x), 1 / audio.SR) > hz].sum() / F.sum()


SOUNDS = {
    "notes": K.notes([K.C5, K.E5]), "hum": K.hum(2.0), "stutter": K.stutter(), "tone": K.tone(2.0),
    "wobble": K.wobble(2.0), "drop": K.drop(), "whoosh": K.whoosh(),
}


class KitTest(unittest.TestCase):
    def test_no_piercing_highs(self):
        for name, x in SOUNDS.items():
            self.assertLess(high_share(x), 0.01, name)

    def test_ends_without_hard_cut(self):
        for name, x in SOUNDS.items():
            self.assertLess(np.abs(x[-int(0.005 * audio.SR):]).max(), 0.05 * np.abs(x).max(), name)

    def test_levels_stay_under_bgm(self):
        for name, x in SOUNDS.items():
            self.assertLess(audio.rms_db(x, True), -25, name)

    def test_swell_reaches_target(self):
        x = K.swell(K.wobble(3.0), 1.0, -42, -25)
        self.assertAlmostEqual(audio.rms_db(x[int(1.2 * audio.SR):int(2.4 * audio.SR)]), -25, delta=1.0)               # 앞뒤 fade만큼 1dB 안쪽 오차


class EngineKitTest(unittest.TestCase):
    """44편이 아니라 엔진만: 형식 2 Episode 하나를 최소 장면으로 만들어 섞기를 본다."""

    def _episode(self, tmp):
        import json
        (tmp / "narration.ko.json").write_text(json.dumps({"format_version": 2, "hook": "왜?", "hook_words": ["왜?"], "scenes": {"hook": {"screen_text": []}, "a": {"screen_text": []}}}, ensure_ascii=False))
        (tmp / "scenes.json").write_text(json.dumps([{"id": "hook", "duration": 4.0, "events": {}, "texts": []},
                                                     {"id": "a", "duration": 4.0, "events": {}, "texts": []}]))
        draw = {"hook": lambda *a: None}

        def a(img, d, t, ta, T):
            T.kit = [(1.0, K.notes([K.C5]), "신호")]
            T.bgm_gain = 0.5
        draw["a"] = a
        return Episode(tmp, ("hook", "a"), draw, "kit_test")

    def test_kit_and_bgm_gain_mix(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            ep = self._episode(Path(d))
            mixed, log = ep._kit()
            self.assertEqual(log, [(5.0, "신호")])
            self.assertGreater(np.abs(mixed[int(5.02 * audio.SR):int(5.1 * audio.SR)]).max(), 0)
            g = ep._bgm_gain()
            self.assertAlmostEqual(g[int(1.0 * audio.SR)], 1.0)
            self.assertAlmostEqual(g[int(6.5 * audio.SR)], 0.5)
            self.assertTrue(0.5 < g[int(4.0 * audio.SR)] < 1.0)        # 경계는 1초에 걸쳐 바뀐다
            b, _, sf, *_ = ep.sound()                                   # 렌더가 쓰는 실제 경로
            self.assertGreater(np.abs(sf[int(5.02 * audio.SR):int(5.1 * audio.SR)]).max(), 0)
            raw = audio.bgm(ep.total, ep.bgm)
            i = int(6.5 * audio.SR)
            self.assertAlmostEqual(b[i] / raw[i], 0.5, places=3)


if __name__ == "__main__":
    unittest.main()
