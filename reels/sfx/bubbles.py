"""보글보글(끓는 물) 효과음을 합성해 bubbles.wav로 쓴다. 기포 하나 = 음이 살짝 오르며 빨리 사라지는 사인파(Minnaert 공명).

usage: python reels/sfx/bubbles.py   (seed 고정이라 다시 돌려도 같은 파일)
"""
import wave
from pathlib import Path

import numpy as np

SR, DUR, RATE = 44100, 2.6, 22          # 샘플레이트, 길이(초), 초당 기포 수
rng = np.random.default_rng(7)
out = np.zeros(int(SR * DUR))
t = np.arange(int(SR * 0.12)) / SR      # 기포 하나의 길이
for start in rng.uniform(0, DUR - 0.12, int(RATE * DUR)):
    f0, tau = rng.uniform(120, 400), rng.uniform(0.03, 0.08)  # 큰 기포일수록 낮고 길게 운다
    f = f0 * (1 + 3.0 * t)               # 기포가 오르며 음이 올라간다
    b = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau) * rng.uniform(0.3, 1.0)
    i = int(start * SR)
    out[i:i + len(b)] += b
fade = np.minimum(1, np.minimum(np.arange(len(out)), np.arange(len(out))[::-1]) / (0.3 * SR))
out *= fade
out *= 10 ** (-1 / 20) / np.abs(out).max()   # 피크 -1dB (다른 효과음 파일과 같게)
with wave.open(str(Path(__file__).with_name("bubbles.wav")), "wb") as w:
    w.setnchannels(1), w.setsampwidth(2), w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes())
