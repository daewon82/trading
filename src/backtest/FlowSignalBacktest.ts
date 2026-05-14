import type { DailyFlow } from '../types/flow.js';
import type {
  BacktestResult,
  Direction,
  SignalEvent,
  SignalStats,
  SignalType,
} from './types.js';
import { HORIZONS } from './types.js';

/**
 * 외인+기관 동반 매수/매도 신호의 사후 수익률 백테스트.
 *
 * **방법론** (look-ahead bias 회피):
 * 1. `daily` 배열은 최신→과거 순으로 정렬 (Toss API 기본). i=0이 가장 최근.
 * 2. 시점 t의 5일 누적 신호 = daily[t..t+5]의 외인+기관 동반 일치
 * 3. 사후 N일 수익률 = (daily[t-N].close - daily[t].close) / daily[t].close
 *    (t-N이 더 최신이므로 t시점 진입 후 N일 뒤 시점)
 * 4. 매도 신호의 수익률은 부호 반전 — 매도 적중(가격 하락)이 양의 수익으로 표시
 *
 * **제약**:
 * - 종가 기반 단순 진입/청산 — 슬리피지·체결 불확실성 미반영
 * - 라운드트립 거래비용(0.4%)은 별도 보고
 * - 신호 중복 제거 안 함 — 같은 종목 연속 동반 매수 시 매 시점 카운트
 */
export class FlowSignalBacktest {
  /**
   * 단일 종목의 시계열에서 모든 신호 이벤트 탐지 + 사후 수익률 계산.
   * `requiredHorizon`(기본 20거래일) 이후 데이터가 없으면 사후 미측정으로 제외.
   */
  detectEvents(
    code: string,
    name: string,
    daily: readonly DailyFlow[],
    requiredHorizon = 20,
  ): SignalEvent[] {
    const events: SignalEvent[] = [];
    if (daily.length < requiredHorizon + 20) return events;

    // 신호 정의: 각 시점 t에서 가능한 8가지 신호 검사
    // t는 가능한 가장 과거(daily.length - 1)부터 (requiredHorizon)까지
    // = 사후 horizon 데이터가 남아 있어야 함 → t - requiredHorizon >= 0
    for (let t = requiredHorizon; t < daily.length; t++) {
      const cur = daily[t];
      if (!cur || cur.close == null || cur.close <= 0) continue;

      const detected: Array<{ type: SignalType; dir: Direction }> = [];

      // 1) 당일 신호
      const today = cur;
      if (today.foreignerNet != null && today.institutionalNet != null) {
        if (today.foreignerNet > 0 && today.institutionalNet > 0)
          detected.push({ type: 'today_both_buy', dir: 'buy' });
        if (today.foreignerNet < 0 && today.institutionalNet < 0)
          detected.push({ type: 'today_both_sell', dir: 'sell' });
      }

      // 2) 5일 누적: daily[t..t+5]
      const win5 = daily.slice(t, t + 5);
      const sum5f = sumField(win5, 'foreignerNet');
      const sum5i = sumField(win5, 'institutionalNet');
      if (sum5f != null && sum5i != null) {
        if (sum5f > 0 && sum5i > 0)
          detected.push({ type: '5d_both_buy', dir: 'buy' });
        if (sum5f < 0 && sum5i < 0)
          detected.push({ type: '5d_both_sell', dir: 'sell' });
      }

      // 3) 20일 누적: daily[t..t+20]
      if (daily.length >= t + 20) {
        const win20 = daily.slice(t, t + 20);
        const sum20f = sumField(win20, 'foreignerNet');
        const sum20i = sumField(win20, 'institutionalNet');
        if (sum20f != null && sum20i != null) {
          if (sum20f > 0 && sum20i > 0)
            detected.push({ type: '20d_both_buy', dir: 'buy' });
          if (sum20f < 0 && sum20i < 0)
            detected.push({ type: '20d_both_sell', dir: 'sell' });
        }
      }

      // 4) 60일 누적: daily[t..t+60]
      if (daily.length >= t + 60) {
        const win60 = daily.slice(t, t + 60);
        const sum60f = sumField(win60, 'foreignerNet');
        const sum60i = sumField(win60, 'institutionalNet');
        if (sum60f != null && sum60i != null) {
          if (sum60f > 0 && sum60i > 0)
            detected.push({ type: '60d_both_buy', dir: 'buy' });
          if (sum60f < 0 && sum60i < 0)
            detected.push({ type: '60d_both_sell', dir: 'sell' });
        }
      }

      if (detected.length === 0) continue;

      // 사후 N일 종가 (t시점 진입 후 → daily[t - N], 더 최신)
      const futureClose: Record<number, number | null> = {};
      const forwardReturns: Record<number, number | null> = {};
      for (const h of HORIZONS) {
        const future = daily[t - h];
        if (future && future.close != null && future.close > 0) {
          futureClose[h] = future.close;
          const raw = (future.close - cur.close) / cur.close;
          forwardReturns[h] = raw;
        } else {
          futureClose[h] = null;
          forwardReturns[h] = null;
        }
      }

      for (const d of detected) {
        // 매도 신호는 부호 반전(가격 하락 = 양의 적중)
        const signedReturns: Record<number, number | null> = {};
        for (const h of HORIZONS) {
          const r = forwardReturns[h];
          signedReturns[h] = r == null ? null : d.dir === 'sell' ? -r : r;
        }
        events.push({
          code,
          name,
          date: cur.date,
          type: d.type,
          direction: d.dir,
          entryClose: cur.close,
          futureClose,
          forwardReturns: signedReturns,
        });
      }
    }
    return events;
  }

