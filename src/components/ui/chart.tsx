"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";
import type { TooltipValueType } from "recharts";

import { cn } from "@/lib/utils";

const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart must be used within ChartContainer");
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        data-chart={chartId}
        data-slot="chart"
        {...props}
      >
        <ChartStyle config={config} id={chartId} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={{ width: 640, height: 280 }}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, item]) => item.theme ?? item.color);
  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(([theme, prefix]) => `${prefix} [data-chart=${id}] {\n${colorConfig
            .map(([key, item]) => {
              const color = item.theme?.[theme as keyof typeof item.theme] ?? item.color;
              return color ? `  --color-${key}: ${color};` : null;
            })
            .join("\n")}\n}`)
          .join("\n"),
      }}
    />
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  className,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<"div"> &
  RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, number | string>) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  return (
    <div className={cn("grid min-w-40 gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs shadow-xl", className)}>
      {label != null ? <p className="font-medium">{labelFormatter ? labelFormatter(label, payload) : String(label)}</p> : null}
      <div className="grid gap-1.5">
        {payload.filter((item) => item.type !== "none").map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          return (
            <div className="flex items-center justify-between gap-4" key={key}>
              {formatter && item.value != null ? (
                formatter(item.value, item.name ?? key, item, index, payload)
              ) : (
                <>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
                    {config[key]?.label ?? item.name}
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    ${Number(item.value ?? 0).toFixed(4)}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  payload,
  className,
}: React.ComponentProps<"div"> & RechartsPrimitive.DefaultLegendContentProps) {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-4 pt-3", className)}>
      {payload.filter((item) => item.type !== "none").map((item) => {
        const key = String(item.dataKey ?? item.value ?? "value");
        return (
          <span className="flex items-center gap-1.5" key={key}>
            <span className="size-2 rounded-[2px]" style={{ backgroundColor: item.color }} />
            {config[key]?.label ?? item.value}
          </span>
        );
      })}
    </div>
  );
}

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
};
