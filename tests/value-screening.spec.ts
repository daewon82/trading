import { test } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NaverKrSource } from '../src/sources/naver-kr/NaverKrSource.js';
import { TossKrFlowSource } from '../src/sources/toss-kr/TossKrFlowSource.js';
import { ValueScreener, rankValueScores } from '../src/analyzers/ValueScreener.js';
import {
  DEFAULT_VALUE_UNIVERSE,
  type SectorTag,
  type ValuationMetrics,
  type ValueScore,
} from '../src/types/valuation.js';
import type { FlowSummary } from '../src/types/flow.js';
import { logger } from '../src/utils/logger.js';

/**
 * v1.1 — 코스피 가치주 스크리너 spec.
 * - VALUE_UNIVERSE=005930,066570,... 환경변수로 종목 코드 지정 가능
 * - 미설정 시 DEFAULT_VALUE_UNIVERSE (claude.md §4.5) 사용
 * - 산출물: reports/value-screening-{ts}.json + .html
 */

interface UniverseItem {
  code: string;
  name: string;
  sector: SectorTag;
}

const universe: UniverseItem[] = resolveUniverse();
const metricsMap = new Map<string, ValuationMetrics>();
const flowMap = new Map<string, FlowSummary>();

test.describe.configure({ mode: 'serial' });

test('외인·기관 20일 수급 — Toss API 병렬 fetch', async () => {
  const toss = new TossKrFlowSource();
  const results = await Promise.all(
    universe.map(async ({ code }) => {
      const flow = await toss.fetch(code, 30);
      if (flow) flowMap.set(code, flow);
      return { code, ok: !!flow };
    }),
  );
  logger.info('value-screen flows fetched', {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
  });
});

for (const item of universe) {
  test(`Value KR ${item.code} (${item.name})`, async ({ page }) => {
    const src = new NaverKrSource();
    await src.open(page, item.code);
    const metrics = await src.extractValuation(page, item.code, item.sector);
    if (!metrics.name) metrics.name = item.name;
    metricsMap.set(item.code, metrics);
    logger.info('valuation metrics', {
      code: item.code,
      name: metrics.name,
      pbr: metrics.pbr,
      per: metrics.per,
      roe: metrics.roe,
    });
  });
}

test.afterAll(async () => {
  if (metricsMap.size === 0) {
    logger.warn('value-screen: no metrics collected, skipping report');
    return;
  }
  const screener = new ValueScreener();
  const allScores: ValueScore[] = [];
  const filterTrace: Array<{ code: string; name: string; passed: boolean; reason?: string }> = [];

  for (const item of universe) {
    const m = metricsMap.get(item.code);
    if (!m) {
      filterTrace.push({ code: item.code, name: item.name, passed: false, reason: 'metrics 미수집' });
      continue;
    }
    const flow = flowMap.get(item.code) ?? null;
    const passed = screener.passesFilter(m, flow);
    if (!passed) {
      filterTrace.push({
        code: item.code,
        name: m.name || item.name,
        passed: false,
        reason: explainFilterFailure(m, flow),
      });
      continue;
    }
    const score = screener.score(m, flow);
    allScores.push(score);
    filterTrace.push({ code: item.code, name: score.name, passed: true });
  }

  const top = rankValueScores(allScores, 5);
  logger.info('value-screen results', {
    universe: universe.length,
    passed: allScores.length,
    top: top.map((s) => ({ code: s.code, name: s.name, total: s.total, badge: s.badge })),
  });

  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  const jsonPath = resolve(`reports/value-screening-${ts}.json`);
  const htmlPath = resolve(`reports/value-screening-${ts}.html`);
  const payload = {
    generatedAt: new Date().toISOString(),
    universeSize: universe.length,
    passedCount: allScores.length,
    top,
    allScores,
    filterTrace,
  };
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await writeFile(htmlPath, renderHtml(payload), 'utf8');
  logger.info('value-screen report written', { jsonPath, htmlPath });
});

function resolveUniverse(): UniverseItem[] {
  const env = process.env.VALUE_UNIVERSE?.trim();
  if (!env) return [...DEFAULT_VALUE_UNIVERSE];
  const lookup = new Map(DEFAULT_VALUE_UNIVERSE.map((u) => [u.code, u]));
  return env
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((code) => lookup.get(code) ?? { code, name: code, sector: '기타' as SectorTag });
}

