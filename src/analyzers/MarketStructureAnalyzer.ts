import type {
  AdvanceDeclineCounts,
  MarketBreadth,
  MarketStructureResult,
} from '../types/market-structure.js';

/**
 * v1.8 — 시장 구조 분석기 (CLAUDE.md §4.10).
 *
 * ADR(Advance-Decline Ratio) 4단계 분류 + 보유 종목 손실 가능성 추정.
 *
 * 분류 임계값:
 *   strong       ≥ 150%  광범위한 상승 (대부분 종목 상승)
 *   healthy      100~150% 과반 상승 (건강한 시장)
 *   narrow        50~100% 쏠림 시작 (절반 이상 하락)
 *   concentrated  < 50%   극단적 쏠림 (반도체·자동차 등 일부만 상승)
 *
 * 실제 사례 (2026-05-15):
 *   KOSPI 상승 141 / 하락 743 → ADR 18.98% → "concentrated"
 *   결과: 보유 7종 모두 하락 (반도체·자동차 외 모두 매도)
 */

const BREADTH_THRESHOLDS = {
  strong: 150,
  healthy: 100,
  narrow: 50,
} as const;

const BREADTH_LABEL: Record<MarketBreadth, string> = {
  strong: '🟢 광범위한 상승 (건강한 강세장)',
  healthy: '🟡 과반 상승 (양호한 시장)',
  narrow: '🟠 쏠림 시작 (소외 종목 출현)',
  concentrated: '🔴 극단적 쏠림 (대다수 하락)',
};

const BREADTH_INSIGHT: Record<MarketBreadth, string> = {
  strong:
    '대부분 종목이 동반 상승 중 — 추격매수 비교적 안전. 강력매수 알림 발송 권장.',
  healthy:
    '시장 전반 건강 — 매수 신호 신뢰도 정상. 보유 종목 다수 동반 상승 기대.',
  narrow:
    '쏠림 장세 진입 — 지수가 올라도 보유 종목은 하락 가능. 매수 신중. 소외 업종 점검.',
  concentrated:
    '극단적 쏠림 — 코스피 지수 ≠ 보유 수익률. 신규 매수 보류 권장. 순환매 발생 시 소외 업종 진입 기회.',
};

/** 코호트 추정 — concentrated일수록 보유 종목 손실 확률 ↑ */
function estimateLossProbability(adrPct: number): number {
  // ADR 200% = 10% / 100% = 35% / 50% = 65% / 20% = 85% 정도로 단조 감소
  if (adrPct >= 200) return 0.10;
  if (adrPct >= 150) return 0.20;
  if (adrPct >= 100) return 0.35;
  if (adrPct >= 75) return 0.50;
  if (adrPct >= 50) return 0.65;
  if (adrPct >= 25) return 0.80;
  return 0.90;
}

export class MarketStructureAnalyzer {
  analyze(counts: AdvanceDeclineCounts): MarketStructureResult {
    const advancing = counts.advancing;
    const declining = counts.declining;
    const adrPct = declining > 0 ? (advancing / declining) * 100 : 999;
    const breadth: MarketBreadth =
      adrPct >= BREADTH_THRESHOLDS.strong ? 'strong'
      : adrPct >= BREADTH_THRESHOLDS.healthy ? 'healthy'
      : adrPct >= BREADTH_THRESHOLDS.narrow ? 'narrow'
      : 'concentrated';
    return {
      counts,
      adrPct,
      breadth,
      label: BREADTH_LABEL[breadth],
      insight: BREADTH_INSIGHT[breadth],
      expectedHoldingLossProbability: estimateLossProbability(adrPct),
    };
  }

  /** 알림 게이트 — ADR ≥ 100% (healthy 이상)이면 강력매수 알림 허용 */
  isAlertAllowed(result: MarketStructureResult): boolean {
    return result.breadth === 'strong' || result.breadth === 'healthy';
  }

  /**
   * 순환매 감지 — 직전 N일 평균 ADR과 비교해 최근 급상승 + 직전엔 쏠림이었으면 순환매로 판별.
   * (단순 휴리스틱. 향후 어제/오늘 ADR 비교 등 정교화 가능)
   */
  detectRotation(today: number, prevAverage: number): boolean {
    return today >= 100 && prevAverage < 75 && today - prevAverage >= 30;
  }
}
