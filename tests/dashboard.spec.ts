import { test } from '@playwright/test';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { TossKrFlowSource } from '../src/sources/toss-kr/TossKrFlowSource.js';
import { NaverWiseReportSource } from '../src/sources/naver-kr/NaverWiseReportSource.js';
import type { FinancialSummary } from '../src/types/financial.js';
import { computeQualityScore, type QualityScore } from '../src/analyzers/QualityScore.js';
import { ValueScreener, rankValueScores } from '../src/analyzers/ValueScreener.js';
import { TradingSignalEngine } from '../src/analyzers/TradingSignalEngine.js';
import { PortfolioPlanner } from '../src/analyzers/PortfolioPlanner.js';
import type { PortfolioPlan, TradingSignal } from '../src/types/trading-signal.js';
import { KrFearGreedSource } from '../src/sources/macro/KrFearGreedSource.js';
import type { FearGreedIndex } from '../src/types/fear-greed.js';
import { NaverVolumeRankSource, type VolumeRankRow } from '../src/sources/naver-kr/NaverVolumeRankSource.js';
import { EndOfDayPicker, type EndOfDayPick } from '../src/analyzers/EndOfDayPicker.js';
import { PortfolioTracker } from '../src/analyzers/PortfolioTracker.js';
import type { PortfolioSnapshot } from '../src/types/portfolio.js';
import { JandiSignalNotifier } from '../src/notifications/JandiSignalNotifier.js';
import { loadEnv } from '../src/utils/loadEnv.js';

loadEnv();
import {
  KR_SECTOR_MAP,
  type SectorTag,
  type ValuationMetrics,
  type ValueScore,
} from '../src/types/valuation.js';
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

// 보유 종목 7종 (고정): 한화시스템, 이마트, 대한항공, SK텔레콤, LG전자, 호텔신라, 삼성전자
const DEFAULT_KR = '272210,139480,003490,017670,066570,008770,005930';

// 저평가 + 외인·기관 매수 추세 + 품질 B 이상 Top 10 후보 시드 (KOSPI 대형 가치주)
// 보유 종목은 별도 영역이라 제외 (중복 표시 방지)
const DEFAULT_VALUE_KR = [
  // 금융
  '105560', // KB금융
  '086790', // 하나금융지주
  '055550', // 신한지주
  '316140', // 우리금융지주
  '024110', // 기업은행
  '032830', // 삼성생명
  '000810', // 삼성화재
  '138040', // 메리츠금융지주
  '029780', // 삼성카드
  '006800', // 미래에셋증권
  '071050', // 한국금융지주
  // 통신·전기
  '030200', // KT
  '015760', // 한국전력
  // 화학·소재
  '005490', // POSCO홀딩스
  '051910', // LG화학
  '011170', // 롯데케미칼
  '010130', // 고려아연
  '004020', // 현대제철
  // 정유·에너지
  '096770', // SK이노베이션
  '010950', // S-Oil
  // 자동차·부품
  '012330', // 현대모비스
  '005380', // 현대차
  '161390', // 한국타이어
  // 조선·기계·항공우주
  '009540', // HD한국조선해양
  '012450', // 한화에어로스페이스
  '047810', // 한국항공우주(KAI)
  // 건설·지주
  '267250', // HD현대
  '006360', // GS건설
  '000720', // 현대건설
  '078930', // GS
  '001040', // CJ
  '028260', // 삼성물산
  '003550', // LG
  // 운송·물류·항공
  '086280', // 현대글로비스
  '011200', // HMM
  '000120', // CJ대한통운
  // 소비재·서비스
  '033780', // KT&G
  '069960', // 현대백화점
].join(',');

