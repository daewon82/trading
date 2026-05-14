import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { NaverGlobalSource } from '../src/sources/naver-global/NaverGlobalSource.js';
import { YahooFinanceSource } from '../src/sources/yahoo/YahooFinanceSource.js';
import { TossKrFlowSource } from '../src/sources/toss-kr/TossKrFlowSource.js';
import { NaverWiseReportSource } from '../src/sources/naver-kr/NaverWiseReportSource.js';
import { KrFearGreedSource } from '../src/sources/macro/KrFearGreedSource.js';
import type { StockSource } from '../src/sources/StockSource.js';
import type { HealthCheckResult, SourceId } from '../src/types/stock.js';
import { logger } from '../src/utils/logger.js';

const SAMPLES: Record<SourceId, string> = {
  'naver-kr': '005930',
  'naver-global': 'AAPL',
  'yahoo': 'AAPL',
};

interface AuxHealthResult {
  source: string;
  ok: boolean;
  missing: string[];
  errors: string[];
}

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

/**
 * v1.5 — 신규 어댑터 healthcheck (StockSource 인터페이스가 아닌 보조 소스들).
 * TossKr 수급, Wisereport 재무, FearGreed 시장 regime, NaverKr.extractValuation.
 */
test('auxiliary sources healthy (v1.3~v1.5)', async ({ page }) => {
  const aux: AuxHealthResult[] = [];

  // 1) TossKrFlowSource — 외인·기관 거래대금 (v1.3 핵심 데이터)
  try {
    const flow = await new TossKrFlowSource().fetch('005930', 30);
    const missing: string[] = [];
    if (!flow) missing.push('result null');
    else {
      if (flow.daily.length < 20) missing.push('daily<20');
      if (flow.net20dForeigner == null) missing.push('net20dForeigner');
      if (flow.net5dForeignerValue == null) missing.push('net5dForeignerValue (v1.3)');
    }
    aux.push({ source: 'toss-kr-flow', ok: missing.length === 0, missing, errors: [] });
  } catch (err) {
    aux.push({ source: 'toss-kr-flow', ok: false, missing: [], errors: [String(err)] });
  }

  // 2) NaverWiseReportSource — 재무 (매출/영업이익/순부채/ROE)
  try {
    const fin = await new NaverWiseReportSource().fetch('005930');
    const missing: string[] = [];
    if (!fin) missing.push('result null');
    else if (!fin.latestActual) missing.push('latestActual');
    aux.push({ source: 'naver-wisereport', ok: missing.length === 0, missing, errors: [] });
  } catch (err) {
    aux.push({ source: 'naver-wisereport', ok: false, missing: [], errors: [String(err)] });
  }

  // 3) KrFearGreedSource — 코스피 공포·탐욕 지수 (v1.4)
  try {
    const fg = await new KrFearGreedSource().fetch();
    const missing: string[] = [];
    if (!fg) missing.push('result null');
    else {
      if (fg.value < 0 || fg.value > 100) missing.push('value out of range');
      if (!fg.zone) missing.push('zone');
    }
    aux.push({ source: 'kr-fear-greed', ok: missing.length === 0, missing, errors: [] });
  } catch (err) {
    aux.push({ source: 'kr-fear-greed', ok: false, missing: [], errors: [String(err)] });
  }

  // 4) NaverKr.extractValuation — v1.1 가치주 스크리닝 진입점
  try {
    const src = new NaverKrSource();
    await src.open(page, '005930');
    const v = await src.extractValuation(page, '005930', '반도체');
    const missing: string[] = [];
    if (!v.name) missing.push('name');
    if (v.pbr == null) missing.push('pbr');
    if (v.per == null) missing.push('per');
    if (v.marketCap == null) missing.push('marketCap');
    aux.push({ source: 'naver-kr.extractValuation', ok: missing.length === 0, missing, errors: [] });
  } catch (err) {
    aux.push({ source: 'naver-kr.extractValuation', ok: false, missing: [], errors: [String(err)] });
  }

  for (const r of aux) {
    logger.info('aux healthCheck', { ...r });
  }
  await mkdir('reports', { recursive: true });
  await writeFile(
    `reports/health-aux-${stamp()}.json`,
    JSON.stringify(aux, null, 2),
    'utf8',
  );

  for (const r of aux) {
    expect.soft(r.ok, `aux source ${r.source} should be healthy`).toBe(true);
  }
});

function stamp(): string {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}
