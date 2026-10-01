"""딸깍 3번(ticks3.wav): 2.5kHz 사인 + 백색 잡음, 시정수 6ms로 감쇠하는 약 30ms 클릭을 0·0.25·0.50초에 놓는다.
usage: python reels/sfx/ticks.py   (seed 고정이라 다시 돌려도 같은 파일)"""
import wave
from pathlib import Path

import numpy as np

SR, CLICK, STARTS = 44100, 0.03, (0.0, 0.25, 0.50)
rng = np.random.default_rng(3)
t = np.arange(int(SR * CLICK)) / SR
click = (np.sin(2 * np.pi * 2500 * t) + rng.uniform(-1, 1, len(t))) * np.exp(-t / 0.006)
out = np.zeros(int(SR * (STARTS[-1] + CLICK)) + 1)
for s in STARTS:
    out[int(s * SR):int(s * SR) + len(click)] += click
out *= 10 ** (-1 / 20) / np.abs(out).max()   # 피크 -1dB (다른 효과음 파일과 같게)
with wave.open(str(Path(__file__).with_name("ticks3.wav")), "wb") as w:
    w.setnchannels(1), w.setsampwidth(2), w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes())
