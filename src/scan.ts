import { fetchOhlcv } from './fetch.js';
import { computeIndicators } from './indicators.js';
import type { Candle, ScanCandidate, ScanCandidateResult } from './types.js';

// 보유 8종목 제외한 KOSPI 시총 상위 대형주 (대략적 시총 순)
export const SCAN_CANDIDATES: ScanCandidate[] = [
  { code: '000660', name: 'SK하이닉스' },
  { code: '373220', name: 'LG에너지솔루션' },
  { code: '005380', name: '현대차' },
  { code: '005490', name: 'POSCO홀딩스' },
  { code: '207940', name: '삼성바이오로직스' },
  { code: '035420', name: 'NAVER' },
  { code: '105560', name: 'KB금융' },
  { code: '028260', name: '삼성물산' },
  { code: '035720', name: '카카오' },
  { code: '055550', name: '신한지주' },
  { code: '068270', name: '셀트리온' },
  { code: '012330', name: '현대모비스' },
  { code: '086790', name: '하나금융지주' },
  { code: '003550', name: 'LG' },
  { code: '015760', name: '한국전력' },
  { code: '011200', name: 'HMM' },
  { code: '010130', name: '고려아연' },
  { code: '033780', name: 'KT&G' },
  { code: '096770', name: 'SK이노베이션' },
  { code: '034730', name: 'SK' },
  { code: '003670', name: '포스코퓨처엠' },
  { code: '030200', name: 'KT' },
  { code: '009150', name: '삼성전기' },
  { code: '010950', name: 'S-Oil' },
  { code: '011170', name: '롯데케미칼' },
  { code: '018260', name: '삼성에스디에스' },
  { code: '032830', name: '삼성생명' },
  { code: '086280', name: '현대글로비스' },
  { code: '047810', name: '한국항공우주' },
  { code: '010140', name: '삼성중공업' },
  { code: '042660', name: '한화오션' },
];

const TIER_B_BREAKOUT_DISTANCE_PCT = 3;

function trimPartialToday(candles: Candle[], kstToday: string, closeConfirmed: boolean): Candle[] {
  if (closeConfirmed || candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  if (last.date === kstToday) return candles.slice(0, -1);
  return candles;
}

async function scanOne(
  c: ScanCandidate,
  kstToday: string,
  closeConfirmed: boolean,
  riskPerTrade: number,
): Promise<ScanCandidateResult> {
  try {
    const raw = await fetchOhlcv(c.code, 400);
    const candles = trimPartialToday(raw, kstToday, closeConfirmed);
    const ind = computeIndicators(candles);
    const distancePct = ((ind.donchianHigh20 - ind.lastClose) / ind.lastClose) * 100;
    const breakoutPassed = ind.lastClose >= ind.donchianHigh20;
    const ma60Passed = ind.lastClose > ind.ma60;
    const ma120Passed = ind.lastClose > ind.ma120;
    const alignmentPassed = ind.ma60 > ind.ma120;

    let tier: ScanCandidateResult['tier'] = 'none';
    if (breakoutPassed && ma60Passed && ma120Passed && alignmentPassed) {
      tier = 'A';
    } else if (
      !breakoutPassed &&
      distancePct <= TIER_B_BREAKOUT_DISTANCE_PCT &&
      distancePct > 0 &&
      ma60Passed &&
      ma120Passed &&
      alignmentPassed
    ) {
      tier = 'B';
    }

    const unitSize = ind.atr20 > 0 ? Math.max(0, Math.floor(riskPerTrade / (2 * ind.atr20))) : 0;

    return {
      code: c.code,
      name: c.name,
      lastClose: ind.lastClose,
      donchianHigh20: ind.donchianHigh20,
      atr20: ind.atr20,
      ma60: ind.ma60,
      ma120: ind.ma120,
      distancePct,
      breakoutPassed,
      ma60Passed,
      ma120Passed,
      alignmentPassed,
      tier,
      unitSize,
    };
  } catch (err) {
    return {
      code: c.code,
      name: c.name,
      lastClose: 0,
      donchianHigh20: 0,
      atr20: 0,
      ma60: 0,
      ma120: 0,
      distancePct: 0,
      breakoutPassed: false,
      ma60Passed: false,
      ma120Passed: false,
      alignmentPassed: false,
      tier: 'none',
      unitSize: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ScanOptions {
  kstToday: string;
  closeConfirmed: boolean;
  riskPerTrade: number;
  onProgress?: (current: ScanCandidate, result: ScanCandidateResult) => void;
  delayMs?: number;
}

export async function scanCandidates(opts: ScanOptions): Promise<ScanCandidateResult[]> {
  const results: ScanCandidateResult[] = [];
  const delayMs = opts.delayMs ?? 800;
  for (const c of SCAN_CANDIDATES) {
    const r = await scanOne(c, opts.kstToday, opts.closeConfirmed, opts.riskPerTrade);
    results.push(r);
    if (opts.onProgress) opts.onProgress(c, r);
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return results;
}
