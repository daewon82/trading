import { test } from '@playwright/test';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { TossKrFlowSource } from '../src/sources/toss-kr/TossKrFlowSource.js';
import { NaverWiseReportSource } from '../src/sources/naver-kr/NaverWiseReportSource.js';
import type { FinancialSummary } from '../src/types/financial.js';
import { computeQualityScore, type QualityScore } from '../src/analyzers/QualityScore.js';
import {
  fetchDailyChart,
  resolveCandidates,
} from '../src/sources/timeseries/YahooChartSource.js';
import { DashboardBuilder } from '../src/analyzers/DashboardBuilder.js';
import { computeIndicators } from '../src/analyzers/TechnicalIndicators.js';
import {
  evaluateInsight,
  DashboardReporter,
  type DashboardPage,
  type UniverseTop,
} from '../src/reporters/DashboardReporter.js';
import type { AnalystConsensus } from '../src/types/consensus.js';
import type { StockSnapshot } from '../src/types/stock.js';
import type { IndicatorSet } from '../src/types/timeseries.js';
import type { FlowSummary } from '../src/types/flow.js';
import { logger } from '../src/utils/logger.js';

// 관심종목 4종 (고정): 삼성전자, LG전자, 기아, SK텔레콤
// 관심종목 11종: 삼성전자, LG전자, 기아, SK텔레콤, 롯데쇼핑, 이마트,
// LG디스플레이, LG유플러스, 엔씨소프트, 펄어비스(KOSDAQ), NAVER
const DEFAULT_KR = '005930,066570,000270,017670,023530,139480,034220,032640,036570,263750,035420';

// 저평가 + 외인·기관 매수 추세 Top 5 후보 시드 (KOSPI 대형 가치주, 25종)
// 관심종목 4종(005930·066570·000270·017670)은 별도 영역이라 제외
const DEFAULT_VALUE_KR = [
  '005490', // POSCO홀딩스
  '012330', // 현대모비스
  '033780', // KT&G
  '086790', // 하나금융지주
  '055550', // 신한지주
  '032830', // 삼성생명
  '024110', // 기업은행
  '267250', // HD현대
  '051910', // LG화학
  '105560', // KB금융
  '316140', // 우리금융지주
  '030200', // KT
  '015760', // 한국전력
  '000810', // 삼성화재
  '096770', // SK이노베이션
  '010950', // S-Oil
  '011170', // 롯데케미칼
  '006360', // GS건설
  '000720', // 현대건설
  '078930', // GS
  '001040', // CJ
  '028260', // 삼성물산
  '003550', // LG
  '005380', // 현대차
  '138040', // 메리츠금융지주
].join(',');

// KR 종목 코드 → 한글 종목명 매핑 (Yahoo chart longName이 영문이라 보정)
const KR_NAMES: Record<string, string> = {
  '005930': '삼성전자', '066570': 'LG전자', '000270': '기아', '017670': 'SK텔레콤',
  '023530': '롯데쇼핑', '139480': '이마트', '034220': 'LG디스플레이',
  '032640': 'LG유플러스', '036570': '엔씨소프트', '263750': '펄어비스',
  '035420': 'NAVER',
  '005490': 'POSCO홀딩스', '012330': '현대모비스', '033780': 'KT&G',
  '086790': '하나금융지주', '055550': '신한지주', '032830': '삼성생명',
  '024110': '기업은행', '267250': 'HD현대', '051910': 'LG화학',
  '105560': 'KB금융', '316140': '우리금융지주', '030200': 'KT',
  '015760': '한국전력', '000810': '삼성화재', '096770': 'SK이노베이션',
  '010950': 'S-Oil', '011170': '롯데케미칼', '006360': 'GS건설',
  '000720': '현대건설', '078930': 'GS', '001040': 'CJ',
  '028260': '삼성물산', '003550': 'LG', '005380': '현대차',
  '138040': '메리츠금융지주',
};

const krCodes = (process.env.KR_DASHBOARD_CODES ?? DEFAULT_KR)
  .split(',').map((s) => s.trim()).filter(Boolean);
const valueKrCodes = (process.env.KR_VALUE_CANDIDATES ?? DEFAULT_VALUE_KR)
  .split(',').map((s) => s.trim()).filter(Boolean);

const krSnaps: StockSnapshot[] = [];
const valueKrSnaps: StockSnapshot[] = [];
const indicatorMap = new Map<string, IndicatorSet>();
const closesMap = new Map<string, number[]>();
const flowMap = new Map<string, FlowSummary>();
const financialMap = new Map<string, FinancialSummary>();
const scoreMap = new Map<string, QualityScore>();
const range52Map = new Map<string, { high: number | null; low: number | null }>();
const consensusMap = new Map<string, AnalystConsensus>();
const nameMap = new Map<string, string>();
let krWatchTop: UniverseTop[] = [];
let krValueForeignBuyTop: UniverseTop[] = [];
const SPARKLINE_DAYS = 60;

