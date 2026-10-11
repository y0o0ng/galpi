"""문장 읽기 시간·자막 적합 검사. ` / ` 조각마다 한 카드·22자 이하여야 종료 코드 0."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from px import engine as E  # noqa: E402

if __name__ == "__main__":
    total = 0.0
    invalid = False
    for s in sys.argv[1:]:
        try:
            secs = E.sentence_secs(s)
        except ValueError as error:
            print(str(error), file=sys.stderr)
            sys.exit(1)
        total += secs
        print(f"{secs:.2f}\t{s}")
        for i, segment in enumerate(s.split(" / "), 1):
            cards = E.split_cards(segment)
            chars = len(segment.replace(" ", ""))
            ok = chars <= E.CARD_CHAR_LIMIT and len(cards) == 1
            invalid |= not ok
            print(f"  {'PASS' if ok else 'NEEDS_SPLIT'}\t조각 {i}: {chars}자 / {len(cards)}카드")
            for card in cards:
                print("    " + " | ".join(f"{line} [{E.text_w(line, E.CARD_FONT)}px]" for line in card))
    print(f"{total:.2f}\t합계")
    sys.exit(1 if invalid else 0)
