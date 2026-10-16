"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, Cloud, CloudRain, CloudSun, Sun } from "lucide-react";

import { getLocalDriverAvatarSrc } from "@/components/racemate/driver-avatar-badge";
import { SessionResultsDialog, type SessionWithResults } from "@/components/racemate/session-results-dialog";
import { cn } from "@/lib/utils";
import { formatSessionName, splitSessionStart } from "@/lib/session-display";

type WeekendSessionBoardProps = {
  activeSessionName: string;
  initialSessionId?: string;
  sessions: SessionWithResults[];
};

export function WeekendSessionBoard({
  activeSessionName,
  initialSessionId,
  sessions,
}: WeekendSessionBoardProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<SessionWithResults | null>(() =>
    sessions.find((item) => item.session.id === initialSessionId) ?? null,
  );

  function closeResults() {
    setSelected(null);

    if (initialSessionId) {
      router.replace("/weekend", { scroll: false });
    }
  }

  return (
    <>
      <div className="min-w-0">
        {sessions.map((item) => {
          const sessionStatus = item.results.length ? "Завершена" : item.session.status;
          const isLive = sessionStatus === "Live";
          const isCurrentTarget = item.session.name === activeSessionName;
          const isCompleted = sessionStatus === "Завершена";
          const isHighlighted = isLive || (isCurrentTarget && !isCompleted);
          const winner = isCompleted
            ? item.results.find((result) => result.position === 1) ?? item.results[0] ?? null
            : null;
          const winnerAvatar = winner ? getLocalDriverAvatarSrc(winner.driverSlug) : null;
          const start = splitSessionStart(item.session.startsAt);

          return (
            <button
              className={cn(
                "group relative grid min-h-[3.9rem] w-full cursor-pointer grid-cols-[minmax(0,1fr)_6.25rem_1rem] items-center gap-x-3 border-b border-border/70 px-4 py-2.5 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:grid-cols-[6rem_minmax(0,1fr)_8.5rem_1rem] sm:px-5",
                isLive
                  ? "bg-success/10 text-foreground"
                  : isHighlighted
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-accent/70",
                "touch-manipulation",
              )}
              key={item.session.id ?? item.session.name}
              onClick={() => setSelected(item)}
              title={winner ? `Победитель: ${winner.driver}` : undefined}
              type="button"
            >
              {isHighlighted ? (
                <span
                  aria-hidden="true"
                  className={cn("absolute inset-y-0 left-0 w-0.5", isLive ? "bg-success" : "bg-primary")}
                />
              ) : null}
              <div className="hidden min-w-0 sm:block">
                <time dateTime={item.session.startsAtIso} className="font-telemetry text-lg font-bold leading-tight text-foreground">
                  {start.time ?? "—"}
                </time>
                <p className="mt-1 text-xs leading-4 text-muted-foreground">{start.date}</p>
              </div>
              <div className="min-w-0">
                {isHighlighted ? (
                  <p className={cn("mb-1 text-xs font-semibold", isLive ? "text-success" : "text-primary")}>
                    {isLive ? "Live сейчас" : "Следующая"}
                  </p>
                ) : null}
                <div className="flex min-w-0 items-center gap-2">
                  {isCompleted ? <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success" /> : null}
                  <p className="min-w-0 font-display text-sm font-bold leading-5 text-foreground [overflow-wrap:anywhere] sm:text-base sm:leading-6">
                    {formatSessionName(item.session.name)}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-4 text-muted-foreground sm:hidden">
                  <time dateTime={item.session.startsAtIso}>
                    {start.time ? `${start.time}${start.date ? " · " : ""}` : ""}{start.date}
                  </time>
                </p>
                {isCompleted ? (
                  <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {winnerAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="size-6 shrink-0 rounded-full object-cover object-top" src={winnerAvatar} />
                    ) : null}
                    <span className="truncate">{winner ? `Победитель: ${winner.driver}` : "Завершена"}</span>
                  </div>
                ) : null}
              </div>
              <div className="min-w-0 text-right">
                <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2">
                  <WeatherIcon precipitationMm={item.session.weather?.precipitationMm} />
                  <p className="whitespace-nowrap font-telemetry text-base font-bold leading-none text-foreground sm:text-lg">
                    {item.session.weather?.temperature ?? "—"}
                  </p>
                </div>
                <p className="mt-1.5 text-xs leading-4 text-muted-foreground">
                  {getWeatherLabel(item.session.weather?.precipitationMm)}
                </p>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-colors group-hover:text-foreground motion-reduce:transition-none" />
            </button>
          );
        })}
      </div>

      <SessionResultsDialog onClose={closeResults} selected={selected} />
    </>
  );
}

function WeatherIcon({ precipitationMm }: { precipitationMm?: number | null }) {
  if (precipitationMm === null || precipitationMm === undefined) {
    return <Cloud className="size-5 shrink-0" aria-hidden="true" />;
  }

  if (precipitationMm >= 0.4) {
    return <CloudRain className="size-5 shrink-0" aria-hidden="true" />;
  }

  if (precipitationMm > 0) {
    return <CloudSun className="size-5 shrink-0" aria-hidden="true" />;
  }

  return <Sun className="size-5 shrink-0" aria-hidden="true" />;
}

function getWeatherLabel(precipitationMm?: number | null) {
  if (precipitationMm === null || precipitationMm === undefined) {
    return "Прогноз уточняется";
  }

  if (precipitationMm >= 0.4) {
    return "Дождь";
  }

  if (precipitationMm > 0) {
    return "Может моросить";
  }

  return "Сухо";
}
