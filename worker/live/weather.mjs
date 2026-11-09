// Open-Meteo supplements track measurements with sky conditions. Read the
// existing shared cache; never make one provider request per LIVE viewer.
const MAX_AGE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const codes = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65,
  66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 97, 99]);
const numeric = (value) => !["number", "string"].includes(typeof value) || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
// The weather job requests timezone=UTC. Provider ISO strings omit the zone.
const utcTime = (value) => typeof value === "string"
  ? Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`) : NaN;

export function cachedWeatherCondition(row, now = Date.now()) {
  if (!row) return null;
  const updated = utcTime(row.updated_at);
  if (!Number.isFinite(updated) || updated > now + CLOCK_SKEW_MS || now - updated > MAX_AGE_MS) return null;
  const current = row.raw_payload?.current;
  let code = numeric(row.weather_code ?? current?.weather_code);
  let observed = utcTime(row.observed_at ?? current?.time);
  let isDay = numeric(current?.is_day), cloudCover = numeric(current?.cloud_cover);
  // Existing cache rows predate the current-weather code request. Their hourly
  // forecast is usable only while the cache and the selected past hour are fresh.
  if (code === null) {
    const hourly = row.raw_payload?.hourly;
    let index = -1, latest = -Infinity;
    for (let i = 0; i < (hourly?.time?.length ?? 0); i++) {
      const time = utcTime(hourly.time[i]);
      if (time <= now && time > latest) { latest = time; index = i; }
    }
    if (index < 0) return null;
    code = numeric(hourly.weather_code?.[index]);
    observed = latest;
    isDay = numeric(hourly.is_day?.[index] ?? current?.is_day);
    cloudCover = numeric(hourly.cloud_cover?.[index] ?? current?.cloud_cover);
  }
  if (!codes.has(code) || !Number.isFinite(observed) || observed > now + CLOCK_SKEW_MS || now - observed > MAX_AGE_MS) return null;
  return {
    code,
    isDay: isDay === 1 ? true : isDay === 0 ? false : null,
    cloudCover: cloudCover !== null && cloudCover >= 0 && cloudCover <= 100 ? cloudCover : null,
    observedAt: new Date(observed).toISOString(),
    expiresAt: new Date(Math.min(updated, observed) + MAX_AGE_MS).toISOString(),
    source: "Open-Meteo",
  };
}

export async function loadLiveWeatherCondition(db, session, now = Date.now()) {
  if (!db || !session?.race_id) return null;
  const { data, error } = await db.from("circuit_weather")
    .select("weather_code,observed_at,updated_at,raw_payload")
    .eq("race_id", session.race_id).eq("provider", "open-meteo")
    .maybeSingle().abortSignal(AbortSignal.timeout(8000));
  if (error) throw error;
  return cachedWeatherCondition(data, now);
}
