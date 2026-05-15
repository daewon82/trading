import type { AdvanceDeclineCounts } from '../../types/market-structure.js';
import { logger } from '../../utils/logger.js';

const BASE = 'https://finance.naver.com/sise/sise_index.naver';

/**
 * v1.8 — 네이버 금융 시장지수 페이지에서 등락 종목 수 파싱.
 *
 * URL: finance.naver.com/sise/sise_index.naver?code=KOSPI (또는 KOSDAQ)
 * 인증 불필요 · EUC-KR 디코딩 필요.
 *
 * HTML 구조 (2026-05 확인):
 *   <span class="blind">상승종목수</span><a href="..."><span>141</span></a>
 *   <span class="blind">하락종목수</span><a href="..."><span>743</span></a>
 */
export class NaverMarketSource {
  readonly id = 'naver-market' as const;

  async fetch(market: 'KOSPI' | 'KOSDAQ' = 'KOSPI'): Promise<AdvanceDeclineCounts | null> {
    const url = `${BASE}?code=${market}`;
    try {
      const res = await globalThis.fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      });
      if (!res.ok) {
        logger.warn('NaverMarketSource non-200', { market, status: res.status });
        return null;
      }
      const buf = await res.arrayBuffer();
      const html = new TextDecoder('euc-kr').decode(buf);
      return this.parse(market, html);
    } catch (err) {
      logger.error('NaverMarketSource.fetch failed', { market, err: String(err) });
      return null;
    }
  }

  private parse(market: 'KOSPI' | 'KOSDAQ', html: string): AdvanceDeclineCounts | null {
    const labels: Array<['upper' | 'advancing' | 'unchanged' | 'declining' | 'lower', string]> = [
      ['upper', '상한종목수'],
      ['advancing', '상승종목수'],
      ['unchanged', '보합종목수'],
      ['declining', '하락종목수'],
      ['lower', '하한종목수'],
    ];
    const result = {
      market,
      upper: 0, advancing: 0, unchanged: 0, declining: 0, lower: 0,
      capturedAt: new Date().toISOString(),
    };
    for (const [key, label] of labels) {
      const re = new RegExp(`${label}[\\s\\S]{0,80}?<a[^>]*><span>([\\d,]+)</span>`, 'i');
      const m = html.match(re);
      if (m) result[key] = parseInt(m[1]!.replace(/,/g, ''), 10);
    }
    // 검증 — 상승+하락+보합 합계가 비정상이면 fail
    if (result.advancing === 0 && result.declining === 0) {
      logger.warn('NaverMarketSource: empty counts — selector may be broken', { market });
      return null;
    }
    return result;
  }
}
