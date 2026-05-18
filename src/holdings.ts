import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { HoldingPosition, HoldingState, Indicators } from './types.js';

const STOP_ATR_MULT = 2;
const PYRAMID_ATR_FRACTION = 0.5;

export async function loadHoldings(path = 'holdings.json'): Promise<HoldingPosition[]> {
  const envJson = process.env.HOLDINGS_JSON;
  if (envJson) {
    try {
      return JSON.parse(envJson) as HoldingPosition[];
    } catch (err) {
      console.error('[holdings] HOLDINGS_JSON 파싱 실패, 파일로 폴백:', err);
    }
  }
  try {
    const raw = await readFile(resolve(process.cwd(), path), 'utf8');
    return JSON.parse(raw) as HoldingPosition[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export function computeHoldingState(
  position: HoldingPosition,
  indicators: Indicators,
): HoldingState {
  const { atr20, lastClose, donchianLow10 } = indicators;
  const currentValue = position.quantity * lastClose;
  const costBasis = position.quantity * position.buyPrice;
  const pnl = currentValue - costBasis;
  const pnlPct = (pnl / costBasis) * 100;
  const stopPrice = position.buyPrice - STOP_ATR_MULT * atr20;
  const nextPyramidPrice = position.buyPrice + PYRAMID_ATR_FRACTION * atr20;
  return {
    position,
    currentValue,
    costBasis,
    pnl,
    pnlPct,
    stopPrice,
    stoppedOut: lastClose <= stopPrice,
    nextPyramidPrice,
    pyramidReady: lastClose >= nextPyramidPrice,
    exitTrigger10dLow: lastClose <= donchianLow10,
  };
}
