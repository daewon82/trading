import { test } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TossKrFlowSource } from '../src/sources/toss-kr/TossKrFlowSource.js';
import { FlowSignalBacktest } from '../src/backtest/FlowSignalBacktest.js';
import type { BacktestReport, SignalEvent } from '../src/backtest/types.js';
import { HORIZONS } from '../src/backtest/types.js';
import { logger } from '../src/utils/logger.js';

/**
 * v1.5 — 외인+기관 동반 신호 사후 수익률 백테스트 spec.
 *
 * Universe: dashboard.spec.ts와 동기화된 코스피 44종 (보유 5 + 가치 후보 39)
 * 데이터: Toss API 200일치 (약 10개월) — API size 상한 200으로 확장 불가. 더 긴 기간이 필요하면 KRX/Naver 어댑터 추가 필요.
 * 결과: reports/flow-backtest-{ts}.{json,html}
 */

const KR_UNIVERSE: Array<{ code: string; name: string }> = [
  // 보유 종목 5종 (dashboard.spec.ts DEFAULT_KR와 동기화)
  { code: '017670', name: 'SK텔레콤' },
  { code: '000270', name: '기아' },
  { code: '036570', name: 'NC' },
  { code: '008770', name: '호텔신라' },
  { code: '005930', name: '삼성전자' },
  // 가치주 후보 39종 (dashboard.spec.ts DEFAULT_VALUE_KR와 동기화)
  { code: '105560', name: 'KB금융' },
  { code: '086790', name: '하나금융지주' },
  { code: '055550', name: '신한지주' },
  { code: '316140', name: '우리금융지주' },
  { code: '024110', name: '기업은행' },
  { code: '032830', name: '삼성생명' },
  { code: '000810', name: '삼성화재' },
  { code: '138040', name: '메리츠금융지주' },
  { code: '029780', name: '삼성카드' },
  { code: '006800', name: '미래에셋증권' },
  { code: '071050', name: '한국금융지주' },
  { code: '030200', name: 'KT' },
  { code: '015760', name: '한국전력' },
  { code: '005490', name: 'POSCO홀딩스' },
  { code: '051910', name: 'LG화학' },
  { code: '011170', name: '롯데케미칼' },
  { code: '010130', name: '고려아연' },
  { code: '004020', name: '현대제철' },
  { code: '096770', name: 'SK이노베이션' },
  { code: '010950', name: 'S-Oil' },
  { code: '012330', name: '현대모비스' },
  { code: '005380', name: '현대차' },
  { code: '161390', name: '한국타이어' },
  { code: '009540', name: 'HD한국조선해양' },
  { code: '012450', name: '한화에어로스페이스' },
  { code: '047810', name: '한국항공우주' },
  { code: '267250', name: 'HD현대' },
  { code: '006360', name: 'GS건설' },
  { code: '000720', name: '현대건설' },
  { code: '078930', name: 'GS' },
  { code: '001040', name: 'CJ' },
  { code: '028260', name: '삼성물산' },
  { code: '003550', name: 'LG' },
  { code: '086280', name: '현대글로비스' },
  { code: '011200', name: 'HMM' },
  { code: '000120', name: 'CJ대한통운' },
  { code: '003490', name: '대한항공' },
  { code: '033780', name: 'KT&G' },
  { code: '069960', name: '현대백화점' },
];

const WINDOW_DAYS = 200;
const COST_BPS = 40; // round-trip 0.4%

