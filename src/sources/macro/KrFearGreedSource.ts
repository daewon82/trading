import { logger } from '../../utils/logger.js';
import {
  classifyZone,
  zoneLabel,
  type FearGreedIndex,
} from '../../types/fear-greed.js';

const ENDPOINT = 'https://fearandgreed.kr/wp-json/fgi/v1/latest';

/**
 * 한국 코스피 공포·탐욕 지수 어댑터 (v1.4).
 * 머신러너 작가가 와이스트릿 인터뷰에서 강조한 "전쟁 터졌을 때 차트 대신 본 지표".
 *
 * 데이터 소스: fearandgreed.kr (AI 분석 기반, 무료 공개 API).
 * - GET /wp-json/fgi/v1/latest → {"data":"57","time":"2026-05-14 13:56:29"}
 * - 단일 값(KOSPI 기준). 1일 1회 갱신 추정.
 *
 * 실패 시 null 반환 — 대시보드의 부가 위젯이므로 fallback 가능.
 */
export class KrFearGreedSource {
  readonly id = 'kr-fear-greed' as const;

  async fetch(): Promise<FearGreedIndex | null> {
    try {
      const res = await globalThis.fetch(ENDPOINT, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        logger.warn('KrFearGreedSource non-200', { status: res.status });
        return null;
      }
      const json = (await res.json()) as { data?: string | number; time?: string };
      const raw = typeof json.data === 'string' ? Number(json.data) : json.data;
      if (raw == null || !Number.isFinite(raw)) {
        logger.warn('KrFearGreedSource invalid data', { json });
        return null;
      }
      const value = Math.max(0, Math.min(100, Math.round(raw)));
      const zone = classifyZone(value);
      return {
        value,
        zone,
        label: zoneLabel(zone),
        capturedAt: json.time ?? new Date().toISOString(),
        source: 'fearandgreed.kr',
      };
    } catch (err) {
      logger.error('KrFearGreedSource.fetch failed', { err: String(err) });
      return null;
    }
  }
}
