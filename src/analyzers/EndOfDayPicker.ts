import type { VolumeRankRow } from '../sources/naver-kr/NaverVolumeRankSource.js';
import type { FlowSummary } from '../types/flow.js';

/**
 * v1.7 — 돌팬티 종가매매 룰 기반 매수 추천 엔진.
 *
 * 출처: 트레이더 돌팬티(YouTube) — 종가매매(종가베팅) 노하우 영상 시리즈.
 *
 * 핵심 룰 (공개 인터뷰·기법 정리 기반):
 *  1) 오후장 거래대금/거래량 상위 = 시장 인기 종목 (돈이 몰리는 곳)
 *  2) 당일 외인+기관 매수 우위 (수급)
 *  3) 양봉 형성 (시가 < 종가). 강한 양봉일수록 모멘텀 강함
 *  4) 평소 대비 거래량 급증 (1.5~2배+) — 세력 매집 신호
 *  5) 52주 추세 강세 구간 (저점 회피, 신고가 근접 종목 선호)
 *  6) 종가 동시호가 매수 → 다음날 시초가 익절(+1~2%) / 갭하락 시 손절
 *
 * 본 엔진은 일간 종가 기준 단순 점수화 (실시간 검색 아님).
 * 다음 거래일 시초가 진입을 위한 "오늘 종가 매수 후보" 산출.
 *
 * ⚠️ 매수가·손절가·익절가 단정 추천 금지(CLAUDE.md §10).
 *    본 엔진은 점수와 근거만 제공하며 진입가는 사용자 판단.
 */

export type EodRecommendation = '🔥 강력 추천' | '⚡ 추천' | '💡 관망' | '미추천';

export interface EodFactor {
  category: '거래대금' | '수급' | '거래량' | '캔들' | '52주';
  weight: number;
  detail: string;
}

export interface EndOfDayPick {
  rank: number;            // 거래량 순위 (1~10)
  code: string;
  name: string;
  price: number;
  changePct: number | null;
  tradingValue: number;    // 원 단위
  volume: number;
  volumeRatio: number | null; // 오늘 / 20일 평균 거래량
  fiftyTwoWeekPositionPct: number | null;
  todayForeignerNet: number | null;
  todayInstitutionalNet: number | null;
  totalScore: number;      // 0~100
  recommendation: EodRecommendation;
  factors: EodFactor[];
}

export interface EodContext {
  /** code → 종가 시계열 (최신이 마지막). 거래량 비율 계산에 미사용 — volumeMap 별도 */
  closesMap: Map<string, number[]>;
  /** code → 20일 평균 거래량. 없으면 ratio 미산정 */
  avgVolume20Map: Map<string, number>;
  /** code → 52주 (high, low) */
  range52Map: Map<string, { high: number | null; low: number | null }>;
  /** code → Toss flow 요약 */
  flowMap: Map<string, FlowSummary>;
}

/**
 * 거래량 Top N 중 ETF/ETN 제외 후 종가매매 점수 산출.
 * 점수 기준 (총 100점):
 *   A. 거래대금 순위 30점 (1위=30, 10위=3)
 *   B. 외인+기관 수급 25점 (둘 다 매수=25, 한쪽=10, 둘 다 매도=-5)
 *   C. 거래량 급증 20점 (≥2.0=20, ≥1.5=12, ≥1.2=6)
 *   D. 양봉(등락률) 15점 (≥+3%=15, +1~3%=10, 0~+1%=5, 음봉=0)
 *   E. 52주 위치 10점 (70~90%=10, 50~70%=5, ≥90%=3, <50%=0)
 */
