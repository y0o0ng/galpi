"""도트 엔진: 1비트 그리기, 안전 영역 여백을 붙인 최근접 확대 + 주사선, mp4 인코딩.
형식 1(기본, 옛 영상): 180x320 캔버스 5배 + 하단 자막 카드. 형식 2(애니메이션 중심): 225x400 캔버스 4배, 자막 카드 없음, 글자는 say 하나로만.
use_format(2)가 모듈 전역 W·H·SCALE·SAFE_OFFSET 등을 바꾼다(한 프로세스는 편 하나를 렌더한다) — Episode가 narration의 format_version을 보고 부른다."""
import math
import subprocess
from contextlib import contextmanager
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from px import draw, lint

D = Path(__file__).parent
FORMAT = 1
W, H, FPS_OUT, FPS_ANIM = 180, 320, 24, 12
# 출력 배치: 인스타·쇼츠 UI가 위 ~240px, 아래 ~210px(1710~), 오른쪽 x>=920, 양옆 ~50px을 가린다(1편 스크린샷 실측).
# 형식 1: 장면 캔버스(180x320)를 확장 캔버스(216x384) 안 SAFE_OFFSET에 붙여 5배 확대한다(1080x1920).
# 형식 2: 장면 캔버스(225x400)를 확장 캔버스(270x480) 안 (15, 50)에 붙여 4배 확대한다 — 물리 위치(60~960, 200~1800)는 같다.
SCALE = 5
SAFE_OFFSET = (12, 40)
EXT_W, EXT_H = 1080 // SCALE, 1920 // SCALE
OUT_W, OUT_H = EXT_W * SCALE, EXT_H * SCALE
DITHER_FROM = 160                  # 배경 디더가 시작하는 장면 y (캔버스 높이의 절반)
READ_CPS = 5                       # 카드 시간 = 글자 수(공백 제외) / READ_CPS (글자당 0.2초)
MID_HOLD = 0.5                     # 문장 중간 카드의 멈춤 비율
MIN_CARD = 1.5                     # 카드 한 장의 최소 시간(초) — 짧은 조각이 깜빡 지나가지 않게
TYPE_CPS = 14                      # 카드 타자 속도(글자/초); 카드 시간의 75%를 넘지 않게 압축
PUNCT_PAUSE = 0.15                 # 문장 부호 뒤 쉼(초)
LEAD, TAIL = 0.4, 0.5              # 장면 앞·뒤 여백(초)
SCANLINE = 0.78

BG, DITHER, INK, DEEP = "#120F1E", "#2A2150", "#8FE3B4", "#2F6B57"
TEXT, LABEL, PURPLE, DANGER = "#F4F1E8", "#B9B3D6", "#9D7CFF", "#FF4D5E"
CARD, OUTLINE, SHADOW = "#221C38", "#05080A", "#000000"

SPRITE_COLORS = ("#4FA77C", "#C9F5DA")             # sprite.py의 명암 두 단계
PEOPLE_COLORS = ("#D9A88A", "#A87562", "#2E2438", "#6B4A3A", "#9A93A8", "#4E6A9C", "#C9A25A", "#8A5A7E",   # figure.py warm
                 "#C9A08E", "#946A66", "#5E4438", "#8C8598", "#4A5E86", "#8A7A4E", "#7A5070")              # figure.py muted
FIRE_COLORS = ("#FFE7A3", "#FFB03B", "#E8572E")  # 불 전용: 속 · 가운데 · 겉 불꽃 (2026-10-13 사용자 결정, DANGER는 위험에만)
PALETTE = (BG, DITHER, INK, DEEP, TEXT, LABEL, PURPLE, DANGER, CARD, OUTLINE, SHADOW, *SPRITE_COLORS, *PEOPLE_COLORS, *FIRE_COLORS)


