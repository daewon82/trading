import { test } from '@playwright/test';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { NaverGlobalSource } from '../src/sources/naver-global/NaverGlobalSource.js';
import { DashboardBuilder } from '../src/analyzers/DashboardBuilder.js';
import {
  DashboardReporter,
  type DashboardPage,
} from '../src/reporters/DashboardReporter.js';
import { JandiNotifier } from '../src/notifications/JandiNotifier.js';
import {
  fetchWeeklyForecast,
  SEOUL,
  GOYANG,
} from '../src/sources/weather/openMeteo.js';
import type { StockSnapshot } from '../src/types/stock.js';
import type { WeatherForecast } from '../src/types/weather.js';
import { logger } from '../src/utils/logger.js';

const DEFAULT_KR = '005930,000660'; // 삼성전자, SK하이닉스
const DEFAULT_US = 'AAPL,MSFT,GOOGL,AMZN,NVDA,TSLA';
const krCodes = (process.env.KR_DASHBOARD_CODES ?? DEFAULT_KR)
  .split(',').map((s) => s.trim()).filter(Boolean);
const usTickers = (process.env.US_DASHBOARD_TICKERS ?? DEFAULT_US)
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

const krSnaps: StockSnapshot[] = [];
const usSnaps: StockSnapshot[] = [];
let weatherForecasts: WeatherForecast[] = [];

test.describe.configure({ mode: 'serial' });

test('주간 날씨 (서울/고양시)', async () => {
  weatherForecasts = await Promise.all([
    fetchWeeklyForecast(SEOUL),
    fetchWeeklyForecast(GOYANG),
  ]);
  logger.info('weather fetched', {
    cities: weatherForecasts.map((f) => f.city),
    days: weatherForecasts[0]?.days.length ?? 0,
  });
});

for (const code of krCodes) {
  test(`KR ${code}`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, code);
    const snap = await src.extractSnapshot(page, code);
    krSnaps.push(snap);
    logger.info('KR snapshot', {
      code,
      name: snap.name,
      price: snap.price,
      pos52w: pos(snap),
    });
  });
}

for (const ticker of usTickers) {
  test(`US ${ticker}`, async ({ page }) => {
    const src = new NaverGlobalSource();
    await src.open(page, ticker);
    const snap = await src.extractSnapshot(page, ticker);
    usSnaps.push(snap);
    logger.info('US snapshot', {
      ticker,
      price: snap.price,
      marketCap: snap.marketCap,
      pos52w: pos(snap),
    });
  });
}

test.afterAll(async () => {
  if (krSnaps.length === 0 && usSnaps.length === 0) return;
  const builder = new DashboardBuilder();
  const dashboard: DashboardPage = {
    generatedAt: new Date().toISOString(),
    today: todayInSeoul(),
    weather: weatherForecasts,
    kr: builder.build(krSnaps),
    us: builder.build(usSnaps),
  };
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  const jsonPath = resolve(`reports/dashboard-${ts}.json`);
  const htmlPath = resolve(`reports/dashboard-${ts}.html`);
  await writeFile(jsonPath, JSON.stringify(dashboard, null, 2), 'utf8');
  await new DashboardReporter().write(dashboard, htmlPath);

  // GitHub Pages 용 docs/ 갱신 — main 브랜치의 docs/ 폴더가 Pages source
  await mkdir('docs/history', { recursive: true });
  const docsIndex = resolve('docs/index.html');
  const docsHistory = resolve(`docs/history/dashboard-${ts}.html`);
  await copyFile(htmlPath, docsIndex);
  await copyFile(htmlPath, docsHistory);

  logger.info('dashboard written', {
    krCount: krSnaps.length,
    usCount: usSnaps.length,
    htmlPath,
    docsIndex,
  });

  const webhook = process.env.JANDI_WEBHOOK_URL;
  if (webhook) {
    const publicUrl = process.env.DASHBOARD_PUBLIC_URL ?? null;
    try {
      await new JandiNotifier().send(dashboard, {
        webhookUrl: webhook,
        htmlAbsolutePath: htmlPath,
        publicUrl,
      });
      logger.info('jandi notification sent');
    } catch (err) {
      logger.error('jandi notification failed', { err: String(err) });
    }
  } else {
    logger.info('jandi skipped — JANDI_WEBHOOK_URL not set');
  }
});

function todayInSeoul(): string {
  const fmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} (${get('weekday')})`;
}

function pos(s: StockSnapshot): number | null {
  if (s.price == null || s.fiftyTwoWeekLow == null || s.fiftyTwoWeekHigh == null) return null;
  if (s.fiftyTwoWeekHigh === s.fiftyTwoWeekLow) return null;
  return ((s.price - s.fiftyTwoWeekLow) / (s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow)) * 100;
}
