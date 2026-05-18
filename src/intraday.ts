/**
 * 장중 트리거 가격 감지.
 *
 * 일봉 종가 기반 시스템과 달리, 이 모듈은 *장중 실시간 가격* 으로 핵심
 * 가격대 통과를 감지해서 즉시 알림용 이벤트를 생성합니다.
 *
 * 감지 대상 트리거
 *   - 보유 종목: -2 ATR 손절선 이탈, 10일 저점 이탈
 *   - 매수 후보 A 등급: 매수 적정가(현재가) 부근 — 돌파 유지 확인용
 *   - 매수 후보 B 등급: 매수 트리거(20일 고점) 도달
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { DashboardData } from './types.js';

export interface IntradayQuote {
  code: string;
  price: number;
  change: number;
  changePct: number;
  fetchedAt: string;
}

export type IntradayTriggerKind =
  | 'STOP_BREACH'        // 보유: 손절선(-2 ATR) 이탈
  | 'EXIT_10D_BREACH'    // 보유: 10일 저점 이탈
  | 'BUY_TRIGGER_HIT'    // 스캔 B 등급: 매수 트리거 도달
  | 'BREAKOUT_LOST';     // 스캔 A 등급: 돌파 무효화 (돌파선 아래로 후퇴)

export interface IntradayAlert {
  code: string;
  name: string;
  kind: IntradayTriggerKind;
  triggerPrice: number;
  currentPrice: number;
  message: string;
  detail: string;
}

interface AlertCache {
  date: string; // YYYY-MM-DD KST
  sent: string[]; // 발송한 알림 키 (`code:kind`)
}

const CACHE_PATH = 'docs/intraday-alerts.json';
const NAVER_BASE = 'https://polling.finance.naver.com/api/realtime/domestic/stock';

function nowKstDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function loadCache(): Promise<AlertCache> {
  try {
    const raw = await readFile(resolve(process.cwd(), CACHE_PATH), 'utf8');
    const c = JSON.parse(raw) as AlertCache;
    if (c.date === nowKstDate()) return c;
  } catch {
    // missing or unreadable — fall through to fresh cache
  }
  return { date: nowKstDate(), sent: [] };
}

async function saveCache(cache: AlertCache): Promise<void> {
  const path = resolve(process.cwd(), CACHE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2), 'utf8');
}

export async function fetchIntradayQuote(code: string): Promise<IntradayQuote> {
  const res = await fetch(`${NAVER_BASE}/${encodeURIComponent(code)}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      Referer: 'https://finance.naver.com/',
    },
  });
  if (!res.ok) throw new Error(`Naver realtime fetch failed (${code}): HTTP ${res.status}`);
  const j = (await res.json()) as {
    datas?: Array<{
      closePriceRaw?: number;
      compareToPreviousClosePriceRaw?: number;
      fluctuationsRatioRaw?: number;
      localTradedAt?: string;
    }>;
  };
  const item = j.datas?.[0];
  if (!item) throw new Error(`Naver realtime empty (${code})`);
  return {
    code,
    price: Number(item.closePriceRaw),
    change: Number(item.compareToPreviousClosePriceRaw ?? 0),
    changePct: Number(item.fluctuationsRatioRaw ?? 0),
    fetchedAt: item.localTradedAt ?? new Date().toISOString(),
  };
}

function fmtWon(n: number): string {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

export async function detectIntradayAlerts(data: DashboardData): Promise<IntradayAlert[]> {
  const alerts: IntradayAlert[] = [];
  const REQUEST_DELAY_MS = 500;

  // 1) 보유 종목 — 손절선/10일 저점 이탈 체크
  for (const r of data.reports) {
    if (!r.holding) continue;
    try {
      const live = await fetchIntradayQuote(r.config.code);
      const { stopPrice, exitTrigger10dLow } = r.holding;
      const tenDayLow = r.indicators.donchianLow10;

      if (live.price <= stopPrice) {
        alerts.push({
          code: r.config.code,
          name: r.config.name,
          kind: 'STOP_BREACH',
          triggerPrice: stopPrice,
          currentPrice: live.price,
          message: `🔴 ${r.config.name} 손절선 이탈`,
          detail: `현재가 ${fmtWon(live.price)} ≤ 손절선 ${fmtWon(stopPrice)} (-2 ATR). 기계적 청산 권장.`,
        });
      }
      if (!exitTrigger10dLow && live.price <= tenDayLow) {
        alerts.push({
          code: r.config.code,
          name: r.config.name,
          kind: 'EXIT_10D_BREACH',
          triggerPrice: tenDayLow,
          currentPrice: live.price,
          message: `🟡 ${r.config.name} 10일 저점 이탈`,
          detail: `현재가 ${fmtWon(live.price)} ≤ 10일 저점 ${fmtWon(tenDayLow)}. 익절 청산 신호.`,
        });
      }
    } catch (err) {
      console.warn(`[intraday] ${r.config.name} 조회 실패:`, (err as Error).message);
    }
    await new Promise((res) => setTimeout(res, REQUEST_DELAY_MS));
  }

  // 2) 매수 후보 — 트리거 가격 도달 체크
  for (const c of data.scanCandidates) {
    if (c.error) continue;
    try {
      const live = await fetchIntradayQuote(c.code);
      const breakoutPrice = c.donchianHigh20;

      if (c.tier === 'B' && live.price >= breakoutPrice) {
        alerts.push({
          code: c.code,
          name: c.name,
          kind: 'BUY_TRIGGER_HIT',
          triggerPrice: breakoutPrice,
          currentPrice: live.price,
          message: `🟢 ${c.name} 매수 트리거 도달`,
          detail: `현재가 ${fmtWon(live.price)} ≥ 20일 고점 ${fmtWon(breakoutPrice)}. 신규 매수 검토.`,
        });
      }
      if (c.tier === 'A' && live.price < breakoutPrice) {
        alerts.push({
          code: c.code,
          name: c.name,
          kind: 'BREAKOUT_LOST',
          triggerPrice: breakoutPrice,
          currentPrice: live.price,
          message: `⚠ ${c.name} 돌파 무효화`,
          detail: `현재가 ${fmtWon(live.price)} < 20일 고점 ${fmtWon(breakoutPrice)}. A등급 신호 일시 후퇴.`,
        });
      }
    } catch (err) {
      console.warn(`[intraday] ${c.name} 조회 실패:`, (err as Error).message);
    }
    await new Promise((res) => setTimeout(res, REQUEST_DELAY_MS));
  }

  return alerts;
}

export async function filterNewAlerts(
  alerts: IntradayAlert[],
): Promise<{ newAlerts: IntradayAlert[]; commit: () => Promise<void> }> {
  const cache = await loadCache();
  const newAlerts: IntradayAlert[] = [];
  for (const a of alerts) {
    const key = `${a.code}:${a.kind}`;
    if (!cache.sent.includes(key)) {
      newAlerts.push(a);
      cache.sent.push(key);
    }
  }
  return {
    newAlerts,
    commit: async () => {
      if (newAlerts.length > 0) await saveCache(cache);
    },
  };
}
