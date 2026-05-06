export type SectionKey = 'KR' | 'US' | 'Value';

export interface SeedSnapshot {
  code: string;
  name: string;
  section: SectionKey;
  dominantLabel: string;
  reasoning: string;
}

export interface ChangelogMeta {
  date: string;
  generatedAt: string;
  seeds: SeedSnapshot[];
}

export interface ChangelogEntry {
  fromDate: string | null;
  toDate: string;
  added: Array<{
    code: string;
    name: string;
    section: SectionKey;
    currentDominant: string;
    currentReasoning: string;
  }>;
  removed: Array<{
    code: string;
    name: string;
    section: SectionKey;
    lastDominant: string;
    lastReasoning: string;
  }>;
}
