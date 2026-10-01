"""6장 색 토큰과 공통 값. 다른 파일은 색·글꼴·크기를 여기서만 가져온다."""
from manim import Text, BOLD

BG = "#151A18"
BRAND_INK = "#7FB99F"   # 강조(용어, 선)
BRAND = "#2F6B57"       # 깊은 강조(채움)
TEXT = "#E7EDE9"
LABEL = "#A8B4AD"
COUNCIL = "#7C6FCD"     # 대비 강조
DANGER = "#FF3B30"

FONT = "Helvetica Neue"

FRAME_W, FRAME_H = 9, 16
MARGIN = 0.45
KICKER_Y = 4.3          # 본문 영역 맨 위 글줄
BAND_BOTTOM = -3.6      # 이 아래는 내레이션 자막 자리

CARD_RADIUS = 12 / 390 * FRAME_W      # 시온 UI 12px 패널 카드를 폰 폭 비율로
CONTROL_RADIUS = 10 / 390 * FRAME_W   # 10px 컨트롤
CARD_FILL_OPACITY = 0.16
HAIRLINE = 2.5
HAIRLINE_OPACITY = 0.45
STROKE = 7

KICKER_SIZE, LABEL_SIZE, SMALL_SIZE = 30, 26, 20


def txt(s, size, color=TEXT, bold=True):
    return Text(s, font=FONT, font_size=size, color=color, weight=BOLD if bold else "NORMAL")
