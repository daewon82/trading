import type {
  HoldingPosition,
  PortfolioSnapshot,
  PositionPnL,
} from '../types/portfolio.js';

/**
 * v1.7 — 보유 종목 손익 추적기 (CLAUDE.md §4.8).
 *
 * 입력: HoldingPosition[] + code → currentPrice 맵.
 * 출력: 종목별 손익 + 합산.
 *
 * 매수가·수량은 사용자가 직접 입력. 환경변수 `HOLDINGS_JSON`으로 spec에서 주입 가능.
 */
export class PortfolioTracker {
  compute(
    positions: HoldingPosition[],
    priceMap: Map<string, number>,
  ): PortfolioSnapshot {
    const rows: PositionPnL[] = [];
    let totalInvested = 0;
    let totalCurrent = 0;
    for (const p of positions) {
      const cur = priceMap.get(p.code) ?? null;
      const invested = p.buyPrice * p.quantity;
      const currentValue = cur != null ? cur * p.quantity : null;
      const pnl = currentValue != null ? currentValue - invested : null;
      const pnlPct = cur != null && p.buyPrice > 0
        ? ((cur - p.buyPrice) / p.buyPrice) * 100
        : null;
      rows.push({ position: p, currentPrice: cur, currentValue, pnl, pnlPct });
      totalInvested += invested;
      if (currentValue != null) totalCurrent += currentValue;
    }
    const totalPnL = totalCurrent - totalInvested;
    const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    return {
      positions: rows,
      totalInvested,
      totalCurrent,
      totalPnL,
      totalPnLPct,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 환경변수 HOLDINGS_JSON에서 HoldingPosition[] 파싱.
   * 형식: '[{"code":"005930","name":"삼성전자","buyPrice":280000,"quantity":2,"buyDate":"2026-05-01"}, ...]'
   * 미설정 또는 파싱 실패 시 빈 배열.
   */
  static parseFromEnv(holdingsJson: string | undefined): HoldingPosition[] {
    if (!holdingsJson) return [];
    try {
      const parsed = JSON.parse(holdingsJson) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is HoldingPosition =>
        typeof x === 'object' && x !== null
        && typeof (x as HoldingPosition).code === 'string'
        && typeof (x as HoldingPosition).buyPrice === 'number'
        && typeof (x as HoldingPosition).quantity === 'number'
      );
    } catch {
      return [];
    }
  }
}
