"""시온 목소리(px/voice.py) 회귀: 녹음은 git 밖이라 가짜 98음절(사인파)로 규칙만 본다."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
import wave

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from px import audio, voice

SR = audio.SR


def fake_recordings(d):
    for k, name in enumerate(voice.NAMES):
        t = np.arange(int(0.3 * SR)) / SR
        y = 0.3 * np.sin(2 * np.pi * (110 + k) * t) * np.hanning(len(t))
        with wave.open(str(Path(d) / f"{name}.wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((y * 32767).astype(np.int16).tobytes())


class VoiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        fake_recordings(self.tmp.name)
        os.environ["REELS_VOICE_DIR"] = self.tmp.name
        voice._sample.cache_clear()

    def tearDown(self):
        os.environ.pop("REELS_VOICE_DIR")
        voice._sample.cache_clear()
        self.tmp.cleanup()

    def test_same_text_same_sound(self):
        self.assertTrue(np.array_equal(voice.speak("드론은 왜 날까?"), voice.speak("드론은 왜 날까?")))

    def test_length_follows_syllables_and_pauses(self):
        one = voice.secs("가나다라")                                  # 4음절, 마지막 1.5배
        self.assertAlmostEqual(one, 3 / voice.RATE + 1.5 / voice.RATE, delta=0.01)
        self.assertGreater(voice.secs("가나, 다라") - voice.secs("가나 다라"), voice.GAP_COMMA - max(voice.GAP_WORD) - 0.01)
        self.assertGreater(voice.secs("가나. 다라.") - voice.secs("가나 다라."), voice.GAP_SENTENCE - max(voice.GAP_WORD) - 0.01)

    def test_need_is_reading_floor_or_voice_plus_tail(self):
        t = "가나다라마바사아자차카타파하"                              # 14음절: 읽기 2초 > 말 1.45초
        self.assertAlmostEqual(voice.need(t), 14 / voice.READ_RATE + voice.TAIL, places=6)

    def test_timing_reads_hook_and_statements_from_final(self):
        md = "- `hook_words`: `가나는` / `다라?`\n\n| `a` | 내용 | 진술: `마바사`, 라벨(선택): `아자` | 1 | - |\n"
        rows = voice.timing(md)
        self.assertEqual([r["text"] for r in rows], ["가나는 다라?", "마바사"])
        self.assertTrue(all(r["need"] >= r["voice"] + voice.TAIL - 1e-9 for r in rows))

    def test_numbers_units_and_english_read_as_hangul(self):
        cases = {"서버 4대가": "서버 네 대가", "1980년": "천구백팔십년", "20살": "스무 살", "24시간": "스물네 시간",
                 "3개월": "삼개월", "1번째": "첫 번째", "3.5배": "삼점오배", "1,000명": "천명", "10000원": "만원",
                 "15%": "십오퍼센트", "몇 km": "몇 킬로미터", "100m": "백미터", "잡음비(SNR)": "잡음비(에스엔알)", "12": "십이"}
        for text, said in cases.items():
            self.assertEqual(voice.read_aloud(text), said, text)
        self.assertTrue(all('가' <= c <= '힣' for c in voice.read_aloud("fiber")))  # 그 밖의 영어도 한글 음절로
        self.assertGreater(voice.secs("SNR"), voice.secs("에"))                      # 더는 글자마다 '에' 하나가 아니다

    def test_plan_speaks_statements_not_numbers_or_labels(self):
        class S:
            def __init__(self, length, texts):
                self.length, self.texts = length, texts
        ep = type("Ep", (), {})()
        ep.nar = {"hook": "가나?", "scenes": {"a": {"screen_text": ["다라마"], "numbers": ["12"], "labels": ["바사"]}}}
        ep.scenes = [S(9.0, [("다라마", 1.0, 5.0), ("12", 2.0, 6.0), ("바사", 1.0, 6.0)])]
        ep.starts = [0.0]
        self.assertEqual([r[1] for r in voice.plan(ep)], ["가나?", "다라마"])

    def test_missing_recordings_fail(self):
        os.environ["REELS_VOICE_DIR"] = self.tmp.name + "-없음"
        voice._sample.cache_clear()
        with self.assertRaises(FileNotFoundError):
            voice.speak("가")


if __name__ == "__main__":
    unittest.main()
