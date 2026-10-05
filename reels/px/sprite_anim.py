"""스프라이트 재생기: 프레임 목록 + 프레임별 시간 + loop/once/pingpong + 앵커 + 좌우 반전. 시각 t만 보고 고른다."""
from PIL import Image, ImageOps


class Anim:
    """frames: RGBA 이미지 목록. durs: 프레임별 초(기본 1/fps). anchor: 프레임 안의 기준점(기본 각 프레임의 발밑 가운데).
    offsets: 프레임별 (dx, dy) 덧붙임(통통 튀기 같은 움직임).
    scales: 프레임별 (가로배, 세로배)(squash/stretch; 최근접 확대, 기본 앵커는 크기를 바꾼 뒤에도 발밑 가운데).
    alts: 프레임별 대체 프레임(눈 깜빡임처럼 같은 자리에서 잠깐 바꿔 끼우는 것; None이면 없음). frame_at(alt=True)가 쓴다."""

    def __init__(self, frames, fps=12, durs=None, mode="loop", anchor=None, flip=False, offsets=None, scales=None, alts=None):
        n = len(frames)
        self.durs = durs or [1 / fps] * n
        self.offsets = offsets or [(0, 0)] * n
        self.scales = scales or [(1, 1)] * n
        mirror = (lambda f: ImageOps.mirror(f) if f is not None else None) if flip else (lambda f: f)
        self.frames = [mirror(f) for f in frames]
        self.alts = [mirror(f) for f in alts] if alts else [None] * n
        self.anchor = anchor
        self.anchors = [((f.width - 1 - anchor[0], anchor[1]) if flip else anchor) if anchor
                        else (f.width // 2, f.height - 1) for f in frames]
        self.seq = list(range(n)) + (list(range(n - 2, 0, -1)) if mode == "pingpong" else [])
        self.once = mode == "once"
        self._scaled = {}

    def index_at(self, t):
        total = sum(self.durs[i] for i in self.seq)
        t = min(max(t, 0), total - 1e-9) if self.once else t % total
        for i in self.seq:
            if t < self.durs[i]:
                return i
            t -= self.durs[i]
        return i

    def _pick(self, i, alt):
        f, (sx, sy) = (self.alts[i] if alt and self.alts[i] is not None else self.frames[i]), self.scales[i]
        ax, ay = self.anchors[i]
        if (sx, sy) == (1, 1):
            return f, (ax, ay)
        key = (i, alt)
        if key not in self._scaled:
            g = f.resize((max(1, round(f.width * sx)), max(1, round(f.height * sy))), Image.NEAREST)
            self._scaled[key] = (g, (g.width // 2, g.height - 1) if not self.anchor else (round(ax * sx), round(ay * sy)))
        return self._scaled[key]

    def frame_at(self, t, at=(0, 0), alt=False):
        """t초의 (프레임, 붙일 왼쪽 위 좌표). at은 앵커가 놓일 화면 좌표."""
        i = self.index_at(t)
        f, (ax, ay) = self._pick(i, alt)
        ox, oy = self.offsets[i]
        return f, (at[0] - ax + ox, at[1] - ay + oy)

    def paste(self, canvas, t, at=(0, 0)):
        f, pos = self.frame_at(t, at)
        canvas.paste(f, pos, f)