function explainFilterFailure(m: ValuationMetrics, flow: FlowSummary | null): string {
  const reasons: string[] = [];
  if (m.pbr == null) reasons.push('PBR null');
  else if (m.pbr > 1.0) reasons.push(`PBR ${m.pbr.toFixed(2)}>1.0`);
  if (m.per == null) reasons.push('PER null');
  else if (m.per <= 0 || m.per > 15) reasons.push(`PER ${m.per.toFixed(2)}∉(0,15]`);
  if (m.roe == null) reasons.push('ROE null');
  else if (m.roe < 8) reasons.push(`ROE ${m.roe.toFixed(2)}<8`);
  if (m.marketCap == null) reasons.push('시총 null');
  else if (m.marketCap < 500_000_000_000) reasons.push(`시총 ${(m.marketCap / 1e8).toFixed(0)}억<5000억`);
  if (!flow) reasons.push('flow 없음');
  else {
    if (flow.net20dForeigner == null || flow.net20dForeigner <= 0) reasons.push('외인20d≤0');
    if (flow.net20dInstitutional == null || flow.net20dInstitutional <= 0) reasons.push('기관20d≤0');
  }
  return reasons.join(', ') || '알 수 없음';
}

interface ReportPayload {
  generatedAt: string;
  universeSize: number;
  passedCount: number;
  top: ValueScore[];
  allScores: ValueScore[];
  filterTrace: Array<{ code: string; name: string; passed: boolean; reason?: string }>;
}

