/**
 * KOSPI 대형주 스캔 — 터틀 시스템 신규 진입 후보 추출 (CLI).
 *
 * 평가 조건 (claude.md 매수 후보 스캔 프로토콜):
 *   1. 종가 ≥ 20일 신고가 (System 1 entry)
 *   2. 종가 > MA60
 *   3. 종가 > MA120
 *   4. MA60 > MA120 (정배열)
 *
 * 사용: npx tsx scripts/scan.ts
 */
import { scanCandidates, SCAN_CANDIDATES } from '../src/scan.js';
import { nowInKst, isDailyCloseConfirmed } from '../src/time.js';
import {
  RISK_PCT,
  FALLBACK_TOTAL_CAPITAL,
  HAS_TOTAL_CAPITAL_OVERRIDE,
} from '../src/config.js';
import { loadHoldings } from '../src/holdings.js';

function fmtWon(n: number): string {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

async function main() {
  const holdings = await loadHoldings();
  const costBasis = holdings.reduce((s, h) => s + h.buyPrice * h.quantity, 0);
  const totalCapital = HAS_TOTAL_CAPITAL_OVERRIDE
    ? FALLBACK_TOTAL_CAPITAL
    : (costBasis > 0 ? costBasis : FALLBACK_TOTAL_CAPITAL);
  const riskPerTrade = totalCapital * RISK_PCT;
  const kst = nowInKst();
  const closeConfirmed = isDailyCloseConfirmed();

  console.log(`\n=== KOSPI 대형주 신규 진입 후보 스캔 ===`);
  console.log(`기준: ${closeConfirmed ? '오늘 확정 종가' : '어제 확정 종가 (장중/시초가 실행)'}`);
  console.log(`총자산: ${fmtWon(totalCapital)} · 1매매 리스크: ${fmtWon(riskPerTrade)}`);
  console.log(`후보군: ${SCAN_CANDIDATES.length}종목\n`);

  const results = await scanCandidates({
    kstToday: kst.date,
    closeConfirmed,
    riskPerTrade,
    onProgress: (c, r) => {
      if (r.error) {
        console.log(`  ${c.name.padEnd(15)} ERROR: ${r.error}`);
        return;
      }
      const flags = [
        r.breakoutPassed ? '돌파✓' : `돌파X(${r.distancePct.toFixed(1)}%)`,
        r.ma60Passed ? 'MA60✓' : 'MA60X',
        r.ma120Passed ? 'MA120✓' : 'MA120X',
        r.alignmentPassed ? '정배열✓' : '역배열X',
      ];
      console.log(`  ${c.name.padEnd(15)} ${fmtWon(r.lastClose).padStart(12)}  ${flags.join(' ')}`);
    },
  });

  const tierA = results.filter((r) => r.tier === 'A').sort((a, b) => b.distancePct - a.distancePct);
  const tierB = results.filter((r) => r.tier === 'B').sort((a, b) => a.distancePct - b.distancePct);

  console.log('\n=== [A] 즉시 진입 신호 ===');
  if (tierA.length === 0) console.log('  (없음)');
  else for (const r of tierA) {
    const sizeNote = r.unitSize === 0 ? ' · ⚠ 자본 부족 (1유닛 0주)' : ` · 1유닛 ${r.unitSize}주`;
    const distSign = r.distancePct < 0 ? `+${(-r.distancePct).toFixed(2)}% 돌파` : `${r.distancePct.toFixed(2)}% 부족`;
    console.log(
      `  ${r.name.padEnd(15)} ${fmtWon(r.lastClose).padStart(12)} · 20일 고점 ${fmtWon(r.donchianHigh20)} (${distSign}) · ATR ${fmtWon(r.atr20)}${sizeNote}`,
    );
  }

  console.log('\n=== [B] 돌파 임박 (3% 이내, 추세 충족) ===');
  if (tierB.length === 0) console.log('  (없음)');
  else for (const r of tierB) {
    console.log(
      `  ${r.name.padEnd(15)} ${fmtWon(r.lastClose).padStart(12)} · 돌파선 ${fmtWon(r.donchianHigh20)} 까지 ${r.distancePct.toFixed(2)}%`,
    );
  }

  console.log('\n=== 요약 ===');
  console.log(`  A 등급: ${tierA.length}종목`);
  console.log(`  B 등급: ${tierB.length}종목`);
  console.log(`  실패: ${results.filter((r) => r.error).length}종목`);
}

main().catch((err) => {
  console.error('[scan] 치명적 오류:', err);
  process.exit(1);
});
