"""도트 트랙 공통 부품: 장면 실행기(Episode), chip·kicker·마스코트, hook 배치. 편마다 다른 것은 인자로 받는다."""
import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from px import audio, engine as E
from px.sprite import sprite, sparkles
from px.sprite_anim import Anim
from px.timeline import step, tween

ROOT = Path(__file__).parents[1]


class Scene:
    def __init__(self, sid, sents, minlen):
        self.id, self.sents = sid, sents
        self.plan = E.plan(sents)
        self.sstart, t = [], E.LEAD
        for s in sents:
            self.sstart.append(t)
            t += E.sentence_secs(s)
        self.sdur = [E.sentence_secs(s) for s in sents]
        self.length = max(t + E.TAIL, minlen)
        self.sfx = []                                  # (장면 시각, 종류)


@lru_cache(None)
def _bg():
    return E.background()


class Episode:
    """here: 편 폴더(narration.ko.json·scenes.json), ids: 장면 순서, draw: {id: 장면 함수(img, d, t, ta, T)}(나중에 채워도 된다), out: 출력 이름."""

    def __init__(self, here, ids, draw, out):
        self.nar = json.loads((here / "narration.ko.json").read_text())
        self.mins = {s["id"]: s["min"] for s in json.loads((here / "scenes.json").read_text())}
        self.scenes = [Scene(k, self.nar["scenes"][k], self.mins[k]) for k in ids]
        self.starts = [sum(s.length for s in self.scenes[:i]) for i in range(len(self.scenes))]
        self.total = sum(s.length for s in self.scenes)
        self.draw, self.out = draw, out

    def which(self, t):
        i = max(j for j, s in enumerate(self.starts) if s <= t + 1e-9)
        return self.scenes[i], t - self.starts[i]

    def frame(self, i, card=True):
        T, t = self.which(i / E.FPS_OUT)
        ta = step(t)                                    # 애니메이션은 12fps로 끊는다
        img = _bg().copy()
        d = ImageDraw.Draw(img)
        self.draw[T.id](img, d, t, ta, T)
        for card, start, dur in (T.plan if card else ()):
            if start <= t < start + dur or (start <= t and card is T.plan[-1][0]):
                typed = sum(ct <= t for ct in E.char_times(card, start, dur))
                E.draw_card(img, card, typed)
        return img

    def sound(self):
        typed, events = [], []
        for T, off in zip(self.scenes, self.starts):
            self.frame(round((off + T.length / 2) * E.FPS_OUT))      # 장면 함수가 T.sfx를 채운다
            events += [(off + t, k) for t, k in T.sfx]
            for card, start, dur in T.plan:
                chars = [c for ln in card for c in ln]
                typed += [off + ct for ct, c in zip(E.char_times(card, start, dur), chars) if c not in " ,.?!"]
        sfx, kept = audio.place_sfx(events, self.total)
        return audio.bgm(self.total), audio.typing(typed, self.total), sfx, kept, events

    def cover(self):
        """훅 끝 무렵(전부 나온 뒤) 자막 카드 없이 media/<out>_cover.png(1080x1920)와
        _cover_grid.png(가운데 3:4, 1080x1440)로 쓴다. 출력 배치(위 여백 200px)에서 그림이 격자 y 240~1680에 든다."""
        i = round(self.scenes[0].length * E.FPS_OUT) - 1
        out = self.frame(i, card=False)
        assert not E.lint.check_canvas(out, E.PALETTE, ignore=(E.BG, E.DITHER))[0]
        arr = E.to_output(out)
        assert E.lint.check_output(arr, E.SCALE)
        pic = Image.fromarray(arr)
        base_path = ROOT / "media" / self.out
        pic.save(f"{base_path}_cover.png")
        top = (arr.shape[0] - arr.shape[1] * 4 // 3) // 2
        pic.crop((0, top, arr.shape[1], top + arr.shape[1] * 4 // 3)).save(f"{base_path}_cover_grid.png")

    def main(self):
        if "--cover" in sys.argv:
            return self.cover()
        out = ROOT / "media" / f"{self.out}.mp4"
        b, ty, sf, kept, events = self.sound()
        wav = out.with_suffix(".wav")
        audio.write_wav(wav, b + ty + sf)
        iso_max, iso_sum = E.encode(self.frame, round(self.total * E.FPS_OUT), wav, out)
        wav.unlink()
        print(f"lint OK (팔레트 밖 0, 5x5 블록 균일); 고립 1px 점: 프레임당 최대 {iso_max}, 합계 {iso_sum}")
        print("total", round(self.total, 2), "s; frames", round(self.total * E.FPS_OUT))
        for T, off in zip(self.scenes, self.starts):
            print(f"[{T.id}] start {off:.2f} length {T.length:.2f} (min {self.mins[T.id]})")
            for card, start, dur in T.plan:
                print(f"   card {card!r} start {start:.2f}s dur {dur:.2f}s")
        self.cover()
        print("sfx kept", [(round(t, 2), k) for t, k in kept])
        print("sfx dropped", [(round(t, 2), k) for t, k in sorted(events) if (t, k) not in kept])
        for name, x in (("bgm", b), ("typing", ty), ("sfx", sf)):
            print(f"{name}: rms whole {audio.rms_db(x):.1f} dB, active {audio.rms_db(x, True):.1f} dB")


def chip(img, x, y, w, label, active):
    d = ImageDraw.Draw(img)
    d.rectangle((x, y, x + w, y + 17), fill=E.DEEP if active else E.BG, outline=E.INK if active else E.LABEL)
    E.text(img, (x + (w - E.text_w(label, "label")) // 2 + 1, y + 4), label, "label", E.TEXT if active else E.LABEL)


def kicker(img, s, scale=2):
    E.text(img, (10, 10), s, "bold", E.INK, scale)


def mascot_frame(mood, sparks=False):
    """스프라이트에 반짝이를 얹을 여백을 둔 캔버스(좌우·위 8px, 발밑은 바닥). 발밑 가운데가 기본 앵커."""
    sp = sprite(mood)
    c = Image.new("RGBA", (sp.width + 16, sp.height + 8), (0, 0, 0, 0))
    c.paste(sp, (8, 8), sp)
    if sparks:
        sparkles(c, 9, 9)
    return c


HOP = [(0, 0), (0, -4), (0, -6), (0, -4), (0, 0), (0, -2), (0, 0)]       # 통통(12fps 7칸)
HOOK_MASCOT = Anim([mascot_frame("surprised")] * 6 + [mascot_frame("sparkle", True)] * 6 + [mascot_frame("base")],
                   durs=[1 / 12] * 12 + [1e9], mode="once", offsets=HOP + [(0, 0)] * 6)   # 놀람 → 반짝 → 기본

SPARKLE_MASCOT = Anim([mascot_frame("sparkle"), mascot_frame("sparkle", True)] * 50, mode="once",
                      offsets=HOP + [(0, 0)] * 93)                        # 통통 뒤 12fps 반짝 깜빡

T_BIG, T_SPRITE = 0.3, 2.4                       # hook: 큰 제목이 뜨는 때, 마스코트가 튀어나오는 때


def hook(img, d, t, ta, T, title, words, art, extra_sfx=()):
    """title: narration의 hook 항목({title, sub}), words: 큰 영문 제목 낱말들(2배, 0.3초 간격 차례로, 28px 줄간격),
    art(img, d, t, ta): 마지막 낱말 0.3초 뒤부터 왼쪽 그림 자리에 그린다. extra_sfx: 편이 더하는 효과음."""
    T.sfx = [(T_BIG, "pop"), (T_SPRITE, "sparkle"), *extra_sfx]
    l1, l2 = E.split_lines(title["title"])
    E.center_text(img, 14, l1)
    E.center_text(img, 29, l2, "bold")
    E.center_text(img, 47, title["sub"], "label", E.LABEL)
    for i, w in enumerate(words):
        if t >= T_BIG + 0.3 * i:
            E.center_text(img, 68 + 28 * i, w, "bold", E.INK, 2)
    if t >= T_BIG + 0.3 * len(words):
        art(img, d, t, ta)
    if t >= T_SPRITE:
        HOOK_MASCOT.paste(img, t - T_SPRITE, (131, 193))


def compare(img, d, t, ta, rows, t1, t0=0.3):
    """위·아래로 쌓은 카드 두 장(이름 bold 왼쪽 위). rows: [(이름, 테두리색, art(img, d, t, ta, y0))], 첫 카드는 t0, 둘째는 t1에 뜬다."""
    for (name, col, art), y, t_on in zip(rows, (44, 150), (t0, t1)):
        if t >= t_on:
            d.rectangle((14, y, 166, y + 70), fill=E.CARD, outline=col)
            E.text(img, (22, y + 6), name, "bold")
            art(img, d, t, ta, y)


def steps(img, labels, cur):
    """아래쪽 chip 세 개 줄. cur번째만 활성(-1이면 전부 비활성)."""
    for i, lab in enumerate(labels):
        chip(img, 10 + i * 54, 224, 50, lab, i == cur)


FLOW_DOT, FLOW_PERIOD, FLOW_STEP = 2, 5, 2      # 흐름 점선: 2px 점, 3px 간격, 12fps마다 2px 전진


@lru_cache(None)
def _lattice(pts):
    """꺾인 선(수평·수직·45°만) → 1px 걸음마다의 도트 목록."""
    out = [pts[0]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        if dx and dy and abs(dx) != abs(dy):
            raise ValueError(f"깔끔한 기울기가 아니다: {(x0, y0)}->{(x1, y1)}")
        sx, sy = (dx > 0) - (dx < 0), (dy > 0) - (dy < 0)
        out += [(x0 + sx * i, y0 + sy * i) for i in range(1, max(abs(dx), abs(dy)) + 1)]
    return tuple(out)


def flow(d, ta, pts, color, u=1.0, thick=False, phase=None):
    """행진하는 점선 흐름. pts: 꺾인 선(마지막 구간은 수평·수직), u: 앞으로 뻗은 진행도 0~1(1이면 끝에 도트 화살촉),
    thick: 점을 3px로 굵게(강조). ta는 12fps로 끊은 시각.
    phase: 점선이 지금까지 전진한 px(기본은 프레임당 FLOW_STEP로 일정; 속도가 변하는 장면이 누적값을 넘긴다)."""
    path = _lattice(tuple(map(tuple, pts)))
    n = round(u * (len(path) - 1)) + 1
    k = 3 if thick else FLOW_DOT
    phase = round(ta * 12) * FLOW_STEP if phase is None else phase
    for i in range(n):
        if (i - phase) % FLOW_PERIOD == 0:
            x, y = path[i]
            d.rectangle((x, y, x + k - 1, y + k - 1), fill=color)
    if u >= 1:
        head(d, *path[-1], path[-1][0] - path[-2][0], path[-1][1] - path[-2][1], color)


def head(d, x, y, ax, ay, color):
    """도트 화살촉: 끝점 (x, y), 방향 (ax, ay)(수평·수직 단위). 깊이 3 × 폭 5·3·1."""
    for a in range(-2, 1):
        for b in range(a, 1 - a):
            d.point((x + ax * a - ay * b, y + ay * a + ax * b), fill=color)


POINT_MASCOT = Anim([mascot_frame("pointing")], mode="once", flip=True)       # 거울상: 눈동자가 왼쪽


def pointer(img, t, t_in, t_out, x, y, x_out=190):
    """가리키기 마스코트: t_in에 오른쪽(x_out)에서 0.34초 들어와 x에 멈추고, t_out에 0.4초 동안 다시 나간다."""
    if t_in <= t < t_out + 0.4:
        px = tween(step(t), t_in, t_in + 0.34, x_out, x, rnd=True) if t < t_out else tween(step(t), t_out, t_out + 0.4, x, x_out, rnd=True)
        POINT_MASCOT.paste(img, 0, (px, y))