# ---- 형식 2: 확장 팔레트(대표색 기준 역할별 명도·채도 범위; 정본 표는 production-contract.md) ----
L_MIN, L_MAX = 0.18, 0.958         # 모든 확장색의 OKLCH 명도 범위
ROLE_RANGES = {                    # 역할: (명도 하한, 명도 상한, 채도 상한)
    "환경": (0.18, 0.60, 0.083),
    "물체·재질": (0.18, 0.958, 0.106),
    "구조·연결부": (0.18, 0.958, 0.106),
    "정보 비교": (0.18, 0.958, 0.187),
    "핵심 변화": (0.18, 0.958, 0.187),
    "강조": (0.18, 0.958, 0.187),
    "발광": (0.18, 0.958, 0.20),   # 빛나는 물질(마그마·용암·필라멘트 등): 밝고 진해도 되지만 면적이 GLOW_MAX_SHARE로 묶인다
}
DANGER_HUE_BAND, DANGER_NEAR_C = 25, 0.15   # DANGER 색상각 ±25° 안의 확장색은 채도 0.15 이하(발광 제외)
GLOW_MAX_SHARE = 0.15              # 발광색은 프레임마다 캔버스 면적의 15% 이하(2026-10-17 사용자 결정)
_EPS = 1e-9


def oklch(color):
    """#RRGGBB → OKLCH (명도 L 0~1, 채도 C, 색상각 h 0~360°)."""
    lin = [(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in (int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))]
    r, g, b = lin
    l, m, s = (x ** (1 / 3) for x in (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
                                       0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
                                       0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b))
    lab_a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    lab_b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, math.hypot(lab_a, lab_b),
            math.degrees(math.atan2(lab_b, lab_a)) % 360)


def range_violations(L, C, h, role):
    """OKLCH 값이 역할 범위를 벗어난 곳의 설명 목록(비면 통과). 경계값은 통과한다."""
    if role not in ROLE_RANGES:
        return [f"역할은 {list(ROLE_RANGES)} 중 하나: {role!r}"]
    lo, hi, c_max = ROLE_RANGES[role]
    out = []
    if L < max(lo, L_MIN) - _EPS:
        out.append(f"명도 L {L:.3f} < 하한 {max(lo, L_MIN)}")
    if L > min(hi, L_MAX) + _EPS:
        out.append(f"명도 L {L:.3f} > 상한 {min(hi, L_MAX)}")
    dc, dh = oklch(DANGER)[1], oklch(DANGER)[2]
    if C > min(c_max, dc) + _EPS:
        out.append(f"채도 C {C:.3f} > 상한 {min(c_max, dc)}")
    if role != "발광" and abs((h - dh + 180) % 360 - 180) <= DANGER_HUE_BAND and C > DANGER_NEAR_C + _EPS:
        out.append(f"DANGER 색상각({dh:.0f}°) ±{DANGER_HUE_BAND}° 안(h {h:.0f}°)에서 채도 C {C:.3f} > {DANGER_NEAR_C}")
    return out


def declare_colors(decls):
    """에피소드의 확장색 선언 [{"color": "#RRGGBB", "role": 역할}] → 선언 색 튜플. 역할이 없거나 범위를 벗어나면 ValueError
    (렌더 전에 실패). 이미 기본 팔레트(브랜드 대표색·마스코트·PEOPLE·FIRE·DANGER 등)에 있는 색은 범위 검사에서 제외한다."""
    out = []
    for d in decls:
        color, role = d.get("color"), d.get("role")
        if not isinstance(color, str) or len(color) != 7 or color[0] != "#" or not role:
            raise ValueError(f"확장색 선언은 색값(#RRGGBB)과 역할이 모두 필요하다: {d!r}")
        if color.upper() in {c.upper() for c in PALETTE}:
            continue
        L, C, h = oklch(color)
        bad = range_violations(L, C, h, role)
        if bad:
            raise ValueError(f"확장색 {color}({role}) 범위 밖 — L {L:.3f} C {C:.3f} h {h:.0f}°: " + "; ".join(bad))
        out.append(color)
    return tuple(out)


