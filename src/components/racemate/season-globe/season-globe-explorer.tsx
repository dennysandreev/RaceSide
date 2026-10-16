"use client";

import { ArrowRight, Cloud, CloudRain, CloudSun, MapPin, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { HomeSessionStrip } from "@/components/racemate/home-session-strip";
import { RaceFlag } from "@/components/racemate/race-flag";
import { SeasonGlobeSceneLazy } from "@/components/racemate/season-globe/season-globe-scene-lazy";
import type { SessionWithResults } from "@/components/racemate/session-results-dialog";
import { TrackMap } from "@/components/racemate/track-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatSessionName } from "@/lib/session-display";
import {
  formatSeasonGlobeCountdownLabel,
  formatSeasonGlobeDateTimeLabel,
} from "@/lib/season-globe-data";
import type {
  NextSession,
  RaceDetail,
  SeasonGlobeData,
  SeasonGlobeEvent,
  SessionWeather,
  TrackLayout,
} from "@/types/racemate";

type SeasonGlobeExplorerProps = {
  currentRace: RaceDetail | null;
  data: SeasonGlobeData;
  fallbackTrack: {
    assetSrc: string | null;
    circuit: string;
    layout: TrackLayout | null;
  };
  initialSessions: SessionWithResults[];
  initialSessionsRound: number | null;
  nextSession: NextSession;
};

type SessionStripState = {
  items: SessionWithResults[];
  round: number | null;
  status: "error" | "loading" | "ready";
};

export function SeasonGlobeExplorer({
  currentRace,
  data,
  fallbackTrack,
  initialSessions,
  initialSessionsRound,
  nextSession,
}: SeasonGlobeExplorerProps) {
  const router = useRouter();
  const defaultEvent = useMemo(
    () =>
      data.events.find((event) => event.round === data.nextRound) ??
      data.events[0] ??
      null,
    [data.events, data.nextRound],
  );
  const [selectedRound, setSelectedRound] = useState<number | null>(
    defaultEvent?.round ?? null,
  );
  const sessionCacheRef = useRef(
    new Map<number, SessionWithResults[]>(
      initialSessionsRound === null || !initialSessions.length
        ? []
        : [[initialSessionsRound, initialSessions]],
    ),
  );
  const [sessionLoadRevision, setSessionLoadRevision] = useState(0);
  const [countdownNow, setCountdownNow] = useState<number | null>(null);
  const [sessionStrip, setSessionStrip] = useState<SessionStripState>({
    items: initialSessions,
    round: initialSessionsRound,
    status: initialSessions.length ? "ready" : "loading",
  });
  const selectedEvent =
    data.events.find((event) => event.round === selectedRound) ?? defaultEvent;
  const selectedEventCountdown = formatSeasonGlobeCountdownLabel(
    selectedEvent?.weekendStartAtIso ?? null,
    countdownNow,
  );
  const drawableEvents = data.events.filter(
    (event) => event.latitude !== null && event.longitude !== null,
  );
  const fallback = (
    <TrackMap
      assetSrc={fallbackTrack.assetSrc}
      circuit={fallbackTrack.circuit}
      compact
      fill
      layout={fallbackTrack.layout}
      unframed
    />
  );

  useEffect(() => {
    const updateCountdown = () => setCountdownNow(Date.now());

    updateCountdown();
    const timer = window.setInterval(updateCountdown, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const round = selectedEvent?.round;

    if (!round) {
      return;
    }

    const cachedSessions = sessionCacheRef.current.get(round);

    if (cachedSessions) {
      setSessionStrip({ items: cachedSessions, round, status: "ready" });
      return;
    }

    const controller = new AbortController();

    setSessionStrip({ items: [], round, status: "loading" });

    void fetch(`/api/grand-prix/${data.season}/${round}/sessions`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Session request failed with ${response.status}`);
        }

        return response.json() as Promise<{ sessions: SessionWithResults[] }>;
      })
      .then((payload) => {
        const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];

        sessionCacheRef.current.set(round, sessions);
        setSessionStrip({ items: sessions, round, status: "ready" });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setSessionStrip({ items: [], round, status: "error" });
      });

    return () => controller.abort();
  }, [data.season, selectedEvent?.round, sessionLoadRevision]);

  const selectedSessionsAreLoading =
    sessionStrip.round !== selectedEvent?.round || sessionStrip.status === "loading";
  const activeSessionName =
    selectedEvent?.round === initialSessionsRound
      ? nextSession.session
      : sessionStrip.items.find((item) => item.session.status === "Live")?.session.name ?? "";
  const selectedWeather = sessionStrip.round === selectedEvent?.round
    ? (sessionStrip.items.find((item) => item.session.name === activeSessionName) ??
      sessionStrip.items.find((item) => item.session.status !== "Завершена"))?.session.weather
    : undefined;

  const selectRelative = (offset: number) => {
    if (!data.events.length) {
      return;
    }

    const currentIndex = Math.max(
      0,
      data.events.findIndex((event) => event.round === selectedEvent?.round),
    );
    const nextIndex = (currentIndex + offset + data.events.length) % data.events.length;
    setSelectedRound(data.events[nextIndex].round);
  };
  const openSelected = () => {
    if (selectedEvent) {
      router.push(getEventAction(selectedEvent).href);
    }
  };

  return (
    <>
      <HomeSeasonProgress data={data} />
      <header className="flex min-h-8 flex-wrap items-center justify-between gap-3 pb-1">
        <p className="sr-only">{getStageLabel(selectedEvent)}</p>
        <div className="flex shrink-0 items-center gap-2 font-telemetry text-[0.7rem] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          <RaceFlag
            className="h-4 w-6"
            countryCode={selectedEvent?.countryCode ?? currentRace?.countryCode}
            label={selectedEvent?.country ?? currentRace?.country ?? nextSession.race}
            value={selectedEvent ? undefined : currentRace?.countryFlag}
          />
          <span>Раунд {selectedEvent?.round ?? currentRace?.round ?? "-"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={getStageBadgeVariant(selectedEvent, nextSession.status)}>
            {getStageStatus(selectedEvent, nextSession.status, selectedEventCountdown)}
          </Badge>
        </div>
      </header>

      <div className="grid min-w-0 items-center lg:grid-cols-[minmax(12rem,0.78fr)_minmax(0,1.4fr)]">
        <StageDetails
          event={selectedEvent}
          nextSession={nextSession}
          weather={selectedWeather}
        />

        <div className="relative order-2 h-[19rem] min-w-0 sm:h-[24rem] lg:col-start-2 lg:row-start-1 lg:h-[26rem]">
          {selectedEvent && drawableEvents.length ? (
            <SeasonGlobeSceneLazy
              events={data.events}
              fallback={fallback}
              onOpenSelected={openSelected}
              onSelectNext={() => setSelectedRound(data.nextRound ?? defaultEvent?.round ?? null)}
              onSelectRelative={selectRelative}
              onSelectRound={setSelectedRound}
              season={data.season}
              selectedRound={selectedEvent.round}
            />
          ) : (
            fallback
          )}
        </div>
        <div className="order-3 min-w-0 md:hidden">
          <StageSessionDetails event={selectedEvent} nextSession={nextSession} weather={selectedWeather} />
        </div>
      </div>

      <div className="min-w-0 pb-1">
        {selectedSessionsAreLoading ? (
          <SessionStripSkeleton />
        ) : sessionStrip.status === "error" ? (
          <div className="flex min-h-32 items-center justify-between gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Не удалось загрузить сессии этого этапа.
            </p>
            <Button
              onClick={() => setSessionLoadRevision((revision) => revision + 1)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Повторить
            </Button>
          </div>
        ) : sessionStrip.items.length ? (
          <HomeSessionStrip
            activeSessionName={activeSessionName}
            embedded
            sessions={sessionStrip.items}
          />
        ) : (
          <p className="py-8 text-sm text-muted-foreground">
            Сессии этого этапа пока недоступны.
          </p>
        )}
      </div>

      <p aria-live="polite" className="sr-only">
        {selectedEvent
          ? `Раунд ${selectedEvent.round} из ${data.events.length}. ${selectedEvent.raceName}. ${getAccessiblePhase(selectedEvent)}.`
          : "Маршрут сезона пока недоступен."}
      </p>
    </>
  );
}

function HomeSeasonProgress({ data }: { data: SeasonGlobeData }) {
  const totalCount = data.events.length;

  if (!totalCount) {
    return null;
  }

  const completedCount = data.events.filter((event) => event.phase === "completed").length;
  const progressRatio = completedCount / totalCount;
  const progressPercent = Math.round(progressRatio * 100);
  const title = `Прогресс сезона ${data.season}`;
  const progressStyle = {
    "--season-progress-cell": `${100 / totalCount}%`,
    "--season-progress-position": `${progressRatio * 100}%`,
    "--season-progress-ratio": progressRatio,
  } as CSSProperties;

  return (
    <div className="mb-4 hidden border-b border-border/50 pb-3 lg:block" style={progressStyle}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <div className="flex items-baseline gap-4 font-telemetry tabular-nums">
          <p className="text-xs text-muted-foreground">{completedCount} из {totalCount} этапов</p>
          <p className="text-[1.375rem] font-bold leading-none text-foreground">{progressPercent}%</p>
        </div>
      </div>
      <div
        aria-label={title}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progressPercent}
        aria-valuetext={`Завершено ${completedCount} из ${totalCount} этапов`}
        className="home-season-progress-track"
        role="progressbar"
      >
        <span aria-hidden="true" className="home-season-progress-segments">
          <span className="home-season-progress-fill" />
        </span>
        {completedCount > 0 ? (
          <span aria-hidden="true" className="home-season-progress-cursor" />
        ) : null}
      </div>
    </div>
  );
}

function SessionStripSkeleton() {
  return (
    <div
      aria-label="Загружаем сессии выбранного этапа"
      className="mt-4 flex gap-2 overflow-hidden pb-1 sm:grid sm:grid-cols-5 sm:gap-3"
      role="status"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div
          className="min-h-[7rem] w-[9.25rem] shrink-0 animate-pulse rounded-md border border-border/70 bg-muted/25 sm:min-h-[8.5rem] sm:w-auto"
          key={index}
        />
      ))}
    </div>
  );
}

function StageDetails({
  event,
  nextSession,
  weather,
}: {
  event: SeasonGlobeEvent | null;
  nextSession: NextSession;
  weather?: SessionWeather;
}) {
  const raceName = event?.raceName ?? nextSession.race;
  const raceTitleParts = raceName.match(/^Гран-при\s+(.+)$/u);
  const circuitName = event?.circuitName ?? nextSession.circuit;
  const raceTitleLength = Array.from(raceName).length;
  const raceTitleSizeClass =
    raceTitleLength > 32
      ? "text-[1.55rem] sm:text-[1.85rem] lg:text-[1.95rem]"
      : raceTitleLength > 22
        ? "text-[1.7rem] sm:text-[2rem] lg:text-[2.15rem]"
        : "text-3xl sm:text-4xl lg:text-[2.55rem]";

  return (
    <div
      className="season-globe-details order-1 min-w-0 pb-1 pt-4 lg:col-start-1 lg:row-start-1 lg:min-h-[23rem] lg:pb-4 lg:pt-2"
      key={event?.round ?? "fallback"}
    >
      <div className="grid gap-3">
        <h2
          className={`max-w-3xl text-balance font-display font-extrabold leading-[1.04] ${raceTitleSizeClass}`}
          id="next-race-title"
        >
          {raceTitleParts ? (
            <>
              <span className="block whitespace-nowrap">Гран-при</span>{" "}
              <span className="block">{raceTitleParts[1]}</span>
            </>
          ) : raceName}
        </h2>
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground sm:text-base">
          <MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
          <span
            className="min-w-0 break-words"
            data-season-globe-circuit-name
          >
            {circuitName}
          </span>
        </p>
      </div>

      {event?.phase !== "completed" && event?.weekendDateLabel ? (
        <p className="mt-4 text-sm font-medium text-muted-foreground">{event.weekendDateLabel} {event.season}</p>
      ) : null}

      <div className="hidden md:block">
        <StageSessionDetails event={event} nextSession={nextSession} weather={weather} />
      </div>
    </div>
  );
}

function StageSessionDetails({ event, nextSession, weather }: {
  event: SeasonGlobeEvent | null;
  nextSession: NextSession;
  weather?: SessionWeather;
}) {
  const action = event ? getEventAction(event) : { href: "/weekend", label: "Перейти к этапу" };
  const raceCompletionLabel = event
    ? formatSeasonGlobeDateTimeLabel(event.raceEndAtIso)
    : null;
  const raceStartLabel = event
    ? formatSeasonGlobeDateTimeLabel(event.raceStartAtIso)
    : null;
  return (
    <div className="mt-5 border-t border-border/70 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          {event?.phase === "completed" ? (
            <div>
              <p className="font-telemetry text-[0.64rem] font-bold uppercase tracking-[0.1em] text-primary">
                Уикенд {event.weekendDateLabel}
              </p>
              <div className="mt-1.5 grid gap-0.5">
                <p className="text-sm font-bold text-foreground">Гонка завершилась</p>
                <p className="text-xs text-muted-foreground">
                  {raceCompletionLabel ?? event.raceDateLabel}
                </p>
              </div>
            </div>
          ) : event?.phase === "upcoming" ? (
            <div>
              <p className="font-telemetry text-[0.64rem] font-bold uppercase tracking-[0.1em] text-primary">
                Дата гонки
              </p>
              <div className="mt-1.5 grid gap-0.5">
                <p className="text-sm font-bold text-foreground">Гонка</p>
                <p className="text-xs text-muted-foreground">
                  {raceStartLabel ?? event.raceDateLabel}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="whitespace-nowrap font-telemetry text-[0.64rem] font-bold uppercase tracking-[0.1em] text-primary">
                Следующая сессия
              </p>
              <div className="mt-1.5 grid gap-0.5">
                <p className="text-sm font-bold text-foreground">
                  {formatSessionName(nextSession.session)}
                </p>
                <p className="text-xs text-muted-foreground">{nextSession.startsAt}</p>
              </div>
            </div>
          )}
        </div>
        {event?.phase !== "completed" && weather?.temperatureC != null ? (
          <StageWeather weather={weather} />
        ) : null}
      </div>

      <Button asChild className="mt-4 w-full" variant="secondary">
        <Link href={action.href} prefetch={false}>
          {action.label}
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </Button>
    </div>
  );
}

function StageWeather({ weather }: { weather: SessionWeather }) {
  const rain = weather.precipitationMm;
  const Icon = rain == null ? Cloud : rain >= 0.4 ? CloudRain : rain > 0 ? CloudSun : Sun;
  const label = rain == null ? "Прогноз погоды" : rain >= 0.4 ? "Дождь" : rain > 0 ? "Морось" : "Без осадков";

  return (
    <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
      <Icon aria-hidden="true" className="size-6 shrink-0 text-warning" strokeWidth={1.4} />
      <div>
        <p className="font-telemetry text-lg font-bold leading-tight text-foreground">{weather.temperature}</p>
        <p className="mt-1 max-w-[4.75rem] text-xs">{label}</p>
      </div>
    </div>
  );
}

function getStageLabel(event: SeasonGlobeEvent | null) {
  if (event?.phase === "completed") {
    return "Прошедший этап";
  }

  if (event?.phase === "upcoming") {
    return "Будущий этап";
  }

  return "Следующий этап";
}

function getStageStatus(
  event: SeasonGlobeEvent | null,
  nextStatus: string,
  eventCountdown: string | null,
) {
  if (event?.phase === "completed") {
    return "Завершен";
  }

  if (event?.phase === "upcoming") {
    return eventCountdown ?? "Скоро";
  }

  return nextStatus;
}

function getStageBadgeVariant(
  event: SeasonGlobeEvent | null,
  nextStatus: string,
): "outline" | "success" | "warning" {
  if (event?.phase === "completed") {
    return "outline";
  }

  return event?.isLive || nextStatus === "Live" ? "success" : "warning";
}

function getEventAction(event: SeasonGlobeEvent) {
  if (event.phase === "completed") {
    return { href: event.href, label: "Открыть итоги" };
  }

  if (event.phase === "next") {
    return { href: "/weekend", label: "Перейти к этапу" };
  }

  return { href: event.href, label: "Открыть этап" };
}

function getAccessiblePhase(event: SeasonGlobeEvent) {
  if (event.phase === "completed") {
    return "Этап завершен";
  }

  if (event.phase === "next") {
    return "Следующий этап";
  }

  return "Этап еще не прошел";
}
