"""9종 템플릿과 콘텐츠 크기 조정 예시를 그림 없이 출력한다. 게시용 deck이 아니다."""
import argparse
import copy
import json
from pathlib import Path
from PIL import ImageDraw

from render import Renderer, save


class LayoutRenderer(Renderer):
    show_art_slots = False

    def art(self, image, path, box):
        if self.show_art_slots:
            x, y, w, h = box
            ImageDraw.Draw(image).rectangle((x, y, x + w - 1, y + h - 1),
                                           outline="#B9B3D6", width=2)
            self.text(image, "그림 영역", (x + 24, y + 24, w - 48, h - 48), 28, "#625E70")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--bold-font", type=Path, required=True)
    parser.add_argument("--font-index", type=int, default=0)
    parser.add_argument("--bold-index", type=int, default=0)
    parser.add_argument("--with-art", action="store_true", help="샘플 도트 그림도 표시")
    args = parser.parse_args()
    root = Path(__file__).parent / "examples"
    data = json.loads((root / "layouts.json").read_text())
    renderer = (Renderer if args.with_art else LayoutRenderer)(
        args.font, args.bold_font, args.font_index, args.bold_index)
    images = [renderer.card(entry["card"], root, i + 1, len(data["templates"]),
                            entry["mode"], data["source"], data["topic"], data["date"])
              for i, entry in enumerate(data["templates"])]
    save(images, args.out)
    # 같은 페이지를 반복하되 콘텐츠만 다르게 배정한 비교다.
    variants = [copy.deepcopy(data["templates"][i]["card"]) for i in (1, 1, 3, 3)]
    variants[0]["composition"] = "stacked"
    variants[1]["composition"] = "stacked"
    variants[1]["content"] = {"top": 370, "height": 700}
    variants[1]["art_box"] = [300, 760, 480, 260]
    variants[3]["content"] = {"top": 318, "height": 842}
    variants[2]["content"] = {"top": 370, "height": 750}
    # 비교용 표시는 콘텐츠를 바꾸지 않고 카테고리에서만 구분한다.
    for card, label in zip(variants, ("STORY / DEFAULT", "STORY / SMALL ART",
                                      "CHART / COMPACT", "CHART / EXPANDED")):
        card["eyebrow"] = label
    if not args.with_art:
        renderer.show_art_slots = True
    save([renderer.card(card, root, i + 1, 4, "news", data["source"], data["topic"], data["date"])
          for i, card in enumerate(variants)], args.out / "variants")
    compositions = [copy.deepcopy(data["templates"][1]["card"]) for _ in range(3)]
    compositions[0].update(composition="stacked", eyebrow="STORY / STACKED")
    compositions[1].update(composition="split", art="device-mint.png", eyebrow="STORY / SPLIT")
    compositions[2] = json.loads((root / "news.json").read_text())["cards"][4]
    compositions[2]["eyebrow"] = "STORY / TEXT"
    save([renderer.card(card, root, i + 1, 3, "news", data["source"], data["topic"], data["date"])
          for i, card in enumerate(compositions)], args.out / "compositions")
    print(f"9 templates + 4 variants + 3 compositions: {args.out}")
