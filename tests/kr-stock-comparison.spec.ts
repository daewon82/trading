import { test } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { StockComparator } from '../src/analyzers/StockComparator.js';
import { HtmlReporter } from '../src/reporters/HtmlReporter.js';
import type { StockSnapshot } from '../src/types/stock.js';
import { logger } from '../src/utils/logger.js';

const DEFAULT_CODES = '005930,000660,051910,068270,035420';
const codes = (process.env.KR_STOCK_CODES ?? DEFAULT_CODES)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const snapshots: StockSnapshot[] = [];

test.describe.configure({ mode: 'serial' });

for (const code of codes) {
  test(`KR snapshot ${code}`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, code);
    const snap = await src.extractSnapshot(page, code);
    logger.info('KR snapshot captured', { code, name: snap.name, price: snap.price });
    snapshots.push(snap);
  });
}

test.afterAll(async () => {
  if (snapshots.length === 0) return;
  const report = new StockComparator().compare(snapshots);
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  await writeFile(
    `reports/kr-snapshots-${ts}.json`,
    JSON.stringify(snapshots, null, 2),
    'utf8',
  );
  await writeFile(
    `reports/kr-report-${ts}.json`,
    JSON.stringify(report, null, 2),
    'utf8',
  );
  await new HtmlReporter().write(report, `reports/kr-report-${ts}.html`);
  logger.info('KR report written', { count: snapshots.length });
});
