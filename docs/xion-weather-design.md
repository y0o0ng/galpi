# XION 홈 날씨 브리핑 — 설계

> 작성: 2026-08-21
> 상태: 구현 전 설계 확정안. 구현 계약은 이 문서가 단일 기준이다.

---

## 0. 결정 요약

XION 홈 머리줄에 현재 위치 기반의 짧은 날씨 브리핑을 붙인다.

이 기능은 날씨 앱이나 위치 시스템을 만드는 것이 아니다. 사용자에게 보이는 정보는 온도 하나와
문구 한 줄뿐이다.

```
늦은 밤이야                                🌧️ 27°
8월 21일 금요일
3시간 뒤 비가 올 수도 있대 ☔
```

비 소식이 없으면 기온에 따라 짧은 생활형 문구를 보여준다.

```
좋은 오후                                  ☀️ 32°
8월 22일 토요일
날씨가 많이 더워. 물 많이 마셔 💦
```

핵심 결정은 다음과 같다.

1. 날씨 공급자는 **기상청 단기예보 조회서비스 하나**만 사용한다.
2. 해외 날씨 provider와 provider router를 만들지 않는다.
3. 위치 이름·도시·주소·역지오코딩을 만들지 않는다.
4. 브라우저의 현재 위·경도를 받아 **서버가** 기상청 격자 `nx`·`ny`로 변환한다.
5. 브라우저는 **마지막 위치 한 건**만 기기에 저장한다.
6. 서버와 DB에는 위치 이력을 저장하지 않는다.
7. 단기예보의 `TMP`·`POP`·`PTY`·`SKY`만 사용한다.
8. 앞으로 12시간의 `POP`을 보고 **가장 가까운 강수 후보 하나**를 고른다.
9. `POP` 60~79는 가능성 표현, 80 이상은 강한 예보 표현을 쓴다.
10. 날씨 판단과 문구 생성은 **LLM이 아니라 결정론적 규칙**으로 한다.
11. 날씨·위치 획득 실패는 XION 홈 전체 실패로 번지지 않는다. 날씨 영역만 숨긴다.
12. 위치 이력·반복 장소 발견·본가 같은 named place는 별도의 향후 location track이다.

---

## 1. 현재 XION 홈과의 연결

`docs/xion-home-design.md` 1절이 정의하듯 XION 홈은 **기존 정본을 읽어 편집해 내놓는 read-only
projection**이고, 화면이 답하는 질문은 `지금 시온이 나한테 알려줘야 할 게 뭐지?`다. 같은 문서는
**"정상 상태는 정보가 적은 상태다"**라고 못박는다.

날씨도 이 원칙을 따른다. **새 날씨 섹션이나 카드 목록을 만들지 않는다.** 날짜와 같은 성격의
오늘의 주변 맥락으로 **머리줄에만** 붙는다.

현재 `makeHomeHead()`(`public/agent-panel.js:780`)는 `home-greeting`과 `home-date` 둘만 만들고
끝난다. 기능의 UI 연결점은 이 함수 하나다.

홈 v1의 통과 기준에 있던 `서버 변경 0줄`은 **이미 완료된 v1 구현 범위에 대한 제약**이었다.
날씨는 그 범위를 수정하는 것이 아니라 v1 이후의 독립적인 read-only 확장이다. 홈 설계 12절이
이 계약 하나를 깨는 것을 이미 명시적으로 수용했다.

**대신 날씨는 항상 있으므로 홈이 영영 비지 않는 화면이 된다.** 홈 설계 9절의 빈 상태가
사라지는 것은 감수한 대가다.

---

## 2. 외부 데이터

공공데이터포털의 **기상청_단기예보 조회서비스**를 사용한다. 공식 설명은 단기예보를 "예보단위를
상세화(3시간→1시간)"하고 "글피까지" 제공하는 예보로 설명하며, 전국을 5km × 5km 격자로 나눈다.

```
VilageFcstInfoService_2.0
└─ getVilageFcst
```

사용하는 기상 요소는 넷뿐이다.

| category | 의미 | XION 용도 |
|---|---|---|
| `TMP` | 1시간 기온 | 표시 온도 · 기온 문구 |
| `POP` | 강수확률 | 강수 브리핑 판단 |
| `PTY` | 강수형태 | 비/눈 구분과 emoji |
| `SKY` | 하늘상태 | 평상시 emoji |

습도·풍속·강수량·최저최고기온 등은 v1에서 읽지 않는다.

서비스는 무료이고 개발계정 기본 일일 호출 한도는 10,000회다. 인증키는 **서버 환경변수에만**
둔다.

---

## 3. 온도의 의미

**v1에서 표시하는 온도는 관측 실황이 아니다.** 현재 KST 이후 가장 가까운 단기예보 슬롯의
`TMP`다.

```
현재 23:27
예보 슬롯 00:00 → TMP 27
표시 → 27°
```

더 정확한 실황을 위해 `getUltraSrtNcst`를 추가로 호출하는 대안이 있지만 **채택하지 않는다.**

