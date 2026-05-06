import type { DashboardPage } from '../reporters/DashboardReporter.js';
import type { StockDashboardSection, Currency } from '../types/stock.js';
import type { WeatherForecast } from '../types/weather.js';

export interface JandiPayload {
  body: string;
  connectColor: string;
  connectInfo: Array<{ title: string; description: string }>;
}

export interface JandiNotifierOptions {
  webhookUrl: string;
  htmlAbsolutePath: string;
  publicUrl?: string | null;
  publicHistoryUrl?: string | null;
}

export class JandiNotifier {
  async send(page: DashboardPage, opts: JandiNotifierOptions): Promise<void> {
    const payload = this.buildPayload(page, opts);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(opts.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.tosslab.jandi-v2+json',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`jandi HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  buildPayload(page: DashboardPage, opts: JandiNotifierOptions): JandiPayload {
    const todayRainy = isTodayRainy(page.weather);
    return {
      body: `📊 오늘의 대시보드 — ${page.today}${todayRainy ? '   🌧️ 오늘 비 예보!' : ''}`,
      // 당일 비면 보더 빨강, 평소엔 파랑
      connectColor: todayRainy ? '#C62828' : '#1976D2',
      connectInfo: [
        {
          title: todayRainy ? '🌧️ 오늘 비 — 우산 챙기세요' : '🌤 이번 주 날씨',
          description: this.summarizeRainOnly(page.weather),
        },
        {
          title: '🇰🇷 국내 — 매수 참조가',
          description: this.summarizeBuyRefs(page.kr),
        },
        {
          title: '🇺🇸 미국 빅테크 — 매수 참조가',
          description: this.summarizeBuyRefs(page.us),
        },
        {
          title: '🔗 대시보드 (상세)',
          description: this.formatLinks(opts),
        },
        {
          title: '⚠️ 면책',
          description:
            '본 알림은 정량 정보 제공용이며 매수/매도 권유나 투자 자문이 아닙니다. 모든 판단과 결과 책임은 본인에게 있습니다.',
        },
      ],
    };
  }

  private summarizeRainOnly(forecasts: WeatherForecast[]): string {
    if (forecasts.length === 0) return '데이터 없음';
    return forecasts
      .map((f) => {
        const rainy = f.days.filter((d) => d.rainy);
        if (rainy.length === 0) return `${f.city}: 이번 주 비 예보 없음 ☀️`;
        const list = rainy
          .map((d) => {
            const pop =
              d.precipitationProbabilityMax != null
                ? ` (${d.precipitationProbabilityMax}%)`
                : '';
            return `🌧️ ${shortDate(d.date)} ${d.description}${pop}`;
          })
          .join(', ');
        return `${f.city}: ${list}`;
      })
      .join('\n');
  }

  private summarizeBuyRefs(section: StockDashboardSection): string {
    return section.cards
      .map((c) => this.summarizeCardRefs(c, section.currency))
      .join('\n');
  }

  private summarizeCardRefs(
    c: { snapshot: { name: string; code: string; price: number | null }; referenceLines: { q1: number; q2: number; q3: number } | null; indicators: { sma200: number | null } | null },
    currency: Currency,
  ): string {
    const s = c.snapshot;
    const cur = formatPrice(s.price, currency);
    const refs = c.referenceLines;
    if (!refs) return `• ${s.name} (${s.code}): 현재 ${cur}`;
    const sma200 = c.indicators?.sma200;
    const sma200Str = sma200 != null ? ` · 200d ${formatPrice(sma200, currency)}` : '';
    return `• ${s.name}: 현재 ${cur} | Q1 ${formatPrice(refs.q1, currency)} · Q2 ${formatPrice(refs.q2, currency)}${sma200Str}`;
  }

  private formatLinks(opts: JandiNotifierOptions): string {
    const lines: string[] = [];
    if (opts.publicUrl) lines.push(`🌐 최신: ${opts.publicUrl}`);
    if (opts.publicHistoryUrl) lines.push(`🕒 오늘 스냅샷: ${opts.publicHistoryUrl}`);
    if (!opts.publicUrl) lines.push(`📄 file://${opts.htmlAbsolutePath}`);
    return lines.join('\n');
  }
}

function isTodayRainy(forecasts: WeatherForecast[]): boolean {
  if (forecasts.length === 0) return false;
  // 오늘은 forecast의 첫 번째 day
  return forecasts.some((f) => f.days[0]?.rainy ?? false);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00+09:00`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
}

function formatPrice(v: number | null, currency: Currency): string {
  if (v == null) return '—';
  if (currency === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  return `$${v.toFixed(2)}`;
}
