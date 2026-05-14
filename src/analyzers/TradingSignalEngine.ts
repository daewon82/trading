import type { DashboardCard } from '../types/stock.js';
import type { FlowSummary } from '../types/flow.js';
import type { IndicatorSet } from '../types/timeseries.js';
import type { ValueScore } from '../types/valuation.js';
import type { FearGreedIndex } from '../types/fear-greed.js';
import type { AnalystConsensus } from '../types/consensus.js';
import type { QualityScore } from './QualityScore.js';
import {
  ACTION_THRESHOLDS,
  type SignalAction,
  type SignalFactor,
  type TradingSignal,
} from '../types/trading-signal.js';

/**
 * 100만원·코스피 매매 시그널 엔진 (v1.3).
 *
 * 매수/매도 기여 팩터(가중합) → -100~+100 점수 → 5단계 액션.
 * 모든 팩터는 사람이 읽을 수 있는 detail 텍스트로 카드에 노출된다.
 *
 * 매수 기여(양수):
 *  +25  오늘 외인+기관 동반 순매수
 *  +20  5일 누적 동반 순매수 (오늘과 중복 가능)
 *  +15  20일 누적 동반 순매수 (중기 추세 확인)
 *  +15  💎 가치 우량 (가치 점수 ≥ 70)
 *  +10  🔍 가치 후보 (가치 점수 50~69) 또는 PBR ≤ 1.0
 *  +10  품질 등급 S/A
 *   +5  품질 등급 B
 *  +10  52주 위치 < 35% (저점 영역)
 *   +5  52주 위치 35~50% (중하단)
 *   +5  RSI 35~55 (과매도 회복 또는 중립)
 *   +5  정배열 (sma5 > sma20 > sma60)
 *
 * 매도 기여(음수) — v1.5+ 백테스트 보정: 매도 신호 적중률 31~37%로 무효 입증되어
 * 수급 기반 매도 가중치를 절반으로 약화. 가격·기술 기반 매도(고점/RSI) 유지.
 *  -12  오늘 외인+기관 동반 순매도 (이전 -25 → 백테스트 hit 36.7%, 절반)
 *   -8  5일 누적 동반 순매도 (이전 -20)
 *   -6  20일 누적 동반 순매도 (이전 -15)
 *  -15  52주 위치 > 90% (고점 영역) — 유지
 *  -10  52주 위치 75~90% — 유지
 *  -10  RSI > 75 (과매수) — 유지
 *  -10  품질 등급 D — 유지
 *   -5  데드크로스 (sma5 < sma20 < sma60) — 유지
 *
 * 시장 regime 보너스 (v1.4 — 머신러너 방법론):
 *   +5  공포탐욕 ≤ 24 (극도의 공포) — 시장 전반 매수 기회
 *   +3  공포탐욕 25~44 (공포)
 *   -3  공포탐욕 55~74 (탐욕)
 *   -5  공포탐욕 ≥ 75 (극도의 탐욕) — 시장 전반 매도 경고
 *
 * 컨센서스 팩터 (v1.6, NaverKr.extractConsensus 기반, Yahoo 스케일 1=매수~5=매도):
 *   +8  recommendationMean ≤ 2.0 (강력 매수 컨센서스, 분석가 3+명)
 *   +4  recommendationMean ≤ 2.5 (매수 컨센서스)
 *   -4  recommendationMean ≥ 3.5 (매도 컨센서스)
 */
export class TradingSignalEngine {
  evaluate(card: DashboardCard, fearGreed: FearGreedIndex | null = null): TradingSignal {
    const s = card.snapshot;
    const factors: SignalFactor[] = [];

    this.applyFlowFactors(card.flow, factors);
    this.applyValueFactors(card.valuation ?? null, s.pbr, factors);
    this.applyQualityFactors(card.qualityScore ?? null, factors);
    this.applyPositionFactors(card.fiftyTwoWeekPosition, factors);
    this.applyTechnicalFactors(card.indicators, factors);
    this.applyFearGreedFactors(fearGreed, factors);
    this.applyConsensusFactors(card.consensus, factors);

    const raw = factors.reduce((acc, f) => acc + f.weight, 0);
    const score = clamp(Math.round(raw), -100, 100);
    const action = this.scoreToAction(score);

    return {
      code: s.code,
      name: s.name,
      pricePerShare: s.price,
      action,
      score,
      factors,
      references: {
        fiftyTwoWeekPositionPct: card.fiftyTwoWeekPosition,
        rsi: card.indicators?.rsi14 ?? null,
        fiftyTwoWeekLow: s.fiftyTwoWeekLow,
        fiftyTwoWeekHigh: s.fiftyTwoWeekHigh,
      },
      affordableSingleShare: s.price != null && s.price > 0 && s.price <= 1_000_000,
    };
  }

