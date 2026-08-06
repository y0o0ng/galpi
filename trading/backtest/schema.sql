-- 데이터 계약 스키마. 설계 17장 표 중 3단계(데이터 계약)와 5단계(Core 백테스터)가
-- 실제로 쓰는 표만 만든다. 나머지 표는 그 단계를 구현할 때 함께 추가한다.
--
-- 이 파일은 백테스트 저장소에 적용하고, PAPER 실행이 같은 피처를 계산할 때가 되면
-- 같은 DDL을 PAPER 저장소에도 적용한다. 백테스트와 실행이 같은 필드를 보게 하는 것이
-- 설계 1.2 우선순위 3(백테스트-실행 일치)이다.

-- 어떤 데이터가 들어왔는지 먼저 선언해야 적재할 수 있다. 무료 데이터는 당시 지수
-- 구성원과 상장폐지 종목이 없어 생존편향이 있고, 그 결과는 전략 판정에 쓸 수 없다.
-- 그 약속을 문서가 아니라 이 표가 지킨다. 기본값은 "편향 있음"이다.
CREATE TABLE IF NOT EXISTS data_sources (
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bars', 'universe', 'earnings', 'securities')),
  point_in_time INTEGER NOT NULL DEFAULT 0 CHECK (point_in_time IN (0, 1)),
  survivorship_biased INTEGER NOT NULL DEFAULT 1 CHECK (survivorship_biased IN (0, 1)),
  note TEXT,
  registered_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (source, source_version, kind)
);

