# CLAUDE.md

> 이 파일은 향후 Claude(또는 다른 AI 어시스턴트)와 작업할 때, 그리고
> 프로젝트에 새로 합류한 개발자가 빠르게 컨텍스트를 잡기 위한 메모입니다.
> 사용자용 문서는 `README.md`이고, **이 파일은 코드를 *변경*하려는 사람이 읽는 문서**입니다.

## 1. 한 줄 요약

Playwright + MCP 기반 한국/미국 주식 비교 분석 자동화. v1.8에서 **ADR(등락비율) 분석 + 쏠림 장세 판별 + 지수 구조 분석** 추가. 코스피 지수 상승이 전종목 상승인지 반도체·자동차 쏠림인지 순환매인지 판별해 보유 종목 대응 전략 제시. 5팩터 종합 점수(v1.3) + 공포·탐욕지수(v1.4) + Walk-forward 백테스트(v1.5) + 컨센서스·RS(v1.6) + 섹터 구조 리스크(v1.7) 위에 시장 구조 분석 레이어 추가. 데이터 소스 어댑터 패턴, 통화 인지 리포트, 소스 교차 검증을 포함. 사용자는 테스트 자동화 엔지니어이며 GitHub 저장소는 [`daewon82/trading`](https://github.com/daewon82/trading).

---

## 2. 두 가지 실행 모드

| 모드            | 사용 도구                          | 진입점                                                                                                                     |
| --------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **자동화 모드** | Playwright Test 러너               | `npm run test:kr`, `test:us`, `test:health`, `test:value`, `test:dashboard`, `test:backtest`, `test:signal`, `test:market` |
| **MCP 모드**    | Claude Desktop + `@playwright/mcp` | `prompts/mcp-analysis-prompt.md` 를 Claude에 붙여넣기                                                                      |

두 모드는 동일한 도메인, 동일한 비교 로직, 동일한 리포트 포맷을 공유한다.

---

## 3. 스택

- Node.js 18+, TypeScript (strict, ES2022 target, ESNext modules)
- Playwright Test 1.48+ (Chromium만 사용)
- 런타임 의존성 없음, devDeps만
- Asia/Seoul 타임존, ko-KR 로케일
- `package.json`에 `"type": "module"` — import는 반드시 `.js` 확장자 (TS source 파일이라도)

---

## 4. 아키텍처

### 4.1 레이어

```
sources/   → 페이지 진입, selector, 파싱
analyzers/ → 순수 로직 (비교, 검증, 가치주 스크리닝, 선행 매수 감지, 구조 리스크, 시장 구조)
reporters/ → 출력 포맷팅
backtest/  → 신호 사후 수익률 검증
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

`CrossSourceVerifier` — 가격 1%, 시총 2%, PER 5% 허용 오차.

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
구조리스크   = 위험 섹터 해당 시 -10점 (v1.7)
```

💎 70점 이상 → "가치 우량" / 🔍 50~69점 → "가치 후보"

### 4.6 [v1.2] 선행 매수 감지 — `EarlySignalDetector`

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
직전 5d 누적 순매수 < 0  AND  최근 5d 누적 순매수 > 0
AND  전환 폭 > 임계값
```

**조건 B — 거래량 급증 감지**

```
오늘 거래량 ≥ 20일 평균 × 1.5
AND  주가 변동 < +3%
AND  외인 또는 기관 당일 순매수 > 0
```

**조건 C — 저점 구간 + 외인 매수 시작**

```
52주 위치 ≤ 30%
AND  최근 5d 외인 순매수 > 0
AND  최근 5d 기관 순매수 > 0
```

#### 선행 신호 강도 등급

| 등급         | 조건             | 배지      | 색상      |
| ------------ | ---------------- | --------- | --------- |
| 🔥 강한 선행 | A + B + C 모두   | "선행 강" | 진한 초록 |
| ⚡ 중간 선행 | A + B 또는 A + C | "선행 중" | 초록      |
| 💡 약한 선행 | 1개만            | "선행 약" | 연초록    |

#### 매도 경고 신호

```
60d 외인+기관 누적 순매수 > 0
AND  52주 위치 ≥ 70%
AND  5d 전환 (양→음)
→ 카드 빨강 + ⚠️ "매도 경고" 배지
```

### 4.7 [v1.7] 섹터 구조 리스크 필터 — `StructuralRiskFilter`

`src/analyzers/StructuralRiskFilter.ts`

#### 도입 배경

> 정량 데이터(PBR·PER·수급)만으로는 산업 구조 변화·경쟁 심화 같은 정성적 리스크를 반영하지 못함.
> 실제 사례: 이마트가 저PBR + 외인 수급 신호로 매수 후보 추천 → 온라인 커머스 경쟁 심화로 주가 부진. 실제 보유 손실 발생.

#### 섹터별 구조 리스크 등급

| 섹터                  | 대표 종목                                  | 등급        | 이유                                  | 점수 보정 |
| --------------------- | ------------------------------------------ | ----------- | ------------------------------------- | --------- |
| 온라인 유통 경쟁 취약 | 이마트(139480), 롯데쇼핑(023530)           | 🔴 HIGH     | 쿠팡·알리 경쟁 심화, 구조적 매출 감소 | -15점     |
| 면세·호텔             | 호텔신라(008770), 신세계(004170)           | 🟠 MEDIUM   | 중국 관광객 회복 더딤, 면세업 경쟁    | -10점     |
| 성숙기 통신           | SK텔레콤(017670), KT(030200)               | 🟡 LOW      | 성장 정체, 배당 목적 보유 적합        | -5점      |
| 조선·방산             | HD한국조선해양(009540), 한화시스템(272210) | 🟢 POSITIVE | 슈퍼사이클, K-방산 수출               | +5점      |
| 반도체                | 삼성전자(005930), SK하이닉스(000660)       | 🟢 POSITIVE | AI 수요 폭발, 실적 성장               | +5점      |

#### 구현 스펙

```typescript
export interface StructuralRiskResult {
  code: string;
  sector: string;
  riskLevel: "high" | "medium" | "low" | "positive" | "neutral";
  riskTag: string; // "온라인 경쟁 취약" 등 표시용
  scoreAdjustment: number; // -15 ~ +5
  warning?: string;
}

export class StructuralRiskFilter {
  assess(code: string): StructuralRiskResult;
  applyToSignalScore(score: number, code: string): number;
}
```

#### 대시보드 표시

- 🔴 HIGH: "⚠️ 구조 리스크" 태그 + 점수 -15점
- 🟠 MEDIUM: "🔶 주의 필요" 태그 + 점수 -10점
- 🟢 POSITIVE: "✅ 성장 섹터" 태그 + 점수 +5점

### 4.8 [v1.7] 보유 종목 손익 추적 — `PortfolioTracker`

`src/analyzers/PortfolioTracker.ts`

#### 도입 배경

> 실제 사례: 한화시스템·이마트·대한항공·SK텔레콤·LG전자·호텔신라·삼성전자 7종목 합산 손실 57,000원 즉시 확인 필요.

```typescript
export interface HoldingPosition {
  code: string;
  name: string;
  buyPrice: number; // 평균 매수가
  quantity: number; // 보유 수량
  buyDate: string; // 최초 매수일 (YYYY-MM-DD)
}

export interface PortfolioSnapshot {
  positions: HoldingPosition[];
  totalInvested: number; // 총 투자금액
  totalCurrent: number; // 현재 평가금액
  totalPnL: number; // 총 손익 (원)
  totalPnLPct: number; // 총 손익률 (%)
  updatedAt: string;
}
```

#### 대시보드 표시

```
💼 내 보유 종목
┌────────────────────────────────────────┐
│ 삼성전자  2주  257,000원  +12,000 (+2.4%)│
│ 한화시스템 3주  68,500원  -8,000 (-3.8%)│
│ ...                                    │
├────────────────────────────────────────┤
│ 총 투자금액:  1,245,000원               │
│ 현재 평가액:  1,188,000원               │
│ 총 손익:      -57,000원 (-4.6%) 🔴     │
└────────────────────────────────────────┘
```

### 4.9 [v1.7] 잔디 강력매수 알림 — `JandiSignalNotifier`

`src/notifications/JandiSignalNotifier.ts`

#### 알림 발송 조건

```
종합 점수 ≥ 75점
AND 구조 리스크 등급 HIGH 아님
AND 52주 위치 ≤ 70% (고점 아님)
AND 외인+기관 5d 동반 순매수 > 0
AND ADR ≥ 100% (v1.8 추가 — 쏠림 장세 시 알림 보류)
```

#### 알림 메시지 포맷

```
🔥 강력매수 신호 발생!

📊 [종목명] (종목코드)
현재가: XXX,XXX원 (52주 위치: XX%)
종합점수: XX점

📈 신호 근거:
• 수급: 외인 +X억 / 기관 +X억 (5d)
• 가치: PBR X.X / PER XX배
• 기술: 거래량 X.Xx↑
• 구조: ✅ 성장 섹터
• 시장: ADR XX% (순환매 장세)  ← v1.8 추가

⚠️ 본 알림은 정보 제공용이며 매매 권유가 아닙니다.
📎 대시보드: {DASHBOARD_PUBLIC_URL}
```

#### 환경변수 (코드/git에 URL 미포함)

```bash
# .env 파일에만 저장 (절대 git에 커밋 금지)
JANDI_WEBHOOK_URL=https://wh.jandi.com/connect-api/webhook/...
DASHBOARD_PUBLIC_URL=https://daewon82.github.io/trading/
```

#### 알림 발송 규칙

- 동일 종목 24시간 이내 중복 발송 금지
- 하루 최대 5건 (스팸 방지)
- 발송 시간: 09:00~15:30 (장중만)
- **쏠림 장세 (ADR < 100%) 시 알림 보류** (v1.8 추가)
- **순환매 감지 시 별도 알림 발송** (v1.8 추가)

### 4.10 [NEW v1.8] 시장 구조 분석 — `MarketStructureAnalyzer`

`src/analyzers/MarketStructureAnalyzer.ts`

#### 핵심 통찰 (실제 사례 기반)

> **코스피 지수 상승 ≠ 전종목 상승**
>
> 코스피는 시가총액 가중 평균 지수.
> 삼성전자 + SK하이닉스 비중이 약 30~35% 차지.
> 이 2개만 올라도 지수는 상승해 보이지만 나머지 460개+ 종목은 하락 가능.
>
> **실제 사례 (2026-05-15)**:
> 코스피 지수 상승 중 → ADR 85.98% → 하락 종목이 더 많음
> "코스피 사상 최고인데 7종목 모두 손실" 현상 발생
> 원인: 반도체·자동차만 오르는 쏠림 장세

#### 코스피 지수 구조 이해

```
코스피 지수 구성 (시가총액 비중):
  삼성전자      약 20~22%
  SK하이닉스    약 10~12%
  삼성전자우    약 3~4%
  현대차·기아   약 4~5%
  ──────────────────────
  상위 5종목    약 40~45%

→ 상위 5종목이 오르면 지수는 올라 보임
→ 나머지 460개+ 종목 하락해도 지수는 상승 가능
→ 지수만 보고 판단하면 시장 오독 가능
```

#### ADR (등락비율) — 진짜 시장 건강도 지표

```
ADR = (20거래일 상승종목 누계 / 하락종목 누계) × 100

ADR ≥ 120% → 과매수 (전종목 고루 상승)
ADR 100~120% → 정상 상승 (순환매 발생 중)
ADR 85~100% → 쏠림 장세 (일부 종목만 상승) ← 2026-05-15 85.98%
ADR < 85%   → 과매도 (전종목 하락, 반등 가능성)
```

#### 쏠림 장세 vs 순환매 판별 및 대응

```
쏠림 장세 (ADR < 100%):
  코스피 지수는 올라도 반도체·자동차 외 종목은 하락
  → 내 계좌가 지수와 반대로 움직임
  → 강력매수 알림 보류
  → 전략: 반도체·자동차 비중 확대 or 관망

순환매 (ADR ≥ 100%):
  상승 온기가 전종목으로 퍼지는 중
  → 소외됐던 종목들도 순차 상승
  → 강력매수 알림 정상 발송
  → 별도 "순환매 감지" 알림 발송
  → 전략: 소외 우량주 저점 매수 기회
```

#### 구현 스펙

```typescript
export interface MarketStructureResult {
  adr: number;
  adrTrend: "rising" | "falling" | "flat";
  adrZone: "overbought" | "normal" | "skewed" | "oversold";
  marketType: "concentrated" | "rotation" | "broad_rally" | "broad_decline";
  concentratedSectors: string[]; // 상승 집중 섹터
  neglectedSectors: string[]; // 소외 섹터
  indexReturn1d: number;
  advanceDeclineRatio: number;
  topHeavyRisk: boolean; // 상위 5종목 쏠림 여부
  portfolioAlignedWithMarket: boolean;
  suggestion: string; // 대응 전략 제안
}

export class MarketStructureAnalyzer {
  analyze(
    indexReturn: number,
    advanceCount: number,
    declineCount: number,
  ): MarketStructureResult;
  isRotationOpportunity(adr: number, adrTrend: string): boolean;
}
```

#### 대시보드 헤더 위젯

```
📊 시장 구조 분석
┌────────────────────────────────────────────┐
│ ADR: 85.98% 🟠 쏠림 장세                   │
│ 상승 집중: 반도체 · 자동차                  │
│ 소외 섹터: 유통 · 면세 · 통신 · 가전       │
│ 코스피 +0.5% ↑  but  하락 종목 더 많음     │
│                                            │
│ 💡 전략: 반도체·자동차 외 소외 종목은       │
│    순환매 전환 시점까지 관망 권장            │
└────────────────────────────────────────────┘
```

#### 순환매 감지 잔디 알림

```
📢 순환매 시작 감지!

ADR: XX% → XX% (상승 전환)
소외 업종 상승 시작: 이차전지, 조선, 화장품

💡 반도체·자동차 외 소외 종목들의
   저점 매수 기회 가능성이 높아졌어요.

대시보드: {URL}
```

---

## 5. 컨벤션

- Selector hard-code 금지 — 어댑터 `sel` 객체에만
- async page 호출은 모두 timeout-bounded
- 로깅은 `logger.info/warn/error`. `console.log` 직접 사용 금지
- 한국어 숫자 파싱은 `utils/logger.ts`의 `parseKoreanNumber()`
- 테스트는 직렬 실행 (`fullyParallel: false`)
- 스냅샷 JSON과 HTML 리포트 동시 저장
- **웹훅 URL은 절대 코드/git에 포함 금지** — `.env`에만 저장, `.gitignore`에 `.env` 추가 필수

---

## 6. 자주 쓰는 명령

```bash
# 최초 1회
npm install
npx playwright install chromium

# 회귀 검증
npm run test:health

# 데이터 수집 + 리포트
npm run test:kr
npm run test:us
npm run test:dashboard

# [v1.1] 가치주 스크리닝
npm run test:value
VALUE_UNIVERSE=005380,009540,105560 npm run test:value

# [v1.2] 선행 매수 감지
npm run test:signal
SIGNAL_UNIVERSE=005380,009540 npm run test:signal

# [v1.5] 백테스트
npm run test:backtest

# [v1.7] 강력매수 알림 dry-run
JANDI_DRY_RUN=1 npm run test:dashboard

# [v1.8 NEW] 시장 구조 분석
npm run test:market

# 타입 검증
npm run lint
```

---

## 7. 현재 상태 (v1.8)

### v1.8 — ADR 분석 + 쏠림 장세 판별 + 지수 구조 분석 (신규, 2026-05-15)

**핵심 추가**

- `MarketStructureAnalyzer` — ADR 4단계 판별 + 쏠림/순환매 판별
- `NaverMarketSource` — 상승/하락 종목 수 파싱
- 대시보드 헤더에 시장 구조 위젯 추가
- `JandiSignalNotifier` 알림 조건에 ADR ≥ 100% 추가
- 순환매 감지 시 별도 잔디 알림 추가

**실제 사례 (2026-05-15)**
코스피 지수 상승 중이었지만 ADR 85.98% → 보유 7종목 모두 손실.
"코스피 최고인데 내 계좌는 마이너스" 현상의 원인이 ADR 분석으로 설명됨.

### v1.7 — 섹터 구조 리스크 + 손익 추적 + 잔디 알림 (2026-05-14)

- `StructuralRiskFilter` — 이마트 실제 손실 사례 반영, 섹터별 점수 보정
- `PortfolioTracker` — 7종목 합산 -57,000원 즉시 확인
- `JandiSignalNotifier` — 강력매수 75점↑ + 조건 충족 시 잔디 알림

#### 대시보드 섹션 (v1.8 최종)

1. 💼 내 보유 종목 + 실시간 손익
2. 📊 시장 구조 위젯 (ADR + 쏠림/순환매) ← v1.8 신규
3. 📋 변동 사항 (자동)
4. 🔎 종목 검색
5. 📊 헤더 요약 (F&G·매수·매도경고·Top chip)
6. 💎 저평가 + 외인+기관 20일 매수 Top 5
7. 🏆 코스피 가치주 스크리너 Top 5
8. 🚨 선행 매수 감지 Top 5
9. 📋 매수 시점 시그널 안내
10. 📰 경제 기사 (RSS)

### v1.6 — 컨센서스·RS·헤더 요약 (2026-05-14)

- `applyConsensusFactors` — NaverKr 컨센서스 → ±4/+8점
- `applyRelativeStrengthFactors` — 코스피 ^KS11 20일 대비 ±3~+5점
- `renderHeaderSummary` — F&G · 매수 N · 매도경고 N · Top chip

### v1.5 — Flow Signal Backtest 인프라 (2026-05)

**백테스트 검증 결과 (거래비용 0.4% 차감 후, 20일 사후)**:

| 신호 유형       | 건수  | 평균 수익  | 적중률    | 판정 |
| --------------- | ----- | ---------- | --------- | ---- |
| today_both_buy  | 1,745 | **+5.60%** | **61.0%** | ✅   |
| 5d_both_buy     | 1,752 | +5.07%     | 59.2%     | ✅   |
| 20d_both_buy    | 1,606 | +5.48%     | 55.7%     | ✅   |
| 60d_both_buy    | 1,273 | +4.97%     | 58.8%     | ✅   |
| today_both_sell | 1,810 | -6.36%     | 36.7%     | ❌   |
| 5d_both_sell    | 1,792 | -5.15%     | 37.4%     | ❌   |
| 20d_both_sell   | 1,467 | -5.97%     | 33.6%     | ❌   |
| 60d_both_sell   | 878   | -7.13%     | 31.1%     | ❌   |

→ 매수 신호 4종 유효 (55~61%), 매도 신호는 오히려 반등 → 매도 가중치 절반 축소 완료.

### v1.4 — 공포·탐욕지수 (2026-05)

- `KrFearGreedSource` — fearandgreed.kr API
- `applyFearGreedFactors()` — regime 보정 ±3~±5점

### v1.3 — 100만원 코스피 매매 시그널 (2026-05)

- `TradingSignalEngine` — 5팩터 가중합 (수급±60 + 가치+15 + 품질±10 + 52주±15 + 기술±10)
- `PortfolioPlanner` — 100만원 1주 단위 분배 (Top 3)

### v1.0~v1.2 — 기존 기능 (생략)

---

### 진행 중 / 다음 할 일

#### Phase 1 (즉시) — v1.8 구현

- 🔧 `src/types/market-structure.ts` — MarketStructureResult 타입
- 🔧 `src/analyzers/MarketStructureAnalyzer.ts` — ADR + 쏠림/순환매 판별
- 🔧 `src/sources/naver-kr/NaverMarketSource.ts` — 상승/하락 종목 수 파싱
- 🔧 `tests/market-structure.spec.ts`
- 🔧 대시보드 헤더에 시장 구조 위젯 추가
- 🔧 `JandiSignalNotifier` ADR 조건 + 순환매 알림 추가

#### Phase 2 — v1.7 미구현 항목

- 🔧 `src/types/structural-risk.ts`
- 🔧 `src/analyzers/StructuralRiskFilter.ts`
- 🔧 `src/types/portfolio.ts`
- 🔧 `src/analyzers/PortfolioTracker.ts`
- 🔧 `src/notifications/JandiSignalNotifier.ts`
- 🔧 `TradingSignalEngine`에 `StructuralRiskFilter` 통합

#### Phase 3 (1~2주)

- 🔧 백테스트 윈도우 확장 — Toss 200일 한계 → KRX 어댑터
- 🔧 강세장 vs 약세장 regime별 백테스트 분리
- 🔧 F&G 7일 추이 sparkline
- 🔧 신호 임계값 재보정

#### Phase 4 (장기)

- 🔧 텔레그램 알림 추가
- 🔧 LLM 종목 리뷰 (Claude API)
- 🔧 KRX 공식 데이터 백업
- 🔧 모바일 PWA
- 🔧 ML 도입 (LightGBM — 별도 Python 워크플로)

---

## 8. 깨질 가능성이 높은 지점 (취약 순)

1. **Yahoo Finance selector** — `fin-streamer[data-field=...]` 자주 변경
2. **Naver Global stats 파싱** — `<dt>/<dd>` 구조 정규식
3. **Naver KR PBR/PER selector** — `#_per`, `#_pbr`
4. **NYSE ticker 매핑** — 하드코딩
5. **Yahoo 쿠키 동의 모달** — EU 리전만
6. **거래량 데이터 파싱** — Yahoo Chart `volume` 필드
7. **섹터 리스크 하드코딩** — 신규 종목 추가 시 누락 가능
8. **[NEW] ADR 파싱** — 네이버 금융 상승/하락 종목 수 selector 변경 가능

---

## 9. 핵심 의사결정 (왜 이렇게 했나)

- **환율 변환 안 함**: KR/US는 물리적으로 다른 리포트.
- **Naver Global 1차, Yahoo 2차**: Naver 모바일이 더 안정적.
- **Comparator는 순수 함수**: I/O 없음.
- **POM-per-adapter**: selector 변경 영향 범위 어댑터 내부 격리.
- **가치 점수는 절대 점수**: 시장 전반 고평가 시에도 그대로 표시.
- **매도 신호 가중치 약화**: 백테스트 결과 매도 후 평균 +6% 반등 → 페널티 절반 축소.
- **5d 전환을 핵심 트리거**: 20d 누적은 이미 진행 중. 가장 이른 포착 시점.
- **섹터 구조 리스크 필터**: 이마트 실제 손실 사례 → 정성 리스크 점수 반영.
- **잔디 알림 조건 엄격화**: 75점 + 구조리스크 없음 + 고점 아님 3중 조건.
- **웹훅 URL 환경변수 분리**: 보안상 코드/git/채팅 절대 미포함.
- **[NEW] ADR을 알림 조건 추가**: 쏠림 장세에서 강력매수 알림 발송 시 실제 수익 미연결 방지.
- **[NEW] 지수 ≠ 전종목 원칙**: ADR로 진짜 시장 건강도 측정. 코스피 지수만 보면 보유 종목과 괴리 발생.

---

## 10. 작업 중 발견한 안전 이슈 (반드시 인지)

초기 v0.2 작업 중 **요청하지 않은 파일이 두 차례 자동 추가**되는 현상 발생. 화이트리스트 방식 재구성.

**새 파일 생성 시 반드시**:

- `git status`로 의도하지 않은 파일 확인
- README에 없는 디렉토리/파일 즉시 알림

**보안 주의사항**:

- 웹훅 URL 절대 코드/git/채팅 노출 금지
- `.env` → `.gitignore` 필수

**자동 매매 신호/추천 룰 (v1.8 최종)**:

| 배지                   | 조건                               | 허용      |
| ---------------------- | ---------------------------------- | --------- |
| 🔥 강력매수 + 잔디알림 | 75점↑ + 구조리스크 없음 + ADR≥100% | ✅        |
| 📢 순환매 감지 알림    | ADR 상승 전환 + 소외 업종 상승     | ✅ (v1.8) |
| 🟠 쏠림 장세 경고      | ADR < 100%                         | ✅ (v1.8) |
| 🔥 선행 강             | A+B+C                              | ✅        |
| ⚡ 선행 중             | A+B 또는 A+C                       | ✅        |
| 💡 선행 약             | 1개만                              | ✅        |
| ✅ 추천                | 20d 외인+기관 동반 순매수          | ✅        |
| 💎 가치 우량           | 70점↑                              | ✅        |
| 🔍 가치 후보           | 50~69점                            | ✅        |
| ⚠️ 매도 경고           | 60d↑+고점+5d전환                   | ✅        |
| ❌ 위험                | 20d 동반 순매도                    | ✅        |
| 🔴 구조 리스크         | 위험 섹터                          | ✅        |

**개별 매수가·손절가·익절가 단정 추천 금지** ❌
페이지 면책: "본 라벨은 룰 기반 시그널이며 매매 권유가 아님"

### v1.8 화이트리스트 파일

- `src/types/market-structure.ts`
- `src/analyzers/MarketStructureAnalyzer.ts`
- `src/sources/naver-kr/NaverMarketSource.ts`
- `tests/market-structure.spec.ts`

### v1.7 화이트리스트 파일

- `src/types/structural-risk.ts`
- `src/analyzers/StructuralRiskFilter.ts`
- `src/types/portfolio.ts`
- `src/analyzers/PortfolioTracker.ts`
- `src/notifications/JandiSignalNotifier.ts`
- `src/types/stock.ts`에 `DashboardCard.structuralRisk`, `DashboardCard.pnl` 필드 추가

---

## 11. 빠르게 코드 파악하려면 (5개 파일)

1. `src/types/stock.ts` — 도메인 모델
2. `src/sources/StockSource.ts` — 어댑터 계약
3. `src/sources/naver-kr/NaverKrSource.ts` — 완결된 어댑터 구현
4. `src/analyzers/TradingSignalEngine.ts` — 핵심 신호 엔진
5. `README.md` — 사용자용 가이드

---

## 12. Git 히스토리

```
1f40ddf  feat: add Playwright specs and report generation script
8551e41  feat: add source adapters, comparator, and HTML reporter
1fdafa3  chore: project scaffold and domain model
```

원격: `https://github.com/daewon82/trading.git` (origin/main)

---

## 13. 작업 흐름 메모

1. v0.1~v0.2: StockSource + KR/US 어댑터
2. v0.3~v0.6: 대시보드·날씨·기술지표·수급·거시환경
3. v1.0: 단순화
4. v1.1: 가치주 스크리너
5. v1.2: 선행 매수 감지
6. v1.3: 100만원 매매 시그널
7. v1.4: 공포·탐욕지수
8. v1.5: 백테스트 12,000건
9. v1.6: 컨센서스·RS·헤더
10. v1.7: 섹터 구조 리스크 + 손익 추적 + 잔디 알림
11. **v1.8 (진행 중)**: ADR + 쏠림 장세 판별 + 지수 구조 분석

---

## 14. 2026년 시장 컨텍스트 (코드 작업 참고용)

> ⚠️ 아래는 참고용이며 매매 권유 아님.

### 현재 시장 환경 (2026년 5월)

- 코스피 7,000~7,500 구간 (역대 최고권)
- **ADR 85.98%** → 쏠림 장세 (반도체·자동차 외 소외)
- AI 국민배당금 발언 → 반도체주 단기 리스크
- 옵션만기일: 매월 두 번째 목요일 변동성 주의
- 코스피 평균 PER: 약 25배 → PBR ≤ 1.0 종목 희귀
- 원/달러: 1,442원 (수출주 유리)
- 주도 섹터: 반도체 > 조선·방산·원전 > 은행·금융

### 옵션만기일 보정

```
매월 두 번째 목요일 = 옵션만기일
→ 당일 외인·기관 매도는 포지션 청산 가능성 높음
→ 선행 신호·매도 경고 신뢰도 50% 하향 적용
→ 알림 발송 보류 (다음 영업일 재평가)
```

### 쏠림 장세 실제 사례 (2026-05-15)

```
코스피 지수: 상승 중 (7,500 근처)
ADR: 85.98% → 하락 종목이 더 많음
상승 집중: 반도체(삼성전자+3%) · 자동차
소외 종목: 이마트·호텔신라·LG전자·SK텔레콤·한화시스템

결과: 보유 7종목 모두 손실 (합산 -57,000원)
교훈: ADR 없이 지수만 보면 시장 오독 가능
```

### 순환매 기대 업종 (소외 → 상승 대기)

| 업종     | 이유                    |
| -------- | ----------------------- |
| 이차전지 | 분기 실적 컨센서스 상향 |
| 조선     | 수주 잔고 + 실적 성장   |
| 화장품   | 중국 수요 회복 기대     |
| 화학     | 저점 매수 구간          |

### 구조 리스크 업데이트 이력

| 날짜       | 내용                                       |
| ---------- | ------------------------------------------ |
| 2026-05-14 | 이마트·호텔신라 HIGH 추가 (실제 손실 반영) |
| 2026-05-14 | AI 국민배당금 → 반도체 단기 리스크 태그    |
| 2026-05-15 | ADR 85.98% → 쏠림 장세 경고 등급 추가      |

### 저PBR 발굴 가능 섹터

| 섹터      | 대표 종목                                          | 특징                 |
| --------- | -------------------------------------------------- | -------------------- |
| 은행/금융 | KB금융(105560), 신한지주(055550), 하나금융(086790) | PBR 0.5~0.8          |
| 통신      | SK텔레콤(017670), KT(030200)                       | PBR 1.0 내외, 고배당 |
| 자동차    | 현대차(005380), 기아(000270)                       | PER 4~6배 극저평가   |
| 조선      | HD한국조선해양(009540)                             | 수주 잔고 풍부       |
| 방산      | 한화에어로스페이스(012450)                         | K-방산 글로벌 수출   |

_최종 업데이트: 2026년 5월 15일 (v1.8 — ADR + 시장 구조 분석)_
_작성: Claude (Anthropic) + QA/자동화 엔지니어_