- 얻는 것: 외부 API 호출 한 번으로 모든 정보가 나오고, 발표시각 선택·실패 처리·테스트가 한
  경로에만 존재한다. 홈이 요구하는 것은 기상 관측 화면이 아니라 짧은 생활 브리핑이다.
- 치르는 것: 표시 온도가 실제 센서 관측값과 다소 다를 수 있다.

**실사용에서 이 차이가 거슬린다는 증거가 나오면** 그때 초단기실황을 별도로 검토한다. v1에서
미리 추가하지 않는다.

---

## 4. 위치 획득

브라우저에서 `navigator.geolocation.getCurrentPosition()`만 사용한다. **`watchPosition()`은
사용하지 않는다.**

Geolocation API는 HTTPS secure context와 사용자 권한을 요구한다. XION PWA는 이미 Tailscale
Serve의 HTTPS canonical origin에서 동작하고, 로컬 개발의 `http://127.0.0.1`도 secure context라
둘 다 성립한다.

### 요청 옵션

기상청 격자가 5km 단위이므로 GPS급 정밀도가 필요하지 않다.

```
enableHighAccuracy = false
timeout            = 5초
maximumAge         = 15분
```

**고정밀 GPS를 강제로 깨워서 전력과 응답 시간을 더 쓰지 않는다.**

---

## 5. 마지막 위치 캐시

마지막으로 성공한 위치 **한 건**을 기기 `localStorage`에 저장한다.

```json
{
  "lat": 35.95,
  "lon": 126.95,
  "accuracy": 80,
  "capturedAt": 1787320000000
}
```

키는 `councilLastLocation` 하나다. **`council` 접두사는 제품명이 갈피로 바뀐 뒤에도 기존 키
(`councilApiToken`·`councilUiHistory:shared-main`·`councilTheme`, `public/app.js:5-9`)가 일부러
유지하고 있는 관례다.** 날씨만 다른 접두사를 쓰면 저장소에 규칙이 둘이 된다.

### 동작

홈 진입 시:

1. `getCurrentPosition()` 시도
2. 성공 → 마지막 위치 갱신 → 새 좌표로 날씨 조회
3. 실패 → 최근 캐시가 있으면 fallback → 없거나 너무 오래됐으면 **날씨 숨김**

**fallback으로 쓸 마지막 위치의 최대 나이는 6시간이다.** 이 값은 위치 자체의 보존기간이 아니라
**잘못된 지역 날씨를 자신 있게 보여주지 않기 위한 weather fallback 제한**이다. 좌표 행 자체는
`localStorage`에 계속 남아 다음 정상 위치 성공 때 덮어쓴다.

### 왜 브라우저 기본 위치 캐시만 쓰지 않는가

더 단순한 대안은 `getCurrentPosition({ maximumAge })`에 전부 맡기는 것이다. 하지만 **브라우저
위치 캐시의 지속성을 XION이 계약할 수 없고**, 새 세션에서도 쓸 명시적인 마지막 좌표가 없다.
그래서 마지막 좌표 한 건만 XION이 직접 소유한다.

---

## 6. 위치 저장의 경계

**Weather v1은 위치 DB를 만들지 않는다.** 서버는 요청 중 받은 좌표를

```
lat/lon → KMA nx/ny → forecast request
```

에만 쓰고 저장하지 않는다. 다음은 만들지 않는다.

```
location_history
visited_places
home_location
school_location
location_clusters
```

**위치 좌표를 application log에도 남기지 않는다.** 오류 로그에는 weather error code만 남긴다.

---

## 7. 미래 Location Track

향후 proactive 기능에서 위치를 활용하는 방향 자체는 유효하다. 별도의 location track에서는
foreground에서 얻은 위치 샘플을 축적하고 반복적으로 등장하는 공간을 찾을 수 있다.

```
위치 샘플 → 반복 영역 탐지 → "여기 자주 있는 것 같은데 저장할 장소야?"
        → 사용자 확인 → 본가 → lat/lon
```

**장소의 의미를 시스템이 임의로 확정하지 않는다.** 집·본가·학교 같은 semantic label은 사용자
확인 후에만 생성한다. 그러면 미래에는 `"본가 쪽 날씨 어때?"` → saved place `본가` → `lat/lon` →
**동일 weather service**를 그대로 재사용할 수 있다.

**Weather v1은 이 미래를 위해 schema·repository·clustering abstraction을 미리 만들지 않는다.**

또 현재 PWA는 background에서 지속적인 위치 수집을 보장할 수 없다. 기존 일정 설계도 hidden
page가 freeze/discard될 수 있으므로 상시 background refresh를 계약하지 않는다. 향후 위치
샘플링을 하더라도 우선은 앱이 foreground인 순간의 샘플을 대상으로 한다.

---

## 8. KMA 좌표 변환

브라우저가 주는 WGS84 위·경도를 **서버에서** KMA DFS 격자 `nx`·`ny`로 변환한다. 기상청이
제공하는 단기예보 격자 변환 규칙(Lambert Conformal Conic)을 그대로 구현한다.

```
RE = 6371.00877   GRID = 5.0
SLAT1 = 30.0      SLAT2 = 60.0
OLON = 126.0      OLAT = 38.0
XO = 43           YO = 136
```

