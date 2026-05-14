import type { DailyFlow, FlowSummary } from '../../types/flow.js';
import { logger } from '../../utils/logger.js';

const BASE =
  'https://wts-info-api.tossinvest.com/api/v1/stock-infos/trade/trend/trading-trend';

interface TossRow {
  baseDate: string;
  base?: number | null;
  close?: number | null;
  foreignerBuyVolume?: number | null;
  foreignerSellVolume?: number | null;
  netForeignerBuyVolume?: number | null;
  institutionBuyVolume?: number | null;
  institutionSellVolume?: number | null;
  netInstitutionBuyVolume?: number | null;
  foreignerRatio?: number | null;
  inMarketTime?: boolean;
}

interface TossResponse {
  result?: { body?: TossRow[] };
}

export class TossKrFlowSource {
  readonly id = 'toss-kr-flow' as const;

  /**
   * Toss Securities 내부 API에서 일별 외인·기관 거래량 fetch.
   * 인증 불필요. size=60이면 약 60거래일치 (오늘 포함).
   * 오늘 데이터(body[0])는 장중 실시간 갱신.
   */
  async fetch(code: string, size = 60): Promise<FlowSummary | null> {
    const url = `${BASE}?productCode=A${code}&size=${size}`;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await globalThis.fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Accept: 'application/json',
          },
        });
        if (!res.ok) {
          logger.warn('TossKrFlowSource non-200', { code, status: res.status, attempt });
          if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
          return null;
        }
        const json = (await res.json()) as TossResponse;
        return this.parseResponse(code, json);
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          logger.warn('TossKrFlowSource transient error, retrying', { code, attempt, err: String(err) });
          await sleep(1000 * (attempt + 1));
        }
      }
    }
    logger.error('TossKrFlowSource.fetch failed', { code, err: String(lastErr) });
    return null;
  }

  private parseResponse(code: string, json: TossResponse): FlowSummary | null {
    try {
      const body = json?.result?.body ?? [];
      if (body.length === 0) return null;

      const daily: DailyFlow[] = body.map((row) => {
        const close = row.close ?? null;
        const f = row.netForeignerBuyVolume ?? null;
        const i = row.netInstitutionBuyVolume ?? null;
        return {
          date: row.baseDate,
          close,
          changePercent:
            row.base != null && row.close != null && row.base !== 0
              ? ((row.close - row.base) / row.base) * 100
              : null,
          volume: null,
          institutionalNet: i,
          foreignerNet: f,
          institutionalNetValue: i != null && close != null ? i * close : null,
          foreignerNetValue: f != null && close != null ? f * close : null,
          foreignerHoldingRatio: row.foreignerRatio ?? null,
        };
      });

      const today = body[0];
      const todayClose = today?.close ?? null;
      const todayF = today?.netForeignerBuyVolume ?? null;
      const todayI = today?.netInstitutionBuyVolume ?? null;
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
        net5dInstitutionalValue: sumNet(daily, 5, 'institutionalNetValue'),
        net5dForeignerValue: sumNet(daily, 5, 'foreignerNetValue'),
        net10dInstitutionalValue: sumNet(daily, 10, 'institutionalNetValue'),
        net10dForeignerValue: sumNet(daily, 10, 'foreignerNetValue'),
        net20dInstitutionalValue: sumNet(daily, 20, 'institutionalNetValue'),
        net20dForeignerValue: sumNet(daily, 20, 'foreignerNetValue'),
        net60dInstitutionalValue: sumNet(daily, 60, 'institutionalNetValue'),
        net60dForeignerValue: sumNet(daily, 60, 'foreignerNetValue'),
        todayForeignerNet: todayF,
        todayInstitutionalNet: todayI,
        todayForeignerNetValue: todayF != null && todayClose != null ? todayF * todayClose : null,
        todayInstitutionalNetValue: todayI != null && todayClose != null ? todayI * todayClose : null,
        todayInMarketTime: today?.inMarketTime ?? false,
        todayDate: today?.baseDate ?? null,
      };
    } catch (err) {
      logger.error('TossKrFlowSource.fetch failed', { code, err: String(err) });
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 정확한 n일 누적. 데이터가 n일치보다 적으면 null 반환 (혼동 방지).
 * 예: size=30으로 fetch했는데 60일 누적을 요청하면 null.
 */
function sumNet(
  rows: DailyFlow[],
  n: number,
  key:
    | 'institutionalNet'
    | 'foreignerNet'
    | 'institutionalNetValue'
    | 'foreignerNetValue',
): number | null {
  const window = rows.slice(0, n);
  if (window.length < n) return null;
  let total = 0;
  let count = 0;
  for (const r of window) {
    const v = r[key];
    if (v != null) {
      total += v;
      count++;
    }
  }
  // 윈도우 내 일부 null 허용(휴장 등) — 70% 미만이면 무효
  if (count < Math.ceil(n * 0.7)) return null;
  return total;
}
