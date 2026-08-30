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

-- Quality + Value 전용 issuer/share-class identity. 기존 securities는 momentum의
-- immutable snapshot 입력이므로 확장하지 않는다. issuer_id가 내부 정본이고 CIK는 SEC
-- filing을 잇는 외부 식별자일 뿐이다.
CREATE TABLE IF NOT EXISTS qv_issuers (
  issuer_id TEXT NOT NULL,
  cik TEXT NOT NULL
    CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  resolution_method TEXT NOT NULL CHECK (length(trim(resolution_method)) > 0),
  usable_from_session TEXT NOT NULL
    CHECK (usable_from_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (issuer_id, source_version),
  UNIQUE (cik, source_version)
) WITHOUT ROWID;

-- class_id는 ticker와 분리된 share-class identity다. 같은 class_id의 비중첩 행으로
-- ticker rename과 XBRL member history를 표현한다. 구간은 [effective_from, effective_to)다.
CREATE TABLE IF NOT EXISTS qv_share_classes (
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  symbol TEXT,
  is_ordinary_common INTEGER NOT NULL CHECK (is_ordinary_common IN (0, 1)),
  is_listed INTEGER NOT NULL CHECK (is_listed IN (0, 1)),
  effective_from TEXT NOT NULL
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT
    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  usable_from_session TEXT NOT NULL
    CHECK (usable_from_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (class_id, effective_from, source_version),
  FOREIGN KEY (issuer_id, source_version)
    REFERENCES qv_issuers(issuer_id, source_version),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (is_listed = 0 OR symbol IS NOT NULL)
) WITHOUT ROWID;

-- Quality + Value 전용 SEC filing 원장. CIK는 이 row의 filing-time SIC를 찾는
-- target registrant이고 issuer identity가 아니다. issuer_id를 두지 않아 submissions
-- ingestion이 SEC registrant를 내부 issuer로 승격하지 못하게 한다.
CREATE TABLE IF NOT EXISTS qv_sec_filings (
  cik TEXT NOT NULL
    CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  form TEXT NOT NULL CHECK (form IN ('10-K', '10-K/A', '10-Q', '10-Q/A')),
  filed_date TEXT NOT NULL
    CHECK (filed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  report_date TEXT
    CHECK (report_date IS NULL OR report_date GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  acceptance_datetime TEXT
    CHECK (acceptance_datetime IS NULL OR acceptance_datetime GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]Z'),
  acceptance_eastern_date TEXT
    CHECK (acceptance_eastern_date IS NULL OR acceptance_eastern_date GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  historical_usable_session TEXT
    CHECK (historical_usable_session IS NULL OR historical_usable_session GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  filing_sic TEXT
    CHECK (filing_sic IS NULL OR
      (length(filing_sic) = 4 AND filing_sic NOT GLOB '*[^0-9]*')),
  sic_status TEXT NOT NULL CHECK (sic_status IN ('EXACT', 'MISSING', 'AMBIGUOUS')),
  primary_document TEXT,
  submissions_file TEXT NOT NULL CHECK (length(trim(submissions_file)) > 0),
  calendar_source TEXT NOT NULL CHECK (length(trim(calendar_source)) > 0),
  calendar_source_version TEXT NOT NULL
    CHECK (length(trim(calendar_source_version)) > 0),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_version TEXT NOT NULL CHECK (length(trim(source_version)) > 0),
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  ingested_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (cik, accession, source_version),
  CHECK ((acceptance_datetime IS NULL) = (acceptance_eastern_date IS NULL)),
  CHECK (acceptance_datetime IS NOT NULL OR historical_usable_session IS NULL),
  CHECK (historical_usable_session IS NULL OR
    historical_usable_session > acceptance_eastern_date),
  CHECK (
    (sic_status = 'EXACT' AND filing_sic IS NOT NULL)
    OR
    (sic_status IN ('MISSING', 'AMBIGUOUS') AND filing_sic IS NULL)
  )
) WITHOUT ROWID;

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

-- 거래를 멈춘 종목. **적재 단계에서 정하고 루프는 조회만 한다.**
--
-- 루프가 "오늘 이후로 바가 없다"를 직접 보면 미래를 보는 것이 된다. 여기서 날짜로
-- 기록해두면 `last_trade_date <= as_of`만 물어도 되고, 그건 그 시점에 이미 참인 사실이다.
--
-- `status`는 둘이다. `DELISTED`는 벤더 폐지 목록이 확인해준 것이고, `UNRESOLVED`는
-- 계열이 끊겼는데 이유를 모르는 것이다. 후자는 런을 막지 않고 따로 세어 보고서에
-- 손익 기여를 찍는다 — 그 기여가 작으면 파고들 필요가 없고, 크면 그 심볼만 손으로 본다.
CREATE TABLE IF NOT EXISTS delistings (
  symbol TEXT NOT NULL,
  source_version TEXT NOT NULL,
  last_trade_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DELISTED', 'UNRESOLVED')),
  evidence TEXT NOT NULL,
  PRIMARY KEY (symbol, source_version)
);

CREATE TABLE IF NOT EXISTS backtest_equity (
  run_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  equity REAL NOT NULL,
  cash REAL NOT NULL,
  exposure REAL NOT NULL,
  drawdown REAL NOT NULL,
  -- 그날 실제로 게이팅한 상태. regime_mode가 무엇이냐에 따라 뜻이 다르다.
  regime TEXT NOT NULL,
  -- 계좌를 보지 않는 시장 라벨. **게이팅과 무관하게 항상 남긴다** — 어떤 시장에서
  -- 벌었는지는 실행이 끝난 뒤에 묻게 되는데 그때는 다시 만들 수 없다. 이 열이 생기기
  -- 전에 저장된 실행은 NULL이다.
  market_regime TEXT,
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

-- Quality + Value의 canonical accounting observation. raw filing 전체를 warehouse하지
-- 않고, 동결된 회계 계약이 고른 값과 그 값을 만든 fact의 provenance만 남긴다. CIK는 raw SEC
-- registrant key이고 issuer_id가 아니다 — issuer join은 qv_identity가 따로 한다.
CREATE TABLE IF NOT EXISTS qv_accounting_filings (
  cik TEXT NOT NULL
    CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  filing_source_version TEXT NOT NULL CHECK (length(trim(filing_source_version)) > 0),
  accounting_source TEXT NOT NULL CHECK (length(trim(accounting_source)) > 0),
  accounting_source_version TEXT NOT NULL
    CHECK (length(trim(accounting_source_version)) > 0),
  accounting_definition_version TEXT NOT NULL
    CHECK (length(trim(accounting_definition_version)) > 0),

  fiscal_period_end TEXT
    CHECK (fiscal_period_end IS NULL OR fiscal_period_end GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_crosscheck_status TEXT NOT NULL,
  income_statement_role TEXT,
  balance_sheet_role TEXT,

  -- canonical 금액은 REAL이 아니라 lossless decimal 문자열이다.
  revenue_value TEXT CHECK (revenue_value IS NULL OR revenue_value GLOB '-[0-9]*'
    OR revenue_value GLOB '[0-9]*'),
  revenue_status TEXT NOT NULL,
  cogs_value TEXT CHECK (cogs_value IS NULL OR cogs_value GLOB '-[0-9]*'
    OR cogs_value GLOB '[0-9]*'),
  cogs_status TEXT NOT NULL,
  gross_profit_value TEXT CHECK (gross_profit_value IS NULL
    OR gross_profit_value GLOB '-[0-9]*' OR gross_profit_value GLOB '[0-9]*'),
  gross_profit_status TEXT NOT NULL,
  direct_gross_profit_value TEXT CHECK (direct_gross_profit_value IS NULL
    OR direct_gross_profit_value GLOB '-[0-9]*'
    OR direct_gross_profit_value GLOB '[0-9]*'),
  gross_profit_tieout_status TEXT NOT NULL,

  assets_value TEXT CHECK (assets_value IS NULL OR assets_value GLOB '-[0-9]*'
    OR assets_value GLOB '[0-9]*'),
  assets_status TEXT NOT NULL,
  assets_tieout_status TEXT NOT NULL,

  parent_se_value TEXT CHECK (parent_se_value IS NULL OR parent_se_value GLOB '-[0-9]*'
    OR parent_se_value GLOB '[0-9]*'),
  parent_se_status TEXT NOT NULL,
  parent_se_path TEXT CHECK (parent_se_path IS NULL OR
    parent_se_path IN ('DIRECT_PARENT_SE', 'INCLUDING_NCI_MINUS_NCI')),
  nci_tieout_status TEXT NOT NULL,

  preferred_value TEXT CHECK (preferred_value IS NULL OR preferred_value GLOB '-[0-9]*'
    OR preferred_value GLOB '[0-9]*'),
  preferred_status TEXT NOT NULL,
  preferred_tier TEXT CHECK (preferred_tier IS NULL OR
    preferred_tier IN ('LIQUIDATION', 'PAR_CARRYING', 'ZERO')),

  book_equity_value TEXT CHECK (book_equity_value IS NULL
    OR book_equity_value GLOB '-[0-9]*' OR book_equity_value GLOB '[0-9]*'),
  book_equity_status TEXT NOT NULL,

  revenue_provenance TEXT,
  cogs_provenance TEXT,
  direct_gp_provenance TEXT,
  assets_provenance TEXT,
  assets_tieout_provenance TEXT,
  parent_se_provenance TEXT,
  nci_tieout_provenance TEXT,
  preferred_provenance TEXT,
  bundle_provenance TEXT NOT NULL CHECK (length(trim(bundle_provenance)) > 0),
  diagnostics TEXT NOT NULL,

  ingested_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  PRIMARY KEY (cik, accession, accounting_source_version,
               accounting_definition_version),
  FOREIGN KEY (cik, accession, filing_source_version)
    REFERENCES qv_sec_filings(cik, accession, source_version),
  CHECK (revenue_status <> 'RESOLVED' OR revenue_value IS NOT NULL),
  CHECK (cogs_status <> 'RESOLVED' OR cogs_value IS NOT NULL),
  CHECK (gross_profit_status <> 'RESOLVED' OR gross_profit_value IS NOT NULL),
  CHECK (assets_status <> 'RESOLVED' OR assets_value IS NOT NULL),
  CHECK (parent_se_status <> 'RESOLVED' OR
    (parent_se_value IS NOT NULL AND parent_se_path IS NOT NULL)),
  CHECK (preferred_status <> 'RESOLVED' OR
    (preferred_value IS NOT NULL AND preferred_tier IS NOT NULL)),
  CHECK (book_equity_status <> 'RESOLVED' OR book_equity_value IS NOT NULL)
) WITHOUT ROWID;

-- ── QV Step 4: identity alias · evidence · shares · events · ME ────────────────
-- 설계 정본은 docs/trading/strategies/qv-step4-shares-me-design.md 다.
-- alias는 economic class가 아니다. 여러 alias가 한 class를 가리킬 수 있고,
-- 같은 시점 같은 키가 두 class로 가면 fail-close다.

-- 매핑마다 구조화된 SEC 증거. usable_from_session은 REQUIRED 증거의 최대값에서
-- 파생하며 손으로 덮어쓰지 않는다. CORROBORATING은 사용 가능 시점을 늦추지 않는다.
CREATE TABLE IF NOT EXISTS qv_identity_evidence (
  relation_kind TEXT NOT NULL CHECK (relation_kind IN (
    'ISSUER', 'SHARE_CLASS', 'XBRL_ALIAS', 'PROSE_ALIAS', 'CONVERSION_RELATION')),
  relation_key TEXT NOT NULL CHECK (length(trim(relation_key)) > 0),
  evidence_ordinal INTEGER NOT NULL CHECK (evidence_ordinal >= 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('KQ_FILING', 'SEC_EVIDENCE_DOCUMENT')),
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  document_name TEXT NOT NULL CHECK (length(trim(document_name)) > 0),
  evidence_role TEXT NOT NULL CHECK (length(trim(evidence_role)) > 0),
  locator TEXT,
  dependency TEXT NOT NULL CHECK (dependency IN ('REQUIRED', 'CORROBORATING')),
  resolved_usable_session TEXT
    CHECK (resolved_usable_session IS NULL OR resolved_usable_session GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (relation_kind, relation_key, evidence_ordinal, source_version)
) WITHOUT ROWID;

-- PIT XBRL QName alias. axis/member 둘 다 정규화 키로 저장하고 raw QName을
-- provenance로 남긴다. local-name-only 추론은 하지 않는다.
CREATE TABLE IF NOT EXISTS qv_share_class_xbrl_aliases (
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  axis_key TEXT NOT NULL CHECK (length(trim(axis_key)) > 0),
  member_key TEXT NOT NULL CHECK (length(trim(member_key)) > 0),
  raw_axis_namespace TEXT,
  raw_axis_local TEXT NOT NULL CHECK (length(trim(raw_axis_local)) > 0),
  raw_member_namespace TEXT,
  raw_member_local TEXT NOT NULL CHECK (length(trim(raw_member_local)) > 0),
  effective_from TEXT NOT NULL
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT
    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  usable_from_session TEXT NOT NULL
    CHECK (usable_from_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (class_id, axis_key, member_key, effective_from, source_version),
  FOREIGN KEY (issuer_id, source_version)
    REFERENCES qv_issuers(issuer_id, source_version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
) WITHOUT ROWID;

-- PIT prose alias. comparison_key는 N1(NFKC·trim·공백 1칸·casefold)까지만이다.
-- COVER_GROUP_LABEL은 단독 canonical bridge가 될 수 없다.
CREATE TABLE IF NOT EXISTS qv_share_class_prose_aliases (
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  raw_prose_name TEXT NOT NULL CHECK (length(trim(raw_prose_name)) > 0),
  comparison_key TEXT NOT NULL CHECK (length(trim(comparison_key)) > 0),
  bridge_type TEXT NOT NULL CHECK (bridge_type IN (
    'SECURITY_TITLE_FACT', 'GOVERNING_INSTRUMENT', 'COVER_GROUP_LABEL')),
  effective_from TEXT NOT NULL
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT
    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  usable_from_session TEXT NOT NULL
    CHECK (usable_from_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (class_id, comparison_key, bridge_type, effective_from, source_version),
  FOREIGN KEY (issuer_id, source_version)
    REFERENCES qv_issuers(issuer_id, source_version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
) WITHOUT ROWID;

-- qv_sec_filings를 넓히지 않기 위한 좁은 SEC 증거 문서 원장. 본문/HTML은 넣지 않는다.
CREATE TABLE IF NOT EXISTS qv_sec_evidence_documents (
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  document_name TEXT NOT NULL CHECK (length(trim(document_name)) > 0),
  form TEXT NOT NULL CHECK (length(trim(form)) > 0),
  document_role TEXT NOT NULL CHECK (document_role IN ('PRIMARY', 'EXHIBIT')),
  acceptance_datetime TEXT NOT NULL
    CHECK (acceptance_datetime GLOB
      '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9][0-9][0-9][0-9]Z'),
  acceptance_eastern_date TEXT NOT NULL
    CHECK (acceptance_eastern_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  historical_usable_session TEXT NOT NULL
    CHECK (historical_usable_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
  document_sha256 TEXT NOT NULL CHECK (length(document_sha256) = 64),
  calendar_source TEXT NOT NULL,
  calendar_source_version TEXT NOT NULL,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (cik, accession, document_name, source_version),
  CHECK (historical_usable_session > acceptance_eastern_date)
) WITHOUT ROWID;

-- accession 단위 주식수 관측 원장. 범용 XBRL 창고가 아니다.
CREATE TABLE IF NOT EXISTS qv_share_observations (
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  fact_ordinal INTEGER NOT NULL CHECK (fact_ordinal >= 0),
  form TEXT NOT NULL CHECK (form IN ('10-K', '10-K/A', '10-Q', '10-Q/A')),
  acceptance_datetime TEXT NOT NULL,
  historical_usable_session TEXT NOT NULL
    CHECK (historical_usable_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  concept_tier TEXT NOT NULL CHECK (concept_tier IN ('A', 'B')),
  concept_namespace TEXT NOT NULL,
  concept_local TEXT NOT NULL,
  fact_instant TEXT NOT NULL
    CHECK (fact_instant GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  share_value_text TEXT NOT NULL CHECK (length(trim(share_value_text)) > 0),
  decimals TEXT,
  unit_id TEXT,
  context_id TEXT NOT NULL,
  raw_axis_namespace TEXT,
  raw_axis_local TEXT,
  raw_member_namespace TEXT,
  raw_member_local TEXT,
  axis_key TEXT,
  member_key TEXT,
  dimension_shape TEXT NOT NULL CHECK (dimension_shape IN (
    'DIMENSIONLESS', 'SINGLE_CLASS_AXIS', 'UNUSABLE')),
  issuer_id TEXT,
  class_id TEXT,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN (
    'RESOLVED', 'UNRESOLVED', 'AMBIGUOUS', 'UNUSABLE_SHAPE')),
  duplicate_status TEXT NOT NULL CHECK (duplicate_status IN (
    'UNIQUE', 'CONSOLIDATED', 'AMBIGUOUS')),
  duplicate_group TEXT,
  source_file TEXT NOT NULL,
  instance_sha256 TEXT NOT NULL CHECK (length(instance_sha256) = 64),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  identity_source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (cik, accession, fact_ordinal, source_version, identity_source_version),
  CHECK (mapping_status <> 'RESOLVED' OR (issuer_id IS NOT NULL AND class_id IS NOT NULL))
) WITHOUT ROWID;

-- 기업행동 탐색 coverage. class 효과 판정과 절대 합치지 않는다.
CREATE TABLE IF NOT EXISTS qv_share_basis_searches (
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  anchor_accession TEXT NOT NULL CHECK (length(trim(anchor_accession)) > 0),
  valuation_date TEXT NOT NULL
    CHECK (valuation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  formation_session TEXT NOT NULL
    CHECK (formation_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  interval_lo TEXT NOT NULL,
  interval_hi TEXT NOT NULL,
  closure_accession TEXT,
  closure_acceptance_eastern_date TEXT,
  coverage TEXT NOT NULL CHECK (coverage IN ('NOT_SEARCHED', 'COMPLETE', 'INCOMPLETE')),
  incomplete_reason TEXT,
  searched_accessions TEXT NOT NULL,
  processed_accessions TEXT,
  failed_accessions TEXT,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (cik, anchor_accession, valuation_date, formation_session, source_version),
  CHECK (coverage <> 'COMPLETE' OR closure_accession IS NOT NULL),
  -- metadata만으로 COMPLETE가 될 수 없다. 실제 문서 처리 증명이 있어야 한다.
  CHECK (coverage <> 'COMPLETE' OR processed_accessions IS NOT NULL),
  CHECK (coverage <> 'INCOMPLETE' OR incomplete_reason IS NOT NULL)
) WITHOUT ROWID;

-- 발견/추출된 원시 공시 후보. 처분(disposition)은 class 효과가 아니다.
CREATE TABLE IF NOT EXISTS qv_share_basis_candidates (
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL CHECK (length(trim(accession)) > 0),
  document_name TEXT NOT NULL CHECK (length(trim(document_name)) > 0),
  block_ordinal INTEGER NOT NULL CHECK (block_ordinal >= 0),
  document_role TEXT NOT NULL CHECK (document_role IN ('PRIMARY', 'EXHIBIT')),
  discovery_family TEXT NOT NULL CHECK (length(trim(discovery_family)) > 0),
  source_span TEXT NOT NULL CHECK (length(trim(source_span)) > 0),
  raw_action TEXT,
  raw_ratio TEXT,
  raw_class_names TEXT NOT NULL,
  raw_disclosure_status TEXT NOT NULL,
  role_dates TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN (
    'CURRENT_EVENT', 'EXCLUDED_NOT_IMPLEMENTED', 'EXCLUDED_OUT_OF_WINDOW', 'UNRESOLVED')),
  disposition_reason TEXT NOT NULL CHECK (length(trim(disposition_reason)) > 0),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (cik, accession, document_name, block_ordinal, source_version)
) WITHOUT ROWID;

-- 대상 class에 대한 semantic 효과 판정.
CREATE TABLE IF NOT EXISTS qv_share_basis_class_effects (
  class_id TEXT NOT NULL,
  cik TEXT NOT NULL CHECK (length(cik) = 10 AND cik NOT GLOB '*[^0-9]*'),
  accession TEXT NOT NULL,
  document_name TEXT NOT NULL,
  block_ordinal INTEGER NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN (
    'SHARE_BASIS_CHANGE_CONFIRMED', 'NO_SHARE_BASIS_EFFECT_CONFIRMED', 'UNRESOLVED')),
  effect_reason TEXT NOT NULL CHECK (length(trim(effect_reason)) > 0),
  ratio_text TEXT,
  share_side_transition_date TEXT,
  share_side_transition_role TEXT
    CHECK (share_side_transition_role IS NULL OR
           share_side_transition_role IN ('EFFECTIVE', 'DISTRIBUTION')),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  identity_source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (class_id, cik, accession, document_name, block_ordinal,
               source_version, identity_source_version),
  CHECK (effect <> 'SHARE_BASIS_CHANGE_CONFIRMED' OR
    (ratio_text IS NOT NULL AND share_side_transition_date IS NOT NULL
     AND share_side_transition_role IS NOT NULL))
) WITHOUT ROWID;

-- vendor split 원장. 상장 market boundary 해석에만 쓴다. 기업행동 프레임워크가 아니다.
CREATE TABLE IF NOT EXISTS qv_vendor_split_events (
  symbol TEXT NOT NULL CHECK (length(trim(symbol)) > 0),
  split_date TEXT NOT NULL
    CHECK (split_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  raw_split TEXT NOT NULL CHECK (length(trim(raw_split)) > 0),
  retrieved_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (symbol, split_date, source_version)
) WITHOUT ROWID;

-- P2 same-regime 선택 결과. formation·class 단위 정답이다.
CREATE TABLE IF NOT EXISTS qv_class_share_resolutions (
  formation_session TEXT NOT NULL
    CHECK (formation_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valuation_date TEXT NOT NULL
    CHECK (valuation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  selector_path TEXT NOT NULL CHECK (selector_path IN ('A', 'B_FALLBACK', 'MISSING')),
  selected_accession TEXT,
  selected_fact_ordinal INTEGER,
  share_value_text TEXT,
  fact_instant TEXT,
  regime_status TEXT NOT NULL CHECK (regime_status IN (
    'SAME_REGIME', 'DIFFERENT_REGIME', 'UNRESOLVED', 'NO_CANDIDATE')),
  search_coverage TEXT NOT NULL CHECK (search_coverage IN (
    'NOT_SEARCHED', 'COMPLETE', 'INCOMPLETE')),
  missing_reason TEXT,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  identity_source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (formation_session, valuation_date, class_id,
               source_version, identity_source_version),
  CHECK (
    (selector_path = 'MISSING' AND share_value_text IS NULL
      AND selected_accession IS NULL AND missing_reason IS NOT NULL)
    OR
    (selector_path IN ('A', 'B_FALLBACK') AND share_value_text IS NOT NULL
      AND selected_accession IS NOT NULL AND selected_fact_ordinal IS NOT NULL
      AND fact_instant IS NOT NULL AND missing_reason IS NULL
      AND regime_status = 'SAME_REGIME')
  )
) WITHOUT ROWID;

-- 법적/경제적 고정 직접 전환 관계. formation 안전성의 답이 아니다.
CREATE TABLE IF NOT EXISTS qv_class_conversion_relations (
  relation_id TEXT NOT NULL CHECK (length(trim(relation_id)) > 0),
  subject_class_id TEXT NOT NULL,
  reference_class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  conversion_ratio_text TEXT NOT NULL CHECK (length(trim(conversion_ratio_text)) > 0),
  ratio_semantics TEXT NOT NULL CHECK (ratio_semantics IN (
    'EXPLICIT_INTEGER', 'ONE_FOR_ONE', 'SHARE_FOR_SHARE', 'EQUAL_NUMBER')),
  effective_from TEXT NOT NULL
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  effective_to TEXT
    CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  usable_from_session TEXT NOT NULL
    CHECK (usable_from_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (relation_id, effective_from, source_version),
  FOREIGN KEY (issuer_id, source_version)
    REFERENCES qv_issuers(issuer_id, source_version),
  CHECK (subject_class_id <> reference_class_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
) WITHOUT ROWID;

-- formation 시점의 valuation 답. 법적 관계 표와 분리한다.
CREATE TABLE IF NOT EXISTS qv_class_valuation_resolutions (
  formation_session TEXT NOT NULL
    CHECK (formation_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  valuation_date TEXT NOT NULL
    CHECK (valuation_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  valuation_method TEXT NOT NULL CHECK (valuation_method IN (
    'OBSERVED_MARKET_PRICE', 'CONVERSION_VALUE_PROXY', 'MISSING')),
  price_symbol TEXT,
  price_date TEXT,
  raw_close_text TEXT,
  price_source_version TEXT,
  relation_id TEXT,
  conversion_ratio_text TEXT,
  reference_class_id TEXT,
  c3_pre_accession TEXT,
  c3_pre_document TEXT,
  c3_post_accession TEXT,
  c3_post_document TEXT,
  continuity_status TEXT NOT NULL CHECK (continuity_status IN (
    'NOT_REQUIRED', 'CONFIRMED', 'UNRESOLVED')),
  amendment_search_status TEXT NOT NULL CHECK (amendment_search_status IN (
    'NOT_REQUIRED', 'COMPLETE', 'UNRESOLVED')),
  amendment_searched_accessions TEXT,
  evidence_cutoff_session TEXT,
  missing_reason TEXT,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  identity_source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (formation_session, valuation_date, class_id,
               source_version, identity_source_version),
  CHECK (
    (valuation_method = 'OBSERVED_MARKET_PRICE'
      AND price_symbol IS NOT NULL AND raw_close_text IS NOT NULL
      AND relation_id IS NULL AND missing_reason IS NULL
      AND continuity_status = 'NOT_REQUIRED')
    OR
    (valuation_method = 'CONVERSION_VALUE_PROXY'
      AND relation_id IS NOT NULL AND conversion_ratio_text IS NOT NULL
      AND reference_class_id IS NOT NULL AND raw_close_text IS NOT NULL
      AND c3_pre_accession IS NOT NULL AND c3_post_accession IS NOT NULL
      AND continuity_status = 'CONFIRMED'
      AND amendment_search_status = 'COMPLETE'
      AND amendment_searched_accessions IS NOT NULL
      AND missing_reason IS NULL)
    OR
    (valuation_method = 'MISSING' AND missing_reason IS NOT NULL
      AND raw_close_text IS NULL)
  )
) WITHOUT ROWID;

-- class 단위 시가총액. Decimal 문자열로 보존한다.
CREATE TABLE IF NOT EXISTS qv_class_market_equity (
  formation_session TEXT NOT NULL,
  valuation_date TEXT NOT NULL,
  class_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RESOLVED', 'MISSING')),
  market_equity_text TEXT,
  share_value_text TEXT,
  conversion_ratio_text TEXT,
  raw_close_text TEXT,
  price_symbol TEXT,
  valuation_method TEXT NOT NULL,
  selector_path TEXT NOT NULL,
  missing_reason TEXT,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  identity_source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (formation_session, valuation_date, class_id,
               source_version, identity_source_version),
  CHECK (
    (status = 'RESOLVED' AND market_equity_text IS NOT NULL AND missing_reason IS NULL)
    OR
    (status = 'MISSING' AND market_equity_text IS NULL AND missing_reason IS NOT NULL)
  )
) WITHOUT ROWID;

-- issuer 단위 시가총액. active ordinary class가 하나라도 미해결이면 전체 MISSING이다.
CREATE TABLE IF NOT EXISTS qv_issuer_market_equity (
  formation_session TEXT NOT NULL,
  valuation_date TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RESOLVED', 'MISSING')),
  market_equity_text TEXT,
  class_count INTEGER NOT NULL CHECK (class_count >= 0),
  resolved_class_count INTEGER NOT NULL CHECK (resolved_class_count >= 0),
  component_class_ids TEXT NOT NULL,
  missing_reason TEXT,
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  identity_source_version TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (length(trim(provenance)) > 0),
  PRIMARY KEY (formation_session, valuation_date, issuer_id,
               source_version, identity_source_version),
  CHECK (
    (status = 'RESOLVED' AND market_equity_text IS NOT NULL AND missing_reason IS NULL
      AND resolved_class_count = class_count AND class_count > 0)
    OR
    (status = 'MISSING' AND market_equity_text IS NULL AND missing_reason IS NOT NULL)
  )
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_holdout_segment
  ON holdout_runs(source_version, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_bars_daily_date ON bars_daily(trade_date);
CREATE INDEX IF NOT EXISTS idx_signals_date ON signals(trade_date);
CREATE INDEX IF NOT EXISTS idx_universe_membership_from ON universe_membership(valid_from);
CREATE INDEX IF NOT EXISTS idx_earnings_calendar_symbol ON earnings_calendar(symbol, event_at);
CREATE INDEX IF NOT EXISTS idx_qv_share_classes_symbol
  ON qv_share_classes(source_version, symbol, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_qv_sec_filings_usable
  ON qv_sec_filings(source_version, cik, historical_usable_session,
                    acceptance_datetime, accession);
CREATE INDEX IF NOT EXISTS idx_qv_accounting_period
  ON qv_accounting_filings(accounting_source_version, accounting_definition_version,
                           cik, fiscal_period_end);

CREATE INDEX IF NOT EXISTS idx_qv_xbrl_alias_lookup
  ON qv_share_class_xbrl_aliases(source_version, issuer_id, axis_key, member_key,
                                 effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_qv_prose_alias_lookup
  ON qv_share_class_prose_aliases(source_version, issuer_id, comparison_key,
                                  effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_qv_share_observations_lookup
  ON qv_share_observations(source_version, identity_source_version, class_id,
                           fact_instant, historical_usable_session);
CREATE INDEX IF NOT EXISTS idx_qv_evidence_documents_usable
  ON qv_sec_evidence_documents(source_version, cik, historical_usable_session);
CREATE INDEX IF NOT EXISTS idx_qv_conversion_relations_subject
  ON qv_class_conversion_relations(source_version, subject_class_id,
                                   effective_from, effective_to);
