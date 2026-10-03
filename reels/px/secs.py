"""문장 읽기 시간. usage: python reels/px/secs.py "문장" ["문장" ...] → 문장마다 초와 합계."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from px import engine as E  # noqa: E402

if __name__ == "__main__":
    total = 0.0
    for s in sys.argv[1:]:
        secs = E.sentence_secs(s)
        total += secs
        print(f"{secs:.2f}\t{s}")
    print(f"{total:.2f}\t합계")
