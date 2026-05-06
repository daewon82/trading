#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StockComparator } from '../src/analyzers/StockComparator.js';
import { HtmlReporter } from '../src/reporters/HtmlReporter.js';
import type { StockSnapshot } from '../src/types/stock.js';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    process.stderr.write(
      'Usage: npm run report:generate -- <path-to-snapshots.json>\n',
    );
    process.exit(2);
  }
  const inputPath = resolve(process.cwd(), arg);
  const raw = await readFile(inputPath, 'utf8');
  const data: unknown = JSON.parse(raw);

  const snapshots: StockSnapshot[] = Array.isArray(data)
    ? (data as StockSnapshot[])
    : ((data as { snapshots?: StockSnapshot[] }).snapshots ?? []);

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    throw new Error(
      'Input must be StockSnapshot[] or { snapshots: StockSnapshot[] } and non-empty',
    );
  }

  const report = new StockComparator().compare(snapshots);
  const out = inputPath.replace(/\.json$/i, '.html');
  await new HtmlReporter().write(report, out);
  logger.info('report generated', { input: inputPath, output: out });
}

main().catch((err) => {
  process.stderr.write(`generate-report failed: ${String(err)}\n`);
  process.exit(1);
});
