"use client";

import { CheckCircle2, Clock3, Cloud, CloudRain, CloudSun, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getLocalDriverAvatarSrc } from "@/components/racemate/driver-avatar-badge";
import { SessionResultsDialog, type SessionWithResults } from "@/components/racemate/session-results-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { formatSessionName } from "@/lib/session-display";

type HomeSessionStripProps = {
  activeSessionName: string;
  embedded?: boolean;
  sessions: SessionWithResults[];
};

export function HomeSessionStrip({ activeSessionName, embedded = false, sessions }: HomeSessionStripProps) {
  const [selected, setSelected] = useState<SessionWithResults | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !isMobile) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const activeCard = strip.querySelector<HTMLElement>("[data-active='true']");
      const left = activeCard
        ? activeCard.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft
          - (strip.clientWidth - activeCard.clientWidth) / 2
        : 0;

      strip.scrollTo({
        behavior: "auto",
        left,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSessionName, isMobile, sessions]);

  return (
    <>
      <div
        aria-label="Сессии уикенда"
        className={cn(
          "flex snap-x gap-2 overflow-x-auto",
          embedded
            ? "mt-4 pb-1 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible"
            : "p-3 sm:grid sm:grid-cols-5 sm:overflow-visible sm:p-4",
        )}
        ref={stripRef}
      >
        {sessions.map((item) => {
          const winner = item.results.length
            ? item.results.find((result) => result.position === 1) ?? item.results[0]
            : null;
          const winnerAvatarSrc = winner ? getLocalDriverAvatarSrc(winner.driverSlug) : null;
          const isActive = item.session.name === activeSessionName;
          const isLive = item.session.status === "Live";
          const isCompleted = item.session.status === "Завершена";
          const start = splitSessionStart(item.session.startsAt);
          const sessionName = formatSessionName(item.session.name);
          const isSprintQualification = /спринт.*квалификац|sprint.*qualif/i.test(sessionName);

          return (
            <button
              aria-label={`Открыть результаты: ${item.session.name}`}
              className={cn(
                "group relative flex min-h-[7rem] w-[9.25rem] shrink-0 snap-start flex-col overflow-hidden rounded-md border border-border/70 bg-background/35 p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/35 hover:bg-accent/45 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[8.5rem] sm:w-auto sm:p-3.5 sm:pt-4",
                isActive && !isCompleted && "border-primary/45 bg-primary/7",
                isLive && "border-success/45 bg-success/8",
                isCompleted && !isLive && "border-success/25 bg-muted/20",
                embedded && "sm:min-h-[8.5rem]",
              )}
              data-active={isActive ? "true" : undefined}
              key={item.session.id ?? item.session.name}
              onClick={() => setSelected(item)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 top-0 z-20 h-0.5 bg-border",
                  isActive && !isCompleted && "bg-primary",
                  isLive && "bg-success",
                  isCompleted && !isLive && "bg-success/70",
                )}
              />
              {winnerAvatarSrc ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 z-0 w-16 overflow-hidden opacity-25 [mask-image:linear-gradient(to_left,rgba(0,0,0,0.9),transparent)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" className="h-full w-full object-cover object-top" src={winnerAvatarSrc} />
                </span>
              ) : null}
              <span className="relative z-10 flex min-h-7 items-start sm:min-h-9">
                <span className="min-w-0 font-display text-sm font-bold leading-[1.18] sm:text-[0.76rem]">
                  {isSprintQualification ? (
                    <>
                      <span className="block">Спринт</span>
                      <span className="block">квалификация</span>
                    </>
                  ) : sessionName}
                </span>
              </span>
              {isCompleted ? (
                <CheckCircle2 aria-hidden="true" className="absolute bottom-3 right-3 z-20 size-5 text-success sm:size-6" />
              ) : (
                <span className="absolute bottom-3 right-3 z-20 text-muted-foreground">
                  {renderWeatherIcon(item.session.weather?.precipitationMm)}
                </span>
              )}
              <span className="relative z-10 mt-auto grid gap-1 pr-7 text-[0.62rem] leading-none text-muted-foreground sm:pr-8">
                <span className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-foreground">
                  <Clock3 aria-hidden="true" className="size-3 text-primary" />
                  {start.time || "—"}
                </span>
                <span className="whitespace-nowrap">
                  {start.weekday}{start.weekday && start.date ? " · " : ""}{start.date}
                </span>
                <span className="font-telemetry mt-1 whitespace-nowrap text-xs font-bold text-foreground">
                  {item.session.weather?.temperature ?? "—"}
                </span>
                <span className="whitespace-nowrap">
                  {getWeatherLabel(item.session.weather?.precipitationMm)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <SessionResultsDialog onClose={() => setSelected(null)} selected={selected} />
    </>
  );
}

function splitSessionStart(value: string) {
  const [dateWithWeekday, time] = value.split(/,\s*(?=\d{1,2}:\d{2})/);
  const [weekday, ...dateParts] = (dateWithWeekday ?? "").split(/,\s*/);

  return {
    date: dateParts.join(", ").trim() || dateWithWeekday?.trim() || value,
    time: time?.trim() ?? "",
    weekday: dateParts.length ? weekday?.trim() ?? "" : "",
  };
}

function renderWeatherIcon(precipitationMm?: number | null) {
  if (precipitationMm === null || precipitationMm === undefined) {
    return <Cloud aria-hidden="true" className="size-5 sm:size-6" />;
  }

  if (precipitationMm >= 0.4) {
    return <CloudRain aria-hidden="true" className="size-5 sm:size-6" />;
  }

  if (precipitationMm > 0) {
    return <CloudSun aria-hidden="true" className="size-5 sm:size-6" />;
  }

  return <Sun aria-hidden="true" className="size-5 sm:size-6" />;
}

function getWeatherLabel(precipitationMm?: number | null) {
  if (precipitationMm === null || precipitationMm === undefined) {
    return "Прогноз";
  }

  if (precipitationMm >= 0.4) {
    return "Дождь";
  }

  if (precipitationMm > 0) {
    return "Морось";
  }

  return "Сухо";
}
