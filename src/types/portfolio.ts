/**
 * v1.7 — 보유 종목 손익 추적 도메인 모델 (CLAUDE.md §4.8).
 */

export interface HoldingPosition {
  code: string;
  name: string;
  /** 평균 매수가 (KRW) */
  buyPrice: number;
  /** 보유 수량 (정수 주식) */
  quantity: number;
  /** 최초 매수일 (YYYY-MM-DD) — 표시용. 추후 보유 기간 분석에 활용 */
  buyDate: string;
}

export interface PositionPnL {
  position: HoldingPosition;
  currentPrice: number | null;
  /** 평가금액 = currentPrice × quantity */
  currentValue: number | null;
  /** 손익 (원) = currentValue - buyPrice × quantity */
  pnl: number | null;
  /** 손익률 (%) = (currentPrice - buyPrice) / buyPrice × 100 */
  pnlPct: number | null;
}

export interface PortfolioSnapshot {
  positions: PositionPnL[];
  /** 총 투자금액 = Σ buyPrice × quantity */
  totalInvested: number;
  /** 현재 평가금액 = Σ currentPrice × quantity (currentPrice null인 종목 제외) */
  totalCurrent: number;
  /** 총 손익 (원) */
  totalPnL: number;
  /** 총 손익률 (%) */
  totalPnLPct: number;
  updatedAt: string;
}
