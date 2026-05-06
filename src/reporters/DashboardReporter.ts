import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  StockDashboardSection,
  DashboardCard,
  Currency,
} from '../types/stock.js';
import type { WeatherForecast, WeatherDay } from '../types/weather.js';
import type { IndicatorSet, CrossEvent } from '../types/timeseries.js';

export interface DashboardPage {
  generatedAt: string;
  today: string;
  weather: WeatherForecast[];
  kr: StockDashboardSection;
  us: StockDashboardSection;
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
${this.renderStockSection('🇰🇷 국내 주식', page.kr)}
${this.renderStockSection('🇺🇸 미국 빅테크', page.us)}
</body>
</html>
`;
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

  private renderStockSection(title: string, section: StockDashboardSection): string {
    const cards = section.cards.map((c) => this.renderCard(c, section.currency)).join('\n');
    return `  <section class="stocks">
    <h2>${esc(title)} <span class="meta">${esc(section.currency)}</span></h2>
    <div class="cards">
${cards}
    </div>
  </section>`;
  }

  private renderCard(c: DashboardCard, currency: Currency): string {
    const s = c.snapshot;
    const price = formatPrice(s.price, currency);
    const change =
      s.changePercent == null
        ? '—'
        : `${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`;
    const lo = s.fiftyTwoWeekLow == null ? '—' : formatPrice(s.fiftyTwoWeekLow, currency);
    const hi = s.fiftyTwoWeekHigh == null ? '—' : formatPrice(s.fiftyTwoWeekHigh, currency);
    const pos = c.fiftyTwoWeekPosition == null
      ? '—'
      : `${c.fiftyTwoWeekPosition.toFixed(1)}%`;
    const quart = c.quartile == null ? '—' : `Q${c.quartile}`;
    const refTable = renderReferencePrices(c, currency);
    const per = s.per == null ? '—' : s.per.toFixed(2);
    const pbr = s.pbr == null ? '—' : s.pbr.toFixed(2);
    const div = s.dividendYield == null ? '—' : `${s.dividendYield.toFixed(2)}%`;
    const positionBar =
      c.fiftyTwoWeekPosition == null
        ? ''
        : `      <div class="bar">
        <div class="bar-q"></div><div class="bar-q" style="left:50%"></div><div class="bar-q" style="left:75%"></div>
        <div class="bar-fill" style="left:${c.fiftyTwoWeekPosition.toFixed(2)}%"></div>
      </div>
      <div class="bar-labels"><span>52주 저</span><span>52주 고</span></div>`;
    const indicatorRows = renderIndicators(c.indicators);
    return `      <article class="card">
        <h3>${esc(s.name)} <span class="ticker">${esc(s.code)}</span></h3>
        <div class="row"><span class="label">현재가</span><span class="value strong">${price}</span><span class="change">${change}</span></div>
        <div class="row"><span class="label">52주 범위</span><span class="value">${lo} ~ ${hi}</span></div>
        <div class="row"><span class="label">위치</span><span class="value">${pos} <span class="quart">(${quart})</span></span></div>
${positionBar}
${refTable}
        <div class="row"><span class="label">PER · PBR · 배당</span><span class="value small">${per} · ${pbr} · ${div}</span></div>
${indicatorRows}
      </article>`;
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
  return `        <div class="row"><span class="label">RSI(14) · 200d 이격</span><span class="value small">${rsi}${rsiNote} · ${pct200}</span></div>
        <div class="row"><span class="label">수익률 1M / 3M</span><span class="value small">${r1} / ${r3}</span></div>
        <div class="row"><span class="label">최근 cross</span><span class="value small">${cross}</span></div>`;
}

function formatCross(c: CrossEvent | null): string {
  if (!c) return '최근 1년 내 없음';
  const label = c.kind === 'golden' ? '골든크로스' : '데드크로스';
  return `${label} · ${c.daysAgo}영업일 전 (${c.date})`;
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
