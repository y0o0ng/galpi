"""스프라이트 재생기: 프레임 목록 + 프레임별 시간 + loop/once/pingpong + 앵커 + 좌우 반전. 시각 t만 보고 고른다."""
from PIL import ImageOps


class Anim:
    """frames: RGBA 이미지 목록. durs: 프레임별 초(기본 1/fps). anchor: 프레임 안의 기준점(기본 각 프레임의 발밑 가운데).
    offsets: 프레임별 (dx, dy) 덧붙임(통통 튀기 같은 움직임)."""

    def __init__(self, frames, fps=12, durs=None, mode="loop", anchor=None, flip=False, offsets=None):
        n = len(frames)
        self.durs = durs or [1 / fps] * n
        self.offsets = offsets or [(0, 0)] * n
        self.frames = [ImageOps.mirror(f) for f in frames] if flip else list(frames)
        self.anchors = [((f.width - 1 - anchor[0], anchor[1]) if flip else anchor) if anchor
                        else (f.width // 2, f.height - 1) for f in frames]
        self.seq = list(range(n)) + (list(range(n - 2, 0, -1)) if mode == "pingpong" else [])
        self.once = mode == "once"

    def frame_at(self, t, at=(0, 0)):
        """t초의 (프레임, 붙일 왼쪽 위 좌표). at은 앵커가 놓일 화면 좌표."""
        total = sum(self.durs[i] for i in self.seq)
        t = min(max(t, 0), total - 1e-9) if self.once else t % total
        for i in self.seq:
            if t < self.durs[i]:
                break
            t -= self.durs[i]
        ax, ay = self.anchors[i]
        ox, oy = self.offsets[i]
        return self.frames[i], (at[0] - ax + ox, at[1] - ay + oy)

    def paste(self, canvas, t, at=(0, 0)):
        f, pos = self.frame_at(t, at)
        canvas.paste(f, pos, f)
