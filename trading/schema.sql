-- PAPER 저장소 스키마. 설계 17장의 논리 계약 중 1~2단계가 실제로 쓰는 표만 만든다.
-- 나머지 표는 그 단계를 구현할 때 함께 추가한다.

CREATE TABLE IF NOT EXISTS broker_environments (
  mode TEXT PRIMARY KEY CHECK (mode = 'PAPER'),
  account_hash TEXT NOT NULL,
  credential_scope TEXT NOT NULL CHECK (credential_scope = 'paper'),
  base_url TEXT NOT NULL,
  capability_hash TEXT,
  health TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health IN ('unknown', 'ok', 'degraded', 'failed')),
  checked_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- 해외주식 API 하나하나가 모의에서 실제로 되는지 self-test로 채운다.
-- live_supported는 이 저장소에서 채우지 않는다. 실전 경로를 구현하지 않기 때문이다.
CREATE TABLE IF NOT EXISTS kis_capability_matrix (
  api_name TEXT PRIMARY KEY,
  tr_id TEXT,
  tr_id_version TEXT,
  paper_supported TEXT NOT NULL DEFAULT 'untested'
    CHECK (paper_supported IN ('untested', 'supported', 'unsupported', 'error')),
  live_supported TEXT NOT NULL DEFAULT 'untested'
    CHECK (live_supported = 'untested'),
  detail TEXT,
  last_self_test INTEGER
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'PAPER' CHECK (environment = 'PAPER'),
  payload_hash TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
