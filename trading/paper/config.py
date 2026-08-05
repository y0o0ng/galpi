"""PAPER 전용 설정.

이 모듈은 실전 자격증명을 읽지 않는다. 설계 1.3이 금지한
"BROKER_MODE 하나만 바꾸면 실전 주문이 나가는 구조"를 이름 규칙과 호스트 검증으로
막는다. 실전 경로는 이 저장소에 구현하지 않는다.
"""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# 모의(vps) 인증 서버. 실전(prod) 호스트가 들어오면 기동을 거부한다.
PAPER_HOST = "openapivts.koreainvestment.com"
PAPER_PORT = 29443
PAPER_BASE_URL = f"https://{PAPER_HOST}:{PAPER_PORT}"

# 이 모듈이 읽는 유일한 환경변수 이름들이다. 실전 이름은 여기에 없고,
# 다른 곳에서도 참조하지 않는다.
PAPER_ENV_NAMES = ("KIS_PAPER_APP_KEY", "KIS_PAPER_APP_SECRET", "KIS_PAPER_ACCOUNT")

# 한투 계좌는 종합계좌 8자리와 상품코드 2자리로 나뉜다.
ACCOUNT_PATTERN = re.compile(r"^(\d{8})-(\d{2})$")

# iOS는 .env를 열 앱이 없어 Pages가 잡아채고 서식 문서(zip)로 저장해버린다.
# 그래서 기본은 .txt다. 점으로 시작하는 이름은 파일 탐색기에서 숨겨지므로
# 기본으로 쓰지 않는다. 셋 다 .gitignore에 있다.
CREDENTIAL_FILENAMES = (
    "paper-credentials.txt",
    "paper-credentials.env",
    ".env.paper",
)
TRADING_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = TRADING_ROOT / CREDENTIAL_FILENAMES[0]


class TradingConfigError(Exception):
    """설정이 격리 계약을 만족하지 못할 때 올린다."""


def _mask(value: str) -> str:
    if not value:
        return ""
    return f"{value[:4]}...({len(value)}자)"


@dataclass(frozen=True)
class PaperConfig:
    app_key: str = field(repr=False)
    app_secret: str = field(repr=False)
    account_prefix: str = field(repr=False)
    account_product: str
    base_url: str

    @property
    def account_hash(self) -> str:
        """감사 로그와 broker_environments에는 계좌번호 원문을 남기지 않는다."""
        raw = f"{self.account_prefix}-{self.account_product}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @property
    def credential_scope(self) -> str:
        return "paper"

    def __repr__(self) -> str:  # pragma: no cover - 표현만 담당한다
        return (
            "PaperConfig(scope=paper, "
            f"app_key={_mask(self.app_key)}, "
            f"account={self.account_hash[:12]}..., "
            f"base_url={self.base_url})"
        )


def parse_env_file(text: str) -> dict[str, str]:
    """KEY=VALUE 줄만 읽는다. 따옴표와 주석을 벗겨낸다."""
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def decode_env_bytes(raw: bytes) -> str:
    """편집기가 UTF-8이 아닌 인코딩으로 저장해도 KEY=VALUE를 읽어낸다.

    자격증명 값은 ASCII라 주석의 한글이 깨져도 값은 온전하다. 인코딩 때문에
    설정을 못 읽는 쪽이 값이 조금 깨져 보이는 쪽보다 나쁘다.
    """
    for encoding in ("utf-8", "cp949", "euc-kr"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _read_env_file(env_file: Path | None) -> dict[str, str]:
    """지정한 파일을 읽는다. 기본 경로면 보이는 이름과 숨김 이름을 모두 살핀다."""
    if env_file is None:
        return {}
    candidates = [env_file]
    if env_file == DEFAULT_ENV_FILE:
        candidates = [TRADING_ROOT / name for name in CREDENTIAL_FILENAMES]
    for candidate in candidates:
        try:
            values = parse_env_file(decode_env_bytes(candidate.read_bytes()))
        except FileNotFoundError:
            continue
        if any(values.get(name) for name in PAPER_ENV_NAMES):
            return values
    return {}


def load_paper_config(
    env: dict[str, str] | None = None,
    env_file: Path | None = DEFAULT_ENV_FILE,
    base_url: str = PAPER_BASE_URL,
) -> PaperConfig:
    """PAPER 설정을 만든다. 이름에 맞는 값이 없으면 기동하지 않는다."""
    process_env = os.environ if env is None else env
    from_file = _read_env_file(env_file)

    resolved: dict[str, str] = {}
    missing: list[str] = []
    for name in PAPER_ENV_NAMES:
        value = str(process_env.get(name) or from_file.get(name) or "").strip()
        if not value:
            missing.append(name)
        resolved[name] = value
    if missing:
        raise TradingConfigError(
            "모의 자격증명이 없습니다: " + ", ".join(missing)
            + f" ({env_file}에 넣거나 환경변수로 주세요)"
        )

    assert_paper_base_url(base_url)

    account = resolved["KIS_PAPER_ACCOUNT"]
    matched = ACCOUNT_PATTERN.match(account)
    if not matched:
        raise TradingConfigError(
            "KIS_PAPER_ACCOUNT는 8자리-2자리 형식이어야 합니다 (예: 50123456-01)."
        )

    return PaperConfig(
        app_key=resolved["KIS_PAPER_APP_KEY"],
        app_secret=resolved["KIS_PAPER_APP_SECRET"],
        account_prefix=matched.group(1),
        account_product=matched.group(2),
        base_url=base_url,
    )


def assert_paper_base_url(base_url: str) -> None:
    """모의 호스트가 아니면 거부한다. 환경변수 하나로 실전이 되지 않게 하는 지점이다."""
    text = str(base_url or "")
    if not text.startswith("https://"):
        raise TradingConfigError("모의 인증 서버는 https여야 합니다.")
    host = text[len("https://"):].split("/", 1)[0].split(":", 1)[0]
    if host != PAPER_HOST:
        raise TradingConfigError(
            f"모의 호스트가 아닙니다: {host}. PAPER 서비스는 {PAPER_HOST}에만 붙습니다."
        )
