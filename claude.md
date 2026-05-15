# CLAUDE.md

> 이 파일은 향후 Claude(또는 다른 AI 어시스턴트)와 작업할 때, 그리고
> 프로젝트에 새로 합류한 개발자가 빠르게 컨텍스트를 잡기 위한 메모입니다.
> 사용자용 문서는 `README.md`이고, **이 파일은 코드를 *변경*하려는 사람이 읽는 문서**입니다.

## 1. 한 줄 요약

Playwright + MCP 기반 한국/미국 주식 비교 분석 자동화. v1.7에서 **섹터 구조 리스크 필터 + 보유 종목 손익 추적 + 잔디 강력매수 알림 + 백테스트 윈도우 확장 + 시장 컨텍스트 업데이트** 추가. 5팩터 종합 점수(v1.3) + 공포·탐욕지수(v1.4) + Walk-forward 백테스트(v1.5) + 컨센서스·RS(v1.6) 위에 구조 리스크 보정 레이어 추가. 데이터 소스 어댑터 패턴, 통화 인지 리포트, 소스 교차 검증을 포함. 사용자는 테스트 자동화 엔지니어이며 GitHub 저장소는 [`daewon82/trading`](https://github.com/daewon82/trading).

---

## 2. 두 가지 실행 모드

| 모드            | 사용 도구                          | 진입점                                                                                                      |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **자동화 모드** | Playwright Test 러너               | `npm run test:kr`, `test:us`, `test:health`, `test:value`, `test:dashboard`, `test:backtest`, `test:signal` |
| **MCP 모드**    | Claude Desktop + `@playwright/mcp` | `prompts/mcp-analysis-prompt.md` 를 Claude에 붙여넣기                                                       |

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
analyzers/ → 순수 로직 (비교, 검증, 가치주 스크리닝, 선행 매수 감지, 구조 리스크)
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
구조리스크   = 위험 섹터 해당 시 -10점 (v1.7 신규)
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

### 4.7 [NEW v1.7] 섹터 구조 리스크 필터 — `StructuralRiskFilter`

`src/analyzers/StructuralRiskFilter.ts`

#### 도입 배경

> 정량 데이터(PBR·PER·수급)만으로는 **산업 구조 변화·경쟁 심화** 같은 정성적 리스크를 반영하지 못함.
> 실제 사례: 이마트가 저PBR + 외인 수급 신호로 매수 후보 추천 → 온라인 커머스 경쟁 심화로 주가 부진.

#### 섹터별 구조 리스크 등급

| 섹터                  | 대표 종목                                  | 리스크 등급 | 이유                                  | 점수 보정 |
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
  warning?: string; // 경고 메시지
}

export class StructuralRiskFilter {
  assess(code: string): StructuralRiskResult;
  applyToSignalScore(score: number, code: string): number;
}
```

#### 대시보드 표시

- 🔴 HIGH 종목: 카드에 "⚠️ 구조 리스크" 태그 + 점수 -15점 적용
- 🟠 MEDIUM 종목: "🔶 주의 필요" 태그 + 점수 -10점 적용
- 🟢 POSITIVE 종목: "✅ 성장 섹터" 태그 + 점수 +5점 적용

### 4.8 [NEW v1.7] 보유 종목 손익 추적 — `PortfolioTracker`

`src/analyzers/PortfolioTracker.ts`

#### 도입 배경

> 현재 localStorage에 종목 코드만 저장. 매수가·수량 없이 손익 계산 불가.
> 실제로 필요한 것: "삼성전자, 한화시스템, 이마트 등 7종목 합산 손실 57,000원" 즉시 확인.

#### 데이터 구조

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

### 4.9 [NEW v1.7] 잔디 강력매수 알림 — `JandiSignalNotifier`

`src/notifications/JandiSignalNotifier.ts`

#### 도입 배경

> 강력매수 신호가 발생해도 대시보드를 직접 열어야만 확인 가능.
> 잔디 웹훅으로 즉시 알림 → 매수 타이밍 놓치지 않음.

#### 알림 발송 조건

```
STRONG_BUY 신호 발생 시 (TradingSignalEngine 점수 기준):
  종합 점수 ≥ 75점
  AND 구조 리스크 등급 HIGH 아님
  AND 52주 위치 ≤ 70% (고점 아님)
  AND 외인+기관 5d 동반 순매수 > 0
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

