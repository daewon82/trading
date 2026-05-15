/**
 * v1.7 — 한국 주식 시장 이벤트 캘린더.
 *
 * 룰 기반 계산 (외부 API 불필요):
 *   - 옵션 만기일: 매월 두 번째 목요일 (코스피200 옵션)
 *   - 쿼드러플 위칭: 3·6·9·12월 두 번째 목요일 (선물·옵션 동시 만기)
 *   - 배당락: 12월 마지막 거래일 직전 거래일 (기말 배당 기준일)
 *   - 분기 결산일: 3·6·9·12월 마지막 거래일 (코스피200 정기 변경 등)
 *
 * 매수에 영향이 큰 이벤트 위주로 7일 전부터 경고 표시.
 */

export type MarketEventKind =
  | 'option_expiry'      // 월간 옵션 만기일 (매월 둘째 목)
  | 'quadruple_witching' // 쿼드러플 위칭 (3·6·9·12월 둘째 목)
  | 'ex_dividend'        // 배당락일 (연말)
  | 'quarter_end';       // 분기 마지막 거래일

export interface MarketEvent {
  kind: MarketEventKind;
  /** ISO YYYY-MM-DD (Asia/Seoul 기준) */
  date: string;
  label: string;
  /** 오늘 기준 잔여 거래일 수 (오늘=0, 음수=과거) */
  daysUntil: number;
  /** 영향 설명 */
  impact: string;
  severity: 'high' | 'medium' | 'low';
}

/**
 * 매월 N번째 특정 요일의 날짜 반환 (1번째=첫 주, 2번째=둘째 주, ...).
 * dayOfWeek: 0=일요일 ~ 6=토요일. 목=4.
 */
function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
  // month: 1~12
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let day = 1 + ((dayOfWeek - firstDow + 7) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Asia/Seoul 자정 기준의 Date를 ISO YYYY-MM-DD 문자열로 */
function toSeoulDateString(d: Date): string {
  // 단순 UTC 날짜 사용 — KST와의 차이는 시(時) 단위라 날짜 경계에서만 문제. 자정 기준 입력이므로 OK.
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** 주말이면 직전 금요일로 이동 (한국 거래일 휴장 가까스로 보정 — 공휴일은 미반영) */
function adjustToTradingDay(d: Date): Date {
  const adjusted = new Date(d);
  while (isWeekend(adjusted)) {
    adjusted.setUTCDate(adjusted.getUTCDate() - 1);
  }
  return adjusted;
}

/** 두 Date 간 캘린더 일수 차이 (today - eventDate). 양수=과거, 음수=미래. */
function diffDays(today: Date, eventDate: Date): number {
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const b = Date.UTC(eventDate.getUTCFullYear(), eventDate.getUTCMonth(), eventDate.getUTCDate());
  return Math.round((b - a) / 86400000);
}

const KIND_LABEL: Record<MarketEventKind, string> = {
  option_expiry: '📅 코스피200 월간 옵션 만기일',
  quadruple_witching: '⚡ 쿼드러플 위칭 (선물·옵션 동시만기)',
  ex_dividend: '💰 12월 결산법인 배당락일',
  quarter_end: '📊 분기 마지막 거래일',
};

const KIND_IMPACT: Record<MarketEventKind, string> = {
  option_expiry:
    '둘째 목요일 오후 변동성 확대. 코스피200 편입종목·대형주 차익거래 청산으로 막판 매물 쏟아짐. 단타·종가매매 회피 권고.',
  quadruple_witching:
    '선물·옵션 동시 만기 → 프로그램 매매·차익 청산 대량. 거래량 폭증·변동성 폭증. 추격매수 위험 ↑↑.',
  ex_dividend:
    '배당락일 시초가 배당률만큼 하락(평균 -2~3%). 배당 받으려면 직전 거래일까지 매수. 종가매매는 익일 갭하락 손실.',
  quarter_end:
    'MSCI/코스피200 정기변경 + 윈도드레싱. 편입·편출 종목 거래량 급변. 룰 기반 단타는 데이터 신뢰도 ↓.',
};

const KIND_SEVERITY: Record<MarketEventKind, 'high' | 'medium' | 'low'> = {
  option_expiry: 'medium',
  quadruple_witching: 'high',
  ex_dividend: 'high',
  quarter_end: 'low',
};

/**
 * 오늘 기준 ±7일 범위의 시장 이벤트 목록을 반환.
 * 일자 가까운 순으로 정렬 (이미 지난 이벤트는 daysUntil 음수).
 */
export class MarketEventCalendar {
  static getEvents(today: Date = new Date(), windowDays = 35): MarketEvent[] {
    const events: Array<{ kind: MarketEventKind; date: Date }> = [];
    const year = today.getUTCFullYear();
    // 현재 월 + 다음 2개월까지 — windowDays=35로 다음 옵션만기일(최대 30일+)·분기말까지 커버
    const months = [0, 1, 2].map((offset) => {
      const m = today.getUTCMonth() + offset;
      let y = year;
      let mm = m + 1;
      while (mm > 12) { mm -= 12; y += 1; }
      return { y, mm };
    });

    for (const { y, mm } of months) {
      // 옵션 만기일 — 매월 둘째 목요일
      const optExp = adjustToTradingDay(nthWeekdayOfMonth(y, mm, 4, 2));
      // 쿼드러플 위칭은 3·6·9·12월 옵션 만기일을 대체 표시
      const isQuadMonth = [3, 6, 9, 12].includes(mm);
      events.push({ kind: isQuadMonth ? 'quadruple_witching' : 'option_expiry', date: optExp });

      // 분기 마지막 거래일 (3·6·9·12월)
      if ([3, 6, 9, 12].includes(mm)) {
        const lastDay = new Date(Date.UTC(y, mm, 0)); // 다음 달 0일 = 이번 달 말일
        events.push({ kind: 'quarter_end', date: adjustToTradingDay(lastDay) });
      }

      // 배당락일 — 12월 결산법인 대상, 12월 마지막 거래일 직전 거래일
      if (mm === 12) {
        const lastDay = new Date(Date.UTC(y, mm, 0));
        const lastTradingDay = adjustToTradingDay(lastDay);
        const exDividend = new Date(lastTradingDay);
        exDividend.setUTCDate(exDividend.getUTCDate() - 1);
        events.push({ kind: 'ex_dividend', date: adjustToTradingDay(exDividend) });
      }
    }

    const result: MarketEvent[] = [];
    for (const { kind, date } of events) {
      const days = diffDays(today, date);
      if (Math.abs(days) > windowDays) continue;
      result.push({
        kind,
        date: toSeoulDateString(date),
        label: KIND_LABEL[kind],
        daysUntil: days,
        impact: KIND_IMPACT[kind],
        severity: KIND_SEVERITY[kind],
      });
    }
    result.sort((a, b) => a.daysUntil - b.daysUntil);
    return result;
  }
}