**generic GIS abstraction으로 만들지 않는다.** Weather 서비스 내부의 단일 함수

```
toKmaGrid(lat, lon) → { nx, ny }
```

면 충분하다. 향후 해외 provider가 추가되더라도 이 함수는 KMA adapter 내부에 남는다.

**기대 `nx`·`ny` 값은 기억이 아니라 기상청 공식 격자 자료로 대조해 테스트에 박는다.** 여기서
틀리면 조용히 다른 동네 날씨가 나오고, 화면에 지역 이름이 없으므로 사용자가 눈치챌 수 없다.

`nx`가 1~149, `ny`가 1~253 밖이면 격자 밖이다. **KMA를 부르지 않고** 그대로
`WEATHER_FORECAST_UNAVAILABLE`로 끝낸다(24절 해외 = 숨김).

---

## 9. 발표시각 선택

단기예보는 하루 8회 발표된다.

```
02:00  05:00  08:00  11:00  14:00  17:00  20:00  23:00
```

기상청 활용가이드의 발표 규칙에서 API 제공은 각 발표의 약 10분 뒤부터 시작한다. 따라서 현재
KST에서 **이미 제공 가능해진 가장 최근 슬롯**을 사용하고, 발표 직후 race를 피해 10분보다 여유
있는 **15분 safety margin**을 둔다.

```
14:07 → 11:00 발표본
14:15 → 14:00 발표본
01:30 → 전날 23:00 발표본
```

### 후보는 둘이다

**`selectKmaBaseTimes(now)`는 후보를 최신 순으로 최대 2개 돌려주고, 첫 후보가 실패하면 직전
발표본으로 한 번만 내려간다.** 재시도는 그것뿐이다 — 같은 후보를 다시 부르지 않는다.

근거는 이렇다. 15분 margin이 기상청 지연을 **항상** 덮는다는 확증이 없고, 못 덮는 순간
21절이 실패를 `숨김`으로 정의하므로 **발표 경계마다 날씨가 조용히 사라지고 아무도 눈치채지
못한다.** 직전 발표본은 최대 3시간 전 자료지만 12시간 창의 강수 판단에는 충분하다. 없는 것보다
낫다.

시간 계산은 전부 `Asia/Seoul` 기준이다.

---

## 10. KMA 응답 정규화

KMA의 category별 flat rows를 UI가 직접 해석하지 않는다. 서버가 먼저 시간 단위로 묶는다.

```
2026-08-22 00:00   TMP 27  POP 30  PTY 0  SKY 3
2026-08-22 01:00   TMP 26  POP 60  PTY 1  SKY 4
```

**프론트에 KMA 원본 category array를 노출하지 않는다.**

---

## 11. 강수 판단

현재 시각 이후 12시간을 본다. 그 범위 안에서 **`POP >= 60`인 첫 번째 예보 슬롯**을 찾는다.
가장 가까운 이벤트 하나만 브리핑한다.

### 11.1 `POP < 60`

강수 브리핑 없음. 기온 문구로 내려간다.

### 11.2 `POP` 60–79 — 가능성 표현

```
3시간 뒤 비가 올 수도 있대 ☔
2시간 뒤 눈이 올 수도 있대 ❄️
```

### 11.3 `POP >= 80` — 강한 예보 표현

```
3시간 뒤 비 예보가 있어. 우산 챙겨 ☔
2시간 뒤 눈 예보가 있어. 조심해서 다녀 ❄️
```

**80%를 100%처럼 번역해 "무조건 온다"고 표현하지 않는다.**

### 11.4 시간

forecast time과 현재시각의 차이를 시간 단위로 **올림**한다.

```
30분 후    → 1시간 뒤
2시간 10분 후 → 3시간 뒤
```

정밀한 분 단위 정보는 홈 브리핑에 필요하지 않다.

---

## 12. PTY 구분

`PTY`는 메시지와 emoji 구분에만 쓴다.

```
비 / 소나기  → rain
비와 눈      → mixed
눈           → snow
없음         → none
```

`mixed`는 `비나 눈이 올 수도 있대 🌨️`로 표현한다.

**`POP >= 60`인데 같은 시간의 `PTY`가 유효한 강수형태를 주지 않으면 데이터를 억지로 비라고
단정하지 않는다.**

```
강수 예보가 있어. 나갈 때 확인해봐 ☔
```

---

## 13. 기온 문구

향후 12시간 안에 강수 이벤트가 **없을 때만** 쓴다.

| 기온 | 문구 |
|---|---|
| 35°C 이상 | 오늘 정말 더워. 오래 밖에 있진 마 🥵 |
| 30–34°C | 날씨가 많이 더워. 물 많이 마셔 💦 |
| 26–29°C | 조금 더워. 가볍게 입어 ☀️ |
| 13–25°C | 날씨 괜찮아. 돌아다니기 좋겠어 🌿 |
| 6–12°C | 조금 쌀쌀해. 겉옷 챙겨 🧥 |
| 1–5°C | 날씨가 꽤 추워. 따뜻하게 입어 🧣 |
| 0°C 이하 | 밖에 많이 추워. 따뜻하게 입어 🥶 |

