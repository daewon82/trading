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
  /** v1.1 — 코스피 가치주 스크리너 Top 5 (멀티팩터 점수). 각 card.valuation 채워짐. */
  krValueScreenerTop?: UniverseTop[];
  /** v1.3 — 100만원 코스피 매매 시그널 + 포트폴리오 분배 */
  krPortfolioPlan?: import('../types/trading-signal.js').PortfolioPlan | null;
  /** v1.4 — 코스피 공포·탐욕 지수 (머신러너 방법론 차용) */
  krFearGreed?: import('../types/fear-greed.js').FearGreedIndex | null;
  /** v1.7 — 코스피 지수 현재값 + 당일 등락률 */
  kospiIndex?: { value: number | null; changePct: number | null } | null;
  /** v1.7 — 거래량 Top 10 (KOSPI 비ETF) */
  volumeTop10?: import('../sources/naver-kr/NaverVolumeRankSource.js').VolumeRankRow[];
  /** v1.7 — 돌팬티 종가매매 룰 기반 매수 추천 */
  eodPicks?: import('../analyzers/EndOfDayPicker.js').EndOfDayPick[];
  /** v1.7 — 시장 이벤트 (옵션 만기일·쿼드러플 위칭·배당락 등) */
  marketEvents?: import('../analyzers/MarketEventCalendar.js').MarketEvent[];
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
  <meta http-equiv="refresh" content="300">
  <title>대시보드 ${esc(page.today)}</title>
  <style>${this.css()}</style>
</head>
<body>
  <header>
    <h1>오늘의 대시보드 <span class="live-dot" title="장중 5분 자동 갱신">●</span></h1>
    <div class="meta">${esc(page.today)} · 생성 ${esc(page.generatedAt)} · <span class="refresh-note">5분마다 자동 새로고침</span></div>
    ${this.renderKospiIndex(page.kospiIndex)}
    ${this.renderMarketEvents(page.marketEvents)}
    ${this.renderHeaderSummary(page)}
    <p class="disclaimer">⚠️ 본 페이지는 객관적 정량 지표를 표시하는 정보 제공 화면이며, 매수/매도 권유 또는 투자 자문이 아닙니다. 모든 투자 판단과 결과 책임은 사용자에게 있습니다.</p>
  </header>
