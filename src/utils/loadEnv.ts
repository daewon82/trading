import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * v1.7 — 최소 .env 로더 (외부 의존성 없이 동작).
 *
 * `.env` 파일에서 `KEY=VALUE` 형식의 줄을 읽어 process.env에 주입.
 * 이미 설정된 환경변수는 덮어쓰지 않음 (CLI overrides .env).
 *
 * 의도적으로 단순함:
 *   - 빈 줄·주석(#) 무시
 *   - 따옴표 처리 안 함 (값에 따옴표 쓸 일 없음)
 *   - 다중 줄 값 미지원
 */
export function loadEnv(path = '.env'): void {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return;
  try {
    const content = readFileSync(fullPath, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!key) continue;
      if (process.env[key] != null) continue; // 기존 값 우선
      process.env[key] = value;
    }
  } catch {
    // 무시 — .env 없으면 그냥 환경변수만 사용
  }
}
