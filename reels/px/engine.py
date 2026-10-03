"""도트 엔진: 180x320 캔버스, 1비트 그리기, 자막 카드, 안전 영역 여백을 붙인 5배 최근접 확대 + 주사선, mp4 인코딩."""
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from px import draw, lint

D = Path(__file__).parent
W, H, FPS_OUT, FPS_ANIM = 180, 320, 24, 12
# 출력 배치: 인스타·쇼츠 UI가 위 ~240px, 아래 ~210px(1710~), 오른쪽 x>=920, 양옆 ~50px을 가린다(1편 스크린샷 실측).
# 그래서 장면 캔버스(180x320)를 확장 캔버스(216x384) 안 SAFE_OFFSET에 붙여 5배 확대한다(1080x1920).
SCALE = 5
SAFE_OFFSET = (12, 40)             # 4의 배수여야 배경 Bayer 위상이 맞는다
EXT_W, EXT_H = 1080 // SCALE, 1920 // SCALE
OUT_W, OUT_H = EXT_W * SCALE, EXT_H * SCALE
READ_CPS = 5                       # 카드 시간 = 글자 수(공백 제외) / READ_CPS (글자당 0.2초; 2026-10-03 7에서 늦춤)
MIN_CARD = 1.5                     # 카드 한 장의 최소 시간(초) — 짧은 조각이 깜빡 지나가지 않게
TYPE_CPS = 14                      # 카드 타자 속도(글자/초; 2026-10-03 12에서 올림, 5편부터); 카드 시간의 75%를 넘지 않게 압축
PUNCT_PAUSE = 0.15                 # 문장 부호 뒤 쉼(초)
LEAD, TAIL = 0.4, 0.5              # 장면 앞·뒤 여백(초)
SCANLINE = 0.78

BG, DITHER, INK, DEEP = "#120F1E", "#2A2150", "#8FE3B4", "#2F6B57"
TEXT, LABEL, PURPLE, DANGER = "#F4F1E8", "#B9B3D6", "#9D7CFF", "#FF4D5E"
CARD, OUTLINE, SHADOW = "#221C38", "#05080A", "#000000"

SPRITE_COLORS = ("#4FA77C", "#C9F5DA")             # sprite.py의 명암 두 단계
PALETTE = (BG, DITHER, INK, DEEP, TEXT, LABEL, PURPLE, DANGER, CARD, OUTLINE, SHADOW, *SPRITE_COLORS)

FONT = {k: ImageFont.truetype(str(D / "fonts" / f), s) for k, (f, s) in
        {"body": ("Galmuri11.ttf", 12), "bold": ("Galmuri11-Bold.ttf", 12), "label": ("Galmuri9.ttf", 10)}.items()}
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]])
CARD_BOX = (10, 252, 170, 290)     # x0,y0,x1,y1 (포함)
CARD_INNER_W = 148
CARD_FONT, CARD_LINE_GAP, CARD_TOP = "label", 14, 8   # 자막 카드: 갈무리9 10px(2026-10-03 12px에서 줄임), 줄당 한글 14자


def background():
    img = Image.new("RGB", (W, H), BG)
    px = img.load()
    for y in range(160, H):
        level = (y - 160) / (H - 160) * 17          # 아래로 갈수록 디더 밀도 증가, 끝에서는 꽉 참
        for x in range(W):
            if BAYER[y % 4][x % 4] < level:
                px[x, y] = tuple(int(DITHER[i:i + 2], 16) for i in (1, 3, 5))
    return img


_EXT_BG = None


def ext_background():
    """확장 캔버스 전체의 배경. background()와 같은 공식을 장면 좌표(x-12, y-40)에 적용 — 위는 단색, 아래는 마지막 농도 유지."""
    global _EXT_BG
    if _EXT_BG is None:
        ox, oy = SAFE_OFFSET
        ys = np.arange(EXT_H)[:, None] - oy
        xs = np.arange(EXT_W)[None, :] - ox
        level = np.clip(ys - 160, 0, H - 1 - 160) / (H - 160) * 17
        mask = (BAYER[ys % 4, xs % 4] < level) & (ys >= 160)
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
    """1비트 글자 + 1px 그림자. scale>1이면 작은 1비트 이미지를 최근접으로 키워 찍는다."""
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
        cards += [lines[i:i + 2] for i in range(0, len(lines), 2)]
    return cards


def _n(s):
    return len(s.replace(" ", ""))


def card_secs(card):
    return max(MIN_CARD, _n("".join(card)) / READ_CPS)


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


def draw_card(img, card, typed):
    x0, y0, x1, y1 = CARD_BOX
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
    left, ty = typed, y0 + CARD_TOP
    for ln in card:
        w = text_w(ln, CARD_FONT)
        text(img, ((W - w) // 2, ty), ln[:max(left, 0)], font=CARD_FONT)
        left -= len(ln)
        ty += CARD_LINE_GAP


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


def encode(frame_fn, n_frames, wav, out):
    """frame_fn(i) -> 180x320 RGB 이미지. 프레임마다 lint를 돌리고, 실패가 있으면 영상을 쓰지 않는다.
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
        img = frame_fn(i)
        bad, n_iso = lint.check_canvas(img, PALETTE, ignore=(BG, DITHER))
        arr = to_output(img)
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
