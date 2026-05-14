/**
 * 한국 코스피 공포·탐욕 지수 도메인 모델 (v1.4).
 * 머신러너 작가 방법론 차용 — fearandgreed.kr 공개 API 기반.
 *
 * 분류 (CNN Fear & Greed Index 표준):
 *  0~24  극도의 공포 (Extreme Fear)  — 매수 기회 영역
 *  25~44 공포 (Fear)
 *  45~54 중립 (Neutral)
 *  55~74 탐욕 (Greed)
 *  75~100 극도의 탐욕 (Extreme Greed) — 매도 경고 영역
 */

export type FearGreedZone =
  | 'extreme_fear'
  | 'fear'
  | 'neutral'
  | 'greed'
  | 'extreme_greed';

export interface FearGreedIndex {
  /** 0~100 */
  value: number;
  zone: FearGreedZone;
  /** 사람이 읽는 라벨 (예: "탐욕") */
  label: string;
  /** 측정 시각 (UTC ISO 또는 source 원본 timestamp) */
  capturedAt: string;
  source: 'fearandgreed.kr';
}

export function classifyZone(value: number): FearGreedZone {
  if (value <= 24) return 'extreme_fear';
  if (value <= 44) return 'fear';
  if (value <= 54) return 'neutral';
  if (value <= 74) return 'greed';
  return 'extreme_greed';
}

export function zoneLabel(zone: FearGreedZone): string {
  switch (zone) {
    case 'extreme_fear': return '극도의 공포';
    case 'fear': return '공포';
    case 'neutral': return '중립';
    case 'greed': return '탐욕';
    case 'extreme_greed': return '극도의 탐욕';
  }
}
