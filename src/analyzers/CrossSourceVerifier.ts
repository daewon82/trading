import type {
  StockSnapshot,
  CrossVerifyDelta,
  CrossVerifyField,
  CrossVerifyResult,
} from '../types/stock.js';

export interface CrossVerifyTolerance {
  pricePercent: number;
  marketCapPercent: number;
  perPercent: number;
}

export const DEFAULT_TOLERANCE: CrossVerifyTolerance = {
  pricePercent: 1,
  marketCapPercent: 2,
  perPercent: 5,
};

export class CrossSourceVerifier {
  constructor(private readonly tolerance: CrossVerifyTolerance = DEFAULT_TOLERANCE) {}

  verify(a: StockSnapshot, b: StockSnapshot): CrossVerifyResult {
    if (a.code !== b.code) {
      throw new Error(`CrossSourceVerifier.verify: code mismatch (${a.code} vs ${b.code})`);
    }
    if (a.source === b.source) {
      throw new Error(`CrossSourceVerifier.verify: same source (${a.source})`);
    }
    const deltas: CrossVerifyDelta[] = [
      this.diff('price', a.price, b.price, this.tolerance.pricePercent),
      this.diff('marketCap', a.marketCap, b.marketCap, this.tolerance.marketCapPercent),
      this.diff('per', a.per, b.per, this.tolerance.perPercent),
    ];
    return {
      code: a.code,
      sourceA: a.source,
      sourceB: b.source,
      ok: deltas.every((d) => d.withinTolerance),
      deltas,
    };
  }

  private diff(
    field: CrossVerifyField,
    a: number | null,
    b: number | null,
    tolerancePct: number,
  ): CrossVerifyDelta {
    if (a == null || b == null) {
      return { field, a, b, diffPercent: null, withinTolerance: false };
    }
    if (a === 0 && b === 0) {
      return { field, a, b, diffPercent: 0, withinTolerance: true };
    }
    const base = Math.max(Math.abs(a), Math.abs(b));
    const diffPercent = (Math.abs(a - b) / base) * 100;
    return {
      field,
      a,
      b,
      diffPercent,
      withinTolerance: diffPercent <= tolerancePct,
    };
  }
}
