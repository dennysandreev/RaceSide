"use client";
import { useMemo, useSyncExternalStore } from "react";
import type { Comparison } from "../lib/types";
import type { CursorStore } from "../lib/client";
import { getTraceColors, number, sectorGapRows } from "../lib/format";
import { trackPositionsAtCursor } from "../lib/track-position";
export type TrackRegion = { id: string; from: number; to: number; color: string; label: string; selected?: boolean; marker?: string; onSelect?: () => void };
export function TelemetryTrack({
  comparison,
  cursor,
  onCorner,
  onSector,
  selectedCorner,
  regions,
  title = "Карта трассы",
  caption,
  hideCorners = false,
  cursorMarker = false,
}: {
  comparison: Comparison;
  cursor: CursorStore;
  onCorner: (n: number) => void;
  onSector: (index: number) => void;
  selectedCorner?: number;
  regions?: TrackRegion[];
  title?: string;
  caption?: string;
  hideCorners?: boolean;
  cursorMarker?: boolean;
}) {
  const traceColors = getTraceColors(comparison);
  const track = comparison.track;
  const points = track.points;
  const geometry = useMemo(() => {
    const xs = points.map((p) => p.x),
      ys = points.map((p) => p.y);
    const minX = Math.min(...xs),
      minY = Math.min(...ys),
      scale = Math.min(
        480 / Math.max(Math.max(...xs) - minX, 1),
        340 / Math.max(Math.max(...ys) - minY, 1),
      );
    const offsetX = (560 - (Math.max(...xs) - minX) * scale) / 2,
      offsetY = (420 - (Math.max(...ys) - minY) * scale) / 2;
    return (d: number) => {
      let i = 0;
      while (i + 1 < points.length && points[i + 1].distance < d) i++;
      const a = points[i],
        b = points[Math.min(i + 1, points.length - 1)],
        ratio =
          b.distance > a.distance
            ? (d - a.distance) / (b.distance - a.distance)
            : 0;
      return {
        x: offsetX + (a.x + (b.x - a.x) * ratio - minX) * scale,
        y: offsetY + (a.y + (b.y - a.y) * ratio - minY) * scale,
      };
    };
  }, [points]);
  if (points.length < 3)
    return (
      <p className="telemetry-channel-empty">
        Координаты этой трассы пока недоступны. Сравнение графиков работает.
      </p>
    );
  const path = (from: number, to: number) => {
    const samples = [
      geometry(from),
      ...points
        .filter((p) => p.distance > from && p.distance < to)
        .map((p) => geometry(p.distance)),
      geometry(to),
    ];
    return samples
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
  };
  const ref = comparison.config.reference,
    other = comparison.traces.findIndex((_, i) => i !== ref);
  const sectorGaps = sectorGapRows(comparison);
  const start = geometry(0);
  return (
    <section className="telemetry-map" data-analysis={Boolean(regions) || undefined}>
      <div className="telemetry-chart-heading">
        <h3>{title}</h3>
        <span>{number(track.length / 1000, 3)} км</span>
      </div>
      <svg
        viewBox="0 0 560 420"
        role="group"
        aria-label="Карта трассы. Выберите поворот на карте или в меню участка."
      >
        <path
          d={path(0, track.length)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="10"
          strokeLinejoin="round"
        />
        {regions?.map((region) => {
          const p = geometry((region.from + region.to) / 2);
          return <g key={region.id} role={region.onSelect ? "button" : undefined} tabIndex={region.onSelect ? 0 : undefined}
            aria-label={region.label} aria-pressed={region.onSelect ? Boolean(region.selected) : undefined}
            className="telemetry-map-region" onClick={region.onSelect}
            onKeyDown={(event) => { if (region.onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); region.onSelect(); } }}>
            <title>{region.label}</title>
            <path d={path(region.from, region.to)} fill="none" stroke={region.color} strokeWidth={region.selected ? 8 : 5} strokeLinecap="round" />
            {region.marker && <><circle cx={p.x + 16} cy={p.y - 16} r="12" stroke={region.color} strokeWidth="2" fill="var(--hub-panel)" />
              <text x={p.x + 16} y={p.y - 12} fontSize="12" textAnchor="middle" fill="var(--foreground)">{region.marker}</text></>}
          </g>;
        })}
        {!regions && comparison.segments.map((s) => (
          <g key={s.from}>
            <title>
              {`${Math.round(s.from)}–${Math.round(s.to)} м: ${
                s.gain[other] == null
                  ? "нет данных"
                  : `${comparison.traces[s.gain[other]! > 0 ? ref : other].driver.code} выигрывает ${number(Math.abs(s.gain[other]!), 3)} с`
              }`}
            </title>
            <path
              d={path(s.from, s.to)}
              fill="none"
              stroke={
                s.gain[other] == null || Math.abs(s.gain[other]!) < 0.025
                  ? "var(--border)"
                  : s.gain[other]! > 0
                    ? traceColors[ref]
                    : traceColors[other]
              }
              strokeWidth="5"
              strokeLinecap="round"
              onPointerMove={() => cursor.set((s.from + s.to) / 2)}
            />
          </g>
        ))}
        <rect
          x={start.x - 5}
          y={start.y - 5}
          width="10"
          height="10"
          fill="var(--foreground)"
        />
        <text
          x={start.x + 10}
          y={start.y - 9}
          fill="var(--foreground)"
          fontSize="11"
        >
          Старт
        </text>
        {track.sectors.map((d, i) => {
          const p = geometry(d);
          return (
            <text
              key={i}
              x={p.x + 10}
              y={p.y}
              fill="var(--muted-foreground)"
              fontSize="12"
            >
              S{i + 1}
            </text>
          );
        })}
        {!hideCorners && track.corners.map((c) => {
          const p = geometry(c.apex);
          const before = geometry(Math.max(0, c.apex - 15));
          const after = geometry(Math.min(track.length, c.apex + 15));
          const length =
            Math.hypot(after.x - before.x, after.y - before.y) || 1;
          // Put labels beside the line so close chicanes remain visible.
          const side = c.number % 2 ? 1 : -1;
          const label = {
            x: p.x - ((after.y - before.y) / length) * 23 * side,
            y: p.y + ((after.x - before.x) / length) * 23 * side,
          };
          return (
            <g
              key={c.number}
              onClick={() => onCorner(c.number)}
              className="telemetry-map-turn"
              role="button"
              tabIndex={0}
              aria-label={`Поворот ${c.number}`}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onCorner(c.number); } }}
            >
              <line
                x1={p.x}
                y1={p.y}
                x2={label.x}
                y2={label.y}
                stroke="var(--muted-foreground)"
                strokeWidth="1"
              />
              <circle
                cx={label.x}
                cy={label.y}
                r="11"
                fill={
                  selectedCorner === c.number
                    ? "var(--foreground)"
                    : "var(--hub-panel, var(--background))"
                }
                stroke="var(--border)"
              />
              <text
                x={label.x}
                y={label.y + 4}
                textAnchor="middle"
                fill={
                  selectedCorner === c.number
                    ? "var(--background)"
                    : "var(--foreground)"
                }
                fontSize="11"
              >
                {c.number}
              </text>
            </g>
          );
        })}
        {cursorMarker && <TrackDistanceMarker geometry={geometry} cursor={cursor} length={track.length} />}
        {!regions && <TrackCursor
          geometry={geometry}
          cursor={cursor}
          comparison={comparison}
        />}
      </svg>
      {caption && <p className="telemetry-analysis-map-caption">{caption}</p>}
      {!regions && <div className="telemetry-map-details"><TrackPositionSummary cursor={cursor} comparison={comparison} />
      <div className="telemetry-map-legend">
        {comparison.traces.map((t, i) => (
          <span key={t.lap.id} style={{ color: traceColors[i] }}>
            <span aria-hidden="true" className="telemetry-line-swatch" />
            {t.driver.code}
          </span>
        ))}
        <span>Тёмно-серый — близкий темп</span>
      </div>
      <div className="telemetry-sector-summary">
        {sectorGaps.map(({ index, delta, winner }) => {
          return (
            <button
              key={index}
              onClick={() => onSector(index)}
              aria-label={`Приблизить сектор ${index + 1}`}
            >
              <span>Сектор {index + 1}</span>
              <strong
                style={{
                  color:
                    delta == null || winner == null
                      ? undefined
                      : traceColors[winner],
                }}
              >
                {delta == null ? "—" : `${number(Math.abs(delta), 3)} с`}
              </strong>
              <span>
                {delta == null
                  ? "Нет данных"
                  : `${comparison.traces[winner!].driver.code} быстрее`}
              </span>
            </button>
          );
        })}
      </div></div>}
    </section>
  );
}
function TrackDistanceMarker({ geometry, cursor, length }: { geometry: (d: number) => { x: number; y: number }; cursor: CursorStore; length: number }) {
  const distance = useSyncExternalStore(cursor.subscribe, cursor.get, () => 0);
  const d = Math.max(0, Math.min(length, distance));
  const p = geometry(d), before = geometry(Math.max(0, d - 10)), after = geometry(Math.min(length, d + 10));
  const tangent = Math.hypot(after.x - before.x, after.y - before.y) || 1;
  const dx = -(after.y - before.y) / tangent * 12, dy = (after.x - before.x) / tangent * 12;
  return <g className="telemetry-track-distance-marker" pointerEvents="none" aria-label={`Позиция на трассе: ${number(d, 0)} м`}>
    <line x1={p.x - dx} y1={p.y - dy} x2={p.x + dx} y2={p.y + dy} stroke="var(--hub-panel, var(--background))" strokeWidth="7" strokeLinecap="round" />
    <line x1={p.x - dx} y1={p.y - dy} x2={p.x + dx} y2={p.y + dy} stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" />
  </g>;
}
function TrackCursor({
  geometry,
  cursor,
  comparison,
}: {
  geometry: (d: number) => { x: number; y: number };
  cursor: CursorStore;
  comparison: Comparison;
}) {
  const traceColors = getTraceColors(comparison);
  const d = useSyncExternalStore(cursor.subscribe, cursor.get, () => 0);
  const { positions } = trackPositionsAtCursor(comparison, d);
  return (
    <g pointerEvents="none">
      {comparison.traces.map((t, i) => {
        const distance = positions[i];
        if (distance == null) return null;
        const p = geometry(distance);
        const before = geometry(Math.max(0, distance - 10));
        const after = geometry(Math.min(comparison.track.length, distance + 10));
        const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
        const side = i % 2 ? 1 : -1;
        const labelX = p.x - (after.y - before.y) / length * 21 * side;
        const labelY = p.y + (after.x - before.x) / length * 21 * side;
        return <g key={t.lap.id}>
          <line x1={p.x} y1={p.y} x2={labelX} y2={labelY} stroke={traceColors[i]} strokeWidth="1.5" />
          <circle
            cx={p.x}
            cy={p.y}
            r={i ? 4 : 6}
            fill={traceColors[i]}
            stroke="var(--background)"
            strokeWidth="2"
          />
          <text x={labelX} y={labelY + 4} textAnchor="middle" fill={traceColors[i]}
            stroke="var(--background)" strokeWidth="3" paintOrder="stroke" fontSize="12" fontWeight="800">
            {t.driver.code}
          </text>
        </g>;
      })}
    </g>
  );
}

