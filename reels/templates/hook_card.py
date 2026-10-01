"""훅 카드: 영어 용어 크게 + 그림 하나 + 시온. 역설 한 줄·한국어 부제는 자막 레이어가 맡는다."""
import numpy as np
from manim import VGroup, DOWN
from reels import style as S
from reels.mascot import at

TERM_Y, ART_Y, ART_H, MASCOT_POS = 2.3, -0.9, 3.6, (3.1, -2.2)


def hook_card(term, art, mascot):
    """term은 줄바꿈(\\n) 가능. art·mascot은 인자로 받은 Mobject를 자리만 잡아준다."""
    term_g = VGroup(*[S.txt(line, 100, S.BRAND_INK) for line in term.split("\n")]).arrange(DOWN, buff=0.2)
    term_g.set_width(min(term_g.width, 7.2)).move_to(np.array([0, TERM_Y, 0]))
    art.set_height(ART_H).move_to(np.array([0, ART_Y, 0]))
    at(mascot, MASCOT_POS)
    card = VGroup(term_g, art, mascot)
    art.sfx = "pop"
    card.term, card.art, card.mascot = term_g, art, mascot
    return card
