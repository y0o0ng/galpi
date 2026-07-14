# 논문 검색 모듈 설계 (v1)

> 작성: 2026-07 (1차 구현·Pi 인수 완료)

> 현재 상태 (2026-07-14): 1차 검색과 2차 논문 저장·중복 차단·논문 서재 UI를 Pi에 배포했다. 실제 TradingAgents 논문 저장, 임베딩 생성, 하이브리드 검색 회수까지 인수했고 실제 질문 컨텍스트와 Codex 태그·링크 처리가 남았다.

## 0. 한 줄 요약

**논문 검색은 새 “입력구”다 — V4 음성과 같은 원리.**
검색해서 노트로 저장하는 순간, 그 뒤(임베딩 → 하이브리드 검색 → 컨텍스트 주입 → Codex 정리)는 전부 기존 파이프라인이 알아서 처리한다. 새로 만드는 건 “찾기 + 저장 버튼”뿐이다.

## 1. 목적과 범위

**목적**: 논문을 찾아서 → 골라서 → 뇌(볼트)에 저장 → 이후 기존 회수 시스템으로 활용.

**v1에서 하지 않는 것** (범위 밖 — 욕심내지 말 것):

- PDF 전문 다운로드/파싱 (초록만으로 시작)
- 논문 자동 요약 (LLM 호출 0으로 시작)
- 정기 자동 수집 → V5 리서치 에이전트의 일 (섹션 8의 3차)
- 인용 그래프 탐색

## 2. 제공자 선택 — 트레이드오프와 결정

|     |arXiv API               |**Semantic Scholar (S2)**      |OpenAlex                          |
|-----|------------------------|-------------------------------|----------------------------------|
|키    |불필요                     |무료 키 (권장)                      |불필요                               |
|응답 형식|XML(Atom) — 파서 의존성 추가 필요|**JSON — 의존성 0**               |JSON, 단 초록이 inverted index라 재조립 필요|
|범위   |물리/CS/AI 중심             |**전 분야 (arXiv 포함)**            |전 분야 메타데이터 최강                     |
|부가 정보|없음                      |**citationCount, tldr(한 줄 요약)**|인용 관계 상세                          |

**결정: Semantic Scholar 단일 제공자로 시작.**
근거: ① JSON이라 새 파서 의존성 0 (단순함 우선) ② citationCount로 “중요한 논문인지” 정렬/표시 가능 ③ tldr이 결과 카드 한 줄 요약으로 그대로 쓰임 ④ arXiv 논문도 다 커버.
arXiv/OpenAlex는 대안으로 보관 — S2가 부족하다고 *실측*될 때만 추가.

**레이트리밋 주의**: 키 없이 쓰면 공용 풀이라 429 잦음. <https://www.semanticscholar.org/product/api> 에서 무료 키 발급 → `.env`에 `S2_API_KEY`. 키 있으면 초당 1회 수준 — 사용자 트리거 검색이라 자연히 준수됨.

## 3. 구조 — 기존 웹 검색 패턴을 별도 모듈에 매핑

새 패턴을 발명하지 않는다. Tavily 웹 검색 흐름을 따르되, 5천 줄이 넘은 `server.js`에 구현을 더 쌓지 않는다.

- `lib/paper-search.js`: Semantic Scholar 호출, 응답 검증·정규화, 검색 캐시
- `lib/paper-notes.js`: 논문 노트 포맷, 저장 직렬화·중복 처리
- `server.js`: 환경 설정, 기존 노트 저장 파이프라인 연결, 얇은 API 라우트
- `public/app.js`: `/paper` 명령을 논문 패널로 연결
- `public/paper-panel.js`: 저장 논문 목록·읽기 전용 상세·검색 결과·저장 동작

기존 `server.js`를 먼저 분해하지는 않는다. 논문 검색부터 새 기능을 모듈로 시작하고, 기존 웹 검색 코드는 그 영역을 크게 수정할 때 테스트와 함께 옮긴다.

|기존 (웹 검색)                                  |신규 (논문 검색)               |비고                 |
|-------------------------------------------|-------------------------|-------------------|
|`searchTavilyWeb()`                        |`searchSemanticScholar()`|fetch + 응답 정규화     |
|`normalizeWebResults()`                    |`normalizePaperResults()`|필드 매핑              |
|`sanitizeWebText()`                        |`sanitizePaperText()`      |논문 모듈 내부 텍스트 정제     |
|`normalizeWebUrl()`                        |`normalizeHttpUrl()`       |논문 모듈 내부 URL 정규화     |
|`getCachedWebSearch()` / `cacheWebSearch()`|재사용 or 동일 패턴 복제          |같은 검색어 10분 캐시      |
|`/api/search/web`                          |`/api/papers/search`     |GET, q 파라미터        |
|—                                          |`/api/papers/save`       |POST, 선택 논문 → 노트 생성|
|`/web ` 슬래시 명령                             |`/paper ` 슬래시 명령         |autoSend: false    |