def glow_colors(decls):
    """선언 중 발광 역할 색 튜플(면적 검사 대상)."""
    return tuple(d["color"] for d in decls if d.get("role") == "발광")


def glow_share(img, glow):
    """캔버스에서 발광색이 차지하는 면적 비율."""
    if not glow:
        return 0.0
    a = np.asarray(img.convert("RGB")).reshape(-1, 3)
    cols = np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for c in glow])
    return float((a[:, None, :] == cols[None]).all(-1).any(-1).mean())


def _fonts(label=("Galmuri9.ttf", 10)):
    spec = {"body": ("Galmuri11.ttf", 12), "bold": ("Galmuri11-Bold.ttf", 12), "label": label, "stmt": ("Galmuri14.ttf", 14)}
    return {k: ImageFont.truetype(str(D / "fonts" / f), n) for k, (f, n) in spec.items()}


FONT = _fonts()                    # 형식 2의 용도: stmt 진술 Galmuri14(56px) · label 라벨 Galmuri11(48px) · bold 2배 큰 수치(96px)


def use_format(version):
    """형식 1(옛 5px) 또는 2(4px 애니메이션 중심)로 엔진 전역을 맞춘다. 바꿀 때마다 배경 캐시를 버린다."""
    global FORMAT, W, H, SCALE, SAFE_OFFSET, EXT_W, EXT_H, OUT_W, OUT_H, DITHER_FROM, _EXT_BG
    if version not in (1, 2):
        raise ValueError(f"format_version은 1 또는 2: {version!r}")
    FORMAT = version
    (W, H), SCALE, SAFE_OFFSET = ((180, 320), 5, (12, 40)) if version == 1 else ((225, 400), 4, (15, 50))
    EXT_W, EXT_H = 1080 // SCALE, 1920 // SCALE
    OUT_W, OUT_H = EXT_W * SCALE, EXT_H * SCALE
    DITHER_FROM = H // 2
    FONT.update(_fonts() if version == 1 else _fonts(("Galmuri11.ttf", 12)))
    _EXT_BG = None


BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])
CARD_BOX = (10, 252, 170, 290)     # x0,y0,x1,y1 (포함)
CARD_INNER_W = 148
CARD_CHAR_LIMIT = 22               # 대본의 카드당 공백 제외 상한; 실제 폭·줄바꿈도 통과해야 한다
CARD_FONT, CARD_LINE_GAP, CARD_TOP = "body", 16, 6   # 새 제작 자막: 갈무리11 Regular 12px, 줄당 한글 최대 12자


def background():
    img = Image.new("RGB", (W, H), BG)
    px = img.load()
    for y in range(DITHER_FROM, H):
        level = (y - DITHER_FROM) / (H - DITHER_FROM) * 17          # 아래로 갈수록 디더 밀도 증가, 끝에서는 꽉 참
        for x in range(W):
            if BAYER[y % 4][x % 4] < level:
                px[x, y] = tuple(int(DITHER[i:i + 2], 16) for i in (1, 3, 5))
    return img


_EXT_BG = None


def ext_background():
    """확장 캔버스 전체의 배경. background()와 같은 공식을 장면 좌표(x-ox, y-oy)에 적용 — 위는 단색, 아래는 마지막 농도 유지.
    Bayer 위상은 장면 좌표로 계산하므로 오프셋이 4의 배수가 아니어도(형식 2: 15, 50) 장면 안팎 이음매가 없다."""
    global _EXT_BG
    if _EXT_BG is None:
        ox, oy = SAFE_OFFSET
        ys = np.arange(EXT_H)[:, None] - oy
        xs = np.arange(EXT_W)[None, :] - ox
        level = np.clip(ys - DITHER_FROM, 0, H - 1 - DITHER_FROM) / (H - DITHER_FROM) * 17
        mask = (BAYER[ys % 4, xs % 4] < level) & (ys >= DITHER_FROM)
        a = np.empty((EXT_H, EXT_W, 3), np.uint8)
        a[:] = tuple(int(BG[i:i + 2], 16) for i in (1, 3, 5))
        a[mask] = tuple(int(DITHER[i:i + 2], 16) for i in (1, 3, 5))
        _EXT_BG = a
    return _EXT_BG


