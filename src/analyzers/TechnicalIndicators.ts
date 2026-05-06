import type {
  Timeseries,
  IndicatorSet,
  CrossEvent,
  PricePoint,
} from '../types/timeseries.js';

export function computeIndicators(ts: Timeseries): IndicatorSet {
  const closes = ts.points.map((p) => p.close);
  const last = closes[closes.length - 1];

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const pctVsSma200 =
    last != null && sma200 != null && sma200 !== 0
      ? ((last - sma200) / sma200) * 100
      : null;

  return {
    sma50,
    sma200,
    rsi14,
    pctVsSma200,
    return1m: pctReturn(closes, 21),
    return3m: pctReturn(closes, 63),
    lastCross: findLastCross(ts.points),
  };
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let total = 0;
  for (let i = values.length - period; i < values.length; i++) total += values[i]!;
  return total / period;
}

function rsi(values: number[], period: number): number | null {
  if (values.length < period + 1) return null;
  const tail = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = tail[i]! - tail[i - 1]!;
    if (diff > 0) gains += diff;
    else losses += -diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  if (avgG === 0) return 0;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function pctReturn(values: number[], lookback: number): number | null {
  if (values.length < lookback + 1) return null;
  const recent = values[values.length - 1]!;
  const past = values[values.length - 1 - lookback]!;
  if (past === 0) return null;
  return ((recent - past) / past) * 100;
}

function smaSeries(closes: number[], period: number): Array<number | null> {
  const result: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i]!;
  result[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    sum += closes[i]! - closes[i - period]!;
    result[i] = sum / period;
  }
  return result;
}

function findLastCross(points: PricePoint[]): CrossEvent | null {
  if (points.length < 201) return null;
  const closes = points.map((p) => p.close);
  const s50 = smaSeries(closes, 50);
  const s200 = smaSeries(closes, 200);

  for (let i = closes.length - 1; i > 199; i--) {
    const t50 = s50[i];
    const y50 = s50[i - 1];
    const t200 = s200[i];
    const y200 = s200[i - 1];
    if (t50 == null || y50 == null || t200 == null || y200 == null) continue;
    if (y50 <= y200 && t50 > t200) {
      return { kind: 'golden', daysAgo: closes.length - 1 - i, date: points[i]!.date };
    }
    if (y50 >= y200 && t50 < t200) {
      return { kind: 'death', daysAgo: closes.length - 1 - i, date: points[i]!.date };
    }
  }
  return null;
}
