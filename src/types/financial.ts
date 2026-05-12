export interface AnnualFinancials {
  /** 회계 연도 (예: '2025(A)') */
  year: string;
  /** 실적/예상치 ('actual' | 'estimate') */
  type: 'actual' | 'estimate';
  /** 매출액 (억원) */
  revenue: number | null;
  /** 매출액 YoY (%) */
  revenueYoy: number | null;
  /** 영업이익 (억원) */
  operatingIncome: number | null;
  /** 당기순이익 (억원) */
  netIncome: number | null;
  /** EPS (원) */
  eps: number | null;
  /** PER (배) */
  per: number | null;
  /** PBR (배) */
  pbr: number | null;
  /** ROE (%) */
  roe: number | null;
  /** EV/EBITDA (배) */
  evEbitda: number | null;
  /** 순부채비율 (%, 음수=현금성 자산 우위) */
  netDebtRatio: number | null;
}

export interface FinancialSummary {
  code: string;
  /** 최근 3개년 실적 + 2개년 예상 (Wisereport 기준) */
  annuals: AnnualFinancials[];
  /** 가장 최근 actual (보통 직전 연도) */
  latestActual: AnnualFinancials | null;
  /** 가장 최근 estimate (당해 또는 차기) */
  latestEstimate: AnnualFinancials | null;
}
