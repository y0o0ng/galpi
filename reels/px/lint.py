"""렌더된 프레임 검사. 캔버스(180x320): 팔레트 밖 색(실패)·고립된 1픽셀 점(보고). 출력 프레임: 6x6 블록 균일(실패)."""
import numpy as np


def _rgb(hexes):
    return {tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in hexes}


def check_canvas(img, palette, ignore=()):
    """(팔레트 밖 색 수, 고립 점 수). 고립 점 = 상하좌우 이웃이 모두 다른 색인 도트(ignore 색은 세지 않는다)."""
    a = np.asarray(img.convert("RGB"))
    ok = _rgb(palette)
    flat = a.reshape(-1, 3)
    uniq = np.unique(flat, axis=0)
    bad = sum(int(((flat == u).all(1)).sum()) for u in uniq if tuple(u) not in ok)
    same = np.zeros(a.shape[:2], bool)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sh = np.roll(a, (dy, dx), (0, 1))
        s = (sh == a).all(-1)
        if dy:
            s[0 if dy > 0 else -1, :] = False
        if dx:
            s[:, 0 if dx > 0 else -1] = False
        same |= s
    iso = ~same
    for c in _rgb(ignore):
        iso &= ~(a == c).all(-1)
    return bad, int(iso.sum())


def check_output(arr, k=6):
    """출력 프레임이 k×k 블록 단위인지(도트 크기 섞임 검사): 블록 안 가로는 같고, 세로는 마지막 줄(주사선)만 다르다."""
    h, w = arr.shape[0] // k, arr.shape[1] // k
    b = arr.reshape(h, k, w, k, 3)
    return bool((b == b[:, :, :, :1]).all() and (b[:, :k - 1] == b[:, :1]).all())
