"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowUpRight,
  Flag,
  Gauge,
  MapPinned,
  Medal,
  Ruler,
  Route,
  ShieldAlert,
  TimerReset,
  Trophy,
  X,
} from "lucide-react";

import { RaceFlag } from "@/components/racemate/race-flag";
import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { FantasyTrackVisualImage } from "@/components/fantasy/fantasy-track-visual";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCircuitAsset, getTeamAsset } from "@/data/f1-assets";
import type { FantasyTrackVisual } from "@/data/fantasy-track-assets";
import { circuitRaceCount, circuitSeasonRange } from "@/lib/circuit-stats-display";
import { cn } from "@/lib/utils";
import type {
  CircuitDriverStat,
  CircuitGrandPrixHistoryRow,
  CircuitRating,
  CircuitStatsView,
  CircuitTeamStat,
} from "@/types/racemate";

const CircuitHistoryChart = dynamic(() => import("./circuit-stats-charts").then((module) => module.CircuitHistoryChart), {
  loading: () => <Skeleton className="h-60 w-full" />,
});
const CircuitPoleChart = dynamic(() => import("./circuit-stats-charts").then((module) => module.CircuitPoleChart), {
  loading: () => <Skeleton className="size-40 shrink-0 rounded-full" />,
});

export function CircuitStatsSection({
  actionsInline = false,
  buttonSize = "default",
  className,
  circuitName,
  footerAction,
  headerAction,
  embedded = false,
  mode = "compact",
  previewFooter,
  previewLayout = "list",
  showCircuitName = true,
  showSectionLabel = true,
  stats,
  trackMapSrc,
  trackPhoto,
}: {
  actionsInline?: boolean;
  buttonSize?: "default" | "sm";
  className?: string;
  circuitName?: string;
  footerAction?: ReactNode;
  headerAction?: ReactNode;
  embedded?: boolean;
  mode?: "compact" | "button";
  previewFooter?: ReactNode;
  previewLayout?: "grid" | "list";
  showCircuitName?: boolean;
  showSectionLabel?: boolean;
  stats: CircuitStatsView | null;
  trackMapSrc?: string | null;
  trackPhoto?: FantasyTrackVisual | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const dialog = stats ? (
    <CircuitStatsDialog onOpenChange={setOpen} open={open} stats={stats} trackMapSrc={trackMapSrc} trackPhoto={trackPhoto} triggerRef={triggerRef} />
  ) : null;

  if (mode === "button") {
    return (
      <>
        <Button
          ref={triggerRef}
          className={cn("w-full justify-center", className)}
          disabled={!stats}
          onClick={() => setOpen(true)}
          size={buttonSize}
          type="button"
          variant="secondary"
        >
          Статистика трассы
        </Button>
        {dialog}
      </>
    );
  }

  if (!stats) {
    return (
      <section className={cn(embedded ? "" : "pb-8", className)} id="circuit-stats">
        <div className={cn("grid gap-4", embedded ? "" : "rounded-xl border border-border bg-card/80 p-4 sm:p-5")}>
          {showSectionLabel || headerAction ? (
            <div className="flex items-center justify-between gap-3">
              {showSectionLabel ? <p className="stitch-label text-primary">О трассе</p> : null}
              {headerAction}
            </div>
          ) : null}
          <div>
            <h2 className="mt-2 font-display text-2xl font-extrabold tracking-[-0.03em]">
              {circuitName ?? "Трасса этапа"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              История трассы появится после ближайшего обновления кеша.
            </p>
          </div>
          <Button className="w-full justify-center" disabled type="button" variant="secondary">
            Подробнее
          </Button>
          {previewFooter}
          {footerAction}
        </div>
      </section>
    );
  }

  return (
    <section className={cn(embedded ? "" : "pb-8", className)} id="circuit-stats">
      <div className={cn(
        "relative overflow-hidden",
        embedded ? "" : "rounded-xl border border-border bg-card/80 p-4 shadow-[0_18px_56px_rgb(0_0_0_/_0.28)] sm:p-5",
      )}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,hsl(var(--primary)/0.16),transparent_18rem)]" />
        <div className={cn("relative grid", embedded ? "gap-2.5" : "gap-4")}>
          <CircuitCompactDossier
            dense={embedded}
            headerAction={headerAction}
            previewFooter={previewFooter}
            previewLayout={previewLayout}
            showCircuitName={showCircuitName}
            showSectionLabel={showSectionLabel}
            stats={stats}
          />
          <div className={cn("grid gap-2", actionsInline && footerAction && "grid-cols-2")}>
            <Button
              ref={triggerRef}
              className="w-full justify-center border-border/80 bg-secondary/70 hover:bg-accent"
              onClick={() => setOpen(true)}
              type="button"
              variant="secondary"
            >
              Подробнее
            </Button>
            {footerAction}
          </div>
        </div>
      </div>

      {dialog}
    </section>
  );
}

