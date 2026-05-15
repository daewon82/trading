/**
 * v1.8 — 시장 구조 분석 도메인 모델 (CLAUDE.md §4.10 신규).
 *
 * "코스피 지수 상승 = 모든 종목 상승"이 아니라는 사실을 정량화.
 * 실제 사례(2026-05-15): 코스피 +0.5% 상승 중이지만 ADR 18.98%
 * → 상승 141 / 하락 743 → 보유 7종 모두 하락.
 */

export type MarketBreadth = 'strong' | 'healthy' | 'narrow' | 'concentrated';

export interface AdvanceDeclineCounts {
  /** 시장 식별자 (KOSPI / KOSDAQ) */
  market: 'KOSPI' | 'KOSDAQ';
  upper: number;       // 상한종목수
  advancing: number;   // 상승종목수
  unchanged: number;   // 보합종목수
  declining: number;   // 하락종목수
  lower: number;       // 하한종목수
  capturedAt: string;
}

export interface MarketStructureResult {
  counts: AdvanceDeclineCounts;
  /** ADR = advancing / declining × 100 */
  adrPct: number;
  /** 분류:
   *  strong       ≥ 150%  광범위한 상승 (강세장)
   *  healthy      100~150%  과반 상승 (건강한 시장)
   *  narrow        50~100%  쏠림 시작 (소외 종목 출현)
   *  concentrated  < 50%   극단적 쏠림 (대다수 하락, 일부만 급등)
   */
  breadth: MarketBreadth;
  /** 사람이 읽는 한 줄 요약 */
  label: string;
  /** 사용자에게 표시되는 의미·대응 가이드 */
  insight: string;
  /** 보유 종목 손실 가능성 (확률 추정 — 코호트 데이터 기반 단순 추정) */
  expectedHoldingLossProbability: number;
}
