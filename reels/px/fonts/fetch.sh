#!/usr/bin/env bash
# 갈무리·Neo둥근모·Mona(SIL OFL 1.1 — 각 LICENSE 파일) 비트맵 TTF를 받는다. 용량이 커서 저장소에 넣지 않는다.
# Pillow가 woff2를 못 읽어 TTF를 쓴다. 버전과 SHA-256을 고정한다.
set -euo pipefail
cd "$(dirname "$0")"
V=2.40.3
while read -r name sum; do
  [ -f "$name" ] && echo "$sum  $name" | shasum -a 256 -c --status && continue
  curl -fsSL -o "$name" "https://cdn.jsdelivr.net/npm/galmuri@$V/dist/$name"
  echo "$sum  $name" | shasum -a 256 -c --status || { echo "SHA 불일치: $name"; rm -f "$name"; exit 1; }
done <<LIST
Galmuri11.ttf 2c709890595668f7bdb6df408420fda957dde0288e95b31a1cc17a2ab98b4b4f
Galmuri11-Bold.ttf 5265b2f437fe81f0c8095b44c0173dd9a276b58a42552bf983f21c0e69e6e8af
Galmuri9.ttf 5cb68052ee0a15571747e91c20f145e24b51bb459c6cd58226fafee78d9c0b16
Galmuri14.ttf d3818c0f2898a3b2d79ccd04ec1e4de5e8940aa26abee261f73e315a44ce8df9
LIST
NEO_SUM=77305267996073aae07bad9313dad2e306a4128e55bfafbed4c41558fee57b4d
if ! { [ -f neodgm.ttf ] && echo "$NEO_SUM  neodgm.ttf" | shasum -a 256 -c --status; }; then
  curl -fsSL -o neodgm.ttf https://github.com/neodgm/neodgm/releases/download/v1.601/neodgm.ttf
  echo "$NEO_SUM  neodgm.ttf" | shasum -a 256 -c --status || { echo "SHA 불일치: neodgm.ttf"; rm -f neodgm.ttf; exit 1; }
fi
if ! { echo "c4ce5a3f30eeb5d909dda0e18da0d3d59b365e24a59f07cbb40e5c36f9e43234  Mona10x12.ttf
0c896b155a90856de4c8e07a10da3dbf8cfb64cfbf5ea3cf14c058f44843d628  Mona10x12-Bold.ttf" | shasum -a 256 -c --status; }; then
  MONA_ZIP=$(mktemp)
  trap 'rm -f "$MONA_ZIP"' EXIT
  curl -fsSL -o "$MONA_ZIP" https://github.com/MonadABXY/mona-font/releases/download/2026.10.09/MonaFont-ttf.zip
  echo "5b2ba21a01b64b6bc37ae1f90297da324258e41d5613272d6b94a970ece29e30  $MONA_ZIP" | shasum -a 256 -c --status
  python3 - "$MONA_ZIP" <<'PYTHON'
from pathlib import Path
import sys
from zipfile import ZipFile
with ZipFile(sys.argv[1]) as archive:
    for name in ("Mona10x12.ttf", "Mona10x12-Bold.ttf"):
        Path(name).write_bytes(archive.read("Mona/01 Main/" + name))
    Path("mona-licenses").mkdir(exist_ok=True)
    for name in ("ark-pixel.txt", "k8x12.txt", "mona.txt", "mplus.txt", "noto-emoji.txt"):
        Path("mona-licenses", name).write_bytes(archive.read("LICENSE/" + name))
    Path("LICENSE-mona.txt").write_bytes(archive.read("LICENSE/mona.txt"))
PYTHON
fi
if ! { echo "d39e50e4bb52b4993b6a4eeb821a171254745bd824446af01e1f616b89fface0  Pretendard-Medium.otf
2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7  Pretendard-Bold.otf" | shasum -a 256 -c --status; }; then
  PRETENDARD_ZIP=$(mktemp)
  trap 'rm -f "$PRETENDARD_ZIP"' EXIT
  curl -fsSL -o "$PRETENDARD_ZIP" https://github.com/orioncactus/pretendard/releases/download/v1.3.9/Pretendard-1.3.9.zip
  echo "04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a  $PRETENDARD_ZIP" | shasum -a 256 -c --status
  python3 - "$PRETENDARD_ZIP" <<'PYTHON'
from pathlib import Path
from zipfile import ZipFile
import sys
with ZipFile(sys.argv[1]) as archive:
    for name in ("Pretendard-Medium.otf", "Pretendard-Bold.otf"):
        Path(name).write_bytes(archive.read("public/static/" + name))
    Path("LICENSE-pretendard.txt").write_bytes(archive.read("LICENSE"))
PYTHON
fi
DNF_SUM=ffa93fec1e4407156b04a1eb2aad3018746d4eb3ef3000c0720e49f068dda622
if ! { [ -f DNFBitBitv2.otf ] && echo "$DNF_SUM  DNFBitBitv2.otf" | shasum -a 256 -c --status; }; then
  curl -fsSL --max-time 60 -o DNFBitBitv2.otf https://cdn.df.nexon.com/img/common/font/DNFBitBitv2.otf
  echo "$DNF_SUM  DNFBitBitv2.otf" | shasum -a 256 -c --status || { rm -f DNFBitBitv2.otf; exit 1; }
fi
echo "fonts ok"
