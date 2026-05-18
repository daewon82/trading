import type { DashboardData, StockReport, TurtleAction, ProtocolStatus } from './types.js';
import { DASHBOARD_PUBLIC_URL, RISK_PER_TRADE } from './config.js';

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

function renderStockCard(r: StockReport): string {
  const { config, indicators, signal, protocol, holding } = r;
  const closes = r.history.map((c) => c.close);
  const changeColor = indicators.change >= 0 ? '#16a34a' : '#dc2626';

  const myPosition = holding ? `
    <div class="my-pos">
      <div class="my-pos-title">내 포지션</div>
      <div class="my-pos-row">
        <div class="cell"><div class="cell-k">매수가</div><div class="cell-v">${fmtWon(holding.position.buyPrice)}</div></div>
        <div class="cell"><div class="cell-k">수량</div><div class="cell-v">${holding.position.quantity}주</div></div>
        <div class="cell"><div class="cell-k">평가액</div><div class="cell-v">${fmtWon(holding.currentValue)}</div></div>
        <div class="cell pnl"><div class="cell-k">내 손익</div><div class="cell-v big" style="color:${holding.pnl >= 0 ? '#22c55e' : '#f87171'}">${fmtPnl(holding.pnl)}<br><span class="pct">${fmtPct(holding.pnlPct)}</span></div></div>
      </div>
      <div class="my-pos-row sub">
        <div class="cell"><div class="cell-k">손절선</div><div class="cell-v">${fmtWon(holding.stopPrice)} ${holding.stoppedOut ? '<span class="alert">⚠ 이탈</span>' : ''}</div></div>
        <div class="cell"><div class="cell-k">다음 피라미딩</div><div class="cell-v">${fmtWon(holding.nextPyramidPrice)} ${holding.pyramidReady ? '<span class="alert ok">✓ 도달</span>' : ''}</div></div>
      </div>
      ${(() => {
        const hint = buildMismatchHint(signal, holding);
        return hint ? `<div class="hint" style="border-left:3px solid ${HINT_COLOR[hint.tone]};color:${HINT_COLOR[hint.tone]}">${escape(hint.text)}</div>` : '';
      })()}
    </div>` : '<div class="my-pos muted">미보유 — 시스템 신호 참고용</div>';

  const protocolItems = [
    ...protocol.passed.map((p) => `<li class="pass">✓ ${escape(p)}</li>`),
    ...protocol.failed.map((p) => `<li class="fail">✗ ${escape(p)}</li>`),
  ].join('');

  return `
  <article class="card">
    <header class="card-head">
      <div>
        <h2>${escape(config.name)} <span class="code">${escape(config.code)}</span></h2>
        <div class="note">${escape(config.positionNote)}</div>
      </div>
      <div class="price">
        <div class="last">${fmtWon(indicators.lastClose)}</div>
        <div class="change" style="color:${changeColor}">${fmtPnl(indicators.change)} (${fmtPct(indicators.changePct)})</div>
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
      <div class="section-title">1유닛 (리스크 ${fmtWon(RISK_PER_TRADE)} 기준)</div>
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

  const cards = data.reports.map(renderStockCard).join('\n');

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
    <div class="item"><div class="label">총 자산</div><div class="value">${fmtWon(data.totalCapital)}</div></div>
    <div class="item"><div class="label">1매매 최대 리스크</div><div class="value">${fmtWon(data.riskPerTrade)}</div></div>
    <div class="item"><div class="label">감시 종목</div><div class="value">${data.reports.length}종</div></div>
    <div class="item"><div class="label">매수 신호</div><div class="value" style="color:#16a34a">${summary.entry}</div></div>
    <div class="item"><div class="label">매도/손절</div><div class="value" style="color:#dc2626">${summary.exit}</div></div>
    <div class="item"><div class="label">보유 손익</div><div class="value" style="color:${summary.totalPnl >= 0 ? '#16a34a' : '#dc2626'}">${fmtPnl(summary.totalPnl)}</div></div>
  </div>

  ${errorBlock}

  <div class="grid">
    ${cards}
  </div>

  <footer>
    데이터: Yahoo Finance · 시스템: 터틀 트레이딩 (CLAUDE.md) · <a href="${escape(DASHBOARD_PUBLIC_URL)}">${escape(DASHBOARD_PUBLIC_URL)}</a>
  </footer>
</div>
</body>
</html>`;
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