function TrackPositionSummary({ cursor, comparison }: { cursor: CursorStore; comparison: Comparison }) {
  const distance = useSyncExternalStore(cursor.subscribe, cursor.get, () => 0);
  const { timeGap, distanceGap } = trackPositionsAtCursor(comparison, distance);
  const colors = getTraceColors(comparison);
  const level = timeGap != null && Math.abs(timeGap) < 0.0005;
  const winner = timeGap == null || level ? null : timeGap > 0 ? 0 : 1;
  const leaderColor = winner == null ? undefined : colors[winner];
  return <div className="telemetry-track-position" aria-label="Отрыв между пилотами">
    <div className="telemetry-track-leader" data-leading={winner != null}>
      <span>Впереди</span>
      <strong style={{ color: leaderColor }}>
        {winner != null && <i aria-hidden="true" />}
        {timeGap == null ? "Нет данных" : level ? "Вровень" : comparison.traces[winner!].driver.code}
      </strong>
    </div>
    <div>
      <span>Отрыв</span>
      <strong style={{ color: leaderColor }}>
        {timeGap == null ? "—" : number(Math.abs(timeGap), 3)}
        {timeGap != null && <small>с</small>}
      </strong>
    </div>
    <div>
      <span>Между болидами</span>
      <strong>
        {distanceGap == null ? "—" : number(Math.abs(distanceGap), 0)}
        {distanceGap != null && <small>м</small>}
      </strong>
    </div>
  </div>;
}
