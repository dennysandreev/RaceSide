import assert from "node:assert/strict";
import test from "node:test";
import { liveWeatherLabel } from "./weather.ts";
const now = Date.parse("2026-10-31T12:20:00Z");
const weather = (code, overrides = {}) => ({ timestamp: new Date(now).toISOString(),
  air: 25, track: 40, humidity: 50, wind: 3, rain: null,
  condition: { code, isDay: true, cloudCover: null, observedAt: new Date(now - 300000).toISOString(),
    expiresAt: new Date(now + 300000).toISOString(), source: "Open-Meteo" }, ...overrides });

test("clear, cloudy, overcast and foggy conditions have distinct labels and icons", () => {
  for (const [code, label, icon] of [[0, "Солнечно", "sun"], [1, "Малооблачно", "cloudSun"],
    [2, "Облачно", "cloudSun"], [3, "Пасмурно", "cloud"], [45, "Туман", "fog"]]) {
    const result = liveWeatherLabel(weather(code), now);
    assert.equal(result.label, label);
    assert.equal(result.icon, icon);
  }
  const night = weather(0); night.condition.isDay = false;
  assert.equal(liveWeatherLabel(night, now).label, "Ясно");
  assert.equal(liveWeatherLabel(night, now).icon, "moon");
  night.condition.code = 1;
  assert.equal(liveWeatherLabel(night, now).icon, "cloudMoon");
  night.condition.isDay = null; night.condition.code = 0;
  assert.equal(liveWeatherLabel(night, now).icon, "clear");
});

test("precipitation and storm descriptions come from actual supported model codes", () => {
  for (const [code, label, icon] of [[51, "Морось", "drizzle"], [61, "Дождь", "rain"],
    [82, "Ливень", "rain"], [75, "Снег", "snow"], [95, "Гроза", "storm"], [97, "Гроза", "storm"]]) {
    assert.equal(liveWeatherLabel(weather(code), now).label, label);
    assert.equal(liveWeatherLabel(weather(code), now).icon, icon);
  }
});

test("actual track rain overrides a clear model and a dry sensor suppresses model rain", () => {
  const rain = liveWeatherLabel(weather(0, { rain: 1 }), now);
  assert.equal(rain.label, "Дождь");
  assert.equal(rain.condition, null);
  assert.equal(liveWeatherLabel(weather(61, { rain: 0 }), now).label, "Без осадков");
  const cloudy = weather(61, { rain: 0 }); cloudy.condition.cloudCover = 95;
  assert.equal(liveWeatherLabel(cloudy, now).label, "Пасмурно");
});

test("expired and unknown observations fall back safely using the shared viewing clock", () => {
  const value = weather(0, { rain: 0 });
  assert.equal(liveWeatherLabel(value, now + 300001).label, "Без осадков");
  assert.equal(liveWeatherLabel(value, now).label, "Солнечно");
  assert.equal(liveWeatherLabel(weather(999), now).label, "Погода —");
  assert.equal(liveWeatherLabel(null, now).label, "Погода —");
  const future = weather(0); future.condition.observedAt = new Date(now + 600000).toISOString();
  assert.equal(liveWeatherLabel(future, now).label, "Погода —");
});
