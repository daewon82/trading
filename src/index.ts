import { STOCKS, TOTAL_CAPITAL, RISK_PER_TRADE } from './config.js';
import { fetchOhlcv } from './fetch.js';
import { computeIndicators } from './indicators.js';
import { computeSignal } from './turtle.js';
import { checkProtocol } from './protocol.js';
import { computeHoldingState, loadHoldings } from './holdings.js';
import type { DashboardData, HoldingPosition, StockReport } from './types.js';

export async function buildDashboard(): Promise<DashboardData> {
  const holdings = await loadHoldings();
  const holdingByCode = new Map<string, HoldingPosition>(holdings.map((h) => [h.code, h]));

  const reports: StockReport[] = [];
  const errors: DashboardData['errors'] = [];
  const REQUEST_DELAY_MS = 800;

  for (const config of STOCKS) {
    try {
      const candles = await fetchOhlcv(config.code, 400);
      const indicators = computeIndicators(candles);
      const holding = holdingByCode.get(config.code) ?? null;
      const signal = computeSignal(indicators, holding);
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
      console.log(`[${config.name}] OK · ${signal.action}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ code: config.code, name: config.name, message });
      console.error(`[${config.name}] 실패: ${message}`);
    }
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  return {
    generatedAt: new Date().toISOString(),
    totalCapital: TOTAL_CAPITAL,
    riskPerTrade: RISK_PER_TRADE,
    reports,
    errors,
  };
}
