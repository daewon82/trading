import { test } from '@playwright/test';
import { writeFile, mkdir, copyFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { NaverGlobalSource } from '../src/sources/naver-global/NaverGlobalSource.js';
import { NaverKrFlowSource } from '../src/sources/naver-kr/NaverKrFlowSource.js';
import {
  fetchDailyChart,
  resolveCandidates,
  fetchMacroQuote,
} from '../src/sources/timeseries/YahooChartSource.js';
import { DashboardBuilder } from '../src/analyzers/DashboardBuilder.js';
import { computeIndicators } from '../src/analyzers/TechnicalIndicators.js';
import { evaluateInsight } from '../src/reporters/DashboardReporter.js';
import { fetchRssFeed } from '../src/sources/news/RssSource.js';
import {
  DashboardReporter,
  type DashboardPage,
} from '../src/reporters/DashboardReporter.js';
import { JandiNotifier } from '../src/notifications/JandiNotifier.js';
import {
  fetchWeeklyForecast,
  SEOUL,
  GOYANG,
} from '../src/sources/weather/openMeteo.js';
import type { StockSnapshot } from '../src/types/stock.js';
import type { WeatherForecast } from '../src/types/weather.js';
import type { IndicatorSet } from '../src/types/timeseries.js';
import type { FlowSummary } from '../src/types/flow.js';
import type { MacroQuote } from '../src/types/macro.js';
import type { NewsSection } from '../src/types/news.js';
import type {
  ChangelogEntry,
  ChangelogMeta,
  SeedSnapshot,
  SectionKey,
} from '../src/types/changelog.js';
import { logger } from '../src/utils/logger.js';

// 필수: 005930 삼성전자, 000660 SK하이닉스 (반도체)
// 추가 10종 (섹터 분산, 시총·외국인 보유·유동성 기준) — 사용자 요청 총 12종:
// NAVER(035420)·카카오(035720) 제거 — 직전 분석에서 매도 우호 우세 + 약세 신호 다수
// 강세 섹터로 교체: HD현대중공업(조선), 한화에어로스페이스(방산)
//   373220 LG에너지솔루션 (2차전지)
//   003670 포스코퓨처엠 (2차전지 양극재)
//   005380 현대차 (자동차)
//   000270 기아 (자동차)
//   068270 셀트리온 (바이오)
//   105560 KB금융 (금융)
//   066570 LG전자 (가전·전기)
//   028260 삼성물산 (지주)
//   329180 HD현대중공업 (조선) — 최근 강세 섹터
//   012450 한화에어로스페이스 (방산) — 최근 강세 섹터
const DEFAULT_KR =
  '005930,000660,373220,003670,005380,000270,068270,105560,066570,028260,329180,012450';
const DEFAULT_US = 'AAPL,MSFT,GOOGL,AMZN,NVDA,TSLA';

// 가치 평가 기준 후보 (스크리닝 시드, 추천 X)
// 객관 근거: 저PER / 저PBR / 고배당 / 시총 상위로 자주 거론되는 한국 대형주
// 가치 함정(value trap) 위험 있음 — 본인 검증 필수
const DEFAULT_VALUE_KR =
  '005490,012330,017670,033780,086790,055550,032830,024110,267250,051910';

// KR universe pool — KOSPI/KOSDAQ 시총 상위 + 거래량 풍부 종목 (30종)
// 매일 cron 시 평가 → 매수 우호 net 점수 상위 10종 자동 선정
const KR_WATCH_POOL = [
  '005930', '000660', '373220', '005380', '000270', '035420', '035720', '005490',
  '003670', '207940', '068270', '105560', '086790', '055550', '028260', '066570',
  '012330', '329180', '012450', '017670', '030200', '033780', '032830', '015760',
  '024110', '267260', '042700', '247540', '086520', '051910',
];

// US value pool — 가치주(저PER/배당/안정) + 시총 대형주 (35종)
// 평가 후 Q4(고평가) 자동 제외 + 매수 우세 가중 → 상위 10종
const US_VALUE_POOL = [
  'BRK-B', 'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'KO', 'PEP', 'PG',
  'WMT', 'HD', 'JNJ', 'PFE', 'MRK', 'BMY', 'XOM', 'CVX', 'COP', 'T',
  'VZ', 'IBM', 'INTC', 'CSCO', 'MMM',
  // 추가 가치주 후보 (저평가 가능성 ↑)
  'DIS', 'TGT', 'F', 'KHC', 'CL', 'MCD', 'LOW', 'UPS', 'DUK', 'O',
];

// US growth pool — 빅테크 + 모멘텀 성장주 (12종)
// 평가 후 매수 우호 net 점수 상위 5종 자동 선정
const US_GROWTH_POOL = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META',
  'AMD', 'AVGO', 'CRM', 'NOW', 'NFLX',
];

