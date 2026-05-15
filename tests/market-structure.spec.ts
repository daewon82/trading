import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NaverMarketSource } from '../src/sources/naver-kr/NaverMarketSource.js';
import { MarketStructureAnalyzer } from '../src/analyzers/MarketStructureAnalyzer.js';
import { logger } from '../src/utils/logger.js';

/**
 * v1.8 — 시장 구조(ADR) 단독 spec.
 *
 * 명령: `npm run test:market`
 * 출력: reports/market-structure-{ts}.json + KOSPI/KOSDAQ ADR + 분류
 */

test('시장 구조 — KOSPI + KOSDAQ ADR 동시 분석', async () => {
  test.setTimeout(30_000);
  const src = new NaverMarketSource();
  const analyzer = new MarketStructureAnalyzer();

  const [kospiCounts, kosdaqCounts] = await Promise.all([
    src.fetch('KOSPI'),
    src.fetch('KOSDAQ'),
  ]);
  expect(kospiCounts).not.toBeNull();
  expect(kosdaqCounts).not.toBeNull();

  const kospi = analyzer.analyze(kospiCounts!);
  const kosdaq = analyzer.analyze(kosdaqCounts!);

  logger.info('KOSPI market structure', {
    advancing: kospi.counts.advancing, declining: kospi.counts.declining,
    adrPct: kospi.adrPct.toFixed(2) + '%',
    breadth: kospi.breadth, label: kospi.label,
    insight: kospi.insight,
    lossProb: (kospi.expectedHoldingLossProbability * 100).toFixed(0) + '%',
  });
  logger.info('KOSDAQ market structure', {
    advancing: kosdaq.counts.advancing, declining: kosdaq.counts.declining,
    adrPct: kosdaq.adrPct.toFixed(2) + '%',
    breadth: kosdaq.breadth, label: kosdaq.label,
  });

  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  await writeFile(
    resolve(`reports/market-structure-${ts}.json`),
    JSON.stringify({ generatedAt: new Date().toISOString(), kospi, kosdaq }, null, 2),
    'utf8',
  );
});
