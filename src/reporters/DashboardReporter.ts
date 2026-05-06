import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  StockDashboardSection,
  DashboardCard,
  Currency,
  Quartile,
} from '../types/stock.js';
import type { WeatherForecast, WeatherDay } from '../types/weather.js';
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
  <section class="search">
    <h2>🔎 종목 검색 (임시)</h2>
    <p class="search-hint">티커 입력 (예: <code>005930</code> 삼성전자, <code>AAPL</code> Apple). KR은 6자리 숫자, US는 알파벳. 결과는 페이지에 영구 추가되지 않습니다 — 새로고침하면 사라짐.</p>
    <form id="searchForm" class="search-form" onsubmit="return false">
      <input type="text" id="searchInput" placeholder="005930 또는 AAPL" autocomplete="off">
      <button type="submit" id="searchBtn">검색</button>
    </form>
    <div id="searchStatus" class="search-status"></div>
    <div id="searchResult" class="search-result"></div>
  </section>
${this.renderWeather(page.weather)}
${this.renderInsights(page)}
  <button id="topBtn" class="top-btn" aria-label="맨 위로" title="맨 위로">↑</button>
  <script>
    (function () {
      var btn = document.getElementById('topBtn');
      if (btn) {
        function onScroll() {
          if (window.scrollY > 600) btn.classList.add('show');
          else btn.classList.remove('show');
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        btn.addEventListener('click', function () {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        onScroll();
      }
    })();

    // 종목 검색 (Yahoo chart API 직접 호출, 클라이언트 측 임시 카드)
    (function () {
      var form = document.getElementById('searchForm');
      var input = document.getElementById('searchInput');
      var statusEl = document.getElementById('searchStatus');
      var resultEl = document.getElementById('searchResult');
      if (!form || !input || !statusEl || !resultEl) return;

      var YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';

      function setStatus(msg, cls) {
        statusEl.textContent = msg || '';
        statusEl.className = 'search-status' + (cls ? ' ' + cls : '');
      }

      function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function formatPrice(v, currency) {
        if (v == null) return '—';
        if (currency === 'KRW') return Math.round(v).toLocaleString('ko-KR') + '원';
        return '$' + Number(v).toFixed(2);
      }

      function sma(arr, period) {
        if (arr.length < period) return null;
        var sum = 0;
        for (var i = arr.length - period; i < arr.length; i++) sum += arr[i];
        return sum / period;
      }

      function rsi(arr, period) {
        if (arr.length < period + 1) return null;
        var g = 0, l = 0;
        for (var i = arr.length - period; i < arr.length; i++) {
          var d = arr[i] - arr[i - 1];
          if (d > 0) g += d; else l += -d;
        }
        var ag = g / period, al = l / period;
        if (al === 0) return ag === 0 ? 50 : 100;
        if (ag === 0) return 0;
        return 100 - 100 / (1 + ag / al);
      }

      function pctReturn(arr, lookback) {
        if (arr.length < lookback + 1) return null;
        var r = arr[arr.length - 1], p = arr[arr.length - 1 - lookback];
        if (p === 0) return null;
        return ((r - p) / p) * 100;
      }

      function sparkSvg(closes) {
        if (!closes || closes.length < 2) return '';
        var w = 280, h = 50;
        var min = closes[0], max = closes[0];
        for (var i = 0; i < closes.length; i++) {
          if (closes[i] < min) min = closes[i];
          if (closes[i] > max) max = closes[i];
        }
        var range = (max - min) || 1;
        var pts = closes.map(function (c, i) {
          var x = (i / (closes.length - 1)) * w;
          var y = h - ((c - min) / range) * h;
          return x.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
        var color = closes[closes.length - 1] >= closes[0] ? '#c62828' : '#2e7d32';
        return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><polyline fill="none" stroke="' + color + '" stroke-width="1.5" points="' + pts + '"/></svg>';
      }

      function tryFetch(symbol) {
        var period2 = Math.floor(Date.now() / 1000);
        var period1 = period2 - 365 * 86400;
        var url = YAHOO + '/' + encodeURIComponent(symbol) + '?period1=' + period1 + '&period2=' + period2 + '&interval=1d';
        return fetch(url).then(function (r) {
          if (!r.ok) return null;
          return r.json();
        }).then(function (j) {
          var res = j && j.chart && j.chart.result && j.chart.result[0];
          if (!res) return null;
          var ts = res.timestamp || [];
          var quote = res.indicators && res.indicators.quote && res.indicators.quote[0];
          if (!quote) return null;
          var closes = [];
          for (var i = 0; i < ts.length; i++) {
            if (quote.close && quote.close[i] != null) closes.push(quote.close[i]);
          }
          var meta = res.meta || {};
          return {
            symbol: meta.symbol,
            currency: meta.currency,
            price: meta.regularMarketPrice,
            previousClose: meta.chartPreviousClose,
            high52: meta.fiftyTwoWeekHigh,
            low52: meta.fiftyTwoWeekLow,
            longName: meta.longName || meta.shortName || meta.symbol,
            closes: closes,
          };
        }).catch(function () { return null; });
      }

      function resolveCandidates(input) {
        var t = input.trim().toUpperCase();
        if (!t) return [];
        // 6자리 숫자면 KR (.KS, .KQ)
        if (/^[0-9]{6}$/.test(t)) return [t + '.KS', t + '.KQ'];
        return [t];
      }

      function fetchTicker(rawInput) {
        var candidates = resolveCandidates(rawInput);
        var p = Promise.resolve(null);
        candidates.forEach(function (sym) {
          p = p.then(function (prev) {
            if (prev) return prev;
            return tryFetch(sym);
          });
        });
        return p;
      }

      function buildCardHtml(d, originalInput) {
        var change = (d.price != null && d.previousClose != null && d.previousClose !== 0)
          ? ((d.price - d.previousClose) / d.previousClose) * 100
          : null;
        var posPct = null;
        if (d.price != null && d.high52 != null && d.low52 != null && d.high52 !== d.low52) {
          posPct = ((d.price - d.low52) / (d.high52 - d.low52)) * 100;
        }
        var quart = posPct == null ? null : (posPct < 25 ? 1 : posPct < 50 ? 2 : posPct < 75 ? 3 : 4);

        var badgeText = '평가 데이터 없음', badgeCls = 'badge-na';
        if (quart === 1) { badgeText = '💰 저평가 영역 (Q1)'; badgeCls = 'badge-low'; }
        else if (quart === 2) { badgeText = '◐ 중하단 (Q2)'; badgeCls = 'badge-mid-low'; }
        else if (quart === 3) { badgeText = '◑ 중상단 (Q3)'; badgeCls = 'badge-mid-high'; }
        else if (quart === 4) { badgeText = '⚠ 고평가 영역 (Q4)'; badgeCls = 'badge-high'; }

        var sma50 = sma(d.closes, 50);
        var sma200 = sma(d.closes, 200);
        var rsi14 = rsi(d.closes, 14);
        var pctVs200 = (d.price != null && sma200 != null && sma200 !== 0)
          ? ((d.price - sma200) / sma200) * 100 : null;
        var r1m = pctReturn(d.closes, 21);
        var r3m = pctReturn(d.closes, 63);

        var trendLabel = '판단 보류';
        if (sma200 != null && pctVs200 != null) {
          if (pctVs200 > 5) trendLabel = '상승 추세 (200일선 위 +' + pctVs200.toFixed(1) + '%)';
          else if (pctVs200 < -5) trendLabel = '하락 추세 (200일선 아래 ' + pctVs200.toFixed(1) + '%)';
          else trendLabel = '횡보 (200일선 부근)';
        }

        var changeStr = change == null ? '—' : (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
        var posStr = posPct == null ? '52주 —' : '52주 ' + posPct.toFixed(0) + '% (Q' + quart + ')';
        var rsiStr = rsi14 == null ? '—' : rsi14.toFixed(0);
        var rsiNote = rsi14 == null ? '' : (rsi14 > 70 ? ' (과열)' : rsi14 < 30 ? ' (과매도)' : '');
        var pct200Str = pctVs200 == null ? '—' : (pctVs200 >= 0 ? '+' : '') + pctVs200.toFixed(1) + '%';
        var r1Str = r1m == null ? '—' : (r1m >= 0 ? '+' : '') + r1m.toFixed(1) + '%';
        var r3Str = r3m == null ? '—' : (r3m >= 0 ? '+' : '') + r3m.toFixed(1) + '%';

        var sparklineCloses = d.closes.slice(-60);

        return '<article class="insight-card">' +
          '<h3>' + escHtml(d.longName) + ' <span class="ticker">' + escHtml(d.symbol || originalInput) + '</span> <span class="eval-badge ' + badgeCls + '">' + escHtml(badgeText) + '</span></h3>' +
          '<div class="ic-head">' +
            '<span class="ic-price-current">' + formatPrice(d.price, d.currency) + '</span>' +
            '<span class="ic-price-change">' + changeStr + '</span>' +
            '<span class="ic-pos">' + posStr + '</span>' +
          '</div>' +
          sparkSvg(sparklineCloses) +
          '<div class="insight-row"><span class="ins-label">추세</span><span class="ins-value">' + escHtml(trendLabel) + '</span></div>' +
          '<div class="insight-row"><span class="ins-label">RSI(14) · 200d 이격</span><span class="ins-value">' + rsiStr + rsiNote + ' · ' + pct200Str + '</span></div>' +
          '<div class="insight-row"><span class="ins-label">수익률 1M / 3M</span><span class="ins-value">' + r1Str + ' / ' + r3Str + '</span></div>' +
          '<p class="insight-note">※ 검색 임시 결과 (Yahoo chart 기반). 외국인/기관 수급·PER/PBR 등은 페이지 영구 카드에서 확인. 매수 결정은 본인.</p>' +
          '<button class="search-close" onclick="document.getElementById(\\'searchResult\\').innerHTML=\\'\\'">닫기</button>' +
          '</article>';
      }

      form.addEventListener('submit', function () {
        var raw = (input.value || '').trim();
        if (!raw) { setStatus('티커를 입력해 주세요.', 'err'); return; }
        setStatus('검색 중…', '');
        resultEl.innerHTML = '';
        fetchTicker(raw).then(function (data) {
          if (!data) {
            setStatus('데이터 없음 — 티커 형식 확인 (예: 005930, AAPL)', 'err');
            return;
          }
          setStatus('완료: ' + (data.longName || data.symbol), 'ok');
          resultEl.innerHTML = buildCardHtml(data, raw);
        });
      });
    })();
  </script>
</body>
</html>
`;
  }

  private renderInsights(page: DashboardPage): string {
    const krInsights = page.kr.cards.map((c) => evaluateInsight(c, 'KR'));
    const usInsights = page.us.cards.map((c) => evaluateInsight(c, 'US'));
    const valueInsights = page.valueKr?.cards.map((c) => evaluateInsight(c, 'KR')) ?? [];
    if (krInsights.length === 0 && usInsights.length === 0 && valueInsights.length === 0) return '';

    const renderGroup = (title: string, intro: string, ins: InsightResult[], currency: Currency): string => {
      if (ins.length === 0) return '';
      const cards = ins.map((i) => renderInsightCard(i, currency)).join('\n');
      const introHtml = intro ? `      <p class="group-intro">${intro}</p>` : '';
      return `    <div class="insight-group">
      <h3 class="insight-group-title">${esc(title)}</h3>
${introHtml}
      <div class="insights-cards">
${cards}
      </div>
    </div>`;
    };

    return `  <section class="insights">
    <p class="insight-intro"><strong>매수 결정은 사용자 본인 판단입니다.</strong> 신호 발생은 사실 정보이며 매수 권유가 아닙니다. 모든 신호가 충족돼도 손실 가능.<br><br><strong>📌 평가 배지 vs 우세 비율</strong> — <strong>평가 배지</strong>(저평가/고평가)는 52주 가격 분위 1차원 정보, <strong>우세 비율</strong>은 추세·모멘텀·수급 등 종합 신호 카운트입니다. <strong>"저평가인데 매도 우세"는 모순이 아닌 가치 함정(value trap) 의심 신호</strong>일 수 있음 — 가격이 싸지만 계속 떨어지는 중일 가능성.</p>
${renderGroup(`🇰🇷 국내 주식 (${krInsights.length}종)`, '', krInsights, 'KRW')}
${renderGroup(`🇺🇸 미국 빅테크 (${usInsights.length}종)`, '', usInsights, 'USD')}
${renderGroup(`📚 저평가 후보 — KOSPI 가치주 시드 (${valueInsights.length}종)`, '저PER · 저PBR · 고배당 등 객관 기준으로 거론되는 가치주 후보입니다. <strong>매수 추천이 아닙니다.</strong> 가치 함정(value trap) 위험 — 산업 사양·실적 악화로 영구 저평가될 수도 있습니다.', valueInsights, 'KRW')}
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
      .group-intro { margin: 0 0 12px; padding: 8px 12px; background: #fff3e0; border-left: 3px solid #ef6c00; border-radius: 4px; font-size: .85em; color: #555; line-height: 1.5; }
      .eval-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: .72em; font-weight: 600; margin-left: 4px; vertical-align: middle; }
      .eval-badge.badge-low { background: #c8e6c9; color: #1b5e20; }
      .eval-badge.badge-mid-low { background: #f0f4c3; color: #555; }
      .eval-badge.badge-mid-high { background: #ffe0b2; color: #6d4c41; }
      .eval-badge.badge-high { background: #ffcdd2; color: #b71c1c; }
      .eval-badge.badge-na { background: #eee; color: #999; }
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
      .dom-reason { margin-top: 6px; padding: 6px 10px; background: #fff; border-left: 3px solid #1976d2; border-radius: 4px; font-size: .82em; color: #555; line-height: 1.5; }
      section.search { padding: 16px 24px; background: #f0f4f8; border-bottom: 1px solid #d6dee6; }
      .search-hint { margin: 0 0 10px; font-size: .85em; color: #555; line-height: 1.5; }
      .search-hint code { background: #fff; padding: 1px 6px; border-radius: 3px; font-size: .92em; }
      .search-form { display: flex; gap: 8px; max-width: 480px; }
      .search-form input { flex: 1; padding: 8px 12px; font-size: 1em; border: 1px solid #ccc; border-radius: 4px; font-variant-numeric: tabular-nums; }
      .search-form button { padding: 8px 16px; font-size: 1em; background: #1976d2; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
      .search-form button:hover { background: #1565c0; }
      .search-status { font-size: .85em; margin: 8px 0; min-height: 1em; color: #555; }
      .search-status.err { color: #c62828; }
      .search-status.ok { color: #1b5e20; }
      .search-result { margin-top: 8px; }
      .search-result .insight-card { max-width: 480px; }
      .search-close { margin-top: 10px; padding: 6px 14px; background: #888; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-size: .85em; }
      .search-close:hover { background: #666; }
      @media (max-width: 600px) {
        section.search { padding: 14px 16px; }
        .search-form { flex-direction: column; }
        .search-form input, .search-form button { width: 100%; }
      }
      .top-btn { position: fixed; right: 20px; bottom: 20px; width: 44px; height: 44px; border-radius: 50%; border: 0; background: #1976d2; color: #fff; font-size: 1.4em; line-height: 1; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.2); opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity .2s, transform .2s; z-index: 1000; }
      .top-btn.show { opacity: 1; pointer-events: auto; transform: translateY(0); }
      .top-btn:hover { background: #1565c0; }
      .top-btn:active { background: #0d47a1; }
      @media (max-width: 600px) {
        .top-btn { right: 14px; bottom: 14px; width: 40px; height: 40px; font-size: 1.2em; }
      }
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
  reasoning: string;
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
  const reasoning = explainDominance(dominantLabel, q);

  return { card: c, market, bullish, cautious, bearish, patterns, valuationLabel, trendLabel, dominance, reasoning };
}

function explainDominance(dominant: string, quartile: Quartile | null): string {
  if (dominant === '매수 우호 우세') {
    if (quartile === 1) return '저평가 + 추세도 양호 — 가치주 회복 신호일 수 있음';
    if (quartile === 4) return '고평가지만 정배열·수급 등 모멘텀 강함 — 추세 추종형';
    if (quartile === 2 || quartile === 3) return '중간 가격대 + 모멘텀 우호';
    return '추세·모멘텀 신호가 우호적';
  }
  if (dominant === '매도 우호 우세') {
    if (quartile === 1) return '⚠️ 저평가지만 역배열·수급 약세 — <strong>가치 함정(value trap) 의심</strong>. 가격이 싼 데는 이유가 있을 수 있음';
    if (quartile === 4) return '고평가에서 약세 전환 — 차익실현 압력 추정';
    if (quartile === 2 || quartile === 3) return '약세 신호 다수 — 추세 약화 진행';
    return '추세 약세 + 수급 약화 동반';
  }
  if (dominant === '신중 우세') {
    if (quartile === 4) return '고평가 + 과열 신호 — 단기 조정 가능성';
    if (quartile === 1) return '저평가 + 일부 신중 신호 — 진입 타이밍 추가 검토 필요';
    return '혼합 신호 — 명확한 방향성 부족';
  }
  if (dominant === '혼합 (동률)') return '신호 동률 — 어느 한쪽으로 기울지 않음';
  return '신호 부족';
}

function renderInsightCard(ins: InsightResult, currency: Currency): string {
  const c = ins.card;
  const s = c.snapshot;

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
  const listOf = (arr: string[]) =>
    arr.length === 0
      ? '<li class="empty">해당 신호 없음</li>'
      : arr.map((b) => `<li>${esc(b)}</li>`).join('');

  const d = ins.dominance;
  const bullW = d.bullishPct.toFixed(1);
  const cautW = d.cautiousPct.toFixed(1);
  const bearW = d.bearishPct.toFixed(1);
  const dominantCls =
    d.dominantLabel.startsWith('매수') ? 'dom-label-bull'
    : d.dominantLabel.startsWith('매도') ? 'dom-label-bear'
    : d.dominantLabel.startsWith('신중') ? 'dom-label-caut'
    : 'dom-label-mix';

  // 평가 배지 (카드 헤더에 색상 강조)
  const q = c.quartile;
  let badgeText = '평가 데이터 없음';
  let badgeCls = 'badge-na';
  if (q === 1) { badgeText = '💰 저평가 영역 (Q1)'; badgeCls = 'badge-low'; }
  else if (q === 2) { badgeText = '◐ 중하단 (Q2)'; badgeCls = 'badge-mid-low'; }
  else if (q === 3) { badgeText = '◑ 중상단 (Q3)'; badgeCls = 'badge-mid-high'; }
  else if (q === 4) { badgeText = '⚠ 고평가 영역 (Q4)'; badgeCls = 'badge-high'; }

  return `      <article class="insight-card">
        <h3>${esc(s.name)} <span class="ticker">${esc(s.code)}</span> <span class="eval-badge ${badgeCls}">${esc(badgeText)}</span></h3>
        <div class="ic-head">
          <span class="ic-price-current">${price}</span>
          <span class="ic-price-change">${change}</span>
          <span class="ic-pos">${pos}</span>
        </div>
${spark}
        <div class="insight-row"><span class="ins-label">추세</span><span class="ins-value">${esc(ins.trendLabel)}</span></div>
        <div class="dominance">
          <div class="dom-bar">
            <div class="dom-seg dom-bull" style="width:${bullW}%" title="매수 우호 ${bullW}%"></div>
            <div class="dom-seg dom-caut" style="width:${cautW}%" title="신중 ${cautW}%"></div>
            <div class="dom-seg dom-bear" style="width:${bearW}%" title="매도 우호 ${bearW}%"></div>
          </div>
          <div class="dom-stats">
            <span class="dom-bull-text">⊕ ${bullW}% (${ins.bullish.length})</span>
            <span class="dom-caut-text">⚠ ${cautW}% (${ins.cautious.length})</span>
            <span class="dom-bear-text">⊖ ${bearW}% (${ins.bearish.length})</span>
          </div>
          <div class="dom-summary">→ <strong class="${dominantCls}">${esc(d.dominantLabel)}</strong></div>
          <div class="dom-reason">${ins.reasoning}</div>
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
        <p class="insight-note">※ 사실 정보. 매수/매도 결정 아님.</p>
      </article>`;
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
