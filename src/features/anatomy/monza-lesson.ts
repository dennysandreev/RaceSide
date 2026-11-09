import type { PhaseId } from "./catalog";

export type LessonSystem = "drive" | "brakes" | "energy" | "aero" | "chassis";
export type EnergyDirection = "deploy" | "recover" | "hold";

export const lessonSystems: { id: LessonSystem; name: string; components: string[] }[] = [
  { id: "drive", name: "Тяга", components: ["engine", "clutch", "gearbox", "differential"] },
  { id: "brakes", name: "Торможение", components: ["brakes", "brake-by-wire", "mguk"] },
  { id: "energy", name: "Энергия", components: ["battery", "inverter", "mguk"] },
  { id: "aero", name: "Воздух", components: ["front-wing", "rear-wing", "floor", "diffuser"] },
  { id: "chassis", name: "Подвеска", components: ["front-suspension", "rear-suspension", "steering", "tyres"] },
];

type LessonSection = {
  id: string; name: string; location: string; phase: PhaseId;
  start: number; end: number; duration: number; energy: EnergyDirection; wings?: boolean;
};

// Distance fractions use the existing Monza model's start line and corner markers.
// Durations deliberately slow the corners for teaching. They are not lap timing,
// telemetry, an ERS strategy or a published active-aero zone map.
export const monzaSections: LessonSection[] = [
  { id: "start", name: "Стартовая прямая", location: "Старт / финиш", phase: "straight", start: 0, end: .125, duration: 12, energy: "deploy", wings: true },
  { id: "rettifilo-brake", name: "Перед первой шиканой", location: "Первая шикана · T1–2", phase: "braking", start: .125, end: .155, duration: 7, energy: "recover" },
  { id: "rettifilo", name: "Первая шикана", location: "Первая шикана · T1–2", phase: "corner", start: .155, end: .178, duration: 9, energy: "hold" },
  { id: "rettifilo-exit", name: "Выход из первой шиканы", location: "После T2", phase: "acceleration", start: .178, end: .225, duration: 7, energy: "deploy" },
  { id: "grande", name: "Курва Гранде", location: "Курва Гранде · T3", phase: "corner", start: .225, end: .28, duration: 7, energy: "hold" },
  { id: "roggia-approach", name: "К шикане Роджа", location: "Перед T4", phase: "acceleration", start: .28, end: .34, duration: 6, energy: "deploy" },
  { id: "roggia-brake", name: "Торможение перед Роджей", location: "Роджа · T4–5", phase: "braking", start: .34, end: .365, duration: 5, energy: "recover" },
  { id: "roggia", name: "Шикана Роджа", location: "Роджа · T4–5", phase: "corner", start: .365, end: .391, duration: 7, energy: "hold" },
  { id: "roggia-exit", name: "Разгон к Лесмо", location: "После T5", phase: "acceleration", start: .391, end: .416, duration: 4, energy: "deploy" },
  { id: "lesmo-one-brake", name: "Перед первым Лесмо", location: "Первый Лесмо · T6", phase: "braking", start: .416, end: .429, duration: 4, energy: "recover" },
  { id: "lesmo-one", name: "Первый Лесмо", location: "Первый Лесмо · T6", phase: "corner", start: .429, end: .45, duration: 6, energy: "hold" },
  { id: "lesmo-link", name: "Между Лесмо", location: "Между T6 и T7", phase: "acceleration", start: .45, end: .48, duration: 4, energy: "deploy" },
  { id: "lesmo-two-brake", name: "Перед вторым Лесмо", location: "Второй Лесмо · T7", phase: "braking", start: .48, end: .493, duration: 4, energy: "recover" },
  { id: "lesmo-two", name: "Второй Лесмо", location: "Второй Лесмо · T7", phase: "corner", start: .493, end: .514, duration: 6, energy: "hold" },
  { id: "serraglio-exit", name: "Выход на Серральо", location: "После T7", phase: "acceleration", start: .514, end: .56, duration: 6, energy: "deploy" },
  { id: "serraglio", name: "Прямая Серральо", location: "Серральо", phase: "straight", start: .56, end: .651, duration: 9, energy: "deploy", wings: true },
  { id: "ascari-brake", name: "Перед Аскари", location: "Аскари · T8–10", phase: "braking", start: .651, end: .678, duration: 6, energy: "recover" },
  { id: "ascari", name: "Связка Аскари", location: "Аскари · T8–10", phase: "corner", start: .678, end: .731, duration: 10, energy: "hold" },
  { id: "ascari-exit", name: "Выход из Аскари", location: "После T10", phase: "acceleration", start: .731, end: .78, duration: 7, energy: "deploy" },
  { id: "back-straight", name: "К Альборето", location: "Задняя прямая", phase: "straight", start: .78, end: .871, duration: 9, energy: "hold" },
  { id: "alboreto-brake", name: "Перед Альборето", location: "Альборето · T11", phase: "braking", start: .871, end: .892, duration: 6, energy: "recover" },
  { id: "alboreto", name: "Поворот Альборето", location: "Альборето · T11", phase: "corner", start: .892, end: .935, duration: 9, energy: "hold" },
  { id: "finish", name: "Разгон к финишу", location: "Старт / финиш", phase: "acceleration", start: .935, end: 1, duration: 9, energy: "deploy" },
];

export const phaseNames: Record<PhaseId, string> = { acceleration: "Разгон", straight: "Прямая", braking: "Торможение", corner: "Поворот" };
const motionRates: Record<PhaseId, [number, number]> = { acceleration: [.4, 1], straight: [1, 1], braking: [1, .35], corner: [.35, .4] };
let seconds = 0, motion = 0;
export const lessonTimeline = monzaSections.map(section => {
  const [from, to] = motionRates[section.phase];
  const entry = { ...section, time: seconds, motion };
  seconds += section.duration;
  motion += section.duration * (from + to) / 2;
  return entry;
});
export const LESSON_DURATION = seconds;

