import type { WeatherDay, WeatherForecast } from '../../types/weather.js';

const WMO_DESCRIPTION: Record<number, string> = {
  0: '맑음',
  1: '대체로 맑음',
  2: '구름 조금',
  3: '흐림',
  45: '안개',
  48: '서리 안개',
  51: '이슬비 약',
  53: '이슬비',
  55: '이슬비 강',
  56: '얼음 이슬비 약',
  57: '얼음 이슬비 강',
  61: '비 약',
  63: '비',
  65: '비 강',
  66: '얼음비 약',
  67: '얼음비 강',
  71: '눈 약',
  73: '눈',
  75: '눈 강',
  77: '싸락눈',
  80: '소나기 약',
  81: '소나기',
  82: '소나기 강',
  85: '눈소나기 약',
  86: '눈소나기 강',
  95: '천둥번개',
  96: '천둥번개+우박',
  99: '천둥번개+큰우박',
};

function isRainyCode(code: number): boolean {
  // 51~67: 이슬비/비/얼음비, 80~82: 소나기, 95~99: 천둥번개
  return (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    (code >= 95 && code <= 99)
  );
}

export interface CityCoord {
  city: string;
  latitude: number;
  longitude: number;
}

export const SEOUL: CityCoord = { city: '서울', latitude: 37.5665, longitude: 126.978 };
export const GOYANG: CityCoord = { city: '고양시', latitude: 37.6584, longitude: 126.832 };

interface OpenMeteoResponse {
  daily: {
    time: string[];
    weather_code: number[];
    precipitation_probability_max: Array<number | null>;
    temperature_2m_max: Array<number | null>;
    temperature_2m_min: Array<number | null>;
  };
}

export async function fetchWeeklyForecast(coord: CityCoord): Promise<WeatherForecast> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(coord.latitude));
  url.searchParams.set('longitude', String(coord.longitude));
  url.searchParams.set(
    'daily',
    'weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min',
  );
  url.searchParams.set('timezone', 'Asia/Seoul');
  url.searchParams.set('forecast_days', '7');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let json: OpenMeteoResponse;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`open-meteo HTTP ${res.status} ${res.statusText}`);
    }
    json = (await res.json()) as OpenMeteoResponse;
  } finally {
    clearTimeout(timer);
  }

  const days: WeatherDay[] = json.daily.time.map((date, i) => {
    const code = json.daily.weather_code[i] ?? 0;
    return {
      date,
      weatherCode: code,
      description: WMO_DESCRIPTION[code] ?? `코드 ${code}`,
      rainy: isRainyCode(code),
      precipitationProbabilityMax: json.daily.precipitation_probability_max[i] ?? null,
      temperatureMax: json.daily.temperature_2m_max[i] ?? null,
      temperatureMin: json.daily.temperature_2m_min[i] ?? null,
    };
  });

  return {
    city: coord.city,
    latitude: coord.latitude,
    longitude: coord.longitude,
    days,
  };
}