  private applyFlowFactors(flow: FlowSummary | null | undefined, factors: SignalFactor[]): void {
    if (!flow) return;
    const tf = flow.todayForeignerNet;
    const ti = flow.todayInstitutionalNet;
    if (tf != null && ti != null) {
      if (tf > 0 && ti > 0) {
        factors.push({ category: '수급', weight: 25, status: 'positive',
          detail: `오늘 외인+기관 동반 순매수${flow.todayInMarketTime ? ' (장중)' : ''}` });
      } else if (tf < 0 && ti < 0) {
        // v1.5+ 보정: 백테스트 hit rate 36.7% — 매도 가중치 절반(-25→-12)
        factors.push({ category: '수급', weight: -12, status: 'negative',
          detail: `오늘 외인+기관 동반 순매도${flow.todayInMarketTime ? ' (장중)' : ''} — 평균회귀 가능성` });
      }
    }
    const f5 = flow.net5dForeigner;
    const i5 = flow.net5dInstitutional;
    if (f5 != null && i5 != null) {
      if (f5 > 0 && i5 > 0)
        factors.push({ category: '수급', weight: 20, status: 'positive', detail: '5일 누적 외인+기관 동반 매수' });
      else if (f5 < 0 && i5 < 0)
        // v1.5+ 보정: hit rate 37.4% (이전 -20 → -8)
        factors.push({ category: '수급', weight: -8, status: 'negative', detail: '5일 누적 외인+기관 동반 매도 — 평균회귀 가능성' });
    }
    const f20 = flow.net20dForeigner;
    const i20 = flow.net20dInstitutional;
    if (f20 != null && i20 != null) {
      if (f20 > 0 && i20 > 0)
        factors.push({ category: '수급', weight: 15, status: 'positive', detail: '20일 누적 외인+기관 동반 매수 (중기)' });
      else if (f20 < 0 && i20 < 0)
        // v1.5+ 보정: hit rate 33.6% (이전 -15 → -6)
        factors.push({ category: '수급', weight: -6, status: 'negative', detail: '20일 누적 외인+기관 동반 매도 (중기) — 평균회귀 가능성' });
    }
  }

  private applyValueFactors(
    valuation: ValueScore | null,
    pbr: number | null,
    factors: SignalFactor[],
  ): void {
    if (valuation) {
      if (valuation.total >= 70)
        factors.push({ category: '가치', weight: 15, status: 'positive', detail: `💎 가치 우량 (${valuation.total}점)` });
      else if (valuation.total >= 50)
        factors.push({ category: '가치', weight: 10, status: 'positive', detail: `🔍 가치 후보 (${valuation.total}점)` });
    } else if (pbr != null && pbr > 0 && pbr <= 1.0) {
      factors.push({ category: '가치', weight: 10, status: 'positive', detail: `저PBR ${pbr.toFixed(2)} (≤1.0)` });
    }
  }

  private applyQualityFactors(qs: QualityScore | null, factors: SignalFactor[]): void {
    if (!qs) return;
    if (qs.grade === 'S' || qs.grade === 'A')
      factors.push({ category: '품질', weight: 10, status: 'positive', detail: `품질 ${qs.grade} 등급 (${qs.total}/100)` });
    else if (qs.grade === 'B')
      factors.push({ category: '품질', weight: 5, status: 'positive', detail: `품질 B 등급 (${qs.total}/100)` });
    else if (qs.grade === 'D')
      factors.push({ category: '품질', weight: -10, status: 'negative', detail: `품질 D 등급 (${qs.total}/100) — 펀더멘털 취약` });
  }

  private applyPositionFactors(position: number | null, factors: SignalFactor[]): void {
    if (position == null) return;
    if (position < 35)
      factors.push({ category: '52주', weight: 10, status: 'positive', detail: `52주 저점 영역 (${position.toFixed(0)}%)` });
    else if (position < 50)
      factors.push({ category: '52주', weight: 5, status: 'positive', detail: `52주 중하단 (${position.toFixed(0)}%)` });
    else if (position > 90)
      factors.push({ category: '52주', weight: -15, status: 'negative', detail: `52주 고점 영역 (${position.toFixed(0)}%) — 추격 매수 위험` });
    else if (position > 75)
      factors.push({ category: '52주', weight: -10, status: 'negative', detail: `52주 상단 (${position.toFixed(0)}%)` });
  }

