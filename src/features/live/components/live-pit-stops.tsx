"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, Wrench } from "lucide-react";
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";
import { useLive } from "./live-provider";
import { compoundText, tyreAgeText } from "../lib/format";
import { sessionCapabilities } from "../lib/session";
import { pitSeconds, pitTyres, tyreSegments } from "../lib/pit-strategy";
import type { LiveStint } from "../lib/types";

const noStints: LiveStint[] = [];
const compounds = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];
const time = (timestamp: string) => Number.isFinite(Date.parse(timestamp))
  ? new Date(timestamp).toLocaleTimeString("ru-RU", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  : "—";

function Tyre({ compound }: { compound: string | null }) {
  const name = compoundText[compound ?? ""];
  return (
    <span className="live-tyre" data-compound={compound} title={name ?? "Шины пока неизвестны"}>
      <b>{name ? compound?.[0] : "?"}</b>
    </span>
  );
}

export function PitStops({ selected, onSelect }: {
  selected: number | null;
  onSelect: (driverNumber: number) => void;
}) {
  const drivers = useLive("drivers"),
    pits = useLive("pits"),
    stints = useLive("stints") ?? noStints,
    session = useLive("session"),
    currentLap = useLive("currentLap"),
    totalLaps = useLive("totalLaps");
  const [filter, setFilter] = useState<number | null>(null);
  const [selectedPit, setSelectedPit] = useState<string | null>(null);
  const race = sessionCapabilities(session).showRaceGap;
  const rows = useMemo(() => Object.values(drivers)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.driverNumber - b.driverNumber)
    .filter((driver) => filter === null || driver.driverNumber === filter)
    .map((driver) => ({
      driver,
      segments: tyreSegments(driver, stints, pits, race),
      stops: pits.filter((pit) => pit.driverNumber === driver.driverNumber)
        .sort((a, b) => a.lap - b.lap || Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    })), [drivers, filter, pits, race, stints]);
  const visiblePits = pits
    .filter((pit) => drivers[pit.driverNumber] && (filter === null || pit.driverNumber === filter))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const active = visiblePits.find((pit) => pit.id === selectedPit) ?? visiblePits[0];
  const activeRow = rows.find((row) => row.driver.driverNumber === active?.driverNumber);
  const tyres = active && activeRow ? pitTyres(active, activeRow.segments) : null;
  // Keep one shared scale even when filtering to a lapped or retired driver.
  const maxLap = Math.max(1, currentLap,
    ...Object.values(drivers).map((driver) => driver.lap),
    ...pits.map((pit) => pit.lap ?? 0));
  const extent = race ? Math.max(totalLaps ?? 0, maxLap) : Math.max(10, Math.ceil(maxLap / 10) * 10);
  const step = extent > 30 ? 10 : 5;
  const ticks = [...new Set([
    0, ...Array.from({ length: Math.floor(extent / step) }, (_, i) => (i + 1) * step), extent,
  ])];
  const percent = (lap: number) => `${Math.min(100, Math.max(0, lap / extent * 100))}%`;
  const activeIndex = activeRow?.stops.findIndex((pit) => pit.id === active?.id) ?? -1;
  const legend = compounds.filter((compound) =>
    ["SOFT", "MEDIUM", "HARD"].includes(compound) ||
    rows.some((row) => row.segments.some((set) => set.compound === compound)));

  return (
    <div className="live-pits">
      <header className="live-pits-header">
        <div>
          <h2>Пит-стопы</h2>
          <p>Каждый отрезок — отдельный комплект</p>
        </div>
        <select
          aria-label="Пилот на шкале пит-стопов"
          value={filter ?? ""}
          onChange={(event) => setFilter(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">Все пилоты</option>
          {Object.values(drivers)
            .sort((a, b) => a.acronym.localeCompare(b.acronym))
            .map((driver) => (
              <option key={driver.driverNumber} value={driver.driverNumber}>
                {driver.acronym} · {driver.fullName}
              </option>
            ))}
        </select>
        <div className="live-pits-legend">
          {legend.map((compound) => (
            <span key={compound}><Tyre compound={compound} />{compoundText[compound]}</span>
          ))}
        </div>
      </header>
      {!rows.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Wrench /></EmptyMedia>
            <EmptyTitle>Ждём первые круги</EmptyTitle>
            <EmptyDescription>Здесь появятся комплекты шин и заезды пилотов в боксы.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="live-pits-scroll" tabIndex={0} aria-label="Шкала комплектов шин и пит-стопов">
          <div className="live-pits-chart" style={{ "--pit-progress": percent(currentLap) } as CSSProperties}>
            <div className="live-pits-axis">
              <span>Пилот</span>
              <div>
                {ticks.map((tick) => (
                  <span key={tick} style={{ left: percent(tick) }}>{tick === 0 ? 1 : tick}</span>
                ))}
                {currentLap > 0 && (
                  <b className="live-pits-now" style={{ left: percent(currentLap) }}>{currentLap}-й круг</b>
                )}
              </div>
              <span>Питы</span>
            </div>
            {rows.map(({ driver, segments, stops }) => (
              <div className="live-pits-row" key={driver.driverNumber} data-selected={selected === driver.driverNumber}>
                <button
                  className="live-pits-driver"
                  onClick={() => onSelect(driver.driverNumber)}
                  aria-label={`Выбрать ${driver.fullName}`}
                >
                  <small>{driver.position?.toString().padStart(2, "0") ?? "—"}</small>
                  <i style={{ background: driver.teamColour }} />
                  <strong>{driver.acronym}</strong>
                </button>
                <div className="live-pits-lane">
                  {ticks.map((tick) => (
                    <i className="live-pits-gridline" key={tick} style={{ left: percent(tick) }} />
                  ))}
                  {segments.filter((set) => set.end >= set.start).map((set) => (
                    <div
                      key={set.id}
                      className="live-pits-set"
                      data-compound={set.compound}
                      data-estimated={set.estimated}
                      style={{ left: percent(set.start - 1), width: percent(set.end - set.start + 1) }}
                      title={`${compoundText[set.compound ?? ""] ?? "Шины пока неизвестны"} · круги ${set.start}–${set.end} · ${set.end - set.start + 1} кр.`}
                    >
                      <Tyre compound={set.compound} /><span>{set.end - set.start + 1} кр.</span>
                    </div>
                  ))}
                  {stops.filter((pit) => pit.lap > 0).map((pit, index) => (
                    <button
                      key={pit.id}
                      className="live-pits-marker"
                      data-active={active?.id === pit.id}
                      style={{ left: percent(pit.lap) }}
                      aria-pressed={active?.id === pit.id}
                      aria-label={`${driver.acronym}, пит-стоп ${index + 1}, ${pit.lap}-й круг, остановка ${pitSeconds(pit.duration)}, заезд ${time(pit.timestamp)}`}
                      onClick={() => { setSelectedPit(pit.id); onSelect(driver.driverNumber); }}
                    >
                      <span>{pitSeconds(pit.duration)}</span><i />
                    </button>
                  ))}
                </div>
                <b className="live-pits-count">{stops.length}</b>
              </div>
            ))}
          </div>
        </div>
      )}
      {active && activeRow && tyres ? (
        <section className="live-pits-detail" aria-label="Подробности пит-стопа">
          <div className="live-pits-detail-heading">
            <h3>{activeRow.driver.acronym} · Пит-стоп {activeIndex + 1}</h3>
            <p>{active.lap > 0 ? `${active.lap}-й круг · ` : ""}Заезд {time(active.timestamp)}</p>
          </div>
          <dl>
            <div><dd>{pitSeconds(active.duration)}</dd><dt>Остановка</dt></div>
            <div><dd>{pitSeconds(active.laneDuration, 1)}</dd><dt>Пит-лейн</dt></div>
            <div>
              <dd className="live-pits-change">
                <Tyre compound={tyres.before} /><ArrowRight aria-hidden="true" /><Tyre compound={tyres.after} />
              </dd>
              <dt>{active.duration === 0 ? "Проезд без остановки" : tyres.confirmedChange ? "Смена комплекта" : tyres.changed ? "Ждём данные о комплекте" : "Шины"}</dt>
            </div>
          </dl>
          <p className="live-pits-age">
            {tyres.ageBefore !== null
              ? `${tyres.confirmedChange ? "Снятый комплект" : "Комплект до заезда"}: ${tyres.ageBefore} кр.`
              : tyres.lapsBefore !== null ? `До пита: ${tyres.lapsBefore} кр. на комплекте` : "Пробег комплекта пока неизвестен"}
            <span>Сейчас: {tyreAgeText(activeRow.driver)} кр. на комплекте</span>
          </p>
          <div className="live-pits-history" aria-label={`Все заезды ${activeRow.driver.acronym} в боксы`}>
            {activeRow.stops.map((pit, index) => (
              <button key={pit.id} aria-pressed={active.id === pit.id} onClick={() => setSelectedPit(pit.id)}>
                Пит {index + 1} · {pit.lap > 0 ? `${pit.lap} кр.` : time(pit.timestamp)}
              </button>
            ))}
          </div>
        </section>
      ) : rows.length ? (
        <div className="live-pits-empty">Заездов в боксы пока нет. Нажмите на отметку пита, когда она появится.</div>
      ) : null}
    </div>
  );
}
