import type { NewsItem } from '../../types/news.js';
import { logger } from '../../utils/logger.js';

const ITEM_RE = /<item[^>]*>([\s\S]*?)<\/item>/g;
const TITLE_RE = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
const LINK_RE = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/;
const PUBDATE_RE = /<pubDate>([\s\S]*?)<\/pubDate>/;

function unescape(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

export async function fetchRssFeed(
  url: string,
  source: string,
  limit: number,
): Promise<NewsItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      logger.warn('RSS fetch HTTP non-ok', { url, status: res.status });
      return [];
    }
    const xml = await res.text();
    const items: NewsItem[] = [];
    const matches = xml.matchAll(ITEM_RE);
    for (const m of matches) {
      const block = m[1] ?? '';
      const titleMatch = block.match(TITLE_RE);
      const linkMatch = block.match(LINK_RE);
      const pubMatch = block.match(PUBDATE_RE);
      if (!titleMatch || !linkMatch) continue;
      items.push({
        title: unescape(titleMatch[1]?.trim() ?? ''),
        link: linkMatch[1]?.trim() ?? '',
        pubDate: pubMatch?.[1]?.trim() ?? '',
        source,
      });
      if (items.length >= limit) break;
    }
    return items;
  } catch (err) {
    logger.error('RSS fetch failed', { url, err: String(err) });
    return [];
  } finally {
    clearTimeout(timer);
  }
}
