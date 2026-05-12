import type { AnnualFinancials, FinancialSummary } from '../../types/financial.js';
import { logger } from '../../utils/logger.js';

const BASE = 'https://navercomp.wisereport.co.kr/v2/company/cF1002.aspx';

export class NaverWiseReportSource {
  readonly id = 'naver-wisereport' as const;

  /**
   * Naver Wisereport cF1002 페이지 fetch — 최근 3개년 실적 + 2개년 추정치.
   * 매출액, YoY, 영업이익, 당기순이익, EPS, PER, PBR, ROE, EV/EBITDA, 순부채비율.
   */
  async fetch(code: string): Promise<FinancialSummary | null> {
    try {
      const url = `${BASE}?cmp_cd=${code}`;
      const res = await globalThis.fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      if (!res.ok) {
        logger.warn('NaverWiseReportSource non-200', { code, status: res.status });
        return null;
      }
      const html = await res.text();
      const annuals = parseAnnuals(html);
      if (annuals.length === 0) return null;
      const latestActual = [...annuals].reverse().find((a) => a.type === 'actual') ?? null;
      const latestEstimate = annuals.find((a) => a.type === 'estimate') ?? null;
      return { code, annuals, latestActual, latestEstimate };
    } catch (err) {
      logger.error('NaverWiseReportSource.fetch failed', { code, err: String(err) });
      return null;
    }
  }
}

function parseAnnuals(html: string): AnnualFinancials[] {
  // tbody 안의 각 tr 추출 (Wisereport는 HTML 직접 반환)
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];
  const tbody = tbodyMatch[1];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const results: AnnualFinancials[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(tbody)) !== null) {
    const cells = extractCells(m[1]);
    if (cells.length < 11) continue;
    const year = cells[0];
    const type: 'actual' | 'estimate' = year.includes('(A)') ? 'actual' : 'estimate';
    results.push({
      year,
      type,
      revenue: parseNum(cells[1]),
      revenueYoy: parseNum(cells[2]),
      operatingIncome: parseNum(cells[3]),
      netIncome: parseNum(cells[4]),
      eps: parseNum(cells[5]),
      per: parseNum(cells[6]),
      pbr: parseNum(cells[7]),
      roe: parseNum(cells[8]),
      evEbitda: parseNum(cells[9]),
      netDebtRatio: parseNum(cells[10]),
    });
  }
  return results;
}

function extractCells(rowHtml: string): string[] {
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = cellRegex.exec(rowHtml)) !== null) {
    out.push(stripHtml(m[1]).trim());
  }
  return out;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s]/g, '').replace(/[()]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}
