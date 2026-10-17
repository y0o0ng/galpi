"""형식 2(애니메이션 중심 4px) 회귀: 격자·출력·글자 헬퍼·시간 계약·확장 팔레트·엔딩. 옛 5px 형식은 test_subtitles·test_legacy_frames가 지킨다."""
import copy
import json
import math
import runpy
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from px import engine as E, lint, templates as T  # noqa: E402
from px.timeline import tween  # noqa: E402

NAR = {"format_version": 2, "hook": "질문", "palette": [], "principle": ["가나다", "라마바"], "bgm": "bright",
       "scenes": {"a": {"screen_text": ["질문", "라벨"]}, "b": {"screen_text": ["수치"]}}}
SCN = [{"id": "a", "duration": 3.0, "events": {"hit": 1.0}, "texts": [{"text": "질문", "start": 0.2, "end": 3.0}]},
       {"id": "b", "duration": 2.0, "texts": [{"text": "수치", "start": 0.5, "end": 1.5}]}]


def make(nar=None, scn=None, draw=None, ids=("a", "b")):
    """임시 폴더에 형식 2 편을 만들어 Episode를 돌려준다(폴더는 호출 동안만 있으면 된다 — 데이터는 생성자가 다 읽는다)."""
    with tempfile.TemporaryDirectory() as tmp:
        here = Path(tmp)
        (here / "narration.ko.json").write_text(json.dumps(NAR if nar is None else nar))
        (here / "scenes.json").write_text(json.dumps(SCN if scn is None else scn))
        return T.Episode(here, ids, draw or {"a": scene_a, "b": scene_b}, "ep98_test")


def scene_a(img, d, t, ta, S):
    S.say(img, t, "질문")
    E.say(img, "라벨", "label", (112, 200))


def scene_b(img, d, t, ta, S):
    S.say(img, t, "수치", "number")


class Base(unittest.TestCase):
    def tearDown(self):
        E.use_format(1)
        E.start_texts(None)


