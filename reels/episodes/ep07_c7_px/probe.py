import sys
from pathlib import Path
sys.path.insert(0, "/home/pi/galpi/reels")
from px import engine as E
import json
nar = json.loads((Path(__file__).parent / "narration.ko.json").read_text())
for k, ss in nar["scenes"].items():
    for i, s in enumerate(ss):
        print(k, i, round(E.sentence_secs(s), 2), [("|".join(c), round(E.card_secs(c), 2)) for c in E.split_cards(s)])
for ch in "µ×u":
    print(ch, E.FONT["label"].getmask(ch).getbbox(), E.FONT["bold"].getmask(ch).getbbox(), E.FONT["body"].getmask(ch).getbbox())
print(E.text_w("51 µs", "bold", 2), E.text_w("40 ms", "bold", 2), E.text_w("STOP THE WORLD", "bold"), E.text_w("VIRTUAL MEMORY", "bold"))