// KR 종목 코드 → 한글 종목명 매핑 (Yahoo chart longName이 영문이라 보정)
const KR_NAMES: Record<string, string> = {
  '005930': '삼성전자', '000660': 'SK하이닉스', '373220': 'LG에너지솔루션',
  '005380': '현대차', '000270': '기아', '035420': 'NAVER', '035720': '카카오',
  '005490': 'POSCO홀딩스', '003670': '포스코퓨처엠', '207940': '삼성바이오로직스',
  '068270': '셀트리온', '105560': 'KB금융', '086790': '하나금융지주',
  '055550': '신한지주', '028260': '삼성물산', '066570': 'LG전자',
  '012330': '현대모비스', '329180': 'HD현대중공업', '012450': '한화에어로스페이스',
  '017670': 'SK텔레콤', '030200': 'KT', '033780': 'KT&G', '032830': '삼성생명',
  '015760': '한국전력', '024110': '기업은행', '267260': 'HD현대일렉트릭',
  '042700': '한미반도체', '247540': '에코프로비엠', '086520': '에코프로',
  '051910': 'LG화학', '267250': 'HD현대', '006400': '삼성SDI',
};

// 미국 빅테크 일부도 한글 표기 (사용자 친숙)
const US_NAMES: Record<string, string> = {
  AAPL: '애플', MSFT: '마이크로소프트', GOOGL: '구글(알파벳)',
  AMZN: '아마존', NVDA: '엔비디아', TSLA: '테슬라', META: '메타',
  'BRK-B': '버크셔해서웨이', JPM: 'JP모건', BAC: '뱅크오브아메리카',
  WFC: '웰스파고', C: '씨티그룹', GS: '골드만삭스', MS: '모건스탠리',
  KO: '코카콜라', PEP: '펩시코', PG: '프록터앤갬블', WMT: '월마트',
  HD: '홈디포', JNJ: '존슨앤존슨', PFE: '화이자', MRK: '머크',
  BMY: '브리스톨마이어스', XOM: '엑손모빌', CVX: '셰브론', COP: '코노코필립스',
  T: 'AT&T', VZ: '버라이즌', IBM: 'IBM', INTC: '인텔', CSCO: '시스코', MMM: '3M',
  DIS: '디즈니', TGT: '타겟', F: '포드', KHC: '크래프트하인즈',
  CL: '콜게이트', MCD: '맥도날드', LOW: '로우스', UPS: 'UPS',
  DUK: '듀크에너지', O: '리얼티인컴',
  AMD: 'AMD', AVGO: '브로드컴', CRM: '세일즈포스', NOW: '서비스나우', NFLX: '넷플릭스',
};
const krCodes = (process.env.KR_DASHBOARD_CODES ?? DEFAULT_KR)
  .split(',').map((s) => s.trim()).filter(Boolean);
const usTickers = (process.env.US_DASHBOARD_TICKERS ?? DEFAULT_US)
  .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const valueKrCodes = (process.env.KR_VALUE_CANDIDATES ?? DEFAULT_VALUE_KR)
  .split(',').map((s) => s.trim()).filter(Boolean);

const krSnaps: StockSnapshot[] = [];
const usSnaps: StockSnapshot[] = [];
const valueKrSnaps: StockSnapshot[] = [];
let weatherForecasts: WeatherForecast[] = [];
const indicatorMap = new Map<string, IndicatorSet>();
const closesMap = new Map<string, number[]>();
const flowMap = new Map<string, FlowSummary>();
const range52Map = new Map<string, { high: number | null; low: number | null }>();
let macros: MacroQuote[] = [];
let newsSections: NewsSection[] = [];
const nameMap = new Map<string, string>();
let krWatchTop: import('../src/reporters/DashboardReporter.js').UniverseTop[] = [];
let usValueTop: import('../src/reporters/DashboardReporter.js').UniverseTop[] = [];
let usGrowthTop: import('../src/reporters/DashboardReporter.js').UniverseTop[] = [];
const SPARKLINE_DAYS = 60;
const MACRO_SYMBOLS: Array<{ symbol: string; name: string; unit: string }> = [
  { symbol: '^KS11', name: '코스피', unit: '' },
  { symbol: 'KRW=X', name: '원/달러', unit: '원' },
  { symbol: '^TNX', name: '미 10년물', unit: '%' },
];

