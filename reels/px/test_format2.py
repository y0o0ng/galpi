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

NAR = {"format_version": 2, "hook": "첫 훅", "hook_words": ["첫", "훅"], "palette": [], "principle": ["가나다", "라마바"], "bgm": "bright",
       "scenes": {"a": {"screen_text": ["질문", "라벨"]}, "b": {"screen_text": ["수치"]}}}
SCN = [{"id": "a", "duration": 4.0, "events": {"hit": 1.0}, "texts": [{"text": "질문", "start": 0.2, "end": 3.0}]},
       {"id": "b", "duration": 2.0, "texts": [{"text": "수치", "start": 0.5, "end": 1.5}]}]


def make(nar=None, scn=None, draw=None, ids=("a", "b"), media=None):
    """임시 폴더에 형식 2 편을 만들어 Episode를 돌려준다(폴더는 호출 동안만 있으면 된다 — 데이터는 생성자가 다 읽는다)."""
    with tempfile.TemporaryDirectory() as tmp:
        here = Path(tmp)
        (here / "narration.ko.json").write_text(json.dumps(NAR if nar is None else nar))
        (here / "scenes.json").write_text(json.dumps(SCN if scn is None else scn))
        return T.Episode(here, ids, draw or {"a": scene_a, "b": scene_b}, "ep98_test", media=media)


def scene_a(img, d, t, ta, S):
    T.hook2(img, d, t, ta, S, NAR, lambda *a: None)
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
        comma = "텍사스는 가스 발전이 가장 크고, 석탄도 돌아요."                 # 쉼표 앞 조각이 폭을 넘어 쉼표 규칙만으론 3줄(25편)
        E.start_texts({"가 " * 5, "가 " * 40, "라벨", comma})
        E.say(img, "가 " * 5)                                                  # 한 줄
        with self.assertRaises(ValueError) as cm:
            E.say(img, "가 " * 40)                                             # 두 줄 초과
        self.assertIn("최대 2줄", str(cm.exception))
        self.assertEqual(len(E.split_lines(comma, E.TEXT_SAFE[2] - E.TEXT_SAFE[0] + 1, "stmt")), 3)
        E.say(img, comma)                                                      # 쉼표 규칙 없이 두 줄로 다시 나눠 통과
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
        self.assertEqual([s.length for s in a.scenes], [4.0, 2.0, T.END_LEN])
        self.assertEqual([s.length for s in b.scenes], [s.length for s in a.scenes])
        self.assertAlmostEqual(a.total, 4.0 + 2.0 + 4.2)
        self.assertEqual(a.starts, [0, 4.0, 6.0])

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
        self.assertIn("events", self.fails(scn=[dict(SCN[0], events={"hit": 4.5}), SCN[1]]))

    def test_text_windows_stay_inside_scene_and_approved(self):
        win = lambda **kw: [dict(SCN[0], texts=[dict(SCN[0]["texts"][0], **kw)]), SCN[1]]
        self.assertIn("표시 구간", self.fails(scn=win(end=4.5)))
        self.assertIn("표시 구간", self.fails(scn=win(start=-0.1)))
        self.assertIn("표시 구간", self.fails(scn=win(start=2.0, end=2.0)))
        self.assertIn("승인 문구", self.fails(scn=win(text="승인 안 됨")))

    def test_scene_set_and_hook_must_match(self):
        self.assertIn("장면", self.fails(scn=[SCN[0]]))
        self.assertIn("scenes", self.fails(nar=dict(NAR, scenes={"a": NAR["scenes"]["a"]})))
        self.assertIn("hook", self.fails(nar=dict(NAR, hook="어디에도 없는 질문")))   # hook_words를 이은 것과 다르다
        legacy_style = dict(NAR, scenes={"a": ["문장."], "b": ["문장."]})
        self.assertIn("screen_text", self.fails(nar=legacy_style))

    def test_total_over_90_seconds_fails(self):
        self.assertIn("90", self.fails(scn=[dict(SCN[0], duration=86.0, events={}), SCN[1]]))

    def test_sfx_times_must_be_inside_scene(self):
        def late(img, d, t, ta, S):
            S.sfx = [(S.events["hit"], "pop", "event"), (4.5, "pop", "event")]
        ep = make(draw={"a": late, "b": scene_b})
        with self.assertRaises(ValueError):
            ep.sound()

    def test_sfx_follows_event_time(self):
        def hit(img, d, t, ta, S):
            S.sfx = [(S.events["hit"], "thud", "event")]
        ep = make(draw={"a": hit, "b": scene_b})
        kept = ep.sound()[3]
        self.assertIn((1.0, "thud", "event"), [e[:3] for e in kept])