function renderHtml(p: ReportPayload): string {
  const cards = p.top.length === 0
    ? `<p class="empty">스크리닝 통과 종목이 없습니다. 시장 전반 고평가 구간일 수 있습니다.</p>`
    : p.top.map((s, i) => renderCard(s, i + 1)).join('\n');
  const trace = p.filterTrace
    .map(
      (t) =>
        `<tr class="${t.passed ? 'pass' : 'fail'}"><td>${esc(t.code)}</td><td>${esc(t.name)}</td><td>${t.passed ? '✅ 통과' : '❌ 제외'}</td><td>${esc(t.reason ?? '')}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>코스피 가치주 스크리너 Top 5</title>
  <style>
    body { font-family: -apple-system, "Pretendard", sans-serif; margin: 0; color: #222; background: #fafafa; }
    header { padding: 20px 24px; background: #fff; border-bottom: 1px solid #eee; }
    h1 { margin: 0 0 6px; font-size: 1.4em; }
    .meta { color: #888; font-size: .9em; }
    .disclaimer { background: #fff7e6; border-left: 4px solid #f5a623; padding: 10px 14px; margin: 14px 0 0; font-size: .9em; color: #555; line-height: 1.5; }
    section { padding: 20px 24px; }
    h2 { margin: 0 0 12px; font-size: 1.15em; }
    .intro { font-size: .9em; color: #555; line-height: 1.55; margin: 0 0 14px; padding: 10px 12px; background: #fff; border-left: 3px solid #1976d2; border-radius: 4px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
    .card { background: #fff; border: 1px solid #ffe082; border-radius: 8px; padding: 14px 16px; display: flex; gap: 12px; }
    .card.gold { background: #fff8e1; border-color: #f9a825; border-width: 2px; }
    .rank { font-size: 1.5em; font-weight: 700; color: #ef6c00; min-width: 40px; text-align: center; }
    .body { flex: 1; }
    .name { font-size: 1.05em; font-weight: 600; margin: 0 0 4px; }
    .code { color: #888; font-weight: normal; font-size: .85em; margin-left: 4px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: .75em; font-weight: 700; margin-left: 8px; vertical-align: middle; }
    .badge-premium { background: #1565c0; color: #fff; }
    .badge-candidate { background: #f9a825; color: #fff; }
    .sector { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: .75em; background: #eceff1; color: #455a64; margin-left: 6px; vertical-align: middle; }
    .sector.lead { background: #d32f2f; color: #fff; }
    .total { margin: 6px 0; font-size: 1.1em; font-weight: 700; color: #1565c0; }
    .total .max { font-size: .8em; color: #888; font-weight: 500; }
    .metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin: 8px 0; font-size: .85em; }
    .metric { background: #f7f9fc; padding: 6px 8px; border-radius: 4px; }
    .metric .k { color: #888; font-size: .82em; }
    .metric .v { font-weight: 600; font-variant-numeric: tabular-nums; }
    details { font-size: .85em; margin-top: 6px; }
    summary { cursor: pointer; color: #666; }
    .bd-rows { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin-top: 6px; }
    .bd-rows > div { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dashed #eee; }
    .empty { color: #888; padding: 20px; text-align: center; background: #fff; border-radius: 6px; }
    .trace { width: 100%; border-collapse: collapse; font-size: .85em; margin-top: 12px; }
    .trace th, .trace td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
    .trace th { background: #f4f4f4; }
    .trace tr.pass td:nth-child(3) { color: #2e7d32; font-weight: 600; }
    .trace tr.fail td:nth-child(3) { color: #c62828; }
    .trace tr.fail td:nth-child(4) { color: #999; font-size: .82em; }
    footer { padding: 16px 24px; background: #f7f9fc; border-top: 1px solid #e6e6e6; color: #666; font-size: .85em; line-height: 1.5; }
  </style>
</head>
<body>
  <header>
    <h1>🏆 코스피 가치주 스크리너 Top 5</h1>
    <div class="meta">생성 ${esc(p.generatedAt)} · 유니버스 ${p.universeSize}종 → 통과 ${p.passedCount}종</div>
    <p class="disclaimer">⚠️ 본 라벨은 룰 기반 시그널이며 매매 권유가 아닙니다. 모든 투자 판단과 결과 책임은 사용자에게 있습니다.</p>
  </header>
  <section>
    <h2>🏆 Top 5 — 멀티팩터 점수 기준</h2>
    <p class="intro">조건(AND): PBR ≤ 1.0 · PER ≤ 15 · ROE ≥ 8% · 외인+기관 20일 동반 순매수 · 시총 ≥ 5,000억원. 점수 70↑ 💎 가치 우량, 50~69 🔍 가치 후보. 주도 섹터(반도체·조선·방산·은행/금융) +5 보너스.</p>
    <div class="cards">
${cards}
    </div>
  </section>
  <section>
    <h2>전체 스크리닝 결과</h2>
    <table class="trace">
      <thead><tr><th>코드</th><th>종목명</th><th>결과</th><th>사유 / 점수</th></tr></thead>
      <tbody>${trace}</tbody>
    </table>
  </section>
  <footer>
    스크리닝 룰 — claude.md §4.5 참조. 데이터 소스: 네이버 금융(PBR/PER/ROE/시총) + 토스증권 API(외인·기관 20일 누적).
  </footer>
</body>
</html>`;
}

function renderCard(s: ValueScore, rank: number): string {
  const isGold = s.badge === '가치 우량';
  const badge = s.badge === '가치 우량'
    ? `<span class="badge badge-premium">💎 가치 우량</span>`
    : s.badge === '가치 후보'
      ? `<span class="badge badge-candidate">🔍 가치 후보</span>`
      : '';
  const sectorCls = ['반도체', '조선', '방산', '은행/금융'].includes(s.sector) ? 'sector lead' : 'sector';
  const sectorIcon = sectorEmoji(s.sector);
  const m = s.metrics;
  const b = s.breakdown;
  return `      <article class="card${isGold ? ' gold' : ''}">
        <div class="rank">#${rank}</div>
        <div class="body">
          <div class="name">${esc(s.name)}<span class="code">${esc(s.code)}</span>${badge}<span class="${sectorCls}">${sectorIcon} ${esc(s.sector)}</span></div>
          <div class="total">${s.total}<span class="max">/100</span></div>
          <div class="metrics">
            <div class="metric"><div class="k">PBR</div><div class="v">${fmt(m.pbr, 2)}</div></div>
            <div class="metric"><div class="k">PER</div><div class="v">${fmt(m.per, 2)}</div></div>
            <div class="metric"><div class="k">ROE</div><div class="v">${fmt(m.roe, 1)}%</div></div>
          </div>
          <details>
            <summary>점수 상세</summary>
            <div class="bd-rows">
              <div><span>PBR</span><b>${b.pbr.toFixed(1)}/20</b></div>
              <div><span>PER</span><b>${b.per.toFixed(1)}/20</b></div>
              <div><span>ROE</span><b>${b.roe.toFixed(1)}/20</b></div>
              <div><span>외인 20d</span><b>${b.foreignerFlow.toFixed(1)}/20</b></div>
              <div><span>기관 20d</span><b>${b.institutionalFlow.toFixed(1)}/20</b></div>
              <div><span>섹터 보너스</span><b>${b.sectorBonus}/5</b></div>
            </div>
          </details>
        </div>
      </article>`;
}

function sectorEmoji(s: SectorTag): string {
  switch (s) {
    case '반도체': return '💻';
    case '조선': return '🚢';
    case '방산': return '🛡️';
    case '은행/금융': return '🏦';
    case '자동차': return '🚗';
    case '통신': return '📡';
    case '전자': return '🔌';
    case '에너지': return '⚡';
    default: return '🏷️';
  }
}

function fmt(v: number | null, digits: number): string {
  return v == null ? '—' : v.toFixed(digits);
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
