export interface StockConfig {
  code: string;
  name: string;
  positionNote: string;
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  atr20: number;
  donchianHigh20: number;
  donchianLow10: number;
  ma60: number;
  ma120: number;
  prevClose: number;
  lastClose: number;
  lastDate: string;
  change: number;
  changePct: number;
  volume: number;
  avgVolume20: number;
}

export type TurtleAction =
  | 'ENTRY_BREAKOUT'
  | 'HOLD'
  | 'EXIT_10D_LOW'
  | 'STOP_LOSS'
  | 'PYRAMID'
  | 'WAIT';

export interface TurtleSignal {
  action: TurtleAction;
  reason: string;
  unitSize: number;
  unitCost: number;
  stopPrice: number | null;
  nextPyramidPrice: number | null;
  distanceToEntryPct: number;
  distanceToStopPct: number | null;
  distanceToExitPct: number;
}

export type ProtocolStatus = 'KEEP' | 'WATCH' | 'DELETE_CANDIDATE';

export interface ProtocolCheck {
  status: ProtocolStatus;
  passed: string[];
  failed: string[];
  notes: string[];
}

export interface HoldingPosition {
  code: string;
  name: string;
  buyPrice: number;
  quantity: number;
  buyDate: string;
}

export interface HoldingState {
  position: HoldingPosition;
  currentValue: number;
  costBasis: number;
  pnl: number;
  pnlPct: number;
  stopPrice: number;
  stoppedOut: boolean;
  nextPyramidPrice: number;
  pyramidReady: boolean;
  exitTrigger10dLow: boolean;
}

export interface StockReport {
  config: StockConfig;
  indicators: Indicators;
  signal: TurtleSignal;
  protocol: ProtocolCheck;
  holding: HoldingState | null;
  history: Candle[];
}

export interface ScanCandidate {
  code: string;
  name: string;
}

export interface ScanCandidateResult {
  code: string;
  name: string;
  lastClose: number;
  donchianHigh20: number;
  atr20: number;
  ma60: number;
  ma120: number;
  distancePct: number;
  breakoutPassed: boolean;
  ma60Passed: boolean;
  ma120Passed: boolean;
  alignmentPassed: boolean;
  tier: 'A' | 'B' | 'none';
  unitSize: number;
  error?: string;
}

export interface DashboardData {
  generatedAt: string;
  totalCapital: number;
  riskPerTrade: number;
  asOfDate: string | null;
  isLive: boolean;
  reports: StockReport[];
  scanCandidates: ScanCandidateResult[];
  errors: { code: string; name: string; message: string }[];
}
