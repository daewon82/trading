type LogMeta = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', msg: string, meta?: LogMeta): void {
  const ts = new Date().toISOString();
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}${payload}\n`;
  if (level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  info: (msg: string, meta?: LogMeta) => emit('info', msg, meta),
  warn: (msg: string, meta?: LogMeta) => emit('warn', msg, meta),
  error: (msg: string, meta?: LogMeta) => emit('error', msg, meta),
};

const KOREAN_UNIT: Array<readonly [string, number]> = [
  ['조', 1_000_000_000_000],
  ['억', 100_000_000],
  ['만', 10_000],
];

export function parseKoreanNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  const raw = input.trim();
  if (!raw || raw === '-' || raw.toUpperCase() === 'N/A') return null;

  const cleaned = raw.replace(/[%,\s]/g, '').replace(/원$/, '');
  if (/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) {
    return Number(cleaned);
  }

  let total = 0;
  let remainder = raw.replace(/[,\s]/g, '');
  let matched = false;
  for (const [unit, mult] of KOREAN_UNIT) {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)${unit}`);
    const m = remainder.match(re);
    if (m) {
      total += Number(m[1]) * mult;
      remainder = remainder.replace(re, '');
      matched = true;
    }
  }
  const leftover = remainder.match(/(\d+(?:\.\d+)?)/);
  if (leftover) {
    total += Number(leftover[1]);
    matched = true;
  }
  return matched ? total : null;
}

export function parseUsNumber(input: string | null | undefined): number | null {
  if (input == null) return null;
  const raw = input.trim();
  if (!raw || raw === '-' || raw.toUpperCase() === 'N/A') return null;

  // 단위 텍스트 제거 (USD, 원, 배)
  const cleaned = raw
    .replace(/USD/gi, '')
    .replace(/[원배]/g, '')
    .replace(/[$,%\s]/g, '');
  const m = cleaned.match(/^([-+]?\d+(?:\.\d+)?)([TBMK])?$/i);
  if (!m) {
    if (/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) return Number(cleaned);
    return null;
  }
  const value = Number(m[1]);
  const suffix = m[2]?.toUpperCase();
  switch (suffix) {
    case 'T': return value * 1e12;
    case 'B': return value * 1e9;
    case 'M': return value * 1e6;
    case 'K': return value * 1e3;
    default:  return value;
  }
}
