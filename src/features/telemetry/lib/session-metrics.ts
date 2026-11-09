import type { SessionLapMetric, SessionMetrics } from "./types";

export type SessionMetric = "speed" | "throttle" | "map";
export const metricTitles: Record<SessionMetric, string> = {
  speed: "Максимальная скорость", throttle: "Полный газ", map: "Карта скоростей",
};
export const metricHelp: Record<SessionMetric, string> = {
  speed: "Максимальная скорость по замерам телеметрии на быстрейшем подходящем круге каждого пилота. Это не замер в одной точке трассы. Круги через боксы, удалённые, стартовые и под SC, VSC или красным флагом исключены.",
  throttle: "Доля времени с газом от 99% на быстрейшем подходящем круге команды. Учитываем длительность между замерами, а не их количество. Неизвестные значения и паузы более 1,5 с не учитываются; нужно покрытие не менее 97% круга.",
  map: "Средняя и максимальная скорость на одном и том же быстрейшем подходящем круге команды. Средняя скорость — длина трассы, делённая на время круга; для неизвестной трассы — средняя по телеметрии. Это сравнение скоростей: по нему нельзя отдельно измерить прижимную силу. На результат также влияют топливо, шины, слипстрим, ветер и режимы энергии.",
};
export function teamSessionLaps(data: SessionMetrics): SessionLapMetric[] {
  const teams = new Map<string, SessionLapMetric>();
  for (const row of data.laps) {
    // Cached source metadata can omit a team. Keep these drivers in the
    // individual ranking rather than inventing a team for the aggregate.
    const team = typeof row.driver.team === "string" ? row.driver.team.trim() : "";
    if (!team) continue;
    const key = team.toLowerCase();
    const old = teams.get(key);
    if (!old || (row.lap?.time ?? Infinity) < (old.lap?.time ?? Infinity) ||
      (row.lap?.time === old.lap?.time && row.driver.number < old.driver.number)) teams.set(key, row);
  }
  return [...teams.values()];
}
export function metricValue(row: SessionLapMetric, metric: SessionMetric) {
  return metric === "throttle" ? row.fullThrottle : row.topSpeed;
}
export function sessionMetricRows(data: SessionMetrics, metric: SessionMetric) {
  return [...(metric === "speed" ? data.laps : teamSessionLaps(data))].sort((a,b) =>
    (metricValue(b, metric) ?? -Infinity) - (metricValue(a, metric) ?? -Infinity) || a.driver.code.localeCompare(b.driver.code));
}
export function formatMetric(value: number | null, metric: SessionMetric) {
  return value == null ? "—" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: metric === "throttle" ? 1 : 0 })}${metric === "throttle" ? "%" : " км/ч"}`;
}
export function metricTeamLabel(row: SessionLapMetric) {
  const team = row.driver.team;
  return team.replace(/Aston Martin.*/, "Aston Martin").replace(/Red Bull.*/, "Red Bull")
    .replace(/Racing Bulls.*/, "Racing Bulls").replace(/Kick Sauber|Sauber.*/, "Sauber");
}
export function metricDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max(1, (high-low)*0.2);
  return [Math.floor(low-padding), Math.ceil(high+padding)];
}
export function metricMapLayout(rows: SessionLapMetric[]) {
  const xd=metricDomain(rows.map(r=>r.averageSpeed!)), yd=metricDomain(rows.map(r=>r.topSpeed!));
  const points=rows.map(row=>({ row, x:62+(row.averageSpeed!-xd[0])/(xd[1]-xd[0])*904,
    y:370-(row.topSpeed!-yd[0])/(yd[1]-yd[0])*326 }));
  const labels: { x:number; y:number; width:number }[]=[];
  return points.map(point=>{
    const width=metricTeamLabel(point.row).length*7.3+12;
    const candidates=Array.from({length:16},(_,i)=>({ x:Math.max(62+width/2,Math.min(966-width/2,point.x+(i%3-1)*80)), y:Math.max(32,Math.min(362,point.y+(i%2?-1:1)*(22+Math.floor(i/2)*20))) }));
    const spot=candidates.find(c=>!labels.some(l=>Math.abs(l.x-c.x)<(l.width+width)/2 && Math.abs(l.y-c.y)<18) &&
      !points.some(p=>Math.abs(p.x-c.x)<width/2 && Math.abs(p.y-(c.y-5))<16)) ?? candidates.at(-1)!;
    labels.push({...spot,width});
    return {...point,labelX:spot.x,labelY:spot.y};
  });
}
export function sessionMetricsCsv(data: SessionMetrics, metric: SessionMetric) {
  const cell = (v: unknown) => {
    const text = String(v ?? "");
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [
    ["Команда", "Пилот", "Круг", "Время круга (с)", "Макс. скорость (км/ч)", "Средняя скорость (км/ч)", "Полный газ (%)", "Покрытие скорости (%)", "Покрытие газа (%)", "Расчёт средней скорости"],
    ...sessionMetricRows(data,metric).map(r=>[r.driver.team,r.driver.code,r.lap?.number,r.lap?.time,r.topSpeed,r.averageSpeed,r.fullThrottle,r.speedCoverage*100,r.throttleCoverage*100,r.averageMethod === "circuit-length" ? "Длина трассы / время круга" : "По телеметрии"]),
  ].map(row=>row.map(cell).join(",")).join("\r\n");
}