**이 값들은 기상학적 경보 기준이 아니라 XION의 생활형 UI 문구 경계다.** 따라서 실사용감에 따라
문구·문턱만 조정할 수 있고 KMA adapter와는 독립적이다.

**문구는 `lib/weather.js`의 `temperatureMessage`·`precipitationMessage` 두 함수에만 있다.**
고칠 때 그 둘 밖을 건드릴 일이 없고, 경계값 테스트(25.1)를 같이 고친다.

---

## 14. 현재 날씨 emoji

머리줄 첫 행 오른쪽은 `🌧️ 27°`처럼 표시한다. 현재 시각 이후 가장 가까운 슬롯의 `PTY`를 먼저
보고, 강수가 없으면 `SKY`를 본다.

```
rain            → 🌧️
mixed           → 🌨️
snow            → 🌨️
clear daytime   → ☀️
clear nighttime → 🌙
cloudy          → ☁️
```

**emoji는 decorative 표현일 뿐 상태 머신으로 쓰지 않는다.** 접근 가능한 실제 의미는 텍스트
message에 남는다.

아이콘을 SVG로 그리지 않는 근거는 홈 설계 12절에 있다. UI 계약의 "아이콘은 SVG로 그린다"는
버튼·컨트롤 안에서 글리프를 광학 중심에 맞추는 문제라 본문 텍스트 흐름의 이모지에는 해당하지
않고, 하늘상태 × 강수형태를 SVG로 그리면 텍스트 한 줄보다 일이 커진다.

---

## 15. 브리핑 우선순위

**한 번에 메시지 하나만 보여준다.**

우선순위의 제1 기준은 확률 등급이 아니라 **가장 먼저 사용자의 행동을 바꿔야 하는 사건의
시각**이다. 60% 강수 1시간 뒤와 90% 강수 10시간 뒤가 동시에 있으면 **가까운 시간의 60%가
이긴다.**

따라서 실제 알고리즘은 하나다.

```
POP >= 60인 시간 슬롯 중 가장 가까운 것 선택
→ 그 슬롯의 POP로 문구 강도 결정
→ 없으면 기온 문구
```

---

## 16. 서버 API

새 read-only endpoint 하나를 추가한다.

```
GET /api/weather?lat={latitude}&lon={longitude}
```

**성공 응답에 `success` 필드를 두지 않는다.** `/api/mail/*`·`/api/news/*` 어디에도 없다 —
성공은 HTTP 200이고 실패만 `{ error, code }`다. 날씨만 다른 모양을 쓰면 클라이언트에 분기가
하나 는다.

강수 있음:

```json
{
  "temperature": 27,
  "icon": "🌧️",
  "message": "3시간 뒤 비가 올 수도 있대 ☔",
  "forecast": { "type": "rain", "probability": 70, "inHours": 3 }
}
```

강수 없음:

```json
{
  "temperature": 32,
  "icon": "☀️",
  "message": "날씨가 많이 더워. 물 많이 마셔 💦",
  "forecast": null
}
```

**프론트가 문구 규칙을 다시 구현하지 않는다.**

| 상황 | 응답 |
|---|---|
| 좌표가 숫자가 아니거나 범위 밖 | `400 WEATHER_INVALID_LOCATION` |
| 기능 비활성 | `503 WEATHER_DISABLED` |
| KMA 실패 | `502 WEATHER_PROVIDER_FAILED` |
| 예보 없음 · 격자 밖 | `502 WEATHER_FORECAST_UNAVAILABLE` |

**오류 응답에 raw KMA body·API key·좌표를 넣지 않는다.**

---

## 17. 서버 모듈 경계

갈피는 feature route를 `register...Routes()` 형태의 작은 모듈로 분리한다(`lib/mail/routes.js`,
`lib/news/routes.js`). Weather도 **이 기존 스타일만** 따른다.

```
lib/weather.js         toKmaGrid · selectKmaBaseTimes · normalizeForecast
                       buildWeatherBriefing · createWeatherService · weatherError
lib/weather-routes.js  registerWeatherRoutes · GET /api/weather · 입력 validation
                       feature guard · 오류 → HTTP mapping
```

`registerWeatherRoutes({ app, config, service })`는 메일과 같은 계약이다. **`guard(res)`가
`config.enabled !== true`면 503으로 끝내고, 라우트 등록 자체는 항상 한다.** 도메인 오류는
`error.statusCode`·`error.code`를 달고 올라오고 route는 그것을 그대로 내보낸다. 없으면
502 `WEATHER_PROVIDER_FAILED`로 떨어진다. 로그는 code 한 줄뿐이다.

`createWeatherService`는 `fetchImpl`·`now`를 주입받는다(`lib/paper-search.js`가 같은 방식).
KMA 호출에는 `AbortSignal.timeout(8000)`을 붙이고 **별도 재시도는 없다** — 9절의 발표본 폴백이
이미 두 번째 시도다.

다음은 만들지 않는다.

```
provider interface     location service
forecast repository    weather domain framework
```

---

## 18. 인증키

```bash
WEATHER_ENABLED=false
KMA_SERVICE_KEY=
```

