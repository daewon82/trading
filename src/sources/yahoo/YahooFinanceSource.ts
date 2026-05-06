import type { Page } from '@playwright/test';
import type {
  StockSnapshot,
  HealthCheckResult,
  CheckResult,
} from '../../types/stock.js';
import type { StockSource } from '../StockSource.js';
import { logger, parseUsNumber } from '../../utils/logger.js';

interface YahooStats {
  marketCap: number | null;
  per: number | null;
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export class YahooFinanceSource implements StockSource {
  readonly id = 'yahoo' as const;
  readonly market = 'US' as const;

  private readonly sel = {
    consentReject: 'button[name="reject"], button[value="reject"]',
    name: 'h1',
    statsTable: '[data-testid="quote-statistics"]',
  };

  private priceSelector(ticker: string): string {
    return `fin-streamer[data-symbol="${ticker}"][data-field="regularMarketPrice"]`;
  }

  private changeSelector(ticker: string): string {
    return `fin-streamer[data-symbol="${ticker}"][data-field="regularMarketChangePercent"]`;
  }

  async open(page: Page, code: string): Promise<void> {
    const ticker = code.toUpperCase();
    const url = `https://finance.yahoo.com/quote/${ticker}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const reject = page.locator(this.sel.consentReject).first();
    const dialogVisible = await reject
      .waitFor({ state: 'visible', timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (dialogVisible) {
      await reject.click({ timeout: 5_000 }).catch(() => {});
    }

    await page.waitForSelector(this.priceSelector(ticker), { timeout: 15_000 });
  }

  async extractSnapshot(page: Page, code: string): Promise<StockSnapshot> {
    const ticker = code.toUpperCase();
    const rawName =
      (await page.locator(this.sel.name).first().textContent({ timeout: 10_000 }))?.trim() ?? '';
    const name = rawName && rawName !== 'Yahoo Finance' ? rawName : ticker;

    const priceLocator = page.locator(this.priceSelector(ticker)).first();
    const priceText =
      (await priceLocator.getAttribute('data-value', { timeout: 10_000 }).catch(() => null)) ??
      (await priceLocator.getAttribute('value', { timeout: 10_000 }).catch(() => null)) ??
      (await priceLocator.textContent({ timeout: 10_000 }).catch(() => null));

    const changeLocator = page.locator(this.changeSelector(ticker)).first();
    const changeText =
      (await changeLocator.getAttribute('data-value', { timeout: 5_000 }).catch(() => null)) ??
      (await changeLocator.getAttribute('value', { timeout: 5_000 }).catch(() => null)) ??
      (await changeLocator.textContent({ timeout: 5_000 }).catch(() => null));

    const stats = await this.readStats(page);

    return {
      code: ticker,
      name,
      market: 'US',
      currency: 'USD',
      source: this.id,
      capturedAt: new Date().toISOString(),
      price: parseUsNumber(priceText),
      changePercent: parseUsNumber(changeText),
      marketCap: stats.marketCap,
      per: stats.per,
      pbr: null,
      eps: stats.eps,
      bps: null,
      roe: null,
      dividendYield: stats.dividendYield,
      fiftyTwoWeekHigh: stats.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stats.fiftyTwoWeekLow,
    };
  }

  private async readStats(page: Page): Promise<YahooStats> {
    const stats = page.locator(this.sel.statsTable).first();
    const text = (await stats.textContent({ timeout: 8_000 }).catch(() => '')) ?? '';

    const find = (re: RegExp): string | null => text.match(re)?.[1] ?? null;
    const rangeMatch = text.match(/52\s*Week\s*Range[^\d.-]*([\d.,]+)\s*-\s*([\d.,]+)/i);

    return {
      marketCap: parseUsNumber(find(/Market\s*Cap[^\d]*([\d.,]+\s*[TBMK]?)/i)),
      per: parseUsNumber(find(/PE\s*Ratio[^\d-]*([\d.,-]+)/i)),
      eps: parseUsNumber(find(/\bEPS\b[^\d-]*([\d.,-]+)/i)),
      dividendYield: parseUsNumber(find(/Yield[^%]*?\(([\d.,]+)\s*%\)/i)),
      fiftyTwoWeekHigh: rangeMatch ? parseUsNumber(rangeMatch[2]) : null,
      fiftyTwoWeekLow: rangeMatch ? parseUsNumber(rangeMatch[1]) : null,
    };
  }

  async healthCheck(page: Page, sample: string): Promise<HealthCheckResult> {
    const checks: CheckResult[] = [];
    try {
      await this.open(page, sample);
      const snap = await this.extractSnapshot(page, sample);
      const missing: string[] = [];
      if (!snap.name) missing.push('name');
      if (snap.price == null) missing.push('price');
      if (snap.marketCap == null) missing.push('marketCap');
      checks.push({
        source: this.id,
        code: sample,
        name: snap.name,
        ok: missing.length === 0,
        missing,
        errors: [],
      });
    } catch (err) {
      logger.error('YahooFinanceSource healthCheck failed', { code: sample, err: String(err) });
      checks.push({
        source: this.id,
        code: sample,
        name: '',
        ok: false,
        missing: [],
        errors: [String(err)],
      });
    }
    return { source: this.id, ok: checks.every((c) => c.ok), checks };
  }
}
