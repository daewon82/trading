import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  DashboardCard,
  Currency,
  Quartile,
} from '../types/stock.js';
import type { AnalystConsensus } from '../types/consensus.js';

export interface UniverseTop {
  ticker: string;
  name: string;
  market: 'KR' | 'US';
  card: DashboardCard;
  insight: InsightResult;
  score: number;
  consensus?: AnalystConsensus | null;
}

export interface DashboardPage {
  generatedAt: string;
  today: string;
  krWatchTop: UniverseTop[];
  krValueForeignBuyTop: UniverseTop[];
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
${this.renderUniverse('💖 나의 관심종목 — 외인·기관 수급 동향', '5일 / 20일 / 60일 누적 순매수면 ↑ 매수, 순매도면 ↓ 매도.', page.krWatchTop)}
${this.renderUniverse('💎 저평가 + 외인·기관 매수 추세 Top 5', 'KOSPI 가치주 시드(저PER·저PBR·고배당 큐레이션) 중 20일 외국인·기관 동반 순매수 합산 큰 순.', page.krValueForeignBuyTop)}
  <button id="topBtn" class="top-btn" aria-label="맨 위로" title="맨 위로">↑</button>
  <script>
    // 공통 — 한국 주요 종목 키워드 매핑 (회사명·별칭 → ticker)
    var KR_KEYWORDS = [
      { kw: ['삼성전자','samsung electronics','삼전'], sym: '005930.KS' },
      { kw: ['sk하이닉스','하이닉스','sk hynix'], sym: '000660.KS' },
      { kw: ['네이버','naver'], sym: '035420.KS' },
      { kw: ['카카오','kakao'], sym: '035720.KS' },
      { kw: ['카카오뱅크','카뱅'], sym: '323410.KS' },
      { kw: ['카카오페이'], sym: '377300.KS' },
      { kw: ['현대차','현대자동차','hyundai motor'], sym: '005380.KS' },
      { kw: ['기아','kia'], sym: '000270.KS' },
      { kw: ['lg에너지솔루션','엘지에너지','엘지엔솔','lg energy','lg엔솔','엔솔'], sym: '373220.KS' },
      { kw: ['lg화학','엘지화학','lg chem'], sym: '051910.KS' },
      { kw: ['lg전자','엘지전자','lg electronics'], sym: '066570.KS' },
      { kw: ['lg유플러스','엘지유플러스','유플러스','u+','lguplus'], sym: '032640.KS' },
      { kw: ['lg','lg corp','lg지주','엘지'], sym: '003550.KS' },
      { kw: ['삼성sdi'], sym: '006400.KS' },
      { kw: ['삼성바이오로직스','삼바','삼성바이오'], sym: '207940.KS' },
      { kw: ['삼성물산'], sym: '028260.KS' },
      { kw: ['삼성생명'], sym: '032830.KS' },
      { kw: ['삼성화재'], sym: '000810.KS' },
      { kw: ['삼성c&t','삼성씨앤티'], sym: '028260.KS' },
      { kw: ['셀트리온','celltrion'], sym: '068270.KS' },
      { kw: ['포스코홀딩스','posco홀딩스','포스코'], sym: '005490.KS' },
      { kw: ['포스코퓨처엠','퓨처엠'], sym: '003670.KS' },
      { kw: ['현대모비스','모비스'], sym: '012330.KS' },
      { kw: ['sk텔레콤','skt','에스케이텔레콤'], sym: '017670.KS' },
      { kw: ['kt','케이티'], sym: '030200.KS' },
      { kw: ['kt&g','ktg','케이티앤지'], sym: '033780.KS' },
      { kw: ['kb금융','kb','kb금융지주','국민은행'], sym: '105560.KS' },
      { kw: ['하나금융','하나금융지주','하나은행'], sym: '086790.KS' },
      { kw: ['신한지주','신한금융','신한은행'], sym: '055550.KS' },
      { kw: ['우리금융','우리금융지주','우리은행'], sym: '316140.KS' },
      { kw: ['기업은행','ibk'], sym: '024110.KS' },
      { kw: ['hd현대','현대중공업그룹'], sym: '267250.KS' },
      { kw: ['hd현대중공업','현대중공업'], sym: '329180.KS' },
      { kw: ['hd현대일렉트릭','현대일렉트릭','hd일렉'], sym: '267260.KS' },
      { kw: ['hd현대미포','현대미포'], sym: '010620.KS' },
      { kw: ['한화에어로스페이스','한화에어로'], sym: '012450.KS' },
      { kw: ['한화시스템'], sym: '272210.KS' },
      { kw: ['한국전력','한전','kepco'], sym: '015760.KS' },
      { kw: ['한미반도체'], sym: '042700.KS' },
      { kw: ['크래프톤','krafton'], sym: '259960.KS' },
      { kw: ['엔씨소프트','ncsoft','엔씨'], sym: '036570.KS' },
      { kw: ['넷마블','netmarble'], sym: '251270.KS' },
      { kw: ['cj제일제당'], sym: '097950.KS' },
      { kw: ['cj','씨제이'], sym: '001040.KS' },
      { kw: ['두산에너빌리티','두산에너','두산중공업'], sym: '034020.KS' },
      { kw: ['두산','doosan'], sym: '000150.KS' },
      { kw: ['에코프로비엠','에코프로bm'], sym: '247540.KQ' },
      { kw: ['에코프로'], sym: '086520.KQ' },
      { kw: ['알테오젠'], sym: '196170.KQ' },
      { kw: ['리노공업'], sym: '058470.KQ' },
      { kw: ['카페24'], sym: '042000.KQ' },
      { kw: ['컴투스'], sym: '078340.KQ' },
      { kw: ['펄어비스'], sym: '263750.KQ' },
      { kw: ['스튜디오드래곤'], sym: '253450.KQ' },
      { kw: ['하이브','hybe','BTS'], sym: '352820.KS' },
      { kw: ['에스엠','sm엔터'], sym: '041510.KQ' },
      { kw: ['jyp엔터','jyp'], sym: '035900.KQ' },
      { kw: ['와이지엔터','yg'], sym: '122870.KQ' },
      { kw: ['아모레퍼시픽','아모레'], sym: '090430.KS' },
      { kw: ['lg생활건강','엘지생건','lg생건'], sym: '051900.KS' },
      { kw: ['오리온','orion'], sym: '271560.KS' },
      { kw: ['농심'], sym: '004370.KS' },
      { kw: ['신세계'], sym: '004170.KS' },
      { kw: ['이마트','emart'], sym: '139480.KS' },
      { kw: ['롯데','lotte'], sym: '004990.KS' },
      { kw: ['현대건설'], sym: '000720.KS' },
      { kw: ['gs건설','지에스건설'], sym: '006360.KS' },
      { kw: ['대우건설'], sym: '047040.KS' },
      { kw: ['gs','지에스'], sym: '078930.KS' },
      { kw: ['s-oil','에스오일','sk이노베이션'], sym: '010950.KS' },
      { kw: ['sk이노','sk innovation'], sym: '096770.KS' },
    ];

