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
  longName: string | null;
  points: PricePoint[];
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
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
  /** 직전 거래일 대비 변동률 (%) */
  lastDayReturn: number | null;
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  return12m: number | null;
  lastCross: CrossEvent | null;
  /** 5일선 > 20일선 > 60일선 정배열이면 true, 역배열이면 false, 혼합이면 null */
  alignmentBullish: boolean | null;
  /** 최근 1일 거래량 / 20일 평균 거래량 (1보다 크면 평균 초과) */
  volumeRatio: number | null;
  /** 20일 일별 로그 수익률 표준편차 × √252 (연환산 %) */
  volatility20d: number | null;
  /** Average True Range 14일 (가격 단위) */
  atr14: number | null;
  /** 최근 20거래일 최고가 (단기 저항선) */
  recent20High: number | null;
  /** 최근 20거래일 최저가 (단기 지지선) */
  recent20Low: number | null;
}
