/**
 * 100만원 코스피 매매 시그널 도메인 모델 (v1.3).
 *
 * 정책 (claude.md §10):
 * - 매수가·손절가·익절가 단정 추천 금지 → "참고 정보"로만 표시
 * - "매매 권유 아님" 면책 카드 상단 유지
 * - 룰 종합 점수만 신호로 노출
 *
 * 자본 제약:
 * - 100만원 기본 (사용자 조정 가능)
 * - 거래비용 0.4% (매수 0.15% + 매도 0.25%) round-trip 마진 reserve
 * - 코스피 1주 단위 분할, 종목당 자본 비중 30~40% 권장
 */

export type SignalAction =
  | 'STRONG_BUY'   // +50 이상 — 강력 매수 후보
  | 'BUY'          // +25 ~ +49 — 매수 후보
  | 'HOLD'         // -24 ~ +24 — 관망
  | 'SELL'         // -49 ~ -25 — 매도 경고
  | 'STRONG_SELL'; // -50 이하 — 강력 매도 경고

export type FactorCategory = '수급' | '가치' | '품질' | '기술' | '52주';
export type FactorStatus = 'positive' | 'neutral' | 'negative';

export interface SignalFactor {
  category: FactorCategory;
  /** 가중치 (양수 매수 기여, 음수 매도 기여). clamp 전 누적값에 반영 */
  weight: number;
  status: FactorStatus;
  /** 사람이 읽는 근거 — 카드에 노출 */
  detail: string;
}

export interface SignalReferences {
  /** 0~100, 현재 가격의 52주 위치 */
  fiftyTwoWeekPositionPct: number | null;
  rsi: number | null;
  /** 가장 가까운 지지·저항 = 52주 저가·고가 (참고용, 추천 라인 아님) */
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
}

export interface TradingSignal {
  code: string;
  name: string;
  pricePerShare: number | null;
  action: SignalAction;
  /** -100 ~ +100 종합 점수 */
  score: number;
  factors: SignalFactor[];
  references: SignalReferences;
  /** 100만원 기준 1주 매수 가능 여부 */
  affordableSingleShare: boolean;
}

export interface PortfolioSlot {
  signal: TradingSignal;
  /** 매수 수량 (정수 주식 수) */
  shares: number;
  /** 종가 × 수량 */
  estimatedCost: number;
  /** 전체 자본 대비 비중 (%) */
  allocationPct: number;
}

export interface PortfolioPlan {
  /** 사용자가 입력한 자본 (원) */
  totalCapital: number;
  /** 거래비용 마진 reserve (round-trip 0.4% 기준) */
  reservedForFees: number;
  /** 할당된 매수 후보 슬롯 */
  slots: PortfolioSlot[];
  /** 분배 후 남은 현금 */
  unspentCash: number;
  /** 매도 경고 종목 (보유 시 참고) */
  sellWarnings: TradingSignal[];
}

/** 점수→액션 매핑 임계값 */
export const ACTION_THRESHOLDS = {
  strongBuy: 50,
  buy: 25,
  sell: -25,
  strongSell: -50,
} as const;