def _draw(img):
    d = ImageDraw.Draw(img)
    d.fontmode = "1"                                 # 안티앨리어싱 끔
    return d


def text(img, xy, s, font="body", fill=TEXT, scale=1, shadow=True):
    """1비트 글자 + 1px 그림자. scale>1이면 작은 1비트 이미지를 최근접으로 키워 찍는다.
    형식 2 편에서는 승인 문구 대조를 거치는 say(와 엔진 내부 trusted())만 부를 수 있다."""
    if _TEXTS is not None and not _trusted:
        raise RuntimeError(f"형식 2의 화면 글자는 E.say(또는 승인 문구를 대조하는 부품)로만 그린다: {s!r}")
    x, y = xy
    f = FONT[font]
    if scale == 1:
        d = _draw(img)
        if shadow:
            d.text((x + 1, y + 1), s, font=f, fill=SHADOW)
        d.text((x, y), s, font=f, fill=fill)
        return
    w = int(f.getlength(s)) + 1
    m = Image.new("1", (w, 16), 0)
    _draw(m).text((0, 0), s, font=f, fill=1)
    m = draw.scale(m, scale)
    if shadow:
        img.paste(SHADOW, (x + 1, y + 1), m)
    img.paste(fill, (x, y), m)


# ---- 형식 2: 승인 문구 대조 글자 헬퍼 ----
_TEXTS = None                      # None이면 형식 1(검사 없음). 아니면 {"approved": set, "drawn": set}
_trusted = False
TEXT_SAFE = (10, 12, 214, 372)     # 형식 2 글자 안전 영역(포함, 장면 좌표): 플랫폼 UI가 위 ~240px·아래 1710px~·오른쪽 920px~를 가린다
STMT_Y, STMT_GAP, STMT_LINES = 14, 18, 2   # 진술 자리: 위쪽, 줄 간격(Galmuri14 14px + 4), 최대 두 줄
FONT_H = {"stmt": 14, "label": 12, "body": 12, "bold": 12}


def start_texts(approved):
    """형식 2 편의 승인 문구 목록을 등록한다(None이면 검사 끔). 이전 등록과 그린 기록은 버린다."""
    global _TEXTS
    _TEXTS = None if approved is None else {"approved": set(approved), "drawn": set()}


@contextmanager
def trusted():
    """엔진·부품 내부 글자 그리기. 승인 문구 대조는 호출자가 이미 했다(엔딩 도장 장면·HUD)."""
    global _trusted
    prev, _trusted = _trusted, True
    try:
        yield
    finally:
        _trusted = prev


def approve(s):
    """s가 승인된 화면 문구인지 대조하고 그렸다고 기록한다. 아니면 ValueError."""
    if _TEXTS is None:
        return
    if s not in _TEXTS["approved"]:
        raise ValueError(f"승인되지 않은 화면 문구: {s!r}")
    _TEXTS["drawn"].add(s)


def undrawn_texts():
    """승인됐지만 이 렌더에서 한 번도 안 그려진 문구."""
    return sorted(_TEXTS["approved"] - _TEXTS["drawn"]) if _TEXTS else []