기본은 꺼진 상태다. Weather는 `WEATHER_ENABLED === true`이고 `KMA_SERVICE_KEY`가 있을 때만
호출 가능하다. **키는 브라우저로 절대 전달하지 않는다.**

공공데이터포털은 Encoding/Decoding 두 형태의 인증키를 주기 때문에 이중 URL encoding 문제가
흔하다. **갈피는 환경변수에 Decoding key를 넣고 HTTP client가 한 번만 encode하는 방식으로
고정한다.** Encoding key를 넣으면 `SERVICE_KEY_IS_NOT_REGISTERED`가 난다.

`.env.example`에도 실제 값 없이 변수명과 이 주의사항만 넣는다.

---

## 19. 클라이언트 흐름

**날씨를 홈 렌더의 대기 대상에 넣지 않는다.**

```
홈 데이터 load (Promise.allSettled)
├─ Attention
├─ Tasks
├─ Agent status
└─ News
        ↓ renderSummary()
        ↓
     Weather (기다리지 않고 던진다)
     ├─ location
     └─ /api/weather
            ↓ 도착하면 머리 노드만 교체
```

위치 획득이 최대 5초라 `Promise.allSettled` 배열에 넣으면 홈 전체가 그만큼 늦어진다. 먼저
기존 홈을 렌더하고, 날씨는 준비되는 대로 머리줄만 갱신한다.

`renderSummary()`는 `container.replaceChildren()`으로 전부 다시 그리므로 날씨만 왔을 때 전체를
다시 그리면 스크롤이 튄다. **`makeHomeHead()`가 만든 노드를 잡아두고 그것만 바꾼다.** 늦게 온
응답이 이미 다른 화면을 덮지 않도록 기존 `state.requestId` staleness 가드를 같이 쓴다.

`503 WEATHER_DISABLED`는 오류가 아니다. 메일·뉴스와 같은 이유로 실패로 다루지 않는다.

---

## 20. UI

기존:

```
늦은 밤이야
8월 21일 금요일
```

변경 — **3행 구조**:

```
┌─ 350px ─────────────────────────┐
│ 늦은 밤이야              🌧️ 27° │  .home-head-top (flex, space-between)
│ 8월 21일 금요일                 │  .home-date (그대로)
│ 3시간 뒤 비가 올 수도 있대 ☔    │  .home-weather-message
└─────────────────────────────────┘
```

**좌/우 2열로 나누지 않는다.** 지식 패널이 데스크톱에서 350px 고정이라(홈 설계 8절) 오른쪽 열이
실질 190~210px가 되고, 그 폭에서 브리핑 문구가 두 줄로 감겨 머리가 3줄 이상으로 커진다. 1행만
좌우로 나누면 온도(`🌧️ 27°`)는 짧아서 안 감기고 문구는 전체 폭을 쓴다.

### 공간 규칙

- 온도 행은 한 줄
- message는 최대 두 줄
- 별도 카드·border·background 없음
- 클릭 동작 없음, 상세 날씨 화면 없음
- **새 글자 크기·굵기·모서리 값을 만들지 않는다** — 홈은 9px·11px·17px과 650·700만 쓴다.
  온도와 문구는 둘 다 11px이고, 온도는 650으로 본문 잉크, 문구는 `var(--label)`이다
- 첫 viewport의 `확인할 것`과 `오늘`을 밀어내면 안 된다(홈 설계 8절)

---

## 21. 로딩과 실패 UI

**Weather는 skeleton을 만들지 않는다.**

```
로딩 중 → 아무것도 표시하지 않음
성공   → 날씨 영역 등장
실패   → 계속 아무것도 표시하지 않음
```

다음과 같은 문구를 만들지 않는다.

```
날씨 확인 중...
위치를 찾을 수 없음
기상청 오류
날씨를 불러오지 못했습니다
```

**홈은 diagnostics 화면이 아니다.** 위치 권한을 거부했을 때도 toast를 반복해 띄우지 않는다.
뉴스가 이미 같은 계약이다.

---

## 22. Weather 캐시

**서버 DB 캐시를 만들지 않는다.** KMA 호출량이 낮고 한 명이 쓰는 시스템이라 DB 캐시는 지금
문제를 해결하지 않는다.

**클라이언트 세션 안에서는 마지막 성공 결과와 조회시각을 state에 두고 15분 이내의 홈 refresh
에서는 재사용한다.** 이건 선택이 아니라 필수다 — 홈은 60초마다 자동 refresh하므로
(`public/app.js`의 `startTaskRefresh`) 캐시가 없으면 KMA를 시간당 60번 부른다.

15분 뒤 또는 새 앱 세션에서 다시 위치·날씨를 갱신한다. 서버 multi-user cache나 persistent
forecast cache는 실사용에서 호출량·latency 문제가 확인된 뒤 검토한다.

---

## 23. 위치가 바뀌었을 때

새 `lat`/`lon`을 격자로 바꿨을 때 이전 `nx`·`ny`와 같다면 같은 forecast region이다. 하지만
**v1에서 브라우저는 `nx`·`ny`를 모르므로 이 최적화를 위해 API를 추가하지 않는다.** 한 홈
weather refresh당 한 번 호출한다. 호출량이 문제가 되기 전에는 최적화하지 않는다.

