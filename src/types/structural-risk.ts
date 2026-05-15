/**
 * v1.7 — 섹터 구조 리스크 도메인 모델 (CLAUDE.md §4.7).
 *
 * 정량 데이터(PBR·PER·수급)만으론 산업 구조 변화·경쟁 심화 같은
 * 정성적 리스크가 안 잡혀서 추가. 예: 이마트 저PBR + 외인 매수 신호 →
 * 온라인 커머스 경쟁 심화로 주가 부진 → 시그널 점수에 -15점 보정 필요.
 */

export type StructuralRiskLevel = 'high' | 'medium' | 'low' | 'positive' | 'neutral';

export interface StructuralRiskResult {
  code: string;
  /** "온라인 유통", "면세·호텔", "성숙기 통신" 등 카테고리 라벨 */
  sector: string;
  riskLevel: StructuralRiskLevel;
  /** 표시용 짧은 태그 (예: "온라인 경쟁 취약") */
  riskTag: string;
  /** 시그널 점수 보정값 (HIGH=-15, MEDIUM=-10, LOW=-5, POSITIVE=+5, NEUTRAL=0) */
  scoreAdjustment: number;
  /** 사용자에게 표시되는 경고/긍정 문구 */
  warning?: string;
}