class GridTest(Base):
    def test_constants_and_physical_position(self):
        E.use_format(2)
        self.assertEqual((E.W, E.H, E.SCALE, E.SAFE_OFFSET, E.EXT_W, E.EXT_H), (225, 400, 4, (15, 50), 270, 480))
        self.assertEqual((E.OUT_W, E.OUT_H), (1080, 1920))
        img = Image.new("RGB", (E.W, E.H), E.BG)
        img.putpixel((0, 0), (255, 255, 255))
        img.putpixel((E.W - 1, E.H - 1), (255, 0, 0))
        arr = E.to_output(img)
        self.assertEqual(arr.shape, (1920, 1080, 3))
        self.assertTrue((arr[200, 60] == 255).all())                       # 장면 (0,0) → 출력 (60, 200), 옛 형식과 같은 물리 위치
        self.assertTrue((arr[200 + 399 * 4, 60 + 224 * 4] == (255, 0, 0)).all())   # 장면 끝 → (956, 1796) = 안전 영역 960·1800 안
        self.assertTrue(lint.check_output(arr, E.SCALE))
        self.assertEqual(E.FPS_OUT, 24)

    def test_exact_4x_nearest_blocks_with_scanline(self):
        E.use_format(2)
        img = Image.new("RGB", (E.W, E.H), E.BG)
        img.putpixel((10, 10), (200, 100, 50))
        arr = E.to_output(img)
        x, y = (15 + 10) * 4, (50 + 10) * 4
        block = arr[y:y + 4, x:x + 4]
        self.assertTrue((block[:3] == [200, 100, 50]).all())               # 위 세 줄은 같은 색
        self.assertTrue((block[3] == (np.array([200, 100, 50]) * E.SCANLINE).astype(np.uint8)).all())   # 마지막 줄만 주사선
        bad = arr.copy()
        bad[y + 1, x + 1] = (1, 2, 3)                                      # 도트 크기가 섞이면 출력 lint가 잡는다
        self.assertFalse(lint.check_output(bad, E.SCALE))

    def test_bayer_seam_is_continuous_at_odd_offset(self):
        """오프셋 (15, 50)은 4의 배수가 아니지만 배경 디더를 장면 좌표로 계산하므로 장면 안팎이 같은 공식이다."""
        E.use_format(2)
        ox, oy = E.SAFE_OFFSET
        ext = E.ext_background()
        self.assertEqual(ext.shape, (480, 270, 3))
        self.assertTrue((ext[oy:oy + E.H, ox:ox + E.W] == np.asarray(E.background())).all())
        dither = np.array([int(E.DITHER[i:i + 2], 16) for i in (1, 3, 5)])
        for y in (oy + E.H, oy + E.H + 7, E.EXT_H - 1):                    # 장면 아래 여백: 마지막 농도, 같은 Bayer 위상
            for x in (0, 3, ox - 1, ox + E.W, E.EXT_W - 1):
                level = (E.H - 1 - E.DITHER_FROM) / (E.H - E.DITHER_FROM) * 17
                self.assertEqual(bool((ext[y, x] == dither).all()), bool(E.BAYER[(y - oy) % 4, (x - ox) % 4] < level))
        self.assertTrue((ext[0] == [0x12, 0x0F, 0x1E]).all())              # 위쪽 여백은 단색

    def test_camera_moves_on_integer_coordinates(self):
        pos = [tween(i / 24, 0, 2, 0, 41, rnd=True) for i in range(49)]
        self.assertTrue(all(isinstance(p, int) for p in pos))
        self.assertEqual((pos[0], pos[-1]), (0, 41))

    def test_format_switch_is_reversible_and_checked(self):
        before = (E.W, E.H, E.SCALE, E.SAFE_OFFSET, E.DITHER_FROM, E.FONT["label"].size)
        E.use_format(2)
        self.assertEqual(E.FONT["label"].size, 12)                         # 형식 2 라벨은 Galmuri11 12px(48px)
        self.assertEqual((E.FONT["stmt"].size, E.FONT["stmt"].getname()[0]), (14, "Galmuri14"))
        E.use_format(1)
        self.assertEqual((E.W, E.H, E.SCALE, E.SAFE_OFFSET, E.DITHER_FROM, E.FONT["label"].size), before)
        with self.assertRaises(ValueError):
            E.use_format(3)

    def test_unversioned_episode_is_legacy_5px(self):
        E.use_format(2)                                                    # 앞 편이 남긴 전역도 버전 표기 없는 편이 되돌린다
        with tempfile.TemporaryDirectory() as tmp:
            here = Path(tmp)
            (here / "narration.ko.json").write_text(json.dumps({"scenes": {"s": ["안녕."]}}))
            (here / "scenes.json").write_text(json.dumps([{"id": "s", "min": 3.0}]))
            ep = T.Episode(here, ("s",), {"s": lambda *a: None}, "ep98_old")
        self.assertEqual((ep.version, E.W, E.SCALE), (1, 180, 5))
        self.assertIsNone(E._TEXTS)


class TextTest(Base):
    def setUp(self):
        E.use_format(2)
        E.start_texts({"가나", "다라", "마바"})

    def test_unapproved_text_fails(self):
        img = Image.new("RGB", (E.W, E.H), E.BG)
        with self.assertRaises(ValueError):
            E.say(img, "승인되지 않은 문구")

    def test_direct_text_is_blocked_but_say_works(self):
        img = Image.new("RGB", (E.W, E.H), E.BG)
        with self.assertRaises(RuntimeError):
            E.text(img, (10, 10), "가나")
        E.say(img, "가나")
        self.assertTrue(np.any(np.asarray(img) != np.array([0x12, 0x0F, 0x1E])))

    def test_statement_lines_and_safe_area(self):
        img = Image.new("RGB", (E.W, E.H), E.BG)
        E.start_texts({"가 " * 5, "가 " * 40, "라벨"})
        E.say(img, "가 " * 5)                                                  # 한 줄
        with self.assertRaises(ValueError) as cm:
            E.say(img, "가 " * 40)                                             # 두 줄 초과
        self.assertIn("최대 2줄", str(cm.exception))
        with self.assertRaises(ValueError):
            E.say(img, "라벨", "label", (5, 100))                              # 안전 영역 왼쪽 밖
        with self.assertRaises(ValueError):
            E.say(img, "라벨", "label", (112, 380))                            # 아래 가림 영역
        with self.assertRaises(ValueError):
            E.say(img, "라벨", "label")                                        # 라벨은 대상 옆 좌표가 필요
        E.say(img, "라벨", "label", (112, 100))

    def test_text_sizes_follow_the_table(self):
        """진술 Galmuri14 → 56px, 라벨 Galmuri11 → 48px, 큰 수치 Galmuri11-Bold 2배 → 96px (도트 14·12·24 x 4)."""
        self.assertEqual(E.FONT_H["stmt"] * E.SCALE, 56)
        self.assertEqual(E.FONT_H["label"] * E.SCALE, 48)
        self.assertEqual(E.FONT_H["bold"] * 2 * E.SCALE, 96)
        self.assertEqual(E.FONT["bold"].getname(), ("Galmuri11", "Bold"))

    def test_undrawn_approved_text_is_reported(self):
        img = Image.new("RGB", (E.W, E.H), E.BG)
        E.say(img, "가나")
        self.assertEqual(E.undrawn_texts(), ["다라", "마바"])
        E.say(img, "다라"), E.say(img, "마바")
        self.assertEqual(E.undrawn_texts(), [])


