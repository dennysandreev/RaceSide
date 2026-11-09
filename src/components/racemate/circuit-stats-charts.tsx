"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Pie, PieChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { circuitHistoryChartRows, circuitRaceCount, circuitSeasonRange } from "@/lib/circuit-stats-display";
import type { CircuitGrandPrixHistoryRow } from "@/types/racemate";

export function CircuitPoleChart({ rate }: { rate: number | null }) {
  if (rate === null || !Number.isFinite(rate) || rate < 0 || rate > 100) {
    return <ChartEmpty description="Пока не хватает результатов квалификаций и гонок для сравнения." />;
  }

  return (
    <div className="relative size-40 shrink-0" role="img" aria-label={`${Math.round(rate)}% побед с поула, ${Math.round(100 - rate)}% с других позиций`}>
      <ChartContainer className="size-full aspect-square" config={{ wins: { label: "Победы", color: "var(--primary)" } }} aria-hidden="true">
        <PieChart>
          <Pie
            data={[
              { value: rate, fill: "var(--primary)" },
              { value: 100 - rate, fill: "var(--muted)" },
            ]}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            innerRadius={62}
            outerRadius={76}
            stroke="none"
            isAnimationActive={false}
          />
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1" aria-hidden="true">
        <span className="font-mono text-3xl font-semibold tracking-[-0.03em] tabular-nums">{Math.round(rate)}%</span>
        <span className="text-xs text-muted-foreground">побед с поула</span>
      </div>
    </div>
  );
}

export function CircuitHistoryChart({
  metric = "dnfCount",
  rows,
}: {
  metric?: "dnfCount" | "winnerStartPosition";
  rows: CircuitGrandPrixHistoryRow[];
}) {
  const data = circuitHistoryChartRows(rows);
  const known = data.filter((row) => row[metric] !== null);
  const isGrid = metric === "winnerStartPosition";
  const title = isGrid ? "Старт победителя" : "Сходы";
  if (!known.length) {
    return <ChartEmpty description={isGrid ? "График появится, когда станут доступны стартовые позиции победителей." : "График появится, когда станут доступны данные о сходах."} />;
  }
  const period = circuitSeasonRange(data[0].season, data[data.length - 1].season);
  const maxValue = Math.max(...known.map((row) => row[metric]!));

  return (
    <figure className="min-w-0">
      <ChartContainer
        className="h-52 w-full aspect-auto"
        config={{ [metric]: { label: title, color: "var(--primary)" } }}
        aria-label={`${title} по гонкам за ${period}`}
      >
        <BarChart accessibilityLayer data={data} margin={{ top: 24, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} minTickGap={12} fontSize={11} tickFormatter={(label: string) => data.find((row) => row.label === label)?.[metric] === null ? `${label}*` : label} />
          <YAxis
            axisLine={false}
            tickLine={false}
            tickMargin={6}
            width={32}
            allowDecimals={false}
            domain={[0, Math.max(isGrid ? 3 : 2, maxValue)]}
            tickFormatter={(value: number) => isGrid ? (value === 0 ? "" : `P${value}`) : String(value)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row) return null;
              const value = row[metric];
              return (
                <div className="max-w-64 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground">
                  <p className="font-semibold">{row.season} · {row.raceName}</p>
                  <p className="mt-1 text-muted-foreground">{row.winner}</p>
                  <p className="mt-2 font-mono">{title}: {value === null ? "нет данных" : isGrid ? `P${value}` : value}</p>
                </div>
              );
            }}
          />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} minPointSize={2} maxBarSize={32} radius={[3, 3, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey={metric} position="top" fontSize={11} fill="var(--foreground)" formatter={(value) => value == null ? "" : isGrid ? `P${value}` : String(value)} />
          </Bar>
        </BarChart>
      </ChartContainer>
      <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
        {period} · {circuitRaceCount(data.length)} в истории
        {known.length !== data.length ? `. * Нет данных: ${data.filter((row) => row[metric] === null).map((row) => row.label).join(", ")}.` : ""}
      </figcaption>
      <table className="sr-only">
        <caption>{title} по гонкам</caption>
        <thead><tr><th scope="col">Гонка</th><th scope="col">Победитель</th><th scope="col">{title}</th></tr></thead>
        <tbody>{data.map((row) => <tr key={`${row.season}-${row.round}`}><th scope="row">{row.label}</th><td>{row.winner}</td><td>{row[metric] ?? "Нет данных"}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function ChartEmpty({ description }: { description: string }) {
  return (
    <Empty className="min-h-48 px-2 py-6 md:p-6">
      <EmptyHeader>
        <EmptyTitle>Недостаточно данных</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
