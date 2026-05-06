import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { NaverGlobalSource } from '../src/sources/naver-global/NaverGlobalSource.js';
import { YahooFinanceSource } from '../src/sources/yahoo/YahooFinanceSource.js';
import type { StockSource } from '../src/sources/StockSource.js';
import type { HealthCheckResult, SourceId } from '../src/types/stock.js';
import { logger } from '../src/utils/logger.js';

const SAMPLES: Record<SourceId, string> = {
  'naver-kr': '005930',
  'naver-global': 'AAPL',
  'yahoo': 'AAPL',
};

test.describe.configure({ mode: 'serial' });

test('all sources healthy', async ({ page }) => {
  const sources: StockSource[] = [
    new NaverKrSource(),
    new NaverGlobalSource(),
    new YahooFinanceSource(),
  ];

  const results: HealthCheckResult[] = [];
  for (const src of sources) {
    const sample = SAMPLES[src.id];
    logger.info('healthCheck start', { source: src.id, sample });
    const r = await src.healthCheck(page, sample);
    results.push(r);
    logger.info('healthCheck done', { source: src.id, ok: r.ok });
  }

  await mkdir('reports', { recursive: true });
  await writeFile(
    `reports/health-${stamp()}.json`,
    JSON.stringify(results, null, 2),
    'utf8',
  );

  for (const r of results) {
    expect.soft(r.ok, `source ${r.source} should be healthy`).toBe(true);
  }
});

function stamp(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}