-- 설계 7.2는 "조정가격과 당시 실제 주문가격 모두 보유"를 요구한다.
-- raw_*는 그날 실제로 주문할 수 있었던 가격이고 수량·손절·지정가 계산에 쓴다.
-- adj_*는 분할·배당 조정가고 수익률·이동평균·모멘텀에 쓴다.
-- source_version이 PK에 있어서 개정본은 기존 행을 덮지 않고 새 버전으로만 들어온다.
CREATE TABLE IF NOT EXISTS bars_daily (
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL
    CHECK (trade_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  raw_open REAL NOT NULL CHECK (raw_open > 0),
  raw_high REAL NOT NULL CHECK (raw_high > 0),
  raw_low REAL NOT NULL CHECK (raw_low > 0),
  raw_close REAL NOT NULL CHECK (raw_close > 0),
  raw_volume REAL NOT NULL CHECK (raw_volume >= 0),
  adj_open REAL NOT NULL CHECK (adj_open > 0),
  adj_high REAL NOT NULL CHECK (adj_high > 0),
  adj_low REAL NOT NULL CHECK (adj_low > 0),
  adj_close REAL NOT NULL CHECK (adj_close > 0),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  ingested_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (symbol, trade_date, source_version),
  CHECK (raw_high >= raw_low AND raw_high >= raw_open AND raw_high >= raw_close),
  CHECK (raw_low <= raw_open AND raw_low <= raw_close),
  CHECK (adj_high >= adj_low AND adj_high >= adj_open AND adj_high >= adj_close),
  CHECK (adj_low <= adj_open AND adj_low <= adj_close)
) WITHOUT ROWID;

-- 당시 구성원. 구간은 [valid_from, valid_to)이고 valid_to가 NULL이면 아직 구성원이다.
CREATE TABLE IF NOT EXISTS universe_membership (
  symbol TEXT NOT NULL,
  index_name TEXT NOT NULL,
  valid_from TEXT NOT NULL
    CHECK (valid_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valid_to TEXT
    CHECK (valid_to IS NULL OR valid_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  PRIMARY KEY (symbol, index_name, valid_from, source_version),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- published_at은 이 일정을 알 수 있게 된 시각이고 event_at은 발표 예정 시각이다.
-- 두 값을 분리해야 나중에 확정된 실적일을 과거에 알고 있었던 것처럼 쓰는 오류를 막는다.
CREATE TABLE IF NOT EXISTS earnings_calendar (
  symbol TEXT NOT NULL,
  event_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('confirmed', 'estimated')),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  PRIMARY KEY (symbol, event_at, published_at, source_version)
);

-- 피처는 바에서 결정론적으로 다시 계산할 수 있다. 저장하는 이유는 감사다.
-- feature_hash가 같으면 같은 입력·같은 규칙에서 나온 값이다(설계 19.3).
CREATE TABLE IF NOT EXISTS features_daily (
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  source_version TEXT NOT NULL,
  rs63_5 REAL NOT NULL,
  trend_quality60 REAL NOT NULL,
  atr14 REAL NOT NULL,
  sma50 REAL NOT NULL,
  sma200 REAL NOT NULL,
  realized_vol20 REAL NOT NULL,
  dollar_volume_median20 REAL NOT NULL,
  bars_used INTEGER NOT NULL,
  feature_hash TEXT NOT NULL,
  computed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (symbol, trade_date, strategy_version, source_version)
);

-- 종목 분류. 17장에 없는 표지만 9.2의 섹터 한도에 필요하다.
-- 섹터 재분류 이력은 모델링하지 않는다. 재분류가 드물고, 당시 섹터가 필요해지면
-- universe_membership처럼 valid_from/valid_to를 붙이는 것이 다음 단계다.
CREATE TABLE IF NOT EXISTS securities (
  symbol TEXT NOT NULL,
  sector TEXT NOT NULL,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  PRIMARY KEY (symbol, source_version)
);

-- 사용자가 승인한 한도 한 벌. broker_mode마다 활성 정책은 하나다.
-- signature는 사용자 키로 만든 위조 방지 서명이 아니라 내용 digest다. 불러올 때마다
-- 다시 계산해 대조하므로 승인 이후에 값이 바뀌면 기동을 거부한다.
CREATE TABLE IF NOT EXISTS policy_versions (
  policy_id TEXT PRIMARY KEY,
  broker_mode TEXT NOT NULL CHECK (broker_mode = 'PAPER'),
  strategy_version TEXT NOT NULL,
  risk_profile TEXT NOT NULL,
  profile TEXT NOT NULL,
  limits TEXT NOT NULL,
  parameters TEXT NOT NULL,
  signature TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  activated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_active
  ON policy_versions(broker_mode) WHERE active = 1;

-- 후보 랭킹의 결과. 17장의 `signals`다.
-- signal_id는 (전략 버전, 데이터 버전, 날짜, 종목)에서 결정론적으로 나오므로 같은
-- 스냅샷을 다시 돌리면 같은 행이 나온다. snapshot_id는 전체를 훑는 값이라 실행이
-- 감사 지점에서 채울 때만 들어온다.
CREATE TABLE IF NOT EXISTS signals (
  signal_id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  source_version TEXT NOT NULL,
  snapshot_id TEXT,
  feature_hash TEXT NOT NULL,
  regime TEXT NOT NULL CHECK (regime IN ('GREEN', 'YELLOW', 'RED')),
  score REAL NOT NULL,
  z_rs63_5 REAL NOT NULL,
  z_trend_quality60 REAL NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 1),
  score_population INTEGER NOT NULL,
  -- 신호 종가와 ATR는 실제 주문 가격 단위다. 진입 지정가 상한과 갭 취소의 기준이다.
  reference_close REAL NOT NULL CHECK (reference_close > 0),
  atr14 REAL NOT NULL CHECK (atr14 > 0),
  reasons TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (trade_date, symbol, strategy_version, source_version)
);

-- 백테스트 실행 기록. 17장의 `trade_outcomes`·`account_snapshots`와 같은 개념이지만
-- run_id를 달고 있는 연구 산출물이라 이름을 나눴다. PAPER 운영 원장은 4단계에서
-- 자기 저장소에 자기 표로 만든다.
--
-- survivorship_biased와 require_* 플래그를 행에 함께 남긴다. 어떤 조건으로 낸 숫자인지
-- 잊으면 그 숫자를 전략 판정에 쓰게 된다.
CREATE TABLE IF NOT EXISTS backtest_runs (
  run_id TEXT PRIMARY KEY,
  source_version TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_signature TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  initial_capital REAL NOT NULL,
  final_equity REAL NOT NULL,
  trade_count INTEGER NOT NULL,
  survivorship_biased INTEGER NOT NULL CHECK (survivorship_biased IN (0, 1)),
  require_earnings_calendar INTEGER NOT NULL CHECK (require_earnings_calendar IN (0, 1)),
  require_sector INTEGER NOT NULL CHECK (require_sector IN (0, 1)),
  cost_stress TEXT NOT NULL,
  gate_factor REAL NOT NULL,
  skip_counts TEXT NOT NULL,
  fill_counts TEXT NOT NULL,
  exit_counts TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS backtest_trades (
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  exit_date TEXT NOT NULL,
  shares INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  entry_reason TEXT NOT NULL,
  exit_reason TEXT NOT NULL,
  exit_fill_reason TEXT NOT NULL,
  fees REAL NOT NULL,
  pnl REAL NOT NULL,
  return_r REAL NOT NULL,
  mfe_r REAL NOT NULL,
  mae_r REAL NOT NULL,
  sessions_held INTEGER NOT NULL,
  min_qty_exception INTEGER NOT NULL CHECK (min_qty_exception IN (0, 1)),
  PRIMARY KEY (run_id, symbol, entry_date)
);

CREATE TABLE IF NOT EXISTS backtest_equity (
  run_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  equity REAL NOT NULL,
  cash REAL NOT NULL,
  exposure REAL NOT NULL,
  drawdown REAL NOT NULL,
  regime TEXT NOT NULL,
  open_positions INTEGER NOT NULL,
  PRIMARY KEY (run_id, trade_date)
);

-- 홀드아웃 실행 기록. 14.3의 "최신 완결 구간은 최종 홀드아웃"을 지키는 장치다.
-- 여러 번 보는 것을 막을 수는 없으니 몇 번 봤는지 세어 판정에 드러낸다. 다른 정책으로
-- 다시 돌리는 것이야말로 홀드아웃을 소모하는 행위이므로 구간 단위로 센다.
CREATE TABLE IF NOT EXISTS holdout_runs (
  run_id TEXT PRIMARY KEY,
  policy_signature TEXT NOT NULL,
  source_version TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  trade_count INTEGER NOT NULL,
  expectancy_r REAL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_holdout_segment
  ON holdout_runs(source_version, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_bars_daily_date ON bars_daily(trade_date);
CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(trade_date);
CREATE INDEX IF NOT EXISTS idx_universe_membership_from ON universe_membership(valid_from);
CREATE INDEX IF NOT EXISTS idx_earnings_calendar_symbol ON earnings_calendar(symbol, event_at);
