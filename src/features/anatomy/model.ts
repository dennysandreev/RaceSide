import type { PhaseId } from "./catalog";

/** FIA 2026, C5.2.7–8, Issue 20. DC-bus regulatory ceiling, not measured wheel power. */
export function ersPowerLimit(speedKph: number, overtake: boolean, powerLimitedSector: boolean): number {
  const speed = Math.max(0, Number.isFinite(speedKph) ? speedKph : 0);
  let ceiling = overtake
    ? speed < 355 ? 7100 - 20 * speed : 0
    : speed < 340 ? 1800 - 5 * speed : speed < 345 ? 6900 - 20 * speed : 0;
  if (powerLimitedSector) {
    const sectorLimit = speed < 310 ? 250 : speed < 340 ? 1800 - 5 * speed : speed < 345 ? 6900 - 20 * speed : 0;
    ceiling = Math.min(ceiling, sectorLimit);
  }
  return Math.max(0, Math.min(350, ceiling));
}

/** Qualitative educational states; deliberately no fabricated temperatures, SoC or lap telemetry. */
export function componentState(id: string, phase: PhaseId): string {
  if (id === "mguk") return phase === "braking" ? "Генерирует ток" : phase === "corner" ? "Момент по запросу" : "Добавляет тягу";
  if (id === "battery") return phase === "braking" ? "Принимает энергию" : phase === "corner" ? "Заряд под контролем" : "Отдаёт энергию";
  if (id === "inverter") return phase === "braking" ? "К батарее" : "К мотору";
  if (id === "front-wing" || id === "rear-wing") return phase === "straight" ? "Меньше сопротивление" : "Больше прижима";
  if (id === "brakes" || id === "brake-by-wire") return phase === "braking" ? "Замедление" : "Тормоз отпущен";
  if (id === "engine") return phase === "braking" ? "Тяга снижена" : "Создаёт момент";
  if (id === "steering") return phase === "corner" ? "Колёса повёрнуты" : "Прямое положение";
  if (id === "cooling") return "Отводит тепло";
  return phase === "corner" ? "Держит баланс" : "Работает в системе";
}