  private applyTechnicalFactors(ind: IndicatorSet | null | undefined, factors: SignalFactor[]): void {
    if (!ind) return;
    const rsi = ind.rsi14;
    if (rsi != null) {
      if (rsi >= 35 && rsi <= 55)
        factors.push({ category: '기술', weight: 5, status: 'positive', detail: `RSI ${rsi.toFixed(0)} — 과매도 회복/중립` });
      else if (rsi > 75)
        factors.push({ category: '기술', weight: -10, status: 'negative', detail: `RSI ${rsi.toFixed(0)} — 과매수 영역` });
    }
    const m5 = ind.sma5, m20 = ind.sma20, m60 = ind.sma60;
    if (m5 != null && m20 != null && m60 != null) {
      if (m5 > m20 && m20 > m60)
        factors.push({ category: '기술', weight: 5, status: 'positive', detail: '정배열 (5일>20일>60일 이평선)' });
      else if (m5 < m20 && m20 < m60)
        factors.push({ category: '기술', weight: -5, status: 'negative', detail: '역배열 (5일<20일<60일 이평선)' });
    }
  }

  /**
   * 시장 regime 보정 — 모든 종목에 동일하게 적용.
   * 극도공포 = 일률 매수 기회 보너스, 극도탐욕 = 일률 페널티.
   * 머신러너 작가가 강조한 "차트 대신 공포탐욕지수" 컨셉.
   */
  private applyFearGreedFactors(fg: FearGreedIndex | null, factors: SignalFactor[]): void {
    if (!fg) return;
    if (fg.zone === 'extreme_fear')
      factors.push({ category: '52주', weight: 5, status: 'positive',
        detail: `시장 극도의 공포 (F&G ${fg.value}) — 매수 우호` });
    else if (fg.zone === 'fear')
      factors.push({ category: '52주', weight: 3, status: 'positive',
        detail: `시장 공포 (F&G ${fg.value}) — 매수 우호` });
    else if (fg.zone === 'greed')
      factors.push({ category: '52주', weight: -3, status: 'negative',
        detail: `시장 탐욕 (F&G ${fg.value}) — 추격 매수 주의` });
    else if (fg.zone === 'extreme_greed')
      factors.push({ category: '52주', weight: -5, status: 'negative',
        detail: `시장 극도의 탐욕 (F&G ${fg.value}) — 차익 실현 영역` });
  }

  /**
   * v1.6 — 애널리스트 컨센서스 통합.
   * NaverKr 페이지의 "투자의견" → Yahoo 스케일(1=매수, 5=매도)로 변환된 값 사용.
   * 분석가가 합의된 매수/매도 의견은 보조 신호로 가산.
   */
  private applyConsensusFactors(cons: AnalystConsensus | null | undefined, factors: SignalFactor[]): void {
    if (!cons || cons.recommendationMean == null) return;
    const m = cons.recommendationMean;
    const label = cons.recommendationKey || '';
    if (m <= 2.0)
      factors.push({ category: '품질', weight: 8, status: 'positive',
        detail: `애널리스트 강력 매수 (${m.toFixed(2)}/5${label ? ` ${label}` : ''})` });
    else if (m <= 2.5)
      factors.push({ category: '품질', weight: 4, status: 'positive',
        detail: `애널리스트 매수 (${m.toFixed(2)}/5${label ? ` ${label}` : ''})` });
    else if (m >= 3.5)
      factors.push({ category: '품질', weight: -4, status: 'negative',
        detail: `애널리스트 매도/중립 (${m.toFixed(2)}/5${label ? ` ${label}` : ''})` });
  }

  private scoreToAction(score: number): SignalAction {
    if (score >= ACTION_THRESHOLDS.strongBuy) return 'STRONG_BUY';
    if (score >= ACTION_THRESHOLDS.buy) return 'BUY';
    if (score <= ACTION_THRESHOLDS.strongSell) return 'STRONG_SELL';
    if (score <= ACTION_THRESHOLDS.sell) return 'SELL';
    return 'HOLD';
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
