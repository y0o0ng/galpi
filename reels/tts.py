"""narration.<언어>.json + scenes.json → 문장별 음성(캐시) → timeline.json, subtitles.<언어>.ass, 오디오 트랙 하나.
사용: reels/.venv/bin/python -m reels.tts <에피소드 폴더> [언어=ko]   (언어 코드는 파일명에서만 쓴다)"""
import asyncio, hashlib, json, re, subprocess, sys, wave
from pathlib import Path
import edge_tts
import imageio_ffmpeg
import numpy as np

VOICE, RATE, SR = "ko-KR-SunHiNeural", "+16%", 24000
LEAD, GAP, TAIL = 0.3, 0.2, 0.3   # 장면 시작→첫 문장, 문장 사이, 마지막 문장→장면 끝(초)
MEDIA = Path(__file__).resolve().parent / "media"
HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Narration,Apple SD Gothic Neo,54,&H00E9EDE7,&H00E9EDE7,&H00181A15,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,90,90,330,1
Style: HookTitle,Apple SD Gothic Neo,68,&H00E9EDE7,&H00E9EDE7,&H00181A15,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,8,80,80,150,1
Style: HookSub,Apple SD Gothic Neo,50,&H00ADB4A8,&H00ADB4A8,&H00181A15,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,8,80,80,370,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def synth(text):
    """문장 하나의 wav(24kHz 모노). 같은 문장·음성·속도면 캐시를 쓴다."""
    key = hashlib.sha1(f"{VOICE}|{RATE}|{text}".encode()).hexdigest()[:16]
    mp3, wav = MEDIA / "tts" / f"{key}.mp3", MEDIA / "tts" / f"{key}.wav"
    if not wav.exists():
        mp3.parent.mkdir(parents=True, exist_ok=True)
        if not mp3.exists():
            asyncio.run(edge_tts.Communicate(text, VOICE, rate=RATE).save(str(mp3)))
        subprocess.run(["nice", "-n", "19", imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
                        "-i", str(mp3), "-ar", str(SR), "-ac", "1", str(wav)], check=True)
    return wav


def read(wav):
    with wave.open(str(wav)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def stamp(t):
    cs = round(t * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def build(ep, lang="ko"):
    nar = json.loads((ep / f"narration.{lang}.json").read_text())
    plan = json.loads((ep / "scenes.json").read_text())
    assert [p["id"] for p in plan] == list(nar["scenes"]), "scenes.json과 narration의 장면 id·순서가 다르다"
    t, scenes, clips = 0.0, [], []
    for p in plan:
        s, sents = t + LEAD, []
        for text in nar["scenes"][p["id"]]:
            wav = synth(text)
            d = len(read(wav)) / SR
            sents.append(dict(text=text, start=round(s, 3), end=round(s + d, 3)))
            clips.append((s, wav))
            s += d + GAP
        end = max(s - GAP + TAIL, t + p["min"])
        scenes.append(dict(id=p["id"], start=round(t, 3), end=round(end, 3), sentences=sents))
        t = end
    total = round(t, 3)
    (ep / "timeline.json").write_text(json.dumps(dict(voice=VOICE, rate=RATE, total=total, scenes=scenes),
                                                  ensure_ascii=False, indent=1) + "\n")

    hook_end = scenes[0]["end"]
    rows = [f"Dialogue: 0,{stamp(0)},{stamp(hook_end)},{style},,0,0,0,,{nar['hook'][key]}"
            for style, key in (("HookTitle", "title"), ("HookSub", "sub"))]
    rows += [f"Dialogue: 0,{stamp(x['start'])},{stamp(x['end'])},Narration,,0,0,0,,{x['text']}"
             for sc in scenes for x in sc["sentences"]]
    (ep / f"subtitles.{lang}.ass").write_text(HEADER + "\n".join(rows) + "\n")

    audio = np.zeros(round(total * SR), dtype=np.int16)
    for s, wav in clips:
        a = read(wav)
        audio[round(s * SR):round(s * SR) + len(a)] = a
    out = MEDIA / f"{ep.name}.{lang}.wav"
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(SR), w.writeframes(audio.tobytes())

    # 검사: ass의 Narration 시작 시각이 timeline과 0.1초 이내로 같다
    got = [sum(float(v) * k for v, k in zip(m.groups(), (3600, 60, 1))) for m in
           re.finditer(r"Dialogue: 0,(\d+):(\d+):([\d.]+),[^,]*,Narration", (ep / f"subtitles.{lang}.ass").read_text())]
    want = [x["start"] for sc in scenes for x in sc["sentences"]]
    assert len(got) == len(want) and all(abs(g - w) < 0.1 for g, w in zip(got, want)), "ass와 timeline 불일치"
    print(f"{ep.name}: {len(want)}문장, 총 {total:.2f}초 → {out.name}")


if __name__ == "__main__":
    build(Path(sys.argv[1]).resolve(), *sys.argv[2:3])
