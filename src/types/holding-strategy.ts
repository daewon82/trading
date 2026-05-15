/**
 * v1.9 — 보유 종목 대응 전략 도메인 모델.
 *
 * 사용자가 보유 중인 종목별로 명확한 액션을 제시:
 *   - 🟢 BUY_MORE  추가 매수 (저점 + 강한 매수 신호)
 *   - 🟡 HOLD     보유 유지 (중립적 신호 또는 약한 신호)
 *   - 🔴 SELL     매도 검토 (고점 + 매도 신호 또는 구조 리스크)
 *
 * 점수 임계값:
 *   action_score >= 25  → BUY_MORE
 *   action_score >= -25 → HOLD
 *   action_score <  -25 → SELL
 *
 * action_score는 TradingSignal.score를 기반으로 하되,
 * 손익률·52주 위치를 추가로 반영해 보유자 관점에서 재계산.
 */

export type HoldingAction = 'BUY_MORE' | 'HOLD' | 'SELL';

export interface StrategyFactor {
  /** 사람이 읽는 근거 한 줄 */
  detail: string;
  /** 이 팩터의 가중치 기여도 */
  weight: number;
  /** 표시용 아이콘 */
  icon?: string;
}

export interface HoldingStrategyResult {
  code: string;
  name: string;
  action: HoldingAction;
  /** 0~100 신뢰도 점수 (액션을 얼마나 강하게 권하는가) */
  confidence: number;
  /** 액션을 결정한 핵심 근거 (최대 5개) */
  reasons: StrategyFactor[];
  /** 손익률 (%) — null이면 보유 정보 없음 */
  pnlPct: number | null;
  /** 현재가 */
  currentPrice: number | null;
  /** 52주 위치 (0~100) */
  fiftyTwoWeekPositionPct: number | null;
  /** 시그널 점수 (-100~+100) — 참고용 */
  signalScore: number;
}
