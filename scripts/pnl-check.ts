import { loadHoldings } from '../src/holdings.js';
import { fetchOhlcv } from '../src/fetch.js';

async function fetchLive(code: string) {
  const url = 'https://polling.finance.naver.com/api/realtime/domestic/stock/' + code;
  const res = await fetch(url);
  const j: any = await res.json();
  const item = j.datas[0];
  return {
    price: Number(item.closePriceRaw),
    change: Number(item.compareToPreviousClosePriceRaw || 0),
    pct: Number(item.fluctuationsRatioRaw || 0),
  };
}

function fmt(n: number, pad = 0) {
  return n.toLocaleString().padStart(pad);
}

async function main() {
  const holdings = await loadHoldings();
  console.log('=== SSR(일봉 종가) vs Live(실시간) 손익 비교 ===');
  console.log('종목       매수가    | 일봉종가(날짜)              | 일봉손익      | 라이브가      | 라이브손익');
  console.log('-'.repeat(120));

  let totalCloseP = 0;
  let totalLiveP = 0;

  for (const h of holdings) {
    try {
      const [candles, live] = await Promise.all([fetchOhlcv(h.code, 10), fetchLive(h.code)]);
      const last = candles[candles.length - 1];
      const cost = h.buyPrice * h.quantity;

      const closePnl = (last.close - h.buyPrice) * h.quantity;
      const livePnl = (live.price - h.buyPrice) * h.quantity;
      totalCloseP += closePnl;
      totalLiveP += livePnl;

      console.log(
        h.name.padEnd(8) + ' | ' +
        fmt(h.buyPrice, 8) + ' | ' +
        fmt(last.close, 8) + ' (' + last.date + ') | ' +
        (closePnl >= 0 ? '+' : '') + fmt(closePnl, 8) + '원 | ' +
        fmt(live.price, 8) + ' | ' +
        (livePnl >= 0 ? '+' : '') + fmt(livePnl, 8) + '원'
      );
    } catch (e: any) {
      console.log(h.name, 'ERROR', e.message);
    }
  }
  console.log('-'.repeat(120));
  console.log(
    '합계'.padEnd(8) + ' |          |                              | ' +
    (totalCloseP >= 0 ? '+' : '') + fmt(totalCloseP, 8) + '원 |          | ' +
    (totalLiveP >= 0 ? '+' : '') + fmt(totalLiveP, 8) + '원'
  );
  console.log('');
  console.log('대시보드 상단 "보유 손익" = 일봉 종가 합계 = ' + (totalCloseP >= 0 ? '+' : '') + totalCloseP.toLocaleString() + '원');
  console.log('실시간 합계                          = ' + (totalLiveP >= 0 ? '+' : '') + totalLiveP.toLocaleString() + '원');
}

main();
