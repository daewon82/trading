import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { TradingSignal } from '../types/trading-signal.js';
import type { StructuralRiskResult } from '../types/structural-risk.js';
import { logger } from '../utils/logger.js';

/**
 * v1.7 — 잔디 강력매수 알림 (CLAUDE.md §4.9).
 *
 * 조건:
 *   1) STRONG_BUY (점수 ≥ 75)
 *   2) 구조 리스크 HIGH 아님
 *   3) 52주 위치 ≤ 70% (고점 추격 아님)
 *   4) 외인+기관 5d 동반 순매수 > 0
 *
 * 보안 — 웹훅 URL은 `process.env.JANDI_WEBHOOK_URL`에서만 읽음 (코드/git 금지).
 * 환경변수 미설정 또는 JANDI_DRY_RUN=1 이면 발송 없이 로그만.
 *
 * 중복 발송 방지 — `cache/jandi-sent.json`에 (code, date) 기록 → 24시간 이내 동일 종목 차단.
 * 하루 최대 5건 · 발송 시간 09:00~15:00 KST.
 */

const CACHE_PATH = 'cache/jandi-sent.json';
const MAX_PER_DAY = 5;
const MIN_HOUR_KST = 9;
const MAX_HOUR_KST = 15;
const SCORE_THRESHOLD = 75;
const POSITION_MAX = 70;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface SentRecord {
  code: string;
  /** ISO 시각 */
  sentAt: string;
}

interface SentCache {
  records: SentRecord[];
}

export interface JandiNotifyContext {
  /** code → 5일 외인+기관 동반 매수 여부 */
  has5dBothBuy: Map<string, boolean>;
  /** code → 구조 리스크 */
  structuralRisk: Map<string, StructuralRiskResult>;
  /** code → 52주 위치 (0~100) */
  position52w: Map<string, number | null>;
  /** code → 추가 컨텍스트 텍스트 (PBR/PER/거래량 비율 등). 없으면 빈 문자열 */
  extra?: Map<string, string>;
  dashboardUrl?: string;
  /** v1.8 — 시장 구조 (ADR 등). breadth가 narrow/concentrated이면 강력매수 알림 보류 */
  marketStructure?: import('../types/market-structure.js').MarketStructureResult | null;
}

export class JandiSignalNotifier {
  private readonly webhookUrl: string;
  private readonly dryRun: boolean;

  constructor() {
    this.webhookUrl = process.env.JANDI_WEBHOOK_URL ?? '';
    this.dryRun = process.env.JANDI_DRY_RUN === '1' || !this.webhookUrl;
  }

  /**
   * 매수 후보 신호 목록에서 잔디 발송 조건 통과 종목만 발송.
   * 발송 결과 로그 출력. 실패는 throw 하지 않고 warn.
   */
  async notify(
    signals: TradingSignal[],
    ctx: JandiNotifyContext,
    now: Date = new Date(),
  ): Promise<{ sent: number; skipped: number; reasons: string[] }> {
    const reasons: string[] = [];
    const kstHour = this.kstHour(now);
    if (kstHour < MIN_HOUR_KST || kstHour > MAX_HOUR_KST) {
      logger.info('jandi notify skipped — out of trading hours', { kstHour });
      return { sent: 0, skipped: signals.length, reasons: ['out_of_hours'] };
    }
    // v1.8 — 쏠림 장세 게이트: 강력매수 알림은 ADR ≥ 100%일 때만 발송
    if (ctx.marketStructure
        && (ctx.marketStructure.breadth === 'narrow' || ctx.marketStructure.breadth === 'concentrated')) {
      logger.info('jandi notify skipped — narrow/concentrated breadth', {
        adr: ctx.marketStructure.adrPct.toFixed(2),
        breadth: ctx.marketStructure.breadth,
      });
      return {
        sent: 0,
        skipped: signals.length,
        reasons: [`breadth_${ctx.marketStructure.breadth}`],
      };
    }

    const cache = await this.loadCache();
    const todayStart = startOfTodayUtc(now).getTime();
    let sentToday = cache.records.filter((r) => Date.parse(r.sentAt) >= todayStart).length;
    let sent = 0;
    let skipped = 0;

    for (const s of signals) {
      if (sentToday >= MAX_PER_DAY) {
        reasons.push(`${s.code}:daily_cap`);
        skipped += 1;
        continue;
      }
      const pass = this.passesGate(s, ctx, cache, now);
      if (!pass.ok) {
        reasons.push(`${s.code}:${pass.reason}`);
        skipped += 1;
        continue;
      }
      const body = this.buildMessage(s, ctx);
      const ok = await this.sendWebhook(body);
      if (ok) {
        cache.records.push({ code: s.code, sentAt: now.toISOString() });
        sent += 1;
        sentToday += 1;
      } else {
        reasons.push(`${s.code}:webhook_failed`);
        skipped += 1;
      }
    }

    await this.saveCache(cache);
    logger.info('jandi notify done', { sent, skipped, dryRun: this.dryRun, reasons });
    return { sent, skipped, reasons };
  }

