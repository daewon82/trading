# MCP 모드 분석 프롬프트

이 프롬프트는 Claude Desktop + `@playwright/mcp` 환경에서 동일한 비교 분석 결과를
얻기 위한 지침입니다. 자동화 모드(Playwright Test 러너)와 동일한 도메인·비교 로직·
리포트 포맷을 공유합니다.

## 사용법

1. Claude Desktop 설정에 `@playwright/mcp` MCP 서버를 등록합니다.
2. 본 프롬프트 전체를 새 대화에 붙여넣고, 마지막 줄에서 종목을 명시합니다.
3. Claude가 페이지를 열고 데이터를 수집한 뒤, 프로젝트의
   `scripts/generate-report.ts`로 리포트를 생성하도록 요청합니다.

## 작업 지침

대상 시장과 종목별로 다음 데이터를 수집합니다. 각 항목이 페이지에 없으면 `null`로 둡니다.

```json
{
  "code": "<티커 또는 KR 코드>",
  "name": "<회사명>",
  "market": "KR | US",
  "currency": "KRW | USD",
  "source": "naver-kr | naver-global | yahoo",
  "capturedAt": "<ISO 8601>",
  "price": 0,
  "changePercent": 0,
  "marketCap": 0,
  "per": 0,
  "pbr": 0,
  "eps": 0,
  "bps": 0,
  "roe": 0,
  "dividendYield": 0,
  "fiftyTwoWeekHigh": 0,
  "fiftyTwoWeekLow": 0
}
```

### 데이터 소스

- KR: `https://finance.naver.com/item/main.naver?code={code}`
- US (1차): `https://m.stock.naver.com/worldstock/stock/{TICKER}.O/total`
  (NYSE 티커는 `.K` 접미사)
- US (2차, 검증용): `https://finance.yahoo.com/quote/{TICKER}/`

### 단위 규칙 — 어기지 말 것

- `marketCap`은 통화의 **기본 단위**로 저장 (KRW: 원, USD: 달러). T/B/M, 조/억 변환은
  리포트 생성 단계에서만 수행합니다. 수집 단계에서 단위를 바꾸면 비교가 깨집니다.
- 시장이 다른 종목을 한 리포트에 섞지 않습니다 (KR/US 분리). `StockComparator`가
  통화 혼용을 감지하면 throw 합니다.

### 리포트 생성

수집한 스냅샷 배열을 `reports/from-mcp.json`으로 저장한 뒤 다음을 실행합니다.

```bash
npm run report:generate -- reports/from-mcp.json
```

리포트는 `reports/from-mcp.html`로 생성됩니다.

## 분석 요청

다음 종목을 비교 분석해 주세요:

- KR: <코드 목록>
- US: <티커 목록>
