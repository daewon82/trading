import type { DashboardData, StockReport, TurtleAction } from './types.js';
import { DASHBOARD_PUBLIC_URL } from './config.js';

const ACTIONABLE: TurtleAction[] = ['ENTRY_BREAKOUT', 'PYRAMID', 'STOP_LOSS', 'EXIT_10D_LOW'];

const ACTION_EMOJI: Record<TurtleAction, string> = {
  ENTRY_BREAKOUT: '🟢',
  PYRAMID: '🔼',
  HOLD: '⚪',
  EXIT_10D_LOW: '🟡',
  STOP_LOSS: '🔴',
  WAIT: '⏳',
};

const ACTION_LABEL: Record<TurtleAction, string> = {
  ENTRY_BREAKOUT: '신규 매수',
  PYRAMID: '피라미딩',
  HOLD: '보유 유지',
  EXIT_10D_LOW: '익절 청산',
  STOP_LOSS: '손절',
  WAIT: '돌파 대기',
};

const COLOR: Record<TurtleAction, string> = {
  ENTRY_BREAKOUT: '#16a34a',
  PYRAMID: '#22c55e',
  HOLD: '#0ea5e9',
  EXIT_10D_LOW: '#f59e0b',
  STOP_LOSS: '#dc2626',
  WAIT: '#64748b',
};

interface JandiPayload {
  body: string;
  connectColor: string;
  connectInfo: { title: string; description: string }[];
}

function fmtWon(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
}

function priorityWeight(action: TurtleAction): number {
  if (action === 'STOP_LOSS') return 0;
  if (action === 'EXIT_10D_LOW') return 1;
  if (action === 'ENTRY_BREAKOUT') return 2;
  if (action === 'PYRAMID') return 3;
  return 4;
}

function buildPayload(data: DashboardData): JandiPayload | null {
  const actionable = data.reports.filter((r) => ACTIONABLE.includes(r.signal.action));
  if (actionable.length === 0) return null;

  actionable.sort((a, b) => priorityWeight(a.signal.action) - priorityWeight(b.signal.action));

  const counts = new Map<TurtleAction, number>();
  for (const r of actionable) {
    counts.set(r.signal.action, (counts.get(r.signal.action) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .map(([a, n]) => `${ACTION_EMOJI[a]} ${ACTION_LABEL[a]} ${n}건`)
    .join(' · ');

  const ts = new Date(data.generatedAt).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const headline = priorityWeight(actionable[0].signal.action);
  const color = COLOR[actionable[0].signal.action];

  const connectInfo = actionable.map((r) => buildSection(r));

  return {
    body: `🐢 터틀 KOSPI 신호 (${ts}) — ${summary}\n${DASHBOARD_PUBLIC_URL}`,
    connectColor: color,
    connectInfo,
  };
}

function buildSection(r: StockReport) {
  const { config, indicators, signal, holding } = r;
  const lines: string[] = [];
  lines.push(`현재가 ${fmtWon(indicators.lastClose)} · 20일 ATR ${fmtWon(indicators.atr20)}`);
  lines.push(signal.reason);
  if (holding) {
    const pnlSign = holding.pnl >= 0 ? '+' : '';
    lines.push(
      `보유 ${holding.position.quantity}주 @ ${fmtWon(holding.position.buyPrice)} · 손익 ${pnlSign}${fmtWon(holding.pnl)} (${holding.pnlPct.toFixed(2)}%)`,
    );
  } else if (signal.action === 'ENTRY_BREAKOUT') {
    lines.push(`1유닛 ${signal.unitSize}주 (약 ${fmtWon(signal.unitCost)})`);
  }
  return {
    title: `${ACTION_EMOJI[signal.action]} ${config.name} (${config.code}) — ${ACTION_LABEL[signal.action]}`,
    description: lines.join('\n'),
  };
}

export async function sendJandiNotification(data: DashboardData): Promise<boolean> {
  const url = process.env.JANDI_WEBHOOK_URL;
  if (!url) {
    console.log('[notify] JANDI_WEBHOOK_URL 미설정 — 알림 스킵');
    return false;
  }
  const payload = buildPayload(data);
  if (!payload) {
    console.log('[notify] 액션 신호 없음 — 알림 스킵');
    return false;
  }
  if (process.env.JANDI_DRY_RUN === '1') {
    console.log('[notify] DRY_RUN 모드 — 발송 안 함. payload:');
    console.log(JSON.stringify(payload, null, 2));
    return false;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.tosslab.jandi-v2+json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[notify] 잔디 발송 실패 HTTP ${res.status}: ${text}`);
    return false;
  }
  console.log(`[notify] 잔디 알림 발송 완료 (${payload.connectInfo.length}건)`);
  return true;
}