  /**
   * 신호 유형별 통계 집계.
   * 라운드트립 거래비용(매수 0.15% + 매도 0.25% = 0.4%)을 평균 수익률에서 차감해 net로 보고.
   */
  aggregate(
    events: SignalEvent[],
    roundTripCostBps = 40,
  ): BacktestResult[] {
    const byType = new Map<SignalType, SignalEvent[]>();
    for (const e of events) {
      const arr = byType.get(e.type) ?? [];
      arr.push(e);
      byType.set(e.type, arr);
    }
    const results: BacktestResult[] = [];
    for (const [type, evts] of byType) {
      const byHorizon: Record<number, SignalStats> = {};
      for (const h of HORIZONS) {
        const xs = evts
          .map((e) => e.forwardReturns[h])
          .filter((v): v is number => v != null);
        byHorizon[h] = computeStats(xs, roundTripCostBps);
      }
      // 종목별 카운트
      const tickerCount = new Map<string, { name: string; count: number }>();
      for (const e of evts) {
        const cur = tickerCount.get(e.code) ?? { name: e.name, count: 0 };
        cur.count += 1;
        tickerCount.set(e.code, cur);
      }
      const topTickers = [...tickerCount.entries()]
        .map(([code, { name, count }]) => ({ code, name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      results.push({ signalType: type, totalEvents: evts.length, byHorizon, topTickers });
    }
    // 결과 정렬: 매수 신호 → 매도 신호, 기간 짧은 순
    const order: SignalType[] = [
      'today_both_buy', '5d_both_buy', '20d_both_buy', '60d_both_buy',
      'today_both_sell', '5d_both_sell', '20d_both_sell', '60d_both_sell',
    ];
    results.sort((a, b) => order.indexOf(a.signalType) - order.indexOf(b.signalType));
    return results;
  }
}

function sumField(rows: readonly DailyFlow[], key: 'foreignerNet' | 'institutionalNet'): number | null {
  let total = 0;
  let count = 0;
  for (const r of rows) {
    const v = r[key];
    if (v != null) { total += v; count++; }
  }
  return count >= Math.ceil(rows.length * 0.7) ? total : null;
}

function computeStats(xs: number[], roundTripCostBps: number): SignalStats {
  if (xs.length === 0) {
    return { meanReturn: null, hitRate: null, std: null, ratio: null, worst: null, best: null, count: 0 };
  }
  const cost = roundTripCostBps / 10000;
  const net = xs.map((x) => x - cost);
  const mean = net.reduce((a, b) => a + b, 0) / net.length;
  const variance = net.reduce((a, b) => a + (b - mean) ** 2, 0) / net.length;
  const std = Math.sqrt(variance);
  const hits = net.filter((x) => x > 0).length;
  return {
    meanReturn: mean,
    hitRate: hits / net.length,
    std,
    ratio: std > 0 ? mean / std : null,
    worst: Math.min(...net),
    best: Math.max(...net),
    count: net.length,
  };
}
