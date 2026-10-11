"""장수·원고 넘침·그래프·그림 경계의 최소 회귀 검증."""
import copy
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image, ImageDraw, ImageChops, ImageFont, ImageFilter
from finalize_integrated import finalize
from render import Renderer, save, LAYOUTS, PIXEL_FONT, TITLE_FONT, pixel_width, BG, TEXT, MINT
from px.sprite import sprite, body_mask

ROOT = Path(__file__).parent


class RenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import os
        cls.renderer = Renderer(os.environ["CARD_FONT"], os.environ["CARD_BOLD_FONT"],
                                int(os.environ.get("CARD_FONT_INDEX", 0)),
                                int(os.environ.get("CARD_BOLD_INDEX", 0)))
        cls.news = json.loads((ROOT / "examples/news.json").read_text())
        cls.compare = json.loads((ROOT / "examples/compare.json").read_text())

    def fails(self, data, message):
        with self.assertRaisesRegex(ValueError, message):
            self.renderer.deck(data, ROOT / "examples")

    def test_layouts_and_lengths(self):
        for original, maximum in ((self.news, 7), (self.compare, 8)):
            for count in (4, maximum):
                data = copy.deepcopy(original)
                data["cards"] = [original["cards"][0]] + [original["cards"][1]] * (count - 2) + [original["cards"][-1]]
                images = self.renderer.deck(data, ROOT / "examples")
                self.assertEqual(len(images), count)
                self.assertTrue(all(i.size == (1080, 1350) for i in images))
            data["cards"].insert(1, original["cards"][1])
            self.fails(data, "장수")
        for data in (self.news, self.compare):
            self.renderer.deck(data, ROOT / "examples")

    def test_text_overflow_is_not_hidden(self):
        data = copy.deepcopy(self.news)
        data["cards"][1]["body"] = "긴 원고 " * 300
        self.fails(data, "카드 2: 텍스트 넘침")

    def test_chart_scale_and_values(self):
        for values, maximum in (([-1, 2], 10), ([float("nan"), 2], 10), ([2, 3], 0), ([2, 3], 2)):
            data = copy.deepcopy(self.news)
            data["cards"][3]["rows"][0].update(values=values, max=maximum)
            self.fails(data, "그래프")
        data["cards"][3]["rows"][0].update(values=[0, 0], max=100)
        self.renderer.deck(data, ROOT / "examples")
        for count in (1, 2):
            fewer = copy.deepcopy(self.news)
            fewer["cards"][3]["rows"] = fewer["cards"][3]["rows"][:count]
            self.renderer.deck(fewer, ROOT / "examples")
        compressed = copy.deepcopy(self.news)
        compressed["cards"][3]["content"] = {"top": 350, "height": 720}
        self.fails(compressed, "행간")

    def test_art_uses_integer_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "art.png"
            art = Image.new("RGBA", (2, 2))
            art.putpixel((0, 0), (47, 107, 87, 255))
            art.save(path)
            canvas = Image.new("RGB", (9, 9), "white")
            self.renderer.art(canvas, path, (0, 0, 9, 9))
            self.assertEqual(canvas.getpixel((3, 3)), (47, 107, 87))
            self.assertEqual(canvas.getpixel((4, 3)), (255, 255, 255))
            Image.new("RGB", (2, 2)).save(path)
            with self.assertRaisesRegex(ValueError, "투명"):
                self.renderer.art(canvas, path, (0, 0, 9, 9))

    def test_rerender_removes_old_cards(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            images = [Image.new("RGB", (1080, 1350))] * 9
            save(images, out)
            (out / "keep.txt").write_text("unrelated")
            save(images[:4], out)
            self.assertFalse((out / "05.png").exists())
            self.assertFalse((out / "06.png").exists())
            self.assertFalse((out / "09.png").exists())
            self.assertTrue((out / "04.png").exists())
            self.assertTrue((out / "keep.txt").exists())

    def test_nine_templates_move_only_content(self):
        data = json.loads((ROOT / "examples/layouts.json").read_text())
        self.assertEqual({e["card"]["layout"] for e in data["templates"]}, LAYOUTS)
        bounds = {"cover": (510, 1140), "story": (334, 1140), "points": (350, 1120),
                  "numbers": (318, 1140), "compare": (390, 1120), "closing": (350, 1120),
                  "stat": (334, 1120), "steps": (334, 1120), "quote": (334, 1120)}
        for entry in data["templates"]:
            with self.subTest(layout=entry["card"]["layout"]):
                card = copy.deepcopy(entry["card"])
                def render():
                    return self.renderer.card(card, ROOT / "examples", 1, 9, entry["mode"], data["source"], data["topic"], data["date"])
                top, bottom = bounds[card["layout"]]
                card["content"] = {"top": top, "height": bottom - top}
                original = render()
                card["content"] = {"top": top + 10, "height": bottom - top - 10}
                changed = render()
                for region in ((0, 0, 1080, top), (0, 1160, 1080, 1350)):
                    self.assertIsNone(ImageChops.difference(original.crop(region), changed.crop(region)).getbbox())
                self.assertIsNotNone(ImageChops.difference(original, changed).getbbox())
        steps = next(e["card"] for e in data["templates"] if e["card"]["layout"] == "steps")
        for count in (1, 2, 4, 5):
            card = copy.deepcopy(steps)
            card["items"] = [copy.deepcopy(steps["items"][0]) for _ in range(count)]
            if count in (2, 4):
                self.renderer.card(card, ROOT / "examples", 1, 4, "news", data["source"], data["topic"], data["date"])
            else:
                with self.assertRaisesRegex(ValueError, "2~4"):
                    self.renderer.card(card, ROOT / "examples", 1, 4, "news", data["source"], data["topic"], data["date"])

    def test_content_boundaries_and_overflow(self):
        for content in ({"top": 200}, {"height": 900}, {"height": 0},
                        {"top": 450.5}, {"width": 900}):
            data = copy.deepcopy(self.news)
            data["cards"][1]["content"] = content
            self.fails(data, "콘텐츠|content")
        data["cards"][1]["composition"] = "stacked"
        data["cards"][1]["content"] = {"top": 450, "height": 30}
        self.fails(data, "넘침")

    def test_small_art_stays_in_allocated_slot(self):
        data = copy.deepcopy(self.news)
        card = data["cards"][1]
        card["composition"] = "stacked"
        card["content"] = {"top": 370, "height": 700}
        card["art_box"] = [300, 760, 480, 260]
        self.renderer.deck(data, ROOT / "examples")
        card["art_box"] = [300, 500, 480, 260]
        self.fails(data, "그림 슬롯")
        card["art_box"] = [300, 1100, 480, 260]
        self.fails(data, "콘텐츠")

    def test_story_compositions_and_text_only(self):
        base = copy.deepcopy(self.news["cards"][1])
        images = []
        for composition in ("stacked", "visual", "split", "text"):
            card = copy.deepcopy(base)
            card["composition"] = composition
            if composition == "text":
                card.pop("art")
                card["statement"] = "시연과 실사용은 다르다"
            images.append(self.renderer.card(card, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10"))
        for image in images[1:]:
            self.assertIsNone(ImageChops.difference(images[0].crop((0, 0, 1080, 128)),
                                                    image.crop((0, 0, 1080, 128))).getbbox())
            self.assertIsNotNone(ImageChops.difference(images[0], image).getbbox())
        base.pop("art")
        base["composition"] = "visual"
        with self.assertRaisesRegex(ValueError, "art"):
            self.renderer.card(base, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")
        base["composition"] = "unknown"
        with self.assertRaisesRegex(ValueError, "composition"):
            self.renderer.card(base, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")

    def test_title_scale_and_safe_content(self):
        base = copy.deepcopy(self.news["cards"][1])
        base["title"] = "새로운 기술"
        for style in ("display", "standard", "quiet"):
            base["title_style"] = style
            self.renderer.card(base, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")
        base["title_style"] = "display"
        base["content"] = {"top": 300, "height": 800}
        with self.assertRaisesRegex(ValueError, "제목"):
            self.renderer.card(base, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")
        base.pop("content")
        base["title"] = "첫 줄\n둘째 줄\n셋째 줄"
        with self.assertRaisesRegex(ValueError, "넘침"):
            self.renderer.card(base, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")

    def test_points_adapt_and_emphasis_is_optional(self):
        base = copy.deepcopy(self.news["cards"][2])
        for count in (1, 2, 3):
            card = copy.deepcopy(base)
            card["items"] = card["items"][:count]
            normal = self.renderer.card(card, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")
            card["items"][0]["emphasis"] = True
            emphasized = self.renderer.card(card, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")
            self.assertIsNotNone(ImageChops.difference(normal, emphasized).getbbox())
        base["items"] *= 2
        with self.assertRaisesRegex(ValueError, "1~3"):
            self.renderer.card(base, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")

    def test_section_can_span_pages_without_merging(self):
        data = copy.deepcopy(self.news)
        # 같은 의미 섹션을 세 장으로 확장하되 최대 7장 계약은 지킨다.
        data["cards"] = [data["cards"][0]] + [data["cards"][1]] * 3 + [data["cards"][2], data["cards"][3], data["cards"][-1]]
        self.assertEqual(len(self.renderer.deck(data, ROOT / "examples")), 7)

    def test_stat_unit_and_overflow(self):
        entries = json.loads((ROOT / "examples/layouts.json").read_text())["templates"]
        card = copy.deepcopy(next(e["card"] for e in entries if e["card"]["layout"] == "stat"))
        def render():
            return self.renderer.card(card, ROOT / "examples", 1, 4, "news", "샘플", "AI 작업 도구", "2026-10-10")
        render()
        card.pop("unit")
        card["value"] = "2.4배"
        render()
        card.update(value="2.4", unit="")
        with self.assertRaisesRegex(ValueError, "단위"):
            render()
        card.update(value="1234567890", unit="배")
        with self.assertRaisesRegex(ValueError, "폭 넘침"):
            render()

    def test_header_reuses_pixel_mark_and_footer_metadata(self):
        card = self.news["cards"][1]
        with patch.object(self.renderer, "text", wraps=self.renderer.text) as text:
            image = self.renderer.card(card, ROOT / "examples", 2, 6, "news", "샘플",
                                       "AI 작업 도구", "2026-10-10")
        calls = text.call_args_list
        for value, y in (("02 / 06", 102), ("샘플", 1270), ("2026.10.10", 1270)):
            call = next(c for c in calls if c.args[1] == value)
            self.assertEqual(call.args[2][1], y)
        # 기존 외곽 모서리를 보존하고 중심만 민트로 채운다.
        silhouette = Image.new("1", (41, 53))
        silhouette.paste(body_mask(), (1, 1))
        boundary = silhouette.filter(ImageFilter.MaxFilter(3))
        mark = image.crop((84, 62, 125, 115))
        for y in range(53):
            for x in range(41):
                if silhouette.getpixel((x, y)):
                    self.assertEqual(mark.getpixel((x, y)), (143, 227, 180))
                elif boundary.getpixel((x, y)):
                    self.assertEqual(mark.getpixel((x, y)), (47, 107, 87))
        halo_colors = {color for _, color in image.crop((80, 58, 129, 119)).getcolors()}
        self.assertEqual(len(halo_colors), 7)  # 민트·선·배경과 바깥 4단계
        font = ImageFont.truetype(str(self.renderer.bold_font), 26,
                                  index=self.renderer.bold_index)
        for value in (card["eyebrow"], "02 / 06"):
            call = next(c for c in calls if c.args[1] == value)
            x, _, width, _ = call.args[2]
            self.assertEqual(x + width, 996)
            self.assertEqual(width, math.ceil(font.getlength(value)))
            self.assertTrue(call.kwargs["bold"])
        page = next(c for c in calls if c.args[1] == "02 / 06")
        strip_x = page.args[2][0] - 24 - (6 * 18 + 5 * 6)
        for i, color in enumerate(((157, 124, 255), (18, 15, 30))):
            self.assertEqual(image.getpixel((strip_x + i * 24 + 9, 116)), color)
        for i in range(2, 6):
            self.assertEqual(image.getpixel((strip_x + i * 24, 112)), (185, 179, 214))
            self.assertEqual(image.getpixel((strip_x + i * 24 + 9, 116)), (244, 241, 232))
        gap = image.crop((page.args[2][0] - 23, 110, page.args[2][0], 121))
        self.assertEqual(gap.getcolors(), [(gap.width * gap.height, (244, 241, 232))])
        self.assertFalse(any(c.args[2][1] == 1170 or c.args[1] == "AI 작업 도구" for c in calls))
        title = next(c for c in calls if c.args[1] == card["title"])
        self.assertTrue(title.kwargs["bold"])

    def test_footer_requires_real_date_and_topic(self):
        for date in ("2026-02-30", "2026.10.10", "20261010", "2026-W41-6", "", None):
            data = copy.deepcopy(self.news)
            data["date"] = date
            self.fails(data, "date")
        data = copy.deepcopy(self.news)
        data["topic"] = ""
        self.fails(data, "topic")

    def test_number_badge_is_centered_and_matches_steps(self):
        image = self.renderer.deck(self.news, ROOT / "examples")[2]
        badge = image.crop((108, 508, 180, 562))
        self.assertEqual(badge.getpixel((0, 0)), (47, 107, 87))
        mask = Image.new("1", badge.size)
        for y in range(badge.height):
            for x in range(badge.width):
                if badge.getpixel((x, y)) == (244, 241, 232):
                    mask.putpixel((x, y), 1)
        bounds = mask.getbbox()
        self.assertIsNotNone(bounds)
        x0, y0, x1, y1 = bounds
        self.assertLessEqual(abs((x0 + x1) / 2 - 36), 3)
        self.assertLessEqual(abs((y0 + y1) / 2 - 27), 3)

    def test_closing_uses_reels_character_without_repainting(self):
        card = copy.deepcopy(self.news["cards"][-1])
        card["content"] = {"top": 350, "height": 770}
        image = self.renderer.card(card, ROOT / "examples", 6, 6, "news", "샘플", "주제", "2026-10-10")
        expected = sprite("sparkle")
        expected = expected.resize((expected.width * 4, expected.height * 4), Image.Resampling.NEAREST)
        y0 = 874 - 24 - expected.height
        for y in range(expected.height):
            for x in range(expected.width):
                rgba = expected.getpixel((x, y))
                if rgba[3] == 255:
                    self.assertEqual(image.getpixel((808 + x, y0 + y)), rgba[:3])

    @patch("render.paper_background", side_effect=lambda layout, top: Image.new("RGB", (1080, 1350), BG))
    def test_optical_center_moves_whole_group_without_repainting(self, paper):
        data = json.loads((ROOT / "examples/layouts.json").read_text())
        tops = {"story": 334, "closing": 350, "stat": 334, "quote": 334}
        for entry in data["templates"]:
            card = copy.deepcopy(entry["card"])
            if card["layout"] not in tops:
                continue
            with self.subTest(layout=card["layout"]):
                top = tops[card["layout"]]
                bottom = 1140 if card["layout"] == "story" else 1120
                automatic = self.renderer.card(card, ROOT / "examples", 1, 9, entry["mode"],
                                               data["source"], data["topic"], data["date"])
                region = automatic.crop((84, top, 997, bottom))
                bounds = ImageChops.difference(region, Image.new("RGB", region.size, BG)).getbbox()
                used = bounds[3] - bounds[1]
                self.assertLessEqual(abs(bounds[1] - (bottom - top - used) * 0.42), 1)
                card["content"] = {"top": top, "height": bottom - top}
                manual = self.renderer.card(card, ROOT / "examples", 1, 9, entry["mode"],
                                            data["source"], data["topic"], data["date"])
                old_region = manual.crop((84, top, 997, bottom))
                old_bounds = ImageChops.difference(old_region, Image.new("RGB", old_region.size, BG)).getbbox()
                self.assertIsNone(ImageChops.difference(region.crop(bounds), old_region.crop(old_bounds)).getbbox())

    def test_editorial_text_contrast_and_quote_marks(self):
        data = json.loads((ROOT / "examples/layouts.json").read_text())
        for entry in data["templates"]:
            card = entry["card"]
            if card["layout"] not in ("points", "steps", "numbers", "compare", "closing", "quote"):
                continue
            with patch.object(self.renderer, "text", wraps=self.renderer.text) as text:
                self.renderer.card(card, ROOT / "examples", 1, 9, entry["mode"],
                                   data["source"], data["topic"], data["date"])
            calls = text.call_args_list
            if card["layout"] in ("points", "steps"):
                for item in card["items"]:
                    call = next(c for c in calls if c.args[1] == item["body"])
                    self.assertEqual(call.args[3:5], (38, TEXT))
            elif card["layout"] == "numbers":
                for row in card["rows"]:
                    self.assertTrue(any(c.args[1] == row["criterion"] for c in calls))
                    for value in row["values"]:
                        call = next(c for c in calls if c.args[1] == f"{value:g}{row['unit']}")
                        self.assertEqual(call.args[4], TEXT)
            elif card["layout"] == "compare":
                for col in card["columns"]:
                    call = next(c for c in calls if c.args[1] == col["name"])
                    self.assertEqual(call.args[4], TEXT)
            elif card["layout"] == "closing":
                call = next(c for c in calls if c.args[1] == card["statement"])
                self.assertEqual(call.kwargs["line_colors"], [MINT])
                self.assertFalse(any(c.args[1] == "“" for c in calls))
            else:
                statement = card["statement"][1:-1]
                self.assertTrue(any(c.args[1] == statement for c in calls))

    def test_sample_diagram_and_icons_share_four_pixel_grid(self):
        data = json.loads((ROOT / "examples/layouts.json").read_text())
        for index in (1, 2, 4):
            entry = data["templates"][index]
            with patch.object(self.renderer, "art", wraps=self.renderer.art) as art:
                self.renderer.card(entry["card"], ROOT / "examples", 1, 9, entry["mode"],
                                   data["source"], data["topic"], data["date"])
            for call in art.call_args_list:
                with Image.open(call.args[1]) as source:
                    width, height = call.args[2][2:]
                    self.assertEqual(min(width // source.width, height // source.height), 4)

    def test_paper_is_repeatable_and_keeps_type_art_and_metadata(self):
        data = json.loads((ROOT / "examples/layouts.json").read_text())
        solid = Image.new("RGB", (1080, 1350), BG)
        for i, entry in enumerate(data["templates"]):
            card = entry["card"]
            def render():
                return self.renderer.card(card, ROOT / "examples", i + 1, 9, entry["mode"],
                                          data["source"], data["topic"], data["date"])
            with self.subTest(layout=card["layout"]):
                textured = render()
                self.assertIsNone(ImageChops.difference(textured, render()).getbbox())
                with patch("render.paper_background", return_value=solid):
                    flat = render()
                difference = ImageChops.difference(flat, textured)
                self.assertLessEqual(max(high for low, high in difference.getextrema()), 36)
                # 산세리프 가장자리의 반투명 픽셀만 새 종이에 자연스럽게 합성한다.
                for color in (TEXT, MINT, "#2F6B57", "#9D7CFF", "#221C38", "#625E70", "#B9B3D6"):
                    channels = ImageChops.difference(flat, Image.new("RGB", flat.size, color)).split()
                    ink = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
                    ink = ink.point(lambda value: 0 if value else 255)
                    self.assertIsNone(ImageChops.multiply(difference, Image.merge("RGB", (ink, ink, ink))).getbbox())
                for region in ((0, 0, 1080, 280), (0, 1240, 1080, 1350)):
                    self.assertIsNone(ImageChops.difference(flat.crop(region), textured.crop(region)).getbbox())
                self.assertIsNotNone(ImageChops.difference(flat, textured).getbbox())
        # 어두운 패널과 배지의 아이보리 글자도 배경 질감으로 덮지 않는다.
        for original, region in ((self.news["cards"][-1], (100, 400, 980, 850)),
                                 (self.news["cards"][2], (108, 508, 181, 563))):
            card = copy.deepcopy(original)
            card["content"] = {"top": 350, "height": 770}
            def render():
                return self.renderer.card(card, ROOT / "examples", 1, 6, "news", "샘플", "주제", "2026-10-10")
            textured = render()
            with patch("render.paper_background", return_value=solid):
                flat = render()
            self.assertIsNone(ImageChops.difference(flat.crop(region), textured.crop(region)).getbbox())

    def test_integrated_frame_preserves_content_and_updates_page_metadata(self):
        deck = {"mode": "news", "source": "공식 발표", "topic": "제품", "date": "2026-10-10",
                "cards": [{"eyebrow": "TECH NEWS"}, {"eyebrow": "TECH NEWS"}]}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            for i in (1, 2):
                Image.new("RGB", (1080, 1350), "#FF0000").save(out / f"{i:02d}.png")
            images = finalize(deck, out, self.renderer)
            for i, image in enumerate(images, 1):
                self.assertEqual(image.getpixel((540, 700)), (255, 0, 0))
                frame = self.renderer.frame(deck["cards"][i - 1], i, 2, "news", deck["source"], "제품", deck["date"])
                for box in ((0, 0, 1080, 160), (0, 1240, 1080, 1350)):
                    self.assertIsNone(ImageChops.difference(image.crop(box), frame.crop(box)).getbbox())
                with Image.open(out / "mobile" / f"{i:02d}.png") as mobile:
                    self.assertEqual(mobile.size, (390, 488))
            self.assertIsNotNone(ImageChops.difference(images[0].crop((700, 90, 996, 140)),
                                                     images[1].crop((700, 90, 996, 140))).getbbox())

    def test_dnf_width_and_wrap_use_output_font_size(self):
        for size in (60, 72, 120):
            font = ImageFont.truetype(str(TITLE_FONT), size)
            width = pixel_width("시온", font)
            self.assertEqual(width, max(math.ceil(font.getlength("시온")), font.getbbox("시온", anchor="lt")[2]))
            height = size + round(size * 7 / 6)
            image = Image.new("RGB", (width, height), "white")
            self.assertEqual(self.renderer.text(image, "시온", (0, 0, width, height), size,
                                                bold=True, pixel="title"), size)
            with self.assertRaisesRegex(ValueError, "넘침"):
                self.renderer.text(image, "시온", (0, 0, width - 1, size), size,
                                   bold=True, pixel="title")

    def test_dnf_headline_has_original_weight_and_binary_pixels(self):
        self.assertEqual(ImageFont.truetype(str(TITLE_FONT), 72).getname(), ("DNF Bit Bit v2", "Regular"))
        self.assertEqual(TITLE_FONT, PIXEL_FONT)
        image = Image.new("RGB", (240, 108), "white")
        regular = image.copy()
        self.renderer.text(regular, "시온", (0, 0, 240, 108), 72, pixel=True, lead_color="#2F6B57")
        self.renderer.text(image, "시온", (0, 0, 240, 108), 72, bold=True, pixel="title", lead_color="#2F6B57")
        self.assertIsNone(ImageChops.difference(regular, image).getbbox())
        self.assertEqual({color for _, color in image.getcolors()}, {(255, 255, 255), (47, 107, 87)})


if __name__ == "__main__":
    unittest.main()