// KR 종목 코드 → 한글 종목명 매핑 (Yahoo chart longName이 영문이라 보정)
const KR_NAMES: Record<string, string> = {
  '005930': '삼성전자', '066570': 'LG전자', '000270': '기아', '017670': 'SK텔레콤',
  '272210': '한화시스템',
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
  '010130': '고려아연', '004020': '현대제철', '009540': 'HD한국조선해양',
  '012450': '한화에어로스페이스', '047810': '한국항공우주',
  '086280': '현대글로비스', '011200': 'HMM', '000120': 'CJ대한통운',
  '003490': '대한항공', '161390': '한국타이어',
  '006800': '미래에셋증권', '029780': '삼성카드', '071050': '한국금융지주',
  '008770': '호텔신라', '069960': '현대백화점',
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
const valueScoreMap = new Map<string, ValueScore>();
const range52Map = new Map<string, { high: number | null; low: number | null }>();
const consensusMap = new Map<string, AnalystConsensus>();
const nameMap = new Map<string, string>();
let krWatchTop: UniverseTop[] = [];
let krValueForeignBuyTop: UniverseTop[] = [];
let krValueScreenerTop: UniverseTop[] = [];
let krPortfolioPlan: PortfolioPlan | null = null;
let krFearGreed: FearGreedIndex | null = null;
let kospiReturn20d: number | null = null;
let kospiIndexValue: number | null = null;
let kospiIndexChangePct: number | null = null;
let volumeTop10: VolumeRankRow[] = [];
let eodPicks: EndOfDayPick[] = [];
let portfolioPnL: PortfolioSnapshot | null = null;
const volumeMap = new Map<string, number[]>(); // code → 최근 30거래일 일별 거래량
const SPARKLINE_DAYS = 60;
const BENCHMARK_SYMBOL = '^KS11';

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
        const vols = ts.points.map((p) => p.volume ?? null)
          .filter((v): v is number => v != null).slice(-30);
        if (vols.length > 0) volumeMap.set(ticker, vols);
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

test('코스피 공포·탐욕 지수 — fearandgreed.kr (머신러너 방법론)', async () => {
  const src = new KrFearGreedSource();
  krFearGreed = await src.fetch();
  logger.info('fear/greed fetched', {
    value: krFearGreed?.value, zone: krFearGreed?.zone, label: krFearGreed?.label,
  });
});

// v1.6 — 상대 강도(RS) 팩터용 코스피 지수 20일 수익률 fetch
test('코스피 지수 ^KS11 — 현재값 + 20거래일 수익률', async () => {
  const ts = await fetchDailyChart(BENCHMARK_SYMBOL, [BENCHMARK_SYMBOL]);
  if (!ts || ts.points.length < 21) {
    logger.warn('kospi benchmark fetch failed or too short', { points: ts?.points.length ?? 0 });
    return;
  }
  const closes = ts.points.map((p) => p.close);
  const last = closes[closes.length - 1]!;
  const prev = closes[closes.length - 2]!;
  const back20 = closes[closes.length - 21]!;
  kospiIndexValue = last;
  if (prev > 0) kospiIndexChangePct = ((last - prev) / prev) * 100;
  if (back20 > 0) kospiReturn20d = (last - back20) / back20;
  logger.info('kospi benchmark fetched', {
    symbol: BENCHMARK_SYMBOL, points: ts.points.length,
    indexValue: kospiIndexValue,
    todayChangePct: kospiIndexChangePct != null ? `${kospiIndexChangePct.toFixed(2)}%` : null,
    kospiReturn20d: kospiReturn20d != null ? `${(kospiReturn20d * 100).toFixed(2)}%` : null,
  });
});

// v1.7 — 돌팬티 종가매매: 거래량 Top 10 + 종가 매수 추천
test('거래량 Top 10 — 돌팬티 종가매매 추천 (KOSPI 비ETF)', async () => {
  test.setTimeout(60_000);
  const src = new NaverVolumeRankSource();
  const ranks = await src.fetch('kospi');
  const nonEtf = ranks.filter((r) => !r.isLikelyEtf).slice(0, 10);
  volumeTop10 = nonEtf;
  logger.info('volume rank fetched', {
    totalRows: ranks.length,
    nonEtfTop10: nonEtf.map((r) => ({ rank: r.rank, code: r.code, name: r.name, ch: r.changePct })),
  });

  // 결측 종목 보강 fetch (flow + closes/volume + 52주)
  const tossSrc = new TossKrFlowSource();
  await Promise.all(nonEtf.map(async (r) => {
    const needFlow = !flowMap.has(r.code);
    const needChart = !closesMap.has(r.code);
    const tasks: Array<Promise<unknown>> = [];
    if (needFlow) {
      tasks.push(tossSrc.fetch(r.code, 30).then((f) => { if (f) flowMap.set(r.code, f); }));
    }
    if (needChart) {
      tasks.push(fetchDailyChart(r.code, resolveCandidates(r.code, 'KR')).then((ts) => {
        if (!ts) return;
        const closes = ts.points.map((p) => p.close).slice(-30);
        closesMap.set(r.code, closes);
        const vols = ts.points.map((p) => p.volume ?? null)
          .filter((v): v is number => v != null).slice(-30);
        if (vols.length > 0) volumeMap.set(r.code, vols);
        range52Map.set(r.code, { high: ts.fiftyTwoWeekHigh, low: ts.fiftyTwoWeekLow });
        if (ts.longName) nameMap.set(r.code, ts.longName);
      }));
    }
    await Promise.all(tasks);
  }));

  // 20일 평균 거래량 계산 (당일 거래량 제외 직전 20일)
  const avgVolume20Map = new Map<string, number>();
  for (const [code, vols] of volumeMap) {
    if (vols.length < 5) continue;
    // 마지막은 당일 거래량일 수 있어 제외, 직전 20일 평균
    const prevs = vols.slice(-21, -1);
    if (prevs.length === 0) continue;
    avgVolume20Map.set(code, prevs.reduce((a, b) => a + b, 0) / prevs.length);
  }

  const picker = new EndOfDayPicker();
  eodPicks = picker.pick(nonEtf, { closesMap, avgVolume20Map, range52Map, flowMap }, 10);
  logger.info('eod picks', {
    count: eodPicks.length,
    top3: eodPicks.slice(0, 3).map((p) => ({
      code: p.code, name: p.name, score: p.totalScore,
      rec: p.recommendation, volRatio: p.volumeRatio?.toFixed(2),
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

  // v1.1 — 코스피 가치주 스크리너 (claude.md §4.5)
  // 보유 종목(5) + 가치 후보(39) 전체에 대해 멀티팩터 점수 산출
  const screener = new ValueScreener();
  const allSnaps = new Map<string, StockSnapshot>();
  for (const s of [...krSnaps, ...valueKrSnaps]) allSnaps.set(s.code, s);
  for (const [code, snap] of allSnaps) {
    const sector: SectorTag = KR_SECTOR_MAP[code] ?? '기타';
    const metrics: ValuationMetrics = {
      code,
      name: snap.name || KR_NAMES[code] || code,
      pbr: snap.pbr,
      per: snap.per,
      roe: snap.roe,
      marketCap: snap.marketCap,
      sector,
    };
    const score = screener.screen(metrics, flowMap.get(code) ?? null);
    if (score) valueScoreMap.set(code, score);
  }
  logger.info('value screener computed', {
    universe: allSnaps.size,
    passed: valueScoreMap.size,
    sample: [...valueScoreMap.values()].slice(0, 3).map((s) => ({
      code: s.code, name: s.name, total: s.total, badge: s.badge,
    })),
  });

  // 보유 종목 + v1.7: 손익 + 구조 리스크 태그
  const { StructuralRiskFilter } = await import('../src/analyzers/StructuralRiskFilter.js');
  const srFilter = new StructuralRiskFilter();
  const holdings = PortfolioTracker.parseFromEnv(process.env.HOLDINGS_JSON);
  const priceMap = new Map<string, number>();
  for (const [code, closes] of closesMap) {
    if (closes.length > 0) priceMap.set(code, closes[closes.length - 1]!);
  }
  if (holdings.length > 0) {
    portfolioPnL = new PortfolioTracker().compute(holdings, priceMap);
    logger.info('portfolio pnl computed', {
      positions: portfolioPnL.positions.length,
      totalPnL: portfolioPnL.totalPnL,
      totalPnLPct: portfolioPnL.totalPnLPct.toFixed(2) + '%',
    });
  }
  const holdingsPnLMap = new Map<string, import('../src/types/portfolio.js').PositionPnL>();
  if (portfolioPnL) for (const p of portfolioPnL.positions) holdingsPnLMap.set(p.position.code, p);

  const favoriteResults: UniverseTop[] = [];
  for (const ticker of krCodes) {
    const card = buildCard(ticker);
    if (!card) continue;
    card.flow = flowMap.get(ticker) ?? null;
    card.consensus = consensusMap.get(ticker) ?? null;
    card.financial = financialMap.get(ticker) ?? null;
    card.qualityScore = scoreMap.get(ticker) ?? null;
    card.structuralRisk = srFilter.assess(ticker);
    card.pnl = holdingsPnLMap.get(ticker) ?? null;
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

  // 저평가 가치주 시드(40종) 중:
  //   - 외인·기관 20일 동반 순매수 + 품질 점수 B 이상 (50점+) → Top 10
  const krValueForeignResults: UniverseTop[] = [];
  for (const ticker of valueKrCodes) {
    const flow = flowMap.get(ticker);
    if (!flow) continue;
    if (flow.net20dForeigner == null || flow.net20dForeigner <= 0) continue;
    if (flow.net20dInstitutional == null || flow.net20dInstitutional <= 0) continue;
    const qs = scoreMap.get(ticker);
    if (!qs || qs.total < 50) continue; // 신규: B 등급 이상 (50점+) 필터
    const card = buildCard(ticker);
    if (!card) continue;
    card.flow = flow;
    card.consensus = consensusMap.get(ticker) ?? null;
    card.financial = financialMap.get(ticker) ?? null;
    card.qualityScore = qs;
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
  krValueForeignBuyTop = krValueForeignResults.slice(0, 10);

  // v1.1 — 가치주 스크리너 Top 5 (UniverseTop 어댑터)
  const topValueScores = rankValueScores([...valueScoreMap.values()], 5);
  const valueScreenerResults: UniverseTop[] = [];
  for (const vs of topValueScores) {
    const card = buildCard(vs.code);
    if (!card) continue;
    card.flow = flowMap.get(vs.code) ?? null;
    card.consensus = consensusMap.get(vs.code) ?? null;
    card.financial = financialMap.get(vs.code) ?? null;
    card.qualityScore = scoreMap.get(vs.code) ?? null;
    card.valuation = vs;
    // PBR/PER/ROE/시총은 NaverKr snapshot에서 보강 (buildCard는 Yahoo chart 기반이라 null)
    const naverSnap = allSnaps.get(vs.code);
    if (naverSnap) {
      card.snapshot.pbr = naverSnap.pbr;
      card.snapshot.per = naverSnap.per;
      card.snapshot.roe = naverSnap.roe;
      card.snapshot.marketCap = naverSnap.marketCap;
    }
    const ins = evaluateInsight(card, 'KR');
    valueScreenerResults.push({
      ticker: vs.code,
      name: vs.name,
      market: 'KR',
      card,
      insight: ins,
      score: vs.total,
      consensus: card.consensus,
    });
  }
  krValueScreenerTop = valueScreenerResults;

  // v1.3 — 100만원 코스피 매매 시그널 (관심+가치 후보 전체 평가) + v1.6 RS 팩터 + v1.7 구조 리스크/옵션만기 보정
  const { MarketEventCalendar: MEC } = await import('../src/analyzers/MarketEventCalendar.js');
  const eventsForSignal = MEC.getEvents();
  const isOptionExpiryDay = eventsForSignal.some(
    (e) => e.daysUntil === 0 && (e.kind === 'option_expiry' || e.kind === 'quadruple_witching'),
  );
  logger.info('signal engine context', { isOptionExpiryDay });
  const engine = new TradingSignalEngine();
  const allSignals: TradingSignal[] = [];
  for (const [code, snap] of allSnaps) {
    const card = buildCard(code);
    if (!card) continue;
    // NaverKr snapshot 데이터로 보강 (price/pbr/per/roe/52주)
    card.snapshot.price = snap.price ?? card.snapshot.price;
    card.snapshot.pbr = snap.pbr;
    card.snapshot.per = snap.per;
    card.snapshot.roe = snap.roe;
    card.snapshot.marketCap = snap.marketCap;
    card.snapshot.fiftyTwoWeekHigh = snap.fiftyTwoWeekHigh ?? card.snapshot.fiftyTwoWeekHigh;
    card.snapshot.fiftyTwoWeekLow = snap.fiftyTwoWeekLow ?? card.snapshot.fiftyTwoWeekLow;
    card.flow = flowMap.get(code) ?? null;
    card.financial = financialMap.get(code) ?? null;
    card.qualityScore = scoreMap.get(code) ?? null;
    card.valuation = valueScoreMap.get(code) ?? null;
    card.consensus = consensusMap.get(code) ?? null;
    // v1.6 — 상대 강도(RS): 종목 20일 수익률 vs 코스피 20일 수익률
    if (kospiReturn20d != null) {
      const closes = closesMap.get(code);
      if (closes && closes.length >= 21) {
        const last = closes[closes.length - 1]!;
        const back20 = closes[closes.length - 21]!;
        if (back20 > 0) {
          const stockReturn20d = (last - back20) / back20;
          card.relativeStrength = {
            stockReturn20d,
            benchmarkReturn20d: kospiReturn20d,
            rsPct: stockReturn20d - kospiReturn20d,
            benchmarkSymbol: BENCHMARK_SYMBOL,
          };
        }
      }
    }
    allSignals.push(engine.evaluate(card, { fearGreed: krFearGreed, isOptionExpiryDay }));
  }
  const planner = new PortfolioPlanner();
  krPortfolioPlan = planner.suggest(allSignals, { totalCapital: 1_000_000, slotCount: 3 });
  logger.info('trading signal plan', {
    totalSignals: allSignals.length,
    buyCount: allSignals.filter((s) => s.action === 'STRONG_BUY' || s.action === 'BUY').length,
    sellCount: allSignals.filter((s) => s.action === 'STRONG_SELL' || s.action === 'SELL').length,
    plan: krPortfolioPlan.slots.map((s) => ({
      code: s.signal.code, name: s.signal.name, action: s.signal.action,
      score: s.signal.score, shares: s.shares, cost: s.estimatedCost,
    })),
  });

  logger.info('universe selection', {
    favorites: krWatchTop.map((r) => ({ ticker: r.ticker, score: r.score })),
    valueForeignBuy: krValueForeignBuyTop.map((r) => ({ ticker: r.ticker, score: r.score })),
    valueScreener: krValueScreenerTop.map((r) => ({
      ticker: r.ticker, total: r.card.valuation?.total, badge: r.card.valuation?.badge,
    })),
  });

  const today = todayInSeoul();
  // v1.7 — 시장 이벤트 (이미 위에서 fetch했지만 표시용으로 다시 한번)
  const marketEvents = eventsForSignal;
  logger.info('market events', {
    upcoming: marketEvents.slice(0, 5).map((e) => ({
      kind: e.kind, date: e.date, daysUntil: e.daysUntil, severity: e.severity,
    })),
  });

  // v1.7 — 잔디 강력매수 알림 (75점+ STRONG_BUY · 구조리스크 HIGH 제외 · 52주 70% 이하 · 5d 동반 매수)
  const has5dBothBuy = new Map<string, boolean>();
  const structuralRiskMap = new Map<string, import('../src/types/structural-risk.js').StructuralRiskResult>();
  const position52wMap = new Map<string, number | null>();
  for (const sig of allSignals) {
    const flow = flowMap.get(sig.code);
    has5dBothBuy.set(sig.code,
      !!(flow && flow.net5dForeigner != null && flow.net5dInstitutional != null
        && flow.net5dForeigner > 0 && flow.net5dInstitutional > 0));
    structuralRiskMap.set(sig.code, srFilter.assess(sig.code));
    position52wMap.set(sig.code, sig.references.fiftyTwoWeekPositionPct);
  }
  const notifier = new JandiSignalNotifier();
  const dashboardUrl = process.env.DASHBOARD_PUBLIC_URL;
  const notifyResult = await notifier.notify(allSignals, {
    has5dBothBuy, structuralRisk: structuralRiskMap, position52w: position52wMap,
    ...(dashboardUrl ? { dashboardUrl } : {}),
  });
  logger.info('jandi notify result', notifyResult);

  const dashboard: DashboardPage = {
    generatedAt: new Date().toISOString(),
    today,
    krWatchTop,
    krValueForeignBuyTop,
    krValueScreenerTop,
    krPortfolioPlan,
    krFearGreed,
    kospiIndex: { value: kospiIndexValue, changePct: kospiIndexChangePct },
    volumeTop10,
    eodPicks,
    marketEvents,
    portfolioPnL,
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
