#!/usr/bin/env bash
# 저화질 미리보기: bash reels/render.sh [에피소드폴더 Scene클래스] (인자 없으면 1편) → reels/media/<이름>_preview.mp4 (음성 포함)
# 음성·타이밍(tts) → 장면(manim) → 자막+음성 합성 순서. 렌더는 한 번에 하나, 낮은 우선순위로 돈다.
# 오디오: 내레이션(1:a)에 manim이 실은 효과음(0:a)을 합친다. 내레이션을 앞에 둬야 amix가 내레이션을 3dB 깎지 않는다(normalize=0이어도 그렇다).
set -euo pipefail
cd "$(dirname "$0")/.."
PY=reels/.venv/bin/python
FF=$($PY -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
EPN=${1:-ep01_harmonic_drive}; SCENE=${2:-Ep01}
OUT=$EPN; [ "$EPN" = ep01_harmonic_drive ] && OUT=ep01
EP=reels/episodes/$EPN
export PYTHONPATH="$PWD"
$PY -m reels.tts "$EP"
# 캐시를 쓰면 캐시된 조각의 시간이 프레임 반올림 없이 더해져 장면 시계가 영상보다 앞서간다
nice -n 19 reels/.venv/bin/manim --disable_caching -ql -r 540,960 --media_dir reels/media/_manim -o ${OUT}_raw "$EP/scene.py" $SCENE
RAW=$(find reels/media/_manim -name ${OUT}_raw.mp4 | head -1)
nice -n 19 "$FF" -y -loglevel error -i "$RAW" -i reels/media/$EPN.ko.wav -filter_complex "[1:a][0:a]amix=inputs=2:duration=longest:normalize=0[a]" -vf "ass=$EP/subtitles.ko.ass" -map 0:v -map "[a]" -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a aac -b:a 128k reels/media/${OUT}_preview.mp4
echo "done: reels/media/${OUT}_preview.mp4"
