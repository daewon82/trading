import type {
  StockSnapshot,
  ComparisonReport,
  ComparisonRow,
  Currency,
  Market,
} from '../types/stock.js';

export class StockComparator {
  compare(snapshots: StockSnapshot[]): ComparisonReport {
    if (snapshots.length === 0) {
      throw new Error('StockComparator.compare: empty snapshot list');
    }
    const currencies = new Set(snapshots.map((s) => s.currency));
    if (currencies.size > 1) {
      throw new Error(
        `StockComparator.compare: mixed currencies not allowed: [${[...currencies].join(', ')}]`,
      );
    }
    const head = snapshots[0]!;
    const currency: Currency = head.currency;
    const market: Market = head.market;

    const rows: ComparisonRow[] = snapshots.map((s) => ({
      code: s.code,
      name: s.name,
      source: s.source,
      price: s.price,
      changePercent: s.changePercent,
      marketCap: s.marketCap,
      per: s.per,
      pbr: s.pbr,
      roe: s.roe,
      dividendYield: s.dividendYield,
    }));

    const sortDesc = (key: keyof ComparisonRow): string[] =>
      rows
        .filter((r) => typeof r[key] === 'number')
        .slice()
        .sort((a, b) => (b[key] as number) - (a[key] as number))
        .map((r) => r.code);

    const sortAsc = (key: keyof ComparisonRow): string[] =>
      rows
        .filter((r) => typeof r[key] === 'number' && (r[key] as number) > 0)
        .slice()
        .sort((a, b) => (a[key] as number) - (b[key] as number))
        .map((r) => r.code);

    return {
      market,
      currency,
      generatedAt: new Date().toISOString(),
      rows,
      ranking: {
        byMarketCap: sortDesc('marketCap'),
        byPer: sortAsc('per'),
        byDividendYield: sortDesc('dividendYield'),
      },
    };
  }
}
