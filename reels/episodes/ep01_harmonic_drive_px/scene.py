"""1편 도트판 전체(hook~ratio). 실행: reels/.venv/bin/python episodes/ep01_harmonic_drive_px/scene.py"""
import json
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
from px import audio, draw as D, engine as E  # noqa: E402
from px.sprite import sprite, sparkles  # noqa: E402
from px.sprite_anim import Anim  # noqa: E402
from px.timeline import at, span, step, tween  # noqa: E402
import mech as M  # noqa: E402

nar = json.loads((HERE / "narration.ko.json").read_text())
mins = {s["id"]: s["min"] for s in json.loads((HERE / "scenes.json").read_text())}


class Scene:
    def __init__(self, sid):
        self.id, self.sents = sid, nar["scenes"][sid]
        self.plan = E.plan(self.sents)
        self.sstart, t = [], E.LEAD
        for s in self.sents:
            self.sstart.append(t)
            t += E.sentence_secs(s)
        self.sdur = [E.sentence_secs(s) for s in self.sents]
        self.length = max(t + E.TAIL, mins[sid])
        self.sfx = []                                  # (장면 시각, 종류)


SCENES = [Scene(k) for k in ("hook", "motor", "stack", "parts", "turn", "ratio")]
STARTS = [sum(s.length for s in SCENES[:i]) for i in range(len(SCENES))]
TOTAL = sum(s.length for s in SCENES)


@lru_cache(None)
def _bg():
    return E.background()


