import type { TradingSignal } from '../types/trading-signal.js';
import type { PositionPnL } from '../types/portfolio.js';
import type { StructuralRiskResult } from '../types/structural-risk.js';
import type { MarketStructureResult } from '../types/market-structure.js';
import type {
  HoldingAction,
  HoldingStrategyResult,
  StrategyFactor,
} from '../types/holding-strategy.js';

/**
 * v1.9 — 보유 종목 대응 전략 분석기.
 *
 * TradingSignal + 손익률 + 52주 위치 + 구조 리스크 + 시장 구조를 종합해
 * 사용자가 즉시 행동할 수 있는 액션(BUY_MORE / HOLD / SELL)을 제시.
 *
 * 결정 로직 (action_score 계산):
 *   - 시그널 점수 그대로 사용 (베이스)
 *   - 손익률 가산:
 *       -10% 이상 손실 + 시그널 점수 > 0  → +10 (저점 매수 기회)
 *       +20% 이상 수익                    → -10 (차익 실현 검토)
 *   - 52주 위치:
 *       < 35% (저점) + 시그널 > 0         → +5
 *       > 85% (고점)                       → -5
 *   - 시장 구조 ADR concentrated:
 *       모든 보유 종목 action_score -10 (쏠림 장세에서 추가 매수 신중)
 *
 * 임계값:
 *   action_score >= 25  → BUY_MORE
 *   action_score >= -25 → HOLD
 *   action_score <  -25 → SELL
 */

const BUY_MORE_THRESHOLD = 25;
const SELL_THRESHOLD = -25;

export class HoldingStrategyAnalyzer {
  analyze(
    signal: TradingSignal,
    pnl: PositionPnL | null,
    fiftyTwoWeekPosition: number | null,
    structuralRisk: StructuralRiskResult | null,
    marketStructure: MarketStructureResult | null,
  ): HoldingStrategyResult {
    const reasons: StrategyFactor[] = [];
    let actionScore = signal.score;

    // 베이스 시그널 근거 — 가장 영향 큰 팩터 3개 추출
    const topFactors = [...signal.factors]
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, 3);
    for (const f of topFactors) {
      reasons.push({
        detail: f.detail,
        weight: f.weight,
        icon: f.weight > 0 ? '➕' : f.weight < 0 ? '➖' : '·',
      });
    }

    // 손익률 보정
    const pnlPct = pnl?.pnlPct ?? null;
    if (pnlPct != null) {
      if (pnlPct <= -10 && signal.score > 0) {
        const bonus = 10;
        actionScore += bonus;
        reasons.push({
          detail: `손실 ${pnlPct.toFixed(1)}% + 매수 신호 → 저점 추가 매수 기회`,
          weight: bonus,
          icon: '💰',
        });
      } else if (pnlPct >= 20) {
        const penalty = -10;
        actionScore += penalty;
        reasons.push({
          detail: `수익 +${pnlPct.toFixed(1)}% — 부분 차익 실현 검토`,
          weight: penalty,
          icon: '🏆',
        });
      }
    }

    // 52주 위치 보정
    if (fiftyTwoWeekPosition != null) {
      if (fiftyTwoWeekPosition < 35 && signal.score > 0) {
        actionScore += 5;
        reasons.push({
          detail: `52주 저점권 ${fiftyTwoWeekPosition.toFixed(0)}% — 진입 우호`,
          weight: 5,
          icon: '📉',
        });
      } else if (fiftyTwoWeekPosition > 85) {
        actionScore -= 5;
        reasons.push({
          detail: `52주 고점권 ${fiftyTwoWeekPosition.toFixed(0)}% — 추가 매수 신중`,
          weight: -5,
          icon: '📈',
        });
      }
    }

    // 구조 리스크 별도 강조
    if (structuralRisk && structuralRisk.riskLevel === 'high') {
      actionScore -= 5; // 이미 시그널에 -15 반영됐지만 한 번 더 강조
      reasons.push({
        detail: `🔴 구조 리스크 HIGH — ${structuralRisk.warning ?? structuralRisk.riskTag}`,
        weight: -5,
        icon: '⚠️',
      });
    }

    // 시장 구조 보정 — 쏠림 장세에선 BUY_MORE 신중
    if (marketStructure && marketStructure.breadth === 'concentrated') {
      actionScore -= 10;
      reasons.push({
        detail: `시장 쏠림 ADR ${marketStructure.adrPct.toFixed(0)}% — 추가 매수 신중`,
        weight: -10,
        icon: '📊',
      });
    } else if (marketStructure && marketStructure.breadth === 'narrow') {
      actionScore -= 5;
      reasons.push({
        detail: `시장 쏠림 시작 ADR ${marketStructure.adrPct.toFixed(0)}% — 신규 매수 신중`,
        weight: -5,
        icon: '📊',
      });
    }

    const action: HoldingAction =
      actionScore >= BUY_MORE_THRESHOLD ? 'BUY_MORE'
      : actionScore > SELL_THRESHOLD ? 'HOLD'
      : 'SELL';
    const confidence = clamp(Math.abs(actionScore) * 2, 0, 100);

    return {
      code: signal.code,
      name: signal.name,
      action,
      confidence,
      reasons: reasons.slice(0, 5),
      pnlPct,
      currentPrice: pnl?.currentPrice ?? signal.pricePerShare,
      fiftyTwoWeekPositionPct: fiftyTwoWeekPosition,
      signalScore: signal.score,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
