"""편 전용 카드의 공통 헤더/푸터를 고정하고 게시·검토 이미지를 동기화한다."""
import argparse
import json
from pathlib import Path
from PIL import Image
from render import Renderer, SIZE, save


def finalize(deck, out, renderer):
    images = []
    expected = [f"{i:02d}" for i in range(1, len(deck["cards"]) + 1)]
    actual = sorted(p.stem for p in out.glob("[0-9][0-9].png"))
    if actual != expected:
        raise ValueError("카드 이미지 장수 또는 번호가 원고와 다르다")
    for i, card in enumerate(deck["cards"], 1):
        with Image.open(out / f"{i:02d}.png") as source:
            if source.size != SIZE:
                raise ValueError("카드 이미지는 1080×1350이어야 한다")
            image = source.convert("RGB")
        frame = renderer.frame(card, i, len(deck["cards"]), deck["mode"],
                               deck["source"], deck["topic"], deck["date"])
        for box in ((0, 0, 1080, 160), (0, 1240, 1080, 1350)):
            image.paste(frame.crop(box), box[:2])
        images.append(image)
    save(images, out)
    for kind in ("mobile", "jpeg"):
        target = out / kind
        target.mkdir(parents=True, exist_ok=True)
        for old in target.glob("[0-9][0-9].*"):
            old.unlink()
    for i, image in enumerate(images, 1):
        image.resize((390, 488), Image.Resampling.LANCZOS).save(out / "mobile" / f"{i:02d}.png")
        image.save(out / "jpeg" / f"{i:02d}.jpg", quality=95, subsampling=0)
    return images


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("deck", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--bold-font", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.deck.read_text())
    images = finalize(data, args.out, Renderer(args.font, args.bold_font))
    print(json.dumps({"count": len(images), "size": list(SIZE)}))
