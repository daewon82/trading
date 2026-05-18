import type { Candle, Indicators, ProtocolCheck } from './types.js';

export function checkProtocol(candles: Candle[], indicators: Indicators): ProtocolCheck {
  const passed: string[] = [];
  const failed: string[] = [];
  const notes: string[] = [];

  const { lastClose, ma60, ma120, avgVolume20 } = indicators;

  if (lastClose > ma60) {
    passed.push(`MA60 위 (${fmt(lastClose)} > ${fmt(ma60)})`);
  } else {
    failed.push(`MA60 아래 (${fmt(lastClose)} ≤ ${fmt(ma60)})`);
  }
  if (lastClose > ma120) {
    passed.push(`MA120 위 (${fmt(lastClose)} > ${fmt(ma120)})`);
  } else {
    failed.push(`MA120 아래 (${fmt(lastClose)} ≤ ${fmt(ma120)})`);
  }
  if (ma60 > ma120) {
    passed.push(`정배열 (MA60 > MA120)`);
  } else {
    failed.push(`역배열 (MA60 ≤ MA120)`);
  }

  const daysSinceBreakout = daysSinceLast20DayBreakout(candles);
  const monthsSince = Math.floor(daysSinceBreakout / 21);
  if (daysSinceBreakout > 60) {
    failed.push(`20일 신고가 ${daysSinceBreakout}일(${monthsSince}개월) 미돌파 — 역추세 고착`);
  } else if (daysSinceBreakout === 0) {
    passed.push(`오늘 20일 신고가 돌파`);
  } else {
    passed.push(`최근 20일 신고가 돌파 ${daysSinceBreakout}일 전`);
  }

  const recentVolume = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  if (avgVolume20 > 0 && recentVolume < avgVolume20 * 0.4) {
    failed.push(`거래량 전멸 (최근 5일 평균 ${((recentVolume / avgVolume20) * 100).toFixed(0)}% 수준)`);
  } else {
    passed.push(`거래량 정상`);
  }

  let status: ProtocolCheck['status'];
  if (failed.length === 0) {
    status = 'KEEP';
  } else if (failed.length >= 3) {
    status = 'DELETE_CANDIDATE';
    notes.push('claude.md 삭제 조건 다중 충족 — 관심 종목에서 제외 검토.');
  } else {
    status = 'WATCH';
    notes.push('일부 조건 실패 — 관찰 필요. 추가 조건 충족 시 삭제 검토.');
  }

  return { status, passed, failed, notes };
}

/**
 * 마지막 20일 신고가 돌파 이후 경과일.
 * 매일 그날 직전 20일 고점을 다시 계산해서, 종가가 그 고점 이상이었던 가장
 * 최근 날짜를 찾는다. 그 날부터 오늘까지의 거래일 수가 "미돌파 지속 기간".
 */
function daysSinceLast20DayBreakout(candles: Candle[]): number {
  if (candles.length < 21) return 0;
  for (let i = candles.length - 1; i >= 20; i--) {
    const prior20 = candles.slice(i - 20, i);
    const prior20Max = Math.max(...prior20.map((c) => c.high));
    if (candles[i].close >= prior20Max) {
      return candles.length - 1 - i;
    }
  }
  return candles.length - 20;
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
}
