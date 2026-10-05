"""도트 트랙 공통 부품: 장면 실행기(Episode), chip·kicker·마스코트, hook 배치. 편마다 다른 것은 인자로 받는다."""
import json
import math
import re
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


END_LEN, T_STAMP = 4.2, 2.3                         # 엔딩 도장 장면 길이, 도장이 찍히는 장면 시각
T_JINGLE, T_TYPED, T_LABEL = 1.55, 1.4, 1.5          # 완성 징글 / 세 줄 타이핑이 끝나는 / 영문 라벨이 뜨는 장면 시각
STAMP_BOX = (98, 214, 62, 34)                        # 도장 x, y, 폭, 높이


class Episode:
    """here: 편 폴더(narration.ko.json·scenes.json), ids: 장면 순서, draw: {id: 장면 함수(img, d, t, ta, T)}(나중에 채워도 된다), out: 출력 이름.
    narration.ko.json의 선택 필드 principle(1~3줄)이 있으면 마지막 장면 뒤에 엔딩 도장 장면을 자동으로 붙인다(principle_label 선택)."""

    def __init__(self, here, ids, draw, out):
        self.nar = json.loads((here / "narration.ko.json").read_text())
        self.mins = {s["id"]: s["min"] for s in json.loads((here / "scenes.json").read_text())}
        self.scenes = [Scene(k, self.nar["scenes"][k], self.mins[k]) for k in ids]
        self.draw, self.out = draw, out
        self.ending = None
        if "principle" in self.nar:
            self.ending = Scene("_ending", [], END_LEN)
            self.mins["_ending"] = END_LEN
            self.scenes.append(self.ending)
            self._check_principle()
        self.starts = [sum(s.length for s in self.scenes[:i]) for i in range(len(self.scenes))]
        self.total = sum(s.length for s in self.scenes)
        self._plan, self._probing = None, False

    def _check_principle(self):
        lines = self.nar["principle"]
        assert 1 <= len(lines) <= 3 and all(isinstance(x, str) and x for x in lines), "principle은 비지 않은 1~3줄"
        for x in lines:
            assert E.text_w(x, "bold", 2) <= E.W, f"principle 줄이 캔버스 폭({E.W}px)을 넘는다: {x!r} ({E.text_w(x, 'bold', 2)}px)"
        label = self.nar.get("principle_label")
        assert label is None or E.text_w(label, "label") <= E.W, f"principle_label이 캔버스 폭을 넘는다: {label!r}"
        assert re.match(r"ep(\d+)_", self.out), f"출력 이름에서 편 번호를 못 읽는다: {self.out}"

    def which(self, t):
        i = max(j for j, s in enumerate(self.starts) if s <= t + 1e-9)
        return self.scenes[i], t - self.starts[i]

    def frame(self, i, card=True):
        T, t = self.which(i / E.FPS_OUT)
        ta = step(t)                                    # 애니메이션은 12fps로 끊는다
        img = _bg().copy()
        d = ImageDraw.Draw(img)
        MASCOT_POS.clear()
        (self._ending_scene if T is self.ending else self.draw[T.id])(img, d, t, ta, T)
        if not self._probing:
            self._react_sparkle(img, i / E.FPS_OUT)
        for card, start, dur in (T.plan if card else ()):
            if start <= t < start + dur or (start <= t and card is T.plan[-1][0]):
                cts = E.char_times(card, start, dur)
                typed = sum(ct <= t for ct in cts)
                scale, cursor = 1.0, True
                if typed >= len(cts):                             # 다 찍힌 뒤: 0.5초 켜짐 / 0.5초 꺼짐
                    cursor = int((t - cts[-1]) * 2 + 1e-9) % 2 == 0
                if T is self.scenes[0] and card is T.plan[0][0]:   # 영상 전체의 첫 카드만: 상자가 먼저 튀어나오고, 글자·커서는 그 뒤부터
                    k = int((t - start) * E.FPS_OUT + 1e-9)
                    if k < len(E.CARD_POP):
                        scale, typed, cursor = E.CARD_POP[k], 0, False
                E.draw_card(img, card, typed, scale, cursor)
        return img

    def compose(self, i):
        """i번째 출력 프레임 → (lint할 원본 캔버스 목록, 출력 배열 1080x1920). 엔딩 도장 순간은 출력 전체를 흔들어야 해서
        캔버스가 아니라 출력 배열 단계에서 만든다."""
        T, t = self.which(i / E.FPS_OUT)
        new = self.frame(i)
        arr = E.to_output(new)
        arr = self._react_danger(arr, i)
        if T is self.ending and T_STAMP - 1e-9 <= t < T_STAMP + 2 / E.FPS_OUT - 1e-9:
            arr = np.roll(arr, (E.SCALE, E.SCALE), axis=(0, 1))     # 도장 순간 2프레임 흔들림: 출력 전체를 한 도트(5px) 이동
        return [new], arr

    # ---- 효과음에 맞춘 화면 반응(sfx_react): place_sfx가 실제로 남긴 소리만 ----
    def _sfx_plan(self):
        """(효과음 합성 배열, 남은 소리 [(절대 시각, 종류)], 전체 이벤트). 장면 함수가 T.sfx를 채우도록 장면 가운데를 한 번씩 그린다."""
        if self._plan is None:
            self._probing, events = True, []
            for T, off in zip(self.scenes, self.starts):
                self.frame(round((off + T.length / 2) * E.FPS_OUT))
                events += [(off + t, k) for t, k in T.sfx]
            self._probing = False
            self._plan = (*audio.place_sfx(events, self.total), events)
        return self._plan

    def _react_danger(self, arr, i):
        """danger 소리 시각부터 2프레임, 출력 전체를 5px 좌우로 흔든다((5,0) → (-5,0))."""
        for t, kind in self._sfx_plan()[1]:
            k = i - math.ceil(t * E.FPS_OUT - 1e-9)
            if kind == "danger" and k in (0, 1):
                return np.roll(arr, E.SCALE * (1, -1)[k], axis=1)
        return arr

    def _react_sparkle(self, img, t_abs):
        """sparkle 소리 시각부터 0.5초, 그 프레임에 붙인 마스코트 둘레에 십자 반짝이 4개를 12fps로 깜빡인다(마스코트가 없으면 없음)."""
        if not MASCOT_POS:
            return
        for t, kind in self._sfx_plan()[1]:
            if kind == "sparkle" and 0 <= t_abs - t + 1e-9 < 0.5 and int((t_abs - t + 1e-9) * E.FPS_ANIM) % 2 == 0:
                d = ImageDraw.Draw(img)
                x, y = MASCOT_POS[0]
                for dx, dy in ((-27, -44), (27, -38), (-29, -12), (25, -6)):
                    sx, sy = min(max(x + dx, 3), E.W - 4), min(max(y + dy, 3), E.H - 4)
                    d.point([(sx, sy - 1), (sx - 1, sy), (sx, sy), (sx + 1, sy), (sx, sy + 1)], fill=E.TEXT)

    def _ending_scene(self, img, d, t, ta, T):
        """엔딩 도장 장면: "오늘의 원리" → 원리 줄 타이핑 → 영문 라벨 → 도장 + 먼지 + 시온 점프·반짝."""
        T.sfx = [(T_JINGLE, "jingle"), (T_STAMP, "stamp")]
        lines = self.nar["principle"]
        E.center_text(img, 52, "오늘의 원리", "label", E.LABEL)
        shown, y = int(min(1, t / T_TYPED) * sum(map(len, lines))), 72
        for k, line in enumerate(lines):
            part, shown = line[:max(0, shown)], shown - len(line)
            if part:
                E.text(img, ((E.W - E.text_w(line, "bold", 2)) // 2, y), part, "bold", E.INK if k == len(lines) - 1 else E.TEXT, scale=2)
            y += 32
        if t >= T_LABEL and self.nar.get("principle_label"):
            E.center_text(img, 176, self.nar["principle_label"], "label", E.LABEL)
        if t < T_STAMP:
            return
        sx, sy, sw, sh = STAMP_BOX
        g = 3 if t < T_STAMP + 2 / E.FPS_OUT else 0       # 찍히는 순간 3도트 크게
        for inset in (0, 2):                              # 이중 테두리, 안은 비운다
            d.rectangle((sx - g + inset, sy - g + inset, sx + sw + g - inset, sy + sh + g - inset), outline=E.DANGER)
        num = re.match(r"ep(\d+)_", self.out).group(1)
        E.text(img, (sx + 11, sy + 6), "원리노트", "label", E.DANGER, shadow=False)
        E.text(img, (sx + 21, sy + 19), f"#{num}", "bold", E.DANGER, shadow=False)
        if t < T_STAMP + 6 / E.FPS_OUT:                   # 먼지
            for dx, dy in ((-7, 6), (sw + 6, 10), (-5, 40), (sw + 8, 44), (40, -7), (70, sh + 6), (20, sh + 7)):
                d.point((sx + dx, sy + dy), fill=E.LABEL)
        sp = sprite("sparkle" if t >= T_STAMP + 0.3 else "base")
        k = int((t - T_STAMP) * 12) if t < T_STAMP + 0.6 else 6
        (sx_, sy_), dy = HOP[min(6, k)]                   # 점프: 발밑 가운데 (50, 267)를 기준으로 찌그러졌다 펴진다
        sp = squashed(sp, sx_, sy_)
        img.paste(sp, (50 - sp.width // 2, 267 + dy - sp.height), sp)

    def sound(self):
        typed = []
        for T, off in zip(self.scenes, self.starts):
            for card, start, dur in T.plan:
                chars = [c for ln in card for c in ln]
                typed += [off + ct for ct, c in zip(E.char_times(card, start, dur), chars) if c not in " ,.?!"]
        bgm = audio.bgm(self.total)
        if self.ending:                                  # 엔딩 도장 장면: 세 줄 타이핑 소리, BGM 1 → 0.35 선형
            off, chars = self.starts[-1], "".join(self.nar["principle"])
            typed += [off + (k + 1) * T_TYPED / len(chars) for k, c in enumerate(chars) if c != " "]
            i0 = int(off * audio.SR)
            bgm[i0:] *= np.linspace(1, 0.35, len(bgm) - i0)
        sfx, kept, events = self._sfx_plan()
        return bgm, audio.typing(typed, self.total), sfx, kept, events

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
        if "--out" in sys.argv:                          # --out 이름: 게시된 결과물을 덮지 않고 다른 이름으로 렌더(커버도 같은 이름)
            self.out = sys.argv[sys.argv.index("--out") + 1]
        if "--cover" in sys.argv:
            return self.cover()
        out = ROOT / "media" / f"{self.out}.mp4"
        b, ty, sf, kept, events = self.sound()
        wav = out.with_suffix(".wav")
        audio.write_wav(wav, b + ty + sf)
        iso_max, iso_sum = E.encode(self.compose, round(self.total * E.FPS_OUT), wav, out)
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


# squash/stretch: 뜀 7칸 ((가로배, 세로배), dy) = 웅크림·뜀·꼭대기·내려옴·착지·되돌아옴·제자리, 나타나기(pop) 6칸(가로·세로배)
HOP = [((1.18, .82), 0), ((.88, 1.14), -4), ((1, 1), -7), ((.92, 1.08), -4), ((1.22, .78), 0), ((.95, 1.05), 0), ((1, 1), 0)]
POP = [(.3, .3), (.7, .7), (1.15, 1.15), (1.1, .9), (.96, 1.04), (1, 1)]
MASCOT_POS = []                                  # 이 프레임에 마지막으로 붙인 마스코트의 발밑 가운데(sparkle 반응이 읽는다)


def squashed(img, sx, sy):
    """RGBA 스프라이트를 최근접으로 가로 sx·세로 sy배(도트 단위, 새 색 없음)."""
    return img.resize((max(1, round(img.width * sx)), max(1, round(img.height * sy))), Image.NEAREST)


def _blinking(clock):
    """눈 깜빡임 시각표: 2.5~4초 간격(간격은 번호의 해시라 결정론적), 한 번에 12fps 1칸."""
    step, b, k = int(clock * E.FPS_ANIM + 1e-9), 0.0, 0
    while True:
        b += 2.5 + 1.5 * (((k + 1) * 2654435761 & 0xFFFFFFFF) / 2 ** 32)
        if int(b * E.FPS_ANIM) >= step:
            return int(b * E.FPS_ANIM) == step
        k += 1


class MascotAnim(Anim):
    """시온 등장·표정 재생기. spec: [(표정, 반짝이 여부)] 프레임 목록(12fps, durs로 바꿈). hop: 앞 7칸을 뜀 동작으로, pop: 맨 앞에 나타나기 6칸을 붙인다(등장 애니메이션만; 밀고 들어오는 pointer는 pop=False).
    base·pointing 표정은 가끔 눈을 감는다. paste는 마스코트 위치를 MASCOT_POS에 남긴다."""

    def __init__(self, spec, durs=None, mode="loop", flip=False, hop=True, pop=True):
        moods = [m for m, _ in spec]
        frames = [mascot_frame(m, sp) for m, sp in spec]
        durs = list(durs or [1 / E.FPS_ANIM] * len(spec))
        scales, offsets = [(1, 1)] * len(spec), [(0, 0)] * len(spec)
        if hop:
            for k, (sc, dy) in enumerate(HOP):
                scales[k], offsets[k] = sc, (0, dy)
        if pop:
            frames, moods, durs = [frames[0]] * len(POP) + frames, [moods[0]] * len(POP) + moods, [1 / E.FPS_ANIM] * len(POP) + durs
            scales, offsets = list(POP) + scales, [(0, 0)] * len(POP) + offsets
        alts = [mascot_frame("blink") if m in ("base", "pointing") else None for m in moods]
        super().__init__(frames, durs=durs, mode=mode, flip=flip, offsets=offsets, scales=scales, alts=alts)
        self.moods = moods

    def paste(self, canvas, t, at=(0, 0), clock=None):
        """clock: 눈 깜빡임 시각표에 쓸 시각(기본은 t; t를 0에 고정해 쓰는 pointer는 장면 시각을 넘긴다)."""
        alt = self.alts[self.index_at(t)] is not None and _blinking(t if clock is None else clock)
        f, pos = self.frame_at(t, at, alt)
        canvas.paste(f, pos, f)
        MASCOT_POS[:] = [at]


HOOK_MASCOT = MascotAnim([("surprised", False)] * 6 + [("sparkle", True)] * 6 + [("base", False)],
                         durs=[1 / 12] * 12 + [1e9], mode="once")                 # 놀람 → 반짝 → 기본

SPARKLE_MASCOT = MascotAnim([("sparkle", False), ("sparkle", True)] * 50, mode="once")   # 통통 뒤 12fps 반짝 깜빡

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


POINT_MASCOT = MascotAnim([("pointing", False)], mode="once", flip=True, hop=False, pop=False)       # 거울상: 눈동자가 왼쪽


def pointer(img, t, t_in, t_out, x, y, x_out=190):
    """가리키기 마스코트: t_in에 오른쪽(x_out)에서 0.34초 들어와 x에 멈추고, t_out에 0.4초 동안 다시 나간다."""
    if t_in <= t < t_out + 0.4:
        px = tween(step(t), t_in, t_in + 0.34, x_out, x, rnd=True) if t < t_out else tween(step(t), t_out, t_out + 0.4, x, x_out, rnd=True)
        POINT_MASCOT.paste(img, 0, (px, y), clock=t)
