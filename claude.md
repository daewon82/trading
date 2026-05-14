# CLAUDE.md

> 이 파일은 향후 Claude(또는 다른 AI 어시스턴트)와 작업할 때, 그리고
> 프로젝트에 새로 합류한 개발자가 빠르게 컨텍스트를 잡기 위한 메모입니다.
> 사용자용 문서는 `README.md`이고, **이 파일은 코드를 *변경*하려는 사람이 읽는 문서**입니다.

## 1. 한 줄 요약

Playwright + MCP 기반 한국/미국 주식 비교 분석 자동화. v1.3~v1.5에서 **100만원 코스피 매매 시그널 + 공포·탐욕지수 + Walk-forward 백테스트** 추가. 가치주 스크리너(v1.1) + 외인·기관 동반 신호(v1.0) 위에 5팩터 종합 점수 산출 + 100만원 자본 분배 + 시장 regime 보정 + 12,000건 신호 사후 수익률 통계로 검증. 데이터 소스 어댑터 패턴, 통화 인지 리포트, 소스 교차 검증을 포함. 사용자는 테스트 자동화 엔지니어이며 GitHub 저장소는 [`daewon82/trading`](https://github.com/daewon82/trading).

## 2. 두 가지 실행 모드

| 모드            | 사용 도구                          | 진입점                                                                                       |
| --------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| **자동화 모드** | Playwright Test 러너               | `npm run test:kr`, `test:us`, `test:health`, `test:value`, `test:dashboard`, `test:backtest` |
| **MCP 모드**    | Claude Desktop + `@playwright/mcp` | `prompts/mcp-analysis-prompt.md` 를 Claude에 붙여넣기                                        |

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
analyzers/ → 순수 로직 (비교, 검증, 가치주 스크리닝, 선행 매수 감지)
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

| 어댑터               | 시장 | URL 패턴                                                  |
| -------------------- | ---- | --------------------------------------------------------- |
| `NaverKrSource`      | KR   | `finance.naver.com/item/main.naver?code={code}`           |
| `NaverGlobalSource`  | US   | `m.stock.naver.com/worldstock/stock/{TICKER}.O\|.K/total` |
| `YahooFinanceSource` | US   | `finance.yahoo.com/quote/{TICKER}/`                       |

**Selector는 모두 어댑터 내부 `private readonly sel = {...}` 객체에 격리**되어 있다.

### 4.3 도메인 모델 — 깨면 안 되는 불변식

- `StockSnapshot.marketCap`은 **통화 기본단위로 저장** (KRW: 원, USD: 달러).
- `StockComparator.compare()`는 입력 스냅샷의 통화가 섞이면 **명시적으로 throw**.
- `Currency`, `Market`, `SourceId`는 `src/types/stock.ts`의 string literal union.

### 4.4 소스 교차 검증

`CrossSourceVerifier`는 동일 ticker를 두 어댑터에서 수집한 결과를 비교. 기본 허용 오차: 가격 1%, 시총 2%, PER 5%.

### 4.5 [v1.1] 가치주 스크리너 — `ValueScreener`

`src/analyzers/ValueScreener.ts`

#### 스크리닝 조건 (AND)

| 팩터            | 기준값      | 근거                                     |
| --------------- | ----------- | ---------------------------------------- |
| PBR             | ≤ 1.0       | 자산가치 대비 저평가                     |
| PER             | ≤ 15        | 이익 대비 저평가 (코스피 평균 25배 기준) |
| ROE             | ≥ 8%        | 자본 수익성 최소 기준                    |
| 외인 20d 순매수 | > 0         | 스마트머니 매수 확인                     |
| 기관 20d 순매수 | > 0         | 국내 기관 매수 확인                      |
| 시총            | ≥ 5,000억원 | 유동성 최소 기준                         |

#### 가중 점수 시스템 (0~100점)

```
PBR 점수     = (1 - PBR) × 20
PER 점수     = (15 - PER) / 15 × 20
ROE 점수     = min(ROE / 20, 1) × 20
외인20d 점수 = 외인순매수 정규화 × 20
기관20d 점수 = 기관순매수 정규화 × 20
섹터보너스   = 주도섹터 해당 시 +5점
```

💎 70점 이상 → "가치 우량" / 🔍 50~69점 → "가치 후보"

### 4.6 [NEW v1.2] 선행 매수 감지 — `EarlySignalDetector`

`src/analyzers/EarlySignalDetector.ts`

#### 핵심 철학

> 외인·기관이 **이미 많이 산 상태**는 곧 매도(차익 실현) 구간.
> 이익을 극대화하려면 **매수를 막 시작하는 초입 단계**에 같이 진입해야 한다.

#### 외인·기관 매수 사이클

```
① 매수 조짐 (5d 전환, 거래량 급증)  ← 🎯 목표 진입 구간
② 추세 매수 (20d 지속 순매수)
③ 주가 상승
④ 차익 실현 매도 (60d↑ 지속 + 고점)  ← ⚠️ 매도 경고
⑤ 주가 하락 (개인 물림)
```

#### 선행 매수 감지 3가지 조건 (OR 1개 이상 충족 시 신호 발생)

**조건 A — 5d 전환 감지 (음→양)**

```
직전 5d 누적 순매수 < 0  (매도 상태였음)
AND
최근 5d 누적 순매수 > 0  (매수로 전환됨)
AND
전환 폭 > 임계값 (급격한 전환일수록 신호 강도 높음)
```

**조건 B — 거래량 급증 감지**

```
오늘 거래량 ≥ 20일 평균 거래량 × 1.5
AND
주가 변동 < +3%  (주가가 크게 오르기 전 = 초입 단계)
AND
외인 또는 기관 당일 순매수 > 0
```

**조건 C — 저점 구간 + 외인 매수 시작**

```
52주 위치 ≤ 30%  (52주 저점 부근)
AND
최근 5d 외인 순매수 > 0
AND
최근 5d 기관 순매수 > 0
```

#### 선행 신호 강도 등급

| 등급         | 조건                  | 배지      | 색상      |
| ------------ | --------------------- | --------- | --------- |
| 🔥 강한 선행 | A + B + C 모두 충족   | "선행 강" | 진한 초록 |
| ⚡ 중간 선행 | A + B 또는 A + C      | "선행 중" | 초록      |
| 💡 약한 선행 | A 또는 B 또는 C 1개만 | "선행 약" | 연초록    |

#### 매도 경고 신호

```
⚠️ 매도 경고 (3가지 모두 충족 시):
  60d 외인+기관 누적 순매수 > 0  (장기 매수 지속)
  AND 52주 위치 ≥ 70%             (고점 구간)
  AND 5d 전환 (양→음)             (단기 매도 시작)
  → 카드 빨강 + "매도 경고" 배지
```

#### 선행 신호 데이터 소스

| 데이터                | 소스                         | 비고                         |
| --------------------- | ---------------------------- | ---------------------------- |
| 외인·기관 일별 순매수 | 네이버 frgn.naver (page 1~6) | 기존 FlowSource 재사용       |
| 일별 거래량           | Yahoo Chart API              | 기존 YahooChartSource 재사용 |
| 52주 위치             | 기존 DashboardBuilder        | 재사용                       |

> ✅ 신규 데이터 소스 없음 — 기존 소스 조합으로 구현 가능

#### 구현 스펙 — `EarlySignalDetector`

```typescript
// src/analyzers/EarlySignalDetector.ts

export interface EarlySignalResult {
  code: string;
  name: string;

  // 5d 전환 감지
  flow5dPrev: number;       // 직전 5일 누적 (음수면 매도였음)
  flow5dCurrent: number;    // 최근 5일 누적
  foreignTurnover: boolean; // 외인 5d 전환 여부
  institutionTurnover: boolean; // 기관 5d 전환 여부

  // 거래량 급증
  volumeRatio: number;      // 오늘 / 20일 평균 (1.5 이상이면 급증)
  priceChange1d: number;    // 당일 주가 변동률 (%)

  // 52주 위치
  position52w: number;      // 0~100% (30 이하면 저점)

  // 누적 수급
  flow5d: number;
  flow20d: number;
  flow60d: number;

  // 신호
  signalStrength: 'strong' | 'medium' | 'weak' | 'none';
  sellWarning: boolean;
  signals: string[];        // 발동된 조건 목록 (A, B, C)
}

export class EarlySignalDetector {
  detect(flows: DailyFlow[], closes: number[], position52w: number): EarlySignalResult;
  detectBatch(universe: string[], ...): Promise<EarlySignalResult[]>;
}
```

#### 스크리닝 유니버스

환경변수 `SIGNAL_UNIVERSE`로 종목 코드 지정. 미설정 시 기본 유니버스 (가치주 스크리너와 동일):

```
반도체:    005930, 000660
자동차:    005380, 000270
조선:      009540, 010140
은행/금융: 105560, 055550, 086790
통신:      017670, 030200
전자:      066570, 009150
방산:      012450, 047810
에너지:    015760
```

## 5. 컨벤션

- Selector hard-code 금지 — 어댑터 `sel` 객체에만
- async page 호출은 모두 timeout-bounded
- 로깅은 `logger.info/warn/error`로 구조화. `console.log` 직접 사용 금지
- 한국어 숫자 파싱은 `utils/logger.ts`의 `parseKoreanNumber()`에 집중
- 테스트는 직렬 실행 (`fullyParallel: false`)
- 스냅샷 JSON과 HTML 리포트 동시 저장

## 6. 자주 쓰는 명령

```bash
# 최초 1회
npm install
npx playwright install chromium

# 회귀 검증 (~30초)
npm run test:health

# 데이터 수집 + 리포트
npm run test:kr
npm run test:us
npm run test:us:full
npm run test:dashboard

# [v1.1] 코스피 가치주 스크리닝
npm run test:value
VALUE_UNIVERSE=005380,009540,105560 npm run test:value

# [NEW v1.2] 선행 매수 감지
npm run test:signal                                          # 기본 유니버스
SIGNAL_UNIVERSE=005380,009540,105560 npm run test:signal    # 종목 지정
npm run test:signal:all                                      # 가치주 + 선행신호 통합

# 타입 검증
npm run lint

# MCP 결과 JSON → HTML
npm run report:generate -- reports/from-mcp.json
```

## 7. 현재 상태 (v1.6)

### v1.6 — 컨센서스·RS·헤더 요약 + 보유 종목 전환 (2026-05-14)

- `TradingSignalEngine.applyConsensusFactors` — NaverKr 컨센서스(1=매수~5=매도) → ±4/+8점
- `TradingSignalEngine.applyRelativeStrengthFactors` — 코스피 ^KS11 20일 대비 ±3~+5점
- `DashboardCard.relativeStrength` 필드 + dashboard.spec.ts에서 ^KS11 fetch 및 종목별 RS 계산
- `DashboardReporter.renderHeaderSummary` — F&G · 매수 N · 매도경고 N · Top 종목 chip
- **DEFAULT_KR**: 관심종목 6종 → 보유 종목 5종 (SK텔레콤·기아·NC·호텔신라·삼성전자)
- 헤더 섹션 "💖 나의 관심종목" → "💼 내 보유 종목"
- `flow-backtest.spec.ts` 유니버스를 dashboard와 동기화 (보유 5 + 가치 후보 39)

### v1.5 — Flow Signal Backtest 인프라 (2026-05)

**핵심**: 외인+기관 동반 신호의 사후 5/10/20일 수익률을 12,000건 통계로 검증.

- `src/backtest/types.ts` — SignalType (8종), SignalEvent, BacktestResult
- `src/backtest/FlowSignalBacktest.ts` — analyzer (signal detection + forward returns + aggregate)
- `tests/flow-backtest.spec.ts` — 코스피 46종 × 200일 fetch + 신호 사후 통계 + HTML 리포트
- `npm run test:backtest`

**검증 결과 (거래비용 0.4% round-trip 차감 후, 20일 사후)**:

| 신호 유형       | 건수  | 평균 수익  | 적중률    | 판정 |
| --------------- | ----- | ---------- | --------- | ---- |
| today_both_buy  | 1,745 | **+5.60%** | **61.0%** | ✅   |
| 5d_both_buy     | 1,752 | +5.07%     | 59.2%     | ✅   |
| 60d_both_buy    | 1,273 | +4.97%     | 58.8%     | ✅   |
| 20d_both_buy    | 1,606 | +5.48%     | 55.7%     | ✅   |
| today_both_sell | 1,810 | -6.36%     | 36.7%     | ❌   |
| 5d_both_sell    | 1,792 | -5.15%     | 37.4%     | ❌   |
| 20d_both_sell   | 1,467 | -5.97%     | 33.6%     | ❌   |
| 60d_both_sell   | 878   | -7.13%     | 31.1%     | ❌   |

→ **매수 신호 4종 모두 유효** (적중률 55~61%), **매도 신호 4종 모두 무효** (적중률 31~37%, 평균 회귀로 오히려 +6% 반등).
→ 한국 강세장(2025~2026 코스피 7000)에서 외인+기관 매도 후 반등 패턴 확인.
→ **시그널 엔진 매도 가중치 약화 필요** (TradingSignalEngine 향후 보정 대상).

### v1.4 — 코스피 공포·탐욕 지수 (머신러너 방법론, 2026-05)

- `src/types/fear-greed.ts` — FearGreedZone 5단계 분류 (extreme_fear / fear / neutral / greed / extreme_greed)
- `src/sources/macro/KrFearGreedSource.ts` — fearandgreed.kr `/wp-json/fgi/v1/latest` 무인증 API
- `DashboardPage.krFearGreed` 필드, 헤더 위젯 (5색 그라데이션 게이지 + needle + 인사이트)
- `TradingSignalEngine.applyFearGreedFactors()` — 시장 regime 보정 ±3~±5점 일률 적용

### v1.3 — 100만원 코스피 매매 시그널 (2026-05)

- `src/types/trading-signal.ts` — SignalAction (5단계: STRONG_BUY ~ STRONG_SELL), SignalFactor, PortfolioPlan
- `src/analyzers/TradingSignalEngine.ts` — 5팩터 가중합 (수급±60 + 가치+15 + 품질±10 + 52주±15 + 기술±10)
- `src/analyzers/PortfolioPlanner.ts` — 100만원 1주 단위 분배 (Top 3, 거래비용 reserve, floor 매수)
- 대시보드 💡 섹션: 매수 후보 Top 3 + 매도 경고 + 면책 문구 + 판정 근거 상세

### v1.2 — 선행 매수 감지 로직 추가 (신규)

#### 추가된 대시보드 섹션

1. 💼 매수한 종목 (localStorage)
2. 📋 변동 사항 (자동)
3. 🔎 종목 검색 (임시)
4. 💖 나의 관심종목 (4종 고정)
5. 💎 저평가 + 외인+기관 20일 매수 Top 5
6. 🏆 코스피 가치주 스크리너 Top 5
7. **🚨 [NEW] 선행 매수 감지 Top 5** — 매수 초입 단계 종목
8. 📋 매수 시점 시그널 안내 (업데이트)
9. 📰 경제 기사 (RSS)

#### 선행 매수 감지 카드 표시 항목

- 종목명 / 코드 / 섹터
- 현재가 / 52주 위치(%) + 구간 표시 (저점/중간/고점)
- **5d 전환 여부** (외인/기관 각각 음→양 표시)
- **거래량 비율** (평균 대비 ×배수)
- **당일 주가 변동률**
- **5d/20d/60d 누적 수급** (외인·기관)
- **선행 신호 강도** (🔥강/⚡중/💡약)
- **발동 조건** (A조건·B조건·C조건 태그)
- **매도 경고** (해당 시 빨강 + ⚠️ 배지)

#### 매수 시점 시그널 안내 섹션 업데이트

```
기존: 20d 외인+기관 동반 순매수 룰만 표시

v1.2 추가:
┌─────────────────────────────────────────────┐
│ 📈 선행 매수 시그널 (초입 단계)              │
│ A. 5d 전환 (음→양): 단기 매도 → 매수 전환   │
│ B. 거래량 급증 1.5배↑ + 주가 소폭 상승      │
│ C. 52주 저점 30% 이하 + 외인·기관 매수 시작 │
├─────────────────────────────────────────────┤
│ 📊 추세 매수 시그널 (진행 중)               │
│ 20d 외인+기관 동반 순매수 지속              │
│ ★★ 펀드매니저 표준 기간                     │
├─────────────────────────────────────────────┤
│ ⚠️ 매도 경고 시그널                         │
│ 60d↑ 지속 + 52주 고점 70%↑ + 5d 양→음 전환│
│ → 차익 실현 구간 가능성                     │
└─────────────────────────────────────────────┘
```

### v1.1 (이전) — 코스피 가치주 스크리너

관심종목 4종 + 저평가/외인기관 Top 5 + 가치주 스크리너 Top 5

### v1.0 (이전) — 단순화

관심종목 4종(삼성전자·LG전자·기아·SK텔레콤) + 저평가/외인기관 Top 5

### 진행 중 / 다음 할 일 (v1.6 시점)

#### Phase 1 (즉시) — 완료

- ✅ [v1.5] `src/backtest/` analyzer + spec + 첫 실행 (2026-05 완료)
- ✅ [v1.5] healthcheck spec에 TossKr, Wisereport, FearGreed, NaverKr.extractValuation 추가 (source-health.spec.ts:60)
- ✅ [v1.5+] 매도 가중치 약화 — 백테스트 결과(적중률 31~37%)에 따라 TradingSignalEngine 매도 페널티 절반으로 (-25→-12, -20→-10, -15→-6)

#### Phase 2 (1주) — 대부분 완료

- ✅ [v1.6] 컨센서스 팩터 신호 엔진 통합 (`applyConsensusFactors`, ±4/+8점)
- ✅ [v1.6] 대시보드 헤더에 한 줄 요약 위젯 (`renderHeaderSummary` — F&G·매수·매도경고·Top chip)
- ✅ [v1.6] 상대 강도(RS) 팩터 — 코스피 ^KS11 20일 대비 ±3~+5점 (`applyRelativeStrengthFactors`)
- 🔧 [v1.7] F&G 7일 추이 sparkline — fearandgreed.kr API 히스토리 엔드포인트 조사 필요 또는 로컬 캐시 누적

#### Phase 3 (2~4주)

- 🔧 [v1.7] localStorage 보유 종목 P&L 추적
- 🔧 [v1.7] 신호 임계값 재보정 (백테스트 hit rate 기준)
- 🔧 [v1.7] cron + 텔레그램/이메일 알림 (강력매수 발생 시)
- 🔧 [v1.7] **백테스트 윈도우 확장** — Toss API size=200 한계로 KRX 또는 Naver frgn.naver 어댑터 추가 필요
- 🔧 [v1.7] **regime별 백테스트 분리** — 강세장(2025~2026 코스피 7000) vs 약세장 결과 분리

#### Phase 4 (장기)

- 🔧 LLM 종목 리뷰 (Claude API) — 매수 후보 위험 요약
- 🔧 KRX 공식 데이터 백업 소스 (Toss 장애 대비, 백테스트 윈도우 확장과 동일 작업)
- 🔧 모바일 PWA 최적화 (홈화면 추가 + 푸시 알림)
- 🔧 **ML 도입(LightGBM/XGBoost)** — 5팩터 비선형 결합. 런타임 의존성 없음 원칙과 충돌하므로 별도 워크플로(예: Python 빌드 단계)로 격리 필요
- 🔧 **대안 데이터(DART NLP)** — 한국 공시 NLP, 글로벌 AI 픽커가 미커버하는 alpha 원천

## 8. 깨질 가능성이 높은 지점 (취약 순)

1. **Yahoo Finance selector** — `fin-streamer[data-field=...]` 자주 변경
2. **Naver Global stats 파싱** — `<dt>/<dd>` 구조 정규식
3. **Naver KR PBR/PER selector** — `#_per`, `#_pbr` ID selector
4. **NYSE ticker 매핑** — `NaverGlobalSource.nyseTickers` 하드코딩
5. **Yahoo 쿠키 동의 모달** — EU 리전만. `button[name="reject"]`
6. **[NEW] 거래량 데이터 파싱** — Yahoo Chart `volume` 필드 위치 변경 가능

## 9. 핵심 의사결정 (왜 이렇게 했나)

- **환율 변환 안 함**: KR/US는 물리적으로 다른 리포트.
- **Naver Global 1차, Yahoo 2차**: Naver 모바일이 더 안정적.
- **Comparator는 순수 함수**: 입력 스냅샷 → 리포트. I/O 없음.
- **POM-per-adapter**: selector 변경 영향 범위 어댑터 내부 격리.
- **가치 점수는 절대 점수**: 시장 전반 고평가 시에도 그대로 표시.
- **섹터 모멘텀 보너스**: 2026년 주도 섹터 한정. 시장 변화 시 이 파일 업데이트.
- **[NEW] 선행 신호는 신규 소스 없이 기존 데이터 조합**: FlowSource + YahooChart + DashboardBuilder 재사용. 추가 API 호출 최소화.
- **[NEW] 매수/매도 사이클 분리 표시**: 선행(초입) → 추세(진행) → 경고(고점) 3단계를 별도 배지로 명확히 구분. 단계 혼용 금지.
- **[NEW] 5d 전환을 핵심 트리거로 채택**: 20d 누적은 이미 진행 중인 상태. 5d 음→양 전환이 가장 이른 포착 가능 시점.

## 10. 작업 중 발견한 안전 이슈 (반드시 인지)

초기 v0.2 작업 중 **요청하지 않은 파일이 두 차례 자동 추가**되는 현상 발생. 화이트리스트 방식으로 패키징 재구성.

**새 파일 생성 시 반드시**:

- `git status`로 의도하지 않은 파일 추가 여부 확인
- README에 없는 디렉토리/파일 발견 시 즉시 사용자에게 알림

**자동 매매 신호/추천 룰 (v1.2 업데이트)**:

| 배지         | 조건                      | 허용 |
| ------------ | ------------------------- | ---- |
| 🔥 선행 강   | A+B+C 모두                | ✅   |
| ⚡ 선행 중   | A+B 또는 A+C              | ✅   |
| 💡 선행 약   | A 또는 B 또는 C           | ✅   |
| ✅ 추천      | 20d 외인+기관 동반 순매수 | ✅   |
| 💎 가치 우량 | 가치 점수 70점↑           | ✅   |
| 🔍 가치 후보 | 가치 점수 50~69점         | ✅   |
| ⚠️ 매도 경고 | 60d↑+고점+5d전환          | ✅   |
| ❌ 위험      | 20d 외인+기관 동반 순매도 | ✅   |

**개별 매수가·손절가·익절가 단정 추천 금지** ❌
손절선 가이드는 표준 룰(−5%/−7%) 정보 제공만.
페이지 면책 문구: "본 라벨은 룰 기반 시그널이며 매매 권유가 아님"

### v1.2 화이트리스트 파일

- `src/types/signal.ts` (EarlySignalResult, SignalStrength)
- `src/analyzers/EarlySignalDetector.ts` (5d전환·거래량·52주 감지 로직)
- `tests/early-signal.spec.ts` (기본 유니버스 선행 신호 탐지 + 리포트)
- `src/types/stock.ts`에 `DashboardCard.earlySignal` 필드 추가

### v1.1 화이트리스트 파일

- `src/types/valuation.ts`
- `src/analyzers/ValueScreener.ts`
- `tests/value-screening.spec.ts`
- `NaverKrSource.extractValuation()` 추가
- `DashboardCard.valuation` 필드 추가

### v0.3~v0.6 화이트리스트 파일 (생략 — 기존 claude.md 참조)

## 11. 빠르게 코드 파악하려면 (5개 파일)

1. `src/types/stock.ts` — 도메인 모델
2. `src/sources/StockSource.ts` — 어댑터 계약
3. `src/sources/naver-kr/NaverKrSource.ts` — 완결된 어댑터 구현
4. `tests/us-stock-comparison.spec.ts` — 교차 검증 spec 흐름
5. `README.md` — 사용자용 가이드

## 12. Git 히스토리

```
1f40ddf  feat: add Playwright specs and report generation script
8551e41  feat: add source adapters, comparator, and HTML reporter
1fdafa3  chore: project scaffold and domain model
```

원격: `https://github.com/daewon82/trading.git` (origin/main)

## 13. 작업 흐름 메모

1. v0.1 → v0.2: StockSource 인터페이스 + KR/US 어댑터
2. v0.3~v0.6: 대시보드·날씨·기술지표·수급·거시환경
3. v1.0: 단순화 — 관심종목 4종 + 저평가/외인기관 Top 5
4. v1.1: 코스피 가치주 스크리너 (PBR/PER/ROE + 점수)
5. **v1.2 (진행 중)**: 선행 매수 감지 (5d전환·거래량·52주)

**다음 단계 (우선순위 순)**:

```
1. src/types/signal.ts          — EarlySignalResult 타입 정의
2. EarlySignalDetector.ts       — 3가지 조건 + 강도 계산 로직
3. tests/early-signal.spec.ts   — 스펙 작성 + 리포트 연동
4. 대시보드 🚨 섹션 추가
5. src/types/valuation.ts       — ValuationMetrics 타입 (v1.1)
6. ValueScreener.ts             — 가치주 점수 계산 (v1.1)
7. tests/value-screening.spec.ts (v1.1)
```

## 14. 2026년 시장 컨텍스트 (코드 작업 참고용)

> ⚠️ 아래는 코드 컨텍스트 참고용이며 매매 권유 아님.

### 현재 시장 환경 (2026년 5월)

- 코스피 7,000 돌파 (역대 최고)
- 코스피 평균 PER: 약 25배 → PBR ≤ 1.0 종목이 희귀
- 원/달러: 1,442원 (수출주 유리)
- 주도 섹터: 반도체 > 조선·방산·원전 > 은행·금융

### 선행 신호 포착 시 주의사항

- **코스피 고점 구간**: 52주 위치 70% 이상 종목이 많음 → 선행 신호 발동해도 리스크 높음
- **거래량 급증 + 주가 소폭**: 세력 매집 초기 패턴. 주가가 크게 오르기 전 확인이 핵심
- **5d 전환의 함정**: 단순 노이즈인지 진짜 전환인지 구분 필요 → 반드시 60d 방향과 비교
  - 60d 음수 + 5d 양전환 = 진짜 초기 매수 가능성 높음 ✅
  - 60d 양수 + 5d 양전환 = 이미 많이 산 상태, 주의 ⚠️

### 저PBR 발굴 가능 섹터 (스크리너 힌트)

| 섹터      | 대표 종목                                          | 특징                 |
| --------- | -------------------------------------------------- | -------------------- |
| 은행/금융 | KB금융(105560), 신한지주(055550), 하나금융(086790) | PBR 0.5~0.8          |
| 통신      | SK텔레콤(017670), KT(030200)                       | PBR 1.0 내외, 고배당 |
| 자동차    | 현대차(005380), 기아(000270)                       | PER 4~6배 극저평가   |
| 조선      | HD한국조선해양(009540)                             | 수주 잔고 풍부       |
| 방산      | 한화에어로스페이스(012450)                         | K-방산 글로벌 수출   |

_최종 업데이트: 2026년 5월 14일 (v1.6 — 컨센서스·RS·헤더 요약·보유 종목 전환)_
_작성: Claude (Anthropic) + QA/자동화 엔지니어_