class TimelineTest(Base):
    def fails(self, nar=None, scn=None, ids=("a", "b")):
        with self.assertRaises(ValueError) as cm:
            make(nar, scn, ids=ids)
        return str(cm.exception)

    def test_scene_length_is_duration_not_text_length(self):
        short, long_ = copy.deepcopy(NAR), copy.deepcopy(NAR)
        long_["scenes"]["a"]["screen_text"] = ["질문", "라벨", "아주 아주 긴 설명 문구가 여기에 들어 있어도 장면 시간은 그대로다"]
        a, b = make(short), make(long_)
        self.assertEqual([s.length for s in a.scenes], [3.0, 2.0, T.END_LEN])
        self.assertEqual([s.length for s in b.scenes], [s.length for s in a.scenes])
        self.assertAlmostEqual(a.total, 3.0 + 2.0 + 4.2)
        self.assertEqual(a.starts, [0, 3.0, 5.0])

    def test_no_cards_and_no_body_typing(self):
        ep = make()
        self.assertTrue(all(s.plan == [] and s.sents == [] for s in ep.scenes))
        _, typing, *_ = ep.sound()
        self.assertEqual(float(np.abs(typing[:int(ep.starts[-1] * 44100)]).max()), 0.0)   # 본편에는 자동 타자음이 없다
        self.assertGreater(float(np.abs(typing[int(ep.starts[-1] * 44100):]).max()), 0.0)  # 엔딩 타자음은 유지

    def test_fail_close_on_missing_or_bad_time(self):
        bad_dur = lambda v: [dict(SCN[0], duration=v), SCN[1]]
        for v in (0, -1, "3", None, True):
            self.assertIn("duration", self.fails(scn=bad_dur(v)))
        no_dur = [{k: v for k, v in SCN[0].items() if k != "duration"}, SCN[1]]
        self.assertIn("duration", self.fails(scn=no_dur))
        self.assertIn("min", self.fails(scn=[dict(SCN[0], min=3.0), SCN[1]]))      # 구버전 min과 혼동하지 않는다
        self.assertIn("events", self.fails(scn=[dict(SCN[0], events={"hit": 3.5}), SCN[1]]))

    def test_text_windows_stay_inside_scene_and_approved(self):
        win = lambda **kw: [dict(SCN[0], texts=[dict(SCN[0]["texts"][0], **kw)]), SCN[1]]
        self.assertIn("표시 구간", self.fails(scn=win(end=3.5)))
        self.assertIn("표시 구간", self.fails(scn=win(start=-0.1)))
        self.assertIn("표시 구간", self.fails(scn=win(start=2.0, end=2.0)))
        self.assertIn("승인 문구", self.fails(scn=win(text="승인 안 됨")))

    def test_scene_set_and_hook_must_match(self):
        self.assertIn("장면", self.fails(scn=[SCN[0]]))
        self.assertIn("scenes", self.fails(nar=dict(NAR, scenes={"a": NAR["scenes"]["a"]})))
        self.assertIn("hook", self.fails(nar=dict(NAR, hook="어디에도 없는 질문")))
        legacy_style = dict(NAR, scenes={"a": ["문장."], "b": ["문장."]})
        self.assertIn("screen_text", self.fails(nar=legacy_style))

    def test_total_over_90_seconds_fails(self):
        self.assertIn("90", self.fails(scn=[dict(SCN[0], duration=86.0, events={}), SCN[1]]))

    def test_sfx_times_must_be_inside_scene(self):
        def late(img, d, t, ta, S):
            S.sfx = [(S.events["hit"], "pop", "event"), (3.5, "pop", "event")]
        ep = make(draw={"a": late, "b": scene_b})
        with self.assertRaises(ValueError):
            ep.sound()

    def test_sfx_follows_event_time(self):
        def hit(img, d, t, ta, S):
            S.sfx = [(S.events["hit"], "thud", "event")]
        ep = make(draw={"a": hit, "b": scene_b})
        kept = ep.sound()[3]
        self.assertIn((1.0, "thud", "event"), [e[:3] for e in kept])


