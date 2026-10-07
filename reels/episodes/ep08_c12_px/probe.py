"""카드 분할·글자 폭·스프라이트 크기 확인용. 실행: reels/.venv/bin/python episodes/ep08_c12_px/probe.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))
from px import engine as E  # noqa: E402
from px.sprite import sprite  # noqa: E402

nar = json.loads((Path(__file__).parent / "narration.ko.json").read_text())
tot = 0
for k, ss in nar["scenes"].items():
    for i, s in enumerate(ss):
        tot += E.sentence_secs(s)
        print(k, i, round(E.sentence_secs(s), 2), [("|".join(c), round(E.card_secs(c), 2)) for c in E.split_cards(s)])
print(round(tot, 2))
for m in ("base", "pointing", "sparkle", "surprised"):
    print(m, sprite(m).size)
for s in ("HYDROTHERMAL", "PLATE EDGES", "HOT ROCK", "PLANT", "DEEPER", "HOTTER", "INJECTION", "PRODUCTION", "FRACTURES",
          "HORIZONTAL", "CONTROLLED", "QUAKE", "NET", "COLD", "HOT", "HEAT", "WATER", "PATHS", "EGS"):
    print(s, E.text_w(s, "label"), E.text_w(s, "bold"))
print(E.text_w("33 MW", "bold", 2), E.text_w("POHANG 2017", "bold", 2), E.text_w("POHANG 2017", "bold"), E.text_w("GEOTHERMAL", "bold", 2))
