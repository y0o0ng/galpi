#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

python3 -m venv reels/.venv
reels/.venv/bin/python -m pip install numpy==2.4.4 Pillow==12.2.0 pypdf==6.10.0
bash reels/px/fonts/fetch.sh
