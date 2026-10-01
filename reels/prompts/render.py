"""prompts/<이름>.md의 {{칸}}을 값으로 채운다. LLM 없이 문자열 치환만 한다.

usage: python reels/prompts/render.py <이름> <값.json>
빈 칸이 남거나, 템플릿에 없는 칸을 넘기면(오타) 실패한다.
"""
import json
import re
import sys
from pathlib import Path

SLOT = re.compile(r"\{\{(\w+)\}\}")


def render(name, values):
    text = (Path(__file__).parent / f"{name}.md").read_text()
    slots = set(SLOT.findall(text))
    if missing := slots - values.keys():
        raise KeyError(f"{name}: 빈 칸 {sorted(missing)}")
    if extra := values.keys() - slots:
        raise KeyError(f"{name}: 템플릿에 없는 칸 {sorted(extra)}")
    return SLOT.sub(lambda m: str(values[m.group(1)]), text)


if __name__ == "__main__":
    print(render(sys.argv[1], json.loads(Path(sys.argv[2]).read_text())), end="")
