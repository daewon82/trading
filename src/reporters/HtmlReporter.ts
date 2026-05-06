import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComparisonReport, Currency } from '../types/stock.js';

export class HtmlReporter {
  async write(report: ComparisonReport, outPath: string): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, this.render(report), 'utf8');
  }

  render(report: ComparisonReport): string {
    const { market, currency, generatedAt, rows, ranking } = report;
    const fmtNum = (v: number | null, digits = 2): string =>
      v == null ? '—' : v.toFixed(digits);
    const fmtPct = (v: number | null): string =>
      v == null ? '—' : `${v.toFixed(2)}%`;

    const tbody = rows
      .map(
        (r) => `      <tr>
        <td>${esc(r.code)}</td>
        <td>${esc(r.name)}</td>
        <td>${esc(r.source)}</td>
        <td class="num">${this.formatPrice(r.price, currency)}</td>
        <td class="num">${fmtPct(r.changePercent)}</td>
        <td class="num">${this.formatMarketCap(r.marketCap, currency)}</td>
        <td class="num">${fmtNum(r.per)}</td>
        <td class="num">${fmtNum(r.pbr)}</td>
        <td class="num">${fmtPct(r.roe)}</td>
        <td class="num">${fmtPct(r.dividendYield)}</td>
      </tr>`,
      )
      .join('\n');

    const rankItem = (label: string, codes: string[]): string =>
      `      <li><strong>${esc(label)}:</strong> ${codes.map(esc).join(' › ') || '—'}</li>`;

    return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>${esc(market)} 주식 비교 (${esc(currency)})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #222; }
    h1 { margin: 0 0 4px; }
    .meta { color: #888; font-size: .9em; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; font-size: .92em; }
    th { background: #f4f4f4; text-align: left; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .ranks { margin-top: 20px; }
    .ranks ul { padding-left: 18px; }
  </style>
</head>
<body>
  <h1>${esc(market)} 주식 비교</h1>
  <div class="meta">통화 ${esc(currency)} · 생성 ${esc(generatedAt)}</div>
  <table>
    <thead>
      <tr>
        <th>코드</th><th>이름</th><th>소스</th>
        <th>가격</th><th>변동%</th><th>시가총액</th>
        <th>PER</th><th>PBR</th><th>ROE</th><th>배당</th>
      </tr>
    </thead>
    <tbody>
${tbody}
    </tbody>
  </table>
  <div class="ranks">
    <h2>랭킹</h2>
    <ul>
${rankItem('시가총액(↓)', ranking.byMarketCap)}
${rankItem('저PER(↑)', ranking.byPer)}
${rankItem('배당수익률(↓)', ranking.byDividendYield)}
    </ul>
  </div>
</body>
</html>
`;
  }

  private formatPrice(v: number | null, currency: Currency): string {
    if (v == null) return '—';
    if (currency === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
    return `$${v.toFixed(2)}`;
  }

  private formatMarketCap(v: number | null, currency: Currency): string {
    if (v == null) return '—';
    if (currency === 'KRW') {
      const jo = 1e12;
      const eok = 1e8;
      if (v >= jo) return `${(v / jo).toFixed(2)}조원`;
      if (v >= eok) return `${Math.round(v / eok).toLocaleString('ko-KR')}억원`;
      return `${Math.round(v).toLocaleString('ko-KR')}원`;
    }
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    return `$${v.toFixed(0)}`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
