import type {
  StockSnapshot,
  DashboardCard,
  Quartile,
  ReferenceLines,
  StockDashboardSection,
} from '../types/stock.js';
import type { IndicatorSet } from '../types/timeseries.js';

export class DashboardBuilder {
  build(
    snapshots: StockSnapshot[],
    indicators?: ReadonlyMap<string, IndicatorSet>,
  ): StockDashboardSection {
    if (snapshots.length === 0) {
      throw new Error('DashboardBuilder.build: empty snapshots');
    }
    const currencies = new Set(snapshots.map((s) => s.currency));
    if (currencies.size > 1) {
      throw new Error(
        `DashboardBuilder.build: mixed currencies not allowed: [${[...currencies].join(', ')}]`,
      );
    }
    const head = snapshots[0]!;
    const cards = snapshots.map((s) =>
      this.toCard(s, indicators?.get(s.code) ?? null),
    );
    return { market: head.market, currency: head.currency, cards };
  }

  private toCard(s: StockSnapshot, indicators: IndicatorSet | null): DashboardCard {
    const position = this.calcPosition(s.price, s.fiftyTwoWeekLow, s.fiftyTwoWeekHigh);
    return {
      snapshot: s,
      fiftyTwoWeekPosition: position,
      quartile: position == null ? null : this.quartile(position),
      referenceLines: this.referenceLines(s.fiftyTwoWeekLow, s.fiftyTwoWeekHigh),
      indicators,
    };
  }

  private calcPosition(
    price: number | null,
    low: number | null,
    high: number | null,
  ): number | null {
    if (price == null || low == null || high == null) return null;
    if (high === low) return null;
    return ((price - low) / (high - low)) * 100;
  }

  private quartile(position: number): Quartile {
    if (position < 25) return 1;
    if (position < 50) return 2;
    if (position < 75) return 3;
    return 4;
  }

  private referenceLines(low: number | null, high: number | null): ReferenceLines | null {
    if (low == null || high == null || high === low) return null;
    const range = high - low;
    return {
      q1: low + range * 0.25,
      q2: low + range * 0.5,
      q3: low + range * 0.75,
    };
  }
}
