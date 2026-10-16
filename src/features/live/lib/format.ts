import type { DriverLiveState } from "./types";

export const tyreAgeText = (driver: DriverLiveState) =>
  driver.tyreAge == null ? "—" : `${driver.tyreAgeEstimated ? "≈" : ""}${driver.tyreAge}`;
export const tyreAgeDescription = (driver: DriverLiveState) =>
  driver.tyreAgeEstimated
    ? `${tyreAgeText(driver)} кругов после пит-стопа · ждём данные о комплекте`
    : `${tyreAgeText(driver)} кругов на комплекте`;

export const lapTime = (value: number | null | undefined) =>
  value && Number.isFinite(value)
    ? `${Math.floor(value / 60)}:${(value % 60).toFixed(3).padStart(6, "0")}`
    : "—";
export const gapText = (value: string | number | null | undefined) =>
  value == null
    ? "—"
    : typeof value === "number"
      ? value === 0
        ? "Лидер"
        : `+${value.toFixed(3)}`
      : /^[+]?0(?:\.0+)?$/.test(value)
        ? "Лидер"
        : value.replace(/\+?(\d+) LAP[S]?/i, "+$1 кр.");
export const compoundText: Record<string, string> = {
  SOFT: "Мягкие",
  MEDIUM: "Средние",
  HARD: "Жёсткие",
  INTERMEDIATE: "Промежуточные",
  WET: "Дождевые",
};
export const driverStatus: Record<string, string> = {
  PIT: "Боксы",
  "OUT LAP": "Выезд",
  "IN LAP": "На пит-стоп",
  "NO DATA": "Нет данных",
  RETIRED: "Сход",
  DNF: "Сход",
  DNS: "Не стартовал",
  DSQ: "Дисквалификация",
};
