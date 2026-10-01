"""비교: 카드 n장을 가로로 놓고 사이에 연결 기호(→, ÷, = 등)를 둔다."""
import numpy as np
from manim import VGroup, RoundedRectangle, DOWN
from reels import style as S
from reels.templates import kicker


def _card(label, art, w, h):
    box = RoundedRectangle(corner_radius=S.CARD_RADIUS, width=w, height=h, color=S.LABEL,
                           stroke_width=S.HAIRLINE, stroke_opacity=S.HAIRLINE_OPACITY,
                           fill_color=S.BRAND, fill_opacity=S.CARD_FILL_OPACITY)
    title = S.txt(label, S.LABEL_SIZE, S.LABEL).move_to(box.get_top() + DOWN * 0.5)
    if art.width > w - 0.5:
        art.set_width(w - 0.5)
    art.move_to(box.get_center() + DOWN * 0.3)
    card = VGroup(box, title, art)
    card.sfx = box.sfx = "pop"  # 장면이 FadeIn하면 timeline.play가 소리를 낸다
    return card


def compare(cards, links, title, y=0.8, h=4.2):
    """cards: [(라벨, 그림 Mobject)], links: 카드 사이 연결 Mobject (len(cards)-1개)."""
    usable = S.FRAME_W - 2 * S.MARGIN - sum(l.width + 0.3 for l in links)
    w = usable / len(cards)
    out, x = VGroup(), -S.FRAME_W / 2 + S.MARGIN
    out.cards, out.links = [], []
    for i, (label, art) in enumerate(cards):
        c = _card(label, art, w, h).move_to(np.array([x + w / 2, y, 0]))
        out.cards.append(c), out.add(c)
        x += w
        if i < len(links):
            x += 0.15 + links[i].width / 2
            links[i].move_to(np.array([x, y, 0]))
            out.links.append(links[i]), out.add(links[i])
            x += links[i].width / 2 + 0.15
    out.kicker = kicker(title)
    out.add(out.kicker)
    return out