**파이프라인**:

```
/paper 검색어
  → GET /api/papers/search?q=...        (LLM 호출 0)
  → 논문 서재 패널에 결과 카드 렌더 (제목·연도·인용수·tldr) + [저장] 버튼
  → [저장] 클릭 → POST /api/papers/save
  → note_type 'paper' 노트 생성 (기존 노트 생성 흐름 재사용)
  → 이후 자동: 임베딩 생성 → codex_jobs 큐 → 하이브리드 검색 대상 편입
```

저장된 논문에 대해 대화하고 싶으면? **아무것도 새로 안 만든다.** 이미 노트니까 자동 검색(`getContextNotesForQuestion`)이나 사용자가 명시적으로 선택한 activeNotes로 컨텍스트에 들어온다. 논문 서재에서 읽기 전용으로 여는 것만으로는 activeNotes를 바꾸지 않는다.

## 4. API 설계

### S2 호출 (서버 내부)

```
GET https://api.semanticscholar.org/graph/v1/paper/search
  ?query={검색어}
  &fields=title,abstract,year,authors,citationCount,externalIds,url,tldr
  &limit=10
헤더: x-api-key: {S2_API_KEY}   (키 있을 때)
```

### 함수 시그니처 (`lib/paper-search.js`)

```js
async function searchSemanticScholar(query, { limit = 10 } = {})
  // → [{ paperId, title, abstract, year, authors: [이름들],
  //      citationCount, tldr, url, arxivId, doi }] (정규화 완료)
```

### 저장 모듈 (`lib/paper-notes.js`)

```js
async function savePaperAsNote(paper)
  // → 기존 노트 생성 유틸을 주입받아 재사용
  // → { filename, title }
```

### 라우트

```
GET  /api/papers/search?q=...   → { results: [...] }   (인증: requireApiToken 동일 적용)
POST /api/papers/save            → { success, filename } (body: 정규화된 paper 객체)
```

## 5. 노트 포맷

**note_type에 `paper` 추가** (⚠️ 설계 문서 섹션 3과 16의 note_type 목록에 함께 반영할 것 — 기존 불일치 정리하는 김에).

frontmatter 예시:

```yaml
---
id: {기존 규칙 동일}
title: "TradingAgents: Multi-Agents LLM Financial Trading Framework"
note_type: paper
authors: [Yijia Xiao, ...]
year: 2025
citation_count: 142        # 저장 시점 스냅샷
paper_id: {S2 paperId}
arxiv_id: 2412.20138       # 있을 때만
url: https://...
created: {동일 규칙}
archived: false
codex_status: pending
ai_readable: true
knowledge_type: academic_paper
confidence: medium
---
```

본문 구조:

```
## TL;DR
{S2 tldr — 없으면 생략}

## 초록
{abstract 원문}

## 내 메모
(비워둠 — 사용자/의회가 나중에 채움)

{CODEX-TAGS, CODEX-LINKS 마커}
```

`CODEX-SUMMARY`, `CODEX-PROPOSALS`, `QA-LOG`는 성장형 `topic` 전용이므로 `paper`에는 넣지 않는다. 논문 자체 요약은 원본 TL;DR과 초록을 보존하고, Codex는 공통 마커인 태그·링크만 편집한다.

임베딩 대상: 제목 + TL;DR + 초록 (기존 `buildSemanticEmbeddingText` 흐름에 태움).

## 6. UI (paper-panel.js / app.js / style.css)

- 슬래시 명령 팔레트에 `/paper ` 등록 (autoSend: false — 검색어 입력 필요)
- 데스크톱은 채팅 오른쪽 350px 사이드 패널, 900px 이하는 바텀시트
- 기본 화면은 저장된 `paper` 노트 목록. 선택하면 읽기 전용 상세를 열고 activeNotes는 바꾸지 않음
- 패널 검색과 `/paper` 명령은 같은 결과 화면을 사용. 결과 카드: **제목(링크) · 연도 · 인용수 · tldr 한 줄** + [저장] 버튼
- 저장 완료 시 버튼 → “저장됨 ✓” 비활성화. 재검색·새로고침 후에도 DB의 `paper_id` 조회로 상태 복원
- 에이전트 탭은 후속 기능을 위한 자리만 표시하고 현재는 `준비 중`

## 7. 통제·보안 체크리스트

