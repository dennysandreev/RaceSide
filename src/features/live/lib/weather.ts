import type { WeatherState } from "./types";

type WeatherIcon = "sun" | "moon" | "clear" | "cloudSun" | "cloudMoon" | "cloud"
  | "fog" | "drizzle" | "rain" | "snow" | "storm" | "dry" | "unknown";
type Condition = NonNullable<WeatherState["condition"]>;
type WeatherLabel = { label: string; icon: WeatherIcon; condition: Condition | null };
const wetCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75,
  77, 80, 81, 82, 85, 86, 95, 96, 97, 99]);

function sky(code: number, condition: Condition): WeatherLabel {
  const daylight = condition.isDay;
  if (code === 0) return { label: daylight === true ? "Солнечно" : "Ясно",
    icon: daylight === true ? "sun" : daylight === false ? "moon" : "clear", condition };
  if (code === 1 || code === 2) return { label: code === 1 ? "Малооблачно" : "Облачно",
    icon: daylight === true ? "cloudSun" : daylight === false ? "cloudMoon" : "cloud", condition };
  return { label: "Пасмурно", icon: "cloud", condition };
}

export function liveWeatherLabel(weather: WeatherState | null, now: number): WeatherLabel {
  const cached = weather?.condition;
  const condition = cached && Date.parse(cached.observedAt) <= now + 120000
    && Date.parse(cached.expiresAt) > now ? cached : null;
  const wet = condition && wetCodes.has(condition.code);
  // The track's actual rain sensor wins over the weather model. It cannot tell
  // us cloud cover, sunshine or rain intensity by itself.
  if (weather?.rain === 1 && !wet) return { label: "Дождь", icon: "rain", condition: null };
  if (condition && weather?.rain === 0 && wet) {
    const clouds = condition.cloudCover;
    if (clouds !== null && Number.isFinite(clouds)) return sky(clouds >= 85 ? 3 : clouds >= 35 ? 2 : clouds >= 10 ? 1 : 0, condition);
    return { label: "Без осадков", icon: "dry", condition: null };
  }
  if (condition) {
    const code = condition.code;
    if (code >= 0 && code <= 3) return sky(code, condition);
    if ([45, 48].includes(code)) return { label: "Туман", icon: "fog", condition };
    if ([51, 53, 55, 56, 57].includes(code)) return { label: "Морось", icon: "drizzle", condition };
    if ([61, 63, 65, 66, 67].includes(code)) return { label: "Дождь", icon: "rain", condition };
    if ([80, 81, 82].includes(code)) return { label: "Ливень", icon: "rain", condition };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Снег", icon: "snow", condition };
    if ([95, 96, 97, 99].includes(code)) return { label: "Гроза", icon: "storm", condition };
  }
  return weather?.rain === 1 ? { label: "Дождь", icon: "rain", condition: null }
    : weather?.rain === 0 ? { label: "Без осадков", icon: "dry", condition: null }
      : { label: "Погода —", icon: "unknown", condition: null };
}