export class EndOfDayPicker {
  pick(volumeRanks: VolumeRankRow[], ctx: EodContext, topN = 10): EndOfDayPick[] {
    const nonEtf = volumeRanks.filter((r) => !r.isLikelyEtf).slice(0, topN);
    const picks: EndOfDayPick[] = [];
    for (const r of nonEtf) {
      const flow = ctx.flowMap.get(r.code) ?? null;
      const closes = ctx.closesMap.get(r.code) ?? null;
      const range = ctx.range52Map.get(r.code) ?? null;
      const avg20 = ctx.avgVolume20Map.get(r.code) ?? null;
      const factors: EodFactor[] = [];

      // A. 거래대금 순위 (Top N 내 순위 기반)
      const aWeight = Math.max(3, 33 - r.rank * 3);
      factors.push({
        category: '거래대금', weight: aWeight,
        detail: `거래량 순위 ${r.rank}위 · 거래대금 ${formatKrw(r.tradingValue)}`,
      });

      // B. 수급 — 외인+기관 당일 순매수
      if (flow && flow.todayForeignerNet != null && flow.todayInstitutionalNet != null) {
        const tf = flow.todayForeignerNet;
        const ti = flow.todayInstitutionalNet;
        if (tf > 0 && ti > 0)
          factors.push({ category: '수급', weight: 25,
            detail: `오늘 외인+기관 동반 순매수${flow.todayInMarketTime ? ' (장중)' : ''}` });
        else if (tf > 0 || ti > 0)
          factors.push({ category: '수급', weight: 10,
            detail: `오늘 ${tf > 0 ? '외인' : '기관'} 순매수${flow.todayInMarketTime ? ' (장중)' : ''}` });
        else if (tf < 0 && ti < 0)
          factors.push({ category: '수급', weight: -5,
            detail: `오늘 외인+기관 동반 순매도 — 종가 베팅 부적합` });
      }

      // C. 거래량 급증
      let volumeRatio: number | null = null;
      if (avg20 != null && avg20 > 0) {
        volumeRatio = r.volume / avg20;
        if (volumeRatio >= 2.0)
          factors.push({ category: '거래량', weight: 20,
            detail: `거래량 평소 ${volumeRatio.toFixed(1)}× — 세력 매집 가능성` });
        else if (volumeRatio >= 1.5)
          factors.push({ category: '거래량', weight: 12,
            detail: `거래량 평소 ${volumeRatio.toFixed(1)}× — 관심 증가` });
        else if (volumeRatio >= 1.2)
          factors.push({ category: '거래량', weight: 6,
            detail: `거래량 평소 ${volumeRatio.toFixed(1)}×` });
      }

      // D. 양봉
      const ch = r.changePct;
      if (ch != null) {
        if (ch >= 3)
          factors.push({ category: '캔들', weight: 15,
            detail: `강한 양봉 +${ch.toFixed(2)}% — 모멘텀 강` });
        else if (ch >= 1)
          factors.push({ category: '캔들', weight: 10,
            detail: `양봉 +${ch.toFixed(2)}%` });
        else if (ch >= 0)
          factors.push({ category: '캔들', weight: 5,
            detail: `약한 양봉 +${ch.toFixed(2)}%` });
        // 음봉은 가산 없음 (페널티도 아님 — 거래량 동반 음봉도 매집 가능)
      }

      // E. 52주 위치
      let position52w: number | null = null;
      if (range && range.high != null && range.low != null && range.high > range.low) {
        position52w = ((r.price - range.low) / (range.high - range.low)) * 100;
        if (position52w >= 70 && position52w < 90)
          factors.push({ category: '52주', weight: 10,
            detail: `52주 ${position52w.toFixed(0)}% — 강세 추세 (신고가 근접)` });
        else if (position52w >= 50 && position52w < 70)
          factors.push({ category: '52주', weight: 5,
            detail: `52주 ${position52w.toFixed(0)}% — 중상단` });
        else if (position52w >= 90)
          factors.push({ category: '52주', weight: 3,
            detail: `52주 ${position52w.toFixed(0)}% — 고점 영역 (갭 부담)` });
        // <50%는 가산 없음 (모멘텀 부족)
      }

      const totalScore = clamp(factors.reduce((a, f) => a + f.weight, 0), 0, 100);
      const recommendation: EodRecommendation =
        totalScore >= 70 ? '🔥 강력 추천'
        : totalScore >= 50 ? '⚡ 추천'
        : totalScore >= 30 ? '💡 관망'
        : '미추천';

      picks.push({
        rank: r.rank,
        code: r.code,
        name: r.name,
        price: r.price,
        changePct: r.changePct,
        tradingValue: r.tradingValue,
        volume: r.volume,
        volumeRatio,
        fiftyTwoWeekPositionPct: position52w,
        todayForeignerNet: flow?.todayForeignerNet ?? null,
        todayInstitutionalNet: flow?.todayInstitutionalNet ?? null,
        totalScore,
        recommendation,
        factors,
      });
      void closes; // closes는 향후 캔들 패턴(K1 장대양봉+단봉) 검출용 — 현재 미사용
    }
    // 추천 점수 높은 순으로 정렬
    picks.sort((a, b) => b.totalScore - a.totalScore);
    return picks;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function formatKrw(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}만`;
  return String(v);
}
