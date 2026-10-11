"""고정 카드뉴스 레이아웃. 확정 JSON + 편별 투명 도트 PNG → 1080×1350 PNG."""
import argparse
from datetime import date as Date
import json
import math
import random
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from px.sprite import body_mask, sprite

SIZE = (1080, 1350)
M = 84
BG, TEXT, MINT, GREEN, PURPLE, DARK = (
    "#F4F1E8", "#120F1E", "#8FE3B4", "#2F6B57", "#9D7CFF", "#221C38"
)
MUTED, LINE = "#625E70", "#B9B3D6"
LAYOUTS = {"cover", "story", "points", "numbers", "compare", "closing", "stat", "steps", "quote"}
PIXEL_FONT = Path(__file__).resolve().parents[1] / "px/fonts/DNFBitBitv2.otf"
TITLE_FONT = PIXEL_FONT


def paper_background(layout, top):
    paper = Image.new("RGB", SIZE, BG)
    draw = ImageDraw.Draw(paper)
    rng = random.Random(20261010)
    for _ in range(35000):
        x, y = rng.randrange(16, 1064), rng.randrange(top + 16, 1218)
        draw.point((x, y), fill=rng.choice(("#EDEAE1", "#FAF7EF")))
    for _ in range(1000):
        x, y = rng.randrange(16, 1060), rng.randrange(top + 16, 1214)
        side = rng.choice((2, 3, 4))
        draw.rectangle((x, y, x + side - 1, y + side - 1),
                       fill=rng.choice(("#E5E1D5", "#EAE6DB", "#DFDBCE")))
    if layout in ("cover", "closing"):
        left = 780 if layout == "cover" else 1008
        for y in range(max(940, top + 16), 1218, 16):
            for x in range(left, 1076, 16):
                strength = ((x - 760) / 316) * ((y - 924) / 294)
                if rng.random() < strength:
                    alpha = 0.06 + 0.12 * strength
                    color = tuple(round(a + (b - a) * alpha)
                                  for a, b in zip((244, 241, 232), (47, 107, 87)))
                    draw.rectangle((x, y, x + 3, y + 3), fill=color)
    return paper


def pixel_width(value, font):
    return max(math.ceil(font.getlength(value)), font.getbbox(value, anchor="lt")[2])


def pixel_mask(value, font):
    mask = Image.new("1", (max(math.ceil(font.getlength(value)), font.getbbox(value, anchor="lt")[2]), max(font.size, font.getbbox(value, anchor="lt")[3]) + 2))
    ImageDraw.Draw(mask).text((0, 0), value, font=font, fill=1, anchor="lt")
    return mask


