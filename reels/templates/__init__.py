import numpy as np
from reels import style as S


def kicker(text):
    """본문 맨 위 왼쪽 정렬 글줄. 템플릿 공통."""
    return S.txt(text, S.KICKER_SIZE, S.BRAND_INK).move_to(
        np.array([-S.FRAME_W / 2 + S.MARGIN, S.KICKER_Y, 0]), aligned_edge=np.array([-1, 0, 0]))