${this.renderVolumeTop10(page.volumeTop10)}
${this.renderEodPicks(page.eodPicks)}
${this.renderFearGreed(page.krFearGreed)}
${this.renderPortfolioPlan(page.krPortfolioPlan)}
${this.renderUniverse('💼 내 보유 종목 — 외인·기관 수급 동향', '각 컬럼은 정확히 그 기간 데이터 (Toss 원본, 거래대금 단위 원/억/조). 오늘=당일, 5/20/60일=직전 거래일 누적 순매수. ↑ 빨강=순매수, ↓ 초록=순매도, ⏱=장중 미확정. 카드 라벨은 <b>오늘 데이터 우선</b>(외인+기관 동반 일치) → 5일 → 20일 → 60일 순.', page.krWatchTop)}
${this.renderUniverse('💎 저평가 + 외인·기관 매수 + 품질 B 이상 Top 10', 'KOSPI 가치주 시드(40종) 중 20일 외인·기관 동반 순매수 + 품질 점수 B 등급(50점) 이상. 합산 매수 큰 순.', page.krValueForeignBuyTop)}
${this.renderValueScreener(page.krValueScreenerTop)}
  <button id="topBtn" class="top-btn" aria-label="맨 위로" title="맨 위로">↑</button>
  <script>
    // 홈화면 추가/PWA 대응 — 페이지 복귀 시 자동 새로고침
    // (meta refresh는 백그라운드에선 정지되므로 visibilitychange + pageshow로 보완)
    (function () {
      var REFRESH_MIN_MS = 60000; // 마지막 로드 후 60초 지나야 재로드
      var loadedAt = Date.now();
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && Date.now() - loadedAt > REFRESH_MIN_MS) {
          window.location.reload();
        }
      });
      // bfcache 복원 시
      window.addEventListener('pageshow', function (e) {
        if (e.persisted) window.location.reload();
      });
    })();

    // 토스증권 — 모바일은 supertoss:// deep link로 앱 호출, PC는 웹 페이지
    window.openTossApp = function (e, webUrl) {
      var ua = navigator.userAgent || '';
      if (!/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return true;
      e.preventDefault();
      var deepLink = 'supertoss://securities?url=' + encodeURIComponent(webUrl);
      window.location.href = deepLink;
      // 앱 미설치 시 fallback — 1.5초 후 웹 URL로
      setTimeout(function () {
        if (!document.hidden) window.location.href = webUrl;
      }, 1500);
      return false;
    };

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

  /**
   * v1.1 — 🏆 코스피 가치주 스크리너 Top 5 (claude.md §4.5).
   * 멀티팩터(PBR·PER·ROE·외인·기관·섹터) 점수 70↑ 💎 가치 우량, 50~69 🔍 가치 후보.
   */
  private renderValueScreener(top: UniverseTop[] | undefined): string {
    if (!top || top.length === 0) {
      return `  <section class="universe value-screener">
    <h2>🏆 코스피 가치주 스크리너 Top 5</h2>
    <p class="universe-intro value-intro">조건(AND): <code>PBR ≤ 1.0</code> · <code>PER ≤ 15</code> · <code>ROE ≥ 8%</code> · 외인+기관 20일 동반 순매수 · 시총 ≥ 5,000억원. 주도 섹터(반도체·조선·방산·은행/금융) +5 보너스.</p>
    <p class="value-empty">현재 조건을 모두 충족하는 종목이 없습니다 — 시장 전반 고평가 구간으로 추정됩니다.</p>
  </section>`;
    }
    const cards = top.map((t, i) => this.renderValueScreenerCard(t, i + 1)).join('\n');
    return `  <section class="universe value-screener">
    <h2>🏆 코스피 가치주 스크리너 Top 5</h2>
    <p class="universe-intro value-intro">조건(AND): <code>PBR ≤ 1.0</code> · <code>PER ≤ 15</code> · <code>ROE ≥ 8%</code> · 외인+기관 20일 동반 순매수 · 시총 ≥ 5,000억원. 주도 섹터(반도체·조선·방산·은행/금융) +5 보너스. 점수 70↑ 💎 가치 우량, 50~69 🔍 가치 후보.</p>
    <div class="universe-list">
${cards}
    </div>
  </section>`;
  }

  private renderValueScreenerCard(t: UniverseTop, rank: number): string {
    const c = t.card;
    const s = c.snapshot;
    const v = c.valuation;
    if (!v) return '';
    const price = formatPrice(s.price, 'KRW');
    const changeCls = s.changePercent == null ? '' : s.changePercent >= 0 ? 'price-up' : 'price-down';
    const change = s.changePercent == null
      ? ''
      : `<span class="${changeCls}">${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%</span>`;
    const pos = c.fiftyTwoWeekPosition;
    const posStr = pos == null ? '' : `<span class="u-pos">52주 위치 ${pos.toFixed(0)}%</span>`;
    const badge = v.badge === '가치 우량'
      ? `<span class="value-badge badge-premium">💎 가치 우량</span>`
      : v.badge === '가치 후보'
        ? `<span class="value-badge badge-candidate">🔍 가치 후보</span>`
        : '';
    const leadSectors = ['반도체', '조선', '방산', '은행/금융'];
    const sectorCls = leadSectors.includes(v.sector) ? 'sector-tag lead' : 'sector-tag';
    const sectorIcon = sectorEmoji(v.sector);
    const sectorChip = `<span class="${sectorCls}">${sectorIcon} ${esc(v.sector)}</span>`;
    const pbrStrCls = pbrClass(v.metrics.pbr);
    const perStrCls = perClass(v.metrics.per);
    const roeStrCls = roeClass(v.metrics.roe);
    const flow = c.flow;
    const flowRows = renderFlowTable(flow);
    const cardCls = v.badge === '가치 우량' ? 'universe-card value-card gold' : 'universe-card value-card';
    return `      <article class="${cardCls}">
        <div class="u-rank">#${rank}</div>
        <div class="u-body">
          <h3><a class="toss-link" href="https://tossinvest.com/stocks/A${esc(s.code)}" target="_blank" rel="noopener noreferrer" onclick="return openTossApp(event, this.href)" title="모바일: 토스 앱 / PC: 웹">${esc(v.name)} <span class="ticker">${esc(v.code)}</span></a>${badge}${sectorChip}</h3>
          <div class="u-price"><span class="price-now">${price}</span> ${change} ${posStr}</div>
          <div class="value-gauge" title="가치 점수 ${v.total}/100">
            <div class="value-bar"><div class="value-bar-fill" style="width: ${v.total}%"></div></div>
            <div class="value-total">${v.total}<span class="value-max">/100</span></div>
          </div>
          <div class="value-metrics">
            <div class="vm-cell ${pbrStrCls}"><div class="vm-k">PBR</div><div class="vm-v">${fmtMetric(v.metrics.pbr, 2)}</div></div>
            <div class="vm-cell ${perStrCls}"><div class="vm-k">PER</div><div class="vm-v">${fmtMetric(v.metrics.per, 2)}</div></div>
            <div class="vm-cell ${roeStrCls}"><div class="vm-k">ROE</div><div class="vm-v">${fmtMetric(v.metrics.roe, 1)}%</div></div>
          </div>
          <details class="score-detail">
            <summary>점수 상세</summary>
            <div class="qs-rows">
              <div><span>PBR</span><b>${v.breakdown.pbr.toFixed(1)}/20</b></div>
              <div><span>PER</span><b>${v.breakdown.per.toFixed(1)}/20</b></div>
              <div><span>ROE</span><b>${v.breakdown.roe.toFixed(1)}/20</b></div>
              <div><span>외인 20d</span><b>${v.breakdown.foreignerFlow.toFixed(1)}/20</b></div>
              <div><span>기관 20d</span><b>${v.breakdown.institutionalFlow.toFixed(1)}/20</b></div>
              <div><span>섹터 보너스</span><b>${v.breakdown.sectorBonus}/5</b></div>
            </div>
          </details>
          ${flowRows}
        </div>
      </article>`;
  }

  /**
   * v1.6 — 헤더 한 줄 요약 위젯.
   * F&G 지수 + 매수/매도 카운트 + 강력매수 Top 1 종목을 압축 표시.
   * 매일 첫 화면 진입 시 즉시 시장·신호 상태 인지 가능.
   */
  /**
   * v1.7 — 헤더 최상단 코스피 지수 표시.
   * 사용자 요청: "맨 상단에 오늘 코스피 지수".
   */
  private renderKospiIndex(idx: DashboardPage['kospiIndex']): string {
    if (!idx || idx.value == null) return '';
    const v = idx.value;
    const ch = idx.changePct;
    const sign = ch == null ? '' : ch >= 0 ? '+' : '';
    const cls = ch == null ? 'flat' : ch >= 0 ? 'up' : 'down';
    const chStr = ch == null ? '—' : `${sign}${ch.toFixed(2)}%`;
    return `<div class="kospi-bar ${cls}">
      <span class="kospi-label">📈 코스피</span>
      <span class="kospi-value">${v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</span>
      <span class="kospi-change">${chStr}</span>
    </div>`;
  }

  /**
   * v1.7 — 시장 이벤트 경고 (옵션 만기일·쿼드러플 위칭·배당락).
   * 7일 이내 이벤트만 강조 표시. 14일 범위.
   */
  private renderMarketEvents(events: DashboardPage['marketEvents']): string {
    if (!events || events.length === 0) return '';
    // 미래 또는 오늘 이벤트만, 가까운 순
    const upcoming = events.filter((e) => e.daysUntil >= 0).slice(0, 3);
    if (upcoming.length === 0) return '';
    const chips = upcoming.map((e) => {
      const sev = `ev-sev-${e.severity}`;
      const tag = e.daysUntil === 0 ? '오늘'
        : e.daysUntil === 1 ? '내일'
        : `D-${e.daysUntil}`;
      return `<div class="ev-chip ${sev}">
        <span class="ev-tag">${esc(tag)}</span>
        <span class="ev-label">${esc(e.label)}</span>
        <span class="ev-date">${esc(e.date)}</span>
        <span class="ev-impact">${esc(e.impact)}</span>
      </div>`;
    }).join('');
    return `<div class="market-events">
      <div class="ev-title">⚠️ 시장 이벤트 캘린더 — 종가매매·단타 영향</div>
      <div class="ev-list">${chips}</div>
    </div>`;
  }

  /**
   * v1.7 — 거래량 Top 10 (KOSPI 비ETF). 돌팬티 종가매매 시드.
   */
  private renderVolumeTop10(rows: DashboardPage['volumeTop10']): string {
    if (!rows || rows.length === 0) return '';
    const trs = rows.map((r) => {
      const chCls = r.changePct == null ? '' : r.changePct >= 0 ? 'up' : 'down';
      const chStr = r.changePct == null ? '—'
        : `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}%`;
      const tv = formatKrwShort(r.tradingValue);
      const vol = r.volume.toLocaleString('ko-KR');
      return `<tr>
        <td class="rank">${r.rank}</td>
        <td class="name"><a href="https://finance.naver.com/item/main.naver?code=${esc(r.code)}" target="_blank" rel="noopener">${esc(r.name)}</a></td>
        <td class="num">${r.price.toLocaleString('ko-KR')}</td>
        <td class="num ${chCls}">${chStr}</td>
        <td class="num">${vol}</td>
        <td class="num">${tv}</td>
        <td class="num muted">${r.per != null ? r.per.toFixed(1) : '—'}</td>
      </tr>`;
    }).join('');
    return `  <section class="volume-top10">
    <h2>🔥 오늘 거래량 Top 10 <span class="src-note">— KOSPI 비ETF (네이버 금융)</span></h2>
    <p class="intro">돈이 몰리는 곳에 상승이 있다 — 종가매매 후보 발굴 시드. ETF/ETN/레버리지/인버스 제외.</p>
    <table class="vt-tbl">
      <thead><tr>
        <th>순위</th><th>종목</th><th>현재가</th><th>등락률</th><th>거래량</th><th>거래대금</th><th>PER</th>
      </tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </section>`;
  }

  /**
   * v1.7 — 돌팬티 종가매매 룰 기반 매수 추천.
   * 거래량 Top 10 종목을 5팩터(거래대금·수급·거래량·캔들·52주)로 점수화 후 우선순위 정렬.
   */
  private renderEodPicks(picks: DashboardPage['eodPicks']): string {
    if (!picks || picks.length === 0) return '';
    const cards = picks.map((p, idx) => {
      const ord = idx + 1;
      const recCls = p.recommendation === '🔥 강력 추천' ? 'eod-strong'
        : p.recommendation === '⚡ 추천' ? 'eod-buy'
        : p.recommendation === '💡 관망' ? 'eod-hold' : 'eod-skip';
      const chCls = p.changePct == null ? '' : p.changePct >= 0 ? 'up' : 'down';
      const chStr = p.changePct == null ? '—'
        : `${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(2)}%`;
      const volR = p.volumeRatio != null ? `${p.volumeRatio.toFixed(1)}×` : '—';
      const pos = p.fiftyTwoWeekPositionPct != null
        ? `${p.fiftyTwoWeekPositionPct.toFixed(0)}%` : '—';
      const flowF = p.todayForeignerNet;
      const flowI = p.todayInstitutionalNet;
      const flowStr = (flowF == null && flowI == null) ? '—'
        : `외인 ${formatFlow(flowF)} / 기관 ${formatFlow(flowI)}`;
      const factorRows = p.factors.map((f) => {
        const sign = f.weight >= 0 ? '+' : '';
        return `<li><span class="f-cat">${esc(f.category)}</span> <b>${sign}${f.weight}</b> <span class="f-det">${esc(f.detail)}</span></li>`;
      }).join('');
      return `<div class="eod-card ${recCls}">
        <div class="eod-head">
          <span class="eod-ord">#${ord}</span>
          <span class="eod-name"><a href="https://finance.naver.com/item/main.naver?code=${esc(p.code)}" target="_blank" rel="noopener">${esc(p.name)}</a> <span class="eod-code">${esc(p.code)}</span></span>
          <span class="eod-rec">${esc(p.recommendation)} <b>${p.totalScore}</b>점</span>
        </div>
        <div class="eod-stats">
          <span>${p.price.toLocaleString('ko-KR')}원</span>
          <span class="${chCls}">${chStr}</span>
          <span>거래량 ${volR}</span>
          <span>52주 ${pos}</span>
          <span class="eod-flow">${flowStr}</span>
        </div>
        <ul class="eod-factors">${factorRows}</ul>
      </div>`;
    }).join('');
    return `  <section class="eod-picks">
    <h2>📌 오늘 종가 매수 추천 <span class="src-note">— 돌팬티 종가매매 룰 (거래대금·수급·거래량·양봉·52주)</span></h2>
    <p class="intro">거래량 Top 10 중 5팩터 점수 정렬. <b>🔥 강력 추천 70+</b> / <b>⚡ 추천 50~69</b> / <b>💡 관망 30~49</b>. ⚠️ 매수가·손절가 단정 추천 없음 — 점수와 근거만 제공.</p>
    <div class="eod-list">${cards}</div>
  </section>`;
  }

  private renderHeaderSummary(page: DashboardPage): string {
    const plan = page.krPortfolioPlan;
    const fg = page.krFearGreed;
    if (!plan && !fg) return '';
    const parts: string[] = [];
    if (fg) {
      const fgCls = `fg-zone-${fg.zone.replace('_', '-')}`;
      parts.push(`<span class="hs-chip ${fgCls}">🌡️ F&amp;G <b>${fg.value}</b> ${esc(fg.label)}</span>`);
    }
    if (plan) {
      const buyN = plan.slots.length;
      const strongBuyTop = plan.slots.find((s) => s.signal.action === 'STRONG_BUY');
      const buyChip = buyN > 0
        ? `<span class="hs-chip hs-buy">💡 매수 후보 <b>${buyN}</b>종</span>`
        : `<span class="hs-chip hs-neutral">💡 매수 후보 없음 (관망)</span>`;
      parts.push(buyChip);
      const sellN = plan.sellWarnings.length;
      if (sellN > 0)
        parts.push(`<span class="hs-chip hs-sell">⚠️ 매도 경고 <b>${sellN}</b>종</span>`);
      if (strongBuyTop) {
        const s = strongBuyTop.signal;
        parts.push(`<span class="hs-chip hs-top">🥇 Top <b>${esc(s.name)}</b> <span class="hs-score">+${s.score}점</span></span>`);
      }
    }
    return `<div class="header-summary">${parts.join('')}</div>`;
  }

  /**
   * v1.4 — 🌡️ 코스피 공포·탐욕 지수 위젯 (머신러너 방법론).
   * 시장 전체 regime을 0~100 게이지로 시각화 + 의미 라벨.
   */
  private renderFearGreed(fg: import('../types/fear-greed.js').FearGreedIndex | null | undefined): string {
    if (!fg) return '';
    const zoneCls = `fg-zone-${fg.zone.replace('_', '-')}`;
    const insight =
      fg.zone === 'extreme_fear' ? '극도의 공포 — 역사적으로 매수 기회 영역. 다만 단기 추가 하락 가능성 존재.'
      : fg.zone === 'fear' ? '공포 — 매수 우호 영역. 분할 매수 고려.'
      : fg.zone === 'neutral' ? '중립 — 시장 방향성 모호. 개별 종목 시그널에 집중.'
      : fg.zone === 'greed' ? '탐욕 — 추격 매수 주의. 신규 진입은 보수적으로.'
      : '극도의 탐욕 — 차익 실현 검토 영역. 신규 진입 위험 ↑.';
    return `  <section class="fear-greed-widget">
    <div class="fg-header">
      <h2>🌡️ 코스피 공포·탐욕 지수 <span class="fg-source">(fearandgreed.kr)</span></h2>
      <span class="fg-time">${esc(fg.capturedAt)}</span>
    </div>
    <div class="fg-body">
      <div class="fg-gauge">
        <div class="fg-bar">
          <div class="fg-segment fg-seg-extreme-fear" style="width: 25%"></div>
          <div class="fg-segment fg-seg-fear" style="width: 20%"></div>
          <div class="fg-segment fg-seg-neutral" style="width: 10%"></div>
          <div class="fg-segment fg-seg-greed" style="width: 20%"></div>
          <div class="fg-segment fg-seg-extreme-greed" style="width: 25%"></div>
          <div class="fg-needle" style="left: ${fg.value}%" title="${fg.value}/100"></div>
        </div>
        <div class="fg-scale">
          <span>0</span><span>25</span><span>45</span><span>55</span><span>75</span><span>100</span>
        </div>
      </div>
      <div class="fg-value-block ${zoneCls}">
        <div class="fg-value">${fg.value}<span class="fg-max">/100</span></div>
        <div class="fg-label">${esc(fg.label)}</div>
      </div>
    </div>
    <p class="fg-insight ${zoneCls}">${esc(insight)} <span class="fg-note">— 시장 regime 보정으로 매매 시그널에 ±5점 반영.</span></p>
  </section>`;
  }

  /**
   * v1.3 — 💡 100만원 코스피 매매 시그널 + 포트폴리오 분배.
   * claude.md §10: 개별 매수가·손절가·익절가 단정 추천 금지 — 점수/근거만 노출.
   */
  private renderPortfolioPlan(plan: import('../types/trading-signal.js').PortfolioPlan | null | undefined): string {
    if (!plan) return '';
    const capStr = plan.totalCapital.toLocaleString('ko-KR');
    const slotsHtml = plan.slots.length === 0
      ? `<div class="plan-empty">현재 매수 후보가 없습니다 — 관망 추천. (모든 종목 점수 25 미만)</div>`
      : plan.slots.map((s, i) => this.renderPortfolioSlot(s, i + 1)).join('\n');
    const sellHtml = plan.sellWarnings.length === 0
      ? ''
      : `<div class="sell-warn-block">
          <h3>⚠️ 매도 경고 (보유 중이면 점검)</h3>
          <div class="sell-warn-list">
            ${plan.sellWarnings.slice(0, 5).map((s) => this.renderSellWarning(s)).join('')}
          </div>
        </div>`;
    const utilization = plan.slots.reduce((a, s) => a + s.estimatedCost, 0);
    const utilPct = (utilization / plan.totalCapital * 100).toFixed(1);
    return `  <section class="portfolio-plan">
    <h2>💡 ${capStr}원 코스피 매매 시그널 — AI 종합 점수 기반</h2>
    <p class="plan-disclaimer">⚠️ 본 시그널은 룰 기반 종합 점수이며 <b>매매 권유가 아닙니다</b>. 매수가·손절가·익절가를 명시하지 않으며, 모든 투자 판단과 결과 책임은 사용자에게 있습니다. 거래비용·세금·슬리피지 미반영.</p>
    <div class="plan-summary">
      <div class="plan-meta"><span>자본</span><b>${capStr}원</b></div>
      <div class="plan-meta"><span>거래비용 reserve</span><b>${plan.reservedForFees.toLocaleString('ko-KR')}원</b></div>
      <div class="plan-meta"><span>매수 후보 슬롯</span><b>${plan.slots.length}종목</b></div>
      <div class="plan-meta"><span>활용률</span><b>${utilPct}%</b></div>
      <div class="plan-meta"><span>잔여 현금</span><b>${plan.unspentCash.toLocaleString('ko-KR')}원</b></div>
    </div>
    <div class="plan-grid">
${slotsHtml}
    </div>
    ${sellHtml}
    <p class="plan-method">📐 점수 산출: 수급 ±60 + 가치 +15 + 품질 ±10 + 52주 위치 ±15 + 기술지표 ±10. 점수 +50↑ 강매수, +25↑ 매수, -25↓ 매도, -50↓ 강매도.</p>
  </section>`;
  }

  private renderPortfolioSlot(slot: import('../types/trading-signal.js').PortfolioSlot, rank: number): string {
    const s = slot.signal;
    const actionCls = s.action.toLowerCase().replace('_', '-');
    const actionLabel: Record<string, string> = {
      STRONG_BUY: '강력 매수 후보',
      BUY: '매수 후보',
      HOLD: '관망',
      SELL: '매도 경고',
      STRONG_SELL: '강력 매도 경고',
    };
    const priceStr = s.pricePerShare != null ? s.pricePerShare.toLocaleString('ko-KR') + '원' : '—';
    const costStr = slot.estimatedCost.toLocaleString('ko-KR');
    const posStr = s.references.fiftyTwoWeekPositionPct != null
      ? `52주 위치 ${s.references.fiftyTwoWeekPositionPct.toFixed(0)}%`
      : '';
    const rsiStr = s.references.rsi != null ? `RSI ${s.references.rsi.toFixed(0)}` : '';
    const lowHigh = s.references.fiftyTwoWeekLow != null && s.references.fiftyTwoWeekHigh != null
      ? `52주 ${Math.round(s.references.fiftyTwoWeekLow).toLocaleString('ko-KR')} ~ ${Math.round(s.references.fiftyTwoWeekHigh).toLocaleString('ko-KR')}원`
      : '';
    const factorList = s.factors
      .filter((f) => f.weight !== 0)
      .map((f) => `<li class="factor-${f.status}"><span class="fc-cat">${esc(f.category)}</span> ${esc(f.detail)} <span class="fc-w">${f.weight > 0 ? '+' : ''}${f.weight}</span></li>`)
      .join('');
    return `      <article class="plan-slot action-${actionCls}">
        <div class="plan-rank">#${rank}</div>
        <div class="plan-body">
          <h3>
            <a class="toss-link" href="https://tossinvest.com/stocks/A${esc(s.code)}" target="_blank" rel="noopener noreferrer" onclick="return openTossApp(event, this.href)">${esc(s.name)} <span class="ticker">${esc(s.code)}</span></a>
            <span class="action-chip action-${actionCls}">${actionLabel[s.action]}</span>
            <span class="signal-score">${s.score > 0 ? '+' : ''}${s.score}점</span>
          </h3>
          <div class="plan-trade">
            <div><span>현재가</span><b>${priceStr}</b></div>
            <div><span>매수 시뮬</span><b>${slot.shares}주</b></div>
            <div><span>예상 매수금</span><b>${costStr}원</b></div>
            <div><span>자본 비중</span><b>${slot.allocationPct.toFixed(1)}%</b></div>
          </div>
          <div class="plan-ref">참고: ${esc([posStr, rsiStr, lowHigh].filter(Boolean).join(' · '))}</div>
          <details class="plan-factors">
            <summary>판정 근거 (${s.factors.filter((f) => f.weight !== 0).length}개 팩터)</summary>
            <ul>${factorList}</ul>
          </details>
        </div>
      </article>`;
  }

  private renderSellWarning(s: import('../types/trading-signal.js').TradingSignal): string {
    const actionLabel = s.action === 'STRONG_SELL' ? '강력 매도 경고' : '매도 경고';
    const priceStr = s.pricePerShare != null ? s.pricePerShare.toLocaleString('ko-KR') + '원' : '—';
    const reasons = s.factors
      .filter((f) => f.status === 'negative')
      .map((f) => f.detail)
      .slice(0, 3)
      .join(' · ');
    return `<div class="sell-warn-item">
      <a class="toss-link" href="https://tossinvest.com/stocks/A${esc(s.code)}" target="_blank" rel="noopener noreferrer" onclick="return openTossApp(event, this.href)">${esc(s.name)} <span class="ticker">${esc(s.code)}</span></a>
      <span class="warn-chip">${actionLabel} ${s.score}점</span>
      <span class="warn-price">${priceStr}</span>
      <span class="warn-reason">${esc(reasons)}</span>
    </div>`;
  }

  private renderUniverseCard(t: UniverseTop, rank: number, currency: Currency): string {
    const c = t.card;
    const s = c.snapshot;
    const flow = c.flow;
    const price = formatPrice(s.price, currency);
    const changeCls =
      s.changePercent == null ? '' : s.changePercent >= 0 ? 'price-up' : 'price-down';
    const change =
      s.changePercent == null
        ? ''
        : `<span class="${changeCls}">${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%</span>`;
    // 트렌드 결정: 20일 → 5일 → 60일 → 10일 → 오늘 → 가중 평균 순으로 라벨 확정.
    // 모든 카드에 라벨이 표시되도록 fallback 다층화.
    const trend = decideTrend(flow);
    const cardCls = trend.type === 'buy' ? 'universe-card trend-buy'
      : trend.type === 'sell' ? 'universe-card trend-sell'
      : 'universe-card';
    const labelText = trend.type === 'buy'
      ? `추천 ${trend.stars}`
      : trend.type === 'sell'
        ? `위험 ${trend.stars}`
        : '';
    const trendLabel = trend.type
      ? `<span class="trend-label trend-label-${trend.type}">${labelText}</span>`
      : '';
    const flowRows = renderFlowTable(flow);
    return `      <article class="${cardCls}">
        <div class="u-rank">#${rank}</div>
        <div class="u-body">
          <h3><a class="toss-link" href="https://tossinvest.com/stocks/A${esc(s.code)}" target="_blank" rel="noopener noreferrer" onclick="return openTossApp(event, this.href)" title="모바일: 토스 앱 / PC: 웹">${esc(s.name)} <span class="ticker">${esc(s.code)}</span></a>${trendLabel}${renderQualityScore(c.qualityScore)}</h3>
          <div class="u-price"><span class="price-now">${price}</span> ${change}</div>${renderScoreBreakdown(c.qualityScore, c.financial)}
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
      /* v1.7 — KOSPI 지수 헤더 */
      .kospi-bar { display: inline-flex; align-items: baseline; gap: 12px; margin: 12px 0 4px; padding: 10px 16px; background: #1a1a1a; color: #fff; border-radius: 8px; font-variant-numeric: tabular-nums; }
      .kospi-bar .kospi-label { font-size: .9em; color: #ccc; }
      .kospi-bar .kospi-value { font-size: 1.3em; font-weight: 700; }
      .kospi-bar .kospi-change { font-size: 1.05em; font-weight: 600; }
      .kospi-bar.up .kospi-change { color: #ff5a5a; }
      .kospi-bar.down .kospi-change { color: #5ad17a; }
      .kospi-bar.flat .kospi-change { color: #aaa; }
      /* v1.7 — 시장 이벤트 캘린더 */
      .market-events { margin: 10px 0; padding: 10px 14px; background: #fffaf0; border-left: 4px solid #ff9800; border-radius: 4px; }
      .ev-title { font-weight: 600; color: #e65100; margin-bottom: 8px; font-size: .95em; }
      .ev-list { display: flex; flex-direction: column; gap: 6px; }
      .ev-chip { display: grid; grid-template-columns: 60px auto auto 1fr; gap: 8px; align-items: baseline; padding: 6px 10px; background: #fff; border-radius: 4px; font-size: .85em; line-height: 1.45; }
      .ev-chip.ev-sev-high { border-left: 3px solid #c62828; }
      .ev-chip.ev-sev-medium { border-left: 3px solid #f57c00; }
      .ev-chip.ev-sev-low { border-left: 3px solid #1976d2; }
      .ev-tag { font-weight: 700; color: #c62828; }
      .ev-label { font-weight: 600; }
      .ev-date { color: #888; font-size: .9em; }
      .ev-impact { color: #555; }
      @media (max-width: 640px) {
        .ev-chip { grid-template-columns: 1fr; gap: 2px; }
      }
      /* v1.7 — 거래량 Top 10 테이블 */
      .volume-top10 .src-note { font-size: .8em; color: #888; font-weight: normal; }
      .volume-top10 .intro { font-size: .88em; color: #555; margin: 0 0 12px; line-height: 1.5; }
      .vt-tbl { width: 100%; border-collapse: collapse; background: #fff; font-size: .9em; font-variant-numeric: tabular-nums; }
      .vt-tbl thead th { background: #f4f4f4; padding: 8px 10px; border: 1px solid #e6e6e6; text-align: center; font-weight: 600; font-size: .85em; }
      .vt-tbl tbody td { padding: 7px 10px; border: 1px solid #f0f0f0; text-align: center; }
      .vt-tbl td.rank { color: #c62828; font-weight: 700; }
      .vt-tbl td.name { text-align: left; font-weight: 600; }
      .vt-tbl td.name a { color: #1976d2; text-decoration: none; }
      .vt-tbl td.num { text-align: right; }
      .vt-tbl td.num.up { color: #c62828; font-weight: 600; }
      .vt-tbl td.num.down { color: #2e7d32; font-weight: 600; }
      .vt-tbl td.muted { color: #999; font-size: .9em; }
      /* v1.7 — 종가 매수 추천 카드 */
      .eod-picks .src-note { font-size: .8em; color: #888; font-weight: normal; }
      .eod-picks .intro { font-size: .88em; color: #555; margin: 0 0 14px; line-height: 1.55; }
      .eod-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
      .eod-card { background: #fff; border: 1px solid #e6e6e6; border-radius: 8px; padding: 14px 16px; font-size: .9em; }
      .eod-card.eod-strong { border: 2px solid #c62828; background: #fff5f5; }
      .eod-card.eod-buy { border: 2px solid #ef6c00; background: #fff8e1; }
      .eod-card.eod-hold { border-left: 4px solid #1976d2; }
      .eod-card.eod-skip { opacity: .65; }
      .eod-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
      .eod-ord { font-size: 1.15em; font-weight: 700; color: #c62828; }
      .eod-name { font-size: 1.05em; font-weight: 600; flex: 1 1 auto; }
      .eod-name a { color: #1976d2; text-decoration: none; }
      .eod-code { font-size: .82em; color: #888; font-weight: normal; margin-left: 4px; }
      .eod-rec { font-weight: 600; font-size: .92em; color: #c62828; }
      .eod-stats { display: flex; flex-wrap: wrap; gap: 10px 14px; padding: 6px 0; font-variant-numeric: tabular-nums; font-size: .9em; color: #444; }
      .eod-stats .up { color: #c62828; font-weight: 600; }
      .eod-stats .down { color: #2e7d32; font-weight: 600; }
      .eod-flow { color: #555; font-size: .88em; }
      .eod-factors { list-style: none; padding: 6px 0 0; margin: 6px 0 0; border-top: 1px solid #eee; font-size: .85em; line-height: 1.55; }
      .eod-factors li { padding: 2px 0; }
      .eod-factors .f-cat { display: inline-block; min-width: 50px; color: #1976d2; font-weight: 600; }
      .eod-factors b { color: #c62828; margin-left: 4px; }
      .eod-factors .f-det { color: #555; }
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
      .toss-link { color: inherit; text-decoration: none; border-bottom: 1px dashed transparent; }
      .toss-link:hover { border-bottom-color: #3182f6; color: #3182f6; }
      .toss-link::after { content: " ↗"; font-size: .75em; color: #3182f6; opacity: .7; }
      .live-dot { color: #c62828; font-size: .6em; vertical-align: middle; animation: live-pulse 2s ease-in-out infinite; }
      .live-mini { color: #c62828; font-size: .7em; animation: live-pulse 2s ease-in-out infinite; }
      @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .refresh-note { color: #888; font-size: .85em; }
      .u-price { margin: 2px 0 6px; font-size: .95em; }
      .price-now { font-weight: 600; font-variant-numeric: tabular-nums; }
      .price-up { color: #c62828; font-variant-numeric: tabular-nums; margin-left: 6px; }
      .price-down { color: #2e7d32; font-variant-numeric: tabular-nums; margin-left: 6px; }
      .flow-table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: .9em; }
      .flow-table thead th { font-weight: 500; color: #888; padding: 4px 6px; text-align: center; border-bottom: 1px solid #eee; font-size: .85em; }
      .flow-table tbody th { text-align: left; padding: 6px 6px; font-weight: 500; color: #555; min-width: 60px; }
      .flow-table tbody td { text-align: center; padding: 6px 6px; font-variant-numeric: tabular-nums; }
      .flow-buy { color: #c62828; font-weight: 600; font-variant-numeric: tabular-nums; }
      .flow-sell { color: #2e7d32; font-weight: 600; font-variant-numeric: tabular-nums; }
      .flow-na { color: #bbb; }
      .flow-live { background: #fff8e1; position: relative; }
      .flow-live::after { content: "⏱"; font-size: .7em; opacity: .5; position: absolute; top: 2px; right: 2px; }
      .flow-table tbody td { font-size: .85em; padding: 5px 4px; }
      @media (max-width: 600px) {
        .flow-table tbody td { font-size: .78em; padding: 4px 2px; }
        .flow-table thead th { font-size: .78em; }
      }
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
      .universe-card { background: #fff; border: 1px solid #ffe082; border-radius: 8px; padding: 10px 14px; display: flex; gap: 12px; transition: background .2s, border-color .2s; }
      .universe-card.trend-buy { background: #e8f5e9; border-color: #66bb6a; border-width: 2px; }
      .universe-card.trend-sell { background: #ffebee; border-color: #ef5350; border-width: 2px; }
      .trend-label { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: .75em; font-weight: 700; margin-left: 8px; vertical-align: middle; letter-spacing: .5px; }
      .trend-label-buy { background: #2e7d32; color: #fff; }
      .trend-label-sell { background: #c62828; color: #fff; }
      .quality-score { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: .8em; font-weight: 700; margin-left: 8px; vertical-align: middle; font-variant-numeric: tabular-nums; }
      .quality-score .qs-max { font-size: .75em; opacity: .7; font-weight: 500; }
      .quality-score .qs-grade { margin-left: 4px; font-size: .85em; }
      .quality-score.score-s { background: #1565c0; color: #fff; }
      .quality-score.score-a { background: #2e7d32; color: #fff; }
      .quality-score.score-b { background: #f9a825; color: #fff; }
      .quality-score.score-c { background: #ef6c00; color: #fff; }
      .quality-score.score-d { background: #c62828; color: #fff; }
      .score-detail { margin-top: 6px; font-size: .85em; }
      .score-detail summary { cursor: pointer; color: #666; font-size: .9em; }
      .qs-rows { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin-top: 6px; }
      .qs-rows > div { display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dashed #eee; }
      .qs-rows > div > span { color: #666; }
      .qs-rows > div > b { font-variant-numeric: tabular-nums; }
      .qs-rev { grid-column: 1 / -1; padding-top: 4px !important; border-bottom: none !important; }
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
      .header-summary { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
      .hs-chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; border-radius: 14px; font-size: .82em; font-weight: 600; border: 1px solid #e0e0e0; background: #f7f9fc; color: #444; }
      .hs-chip b { font-variant-numeric: tabular-nums; font-weight: 700; }
      .hs-chip.fg-zone-extreme-fear { background: #e3f2fd; color: #0d47a1; border-color: #90caf9; }
      .hs-chip.fg-zone-fear { background: #e8f5e9; color: #1b5e20; border-color: #a5d6a7; }
      .hs-chip.fg-zone-neutral { background: #f5f5f5; color: #555; }
      .hs-chip.fg-zone-greed { background: #fff3e0; color: #e65100; border-color: #ffcc80; }
      .hs-chip.fg-zone-extreme-greed { background: #ffebee; color: #b71c1c; border-color: #ef9a9a; }
      .hs-chip.hs-buy { background: #ffebee; color: #c62828; border-color: #ef9a9a; }
      .hs-chip.hs-sell { background: #e8f5e9; color: #2e7d32; border-color: #a5d6a7; }
      .hs-chip.hs-neutral { background: #eceff1; color: #455a64; }
      .hs-chip.hs-top { background: #fff8e1; color: #bf360c; border-color: #f9a825; }
      .hs-score { color: #c62828; font-weight: 700; font-size: .9em; margin-left: 2px; }
      section.fear-greed-widget { padding: 20px 24px; background: #fff; border-top: 1px solid #e6e6e6; border-bottom: 1px solid #e6e6e6; }
      .fg-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
      .fg-header h2 { margin: 0; font-size: 1.1em; color: #333; }
      .fg-source { font-size: .7em; color: #888; font-weight: normal; margin-left: 4px; }
      .fg-time { color: #888; font-size: .82em; }
      .fg-body { display: grid; grid-template-columns: 3fr 1fr; gap: 20px; align-items: center; }
      .fg-gauge { position: relative; }
      .fg-bar { position: relative; display: flex; height: 24px; border-radius: 12px; overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.1); }
      .fg-segment { height: 100%; }
      .fg-seg-extreme-fear { background: linear-gradient(90deg, #1565c0, #1976d2); }
      .fg-seg-fear { background: linear-gradient(90deg, #1976d2, #66bb6a); }
      .fg-seg-neutral { background: #e0e0e0; }
      .fg-seg-greed { background: linear-gradient(90deg, #f9a825, #ef6c00); }
      .fg-seg-extreme-greed { background: linear-gradient(90deg, #ef6c00, #c62828); }
      .fg-needle { position: absolute; top: -4px; width: 4px; height: 32px; background: #212121; border-radius: 2px; transform: translateX(-2px); box-shadow: 0 2px 4px rgba(0,0,0,0.4); transition: left .5s ease; }
      .fg-needle::before { content: ''; position: absolute; top: -6px; left: -4px; width: 12px; height: 12px; background: #212121; border-radius: 50%; }
      .fg-scale { display: flex; justify-content: space-between; margin-top: 4px; font-size: .72em; color: #888; font-variant-numeric: tabular-nums; }
      .fg-scale span:nth-child(1) { color: #1565c0; font-weight: 700; }
      .fg-scale span:nth-child(2) { color: #1976d2; }
      .fg-scale span:nth-child(5) { color: #ef6c00; }
      .fg-scale span:nth-child(6) { color: #c62828; font-weight: 700; }
      .fg-value-block { text-align: center; padding: 10px; border-radius: 8px; }
      .fg-value-block.fg-zone-extreme-fear { background: #e3f2fd; color: #0d47a1; }
      .fg-value-block.fg-zone-fear { background: #e8f5e9; color: #1b5e20; }
      .fg-value-block.fg-zone-neutral { background: #f5f5f5; color: #555; }
      .fg-value-block.fg-zone-greed { background: #fff3e0; color: #e65100; }
      .fg-value-block.fg-zone-extreme-greed { background: #ffebee; color: #b71c1c; }
      .fg-value { font-size: 2em; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
      .fg-max { font-size: .5em; opacity: .6; font-weight: 500; }
      .fg-label { font-size: .9em; font-weight: 700; margin-top: 4px; }
      .fg-insight { margin: 12px 0 0; padding: 10px 14px; border-radius: 6px; font-size: .9em; line-height: 1.5; border-left: 3px solid; }
      .fg-insight.fg-zone-extreme-fear { background: #e3f2fd; border-color: #1565c0; color: #0d47a1; }
      .fg-insight.fg-zone-fear { background: #e8f5e9; border-color: #2e7d32; color: #1b5e20; }
      .fg-insight.fg-zone-neutral { background: #f5f5f5; border-color: #757575; color: #555; }
      .fg-insight.fg-zone-greed { background: #fff3e0; border-color: #ef6c00; color: #e65100; }
      .fg-insight.fg-zone-extreme-greed { background: #ffebee; border-color: #c62828; color: #b71c1c; }
      .fg-note { color: #888; font-size: .85em; font-weight: normal; margin-left: 4px; }
      @media (max-width: 600px) {
        .fg-body { grid-template-columns: 1fr; gap: 14px; }
        .fg-value { font-size: 1.6em; }
      }
      section.portfolio-plan { padding: 24px; background: linear-gradient(180deg, #fff3e0 0%, #fffaf3 100%); border-top: 3px solid #ef6c00; border-bottom: 3px solid #ef6c00; }
      section.portfolio-plan h2 { margin: 0 0 8px; color: #bf360c; font-size: 1.25em; }
      .plan-disclaimer { background: #fff; border-left: 4px solid #d32f2f; padding: 10px 14px; margin: 0 0 14px; font-size: .88em; color: #555; line-height: 1.5; border-radius: 4px; }
      .plan-summary { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
      .plan-meta { background: #fff; padding: 8px 14px; border-radius: 8px; border: 1px solid #ffcc80; min-width: 110px; }
      .plan-meta span { display: block; font-size: .78em; color: #888; }
      .plan-meta b { font-size: 1em; font-variant-numeric: tabular-nums; color: #bf360c; }
      .plan-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 12px; }
      .plan-empty { grid-column: 1/-1; background: #fff; border-radius: 8px; padding: 24px; text-align: center; color: #888; font-size: .95em; }
      .plan-slot { background: #fff; border: 2px solid #ffcc80; border-radius: 10px; padding: 14px 16px; display: flex; gap: 12px; }
      .plan-slot.action-strong-buy { border-color: #c62828; background: linear-gradient(180deg, #ffebee 0%, #fff 30%); }
      .plan-slot.action-buy { border-color: #f57c00; }
      .plan-rank { font-size: 1.7em; font-weight: 700; color: #bf360c; min-width: 40px; text-align: center; }
      .plan-body { flex: 1; min-width: 0; }
      .plan-body h3 { margin: 0 0 8px; font-size: 1.05em; display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }
      .action-chip { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: .72em; font-weight: 700; vertical-align: middle; letter-spacing: .5px; }
      .action-chip.action-strong-buy { background: #c62828; color: #fff; }
      .action-chip.action-buy { background: #ef6c00; color: #fff; }
      .action-chip.action-hold { background: #757575; color: #fff; }
      .action-chip.action-sell { background: #558b2f; color: #fff; }
      .action-chip.action-strong-sell { background: #1b5e20; color: #fff; }
      .signal-score { font-size: .9em; color: #bf360c; font-weight: 700; font-variant-numeric: tabular-nums; margin-left: auto; }
      .plan-trade { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 6px; margin: 8px 0; padding: 8px; background: #fafafa; border-radius: 6px; }
      .plan-trade > div { text-align: center; }
      .plan-trade > div > span { display: block; font-size: .72em; color: #888; }
      .plan-trade > div > b { font-size: .92em; font-variant-numeric: tabular-nums; color: #333; }
      .plan-ref { font-size: .78em; color: #666; padding: 4px 8px; background: #f7f9fc; border-radius: 4px; margin: 4px 0; }
      .plan-factors { margin-top: 6px; }
      .plan-factors summary { cursor: pointer; color: #666; font-size: .85em; }
      .plan-factors ul { margin: 6px 0 0; padding-left: 0; list-style: none; font-size: .82em; }
      .plan-factors li { padding: 4px 8px; margin: 2px 0; border-radius: 4px; display: flex; align-items: baseline; gap: 6px; }
      .plan-factors li.factor-positive { background: #ffebee; }
      .plan-factors li.factor-negative { background: #e8f5e9; }
      .plan-factors li.factor-neutral { background: #f5f5f5; }
      .fc-cat { display: inline-block; min-width: 36px; font-weight: 700; font-size: .82em; color: #555; }
      .fc-w { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; color: #bf360c; }
      .factor-negative .fc-w { color: #2e7d32; }
      .sell-warn-block { margin-top: 14px; padding: 12px 14px; background: #e8f5e9; border-left: 4px solid #2e7d32; border-radius: 6px; }
      .sell-warn-block h3 { margin: 0 0 8px; font-size: .98em; color: #1b5e20; }
      .sell-warn-list { display: flex; flex-direction: column; gap: 6px; }
      .sell-warn-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: #fff; border-radius: 4px; flex-wrap: wrap; font-size: .88em; }
      .sell-warn-item .toss-link { overflow-wrap: break-word; word-break: keep-all; }
      .warn-chip { background: #2e7d32; color: #fff; padding: 2px 8px; border-radius: 10px; font-size: .72em; font-weight: 700; flex-shrink: 0; }
      .warn-price { font-variant-numeric: tabular-nums; color: #555; flex-shrink: 0; }
      .warn-reason { color: #666; font-size: .82em; flex: 1; min-width: 0; overflow-wrap: break-word; word-break: keep-all; line-height: 1.45; }
      .plan-method { font-size: .8em; color: #888; margin: 12px 0 0; padding: 8px 10px; background: rgba(255,255,255,0.6); border-radius: 4px; line-height: 1.5; }
      @media (max-width: 600px) {
        section.portfolio-plan { padding: 18px 14px; }
        .plan-grid { grid-template-columns: 1fr; gap: 8px; }
        .plan-slot { padding: 12px 12px; gap: 8px; }
        .plan-rank { font-size: 1.4em; min-width: 32px; }
        .plan-trade { grid-template-columns: 1fr 1fr; }
        .plan-summary { gap: 6px; }
        .plan-meta { flex: 1; min-width: 110px; padding: 6px 10px; }
        .plan-meta b { font-size: .92em; }
        .sell-warn-block { padding: 10px 12px; margin-top: 12px; }
        .sell-warn-list { gap: 8px; }
        .sell-warn-item {
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 8px 10px;
          font-size: .85em;
        }
        .sell-warn-item .toss-link { width: 100%; line-height: 1.4; }
        .warn-reason { width: 100%; font-size: .78em; }
      }
      section.universe.value-screener { background: #f0f7ff; border-top: 1px solid #cfd8dc; border-bottom: 1px solid #cfd8dc; }
      section.value-screener h2 { color: #0d47a1; }
      .value-screener .universe-card.value-card { border-color: #90caf9; }
      .value-screener .universe-card.value-card.gold { background: #fff8e1; border-color: #f9a825; border-width: 2px; }
      .value-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: .75em; font-weight: 700; margin-left: 8px; vertical-align: middle; letter-spacing: .5px; }
      .badge-premium { background: #1565c0; color: #fff; }
      .badge-candidate { background: #f9a825; color: #fff; }
      .sector-tag { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: .75em; background: #eceff1; color: #455a64; margin-left: 6px; vertical-align: middle; }
      .sector-tag.lead { background: #d32f2f; color: #fff; }
      .u-pos { color: #888; font-size: .82em; margin-left: 8px; font-variant-numeric: tabular-nums; }
      .value-gauge { display: flex; align-items: center; gap: 10px; margin: 8px 0 6px; }
      .value-bar { flex: 1; height: 10px; background: #eceff1; border-radius: 5px; overflow: hidden; }
      .value-bar-fill { height: 100%; background: linear-gradient(90deg, #66bb6a 0%, #1976d2 70%, #0d47a1 100%); transition: width .3s; }
      .value-total { font-weight: 700; font-size: 1.05em; color: #0d47a1; font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; }
      .value-max { font-size: .75em; color: #888; font-weight: 500; }
      .value-metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 6px 0; }
      .vm-cell { padding: 6px 8px; border-radius: 4px; background: #f7f9fc; text-align: center; }
      .vm-cell .vm-k { font-size: .78em; color: #888; margin-bottom: 2px; }
      .vm-cell .vm-v { font-size: 1em; font-weight: 700; font-variant-numeric: tabular-nums; }
      .vm-cell.vm-good { background: #e8f5e9; color: #1b5e20; }
      .vm-cell.vm-good .vm-v { color: #1b5e20; }
      .vm-cell.vm-ok { background: #fff8e1; color: #6d4c00; }
      .vm-cell.vm-ok .vm-v { color: #6d4c00; }
      .vm-cell.vm-bad { background: #ffebee; color: #b71c1c; }
      .vm-cell.vm-bad .vm-v { color: #b71c1c; }
      .vm-cell.vm-na .vm-v { color: #aaa; }
      .value-empty { padding: 20px 16px; text-align: center; color: #888; background: #fff; border-radius: 6px; font-size: .9em; }
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

function renderQualityScore(
  qs: import('../analyzers/QualityScore.js').QualityScore | null | undefined,
): string {
  if (!qs) return '';
  const gradeCls = qs.grade === 'S' ? 'score-s' : qs.grade === 'A' ? 'score-a'
    : qs.grade === 'B' ? 'score-b' : qs.grade === 'C' ? 'score-c' : 'score-d';
  return `<span class="quality-score ${gradeCls}" title="기업 품질 점수 — 수익성·밸류에이션·성장성·안정성·효율성·수급 종합">${qs.total}<span class="qs-max">/100</span> <span class="qs-grade">${qs.grade}</span></span>`;
}

function renderScoreBreakdown(
  qs: import('../analyzers/QualityScore.js').QualityScore | null | undefined,
  fin: import('../types/financial.js').FinancialSummary | null | undefined,
): string {
  if (!qs) return '';
  const b = qs.breakdown;
  const latest = fin?.latestActual;
  const revStr = latest?.revenue != null ? `${latest.revenue.toLocaleString('ko-KR')}억` : '—';
  const debtStr = latest?.netDebtRatio != null ? `${latest.netDebtRatio.toFixed(1)}%` : '—';
  const yoyStr = latest?.revenueYoy != null ? `${latest.revenueYoy >= 0 ? '+' : ''}${latest.revenueYoy.toFixed(1)}%` : '—';
  const yearStr = latest?.year ?? '—';
  return `
          <details class="score-detail">
            <summary>점수 상세 (${yearStr})</summary>
            <div class="qs-rows">
              <div><span>수익성 (ROE)</span><b>${b.profitability}/25</b></div>
              <div><span>밸류 (PER·PBR)</span><b>${b.valuation}/20</b></div>
              <div><span>성장 (매출 YoY ${yoyStr})</span><b>${b.growth}/15</b></div>
              <div><span>안정 (순부채 ${debtStr})</span><b>${b.stability}/15</b></div>
              <div><span>효율 (영업이익률)</span><b>${b.efficiency}/10</b></div>
              <div><span>수급 (외인·기관)</span><b>${b.momentum}/15</b></div>
              <div class="qs-rev"><span>매출액</span><b>${revStr}</b></div>
            </div>
          </details>`;
}

type TrendDecision = { type: 'buy' | 'sell' | null; stars: string };
/**
 * 카드 상단 추천/위험 라벨 결정.
 * 우선순위: **오늘 (외인+기관 동반 일치)** → 5일 → 20일 → 60일 → 10일.
 * 사용자 피드백(2026-05): 카드 라벨이 누적 기반이면 "오늘 매도인데 추천" 같은 혼란 발생 →
 * 오늘 동반 일치를 최우선으로. 장중(inMarketTime) 라벨에는 ⏱ 마커.
 */
function decideTrend(flow: import('../types/flow.js').FlowSummary | null | undefined): TrendDecision {
  if (!flow) return { type: null, stars: '' };

  // 1순위: 오늘 — 외인+기관 동반 일치 시 즉시 확정
  const tf = flow.todayForeignerNet;
  const ti = flow.todayInstitutionalNet;
  const todayMarker = flow.todayInMarketTime ? '⏱ 오늘' : '★ 오늘';
  if (tf != null && ti != null) {
    if (tf > 0 && ti > 0) return { type: 'buy', stars: todayMarker };
    if (tf < 0 && ti < 0) return { type: 'sell', stars: todayMarker };
  }

  // 2~5순위: 단기→중기→장기 누적 (기간 라벨 명시)
  const tiers: Array<{ f: number | null; i: number | null; stars: string }> = [
    { f: flow.net5dForeigner, i: flow.net5dInstitutional, stars: '★ 5일' },
    { f: flow.net20dForeigner, i: flow.net20dInstitutional, stars: '★★ 20일' },
    { f: flow.net60dForeigner, i: flow.net60dInstitutional, stars: '★ 60일' },
    { f: flow.net10dForeigner, i: flow.net10dInstitutional, stars: '★ 10일' },
  ];
  for (const t of tiers) {
    if (t.f != null && t.i != null) {
      if (t.f > 0 && t.i > 0) return { type: 'buy', stars: t.stars };
      if (t.f < 0 && t.i < 0) return { type: 'sell', stars: t.stars };
    }
  }

  // Fallback: 가중 평균 (오늘 ×3, 5일 ×2, 20일 ×2, 60일 ×1, 10일 ×1)
  // 오늘 우선 정책에 맞춰 가중치 재조정
  const weighted = [
    { f: tf, i: ti, w: 3 },
    { f: flow.net5dForeigner, i: flow.net5dInstitutional, w: 2 },
    { f: flow.net20dForeigner, i: flow.net20dInstitutional, w: 2 },
    { f: flow.net60dForeigner, i: flow.net60dInstitutional, w: 1 },
    { f: flow.net10dForeigner, i: flow.net10dInstitutional, w: 1 },
  ];
  let score = 0;
  for (const x of weighted) {
    if (x.f != null) score += x.w * Math.sign(x.f);
    if (x.i != null) score += x.w * Math.sign(x.i);
  }
  if (score > 0) return { type: 'buy', stars: '◇ 가중' };
  if (score < 0) return { type: 'sell', stars: '◇ 가중' };
  // 동률 — 가장 최근(오늘) 신호로 tiebreak
  const tiebreakers: Array<number | null | undefined> = [
    tf, ti,
    flow.net5dForeigner, flow.net5dInstitutional,
    flow.net20dForeigner, flow.net20dInstitutional,
  ];
  for (const v of tiebreakers) {
    if (v != null && v !== 0) {
      return { type: v > 0 ? 'buy' : 'sell', stars: '◇' };
    }
  }
  return { type: null, stars: '' };
}

function fmtMetric(v: number | null, digits: number): string {
  return v == null ? '—' : v.toFixed(digits);
}

/**
 * 외인·기관 수급 표 렌더 — 토스 API 원본을 정확한 단위(거래대금 원)로 분리 표시.
 *
 * 컬럼 정의:
 * - **오늘**: 당일(body[0]) 외인/기관 순매수 거래대금. 장중은 ⏱(미확정, 마감 시 확정).
 * - **5일 누적**: 직전 5거래일 순매수 거래대금 합계.
 * - **20일 누적**: 직전 20거래일 합계 (펀드매니저 표준 중기 추세).
 * - **60일 누적**: 직전 60거래일 합계 (장기 사이클).
 *
 * 데이터 부족 시 (예: 60일 fetch 안 됨) sumNet이 null 반환 → "—" 표시.
 * 누적값은 단순 합산이라 부분 매수+부분 매도가 상쇄될 수 있음 — 컬럼별로 부호가 다를 수 있다.
 */
function renderFlowTable(flow: import('../types/flow.js').FlowSummary | null | undefined): string {
  if (!flow) return `<p class="flow-empty">수급 데이터 없음 (Toss API)</p>`;
  const live = flow.todayInMarketTime;
  const liveTag = live
    ? ' <span class="live-mini" title="장중 실시간 — 마감 시 확정">⏱</span>'
    : '';
  return `<table class="flow-table">
          <thead><tr>
            <th></th>
            <th title="당일 단일 일자 데이터${live ? ' (장중)' : ''}">오늘${liveTag}</th>
            <th title="직전 5거래일 순매수 거래대금 합계">5일 누적</th>
            <th title="직전 20거래일 누적 (중기 추세)">20일 누적</th>
            <th title="직전 60거래일 누적 (장기 사이클)">60일 누적</th>
          </tr></thead>
          <tbody>
            <tr><th>외국인</th>${fmtFlowCell(flow.todayForeignerNetValue, live)}${fmtFlowCell(flow.net5dForeignerValue)}${fmtFlowCell(flow.net20dForeignerValue)}${fmtFlowCell(flow.net60dForeignerValue)}</tr>
            <tr><th>기관</th>${fmtFlowCell(flow.todayInstitutionalNetValue, live)}${fmtFlowCell(flow.net5dInstitutionalValue)}${fmtFlowCell(flow.net20dInstitutionalValue)}${fmtFlowCell(flow.net60dInstitutionalValue)}</tr>
          </tbody>
        </table>`;
}

/**
 * 거래대금 셀 포맷터 — Toss 원본 데이터 단위(원)에서 직접 환산.
 * 양수: 빨강 ↑ 매수 / 음수: 초록 ↓ 매도 / null: dash.
 * 장중 데이터에는 ⏱ + flow-live 클래스 부여.
 */
function fmtFlowCell(value: number | null | undefined, isLive = false): string {
  if (value == null) return `<td class="flow-na">—</td>`;
  if (value === 0) return `<td class="flow-na">0</td>`;
  const cls = value > 0 ? 'flow-buy' : 'flow-sell';
  const arrow = value > 0 ? '↑' : '↓';
  const liveCls = isLive ? ' flow-live' : '';
  return `<td class="${cls}${liveCls}">${arrow} ${fmtKrwSigned(value)}</td>`;
}

function fmtKrwSigned(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e10) return `${sign}${Math.round(abs / 1e8).toLocaleString('ko-KR')}억`;
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(0)}억`;
  if (abs >= 1e7) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  return `${sign}${Math.round(abs / 1e4).toLocaleString('ko-KR')}만`;
}

function pbrClass(v: number | null): string {
  if (v == null) return 'vm-na';
  if (v <= 0.7) return 'vm-good';
  if (v <= 1.0) return 'vm-ok';
  return 'vm-bad';
}

function perClass(v: number | null): string {
  if (v == null || v <= 0) return 'vm-na';
  if (v <= 8) return 'vm-good';
  if (v <= 15) return 'vm-ok';
  return 'vm-bad';
}

function roeClass(v: number | null): string {
  if (v == null) return 'vm-na';
  if (v >= 15) return 'vm-good';
  if (v >= 8) return 'vm-ok';
  return 'vm-bad';
}

function sectorEmoji(s: import('../types/valuation.js').SectorTag): string {
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

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatKrwShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return v.toLocaleString('ko-KR');
}

function formatFlow(n: number | null): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const arrow = n > 0 ? '↑' : n < 0 ? '↓' : '·';
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  let body: string;
  if (abs >= 1e8) body = `${(abs / 1e8).toFixed(1)}억`;
  else if (abs >= 1e4) body = `${(abs / 1e4).toFixed(0)}만`;
  else body = abs.toLocaleString('ko-KR');
  return `<span class="${cls}">${arrow}${body}</span>`;
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
    // 당일 외인·기관 순매수 (Toss 실시간)
    if (flow.todayForeignerNet != null && flow.todayForeignerNet > 0) {
      bullish.push('외국인 당일 순매수');
    } else if (flow.todayForeignerNet != null && flow.todayForeignerNet < 0) {
      bearish.push('외국인 당일 순매도');
    }
    if (flow.todayInstitutionalNet != null && flow.todayInstitutionalNet > 0) {
      bullish.push('기관 당일 순매수');
    } else if (flow.todayInstitutionalNet != null && flow.todayInstitutionalNet < 0) {
      bearish.push('기관 당일 순매도');
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

