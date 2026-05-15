import type {
  StructuralRiskLevel,
  StructuralRiskResult,
} from '../types/structural-risk.js';

/**
 * v1.7 — 섹터 구조 리스크 필터 (CLAUDE.md §4.7).
 *
 * 종목 코드 → 산업 구조적 리스크 등급 → 시그널 점수 보정.
 *
 * 등급 체계:
 *   🔴 high    -15  (구조적 매출 감소 가능성, 정량 신호로 잡히지 않음)
 *   🟠 medium  -10  (회복 모멘텀 불확실)
 *   🟡 low      -5  (성장 정체, 배당 목적 보유 적합)
 *   🟢 positive +5  (슈퍼사이클·정책 모멘텀)
 *   ⚪ neutral   0  (분류 없음)
 *
 * ⚠️ 종목 코드 하드코딩 — 신규 종목 추가 시 이 파일과 CLAUDE.md §4.7 표를 함께 갱신.
 */

interface RiskEntry {
  codes: ReadonlySet<string>;
  sector: string;
  riskLevel: StructuralRiskLevel;
  riskTag: string;
  warning?: string;
}

const RISK_TABLE: RiskEntry[] = [
  {
    codes: new Set(['139480', '023530']), // 이마트, 롯데쇼핑
    sector: '온라인 유통 경쟁 취약',
    riskLevel: 'high',
    riskTag: '온라인 경쟁 취약',
    warning: '쿠팡·알리 경쟁 심화로 오프라인 유통 구조적 매출 감소 가능성',
  },
  {
    codes: new Set(['008770', '004170']), // 호텔신라, 신세계
    sector: '면세·호텔',
    riskLevel: 'medium',
    riskTag: '면세업 회복 더딤',
    warning: '중국 단체관광 회복 지연 · 면세업 경쟁 심화',
  },
  {
    codes: new Set(['017670', '030200']), // SK텔레콤, KT
    sector: '성숙기 통신',
    riskLevel: 'low',
    riskTag: '성장 정체',
    warning: '성장 정체 — 배당 목적 보유에 적합. 신규 매수 모멘텀 약함',
  },
  {
    codes: new Set([
      '009540', // HD한국조선해양
      '272210', // 한화시스템
      '012450', // 한화에어로스페이스
      '047810', // 한국항공우주 (KAI)
    ]),
    sector: '조선·방산',
    riskLevel: 'positive',
    riskTag: '성장 섹터',
    warning: '조선 슈퍼사이클 · K-방산 수출 모멘텀',
  },
  {
    codes: new Set(['005930', '000660']), // 삼성전자, SK하이닉스
    sector: '반도체',
    riskLevel: 'positive',
    riskTag: '성장 섹터',
    warning: 'AI 수요 폭발 · HBM 공급 부족 · 실적 성장 사이클',
  },
];

const ADJUSTMENT_BY_LEVEL: Record<StructuralRiskLevel, number> = {
  high: -15,
  medium: -10,
  low: -5,
  positive: +5,
  neutral: 0,
};

export class StructuralRiskFilter {
  /** 코드 → 구조 리스크 결과. 분류 없는 종목은 neutral. */
  assess(code: string): StructuralRiskResult {
    for (const entry of RISK_TABLE) {
      if (entry.codes.has(code)) {
        return {
          code,
          sector: entry.sector,
          riskLevel: entry.riskLevel,
          riskTag: entry.riskTag,
          scoreAdjustment: ADJUSTMENT_BY_LEVEL[entry.riskLevel],
          warning: entry.warning,
        };
      }
    }
    return {
      code,
      sector: '기타',
      riskLevel: 'neutral',
      riskTag: '',
      scoreAdjustment: 0,
    };
  }

  /** 점수에 보정 적용 — TradingSignalEngine 외부에서 후처리 시 사용. */
  applyToSignalScore(score: number, code: string): number {
    return score + this.assess(code).scoreAdjustment;
  }
}