class PaletteTest(Base):
    def test_role_ranges_and_boundaries(self):
        ok = lambda L, C, h, role: E.range_violations(L, C, h, role) == []
        self.assertTrue(ok(0.18, 0.083, 100, "환경") and ok(0.60, 0.083, 100, "환경"))       # 경계 정확히 통과
        self.assertFalse(ok(0.1799, 0.05, 100, "환경") or ok(0.6001, 0.05, 100, "환경") or ok(0.3, 0.0831, 100, "환경"))
        self.assertTrue(ok(0.958, 0.106, 100, "물체·재질") and ok(0.958, 0.106, 100, "구조·연결부"))
        self.assertFalse(ok(0.9581, 0.05, 100, "물체·재질") or ok(0.5, 0.1061, 100, "구조·연결부"))
        self.assertTrue(ok(0.5, 0.187, 150, "정보 비교") and ok(0.5, 0.187, 150, "핵심 변화") and ok(0.5, 0.187, 150, "강조"))
        self.assertFalse(ok(0.5, 0.1871, 150, "강조"))
        self.assertTrue(any("역할" in m for m in E.range_violations(0.5, 0.05, 100, "배경")))

    def test_nothing_more_saturated_than_danger(self):
        _, danger_c, danger_h = E.oklch(E.DANGER)
        self.assertAlmostEqual(danger_c, 0.213, places=3)
        self.assertTrue(any("채도" in m for m in E.range_violations(0.6, danger_c + 0.001, 150, "강조")))

    def test_danger_neighbourhood_is_capped(self):
        _, _, h = E.oklch(E.DANGER)
        near = lambda dh, C: E.range_violations(0.6, C, h + dh, "강조")
        self.assertEqual(near(0, 0.15), [])                                    # 경계 통과
        self.assertTrue(near(0, 0.1501) and near(25, 0.16) and near(-25, 0.16))
        self.assertEqual(near(25.5, 0.16), [])                                 # 밖은 일반 역할 상한만
        self.assertEqual(near(60, 0.18), [])

    def test_declaration_needs_role_and_range(self):
        with self.assertRaises(ValueError):
            E.declare_colors([{"color": "#4D3B2C"}])
        with self.assertRaises(ValueError):
            E.declare_colors([{"color": "#4D3B2C", "role": ""}])
        with self.assertRaises(ValueError) as cm:
            E.declare_colors([{"color": "#C8502B", "role": "핵심 변화"}])     # DANGER 근처인데 C 0.161 > 0.15
        for token in ("#C8502B", "핵심 변화", "L ", "C ", "DANGER"):
            self.assertIn(token, str(cm.exception))
        with self.assertRaises(ValueError):
            E.declare_colors([{"color": "#CFE9F2", "role": "환경"}])           # 밝은 색은 환경색이 못 된다(L 0.918 > 0.60)
        self.assertEqual(E.declare_colors([{"color": "#4D3B2C", "role": "환경"}, {"color": "#CFE9F2", "role": "정보 비교"}]),
                         ("#4D3B2C", "#CFE9F2"))

    def test_exempt_colors_skip_the_range_check_and_keep_values(self):
        for c in (E.BG, E.INK, E.DEEP, E.PURPLE, E.TEXT, E.DANGER, *E.SPRITE_COLORS, *E.PEOPLE_COLORS, *E.FIRE_COLORS):
            self.assertEqual(E.declare_colors([{"color": c, "role": "환경"}]), ())   # 환경 범위 밖이어도 통과, 새 색은 아니다
        self.assertEqual((E.BG, E.INK, E.DEEP, E.PURPLE, E.TEXT, E.DANGER), ("#120F1E", "#8FE3B4", "#2F6B57", "#9D7CFF", "#F4F1E8", "#FF4D5E"))
        self.assertEqual(E.FIRE_COLORS, ("#FFE7A3", "#FFB03B", "#E8572E"))

    def test_episode_rejects_bad_declaration_before_render(self):
        with self.assertRaises(ValueError) as cm:
            make(dict(NAR, palette=[{"color": "#C8502B", "role": "강조"}]))
        self.assertIn("#C8502B", str(cm.exception))
        with self.assertRaises(ValueError):
            make(dict(NAR, palette=[{"color": "#4D3B2C"}]))

    def test_palette_is_per_episode(self):
        a = make(dict(NAR, palette=[{"color": "#4D3B2C", "role": "환경"}]))
        b = make(dict(NAR, palette=[{"color": "#26324A", "role": "환경"}]))
        img = Image.new("RGB", (8, 8), "#4D3B2C")
        self.assertEqual(lint.check_canvas(img, a.palette)[0], 0)
        self.assertGreater(lint.check_canvas(img, b.palette)[0], 0)        # 편 A의 확장색은 편 B에 자동 허용되지 않는다
        self.assertGreater(lint.check_canvas(img, E.PALETTE)[0], 0)        # 선언이 없으면 옛 고정 팔레트 검사 그대로
        self.assertEqual(lint.check_canvas(Image.new("RGB", (8, 8), E.INK), b.palette)[0], 0)


