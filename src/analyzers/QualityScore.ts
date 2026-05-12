import type { FinancialSummary } from '../types/financial.js';
import type { FlowSummary } from '../types/flow.js';

export interface QualityScore {
  /** 0-100 종합 점수 */
  total: number;
  /** 등급 (S/A/B/C/D) */
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  /** 항목별 점수 (디버깅·툴팁용) */
  breakdown: {
    profitability: number; // 수익성 (ROE) 25점
    valuation: number; // 밸류에이션 (PER/PBR) 20점
    growth: number; // 성장성 (매출 YoY) 15점
    stability: number; // 안정성 (순부채비율) 15점
    efficiency: number; // 효율성 (영업이익률) 10점
    momentum: number; // 수급 모멘텀 15점
  };
}

/**
 * 1-100 종합 품질 점수 계산.
 * 항목: 수익성·밸류에이션·성장성·안정성·효율성·수급 모멘텀.
 * 펀더멘털 4종(financial)이 모두 null이면 null 반환.
 */
export function computeQualityScore(
  financial: FinancialSummary | null | undefined,
  flow: FlowSummary | null | undefined,
): QualityScore | null {
  const latest = financial?.latestActual;
  if (!latest) return null;

  // 수익성 — ROE (최근 실적)
  let profitability = 0;
  if (latest.roe != null) {
    if (latest.roe >= 20) profitability = 25;
    else if (latest.roe >= 15) profitability = 22;
    else if (latest.roe >= 10) profitability = 18;
    else if (latest.roe >= 5) profitability = 12;
    else if (latest.roe >= 0) profitability = 6;
    else profitability = 0;
  }

  // 밸류에이션 — PER + PBR 조합 (낮을수록 좋음)
  let valuation = 0;
  const per = latest.per;
  const pbr = latest.pbr;
  if (per != null && per > 0 && pbr != null && pbr > 0) {
    if (per < 10 && pbr < 1.5) valuation = 20;
    else if (per < 15 && pbr < 2) valuation = 16;
    else if (per < 20 && pbr < 3) valuation = 12;
    else if (per < 30) valuation = 8;
    else valuation = 4;
  } else if (per != null && per > 0) {
    // PBR 없으면 PER만으로 부분 점수
    if (per < 10) valuation = 14;
    else if (per < 20) valuation = 10;
    else if (per < 30) valuation = 6;
    else valuation = 3;
  }

  // 성장성 — 매출 YoY
  let growth = 0;
  if (latest.revenueYoy != null) {
    if (latest.revenueYoy >= 20) growth = 15;
    else if (latest.revenueYoy >= 10) growth = 12;
    else if (latest.revenueYoy >= 5) growth = 9;
    else if (latest.revenueYoy >= 0) growth = 6;
    else if (latest.revenueYoy >= -10) growth = 3;
    else growth = 0;
  }

  // 안정성 — 순부채비율 (음수=현금 우위)
  let stability = 0;
  if (latest.netDebtRatio != null) {
    if (latest.netDebtRatio <= 0) stability = 15; // 현금성 자산 우위
    else if (latest.netDebtRatio <= 30) stability = 12;
    else if (latest.netDebtRatio <= 60) stability = 9;
    else if (latest.netDebtRatio <= 100) stability = 6;
    else if (latest.netDebtRatio <= 200) stability = 3;
    else stability = 0;
  }

  // 효율성 — 영업이익률 (영업이익 / 매출)
  let efficiency = 0;
  if (latest.operatingIncome != null && latest.revenue != null && latest.revenue > 0) {
    const margin = (latest.operatingIncome / latest.revenue) * 100;
    if (margin >= 20) efficiency = 10;
    else if (margin >= 15) efficiency = 8;
    else if (margin >= 10) efficiency = 6;
    else if (margin >= 5) efficiency = 4;
    else if (margin >= 0) efficiency = 2;
    else efficiency = 0;
  }

  // 수급 모멘텀 — 외인+기관 20일 + 60일 (15점)
  let momentum = 0;
  if (flow) {
    const f20 = flow.net20dForeigner;
    const i20 = flow.net20dInstitutional;
    const f60 = flow.net60dForeigner;
    const i60 = flow.net60dInstitutional;
    const both20Buy = f20 != null && i20 != null && f20 > 0 && i20 > 0;
    const both20Sell = f20 != null && i20 != null && f20 < 0 && i20 < 0;
    const both60Buy = f60 != null && i60 != null && f60 > 0 && i60 > 0;
    if (both20Buy && both60Buy) momentum = 15;
    else if (both20Buy) momentum = 11;
    else if (both60Buy) momentum = 7;
    else if (both20Sell) momentum = 0;
    else momentum = 4; // 혼조
  }

  const total = Math.min(
    100,
    Math.round(profitability + valuation + growth + stability + efficiency + momentum),
  );

  const grade: QualityScore['grade'] =
    total >= 80 ? 'S'
      : total >= 65 ? 'A'
        : total >= 50 ? 'B'
          : total >= 35 ? 'C'
            : 'D';

  return {
    total,
    grade,
    breakdown: {
      profitability,
      valuation,
      growth,
      stability,
      efficiency,
      momentum,
    },
  };
}
