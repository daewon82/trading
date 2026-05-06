import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  StockDashboardSection,
  DashboardCard,
  Currency,
} from '../types/stock.js';
import type { WeatherForecast, WeatherDay } from '../types/weather.js';
import type { IndicatorSet, CrossEvent } from '../types/timeseries.js';
import type { FlowSummary } from '../types/flow.js';
import type { MacroQuote } from '../types/macro.js';

export interface DashboardPage {
  generatedAt: string;
  today: string;
  weather: WeatherForecast[];
  macros: MacroQuote[];
  kr: StockDashboardSection;
  us: StockDashboardSection;
  valueKr: StockDashboardSection | null;
}

export class DashboardReporter {
  async write(page: DashboardPage, outPath: string): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, this.render(page), 'utf8');
  }

  render(page: DashboardPage): string {
    return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>대시보드 ${esc(page.today)}</title>
  <style>${this.css()}</style>
</head>
<body>
  <header>
    <h1>오늘의 대시보드</h1>
    <div class="meta">${esc(page.today)} · 생성 ${esc(page.generatedAt)}</div>
    <p class="disclaimer">⚠️ 본 페이지는 객관적 정량 지표를 표시하는 정보 제공 화면이며, 매수/매도 권유 또는 투자 자문이 아닙니다. 모든 투자 판단과 결과 책임은 사용자에게 있습니다.</p>
  </header>
${this.renderWeather(page.weather)}
${this.renderInsights(page)}
${this.renderRulesIntro()}
${this.renderMacro(page.macros)}
</body>
</html>
`;
  }

  private renderMacro(macros: MacroQuote[]): string {
    if (macros.length === 0) return '';
    const cells = macros
      .map((m) => {
        const value = formatMacroValue(m);
        const change = formatMacroChange(m.changePercent);
        const cls =
          m.changePercent == null
            ? ''
            : m.changePercent > 0
              ? ' up'
              : m.changePercent < 0
                ? ' down'
                : '';
        return `      <div class="macro-cell">
        <div class="macro-name">${esc(m.name)}</div>
        <div class="macro-value">${esc(value)}</div>
        <div class="macro-change${cls}">${esc(change)}</div>
      </div>`;
      })
      .join('\n');
    return `  <section class="macro">
    <h2>거시 환경</h2>
    <div class="macro-grid">
${cells}
    </div>
  </section>`;
  }

  private renderInsights(page: DashboardPage): string {
    const krInsights = page.kr.cards.map((c) => evaluateInsight(c, 'KR'));
    const usInsights = page.us.cards.map((c) => evaluateInsight(c, 'US'));
    const valueInsights = page.valueKr?.cards.map((c) => evaluateInsight(c, 'KR')) ?? [];
    const all = [...krInsights, ...usInsights, ...valueInsights];
    if (all.length === 0) return '';

    const renderGroup = (title: string, ins: InsightResult[], currency: Currency): string => {
      if (ins.length === 0) return '';
      const cards = ins.map((i) => renderInsightCard(i, currency)).join('\n');
      return `    <div class="insight-group">
      <h3 class="insight-group-title">${esc(title)}</h3>
      <div class="insights-cards">
${cards}
      </div>
    </div>`;
    };

    return `  <section class="insights">
    <h2>🔍 매수 시점 신호 종합 — 전문가들이 자주 보는 관점</h2>
    <p class="insight-intro">아래는 일반적으로 알려진 매수 관점 신호의 <strong>발생 여부와 패턴 매칭 점수</strong>입니다. <strong>매수 결정은 사용자 본인 판단입니다.</strong> 모든 신호가 충족돼도 손실 가능. "외국인+기관 동반 매수" 같은 신호는 통계적 경향이지 보장이 아닙니다.</p>
${renderGroup(`🇰🇷 국내 주식 (${krInsights.length}종)`, krInsights, 'KRW')}
${renderGroup(`🇺🇸 미국 빅테크 (${usInsights.length}종)`, usInsights, 'USD')}
${renderGroup(`📚 가치 평가 기준 후보 (${valueInsights.length}종, KR)`, valueInsights, 'KRW')}
  </section>`;
  }

  private renderRulesIntro(): string {
    return `  <section class="rules">
    <h2>참고 — 룰 기반 매매 접근 (정보)</h2>
    <ul>
      <li><strong>DCA (분할매수)</strong>: 시점 예측 회피, 매월 일정 금액 매수. 변동성 시장에서 평균단가 하향.</li>
      <li><strong>밸류에이션 채널</strong>: 자체 5년 PER 분위 25% 미만 → 매수 검토, 75% 이상 → 매도 검토.</li>
      <li><strong>이격 매수</strong>: 200일선 −20% 이격 시 검토. 카드의 "200d" 행 참고.</li>
      <li><strong>정배열 모멘텀</strong>: 5일 &gt; 20일 &gt; 60일 정배열 + RSI 50 돌파 + 거래량 1.5× 동반 시 추세 진입.</li>
      <li><strong>수급 동반 매수 (KR)</strong>: 외국인 + 기관 5일 누적 순매수 동반 시 한국 시장에서 자주 상승과 동행 (사용자 경험).</li>
      <li><strong>리스크 관리</strong>: 손절선(예: −7%), 한 종목 자산의 5~10% 이하, 목표가÷손절폭 ≥ 2:1.</li>
    </ul>
    <p class="rules-disclaimer">※ 본 내용은 공개된 일반 매매 룰의 정리이며 매매 권유나 투자 자문이 아닙니다. 위 룰을 적용하더라도 손실이 날 수 있고, 모든 투자 판단과 결과 책임은 본인에게 있습니다.</p>
  </section>`;
  }

  private renderWeather(forecasts: WeatherForecast[]): string {
    if (forecasts.length === 0) return '';
    const head = forecasts[0]!;
    const dateHeaders = head.days
      .map((d) => `<th>${esc(formatShortDate(d.date))}</th>`)
      .join('');
    const rows = forecasts
      .map((f) => {
        const cells = f.days
          .map((d) => this.renderWeatherCell(d))
          .join('');
        return `      <tr><th class="city">${esc(f.city)}</th>${cells}</tr>`;
      })
      .join('\n');
    return `  <section class="weather">
    <h2>주간 날씨 — open-meteo</h2>
    <div class="weather-wrap">
      <table class="weather-table">
        <thead><tr><th class="city">도시</th>${dateHeaders}</tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
    <p class="legend"><span class="rainy-legend">빨강</span> = 비/소나기/천둥번개 예보</p>
  </section>`;
  }

  private renderWeatherCell(d: WeatherDay): string {
    const cls = d.rainy ? ' class="rainy"' : '';
    const tmax = d.temperatureMax == null ? '—' : `${d.temperatureMax.toFixed(0)}°`;
    const tmin = d.temperatureMin == null ? '—' : `${d.temperatureMin.toFixed(0)}°`;
    const pop = d.precipitationProbabilityMax == null
      ? ''
      : `<div class="pop">강수 ${d.precipitationProbabilityMax}%</div>`;
    return `<td${cls}><div class="day-desc">${esc(d.description)}</div><div class="temp">${tmax} / ${tmin}</div>${pop}</td>`;
  }

  private css(): string {
    return `
      *, *::before, *::after { box-sizing: border-box; }
      html { -webkit-text-size-adjust: 100%; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Pretendard", sans-serif; margin: 0; color: #222; background: #fafafa; }
      header { padding: 24px; background: #fff; border-bottom: 1px solid #eee; }
      h1 { margin: 0 0 4px; font-size: 1.6em; }
      .meta { color: #888; font-size: .9em; }
      .disclaimer { background: #fff7e6; border-left: 4px solid #f5a623; padding: 10px 14px; margin: 14px 0 0; font-size: .9em; color: #555; line-height: 1.5; }
      section { padding: 20px 24px; }
      h2 { margin: 0 0 12px; font-size: 1.2em; }
      .weather-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      table.weather-table { border-collapse: collapse; width: 100%; min-width: 560px; background: #fff; }
      table.weather-table th, table.weather-table td { border: 1px solid #e6e6e6; padding: 8px 10px; font-size: .85em; text-align: center; vertical-align: top; }
      table.weather-table thead th { background: #f4f4f4; }
      table.weather-table tbody th.city { background: #fafafa; text-align: left; }
      table.weather-table td.rainy { background: #ffecec; color: #c62828; font-weight: 600; }
      .day-desc { font-weight: 500; margin-bottom: 4px; }
      .temp { color: #555; font-size: .92em; }
      .pop { color: #888; font-size: .85em; margin-top: 2px; }
      .legend { font-size: .85em; color: #555; margin-top: 8px; }
      .rainy-legend { color: #c62828; font-weight: 600; }
      .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
      .card { background: #fff; border: 1px solid #e6e6e6; border-radius: 8px; padding: 14px 16px; font-size: .92em; }
      .card h3 { margin: 0 0 10px; font-size: 1.05em; }
      .ticker { color: #888; font-weight: normal; font-size: .85em; }
      .row { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; gap: 8px; }
      .label { color: #777; font-size: .9em; flex-shrink: 0; }
      .value { text-align: right; font-variant-numeric: tabular-nums; }
      .value.strong { font-weight: 700; font-size: 1.05em; }
      .value.small { font-size: .85em; }
      .change { color: #555; font-size: .85em; min-width: 60px; text-align: right; }
      .quart { color: #888; font-size: .85em; }
      .dim { color: #aaa; }
      .ref-block { margin: 6px 0 4px; padding: 6px 8px; background: #f7f9fc; border-radius: 4px; }
      .ref-title { font-size: .85em; color: #555; margin-bottom: 4px; }
      .ref-note { color: #999; font-weight: normal; }
      .ref-table { width: 100%; border-collapse: collapse; font-size: .85em; }
      .ref-table td { padding: 2px 4px; }
      .ref-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .ref-table td.pct { color: #888; min-width: 60px; }
      .ref-table tr.below td.pct { color: #2e7d32; }
      .ref-table tr.above td.pct { color: #c62828; }
      .spark { width: 100%; height: 50px; display: block; margin: 8px 0 4px; }
      .flow-buy { color: #c62828; font-weight: 600; }
      .flow-sell { color: #2e7d32; font-weight: 600; }
      .bull { color: #c62828; font-weight: 600; }
      .bear { color: #2e7d32; font-weight: 600; }
      .macro-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
      .macro-cell { background: #fff; border: 1px solid #e6e6e6; padding: 10px 12px; border-radius: 6px; }
      .macro-name { font-size: .85em; color: #888; }
      .macro-value { font-size: 1.1em; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
      .macro-change { font-size: .85em; font-variant-numeric: tabular-nums; margin-top: 2px; }
      .macro-change.up { color: #c62828; }
      .macro-change.down { color: #2e7d32; }
      section.insights { padding: 20px 24px; background: #fffaf3; border-top: 1px solid #f0e0c0; }
      .insight-intro { font-size: .9em; color: #555; line-height: 1.55; margin: 0 0 14px; padding: 10px 12px; background: #fff; border-left: 3px solid #f5a623; border-radius: 4px; }
      .insights-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
      .insight-group { margin-bottom: 24px; }
      .insight-group:last-child { margin-bottom: 0; }
      .insight-group-title { font-size: 1.05em; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 2px solid #f5a623; color: #444; }
      .ic-head { display: flex; gap: 8px; align-items: baseline; padding: 4px 0 6px; flex-wrap: wrap; }
      .ic-price-current { font-size: 1.1em; font-weight: 700; font-variant-numeric: tabular-nums; }
      .ic-price-change { color: #555; font-size: .88em; font-variant-numeric: tabular-nums; }
      .ic-pos { color: #888; font-size: .82em; margin-left: auto; }
      .ic-row { font-size: .82em; padding: 4px 8px; background: #f7f9fc; border-radius: 4px; margin: 3px 0; line-height: 1.5; display: flex; gap: 6px; align-items: baseline; }
      .ic-tag { color: #888; font-weight: 500; min-width: 56px; flex-shrink: 0; }
      .ic-val { flex: 1; font-variant-numeric: tabular-nums; }
      .insight-card { background: #fff; border: 1px solid #e6e6e6; border-radius: 8px; padding: 14px 16px; font-size: .9em; }
      .insight-card h3 { margin: 0 0 8px; font-size: 1.05em; }
      .insight-card h4 { margin: 8px 0 4px; font-size: .9em; color: #555; }
      .insight-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #f0f0f0; }
      .ins-label { color: #777; font-size: .9em; }
      .ins-value { font-weight: 500; text-align: right; }
      .signal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
      .signal-grid.signal-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
      .signal-grid ul { margin: 0; padding-left: 18px; font-size: .85em; line-height: 1.55; }
      .bullish h4 { color: #c62828; }
      .cautious h4 { color: #b35900; }
      .bearish h4 { color: #2e7d32; }
      .signal-grid li.empty { color: #aaa; list-style: none; margin-left: -18px; }
      .dominance { margin: 10px 0 8px; padding: 10px 12px; background: #f7f9fc; border-radius: 6px; }
      .dom-title { font-size: .82em; color: #555; margin-bottom: 6px; }
      .dom-note { color: #999; font-weight: normal; }
      .dom-bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: #eee; margin-bottom: 6px; }
      .dom-seg { height: 100%; }
      .dom-seg.dom-bull { background: #c62828; }
      .dom-seg.dom-caut { background: #f5a623; }
      .dom-seg.dom-bear { background: #2e7d32; }
      .dom-stats { display: flex; justify-content: space-between; gap: 6px; font-size: .78em; flex-wrap: wrap; }
      .dom-bull-text { color: #c62828; font-weight: 600; }
      .dom-caut-text { color: #b35900; font-weight: 600; }
      .dom-bear-text { color: #2e7d32; font-weight: 600; }
      .dom-summary { margin-top: 6px; font-size: .85em; color: #555; }
      .dom-label-bull { color: #c62828; }
      .dom-label-bear { color: #2e7d32; }
      .dom-label-caut { color: #b35900; }
      .dom-label-mix { color: #666; }
      .patterns ul { margin: 0; padding-left: 0; list-style: none; font-size: .85em; }
      .patterns .pattern { padding: 6px 8px; margin-bottom: 4px; border-radius: 4px; background: #fafafa; }
      .patterns .pattern.full { background: #fff3e0; border-left: 3px solid #ef6c00; }
      .patterns .pattern.partial { background: #fafafa; border-left: 3px solid #ccc; }
      .patterns .pattern.empty { background: #fafafa; border-left: 3px solid transparent; color: #999; }
      .pattern-head .ratio { color: #888; font-weight: normal; margin-left: 4px; }
      .pattern-desc { color: #777; font-size: .92em; margin-top: 2px; }
      .insight-note { margin: 10px 0 0; padding: 8px 10px; font-size: .82em; color: #666; background: #f7f9fc; border-radius: 4px; line-height: 1.5; }
      section.value-candidates { padding: 20px 24px; background: #f0f7ff; border-top: 1px solid #cfd8dc; border-bottom: 1px solid #cfd8dc; }
      .value-intro { font-size: .9em; color: #555; line-height: 1.55; margin: 0 0 14px; padding: 10px 12px; background: #fff; border-left: 3px solid #1976d2; border-radius: 4px; }
      .value-intro code { background: #eee; padding: 1px 5px; border-radius: 3px; font-size: .9em; }
      footer.rules { padding: 20px 24px; background: #f7f9fc; border-top: 1px solid #e6e6e6; }
      footer.rules h2 { font-size: 1em; margin: 0 0 8px; color: #555; }
      footer.rules ul { margin: 0; padding-left: 20px; font-size: .9em; color: #444; line-height: 1.6; }
      footer.rules li { margin-bottom: 4px; }
      .rules-disclaimer { margin-top: 10px; font-size: .85em; color: #888; line-height: 1.5; }
      .bar { position: relative; height: 8px; background: #f0f0f0; border-radius: 4px; margin: 8px 0 4px; }
      .bar-q { position: absolute; top: 0; width: 1px; height: 8px; background: #ccc; left: 25%; }
      .bar-fill { position: absolute; top: -3px; width: 3px; height: 14px; background: #1976d2; border-radius: 1px; transform: translateX(-1.5px); }
      .bar-labels { display: flex; justify-content: space-between; color: #999; font-size: .75em; }
      @media (max-width: 600px) {
        header { padding: 16px; }
        section { padding: 14px 16px; }
        h1 { font-size: 1.3em; }
        h2 { font-size: 1.05em; }
        .cards { grid-template-columns: 1fr; gap: 10px; }
        .card { padding: 12px 14px; font-size: .9em; }
        .card h3 { font-size: 1em; }
        table.weather-table th, table.weather-table td { padding: 6px 4px; font-size: .78em; }
        .ref-table td { padding: 2px 3px; font-size: .8em; }
        .label { font-size: .82em; }
        .row { padding: 2px 0; }
        .disclaimer { font-size: .82em; padding: 8px 10px; }
      }
    `;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderReferencePrices(c: DashboardCard, currency: Currency): string {
  const s = c.snapshot;
  const refs = c.referenceLines;
  const lo = s.fiftyTwoWeekLow;
  const hi = s.fiftyTwoWeekHigh;
  if (refs == null || lo == null || hi == null) {
    return `        <div class="row"><span class="label">참조 가격대</span><span class="value small dim">데이터 없음</span></div>`;
  }
  const cur = s.price;
  const ind = c.indicators;
  const diff = (target: number): string => {
    if (cur == null || cur === 0) return '—';
    const pct = ((target - cur) / cur) * 100;
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}%`;
  };
  const rows: Array<[string, number]> = [
    ['52주 저', lo],
    ['Q1 (하위 25%선)', refs.q1],
    ['Q2 (중간)', refs.q2],
    ['Q3 (상위 25%선)', refs.q3],
    ['52주 고', hi],
  ];
  if (ind?.sma50 != null) rows.push(['50일선 (중기 추세)', ind.sma50]);
  if (ind?.sma200 != null) rows.push(['200일선 (장기 추세)', ind.sma200]);
  // 가격 오름차순 정렬 — 현재가 기준 위/아래 직관적 비교
  rows.sort((a, b) => a[1] - b[1]);

  const tbody = rows
    .map(([label, target]) => {
      const pct = diff(target);
      const cls =
        cur != null && target < cur ? ' below' : cur != null && target > cur ? ' above' : '';
      return `          <tr class="ref${cls}"><td>${esc(label)}</td><td class="num">${formatPrice(target, currency)}</td><td class="num pct">${esc(pct)}</td></tr>`;
    })
    .join('\n');
  return `        <div class="ref-block">
          <div class="ref-title">참조 가격대 <span class="ref-note">(현재가 대비)</span></div>
          <table class="ref-table">
${tbody}
          </table>
        </div>`;
}

function renderSparkline(closes: number[] | null): string {
  if (!closes || closes.length < 2) return '';
  const w = 280;
  const h = 50;
  let min = closes[0]!;
  let max = closes[0]!;
  for (const c of closes) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const range = max - min || 1;
  const points = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((c - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // 한국식 색상: 종가가 시작점보다 위면 빨강(상승), 아래면 녹색(하락)
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  const color = last >= first ? '#c62828' : '#2e7d32';
  return `        <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
          <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${points}"/>
        </svg>`;
}

function renderFlow(f: FlowSummary | null): string {
  if (!f) return '';
  const fmt = (v: number | null): string => {
    if (v == null) return '—';
    const abs = Math.abs(v);
    const sign = v >= 0 ? '+' : '−';
    if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}억주`;
    if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}만주`;
    return `${sign}${abs.toLocaleString('ko-KR')}주`;
  };
  const cls = (v: number | null): string =>
    v == null ? '' : v > 0 ? ' flow-buy' : v < 0 ? ' flow-sell' : '';
  return `        <div class="row"><span class="label">외국인 5d / 10d</span><span class="value small"><span class="${cls(f.net5dForeigner)}">${fmt(f.net5dForeigner)}</span> / <span class="${cls(f.net10dForeigner)}">${fmt(f.net10dForeigner)}</span></span></div>
        <div class="row"><span class="label">기관 5d / 10d</span><span class="value small"><span class="${cls(f.net5dInstitutional)}">${fmt(f.net5dInstitutional)}</span> / <span class="${cls(f.net10dInstitutional)}">${fmt(f.net10dInstitutional)}</span></span></div>`;
}

function renderIndicators(ind: IndicatorSet | null): string {
  if (!ind) {
    return `        <div class="row"><span class="label">시계열</span><span class="value small dim">데이터 없음</span></div>`;
  }
  const rsi = ind.rsi14 == null ? '—' : ind.rsi14.toFixed(0);
  const rsiNote =
    ind.rsi14 == null ? '' : ind.rsi14 < 30 ? ' (30 미만)' : ind.rsi14 > 70 ? ' (70 초과)' : '';
  const pct200 = ind.pctVsSma200 == null
    ? '—'
    : `${ind.pctVsSma200 >= 0 ? '+' : ''}${ind.pctVsSma200.toFixed(1)}%`;
  const r1 = ind.return1m == null
    ? '—'
    : `${ind.return1m >= 0 ? '+' : ''}${ind.return1m.toFixed(1)}%`;
  const r3 = ind.return3m == null
    ? '—'
    : `${ind.return3m >= 0 ? '+' : ''}${ind.return3m.toFixed(1)}%`;
  const cross = formatCross(ind.lastCross);
  const align =
    ind.alignmentBullish == null
      ? '—'
      : ind.alignmentBullish
        ? '<span class="bull">정배열 ✓</span>'
        : '<span class="bear">역배열</span>';
  const vol = ind.volumeRatio == null ? '—' : `${ind.volumeRatio.toFixed(2)}× (20일 평균)`;
  return `        <div class="row"><span class="label">RSI(14) · 200d 이격</span><span class="value small">${rsi}${rsiNote} · ${pct200}</span></div>
        <div class="row"><span class="label">수익률 1M / 3M</span><span class="value small">${r1} / ${r3}</span></div>
        <div class="row"><span class="label">최근 cross</span><span class="value small">${cross}</span></div>
        <div class="row"><span class="label">5/20/60 정배열</span><span class="value small">${align}</span></div>
        <div class="row"><span class="label">거래량 비율</span><span class="value small">${vol}</span></div>`;
}

function formatCross(c: CrossEvent | null): string {
  if (!c) return '최근 1년 내 없음';
  const label = c.kind === 'golden' ? '골든크로스' : '데드크로스';
  return `${label} · ${c.daysAgo}영업일 전 (${c.date})`;
}

interface InsightPattern {
  name: string;
  matched: number;
  total: number;
  description: string;
}

interface InsightResult {
  card: DashboardCard;
  market: 'KR' | 'US';
  bullish: string[];
  cautious: string[];
  bearish: string[];
  patterns: InsightPattern[];
  valuationLabel: string;
  trendLabel: string;
  dominance: {
    bullishPct: number;
    cautiousPct: number;
    bearishPct: number;
    dominantLabel: string;
    total: number;
  };
}

function evaluateInsight(c: DashboardCard, market: 'KR' | 'US'): InsightResult {
  const ind = c.indicators;
  const flow = c.flow;
  const q = c.quartile;
  const bullish: string[] = [];
  const cautious: string[] = [];
  const bearish: string[] = [];

  // 추세
  if (ind?.pctVsSma200 != null) {
    if (ind.pctVsSma200 > 5) bullish.push(`200일선 +${ind.pctVsSma200.toFixed(1)}% 위`);
    else if (ind.pctVsSma200 < -10) bearish.push(`200일선 ${ind.pctVsSma200.toFixed(1)}% 아래 (강한 하락)`);
    else if (ind.pctVsSma200 < -5) cautious.push(`200일선 ${ind.pctVsSma200.toFixed(1)}% 아래`);
  }
  if (ind?.alignmentBullish === true) bullish.push('5/20/60 정배열');
  if (ind?.alignmentBullish === false) bearish.push('5/20/60 역배열');

  // 모멘텀
  if (ind?.rsi14 != null) {
    if (ind.rsi14 > 70) cautious.push(`RSI ${ind.rsi14.toFixed(0)} (과열, 70 초과)`);
    else if (ind.rsi14 < 30) bullish.push(`RSI ${ind.rsi14.toFixed(0)} (과매도, 반등 가능)`);
    else if (ind.rsi14 >= 50) bullish.push(`RSI ${ind.rsi14.toFixed(0)} (50 위 모멘텀)`);
  }
  if (ind?.return1m != null) {
    if (ind.return1m > 5) bullish.push(`1M +${ind.return1m.toFixed(1)}%`);
    else if (ind.return1m < -10) bearish.push(`1M ${ind.return1m.toFixed(1)}% (큰 폭 하락)`);
    else if (ind.return1m < -5) cautious.push(`1M ${ind.return1m.toFixed(1)}%`);
  }
  if (ind?.return3m != null) {
    if (ind.return3m > 10) bullish.push(`3M +${ind.return3m.toFixed(1)}%`);
    else if (ind.return3m < -15) bearish.push(`3M ${ind.return3m.toFixed(1)}% (큰 폭 하락)`);
    else if (ind.return3m < -10) cautious.push(`3M ${ind.return3m.toFixed(1)}%`);
  }

  // 거래량
  if (ind?.volumeRatio != null) {
    if (ind.volumeRatio > 1.5) bullish.push(`거래량 ${ind.volumeRatio.toFixed(2)}× (20일 평균 대비 급증)`);
    else if (ind.volumeRatio < 0.5) cautious.push(`거래량 ${ind.volumeRatio.toFixed(2)}× (위축)`);
  }

  // Cross
  if (ind?.lastCross && ind.lastCross.daysAgo < 30) {
    if (ind.lastCross.kind === 'golden') bullish.push(`골든크로스 ${ind.lastCross.daysAgo}영업일 전`);
    else bearish.push(`데드크로스 ${ind.lastCross.daysAgo}영업일 전`);
  }

  // 수급 (KR만, 사용자 경험 반영)
  if (market === 'KR' && flow) {
    const fNet = flow.net5dForeigner;
    const iNet = flow.net5dInstitutional;
    if (fNet != null && iNet != null && fNet > 0 && iNet > 0) {
      bullish.push('외국인 + 기관 5일 동반 순매수 ★');
    } else if (fNet != null && iNet != null && fNet < 0 && iNet < 0) {
      bearish.push('외국인 + 기관 5일 동반 순매도 ★');
    } else if (fNet != null && fNet > 0) {
      bullish.push('외국인 5일 순매수 (기관 미동반)');
    } else if (iNet != null && iNet > 0) {
      bullish.push('기관 5일 순매수 (외국인 미동반)');
    }
  }

  // 52주 위치
  if (q === 1) bullish.push('52주 Q1 (저평가 영역)');
  else if (q === 4) cautious.push('52주 Q4 (고평가 영역)');

  // 패턴 매칭
  const patterns: InsightPattern[] = [];

  // 1. 추세 추종 매수 (정배열형)
  {
    let m = 0;
    const total = market === 'KR' ? 4 : 3;
    if (ind?.alignmentBullish === true) m++;
    if (ind?.rsi14 != null && ind.rsi14 >= 50 && ind.rsi14 <= 70) m++;
    if (ind?.volumeRatio != null && ind.volumeRatio > 1.2) m++;
    if (
      market === 'KR' &&
      flow?.net5dForeigner != null && flow.net5dForeigner > 0 &&
      flow?.net5dInstitutional != null && flow.net5dInstitutional > 0
    ) m++;
    patterns.push({
      name: '추세 추종 매수 (정배열형)',
      matched: m,
      total,
      description: market === 'KR'
        ? '정배열 + RSI 50~70 + 거래량 1.2× 초과 + 외국인·기관 동반 순매수'
        : '정배열 + RSI 50~70 + 거래량 1.2× 초과',
    });
  }

  // 2. 저평가 매수 (역추세형)
  {
    let m = 0;
    if (q === 1) m++;
    if (ind?.rsi14 != null && ind.rsi14 < 30) m++;
    if (ind?.pctVsSma200 != null && ind.pctVsSma200 < -10) m++;
    patterns.push({
      name: '저평가 매수 (역추세형)',
      matched: m,
      total: 3,
      description: '52주 Q1 + RSI 30 미만 + 200일선 −10% 이상 이격',
    });
  }

  // 3. 돌파 매수 (브레이크아웃)
  {
    let m = 0;
    if (ind?.pctVsSma200 != null && ind.pctVsSma200 >= 0 && ind.pctVsSma200 < 10) m++;
    if (ind?.lastCross?.kind === 'golden' && ind.lastCross.daysAgo < 30) m++;
    if (ind?.volumeRatio != null && ind.volumeRatio > 1.5) m++;
    patterns.push({
      name: '돌파 매수 (브레이크아웃)',
      matched: m,
      total: 3,
      description: '200일선 회복(+0~10%) + 최근 30영업일 내 골든크로스 + 거래량 1.5× 초과',
    });
  }

  // 4. 수급 동반 매수 (KR만, 사용자 경험)
  if (market === 'KR') {
    let m = 0;
    if (flow?.net5dForeigner != null && flow.net5dForeigner > 0) m++;
    if (flow?.net5dInstitutional != null && flow.net5dInstitutional > 0) m++;
    patterns.push({
      name: '수급 동반 매수 ★',
      matched: m,
      total: 2,
      description: '외국인 5일 순매수 + 기관 5일 순매수 (한국 시장에서 자주 상승과 동행하는 패턴)',
    });
  }

  // 가치 평가 라벨
  let valuationLabel = '데이터 부족';
  if (q === 1) valuationLabel = '저평가 영역 (52주 Q1)';
  else if (q === 2) valuationLabel = '중하단 (52주 Q2)';
  else if (q === 3) valuationLabel = '중상단 (52주 Q3)';
  else if (q === 4) valuationLabel = '고평가 영역 (52주 Q4)';

  // 추세 라벨
  let trendLabel = '판단 보류 (데이터 부족)';
  if (ind?.alignmentBullish === true && ind?.pctVsSma200 != null && ind.pctVsSma200 > 0) {
    trendLabel = '상승 추세 (정배열 + 200일선 위)';
  } else if (ind?.alignmentBullish === false && ind?.pctVsSma200 != null && ind.pctVsSma200 < 0) {
    trendLabel = '하락 추세 (역배열 + 200일선 아래)';
  } else if (ind?.alignmentBullish != null || ind?.pctVsSma200 != null) {
    trendLabel = '횡보·전환 (혼합 신호)';
  }

  // 우세 비율 산출 — 단순 카운트 비교 (가중치 없음)
  const total = bullish.length + cautious.length + bearish.length;
  const bullishPct = total > 0 ? (bullish.length / total) * 100 : 0;
  const cautiousPct = total > 0 ? (cautious.length / total) * 100 : 0;
  const bearishPct = total > 0 ? (bearish.length / total) * 100 : 0;
  let dominantLabel = '신호 없음';
  if (total > 0) {
    if (bullish.length > cautious.length && bullish.length > bearish.length) dominantLabel = '매수 우호 우세';
    else if (bearish.length > bullish.length && bearish.length > cautious.length) dominantLabel = '매도 우호 우세';
    else if (cautious.length > bullish.length && cautious.length > bearish.length) dominantLabel = '신중 우세';
    else dominantLabel = '혼합 (동률)';
  }
  const dominance = { bullishPct, cautiousPct, bearishPct, dominantLabel, total };

  return { card: c, market, bullish, cautious, bearish, patterns, valuationLabel, trendLabel, dominance };
}

function renderInsightCard(ins: InsightResult, currency: Currency): string {
  const c = ins.card;
  const s = c.snapshot;
  const refs = c.referenceLines;
  const ind = c.indicators;
  const flow = c.flow;

  // 가격 + 변동률 + 52주 위치
  const price = formatPrice(s.price, currency);
  const change =
    s.changePercent == null
      ? '—'
      : `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`;
  const pos =
    c.fiftyTwoWeekPosition == null
      ? '52주 —'
      : `52주 ${c.fiftyTwoWeekPosition.toFixed(0)}%${c.quartile ? ` (Q${c.quartile})` : ''}`;

  // sparkline
  const spark = renderSparkline(c.sparklineCloses);

  // 참조가 행
  let refsRow = '';
  if (refs) {
    const sma200 =
      ind?.sma200 != null ? ` · 200d ${formatPrice(ind.sma200, currency)}` : '';
    refsRow = `        <div class="ic-row ic-refs"><span class="ic-tag">참조가</span><span class="ic-val">Q1 ${formatPrice(refs.q1, currency)} · Q2 ${formatPrice(refs.q2, currency)} · Q3 ${formatPrice(refs.q3, currency)}${sma200}</span></div>`;
  }

  // 펀더멘털 + 거래량
  const perStr = s.per == null ? '—' : s.per.toFixed(2);
  const pbrStr = s.pbr == null ? '—' : s.pbr.toFixed(2);
  const divStr = s.dividendYield == null ? '—' : `${s.dividendYield.toFixed(2)}%`;
  const volRatioStr =
    ind?.volumeRatio != null ? ` · 거래량 ${ind.volumeRatio.toFixed(2)}×` : '';
  const fundRow = `        <div class="ic-row ic-fund"><span class="ic-tag">펀더</span><span class="ic-val">PER ${perStr} · PBR ${pbrStr} · 배당 ${divStr}${volRatioStr}</span></div>`;

  // 수급 (KR만)
  let flowRow = '';
  if (flow && (flow.net5dForeigner != null || flow.net5dInstitutional != null)) {
    const fmt = (v: number | null): string => {
      if (v == null) return '—';
      const abs = Math.abs(v);
      const sign = v >= 0 ? '+' : '−';
      if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}억주`;
      if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(1)}만주`;
      return `${sign}${abs.toLocaleString('ko-KR')}주`;
    };
    const cls = (v: number | null): string =>
      v == null ? '' : v > 0 ? 'flow-buy' : v < 0 ? 'flow-sell' : '';
    flowRow = `        <div class="ic-row ic-flow"><span class="ic-tag">수급 5d</span><span class="ic-val">외인 <span class="${cls(flow.net5dForeigner)}">${fmt(flow.net5dForeigner)}</span> · 기관 <span class="${cls(flow.net5dInstitutional)}">${fmt(flow.net5dInstitutional)}</span></span></div>`;
  }
  const listOf = (arr: string[]) =>
    arr.length === 0
      ? '<li class="empty">해당 신호 없음</li>'
      : arr.map((b) => `<li>${esc(b)}</li>`).join('');
  const patternsList = ins.patterns
    .map((p) => {
      const ratio = `${p.matched}/${p.total}`;
      const cls = p.matched === p.total ? 'full' : p.matched > 0 ? 'partial' : 'empty';
      return `          <li class="pattern ${cls}">
            <div class="pattern-head"><strong>${esc(p.name)}</strong> <span class="ratio">${ratio}</span></div>
            <div class="pattern-desc">${esc(p.description)}</div>
          </li>`;
    })
    .join('\n');

  const d = ins.dominance;
  const bullW = d.bullishPct.toFixed(1);
  const cautW = d.cautiousPct.toFixed(1);
  const bearW = d.bearishPct.toFixed(1);
  const dominantCls =
    d.dominantLabel.startsWith('매수') ? 'dom-label-bull'
    : d.dominantLabel.startsWith('매도') ? 'dom-label-bear'
    : d.dominantLabel.startsWith('신중') ? 'dom-label-caut'
    : 'dom-label-mix';

  return `      <article class="insight-card">
        <h3>${esc(s.name)} <span class="ticker">${esc(s.code)}</span></h3>
        <div class="ic-head">
          <span class="ic-price-current">${price}</span>
          <span class="ic-price-change">${change}</span>
          <span class="ic-pos">${pos}</span>
        </div>
${spark}
${refsRow}
${fundRow}
${flowRow}
        <div class="insight-row"><span class="ins-label">평가 대비 주가</span><span class="ins-value">${esc(ins.valuationLabel)}</span></div>
        <div class="insight-row"><span class="ins-label">현재 추세</span><span class="ins-value">${esc(ins.trendLabel)}</span></div>
        <div class="dominance">
          <div class="dom-title">신호 우세 비율 <span class="dom-note">(단순 카운트 비교, 결정은 본인)</span></div>
          <div class="dom-bar">
            <div class="dom-seg dom-bull" style="width:${bullW}%" title="매수 우호 ${bullW}%"></div>
            <div class="dom-seg dom-caut" style="width:${cautW}%" title="신중 ${cautW}%"></div>
            <div class="dom-seg dom-bear" style="width:${bearW}%" title="매도 우호 ${bearW}%"></div>
          </div>
          <div class="dom-stats">
            <span class="dom-bull-text">⊕ 매수 우호 ${bullW}% (${ins.bullish.length}건)</span>
            <span class="dom-caut-text">⚠ 신중 ${cautW}% (${ins.cautious.length}건)</span>
            <span class="dom-bear-text">⊖ 매도 우호 ${bearW}% (${ins.bearish.length}건)</span>
          </div>
          <div class="dom-summary">→ <strong class="${dominantCls}">${esc(d.dominantLabel)}</strong> · 총 ${d.total}건</div>
        </div>
        <div class="signal-grid signal-grid-3">
          <div class="bullish">
            <h4>⊕ 매수 우호</h4>
            <ul>${listOf(ins.bullish)}</ul>
          </div>
          <div class="cautious">
            <h4>⚠ 신중</h4>
            <ul>${listOf(ins.cautious)}</ul>
          </div>
          <div class="bearish">
            <h4>⊖ 매도 우호</h4>
            <ul>${listOf(ins.bearish)}</ul>
          </div>
        </div>
        <div class="patterns">
          <h4>📐 전문가 패턴 매칭</h4>
          <ul>
${patternsList}
          </ul>
        </div>
        <p class="insight-note">※ 위 신호 발생과 우세 비율은 <strong>단순 카운트 사실 정보</strong>이며 매수/매도 결정이 아닙니다. 본인 룰에 따라 판단하세요.</p>
      </article>`;
}

function formatMacroValue(m: MacroQuote): string {
  if (m.value == null) return '—';
  const v = m.value;
  if (m.unit === '%') return `${v.toFixed(2)}%`;
  if (m.unit === '원') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

function formatMacroChange(pct: number | null): string {
  if (pct == null) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function formatPrice(v: number | null, currency: Currency): string {
  if (v == null) return '—';
  if (currency === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  return `$${v.toFixed(2)}`;
}

function formatShortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00+09:00`);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${md} (${days[d.getDay()]})`;
}