test.describe.configure({ mode: 'serial' });

test('주간 날씨 (서울/고양시)', async () => {
  weatherForecasts = await Promise.all([
    fetchWeeklyForecast(SEOUL),
    fetchWeeklyForecast(GOYANG),
  ]);
  logger.info('weather fetched', {
    cities: weatherForecasts.map((f) => f.city),
    days: weatherForecasts[0]?.days.length ?? 0,
  });
});

test('경제 기사 (KR 5건 + US 3건)', async () => {
  const [krItems, usItems] = await Promise.all([
    fetchRssFeed('https://www.yna.co.kr/rss/economy.xml', '연합뉴스', 5),
    fetchRssFeed('https://finance.yahoo.com/news/rssindex', 'Yahoo Finance', 3),
  ]);
  newsSections = [];
  if (krItems.length > 0) {
    newsSections.push({ region: 'KR', source: '연합뉴스 경제', items: krItems });
  }
  if (usItems.length > 0) {
    newsSections.push({ region: 'US', source: 'Yahoo Finance', items: usItems });
  }
  logger.info('news fetched', { kr: krItems.length, us: usItems.length });
});

test('거시 환경 (KOSPI / 원/달러 / 미국 10년물)', async () => {
  const results = await Promise.all(
    MACRO_SYMBOLS.map((m) => fetchMacroQuote(m.symbol, m.name, m.unit)),
  );
  macros = results.filter((q): q is MacroQuote => q != null);
  logger.info('macros fetched', {
    count: macros.length,
    quotes: macros.map((m) => ({ name: m.name, value: m.value, pct: m.changePercent })),
  });
});

test('시계열 + 기술적 지표 + sparkline + universe pool (병렬 fetch)', async () => {
  // 중복 제거: 메인/가치/universe pool 합쳐 한 번만 fetch
  const allTickers = new Map<string, 'KR' | 'US'>();
  for (const c of krCodes) allTickers.set(c, 'KR');
  for (const t of usTickers) allTickers.set(t, 'US');
  for (const c of valueKrCodes) allTickers.set(c, 'KR');
  for (const c of KR_WATCH_POOL) if (!allTickers.has(c)) allTickers.set(c, 'KR');
  for (const t of US_VALUE_POOL) if (!allTickers.has(t)) allTickers.set(t, 'US');
  for (const t of US_GROWTH_POOL) if (!allTickers.has(t)) allTickers.set(t, 'US');

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
  logger.info('indicators + universe fetched', {
    total: results.length,
    indicators: indicatorMap.size,
  });
});

for (const code of krCodes) {
  test(`KR ${code}`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, code);
    const snap = await src.extractSnapshot(page, code);
    krSnaps.push(snap);
    logger.info('KR snapshot', {
      code,
      name: snap.name,
      price: snap.price,
      pos52w: pos(snap),
    });

    // 같은 page로 외국인/기관 매매동향 페이지로 이동해 수급 추출
    const flow = await new NaverKrFlowSource().fetch(page, code);
    if (flow) {
      flowMap.set(code, flow);
      logger.info('KR flow', {
        code,
        net5dForeigner: flow.net5dForeigner,
        net5dInstitutional: flow.net5dInstitutional,
        days: flow.daily.length,
      });
    }
  });
}

for (const ticker of usTickers) {
  test(`US ${ticker}`, async ({ page }) => {
    const src = new NaverGlobalSource();
    await src.open(page, ticker);
    const snap = await src.extractSnapshot(page, ticker);
    usSnaps.push(snap);
    logger.info('US snapshot', {
      ticker,
      price: snap.price,
      marketCap: snap.marketCap,
      pos52w: pos(snap),
    });
  });
}

for (const code of valueKrCodes) {
  test(`Value KR ${code}`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, code);
    const snap = await src.extractSnapshot(page, code);
    valueKrSnaps.push(snap);
    logger.info('Value KR snapshot', {
      code,
      name: snap.name,
      price: snap.price,
      pos52w: pos(snap),
    });

    // 가치 후보도 외인/기관 수급 fetch (KR이라 가능)
    const flow = await new NaverKrFlowSource().fetch(page, code);
    if (flow) {
      flowMap.set(code, flow);
    }
  });
}

