"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { getTeamAsset } from "@/data/f1-assets";
import {
  reportChartRows,
  reportLapTime,
  type GrandPrixReportAnalytics,
  type ReportDriverTrace,
} from "@/lib/grand-prix-report";

type Metric = "positions" | "gaps" | "pace";
const format = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const colour = (driver: ReportDriverTrace) =>
  getTeamAsset(driver.team)?.color ?? "var(--foreground)";
const titles: Record<
  Metric,
  { title: string; description: string; unit: string }
> = {
  positions: {
    title: "Позиции по кругам",
    description: "Последний сохранённый замер на каждом круге пилота",
    unit: "Место",
  },
  gaps: {
    title: "Отрыв от лидера",
    description:
      "Последний замер на круге. Для отставших на круг секунды не показаны.",
    unit: "Секунды",
  },
  pace: {
    title: "Гоночный темп",
    description:
      "Сглаженное время чистых кругов. Пит-стопы, круги под флагами и пропуски разрывают линию.",
    unit: "Время круга",
  },
};

export function ReportTimingCharts({
  analytics,
  mode,
}: {
  analytics?: GrandPrixReportAnalytics | null;
  mode: "positions" | "pace";
}) {
  const available = (analytics?.drivers ?? []).filter((driver) =>
    (mode === "pace"
      ? driver.pace
      : [...driver.positions, ...driver.gaps]
    ).some((point) => point.value !== null),
  );
  const defaults = available.slice(0, 3).map((driver) => driver.number);
  // Until the user makes a choice, follow the first available traces. Timing
  // can arrive after the report opens; an initial empty list must not stick.
  const [selection, setSelectedNumbers] = useState<number[] | null>(null);
  const selectedNumbers = selection ?? defaults;
  const [expanded, setExpanded] = useState(false);
  const selected = available.filter((driver) =>
    selectedNumbers.includes(driver.number),
  );
  const changeSelection = (number: number) =>
    setSelectedNumbers((previous) => {
      const current = previous ?? defaults;
      return current.includes(number)
        ? current.filter((item) => item !== number)
        : current.length < 6
          ? [...current, number]
          : current;
    });
  return (
    <div className="rr-timing-charts">
      {available.length > 0 && (
        <fieldset className="rr-driver-picker">
          <legend>
            Пилоты на графике <span>До 6 одновременно</span>
          </legend>
          <div>
            {available
              .slice(0, expanded ? available.length : 8)
              .map((driver) => (
                <button
                  type="button"
                  key={driver.number}
                  aria-pressed={selectedNumbers.includes(driver.number)}
                  disabled={
                    !selectedNumbers.includes(driver.number) &&
                    selectedNumbers.length >= 6
                  }
                  onClick={() => changeSelection(driver.number)}
                >
                  <i style={{ background: colour(driver) }} />
                  {driver.driver.split(" ").slice(-1).join(" ")}
                </button>
              ))}
            {available.length > 8 && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Меньше пилотов" : "Все пилоты"}
              </Button>
            )}
          </div>
        </fieldset>
      )}
      {(mode === "pace"
        ? (["pace"] as const)
        : (["positions", "gaps"] as const)
      ).map((metric) => (
        <TimingChart
          key={metric}
          metric={metric}
          drivers={selected}
          totalLaps={analytics?.totalLaps ?? 1}
          fieldSize={analytics?.drivers.length ?? 22}
          hasAvailable={available.some((driver) =>
            driver[metric].some((point) => point.value !== null),
          )}
        />
      ))}
    </div>
  );
}

function TimingChart({
  metric,
  drivers,
  totalLaps,
  fieldSize,
  hasAvailable,
}: {
  metric: Metric;
  drivers: ReportDriverTrace[];
  totalLaps: number;
  fieldSize: number;
  hasAvailable: boolean;
}) {
  const data = useMemo(
    () => reportChartRows(drivers, metric, totalLaps),
    [drivers, metric, totalLaps],
  );
  const config = Object.fromEntries(
    drivers.map((driver) => [
      "driver" + driver.number,
      { label: driver.driver, color: colour(driver) },
    ]),
  ) satisfies ChartConfig;
  const visible = drivers.filter((driver) =>
    driver[metric].some((point) => point.value !== null),
  );
  const info = titles[metric];
  const finiteValues = data
    .flatMap((row) =>
      drivers.flatMap((driver) =>
        row["driver" + driver.number] === null
          ? []
          : [row["driver" + driver.number]!],
      ),
    )
    .filter(Number.isFinite);
  const minimum = Math.floor(Math.min(...finiteValues)),
    maximum = Math.ceil(Math.max(...finiteValues));
  const paceDomain = [
    Number.isFinite(minimum) ? minimum - 1 : 0,
    Number.isFinite(maximum) ? maximum + 1 : 100,
  ];
  return (
    <figure className="rr-chart-block">
      <figcaption>
        <h3>{info.title}</h3>
        <p className="rr-caption">{info.description}</p>
      </figcaption>
      {visible.length && finiteValues.length ? (
        <>
          <div className="rr-chart-axis-label">{info.unit}</div>
          <ChartContainer
            className="rr-chart"
            config={config}
            aria-label={info.title}
          >
            <LineChart
              accessibilityLayer
              data={data}
              margin={{ left: 0, right: 14, top: 8, bottom: 6 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="lap"
                type="number"
                domain={[1, Math.max(2, totalLaps)]}
                minTickGap={36}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
              />
              <YAxis
                reversed={metric === "positions"}
                ticks={
                  metric === "positions"
                    ? [...new Set([1, 5, 10, 15, 20, fieldSize])].filter(
                        (position) => position <= fieldSize,
                      )
                    : undefined
                }
                interval={metric === "positions" ? 0 : "preserveStartEnd"}
                domain={
                  metric === "positions"
                    ? [1, Math.max(fieldSize, ...finiteValues)]
                    : metric === "pace"
                      ? paceDomain
                      : [0, "auto"]
                }
                allowDecimals={metric !== "positions"}
                tickCount={metric === "positions" ? 6 : 5}
                width={metric === "pace" ? 68 : 42}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  metric === "positions" ? "P" + value
                    : metric === "pace" ? reportLapTime(value).replace(/\.000$/, "")
                    : format.format(value)
                }
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => "Круг " + value}
                    formatter={(value, name) => (
                      <>
                        <span className="text-muted-foreground">
                          {config[String(name)]?.label}
                        </span>
                        <span className="ml-auto font-mono font-medium text-foreground">
                          {metric === "positions"
                            ? "P" + value
                            : metric === "pace" ? reportLapTime(value)
                            : format.format(Number(value)) + " с"}
                        </span>
                      </>
                    )}
                  />
                }
              />
              {drivers.map((driver) => (
                <Line
                  key={driver.number}
                  dataKey={"driver" + driver.number}
                  type={metric === "positions" ? "stepAfter" : "linear"}
                  stroke={colour(driver)}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
          <div className="rr-chart-lap-label">Круг</div>
          <div className="rr-chart-legend">
            {visible.map((driver) => (
              <span key={driver.number}>
                <i
                  style={{ borderColor: colour(driver) }}
                />
                {driver.driver}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="rr-missing">
          <h4>
            {hasAvailable
              ? "Выбери пилотов для сравнения"
              : metric === "pace"
                ? "Данные о темпе пока недоступны"
                : "Тайминг по кругам пока недоступен"}
          </h4>
          <p>
            {hasAvailable
              ? "Нажми на фамилии над графиком."
              : "График появится после загрузки данных этой гонки."}
          </p>
        </div>
      )}
    </figure>
  );
}