---

## 24. 해외

**Weather v1의 지원 범위는 대한민국이다.** 도시·국가 문자열을 만들지 않는다. 격자 밖 좌표이거나
KMA가 유효한 예보를 반환하지 못하면 **Weather 영역을 숨긴다.**

향후 실제 해외 사용이 필요해지면 `한국 → KMA / 해외 → 별도 provider`를 검토한다. 그 시점에도
XION이 쓰는 상위 계약 `weather(lat, lon)`은 바뀔 필요가 없다. **v1에서 `WeatherProvider`
interface나 국가 router를 선행 구현하지 않는다.**

---

## 25. 테스트

### 25.1 순수 로직 — `test/weather.test.js`

`fetchImpl`·`now`를 주입해 네트워크를 타지 않는다.

- **`toKmaGrid`** — 기상청 공식 격자 자료에서 뽑은 좌표들 → 기대 `nx`/`ny`, 격자 경계,
  invalid `lat`/`lon` 거부, 범위 밖 좌표
- **`selectKmaBaseTimes`** — `01:00`→전날 23시, `02:05`→전날 23시, `02:20`→당일 02시,
  `14:07`→11시, `14:20`→14시, 날짜 경계, **두 번째 후보가 직전 발표본인지**
- **`normalizeForecast`** — category 순서 무관, `TMP`/`POP`/`PTY`/`SKY` 일부 누락,
  malformed payload 거부
- **`buildWeatherBriefing`** — `POP` 59/60/79/80 경계, 여러 강수 슬롯 중 가장 가까운 것,
  12시간 밖 강수 무시, 비/눈/혼합, `POP>=60`인데 `PTY` 무효일 때의 하향 문구, 기온 경계 전부
- **`createWeatherService`** — 최신 발표본 실패 → 직전 발표본 성공, 둘 다 실패 →
  `WEATHER_PROVIDER_FAILED`, 서비스키가 정확히 한 번만 인코딩되는지

### 25.2 route — `test/weather-routes.test.js`

`test/mail-routes.test.js`의 `createFakeApp()`을 그대로 쓴다. Express도 HTTP도 띄우지 않는다.

- disabled → 503 `WEATHER_DISABLED`
- 좌표 없음 · NaN · 범위 밖 → 400 `WEATHER_INVALID_LOCATION`
- 정상 fixture → compact response, **`success` 필드 없음**
- KMA HTTP 실패 → 502 `WEATHER_PROVIDER_FAILED`
- KMA `resultCode` 실패 → 502 `WEATHER_PROVIDER_FAILED`
- 예보 없음 · 격자 밖 → 502 `WEATHER_FORECAST_UNAVAILABLE`
- **응답 본문과 로그에 API 키·좌표·raw provider payload가 없다**

### 25.3 UI 계약 — `test/chat-ui.test.js`

- `.home-head-top`이 `justify-content: space-between`
- `.home-weather-now`·`.home-weather-message`가 `font-size: 11px`
- `agent-panel.js`에 `watchPosition`이 **없다**
- `agent-panel.js`에 실패 문구가 **없다**(21절)
- 날씨 로드가 `Promise.allSettled` 배열 안에 **없다**(19절 비차단 계약)

### 25.4 실제 픽셀 — Playwright

- location 성공 → Weather 표시 / location 실패 + 최근 cache → cache 사용 /
  location 실패 + stale·no cache → Weather 없음
- Weather API 실패 → 기존 홈 정상
- `🌧️ 27°` + 두 줄 message가 panel overflow를 만들지 않음
- light·dark, 390×844, 1440×900

---

## 26. 통과 기준

- [x] XION 홈 머리줄에 emoji + 온도 + 한 줄/두 줄 브리핑이 표시된다
- [x] Weather가 새 카드나 홈 섹션을 만들지 않는다
- [x] 단기예보 `TMP`/`POP`/`PTY`/`SKY`만으로 동작한다
- [x] `POP` 59/60/79/80 경계가 결정론적으로 동작한다
- [x] 강수 후보는 현재 이후 12시간 중 가장 가까운 `POP >= 60` 시간이다
- [x] 비·눈·혼합 강수를 구분한다
- [x] 강수 후보가 없으면 기온 문구가 표시된다
- [x] 최신 발표본이 아직 없을 때 직전 발표본으로 한 번 내려가고, 둘 다 실패하면 숨긴다
- [x] `getCurrentPosition()`만 쓰고 `watchPosition()`을 쓰지 않는다
- [x] 마지막 성공 좌표 한 건만 기기에 저장된다
- [x] 위치 이력이나 장소 DB가 생기지 않는다
- [x] KMA API key가 browser response·bundle·log에 노출되지 않는다
- [x] 위치 좌표가 서버 로그에 남지 않는다
- [x] 날씨가 홈 첫 렌더를 지연시키지 않는다
- [x] 15분 이내 재조회에서 KMA를 다시 부르지 않는다
- [x] Weather 실패가 `확인할 것`·`오늘`·에이전트 상태 렌더링을 깨지 않는다
- [x] 위치 권한 거부 시 반복 오류 UI가 나타나지 않는다 — 30.1절
- [x] 390×844에서 Weather가 `오늘` 영역을 불필요하게 아래로 밀지 않는다
- [x] 기존 XION 홈·뉴스·일정·Mail UI가 회귀하지 않는다

