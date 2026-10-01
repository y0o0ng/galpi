#!/usr/bin/env bash
# 1편 저화질 미리보기: manim 렌더 → 자막 입히기 → reels/media/ep01_preview.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
PY=reels/.venv/bin/python
FF=$($PY -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
EP=reels/episodes/ep01_harmonic_drive
export PYTHONPATH="$PWD"
reels/.venv/bin/manim -ql -r 540,960 --media_dir reels/media/_manim -o ep01_raw "$EP/scene.py" Ep01
RAW=$(find reels/media/_manim -name ep01_raw.mp4 | head -1)
"$FF" -y -loglevel error -i "$RAW" -vf "ass=$EP/subtitles.ko.ass" -c:v libx264 -pix_fmt yuv420p -crf 18 reels/media/ep01_preview.mp4
echo "done: reels/media/ep01_preview.mp4"
