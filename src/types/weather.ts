export interface WeatherDay {
  date: string;
  weatherCode: number;
  description: string;
  rainy: boolean;
  precipitationProbabilityMax: number | null;
  temperatureMax: number | null;
  temperatureMin: number | null;
}

export interface WeatherForecast {
  city: string;
  latitude: number;
  longitude: number;
  days: WeatherDay[];
}
