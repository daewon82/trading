import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { buildDashboard } from '../src/index.js';
import { renderHtml } from '../src/report.js';

async function main() {
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

  if (data.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[turtle] 치명적 오류:', err);
  process.exit(1);
});