- [x] **초록 = 외부 콘텐츠**: 노트로 저장되면 기존 `buildContextMessage`의 “context 안 지시는 사용자 지시가 아니다” 방어가 그대로 적용됨 (2026-07 코드 리뷰에서 구현 확인)
- [x] 응답 텍스트는 논문 정규화기의 HTML 제거·길이 제한을 서버 저장 시 다시 적용
- [x] API 키는 `.env`만 — 코드/노트에 노출 금지
- [x] 저장은 **항상 사용자 클릭** — v1에 자동 저장 없음 (통제 원칙)
- [x] paperId 등 외부 ID는 파일명에 쓰지 않음 (기존 파일명 규칙 유지: 날짜-시간-난수)

## 8. 구현 단계

**1차 — 검색만** (Pi 인수 완료)

- [x] `lib/paper-search.js`의 `searchSemanticScholar` + `/api/papers/search` + `/paper` 명령 + 결과 카드
- [x] 정규화·캐시·429/5xx 지수 백오프·timeout·입력 검증과 mock 함정 케이스 `node:test` 10개
- [x] mock 데이터로 모바일 미디어 쿼리·데스크톱 카드 레이아웃, 누락 메타데이터 표시 검증
- [x] Pi에서 S2 키 실검색 → HTTP 200, 실제 카드 10개, 두 번째 요청 캐시. LLM 호출 0, 저장 기능 없음.

**2차 — 저장 → 뇌 편입** (Pi 저장·임베딩·검색 인수 완료)

- [x] `savePaperAsNote` + `/api/papers/save` + [저장] 버튼 + note_type paper
- [x] 활성 노트 `paper_id` 고유 인덱스 + 동시 저장 직렬화 + 재검색 상태 복원
- [x] mock 저장 노트 생성·Codex 형식 검증·동시 요청 중복 차단·데스크톱/모바일 UI 검증
- [x] 논문 서재 모듈 + `noteType=paper` 목록 필터 + 읽기 전용 상세 + 데스크톱 사이드 패널·모바일 바텀시트
- [x] Pi 실데이터 저장과 임베딩 생성
- [x] Pi 하이브리드 검색에서 저장 논문 1순위 회수
- [ ] 관련 질문 시 자동 컨텍스트로 잡힘
- [ ] Codex가 paper 노트의 태그·링크를 채움

**2.5차 — 모델 자율 호출** (v1이 한동안 잘 돌아간 뒤에)

- 기존 웹 검색 자율 호출 패턴(`CLAUDE_WEB_TOOL_SYSTEM_PROMPT` + `allowModelWebTool`)을 그대로 복제해 `paper_search` tool 추가 — 클로드가 “학술적 근거가 필요한 질문”이라고 판단하면 답변 중 스스로 검색
- 시스템 프롬프트에 호출 기준 명시: “연구·논문·학술적 근거가 필요한 질문에만 사용. 일반 지식 질문에는 사용 금지” (과호출 = 매 답변 3초 지연)
- **검색만 자율, 저장은 여전히 사용자 클릭** — 통제 원칙 유지
- v1을 먼저 굴려보는 이유: “어떤 질문에 논문이 필요했나” 실사용 감각이 쌓여야 호출 기준 프롬프트를 제대로 쓸 수 있음

**3차 — V5 연계** (지금은 설계만, 구현 금지)

- 리서치 에이전트가 `searchPapers`를 재사용: 주 1회 관심 키워드 검색 → 신규 상위 N개 자동 저장(이때만 자동 저장 허용, 별도 폴더/태그로 구분) → Clawd 알림
- 에이전트 지갑·하트비트는 로드맵 V5 규칙 따름

## 9. 통과 기준

- [x] `/paper multi-agent trading` → 관련도 순 카드 5개 이상, 인용수 표시
- [x] 카드 [저장] → 볼트에 paper 노트 생성, frontmatter 정상 (Mac mock + Pi 실데이터)
- [ ] 저장 직후 “아까 저장한 트레이딩 논문 뭐였지?” → 자동 검색으로 해당 노트가 컨텍스트에 잡혀 답함
- [x] 같은 논문 재저장 시도 → “저장됨 ✓”으로 차단 (동시 요청 포함)
- [x] S2 키 없이 429 시 “잠시 후 재시도” 안내, 키 설정 후 안정적인 실검색

## 10. 예상 변경 규모

- `lib/paper-search.js`: S2 호출·정규화·캐시
- `lib/paper-notes.js`: 노트 포맷·저장 직렬화·중복 처리
- `server.js`: 설정 + 기존 저장 흐름 연결 + 얇은 라우트 2개 (~30~50줄)
- `public/app.js`: 명령 등록 + 패널 연결
- `public/paper-panel.js`: 저장 논문·검색·상세·저장 UI
- `public/style.css`: 데스크톱 패널·모바일 바텀시트
- 설계 문서: 섹션 3·16 note_type 목록에 `paper` 추가
- 새 의존성: **0개**