function CircuitStatsDialog({
  onOpenChange,
  open,
  stats,
  trackMapSrc,
  trackPhoto,
  triggerRef,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  stats: CircuitStatsView;
  trackMapSrc?: string | null;
  trackPhoto?: FantasyTrackVisual | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const period = circuitSeasonRange(stats.summary.calculatedFromSeason, stats.summary.calculatedToSeason);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none border-0 border-border p-0 motion-reduce:animate-none sm:h-[90dvh] sm:max-h-[58rem] sm:max-w-6xl sm:rounded-xl sm:border"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
        showCloseButton={false}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Статистика трассы</p>
            <DialogTitle className="text-balance text-xl font-bold leading-tight tracking-[-0.03em] sm:text-2xl">
              {stats.circuit.name}
            </DialogTitle>
            <DialogDescription className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm">
              <span className="inline-flex items-center gap-2">
                <RaceFlag className="text-base" countryCode={getCircuitCountryCode(stats.circuit.country)} label={stats.circuit.country} />
                {[stats.circuit.locality, stats.circuit.country].filter(Boolean).join(", ")}
              </span>
              <span>{circuitRaceCount(stats.summary.racesCount)}{period ? ` · ${period}` : ""}</span>
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button aria-label="Закрыть статистику" size="icon" type="button" variant="ghost" className="shrink-0 motion-reduce:transition-none">
              <X aria-hidden="true" data-icon="inline-start" />
            </Button>
          </DialogClose>
        </header>
        <Tabs defaultValue="overview" className="min-h-0 flex-1 gap-0" onValueChange={() => scrollRef.current?.scrollTo({ top: 0 })}>
          <div className="shrink-0 border-b border-border px-4 py-2 sm:px-6">
            <TabsList aria-label="Разделы статистики трассы" className="grid w-full grid-cols-4 sm:w-fit sm:min-w-96">
              <TabsTrigger value="overview" className="min-h-10 motion-reduce:transition-none">Обзор</TabsTrigger>
              <TabsTrigger value="history" className="min-h-10 motion-reduce:transition-none">История</TabsTrigger>
              <TabsTrigger value="leaders" className="min-h-10 motion-reduce:transition-none">Лидеры</TabsTrigger>
              <TabsTrigger value="character" className="min-h-10 motion-reduce:transition-none">Характер</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6" ref={scrollRef}>
            <TabsContent value="overview" className="m-0">
              <CircuitOverview stats={stats} trackMapSrc={trackMapSrc} trackPhoto={trackPhoto} />
            </TabsContent>
            <TabsContent value="history" className="m-0">
              <div className="grid gap-6">
                <section>
                  <CircuitSectionHeader icon={Flag} title="Откуда стартовали победители" />
                  <p className="mt-2 mb-4 text-sm text-muted-foreground">Стартовая позиция будущего победителя в каждой из последних гонок.</p>
                  <CircuitHistoryChart metric="winnerStartPosition" rows={stats.history} />
                </section>
                <section className="border-t border-border pt-5">
                  <CircuitSectionHeader icon={Trophy} title="Гонки на этой трассе" />
                  <p className="mb-4 mt-2 text-sm text-muted-foreground">Победители, поулы и подиумы последних {stats.history.length || "доступных"} гонок.</p>
                  <HistoryTable rows={stats.history} />
                </section>
              </div>
            </TabsContent>
            <TabsContent value="leaders" className="m-0">
              <p className="mb-6 text-sm leading-6 text-muted-foreground">Пилоты и команды с лучшими результатами в доступной истории трассы. Сначала по числу побед, затем по подиумам.</p>
              <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
                <section className="min-w-0">
                  <CircuitSectionHeader icon={Medal} title="Пилоты" />
                  <DriverStatsList rows={stats.topDrivers} />
                </section>
                <section className="min-w-0">
                  <CircuitSectionHeader icon={Flag} title="Команды" />
                  <TeamStatsList rows={stats.topTeams} />
                </section>
              </div>
            </TabsContent>
            <TabsContent value="character" className="m-0">
              <CircuitStatsDetails stats={stats} />
            </TabsContent>
            <footer className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
              <span>{period ? `В общей статистике: ${period} · ` : "В общей статистике: "}{circuitRaceCount(stats.summary.racesCount)}</span>
              {stats.summary.updatedAt ? <span>Обновлено {stats.summary.updatedAt}</span> : null}
            </footer>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function CircuitCompactDossier({
  dense = false,
  headerAction,
  previewFooter,
  previewLayout = "list",
  showCircuitName = true,
  showSectionLabel = true,
  stats,
}: {
  dense?: boolean;
  headerAction?: ReactNode;
  previewFooter?: ReactNode;
  previewLayout?: "grid" | "list";
  showCircuitName?: boolean;
  showSectionLabel?: boolean;
  stats: CircuitStatsView;
}) {
  const metrics = [
    {
      icon: Ruler,
      label: "Длина круга",
      value: formatKm(stats.circuit.lapLengthKm),
    },
    {
      icon: Route,
      label: "Дистанция",
      value: formatCompactDistanceValue(stats.circuit.raceDistanceKm, stats.circuit.raceLaps),
    },
    {
      icon: TimerReset,
      label: "Рекорд трассы",
      value: formatLapRecord(stats.circuit.lapRecordTime, stats.circuit.lapRecordDriver, stats.circuit.lapRecordYear),
    },
  ];

  return (
    <div className="relative min-w-0">
      {showSectionLabel || headerAction ? (
        <div className="flex items-start justify-between gap-4">
          {showSectionLabel ? <p className="stitch-label text-primary">О трассе</p> : null}
          <div className="flex shrink-0 items-center gap-2">
            {headerAction ?? (
              <span className={cn("grid place-items-center rounded-md bg-primary/10 text-primary", dense ? "size-8" : "size-10")}>
                <MapPinned aria-hidden="true" className={dense ? "size-4" : "size-5"} />
              </span>
            )}
          </div>
        </div>
      ) : null}
      {showCircuitName ? (
        <h2 className="relative mt-4 text-balance font-display text-2xl font-extrabold leading-tight tracking-[-0.03em]">
          {stats.circuit.name}
        </h2>
      ) : null}
      <div
        className={cn(
          previewLayout === "grid" ? "grid grid-cols-2 gap-2" : "divide-y divide-border/70",
          dense ? "mt-2" : "mt-4",
        )}
      >
        {metrics.map((metric, index) => (
          <CircuitPreviewMetric
            className={cn(previewLayout === "grid" && index === metrics.length - 1 && "col-span-2")}
            icon={metric.icon}
            dense={dense}
            key={metric.label}
            label={metric.label}
            layout={previewLayout}
            value={metric.value}
          />
        ))}
        {previewFooter ? (
          <div className={cn(previewLayout === "grid" && "col-span-2")}>
            {previewFooter}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CircuitPreviewMetric({
  className,
  dense = false,
  icon: Icon,
  label,
  layout = "list",
  value,
}: {
  className?: string;
  dense?: boolean;
  icon: typeof Gauge;
  label: string;
  layout?: "grid" | "list";
  value: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr] gap-3",
        layout === "grid" ? "min-h-16 rounded-md bg-secondary/40 p-3" : dense ? "min-h-12 py-2" : "min-h-14 py-3",
        className,
      )}
    >
      <span className={cn("grid place-items-center rounded-md bg-primary/10 text-primary", dense ? "size-7" : "size-8")}>
        <Icon aria-hidden="true" className={dense ? "size-3.5" : "size-4"} />
      </span>
      <span className="grid min-w-0 content-center gap-1">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="min-w-0 break-words font-mono text-sm font-bold leading-5 text-foreground">
          {value}
        </span>
      </span>
    </div>
  );
}

function CircuitOverview({ stats, trackMapSrc, trackPhoto }: {
  stats: CircuitStatsView;
  trackMapSrc?: string | null;
  trackPhoto?: FantasyTrackVisual | null;
}) {
  const imageSrc = trackMapSrc === undefined ? getCircuitAsset(stats.circuit.slug ?? stats.circuit.name)?.src : trackMapSrc;
  const metrics = [
    { label: "Длина круга", value: formatKm(stats.circuit.lapLengthKm) },
    { label: "Повороты", value: formatNumber(stats.circuit.turnsCount) },
    { label: "Дистанция гонки", value: formatCompactDistanceValue(stats.circuit.raceDistanceKm, stats.circuit.raceLaps) },
    { label: "Первый Гран-при", value: formatNumber(stats.circuit.firstGrandPrixYear) },
  ];

  return (
    <div className="grid gap-6">
      <section aria-label="Трасса в деталях">
        <div className={cn("grid gap-4", trackPhoto && "sm:grid-cols-2")}>
          {trackPhoto ? <FantasyTrackVisualImage className="aspect-[16/9] rounded-lg sm:aspect-auto sm:h-52" showCredit={false} sizes="(max-width: 640px) 100vw, 540px" variant="card" visual={trackPhoto} /> : null}
          <div className="relative flex h-52 min-w-0 items-center justify-center overflow-hidden rounded-lg bg-muted/30 p-3">
            {imageSrc ? <CircuitMapImage src={imageSrc} name={stats.circuit.name} /> : <EmptyLine>Схема этой трассы пока недоступна.</EmptyLine>}
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div className="min-w-0" key={metric.label}>
              <dt className="text-xs text-muted-foreground">{metric.label}</dt>
              <dd className="mt-1.5 break-words font-mono text-sm font-semibold tabular-nums">{metric.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="grid gap-x-6 border-y border-border py-1 sm:grid-cols-3" aria-label="Рекорды трассы">
        <CircuitRecordRow icon={TimerReset} label="Лучший круг в квалификации" value={stats.circuit.lapRecordTime ?? "Нет данных"} detail={[stats.circuit.lapRecordDriver, stats.circuit.lapRecordYear].filter(Boolean).join(" · ")} />
        <CircuitRecordRow icon={Medal} label="Больше всего побед · пилот" value={stats.records.mostSuccessfulDriver ?? "Нет данных"} />
        <CircuitRecordRow icon={Trophy} label="Больше всего побед · команда" value={stats.records.mostSuccessfulTeam ?? "Нет данных"} />
      </section>
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
        <section className="min-w-0">
          <CircuitSectionHeader icon={Flag} title="Насколько важен старт" />
          <div className="mt-4 flex flex-wrap items-center gap-5 sm:flex-nowrap">
            <CircuitPoleChart rate={stats.qualifying.poleWinRate} />
            <dl className="grid min-w-0 flex-1 gap-5">
              <div>
                <dt className="text-xs leading-5 text-muted-foreground">Победы с первого ряда</dt>
                <dd className="mt-1 font-mono text-xl font-semibold">{formatPercent(stats.qualifying.frontRowWinRate)}</dd>
              </div>
              <div>
                <dt className="text-xs leading-5 text-muted-foreground">Средний старт победителя</dt>
                <dd className="mt-1 font-mono text-xl font-semibold">{formatPosition(stats.qualifying.winnerAvgStartPosition)}</dd>
              </div>
            </dl>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">По общей истории трассы: {circuitRaceCount(stats.summary.racesCount)}.</p>
        </section>
        <section className="min-w-0">
          <CircuitSectionHeader icon={ShieldAlert} title="Сколько пилотов сходили" />
          <p className="mt-2 text-xs text-muted-foreground">Сходы в последних гонках на этой трассе</p>
          <CircuitHistoryChart rows={stats.history} />
        </section>
      </div>
    </div>
  );
}

function CircuitMapImage({ src, name }: { src: string; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return failedSrc === src
    ? <EmptyLine>Схема трассы сейчас недоступна.</EmptyLine>
    : <Image alt={`Схема трассы ${name}`} className="object-contain p-3" fill onError={() => setFailedSrc(src)} sizes="(max-width: 640px) 100vw, 540px" src={src} unoptimized />;
}

function CircuitStatsDetails({ stats }: { stats: CircuitStatsView }) {
  const ratings = stats.character.ratings.length ? stats.character.ratings : stats.ratings;
  return (
    <div className="grid gap-7">
      <section>
        <CircuitSectionHeader icon={Gauge} title="Какой бывает гонка" />
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {stats.character.racesCount ? `Оценки по пятибалльной шкале: ${circuitRaceCount(stats.character.racesCount)} с ${stats.character.sinceSeason} года.` : "Оценки появятся, когда будет достаточно истории гонок."}
        </p>
        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          {ratings.map((rating) => <RatingRow key={rating.label} rating={rating} />)}
        </div>
      </section>
      <div className="grid gap-7 border-t border-border pt-6 lg:grid-cols-2 lg:gap-10">
        <section>
          <CircuitSectionHeader icon={ArrowDownUp} title="Борьба за позиции" />
          <div className="mt-3">
            <CircuitFactRow label="Среднее изменение позиции" value={formatSigned(stats.overtaking.avgPositionDelta)} />
            <CircuitFactRow label="Изменение без учёта знака" value={formatNumber(stats.overtaking.avgAbsPositionDelta)} />
            <CircuitFactRow label="Самый большой прорыв" value={formatPositionRecord(stats.overtaking.bestGain)} />
            <CircuitFactRow label="Победа с самой дальней позиции" value={formatPositionRecord(stats.qualifying.bestNonPoleWin)} />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Разница между стартом и финишем учитывает также сходы и штрафы. Это не число обгонов на трассе.</p>
        </section>
        <section>
          <CircuitSectionHeader icon={Activity} title="Пит-стопы и стратегия" />
          <div className="mt-3">
            <CircuitFactRow label="Пит-стопов на пилота" value={formatNumber(stats.strategy.avgPitStops)} />
            <CircuitFactRow label="Первый пит-стоп в среднем" value={stats.strategy.avgFirstPitLap === null ? "Нет данных" : `Круг ${formatNumber(stats.strategy.avgFirstPitLap)}`} />
            <CircuitFactRow label="Обычная стратегия" value={formatStrategy(stats.strategy.mostCommonStrategy)} />
            <CircuitFactRow label="Разнообразие стратегий" value={stats.strategy.strategyVariabilityLevel ?? "Нет данных"} />
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Стратегия может включать справочную оценку RaceSide, если история пит-стопов неполная.</p>
        </section>
      </div>
      <section className="border-t border-border pt-6">
        <CircuitSectionHeader icon={ShieldAlert} title="Нейтрализации и сходы" />
        <p className="mt-2 text-sm text-muted-foreground">Среднее число событий за гонку. Если история неполная, значение остаётся неизвестным.</p>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            ["Safety Car", formatNumber(stats.chaos.safetyCarFrequency)],
            ["Виртуальный Safety Car", formatNumber(stats.chaos.vscFrequency)],
            ["Красные флаги", formatNumber(stats.chaos.redFlagFrequency)],
            ["Сходы", formatNumber(stats.chaos.avgDnfCount)],
          ].map(([label, value]) => <CircuitStatTile key={label} label={label} value={value} />)}
        </div>
        <div className="mt-5"><CircuitFactRow label="Больше всего сходов в одной гонке" value={formatNumber(stats.records.maxDnfCount ?? null)} /></div>
      </section>
    </div>
  );
}

function formatStrategy(value: string | null) {
  if (!value) return "Нет данных";
  return value.replace(/(\d+)\s*[-–]\s*(\d+)\s+stops?/gi, "$1–$2 пит-стопа")
    .replace(/\b1\s+stop\b/gi, "1 пит-стоп")
    .replace(/(\d+)\s+stops?\b/gi, "$1 пит-стопа");
}

function CircuitRecordRow({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail?: string;
  icon: typeof Gauge;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b border-border/65 py-3 last:border-b-0 sm:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold leading-5 text-muted-foreground">{label}</span>
        <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
      </div>
      <p className="break-words text-base font-semibold leading-6 text-foreground">
        {value}
      </p>
      {detail ? <p className="text-xs leading-5 text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function CircuitSectionHeader({
  icon: Icon,
  title,
}: {
  icon: typeof Gauge;
  title: string;
}) {
  return (
    <div>
      <h2 className="flex min-w-0 items-center gap-2 font-display text-lg font-bold leading-tight">
        <Icon aria-hidden="true" className="size-5 shrink-0" />
        <span className="min-w-0 text-wrap">{title}</span>
      </h2>
    </div>
  );
}

function CircuitFactRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid min-h-10 gap-1 border-b border-border/65 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(7rem,auto)] sm:items-center sm:gap-3">
      <span className="min-w-0 text-sm font-medium leading-5 text-foreground">{label}</span>
      <span className="min-w-0 break-words font-mono text-sm leading-5 text-foreground sm:text-right">
        {value}
      </span>
    </div>
  );
}

function CircuitStatTile({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid min-h-20 content-between gap-3 py-3 sm:px-5 sm:py-2 sm:first:pl-0 sm:last:pr-0">
      <p className="text-sm font-medium leading-5 text-foreground">{label}</p>
      <p className="break-words font-telemetry text-xl font-extrabold leading-none text-foreground">
        {value}
      </p>
    </div>
  );
}

function RatingRow({
  rating,
}: {
  rating: CircuitRating;
}) {
  const displayValue = rating.value !== null ? `${rating.value}/5` : "Нет данных";

  return (
    <div className="grid content-start gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{rating.label}</p>
        <span className="text-right font-telemetry text-sm text-muted-foreground">{displayValue}</span>
      </div>
      <div className="grid grid-cols-5 gap-1" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <span
            className={cn(
              "h-1.5 rounded-sm bg-muted",
              rating.value !== null && index < rating.value ? "bg-primary" : null,
            )}
            key={index}
          />
        ))}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{rating.helper}</p>
    </div>
  );
}

