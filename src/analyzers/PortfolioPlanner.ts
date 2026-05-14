import type {
  PortfolioPlan,
  PortfolioSlot,
  TradingSignal,
} from '../types/trading-signal.js';

/**
 * 소규모 자본(기본 100만원) 코스피 포트폴리오 분배 (v1.3).
 *
 * 알고리즘:
 * 1. 입력 signals 중 액션이 STRONG_BUY/BUY인 후보 추출 → score 내림차순
 * 2. 거래비용 reserve = 자본 × 0.4% × 2 (매수 + 매도 round-trip) → 최소 5,000원
 * 3. 가용 자본 = 자본 - reserve
 * 4. Top N(기본 3개) 후보에 1/N씩 균등 목표 배분
 * 5. 각 슬롯: shares = floor(목표금액 / 종가). 가격 > 목표금액이면 슬롯 비움
 *    (단, 다음 후보로 자동 대체 — 가격이 가능한 다음 후보까지 탐색)
 * 6. 남은 현금 = unspentCash
 *
 * 매도 경고: 별도 추출 (현재 보유 시 점검용)
 */
export interface PlannerOptions {
  totalCapital?: number;
  slotCount?: number;
  /** 거래비용율 (round-trip). 기본 0.4% = 0.004 */
  roundTripFeeRate?: number;
  /** 최소 reserve (원) */
  minFeeReserve?: number;
}

export class PortfolioPlanner {
  suggest(signals: TradingSignal[], opts: PlannerOptions = {}): PortfolioPlan {
    const capital = opts.totalCapital ?? 1_000_000;
    const slotCount = opts.slotCount ?? 3;
    const feeRate = opts.roundTripFeeRate ?? 0.004;
    const minReserve = opts.minFeeReserve ?? 5_000;

    const reservedForFees = Math.max(minReserve, Math.round(capital * feeRate));
    const available = capital - reservedForFees;

    const buyCandidates = signals
      .filter((s) => s.action === 'STRONG_BUY' || s.action === 'BUY')
      .filter((s) => s.pricePerShare != null && s.pricePerShare > 0)
      .sort((a, b) => b.score - a.score);

    const sellWarnings = signals
      .filter((s) => s.action === 'SELL' || s.action === 'STRONG_SELL')
      .sort((a, b) => a.score - b.score);

    const slots: PortfolioSlot[] = [];
    let cash = available;
    const targetPerSlot = Math.floor(available / slotCount);

    for (const sig of buyCandidates) {
      if (slots.length >= slotCount) break;
      const price = sig.pricePerShare!;
      // 종목당 목표금액 안에서 매수 가능한 정수 주식 수
      const budget = Math.min(targetPerSlot, cash);
      const shares = Math.floor(budget / price);
      if (shares <= 0) continue; // 가격이 목표금액 초과 → 다음 후보
      const cost = shares * price;
      slots.push({
        signal: sig,
        shares,
        estimatedCost: cost,
        allocationPct: (cost / capital) * 100,
      });
      cash -= cost;
    }

    return {
      totalCapital: capital,
      reservedForFees,
      slots,
      unspentCash: cash + reservedForFees, // reserve는 일부러 안 쓴 부분이므로 합산해 노출
      sellWarnings,
    };
  }
}
