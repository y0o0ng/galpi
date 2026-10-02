#!/usr/bin/env bash
# 갈무리(Galmuri, SIL OFL 1.1 — LICENSE-galmuri.txt) 비트맵 TTF를 받는다. 용량이 커서 저장소에 넣지 않는다.
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
LIST
echo "fonts ok"
