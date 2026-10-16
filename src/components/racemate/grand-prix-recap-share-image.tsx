/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react";

import { RaceSideLogoSvg } from "@/components/racemate/racemate-logo";
import { getGrandPrixRecapImageLayout, type GrandPrixRecapData } from "@/lib/grand-prix-recap";
import { buildRecapPositionChart } from "@/lib/grand-prix-recap-chart";

type GrandPrixRecapShareImageData = Omit<GrandPrixRecapData, "podium"> & {
  podium: Array<GrandPrixRecapData["podium"][number] & { avatarUrl: string | null }>;
};

const colors = {
  background: "#070707",
  border: "#444448",
  grid: "#252528",
  muted: "#b8b8c0",
  primary: "#e10600",
  text: "#f5f4f2",
};
const column: CSSProperties = { display: "flex", flexDirection: "column", flexShrink: 0 };
const heading: CSSProperties = { display: "flex", fontSize: 27, fontWeight: 900, height: 32 };

export function GrandPrixRecapShareImage({ data }: { data: GrandPrixRecapShareImageData }) {
  const layout = getGrandPrixRecapImageLayout(data.raceName);
  const meta = [data.circuitName, data.dateLabel, data.totalLaps ? `${data.totalLaps} ${plural(data.totalLaps, "круг", "круга", "кругов")}` : null].filter(Boolean).join(" / ");
  return (
    <div style={{ ...column, backgroundColor: colors.background, color: colors.text, fontFamily: "Geist", height: "100%", padding: "24px 32px 48px", position: "relative", width: "100%" }}>
      <header style={{ alignItems: "center", borderBottom: `1px solid ${colors.border}`, display: "flex", flexShrink: 0, height: 58, justifyContent: "space-between", paddingBottom: 12 }}>
        <RaceSideLogoSvg palette="dark" width={312} />
        <span style={{ color: colors.muted, display: "flex", fontSize: 16 }}>СЕЗОН {data.season} / ЭТАП {data.round}</span>
      </header>
      <section style={{ ...column, borderBottom: `1px solid ${colors.border}`, height: layout.heroHeight, justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: layout.titleFontSize, fontWeight: 900, height: layout.titleHeight, letterSpacing: "-0.025em", lineHeight: layout.titleLineHeight }}>{data.raceName}</div>
        <div style={{ color: colors.muted, display: "flex", fontSize: meta.length > 72 ? 21 : 25, marginTop: layout.titleMetaMarginTop }}>{meta}</div>
      </section>
      <section style={{ borderBottom: `1px solid ${colors.border}`, display: "flex", flexShrink: 0, height: 148 }}>
        {data.podium.map((entry, index) => <PodiumEntry entry={entry} index={index} key={entry.position} />)}
      </section>
      <PositionsChart data={data} />
      <section style={{ borderBottom: `1px solid ${colors.border}`, borderTop: `1px solid ${colors.border}`, display: "flex", flexShrink: 0, height: 96, padding: "9px 0" }}>
        <StatCell label="Лучший круг" value={data.fastestLap?.time ?? "—"} detail={data.fastestLap ? surname(data.fastestLap.driver) : "—"} index={0} />
        <StatCell label="Больше всего позиций" value={data.positionGain ? `+${data.positionGain.gained}` : "—"} detail={data.positionGain ? surname(data.positionGain.driver) : "—"} index={1} />
        <StatCell label="На финише" value={data.finishers === null ? "—" : `${data.finishers} из ${data.starters}`} detail={data.retirements === null ? "—" : `${data.retirements} ${plural(data.retirements, "сход", "схода", "сходов")}`} index={2} />
        <StatCell label="Команда этапа" value={data.bestTeam.pointsComplete ? points(data.bestTeam.points) : "—"} detail={data.bestTeam.pointsComplete ? data.bestTeam.name : "—"} index={3} />
      </section>
      <section style={{ ...column, borderBottom: `1px solid ${colors.border}`, height: 196, paddingTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <ClassificationColumn entries={data.classification.slice(0, 5)} />
          <div style={{ borderLeft: `1px solid ${colors.border}`, display: "flex", width: 1 }} />
          <ClassificationColumn entries={data.classification.slice(5, 10)} />
        </div>
      </section>
      <section style={{ ...column, height: 110, paddingTop: 8 }}>
        <div style={heading}>Чемпионат после этапа</div>
        {data.championship.length >= 3 ? (
          <div style={{ display: "flex", height: 66 }}>
            {data.championship.map((entry, index) => (
              <div key={entry.id} style={{ alignItems: "center", ...(index ? { borderLeft: `1px solid ${colors.border}` } : {}), display: "flex", flex: 1, padding: "0 20px" }}>
                <span style={{ display: "flex", fontSize: 49, fontWeight: 900, marginRight: 20 }}>{entry.position}</span>
                <div style={column}>
                  <span style={{ display: "flex", fontSize: 21 }}>{surname(entry.name)}</span>
                  <span style={{ display: "flex", fontSize: 27, fontWeight: 900 }}>{points(entry.points)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: colors.muted, display: "flex", fontSize: 21, marginTop: 10 }}>Таблица чемпионата ещё не обновилась</div>}
      </section>
      <footer style={{ alignItems: "center", backgroundColor: colors.primary, bottom: 0, display: "flex", height: 48, justifyContent: "space-between", left: 0, padding: "0 32px", position: "absolute", width: "100%" }}>
        <span style={{ display: "flex", fontSize: 23, fontWeight: 900 }}>Полный отчёт на RaceSide</span>
        <span style={{ display: "flex", fontSize: 22 }}>raceside.online</span>
      </footer>
    </div>
  );
}

function PodiumEntry({ entry, index }: { entry: GrandPrixRecapShareImageData["podium"][number]; index: number }) {
  const parts = entry.driver.trim().split(/\s+/);
  return (
    <div style={{ ...(index ? { borderLeft: `1px solid ${colors.border}` } : {}), display: "flex", flex: 1, margin: "12px 0", padding: "0 12px", position: "relative" }}>
      <div style={{ ...column, justifyContent: "space-between", width: 94 }}>
        <span style={{ color: entry.position === 1 ? colors.primary : colors.text, display: "flex", fontSize: 32, fontWeight: 900, height: 35 }}>P{entry.position}</span>
        {entry.avatarUrl ? <img alt="" height={86} src={entry.avatarUrl} style={{ height: 86, objectFit: "contain", width: 86 }} width={86} />
          : <div style={{ alignItems: "center", color: entry.teamColor, display: "flex", fontSize: 29, height: 86, justifyContent: "center", width: 86 }}>{parts.slice(0, 2).map((part) => part[0]).join("")}</div>}
      </div>
      <div style={{ ...column, flex: 1, justifyContent: "center", paddingLeft: 8 }}>
        <span style={{ display: "flex", fontSize: 22, fontWeight: 900, lineHeight: 1.05 }}>{parts.length > 1 ? parts[0] : entry.driver}</span>
        {parts.length > 1 && <span style={{ display: "flex", fontSize: 22, fontWeight: 900, lineHeight: 1.05 }}>{parts.at(-1)}</span>}
        <span style={{ color: colors.muted, display: "flex", fontSize: entry.team.length > 20 ? 15 : 17, marginTop: 4 }}>{entry.team}</span>
        <span style={{ display: "flex", fontSize: 22, fontWeight: 900, marginTop: 4 }}>{compactTime(entry.raceTime ?? entry.gapToWinner) ?? "—"}</span>
        <span style={{ color: colors.muted, display: "flex", fontSize: 17, marginTop: 2 }}>{entry.points === null ? "—" : points(entry.points)}</span>
      </div>
    </div>
  );
}

function PositionsChart({ data }: { data: GrandPrixRecapShareImageData }) {
  const chart = buildRecapPositionChart(data.positionDrivers, data.totalLaps, 1016, 464);
  const legendColumns = Math.max(1, Math.ceil(data.positionDrivers.length / 2));
  return (
    <section style={{ ...column, height: 528, padding: "8px 0" }}>
      <div style={{ display: "flex", flexShrink: 0, height: chart.height, position: "relative", width: chart.width }}>
        {chart.hasTiming ? <>
          <svg height={chart.height} width={chart.width} xmlns="http://www.w3.org/2000/svg" style={{ left: 0, position: "absolute", top: 0 }}>
            {chart.positionTicks.map((tick) => <path d={`M${chart.left} ${tick.y}H${chart.right}`} fill="none" key={`p${tick.value}`} stroke={colors.grid} strokeWidth={1} />)}
            {chart.lapTicks.map((tick) => <path d={`M${tick.x} ${chart.top}V${chart.bottom}`} fill="none" key={`l${tick.value}`} stroke={colors.grid} strokeWidth={1} />)}
            {[...chart.traces].reverse().map((trace) => <path d={trace.path} fill="none" key={trace.driver} opacity={0.92} stroke={trace.color} strokeLinejoin="round" strokeWidth={2} />)}
            {chart.endLabels.map((label) => <path d={`M${label.point.x} ${label.point.y}L${chart.right + 3} ${label.y}`} fill="none" key={label.code} opacity={0.35} stroke={label.color} strokeWidth={1} />)}
            {chart.traces.map((trace) => trace.last ? <circle cx={trace.last.x} cy={trace.last.y} fill={trace.color} key={trace.driver} r={2.5} /> : null)}
          </svg>
          {chart.positionTicks.map((tick) => <span key={tick.value} style={{ color: colors.muted, display: "flex", fontSize: 17, justifyContent: "flex-end", left: 0, position: "absolute", top: tick.y - 11, width: 34 }}>P{tick.value}</span>)}
          {chart.lapTicks.map((tick) => <span key={tick.value} style={{ color: colors.muted, display: "flex", fontSize: 17, justifyContent: "center", left: tick.x - 20, position: "absolute", top: chart.bottom + 9, width: 40 }}>{tick.value}</span>)}
          <span style={{ color: colors.muted, display: "flex", fontSize: 15, left: chart.right + 17, position: "absolute", top: chart.bottom + 11 }}>Круг</span>
          {chart.endLabels.map((label) => <span key={label.code} style={{ display: "flex", fontSize: 14, left: chart.right + 9, position: "absolute", top: label.y - 9 }}>{label.code}</span>)}
          {chart.traces.filter((trace) => !trace.finished && trace.last).map((trace) => <span key={trace.driver} style={{ color: trace.color, display: "flex", fontSize: 17, left: Math.min(chart.right - 14, trace.last!.x + 6), position: "absolute", top: trace.last!.y - 11 }}>×</span>)}
        </> : <div style={{ alignItems: "center", color: colors.muted, display: "flex", fontSize: 24, height: "100%", justifyContent: "center", width: "100%" }}>Позиции по кругам пока недоступны</div>}
      </div>
      <div style={{ display: "flex", flexShrink: 0, flexWrap: "wrap", height: 48 }}>
        {data.positionDrivers.map((driver) => <div key={driver.driver} style={{ alignItems: "center", display: "flex", height: 24, width: Math.floor(chart.width / legendColumns) }}>
          <span style={{ backgroundColor: driver.color, display: "flex", height: 3, marginRight: 9, width: 22 }} />
          <span style={{ display: "flex", fontSize: 15 }}>{driver.code}</span>
        </div>)}
      </div>
    </section>
  );
}

function StatCell({ label, value, detail, index }: { label: string; value: string; detail: string; index: number }) {
  return <div style={{ ...column, alignItems: "center", ...(index ? { borderLeft: `1px solid ${colors.border}` } : {}), flex: 1, padding: "0 8px" }}>
    <span style={{ display: "flex", fontSize: label.length > 18 ? 17 : 19, height: 23 }}>{label}</span>
    <span style={{ display: "flex", fontSize: 31, fontWeight: 900, height: 32, lineHeight: 1 }}>{value}</span>
    <span style={{ display: "flex", fontSize: detail.length > 24 ? 16 : 19, height: 22, marginTop: 2 }}>{detail}</span>
  </div>;
}

function ClassificationColumn({ entries }: { entries: GrandPrixRecapData["classification"] }) {
  return <div style={{ ...column, width: 494 }}>
    <div style={{ color: colors.muted, display: "flex", fontSize: 17, height: 25 }}>
      <span style={{ display: "flex", width: 35 }}>#</span>
      <span style={{ display: "flex", width: 255 }}>Пилот</span>
      <span style={{ display: "flex", width: 132 }}>Отрыв</span>
      <span style={{ display: "flex", justifyContent: "flex-end", width: 72 }}>Очки</span>
    </div>
    {entries.map((entry) => <div key={entry.position} style={{ alignItems: "center", borderTop: `1px solid ${colors.border}`, display: "flex", fontSize: 21, height: 32 }}>
      <span style={{ display: "flex", width: 35 }}>{entry.position}</span>
      <span style={{ alignItems: "center", display: "flex", width: 255 }}>
        <span style={{ backgroundColor: entry.teamColor, display: "flex", height: 17, marginRight: 12, width: 17 }} />
        <span style={{ display: "flex" }}>{surname(entry.driver)}</span>
      </span>
      <span style={{ display: "flex", fontSize: 19, width: 132 }}>{compactTime(entry.gap) ?? "—"}</span>
      <span style={{ display: "flex", fontWeight: 900, justifyContent: "flex-end", width: 72 }}>{entry.points === null ? "—" : formatNumber(entry.points)}</span>
    </div>)}
  </div>;
}

function surname(name: string) {
  return name.trim().split(/\s+/).at(-1) ?? name;
}

function compactTime(value: string | null) {
  if (!value) return null;
  return value.replace(/^(\d+) ч (\d+) мин (\d+(?:[.,]\d+)?) с$/, "$1:$2:$3")
    .replace(/ с$/, "").replace(/(\d),(\d)/g, "$1.$2")
    .replace(/^(\d+)\s+Lap(?:s)?$/i, "+$1 кр.")
    .replace(/^\+(\d+)\s+Lap(?:s)?$/i, "+$1 кр.");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function points(value: number) {
  return `${formatNumber(value)} ${plural(value, "очко", "очка", "очков")}`;
}

function plural(value: number, one: string, few: string, many: string) {
  const hundred = Math.abs(value) % 100, ten = hundred % 10;
  return hundred >= 11 && hundred <= 14 ? many : ten === 1 ? one : ten >= 2 && ten <= 4 ? few : many;
}