def chip(img, x, y, w, label, active):
    d = ImageDraw.Draw(img)
    d.rectangle((x, y, x + w, y + 17), fill=E.DEEP if active else E.BG, outline=E.INK if active else E.LABEL)
    E.text(img, (x + (w - E.text_w(label, "label")) // 2 + 1, y + 4), label, "label", E.TEXT if active else E.LABEL)


def kicker(img, s):
    E.text(img, (10, 10), s, "bold", E.INK, 2)


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
RATIO_MASCOT = Anim([mascot_frame("sparkle"), mascot_frame("sparkle", True)] * 50, mode="once",
                    offsets=HOP + [(0, 0)] * 93)                          # 통통 뒤 12fps 반짝 깜빡
PARTS_MASCOT = Anim([mascot_frame("pointing")], mode="once", flip=True)    # 거울상: 눈동자가 기구 쪽


# ---------------- hook (확정) ----------------
T_BIG, T_SPRITE = 0.3, 2.4                       # 큰 제목이 뜨는 때, 마스코트가 튀어나오는 때
SCENES[0].sfx = [(T_BIG, "pop"), (T_SPRITE, "sparkle")]


def hook(img, d, t, ta, T):
    # 위쪽 제목(한국어): 쉼표에서 두 줄
    l1, l2 = E.split_lines(nar["hook"]["title"])
    E.center_text(img, 14, l1)
    E.center_text(img, 29, l2, "bold")
    E.center_text(img, 47, nar["hook"]["sub"], "label", E.LABEL)
    # 큰 영문 제목(2배): 두 단어가 차례로
    if t >= T_BIG:
        E.center_text(img, 68, "HARMONIC", "bold", E.INK, 2)
    if t >= T_BIG + 0.3:
        E.center_text(img, 96, "DRIVE", "bold", E.INK, 2)
    # 관절: 위팔·아래팔 + 둥근 하우징(바깥 원·보라 링·축). 하모닉 드라이브가 들어갈 자리
    if t >= T_BIG + 0.6:
        for box in ((16, 130, 36, 200), (26, 190, 102, 210)):
            d.rounded_rectangle((box[0] + 1, box[1] + 1, box[2] + 1, box[3] + 1), 5, fill=E.SHADOW)
            d.rounded_rectangle(box, 5, fill=E.DEEP, outline=E.OUTLINE)
            d.line((box[0] + 3, box[1] + 1, box[0] + 3, box[3] - 3), fill=E.INK)
        cx, cy = 26, 200
        d.ellipse((cx - 19, cy - 19, cx + 20, cy + 20), fill=E.OUTLINE)
        d.ellipse((cx - 18, cy - 18, cx + 19, cy + 19), fill=E.DEEP)
        d.ellipse((cx - 17, cy - 17, cx + 18, cy + 18), outline=E.INK, width=2)
        r = 10 + int(ta * E.FPS_ANIM) % 2
        d.ellipse((cx - r, cy - r, cx + r + 1, cy + r + 1), outline=E.PURPLE, width=2)
        d.rectangle((cx - 1, cy - 1, cx + 1, cy + 1), fill=E.TEXT)
    # 마스코트
    if t >= T_SPRITE:
        HOOK_MASCOT.paste(img, t - T_SPRITE, (131, 193))


# ---------------- motor ----------------
def bars(img, d, x, y, speed, torque, k):
    for i, (name, v, col) in enumerate((("SPEED", speed, E.INK), ("TORQUE", torque, E.PURPLE))):
        yy = y + 22 + i * 22
        E.text(img, (x, yy), name, "label", E.LABEL)
        d.rectangle((x, yy + 12, x + 130, yy + 19), outline=E.LABEL)
        w = int(130 * v * k)
        if w:
            d.rectangle((x + 1, yy + 13, x + w, yy + 18), fill=col)


def motor(img, d, t, ta, T):
    kicker(img, "TRADE-OFF")
    s1 = at(T, 1)
    for i, (name, sp, tq, y, t0, col) in enumerate((("MOTOR", .95, .2, 44, 0.3, E.LABEL),
                                                  ("JOINT", .2, .95, 150, s1 + 0.5, E.INK))):
        if t < t0:
            continue
        d.rectangle((14, y, 166, y + 70), fill=E.CARD, outline=col)
        E.text(img, (22, y + 6), name, "bold")
        bars(img, d, 22, y + 2, sp, tq, span(t, t0, t0 + 0.6))
    if t >= s1:                                       # 기어 화살표
        d.polygon([(84, 118), (96, 118), (96, 130), (102, 130), (90, 144), (78, 130), (84, 130)], fill=E.INK)
        E.text(img, (108, 126), "GEARS", "label", E.LABEL)
    T.sfx = [(0.3, "pop"), (s1 + 0.5, "pop")]


# ---------------- stack ----------------
def stack(img, d, t, ta, T):
    kicker(img, "100 : 1")
    times = [at(T, 0, f) for f in (0.1, 0.4, 0.7)]
    pin, big, dd = 0.3, 0.72, 0.3 + 0.72 + 0.02
    stages = [((-1.7 + i * dd, 2.9 - i * 1.5), (-1.7 + i * dd + dd, 2.9 - i * 1.5)) for i in range(3)]
    px = lambda x: 90 + 30 * (x + 0.07)
    py = lambda y: 135 - 30 * (y - 1.47)
    cur = -1
    for i, (p, b) in enumerate(stages):
        if t < times[i]:
            continue
        cur = i
        if i:                                         # 다음 단 작은 기어는 앞 단 큰 기어 바로 아래 축에 달린다
            D.line(d, (px(p[0]), py(p[1] + 1.5)), (px(p[0]), py(p[1])), E.LABEL, width=2)
        for (gx, gy), r, n, ang in ((p, pin, 6, ta * 1.5), (b, big, 15, -ta * 1.5 * pin / big + 0.2)):
            D.gear(d, px(gx), py(gy), r * 30, n, angle=ang, tooth=0.14 * 30, fill=E.DEEP, outline=E.INK)
            D.circle(d, round(px(gx)), round(py(gy)), max(round(r * 30 * .25), 2), fill=E.INK)
    for i, lab in enumerate(("1 STAGE", "2 STAGES", "3 STAGES")):
        chip(img, 10 + i * 54, 224, 50, lab, i == cur)
    if t >= at(T, 0, 0.88):
        E.text(img, (118, 80), "BIG +", "bold", E.DANGER)
        E.text(img, (118, 94), "HEAVY", "bold", E.DANGER)
    T.sfx = [(times[0], "pop"), (at(T, 0, 0.88), "pop")]


# ---------------- parts ----------------
PU, PC = 14, (78, 126)
LEGEND = (("WAVE GENERATOR", E.PURPLE), (f"FLEXSPLINE  {M.FLEX_TEETH} TEETH", E.INK),
          (f"CIRCULAR SPLINE  {M.RING_TEETH} TEETH", E.LABEL))


def parts(img, d, t, ta, T):
    s1, s2 = at(T, 1), at(T, 2)
    reveal = {"cam": s1, "flex": at(T, 1, 0.22), "ring": at(T, 1, 0.66)}
    shown = {k for k, v in reveal.items() if t >= v}
    if 0.3 <= t < s1 - 0.2:
        E.center_text(img, 110, "3 PARTS", "bold", E.INK, 2)
    M.draw_mech(img, PC[0], PC[1], PU, 0.0, shown)
    if t >= s1 - 0.2:
        kicker(img, f"{M.RING_TEETH} - {M.FLEX_TEETH} = {M.TOOTH_DIFF}" if t >= s2 else "3 PARTS")
    for i, (name, col) in enumerate(LEGEND):
        if t >= list(reveal.values())[i]:
            hl = s2 <= t < s2 + 0.8 and i > 0
            d.rectangle((10, 207 + i * 12, 15, 212 + i * 12), fill=col)
            E.text(img, (20, 205 + i * 12), name, "label", E.TEXT if hl else col)
    # 마스코트: 캠을 켤 때 들어와 가리키고, 링을 켠 뒤 퇴장
    out0 = reveal["ring"] + 1.0
    if reveal["cam"] <= t < out0 + 0.4:
        x = (tween(step(t), reveal["cam"], reveal["cam"] + 0.34, 190, 134, rnd=True) if t < out0
             else tween(step(t), out0, out0 + 0.4, 134, 190, rnd=True))
        PARTS_MASCOT.paste(img, 0, (x + 20, 192))
    T.sfx = [(0.3, "pop"), (reveal["cam"], "sparkle"), (s2, "pop")]


# ---------------- turn ----------------
TU, TC = 17, (90, 132)
T_CAM0 = 0.5
CAM_STEPS = round((SCENES[4].length - 1.0 - T_CAM0) * E.FPS_ANIM)        # 캠 한 바퀴 = 12fps CAM_STEPS칸
T_CAM1 = T_CAM0 + CAM_STEPS / E.FPS_ANIM                                  # 360°에 닿는 시각
TURN_CAM = M.turn_anim(TC[0], TC[1], TU, CAM_STEPS)


def turn(img, d, t, ta, T):
    kicker(img, "ONE TURN")
    TURN_CAM.paste(img, t - T_CAM0, TC)
    M.ref_mark(d, TC[0], TC[1], TU)
    chip(img, 10, 210, 78, "CAM 1 TURN", True)
    chip(img, 92, 210, 78, "CUP 2 TEETH", t >= at(T, 1))
    if t >= T_CAM1:
        x, y = M.travel_arc(d, TC[0], TC[1], TU)
        E.text(img, (int(x) - E.text_w("2 TEETH", "label") // 2, int(y) - 5), "2 TEETH", "label", E.TEXT)
    T.sfx = [(0.3, "pop"), (T_CAM1, "pop")]


# ---------------- ratio ----------------
def ratio(img, d, t, ta, T):
    kicker(img, "ONE STAGE")
    s1 = at(T, 1)
    cards = (("TEETH", str(M.REAL_FLEX_TEETH), 0.3, E.TEXT), ("SHIFT", str(M.TOOTH_DIFF), at(T, 0, 0.36), E.TEXT),
             ("RATIO", str(M.REAL_RATIO), at(T, 0, 0.73), E.INK))
    for i, (lab, num, t0, col) in enumerate(cards):
        if t < t0:
            continue
        cx = 30 + i * 60
        if i == 2:
            d.rectangle((cx - 26, 62, cx + 26, 126), fill=E.CARD, outline=E.INK)
        E.text(img, (cx - E.text_w(lab, "label") // 2 + 1, 68), lab, "label", E.LABEL)
        E.text(img, (cx - E.text_w(num, "bold", 2) // 2 + 1, 92), num, "bold", col, 2)
        if i:                                         # 연산자: 글자 대신 도트 도형
            ox, oy = cx - (18 if i == 1 else 38), 104
            if i == 1:
                d.rectangle((ox - 4, oy, ox + 4, oy + 1), fill=E.LABEL)
                d.rectangle((ox - 1, oy - 5, ox, oy - 4), fill=E.LABEL); d.rectangle((ox - 1, oy + 6, ox, oy + 7), fill=E.LABEL)
            else:
                d.rectangle((ox - 4, oy - 2, ox + 4, oy - 1), fill=E.LABEL); d.rectangle((ox - 4, oy + 3, ox + 4, oy + 4), fill=E.LABEL)
    if t >= s1:
        RATIO_MASCOT.paste(img, t - s1, (89, 202))
    T.sfx = [(0.3, "pop"), (s1, "sparkle")]


DRAW = {"hook": hook, "motor": motor, "stack": stack, "parts": parts, "turn": turn, "ratio": ratio}


def which(t):
    i = max(j for j, s in enumerate(STARTS) if s <= t + 1e-9)
    return SCENES[i], t - STARTS[i]


def frame(i):
    T, t = which(i / E.FPS_OUT)
    ta = step(t)                                    # 애니메이션은 12fps로 끊는다
    img = _bg().copy()
    d = ImageDraw.Draw(img)
    DRAW[T.id](img, d, t, ta, T)
    for card, start, dur in T.plan:
        if start <= t < start + dur or (start <= t and card is T.plan[-1][0]):
            typed = sum(ct <= t for ct in E.char_times(card, start, dur))
            E.draw_card(img, card, typed)
    return img


def sound():
    typed, events = [], []
    for T, off in zip(SCENES, STARTS):
        frame(round((off + T.length / 2) * E.FPS_OUT))      # 장면 함수가 T.sfx를 채운다
        events += [(off + t, k) for t, k in T.sfx]
        for card, start, dur in T.plan:
            chars = [c for ln in card for c in ln]
            typed += [off + ct for ct, c in zip(E.char_times(card, start, dur), chars) if c not in " ,.?!"]
    sfx, kept = audio.place_sfx(events, TOTAL)
    return audio.bgm(TOTAL), audio.typing(typed, TOTAL), sfx, kept, events


if __name__ == "__main__":
    out = ROOT / "media" / "ep01_px_preview.mp4"
    b, ty, sf, kept, events = sound()
    wav = ROOT / "media" / "ep01_px_preview.wav"
    audio.write_wav(wav, b + ty + sf)
    iso_max, iso_sum = E.encode(frame, round(TOTAL * E.FPS_OUT), wav, out)
    wav.unlink()
    print(f"lint OK (팔레트 밖 0, 6x6 블록 균일); 고립 1px 점: 프레임당 최대 {iso_max}, 합계 {iso_sum}")
    print("total", round(TOTAL, 2), "s; frames", round(TOTAL * E.FPS_OUT))
    for T, off in zip(SCENES, STARTS):
        print(f"[{T.id}] start {off:.2f} length {T.length:.2f} (min {mins[T.id]})")
        for card, start, dur in T.plan:
            print(f"   card {card!r} start {start:.2f}s dur {dur:.2f}s")
    print("sfx kept", [(round(t, 2), k) for t, k in kept])
    print("sfx dropped", [(round(t, 2), k) for t, k in sorted(events) if (t, k) not in kept])
    for name, x in (("bgm", b), ("typing", ty), ("sfx", sf)):
        print(f"{name}: rms whole {audio.rms_db(x):.1f} dB, active {audio.rms_db(x, True):.1f} dB")
