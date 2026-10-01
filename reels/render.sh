#!/usr/bin/env bash
# 저화질 미리보기: bash reels/render.sh [에피소드폴더 Scene클래스] (인자 없으면 1편) → reels/media/<이름>_preview.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
PY=reels/.venv/bin/python
FF=$($PY -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
EPN=${1:-ep01_harmonic_drive}; SCENE=${2:-Ep01}
OUT=$EPN; [ "$EPN" = ep01_harmonic_drive ] && OUT=ep01
EP=reels/episodes/$EPN
export PYTHONPATH="$PWD"
reels/.venv/bin/manim -ql -r 540,960 --media_dir reels/media/_manim -o ${OUT}_raw "$EP/scene.py" $SCENE
RAW=$(find reels/media/_manim -name ${OUT}_raw.mp4 | head -1)
"$FF" -y -loglevel error -i "$RAW" -vf "ass=$EP/subtitles.ko.ass" -c:v libx264 -pix_fmt yuv420p -crf 18 reels/media/${OUT}_preview.mp4
echo "done: reels/media/${OUT}_preview.mp4"
