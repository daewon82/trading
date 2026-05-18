/**
 * 장중 5분 cron — 트리거 가격 통과 시 잔디 즉시 알림.
 *
 * docs/dashboard.json 을 읽어 보유·매수 후보 메타를 가져온 후,
 * 네이버 실시간 가격을 조회해 트리거 통과 여부 확인. 같은 날 같은
 * 트리거는 한 번만 발송 (docs/intraday-alerts.json 캐시).
 *
 * 사용 (로컬): JANDI_WEBHOOK_URL=... npx tsx scripts/intraday-monitor.ts
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DashboardData } from '../src/types.js';
import { detectIntradayAlerts, filterNewAlerts } from '../src/intraday.js';
import { sendIntradayAlerts } from '../src/notify.js';

async function loadDotEnv() {
  try {
    const raw = await readFile(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // missing .env is OK in CI
  }
}

function isMarketHoursKst(): boolean {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit',
    weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = get('weekday');
  if (day === 'Sat' || day === 'Sun') return false;
  const hour = Number(get('hour'));
  const min = Number(get('minute'));
  if (hour < 9) return false;
  if (hour > 15) return false;
  if (hour === 15 && min > 35) return false; // 15:30 마감 + 5분 버퍼
  return true;
}

async function main() {
  await loadDotEnv();
  console.log('[intraday] 장중 트리거 감지 시작');

  if (!isMarketHoursKst()) {
    console.log('[intraday] 장 외 시간 — 건너뜀');
    return;
  }

  const dashboardPath = resolve(process.cwd(), 'docs/dashboard.json');
  let data: DashboardData;
  try {
    data = JSON.parse(await readFile(dashboardPath, 'utf8')) as DashboardData;
  } catch (err) {
    console.error('[intraday] docs/dashboard.json 로드 실패:', (err as Error).message);
    console.error('먼저 npm start 로 대시보드를 한 번 생성하세요.');
    process.exit(1);
  }

  const alerts = await detectIntradayAlerts(data);
  console.log(`[intraday] 감지된 트리거: ${alerts.length}건`);
  for (const a of alerts) console.log(`  · ${a.message} — ${a.detail}`);

  const { newAlerts, commit } = await filterNewAlerts(alerts);
  console.log(`[intraday] 신규 알림 (캐시 후): ${newAlerts.length}건`);

  const sent = await sendIntradayAlerts(newAlerts);
  if (sent) {
    await commit();
    console.log('[intraday] 캐시 업데이트 완료');
  } else if (process.env.JANDI_DRY_RUN === '1') {
    console.log('[intraday] DRY_RUN — 캐시 미저장');
  }
}

main().catch((err) => {
  console.error('[intraday] 치명적 오류:', err);
  process.exit(1);
});
