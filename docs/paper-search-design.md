# 논문 검색 모듈 설계 (v1 + 2.5 전문검색)

> 작성: 2026-07 (1차 구현·Pi 인수 완료)

> 현재 상태 (2026-07-15): 1차 검색과 2차 논문 저장·중복 차단·논문 서재 UI, 일반 노트 열람과 공개 PDF 외부 링크를 Pi에 배포했다 (`c9bf470`). 실제 TradingAgents 논문 저장, 임베딩 생성, 하이브리드 검색 회수까지 인수했다. 2.5A Phase A 파서 spike와 Phase B 로컬 색인·검색도 Pi에 배포했다 (`4c3d07f`, `1078df5`). Pi 임시 DB·볼트에서 실제 TradingAgents PDF를 97개 청크로 색인해 원본 캐시, 중복 색인 재사용, 방법론·실험·한계 질의의 top 4 근거 회수를 확인했다. 서버에는 전용 테이블 초기화만 연결했으며 URL 다운로드·SSRF 방어, 모델 도구와 UI는 아직 구현·인수 전이다.

## 0. 한 줄 요약

**논문 검색은 새 “입력구”이고, 전문검색은 필요할 때만 여는 두 번째 문이다.**
검색해서 노트로 저장하면 기존 회수·Codex 파이프라인에 들어간다. 평소에는 제목·TL;DR·초록만 쓰고, 세부 근거가 필요한 질문에서만 저장 논문의 공개 PDF를 색인해 관련 섹션·페이지를 제한적으로 읽는다.

## 1. 목적과 범위

**목적**: 논문을 찾아서 → 골라서 → 뇌(볼트)에 저장 → 이후 기존 회수 시스템으로 활용.

**v1에서 하지 않는 것** (2.5A 전까지 범위 밖):

- PDF 전문 다운로드/파싱 (초록만 저장하고, 공개 PDF가 있으면 외부 링크만 제공)
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
  &fields=title,abstract,year,authors,citationCount,externalIds,url,tldr,openAccessPdf
  &limit=10
