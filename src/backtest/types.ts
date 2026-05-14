/**
 * 신호 백테스트 도메인 모델 (v1.2).
 *
 * 목적: 대시보드가 매일 표시하는 외인+기관 동반 신호(오늘/5/20/60일)가
 * 실제로 사후 5/10/20일 수익률에 유의미한 우위를 갖는지 통계로 검증.
 *
 * YouTube 콘텐츠 다수가 빠지는 함정(단일 종목·단일 백테스트·look-ahead bias)을
 * 회피하기 위해, 모든 universe 종목의 모든 신호 시점을 누적해 평균 통계를 낸다.
 */

export type SignalType =
  | 'today_both_buy'   // 당일 외인+기관 동반 순매수
  | 'today_both_sell'  // 당일 외인+기관 동반 순매도
  | '5d_both_buy'      // 5일 누적 동반 순매수
  | '5d_both_sell'     // 5일 누적 동반 순매도
  | '20d_both_buy'     // 20일 누적 동반 순매수 (★★ 라벨)
  | '20d_both_sell'    // 20일 누적 동반 순매도 (위험 ★★)
  | '60d_both_buy'     // 60일 누적 동반 순매수 (장기 사이클)
  | '60d_both_sell';   // 60일 누적 동반 순매도

export type Direction = 'buy' | 'sell';

/** 사후 수익률 측정 horizon (거래일 기준) */
export const HORIZONS: readonly number[] = [5, 10, 20] as const;
export type Horizon = (typeof HORIZONS)[number];

export interface SignalEvent {
  code: string;
  name: string;
  date: string;
  type: SignalType;
  direction: Direction;
  entryClose: number;
  /** horizon → 사후 종가 (없으면 null) */
  futureClose: Record<number, number | null>;
  /** horizon → 수익률 (소수, 0.023 = 2.3%). 매도 신호는 부호 반전(매도가 적중하면 양수) */
  forwardReturns: Record<number, number | null>;
}

export interface SignalStats {
  /** horizon → 평균 수익률 */
  meanReturn: number | null;
  /** horizon → 적중률 (수익률 > 0 비율) */
  hitRate: number | null;
  /** 표준편차 */
  std: number | null;
  /** Sharpe 비슷한 비율 (mean/std, 연환산 X — horizon 단위) */
  ratio: number | null;
  worst: number | null;
  best: number | null;
  /** 표본 수 */
  count: number;
}

export interface BacktestResult {
  signalType: SignalType;
  totalEvents: number;
  /** horizon → 통계 */
  byHorizon: Record<number, SignalStats>;
  /** 종목별 신호 발생 횟수 Top */
  topTickers: Array<{ code: string; name: string; count: number }>;
}

export interface BacktestReport {
  generatedAt: string;
  universeSize: number;
  totalSignals: number;
  windowDays: number;
  /** 한국 평균 거래비용 가정 (편도 0.15% + 매도 0.25% = 0.4%/매수+매도 round-trip) */
  roundTripCostBps: number;
  results: BacktestResult[];
  /** 모든 신호 이벤트 (디버깅/CSV 추출용) */
  events: SignalEvent[];
}
