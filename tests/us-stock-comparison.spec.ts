import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { NaverGlobalSource } from '../src/sources/naver-global/NaverGlobalSource.js';
import { YahooFinanceSource } from '../src/sources/yahoo/YahooFinanceSource.js';
import { StockComparator } from '../src/analyzers/StockComparator.js';
import { CrossSourceVerifier } from '../src/analyzers/CrossSourceVerifier.js';
import { HtmlReporter } from '../src/reporters/HtmlReporter.js';
import type { StockSnapshot, CrossVerifyResult } from '../src/types/stock.js';
import { logger } from '../src/utils/logger.js';

const DEFAULT_TICKERS = 'AAPL,MSFT,GOOGL,AMZN,NVDA';
const tickers = (process.env.US_STOCK_TICKERS ?? DEFAULT_TICKERS)
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const fullCross = process.env.CROSS_VERIFY === '1';

const primarySnapshots: StockSnapshot[] = [];
const crossResults: CrossVerifyResult[] = [];

test.describe.configure({ mode: 'serial' });

for (const ticker of tickers) {
  test(`US snapshot ${ticker}`, async ({ page }) => {
    const naver = new NaverGlobalSource();
    await naver.open(page, ticker);
    const primary = await naver.extractSnapshot(page, ticker);
    primarySnapshots.push(primary);
    logger.info('US primary snapshot captured', {
      ticker,
      price: primary.price,
      marketCap: primary.marketCap,
    });

    const shouldCross = fullCross || ticker === 'AAPL';
    if (!shouldCross) return;

    const yahoo = new YahooFinanceSource();
    await yahoo.open(page, ticker);
    const secondary = await yahoo.extractSnapshot(page, ticker);
    const result = new CrossSourceVerifier().verify(primary, secondary);
    crossResults.push(result);
    logger.info('US cross-verify done', {
      ticker,
      ok: result.ok,
      deltas: result.deltas.map((d) => ({ field: d.field, diff: d.diffPercent })),
    });
    expect.soft(result.ok, `${ticker}: cross-source within tolerance`).toBe(true);
  });
}

test.afterAll(async () => {
  if (primarySnapshots.length === 0) return;
  const report = new StockComparator().compare(primarySnapshots);
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  await writeFile(
    `reports/us-snapshots-${ts}.json`,
    JSON.stringify(primarySnapshots, null, 2),
    'utf8',
  );
  await writeFile(
    `reports/us-report-${ts}.json`,
    JSON.stringify(report, null, 2),
    'utf8',
  );
  if (crossResults.length > 0) {
    await writeFile(
      `reports/us-cross-${ts}.json`,
      JSON.stringify(crossResults, null, 2),
      'utf8',
    );
  }
  await new HtmlReporter().write(report, `reports/us-report-${ts}.html`);
  logger.info('US report written', {
    count: primarySnapshots.length,
    crossChecked: crossResults.length,
  });
});