class RenderGateTest(Base):
    """main()의 렌더 끝 검사: 승인된 문구가 한 번도 안 그려졌으면 실패하고 mp4를 남기지 않는다(ffmpeg 없이 encode를 바꿔 끼워 확인)."""

    def render(self, draw):
        real, calls = E.encode, []

        def fake(frame_fn, n, wav, out, palette=None, glow=()):
            for i in range(0, n, 12):
                frame_fn(i)
            calls.append(palette)
            Path(out).write_bytes(b"x")
            return 0, 0
        E.encode = fake
        try:
            with tempfile.TemporaryDirectory() as media:
                ep = make(draw=draw, media=media)
                try:
                    ep.main()
                    failed = None
                except SystemExit as error:
                    failed = str(error)
                return failed, (Path(media) / "ep98_test.mp4").exists(), calls
        finally:
            E.encode = real

    def test_missing_approved_text_fails_and_removes_mp4(self):
        def only_question(img, d, t, ta, S):
            S.say(img, 1.0, "질문"), E.say(img, "라벨", "label", (112, 200))
        failed, exists, calls = self.render({"a": only_question, "b": lambda *a: None})
        self.assertIn("수치", failed or "")
        self.assertFalse(exists)

    def test_all_texts_drawn_keeps_mp4_and_passes_palette(self):
        failed, exists, calls = self.render({"a": scene_a, "b": lambda img, d, t, ta, S: S.say(img, t, "수치", "number")})
        self.assertIsNone(failed)
        self.assertTrue(exists)
        self.assertEqual(calls, [tuple(E.PALETTE)])                          # 선언한 확장색이 없으면 공용 팔레트 그대로

    def test_labels_are_optional_but_still_approved(self):
        nar = dict(NAR, scenes={"a": {"screen_text": ["질문"], "labels": ["라벨", "통로"]}, "b": {"screen_text": ["수치"]}})
        _, approved, labels = T.load_v2(nar, SCN, ("a", "b"))
        self.assertEqual(labels, {"라벨", "통로"})
        E.start_texts(approved, labels)
        for x in ("질문", "수치", "첫", "훅", "라벨"):
            E.approve(x)
        self.assertEqual(E.undrawn_texts(), [])                              # 안 그린 라벨 "통로"는 실패가 아니다
        with self.assertRaises(ValueError):
            E.approve("마그마방")                                             # 승인 안 된 글자는 여전히 막힌다
        E.start_texts(approved, labels)
        E.approve("라벨")
        self.assertIn("질문", E.undrawn_texts())                              # 진술·수치·훅은 여전히 필수
        self.assertNotIn("통로", E.undrawn_texts())
        with self.assertRaises(ValueError):
            T.load_v2(dict(nar, scenes={"a": {"screen_text": ["질문"], "labels": "라벨"}, "b": {"screen_text": ["수치"]}}), SCN, ("a", "b"))

    def test_empty_episode_fails(self):
        with self.assertRaises(ValueError):
            make(dict(NAR, scenes={}), [], ids=())


