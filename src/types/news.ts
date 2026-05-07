export type NewsRegion = 'KR' | 'US';

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface NewsSection {
  region: NewsRegion;
  source: string;
  items: NewsItem[];
}
