export interface AnalystTrend {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface AnalystConsensus {
  ticker: string;
  recommendationKey: string | null;
  /** 1.0 = strong buy, 5.0 = strong sell */
  recommendationMean: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  numberOfAnalystOpinions: number | null;
  trend: AnalystTrend | null;
}
