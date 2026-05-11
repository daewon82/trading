import type { Page } from '@playwright/test';
import type { DailyFlow, FlowSummary } from '../../types/flow.js';
import { logger } from '../../utils/logger.js';

export class NaverKrFlowSource {
  readonly id = 'naver-kr-flow' as const;

  private readonly sel = {
    flowTable: 'table[summary*="외국인 기관 순매매"]',
  };

  private buildUrl(code: string, pageNum: number): string {
    return `https://finance.naver.com/item/frgn.naver?code=${code}&page=${pageNum}`;
  }

  /**
   * frgn.naver 페이지 1~6 fetch — 약 60거래일치 데이터.
   * pages=1이면 5d/10d만 (빠름), pages=6이면 60d까지 모두 (느림).
   */
  async fetch(page: Page, code: string, pages = 6): Promise<FlowSummary | null> {
    try {
      const daily: DailyFlow[] = [];
      let pageOneRaw = '';

      for (let pageNum = 1; pageNum <= pages; pageNum++) {
        await page.goto(this.buildUrl(code, pageNum), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        await page.waitForSelector(this.sel.flowTable, { timeout: 15_000 });

        const raw = await page.locator(this.sel.flowTable).evaluate((table) => {
          return Array.from(table.querySelectorAll('tbody tr'))
            .map((tr) =>
              Array.from(tr.querySelectorAll('td')).map((td) =>
                (td.textContent ?? '').replace(/\s+/g, ' ').trim(),
              ),
            )
            .filter((cells) => cells.length >= 7 && /^\d{4}\.\d{2}\.\d{2}/.test(cells[0] ?? ''));
        });

        const parsed = raw.map(parseRow);
        if (parsed.length === 0) break; // 데이터 더 없음
        daily.push(...parsed);

        if (pageNum === 1) {
          pageOneRaw = await page.content();
        }
      }

      // 거래원 정보 — page=1에서 "외국계추정합" 영역 추출
      const flat = pageOneRaw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
      const brokerMatch = flat.match(
        /외국계\s*추정합\s*([\d,]+)\s+([\d,]+)\s+([\d,]+)/,
      );
      let foreignBrokerSell: number | null = null;
      let foreignBrokerBuy: number | null = null;
      if (brokerMatch) {
        foreignBrokerSell = parsePlainNumber(brokerMatch[1]);
        foreignBrokerBuy = parsePlainNumber(brokerMatch[2]);
      }

      return {
        code,
        daily,
        net5dInstitutional: sumNet(daily, 5, 'institutionalNet'),
        net5dForeigner: sumNet(daily, 5, 'foreignerNet'),
        net10dInstitutional: sumNet(daily, 10, 'institutionalNet'),
        net10dForeigner: sumNet(daily, 10, 'foreignerNet'),
        net20dInstitutional: sumNet(daily, 20, 'institutionalNet'),
        net20dForeigner: sumNet(daily, 20, 'foreignerNet'),
        net60dInstitutional: sumNet(daily, 60, 'institutionalNet'),
        net60dForeigner: sumNet(daily, 60, 'foreignerNet'),
        foreignBrokerSell,
        foreignBrokerBuy,
      };
    } catch (err) {
      logger.error('NaverKrFlowSource.fetch failed', { code, err: String(err) });
      return null;
    }
  }
}

function parseRow(cells: string[]): DailyFlow {
  const [d0, c1, _c2, c3, c4, c5, c6, _c7, c8] = cells;
  const date = (d0 ?? '').replace(/\./g, '-');
  return {
    date,
    close: parsePlainNumber(c1),
    changePercent: parsePercent(c3),
    volume: parsePlainNumber(c4),
    institutionalNet: parseSignedNumber(c5),
    foreignerNet: parseSignedNumber(c6),
    foreignerHoldingRatio: parsePercent(c8),
  };
}

function parsePlainNumber(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s]/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parsePercent(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[%,\s]/g, '');
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function parseSignedNumber(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,\s]/g, '');
  const m = cleaned.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * Number(m[2]);
}

function sumNet(
  rows: DailyFlow[],
  n: number,
  key: 'institutionalNet' | 'foreignerNet',
): number | null {
  let total = 0;
  let count = 0;
  for (const r of rows.slice(0, n)) {
    const v = r[key];
    if (v != null) {
      total += v;
      count++;
    }
  }
  return count > 0 ? total : null;
}