- 동일 종목 동일 신호: **24시간 이내 중복 발송 금지** (캐시로 관리)
- 하루 최대 알림: **5건** (스팸 방지)
- 발송 시간: **오전 9시 ~ 오후 3시** (장중만)

---

## 5. 컨벤션

- Selector hard-code 금지 — 어댑터 `sel` 객체에만
- async page 호출은 모두 timeout-bounded
- 로깅은 `logger.info/warn/error`로 구조화. `console.log` 직접 사용 금지
- 한국어 숫자 파싱은 `utils/logger.ts`의 `parseKoreanNumber()`에 집중
- 테스트는 직렬 실행 (`fullyParallel: false`)
- 스냅샷 JSON과 HTML 리포트 동시 저장
- **웹훅 URL은 절대 코드/git에 포함 금지** — `.env`에만 저장, `.gitignore`에 `.env` 추가 필수

---

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
npm run test:dashboard

# [v1.1] 코스피 가치주 스크리닝
npm run test:value
VALUE_UNIVERSE=005380,009540,105560 npm run test:value

# [v1.2] 선행 매수 감지
npm run test:signal
SIGNAL_UNIVERSE=005380,009540 npm run test:signal

# [v1.5] 백테스트
npm run test:backtest

# [v1.7 NEW] 강력매수 알림 테스트 (dry-run)
JANDI_DRY_RUN=1 npm run test:dashboard

# 타입 검증
npm run lint
```

---

## 7. 현재 상태 (v1.7)

### v1.7 — 섹터 구조 리스크 + 손익 추적 + 잔디 알림 (신규)

#### 추가 내용 요약

**섹터 구조 리스크 필터**
정량 신호만으로 추천된 이마트·호텔신라 등 구조적 위기 종목에 경고 태그 + 점수 보정 적용.

**보유 종목 손익 추적**
매수가·수량 입력 → 실시간 총 손익 계산. "7종목 합산 -57,000원" 즉시 확인 가능.

**잔디 강력매수 알림**
종합 점수 75점 이상 + 구조 리스크 없음 + 수급 조건 충족 시 잔디 웹훅으로 즉시 알림.
알림에 종목명·점수·신호 근거·대시보드 링크 포함.

#### 대시보드 섹션 (v1.7 최종)

1. 💼 내 보유 종목 + **실시간 손익** (NEW)
2. 📋 변동 사항 (자동)
3. 🔎 종목 검색
4. 📊 헤더 요약 (F&G·매수·매도경고·Top chip)
5. 💎 저평가 + 외인+기관 20일 매수 Top 5
6. 🏆 코스피 가치주 스크리너 Top 5
7. 🚨 선행 매수 감지 Top 5
8. 📋 매수 시점 시그널 안내
9. 📰 경제 기사 (RSS)

### v1.6 — 컨센서스·RS·헤더 요약 + 보유 종목 전환 (2026-05-14)

- `TradingSignalEngine.applyConsensusFactors` — NaverKr 컨센서스 → ±4/+8점
- `TradingSignalEngine.applyRelativeStrengthFactors` — 코스피 ^KS11 20일 대비 ±3~+5점
- `DashboardReporter.renderHeaderSummary` — F&G · 매수 N · 매도경고 N · Top 종목 chip
- DEFAULT_KR: 관심종목 → 보유 종목 5종 (SK텔레콤·기아·NC·호텔신라·삼성전자)

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

→ **매수 신호 4종 모두 유효** (55~61%), **매도 신호은 오히려 반등** → 매도 가중치 절반으로 약화 완료.

### v1.4 — 공포·탐욕지수 (2026-05)

- `src/sources/macro/KrFearGreedSource.ts` — fearandgreed.kr API
- `TradingSignalEngine.applyFearGreedFactors()` — 시장 regime 보정 ±3~±5점

### v1.3 — 100만원 코스피 매매 시그널 (2026-05)

- `TradingSignalEngine` — 5팩터 가중합 (수급±60 + 가치+15 + 품질±10 + 52주±15 + 기술±10)
- `PortfolioPlanner` — 100만원 1주 단위 분배 (Top 3)

### v1.0~v1.2 — 기존 기능 (생략 — 이전 claude.md 참조)

---

### 진행 중 / 다음 할 일

#### Phase 1 (즉시) — v1.7 신규 구현

- 🔧 `src/types/structural-risk.ts` — StructuralRiskResult 타입
- 🔧 `src/analyzers/StructuralRiskFilter.ts` — 섹터별 리스크 등급 + 점수 보정
- 🔧 `src/types/portfolio.ts` — HoldingPosition, PortfolioSnapshot 타입
- 🔧 `src/analyzers/PortfolioTracker.ts` — 손익 계산 로직
- 🔧 `src/notifications/JandiSignalNotifier.ts` — 강력매수 잔디 알림
- 🔧 대시보드 보유 종목 섹션에 손익 표시 추가
- 🔧 `TradingSignalEngine`에 `StructuralRiskFilter` 통합

#### Phase 2 (1~2주)

- 🔧 백테스트 윈도우 확장 — Toss API size=200 한계 → KRX 또는 Naver frgn.naver 어댑터
- 🔧 강세장 vs 약세장 regime별 백테스트 분리
- 🔧 F&G 7일 추이 sparkline — 히스토리 엔드포인트 조사 또는 로컬 캐시 누적
- 🔧 신호 임계값 재보정 (백테스트 hit rate 기준)

#### Phase 3 (장기)

- 🔧 cron + 텔레그램 알림 추가 (잔디 외 채널)
- 🔧 LLM 종목 리뷰 (Claude API) — 매수 후보 위험 요약
- 🔧 KRX 공식 데이터 백업 소스
- 🔧 모바일 PWA 최적화
- 🔧 ML 도입 (LightGBM/XGBoost) — 별도 Python 워크플로로 격리

---

## 8. 깨질 가능성이 높은 지점 (취약 순)

1. **Yahoo Finance selector** — `fin-streamer[data-field=...]` 자주 변경
2. **Naver Global stats 파싱** — `<dt>/<dd>` 구조 정규식
3. **Naver KR PBR/PER selector** — `#_per`, `#_pbr` ID selector
4. **NYSE ticker 매핑** — `NaverGlobalSource.nyseTickers` 하드코딩
5. **Yahoo 쿠키 동의 모달** — EU 리전만. `button[name="reject"]`
6. **거래량 데이터 파싱** — Yahoo Chart `volume` 필드 위치 변경 가능
7. **[NEW] 섹터 리스크 하드코딩** — 종목 코드 Set에 하드코딩. 신규 종목 추가 시 누락 가능

