export interface MacroQuote {
  symbol: string;
  name: string;
  value: number | null;
  previousClose: number | null;
  changePercent: number | null;
  unit: string;
}
