import type { AnalystConsensus } from '../../types/consensus.js';
import { logger } from '../../utils/logger.js';

const YAHOO_FC = 'https://fc.yahoo.com/';
const YAHOO_CRUMB = 'https://query2.finance.yahoo.com/v1/test/getcrumb';
const YAHOO_QSUM = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';
const UA = 'Mozilla/5.0';

export interface YahooAuth {
  cookie: string;
  crumb: string;
}

interface RawNumber {
  raw?: number;
  fmt?: string;
}

interface RawString {
  raw?: string;
  fmt?: string;
}

interface FinancialData {
  recommendationKey?: string;
  recommendationMean?: RawNumber;
  targetMeanPrice?: RawNumber;
  targetHighPrice?: RawNumber;
  targetLowPrice?: RawNumber;
  numberOfAnalystOpinions?: RawNumber;
}

interface RecTrend {
  period?: string;
  strongBuy?: number;
  buy?: number;
  hold?: number;
  sell?: number;
  strongSell?: number;
}

interface QuoteSummaryResponse {
  quoteSummary?: {
    result?: Array<{
      financialData?: FinancialData;
      recommendationTrend?: { trend?: RecTrend[] };
    }>;
    error?: { code: string; description: string } | null;
  };
}

export async function getYahooAuth(): Promise<YahooAuth | null> {
  const ctrl1 = new AbortController();
  const t1 = setTimeout(() => ctrl1.abort(), 8_000);
  let cookie: string | null = null;
  try {
    const res = await fetch(YAHOO_FC, {
      headers: { 'User-Agent': UA },
      signal: ctrl1.signal,
      redirect: 'manual',
    });
    const setCookies = res.headers.get('set-cookie');
    if (setCookies) {
      cookie = setCookies
        .split(',')
        .map((c) => c.split(';')[0]!.trim())
        .filter((c) => c.length > 0)
        .join('; ');
    }
  } catch (err) {
    logger.warn('Yahoo cookie fetch failed', { err: String(err) });
  } finally {
    clearTimeout(t1);
  }
  if (!cookie) return null;

  const ctrl2 = new AbortController();
  const t2 = setTimeout(() => ctrl2.abort(), 8_000);
  try {
    const res = await fetch(YAHOO_CRUMB, {
      headers: { 'User-Agent': UA, Cookie: cookie },
      signal: ctrl2.signal,
    });
    if (!res.ok) return null;
    const crumb = (await res.text()).trim();
    if (!crumb || crumb === 'Unauthorized' || crumb.length > 64) return null;
    return { cookie, crumb };
  } catch (err) {
    logger.warn('Yahoo crumb fetch failed', { err: String(err) });
    return null;
  } finally {
    clearTimeout(t2);
  }
}

export async function fetchAnalystConsensus(
  ticker: string,
  auth: YahooAuth,
): Promise<AnalystConsensus | null> {
  const url = `${YAHOO_QSUM}/${encodeURIComponent(ticker)}?modules=financialData,recommendationTrend&crumb=${encodeURIComponent(auth.crumb)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Cookie: auth.cookie },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as QuoteSummaryResponse;
    const result = json.quoteSummary?.result?.[0];
    if (!result) return null;
    const fd = result.financialData;
    const t = result.recommendationTrend?.trend?.[0];
    return {
      ticker,
      recommendationKey: fd?.recommendationKey ?? null,
      recommendationMean: fd?.recommendationMean?.raw ?? null,
      targetMeanPrice: fd?.targetMeanPrice?.raw ?? null,
      targetHighPrice: fd?.targetHighPrice?.raw ?? null,
      targetLowPrice: fd?.targetLowPrice?.raw ?? null,
      numberOfAnalystOpinions: fd?.numberOfAnalystOpinions?.raw ?? null,
      trend: t
        ? {
            strongBuy: t.strongBuy ?? 0,
            buy: t.buy ?? 0,
            hold: t.hold ?? 0,
            sell: t.sell ?? 0,
            strongSell: t.strongSell ?? 0,
          }
        : null,
    };
  } catch (err) {
    logger.warn('Yahoo consensus fetch failed', { ticker, err: String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
