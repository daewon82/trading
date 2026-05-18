import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildDashboard } from '../src/index.js';
import { renderHtml } from '../src/report.js';
import { sendJandiNotification } from '../src/notify.js';

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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[env] .env 로드 실패:', (err as Error).message);
    }
  }
}

async function main() {
  await loadDotEnv();
  console.log('[turtle] 대시보드 생성 시작');
  const data = await buildDashboard();
  console.log(`[turtle] 수집 완료: 성공 ${data.reports.length}, 실패 ${data.errors.length}`);

  const html = renderHtml(data);

  const htmlPath = resolve(process.cwd(), 'docs/index.html');
  const jsonPath = resolve(process.cwd(), 'docs/dashboard.json');
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, html, 'utf8');
  await writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');

  console.log(`[turtle] 저장 완료: ${htmlPath}`);

  for (const r of data.reports) {
    const tag = r.signal.action.padEnd(15);
    const prot = r.protocol.status.padEnd(18);
    console.log(`  ${r.config.name.padEnd(8)} ${tag} ${prot} ${r.signal.reason}`);
  }

  await sendJandiNotification(data);

  if (data.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[turtle] 치명적 오류:', err);
  process.exit(1);
});
