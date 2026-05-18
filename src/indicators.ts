import type { Candle, Indicators } from './types.js';

export function trueRange(curr: Candle, prev: Candle): number {
  const hl = curr.high - curr.low;
  const hc = Math.abs(curr.high - prev.close);
  const lc = Math.abs(curr.low - prev.close);
  return Math.max(hl, hc, lc);
}

export function atr(candles: Candle[], period = 20): number {
  if (candles.length < period + 1) {
    throw new Error(`ATR needs at least ${period + 1} candles, got ${candles.length}`);
  }
  const slice = candles.slice(-(period + 1));
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    sum += trueRange(slice[i], slice[i - 1]);
  }
  return sum / period;
}

export function donchianHigh(candles: Candle[], period: number): number {
  const slice = candles.slice(-period - 1, -1);
  if (slice.length === 0) throw new Error(`donchianHigh: not enough candles for period ${period}`);
  return Math.max(...slice.map((c) => c.high));
}

export function donchianLow(candles: Candle[], period: number): number {
  const slice = candles.slice(-period - 1, -1);
  if (slice.length === 0) throw new Error(`donchianLow: not enough candles for period ${period}`);
  return Math.min(...slice.map((c) => c.low));
}

export function sma(candles: Candle[], period: number): number {
  if (candles.length < period) {
    throw new Error(`SMA needs ${period} candles, got ${candles.length}`);
  }
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

export function avgVolume(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const slice = candles.slice(-period);
  const sum = slice.reduce((acc, c) => acc + c.volume, 0);
  return sum / period;
}

export function computeIndicators(candles: Candle[]): Indicators {
  if (candles.length < 121) {
    throw new Error(`Need at least 121 candles, got ${candles.length}`);
  }
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const change = last.close - prev.close;
  return {
    atr20: atr(candles, 20),
    donchianHigh20: donchianHigh(candles, 20),
    donchianLow10: donchianLow(candles, 10),
    ma60: sma(candles, 60),
    ma120: sma(candles, 120),
    prevClose: prev.close,
    lastClose: last.close,
    lastDate: last.date,
    change,
    changePct: (change / prev.close) * 100,
    volume: last.volume,
    avgVolume20: avgVolume(candles, 20),
  };
}
