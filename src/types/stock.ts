export type Market = 'KR' | 'US';
export type Currency = 'KRW' | 'USD';
export type SourceId = 'naver-kr' | 'naver-global' | 'yahoo';

export interface StockSnapshot {
  code: string;
  name: string;
  market: Market;
  currency: Currency;
  source: SourceId;
  capturedAt: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface ComparisonRow {
  code: string;
  name: string;
  source: SourceId;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  dividendYield: number | null;
}

export interface ComparisonReport {
  market: Market;
  currency: Currency;
  generatedAt: string;
  rows: ComparisonRow[];
  ranking: {
    byMarketCap: string[];
    byPer: string[];
    byDividendYield: string[];
  };
}

export interface CheckResult {
  source: SourceId;
  code: string;
  name: string;
  ok: boolean;
  missing: string[];
  errors: string[];
}

export interface HealthCheckResult {
  source: SourceId;
  ok: boolean;
  checks: CheckResult[];
}

export type CrossVerifyField = 'price' | 'marketCap' | 'per';

export interface CrossVerifyDelta {
  field: CrossVerifyField;
  a: number | null;
  b: number | null;
  diffPercent: number | null;
  withinTolerance: boolean;
}

export interface CrossVerifyResult {
  code: string;
  sourceA: SourceId;
  sourceB: SourceId;
  ok: boolean;
  deltas: CrossVerifyDelta[];
}

export type Quartile = 1 | 2 | 3 | 4;

export interface ReferenceLines {
  q1: number;
  q2: number;
  q3: number;
}

export interface DashboardCard {
  snapshot: StockSnapshot;
  fiftyTwoWeekPosition: number | null;
  quartile: Quartile | null;
  referenceLines: ReferenceLines | null;
  indicators: import('./timeseries.js').IndicatorSet | null;
  sparklineCloses: number[] | null;
  flow: import('./flow.js').FlowSummary | null;
  consensus: import('./consensus.js').AnalystConsensus | null;
}

export interface StockDashboardSection {
  market: Market;
  currency: Currency;
  cards: DashboardCard[];
}
