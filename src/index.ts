import {
  STOCKS,
  RISK_PCT,
  FALLBACK_TOTAL_CAPITAL,
  HAS_TOTAL_CAPITAL_OVERRIDE,
} from './config.js';
import { fetchOhlcv } from './fetch.js';
import { computeIndicators } from './indicators.js';
import { computeSignal } from './turtle.js';
import { checkProtocol } from './protocol.js';
import { computeHoldingState, loadHoldings } from './holdings.js';
import { nowInKst, isDailyCloseConfirmed } from './time.js';
import type { Candle, DashboardData, HoldingPosition, StockReport } from './types.js';

function trimPartialToday(candles: Candle[], kstToday: string, closeConfirmed: boolean): Candle[] {
  if (closeConfirmed || candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  if (last.date === kstToday) {
    return candles.slice(0, -1);
  }
  return candles;
}

function computeTotalCapital(holdings: HoldingPosition[]): number {
  if (HAS_TOTAL_CAPITAL_OVERRIDE) return FALLBACK_TOTAL_CAPITAL;
  const costBasis = holdings.reduce((s, h) => s + h.buyPrice * h.quantity, 0);
  return costBasis > 0 ? costBasis : FALLBACK_TOTAL_CAPITAL;
}

export async function buildDashboard(): Promise<DashboardData> {
  const holdings = await loadHoldings();
  const holdingByCode = new Map<string, HoldingPosition>(holdings.map((h) => [h.code, h]));

  const totalCapital = computeTotalCapital(holdings);
  const riskPerTrade = totalCapital * RISK_PCT;

  const kst = nowInKst();
  const closeConfirmed = isDailyCloseConfirmed();

  const reports: StockReport[] = [];
  const errors: DashboardData['errors'] = [];
  const REQUEST_DELAY_MS = 800;

  for (const config of STOCKS) {
    try {
      const raw = await fetchOhlcv(config.code, 400);
      const candles = trimPartialToday(raw, kst.date, closeConfirmed);
      const indicators = computeIndicators(candles);
      const holding = holdingByCode.get(config.code) ?? null;
      const signal = computeSignal(indicators, holding, riskPerTrade);
      const protocol = checkProtocol(candles, indicators);
      const holdingState = holding ? computeHoldingState(holding, indicators) : null;
      reports.push({
        config,
        indicators,
        signal,
        protocol,
        holding: holdingState,
        history: candles.slice(-60),
      });
      console.log(`[${config.name}] OK · ${signal.action} (기준 ${indicators.lastDate})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ code: config.code, name: config.name, message });
      console.error(`[${config.name}] 실패: ${message}`);
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  return {
    generatedAt: new Date().toISOString(),
    totalCapital,
    riskPerTrade,
    asOfDate: reports[0]?.indicators.lastDate ?? null,
    isLive: closeConfirmed,
    reports,
    errors,
  };
}