class Renderer:
    def __init__(self, font, bold_font, font_index=0, bold_index=0):
        self.font = font
        self.bold_font = bold_font
        self.font_index = font_index
        self.bold_index = bold_index

    def text(self, image, value, box, size=40, color=TEXT, bold=False,
             pixel=False, lead_color=None, line_colors=None):
        if not isinstance(value, str) or not value.strip():
            raise ValueError("비어 있거나 문자열이 아닌 원고")
        x, y, width, height = box
        font = (ImageFont.truetype(str(TITLE_FONT if pixel == "title" or bold else PIXEL_FONT), size) if pixel else
                ImageFont.truetype(str(self.bold_font if bold else self.font), size,
                                   index=self.bold_index if bold else self.font_index))
        draw = ImageDraw.Draw(image)
        def measured_width(value):
            return pixel_width(value, font) if pixel else draw.textlength(value, font=font)

        lines = []
        # 한국어도 줄바꿈하되 원고의 명시적 줄바꿈은 보존한다.
        for paragraph in value.split("\n"):
            line = ""
            for char in paragraph:
                if measured_width(line + char) > width:
                    if not line:
                        raise ValueError(f"한 글자도 못 들어가는 텍스트 영역: {value!r}")
                    split = line.rfind(" ")
                    if split > 0:
                        lines.append(line[:split])
                        line = line[split + 1:] + char
                    else:
                        lines.append(line)
                        line = char
                else:
                    line += char
            lines.append(line.rstrip())
        step = round(size * 7 / 6) if pixel else round(size * (1.2 if bold else 1.4))
        if (len(lines) - 1) * step + size > height:
            raise ValueError(f"텍스트 넘침({len(lines)}줄): {value!r}")
        used_height = (len(lines) - 1) * step + size
        for i, line in enumerate(lines):
            if measured_width(line) > width:
                raise ValueError(f"텍스트 폭 넘침: {line!r}")
            ink = (line_colors[i] if line_colors and i < len(line_colors) else
                   lead_color if i == 0 and lead_color else color)
            if pixel and line:
                mask = pixel_mask(line, font)
                bounds = mask.getbbox()
                if bounds:
                    mask = mask.crop((0, 0, mask.width, bounds[3]))
                    if i * step + mask.height > height:
                        raise ValueError(f"픽셀 글자 높이 넘침: {value!r}")
                    image.paste(ink, (x, y + i * step), mask)
            elif not pixel:
                draw.text((x, y + i * step), line, font=font, fill=ink, anchor="lt")
        return used_height

    def art(self, image, path, box):
        x, y, width, height = box
        with Image.open(path) as source:
            if source.format != "PNG" or source.mode != "RGBA" or source.getextrema()[3][0] != 0:
                raise ValueError(f"그림은 투명 RGBA PNG여야 한다: {path}")
            k = min(width // source.width, height // source.height)
            if k < 1:
                raise ValueError(f"그림이 슬롯보다 크다: {path}")
            art = source.resize((source.width * k, source.height * k), Image.Resampling.NEAREST)
            image.paste(art, (x + (width - art.width) // 2, y + (height - art.height) // 2), art)

    def frame(self, card, number, total, mode, source, topic, published_date):
        image = Image.new("RGB", SIZE, BG)
        d = ImageDraw.Draw(image)
        if not isinstance(topic, str) or not topic.strip():
            raise ValueError("편의 topic이 필요하다")
        try:
            parsed_date = Date.fromisoformat(published_date)
            if parsed_date.isoformat() != published_date:
                raise ValueError("날짜 형식")
            date_label = parsed_date.strftime("%Y.%m.%d")
        except (TypeError, ValueError):
            raise ValueError("바닥말 date는 실제 날짜 YYYY-MM-DD다") from None

        # 원래 별의 모서리는 유지하고 안을 채운 뒤 바깥에만 계단형 그라데이션을 둔다.
        silhouette = Image.new("1", (49, 61))
        silhouette.paste(body_mask(), (5, 5))
        boundary = silhouette.filter(ImageFilter.MaxFilter(3))
        layers = [boundary]
        for _ in range(4):
            layers.append(layers[-1].filter(ImageFilter.MaxFilter(3)))
        mark = Image.new("RGBA", silhouette.size)
        for index, alpha in reversed(list(enumerate((105, 62, 30, 10), 1))):
            ring = ImageChops.logical_xor(layers[index], layers[index - 1])
            mark.paste((47, 107, 87, alpha), (0, 0), ring)
        mark.paste(GREEN, (0, 0), boundary)
        mark.paste(MINT, (0, 0), silhouette)
        image.paste(mark, (M - 4, 58), mark)
        d.line((M, 30, 996, 30), fill=MUTED, width=2)
        d.line((M, 148, 996, 148), fill=MUTED, width=2)
        self.text(image, "시온의 원리노트", (149, 78, 440, 48), 36, bold=True)
        category = card["eyebrow"]
        if not isinstance(category, str) or not category.strip():
            raise ValueError("머릿말 카테고리는 비어 있지 않은 문자열이다")
        meta_font = ImageFont.truetype(str(self.font), 26, index=self.font_index)
        header_font = ImageFont.truetype(str(self.bold_font), 26, index=self.bold_index)
        category_w = math.ceil(header_font.getlength(category))
        self.text(image, category, (996 - min(category_w, 336), 50, min(category_w, 336), 38), 26, MUTED, bold=True)
        page_label = f"{number:02d} / {total:02d}"
        page_w = math.ceil(header_font.getlength(page_label))
        page_x = 996 - page_w
        self.text(image, page_label, (page_x, 102, page_w, 36), 26, MUTED, bold=True)
        strip_w = total * 18 + (total - 1) * 6
        for i in range(total):
            x = page_x - 24 - strip_w + i * 24
            if i + 1 == number:
                d.rectangle((x, 112, x + 18, 120), fill=TEXT)
            elif i + 1 < number:
                d.rectangle((x, 112, x + 18, 120), fill=PURPLE)
            else:
                d.rectangle((x, 112, x + 18, 120), outline=LINE, width=2)
        d.line((M, 1240, 996, 1240), fill=LINE, width=1)
        date_w = math.ceil(meta_font.getlength(date_label))
        date_x = 996 - date_w
        self.text(image, card.get("source", source), (M, 1270, date_x - M - 32, 36), 26, MUTED)
        self.text(image, date_label, (date_x, 1270, date_w, 36), 26, MUTED)

        return image

    def card(self, card, root, number, total, mode, source, topic, published_date):
        layout = card["layout"]
        if layout not in LAYOUTS:
            raise ValueError(f"알 수 없는 레이아웃: {layout}")
        image = self.frame(card, number, total, mode, source, topic, published_date)
        d = ImageDraw.Draw(image)

        title_size = {"cover": 120, "points": 72, "compare": 72, "numbers": 60,
                      "closing": 60, "stat": 60, "quote": 60}.get(layout, 72)
        if "title_style" in card:
            styles = {"display": 120, "standard": 72, "quiet": 60}
            if not isinstance(card["title_style"], str) or card["title_style"] not in styles:
                raise ValueError("title_style는 display·standard·quiet다")
            title_size = styles[card["title_style"]]
        title_y = 202 if layout == "cover" else 188
        title_height = self.text(image, card["title"],
                                 (M, title_y, 912, title_size + 14 * (title_size // 12) + 4),
                                 title_size, bold=True, pixel="title", lead_color=GREEN)
        minimum = title_y + title_height + 32
        background = paper_background(layout, minimum)
        image.paste(background.crop((0, minimum, 1080, 1218)), (0, minimum))
        # 제목의 실제 높이 아래에서 콘텐츠만 이동한다. 글자 크기는 줄이지 않는다.
        default_top, default_bottom = {
            "cover": (510, 1140), "story": (334, 1140), "points": (350, 1120),
            "numbers": (318, 1140), "compare": (390, 1120), "closing": (350, 1120),
            "stat": (334, 1120), "steps": (334, 1120), "quote": (334, 1120),
        }[layout]
        content = card.get("content", {})
        if not isinstance(content, dict) or content.keys() - {"top", "height"}:
            raise ValueError("content는 top·height만 지정한다")
        top = content.get("top", max(default_top, minimum))
        height = content.get("height", default_bottom - top)
        if (type(top) is not int or type(height) is not int or height <= 0
                or top < minimum or top + height > 1160):
            raise ValueError("콘텐츠 영역이 제목·출처 영역을 침범한다")

        def cy(y):
            return top + round((y - default_top) * height / (default_bottom - default_top))

        def box(x, y, width, h):
            return x, cy(y), width, cy(y + h) - cy(y)

        def rectangle(bounds, **kwargs):
            x0, y0, x1, y1 = bounds
            d.rectangle((x0, cy(y0), x1, cy(y1)), **kwargs)

        def art(item, default_box):
            slot = box(*default_box)
            target = item.get("art_box", slot)
            if (not isinstance(target, (list, tuple)) or len(target) != 4
                    or any(type(v) is not int for v in target)):
                raise ValueError("art_box는 정수 [x,y,width,height]다")
            x, y, w, h = target
            if w <= 0 or h <= 0 or x < M or x + w > 996 or y < top or y + h > top + height:
                raise ValueError("그림 상자가 콘텐츠 영역을 침범한다")
            sx, sy, sw, sh = slot
            if x < sx or y < sy or x + w > sx + sw or y + h > sy + sh:
                raise ValueError("그림 상자가 배정된 그림 슬롯을 벗어난다")
            self.art(image, root / item["art"], target)

        if layout == "cover":
            if mode == "news":
                self.text(image, card["body"], box(M, 510, 330, 200), 42)
                if "art" in card:
                    art(card, (438, 610, 558, 530))
            else:
                self.text(image, card["body"], box(M, 510, 912, 150), 42)
                if "art" in card:
                    art(card, (M, 698, 912, 442))
        elif layout == "story":
            composition = card.get("composition", "stacked" if "art" in card else "text")
            if composition not in ("stacked", "visual", "split", "text"):
                raise ValueError("story composition는 stacked·visual·split·text다")
            if composition != "text" and "art" not in card:
                raise ValueError("그림 중심 구도에는 art가 필요하다")
            if composition == "stacked":
                self.text(image, card["body"], box(M, 334, 912, 224), 42)
                art(card, (M, 594, 912, 546))
            elif composition == "visual":
                art(card, (M, 350, 912, 460))
                self.text(image, card["body"], box(M, 842, 912, 236), 42)
            elif composition == "split":
                art(card, (M, 420, 426, 568))
                self.text(image, card["body"], box(576, 420, 420, 680), 40)
            else:
                if "art" in card:
                    raise ValueError("text 구도는 그림 없이 사용한다")
                body_y = top
                if "statement" in card:
                    used = self.text(image, card["statement"], box(M, 334, 912, 300),
                                     72, bold=True, pixel=True, lead_color=GREEN)
                    body_y += used + 56
                self.text(image, card["body"], (M, body_y, 864, top + height - body_y), 46)
        elif layout == "points":
            self.text(image, card["body"], box(M, 350, 912, 104), 40, TEXT)
            items = card["items"]
            if not 1 <= len(items) <= 3:
                raise ValueError("points 항목은 1~3개")
            step = min(290, 620 / len(items))
            for i, item in enumerate(items):
                y = round(500 + i * step)
                if "emphasis" in item and type(item["emphasis"]) is not bool:
                    raise ValueError("emphasis는 true·false다")
                if item.get("emphasis", False):
                    rectangle((M, y - 12, 996, y + 180), fill="#E5F3E9")
                rectangle((108, y + 8, 180, y + 62), fill=GREEN)
                badge_font = ImageFont.truetype(str(PIXEL_FONT), 36)
                badge_label = f"0{i + 1}"
                badge_w = pixel_width(badge_label, badge_font)
                badge_mask = pixel_mask(badge_label, badge_font)
                bx0, by0, bx1, by1 = badge_mask.getbbox()
                badge_x = 108 + (72 - (bx1 - bx0)) // 2 - bx0
                badge_y = cy(y + 8) + (cy(y + 62) - cy(y + 8) - (by1 - by0)) // 2 - by0
                self.text(image, badge_label, (badge_x, badge_y, badge_w, cy(y + 62) - badge_y),
                          36, BG, pixel=True)
                text_x = 392 if "art" in item else 220
                if "art" in item:
                    art(item, (202, y + 14, 168, 148))
                self.text(image, item["title"], box(text_x, y + 12, 972 - text_x, 60), 44, bold=True)
                self.text(image, item["body"], box(text_x, y + 76, 972 - text_x, 94), 38, TEXT)
        elif layout == "numbers":
            self.text(image, card["body"], box(M, 318, 912, 112), 38, TEXT)
            labels, rows = card["labels"], card["rows"]
            if len(labels) != 2 or not 1 <= len(rows) <= 3:
                raise ValueError("numbers는 대상 2개와 지표 1~3개")
            for i, label in enumerate(labels):
                x = M + i * 450
                rectangle((x, 464, x + 18, 482), fill=(GREEN, PURPLE)[i])
                self.text(image, label, box(x + 34, 454, 390, 48), 32)
            step = min(240, 570 / len(rows))
            for i, row in enumerate(rows):
                y = round(548 + i * step)
                values = row["values"]
                if (len(values) != 2 or any(type(v) not in (int, float) or not math.isfinite(v)
                                           or v < 0 for v in values)):
                    raise ValueError("그래프 값은 유한한 음이 아닌 숫자 2개")
                maximum = row["max"]
                if type(maximum) not in (int, float) or not math.isfinite(maximum) or maximum <= 0 or max(values) > maximum:
                    raise ValueError("그래프 상한은 양수이며 값 이상이어야 한다")
                label_width = 600 if "criterion" in row else 700
                self.text(image, row["label"], box(M, y, label_width, 48), 36, bold=True)
                if "criterion" in row:
                    self.text(image, row["criterion"], box(720, y + 4, 276, 42), 30, TEXT)
                if cy(y + 118) - cy(y + 66) < 46:
                    raise ValueError("그래프 수치의 행간이 너무 좁다")
                for j, value in enumerate(values):
                    yy = y + 66 + j * 52
                    rectangle((M, yy, 724, yy + 22), fill="#E5E0D7")
                    if value:
                        rectangle((M, yy, M + round(640 * value / maximum), yy + 22), fill=(GREEN, PURPLE)[j])
                    self.text(image, f"{value:g}{row['unit']}", box(770, yy - 12, 226, 58),
                              44, TEXT, bold=True)
            self.text(image, card["note"], box(M, 1106, 912, 34), 26, MUTED)
        elif layout == "compare":
            columns = card["columns"]
            if len(columns) != 2:
                raise ValueError("compare 대상은 2개")
            d.line((540, cy(480), 540, cy(1040)), fill=LINE, width=2)
            for i, col in enumerate(columns):
                x = M + i * 486
                rectangle((x, 426, x + 22, 448), fill=(MINT, PURPLE)[i])
                self.text(image, col["name"], box(x + 42, 414, 384, 100), 48, TEXT, True)
                if "art" in col:
                    art(col, (x, 512, 426, 320))
                body_box = (x, 862, 426, 248) if "art" in col else (x, 558, 426, 552)
                self.text(image, col["body"], box(*body_box), 40)
        elif layout == "closing":
            panel_top, panel_bottom = cy(382), cy(874)
            d.polygon(((M + 12, panel_top), (984, panel_top), (996, panel_top + 12), (996, panel_bottom - 12),
                       (984, panel_bottom), (M + 12, panel_bottom), (M, panel_bottom - 12), (M, panel_top + 12)), fill=DARK)
            for y in range(panel_top + 18, panel_bottom - 12, 12):
                for x in range(M + 18, 984, 12):
                    d.rectangle((x, y, x + 1, y + 1), fill="#2B2543")
            self.text(image, card["statement"], box(156, 450, 624, 342), 72,
                      BG, bold=True, pixel=True, line_colors=[MINT])
            mascot = sprite("sparkle")
            mascot = mascot.resize((mascot.width * 4, mascot.height * 4), Image.Resampling.NEAREST)
            mascot_y = panel_bottom - 24 - mascot.height
            if mascot_y < panel_top + 120:
                raise ValueError("결론 콘텐츠 높이가 시온 캐릭터보다 작다")
            image.paste(mascot, (808, mascot_y), mascot)
            self.text(image, card["body"], box(M, 956, 912, 164), 42)
        elif layout == "stat":
            unit = card.get("unit")
            value_w = 912
            if unit is not None:
                font = ImageFont.truetype(str(TITLE_FONT), 168)
                if not isinstance(card["value"], str) or not card["value"].strip():
                    raise ValueError("큰 숫자 값은 비어 있지 않은 문자열이다")
                if not isinstance(unit, str) or not unit.strip():
                    raise ValueError("큰 숫자 단위는 비어 있지 않은 문자열이다")
                value_w = pixel_width(card["value"], font)
                unit_font = ImageFont.truetype(str(TITLE_FONT), 96)
                unit_w = pixel_width(unit, unit_font)
                if "\n" in card["value"] + unit or value_w + 24 + unit_w > 912:
                    raise ValueError("큰 숫자·단위 폭 넘침")
                unit_y = cy(456) + font.getbbox(card["value"], anchor="lt")[3] - unit_font.getbbox(unit, anchor="lt")[3]
                self.text(image, unit, (M + value_w + 24, unit_y, unit_w, cy(636) - unit_y),
                          96, GREEN, bold=True, pixel=True)
            self.text(image, card["value"], box(M, 456, value_w, 180), 168,
                      bold=True, pixel=True, lead_color=GREEN)
            self.text(image, card["label"], box(M, 650, 912, 80), 44, bold=True)
            d.line((M, cy(824), 996, cy(824)), fill=LINE, width=2)
            self.text(image, card["body"], box(M, 862, 912, 164), 40)
            self.text(image, card["note"], box(M, 1076, 912, 44), 28, TEXT)
        elif layout == "steps":
            self.text(image, card["body"], box(M, 334, 912, 112), 40, TEXT)
            items = card["items"]
            if not 2 <= len(items) <= 4:
                raise ValueError("steps 항목은 2~4개")
            step = 580 / len(items)
            for i, item in enumerate(items):
                y = round(500 + i * step)
                if i < len(items) - 1:
                    d.line((126, cy(y + 72), 126, cy(round(y + step))), fill=LINE, width=3)
                rectangle((84, y, 168, y + 72), fill=GREEN)
                badge_label = f"0{i + 1}"
                badge_font = ImageFont.truetype(str(PIXEL_FONT), 36)
                badge_w = pixel_width(badge_label, badge_font)
                bx0, by0, bx1, by1 = pixel_mask(badge_label, badge_font).getbbox()
                badge_x = 84 + (84 - (bx1 - bx0)) // 2 - bx0
                badge_y = cy(y) + (cy(y + 72) - cy(y) - (by1 - by0)) // 2 - by0
                self.text(image, badge_label, (badge_x, badge_y, badge_w, cy(y + 72) - badge_y),
                          36, BG, pixel=True)
                self.text(image, item["title"], box(210, y, 786, 56), 44, bold=True)
                self.text(image, item["body"], box(210, y + 66, 786, round(step - 78)), 38, TEXT)
        elif layout == "quote":
            statement = card["statement"]
            if isinstance(statement, str) and statement.startswith("“") and statement.endswith("”"):
                statement = statement[1:-1]
            used = self.text(image, statement, box(132, 382, 864, 300), 72,
                             bold=True, pixel=True, lead_color=GREEN)
            attribution_y = cy(382) + used + 32
            body_y = attribution_y + 96
            if attribution_y + 54 > top + height:
                raise ValueError("인용·발언자가 콘텐츠 영역을 침범한다")
            d.rectangle((M, cy(358), M + 8, attribution_y + 54), fill=GREEN)
            self.text(image, card["attribution"], (132, attribution_y, 864, 54), 34, MUTED)
            self.text(image, card["body"], (M, body_y, 912, top + height - body_y), 42)
        # 명시 좌표는 그대로 두고 짧은 지면의 실제 콘텐츠 묶음만 광학적 중앙으로 옮긴다.
        if layout in ("story", "closing", "stat", "quote") and not content and "art_box" not in card:
            region = image.crop((M, top, 997, top + height))
            empty = background.crop((M, top, 997, top + height))
            bounds = ImageChops.difference(region, empty).getbbox()
            if bounds:
                x0, y0, x1, y1 = bounds
                target_y = top + round((height - (y1 - y0)) * 0.42)
                image.paste(empty, (M, top))
                image.paste(region.crop(bounds), (M + x0, target_y))
        return image

    def deck(self, data, root):
        mode, cards = data["mode"], data["cards"]
        if mode not in ("news", "compare"):
            raise ValueError("mode는 news 또는 compare")
        maximum = 7 if mode == "news" else 8
        if not 4 <= len(cards) <= maximum:
            raise ValueError(f"{mode} 장수는 4~{maximum}")
        if cards[0]["layout"] != "cover" or cards[-1]["layout"] != "closing":
            raise ValueError("첫 장은 cover, 마지막은 closing")
        images = []
        for i, card in enumerate(cards):
            try:
                images.append(self.card(card, root, i + 1, len(cards), mode, data["source"], data["topic"], data["date"]))
            except (ValueError, KeyError) as error:
                raise ValueError(f"카드 {i + 1}: {error}") from error
        return images


def save(images, out):
    out.mkdir(parents=True, exist_ok=True)
    for i, image in enumerate(images):
        image.save(out / f"{i + 1:02d}.png")
    # 장수를 줄인 재렌더에서 옛 카드가 게시 목록에 섞이지 않게 한다.
    for path in out.glob("[0-9][0-9].png"):
        if int(path.stem) > len(images):
            path.unlink()
    sheet = Image.new("RGB", (3 * 360 + 4 * 20, math.ceil(len(images) / 3) * 470 + 20), TEXT)
    for i, image in enumerate(images):
        sheet.paste(image.resize((360, 450), Image.Resampling.LANCZOS),
                    (20 + (i % 3) * 380, 20 + (i // 3) * 470))
    sheet.save(out / "preview.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--font", type=Path, required=True)
    parser.add_argument("--bold-font", type=Path, required=True)
    parser.add_argument("--font-index", type=int, default=0)
    parser.add_argument("--bold-index", type=int, default=0)
    args = parser.parse_args()
    renderer = Renderer(args.font, args.bold_font, args.font_index, args.bold_index)
    images = renderer.deck(json.loads(args.input.read_text()), args.input.parent)
    save(images, args.out)
    print(f"{len(images)} cards: {args.out}")
