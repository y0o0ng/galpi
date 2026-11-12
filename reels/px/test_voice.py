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

    def test_missing_recordings_fail(self):
        os.environ["REELS_VOICE_DIR"] = self.tmp.name + "-없음"
        voice._sample.cache_clear()
        with self.assertRaises(FileNotFoundError):
            voice.speak("가")


if __name__ == "__main__":
    unittest.main()
