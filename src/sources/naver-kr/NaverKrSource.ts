import type { Page } from '@playwright/test';
import type {
  StockSnapshot,
  HealthCheckResult,
  CheckResult,
} from '../../types/stock.js';
import type { AnalystConsensus } from '../../types/consensus.js';
import type { StockSource } from '../StockSource.js';
import { logger, parseKoreanNumber } from '../../utils/logger.js';

interface AsideStats {
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export class NaverKrSource implements StockSource {
  readonly id = 'naver-kr' as const;
  readonly market = 'KR' as const;

  private readonly sel = {
    name: '.wrap_company h2 a',
    price: 'p.no_today .blind',
    changePercent: 'p.no_exday em:nth-of-type(2) .blind',
    statBox: '.aside_invest_info',
  };

  async open(page: Page, code: string): Promise<void> {
    const url = `https://finance.naver.com/item/main.naver?code=${code}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector(this.sel.name, { timeout: 15_000 });
  }

  async extractSnapshot(page: Page, code: string): Promise<StockSnapshot> {
    const name =
      (await page.locator(this.sel.name).first().textContent({ timeout: 10_000 }))?.trim() ?? '';
    const priceText = await page
      .locator(this.sel.price)
      .first()
      .textContent({ timeout: 10_000 })
      .catch(() => null);
    const changeText = await page
      .locator(this.sel.changePercent)
      .first()
      .textContent({ timeout: 10_000 })
      .catch(() => null);

    const stats = await this.readAsideStats(page);

    return {
      code,
      name,
      market: 'KR',
      currency: 'KRW',
      source: this.id,
      capturedAt: new Date().toISOString(),
      price: parseKoreanNumber(priceText),
      changePercent: parseKoreanNumber(changeText),
      marketCap: stats.marketCap,
      per: stats.per,
      pbr: stats.pbr,
      eps: stats.eps,
      bps: stats.bps,
      roe: stats.roe,
      dividendYield: stats.dividendYield,
      fiftyTwoWeekHigh: stats.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stats.fiftyTwoWeekLow,
    };
  }

  private async readAsideStats(page: Page): Promise<AsideStats> {
    const aside = page.locator(this.sel.statBox).first();
    const html = await aside.innerHTML({ timeout: 8_000 }).catch(() => '');
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');

    const findByLabel = (label: string): string | null => {
      const re = new RegExp(`${label}\\s*([\\-\\d,.]+(?:\\s?(?:조|억|만))?)`);
      const m = text.match(re);
      return m ? m[1] : null;
    };

    // 52주최고/최저: "52주최고l최저 232,500 l 53,700" 형식
    const fiftyTwo = text.match(/52주\s*최고\s*l?\s*최저\s*([0-9,]+)\s*l?\s*([0-9,]+)/);

    return {
      marketCap: parseKoreanNumber(findByLabel('시가총액')),
      per: parseKoreanNumber(findByLabel('PER')),
      pbr: parseKoreanNumber(findByLabel('PBR')),
      eps: parseKoreanNumber(findByLabel('EPS')),
      bps: parseKoreanNumber(findByLabel('BPS')),
      roe: parseKoreanNumber(findByLabel('ROE')),
      dividendYield: parseKoreanNumber(findByLabel('배당수익률')),
      fiftyTwoWeekHigh: fiftyTwo ? parseKoreanNumber(fiftyTwo[1]) : null,
      fiftyTwoWeekLow: fiftyTwo ? parseKoreanNumber(fiftyTwo[2]) : null,
    };
  }

  /**
   * 네이버 페이지의 투자의견 영역에서 컨센서스 추출.
   * 마크업 예: "투자의견l목표주가 4.00매수 l 298,750"
   * 네이버 점수: 1=매도 ~ 5=강력매수 → Yahoo 표준 (1=매수~5=매도)으로 변환 (6-x)
   */
  async extractConsensus(page: Page, code: string): Promise<AnalystConsensus | null> {
    try {
      const aside = page.locator(this.sel.statBox).first();
      const html = await aside.innerHTML({ timeout: 5_000 }).catch(() => '');
      const text = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ');
      // 패턴 매칭 — 투자의견 + 점수 + 한글 라벨 + 목표가
      const m = text.match(
        /투자의견\s*l?\s*목표주가\s*([1-5](?:\.\d+)?)\s*([가-힣]+)\s*l?\s*([\d,]+)/,
      );
      if (!m) return null;
      const rawScore = Number(m[1]);
      if (!Number.isFinite(rawScore) || rawScore < 1 || rawScore > 5) return null;
      const koreanLabel = m[2] ?? '';
      const target = parseKoreanNumber(m[3] ?? null);
      // KR(5=매수) → Yahoo(1=매수) 스케일 변환
      const yahooMean = 6 - rawScore;
      return {
        ticker: code,
        recommendationKey: koreanLabel,
        recommendationMean: yahooMean,
        targetMeanPrice: target,
        targetHighPrice: null,
        targetLowPrice: null,
        numberOfAnalystOpinions: null,
        trend: null,
      };
    } catch (err) {
      logger.warn('NaverKr consensus extract failed', { code, err: String(err) });
      return null;
    }
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
      if (snap.per == null) missing.push('per');
      checks.push({
        source: this.id,
        code: sample,
        name: snap.name,
        ok: missing.length === 0,
        missing,
        errors: [],
      });
    } catch (err) {
      logger.error('NaverKrSource healthCheck failed', { code: sample, err: String(err) });
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
