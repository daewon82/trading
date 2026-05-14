import type { FlowSummary } from '../types/flow.js';
import {
  LEAD_SECTORS,
  VALUE_THRESHOLDS,
  type ValuationMetrics,
  type ValueBadge,
  type ValueScore,
  type ValueScoreBreakdown,
} from '../types/valuation.js';

/**
 * 코스피 가치주 멀티팩터 스크리닝 (claude.md §4.5).
 *
 * 1. 1차 필터(AND) — 충족 못 하면 null
 *    - PBR ≤ 1.0, PER ≤ 15, ROE ≥ 8%
 *    - 외인 20일 누적 순매수 > 0, 기관 20일 누적 순매수 > 0
 *    - 시총 ≥ 5,000억원
 * 2. 2차 점수(0~100, 섹터 보너스 포함 최대 105 → clamp 100)
 *    - 각 팩터 20점 만점 + 주도 섹터 보너스 +5
 * 3. 배지 — 70점↑ "가치 우량"(💎), 50~69점 "가치 후보"(🔍), 미만 null
 */
export class ValueScreener {
  screen(metrics: ValuationMetrics, flow: FlowSummary | null): ValueScore | null {
    if (!this.passesFilter(metrics, flow)) return null;
    return this.score(metrics, flow);
  }

  /** 1차 필터 통과 여부 — debug용으로 분리 */
  passesFilter(metrics: ValuationMetrics, flow: FlowSummary | null): boolean {
    const { pbrMax, perMax, roeMin, marketCapMin } = VALUE_THRESHOLDS;
    if (metrics.pbr == null || metrics.pbr > pbrMax) return false;
    if (metrics.per == null || metrics.per <= 0 || metrics.per > perMax) return false;
    if (metrics.roe == null || metrics.roe < roeMin) return false;
    if (metrics.marketCap == null || metrics.marketCap < marketCapMin) return false;
    if (!flow) return false;
    if (flow.net20dForeigner == null || flow.net20dForeigner <= 0) return false;
    if (flow.net20dInstitutional == null || flow.net20dInstitutional <= 0) return false;
    return true;
  }

  /**
   * 점수 계산 — 필터 통과를 가정한다.
   * 필터 미통과 입력이면 0점 또는 음수가 나올 수 있어 외부에서 screen()을 사용할 것.
   */
  score(metrics: ValuationMetrics, flow: FlowSummary | null): ValueScore {
    const breakdown = this.computeBreakdown(metrics, flow);
    const rawTotal =
      breakdown.pbr +
      breakdown.per +
      breakdown.roe +
      breakdown.foreignerFlow +
      breakdown.institutionalFlow +
      breakdown.sectorBonus;
    const total = Math.max(0, Math.min(100, Math.round(rawTotal)));
    return {
      code: metrics.code,
      name: metrics.name,
      sector: metrics.sector,
      total,
      badge: this.toBadge(total),
      breakdown,
      metrics,
    };
  }

  private computeBreakdown(
    m: ValuationMetrics,
    flow: FlowSummary | null,
  ): ValueScoreBreakdown {
    // PBR — (1 - PBR) × 20, clamp [0, 20]. PBR 0이면 20, 1이면 0, >1이면 음수가 되므로 clamp.
    const pbr = m.pbr == null ? 0 : clamp((1 - m.pbr) * 20, 0, 20);

    // PER — (15 - PER)/15 × 20, clamp [0, 20]
    const per = m.per == null ? 0 : clamp(((15 - m.per) / 15) * 20, 0, 20);

    // ROE — min(ROE/20, 1) × 20 → 0~20, ROE 20% 이상이면 만점. 음수는 0.
    const roe = m.roe == null ? 0 : clamp((Math.min(m.roe, 20) / 20) * 20, 0, 20);

    // 외인·기관 20일 누적 — 단위가 '주' 라서 log10 스케일 정규화. 1만주~수백만주 분포를 0~20에 매핑.
    // log10(1e4)=4 → 5점, log10(1e5)=5 → 10점, log10(1e6)=6 → 15점, log10(1e7)=7 → 20점
    const foreignerFlow = flowScore(flow?.net20dForeigner);
    const institutionalFlow = flowScore(flow?.net20dInstitutional);

    // 주도 섹터 보너스
    const sectorBonus = (LEAD_SECTORS as readonly string[]).includes(m.sector) ? 5 : 0;

    return { pbr, per, roe, foreignerFlow, institutionalFlow, sectorBonus };
  }

  private toBadge(total: number): ValueBadge {
    if (total >= 70) return '가치 우량';
    if (total >= 50) return '가치 후보';
    return null;
  }
}

/**
 * 점수 내림차순 정렬 + Top N 추출. 동점 시 PBR 낮은 순.
 */
export function rankValueScores(scores: ValueScore[], topN = 5): ValueScore[] {
  return [...scores]
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      const aPbr = a.metrics.pbr ?? Infinity;
      const bPbr = b.metrics.pbr ?? Infinity;
      return aPbr - bPbr;
    })
    .slice(0, topN);
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function flowScore(netShares: number | null | undefined): number {
  if (netShares == null || netShares <= 0) return 0;
  const log = Math.log10(netShares);
  // log10=3(1천주)→0점, log10=7(1천만주)→20점, 그 사이 선형
  return clamp(((log - 3) / 4) * 20, 0, 20);
}
