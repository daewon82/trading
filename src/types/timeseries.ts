export interface PricePoint {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface Timeseries {
  ticker: string;
  resolved: string;
  currency: string;
  points: PricePoint[];
}

export type CrossKind = 'golden' | 'death';

export interface CrossEvent {
  kind: CrossKind;
  daysAgo: number;
  date: string;
}

export interface IndicatorSet {
  sma5: number | null;
  sma20: number | null;
  sma50: number | null;
  sma60: number | null;
  sma200: number | null;
  rsi14: number | null;
  pctVsSma200: number | null;
  return1m: number | null;
  return3m: number | null;
  lastCross: CrossEvent | null;
  /** 5일선 > 20일선 > 60일선 정배열이면 true, 역배열이면 false, 혼합이면 null */
  alignmentBullish: boolean | null;
  /** 최근 1일 거래량 / 20일 평균 거래량 (1보다 크면 평균 초과) */
  volumeRatio: number | null;
}
