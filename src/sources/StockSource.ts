import type { Page } from '@playwright/test';
import type { StockSnapshot, HealthCheckResult, SourceId, Market } from '../types/stock.js';

export interface StockSource {
  readonly id: SourceId;
  readonly market: Market;

  open(page: Page, code: string): Promise<void>;
  extractSnapshot(page: Page, code: string): Promise<StockSnapshot>;
  healthCheck(page: Page, sample: string): Promise<HealthCheckResult>;
}