---

## 9. 핵심 의사결정 (왜 이렇게 했나)

- **환율 변환 안 함**: KR/US는 물리적으로 다른 리포트.
- **Naver Global 1차, Yahoo 2차**: Naver 모바일이 더 안정적.
- **Comparator는 순수 함수**: 입력 스냅샷 → 리포트. I/O 없음.
- **POM-per-adapter**: selector 변경 영향 범위 어댑터 내부 격리.
- **가치 점수는 절대 점수**: 시장 전반 고평가 시에도 그대로 표시.
- **매도 신호 가중치 약화**: 백테스트 결과 매도 신호 후 평균 +6% 반등 확인 → 페널티 절반 축소.
- **5d 전환을 핵심 트리거**: 20d 누적은 이미 진행 중. 5d 음→양 전환이 가장 이른 포착 시점.
- **[NEW] 섹터 구조 리스크 필터 도입**: 정량 신호만으로 이마트 등 구조적 위기 종목이 추천되는 오류 발생. 정성 리스크를 점수에 반영해 정확도 향상.
- **[NEW] 잔디 알림 조건 엄격화**: 단순 매수 신호가 아닌 75점 이상 + 구조 리스크 없음 + 고점 아님 3중 조건. 알림 남발 방지.
- **[NEW] 웹훅 URL 환경변수 분리**: 보안상 코드/git에 URL 절대 미포함. `.env`에만 저장.

---

## 10. 작업 중 발견한 안전 이슈 (반드시 인지)

초기 v0.2 작업 중 **요청하지 않은 파일이 두 차례 자동 추가**되는 현상 발생. 화이트리스트 방식으로 재구성.

**새 파일 생성 시 반드시**:

- `git status`로 의도하지 않은 파일 추가 여부 확인
- README에 없는 디렉토리/파일 발견 시 즉시 사용자에게 알림

**보안 주의사항**:

- 웹훅 URL(잔디·슬랙·텔레그램) 절대 코드/git/채팅에 노출 금지
- `.env` 파일은 `.gitignore`에 반드시 포함
- API 키·토큰 모두 동일 원칙 적용

**자동 매매 신호/추천 룰 (v1.7 업데이트)**:

