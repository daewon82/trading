import type { DashboardPage } from '../reporters/DashboardReporter.js';
import type {
  DashboardCard,
  StockDashboardSection,
  Currency,
} from '../types/stock.js';
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
    const fileUrl = `file://${opts.htmlAbsolutePath}`;
    const linkBlock = opts.publicUrl
      ? `🌐 ${opts.publicUrl}\n📄 ${fileUrl}`
      : `📄 ${fileUrl}`;

    return {
      body: `📊 오늘의 대시보드 — ${page.today}`,
      connectColor: '#1976D2',
      connectInfo: [
        {
          title: '🌤 주간 날씨',
          description: this.summarizeWeather(page.weather),
        },
        {
          title: '🇰🇷 국내 주식',
          description: this.summarizeSection(page.kr),
        },
        {
          title: '🇺🇸 미국 빅테크',
          description: this.summarizeSection(page.us),
        },
        {
          title: '🔗 대시보드 링크',
          description: linkBlock,
        },
        {
          title: '⚠️ 면책',
          description:
            '본 알림은 정량 지표 정보 제공이며 매수/매도 권유 또는 투자 자문이 아닙니다. 모든 투자 판단과 결과 책임은 본인에게 있습니다.',
        },
      ],
    };
  }

  private summarizeWeather(forecasts: WeatherForecast[]): string {
    if (forecasts.length === 0) return '데이터 없음';
    return forecasts
      .map((f) => {
        const rainyDays = f.days.filter((d) => d.rainy);
        const summary =
          rainyDays.length === 0
            ? '비 예보 없음'
            : `비 예보 ${rainyDays.length}일 (${rainyDays
                .map((d) => `${monthDay(d.date)} ${d.description}${d.precipitationProbabilityMax != null ? ` ${d.precipitationProbabilityMax}%` : ''}`)
                .join(', ')})`;
        return `${f.city}: ${summary}`;
      })
      .join('\n');
  }

  private summarizeSection(section: StockDashboardSection): string {
    return section.cards.map((c) => this.summarizeCard(c, section.currency)).join('\n');
  }

  private summarizeCard(c: DashboardCard, currency: Currency): string {
    const s = c.snapshot;
    const price = formatPrice(s.price, currency);
    const pos =
      c.fiftyTwoWeekPosition == null
        ? '52주위치 —'
        : `52주 ${c.fiftyTwoWeekPosition.toFixed(0)}%${c.quartile ? ` (Q${c.quartile})` : ''}`;
    const change =
      s.changePercent == null
        ? ''
        : ` ${s.changePercent >= 0 ? '+' : ''}${s.changePercent.toFixed(2)}%`;
    const ind = c.indicators;
    const signals: string[] = [];
    if (ind?.rsi14 != null) {
      const note = ind.rsi14 < 30 ? '↓' : ind.rsi14 > 70 ? '↑' : '';
      signals.push(`RSI ${ind.rsi14.toFixed(0)}${note}`);
    }
    if (ind?.pctVsSma200 != null) {
      signals.push(`200d ${ind.pctVsSma200 >= 0 ? '+' : ''}${ind.pctVsSma200.toFixed(0)}%`);
    }
    if (ind?.lastCross) {
      const tag = ind.lastCross.kind === 'golden' ? '골든' : '데드';
      signals.push(`${tag} ${ind.lastCross.daysAgo}일전`);
    }
    const sigSuffix = signals.length > 0 ? ` · ${signals.join(' · ')}` : '';
    return `• ${s.name} (${s.code}): ${price}${change} · ${pos}${sigSuffix}`;
  }
}

function formatPrice(v: number | null, currency: Currency): string {
  if (v == null) return '—';
  if (currency === 'KRW') return `${Math.round(v).toLocaleString('ko-KR')}원`;
  return `$${v.toFixed(2)}`;
}

function monthDay(isoDate: string): string {
  const [, mm, dd] = isoDate.split('-');
  return `${Number(mm)}/${Number(dd)}`;
}