test.afterAll(async () => {
  if (krSnaps.length === 0 && usSnaps.length === 0) return;

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
  fixup52w(usSnaps);
  fixup52w(valueKrSnaps);

  const builder = new DashboardBuilder();
  const ctx = { indicators: indicatorMap, closes: closesMap, flows: flowMap };
  const krSection = builder.build(krSnaps, ctx);
  const usSection = builder.build(usSnaps, { indicators: indicatorMap, closes: closesMap });
  const valueSection = valueKrSnaps.length > 0 ? builder.build(valueKrSnaps, ctx) : null;

  // Universe selection — Yahoo meta 기반으로 dummy snapshot 만들고 평가
  const buildUniverseCard = (
    ticker: string,
    market: 'KR' | 'US',
  ): import('../src/types/stock.js').DashboardCard | null => {
    const closes = closesMap.get(ticker);
    const range = range52Map.get(ticker);
    if (!closes || closes.length < 2 || !range) return null;
    const price = closes[closes.length - 1]!;
    const yesterday = closes[closes.length - 2]!;
    const changePercent = yesterday > 0 ? ((price - yesterday) / yesterday) * 100 : null;
    const localName = market === 'KR'
      ? (KR_NAMES[ticker] ?? nameMap.get(ticker))
      : (US_NAMES[ticker] ?? nameMap.get(ticker));
    const snap: StockSnapshot = {
      code: ticker,
      name: localName ?? ticker,
      market,
      currency: market === 'KR' ? 'KRW' : 'USD',
      source: market === 'KR' ? 'naver-kr' : 'yahoo',
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
    const sec = builder.build([snap], { indicators: indicatorMap, closes: closesMap });
    return sec.cards[0] ?? null;
  };

  // KR pool — net 점수 큰 순으로 정렬, 동률은 cautious 적은 순
  const krResults: import('../src/reporters/DashboardReporter.js').UniverseTop[] = [];
  for (const ticker of KR_WATCH_POOL) {
    const card = buildUniverseCard(ticker, 'KR');
    if (!card) continue;
    const ins = evaluateInsight(card, 'KR');
    krResults.push({
      ticker,
      name: card.snapshot.name,
      market: 'KR',
      card,
      insight: ins,
      score: ins.bullish.length - ins.bearish.length,
    });
  }
  krResults.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.insight.cautious.length - b.insight.cautious.length;
  });
  krWatchTop = krResults.slice(0, 10);

  // US pool — Q4(고평가) 하드 필터 + 저평가 가중치(Q1=+5, Q2=+2, Q3=0) 적용
  const usResults: import('../src/reporters/DashboardReporter.js').UniverseTop[] = [];
  for (const ticker of US_VALUE_POOL) {
    const card = buildUniverseCard(ticker, 'US');
    if (!card) continue;
    if (card.quartile === 4) continue; // 고평가 영역은 "저평가 후보"에서 제외
    const ins = evaluateInsight(card, 'US');
    const valueWeight =
      card.quartile === 1 ? 5 : card.quartile === 2 ? 2 : 0;
    usResults.push({
      ticker,
      name: card.snapshot.name,
      market: 'US',
      card,
      insight: ins,
      score: ins.bullish.length - ins.bearish.length + valueWeight,
    });
  }
  usResults.sort((a, b) => b.score - a.score);
  usValueTop = usResults.slice(0, 10);

  // US growth pool — 매수 우호 net 점수 상위 5
  const growthResults: import('../src/reporters/DashboardReporter.js').UniverseTop[] = [];
  for (const ticker of US_GROWTH_POOL) {
    const card = buildUniverseCard(ticker, 'US');
    if (!card) continue;
    const ins = evaluateInsight(card, 'US');
    growthResults.push({
      ticker,
      name: card.snapshot.name,
      market: 'US',
      card,
      insight: ins,
      score: ins.bullish.length - ins.bearish.length,
    });
  }
  growthResults.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.insight.cautious.length - b.insight.cautious.length;
  });
  usGrowthTop = growthResults.slice(0, 5);

  logger.info('universe selection', {
    krTop: krWatchTop.map((r) => ({ ticker: r.ticker, score: r.score })),
    usTop: usValueTop.map((r) => ({ ticker: r.ticker, score: r.score, q: r.card.quartile })),
  });

  // Changelog: 직전 meta와 비교해 추가/삭제 종목 + 평가 사유 추출
  const today = todayInSeoul();
  const currentSeeds: SeedSnapshot[] = [
    ...krSection.cards.map((c) => seedOf(c, 'KR')),
    ...usSection.cards.map((c) => seedOf(c, 'US')),
    ...(valueSection?.cards.map((c) => seedOf(c, 'Value')) ?? []),
  ];
  const prevMeta = await readPrevMeta();
  const changes = buildChangelog(prevMeta, today, currentSeeds);
  await writeMeta({ date: today, generatedAt: new Date().toISOString(), seeds: currentSeeds });

  const dashboard: DashboardPage = {
    generatedAt: new Date().toISOString(),
    today,
    weather: weatherForecasts,
    macros,
    kr: krSection,
    us: usSection,
    valueKr: valueSection,
    changes,
    news: newsSections,
    krWatchTop,
    usValueTop,
    usGrowthTop,
  };
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  const jsonPath = resolve(`reports/dashboard-${ts}.json`);
  const htmlPath = resolve(`reports/dashboard-${ts}.html`);
  await writeFile(jsonPath, JSON.stringify(dashboard, null, 2), 'utf8');
  await new DashboardReporter().write(dashboard, htmlPath);

  // GitHub Pages 용 docs/ 갱신 — main 브랜치의 docs/ 폴더가 Pages source
  await mkdir('docs/history', { recursive: true });
  const docsIndex = resolve('docs/index.html');
  const docsHistory = resolve(`docs/history/dashboard-${ts}.html`);
  await copyFile(htmlPath, docsIndex);
  await copyFile(htmlPath, docsHistory);

  logger.info('dashboard written', {
    krCount: krSnaps.length,
    usCount: usSnaps.length,
    htmlPath,
    docsIndex,
  });

  const webhook = process.env.JANDI_WEBHOOK_URL;
  if (webhook) {
    const publicUrl = process.env.DASHBOARD_PUBLIC_URL ?? null;
    const publicHistoryUrl = publicUrl
      ? `${publicUrl.replace(/\/$/, '')}/history/dashboard-${ts}.html`
      : null;
    try {
      await new JandiNotifier().send(dashboard, {
        webhookUrl: webhook,
        htmlAbsolutePath: htmlPath,
        publicUrl,
        publicHistoryUrl,
      });
      logger.info('jandi notification sent', { publicUrl, publicHistoryUrl });
    } catch (err) {
      logger.error('jandi notification failed', { err: String(err) });
    }
  } else {
    logger.info('jandi skipped — JANDI_WEBHOOK_URL not set');
  }
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