def say(img, s, kind="statement", xy=None, fill=None, align="center"):
    """형식 2의 화면 글자 헬퍼(장면 글자는 전부 이것을 거친다). s는 그 편의 승인된 화면 문구여야 한다(아니면 ValueError).
    statement(진술, Galmuri14 56px): 화면 위 진술 자리, 최대 두 줄, xy 생략 시 가운데.
    label(라벨, Galmuri11 48px): 가리키는 대상 옆 xy, 한 줄. align="center"면 xy의 x가 글자 가운데, "left"면 왼쪽 끝.
    number(큰 수치, Galmuri11-Bold 2배 96px, 기본 INK): xy 생략 시 진술 자리 아래 가운데.
    두 줄을 넘거나 글자 안전 영역(TEXT_SAFE) 밖으로 나가면 ValueError. 즉시 등장한다(타자기 없음)."""
    approve(s)
    sx0, sy0, sx1, sy1 = TEXT_SAFE
    if kind == "statement":
        font, scale, fill = "stmt", 1, fill or TEXT
        lines = split_lines(s, sx1 - sx0 + 1, font)
        if len(lines) > STMT_LINES:
            raise ValueError(f"진술은 최대 {STMT_LINES}줄: {s!r} ({len(lines)}줄)")
        x0, y0, gap = None, (xy[1] if xy else STMT_Y), STMT_GAP
    elif kind in ("label", "number"):
        font, scale = ("label", 1) if kind == "label" else ("bold", 2)
        fill = fill or (TEXT if kind == "label" else INK)
        lines, gap = [s], 0
        y0 = xy[1] if xy else STMT_Y + STMT_LINES * STMT_GAP + 6
        x0 = None
        if kind == "label" and xy is None:
            raise ValueError("라벨은 가리키는 대상 옆 xy가 필요하다")
    else:
        raise ValueError(f"글자 종류는 statement·label·number: {kind!r}")
    cx = xy[0] if xy and kind != "statement" else W // 2
    h = FONT_H[font] * scale
    for k, line in enumerate(lines):
        w = text_w(line, font, scale)
        x = cx - w // 2 if (align == "center" or kind == "statement") else cx
        y = y0 + k * gap
        if x < sx0 or x + w - 1 > sx1 or y < sy0 or y + h - 1 > sy1:
            raise ValueError(f"글자가 안전 영역 {TEXT_SAFE} 밖으로 나간다: {line!r} x {x}~{x + w - 1} y {y}~{y + h - 1}")
        with trusted():
            text(img, (x, y), line, font, fill, scale)


def text_w(s, font="body", scale=1):
    return int(FONT[font].getlength(s)) * scale