class EndingTest(Base):
    def test_ending_is_four_point_two_seconds_with_same_beats(self):
        ep = make()
        self.assertEqual(ep.scenes[-1].length, 4.2)
        self.assertEqual((T.T_JINGLE, T.T_STAMP, T.T_TYPED, T.T_LABEL), (1.55, 2.3, 1.4, 1.5))
        ending = ep.scenes[-1]
        ep.frame(round((ep.starts[-1] + 3.0) * 24))
        self.assertEqual(ending.sfx, [(1.55, "jingle"), (2.3, "stamp")])

    def test_stamp_shakes_one_dot_and_frames_pass_lint(self):
        ep = make(dict(NAR, principle_label="LABEL"))
        i = math.ceil((ep.starts[-1] + T.T_STAMP) * 24 - 1e-9)       # 도장이 찍히는 첫 프레임
        canvases, arr = ep.compose(i)
        base = E.to_output(ep.frame(i))
        self.assertTrue((arr == np.roll(base, (4, 4), (0, 1))).all())      # 한 도트 = 4px
        self.assertTrue(lint.check_output(arr, E.SCALE))
        self.assertEqual(lint.check_canvas(canvases[0], ep.palette)[0], 0)
        j = i + 2                                                           # 흔들림은 2프레임뿐
        self.assertTrue((ep.compose(j)[1] == E.to_output(ep.frame(j))).all())

    def test_ending_text_fits_the_canvas_and_uses_grid_fonts(self):
        ep = make(dict(NAR, principle=["가나다라마바사아자", "하", "하"], principle_label="LABEL"))
        self.assertLessEqual(E.text_w("가나다라마바사아자", "bold", 2), E.W)           # 한 줄 9자까지(96px 글자)
        self.assertEqual(T.ENDING[2]["stamp"][2:], (78, 42))                  # 도장은 같은 4px 격자에서 도트 수를 늘려 비슷한 물리 크기
        with self.assertRaises(AssertionError):
            make(dict(NAR, principle=["가" * 10]))

    def test_no_card_box_in_body_frames(self):
        ep = make()
        body = ep.frame(1)
        card_box_px = np.asarray(body)[E.CARD_BOX[1]:E.CARD_BOX[3], E.CARD_BOX[0]:E.CARD_BOX[2]]
        self.assertFalse((card_box_px == np.array([int(E.CARD[i:i + 2], 16) for i in (1, 3, 5)])).all(-1).any())


class TrialEpisodesTest(Base):
    """시험 장면 두 편이 데이터 계약을 통과하고 서로의 확장색을 공유하지 않는다."""

    def test_trial_palettes_are_declared_per_episode(self):
        trial = ROOT / "runs" / "animation-first-trial"
        a = runpy.run_path(str(trial / "a_password" / "scene.py"), run_name="trial")["ep"]
        b = runpy.run_path(str(trial / "b_volcano" / "scene.py"), run_name="trial")["ep"]
        self.assertEqual(len(a.palette), len(E.PALETTE))                     # A는 대표색만
        self.assertEqual(set(b.palette) - set(E.PALETTE), {"#26324A", "#4D3B2C", "#7A6350", "#3A3F4F", "#8A8478", "#CFE9F2", "#8F3A27", "#B8573A", "#D0703F"})
        self.assertEqual((a.version, b.version, a.scenes[-1].length), (2, 2, 4.2))


if __name__ == "__main__":
    unittest.main()
