"use client";
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import Image from "next/image";
import { Flag, ArrowUpRight } from "lucide-react";
import { Popover } from "radix-ui";
import { useLive, useLiveStore } from "./live-provider";
import { compoundText, driverStatus, gapText, lapTime, tyreAgeText, tyreAgeDescription } from "../lib/format";
import { sessionCapabilities } from "../lib/session";
import { getRacePaceTrend, type RacePaceTrend } from "../lib/race-pace";
import type {
  DriverLiveState,
  LiveSession,
  TelemetrySample,
} from "../lib/types";
import { Button } from "@/components/ui/button";
import { normalizeDriverAvatarSlug } from "@/lib/driver-avatar-slug";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
const emptyTelemetry: TelemetrySample[] = [];
function useLatestTelemetry(selected: number | null) {
  const store = useLiveStore();
  const buffer = useSyncExternalStore(
    (notify) => store.subscribe(`telemetry:${selected ?? "none"}`, notify),
    () =>
      selected === null
        ? emptyTelemetry
        : (store.telemetry.get(selected) ?? emptyTelemetry),
    () => emptyTelemetry,
  );
  return buffer.at(-1);
}
function displayedSectors(driver: DriverLiveState, timed: boolean) {
  if (!timed) return driver.sectors;
  if (driver.bestLapSectors?.some((sector) => sector !== null))
    return driver.bestLapSectors;
  const bestLap = driver.lapHistory?.find(
    (lap) =>
      !lap.deleted &&
      driver.bestLap !== null &&
      Math.abs(lap.duration - driver.bestLap) < 0.0005,
  );
  return bestLap?.sectors ?? [null, null, null];
}
function PaceSummary({
  driver,
  trend,
}: {
  driver: DriverLiveState;
  trend: RacePaceTrend;
}) {
  if (trend.kind === "leader")
    return (
      <div className="live-pace-summary">
        <strong>{driver.acronym} лидирует</strong>
        <span>
          Среднее за три чистых круга: {lapTime(trend.average)}. Машины впереди
          нет.
        </span>
      </div>
    );
  if (trend.kind === "unknown")
    return (
      <div className="live-pace-summary">
        <strong>Нужно больше чистых кругов</strong>
        <span>
          {driver.acronym}: {trend.laps}/3 · {trend.aheadName}:{" "}
          {trend.aheadLaps}
          /3. Круги с заездом в боксы не учитываются.
        </span>
      </div>
    );

  const delta = Math.abs(trend.gainPerLap ?? 0).toFixed(3);
  const direction =
    trend.kind === "gaining"
      ? `отыгрывает ${delta} с за круг`
      : trend.kind === "losing"
        ? `теряет ${delta} с за круг`
        : `идёт почти в одном темпе — разница ${delta} с за круг`;
  const projection =
    trend.lapsToOvertakeZone === 0
      ? "Уже в зоне атаки — менее секунды."
      : trend.lapsToOvertakeZone
        ? `До зоны атаки: примерно ${trend.lapsToOvertakeZone} кр.`
        : "При текущем темпе зона атаки не приближается.";
  return (
    <div className="live-pace-summary">
      <strong>
        {driver.acronym} → {trend.aheadName}
      </strong>
      <span>
        Среднее: {lapTime(trend.average)} против {lapTime(trend.aheadAverage)}.
      </span>
      <span>
        {driver.acronym} {direction}. Интервал: {gapText(trend.interval)}.
      </span>
      <span>{projection}</span>
    </div>
  );
}
export function Tyre({ driver }: { driver: DriverLiveState }) {
  return (
    <span
      className="live-tyre"
      data-compound={driver.compound}
      title={`${compoundText[driver.compound ?? ""] ?? "Шины неизвестны"} · ${tyreAgeDescription(driver)}`}
    >
      <b>{driver.compound?.[0] ?? "—"}</b>
      <span>{tyreAgeText(driver)}</span>
    </span>
  );
}
export function ordered(
  drivers: Record<number, DriverLiveState>,
  session: LiveSession | null,
) {
  const capabilities = sessionCapabilities(session);
  return Object.values(drivers).sort((a, b) => {
    const retired = (d: DriverLiveState) =>
      ["DNF", "DNS", "RETIRED", "DSQ"].includes(d.status) ? 1 : 0;
    if (retired(a) !== retired(b)) return retired(a) - retired(b);
    const eliminated = (d: DriverLiveState) => (d.eliminatedIn ? 1 : 0);
    if (eliminated(a) !== eliminated(b)) return eliminated(a) - eliminated(b);
    if (capabilities.rankByLapTime)
      return (
        (a.bestLap ?? Infinity) - (b.bestLap ?? Infinity) ||
        (a.position ?? 99) - (b.position ?? 99)
      );
    return (a.position ?? 99) - (b.position ?? 99);
  });
}
export function TimingTower({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (n: number) => void;
}) {
  const drivers = useLive("drivers"),
    session = useLive("session");
  const rows = ordered(drivers, session),
    capabilities = sessionCapabilities(session);
  return (
    <div className="live-tower">
      <div className="live-panel-title">
        Тайминг
        <span>
          {capabilities.rankByLapTime
            ? "Лучший круг"
            : rows.length
              ? `${rows.length} пилота`
              : ""}
        </span>
      </div>
      <div className="live-tower-scroll">
        {rows.map((d, index) => (
          <button
            key={d.driverNumber}
            className="live-tower-row"
            data-selected={selected === d.driverNumber}
            data-retired={["DNF", "DNS", "RETIRED", "DSQ"].includes(d.status)}
            data-eliminated={Boolean(d.eliminatedIn)}
            onClick={() => onSelect(d.driverNumber)}
            style={{ "--team": d.teamColour } as CSSProperties}
            aria-pressed={selected === d.driverNumber}
          >
            <span className="live-position">
              {String(
                capabilities.rankByLapTime
                  ? index + 1
                  : (d.position ?? index + 1),
              ).padStart(2, "0")}
            </span>
            <span className="live-team-dot" />
            <strong>{d.acronym}</strong>
            <Tyre driver={d} />
            <span
              className="live-tower-gap"
              title={
                capabilities.rankByLapTime
                  ? `Лучший: ${lapTime(d.bestLap)} · Последний: ${lapTime(d.lastLap)} · ${d.lap} кругов`
                  : `До лидера: ${gapText(d.gap)} · До впереди: ${gapText(d.interval)}`
              }
            >
              {capabilities.rankByLapTime
                ? lapTime(d.bestLap)
                : gapText(d.position === 1 ? d.gap : (d.interval ?? d.gap))}
            </span>
          </button>
        ))}
        {!rows.length && <p className="live-quiet">Ждём выезда пилотов</p>}
      </div>
    </div>
  );
}
export function DriverPortrait({ driver }: { driver: DriverLiveState }) {
  const session = useLive("session");
  const [failed, setFailed] = useState<string | null>(null);
  const slug = normalizeDriverAvatarSlug(driver.fullName);
  const season = session?.date_start.slice(0, 4);
  const src = `/drivers/avatars/${season}/${slug}.webp`;
  return (
    <div
      className="live-portrait"
      style={{ "--team": driver.teamColour } as CSSProperties}
    >
      {season === "2026" && failed !== src ? (
        <Image
          src={src}
          alt=""
          width={112}
          height={112}
          onError={() => setFailed(src)}
        />
      ) : (
        <span>{driver.driverNumber}</span>
      )}
    </div>
  );
}
export function SelectedDriver({
  selected,
  onEvents,
  onDetails,
}: {
  selected: number | null;
  onEvents: () => void;
  onDetails: () => void;
}) {
  const drivers = useLive("drivers"),
    session = useLive("session");
  const telemetry = useLatestTelemetry(selected);
  const d = selected === null ? null : drivers[selected];
  const timed = sessionCapabilities(session).rankByLapTime;
  const rows = ordered(drivers, session),
    best = Math.min(
      ...rows
        .filter((driver) => !driver.eliminatedIn)
        .map((driver) => driver.bestLap ?? Infinity),
    );
  if (!d)
    return (
      <section className="live-selected">
        <p className="live-quiet">Выберите пилота в тайминге</p>
      </section>
    );
  const name = d.fullName
    .toLowerCase()
    .split(" ")
    .map((part) => part[0]?.toUpperCase() + part.slice(1));
  return (
    <section
      className="live-selected"
      style={{ "--team": d.teamColour } as CSSProperties}
      aria-label={`Карточка ${d.fullName}`}
    >
      <div className="live-selected-identity">
        <div>
          <span>{name.slice(0, -1).join(" ")}</span>
          <h2>{name.at(-1)}</h2>
          <p>
            <i />
            {d.team}
          </p>
        </div>
        <DriverPortrait key={d.driverNumber} driver={d} />
      </div>
      <div className="live-selected-stint">
        <Tyre driver={d} />
        <span>
          {compoundText[d.compound ?? ""] ?? "Шины"}
          <small title={tyreAgeDescription(d)}>{tyreAgeText(d)} {d.tyreAgeEstimated ? "кругов после пита" : "кругов на комплекте"}</small>
        </span>
        <b>
          {timed
            ? d.bestLap
              ? gapText(d.bestLap - best)
              : "—"
            : gapText(d.gap)}
        </b>
      </div>
      <dl className="live-stats">
        <div className="live-selected-motion">
          <dt className="sr-only">Скорость</dt>
          <dd
            aria-label={`Скорость ${telemetry?.speed ?? "—"} километров в час`}
          >
            <span className="live-selected-speed">
              {telemetry?.speed ?? "—"}
              <small>км/ч</small>
            </span>
          </dd>
        </div>
        <div>
          <dt>Лучший круг</dt>
          <dd className="live-green">{lapTime(d.bestLap)}</dd>
        </div>
        <div>
          <dt>Пройдено кругов</dt>
          <dd>{d.lap}</dd>
        </div>
        <div>
          <dt>Пит-стопы</dt>
          <dd>{d.pitCount}</dd>
        </div>
      </dl>
      <div className="live-selected-actions">
        <Button variant="secondary" size="sm" onClick={onEvents}>
          <Flag size={15} />
          События
        </Button>
        <Button variant="ghost" size="sm" onClick={onDetails}>
          Подробнее
          <ArrowUpRight size={15} />
        </Button>
      </div>
    </section>
  );
}
export function DetailedTiming({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (n: number) => void;
}) {
  const drivers = useLive("drivers"),
    session = useLive("session");
  const [expandedPace, setExpandedPace] = useState<number | null>(null);
  const rows = ordered(drivers, session),
    capabilities = sessionCapabilities(session);
  const activeRows = rows.filter((d) => !d.eliminatedIn);
  const best = Math.min(...activeRows.map((d) => d.bestLap ?? Infinity));
  const sectors = [0, 1, 2].map((i) =>
    Math.min(...activeRows.map((d) => d.bestSectors[i] ?? Infinity)),
  );
  const timed = capabilities.rankByLapTime;
  const columns = timed
    ? [
        { label: "Поз.", width: 44 },
        { label: "Пилот", width: 56 },
        { label: "Шины", width: 64 },
        { label: "Питы", width: 48 },
        { label: "Лучший", width: 88 },
        { label: "От лучшего", width: 80 },
        { label: "Последний", width: 88 },
        { label: "S1", width: 64 },
        { label: "S2", width: 64 },
        { label: "S3", width: 64 },
        { label: "Макс. км/ч", width: 88 },
        { label: "Круги", width: 48 },
        { label: "Статус", width: 136 },
      ]
    : [
        { label: "Поз.", width: 44 },
        { label: "Пилот", width: 56 },
        { label: "Шины", width: 64 },
        { label: "Питы", width: 48 },
        { label: "От лидера", width: 88 },
        { label: "Интервал", width: 80 },
        { label: "Последний", width: 88 },
        { label: "S1", width: 64 },
        { label: "S2", width: 64 },
        { label: "S3", width: 64 },
        { label: "Лучший", width: 88 },
        { label: "Темп", width: 88 },
        { label: "Статус", width: 136 },
      ];
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  return (
    <div className="live-table-scroll">
      <Table className="live-detail-table" style={{ minWidth: tableWidth }}>
        <colgroup>
          {columns.map(({ label, width }) => (
            <col key={label} style={{ width }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            {columns.map(({ label }) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((d, index) => {
            const shownSectors = displayedSectors(d, timed);
            const paceTrend = timed
              ? null
              : getRacePaceTrend(d, rows[index - 1]);
            return (
              <TableRow
                key={d.driverNumber}
                data-state={
                  selected === d.driverNumber ? "selected" : undefined
                }
                data-eliminated={Boolean(d.eliminatedIn)}
                aria-selected={selected === d.driverNumber}
                onClick={() => onSelect(d.driverNumber)}
              >
                <TableCell>{timed ? index + 1 : (d.position ?? "—")}</TableCell>
                <TableCell>
                  <button
                    aria-label={`Выбрать ${d.fullName}`}
                    className="live-driver-button"
                    style={{ color: d.teamColour }}
                  >
                    {d.acronym}
                  </button>
                </TableCell>
                <TableCell>
                  <Tyre driver={d} />
                </TableCell>
                <TableCell>{d.pitCount}</TableCell>
                {timed ? (
                  <>
                    <TableCell
                      className={d.bestLap === best ? "live-purple" : ""}
                    >
                      {lapTime(d.bestLap)}
                    </TableCell>
                    <TableCell>
                      {d.bestLap ? gapText(d.bestLap - best) : "—"}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>{gapText(d.gap)}</TableCell>
                    <TableCell>{gapText(d.interval)}</TableCell>
                  </>
                )}
                <TableCell>
                  {driverStatus[d.status] ?? lapTime(d.lastLap)}
                </TableCell>
                {shownSectors.map((v, i) => (
                  <TableCell
                    key={i}
                    className={
                      v && v <= sectors[i]
                        ? "live-purple"
                        : v && v <= (d.bestSectors[i] ?? 0)
                          ? "live-green"
                          : ""
                    }
                  >
                    {v?.toFixed(3) ?? "—"}
                  </TableCell>
                ))}
                {timed ? (
                  <>
                    <TableCell title="Максимальная скорость за сессию">
                      {d.maxSpeed == null ? "—" : Math.round(d.maxSpeed)}
                    </TableCell>
                    <TableCell>{d.lap}</TableCell>
                    <TableCell>
                      {d.eliminatedIn
                        ? `Вылетел в ${d.eliminatedIn}`
                        : (driverStatus[d.status] ?? "На трассе")}
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell
                      className={d.bestLap === best ? "live-purple" : ""}
                    >
                      {lapTime(d.bestLap)}
                    </TableCell>
                    <TableCell>
                      {lapTime(
                        d.pace
                          .filter((p) => !p.pit)
                          .slice(-3)
                          .reduce(
                            (a, p, _, all) => a + p.duration / all.length,
                            0,
                          ),
                      )}
                    </TableCell>
                    <TableCell>
                      <Popover.Root
                        open={expandedPace === d.driverNumber}
                        onOpenChange={(open) =>
                          setExpandedPace(open ? d.driverNumber : null)
                        }
                      >
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            className="live-pace-button"
                            data-trend={paceTrend?.kind}
                            aria-label={`${d.acronym}: ${paceTrend?.label ?? "Мало данных"}. Подробнее о темпе`}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            {paceTrend?.label ?? "Мало данных"}
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content
                            className="live-pace-popover"
                            side="bottom"
                            align="end"
                            sideOffset={8}
                            collisionPadding={16}
                            aria-label={`Темп ${d.acronym}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {paceTrend && (
                              <PaceSummary driver={d} trend={paceTrend} />
                            )}
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {!rows.length && (
        <p className="live-quiet">Результаты появятся после первых кругов.</p>
      )}
    </div>
  );
}