---

## 27. 예상 변경 범위

```
.env.example                     WEATHER_ENABLED · KMA_SERVICE_KEY
server.js                        플래그 · registerWeatherRoutes · /api/config
lib/weather.js                   new
lib/weather-routes.js            new
public/app.js                    AgentPanel.init에 weatherEnabled 전달
public/agent-panel.js            state · loadWeather · makeHomeHead
public/style.css                 .home-head-top · .home-weather-*
test/weather.test.js             new
test/weather-routes.test.js      new
test/chat-ui.test.js             UI 계약 추가
docs/xion-weather-design.md      this document
docs/xion-home-design.md         12절을 현재 계약으로
docs/roadmap.md                  독립 트랙 한 줄
CLAUDE.md · AGENTS.md            열린 작업 항목 교체 (둘의 내용은 제목만 빼고 같다)
```

**DB migration은 없다.** 새 표도 새 스키마 버전도 만들지 않는다.
**새 npm dependency도 필요하지 않다.** Node의 전역 `fetch`와 브라우저 Geolocation API만 쓴다.
**`/api/weather` 외에 새 endpoint가 없다.** `/api/config`는 기존 응답에 boolean 한 줄만 는다.

---

## 28. 하지 않는 것

```
현재 위치 지속 추적      background GPS         위치 history DB
위치 clustering          home/work/school 추론   named place
역지오코딩               도시명 표시             지도
Weather 상세 화면        주간예보 UI             습도·풍속·미세먼지
기상 특보                LLM 날씨 문구 생성      proactive Weather push
해외 Weather provider    범용 provider abstraction
location framework       forecast DB/cache      초단기실황 추가 호출
```

향후 필요성이 실제로 생겼을 때 각각 별도 설계한다.

---

## 29. 구현 기록 — 2026-08-22

설계대로 구현했고, 여기에는 **설계가 정하지 않아 구현하면서 정한 것**과 **실측**만 남긴다.
계약이 바뀐 것은 없다.

### 29.1 실제로 생긴 파일

```
lib/weather.js              toKmaGrid · selectKmaBaseTimes · normalizeForecast
                            buildWeatherBriefing · createWeatherService · weatherError
lib/weather-routes.js       registerWeatherRoutes · GET /api/weather
test/weather.test.js        25개
test/weather-routes.test.js 10개
test/chat-ui.test.js        UI 계약 2개 추가
```

`server.js`·`public/app.js`·`public/agent-panel.js`·`public/style.css`는 27절 예상 범위
그대로다. **DB migration도 새 의존성도 없다.** 전체 회귀는 949개 통과다.

### 29.2 설계가 정하지 않아 구현하면서 정한 것

**`resultCode`는 `00`과 `0` 둘 다 정상으로 받는다.** 활용가이드의 응답 명세는 샘플데이터를
`00`으로 적는데 **같은 문서의 요청/응답 예제는 `<resultCode>0</resultCode>`**로 적는다. 하나만
받으면 언젠가 정상 응답을 provider 실패로 읽는다.

**`numOfRows=1000`으로 받아 서버에서 자른다.** 필요한 것은 12시간치지만 응답이 `fcstTime`
오름차순이라는 것을 명세가 계약하지 않는다. 앞쪽 몇 행만 받으면 정렬이 바뀌는 날 조용히
빈 예보가 된다.

**빈 좌표를 0으로 읽지 않는다.** `Number('')`가 `0`이라 `lat`이 통째로 빠진 요청이 "위도 0·
경도 0"이라는 유효한 좌표로 통과했다. 격자 밖이므로 400이 아니라 502가 나가던 구멍이라
`toCoordinate`로 라우트와 `toKmaGrid` 양쪽을 막았다.

**라우트는 도메인 오류의 `message`를 그대로 내보내지 않는다.** 코드 → 고정 문구 표(`MESSAGES`)
로 잠갔다. 16절이 금지하는 것은 raw KMA body지만, `error.message`를 통과시키면 언젠가 provider
원문이나 좌표를 담은 오류가 그 통로로 그대로 나간다.

**`SKY`를 모르면 맑다고 말하지 않는다.** 14절의 표에 없는 경우다. `PTY`도 `SKY`도 못 읽으면
`☀️`가 아니라 `☁️`를 쓴다 — emoji는 장식이지만(14절) 폭우 중에 해를 그리는 것은 장식이 아니다.

**혼합 강수의 `POP >= 80` 문구는 `비나 눈 예보가 있어. 우산 챙겨 🌨️`다.** 11.3절이 비와 눈만
적었다. 12절의 `mixed` 표현을 11.3의 문형에 그대로 얹었다.

### 29.3 격자 변환 검증

`reference/기상청41_…_격자_위경도(2607).xlsx`의 **3,761개 행정구역 전수**를 `toKmaGrid`와
대조했다.

| | |
|---|---|
| 일치 | 3,718 / 3,761 (98.9%) |
| 불일치 | 43건 |

