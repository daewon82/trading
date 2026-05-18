import type { HoldingPosition, Indicators, TurtleSignal } from './types.js';

const STOP_ATR_MULT = 2;
const PYRAMID_ATR_FRACTION = 0.5;

export function computeUnitSize(atr20: number, riskPerTrade: number): number {
  if (atr20 <= 0) return 0;
  const stopDistance = STOP_ATR_MULT * atr20;
  return Math.max(0, Math.floor(riskPerTrade / stopDistance));
}

export function computeSignal(
  indicators: Indicators,
  holding: HoldingPosition | null,
  riskPerTrade: number,
): TurtleSignal {
  const { atr20, donchianHigh20, donchianLow10, lastClose } = indicators;
  const unitSize = computeUnitSize(atr20, riskPerTrade);
  const unitCost = unitSize * lastClose;

  const distanceToEntryPct = ((donchianHigh20 - lastClose) / lastClose) * 100;
  const distanceToExitPct = ((lastClose - donchianLow10) / lastClose) * 100;

  if (holding) {
    const stopPrice = holding.buyPrice - STOP_ATR_MULT * atr20;
    const nextPyramidPrice = holding.buyPrice + PYRAMID_ATR_FRACTION * atr20;
    const distanceToStopPct = ((lastClose - stopPrice) / lastClose) * 100;

    if (lastClose <= stopPrice) {
      return {
        action: 'STOP_LOSS',
        reason: `현재가 ${fmt(lastClose)} ≤ 손절선 ${fmt(stopPrice)} (-2 ATR). 기계적 전량 청산.`,
        unitSize,
        unitCost,
        stopPrice,
        nextPyramidPrice,
        distanceToEntryPct,
        distanceToStopPct,
        distanceToExitPct,
      };
    }
    if (lastClose <= donchianLow10) {
      return {
        action: 'EXIT_10D_LOW',
        reason: `10일 저점 ${fmt(donchianLow10)} 이탈. 전량 익절/청산.`,
        unitSize,
        unitCost,
        stopPrice,
        nextPyramidPrice,
        distanceToEntryPct,
        distanceToStopPct,
        distanceToExitPct,
      };
    }
    if (lastClose >= nextPyramidPrice) {
      return {
        action: 'PYRAMID',
        reason: `진입가 +0.5 ATR 도달 (${fmt(nextPyramidPrice)}). 1유닛 추가 매수 (최대 ${4}유닛).`,
        unitSize,
        unitCost,
        stopPrice,
        nextPyramidPrice,
        distanceToEntryPct,
        distanceToStopPct,
        distanceToExitPct,
      };
    }
    return {
      action: 'HOLD',
      reason: `손절선 ${fmt(stopPrice)} / 10일 저점 ${fmt(donchianLow10)} / 다음 피라미딩 ${fmt(nextPyramidPrice)}.`,
      unitSize,
      unitCost,
      stopPrice,
      nextPyramidPrice,
      distanceToEntryPct,
      distanceToStopPct,
      distanceToExitPct,
    };
  }

  if (lastClose >= donchianHigh20) {
    return {
      action: 'ENTRY_BREAKOUT',
      reason: `20일 신고가 ${fmt(donchianHigh20)} 돌파. 1유닛(${unitSize}주, 약 ${fmt(unitCost)}) 매수.`,
      unitSize,
      unitCost,
      stopPrice: null,
      nextPyramidPrice: null,
      distanceToEntryPct,
      distanceToStopPct: null,
      distanceToExitPct,
    };
  }

  return {
    action: 'WAIT',
    reason: `20일 고점 ${fmt(donchianHigh20)} 까지 ${distanceToEntryPct.toFixed(2)}% 남음. 돌파 대기.`,
    unitSize,
    unitCost,
    stopPrice: null,
    nextPyramidPrice: null,
    distanceToEntryPct,
    distanceToStopPct: null,
    distanceToExitPct,
  };
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
}