  private passesGate(
    s: TradingSignal,
    ctx: JandiNotifyContext,
    cache: SentCache,
    now: Date,
  ): { ok: true } | { ok: false; reason: string } {
    if (s.action !== 'STRONG_BUY' || s.score < SCORE_THRESHOLD)
      return { ok: false, reason: `score_${s.score}` };
    const risk = ctx.structuralRisk.get(s.code);
    if (risk && risk.riskLevel === 'high')
      return { ok: false, reason: 'structural_risk_high' };
    const pos = ctx.position52w.get(s.code);
    if (pos != null && pos > POSITION_MAX)
      return { ok: false, reason: `pos_${Math.round(pos)}` };
    const both = ctx.has5dBothBuy.get(s.code);
    if (!both)
      return { ok: false, reason: 'no_5d_flow' };
    // 중복 — 같은 종목 24시간 이내
    const lastSent = cache.records
      .filter((r) => r.code === s.code)
      .map((r) => Date.parse(r.sentAt))
      .sort((a, b) => b - a)[0];
    if (lastSent != null && now.getTime() - lastSent < DUPLICATE_WINDOW_MS)
      return { ok: false, reason: 'duplicate_24h' };
    return { ok: true };
  }

  private buildMessage(s: TradingSignal, ctx: JandiNotifyContext): unknown {
    const pos = ctx.position52w.get(s.code);
    const posStr = pos != null ? `52주 ${pos.toFixed(0)}%` : '';
    const extra = ctx.extra?.get(s.code) ?? '';
    const risk = ctx.structuralRisk.get(s.code);
    const riskLine = risk && risk.riskLevel === 'positive'
      ? `\n• 구조: ✅ ${risk.riskTag}` : '';
    const dashboardLine = ctx.dashboardUrl ? `\n📎 대시보드: ${ctx.dashboardUrl}` : '';
    const factors = s.factors
      .filter((f) => f.weight !== 0)
      .slice(0, 5)
      .map((f) => `• ${f.category}: ${f.detail} (${f.weight >= 0 ? '+' : ''}${f.weight})`)
      .join('\n');
    const price = s.pricePerShare != null
      ? `${s.pricePerShare.toLocaleString('ko-KR')}원` : '—';
    const body =
      `🔥 강력매수 신호 발생!\n\n` +
      `📊 ${s.name} (${s.code})\n` +
      `현재가: ${price}` + (posStr ? ` (${posStr})` : '') + `\n` +
      `종합점수: ${s.score}점\n\n` +
      `📈 신호 근거:\n${factors}` + riskLine +
      (extra ? `\n${extra}` : '') + `\n\n` +
      `⚠️ 본 알림은 정보 제공용이며 매매 권유가 아닙니다.${dashboardLine}`;
    return {
      body,
      connectColor: '#FF5A5A',
      connectInfo: [
        { title: '종목', description: `${s.name} (${s.code})` },
        { title: '점수', description: `${s.score}점` },
      ],
    };
  }

  private async sendWebhook(body: unknown): Promise<boolean> {
    if (this.dryRun) {
      logger.info('jandi DRY_RUN — would send', { body });
      return true;
    }
    try {
      const res = await globalThis.fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.tosslab.jandi-v2+json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.warn('jandi webhook non-200', { status: res.status });
        return false;
      }
      return true;
    } catch (err) {
      logger.warn('jandi webhook exception', { err: String(err) });
      return false;
    }
  }

  private async loadCache(): Promise<SentCache> {
    try {
      const raw = await readFile(resolve(CACHE_PATH), 'utf8');
      const parsed = JSON.parse(raw) as SentCache;
      if (parsed && Array.isArray(parsed.records)) return parsed;
    } catch {
      // 파일 없음 — 빈 캐시
    }
    return { records: [] };
  }

  private async saveCache(cache: SentCache): Promise<void> {
    // 오래된 기록(7일+) 제거
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    cache.records = cache.records.filter((r) => Date.parse(r.sentAt) >= cutoff);
    const path = resolve(CACHE_PATH);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache, null, 2), 'utf8');
  }

  private kstHour(now: Date): number {
    // KST = UTC + 9. getUTCHours()에 +9 mod 24
    return (now.getUTCHours() + 9) % 24;
  }

  /**
   * v1.8 — 순환매 감지 시 별도 잔디 알림.
   * MarketStructureAnalyzer.detectRotation()이 true일 때만 호출.
   */
  async notifyRotation(
    market: 'KOSPI' | 'KOSDAQ',
    adrToday: number,
    adrPrevAvg: number,
    leadingSectors: string[],
    dashboardUrl?: string,
  ): Promise<boolean> {
    const body =
      `📢 순환매 감지!\n\n` +
      `시장: ${market}\n` +
      `ADR: ${adrPrevAvg.toFixed(1)}% → ${adrToday.toFixed(1)}% (쏠림 → 광범위 상승)\n\n` +
      `📈 새로 상승하는 업종:\n${leadingSectors.map((s) => `• ${s}`).join('\n')}\n\n` +
      `⚠️ 본 알림은 정보 제공용이며 매매 권유가 아닙니다.` +
      (dashboardUrl ? `\n📎 대시보드: ${dashboardUrl}` : '');
    return this.sendWebhook({
      body,
      connectColor: '#2E7D32',
      connectInfo: [{ title: '순환매', description: `${market} ADR ${adrPrevAvg.toFixed(0)}→${adrToday.toFixed(0)}%` }],
    });
  }
}

function startOfTodayUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
