export interface DailyFlow {
  date: string;
  close: number | null;
  changePercent: number | null;
  volume: number | null;
  /** 양수=순매수, 음수=순매도 (단위: 주) */
  institutionalNet: number | null;
  /** 양수=순매수, 음수=순매도 (단위: 주) */
  foreignerNet: number | null;
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
  /** 거래원 정보 — 당일 외국계 추정 매도/매수 거래량 (주식 수) */
  foreignBrokerSell: number | null;
  foreignBrokerBuy: number | null;
}