def center_text(img, y, s, font="body", fill=TEXT, scale=1):
    text(img, ((W - text_w(s, font, scale)) // 2, y), s, font, fill, scale)


# 줄을 끊어도 자연스러운 낱말 끝(조사·연결 어미·쉼표)
BREAK_AFTER = tuple(",.는이가을를에로와과도만면고서며데지요죠")  # "은"·"의"는 꾸미는 말(좁은, 부품값의)에도 붙어 뺀다 + ("보다", "부터", "까지", "처럼", "만큼")


def split_lines(s, max_w=CARD_INNER_W, font="body"):
    """띄어쓰기에서 끊고, 쉼표 뒤에서는 줄을 바꾼다."""
    lines, cur = [], ""
    for tok in s.split():
        trial = f"{cur} {tok}".strip()
        if cur and text_w(trial, font) > max_w:
            lines.append(cur)
            cur = tok
        else:
            cur = trial
        if tok.endswith(","):
            lines.append(cur)
            cur = ""
    if cur:
        lines.append(cur)
    if len(lines) == 2 and not lines[0].endswith(","):  # 두 줄이면 길이를 고르게(말 덩어리가 앞 줄 끝에 홀로 붙지 않게)
        words = s.split()
        splits = [(" ".join(words[:k]), " ".join(words[k:])) for k in range(1, len(words))]
        fits = [p for p in splits if max(text_w(p[0], font), text_w(p[1], font)) <= max_w]
        # 조사·어미 뒤에서 끊는다("여러 / 단을"처럼 꾸미는 말과 꾸밈받는 말이 갈리지 않게). 그런 자리가 없을 때만 아무 데나.
        good = [p for p in fits if p[0].endswith(BREAK_AFTER)] or fits
        if good:
            lines = list(min(good, key=lambda p: max(text_w(p[0], font), text_w(p[1], font))))
    for i in range(1, len(lines)):                    # 쉼표로 홀로 남은 짧은 줄은 앞 줄 마지막 낱말을 데려온다
        head, tail = lines[i - 1].rsplit(" ", 1) if " " in lines[i - 1] else (None, None)
        if head and " " not in lines[i] and len(lines[i]) <= 3:
            lines[i - 1], lines[i] = head, f"{tail} {lines[i]}"
    return lines


def clean(sentence):
    """대본의 뜻 단위 끊기 ` / `를 뺀 화면 글자."""
    return sentence.replace(" / ", " ")


def split_cards(sentence):
    """문장 → 두 줄짜리 카드 목록(각 카드는 줄 목록). 대본의 ` / `에서 먼저 나누고, 넘치면 폭으로 끊는다."""
    cards = []
    for seg in sentence.split(" / "):
        lines = split_lines(seg, font=CARD_FONT)
        for line in lines:
            if text_w(line, CARD_FONT) > CARD_INNER_W:
                raise ValueError(f"자막 줄 폭 초과: {line!r} ({text_w(line, CARD_FONT)} > {CARD_INNER_W}px)")
        cards += [lines[i:i + 2] for i in range(0, len(lines), 2)]
    return cards


def _n(s):
    return len(s.replace(" ", ""))


def card_secs(card):
    """읽기 시간. 문장 중간에서 끊긴 카드(끝이 쉼표·마침표가 아님)는 다 찍힌 뒤 멈춤을 MID_HOLD만큼만 둔다 —
    다음 카드에 문장이 이어져서 오래 멈출 필요가 없다."""
    full = max(MIN_CARD, _n("".join(card)) / READ_CPS)
    if card[-1].rstrip()[-1:] in ",.?!":
        return full
    chars = [ch for ln in card for ch in ln]
    typing = len(chars) / TYPE_CPS + sum(PUNCT_PAUSE for ch in chars if ch in ",.?!")
    return typing + MID_HOLD * (full - typing) if full > typing else full


def sentence_secs(s):
    return sum(card_secs(c) for c in split_cards(s))


def plan(sentences):
    """장면 문장들 → [(카드 줄, 시작, 길이)] (장면 시간 기준; LEAD 이후부터)."""
    out, t = [], LEAD
    for s in sentences:
        for c in split_cards(s):
            dur = card_secs(c)
            out.append((c, t, dur))
            t += dur
    return out


def char_times(card, start, dur):
    """카드 안 각 글자(공백 포함 순서)가 찍히는 시각. 소리와 화면이 같은 표를 쓴다."""
    chars = [ch for ln in card for ch in ln]
    step = min(1 / TYPE_CPS, dur * 0.75 / max(len(chars), 1))
    t, out = start, []
    for ch in chars:
        out.append(t)
        t += step + (PUNCT_PAUSE if ch in ",.?!" else 0)
    return out


CARD_POP = (0.6, 1.08, 1.0)        # 장면 첫 카드가 튀어나오는 크기(24fps 3프레임); 글자는 그 뒤부터 보인다
CURSOR_W = 6                       # 타이핑 커서 폭(글자 폭의 절반)


def draw_card(img, card, typed, scale=1.0, cursor=False):
    """scale: 상자 크기 배율(가운데 기준; 1이 아니면 글자·커서는 안 그린다). cursor: 마지막 찍힌 글자 바로 뒤에 INK 블록 커서."""
    cx0, cy0, cx1, cy1 = CARD_BOX
    mx, my = (cx0 + cx1) / 2, (cy0 + cy1) / 2
    x0, x1 = round(mx - (mx - cx0) * scale), round(mx + (cx1 - mx) * scale)
    y0, y1 = round(my - (my - cy0) * scale), round(my + (cy1 - my) * scale)
    d = ImageDraw.Draw(img)

    def shape(dx, dy, fill, line):                    # 모서리 한 점 깎은 상자
        if fill:
            d.rectangle((x0 + dx, y0 + dy + 1, x1 + dx, y1 + dy - 1), fill=fill)
            d.rectangle((x0 + dx + 1, y0 + dy, x1 + dx - 1, y1 + dy), fill=fill)
        if line:
            d.line((x0 + 1, y0, x1 - 1, y0), fill=line); d.line((x0 + 1, y1, x1 - 1, y1), fill=line)
            d.line((x0, y0 + 1, x0, y1 - 1), fill=line); d.line((x1, y0 + 1, x1, y1 - 1), fill=line)

    shape(1, 1, SHADOW, None)
    shape(0, 0, CARD, None)
    shape(0, 0, None, INK)
    if scale != 1.0:
        return
    left, ty = typed, y0 + CARD_TOP
    cur = None
    for ln in card:
        w = text_w(ln, CARD_FONT)
        text(img, ((W - w) // 2, ty), ln[:max(left, 0)], font=CARD_FONT)
        if left >= 0 and (cur is None or left > 0):          # 커서는 마지막으로 글자가 찍힌 줄의 끝(아직 아무것도 안 찍혔으면 첫 줄 앞)
            cur = ((W - w) // 2 + text_w(ln[:left], CARD_FONT), ty)
        left -= len(ln)
        ty += CARD_LINE_GAP
    if cursor and cur:                                    # 상자 안(오른쪽 테두리 앞)을 넘지 않게
        x = min(cur[0], x1 - 1 - CURSOR_W)
        d.rectangle((x, cur[1] + 1, x + CURSOR_W - 1, cur[1] + 11), fill=INK)


def to_output(img):
    ox, oy = SAFE_OFFSET
    ext = ext_background().copy()
    ext[oy:oy + H, ox:ox + W] = np.asarray(img.convert("RGB"))
    a = np.asarray(draw.scale(Image.fromarray(ext), SCALE)).copy()
    a = a.reshape(EXT_H, SCALE, OUT_W, 3)
    a[:, SCALE - 1] = (a[:, SCALE - 1] * SCANLINE).astype(np.uint8)   # 도트 줄마다 마지막 출력 줄을 어둡게
    return a.reshape(OUT_H, OUT_W, 3)


def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode(frame_fn, n_frames, wav, out, palette=None, glow=()):
    """frame_fn(i) -> (캔버스 목록, 출력 배열 1080x1920). 캔버스는 그 프레임에 쓰인 180x320 원본 전부이고
    프레임마다 전부 lint를 돌린다(palette가 없으면 PALETTE). 출력 배열은 SCALE×SCALE 블록 lint. 실패가 있으면 영상을 쓰지 않는다.
    반환: (고립 점 수의 최댓값, 합계)."""
    out = Path(out)
    tmp = out.with_suffix(".tmp.mp4")
    cmd = ["nice", "-n", "19", ffmpeg_exe(), "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS_OUT), "-i", "-", "-i", str(wav),
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", "-tune", "animation",
           "-threads", "1", "-x264-params", "rc-lookahead=5:ref=2:bframes=2",   # Pi 2GB: ffmpeg 1.26GB → 0.91GB
           "-c:a", "aac", "-b:a", "160k", "-shortest", "-f", "mp4", str(tmp)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    fails, iso = [], []
    for i in range(n_frames):
        canvases, arr = frame_fn(i)
        bad, n_iso = 0, 0
        for img in canvases:
            b, n = lint.check_canvas(img, palette or PALETTE, ignore=(BG, DITHER))
            bad, n_iso = bad + b + (glow_share(img, glow) > GLOW_MAX_SHARE + _EPS), max(n_iso, n)
        if bad or not lint.check_output(arr, SCALE):
            fails.append((i, bad))
        iso.append(n_iso)
        p.stdin.write(arr.tobytes())
    p.stdin.close()
    p.wait()
    if fails or p.returncode:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"lint/ffmpeg 실패: {fails[:5]}")
    tmp.replace(out)
    return max(iso), sum(iso)