| 배지                   | 조건                                     | 허용 |
| ---------------------- | ---------------------------------------- | ---- |
| 🔥 강력매수 + 잔디알림 | 종합 75점↑ + 구조리스크 없음 + 수급 충족 | ✅   |
| 🔥 선행 강             | A+B+C 모두                               | ✅   |
| ⚡ 선행 중             | A+B 또는 A+C                             | ✅   |
| 💡 선행 약             | 1개만                                    | ✅   |
| ✅ 추천                | 20d 외인+기관 동반 순매수                | ✅   |
| 💎 가치 우량           | 가치 점수 70점↑                          | ✅   |
| 🔍 가치 후보           | 가치 점수 50~69점                        | ✅   |
| ⚠️ 매도 경고           | 60d↑+고점+5d전환                         | ✅   |
| ❌ 위험                | 20d 외인+기관 동반 순매도                | ✅   |
| 🔴 구조 리스크         | 온라인유통·면세 등 위험 섹터             | ✅   |

**개별 매수가·손절가·익절가 단정 추천 금지** ❌
손절선 가이드는 표준 룰(-5%/-7%) 정보 제공만.
페이지 면책 문구: "본 라벨은 룰 기반 시그널이며 매매 권유가 아님"

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

1. v0.1~v0.2: StockSource 인터페이스 + KR/US 어댑터
2. v0.3~v0.6: 대시보드·날씨·기술지표·수급·거시환경
3. v1.0: 단순화 — 관심종목 4종 + 저평가/외인기관 Top 5
4. v1.1: 가치주 스크리너 (PBR/PER/ROE + 점수)
5. v1.2: 선행 매수 감지 (5d전환·거래량·52주)
6. v1.3: 100만원 매매 시그널 + PortfolioPlanner
7. v1.4: 공포·탐욕지수 + regime 보정
8. v1.5: Flow Signal Backtest (12,000건 검증)
9. v1.6: 컨센서스·RS·헤더 요약
10. **v1.7 (진행 중)**: 섹터 구조 리스크 + 손익 추적 + 잔디 강력매수 알림

---

## 14. 2026년 시장 컨텍스트 (코드 작업 참고용)

> ⚠️ 아래는 코드 컨텍스트 참고용이며 매매 권유 아님.

### 현재 시장 환경 (2026년 5월)

- 코스피 7,000 돌파 후 조정 중 (7,500 찍고 하락)
- 오늘 이슈: **AI 국민배당금 발언** → 반도체주 일시 급락
- **옵션만기일 패턴**: 매월 두 번째 목요일 변동성 주의 → 당일 매수 신호 신뢰도 낮춤
- 코스피 평균 PER: 약 25배 → PBR ≤ 1.0 종목 희귀
- 원/달러: 1,442원 (수출주 유리)
- 주도 섹터: 반도체 > 조선·방산·원전 > 은행·금융

### 옵션만기일 보정 (v1.7 추가)

```
매월 두 번째 목요일 = 옵션만기일
→ 당일 외인·기관 매도는 포지션 청산 가능성 높음
→ 선행 신호·매도 경고 신뢰도 50% 하향 적용
→ 알림 발송 보류 (다음 영업일 재평가)
```

### 구조 리스크 업데이트 이력

| 날짜       | 업데이트 내용                                            |
| ---------- | -------------------------------------------------------- |
| 2026-05-14 | 이마트·호텔신라 HIGH 등급 추가 (실제 손실 사례 반영)     |
| 2026-05-14 | AI 국민배당금 발언 → 반도체주 단기 리스크 주의 태그 추가 |

### 저PBR 발굴 가능 섹터

| 섹터      | 대표 종목                                          | 특징                 |
| --------- | -------------------------------------------------- | -------------------- |
| 은행/금융 | KB금융(105560), 신한지주(055550), 하나금융(086790) | PBR 0.5~0.8          |
| 통신      | SK텔레콤(017670), KT(030200)                       | PBR 1.0 내외, 고배당 |
| 자동차    | 현대차(005380), 기아(000270)                       | PER 4~6배 극저평가   |
| 조선      | HD한국조선해양(009540)                             | 수주 잔고 풍부       |
| 방산      | 한화에어로스페이스(012450)                         | K-방산 글로벌 수출   |

_최종 업데이트: 2026년 5월 14일 (v1.7)_
_작성: Claude (Anthropic) + QA/자동화 엔지니어_