function seedOf(card: import('../src/types/stock.js').DashboardCard, section: SectionKey): SeedSnapshot {
  const market: 'KR' | 'US' = section === 'US' ? 'US' : 'KR';
  const ins = evaluateInsight(card, market);
  return {
    code: card.snapshot.code,
    name: card.snapshot.name,
    section,
    dominantLabel: ins.dominance.dominantLabel,
    reasoning: ins.reasoning,
  };
}

const META_PATH = 'docs/dashboard-meta.json';

async function readPrevMeta(): Promise<ChangelogMeta | null> {
  try {
    const raw = await readFile(META_PATH, 'utf8');
    return JSON.parse(raw) as ChangelogMeta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: ChangelogMeta): Promise<void> {
  await mkdir('docs', { recursive: true });
  await writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
}

function buildChangelog(
  prev: ChangelogMeta | null,
  today: string,
  current: SeedSnapshot[],
): ChangelogEntry {
  if (!prev) {
    return { fromDate: null, toDate: today, added: [], removed: [] };
  }
  const prevByCode = new Map(prev.seeds.map((s) => [s.code, s]));
  const curByCode = new Map(current.map((s) => [s.code, s]));
  const added = current
    .filter((s) => !prevByCode.has(s.code))
    .map((s) => ({
      code: s.code,
      name: s.name,
      section: s.section,
      currentDominant: s.dominantLabel,
      currentReasoning: s.reasoning,
    }));
  const removed = prev.seeds
    .filter((s) => !curByCode.has(s.code))
    .map((s) => ({
      code: s.code,
      name: s.name,
      section: s.section,
      lastDominant: s.dominantLabel,
      lastReasoning: s.reasoning,
    }));
  return { fromDate: prev.date, toDate: today, added, removed };
}

function pos(s: StockSnapshot): number | null {
  if (s.price == null || s.fiftyTwoWeekLow == null || s.fiftyTwoWeekHigh == null) return null;
  if (s.fiftyTwoWeekHigh === s.fiftyTwoWeekLow) return null;
  return ((s.price - s.fiftyTwoWeekLow) / (s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow)) * 100;
}
