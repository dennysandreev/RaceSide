/* eslint-disable @next/next/no-img-element */
import { RaceSideLogoSvg } from "@/components/racemate/racemate-logo";
import {
  compareDriverSnapshots,
  driverComparisonMetrics,
} from "@/lib/driver-comparison";
import type {
  DriverComparisonDriver,
  DriverRoundSnapshot,
  DriverStageResult,
} from "@/types/racemate";

const colors = {
  background: "#090909",
  border: "#29292c",
  muted: "#aaa6a3",
  primary: "#e10600",
  surface: "#121214",
  surfaceRaised: "#19191c",
  text: "#f5f4f2",
};

const sansFont = "Geist, Arial, Helvetica, sans-serif";
const monoFont = "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";

export function DriverComparisonShareImage({
  left,
  leftSnapshot,
  raceName,
  right,
  rightSnapshot,
  round,
  season,
  siteOrigin,
}: {
  left: DriverComparisonDriver;
  leftSnapshot: DriverRoundSnapshot;
  raceName: string;
  right: DriverComparisonDriver;
  rightSnapshot: DriverRoundSnapshot;
  round: number;
  season: number;
  siteOrigin: string;
}) {
  const comparison = compareDriverSnapshots(leftSnapshot, rightSnapshot);
  const [leftColor, rightColor] = getSeriesColors(left.team.color, right.team.color);

  return (
    <div
      style={{
        background: colors.background,
        color: colors.text,
        display: "flex",
        flexDirection: "column",
        fontFamily: sansFont,
        height: 1350,
        overflow: "hidden",
        padding: "36px 48px 0",
        width: 1080,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <RaceSideShareLogo />
        <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 15, fontWeight: 700, letterSpacing: 1.4 }}>
          СЕЗОН {season} / ЭТАП {round}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 30 }}>
        <span style={{ color: colors.primary, display: "flex", fontFamily: monoFont, fontSize: 14, fontWeight: 900, letterSpacing: 2 }}>
          СРАВНЕНИЕ ПИЛОТОВ
        </span>
        <span style={{ display: "flex", fontSize: 34, fontWeight: 900, letterSpacing: "-0.035em", marginTop: 8 }}>
          После {truncate(raceName, 52)}
        </span>
      </div>

      <div style={{ display: "flex", marginTop: 24, width: "100%" }}>
        <DriverHero align="left" color={leftColor} driver={left} siteOrigin={siteOrigin} />
        <div
          style={{
            alignItems: "center",
            background: colors.surfaceRaised,
            borderBottom: `1px solid ${colors.border}`,
            borderTop: `1px solid ${colors.border}`,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 132,
          }}
        >
          <span style={{ color: colors.primary, display: "flex", fontFamily: monoFont, fontSize: 15, fontWeight: 900 }}>СЧЁТ</span>
          <span style={{ display: "flex", fontFamily: monoFont, fontSize: 36, fontWeight: 900, marginTop: 8 }}>
            {comparison.leftScore}:{comparison.rightScore}
          </span>
        </div>
        <DriverHero align="right" color={rightColor} driver={right} siteOrigin={siteOrigin} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
        <SectionTitle title="Показатели сезона" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          {driverComparisonMetrics.map((metric) => (
            <MetricCard
              format={metric.format}
              key={metric.key}
              label={metric.label}
              leftValue={leftSnapshot[metric.key]}
              rightValue={rightSnapshot[metric.key]}
              winner={comparison.result[metric.key] ?? "tie"}
            />
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
        <SectionTitle meta={`Этап ${round} · ${truncate(raceName, 42)}`} title="На выбранном этапе" />
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <StageCard name={left.fullName} result={leftSnapshot.stage} />
          <StageCard name={right.fullName} result={rightSnapshot.stage} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
        <SectionTitle title="Накопленные очки" />
        <PointsChart
          left={left}
          leftColor={leftColor}
          right={right}
          rightColor={rightColor}
          round={round}
        />
      </div>

      <div
        style={{
          alignItems: "center",
          background: colors.primary,
          display: "flex",
          height: 92,
          justifyContent: "space-between",
          marginLeft: -48,
          marginRight: -48,
          marginTop: "auto",
          padding: "0 48px",
        }}
      >
        <span style={{ display: "flex", fontSize: 25, fontWeight: 900 }}>Сравни своих фаворитов</span>
        <span style={{ display: "flex", fontFamily: monoFont, fontSize: 19, fontWeight: 900 }}>
          raceside.online/drivers/compare
        </span>
      </div>
    </div>
  );
}

export function RaceSideShareLogo() {
  return <RaceSideLogoSvg palette="dark" variant="signature" width={300} />;
}

function DriverHero({
  align,
  color,
  driver,
  siteOrigin,
}: {
  align: "left" | "right";
  color: string;
  driver: DriverComparisonDriver;
  siteOrigin: string;
}) {
  const portrait = driver.avatarUrl ? (
    <img
      alt=""
      height="104"
      src={resolveAssetUrl(driver.avatarUrl, siteOrigin)}
      style={{ height: 104, objectFit: "cover", width: 104 }}
      width="104"
    />
  ) : (
    <span style={{ alignItems: "center", display: "flex", fontFamily: monoFont, fontSize: 30, fontWeight: 900, height: 104, justifyContent: "center", width: 104 }}>
      {driver.number ?? driver.code ?? "F1"}
    </span>
  );

  return (
    <div
      style={{
        alignItems: "center",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: align === "right" ? "row-reverse" : "row",
        gap: 18,
        height: 166,
        padding: "20px 22px",
        width: 426,
      }}
    >
      <div style={{ border: `3px solid ${color}`, borderRadius: 999, display: "flex", height: 110, overflow: "hidden", width: 110 }}>
        {portrait}
      </div>
      <div style={{ alignItems: align === "right" ? "flex-end" : "flex-start", display: "flex", flex: 1, flexDirection: "column", textAlign: align }}>
        <span style={{ display: "flex", fontSize: getDriverNameFontSize(driver.fullName), fontWeight: 900, letterSpacing: "-0.035em", lineHeight: 1.02, maxWidth: 245 }}>
          {truncate(driver.fullName, 28)}
        </span>
        <span style={{ color, display: "flex", fontFamily: monoFont, fontSize: 13, fontWeight: 900, marginTop: 10 }}>
          № {driver.number ?? "?"} / {truncate(driver.team.name, 18)}
        </span>
      </div>
    </div>
  );
}

function SectionTitle({ meta, title }: { meta?: string; title: string }) {
  return (
    <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
      <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
        <span style={{ background: colors.primary, display: "flex", height: 20, width: 4 }} />
        <span style={{ display: "flex", fontSize: 18, fontWeight: 900 }}>{title}</span>
      </div>
      {meta ? (
        <span style={{ color: colors.muted, display: "flex", fontFamily: monoFont, fontSize: 11, fontWeight: 700 }}>
          {meta}
        </span>
      ) : null}
    </div>
  );
}

function MetricCard({
  format,
  label,
  leftValue,
  rightValue,
  winner,
}: {
  format?: "decimal" | "position";
  label: string;
  leftValue: number | null;
  rightValue: number | null;
  winner: "left" | "right" | "tie";
}) {
  return (
    <div style={{ alignItems: "center", background: colors.surface, border: `1px solid ${colors.border}`, display: "flex", height: 49, padding: "0 14px", width: 487 }}>
      <MetricValue active={winner === "left"} align="left" format={format} value={leftValue} />
      <span style={{ color: colors.muted, display: "flex", flex: 1, fontSize: 12, fontWeight: 700, justifyContent: "center", textAlign: "center" }}>
        {label}
      </span>
      <MetricValue active={winner === "right"} align="right" format={format} value={rightValue} />
    </div>
  );
}

function MetricValue({
  active,
  align,
  format,
  value,
}: {
  active: boolean;
  align: "left" | "right";
  format?: "decimal" | "position";
  value: number | null;
}) {
  return (
    <span style={{ color: active ? colors.text : colors.muted, display: "flex", fontFamily: monoFont, fontSize: value === null ? 10 : 17, fontWeight: 900, justifyContent: align === "right" ? "flex-end" : "flex-start", width: 100 }}>
      {active ? (align === "left" ? "● " : "") : ""}
      {formatMetric(value, format)}
      {active ? (align === "right" ? " ●" : "") : ""}
    </span>
  );
}

function StageCard({ name, result }: { name: string; result: DriverStageResult | null }) {
  const items = getStageItems(result);

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", height: 164, padding: "14px 16px", width: 487 }}>
      <span style={{ display: "flex", fontSize: 14, fontWeight: 900 }}>{truncate(name, 28)}</span>
      <div style={{ display: "flex", flexWrap: "wrap", marginTop: 10 }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: "flex", flexDirection: "column", height: 52, width: "33.333%" }}>
            <span style={{ color: colors.muted, display: "flex", fontSize: 9, fontWeight: 700 }}>{item.label}</span>
            <span style={{ display: "flex", fontFamily: monoFont, fontSize: 13, fontWeight: 900, marginTop: 4 }}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PointsChart({
  left,
  leftColor,
  right,
  rightColor,
  round,
}: {
  left: DriverComparisonDriver;
  leftColor: string;
  right: DriverComparisonDriver;
  rightColor: string;
  round: number;
}) {
  const width = 940;
  const height = 92;
  const leftPoints = toChartPoints(left, round);
  const rightPoints = toChartPoints(right, round);
  const maxValue = Math.max(1, ...leftPoints.map((point) => point.value), ...rightPoints.map((point) => point.value));
  const leftPolyline = toPolyline(leftPoints, round, maxValue, width, height);
  const rightPolyline = toPolyline(rightPoints, round, maxValue, width, height);

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", height: 136, marginTop: 10, padding: "12px 16px" }}>
      <div style={{ alignItems: "center", display: "flex", gap: 22 }}>
        <Legend color={leftColor} dashed={false} label={getSurname(left.fullName)} value={leftPoints.at(-1)?.value ?? 0} />
        <Legend color={rightColor} dashed label={getSurname(right.fullName)} value={rightPoints.at(-1)?.value ?? 0} />
      </div>
      <svg height={height} style={{ display: "flex", marginTop: 5 }} viewBox={`0 0 ${width} ${height}`} width={width}>
        <line stroke={colors.border} strokeWidth="1" x1="0" x2={width} y1={height - 2} y2={height - 2} />
        <polyline fill="none" points={leftPolyline} stroke={leftColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
        <polyline fill="none" points={rightPolyline} stroke={rightColor} strokeDasharray="12 9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
      </svg>
    </div>
  );
}

function Legend({ color, dashed, label, value }: { color: string; dashed: boolean; label: string; value: number }) {
  return (
    <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
      <span style={{ borderTop: `${dashed ? "3px dashed" : "3px solid"} ${color}`, display: "flex", width: 30 }} />
      <span style={{ color: colors.muted, display: "flex", fontSize: 11, fontWeight: 700 }}>{label}</span>
      <span style={{ display: "flex", fontFamily: monoFont, fontSize: 13, fontWeight: 900 }}>{formatMetric(value)}</span>
    </div>
  );
}

function getStageItems(result: DriverStageResult | null) {
  if (!result?.participated) {
    return [
      { label: "КВАЛИФИКАЦИЯ", value: "Нет старта" },
      { label: "СПРИНТ", value: "Нет старта" },
      { label: "СТАРТ", value: "Нет старта" },
      { label: "ФИНИШ", value: "Нет старта" },
      { label: "ЛУЧШИЙ КРУГ", value: "Нет данных" },
      { label: "ОЧКИ", value: "0" },
    ];
  }

  return [
    { label: "КВАЛИФИКАЦИЯ", value: formatPosition(result.qualifyingPosition) },
    { label: "СПРИНТ", value: result.sprintPosition === null ? "Не было" : formatPosition(result.sprintPosition) },
    { label: "СТАРТ", value: formatPosition(result.startPosition) },
    { label: "ФИНИШ", value: result.isDnf ? "Сход" : formatPosition(result.finishPosition) },
    { label: "ЛУЧШИЙ КРУГ", value: result.fastestLapTime ?? "Нет данных" },
    { label: "ОЧКИ", value: formatMetric(result.points, "decimal") },
  ];
}

function toChartPoints(driver: DriverComparisonDriver, round: number) {
  return [
    { round: 0, value: 0 },
    ...driver.snapshots
      .filter((snapshot) => snapshot.round <= round)
      .map((snapshot) => ({ round: snapshot.round, value: snapshot.points })),
  ];
}

function toPolyline(points: Array<{ round: number; value: number }>, round: number, maxValue: number, width: number, height: number) {
  return points
    .map((point) => {
      const x = round > 0 ? (point.round / round) * width : 0;
      const y = height - 4 - (point.value / maxValue) * (height - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function getSeriesColors(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeColor(left);
  const normalizedRight = normalizeColor(right);

  if (normalizedLeft.toLowerCase() !== normalizedRight.toLowerCase()) {
    return [normalizedLeft, normalizedRight] as const;
  }

  return [normalizedLeft, normalizedLeft.toLowerCase() === colors.primary ? "#4c8dff" : colors.primary] as const;
}

function normalizeColor(value: string | null | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : colors.primary;
}

function resolveAssetUrl(value: string, siteOrigin: string) {
  return new URL(value, siteOrigin).toString();
}

function formatMetric(value: number | null, format?: "decimal" | "position") {
  if (value === null) {
    return "Нет стартов";
  }

  if (format === "position") {
    return `P${value}`;
  }

  if (format === "decimal" && !Number.isInteger(value)) {
    return value.toFixed(1);
  }

  return String(value);
}

function formatPosition(value: number | null) {
  return value === null ? "Нет данных" : `P${value}`;
}

function getSurname(name: string) {
  return name.trim().split(/\s+/).at(-1) ?? name;
}

function getDriverNameFontSize(name: string) {
  if (name.length > 24) return 21;
  if (name.length > 18) return 24;
  return 28;
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