class HookTest(Base):
    """hook2: 큰 한국어 질문 줄(hook_words)·부제·마스코트·소리·승인 게이트·커버."""

    def fails(self, **kw):
        with self.assertRaises(ValueError) as cm:
            make(dict(NAR, **kw))
        return str(cm.exception)

    def test_hook_words_validation_fails_closed(self):
        no_words = {k: v for k, v in NAR.items() if k != "hook_words"}
        with self.assertRaises(ValueError) as cm:
            make(no_words)
        self.assertIn("hook_words", str(cm.exception))
        for bad in ([], "첫 훅", ["첫", ""], ["첫", 3]):
            self.assertIn("hook_words", self.fails(hook_words=bad))
        five = ["가", "나", "다", "라", "마"]
        self.assertIn("1~4줄", self.fails(hook=" ".join(five), hook_words=five))
        self.assertIn("hook", self.fails(hook_words=["첫", "다름"]))                      # 이은 것이 hook과 다르다
        self.assertIn("hook_sub", self.fails(hook_sub=""))
        make(dict(NAR, hook="  첫   훅 ", hook_sub="부제"))                                   # 공백 정규화 뒤 같으면 통과

    def test_line_width_must_fit_text_safe(self):
        ok = "가" * 8                                                                        # 192px: 한글 8자까지
        make(dict(NAR, hook=ok, hook_words=[ok]))
        wide = "가" * 9
        msg = self.fails(hook=wide, hook_words=[wide])
        self.assertIn(wide, msg)
        self.assertIn(str(E.text_w(wide, "bold", 2)), msg)
        self.assertIn("부제", self.fails(hook_sub="가" * 20 + "부제"))                         # 부제도 안전 폭 검사

    def test_hook_scene_must_outlast_the_mascot_sparkle(self):
        self.assertAlmostEqual(T.HOOK_END, T.T_SPRITE + 1.5)                                 # 놀람·반짝 12칸 + 등장 6칸
        short = [dict(SCN[0], duration=T.HOOK_END - 0.1), SCN[1]]
        with self.assertRaises(ValueError) as cm:
            make(scn=short)
        self.assertIn("훅", str(cm.exception))
        make(scn=[dict(SCN[0], duration=T.HOOK_END), SCN[1]])                                # 경계 통과

    def test_hook_question_need_not_be_a_scene_statement(self):
        make()                                                                                # NAR의 screen_text에 hook이 없다

    def region_ink(self, frame, y):
        a = np.asarray(frame)[y:y + 24]
        return int((a == np.array([int(E.INK[i:i + 2], 16) for i in (1, 3, 5)])).all(-1).sum())

    def test_lines_appear_every_third_of_a_second_without_typing(self):
        words = dict(NAR, hook="가 나 다 라", hook_words=["가", "나", "다", "라"])
        ep = make(words, draw={"a": lambda img, d, t, ta, S: T.hook2(img, d, t, ta, S, words, lambda *a: None), "b": scene_b})
        T0, STEP = T.T_BIG, 0.3
        for k in range(4):
            y = T.HOOK2_Y + T.HOOK2_GAP * k
            first = math.ceil((T0 + STEP * k) * 24 - 1e-9)
            self.assertEqual(self.region_ink(ep.frame(first - 1), y), 0)
            full = self.region_ink(ep.frame(first), y)
            self.assertGreater(full, 0)                                                      # 나타나는 첫 프레임에 글자가 전부(타자기 없음)
            self.assertEqual(self.region_ink(ep.frame(first + 6), y), full)

    def test_mascot_pops_out_at_t_sprite_inside_safe_area_and_above_hud(self):
        ep = make()
        ep.sound()                                                                            # 효과음 계획(장면 가운데 시험 그리기)을 먼저 끝내 둔다
        box = (135, 255, 222, 337)
        crop = lambda i: np.asarray(ep.frame(i))[box[1]:box[3], box[0]:box[2]]
        first = math.ceil(T.T_SPRITE * 24 - 1e-9)
        self.assertTrue((crop(first - 1) == crop(0)).all())
        self.assertFalse((crop(first) == crop(0)).all())
        lo, hi = E.TEXT_SAFE[0], E.TEXT_SAFE[2]
        for k in range(40):
            f, (x, y) = T.HOOK_MASCOT.frame_at(k / 12, T.HOOK2_MASCOT)
            self.assertTrue(x >= lo and x + f.width - 1 <= hi and y + f.height - 1 < T.HUD_V2["box"][1], (k, x, y, f.size))

    def test_sounds_match_the_legacy_hook(self):
        ep = make()
        ep.frame(round(ep.scenes[0].length / 2 * 24))
        self.assertEqual(ep.scenes[0].sfx, [(T.T_BIG, "pop"), (T.T_SPRITE, "sparkle")])
        self.assertEqual((T.T_BIG, T.T_SPRITE), (0.3, 2.4))
        extra = make(draw={"a": lambda img, d, t, ta, S: T.hook2(img, d, t, ta, S, NAR, lambda *a: None, extra_sfx=[(1.0, "thud")]), "b": scene_b})
        extra.frame(round(extra.scenes[0].length / 2 * 24))
        self.assertEqual(extra.scenes[0].sfx[-1], (1.0, "thud"))

    def test_art_starts_after_the_last_line(self):
        calls = []
        ep = make(draw={"a": lambda img, d, t, ta, S: T.hook2(img, d, t, ta, S, NAR, lambda *a: calls.append(a[2])), "b": scene_b})
        ep.sound()
        calls.clear()
        for i in range(0, 60):
            ep.frame(i)
        self.assertAlmostEqual(min(calls), T.T_BIG + 0.3 * 2, delta=1 / 24)

    def test_art_is_clipped_to_the_hook_box(self):
        from PIL import Image
        img = Image.new("RGB", (E.W, E.H), E.BG)
        T.hook2(img, None, 2.0, 2.0, type("S", (), {})(), NAR, lambda im, d, t, ta: d.rectangle((0, 0, E.W - 1, E.H - 1), fill=E.PURPLE))
        x0, y0, x1, y1 = T.HOOK2_ART
        px = img.load()
        self.assertEqual(px[x0, y0], px[x1, y1])
        self.assertEqual(px[x0, y0], tuple(int(E.PURPLE[i:i + 2], 16) for i in (1, 3, 5)))
        self.assertNotEqual(px[x1 + 1, y1], px[x1, y1])                       # 상자 밖은 그대로
        self.assertNotEqual(px[x0, y1 + 1], px[x0, y1])

    def test_undrawn_hook_line_fails_the_render_gate(self):
        def no_hook(img, d, t, ta, S):
            S.say(img, t, "질문"), E.say(img, "라벨", "label", (112, 200))
        failed, exists, _ = RenderGateTest.render(self, {"a": no_hook, "b": scene_b_with_number})
        self.assertIn("첫", failed or "")
        self.assertFalse(exists)

    def test_cover_shows_big_text_and_mascot(self):
        with tempfile.TemporaryDirectory() as media:
            ep = make(dict(NAR, hook_sub="부제"), media=media)
            ep.cover()                                                                        # sound() 없이도(--cover 단독) 마스코트가 있는 커버를 쓴다
            self.assertTrue((Path(media) / "ep98_test_cover.png").exists())
            last = ep.frame(round(ep.scenes[0].length * 24) - 1, card=False)
            for k in range(2):
                self.assertGreater(self.region_ink(last, T.HOOK2_Y + T.HOOK2_GAP * k), 0)
            box = (135, 255, 222, 337)
            crop = lambda f: np.asarray(f)[box[1]:box[3], box[0]:box[2]]
            self.assertFalse((crop(last) == crop(ep.frame(0, card=False))).all())


