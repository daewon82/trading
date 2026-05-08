import { logger } from '../../utils/logger.js';

const DART_BASE = 'https://opendart.fss.or.kr/api';

export interface DartFinancial {
  ticker: string;
  corpCode: string;
  bsnsYear: string;
  reprtCode: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  prevRevenue: number | null;
  prevOperatingProfit: number | null;
  prevNetIncome: number | null;
}

interface DartFnlttItem {
  account_nm?: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
  fs_div?: string;
  sj_div?: string;
}

interface DartFnlttResponse {
  status: string;
  message?: string;
  list?: DartFnlttItem[];
}

interface DartCorpCodeEntry {
  ticker: string;
  corpCode: string;
  corpName: string;
}

/** corpCode.xml은 ZIP 다운로드라 일반 fetch 어려움. 미리 작성한 정적 매핑 사용. */
const KR_CORP_CODE_MAP: Record<string, string> = {
  '005930': '00126380', // 삼성전자
  '000660': '00164779', // SK하이닉스
  '035420': '00266961', // NAVER
  '035720': '00258801', // 카카오
  '373220': '01515323', // LG에너지솔루션
  '005380': '00164742', // 현대차
  '000270': '00106494', // 기아
  '207940': '00877059', // 삼성바이오로직스
  '068270': '00421440', // 셀트리온
  '105560': '00688996', // KB금융
  '086790': '00547583', // 하나금융지주
  '055550': '00382199', // 신한지주
  '028260': '00126308', // 삼성물산
  '066570': '00401731', // LG전자
  '012330': '00164645', // 현대모비스
  '329180': '01083655', // HD현대중공업
  '012450': '00139834', // 한화에어로스페이스
  '017670': '00258999', // SK텔레콤
  '030200': '00187220', // KT
  '033780': '00153628', // KT&G
  '032830': '00126256', // 삼성생명
  '015760': '00139717', // 한국전력
  '024110': '00261443', // 기업은행
  '267260': '01072164', // HD현대일렉트릭
  '042700': '00181712', // 한미반도체
  '003670': '00378124', // 포스코퓨처엠
  '247540': '00897173', // 에코프로비엠
  '086520': '00422972', // 에코프로
  '051910': '00356361', // LG화학
  '005490': '00126362', // POSCO홀딩스
  '017670_t': '00258999', // (alias guard)
};

export function getCorpCode(ticker: string): string | null {
  return KR_CORP_CODE_MAP[ticker] ?? null;
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * DART 단일회사 전체 재무제표 fetch.
 * reprt_code: 11011=사업보고서, 11012=반기, 11013=1분기, 11014=3분기.
 */
export async function fetchDartFinancial(
  ticker: string,
  apiKey: string,
  bsnsYear: string,
  reprtCode: string,
): Promise<DartFinancial | null> {
  const corpCode = getCorpCode(ticker);
  if (!corpCode) return null;
  const url = `${DART_BASE}/fnlttSinglAcntAll.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bsns_year=${bsnsYear}&reprt_code=${reprtCode}&fs_div=CFS`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as DartFnlttResponse;
    if (json.status !== '000' || !json.list) {
      logger.warn('DART fnltt non-success', { ticker, status: json.status, msg: json.message });
      return null;
    }
    const findItem = (predicate: (it: DartFnlttItem) => boolean): DartFnlttItem | null =>
      json.list?.find(predicate) ?? null;

    const revenueItem = findItem(
      (i) => (i.sj_div === 'IS' || i.sj_div === 'CIS') && /매출액|수익\(매출액\)/.test(i.account_nm ?? ''),
    );
    const opItem = findItem(
      (i) => (i.sj_div === 'IS' || i.sj_div === 'CIS') && /영업이익/.test(i.account_nm ?? ''),
    );
    const niItem = findItem(
      (i) => (i.sj_div === 'IS' || i.sj_div === 'CIS') && /당기순이익|반기순이익|분기순이익/.test(i.account_nm ?? ''),
    );

    return {
      ticker,
      corpCode,
      bsnsYear,
      reprtCode,
      revenue: parseAmount(revenueItem?.thstrm_amount),
      operatingProfit: parseAmount(opItem?.thstrm_amount),
      netIncome: parseAmount(niItem?.thstrm_amount),
      prevRevenue: parseAmount(revenueItem?.frmtrm_amount),
      prevOperatingProfit: parseAmount(opItem?.frmtrm_amount),
      prevNetIncome: parseAmount(niItem?.frmtrm_amount),
    };
  } catch (err) {
    logger.warn('DART fnltt fetch failed', { ticker, err: String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
