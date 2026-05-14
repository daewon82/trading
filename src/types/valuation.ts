/**
 * 코스피 가치주 스크리너 도메인 모델 (v1.1).
 * claude.md §4.5 참조.
 */

export type SectorTag =
  | '반도체'
  | '자동차'
  | '조선'
  | '방산'
  | '은행/금융'
  | '통신'
  | '전자'
  | '에너지'
  | '기타';

export interface ValuationMetrics {
  code: string;
  name: string;
  pbr: number | null;
  per: number | null;
  /** 단위: % */
  roe: number | null;
  /** 단위: 원 (KRW). NaverKr 어댑터에서 '억' 단위로 반환되므로 변환 필요 */
  marketCap: number | null;
  sector: SectorTag;
}

export interface ValueScoreBreakdown {
  /** PBR 점수 — (1-PBR)×20, 0~20 */
  pbr: number;
  /** PER 점수 — (15-PER)/15×20, 0~20 */
  per: number;
  /** ROE 점수 — min(ROE/20,1)×20, 0~20 */
  roe: number;
  /** 외인 20일 누적 순매수 점수 — log 스케일 정규화 0~20 */
  foreignerFlow: number;
  /** 기관 20일 누적 순매수 점수 — log 스케일 정규화 0~20 */
  institutionalFlow: number;
  /** 주도 섹터 보너스 — 0 또는 5 (반도체·조선·방산·은행/금융) */
  sectorBonus: number;
}

export type ValueBadge = '가치 우량' | '가치 후보' | null;

export interface ValueScore {
  code: string;
  name: string;
  sector: SectorTag;
  /** 0~100 (실효 상한 105, 최종 round/clamp) */
  total: number;
  badge: ValueBadge;
  breakdown: ValueScoreBreakdown;
  /** 입력 지표 (디버깅·툴팁용 원본 값) */
  metrics: ValuationMetrics;
}

/** 가치주 스크리닝 임계값 — claude.md §4.5 */
export const VALUE_THRESHOLDS = {
  pbrMax: 1.0,
  perMax: 15,
  roeMin: 8,
  /** 단위: 원. 5,000억원 */
  marketCapMin: 500_000_000_000,
} as const;

/** 주도 섹터 (2026년 시장 컨텍스트, claude.md §14) — 변경 시 ValueScreener 입력 */
export const LEAD_SECTORS: readonly SectorTag[] = [
  '반도체',
  '조선',
  '방산',
  '은행/금융',
];

/**
 * 대시보드에서 사용하는 KR 코드 → 섹터 매핑.
 * 페이지에서 섹터 정보를 얻을 수 없으므로 정적 매핑이 필요. 없는 코드는 '기타'.
 */
export const KR_SECTOR_MAP: Record<string, SectorTag> = {
  // 반도체
  '005930': '반도체', '000660': '반도체',
  // 자동차
  '005380': '자동차', '000270': '자동차', '012330': '자동차', '161390': '자동차',
  // 조선
  '009540': '조선', '010140': '조선',
  // 방산
  '012450': '방산', '047810': '방산',
  // 은행/금융
  '105560': '은행/금융', '055550': '은행/금융', '086790': '은행/금융',
  '316140': '은행/금융', '024110': '은행/금융', '032830': '은행/금융',
  '000810': '은행/금융', '138040': '은행/금융', '029780': '은행/금융',
  '006800': '은행/금융', '071050': '은행/금융',
  // 통신
  '017670': '통신', '030200': '통신', '032640': '통신',
  // 전자
  '066570': '전자', '009150': '전자', '034220': '전자',
  // 에너지
  '015760': '에너지', '096770': '에너지', '010950': '에너지',
};

/**
 * 기본 스크리닝 유니버스 (claude.md §4.5).
 * `VALUE_UNIVERSE` 환경변수가 비어 있을 때 사용.
 */
export const DEFAULT_VALUE_UNIVERSE: ReadonlyArray<{
  code: string;
  name: string;
  sector: SectorTag;
}> = [
  // 반도체
  { code: '005930', name: '삼성전자', sector: '반도체' },
  { code: '000660', name: 'SK하이닉스', sector: '반도체' },
  // 자동차
  { code: '005380', name: '현대차', sector: '자동차' },
  { code: '000270', name: '기아', sector: '자동차' },
  // 조선
  { code: '009540', name: 'HD한국조선해양', sector: '조선' },
  { code: '010140', name: '삼성중공업', sector: '조선' },
  // 은행/금융
  { code: '105560', name: 'KB금융', sector: '은행/금융' },
  { code: '055550', name: '신한지주', sector: '은행/금융' },
  { code: '086790', name: '하나금융지주', sector: '은행/금융' },
  // 통신
  { code: '017670', name: 'SK텔레콤', sector: '통신' },
  { code: '030200', name: 'KT', sector: '통신' },
  // 전자
  { code: '066570', name: 'LG전자', sector: '전자' },
  { code: '009150', name: '삼성전기', sector: '전자' },
  // 방산
  { code: '012450', name: '한화에어로스페이스', sector: '방산' },
  { code: '047810', name: '한국항공우주', sector: '방산' },
  // 에너지
  { code: '015760', name: '한국전력', sector: '에너지' },
];