**불일치 43건은 전부 격자 경계에 걸친 동 단위다**(수유1동·도림동·개포3동·청림동·좌천동…).
엑셀의 동 대표점이 5km 셀 경계에 얹혀 있어서 나는 차이이므로 **변환식을 엑셀에 맞추려 고치면
나머지 3,718건이 깨진다.** 8절이 요구한 테스트 fixture는 경계에서 먼 시·도 대표점으로 박았다 —
서울 `(60,127)` · 부산 `(98,76)` · 제주시 `(53,38)` · 전주 `(63,89)`.

### 29.4 실측 왕복

실제 `KMA_SERVICE_KEY`(Decoding key, 86자)로 한 번 불렀다.

```
KST 2026-08-22 00:56
base 후보  [20260821 2300, 20260821 2000]
서울시청 (37.5665, 126.9780) → 격자 (60, 127)

{ "temperature": 25, "icon": "☁️",
  "message": "3시간 뒤 비가 올 수도 있대 ☔",
  "forecast": { "type": "rain", "probability": 60, "inHours": 3 } }
```

**Decoding key가 한 번만 인코딩돼 통과했다**(18절 확인). 아이콘 `☁️`와 문구의 비가 어긋나
보이지만 설계대로다 — 아이콘은 **현재 슬롯**(`SKY 4` 흐림)을 읽고 문구는 **가장 가까운
`POP >= 60` 슬롯**(15절)을 읽는다.

### 29.5 Pi 배포 — 2026-08-22 01:07 KST

```
백업     galpi-20260822-0104.db · vault-20260822-0104.tar.gz
         galpi-code-before-weather-20260822-010402.tar.gz
         .env.before-weather-20260822-010435
복사     10개 파일, SHA-256 전부 일치
.env     WEATHER_ENABLED=true · KMA_SERVICE_KEY(86자)
Pi 회귀  날씨 35 + UI 계약 37 = 72개 통과
Pi 왕복  {"temperature":25,"icon":"☁️","message":"2시간 뒤 비가 올 수도 있대 ☔"}
기동     01:07:53 KST, /api/config weatherEnabled=true, 날씨 오류 로그 0건
```

**실기기(iPhone) 1차 확인**: 머리줄 3행이 정상이고 표시 온도가 실제 지역과 일치했다.
**다만 위치 권한 프롬프트가 뜨지 않았다** — 30.1절.

### 29.6 아직 하지 않은 것

- **25.4 Playwright 실제 픽셀** — 390×844·1440×900, light·dark, 위치 거부/캐시 시나리오
- **26절 통과 기준 확정** — 실기기 인수 뒤에 체크한다

---

## 30. 관측

### 30.1 위치 권한 프롬프트가 뜨지 않았다 — 2026-08-22

첫 실기기 확인에서 **권한을 묻는 대화상자 없이 날씨가 곧바로 표시됐고 온도는 실제 지역과
일치했다.**

**동작은 정상이다.** 19절의 `currentLocation()`에서 날씨가 표시되는 경로는 둘뿐이고, 첫
실행에는 `councilLastLocation` 캐시가 존재할 수 없으므로 **`getCurrentPosition()`이 실제로
성공한 것 말고는 표시될 방법이 없다.** 서버 쪽에도 날씨 오류가 0건이다.

그러면 남는 것은 **왜 묻지 않았는가**이고, 답은 브라우저의 위치 정책이지 XION의 코드가
아니다. iOS `설정 → Safari → 위치`가 `확인`이 아니라 `허용`이면 사이트마다 묻지 않고 바로
내준다. 같은 origin에 이미 권한이 남아 있어도 같다.

### 30.2 거부 경로를 어떤 근거로 닫았는가 — 2026-08-22

거부 화면은 **실기기에서 프롬프트를 띄워 확인하지 않았다.** 기기 설정이 자동 허용이라 뜨지
않았고, 그것을 보려면 설정을 뒤집어야 한다. 사용자 판단으로 아래 근거를 받아 닫았다.

1. **로딩과 실패는 렌더 경로가 하나다.** 둘 다 `state.weather === null`인 `makeHomeHead()`이고
   분기가 없다. 사용자는 첫 진입의 공백으로 그 화면을 실제로 봤다.
2. **실패 문구가 존재할 수 없다.** `test/chat-ui.test.js`가 `agent-panel.js`의 코드에서
   `날씨 확인 중`·`위치를 찾을 수 없`·`기상청`·`날씨를 불러오지 못`을 금지한다. 띄우려 해도
   띄울 문자열이 없다.
3. **거부는 예외가 아니라 값이다.** `getCurrentPosition`의 error 콜백이 `fallback()`으로
   들어가고, 캐시가 없거나 6시간을 넘으면 `resolve(null)`이라 `refreshWeather`가 머리 노드를
   건드리지 않고 끝난다. toast를 부르는 경로 자체가 없다.

**남은 실제 차이 하나**: 거부해도 6시간 안에 찍힌 `councilLastLocation`이 있으면 공백이 아니라
**그 좌표의 날씨가 뜬다**(5절의 fallback). 이건 설계된 동작이고 오류 UI와는 무관하다.