test.describe.configure({ mode: 'serial' });

test('시계열 + 기술적 지표 + sparkline (병렬 fetch)', async () => {
  const allTickers = new Map<string, 'KR'>();
  for (const c of krCodes) allTickers.set(c, 'KR');
  for (const c of valueKrCodes) allTickers.set(c, 'KR');

  const tasks = [...allTickers.entries()].map(([ticker, market]) => ({ ticker, market }));
  const results = await Promise.all(
    tasks.map(async ({ ticker, market }) => {
      const ts = await fetchDailyChart(ticker, resolveCandidates(ticker, market));
      if (ts) {
        const ind = computeIndicators(ts);
        indicatorMap.set(ticker, ind);
        const closes = ts.points.map((p) => p.close).slice(-SPARKLINE_DAYS);
        closesMap.set(ticker, closes);
        range52Map.set(ticker, {
          high: ts.fiftyTwoWeekHigh,
          low: ts.fiftyTwoWeekLow,
        });
        if (ts.longName) nameMap.set(ticker, ts.longName);
        return { ticker, points: ts.points.length };
      }
      return { ticker, points: 0 };
    }),
  );
  logger.info('indicators fetched', {
    total: results.length,
    indicators: indicatorMap.size,
  });
});

test('외인·기관 수급 — Toss API 병렬 fetch (장중 실시간)', async () => {
  const allCodes = new Set<string>([...krCodes, ...valueKrCodes]);
  const tossSrc = new TossKrFlowSource();
  const results = await Promise.all(
    [...allCodes].map(async (code) => {
      const flow = await tossSrc.fetch(code, 60);
      if (flow) flowMap.set(code, flow);
      return { code, ok: !!flow };
    }),
  );
  logger.info('flow fetched (Toss)', {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
  });
});

test('재무 — Naver Wisereport 병렬 fetch (매출/영업이익/순부채/ROE)', async () => {
  const allCodes = new Set<string>([...krCodes, ...valueKrCodes]);
  const wiseSrc = new NaverWiseReportSource();
  const results = await Promise.all(
    [...allCodes].map(async (code) => {
      const fin = await wiseSrc.fetch(code);
      if (fin) financialMap.set(code, fin);
      return { code, ok: !!fin };
    }),
  );
  logger.info('financials fetched (Wisereport)', {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    sample: [...financialMap.entries()].slice(0, 3).map(([c, f]) => ({
      code: c,
      latestActual: f.latestActual ? {
        year: f.latestActual.year,
        revenue: f.latestActual.revenue,
        roe: f.latestActual.roe,
        debt: f.latestActual.netDebtRatio,
      } : null,
    })),
  });
});

for (const code of krCodes) {
  test(`KR ${code}`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, code);
    const snap = await src.extractSnapshot(page, code);
    krSnaps.push(snap);
    const cons = await src.extractConsensus(page, code);
    if (cons) consensusMap.set(code, cons);
    logger.info('KR snapshot', {
      code,
      name: snap.name,
      price: snap.price,
      consensus: cons ? `${cons.recommendationKey} ${cons.recommendationMean?.toFixed(2)}/5` : null,
    });
  });
}

for (const code of valueKrCodes) {
  test(`Value KR ${code}`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, code);
    const snap = await src.extractSnapshot(page, code);
    valueKrSnaps.push(snap);
    const cons = await src.extractConsensus(page, code);
    if (cons) consensusMap.set(code, cons);
  });
}

