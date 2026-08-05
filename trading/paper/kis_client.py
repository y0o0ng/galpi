"""PAPER 전용 한투 REST 클라이언트.

표준 라이브러리만 쓴다. Pi에 pip 의존성을 늘리지 않기 위해서다.
호출 제한이 모의에서 더 낮다는 공식 안내에 따라 최소 간격을 강제한다.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import PaperConfig, assert_paper_base_url

# 모의는 실전보다 호출 제한이 낮다. 0.35초로는 EGW00201(초당 거래건수 초과)이
# 실제로 났다. 실측에 맞춰 1초로 두고, 그래도 걸리면 아래에서 재시도한다.
MIN_CALL_INTERVAL_SEC = 1.0
RATE_LIMIT_MSG_CD = "EGW00201"
RATE_LIMIT_RETRIES = 3
DEFAULT_TIMEOUT_SEC = 10.0


class KisApiError(Exception):
    def __init__(self, message: str, *, status: int | None = None, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


@dataclass
class KisResponse:
    status: int
    headers: dict[str, str]
    body: dict[str, Any]

    @property
    def rt_cd(self) -> str:
        return str(self.body.get("rt_cd", ""))

    @property
    def msg(self) -> str:
        return str(self.body.get("msg1", "")).strip()

    @property
    def msg_cd(self) -> str:
        return str(self.body.get("msg_cd", ""))

    @property
    def ok(self) -> bool:
        """rt_cd '0'이 성공이다."""
        return self.rt_cd == "0"


# 한투는 접근토큰 발급 자체에 빈도 제한이 있다(재요청 시 403). 토큰은 24시간
# 유효하므로 파일에 캐시해 재사용한다. 이 파일도 자격증명처럼 커밋하지 않는다.
TOKEN_CACHE_PATH = Path(__file__).resolve().parents[1] / "data" / "paper-token.json"


class KisPaperClient:
    def __init__(
        self,
        config: PaperConfig,
        timeout: float = DEFAULT_TIMEOUT_SEC,
        token_cache: Path | None = TOKEN_CACHE_PATH,
    ):
        assert_paper_base_url(config.base_url)
        self._config = config
        self._timeout = timeout
        self._token_cache = token_cache
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._last_call_at = 0.0
        self._load_cached_token()

    def _load_cached_token(self) -> None:
        if not self._token_cache:
            return
        try:
            cached = json.loads(self._token_cache.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return
        # 다른 계좌·환경의 토큰을 재사용하지 않는다.
        if cached.get("account_hash") != self._config.account_hash:
            return
        if cached.get("base_url") != self._config.base_url:
            return
        expires_at = float(cached.get("expires_at") or 0)
        if expires_at > time.time() + 60:
            self._token = str(cached.get("access_token") or "") or None
            self._token_expires_at = expires_at

    def _save_cached_token(self) -> None:
        if not self._token_cache or not self._token:
            return
        self._token_cache.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "account_hash": self._config.account_hash,
            "base_url": self._config.base_url,
            "access_token": self._token,
            "expires_at": self._token_expires_at,
        }
        self._token_cache.write_text(json.dumps(payload), encoding="utf-8")
        os.chmod(self._token_cache, 0o600)

    # ── 저수준 ────────────────────────────────────────────────────────────
    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call_at
        if elapsed < MIN_CALL_INTERVAL_SEC:
            time.sleep(MIN_CALL_INTERVAL_SEC - elapsed)
        self._last_call_at = time.monotonic()

    def _request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, str] | None = None,
        body: dict[str, Any] | None = None,
    ) -> KisResponse:
        assert_paper_base_url(self._config.base_url)
        url = f"{self._config.base_url}{path}"
        if params:
            query = urllib.parse.urlencode(params)
            url = f"{url}?{query}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("content-type", "application/json; charset=utf-8")
        for key, value in (headers or {}).items():
            request.add_header(key, value)

        self._throttle()
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read().decode("utf-8", errors="replace")
                return KisResponse(
                    status=response.status,
                    headers={k.lower(): v for k, v in response.headers.items()},
                    body=_safe_json(raw),
                )
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            return KisResponse(
                status=error.code,
                headers={k.lower(): v for k, v in (error.headers or {}).items()},
                body=_safe_json(raw),
            )
        except urllib.error.URLError as error:
            raise KisApiError(f"모의 서버에 연결하지 못했습니다: {error.reason}") from error

    # ── 인증 ──────────────────────────────────────────────────────────────
    def access_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token
        response = self._request(
            "POST",
            "/oauth2/tokenP",
            body={
                "grant_type": "client_credentials",
                "appkey": self._config.app_key,
                "appsecret": self._config.app_secret,
            },
        )
        token = str(response.body.get("access_token") or "")
        if not token:
            hint = ""
            if response.status == 403:
                hint = " (한투는 토큰 발급 빈도를 제한한다. 잠시 뒤 다시 시도하면 된다)"
            raise KisApiError(
                "모의 접근토큰을 받지 못했습니다: "
                f"{response.body.get('msg1') or response.body.get('error_description') or response.status}{hint}",
                status=response.status,
            )
        self._token = token
        self._token_expires_at = time.time() + float(response.body.get("expires_in") or 0)
        self._save_cached_token()
        return token

    def _auth_headers(self, tr_id: str) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self.access_token()}",
            "appkey": self._config.app_key,
            "appsecret": self._config.app_secret,
            "tr_id": tr_id,
            "custtype": "P",
        }

    # ── 조회 ──────────────────────────────────────────────────────────────
    def _with_rate_limit_retry(self, call) -> KisResponse:
        """초당 제한은 실패가 아니라 기다렸다 다시 보내야 하는 신호다."""
        response = call()
        for attempt in range(RATE_LIMIT_RETRIES):
            if response.msg_cd != RATE_LIMIT_MSG_CD:
                return response
            time.sleep(MIN_CALL_INTERVAL_SEC * (attempt + 2))
            response = call()
        return response

    def get(self, path: str, tr_id: str, params: dict[str, str]) -> KisResponse:
        return self._with_rate_limit_retry(
            lambda: self._request("GET", path, headers=self._auth_headers(tr_id), params=params)
        )

    def post(self, path: str, tr_id: str, body: dict[str, Any]) -> KisResponse:
        return self._with_rate_limit_retry(
            lambda: self._request("POST", path, headers=self._auth_headers(tr_id), body=body)
        )

    @property
    def account_params(self) -> dict[str, str]:
        return {
            "CANO": self._config.account_prefix,
            "ACNT_PRDT_CD": self._config.account_product,
        }


def _safe_json(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"_raw": raw[:2000]}
    return parsed if isinstance(parsed, dict) else {"_raw": parsed}
