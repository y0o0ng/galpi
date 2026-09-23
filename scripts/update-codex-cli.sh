#!/bin/sh
# Pi의 Codex CLI를 npm 최신으로 올린다. pi crontab에서 매일 돈다(런북 1절).
# Codex 백엔드는 클라이언트 버전으로 모델 목록을 거르므로, CLI가 낡으면 새 모델이
# 오류 없이 사서 카탈로그에서 빠진다. 검증에 실패하면 이전 버전으로 되돌린다.
set -u

NODE_BIN=/home/pi/.nvm/versions/node/v24.16.0/bin
export PATH="$NODE_BIN:/usr/bin:/bin"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CODEX="$ROOT/bin/codex"
MODEL=$(sed -n 's/^CODEX_MODEL=//p' "$ROOT/.env")
MODEL=${MODEL:-gpt-5.6-terra}
# 검증에 실패한 버전은 다시 설치하지 않는다. 안 그러면 다음 릴리스까지 매일 설치·롤백·알림이 반복된다.
SKIP_FILE="$HOME/.cache/galpi-codex-update-failed"

log() { logger -t galpi-codex-update "$*"; echo "$*"; }
installed() { "$CODEX" --version 2>/dev/null | awk '{print $NF}'; }
install() { npm install -g --no-fund --no-audit "@openai/codex@$1" >/dev/null 2>&1; }

# 서버와 같은 실행 경로(wrapper → exec → stdin)를 빈 임시 폴더에서 한 번 돌린다.
verify() {
  [ "$(installed)" = "$1" ] || return 1
  "$CODEX" login status >/dev/null 2>&1 || return 1
  dir=$(mktemp -d)
  out=$(printf '%s\n' 'Reply only RUNNER_OK. Do not modify files.' \
    | timeout 180 "$CODEX" exec --model "$MODEL" -C "$dir" --skip-git-repo-check \
      --sandbox workspace-write --color never - 2>/dev/null)
  rm -rf "$dir"
  case "$out" in *RUNNER_OK*) return 0 ;; *) return 1 ;; esac
}

notify() { node "$ROOT/scripts/notify-codex-update.js" "$@" || log "알림 전송 실패"; }

current=$(installed)
latest=$(npm view @openai/codex version 2>/dev/null)
[ -n "$current" ] || { log "현재 버전을 읽지 못했다"; exit 1; }
[ -n "$latest" ] || { log "최신 버전 조회 실패"; exit 1; }
[ "$current" = "$latest" ] && exit 0
[ "$(cat "$SKIP_FILE" 2>/dev/null)" = "$latest" ] && exit 0

log "업데이트 시작: $current -> $latest"
if install "$latest" && verify "$latest"; then
  log "업데이트 완료: $latest"
  notify updated "$latest"
  exit 0
fi

mkdir -p "$(dirname "$SKIP_FILE")" && echo "$latest" > "$SKIP_FILE"
if install "$current" && verify "$current"; then
  log "검증 실패로 되돌림: $latest -> $current"
  notify rolled_back "$current"
  exit 1
fi
log "되돌리기도 실패했다. 사서 실행기를 확인해야 한다."
notify broken "$current"
exit 2
