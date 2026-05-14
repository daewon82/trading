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
  financial?: import('./financial.js').FinancialSummary | null;
  qualityScore?: import('../analyzers/QualityScore.js').QualityScore | null;
  /** v1.1 — 코스피 가치주 스크리너 점수. 필터 미통과 또는 KR 외 시장은 null. */
  valuation?: import('./valuation.js').ValueScore | null;
  /** v1.6 — 코스피 지수 대비 20거래일 상대 강도(RS). 시계열 부족 시 null. */
  relativeStrength?: RelativeStrength | null;
}

export interface RelativeStrength {
  /** 종목 20거래일 수익률 (예: 0.07 = +7%) */
  stockReturn20d: number;
  /** 벤치마크(코스피) 20거래일 수익률 */
  benchmarkReturn20d: number;
  /** RS = stockReturn20d - benchmarkReturn20d. 양수면 outperform */
  rsPct: number;
  /** 벤치마크 심볼 (예: '^KS11') */
  benchmarkSymbol: string;
}

export interface StockDashboardSection {
  market: Market;
  currency: Currency;
  cards: DashboardCard[];
}
