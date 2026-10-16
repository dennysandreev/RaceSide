"use client";
import { memo, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import type { Channel, Comparison } from "../lib/types";
import type { CursorStore } from "../lib/client";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  channelLabels,
  units,
  getTraceColors,
  displayedDelta,
  number,
} from "../lib/format";
export const TelemetryChart = memo(function TelemetryChart({
  comparison,
  channel,
  range,
  onRange,
  cursor,
  compact = false,
  traceIndices,
  distanceOrigin = 0,
  markers = [],
  highlight,
  interactiveRange = true,
}: {
  comparison: Comparison;
  channel: Channel | "delta";
  range: [number, number];
  onRange: (range: [number, number]) => void;
  cursor: CursorStore;
  compact?: boolean;
  traceIndices?: number[];
  distanceOrigin?: number;
  markers?: { distance: number; label: string }[];
  highlight?: [number, number];
  interactiveRange?: boolean;
}) {
  const mobile = useIsMobile();
  const axisWidth = mobile ? 40 : 48;
  const rightMargin = mobile ? 8 : 16;
  const traceColors = getTraceColors(comparison);
  const gradientId = useId().replaceAll(":", "");
  const node = useRef<HTMLDivElement>(null),
    start = useRef<number | null>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const data = useMemo(
    () =>
      comparison.distance.map((distance, i) => ({
        distance,
        ...Object.fromEntries(
          comparison.traces.map((t, n) => [
            `t${n}`,
            channel === "delta"
              ? displayedDelta(comparison.delta[n][i])
              : (t.points[i]?.[channel] ?? null),
          ]),
        ),
      })),
    [comparison, channel],
  );
  const visible = useMemo(
    () => data.filter((p) => p.distance >= range[0] && p.distance <= range[1]),
    [data, range],
  );
  const cornerLabels = useMemo(() => {
    const lanes: number[] = [];
    return comparison.track.corners
      .filter((corner) => corner.apex >= range[0] && corner.apex <= range[1])
      .sort((a, b) => a.apex - b.apex)
      .map((corner) => {
        const position = (corner.apex - range[0]) / (range[1] - range[0]);
        let lane = lanes.findIndex((last) => position - last >= 0.08);
        if (lane < 0) lane = lanes.length;
        lanes[lane] = position;
        return { ...corner, position, lane };
      });
  }, [comparison.track.corners, range]);
  const position = (x: number) => {
    const rect = node.current!.getBoundingClientRect();
    return (
      range[0] +
      Math.max(0, Math.min(1, (x - rect.left - axisWidth) / (rect.width - axisWidth - rightMargin))) *
        (range[1] - range[0])
    );
  };
  const active = comparison.traces
    .map((_, i) => i)
    .filter((i) => (!traceIndices || traceIndices.includes(i)) && (channel !== "delta" || i !== comparison.config.reference));
  const deltaStrokes = active.map((i) => {
    if (channel !== "delta")
      return { index: i, crossesZero: false, zeroOffset: 0, color: traceColors[i] };
    const values = visible
      .map((point) => (point as Record<string, number | null>)[`t${i}`])
      .filter((value): value is number => value != null && Number.isFinite(value));
    if (!values.length)
      return { index: i, crossesZero: false, zeroOffset: 0, color: traceColors[i] };
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    return {
      index: i,
      crossesZero: lowest < 0 && highest > 0,
      zeroOffset: (highest / (highest - lowest)) * 100,
      color:
        highest <= 0
          ? traceColors[comparison.config.reference]
          : traceColors[i],
    };
  });
  const available = active.some((i) =>
    visible.some((p) => (p as Record<string, unknown>)[`t${i}`] != null),
  );
  return (
    <section className="telemetry-chart" data-compact={compact || undefined} aria-label={channelLabels[channel]}>
      <div className="telemetry-chart-heading">
        <h3>{channelLabels[channel]}</h3>
        <span>{compact && channel === "brake" ? "нажат / отпущен" : units[channel]}</span>
        <ChartValues
          comparison={comparison}
          channel={channel}
          cursor={cursor}
          traceIndices={traceIndices}
        />
        {interactiveRange && (range[0] > 0 || range[1] < comparison.track.length) && (
          <Button variant="ghost" size="sm" className="telemetry-reset-scale" onClick={() => onRange([0, comparison.track.length])}>
            Сбросить масштаб
          </Button>
        )}
      </div>
      {!available ? (
        <p className="telemetry-channel-empty">
          Этот канал недоступен для выбранных кругов
        </p>
      ) : (
        <div
          className="telemetry-plot"
          ref={node}
          style={{ touchAction: "pan-y" }}
          onPointerMove={(e) => {
            const d = position(e.clientX);
            cursor.set(d);
            if (start.current != null) setSelection([start.current, d]);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            cursor.set(position(e.clientX));
            if (!interactiveRange) return;
            start.current = position(e.clientX);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            start.current = null;
            setSelection(null);
          }}
          onPointerUp={(e) => {
            if (start.current != null) {
              const a = start.current,
                b = position(e.clientX),
                width = range[1] - range[0];
              if (Math.abs(a - b) > width * 0.02) {
                if (e.shiftKey) {
                  const from = Math.max(
                    0,
                    Math.min(comparison.track.length - width, range[0] + a - b),
                  );
                  onRange([from, from + width]);
                } else onRange([Math.min(a, b), Math.max(a, b)]);
              }
            }
            start.current = null;
            setSelection(null);
          }}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={1}
            initialDimension={{ width: 640, height: 200 }}
          >
            <LineChart
              data={visible}
              margin={{ top: 8, right: rightMargin, left: 0, bottom: 0 }}
              accessibilityLayer
            >
              {channel === "delta" && (
                <defs>
                  {deltaStrokes.filter((stroke) => stroke.crossesZero).map((stroke) => (
                    <linearGradient key={stroke.index} id={`${gradientId}-${stroke.index}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset={`${stroke.zeroOffset}%`} stopColor={traceColors[stroke.index]} />
                      <stop offset={`${stroke.zeroOffset}%`} stopColor={traceColors[comparison.config.reference]} />
                    </linearGradient>
                  ))}
                </defs>
              )}
              <CartesianGrid
                vertical={false}
                stroke="var(--hub-grid, var(--border))"
                strokeDasharray="3 5"
              />
              <XAxis
                height={compact ? 28 : 72}
                tickMargin={compact ? 8 : 48}
                dataKey="distance"
                type="number"
                domain={range}
                allowDataOverflow
                tickFormatter={(v) => `${Math.round(v - distanceOrigin)} м`}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                minTickGap={45}
              />
              <YAxis
                width={axisWidth}
                tickMargin={mobile ? 4 : 5}
                domain={
                  channel === "throttle" || channel === "brake"
                    ? [0, 100]
                    : channel === "gear"
                      ? [0, 8]
                      : ["auto", "auto"]
                }
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={compact && channel === "brake" ? (v) => v === 0 ? "Нет" : v === 100 ? "Да" : "" : undefined}
                ticks={compact && channel === "brake" ? [0, 100] : undefined}
              />
              {highlight && <ReferenceArea x1={highlight[0]} x2={highlight[1]} fill="var(--analysis-signal-drop)" fillOpacity={0.08} strokeOpacity={0} />}
              {markers.filter((marker) => marker.distance >= range[0] && marker.distance <= range[1]).map((marker) => (
                <ReferenceLine key={`${marker.label}-${marker.distance}`} x={marker.distance} stroke="var(--muted-foreground)" strokeDasharray="3 4" label={{ value: marker.label, fill: "var(--muted-foreground)", fontSize: 10, position: "insideTopRight" }} />
              ))}
              {!compact && comparison.track.corners.filter((corner) => corner.apex >= range[0] && corner.apex <= range[1]).map((corner) => (
                <ReferenceLine key={`corner-${corner.number}`} x={corner.apex} stroke="var(--muted-foreground)" strokeOpacity={0.22} strokeDasharray="2 4" />
              ))}
              {channel === "delta" && (
                <ReferenceLine y={0} stroke="var(--muted-foreground)" />
              )}
              {deltaStrokes.map(({ index: i, crossesZero, color }) => (
                <Line
                  key={i}
                  dataKey={`t${i}`}
                  name={comparison.traces[i].driver.code}
                  type={
                    ["brake", "gear"].includes(channel)
                      ? "stepAfter"
                      : "linear"
                  }
                  stroke={crossesZero ? `url(#${gradientId}-${i})` : color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {!compact && <div className="telemetry-corner-axis" aria-label="Повороты на дистанции" style={{ left: axisWidth, right: rightMargin }}>
            {cornerLabels.map((corner) => (
              <span key={corner.number} title={`Поворот ${corner.number} · ${Math.round(corner.apex)} м`} style={{ left: `${100 * corner.position}%`, top: corner.lane * 12 }}>Т{corner.number}</span>
            ))}
          </div>}
          <CursorMarker cursor={cursor} range={range} axisWidth={axisWidth} rightMargin={rightMargin} />
          {selection && (
            <div
              className="telemetry-selection"
              style={{
                left: `calc(${axisWidth}px + (100% - ${axisWidth + rightMargin}px) * ${(Math.min(...selection) - range[0]) / (range[1] - range[0])})`,
                width: `calc((100% - ${axisWidth + rightMargin}px) * ${Math.abs(selection[1] - selection[0]) / (range[1] - range[0])})`,
              }}
            />
          )}
        </div>
      )}
    </section>
  );
});
function CursorMarker({
  cursor,
  range,
  axisWidth,
  rightMargin,
}: {
  cursor: CursorStore;
  range: [number, number];
  axisWidth: number;
  rightMargin: number;
}) {
  const d = useSyncExternalStore(cursor.subscribe, cursor.get, () => 0);
  return d >= range[0] && d <= range[1] ? (
    <div
      className="telemetry-cursor"
      style={{
        left: `calc(${axisWidth}px + (100% - ${axisWidth + rightMargin}px) * ${(d - range[0]) / (range[1] - range[0])})`,
      }}
    />
  ) : null;
}
function ChartValues({
  comparison,
  channel,
  cursor,
  traceIndices,
}: {
  comparison: Comparison;
  channel: Channel | "delta";
  cursor: CursorStore;
  traceIndices?: number[];
}) {
  const traceColors = getTraceColors(comparison);
  const d = useSyncExternalStore(cursor.subscribe, cursor.get, () => 0);
  const reference = comparison.config.reference;
  let i = 0;
  while (i + 1 < comparison.distance.length && comparison.distance[i + 1] < d)
    i++;
  return (
    <div className="telemetry-chart-values">
      {comparison.traces.map((t, n) => {
        if (traceIndices && !traceIndices.includes(n)) return null;
        if (channel === "delta" && n === reference) return null;
        const delta =
          channel === "delta" ? displayedDelta(comparison.delta[n]?.[i]) : null;
        const leader =
          delta == null || delta === 0 ? null : delta < 0 ? reference : n;
        return (
          <span key={t.lap.id} style={{ color: traceColors[n] }}>
            <span
              aria-hidden="true"
              className="telemetry-line-swatch"
              style={{ color: leader == null ? "var(--muted-foreground)" : traceColors[leader] }}
            />
            {channel === "delta" ? (
              <span
                style={{
                  color:
                    leader == null
                      ? "var(--muted-foreground)"
                      : traceColors[leader],
                }}
              >
                {delta == null
                  ? "Нет данных"
                  : leader == null
                    ? "Равное время"
                    : `${comparison.traces[leader].driver.code} ${number(delta, 3)} с`}
              </span>
            ) : (
              `${t.driver.code} ${number(t.points[i]?.[channel], 0)}`
            )}
          </span>
        );
      })}
    </div>
  );
}
