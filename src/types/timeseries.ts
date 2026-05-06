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
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  pctVsSma200: number | null;
  return1m: number | null;
  return3m: number | null;
  lastCross: CrossEvent | null;
}