def scene_b_with_number(img, d, t, ta, S):
    S.say(img, t, "수치", "number")


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

    def test_glow_role(self):
        self.assertEqual(E.declare_colors([{"color": "#C8502B", "role": "발광"}]), ("#C8502B",))   # 마그마: 발광이면 DANGER 근처도 통과
        self.assertTrue(E.range_violations(0.7, 0.2001, 150, "발광"))                           # 채도 상한 0.20
        from PIL import Image
        img = Image.new("RGB", (100, 100), E.BG)
        img.paste("#C8502B", (0, 0, 100, 15))
        self.assertAlmostEqual(E.glow_share(img, ("#C8502B",)), 0.15)                           # 경계 15%
        img.paste("#C8502B", (0, 0, 100, 16))
        self.assertGreater(E.glow_share(img, ("#C8502B",)), E.GLOW_MAX_SHARE)
        self.assertEqual(E.glow_share(img, ()), 0.0)
        self.assertEqual(E.glow_colors([{"color": "#C8502B", "role": "발광"}, {"color": "#4D3B2C", "role": "환경"}]), ("#C8502B",))

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

    def test_wide_principle_line_wraps_at_spaces(self):
        ep = make(dict(NAR, principle=["걸린 시간으로 거리를", "세 원이 겹친 점이", "내 위치다"], principle_label="LABEL"))
        self.assertEqual(ep.principle, [("걸린 시간으로", False), ("거리를", False), ("세 원이 겹친 점이", False), ("내 위치다", True)])
        g = T.ENDING[2]
        self.assertLessEqual(g["line_y"] + 3 * 34 + 2 * E.FONT_H["bold"], g["en_y"])   # 4줄 마지막 글자가 영문 라벨 위에서 끝난다
        ep.frame(round((ep.starts[-1] + 3.0) * 24))
        with self.assertRaises(AssertionError):                           # 나눠도 5줄이면 안 들어간다
            make(dict(NAR, principle=["가나다라마 바사아자차 카타파하가", "하", "하"]))

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


class TextFitTest(unittest.TestCase):
    """검토 게이트(textfit)는 장면 표의 화면 문구를 렌더와 같은 E.say로 잰다(30편: 두 줄에 안 드는 진술이 빌드를 세 번 죽였다)."""

    def test_table(self):
        from px import textfit
        md = ("| 장면 | 전달할 내용 | 화면 문구 | 근거 행 | 제작 제약 |\n| --- | --- | --- | --- | --- |\n"
              "| `a` | 내용 | 진술: `판을 구부리면 바깥쪽은 늘어나고 안쪽은 줄어들어요` · 라벨(선택): `중립축` | 1 | `진술: \"x\"` |\n"
              "| `b` | 내용 | 진술 `약한 층 위아래를 비슷하게 쌓으면 중립축이 그 층 근처로 와요` | 2 | 없음 |\n")
        items = textfit.screen_texts(md)
        self.assertEqual([k for k, _ in items], ["statement", "label", "statement"])
        bad = textfit.misfits(items)
        self.assertEqual([s for _, s, _ in bad], ["약한 층 위아래를 비슷하게 쌓으면 중립축이 그 층 근처로 와요"])


if __name__ == "__main__":
    unittest.main()
