import type { Page } from '@playwright/test';
import type {
  StockSnapshot,
  HealthCheckResult,
  CheckResult,
} from '../../types/stock.js';
import type { StockSource } from '../StockSource.js';
import { logger, parseKoreanNumber, parseUsNumber } from '../../utils/logger.js';

interface GlobalStats {
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export class NaverGlobalSource implements StockSource {
  readonly id = 'naver-global' as const;
  readonly market = 'US' as const;

  /** NYSE 종목은 .K 접미사. 그 외는 .O (NASDAQ). 새 종목은 여기에 추가. */
  private readonly nyseTickers: ReadonlySet<string> = new Set([
    'JPM', 'WMT', 'KO', 'PG', 'PFE', 'V', 'MA', 'JNJ', 'XOM', 'CVX',
    'BAC', 'WFC', 'DIS', 'NKE', 'MCD', 'IBM', 'GE', 'F', 'GM', 'BA',
    'T', 'VZ', 'HD', 'LOW', 'TGT', 'UNH', 'CAT', 'MMM', 'GS', 'MS',
  ]);

  private readonly sel = {
    name: '[class*="GraphMain_name"]',
    price: '[class*="GraphMain_price"]',
    changePercent: '[class*="VGap_stockGap__"] [class*="VGap_gap__"]:has(.per)',
    statItem: '[class*="StockInfo_item__"]',
    statKey: '[class*="StockInfo_key__"]',
    statValue: '[class*="StockInfo_value__"]',
  };

  private resolveSuffix(ticker: string): 'O' | 'K' {
    return this.nyseTickers.has(ticker.toUpperCase()) ? 'K' : 'O';
  }

  private buildUrl(ticker: string): string {
    const upper = ticker.toUpperCase();
    return `https://m.stock.naver.com/worldstock/stock/${upper}.${this.resolveSuffix(upper)}/total`;
  }

  async open(page: Page, code: string): Promise<void> {
    await page.goto(this.buildUrl(code), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector(this.sel.price, { timeout: 15_000 });
  }

  async extractSnapshot(page: Page, code: string): Promise<StockSnapshot> {
    const ticker = code.toUpperCase();
    const name =
      (await page.locator(this.sel.name).first().textContent({ timeout: 10_000 }))?.trim() ?? ticker;
    const priceText = await page
      .locator(this.sel.price)
      .first()
      .textContent({ timeout: 10_000 })
      .catch(() => null);
    const changeText = await page
      .locator(this.sel.changePercent)
      .first()
      .textContent({ timeout: 5_000 })
      .catch(() => null);

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
      pbr: stats.pbr,
      eps: stats.eps,
      bps: stats.bps,
      roe: null,
      dividendYield: stats.dividendYield,
      fiftyTwoWeekHigh: stats.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stats.fiftyTwoWeekLow,
    };
  }

  private async readStats(page: Page): Promise<GlobalStats> {
    const items = await page
      .locator(this.sel.statItem)
      .evaluateAll((els, sel) => {
        return els.map((el) => ({
          key: (el.querySelector(sel.key)?.textContent ?? '').trim(),
          value: (el.querySelector(sel.value)?.textContent ?? '').trim(),
        }));
      }, { key: this.sel.statKey, value: this.sel.statValue });

    const find = (predicate: (key: string) => boolean): string | null =>
      items.find((it) => predicate(it.key))?.value ?? null;

    // 시총 셀에는 USD/KRW 두 표기가 함께 있음 ("4조 1,145억 USD6,042조 1,666억원").
    // USD 직전까지만 잘라 USD 시총으로 사용.
    const marketCapRaw = find((k) => k.startsWith('시총'));
    const usdPart = marketCapRaw?.match(/^(.+?)USD/)?.[1] ?? marketCapRaw;

    return {
      marketCap: parseKoreanNumber(usdPart),
      per: parseUsNumber(find((k) => k.startsWith('PER'))),
      pbr: parseUsNumber(find((k) => k.startsWith('PBR'))),
      eps: parseUsNumber(find((k) => k.startsWith('EPS'))),
      bps: parseUsNumber(find((k) => k.startsWith('BPS'))),
      dividendYield: parseUsNumber(find((k) => k.startsWith('배당수익률'))),
      fiftyTwoWeekHigh: parseUsNumber(find((k) => k.startsWith('52주 최고'))),
      fiftyTwoWeekLow: parseUsNumber(find((k) => k.startsWith('52주 최저'))),
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
      logger.error('NaverGlobalSource healthCheck failed', { code: sample, err: String(err) });
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
