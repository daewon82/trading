import type { PricePoint, Timeseries } from '../../types/timeseries.js';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

interface YahooQuote {
  close: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  volume?: Array<number | null>;
}

interface YahooMeta {
  currency: string;
  symbol: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: YahooMeta;
      timestamp?: number[];
      indicators: { quote: YahooQuote[] };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

export interface FetchOptions {
  daysBack?: number;
}

export async function fetchMacroQuote(
  symbol: string,
  displayName: string,
  unit: string,
): Promise<import('../../types/macro.js').MacroQuote | null> {
  const url =
    `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChartResponse;
    const meta = json.chart.result?.[0]?.meta;
    if (!meta) return null;
    const value = meta.regularMarketPrice ?? null;
    const prev = meta.chartPreviousClose ?? null;
    const changePercent =
      value != null && prev != null && prev !== 0
        ? ((value - prev) / prev) * 100
        : null;
    return {
      symbol,
      name: displayName,
      value,
      previousClose: prev,
      changePercent,
      unit,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function resolveCandidates(ticker: string, market: 'KR' | 'US'): string[] {
  if (market === 'US') return [ticker.toUpperCase()];
  // KR: KOSPI(.KS) → KOSDAQ(.KQ) 순서로 fallback
  return [`${ticker}.KS`, `${ticker}.KQ`];
}

export async function fetchDailyChart(
  ticker: string,
  candidates: string[],
  opts: FetchOptions = {},
): Promise<Timeseries | null> {
  const days = opts.daysBack ?? 365;
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - days * 86400;

  for (const symbol of candidates) {
    const result = await tryFetch(symbol, period1, period2);
    if (result && result.points.length > 0) {
      return {
        ticker,
        resolved: symbol,
        currency: result.currency,
        points: result.points,
      };
    }
  }
  return null;
}

async function tryFetch(
  symbol: string,
  period1: number,
  period2: number,
): Promise<{ currency: string; points: PricePoint[] } | null> {
  const url =
    `${YAHOO_BASE}/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart.result?.[0];
    if (!result) return null;
    const ts = result.timestamp ?? [];
    const quote = result.indicators.quote[0];
    if (!quote) return null;
    const closes = quote.close ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];
    const points: PricePoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = closes[i];
      if (close == null) continue;
      const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
      const point: PricePoint = { date, close };
      if (highs[i] != null) point.high = highs[i] as number;
      if (lows[i] != null) point.low = lows[i] as number;
      const v = quote.volume?.[i];
      if (v != null) point.volume = v;
      points.push(point);
    }
    return { currency: result.meta.currency, points };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
