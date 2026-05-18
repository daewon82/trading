import type { Candle } from './types.js';

const NAVER_BASE = 'https://api.finance.naver.com/siseJson.naver';
const RETRY_DELAYS_MS = [1000, 3000, 7000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export async function fetchOhlcv(code: string, days = 400): Promise<Candle[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const url = `${NAVER_BASE}?symbol=${encodeURIComponent(code)}&requestType=1&startTime=${fmtDate(start)}&endTime=${fmtDate(end)}&timeframe=day`;

  let text = '';
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json,text/javascript,*/*;q=0.01',
          Referer: `https://finance.naver.com/item/sise.naver?code=${encodeURIComponent(code)}`,
        },
      });
      if (!res.ok) {
        lastErr = new Error(`Naver fetch failed (${code}): HTTP ${res.status}`);
        if (res.status < 500 && res.status !== 429) throw lastErr;
        if (attempt === RETRY_DELAYS_MS.length) throw lastErr;
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      text = await res.text();
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === RETRY_DELAYS_MS.length) throw lastErr;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  return parseNaverSise(text, code);
}

function parseNaverSise(text: string, code: string): Candle[] {
  const cleaned = text
    .replace(/\r?\n/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let rows: (string | number)[][];
  try {
    rows = JSON.parse(cleaned.replace(/'/g, '"')) as (string | number)[][];
  } catch (err) {
    throw new Error(`Naver parse failed (${code}): ${(err as Error).message}`);
  }

  const candles: Candle[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const [date, open, high, low, close, volume] = row;
    if (typeof date !== 'string' || date.length !== 8) continue;
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    candles.push({
      date: iso,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    });
  }
  if (candles.length === 0) {
    throw new Error(`Naver returned no candles for ${code}`);
  }
  return candles;
}
