import type { StockConfig } from './types.js';

export const RISK_PCT = 0.01;
export const MAX_PYRAMID_UNITS = 4;

/**
 * 보유 종목이 하나도 없을 때의 폴백 총자산. env TOTAL_CAPITAL 로 명시
 * 오버라이드 가능. 보유 종목이 있으면 보유 평단가 합계가 우선됩니다.
 */
export const FALLBACK_TOTAL_CAPITAL = Number(process.env.TOTAL_CAPITAL ?? 50_000_000);
export const HAS_TOTAL_CAPITAL_OVERRIDE = process.env.TOTAL_CAPITAL != null;

export const DASHBOARD_PUBLIC_URL =
  process.env.DASHBOARD_PUBLIC_URL ?? 'https://daewon82.github.io/trading/';

export const STOCKS: StockConfig[] = [
  { code: '005930', name: '삼성전자', positionNote: '주도 대형주 (추세 지속성 높음)' },
  { code: '066570', name: 'LG전자', positionNote: '강한 모멘텀 (최근 변동성 확대)' },
  { code: '003550', name: 'LG', positionNote: '지주회사 (LG그룹 전체 익스포저)' },
  { code: '000270', name: '기아', positionNote: '실적 대형주 (추세 신뢰도 높음)' },
  { code: '017670', name: 'SK텔레콤', positionNote: '방어주 성격 (낮은 변동성, 안정적)' },
  { code: '003490', name: '대한항공', positionNote: '경기 민감주 (박스권 돌파 확인 필수)' },
  { code: '008770', name: '호텔신라', positionNote: '턴어라운드형 (완전한 바닥 탈출 필요)' },
  { code: '139480', name: '이마트', positionNote: '역추세 주의 (20일 고점 돌파 엄격 적용)' },
];