test('Flow signal backtest — 46종 × 200일 사후 수익률 통계', async () => {
  test.setTimeout(180_000);
  const toss = new TossKrFlowSource();
  const backtest = new FlowSignalBacktest();
  const allEvents: SignalEvent[] = [];

  const fetched = await Promise.all(
    KR_UNIVERSE.map(async ({ code, name }) => {
      const flow = await toss.fetch(code, WINDOW_DAYS);
      if (!flow || flow.daily.length < 50) return { code, ok: false, eventCount: 0 };
      const events = backtest.detectEvents(code, name, flow.daily);
      allEvents.push(...events);
      return { code, ok: true, eventCount: events.length };
    }),
  );

  logger.info('flow-backtest fetched', {
    universe: KR_UNIVERSE.length,
    ok: fetched.filter((r) => r.ok).length,
    totalEvents: allEvents.length,
  });

  const results = backtest.aggregate(allEvents, COST_BPS);
  const report: BacktestReport = {
    generatedAt: new Date().toISOString(),
    universeSize: KR_UNIVERSE.length,
    totalSignals: allEvents.length,
    windowDays: WINDOW_DAYS,
    roundTripCostBps: COST_BPS,
    results,
    events: allEvents,
  };

  logger.info('flow-backtest results summary', {
    totalEvents: allEvents.length,
    bySignal: results.map((r) => ({
      type: r.signalType,
      count: r.totalEvents,
      mean5d: r.byHorizon[5]?.meanReturn,
      mean20d: r.byHorizon[20]?.meanReturn,
      hit20d: r.byHorizon[20]?.hitRate,
    })),
  });

  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  await mkdir('reports', { recursive: true });
  const jsonPath = resolve(`reports/flow-backtest-${ts}.json`);
  const htmlPath = resolve(`reports/flow-backtest-${ts}.html`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(htmlPath, renderHtml(report), 'utf8');
  logger.info('flow-backtest written', { jsonPath, htmlPath });
});

function renderHtml(r: BacktestReport): string {
  const rows = r.results.map((res) => {
    const tds = HORIZONS.map((h) => {
      const s = res.byHorizon[h];
      if (!s || s.count === 0) return `<td colspan="4" class="na">—</td>`;
      const mean = s.meanReturn != null ? (s.meanReturn * 100).toFixed(2) + '%' : '—';
      const hit = s.hitRate != null ? (s.hitRate * 100).toFixed(0) + '%' : '—';
      const ratio = s.ratio != null ? s.ratio.toFixed(2) : '—';
      const worst = s.worst != null ? (s.worst * 100).toFixed(1) + '%' : '—';
      const meanCls = s.meanReturn != null && s.meanReturn > 0 ? 'pos' : s.meanReturn != null && s.meanReturn < 0 ? 'neg' : '';
      const hitCls = s.hitRate != null && s.hitRate >= 0.55 ? 'pos' : s.hitRate != null && s.hitRate < 0.45 ? 'neg' : '';
      return `<td class="${meanCls}">${mean}</td><td class="${hitCls}">${hit}</td><td>${ratio}</td><td class="muted">${worst}</td>`;
    }).join('');
    const dir = res.signalType.includes('buy') ? 'buy' : 'sell';
    return `<tr class="row-${dir}">
      <td class="signal-name">${esc(res.signalType)}</td>
      <td class="count">${res.totalEvents}</td>
      ${tds}
    </tr>`;
  }).join('');

  const totalEvents = r.totalSignals;
  const verdict = makeVerdict(r);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Flow Signal Backtest — ${esc(r.generatedAt)}</title>
  <style>
    body { font-family: -apple-system, "Pretendard", sans-serif; margin: 0; color: #222; background: #fafafa; }
    header { padding: 20px 24px; background: #fff; border-bottom: 1px solid #eee; }
    h1 { margin: 0 0 6px; font-size: 1.4em; }
    .meta { color: #888; font-size: .9em; }
    .disclaimer { background: #fff7e6; border-left: 4px solid #f5a623; padding: 10px 14px; margin: 14px 0 0; font-size: .88em; color: #555; line-height: 1.5; }
    section { padding: 20px 24px; }
    h2 { margin: 0 0 12px; font-size: 1.15em; }
    .intro { font-size: .88em; color: #555; line-height: 1.55; margin: 0 0 14px; padding: 10px 12px; background: #fff; border-left: 3px solid #1976d2; border-radius: 4px; }
    .verdict { padding: 14px 16px; background: #fff; border-radius: 8px; margin-bottom: 18px; border: 2px solid #1976d2; }
    .verdict h3 { margin: 0 0 8px; color: #0d47a1; font-size: 1.1em; }
    .verdict ul { margin: 6px 0 0; padding-left: 20px; line-height: 1.7; font-size: .92em; }
    table.bt { width: 100%; border-collapse: collapse; background: #fff; font-size: .85em; }
    table.bt thead th { background: #f4f4f4; padding: 8px 6px; text-align: center; border: 1px solid #e6e6e6; font-weight: 600; font-size: .85em; }
    table.bt tbody td { padding: 6px; text-align: center; border: 1px solid #f0f0f0; font-variant-numeric: tabular-nums; }
    table.bt tbody th { padding: 6px 8px; border: 1px solid #f0f0f0; text-align: left; background: #fafafa; font-size: .82em; }
    .signal-name { text-align: left !important; font-weight: 600; padding-left: 8px !important; }
    .row-buy .signal-name { color: #c62828; }
    .row-sell .signal-name { color: #2e7d32; }
    .count { font-weight: 600; color: #666; }
    .pos { color: #c62828; font-weight: 600; }
    .neg { color: #2e7d32; font-weight: 600; }
    .muted { color: #aaa; font-size: .88em; }
    .na { color: #ccc; font-size: .82em; }
    .horizon-group { background: #eef3f8; }
    .legend { font-size: .82em; color: #666; margin-top: 12px; padding: 10px 12px; background: #fff; border-radius: 4px; line-height: 1.6; }
    .legend b { color: #333; }
    .legend code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-size: .92em; }
  </style>
</head>
<body>
  <header>
    <h1>📊 Flow Signal Backtest — 외인+기관 동반 신호 사후 수익률</h1>
    <div class="meta">생성 ${esc(r.generatedAt)} · 유니버스 ${r.universeSize}종 · 윈도우 ${r.windowDays}일 · 총 신호 ${totalEvents.toLocaleString('ko-KR')}건 · 거래비용 ${(r.roundTripCostBps / 100).toFixed(2)}%(round-trip)</div>
    <p class="disclaimer">⚠️ 본 백테스트는 과거 데이터 기반 통계이며, 미래 수익을 보장하지 않습니다. 슬리피지·세금·매수가 결정 불확실성 미반영. 매도 신호의 수익률은 부호 반전(가격 하락=양의 적중).</p>
  </header>
  <section>
    ${verdict}
    <h2>신호 유형별 통계 — 사후 5/10/20거래일 수익률</h2>
    <p class="intro">매수 신호 적중 기준: 평균 수익률 > 0% 및 hit rate > 50% (거래비용 ${(r.roundTripCostBps / 100).toFixed(2)}% 차감 후). 매도 신호는 가격 하락이 적중이므로 부호 반전 후 동일 기준 적용. <code>ratio</code> = mean/std (Sharpe-like, horizon 단위).</p>
    <table class="bt">
      <thead>
        <tr>
          <th rowspan="2">신호 유형</th>
          <th rowspan="2">건수</th>
          <th colspan="4" class="horizon-group">사후 5일</th>
          <th colspan="4" class="horizon-group">사후 10일</th>
          <th colspan="4" class="horizon-group">사후 20일</th>
        </tr>
        <tr>
          <th>평균수익</th><th>적중률</th><th>ratio</th><th>최악</th>
          <th>평균수익</th><th>적중률</th><th>ratio</th><th>최악</th>
          <th>평균수익</th><th>적중률</th><th>ratio</th><th>최악</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="legend">
      <b>해석 가이드</b> — <span class="pos">빨강</span>=매수 적중(수익률·hit) / <span class="neg">초록</span>=실패. hit rate ≥ 55% = 의미 있는 신호, &lt; 45% = 역방향 가능. ratio가 0.3 이상이면 risk-adjusted 강함.
    </div>
  </section>
</body>
</html>`;
}

function makeVerdict(r: BacktestReport): string {
  const lines: string[] = [];
  for (const res of r.results) {
    const s20 = res.byHorizon[20];
    if (!s20 || s20.count < 30) continue; // 표본 30 미만은 무시
    const meanPct = s20.meanReturn != null ? (s20.meanReturn * 100).toFixed(2) : '?';
    const hitPct = s20.hitRate != null ? (s20.hitRate * 100).toFixed(0) : '?';
    const ok = s20.hitRate != null && s20.hitRate >= 0.55 && s20.meanReturn != null && s20.meanReturn > 0;
    const weak = s20.hitRate != null && s20.hitRate >= 0.50 && s20.hitRate < 0.55;
    const fail = s20.hitRate != null && s20.hitRate < 0.50;
    const tag = ok ? '✅ 유효' : weak ? '🟡 경계' : fail ? '❌ 무효' : '?';
    lines.push(`<li><b>${esc(res.signalType)}</b> (${res.totalEvents}건) — 20일 평균 ${meanPct}%, 적중률 ${hitPct}% → ${tag}</li>`);
  }
  if (lines.length === 0) lines.push('<li>표본 30건 이상 신호 유형이 없습니다.</li>');
  return `<div class="verdict">
    <h3>📋 신호 유효성 판정 (20일 기준)</h3>
    <ul>${lines.join('')}</ul>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
