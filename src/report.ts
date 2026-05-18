import type { DashboardData, StockReport, TurtleAction, ProtocolStatus } from './types.js';
import { DASHBOARD_PUBLIC_URL } from './config.js';

const ACTION_LABEL: Record<TurtleAction, string> = {
  ENTRY_BREAKOUT: '신규 매수',
  PYRAMID: '피라미딩',
  HOLD: '보유 유지',
  EXIT_10D_LOW: '익절 청산',
  STOP_LOSS: '손절',
  WAIT: '돌파 대기',
};

const ACTION_COLOR: Record<TurtleAction, string> = {
  ENTRY_BREAKOUT: '#16a34a',
  PYRAMID: '#22c55e',
  HOLD: '#0ea5e9',
  EXIT_10D_LOW: '#f59e0b',
  STOP_LOSS: '#dc2626',
  WAIT: '#64748b',
};

const PROTOCOL_LABEL: Record<ProtocolStatus, string> = {
  KEEP: '유지',
  WATCH: '관찰',
  DELETE_CANDIDATE: '삭제 검토',
};

const PROTOCOL_COLOR: Record<ProtocolStatus, string> = {
  KEEP: '#16a34a',
  WATCH: '#f59e0b',
  DELETE_CANDIDATE: '#dc2626',
};

function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function fmtWon(n: number): string {
  return fmtNumber(n) + '원';
}

function fmtPct(n: number, digits = 2): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function fmtPnl(n: number): string {
  const sign = n > 0 ? '+' : '';
  return sign + fmtWon(n);
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}