export function clampLessonTime(time: number) {
  return Math.max(0, Math.min(LESSON_DURATION, Number.isFinite(time) ? time : 0));
}

export function sampleLesson(time: number) {
  const elapsed = clampLessonTime(time);
  const index = Math.max(0, lessonTimeline.findLastIndex(section => section.time <= elapsed));
  const section = lessonTimeline[index];
  const local = Math.min(section.duration, elapsed - section.time);
  const fraction = local / section.duration;
  const [from, to] = motionRates[section.phase];
  return {
    time: elapsed, index, section, phase: section.phase, energy: section.energy,
    progress: section.start + (section.end - section.start) * fraction,
    // An integral, not accumulated frame deltas: seeking restores the exact pose.
    mechanismTime: section.motion + from * local + (to - from) * local * local / (2 * section.duration),
    wingOpening: section.wings ? Math.min(1, fraction * 8, (1 - fraction) * 8) : 0,
  };
}
export type LessonFrame = ReturnType<typeof sampleLesson>;

export function timeAtProgress(progress: number) {
  const distance = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const section = lessonTimeline.find(section => distance < section.end) ?? lessonTimeline.at(-1)!;
  return section.time + (distance - section.start) / (section.end - section.start) * section.duration;
}

export function adjacentLessonTime(time: number, direction: -1 | 1) {
  const frame = sampleLesson(time);
  if (direction === -1 && frame.time - frame.section.time > .5) return frame.section.time;
  return lessonTimeline[Math.max(0, Math.min(lessonTimeline.length - 1, frame.index + direction))].time;
}

export function lessonExplanation(system: LessonSystem, frame: LessonFrame): { title: string; text: string; path: string[] } {
  const phase = frame.phase;
  if (system === "energy") {
    if (frame.energy === "recover") return { title: "Движение становится электричеством", text: "MGU-K работает генератором. Через инвертор энергия возвращается в батарею, а тормозные диски рассеивают другую часть энергии в виде тепла.", path: ["mguk", "inverter", "battery"] };
    if (frame.energy === "deploy") return { title: "Батарея помогает разгоняться", text: "Инвертор подаёт ток на MGU-K. Электромотор добавляет крутящий момент к работе двигателя. Подсветка показывает направление передачи энергии.", path: ["battery", "inverter", "mguk"] };
    return { title: "Электрическая помощь на паузе", text: "В этом учебном моменте батарея не отдаёт и не принимает энергию. В реальной машине режим зависит от стратегии: рекуперация возможна и вне торможения.", path: [] };
  }
  if (system === "brakes") return phase === "braking"
    ? { title: "Две системы замедляют машину", text: "Колодки зажимают вращающиеся диски. На задней оси brake-by-wire согласует тормозное усилие с рекуперацией MGU-K. Красная подсветка отмечает работу тормозов, а не их температуру.", path: ["brakes", "brake-by-wire", "mguk"] }
    : { title: "Диски вращаются свободно", text: "В этом моменте педаль тормоза отпущена. Диски продолжают вращаться вместе с колёсами. Перейди к торможению, чтобы увидеть участие тормозов и MGU-K.", path: [] };
  if (system === "aero") return frame.section.wings
    ? { title: "Крылья уменьшают сопротивление", text: "На выбранной учебной прямой подвижные профили раскрываются. Проследи, как меняются потоки. Перед торможением крылья возвращаются в поворотное положение.", path: ["front-wing", "rear-wing"] }
    : { title: "Прижим помогает держать траекторию", text: "Крылья находятся в поворотном положении. Вместе с днищем они создают аэродинамическую нагрузку. Потоки показывают путь воздуха, без расчёта давления и прижимной силы.", path: ["front-wing", "floor", "diffuser", "rear-wing"] };
  if (system === "chassis") {
    if (phase === "braking") return { title: "Нагрузка смещается вперёд", text: "При замедлении передние колёса принимают больше нагрузки. Рычаги, тяги и амортизаторы контролируют перемещение колёс и положение машины. Подсвечены участвующие узлы; их ход здесь не рассчитывается.", path: ["front-suspension", "tyres"] };
    if (phase === "corner") return { title: "Колёса держат дугу поворота", text: "Рулевой механизм задаёт направление передних колёс. Подвеска контролирует их положение, а внешние шины принимают больше нагрузки. Здесь можно рассмотреть устройство этих узлов; их деформации не моделируются.", path: ["steering", "front-suspension", "rear-suspension", "tyres"] };
    return { title: phase === "acceleration" ? "Задние колёса передают тягу" : "Подвеска сохраняет положение машины", text: "Тяга передаётся на трассу через задние шины. Подвеска помогает сохранять контакт колёс с покрытием и рабочее положение днища. Открой узел, чтобы рассмотреть соединения.", path: ["rear-suspension", "tyres"] };
  }
  return phase === "braking"
    ? { title: "Газ отпущен, механизмы продолжают работать", text: "Двигатель и трансмиссия продолжают вращаться, пока машина замедляется. Приводы насосов и клапанов сохраняют связь с коленвалом. Открой двигатель и перемести шкалу, чтобы рассмотреть их положение.", path: ["engine", "gearbox", "differential"] }
    : { title: phase === "corner" ? "Тяга под контролем" : "От поршней до задних колёс", text: "Поршни вращают коленвал. Через сцепление, коробку и дифференциал момент доходит до задних колёс. Механизмы намеренно замедлены; коробка показана на одной передаче.", path: ["engine", "clutch", "gearbox", "differential"] };
}