test.afterAll(async () => {
  if (krSnaps.length === 0) return;

  // 52주 보정 — NaverKr 정규식이 일부 종목에서 미매칭일 때 Yahoo chart meta로 fallback
  const fixup52w = (snaps: StockSnapshot[]): void => {
    for (const snap of snaps) {
      const range = range52Map.get(snap.code);
      if (!range) continue;
      if (snap.fiftyTwoWeekHigh == null && range.high != null) {
        snap.fiftyTwoWeekHigh = range.high;
      }
      if (snap.fiftyTwoWeekLow == null && range.low != null) {
        snap.fiftyTwoWeekLow = range.low;
      }
    }
  };
  fixup52w(krSnaps);
  fixup52w(valueKrSnaps);

  const builder = new DashboardBuilder();
  const ctx = { indicators: indicatorMap, closes: closesMap, flows: flowMap, consensuses: consensusMap };

  const buildCard = (
    ticker: string,
  ): import('../src/types/stock.js').DashboardCard | null => {
    const closes = closesMap.get(ticker);
    const range = range52Map.get(ticker);
    if (!closes || closes.length < 2 || !range) return null;
    const price = closes[closes.length - 1]!;
    const yesterday = closes[closes.length - 2]!;
    const changePercent = yesterday > 0 ? ((price - yesterday) / yesterday) * 100 : null;
    const localName = KR_NAMES[ticker] ?? nameMap.get(ticker);
    const snap: StockSnapshot = {
      code: ticker,
      name: localName ?? ticker,
      market: 'KR',
      currency: 'KRW',
      source: 'naver-kr',
      capturedAt: new Date().toISOString(),
      price,
      changePercent,
      marketCap: null,
      per: null,
      pbr: null,
      eps: null,
      bps: null,
      roe: null,
      dividendYield: null,
      fiftyTwoWeekHigh: range.high,
      fiftyTwoWeekLow: range.low,
    };
    const sec = builder.build([snap], ctx);
    return sec.cards[0] ?? null;
  };

  // 품질 점수 계산 — 모든 관심·가치 코드에 대해
  for (const code of [...krCodes, ...valueKrCodes]) {
    const fin = financialMap.get(code) ?? null;
    const flow = flowMap.get(code) ?? null;
    const qs = computeQualityScore(fin, flow);
    if (qs) scoreMap.set(code, qs);
  }
  logger.info('quality scores computed', {
    count: scoreMap.size,
    sample: [...scoreMap.entries()].slice(0, 3).map(([c, s]) => ({ code: c, total: s.total, grade: s.grade })),
  });

  // 관심종목
  const favoriteResults: UniverseTop[] = [];
  for (const ticker of krCodes) {
    const card = buildCard(ticker);
    if (!card) continue;
    card.flow = flowMap.get(ticker) ?? null;
    card.consensus = consensusMap.get(ticker) ?? null;
    card.financial = financialMap.get(ticker) ?? null;
    card.qualityScore = scoreMap.get(ticker) ?? null;
    const ins = evaluateInsight(card, 'KR');
    favoriteResults.push({
      ticker,
      name: card.snapshot.name,
      market: 'KR',
      card,
      insight: ins,
      score: ins.bullish.length - ins.bearish.length,
      consensus: card.consensus,
    });
  }
  krWatchTop = favoriteResults;

  // 저평가 가치주 시드(25종) 중 외인·기관 20일 동반 순매수 Top 5
  // "저평가" 정의 = 52주 위치가 아니라 KOSPI 전통 가치주(저PER/저PBR/고배당) 큐레이션 풀.
  // 강세장에서는 가치주도 52주 고점 근처 가능하지만, 펀더멘털 기준으로는 여전히 저평가.
  const krValueForeignResults: UniverseTop[] = [];
  for (const ticker of valueKrCodes) {
    const flow = flowMap.get(ticker);
    if (!flow) continue;
    if (flow.net20dForeigner == null || flow.net20dForeigner <= 0) continue;
    if (flow.net20dInstitutional == null || flow.net20dInstitutional <= 0) continue;
    const card = buildCard(ticker);
    if (!card) continue;
    card.flow = flow;
    card.consensus = consensusMap.get(ticker) ?? null;
    card.financial = financialMap.get(ticker) ?? null;
    card.qualityScore = scoreMap.get(ticker) ?? null;
    const ins = evaluateInsight(card, 'KR');
    krValueForeignResults.push({
      ticker,
      name: card.snapshot.name,
      market: 'KR',
      card,
      insight: ins,
      score: flow.net20dForeigner + flow.net20dInstitutional,
      consensus: card.consensus,
    });
  }
  krValueForeignResults.sort((a, b) => b.score - a.score);
  krValueForeignBuyTop = krValueForeignResults.slice(0, 5);

  logger.info('universe selection', {
    favorites: krWatchTop.map((r) => ({ ticker: r.ticker, score: r.score })),
    valueForeignBuy: krValueForeignBuyTop.map((r) => ({ ticker: r.ticker, score: r.score })),
  });

  const today = todayInSeoul();
  const dashboard: DashboardPage = {
    generatedAt: new Date().toISOString(),
    today,
    krWatchTop,
    krValueForeignBuyTop,
  };
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  const jsonPath = resolve(`reports/dashboard-${ts}.json`);
  const htmlPath = resolve(`reports/dashboard-${ts}.html`);
  await writeFile(jsonPath, JSON.stringify(dashboard, null, 2), 'utf8');
  await new DashboardReporter().write(dashboard, htmlPath);

  // GitHub Pages 용 docs/ 갱신
  await mkdir('docs/history', { recursive: true });
  const docsIndex = resolve('docs/index.html');
  const docsHistory = resolve(`docs/history/dashboard-${ts}.html`);
  await copyFile(htmlPath, docsIndex);
  await copyFile(htmlPath, docsHistory);

  logger.info('dashboard written', {
    krCount: krSnaps.length,
    htmlPath,
    docsIndex,
  });
});

function todayInSeoul(): string {
  const fmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} (${get('weekday')})`;
}