헤더: x-api-key: {S2_API_KEY}   (키 있을 때)
```

### 함수 시그니처 (`lib/paper-search.js`)

```js
async function searchSemanticScholar(query, { limit = 10 } = {})
  // → [{ paperId, title, abstract, year, authors: [이름들],
  //      citationCount, tldr, url, arxivId, doi, openAccessPdfUrl }] (정규화 완료)
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
open_access_pdf_url: https://... # S2가 공개 PDF를 제공할 때만
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
## 원문
[공개 PDF 열기 ↗](https://...)  # 있을 때만

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
- `노트` 탭은 일반 노트를 별도 `public/note-panel.js`로 읽기 전용 표시하며 activeNotes를 바꾸지 않음
- 패널 검색과 `/paper` 명령은 같은 결과 화면을 사용. 결과 카드: **제목(링크) · 연도 · 인용수 · tldr 한 줄** + [저장] 버튼
- S2 `openAccessPdf.url`이 있거나 arXiv ID를 가진 논문은 공개 PDF를 새 탭에서 연다. v1 UI는 PDF를 다운로드·파싱·프록시하지 않으며, 2.5A에서 저장 논문에 한해 서버가 온디맨드 색인
- 저장 완료 시 버튼 → “저장됨 ✓” 비활성화. 재검색·새로고침 후에도 DB의 `paper_id` 조회로 상태 복원
- 에이전트 탭은 후속 기능을 위한 자리만 표시하고 현재는 `준비 중`

## 7. 통제·보안 체크리스트

- [x] **초록 = 외부 콘텐츠**: 노트로 저장되면 기존 `buildContextMessage`의 “context 안 지시는 사용자 지시가 아니다” 방어가 그대로 적용됨 (2026-07 코드 리뷰에서 구현 확인)
- [x] 응답 텍스트는 논문 정규화기의 HTML 제거·길이 제한을 서버 저장 시 다시 적용
- [x] API 키는 `.env`만 — 코드/노트에 노출 금지
- [x] 저장은 **항상 사용자 클릭** — v1에 자동 저장 없음 (통제 원칙)
- [x] paperId 등 외부 ID는 파일명에 쓰지 않음 (기존 파일명 규칙 유지: 날짜-시간-난수)
- [ ] **전문 = 외부 콘텐츠**: 도구 결과를 명령이 아닌 자료로 감싸고 PDF 안 URL·지시를 실행하지 않음
- [ ] 전문 다운로드는 저장된 논문의 검증된 공개 HTTP(S) URL만 허용하고 사설 IP·리다이렉트·용량·시간을 제한
- [ ] 전문 도구는 임의 경로/URL을 받지 않고 서버가 허용한 `paperId`와 반환된 `chunkId`만 받음

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

**2.5A — 저장 논문 전문 능동 독서** (설계 완료, 구현 전)

- 평소 제목·TL;DR·초록만 주입하고, 방법론·실험·수치·한계처럼 초록으로 부족한 질문에만 전문 도구 호출
- 최초 호출 시 공개 PDF를 1회 내려받아 섹션·페이지 단위로 색인하고 이후 영구 재사용
- 모델 도구는 `paper_fulltext_search`와 `paper_fulltext_read` 두 개만 제공
- 질문당 도구 최대 2회, 전문 결과 누적 최대 약 3,000 입력 토큰. PDF 전체 직접 입력은 기본 경로에서 금지
- 상세 구조·토큰 계산·저장·보안·통과 기준은 섹션 11 참조

**2.5B — 외부 논문 발견 검색 자율 호출** (v1이 한동안 잘 돌아간 뒤에)

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
- [ ] 초록 기반 질문에서 전문 도구 호출 0회
- [ ] 전문 질문에서 관련 섹션·페이지를 최대 2회 검색하고 근거 위치와 함께 답변
- [ ] 질문당 전문 결과 누적 3,000토큰 상한과 전체 PDF 기본 입력 금지가 실제로 집행됨
- [ ] 전문이 없거나 파싱에 실패하면 초록 기반임을 밝히고 정상 답변 또는 명확한 실패 안내

## 10. 1~2차 변경 규모 (완료)

- `lib/paper-search.js`: S2 호출·정규화·캐시
- `lib/paper-notes.js`: 노트 포맷·저장 직렬화·중복 처리
- `server.js`: 설정 + 기존 저장 흐름 연결 + 얇은 라우트 2개 (~30~50줄)
- `public/app.js`: 명령 등록 + 패널 연결
- `public/paper-panel.js`: 저장 논문·검색·상세·저장 UI
- `public/style.css`: 데스크톱 패널·모바일 바텀시트
- 설계 문서: 섹션 3·16 note_type 목록에 `paper` 추가
- 새 의존성: **0개**

## 11. 2.5A 전문 능동 독서 상세 설계

> 결정: **전문 전체를 매번 모델에 보내지 않는다.** 서버가 저장 논문의 공개 PDF를 한 번만 기계적으로 색인하고, 모델은 질문에 필요한 원문 조각만 도구로 가져간다. 검색 자체는 로컬에서 수행하며 Claude 토큰은 도구 결과가 프롬프트에 들어갈 때만 사용한다.

### 11.1 기준 측정과 목표

2026-07-14 실제 TradingAgents 논문으로 측정했다.

|입력 방식|논문 관련 입력량|비고|
|---|---:|---|
|현재 저장 노트|원본 2,757자, 모델 입력 약 450~650토큰|frontmatter 제외, 제목·TL;DR·초록|
|전문검색 1회|총 약 1,500~2,000토큰 예상|현재 노트 + 원문 조각 최대 4개|
|전문검색 2회|총 약 2,500~3,500토큰 예상|누적 상한에서 잘라냄|
|PDF 전체 직접 입력|87,811 입력 토큰|`claude-sonnet-4-6` count-tokens API 실측, PDF 1,903,362바이트|

목표:

- 일반 질문의 논문 토큰은 현재 수준 유지
- 전문 질문의 추가 입력은 **통상 1,000~1,500토큰, 절대 상한 약 3,000토큰**
- 전체 PDF 직접 입력보다 약 30~60배 적은 토큰으로 세부 근거 회수
- 답변마다 논문 제목·섹션·PDF 페이지를 근거 위치로 표시
- 검색 결과가 부족하면 추측하지 않고 추가 근거 부족을 밝힘

PDF 직접 입력 토큰은 파일·모델·PDF 시각 요소에 따라 달라질 수 있다. 위 87,811은 비용 보장이 아니라 이 프로젝트의 기준 논문에 대한 실측 회귀값이다.

### 11.2 전체 흐름

```text
사용자 질문
  → 기존 노트 하이브리드 검색이 paper 노트의 제목·초록을 회수
  → 모델이 초록만으로 답할 수 있는지 판단
      ├─ 가능: 도구 호출 없이 답변하고 필요하면 “초록 기반” 표시
      └─ 부족: paper_fulltext_search(paperId, query, mode)
                 → 미색인 상태면 ensurePaperIndex() 1회 실행
                 → 관련 원문 조각 최대 4개 + 섹션·페이지 반환
                 → 충분하면 근거와 답변
                 → 부족하면 paper_fulltext_read(paperId, chunkId) 1회
                            → 해당 조각의 인접 문단만 추가
                            → 누적 예산 안에서 최종 답변
```

**중요한 구분:**

- `paper_search`: Semantic Scholar에서 새 논문을 **발견**하는 2.5B 도구
- `paper_fulltext_search`: 이미 저장한 한 논문의 내부를 **읽는** 2.5A 도구
- 전문을 읽어도 새 논문을 자동 저장하지 않고, 기존 paper 노트의 `activeNotes` 상태도 바꾸지 않음

### 11.3 모델 도구 계약

```js
paper_fulltext_search({
  paperId,                 // 현재 요청에서 서버가 허용한 저장 논문 ID만
  query,                   // 최대 300자
  mode: 'focused' | 'overview'
})
// → {
//   evidence: [{ chunkId, section, pageStart, pageEnd, text }], // 최대 4개
//   indexedNow, truncated, remainingContextChars
// }

paper_fulltext_read({
  paperId,
  chunkId                  // 직전 search가 반환한 ID만
})
// → 선택 조각 앞뒤 문단 최대 2개. 임의 페이지·경로·URL 입력 금지
```

서버 집행 규칙:

- 한 모델 답변에서 두 도구를 합쳐 최대 2회
- 호출 1회 결과 최대 5,000자, 답변 전체 누적 최대 10,000자
- 모델이 limit을 올리거나 다른 paperId를 보내도 서버 상한 우선
- 두 번째 호출은 첫 결과가 부족할 때만 허용
- 도구 결과에는 항상 논문 제목·섹션·PDF 페이지·chunkId 포함
- 답변 인용 표기 예: `[TradingAgents, §4 Experiments, PDF p.8]`

### 11.4 온디맨드 색인

저장 시 모든 PDF를 처리하지 않는다. 전문 도구의 첫 호출 때만 `ensurePaperIndex()`를 실행한다.

1. paper 노트의 `open_access_pdf_url`, 없으면 검증된 `arxiv_id`에서 공개 PDF URL 결정
2. HTTP(S), 공개 호스트, PDF Content-Type, 리다이렉트, 최대 20MB, 최대 100페이지, timeout 검증
3. 임시 파일에 내려받고 SHA-256 계산
4. 텍스트·페이지·제목 구조 추출
5. 참고문헌은 기본 검색 가중치를 낮추고 본문을 문단 경계 우선으로 분할
6. 제목·섹션·페이지 문맥을 붙여 청크 임베딩 생성
7. 원본·색인 상태를 저장하고 같은 SHA-256이면 재처리하지 않음

목표 청크:

- 본문 250~400토큰 내외, 문단 경계 우선
- 인접 청크 overlap 60~100토큰
- 구조 문맥: `논문 제목 > 섹션 제목 > PDF 페이지`
- 표 캡션·그림 캡션은 주변 설명과 같은 청크 또는 별도 caption 청크
- references 청크는 사용자가 선행연구·인용을 물을 때만 검색

**파서 spike 결정: `pdf-parse` 2.4.5를 사용한다.** Node CommonJS에서 바로 호출할 수 있고 Mac/Pi에 Poppler를 별도 설치하지 않아도 된다. 실제 TradingAgents PDF(38페이지, 1,903,362바이트)는 Mac과 Pi에서 모두 104,235자의 페이지별 텍스트와 주요 섹션 제목을 추출했다. Mac은 약 3.4초·최대 RSS 149MB, Pi 격리 환경은 약 1.1초·최대 RSS 156MB였고 Pi 설치 용량은 의존성 포함 약 87MB였다. 최대 20MB·100페이지 제한과 잘못된 PDF, 빈 텍스트, 파서 실패 분류를 단위 테스트로 고정했다.

선택의 대가는 설치 용량과 약 150MB대 피크 메모리다. 실제 복잡한 편집 문서에서 검색 품질이 부족하다고 측정될 때만 Poppler를 대안으로 다시 비교한다. 스캔 PDF의 실제 OCR 추출은 검증하지 않았으며, 현재는 텍스트가 없으면 `pdf_text_empty`로 분류한다. Claude PDF 전체 입력은 표·그림 품질은 좋지만 TradingAgents에서 87,811토큰이므로 기본 파서로 쓰지 않는다. 자동 OCR도 첫 구현 범위에서 제외한다.

**Phase B 색인 구현:** `createPaperFullTextService()`는 이미 저장된 활성 paper 노트와 검증된 PDF 바이트만 입력받는다. 논문 ID를 해시한 숨김 경로에 원본을 원자적으로 저장하고, 논문별 인프로세스 직렬화와 SHA-256·파서 버전·임베딩 유무를 기준으로 재색인을 차단한다. 중단된 `indexing` 상태는 다음 시작에서 `failed/index_interrupted`로 복구하고, 텍스트가 없으면 `needs_ocr`로 남긴다. URL 다운로드와 redirect별 SSRF 검사는 외부 입력 경로를 여는 Phase C에서 붙인다.

### 11.5 검색 방식

별도 벡터 DB나 새 서버를 추가하지 않는다.

- `paper_chunks` 안에서 키워드(BM25 계열) + 임베딩 유사도 하이브리드 검색
- 임베딩 텍스트 앞에 제목·섹션·페이지를 기계적으로 붙여 짧은 조각의 문맥 손실 완화
- 상위 조각을 점수순으로 고른 뒤 같은 섹션 중복을 줄이고 인접 문단은 `paper_fulltext_read`에서만 확장
- v1에는 LLM reranker를 넣지 않음. 실제 질문 회수율이 부족하다고 측정될 때만 추가
- `overview`는 섹션 제목과 대표 문단을 넓게 회수하고, `focused`는 질문과 가까운 원문 문단을 우선
- 전문 청크를 일반 `searchVault()` 결과에 섞지 않음. 먼저 paper 노트가 선택된 요청에서만 전용 검색

이 방식은 청크에 문서별 문맥을 덧붙여 임베딩·키워드 검색을 개선하는 Anthropic Contextual Retrieval의 원리를 사용하되, 색인 단계의 LLM 호출은 생략하고 논문의 기존 섹션 구조를 활용한다.

2026-07-15 Mac 임시 환경에서 TradingAgents 38페이지·104,235자를 97개 청크로 색인했다. 임베딩 없이 BM25 계열 검색만 사용한 기준 질문에서도 Analyst Team, Maximum Drawdown/Simulation Setup, Conclusion이 각각 방법론·실험·한계 질문의 top 4 안에 들어왔다(3/3). 임베딩 하이브리드 경로는 주입형 벡터 단위 테스트를 통과했으며 실제 OpenAI 질의 임베딩 재사용은 Phase C 연결 시 검증한다.

### 11.6 토큰 예산과 비용 통제

```text
FULLTEXT_MAX_TOOL_CALLS=2
FULLTEXT_MAX_CHUNKS_PER_SEARCH=4
FULLTEXT_MAX_RESULT_CHARS_PER_CALL=5000
FULLTEXT_MAX_CONTEXT_CHARS_PER_ANSWER=10000
FULLTEXT_TARGET_INPUT_TOKENS=3000
```

- 하드 제한은 서버의 문자 수·호출 횟수로 집행하고, 모델 프롬프트 지시에만 의존하지 않음
- 색인과 검색은 로컬 처리라 Claude 입력 토큰 0. 청크 임베딩은 최초 색인 시 한 번만 생성
- 질문 임베딩은 기존 질의 임베딩 흐름과 합쳐 중복 호출을 피함
- PDF 전체 또는 선택 페이지를 Claude에 보내는 시각 분석은 2.5A 첫 구현에서 제외
- 후속 표·그래프 분석을 넣을 때는 사용자가 명시한 경우에만 최대 3페이지를 보내고 count-tokens 결과가 별도 상한을 넘으면 재확인
- prompt caching은 같은 PDF를 짧은 시간 반복 분석할 때 비용을 낮출 수 있지만 기본 TTL이 짧아 장기 기억·색인을 대체하지 않음

### 11.7 저장 구조

paper 노트는 계속 사람과 기존 검색의 기준점으로 유지한다. 전문 파생 데이터는 일반 노트와 분리한다.

```text
VAULT_PATH/
  {paper-note}.md                    # 제목·초록·내 메모, 기존 그대로
  .paper-sources/{safe-id}/source.pdf # 공개 원본 캐시, 노트 목록/Codex에서 제외

SQLite
  paper_documents                   # paperId, note filename, URL, SHA-256, 상태, parser 버전
  paper_chunks                      # section, page range, ordinal, content, embedding
```

상태값은 `not_indexed | indexing | ready | failed | needs_ocr`로 제한한다. 서버 시작 중 `indexing`으로 남은 건 `failed`로 복구하고 재시도 가능하게 한다. paper 노트를 archive하면 전문 검색에서 제외하되 원본·청크는 즉시 삭제하지 않고, 복원 시 재색인 없이 되살린다. 실제 삭제 정책은 별도 승인 기능을 만들 때 정한다.

전용 테이블을 쓰는 이유는 전문 청크가 기존 QA 기반 `note_chunks`와 수명·페이지 메타데이터·검색 범위가 다르고, 일반 노트 검색을 오염시키면 안 되기 때문이다. DB와 vault 원본은 기존 일일 백업에 함께 포함된다.

Phase B 구현은 `paper_documents`에 source SHA/path, parser version, 상태, 페이지·문자·청크·임베딩 수를 저장하고, `paper_chunks`에 안정 chunk ID, 섹션, 페이지 범위, 순서, 본문, 선택적 임베딩, references 여부를 저장한다. 서버는 시작 시 스키마와 중단 복구만 수행하며 자동 다운로드·색인은 하지 않는다.

### 11.8 모델·의회 통합

- 단일 Claude/GPT: 기존 노트 검색이 후보 paper 노트를 회수한 경우에만 provider-neutral 전문 도구를 노출
- 후보 paperId는 activeNotes와 자동 회수 paper 노트의 교집합, 최대 3개
- 모델은 초록으로 충분하면 도구를 호출하지 않도록 시스템 기준 명시
- 의회 모드: 첫 답변 단계에서 전문 근거를 한 번만 가져오고 Claude·GPT 비평·수정 단계에 같은 evidence 공유. 모델별 중복 검색 금지
- 전문 근거는 기존 `<context>` 방어와 같은 외부 자료 블록으로 주입
- 답변에는 `초록 기반`, `전문 근거 사용`, `전문 미확보` 중 실제 상태를 표시할 수 있게 메타데이터 반환

### 11.9 실패·보안 경계

- 공개 PDF가 없음: 초록 기반으로만 답하고 `전문 미확보` 안내
- 다운로드/파싱 실패: paper 노트는 정상 유지, 색인 상태와 오류만 기록, 지수 백오프로 수동 재시도
- 텍스트가 거의 없음: `needs_ocr`; 자동 OCR·전체 Claude 전송으로 몰래 우회하지 않음
- SSRF 방어: DNS 해석과 모든 redirect 단계에서 loopback·사설·link-local 주소 차단
- 파일 방어: PDF magic bytes, 크기·페이지·처리 시간 제한, 파서는 shell 문자열 결합 없이 인자 배열로 실행
- 프롬프트 인젝션: PDF 안의 지시·URL·코드는 데이터일 뿐 실행·도구 호출 근거가 아님
- 모델이 반환하지 않은 chunkId, 다른 paperId, 임의 경로·URL을 요청하면 거부
- 원문은 공개 PDF이거나 사용자가 합법적으로 제공한 파일만 처리. 앱 밖으로 원문을 재배포하지 않음

### 11.10 구현 순서와 통과 기준

**A. 파서 spike — 제품 코드 연결 전**

- [x] TradingAgents에서 38페이지·104,235자와 주요 섹션을 Mac/Pi에서 동일하게 추출
- [x] Mac/Pi 처리 시간·최대 RSS를 측정하고 `pdf-parse` 2.4.5 선택
- [x] 잘못된 PDF, 빈 텍스트, 100페이지 초과, 파서 실패 함정 케이스 단위 테스트
- [x] 사용자에게 선택 이유·의존성·운영 영향을 설명하고 spike 구현 컨펌
- [ ] 실제 스캔 PDF/OCR 케이스 검증 (자동 OCR을 도입할 때만 진행)

**B. 로컬 색인·검색 — 모델 호출 없이**

- [x] 별도 `lib/paper-fulltext.js` + 전용 DB 테이블 + 해시 기반 숨김 원본 캐시
- [x] 같은 PDF 동시 색인 직렬화, SHA-256·파서 버전·임베딩 기준 중복 차단, 실패 복구
- [x] TradingAgents 방법론·실험·한계 질문 3/3에서 목표 근거가 top 4에 회수 (Mac 임시 환경)
- [x] 일반 `note_chunks`·검색·Codex 큐와 paper 노트 본문에 전문 청크가 섞이지 않음
- [x] Pi 앱 배포 후 전용 테이블 생성·원본 캐시·검색 재검증 (임시 DB·볼트, 실사용 데이터 미변경)

**C. 능동 독서 도구**

- [ ] 초록 답변 가능 질문 10개에서 도구 오호출 0회
- [ ] 전문 필요 질문 10개에서 섹션/페이지 근거 회수 성공률 8/10 이상
- [ ] 어떤 모델 출력에도 호출 2회·누적 10,000자 상한이 깨지지 않음
- [ ] 같은 논문 질문 10회에서 PDF 재다운로드·재색인 0회
- [ ] 의회 모드가 전문 검색을 한 번만 실행하고 근거를 공유
- [ ] 전체 PDF 87,811토큰 경로가 명시적 후속 기능 외에는 호출되지 않음

**D. 후속 확장 — 실측 후만**

- 표·그래프 질문용 선택 페이지 시각 분석
- OCR, LLM reranker, 섹션 계층 요약(RAPTOR식)은 회수 실패 사례가 쌓일 때만
- 외부 논문 발견 자율 검색(2.5B)은 전문 내부 검색과 별도 도구로 유지

### 11.11 근거 자료

- [Semantic Scholar Academic Graph API](https://www.semanticscholar.org/product/api): 공개 PDF URL·초록·요약 메타데이터 제공
- [Claude PDF support](https://docs.claude.com/en/docs/build-with-claude/pdf-support): PDF의 “text, pictures, charts, and tables”를 처리하며 요청 크기·페이지 제한을 명시
- [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval): “prepending chunk-specific explanatory context to each chunk before embedding”하는 검색 방식
- [PaperQA2](https://arxiv.org/abs/2409.13740): 전문 문헌에서 “assesses the relevance of sources and passages”하며 근거를 회수하는 에이전트 접근
- [RAPTOR](https://arxiv.org/abs/2401.18059): “a tree with differing levels of summarization”으로 긴 문서를 계층 회수. 초기 구현에는 넣지 않고 overview 실패 시 참고
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): 반복 문서 입력 비용 최적화. 기본 단기 캐시라 영구 색인을 대체하지 않음
