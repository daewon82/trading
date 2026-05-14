export interface DailyFlow {
  date: string;
  close: number | null;
  changePercent: number | null;
  volume: number | null;
  /** 양수=순매수, 음수=순매도 (단위: 주) */
  institutionalNet: number | null;
  /** 양수=순매수, 음수=순매도 (단위: 주) */
  foreignerNet: number | null;
  /** 양수=순매수, 음수=순매도 (단위: 원). 종가×순매수주식수로 추정. */
  institutionalNetValue: number | null;
  /** 양수=순매수, 음수=순매도 (단위: 원). 종가×순매수주식수로 추정. */
  foreignerNetValue: number | null;
  foreignerHoldingRatio: number | null;
}

export interface FlowSummary {
  code: string;
  daily: DailyFlow[];
  /** 5거래일 누적 순매수 (양수=순매수, 음수=순매도) */
  net5dInstitutional: number | null;
  net5dForeigner: number | null;
  net10dInstitutional: number | null;
  net10dForeigner: number | null;
  /** 20거래일 누적 (중기 추세, 펀드매니저 표준 기간) */
  net20dInstitutional: number | null;
  net20dForeigner: number | null;
  /** 60거래일 누적 (장기 사이클) */
  net60dInstitutional: number | null;
  net60dForeigner: number | null;
  /** 거래대금(원) 누적 — Σ(일별 close × 일별 순매수주). 토스 앱 표시 단위와 비교 가능. */
  net5dInstitutionalValue: number | null;
  net5dForeignerValue: number | null;
  net10dInstitutionalValue: number | null;
  net10dForeignerValue: number | null;
  net20dInstitutionalValue: number | null;
  net20dForeignerValue: number | null;
  net60dInstitutionalValue: number | null;
  net60dForeignerValue: number | null;
  /** 당일 외인 순매수 (Toss API 실시간, 장중 갱신) */
  todayForeignerNet: number | null;
  /** 당일 기관 순매수 (Toss API 실시간, 장중 갱신) */
  todayInstitutionalNet: number | null;
  /** 당일 거래대금(원) — close × 당일 순매수주 */
  todayForeignerNetValue: number | null;
  todayInstitutionalNetValue: number | null;
  /** 현재 장 운영 중 여부 */
  todayInMarketTime: boolean;
  /** 당일 데이터 기준일 (YYYY-MM-DD) */
  todayDate: string | null;
}
