# Trading

Playwright + MCP 기반 한국/미국 주식 비교 분석 자동화.

3개 소스(`naver-kr`, `naver-global`, `yahoo`)에서 펀더멘털 데이터를 수집해
시장별 비교 리포트와 소스 교차 검증 결과를 생성합니다.

## 빠른 시작

```bash
npm install
npx playwright install chromium

npm run test:health         # selector 헬스체크 (~30s)
npm run test:kr             # 국내 5종목 비교 + 리포트
npm run test:us             # 미국 5종목 + AAPL 교차검증
npm run test:us:full        # 미국 모든 종목 교차검증
npm run lint                # 타입 검증 (tsc --noEmit)
```

리포트는 `reports/` 폴더에 JSON + HTML 쌍으로 저장됩니다.

## 종목 변경

환경변수로 기본 종목 리스트를 덮어쓸 수 있습니다.

```bash
KR_STOCK_CODES=005930,068270 npm run test:kr
US_STOCK_TICKERS=NVDA,TSLA,AMD npm run test:us
```

NYSE 신규 티커를 사용한다면
[src/sources/naver-global/NaverGlobalSource.ts](src/sources/naver-global/NaverGlobalSource.ts)
의 `nyseTickers` Set에 추가해 주세요(NASDAQ은 추가 불필요).

## 두 가지 실행 모드

| 모드 | 사용 도구 | 진입점 |
|------|-----------|--------|
| 자동화 | Playwright Test 러너 | `npm run test:*` |
| MCP | Claude Desktop + `@playwright/mcp` | [prompts/mcp-analysis-prompt.md](prompts/mcp-analysis-prompt.md) |

두 모드는 동일한 도메인 모델(`StockSnapshot`)과 비교 로직(`StockComparator`)을 공유합니다.

## MCP 결과를 리포트로

MCP 모드로 수집한 스냅샷 JSON을 같은 포맷의 HTML 리포트로 변환할 수 있습니다.

```bash
npm run report:generate -- reports/from-mcp.json
```

## 프로젝트 구조

```
src/
  types/stock.ts                    도메인 모델
  sources/StockSource.ts            어댑터 계약
  sources/naver-kr/                 KR 어댑터
  sources/naver-global/             US 1차 어댑터
  sources/yahoo/                    US 2차(검증용) 어댑터
  analyzers/StockComparator.ts      통화 단일성 검증, 랭킹 산출
  analyzers/CrossSourceVerifier.ts  소스 간 가격/시총/PER 교차 검증
  reporters/HtmlReporter.ts         HTML 출력
  utils/logger.ts                   로거 + 한국어/영문 숫자 파서
tests/
  source-health.spec.ts             3개 어댑터 selector 생존 확인
  kr-stock-comparison.spec.ts       KR 비교 + 리포트
  us-stock-comparison.spec.ts       US 비교 + 교차검증 + 리포트
scripts/
  generate-report.ts                JSON → HTML 변환
prompts/
  mcp-analysis-prompt.md            MCP 모드용 작업 지침
```

## 통합 대시보드 (v0.3)

국내 2종(삼성전자·SK하이닉스) + 미국 빅테크 6종(AAPL/MSFT/GOOGL/AMZN/NVDA/TSLA)
+ 주간 날씨(서울·고양시) 한 화면 HTML.

```bash
npm run test:dashboard

# 잔디 알림까지 함께
JANDI_WEBHOOK_URL="https://wh.jandi.com/connect-api/webhook/..." \
  npm run test:dashboard
```

산출물: `reports/dashboard-{YYYYMMDDHHmmss}.html` + 동일 이름의 `.json`.

각 종목 카드는 **52주 범위 내 현재가 위치(%)**, **4분위(Q1~Q4)**, **참조선
(Q1=하위 25%선, Q2=중간, Q3=상위 25%선)** 을 표시합니다. "매수 적정가" 같은
단정 라벨은 자동 출력하지 않습니다 — 정량 정보를 보고 판단은 사용자가 합니다.

### 매일 오전 8시 자동 실행 (GitHub Actions + Pages)

[.github/workflows/daily-dashboard.yml](.github/workflows/daily-dashboard.yml)이
매일 23:00 UTC(=08:00 KST)에 발화하여:

1. Playwright Chromium 설치
2. `npm run test:dashboard` 실행 (날씨·국내·미국 종목 수집)
3. `docs/index.html` 갱신 + `docs/history/dashboard-{ts}.html`에 이력 보존
4. `docs/` 자동 커밋·푸시
5. `JANDI_WEBHOOK_URL` 시크릿이 설정되어 있으면 잔디 알림 송신

#### 최초 셋업 (GitHub UI에서 1회)

1. **Repository 생성·연결** — `daewon82/trading` 에 이 저장소 push
2. **GitHub Pages 활성화** — Settings → Pages → Source: `main` branch / `/docs`
   - 활성화 후 URL: `https://daewon82.github.io/trading/`
3. **Secrets 등록** — Settings → Secrets and variables → Actions → New repository secret
   - 이름: `JANDI_WEBHOOK_URL`
   - 값: 잔디 채널 webhook URL **(평문 노출된 기존 URL은 회전 후 새 값을 등록)**
4. **(선택) Variables 등록** — `DASHBOARD_PUBLIC_URL`을 다른 도메인으로 쓰려면 같은 메뉴 Variables 탭
5. **Workflow 권한 확인** — Settings → Actions → General → Workflow permissions: **Read and write** 체크
6. **첫 실행** — Actions 탭 → daily-dashboard → Run workflow (수동 트리거)

문제 있으면 Actions 로그에서 어떤 단계가 실패했는지 확인할 수 있습니다.

#### 로컬 실행 (수동)

```bash
JANDI_WEBHOOK_URL="..." \
DASHBOARD_PUBLIC_URL="https://daewon82.github.io/trading/" \
  npm run test:dashboard
```

`docs/index.html` 이 갱신됩니다. `git add docs/ && git commit && git push` 하면
GitHub Pages가 즉시 재배포합니다.

## 개발자 문서

코드를 변경하려면 [claude.md](claude.md) 를 먼저 읽어주세요. 어댑터 selector,
도메인 불변식, 깨질 가능성이 높은 지점을 정리해 두었습니다.
