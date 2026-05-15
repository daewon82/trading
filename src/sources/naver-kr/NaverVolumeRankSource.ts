import { logger } from '../../utils/logger.js';

const BASE = 'https://finance.naver.com/sise/sise_quant.naver';

export interface VolumeRankRow {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number | null;
  volume: number;
  /** 거래대금 (원 단위로 변환됨 — Naver 페이지 원본은 천원 단위) */
  tradingValue: number;
  per: number | null;
  roe: number | null;
  /** PER이 N/A이거나 이름이 ETF/ETN/레버리지/인버스/선물 패턴이면 true */
  isLikelyEtf: boolean;
}

const ETF_NAME_PATTERNS = [
  'KODEX', 'TIGER', 'ARIRANG', 'ACE', 'SOL', 'HANARO', 'KOSEF',
  'PLUS', 'KBSTAR', 'WOORI', 'TIMEFOLIO',
  'ETN', 'ETF', '레버리지', '인버스', '선물', 'WTI', '원유',
];

function isEtfName(name: string): boolean {
  const upper = name.toUpperCase();
  return ETF_NAME_PATTERNS.some((p) => upper.includes(p.toUpperCase()));
}

/**
 * Naver finance 거래량 순위 페이지(KOSPI sosok=0, KOSDAQ sosok=1) 파서.
 * 인증 불필요 · EUC-KR 페이지 디코딩 필요.
 *
 * 컬럼 구조 (확인된 순서):
 *   [0]순위 [1]종목명 [2]현재가 [3]전일비(텍스트+숫자) [4]등락률(%)
 *   [5]거래량 [6]거래대금(천원) [7]매수호가 [8]매도호가 [9]시가총액(억원)
 *   [10]PER [11]ROE
 */
export class NaverVolumeRankSource {
  readonly id = 'naver-volume-rank' as const;

  async fetch(market: 'kospi' | 'kosdaq' = 'kospi'): Promise<VolumeRankRow[]> {
    const sosok = market === 'kospi' ? 0 : 1;
    const url = `${BASE}?sosok=${sosok}`;
    try {
      const res = await globalThis.fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      });
      if (!res.ok) {
        logger.warn('NaverVolumeRankSource non-200', { status: res.status });
        return [];
      }
      const buf = await res.arrayBuffer();
      const html = new TextDecoder('euc-kr').decode(buf);
      return this.parse(html);
    } catch (err) {
      logger.error('NaverVolumeRankSource.fetch failed', { err: String(err) });
      return [];
    }
  }

  private parse(html: string): VolumeRankRow[] {
    const rows: VolumeRankRow[] = [];
    const trMatches = html.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
    let rank = 0;
    for (const tr of trMatches) {
      const codeMatch = tr.match(/code=(\d{6})/);
      const nameMatch = tr.match(/class="tltle"[^>]*>([^<]+)</);
      if (!codeMatch || !nameMatch) continue;
      const code = codeMatch[1]!;
      const name = nameMatch[1]!.trim();
      // 모든 <td>를 순서대로 추출 (number 클래스 한정하지 않음)
      const tdMatches = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
      const cells = tdMatches.map((m) => stripTags(m[1]!).trim());
      if (cells.length < 11) continue;
      const price = parseKr(cells[2]);
      const changePct = parsePct(cells[4]);
      const volume = parseKr(cells[5]);
      const tradingValueK = parseKr(cells[6]);
      const per = parseFloatOrNull(cells[10]);
      const roe = parseFloatOrNull(cells[11]);
      if (price == null || volume == null) continue;
      rank += 1;
      rows.push({
        rank,
        code,
        name,
        price,
        changePct,
        volume,
        tradingValue: (tradingValueK ?? 0) * 1000,
        per,
        roe,
        isLikelyEtf: per == null || isEtfName(name),
      });
    }
    return rows;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseKr(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, '').replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parsePct(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(s: string | undefined): number | null {
  if (!s) return null;
  if (/N\/A|–|—|^-$/.test(s.trim())) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
