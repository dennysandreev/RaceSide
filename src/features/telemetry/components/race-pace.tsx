"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, Share2, Cog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type { RacePace, RacePacePoint, Session } from "../lib/types";
import { telemetryRequest } from "../lib/client";
import { lapTime, teamColor } from "../lib/format";
import {
  compoundLabels,
  paceCsv,
  paceReasonLabels,
  paceSeries,
  paceCompounds,
  compoundColors,
  togglePaceCompound,
  selectedCompounds,
  paceValue,
  isPaceLap,
  paceLapRange,
  paceDistribution,
  paceDistributionCsv,
  type PaceLapRange,
  type PaceAxis,
  type PaceSection,
  type PaceDistributionScope,
} from "../lib/race-pace";
import { isRaceSession } from "../../../../worker/telemetry/race-pace.mjs";
import { TelemetryShare } from "./telemetry-share";
import { RacePaceDistribution } from "./race-pace-distribution";
import "./race-pace.css";

export type RacePaceView = {
  axis?: PaceAxis;
  compound?: string;
  compounds?: string[];
  drivers?: number[];
  hidePits?: boolean;
  hideSafetyCar?: boolean;
  trend?: boolean;
  field?: boolean;
  lapRange?: PaceLapRange;
  section?: PaceSection;
  distributionScope?: PaceDistributionScope;
};
export function RacePaceWorkspace({
  session,
  initialView = {},
  onReady,
  actionsContainer,
}: {
  session: Session;
  initialView?: RacePaceView;
  onReady?: (data: RacePace) => void;
  actionsContainer?: HTMLElement | null;
}) {
  const [result, setResult] = useState<{
    session: number;
    data?: RacePace;
    error?: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const race = isRaceSession(session);
  const sessionId = session.id;
  useEffect(() => {
    if (!race) return;
    const controller = new AbortController();
    void telemetryRequest<RacePace>(`race-pace?session=${sessionId}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setResult({ session: sessionId, data });
          onReady?.(data);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            session: sessionId,
            error:
              error instanceof Error
                ? error.message
                : "Не удалось загрузить темп гонки.",
          });
      });
    return () => controller.abort();
  }, [sessionId, race, retry, onReady]);
  if (!isRaceSession(session))
    return (
      <PaceEmpty
        title="Нужна завершённая гонка"
        description="Выберите гонку или спринт, чтобы посмотреть темп всех пилотов."
      />
    );
  if (result?.session !== session.id)
    return (
      <div className="race-pace-loading" role="status">
        <Cog className="telemetry-loading-gear" aria-hidden="true" />
        <div>
          <strong>Готовим темп гонки</strong>
          <p>Загрузка может занять время</p>
        </div>
      </div>
    );
  if (result.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Не удалось открыть темп гонки</AlertTitle>
        <AlertDescription>
          {result.error}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setResult(null);
              setRetry((value) => value + 1);
            }}
          >
            Попробовать ещё раз
          </Button>
        </AlertDescription>
      </Alert>
    );
  return result.data ? (
    <RacePaceAnalysis
      key={session.id}
      data={result.data}
      initialView={initialView}
      actionsContainer={actionsContainer}
    />
  ) : null;
}
function PaceEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Empty className="race-pace-empty">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function RacePaceAnalysis({
  data,
  initialView = {},
  actionsContainer,
}: {
  data: RacePace;
  initialView?: RacePaceView;
  actionsContainer?: HTMLElement | null;
}) {
  const mobile = useIsMobile();
  const [axis, setAxis] = useState<PaceAxis>(initialView.axis ?? "lap");
  const [section, setSection] = useState<PaceSection>(initialView.section ?? "trend");
  const [distributionScope, setDistributionScope] = useState<PaceDistributionScope>(initialView.distributionScope ?? "field");
  const distribution = section === "distribution";
  function changeChart(value: string) {
    setSection(value === "distribution" ? "distribution" : "trend");
    if (value === "lap" || value === "age") setAxis(value);
  }
  const [compounds, setCompounds] = useState(() => selectedCompounds(initialView.compounds ?? initialView.compound));
  const [hideSafetyCar, setHideSafetyCar] = useState(
    initialView.hideSafetyCar ?? true,
  );
  const [trend, setTrend] = useState(initialView.trend ?? true);
  const [field, setField] = useState(initialView.field ?? false);
  const [lapRange, setLapRange] = useState(() => paceLapRange(data.totalLaps, initialView.lapRange));
  const fullRace = lapRange[0] === 1 && lapRange[1] === data.totalLaps;
  const [shareOpen, setShareOpen] = useState(false);
  const [driversOpen, setDriversOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>(() => {
    const available = data.drivers.filter((driver) =>
      data.points.some(
        (point) => point.driver === driver.number && isPaceLap(point),
      ),
    );
    return initialView.drivers !== undefined
      ? initialView.drivers
          .filter(
            (id, index, ids) =>
              ids.indexOf(id) === index &&
              available.some((driver) => driver.number === id),
          )
          .slice(0, 6)
      : available.slice(0, 3).map((driver) => driver.number);
  });
  const series = useMemo(
    () => paceSeries(data, distribution ? "lap" : axis, compounds, { hidePits: true, hideSafetyCar, lapRange }),
    [data, axis, distribution, compounds, hideSafetyCar, lapRange],
  );
  const distributionRows = useMemo(() => paceDistribution(data, compounds,
    { hidePits: true, hideSafetyCar, lapRange }, distributionScope === "selected" ? selected : undefined),
    [data, compounds, hideSafetyCar, lapRange, distributionScope, selected]);
  const canExport = distribution ? distributionRows.length > 0 : series.some((item) => selected.includes(item.driver));
  const visible = series.filter((item) => field || selected.includes(item.driver));
  const colors = new Map(data.drivers.map((driver) => [driver.number, teamColor(driver)]));
  const selectedPoints = series
    .filter((item) => selected.includes(item.driver))
    .flatMap((item) => item.points);
  const times = selectedPoints.map((point) => paceValue(point, trend)!);
  const domain: [number, number] = times.length
    ? [
        Math.floor(Math.min(...times) - 0.5),
        Math.ceil(Math.max(...times) + 0.5),
      ]
    : [0, 1];
  const minX = axis === "lap" ? lapRange[0] : 0;
  const maxX =
    axis === "lap"
      ? lapRange[1]
      : Math.max(1, ...selectedPoints.map((point) => point.x));
  function toggleDriver(id: number) {
    setSelected((old) =>
      old.includes(id)
        ? old.filter((driver) => driver !== id)
        : old.length < 6
          ? [...old, id]
          : old,
    );
  }
  const shareParams = new URLSearchParams({
    axis, compounds: compounds.join(","), drivers: selected.join(","),
    safety: hideSafetyCar ? "1" : "0", trend: trend ? "1" : "0", field: field ? "1" : "0",
  });
  if (distribution) {
    shareParams.set("view", "distribution");
    shareParams.set("scope", distributionScope);
  }
  if (!fullRace) {
    shareParams.set("from", String(lapRange[0]));
    shareParams.set("to", String(lapRange[1]));
  }
  const shareImage = `/api/share-image/race-pace/${data.session.id}?${shareParams}`;
  const query = shareParams.toString();
  useEffect(() => {
    const url = new URL("/telemetry", window.location.origin);
    url.search = query;
    url.searchParams.set("mode", "race-pace");
    url.searchParams.set("season", String(data.session.season));
    url.searchParams.set("meeting", String(data.session.meetingId));
    url.searchParams.set("session", String(data.session.id));
    window.history.replaceState(window.history.state, "", url);
  }, [query, data.session]);
  const tyreButtons = (
    <div className="race-pace-tyres" role="group" aria-label="Составы шин">
      <button type="button" aria-label="Все шины" title="Все шины"
        aria-pressed={selectedCompounds("ALL").every((value) => compounds.includes(value))}
        onClick={() => setCompounds(selectedCompounds("ALL"))}>
        <svg width="36" height="36" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="23" fill="#151619" stroke="#45464b" />
          <circle cx="24" cy="24" r="18" fill="#242529" />
          {paceCompounds.map((value, index) => <circle key={value} cx="24" cy="24" r="18" fill="none"
            stroke={compoundColors[value]} strokeWidth="4" strokeDasharray="20 94" strokeDashoffset={-index * 22.6} transform="rotate(-90 24 24)" />)}
          <circle cx="24" cy="24" r="13" fill="#151619" stroke="#404147" />
          <text x="24" y="27.5" textAnchor="middle" fill="#eeeeef" fontSize="10" fontWeight="700">ВСЕ</text>
        </svg>
      </button>
      {paceCompounds.map((value) => (
        <button key={value} type="button" aria-label={compoundLabels[value]} title={compoundLabels[value]}
          aria-pressed={compounds.includes(value)}
          onClick={() => setCompounds((old) => togglePaceCompound(old, value))}>
          <svg width="36" height="36" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="23" fill="#151619" stroke="#45464b" />
            <circle cx="24" cy="24" r="18" fill="#242529" stroke={compoundColors[value]} strokeWidth="4" />
            <circle cx="24" cy="24" r="13" fill="#151619" stroke="#404147" />
            {(value === "INTERMEDIATE" || value === "WET") && [0,45,90,135,180,225,270,315].map((angle) => (
              <path key={angle} d="M23 1L20 5M28 1L25 5" stroke="#6c6e76" strokeWidth="1.3" transform={`rotate(${angle} 24 24)`} />
            ))}
            <text x="24" y="29" textAnchor="middle" fill={compoundColors[value]} fontSize="15" fontWeight="700">{value[0]}</text>
          </svg>
        </button>
      ))}
    </div>
  );
  function download() {
    const blob = new Blob([distribution ? paceDistributionCsv(distributionRows) : paceCsv(selectedPoints, data.drivers)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `raceside-pace-${distribution ? "distribution-" : ""}${data.session.id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const filterControls = (
    <div className="race-pace-filters">
      <label>
        <Checkbox
          checked={hideSafetyCar}
          onCheckedChange={(value) => setHideSafetyCar(value === true)}
        />
        Без кругов под SC / VSC
      </label>
      {!distribution && <label>
        <Checkbox
          checked={trend}
          onCheckedChange={(value) => setTrend(value === true)}
        />
        Сгладить темп
      </label>}
      <label>
        <Checkbox
          checked={distribution ? distributionScope === "selected" : field}
          onCheckedChange={(value) => distribution
            ? setDistributionScope(value === true ? "selected" : "field")
            : setField(value === true)}
        />
        {distribution ? "Только выбранные пилоты" : "Показать остальных"}
      </label>
    </div>
  );
  const actions = (
    <div className="race-pace-actions">
      <Button variant="outline" data-slot="button" aria-label="CSV"
        disabled={!canExport} onClick={download}>
        <Download aria-hidden="true" /><span>CSV</span>
      </Button>
      <Button
        data-slot="button"
        variant="outline"
        aria-label="Поделиться"
        disabled={!canExport}
        onClick={() => setShareOpen(true)}
      >
        <Share2 aria-hidden="true" />
        <span>Поделиться</span>
      </Button>
    </div>
  );
  const driverRail = (
    <aside className="race-pace-drivers" aria-label="Пилоты для сравнения">
      <header>
        <h3>
          Пилоты <span>{data.drivers.length}</span>
        </h3>
        <p>Выбрано {selected.length} из 6</p>
      </header>
      <div className="race-pace-driver-list">
        {data.drivers.map((driver) => {
          const points = series
            .filter((item) => item.driver === driver.number)
            .flatMap((item) => item.points);
          const hasTime = data.points.some(
            (point) => point.driver === driver.number && isPaceLap(point),
          );
          return (
            <label
              className="race-pace-driver"
              key={driver.number}
              data-selected={selected.includes(driver.number)}
            >
              <Checkbox
                checked={selected.includes(driver.number)}
                disabled={
                  !hasTime ||
                  (!selected.includes(driver.number) && selected.length >= 6)
                }
                onCheckedChange={() => toggleDriver(driver.number)}
              />
              <span
                className="race-pace-driver-code"
                style={{ color: colors.get(driver.number) }}
              >
                {driver.code}
              </span>
              <span className="race-pace-driver-name">
                {driver.name}
                <small>{driver.team}</small>
              </span>
              <span className="race-pace-driver-count">
                {points.length}
                <small>кр.</small>
              </span>
            </label>
          );
        })}
      </div>
    </aside>
  );
  return (
    <>
      {actionsContainer && createPortal(actions, actionsContainer)}
      <div className="race-pace-toolbar telemetry-workspace-toolbar">
        <select className="telemetry-mobile-view" aria-label="Как сравнить темп" value={distribution ? "distribution" : axis}
          onChange={(event) => changeChart(event.target.value)}>
          <option value="lap">По кругам гонки</option><option value="age">По возрасту шин</option>
          <option value="distribution">Распределение темпа</option>
        </select>
        <Tabs value={distribution ? "distribution" : axis} onValueChange={changeChart}>
          <TabsList className="telemetry-view-tabs" aria-label="Как сравнить темп">
            <TabsTrigger value="lap">По кругам гонки</TabsTrigger>
            <TabsTrigger value="age">По возрасту шин</TabsTrigger>
            <TabsTrigger value="distribution">Распределение темпа</TabsTrigger>
          </TabsList>
        </Tabs>
        {tyreButtons}
      </div>
      <section className="race-pace-workspace" aria-label="Темп гонки" data-section={section}>
        <div className="race-pace-body">
          <div className="race-pace-main">
            <header className="race-pace-chart-heading telemetry-chart-heading">
              <h3>{distribution ? "Распределение темпа" : "Как менялся темп"}</h3>
              <div className="race-pace-filter-controls">{filterControls}</div>
              <Button className="race-pace-filter-toggle" variant="outline" size="sm"
                onClick={() => setFiltersOpen(true)}>Фильтры</Button>
              <Button
                className="race-pace-driver-toggle"
                variant="outline"
                size="sm"
                onClick={() => setDriversOpen(true)}
              >
                Пилоты · {distribution && distributionScope === "field" ? "все" : selected.length}
              </Button>
            </header>
            <div
              className="race-pace-plot"
              aria-label={distribution ? "Распределение темпа" : `Время круга по ${axis === "age" ? "возрасту шин" : "кругам гонки"}`}
            >
              {distribution ? (distributionRows.length ? <RacePaceDistribution rows={distributionRows} /> :
                <PaceEmpty title={distributionScope === "selected" && !selected.length ? "Выберите пилотов" : "Нет кругов для этого сравнения"}
                  description={distributionScope === "selected" && !selected.length ? "Отметьте пилотов или покажите весь пелотон." : "Расширьте диапазон кругов или измените фильтры."} />
              ) : !selected.length ? (
                <PaceEmpty
                  title="Выберите пилотов"
                  description="Отметьте до шести пилотов для сравнения."
                />
              ) : !selectedPoints.length ? (
                <PaceEmpty
                  title="Нет кругов для этого сравнения"
                  description={
                    axis === "age" && data.warnings.includes("MISSING_TYRES")
                      ? "Для части кругов неизвестен возраст шин. Попробуйте сравнение по кругам гонки."
                      : "Расширьте диапазон кругов или измените фильтры."
                  }
                />
              ) : (
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={{ width: 800, height: 480 }}
                >
                  <LineChart
                    margin={{ top: 12, right: mobile ? 12 : 26, left: mobile ? 0 : 4, bottom: 18 }}
                    accessibilityLayer
                  >
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeOpacity={0.6}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={minX === maxX ? [minX - 0.5, maxX + 0.5] : [minX, maxX]}
                      allowDataOverflow
                      allowDecimals={false}
                      ticks={axis === "lap" && minX === maxX ? [minX] : undefined}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickLine={false}
                      axisLine={false}
                      label={{
                        value:
                          axis === "age" ? "Возраст шин, кругов" : "Круг гонки",
                        position: "insideBottom",
                        offset: -14,
                        fill: "var(--muted-foreground)",
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      type="number"
                      domain={domain}
                      allowDataOverflow
                      width={mobile ? 44 : 74}
                      tickMargin={mobile ? 4 : 8}
                      tickFormatter={(value: number) =>
                        lapTime(value).slice(0, -2)
                      }
                      tick={{ fill: "var(--muted-foreground)", fontSize: mobile ? 11 : 12 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      isAnimationActive={false}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const points = [
                          ...new Map(
                            payload
                              .filter((row) => row.dataKey === "value")
                              .map((row) => {
                                const point = row.payload as RacePacePoint;
                                return [
                                  `${point.driver}:${point.lap}`,
                                  point,
                                ] as const;
                              }),
                          ).values(),
                        ].filter((point) => selected.includes(point.driver));
                        return points.length ? (
                          <div className="race-pace-tooltip">
                            <strong>
                              {axis === "age"
                                ? `Возраст шин: ${points[0].tyreAge} кр.`
                                : `Круг ${points[0].lap}`}
                            </strong>
                            {points.slice(0, 6).map((point) => (
                              <div key={`${point.driver}:${point.lap}`}>
                                <b style={{ color: colors.get(point.driver) }}>
                                  {
                                    data.drivers.find(
                                      (driver) => driver.number === point.driver,
                                    )?.code
                                  }
                                </b>
                                <strong>{lapTime(point.time)}</strong>
                                <small>
                                  Круг {point.lap} ·{" "}
                                  {compoundLabels[point.compound] ??
                                    point.compound}{" "}
                                  · комплект {point.stint ?? "?"} ·{" "}
                                  {point.tyreAge ?? "?"} кр.
                                </small>
                                {trend && point.trend != null && (
                                  <small>
                                    Сглаженный темп {lapTime(point.trend)}
                                  </small>
                                )}
                                {point.reasons.length > 0 && (
                                  <small>
                                    {point.reasons
                                      .map((reason) => paceReasonLabels[reason])
                                      .join(" · ")}
                                  </small>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null;
                      }}
                    />
                    {[...visible]
                      .sort(
                        (a, b) =>
                          Number(selected.includes(a.driver)) -
                          Number(selected.includes(b.driver)),
                      )
                      .flatMap((item) => {
                        const highlight = selected.includes(item.driver),
                          color = colors.get(item.driver);
                        return (
                          <Line key={item.key}
                            data={item.points.map((point) => ({ ...point, value: paceValue(point, trend) }))}
                            dataKey="value" name={item.key} type="linear" stroke={color}
                            strokeWidth={highlight ? 2.2 : 0.8} strokeOpacity={highlight ? 1 : 0.08}
                            dot={highlight ? { r: 2.3, fill: color, strokeWidth: 0 } : false}
                            activeDot={highlight ? { r: 4, fill: color, stroke: "var(--card)" } : false}
                            isAnimationActive={false} connectNulls={false}
                          />
                        );
                      })}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <section className="race-pace-range" aria-label="Отрезок гонки">
              <header>
                <span>{lapRange[0] === lapRange[1] ? `Круг ${lapRange[0]}` : `Круги ${lapRange[0]}–${lapRange[1]}`}</span>
                <Button variant="ghost" size="sm" disabled={fullRace}
                  onClick={() => setLapRange(paceLapRange(data.totalLaps))}>Вся гонка</Button>
              </header>
              <Slider min={1} max={Math.max(2, data.totalLaps)} step={1} value={lapRange}
                disabled={data.totalLaps < 2} thumbLabels={["Первый круг отрезка", "Последний круг отрезка"]}
                onValueChange={(value) => setLapRange(paceLapRange(data.totalLaps, value as PaceLapRange))} />
            </section>
            {!distribution && <><div className="race-pace-legend">
              {data.drivers
                .filter((driver) => selected.includes(driver.number))
                .map((driver) => (
                  <span
                    key={driver.number}
                    style={{ color: colors.get(driver.number) }}
                  >
                    <i />
                    {driver.code}
                  </span>
                ))}
            </div>
            <section className="race-pace-strategy" aria-label="Смена шин">
              <header>
                <h3>Смена шин</h3>
                <span>По кругам гонки</span>
              </header>
              <div className="race-pace-strategy-rows">
                {data.drivers
                  .filter((driver) => selected.includes(driver.number))
                  .map((driver) => (
                    <div className="race-pace-strategy-row" key={driver.number}>
                      <b style={{ color: colors.get(driver.number) }}>
                        {driver.code}
                      </b>
                      <div>
                        {data.stints
                          .filter((stint) => stint.driver === driver.number)
                          .map((stint) => (
                            <span
                              key={`${driver.number}-${stint.from}`}
                              className="race-pace-stint"
                              data-compound={stint.compound}
                              data-muted={
                                !compounds.includes(stint.compound)
                              }
                              style={{
                                left: `${((stint.from - 1) / data.totalLaps) * 100}%`,
                                width: `${((stint.to - stint.from + 1) / data.totalLaps) * 100}%`,
                              }}
                              title={`${driver.code} · ${compoundLabels[stint.compound] ?? stint.compound} · круги ${stint.from}–${stint.to} · возраст в начале ${stint.ageAtStart ?? "неизвестен"}`}
                            >
                              <strong>
                                {stint.compound === "UNKNOWN"
                                  ? "?"
                                  : stint.compound.slice(0, 1)}
                              </strong>
                              <small>
                                {stint.from}–{stint.to}
                              </small>
                            </span>
                          ))}
                        {!fullRace && <>
                          <span className="race-pace-range-shade" style={{ left: 0, width: `${(lapRange[0] - 1) / data.totalLaps * 100}%` }} />
                          <span className="race-pace-range-shade" style={{ right: 0, width: `${(data.totalLaps - lapRange[1]) / data.totalLaps * 100}%` }} />
                        </>}
                      </div>
                    </div>
                  ))}
              </div>
            </section></>}
          </div>
          {!distribution && <div className="race-pace-driver-rail">{driverRail}</div>}
        </div>
      </section>
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="telemetry-settings-dialog race-pace-filters-dialog">
          <DialogHeader>
            <DialogTitle>Настроить график</DialogTitle>
            <DialogDescription>
              Выберите шины и какие круги показать.
            </DialogDescription>
          </DialogHeader>
          {tyreButtons}
          {filterControls}
        </DialogContent>
      </Dialog>
      <Dialog open={driversOpen} onOpenChange={setDriversOpen}>
        <DialogContent className="race-pace-drivers-dialog">
          <DialogHeader>
            <DialogTitle>Пилоты для сравнения</DialogTitle>
            <DialogDescription>Отметьте до шести пилотов.</DialogDescription>
          </DialogHeader>
          {distribution && <label className="pace-distribution-scope">
            <Checkbox checked={distributionScope === "selected"}
              onCheckedChange={(value) => setDistributionScope(value === true ? "selected" : "field")} />
            Показывать только выбранных
          </label>}
          {driverRail}
        </DialogContent>
      </Dialog>
      <TelemetryShare open={shareOpen} onOpenChange={setShareOpen}
        imageSource={shareImage} title="Поделиться темпом гонки" />
    </>
  );
}