function renderSparkline(closes: number[]): string {
  if (closes.length < 2) return '';
  const w = 200;
  const h = 40;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const step = w / (closes.length - 1);
  const points = closes.map((c, i) => {
    const x = i * step;
    const y = h - ((c - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = closes[closes.length - 1];
  const first = closes[0];
  const color = last >= first ? '#16a34a' : '#dc2626';
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

interface MismatchHint {
  tone: 'warn' | 'caution' | 'ok' | 'info';
  text: string;
}

function buildMismatchHint(signal: StockReport['signal'], holding: StockReport['holding']): MismatchHint | null {
  if (!holding) return null;
  const pnlPct = holding.pnlPct;
  const action = signal.action;

  if (action === 'EXIT_10D_LOW') {
    if (pnlPct < 0) {
      return { tone: 'warn', text: `시스템 익절 신호 / 내 포지션 ${pnlPct.toFixed(2)}% 손실 — 매도 시 손실 확정` };
    }
    if (pnlPct < 3) {
      return { tone: 'caution', text: `시스템 익절 신호 / 평가익 ${pnlPct.toFixed(2)}% 미미` };
    }
    return { tone: 'ok', text: `시스템 익절 신호 — 평가익 +${pnlPct.toFixed(2)}% 확정 가능` };
  }
  if (action === 'STOP_LOSS') {
    return { tone: 'warn', text: `시스템 손절 신호 (-2 ATR) / 손익 ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% — 기계적 청산 권장` };
  }
  if (action === 'PYRAMID') {
    return { tone: 'ok', text: `피라미딩 신호 / 평가익 +${pnlPct.toFixed(2)}% — 추가 매수 검토` };
  }
  if (action === 'HOLD') {
    const stopPct = ((holding.position.buyPrice * 1 - holding.stopPrice) / holding.position.buyPrice) * 100;
    if (pnlPct >= 0) {
      return { tone: 'info', text: `평가익 +${pnlPct.toFixed(2)}% · 손절선까지 여유 ${stopPct.toFixed(1)}%` };
    }
    return { tone: 'caution', text: `평가손 ${pnlPct.toFixed(2)}% · 손절선까지 ${stopPct.toFixed(1)}% 여유` };
  }
  return null;
}

const HINT_COLOR: Record<MismatchHint['tone'], string> = {
  warn: '#dc2626',
  caution: '#f59e0b',
  ok: '#16a34a',
  info: '#0ea5e9',
};

function renderScanSection(candidates: import('./types.js').ScanCandidateResult[]): string {
  if (!candidates || candidates.length === 0) return '';
  const tierA = candidates.filter((c) => c.tier === 'A').sort((a, b) => b.distancePct - a.distancePct);
  const tierB = candidates.filter((c) => c.tier === 'B').sort((a, b) => a.distancePct - b.distancePct);
  const errored = candidates.filter((c) => c.error);

  function renderTierA(): string {
    if (tierA.length === 0) return '<div class="scan-empty">즉시 진입 신호 없음 — 시장 정중 중</div>';
    return tierA.map((c) => {
      const distAbs = Math.abs(c.distancePct).toFixed(2);
      const distLabel = c.distancePct < 0 ? `+${distAbs}% 돌파` : `${distAbs}% 부족`;
      const sizeWarning = c.unitSize === 0
        ? '<span class="scan-warn">⚠ 자본 부족 (1유닛 0주, 실제 매수 불가)</span>'
        : `<span class="scan-ok">1유닛 ${c.unitSize}주</span>`;
      return `
        <div class="scan-card scan-tier-a">
          <div class="scan-head">
            <span class="scan-name">${escape(c.name)} <span class="scan-code">${escape(c.code)}</span></span>
            <span class="scan-price">${fmtWon(c.lastClose)}</span>
          </div>
          <div class="scan-body">
            <div>20일 고점 ${fmtWon(c.donchianHigh20)} (${distLabel})</div>
            <div>ATR ${fmtWon(c.atr20)} · MA60 ${fmtWon(c.ma60)} · MA120 ${fmtWon(c.ma120)}</div>
            <div class="scan-size">${sizeWarning}</div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTierB(): string {
    if (tierB.length === 0) return '<div class="scan-empty">돌파 임박 종목 없음</div>';
    return tierB.map((c) => `
      <div class="scan-card scan-tier-b">
        <div class="scan-head">
          <span class="scan-name">${escape(c.name)} <span class="scan-code">${escape(c.code)}</span></span>
          <span class="scan-price">${fmtWon(c.lastClose)}</span>
        </div>
        <div class="scan-body">
          돌파선 ${fmtWon(c.donchianHigh20)} 까지 ${c.distancePct.toFixed(2)}%
        </div>
      </div>`).join('');
  }

  return `
  <section class="scan-section">
    <h2 class="scan-title">🔍 매수 후보 (KOSPI 대형주 ${candidates.length}종목 스캔)</h2>
    <div class="scan-meta">claude.md "매수 후보 스캔 프로토콜" — 20일 신고가 돌파 + 정배열 (MA60>MA120) + 종가 > MA60·MA120</div>

    <div class="scan-tier-title">A 등급 — 즉시 진입 신호 (4개 조건 전부 충족)</div>
    <div class="scan-list">${renderTierA()}</div>

    <div class="scan-tier-title">B 등급 — 돌파 임박 (추세 충족 + 3% 이내)</div>
    <div class="scan-list">${renderTierB()}</div>

    ${errored.length > 0 ? `<div class="scan-meta">수집 실패: ${errored.length}종목</div>` : ''}
  </section>`;
}

function renderQuickOverview(reports: StockReport[]): string {
  if (reports.length === 0) return '';
  const items = reports.map((r) => {
    const { config, signal, holding } = r;
    const color = ACTION_COLOR[signal.action];
    const pnlBlock = holding
      ? `<div class="qo-pnl" data-live="qoPnl" style="color:${holding.pnl >= 0 ? '#22c55e' : '#f87171'}">
          <div class="qo-pnl-amt" data-live="qoPnlAmt">${fmtPnl(holding.pnl)}</div>
          <div class="qo-pnl-pct" data-live="qoPnlPct">${fmtPct(holding.pnlPct)}</div>
        </div>`
      : '<div class="qo-pnl muted">미보유</div>';
    return `
      <a class="qo-item" data-stock-code="${escape(config.code)}" href="#stock-${escape(config.code)}" style="border-left:3px solid ${color}">
        <div class="qo-name">${escape(config.name)}</div>
        <div class="qo-action" style="background:${color}">${ACTION_LABEL[signal.action]}</div>
        ${pnlBlock}
      </a>`;
  }).join('');
  return `
  <section class="quick-overview">
    <div class="qo-title">한눈에 보기 (클릭 시 상세 카드로 이동) · <span id="live-status">초기화 중…</span> · <span id="live-updated"></span></div>
    <div class="qo-grid">${items}</div>
  </section>`;
}

function renderStockCard(r: StockReport, riskPerTrade: number): string {
  const { config, indicators, signal, protocol, holding } = r;
  const closes = r.history.map((c) => c.close);
  const changeColor = indicators.change >= 0 ? '#16a34a' : '#dc2626';

  const myPosition = holding ? `
    <div class="my-pos">
      <div class="my-pos-title">내 포지션</div>
      <div class="my-pos-row">
        <div class="cell"><div class="cell-k">매수가</div><div class="cell-v">${fmtWon(holding.position.buyPrice)}</div></div>
        <div class="cell"><div class="cell-k">수량</div><div class="cell-v">${holding.position.quantity}주</div></div>
        <div class="cell"><div class="cell-k">평가액</div><div class="cell-v" data-live="currentValue">${fmtWon(holding.currentValue)}</div></div>
        <div class="cell pnl"><div class="cell-k">내 손익</div><div class="cell-v big" data-live="pnl" style="color:${holding.pnl >= 0 ? '#22c55e' : '#f87171'}">${fmtPnl(holding.pnl)}<br><span class="pct">${fmtPct(holding.pnlPct)}</span></div></div>
      </div>
      <div class="my-pos-row sub">
        <div class="cell"><div class="cell-k">손절선</div><div class="cell-v">${fmtWon(holding.stopPrice)} ${holding.stoppedOut ? '<span class="alert">⚠ 이탈</span>' : ''}</div></div>
        <div class="cell"><div class="cell-k">다음 피라미딩</div><div class="cell-v">${fmtWon(holding.nextPyramidPrice)} ${holding.pyramidReady ? '<span class="alert ok">✓ 도달</span>' : ''}</div></div>
      </div>
      ${(() => {
        const hint = buildMismatchHint(signal, holding);
        return hint ? `<div class="hint" data-live="hint" data-action="${signal.action}" style="border-left:3px solid ${HINT_COLOR[hint.tone]};color:${HINT_COLOR[hint.tone]}">${escape(hint.text)}</div>` : '<div class="hint" data-live="hint" data-action="' + signal.action + '" style="display:none"></div>';
      })()}
    </div>` : '<div class="my-pos muted">미보유 — 시스템 신호 참고용</div>';

  const protocolItems = [
    ...protocol.passed.map((p) => `<li class="pass">✓ ${escape(p)}</li>`),
    ...protocol.failed.map((p) => `<li class="fail">✗ ${escape(p)}</li>`),
  ].join('');

  return `
  <article class="card" id="stock-${escape(config.code)}">
    <header class="card-head">
      <div>
        <h2>${escape(config.name)} <span class="code">${escape(config.code)}</span></h2>
        <div class="note">${escape(config.positionNote)}</div>
      </div>
      <div class="price">
        <div class="last" data-live="price">${fmtWon(indicators.lastClose)}</div>
        <div class="change" data-live="change" style="color:${changeColor}">${fmtPnl(indicators.change)} (${fmtPct(indicators.changePct)})</div>
      </div>
    </header>

    <div class="signal" style="background:${ACTION_COLOR[signal.action]}1a;border-left:4px solid ${ACTION_COLOR[signal.action]}">
      <div class="signal-head">
        <span class="action-badge" style="background:${ACTION_COLOR[signal.action]}">${ACTION_LABEL[signal.action]}</span>
        <span class="protocol-badge" style="background:${PROTOCOL_COLOR[protocol.status]}">${PROTOCOL_LABEL[protocol.status]}</span>
      </div>
      <div class="signal-reason">${escape(signal.reason)}</div>
    </div>

    ${myPosition}

    <div class="spark">${renderSparkline(closes)}</div>

    <div class="section">
      <div class="section-title">지표 (${escape(indicators.lastDate)})</div>
      <div class="kv">
        <div><span class="k">20일 ATR</span><span class="v">${fmtWon(indicators.atr20)}</span></div>
        <div><span class="k">20일 고점</span><span class="v">${fmtWon(indicators.donchianHigh20)}</span></div>
        <div><span class="k">10일 저점</span><span class="v">${fmtWon(indicators.donchianLow10)}</span></div>
        <div><span class="k">MA60</span><span class="v">${fmtWon(indicators.ma60)}</span></div>
        <div><span class="k">MA120</span><span class="v">${fmtWon(indicators.ma120)}</span></div>
        <div><span class="k">거래량(20일평균)</span><span class="v">${fmtNumber(indicators.avgVolume20)}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">1유닛 (리스크 ${fmtWon(riskPerTrade)} 기준)</div>
      <div class="kv">
        <div><span class="k">수량</span><span class="v">${signal.unitSize}주</span></div>
        <div><span class="k">금액</span><span class="v">${fmtWon(signal.unitCost)}</span></div>
        <div><span class="k">20일 고점까지</span><span class="v">${fmtPct(signal.distanceToEntryPct)}</span></div>
        <div><span class="k">10일 저점까지</span><span class="v">${fmtPct(signal.distanceToExitPct)}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">프로토콜 검증</div>
      <ul class="protocol">${protocolItems}</ul>
      ${protocol.notes.length ? `<div class="notes">${protocol.notes.map((n) => `<div>· ${escape(n)}</div>`).join('')}</div>` : ''}
    </div>
  </article>`;
}

export function renderHtml(data: DashboardData): string {
  const ts = new Date(data.generatedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const cards = data.reports.map((r) => renderStockCard(r, data.riskPerTrade)).join('\n');

  const errorBlock = data.errors.length ? `
    <section class="errors">
      <h3>수집 실패</h3>
      <ul>${data.errors.map((e) => `<li>${escape(e.name)} (${escape(e.code)}): ${escape(e.message)}</li>`).join('')}</ul>
    </section>` : '';

  const summary = summarize(data);

  const asOfLine = data.asOfDate
    ? `기준 종가: ${escape(data.asOfDate)} · ${data.isLive ? '장 마감 후 확정' : '장중/시초가 직전 실행 — 어제 확정 종가 기준'}`
    : '기준 종가: 알 수 없음';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🐢 터틀 KOSPI 대시보드</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', Roboto, sans-serif;
    margin: 0; padding: 0;
    background: #0f172a;
    color: #e2e8f0;
    line-height: 1.5;
  }
  .container { max-width: 1400px; margin: 0 auto; padding: 24px; }
  header.main {
    display: flex; justify-content: space-between; align-items: flex-end;
    margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
  }
  header.main h1 { margin: 0; font-size: 24px; }
  header.main .sub { color: #94a3b8; font-size: 13px; }
  .summary {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px; margin-bottom: 24px;
    padding: 16px; background: #1e293b; border-radius: 8px;
  }
  .summary .item { text-align: center; }
  .summary .item .label { color: #94a3b8; font-size: 12px; }
  .summary .item .value { font-size: 20px; font-weight: 600; margin-top: 4px; }
  .quick-overview {
    background: #1e293b; border-radius: 8px; padding: 16px;
    margin-bottom: 24px;
  }
  .qo-title {
    font-size: 12px; color: #94a3b8; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 10px;
  }
  .qo-grid {
    display: grid; gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .qo-item {
    display: block; padding: 10px 12px;
    background: #0f172a; border-radius: 6px;
    text-decoration: none; color: inherit;
    transition: transform 0.1s ease, background 0.1s ease;
  }
  .qo-item:hover { background: #243149; transform: translateY(-1px); }
  .qo-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
  .qo-action {
    display: inline-block; margin-top: 6px;
    color: white; font-size: 11px; font-weight: 600;
    padding: 2px 8px; border-radius: 3px;
  }
  .qo-pnl { margin-top: 6px; font-weight: 600; line-height: 1.2; }
  .qo-pnl-amt { font-size: 14px; }
  .qo-pnl-pct { font-size: 11px; opacity: 0.85; margin-top: 1px; }
  .qo-pnl.muted { color: #64748b; font-weight: 400; font-style: italic; font-size: 13px; }
  .scan-section {
    background: #1e293b; border-radius: 8px; padding: 16px;
    margin-bottom: 24px;
  }
  .scan-title {
    margin: 0 0 6px; font-size: 16px;
  }
  .scan-meta {
    color: #94a3b8; font-size: 12px; margin-bottom: 14px;
  }
  .scan-tier-title {
    font-size: 12px; color: #94a3b8; text-transform: uppercase;
    letter-spacing: 0.5px; margin: 12px 0 8px;
    padding-bottom: 4px; border-bottom: 1px solid #334155;
  }
  .scan-list {
    display: grid; gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  }
  .scan-card {
    padding: 10px 12px; border-radius: 6px;
    background: #0f172a; border-left: 3px solid #64748b;
  }
  .scan-card.scan-tier-a { border-left-color: #16a34a; background: rgba(22,163,74,0.08); }
  .scan-card.scan-tier-b { border-left-color: #f59e0b; background: rgba(245,158,11,0.06); }
  .scan-head {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 4px;
  }
  .scan-name { font-weight: 600; font-size: 14px; }
  .scan-code { color: #64748b; font-size: 11px; font-weight: 400; margin-left: 4px; }
  .scan-price { font-size: 13px; font-weight: 600; }
  .scan-body { font-size: 12px; color: #cbd5e1; line-height: 1.5; }
  .scan-size { margin-top: 4px; }
  .scan-ok { color: #22c55e; font-weight: 500; }
  .scan-warn { color: #f59e0b; font-weight: 500; }
  .scan-empty { color: #64748b; font-style: italic; font-size: 13px; }
  .grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  }
  .card {
    background: #1e293b; border-radius: 10px; padding: 16px;
    border: 1px solid #334155;
  }
  .card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
  .card-head h2 { margin: 0; font-size: 18px; }
  .card-head .code { color: #64748b; font-size: 12px; font-weight: 400; margin-left: 6px; }
  .card-head .note { color: #94a3b8; font-size: 12px; margin-top: 2px; }
  .card-head .price { text-align: right; }
  .card-head .last { font-size: 20px; font-weight: 600; }
  .card-head .change { font-size: 13px; margin-top: 2px; }
  .signal { padding: 12px; border-radius: 6px; margin: 12px 0; }
  .signal-head { display: flex; gap: 8px; margin-bottom: 6px; }
  .action-badge, .protocol-badge {
    color: white; font-size: 11px; font-weight: 600;
    padding: 3px 8px; border-radius: 4px;
  }
  .signal-reason { font-size: 13px; color: #cbd5e1; }
  .my-pos {
    margin: 12px 0;
    padding: 12px;
    background: #0f172a;
    border-radius: 6px;
    border: 1px solid #334155;
  }
  .my-pos.muted {
    color: #64748b; font-size: 12px; text-align: center;
    padding: 8px; font-style: italic;
  }
  .my-pos-title {
    font-size: 11px; color: #94a3b8; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 8px;
  }
  .my-pos-row {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    margin-bottom: 6px;
  }
  .my-pos-row.sub { grid-template-columns: repeat(2, 1fr); }
  .my-pos .cell { font-size: 12px; }
  .my-pos .cell-k { color: #94a3b8; font-size: 11px; }
  .my-pos .cell-v { color: #e2e8f0; margin-top: 2px; font-weight: 500; }
  .my-pos .cell-v.big { font-size: 16px; font-weight: 700; line-height: 1.15; }
  .my-pos .cell-v .pct { font-size: 12px; font-weight: 500; opacity: 0.85; }
  .my-pos .hint {
    margin-top: 8px; padding: 6px 10px;
    background: rgba(255,255,255,0.04);
    border-radius: 4px; font-size: 12px; font-weight: 500;
  }
  .spark { margin: 8px 0 12px; opacity: 0.7; }
  .section { margin-top: 12px; }
  .section-title {
    font-size: 11px; color: #94a3b8; text-transform: uppercase;
    letter-spacing: 0.5px; margin-bottom: 6px;
  }
  .kv { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 13px; }
  .kv > div { display: flex; justify-content: space-between; }
  .kv .k { color: #94a3b8; }
  .kv .v { color: #e2e8f0; }
  .alert { color: #dc2626; font-weight: 600; margin-left: 4px; }
  .alert.ok { color: #16a34a; }
  ul.protocol { list-style: none; padding: 0; margin: 0; font-size: 12px; }
  ul.protocol li { padding: 2px 0; }
  ul.protocol .pass { color: #4ade80; }
  ul.protocol .fail { color: #f87171; }
  .notes { font-size: 12px; color: #fbbf24; margin-top: 6px; }
  .errors {
    background: #7f1d1d; color: #fee2e2;
    padding: 12px; border-radius: 6px; margin: 16px 0;
  }
  .errors h3 { margin: 0 0 6px; font-size: 14px; }
  .errors ul { margin: 0; padding-left: 18px; font-size: 13px; }
  footer {
    margin-top: 32px; padding-top: 16px; border-top: 1px solid #334155;
    color: #64748b; font-size: 12px; text-align: center;
  }
  footer a { color: #94a3b8; }
</style>
</head>
<body>
<div class="container">
  <header class="main">
    <div>
      <h1>🐢 터틀 KOSPI 대시보드</h1>
      <div class="sub">리처드 대니스 원칙 · 1유닛 = (총자산 × 1%) ÷ ATR</div>
      <div class="sub" style="margin-top:4px;color:${data.isLive ? '#22c55e' : '#fbbf24'}">${asOfLine}</div>
    </div>
    <div class="sub">생성: ${escape(ts)} KST</div>
  </header>

  <div class="summary">
    <div class="item"><div class="label">총 자산 (매수 평단가 합계)</div><div class="value">${fmtWon(data.totalCapital)}</div></div>
    <div class="item"><div class="label">1매매 최대 리스크 (1%)</div><div class="value">${fmtWon(data.riskPerTrade)}</div></div>
    <div class="item"><div class="label">감시 종목</div><div class="value">${data.reports.length}종</div></div>
    <div class="item"><div class="label">매수 신호</div><div class="value" style="color:#16a34a">${summary.entry}</div></div>
    <div class="item"><div class="label">매도/손절</div><div class="value" style="color:#dc2626">${summary.exit}</div></div>
    <div class="item"><div class="label">보유 손익</div><div class="value" style="color:${summary.totalPnl >= 0 ? '#16a34a' : '#dc2626'}">${fmtPnl(summary.totalPnl)}</div></div>
  </div>

  ${errorBlock}

  ${renderQuickOverview(data.reports)}

  ${renderScanSection(data.scanCandidates)}

  <div class="grid">
    ${cards}
  </div>

  <footer>
    데이터: Naver Finance (일봉) · 실시간: Naver polling (10초, via allorigins.win) · 시스템: 터틀 트레이딩 (CLAUDE.md)<br>
    <a href="${escape(DASHBOARD_PUBLIC_URL)}">${escape(DASHBOARD_PUBLIC_URL)}</a>
  </footer>
</div>

<script id="turtle-data" type="application/json">${JSON.stringify(buildLiveDataPayload(data)).replace(/<\/script>/gi, '<\\/script>')}</script>
<script>${liveUpdateScript()}</script>
</body>
</html>`;
}

function buildLiveDataPayload(data: DashboardData) {
  return {
    stocks: data.reports.map((r) => ({
      code: r.config.code,
      buyPrice: r.holding?.position.buyPrice ?? null,
      quantity: r.holding?.position.quantity ?? 0,
      action: r.signal.action,
    })),
  };
}

function liveUpdateScript(): string {
  return `(function(){
  const data = JSON.parse(document.getElementById('turtle-data').textContent);
  const POLL_MS = 10000;
  const PROXY = 'https://api.allorigins.win/get?url=';
  let failStreak = 0;

  function kstHour(){
    const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',hour:'2-digit',hour12:false}).formatToParts(new Date());
    return Number(p.find(x=>x.type==='hour')?.value ?? -1);
  }
  function kstMinute(){
    const p = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',minute:'2-digit'}).formatToParts(new Date());
    return Number(p.find(x=>x.type==='minute')?.value ?? -1);
  }
  function isMarketOpen(){
    const h = kstHour(), m = kstMinute();
    if (h < 9) return false;
    if (h > 15) return false;
    if (h === 15 && m >= 30) return false;
    const day = new Date().toLocaleDateString('en-US',{timeZone:'Asia/Seoul',weekday:'short'});
    return day !== 'Sat' && day !== 'Sun';
  }
  function fmtWon(n){ return Math.round(n).toLocaleString('ko-KR') + '원'; }
  function fmtPnl(n){ return (n>=0?'+':'') + Math.round(n).toLocaleString('ko-KR') + '원'; }
  function fmtPct(n){ return (n>0?'+':'') + n.toFixed(2) + '%'; }

  async function fetchOne(code){
    const naverUrl = 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + code;
    const res = await fetch(PROXY + encodeURIComponent(naverUrl));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const wrapper = await res.json();
    if (!wrapper || !wrapper.contents) throw new Error('proxy: empty contents');
    const j = JSON.parse(wrapper.contents);
    const item = j.datas && j.datas[0];
    if (!item) throw new Error('no data');
    const dir = item.compareToPreviousPrice && item.compareToPreviousPrice.code; // 2=상승,5=하락
    const sign = dir === '5' ? -1 : 1;
    const price = Number(item.closePriceRaw);
    const change = Number(item.compareToPreviousClosePriceRaw || 0) * sign;
    const changePct = Number(item.fluctuationsRatioRaw || 0) * sign;
    if (!isFinite(price) || price <= 0) throw new Error('invalid price: ' + item.closePriceRaw);
    return { price, change, changePct };
  }

  function updateHint(card, action, pnlPct){
    const el = card.querySelector('[data-live="hint"]');
    if (!el) return;
    let text='', color='';
    if (action === 'EXIT_10D_LOW') {
      if (pnlPct < 0) { text = '시스템 익절 신호 / 내 포지션 ' + pnlPct.toFixed(2) + '% 손실 — 매도 시 손실 확정'; color = '#dc2626'; }
      else if (pnlPct < 3) { text = '시스템 익절 신호 / 평가익 +' + pnlPct.toFixed(2) + '% 미미'; color = '#f59e0b'; }
      else { text = '시스템 익절 신호 — 평가익 +' + pnlPct.toFixed(2) + '% 확정 가능'; color = '#16a34a'; }
    } else if (action === 'STOP_LOSS') {
      text = '시스템 손절 신호 (-2 ATR) / 손익 ' + (pnlPct>=0?'+':'') + pnlPct.toFixed(2) + '% — 기계적 청산 권장';
      color = '#dc2626';
    } else if (action === 'PYRAMID') {
      text = '피라미딩 신호 / 평가익 +' + pnlPct.toFixed(2) + '% — 추가 매수 검토';
      color = '#16a34a';
    } else { return; }
    el.textContent = text;
    el.style.borderLeft = '3px solid ' + color;
    el.style.color = color;
    el.style.display = '';
  }

  function updateCard(s, live){
    const card = document.getElementById('stock-' + s.code);
    if (!card) return;
    const lastEl = card.querySelector('[data-live="price"]');
    if (lastEl) lastEl.textContent = fmtWon(live.price);
    const chEl = card.querySelector('[data-live="change"]');
    if (chEl){
      chEl.textContent = fmtPnl(live.change) + ' (' + fmtPct(live.changePct) + ')';
      chEl.style.color = live.change >= 0 ? '#16a34a' : '#dc2626';
    }
    if (s.quantity > 0 && s.buyPrice){
      const cv = live.price * s.quantity;
      const cb = s.buyPrice * s.quantity;
      const pnl = cv - cb;
      const pnlPct = (pnl / cb) * 100;
      const cvEl = card.querySelector('[data-live="currentValue"]');
      if (cvEl) cvEl.textContent = fmtWon(cv);
      const pnlEl = card.querySelector('[data-live="pnl"]');
      if (pnlEl){
        pnlEl.innerHTML = fmtPnl(pnl) + '<br><span class="pct">' + fmtPct(pnlPct) + '</span>';
        pnlEl.style.color = pnl >= 0 ? '#22c55e' : '#f87171';
      }
      const qoItem = document.querySelector('.qo-item[data-stock-code="' + s.code + '"]');
      if (qoItem){
        const qoWrap = qoItem.querySelector('[data-live="qoPnl"]');
        if (qoWrap) qoWrap.style.color = pnl >= 0 ? '#22c55e' : '#f87171';
        const qoAmt = qoItem.querySelector('[data-live="qoPnlAmt"]');
        if (qoAmt) qoAmt.textContent = fmtPnl(pnl);
        const qoPct = qoItem.querySelector('[data-live="qoPnlPct"]');
        if (qoPct) qoPct.textContent = fmtPct(pnlPct);
      }
      updateHint(card, s.action, pnlPct);
    }
  }

  function setStatus(text, color){
    const el = document.getElementById('live-status');
    if (el){ el.textContent = text; if (color) el.style.color = color; }
  }
  function setUpdated(){
    const el = document.getElementById('live-updated');
    if (el){
      const t = new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'});
      el.textContent = '마지막 ' + t;
    }
  }

  async function tick(){
    if (!isMarketOpen()){
      setStatus('장 마감 — 실시간 갱신 정지','#94a3b8');
      return;
    }
    setStatus('🟢 실시간 갱신 중 (10초)','#22c55e');
    try {
      const results = await Promise.all(data.stocks.map(async s => {
        try { const live = await fetchOne(s.code); return { s, live }; }
        catch(e){ console.warn('[live]', s.code, e.message); return null; }
      }));
      let ok = 0;
      for (const r of results){ if (r){ updateCard(r.s, r.live); ok++; } }
      if (ok === 0){
        failStreak++;
        const msg = failStreak >= 3
          ? '🔴 프록시 ' + failStreak + '회 연속 실패 — 일봉 종가 표시 중'
          : '⚠ 갱신 실패 (' + failStreak + '회)';
        setStatus(msg, failStreak >= 3 ? '#dc2626' : '#f59e0b');
      } else {
        if (failStreak > 0) console.log('[live] 복구 (실패 ' + failStreak + '회 → 0)');
        failStreak = 0;
        setUpdated();
      }
    } catch(e){
      console.error('[live] tick error', e);
      setStatus('⚠ 오류: ' + e.message,'#dc2626');
    }
  }

  tick();
  setInterval(tick, POLL_MS);
})();`;
}

function summarize(data: DashboardData) {
  let entry = 0, exit = 0, totalPnl = 0;
  for (const r of data.reports) {
    if (r.signal.action === 'ENTRY_BREAKOUT' || r.signal.action === 'PYRAMID') entry++;
    if (r.signal.action === 'EXIT_10D_LOW' || r.signal.action === 'STOP_LOSS') exit++;
    if (r.holding) totalPnl += r.holding.pnl;
  }
  return { entry, exit, totalPnl };
}