function HistoryTable({ rows }: { rows: CircuitGrandPrixHistoryRow[] }) {
  if (!rows.length) return <EmptyLine>История появится, когда будут доступны результаты гонок на этой трассе.</EmptyLine>;

  return (
    <>
      <div className="grid gap-5 sm:hidden">
        {rows.map((row) => (
          <article className="border-b border-border pb-5 last:border-0" key={`${row.season}-${row.round}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <HistorySeason row={row} />
              <span className="font-mono text-xs text-muted-foreground">Старт победителя: {formatPosition(row.winnerStartPosition)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <HistoryMobileFact label="Победитель" value={row.winner} />
              <HistoryMobileFact label="Поул" value={row.pole} />
              <HistoryMobileFact className="col-span-2" label="Подиум" value={row.podium.join(" · ") || "Нет данных"} />
              <HistoryMobileFact label="Команда победителя" value={row.winnerTeam} />
              <HistoryMobileFact label="Сходы" value={String(row.dnfCount ?? "Нет данных")} />
            </div>
            <div className="mt-3 text-xs leading-5 text-muted-foreground"><HistoryEvents row={row} /></div>
          </article>
        ))}
      </div>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Гонка</TableHead>
              <TableHead>Победитель</TableHead>
              <TableHead>Его старт</TableHead>
              <TableHead>Поул</TableHead>
              <TableHead>Подиум</TableHead>
              <TableHead>Сходы</TableHead>
              <TableHead>Нейтрализации</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.season}-${row.round}`}>
                <TableCell><HistorySeason row={row} /></TableCell>
                <TableCell className="py-3">
                  <p className="font-medium">{row.winner}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.winnerTeam}</p>
                </TableCell>
                <TableCell className="font-mono">{formatPosition(row.winnerStartPosition)}</TableCell>
                <TableCell>{row.pole}</TableCell>
                <TableCell className="py-3">
                  {row.podium.length ? <ol className="grid gap-1">{row.podium.map((name, index) => <li className="text-xs" key={`${index}-${name}`}><span className="mr-2 font-mono text-muted-foreground">{index + 1}</span>{name}</li>)}</ol> : "Нет данных"}
                </TableCell>
                <TableCell className="font-mono">{row.dnfCount ?? "Нет данных"}</TableCell>
                <TableCell className="whitespace-normal text-xs leading-5 text-muted-foreground"><HistoryEvents row={row} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function HistorySeason({ row }: { row: CircuitGrandPrixHistoryRow }) {
  return row.season >= 2020 ? (
    <Link className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-mono font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.href} prefetch={false} aria-label={`Результаты: ${row.raceName}, ${row.season}, этап ${row.round}`}>
      {row.season}<ArrowUpRight className="size-3.5" aria-hidden="true" />
    </Link>
  ) : <span className="font-mono font-semibold">{row.season}</span>;
}

function HistoryEvents({ row }: { row: CircuitGrandPrixHistoryRow }) {
  return (
    <span className="grid gap-0.5">
      <span>Safety Car: {row.safetyCarCount ?? "нет данных"}</span>
      <span>Виртуальный: {row.vscCount ?? "нет данных"}</span>
      <span>Красные флаги: {row.redFlagCount ?? "нет данных"}</span>
    </span>
  );
}

function HistoryMobileFact({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words font-medium leading-5">{value}</p>
    </div>
  );
}

function DriverStatsList({ rows }: { rows: CircuitDriverStat[] }) {
  if (!rows.length) {
    return <EmptyLine>Статистика действующих пилотов для этой трассы пока недоступна.</EmptyLine>;
  }
  return (
    <div className="mt-4">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Пилот и выступления</span><span>Победы</span></div>
      <ol className="divide-y divide-border">
        {rows.map((row, index) => {
          const content = (
            <>
              <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">{index + 1}</span>
              <DriverAvatarBadge className="size-11" color={row.teamColor} name={row.driver} slug={row.driverSlug} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{row.driver}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">Стартов {row.starts} · Подиумов {row.podiums}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-2xl font-semibold tabular-nums">{row.wins}</span>
                <span className="mt-1 block text-xs text-muted-foreground">Ср. финиш {formatPosition(row.avgFinishPosition)}</span>
              </span>
            </>
          );
          const classes = "flex min-w-0 items-center gap-3 py-4";
          return (
            <li key={`${row.driver}-${index}`}>
              {row.driverSlug ? (
                <Link className={cn(classes, "rounded-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none")} href={`/drivers/${row.driverSlug}`} prefetch={false}>{content}</Link>
              ) : <div className={classes}>{content}</div>}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">«Финиш» показывает среднюю позицию в гонках на этой трассе.</p>
    </div>
  );
}

function TeamStatsList({ rows }: { rows: CircuitTeamStat[] }) {
  if (!rows.length) {
    return <EmptyLine>Статистика действующих команд для этой трассы пока недоступна.</EmptyLine>;
  }
  return (
    <div className="mt-4">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Команда и выступления</span><span>Победы</span></div>
      <ol className="divide-y divide-border">
        {rows.map((row, index) => {
          const asset = getTeamAsset(row.team);
          return (
            <li className="flex min-w-0 items-center gap-3 py-4" key={`${row.team}-${index}`}>
              <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">{index + 1}</span>
              <span className="team-logo-surface relative grid size-11 shrink-0 place-items-center rounded-md p-1.5" aria-hidden="true">
                {asset?.logo ? <Image alt="" className="object-contain p-1.5" fill sizes="44px" src={asset.logo} /> : <Flag className="size-5 text-muted-foreground" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{row.team}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">Стартов {row.starts} · Подиумов {row.podiums}</span>
                <span className="block text-xs leading-5 text-muted-foreground">В очках обе машины: {row.doublePointsFinishes}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-2xl font-semibold tabular-nums">{row.wins}</span>
                <span className="mt-1 block text-xs text-muted-foreground">Ср. очки {formatNumber(row.avgPoints)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">«Очки» показывает средний результат команды за гонку.</p>
    </div>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <Empty className="py-6 md:p-6"><EmptyHeader><EmptyTitle className="text-base">Пока нет данных</EmptyTitle><EmptyDescription>{children}</EmptyDescription></EmptyHeader></Empty>;
}

function formatKm(value: number | null) {
  return value === null ? "—" : `${value.toFixed(3)} км`;
}

function formatCompactDistanceValue(distance: number | null, laps: number | null) {
  if (distance === null && laps === null) {
    return "—";
  }

  return [
    distance !== null ? `${distance.toFixed(1)} км` : null,
    laps !== null ? `${laps} кругов` : null,
  ].filter(Boolean).join(" · ");
}

function formatLapRecord(time: string | null, driver: string | null, year: number | null) {
  if (!time) {
    return "—";
  }

  return [time, driver, year].filter(Boolean).join(" · ");
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatNumber(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPosition(value: number | null) {
  return value === null ? "—" : `P${formatNumber(value)}`;
}

function formatSigned(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatPositionRecord(record: CircuitStatsView["overtaking"]["bestGain"]) {
  if (!record?.driver) {
    return "—";
  }

  const change = record.start && record.finish ? `P${record.start} → P${record.finish}` : "";

  return [record.driver, change].filter(Boolean).join(" · ");
}

function getCircuitCountryCode(country: string | null | undefined) {
  const normalized = String(country ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  const codes: Record<string, string> = {
    australia: "au",
    austria: "at",
    azerbaijan: "az",
    bahrain: "bh",
    malaysia: "my",
    belgium: "be",
    brazil: "br",
    canada: "ca",
    china: "cn",
    france: "fr",
    germany: "de",
    hungary: "hu",
    italy: "it",
    japan: "jp",
    mexico: "mx",
    monaco: "mc",
    netherlands: "nl",
    qatar: "qa",
    "saudi arabia": "sa",
    singapore: "sg",
    spain: "es",
    uae: "ae",
    uk: "gb",
    "united kingdom": "gb",
    usa: "us",
    "united states": "us",
  };

  return codes[normalized] ?? undefined;
}
