# CLAUDE.md

> 이 파일은 향후 Claude(또는 다른 AI 어시스턴트)와 작업할 때, 그리고
> 프로젝트에 새로 합류한 개발자가 빠르게 컨텍스트를 잡기 위한 메모입니다.
> 사용자용 문서는 `README.md`이고, **이 파일은 코드를 *변경*하려는 사람이 읽는 문서**입니다.

## 1. 한 줄 요약

Playwright + MCP 기반 한국/미국 주식 비교 분석 자동화. v0.3에서 **통합 대시보드(국내·미국 주식 정량 카드 + 주간 날씨)** 추가. 데이터 소스 어댑터 패턴, 통화 인지 리포트, 소스 교차 검증을 포함. 사용자는 테스트 자동화 엔지니어이며 GitHub 저장소는 [`daewon82/trading`](https://github.com/daewon82/trading).

## 2. 두 가지 실행 모드

| 모드 | 사용 도구 | 진입점 |
|---|---|---|
| **자동화 모드** | Playwright Test 러너 | `npm run test:kr`, `test:us`, `test:health` |
| **MCP 모드** | Claude Desktop + `@playwright/mcp` | `prompts/mcp-analysis-prompt.md` 를 Claude에 붙여넣기 |

두 모드는 동일한 도메인, 동일한 비교 로직, 동일한 리포트 포맷을 공유한다.

## 3. 스택

- Node.js 18+, TypeScript (strict, ES2022 target, ESNext modules)
- Playwright Test 1.48+ (Chromium만 사용)
- 런타임 의존성 없음, devDeps만
- Asia/Seoul 타임존, ko-KR 로케일
- `package.json`에 `"type": "module"` — import는 반드시 `.js` 확장자 (TS source 파일이라도)

## 4. 아키텍처

### 4.1 레이어

```
sources/   → 페이지 진입, selector, 파싱
analyzers/ → 순수 로직 (비교, 검증)
reporters/ → 출력 포맷팅
tests/     → Playwright spec, sources + analyzers 오케스트레이션
scripts/   → 단독 실행 도구 (JSON → HTML 변환 등)
```

### 4.2 핵심 추상화: `StockSource`

`src/sources/StockSource.ts`가 모든 데이터 소스의 계약. 어댑터는 다음 메서드 구현:

- `open(page, code)` — 페이지 진입 + 핵심 영역 렌더링 대기
- `extractSnapshot(page, code)` — `StockSnapshot` 반환
- `healthCheck(page, sample)` — `HealthCheckResult` 반환 (selector 생존만 확인)

세 개 어댑터:

| 어댑터 | 시장 | URL 패턴 |
|---|---|---|
| `NaverKrSource` | KR | `finance.naver.com/item/main.naver?code={code}` |
| `NaverGlobalSource` | US | `m.stock.naver.com/worldstock/stock/{TICKER}.O\|.K/total` |
| `YahooFinanceSource` | US | `finance.yahoo.com/quote/{TICKER}/` |

**Selector는 모두 어댑터 내부 `private readonly sel = {...}` 객체에 격리**되어 있다. 마크업이 바뀌면 그 객체만 수정한다.

### 4.3 도메인 모델 — 깨면 안 되는 불변식

- `StockSnapshot.marketCap`은 **통화 기본단위로 저장** (KRW: 원, USD: 달러). 표시 단위(조/억 vs T/B/M)는 reporter 책임.
- `StockComparator.compare()`는 입력 스냅샷의 통화가 섞이면 **명시적으로 throw**. KR/US 리포트는 항상 분리.
- `Currency`, `Market`, `SourceId`는 `src/types/stock.ts`의 string literal union.

### 4.4 소스 교차 검증

`CrossSourceVerifier`는 동일 ticker를 두 어댑터에서 수집한 결과를 비교. 기본 허용 오차: 가격 1%, 시총 2%, PER 5%. `tests/us-stock-comparison.spec.ts`에서 사용:
- 기본: 첫 ticker(AAPL)만 교차 검증 (시간 절약)
- `CROSS_VERIFY=1` 환경변수: 모든 ticker 교차 검증

## 5. 컨벤션

- Selector hard-code 금지 — 어댑터 `sel` 객체에만
- async page 호출은 모두 timeout-bounded (Playwright 내장 또는 명시 `{ timeout }`)
- 로깅은 `logger.info/warn/error`로 구조화 메타와 함께. `console.log` 직접 사용 금지
- 한국어 숫자 표기("5,930", "12.34%", "1조 2,000억") 파싱은 `utils/logger.ts`의 `parseKoreanNumber()` 에 집중
- 테스트는 직렬 실행 (`fullyParallel: false`) — 같은 도메인 연속 호출 회피
- 스냅샷 JSON과 HTML 리포트 동시 저장 — 재현성/감사 추적

## 6. 자주 쓰는 명령

```bash
# 최초 1회
npm install
npx playwright install chromium

# 회귀 검증 (가장 빠름, ~30초)
npm run test:health

# 데이터 수집 + 리포트 생성
npm run test:kr            # 국내 5종목
npm run test:us            # 미국 5종목 + AAPL 교차검증
npm run test:us:full       # 모든 종목 교차검증

# 통합 대시보드 (v0.3) — 국내 2 + 미국 빅테크 6 + 주간 날씨(서울/고양)
npm run test:dashboard

# 종목 변경
KR_STOCK_CODES=005930,068270 npm run test:kr
US_STOCK_TICKERS=NVDA,TSLA,AMD npm run test:us

# 타입 검증만
npm run lint

# MCP 결과 JSON → HTML
npm run report:generate -- reports/from-mcp.json
```

## 7. 현재 상태 (v1.0)

### v1.0 — 단순화: 나의 관심종목 + 저평가+외인기관 매수 (사용자 요청)

페이지 구조:
1. 💼 매수한 종목 (localStorage)
2. 📋 변동 사항 (자동)
3. 🔎 종목 검색 (임시)
4. **💖 나의 관심종목 (4종 고정)**: 삼성전자(005930)·LG전자(066570)·기아(000270)·SK텔레콤(017670)
5. **💎 저평가 + 외인+기관 20일 매수 Top 5**
6. **📋 매수 시점 시그널 안내** (전문 투자자가 자주 보는 외인·기관 매수 시그널 룰)
7. 📰 경제 기사 (RSS)

제거된 영역 (페이지 표시 X, fetch도 X):
- 🚀 코스피 매수 후보 Top 10 (KR universe)
- 📚 KR 저평가 후보 인사이트
- 🌏 외국인 매수 Top 10
- 💎 미국 저평가 후보 Top 10
- 🚀 미국 매수 추천 Top 5
- 🇰🇷 국내 주식 12종 / 🇺🇸 미국 빅테크 6종

수급 분석 기간 확장 (사용자 옵션 2):
- **5d / 20d / 60d 누적 모두 표시** (네이버 frgn.naver page 1~6 fetch)
- 관심종목 4 + 가치 후보 풀에만 multi-page fetch (시간 절약)
- 외인+기관 5d 동반 매수: 단기 추세 ★
- 외인+기관 **20d 동반 매수: 추세 매수 확정 ★★ (펀드매니저 표준 기간)**
- 외인+기관 60d 동반 매수: 장기 매수 사이클 ★★★

claude.md 10절 룰 유지 — "추천" 단정 라벨 X, 사실 정보 기반.

### v0.6 (이전)

### v0.6 — 거시 환경 위젯 + 추가 기술지표 + 룰 안내 + 잔디 형식 개편

대시보드 (HTML, Pages):
- **거시 환경 위젯** (헤더 아래): 코스피(`^KS11`), 원/달러(`KRW=X`), 미국 10년물(`^TNX`). Yahoo chart API meta 필드(regularMarketPrice + chartPreviousClose) 활용. 키 불필요.
- **추가 기술지표 (카드)**: 5/20/60일선 정배열 여부, 거래량 20일 평균 대비 비율 (예: 1.5×)
- **룰 안내 푸터**: DCA, 밸류에이션 채널, 이격 매수, 정배열 모멘텀, 리스크 관리 — 정보 카드. **결론 라벨 없음.**
- 카드의 PricePoint에 volume 필드 추출 추가

잔디 알림 — 사용자 요청에 따라 단순화·재구성:
- **본문**: 당일 비 예보면 "🌧️ 오늘 비 예보!" 추가, 메시지 보더 색상 빨강
- **이번 주 날씨**: 비 오는 날만 표시 (`🌧️ 5/8(금) 비 (80%)`). 비 없으면 "이번 주 비 예보 없음 ☀️"
- **국내·미국 주식**: 매수 참조가만 (`현재가 + Q1 + Q2 + 200d`). RSI/cross/수급 등 상세는 Pages 대시보드에서.
- **링크**: Pages 최신 + 오늘 스냅샷
- **면책**: 짧게

### v0.5 — 1년 주가 sparkline + 외국인/기관 수급 (KR)

### v0.5 — 1년 주가 sparkline + 외국인/기관 수급 (KR)

- **Sparkline**: Yahoo chart에서 받은 시계열의 **최근 60거래일 close 가격**을 SVG polyline으로 카드 헤더에 표시. 한국식 색상(시작점 대비 상승=빨강, 하락=녹색).
- **외국인/기관 수급(KR 한정)**: 네이버 금융 외국인·기관 매매동향 페이지(`item/frgn.naver?code=...`)에서 일자별 순매매량(주식 수) 추출.
  - 카드에 5거래일/10거래일 누적 순매수 표시 (양수=매수, 음수=매도)
  - 매수/매도 색상 강조 (빨/녹)
  - 잔디 알림 KR 종목 요약 한 줄에도 `외인5d ... 기관5d ...` 추가
- US 종목은 한국과 동등한 일별 외국인·기관 수급 데이터가 없어 **수급 표시 안 함** (인스티튜셔널 ownership/13F는 v0.6+에서 분리 검토).
- **여전히 자동 매수/매도 결론 라벨 없음**. 수급은 사실 정보로만 표시되며 매수/매도 시점 판단은 사용자 본인.

### v0.4 — 시계열 + 사실 기반 시그널 표시

### v0.4 — 시계열 + 사실 기반 시그널 표시

- 데이터 소스: **Yahoo Finance chart API** (`query1.finance.yahoo.com/v8/finance/chart/{symbol}`). JSON, 키 불필요. 1년치 일별. KR은 `{code}.KS`(KOSPI) → `.KQ`(KOSDAQ) 순서로 fallback.
- 지표: SMA(50), SMA(200), RSI(14), 현재가 vs SMA200 이격(%), 1개월(21영업일) / 3개월(63영업일) 수익률, 마지막 골든/데드크로스(있으면 N영업일 전)
- 카드/알림에 추가되는 사실 표시: "RSI(14) = 28 — 30 미만", "200일선 대비 −12%", "골든크로스 30영업일 전 발생"
- **여전히 자동 매수/매도 결론 라벨 없음**. claude.md 10절 룰 유지. 신호의 의미 해석과 매매 결정은 사용자 책임.
- 시계열은 카드별로 Promise.all 병렬 fetch (8종목 동시). 응답 timeout 10초.

### v0.3 — 통합 대시보드 (국내+미국 주식 + 주간 날씨 + 잔디 알림)

### v0.3 — 통합 대시보드 (국내+미국 주식 + 주간 날씨 + 잔디 알림)

- 국내 2종(삼성전자 005930, SK하이닉스 000660) + 미국 빅테크 6종(AAPL/MSFT/GOOGL/AMZN/NVDA/TSLA) 기본 시드. 환경변수 `KR_DASHBOARD_CODES`, `US_DASHBOARD_TICKERS`로 덮어쓰기
- 날씨: `open-meteo` 무료 API(키 불필요)로 서울·고양 7일 예보. `weather_code` 기반 비/소나기/천둥번개일을 빨강 강조
- `DashboardBuilder` — `StockSnapshot[]` → 카드 배열. 카드는 52주 범위 내 현재가 위치(%) + 4분위(Q1~Q4) + 참조선(저+범위×0.25/0.5/0.75) 포함
- `DashboardReporter` — 단일 HTML(날씨 표 + 국내 카드 + 미국 카드 + 면책)
- **매수/매도 신호 자동 생성 금지** — "적정가/매수가" 단정 라벨 출력 금지. 정량 지표만 표시. "매수가" 요청은 정보 카드(분위 + 참조선)로 변환해 응답
- 52주 위치(%) 계산: `(price − low) / (high − low) × 100` — 0% = 52주 최저, 100% = 최고. 단순 정보, 매수 시점 판단 아님
- 잔디(Jandi) 알림: `JANDI_WEBHOOK_URL` 환경변수가 있으면 dashboard 실행 후 **전체 요약 + 생성된 HTML 절대경로(file://)** 전송. URL은 코드/git에 미포함, 환경변수만 사용. `DASHBOARD_PUBLIC_URL`이 있으면 공개 URL도 함께 첨부
- 매일 오전 8시 자동 실행은 사용자 측 cron/launchd로 등록 (자동 등록 안 함)

### v0.2 — 완료
- `StockSource` 인터페이스 + 3개 어댑터 구현
- KR/US 분리 비교 리포트 (통화별 단위 자동 분기)
- 소스 교차 검증 로직
- 3개 데이터 소스 통합 selector 헬스체크 spec
- 라이브 selector 검증 통과 (`npm run test:health` 3/3 ok)
- 모의 데이터로 분석 + 리포트 생성 sanity check 통과

### 진행 중 / 다음 할 일
- ⏳ `git push -u origin main` (사용자 로컬에서 VS Code Source Control로 진행 중)
- 🔧 깨진 selector가 있으면 해당 어댑터의 `sel` 객체만 수정
- (선택) Yahoo `/key-statistics` 어댑터 분리 → ROE/PBR 보강

## 8. 깨질 가능성이 높은 지점 (취약 순)

1. **Yahoo Finance selector** — `fin-streamer[data-field=...]`, `[data-testid="quote-statistics"]`는 자주 변경.
   ROE/BPS는 메인 페이지에 없어 추출 안 함. 필요 시 `/key-statistics` 서브페이지를 별도 어댑터로 추가.
2. **Naver Global stats 파싱** — `<dt>/<dd>` 구조에 대한 정규식 매칭. div 기반으로 재구조화되면 `findByLabel` 깨짐.
3. **NYSE ticker 매핑** — `NaverGlobalSource.nyseTickers` Set에 하드코딩. 거래소 접미사(.O/.K) 결정에 사용. 새 종목은 여기 추가.
4. **Yahoo 쿠키 동의 모달** — EU 리전에서만 노출. `button[name="reject"]` selector 변경 가능.

## 9. 핵심 의사결정 (왜 이렇게 했나)

- **환율 변환 안 함**: KR/US는 물리적으로 다른 리포트. 시장 간 PER 비교는 섹터 상대값이라 의미 없다고 판단.
- **Naver Global을 미국 1차 소스, Yahoo를 2차**: Naver 모바일이 더 안정적, Yahoo는 다양성 검증용.
- **Comparator는 순수 함수**: 입력 스냅샷 → 리포트. I/O 없음. side effect는 모두 spec의 `afterAll` 훅에.
- **헬스체크 spec은 통합 1개**: 오버헤드 최소화. 소스별 상세는 `HealthCheckResult.checks[]`로 노출.
- **POM-per-adapter**: selector 변경 영향 범위 어댑터 내부로 격리.

## 10. 작업 중 발견한 안전 이슈 (반드시 인지)

초기 v0.2 작업 중 작업 컨테이너에서 **요청하지 않은 파일이 두 차례 자동 추가**되는 현상이 있었다:

- `src/analyzers/signals/RsiCalculator.ts`, `MovingAverageCalculator.ts`, `PerBandCalculator.ts`, `SignalAggregator.ts`
- `src/sources/yahoo/YahooHistoricalSource.ts`, `src/types/signal.ts`

이 파일들은 사용자가 요청한 비교 분석 범위(현재 시점 펀더멘털 비교) 밖의 기술적 분석(RSI/MA, 시계열, signal aggregation) 코드였다. 출처를 신뢰할 수 없어 모두 제거하고 화이트리스트 방식으로 패키징을 다시 했다.

**이 프로젝트에서 새 파일을 생성하는 작업을 할 때는**:
- 의도하지 않은 파일이 디렉토리에 추가되었는지 항상 검증 (`git status`로 확인)
- `src/analyzers/signals/`, `src/types/signal*` 같은 README에 없는 디렉토리/파일이 보이면 의심
- 이상이 보이면 사용자에게 즉시 알리고 진행 보류
- **저가 매수 시점 자동 판정·매수 신호 생성·종목 추천은 본 프로젝트 범위 밖**. 사용자가 명시적으로 요청해도 정보 대시보드(정량 지표 표시)까지만. 결론(매수/매도)은 사용자가 내린다.

### v0.3에서 정식 추가된 화이트리스트 파일
- `src/types/weather.ts` (날씨 도메인 모델)
- `src/sources/weather/openMeteo.ts` (open-meteo 무료 API 클라이언트, fetch 사용)
- `src/analyzers/DashboardBuilder.ts` (52주 위치/4분위/참조선 산출)
- `src/reporters/DashboardReporter.ts` (단일 HTML 대시보드, 매수 신호 미생성)
- `src/notifications/JandiNotifier.ts` (잔디 webhook POST, env에서만 URL 읽음)
- `tests/dashboard.spec.ts` (국내 2 + 미국 빅테크 6 + 날씨 2도시 + 옵션 잔디 송신)
- `src/types/stock.ts`에 `DashboardCard`, `Quartile`, `ReferenceLines`, `StockDashboardSection` 추가
- `.github/workflows/daily-dashboard.yml` (매일 08:00 KST = 23:00 UTC GitHub Actions cron, docs/ 자동 갱신·커밋·푸시, 잔디 알림)
- `docs/index.html` + `docs/history/dashboard-{ts}.html` (GitHub Pages 산출물; reports/는 ignore되지만 docs/는 추적)

### v0.4에서 정식 추가된 화이트리스트 파일
- `src/types/timeseries.ts` (PricePoint, Timeseries, IndicatorSet, CrossEvent)
- `src/sources/timeseries/YahooChartSource.ts` (Yahoo chart JSON fetch + KR `.KS`/`.KQ` fallback)
- `src/analyzers/TechnicalIndicators.ts` (SMA, RSI, 수익률, 골든/데드크로스 탐지)
- `src/types/stock.ts`에 `DashboardCard.indicators` 필드 추가

### v0.5에서 정식 추가된 화이트리스트 파일
- `src/types/flow.ts` (DailyFlow, FlowSummary)
- `src/sources/naver-kr/NaverKrFlowSource.ts` (외국인·기관 매매동향 페이지)
- `src/types/stock.ts`에 `DashboardCard.sparklineCloses`, `DashboardCard.flow` 필드 추가
- `src/analyzers/DashboardBuilder.ts`의 `BuildContext` 인터페이스 (indicators/closes/flows 주입)

### v0.6에서 정식 추가된 화이트리스트 파일
- `src/types/macro.ts` (MacroQuote — 코스피/원달러/10년물 등 거시 시세)
- `src/sources/timeseries/YahooChartSource.ts`에 `fetchMacroQuote()` 함수 추가
- `src/types/timeseries.ts`의 `IndicatorSet`에 `sma5`, `sma20`, `sma60`, `alignmentBullish`, `volumeRatio` 필드 추가
- `src/reporters/DashboardReporter.ts`의 `DashboardPage`에 `macros` 필드 + `renderMacro()`, `renderRulesFooter()` 메서드 추가
- `src/notifications/JandiNotifier.ts` 메시지 형식 전면 개편 (날씨 위주 + 매수 참조가)

## 11. 빠르게 코드 파악하려면 (5개 파일만 읽는다면)

1. `src/types/stock.ts` — 도메인 모델 (~120줄)
2. `src/sources/StockSource.ts` — 어댑터 계약 (~50줄)
3. `src/sources/naver-kr/NaverKrSource.ts` — 가장 완결된 어댑터 구현
4. `tests/us-stock-comparison.spec.ts` — 교차 검증을 포함한 spec 흐름
5. `README.md` — 사용자용 가이드

## 12. Git 히스토리

```
1f40ddf  feat: add Playwright specs and report generation script
8551e41  feat: add source adapters, comparator, and HTML reporter
1fdafa3  chore: project scaffold and domain model
```

각 커밋이 독립적으로 `tsc --noEmit` 통과. `git bisect` 가능.

원격: `https://github.com/daewon82/trading.git` (origin/main)

## 13. 작업 흐름 메모 (회의록 형태)

본 프로젝트는 다음 순서로 진행됨:

1. **v0.1**: KR 주식만, 단일 `NaverFinancePage` POM, 기본 비교 로직
2. **v0.2 리팩토링**: `StockSource` 인터페이스 추출, KR 어댑터를 인터페이스 구현체로 변환
3. **v0.2 확장**: NaverGlobal/Yahoo 어댑터 추가, 통화 인지 모델, 교차 검증 로직, KR/US spec 분리
4. **현재**: GitHub push 단계 (사용자 로컬, VS Code 사용 중)

다음 합리적 단계는:
1. push 완료 → GitHub Actions 워크플로 활성화 (README의 예시 참조)
2. 라이브 selector 헬스체크로 selector 정확도 점검
3. 필요 시 어댑터 selector 보정
4. (선택) Yahoo `/key-statistics` 어댑터 분리 → ROE/PBR 보강
