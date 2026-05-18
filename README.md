# 🐢 Turtle KOSPI Dashboard

리처드 대니스 터틀 트레이딩 원칙 기반 KOSPI 8종목 자동 신호 시스템.

매매 규칙·종목 추가/삭제 프로토콜의 단일 출처는 [claude.md](claude.md).

## 빠른 시작

```bash
npm install
npm run lint     # 타입 검증
npm start        # docs/index.html 생성
```

데이터는 네이버 금융 일봉 시세에서 가져오고, 결과는 `docs/index.html`
(GitHub Pages 배포용)과 `docs/dashboard.json` 두 파일로 떨어집니다.

## 생성되는 신호

각 종목마다 일봉 종가 기준으로 다음을 산출합니다.

| 신호 | 조건 |
| --- | --- |
| `ENTRY_BREAKOUT` | 종가 ≥ 20일 신고가 (미보유 상태) |
| `PYRAMID` | 보유 중 + 종가 ≥ 진입가 + 0.5 ATR |
| `HOLD` | 보유 중 + 손절선·10일 저점·다음 피라미딩가 모두 안전 |
| `EXIT_10D_LOW` | 보유 중 + 종가 ≤ 10일 저점 → 익절/청산 |
| `STOP_LOSS` | 보유 중 + 종가 ≤ 진입가 − 2 ATR → 기계적 손절 |
| `WAIT` | 미보유 + 돌파 대기 |

1유닛 수량 = `(총자산 × 1%) ÷ (2 × ATR20)`. 기본 총자산은 5,000만 원이며
`TOTAL_CAPITAL` 환경변수로 변경할 수 있습니다.

## 종목 추가/삭제 프로토콜 자동 검증

각 종목 카드에 다음 체크 결과를 표시합니다.

- 종가 vs MA60, MA120 (역배열 / 정배열)
- 20일 고점 미돌파 지속 기간 (역추세 고착 판정)
- 거래량 전멸 여부 (20일 평균 대비 최근 5일)

판정 `KEEP` / `WATCH` / `DELETE_CANDIDATE` 가 배지로 노출됩니다.

## 보유 종목 입력

`holdings.json` (gitignored) 또는 `HOLDINGS_JSON` 환경변수로 주입.
형식은 [holdings.example.json](holdings.example.json) 참고.

```json
[
  { "code": "005930", "name": "삼성전자", "buyPrice": 80000, "quantity": 41, "buyDate": "2026-05-01" }
]
```

보유 종목으로 등록된 코드는 손익·손절가·다음 피라미딩가가 카드에 자동
계산되고, 신호도 보유 상태 기준으로 재산정됩니다.

## GitHub Actions 자동 실행

[.github/workflows/daily-dashboard.yml](.github/workflows/daily-dashboard.yml)이
평일 16:00 KST (장 마감 후)에 발화하여 `docs/`를 갱신·커밋·푸시합니다.
Pages 설정은 Settings → Pages → Source: `main` / `/docs`.

## 프로젝트 구조

```text
src/
  types.ts        도메인 타입
  config.ts       8종목 + 총자산
  fetch.ts        네이버 금융 일봉 페처
  indicators.ts   ATR / Donchian / SMA
  turtle.ts       매매 신호 생성
  protocol.ts     종목 추가/삭제 자동 검증
  holdings.ts     보유 포지션 로딩 + 손익 계산
  report.ts       HTML 대시보드 렌더러
  index.ts        오케스트레이터
scripts/
  run.ts          엔트리 스크립트
```