    function tradingFindKrSymbol(query) {
      var q = String(query || '').toLowerCase().replace(/\s/g, '');
      if (!q) return null;
      for (var i = 0; i < KR_KEYWORDS.length; i++) {
        var entry = KR_KEYWORDS[i];
        for (var j = 0; j < entry.kw.length; j++) {
          var k = String(entry.kw[j]).toLowerCase().replace(/\s/g, '');
          if (k === q || k.includes(q) || q.includes(k)) return entry.sym;
        }
      }
      return null;
    }

    function tradingResolveQuery(rawInput) {
      var t = String(rawInput || '').trim();
      if (!t) return Promise.resolve([]);
      // 6자리 숫자 → KR ticker
      if (/^[0-9]{6}$/.test(t)) return Promise.resolve([t + '.KS', t + '.KQ']);
      // 영문 ticker (.KS, .KQ 포함 가능)
      if (/^[A-Za-z][A-Za-z0-9\.\-=\^]*$/.test(t)) {
        // 우선 영문 ticker로 시도, 안 되면 search
        return Promise.resolve([t.toUpperCase()]);
      }
      // 한국 매핑 우선
      var krSym = tradingFindKrSymbol(t);
      if (krSym) return Promise.resolve([krSym]);
      // Yahoo search (영문 회사명용)
      return fetch('https://query2.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(t) + '&quotesCount=5')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.quotes) return [];
          var equity = j.quotes.find(function (q) { return q.quoteType === 'EQUITY' && q.symbol; });
          var first = equity || j.quotes.find(function (q) { return q.symbol; });
          return first ? [first.symbol] : [];
        })
        .catch(function () { return []; });
    }

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

  private renderUniverse(title: string, intro: string, top: UniverseTop[]): string {
    if (!top || top.length === 0) return '';
    const cards = top
      .map((t, idx) => {
        const currency: Currency = t.market === 'KR' ? 'KRW' : 'USD';
        return this.renderUniverseCard(t, idx + 1, currency);
      })
      .join('\n');
    return `  <section class="universe">
    <h2>${esc(title)}</h2>
    <p class="universe-intro">${intro}</p>
    <div class="universe-list">
${cards}
    </div>
  </section>`;
  }

  private renderUniverseCard(t: UniverseTop, rank: number, _currency: Currency): string {
    const c = t.card;
    const s = c.snapshot;
    const flow = c.flow;
    const cell = (v: number | null | undefined): string => {
      if (v == null) return `<td class="flow-na">—</td>`;
      if (v > 0) return `<td class="flow-buy">↑ 매수</td>`;
      if (v < 0) return `<td class="flow-sell">↓ 매도</td>`;
      return `<td class="flow-na">—</td>`;
    };
    const flowRows = flow
      ? `<table class="flow-table">
          <thead><tr><th></th><th>5일</th><th>20일</th><th>60일</th></tr></thead>
          <tbody>
            <tr><th>외국인</th>${cell(flow.net5dForeigner)}${cell(flow.net20dForeigner)}${cell(flow.net60dForeigner)}</tr>
            <tr><th>기관</th>${cell(flow.net5dInstitutional)}${cell(flow.net20dInstitutional)}${cell(flow.net60dInstitutional)}</tr>
          </tbody>
        </table>`
      : `<p class="flow-empty">수급 데이터 없음</p>`;
    return `      <article class="universe-card">
        <div class="u-rank">#${rank}</div>
        <div class="u-body">
          <h3>${esc(s.name)} <span class="ticker">${esc(s.code)}</span></h3>
          ${flowRows}
        </div>
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
      .spark { width: 100%; height: 50px; display: block; margin: 8px 0 4px; }
      .flow-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: .9em; }
      .flow-table thead th { font-weight: 500; color: #888; padding: 4px 6px; text-align: center; border-bottom: 1px solid #eee; font-size: .85em; }
      .flow-table tbody th { text-align: left; padding: 6px 6px; font-weight: 500; color: #555; min-width: 60px; }
      .flow-table tbody td { text-align: center; padding: 6px 6px; font-variant-numeric: tabular-nums; }
      .flow-buy { color: #c62828; font-weight: 600; }
      .flow-sell { color: #2e7d32; font-weight: 600; }
      .flow-na { color: #bbb; }
      .flow-empty { color: #888; font-size: .9em; margin: 6px 0 0; }
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
      section.holdings { padding: 16px 24px; background: #f1f8e9; border-bottom: 1px solid #c5e1a5; }
      section.holdings h2 { font-size: 1.05em; margin: 0 0 6px; }
      .holdings-hint { font-size: .85em; color: #555; margin: 0 0 10px; line-height: 1.5; }
      .holding-form { display: flex; flex-wrap: wrap; gap: 8px; max-width: 720px; align-items: flex-start; }
      .holding-input-wrap { position: relative; flex: 1.5; min-width: 200px; }
      .holding-input-wrap input { width: 100%; }
      .holding-form input { padding: 8px 12px; font-size: 1em; border: 1px solid #ccc; border-radius: 4px; font-variant-numeric: tabular-nums; }
      .holding-form input[type="number"] { flex: 1; min-width: 110px; }
      .suggest-list { position: absolute; top: 100%; left: 0; right: 0; margin: 2px 0 0; padding: 0; list-style: none; background: #fff; border: 1px solid #ccc; border-radius: 4px; max-height: 280px; overflow-y: auto; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: none; }
      .suggest-list.show { display: block; }
      .suggest-item { padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; font-size: .9em; }
      .suggest-item:hover { background: #f0f4f8; }
      .suggest-name { color: #222; }
      .suggest-sym { color: #888; font-size: .85em; font-variant-numeric: tabular-nums; }
      .holding-form button { padding: 8px 16px; background: #2e7d32; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
      .holding-form button:hover { background: #1b5e20; }
      .holdings-empty { font-size: .9em; color: #888; margin: 14px 0 0; }
      .holdings-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; margin-top: 12px; }
      .holding-card { background: #fff; border: 1px solid #c5e1a5; border-radius: 8px; padding: 14px 16px; font-size: .9em; position: relative; }
      .holding-card h3 { margin: 0 0 8px; font-size: 1em; }
      .holding-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: .9em; border-bottom: 1px dashed #f0f0f0; }
      .pnl-up { color: #c62828; font-weight: 700; }
      .pnl-down { color: #2e7d32; font-weight: 700; }
      .sell-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: .72em; font-weight: 600; margin-left: 4px; }
      .sell-stop { background: #ffcdd2; color: #b71c1c; }
      .sell-take { background: #fff3e0; color: #ef6c00; }
      .sell-hold-up { background: #fce4ec; color: #ad1457; }
      .sell-hold-down { background: #e8f5e9; color: #2e7d32; }
      .sell-hold { background: #eceff1; color: #455a64; }
      .sell-na { background: #eee; color: #999; }
      .sell-reasons { margin-top: 6px; padding: 6px 8px; background: #fafafa; border-radius: 4px; font-size: .82em; color: #555; line-height: 1.5; }
      .holding-remove { margin-top: 10px; padding: 4px 12px; background: #888; color: #fff; border: 0; border-radius: 4px; cursor: pointer; font-size: .8em; }
      .holding-remove:hover { background: #555; }
      .holding-card.loading { color: #888; }
      .holding-card.error { background: #ffebee; }
      @media (max-width: 600px) {
        section.holdings { padding: 14px 16px; }
        .holding-form { flex-direction: column; }
        .holding-form input, .holding-form button { width: 100%; }
      }
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
      section.changelog { padding: 16px 24px; background: #fff8e1; border-bottom: 1px solid #ffe082; }
      section.changelog h2 { font-size: 1.05em; margin: 0 0 10px; color: #5d4037; }
      .cl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      .cl-block { background: #fff; border-radius: 6px; padding: 10px 14px; }
      .cl-block.cl-removed { border-left: 4px solid #c62828; }
      .cl-block.cl-added { border-left: 4px solid #2e7d32; }
      .cl-block h3 { margin: 0 0 6px; font-size: .95em; }
      .cl-removed h3 { color: #c62828; }
      .cl-added h3 { color: #2e7d32; }
      .cl-block ul { margin: 0; padding-left: 18px; font-size: .9em; }
      .cl-block li { margin-bottom: 6px; }
      .cl-section { color: #888; font-size: .82em; }
      .cl-detail { color: #555; font-size: .82em; margin-top: 2px; line-height: 1.4; }
      .cl-note { font-size: .8em; color: #888; margin: 8px 0 0; }
      section.universe { padding: 20px 24px; background: #fff8e1; border-top: 1px solid #ffe082; }
      section.universe h2 { margin: 0 0 6px; font-size: 1.1em; color: #5d4037; }
      .universe-intro { font-size: .85em; color: #555; margin: 0 0 14px; padding: 8px 12px; background: #fff; border-left: 3px solid #ef6c00; border-radius: 4px; line-height: 1.5; }
      .universe-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 10px; }
      .universe-card { background: #fff; border: 1px solid #ffe082; border-radius: 8px; padding: 10px 14px; display: flex; gap: 12px; }
      .u-rank { font-size: 1.4em; font-weight: 700; color: #ef6c00; min-width: 36px; text-align: center; padding-top: 2px; }
      .u-body { flex: 1; }
      .universe-card h3 { margin: 0 0 6px; font-size: 1em; }
      .u-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; padding: 2px 0; }
      .u-score { margin-left: auto; padding: 2px 8px; background: #ef6c00; color: #fff; border-radius: 12px; font-size: .82em; font-weight: 600; font-variant-numeric: tabular-nums; }
      .u-reasons { margin: 6px 0 0; padding-left: 18px; font-size: .82em; line-height: 1.55; }
      .u-bull { color: #c62828; }
      .u-bear { color: #2e7d32; }
      @media (max-width: 600px) {
        .universe-card { padding: 8px 10px; gap: 8px; }
        .u-rank { font-size: 1.1em; min-width: 28px; }
      }
      section.news { padding: 20px 24px; background: #f5f5f5; border-top: 1px solid #ddd; }
      section.news h2 { margin: 0 0 6px; font-size: 1.05em; }
      .news-note { font-size: .82em; color: #888; margin: 0 0 14px; }
      .news-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
      .news-block { background: #fff; border-radius: 6px; padding: 12px 14px; border: 1px solid #e6e6e6; }
      .news-block h3 { margin: 0 0 8px; font-size: .95em; color: #555; }
      .news-block ol { margin: 0; padding-left: 22px; font-size: .9em; line-height: 1.6; }
      .news-block li { margin-bottom: 6px; }
      .news-block a { color: #1976d2; text-decoration: none; }
      .news-block a:hover { text-decoration: underline; }
      .news-date { color: #999; font-size: .85em; margin-left: 6px; }
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

export interface InsightPattern {
  name: string;
  matched: number;
  total: number;
  description: string;
}

export interface InsightResult {
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

export function evaluateInsight(c: DashboardCard, market: 'KR' | 'US'): InsightResult {
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

  // 단기 급등 → 조정 압력 (다음날 mean reversion 위험)
  const recentSpike =
    ind?.lastDayReturn != null && ind.lastDayReturn > 10;
  if (ind?.lastDayReturn != null) {
    if (ind.lastDayReturn > 15) {
      cautious.push(`직전일 +${ind.lastDayReturn.toFixed(1)}% (강한 급등 — 조정 압력 ↑)`);
      cautious.push(`단기 차익실현 매물 가능성`);
    } else if (ind.lastDayReturn > 10) {
      cautious.push(`직전일 +${ind.lastDayReturn.toFixed(1)}% (단기 급등 — 조정 압력)`);
    } else if (ind.lastDayReturn > 7) {
      cautious.push(`직전일 +${ind.lastDayReturn.toFixed(1)}% (강세 — 조정 가능)`);
    } else if (ind.lastDayReturn < -10) {
      bullish.push(`직전일 ${ind.lastDayReturn.toFixed(1)}% (단기 급락 — 반등 가능)`);
    }
  }

  // 모멘텀
  if (ind?.rsi14 != null) {
    if (ind.rsi14 > 70) cautious.push(`RSI ${ind.rsi14.toFixed(0)} (과열, 70 초과)`);
    else if (ind.rsi14 < 30) bullish.push(`RSI ${ind.rsi14.toFixed(0)} (과매도, 반등 가능)`);
    else if (ind.rsi14 >= 50 && !recentSpike) {
      // 단기 급등 동반 시 RSI 매수 신호 제외 (이미 과열 위험 인지됨)
      bullish.push(`RSI ${ind.rsi14.toFixed(0)} (50 위 모멘텀)`);
    }
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
  // 12M 모멘텀 (Jegadeesh-Titman 효과)
  if (ind?.return12m != null) {
    if (ind.return12m > 20) bullish.push(`12M +${ind.return12m.toFixed(1)}% (장기 모멘텀 ↑)`);
    else if (ind.return12m < -20) bearish.push(`12M ${ind.return12m.toFixed(1)}% (장기 부진)`);
  }
  // 단기 mean reversion (1주 -5% 이상 + RSI 50 이하)
  if (
    ind?.return1w != null && ind.return1w < -5 &&
    ind?.rsi14 != null && ind.rsi14 < 50
  ) {
    bullish.push(`1주 ${ind.return1w.toFixed(1)}% (단기 반전 가능)`);
  }
  // 변동성 위험
  if (ind?.volatility20d != null) {
    if (ind.volatility20d > 50) cautious.push(`변동성 ${ind.volatility20d.toFixed(0)}% (매우 높음)`);
    else if (ind.volatility20d > 35) cautious.push(`변동성 ${ind.volatility20d.toFixed(0)}% (높음)`);
  }
  // 단기 지지선 테스트 (최근 20일 저점 ±3%)
  if (c.snapshot.price != null && ind?.recent20Low != null && ind.recent20Low > 0) {
    const distLow = ((c.snapshot.price - ind.recent20Low) / ind.recent20Low) * 100;
    if (distLow >= 0 && distLow < 3) {
      bullish.push(`최근 20일 저점 +${distLow.toFixed(1)}% (단기 지지선 테스트)`);
    }
  }
  // 단기 저항선 (최근 20일 고점 ±3%)
  if (c.snapshot.price != null && ind?.recent20High != null && ind.recent20High > 0) {
    const distHigh = ((c.snapshot.price - ind.recent20High) / ind.recent20High) * 100;
    if (distHigh > -3 && distHigh <= 0) {
      cautious.push(`최근 20일 고점 ${distHigh.toFixed(1)}% (단기 저항선)`);
    }
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
    // 외국계 거래원 — 당일 매수/매도 비율
    if (flow.foreignBrokerBuy != null && flow.foreignBrokerSell != null && flow.foreignBrokerSell > 0) {
      const ratio = flow.foreignBrokerBuy / flow.foreignBrokerSell;
      if (ratio >= 1.5) bullish.push(`외국계 거래원 매수 ${ratio.toFixed(1)}× 우위 (당일)`);
      else if (ratio <= 0.67) cautious.push(`외국계 거래원 매도 우위 (당일)`);
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
  const reasoning = explainDominance(dominantLabel, q, ind?.lastDayReturn);

  return { card: c, market, bullish, cautious, bearish, patterns, valuationLabel, trendLabel, dominance, reasoning };
}

function explainDominance(
  dominant: string,
  quartile: Quartile | null,
  lastDayReturn?: number | null,
): string {
  // 단기 급등 + 매수 우세 → 조정 위험 reasoning 우선
  if (lastDayReturn != null && lastDayReturn > 10 && dominant === '매수 우호 우세') {
    return `⚠️ 직전일 +${lastDayReturn.toFixed(1)}% 급등 — 추세는 강하지만 다음날 조정 압력 존재. 분할매수·진입가 조정 검토`;
  }
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

function formatPrice(v: number | null, currency: Currency): string {
  if (v == null) return '—';
  if (currency === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  return `$${v.toFixed(2)}`;
}

function renderConsensusRow(
  cons: AnalystConsensus | null | undefined,
  currentPrice: number | null,
  currency: Currency,
): string {
  if (!cons || cons.recommendationMean == null) return '';
  const meanScore = cons.recommendationMean.toFixed(2);
  const key = cons.recommendationKey ?? '';
  const keyKr =
    key === 'strong_buy' || key === 'strongBuy' ? '강력 매수'
    : key === 'buy' ? '매수'
    : key === 'hold' ? '보유'
    : key === 'underperform' ? '시장 하회'
    : key === 'sell' ? '매도'
    : key === 'strong_sell' || key === 'strongSell' ? '강력 매도'
    : key;
  const keyCls =
    cons.recommendationMean <= 1.5 ? 'cons-strongbuy'
    : cons.recommendationMean <= 2.5 ? 'cons-buy'
    : cons.recommendationMean <= 3.5 ? 'cons-hold'
    : 'cons-sell';
  const n = cons.numberOfAnalystOpinions ?? 0;
  let target = '';
  if (cons.targetMeanPrice != null) {
    const tgtStr = formatPrice(cons.targetMeanPrice, currency);
    let upside = '';
    if (currentPrice != null && currentPrice > 0) {
      const u = ((cons.targetMeanPrice - currentPrice) / currentPrice) * 100;
      const sign = u >= 0 ? '+' : '';
      const cls = u >= 0 ? 'upside-pos' : 'upside-neg';
      upside = ` <span class="${cls}">(${sign}${u.toFixed(1)}%)</span>`;
    }
    target = ` · 목표가 ${tgtStr}${upside}`;
  }
  const trend = cons.trend
    ? ` · <span class="trend-mini">SB ${cons.trend.strongBuy} · B ${cons.trend.buy} · H ${cons.trend.hold} · S ${cons.trend.sell} · SS ${cons.trend.strongSell}</span>`
    : '';
  return `          <div class="u-consensus"><span class="cons-tag ${keyCls}">애널리스트: ${esc(keyKr)} ${meanScore}/5</span> <span class="cons-meta">(${n}명)</span>${target}${trend}</div>`;
}

