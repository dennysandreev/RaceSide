"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Maximize,
  Minimize,
  Wifi,
  CloudRain,
  DropletOff,
  Droplets,
  Wind,
  ChevronDown,
  FastForward,
  Flag,
  Pause,
  Play,
  Rewind,
} from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { RaceSideLogoSvg } from "@/components/racemate/racemate-logo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LiveProvider,
  useConnection,
  useLive,
  useLiveReplay,
  useLiveViewingMode,
  useLiveSeekRevision,
  useLiveNow,
} from "./live-provider";
import { LiveViewSwitch, LiveRewindControls } from "./live-rewind";
import {
  TimingTower,
  SelectedDriver,
  DetailedTiming,
  ordered,
} from "./live-timing";
import { LiveTrack } from "./live-track";
import { PitStops } from "./live-pit-stops";
import { ChampionshipPoints } from "./live-points";
import { Analytics, DriverPanel, EventFeed, RadioFeed } from "./live-panels";
import { sessionCapabilities, sessionLabel } from "../lib/session";
import { gapText, lapTime } from "../lib/format";
import type { RaceReplaySnapshot } from "@/types/racemate";
import "./live.css";
const flagLabels: Record<string, string> = {
  GREEN: "Зелёный флаг",
  YELLOW: "Жёлтый флаг",
  RED: "Красный флаг",
  SC: "Сейфти-кар",
  SC_ENDING: "Сейфти-кар уходит",
  VSC: "Виртуальный сейфти-кар",
  VSC_ENDING: "VSC завершается",
  CHEQUERED: "Финиш",
};
export function LiveTerminal({
  replay,
  returnUrl,
}: {
  replay?: RaceReplaySnapshot;
  returnUrl: string;
}) {
  return (
    <LiveProvider replay={replay}>
      <Terminal returnUrl={returnUrl} />
    </LiveProvider>
  );
}
function Terminal({ returnUrl }: { returnUrl: string }) {
  const replay = useLiveReplay();
  const viewingMode = useLiveViewingMode(), seekRevision = useLiveSeekRevision();
  const [selected, setSelected] = useState<number | null>(null),
    [mode, setMode] = useState("track"),
    [feed, setFeed] = useState("events"),
    [filter, setFilter] = useState<number | null>(null),
    [eventFilter, setEventFilter] = useState<number | null>(null),
    [seenRadio, setSeenRadio] = useState<string[]>([]);
  const radio = useLive("radio"),
    drivers = useLive("drivers"),
    session = useLive("session"),
    flag = useLive("flag");
  const readyRadio = radio.filter(
    (message) =>
      message.status === "ready" && Boolean(message.original && message.ru),
  );
  const selectedNumber =
    (selected !== null && drivers[selected] ? selected : null) ??
    Object.values(drivers).sort(
      (a, b) => (a.position ?? 99) - (b.position ?? 99),
    )[0]?.driverNumber ??
    null;
  const onSelect = useCallback((n: number) => setSelected(n), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target instanceof HTMLElement &&
          (e.target.matches("input,textarea,select") ||
            e.target.isContentEditable))
      )
        return;
      const tab = ["track", "timing", "driver", "pits", "analytics", ...(!replay ? ["points"] : [])][Number(e.key) - 1];
      if (tab) {
        e.preventDefault();
        setMode(tab);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [replay]);
  const openEvents = () => {
    setEventFilter(selectedNumber);
    setFeed("events");
    if (matchMedia("(max-width: 1199px)").matches) setMode("events");
  };
  const unseen = readyRadio.filter(
    (message) => !seenRadio.includes(message.id),
  ).length;
  return (
    <main
      className="live-terminal"
      data-flag={flag}
      data-replay={replay ? "true" : undefined}
      data-rewind={viewingMode === "rewind" ? "true" : undefined}
    >
      <Hud returnUrl={returnUrl} />
      <div className="live-body">
        <aside className="live-left">
          <TimingTower selected={selectedNumber} onSelect={onSelect} />
          <SelectedDriver
            selected={selectedNumber}
            onEvents={openEvents}
            onDetails={() => setMode("driver")}
          />
        </aside>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            setMode(value);
            if (value === "radio")
              setSeenRadio(readyRadio.map((message) => message.id));
          }}
          className="live-workspace"
        >
          <TabsList variant="line" className="live-workspace-tabs">
            {[
              ["track", "Трасса"],
              ["timing", "Тайминг"],
              ["driver", "Пилот"],
              ["pits", "Пит-стопы"],
              ["analytics", "Аналитика"],
              ...(!replay ? [["points", "Очки"]] : []),
              ["events", "События"],
              ["radio", "Радио"],
            ].map(([key, title]) => (
              <TabsTrigger
                key={key}
                value={key}
                className={key === "events" || key === "radio" ? "live-mobile-tab" : ""}
              >
                {title}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="track" className="live-track-panel">
            <SessionWorkspace selected={selectedNumber} onSelect={onSelect} />
            <TelemetryStrip selected={selectedNumber} />
          </TabsContent>
          <TabsContent value="timing" className="live-central-panel">
            <DetailedTiming selected={selectedNumber} onSelect={onSelect} />
          </TabsContent>
          <TabsContent value="driver" className="live-central-panel">
            <DriverPanel selected={selectedNumber} />
          </TabsContent>
          <TabsContent value="analytics" className="live-central-panel">
            <Analytics />
          </TabsContent>
          <TabsContent value="pits" className="live-central-panel">
            <PitStops key={session?.session_key} selected={selectedNumber} onSelect={onSelect} />
          </TabsContent>
          {!replay ? <TabsContent value="points" className="live-central-panel">
            <ChampionshipPoints selected={selectedNumber} onSelect={onSelect} />
          </TabsContent> : null}
          <TabsContent value="events" className="live-central-panel">
            <EventFeed
              key={`${session?.session_key}:${seekRevision}`}
              filter={eventFilter}
              onFilter={setEventFilter}
            />
          </TabsContent>
          <TabsContent value="radio" className="live-central-panel">
            <RadioFeed
              key={`${session?.session_key}:${seekRevision}`}
              filter={filter}
              onFilter={setFilter}
            />
          </TabsContent>
        </Tabs>
        <Tabs
          value={feed}
          onValueChange={(value) => {
            setFeed(value);
            if (value === "radio")
              setSeenRadio(readyRadio.map((message) => message.id));
          }}
          className="live-right"
        >
          <TabsList variant="line" className="live-feed-tabs">
            <TabsTrigger value="events">События</TabsTrigger>
            <TabsTrigger value="radio">
              Радио{" "}
              {unseen > 0 && feed !== "radio" ? (
                <span className="live-unread">{unseen}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="events">
            <EventFeed
              key={`${session?.session_key}:${seekRevision}`}
              filter={eventFilter}
              onFilter={setEventFilter}
            />
          </TabsContent>
          <TabsContent value="radio">
            <RadioFeed
              key={`${session?.session_key}:${seekRevision}`}
              filter={filter}
              onFilter={setFilter}
            />
          </TabsContent>
        </Tabs>
      </div>
      {!replay ? <LiveRewindControls /> : null}
      {replay ? <ReplayControls /> : null}
    </main>
  );
}
function Hud({ returnUrl }: { returnUrl: string }) {
  const router = useRouter();
  const replay = useLiveReplay();
  const rewinding = useLiveViewingMode() === "rewind";
  const session = useLive("session"),
    status = useLive("status"),
    flag = useLive("flag"),
    lap = useLive("currentLap"),
    total = useLive("totalLaps"),
    phase = useLive("phase"),
    replayReady = useLive("replayReady"),
    connection = useConnection();
  const capabilities = sessionCapabilities(session);
  const [fullscreen, setFullscreen] = useState(false);
  const available = useSyncExternalStore(
    () => () => {},
    () => Boolean(document.fullscreenEnabled),
    () => false,
  );
  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const toggle = () => {
    const action = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    void action.catch(() => {});
  };
  const leaveLive = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!document.fullscreenElement) return;
    event.preventDefault();
    void document
      .exitFullscreen()
      .catch(() => {})
      .finally(() => router.push(returnUrl));
  };
  return (
    <header className="live-hud">
      <div className="live-hud-start">
        <Button
          asChild
          variant="ghost"
          size="icon"
          title="Вернуться"
          aria-label="Вернуться на текущий этап"
        >
          <Link href={returnUrl} onClick={leaveLive}>
            <ArrowLeft />
          </Link>
        </Button>
        <span aria-label={`RaceSide ${replay ? "Replay" : "LIVE"}`} className="live-wordmark" role="img">
          <RaceSideLogoSvg className="live-logo" width={128} />
          <b aria-hidden="true">{replay ? "REPLAY" : "LIVE"}</b>
        </span>
        <strong className="live-grand-prix">
          {session?.race_name ?? session?.circuit_short_name ?? "Текущий этап"}
        </strong>
      </div>
      {!replay ? <LiveViewSwitch /> : null}
      <div className="live-session-hud">
        <span className="live-indicator" data-active={status === "live" && !rewinding}>
          {replay
            ? replay.isPlaying
              ? "Повтор"
              : "Пауза"
            : status === "finished"
            ? "Финиш"
            : status === "waiting"
              ? "Скоро"
              : status === "paused"
                ? "Пауза"
                : rewinding ? "Перемотка" : "LIVE"}
        </span>
        <span>{session ? sessionLabel(session) : "Сессия"}</span>
        {capabilities.showQualifyingPhase && phase ? (
          <strong>{phase}</strong>
        ) : capabilities.showLapCounter && lap > 0 ? (
          <strong>
            {lap}
            {total ? ` / ${total}` : ""} <small>кр.</small>
          </strong>
        ) : null}
        {capabilities.showCountdown && <SessionCountdown />}
        {flag && (
          <span className="live-flag" data-flag={flag}>
            <Flag />
            {flagLabels[flag] ?? flag}
          </span>
        )}
      </div>
      <div className="live-hud-end">
        <HudWeather />
        {replay ? (
          <span className="live-replay-clock">
            {formatReplayClock(replay.elapsedMs)} / {formatReplayClock(replay.durationMs)}
          </span>
        ) : (
          <span
            className="live-connection"
            data-connected={connection === "connected"}
            title={
              connection === "connected"
                ? "Соединение установлено"
                : connection === "offline"
                  ? "Нет связи. Переподключаемся автоматически."
                  : "Восстанавливаем соединение"
            }
          >
            <Wifi />
            <span>
              {connection === "connected"
                ? rewinding ? "На связи" : "В эфире"
                : connection === "offline"
                  ? "Нет связи"
                  : "Подключение…"}
            </span>
          </span>
        )}
        {!replay && replayReady && session && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/race-replay/${session.session_key}`}>
              Открыть повтор
            </Link>
          </Button>
        )}
        {available && (
          <Button
            size="icon"
            variant="ghost"
            onClick={toggle}
            aria-label={
              fullscreen ? "Выйти из полного экрана" : "На весь экран"
            }
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
        )}
      </div>
    </header>
  );
}

function HudWeather() {
  const weather = useLive("weather");
  const wind = weather?.wind == null ? "—" : `${(weather.wind * 3.6).toFixed(1).replace(".", ",")} км/ч`;
  const humidity = weather?.humidity == null ? "—" : `${weather.humidity}%`;
  const rain = weather?.rain === 1 ? "Дождь" : weather?.rain === 0 ? "Без дождя" : "Дождь —";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="live-hud-weather" aria-label="Погода на трассе" title="Погода на трассе">
          <span title="Температура воздуха / трассы">{weather?.air ?? "—"}° / {weather?.track ?? "—"}°</span>
          <span className="live-hud-weather-extra">
            <span title="Влажность"><Droplets aria-hidden="true" />{humidity}</span>
            <span title="Ветер"><Wind aria-hidden="true" />{wind}</span>
            <span>
              {weather?.rain === 1 ? <CloudRain aria-hidden="true" /> : weather?.rain === 0 ? <DropletOff aria-hidden="true" /> : null}
              {rain}
            </span>
          </span>
          <ChevronDown className="live-weather-chevron" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="live-weather-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Погода на трассе">
          <h2>Погода на трассе</h2>
          <dl className="live-weather">
            <div><dt>Воздух</dt><dd>{weather?.air ?? "—"}°C</dd></div>
            <div><dt>Трасса</dt><dd>{weather?.track ?? "—"}°C</dd></div>
            <div><dt>Влажность</dt><dd>{humidity}</dd></div>
            <div><dt>Ветер</dt><dd>{wind}</dd></div>
            <div><dt>Осадки</dt><dd>{rain}</dd></div>
          </dl>
          {weather && <p>Обновлено в {new Date(weather.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ReplayControls() {
  const replay = useLiveReplay();

  useEffect(() => {
    if (!replay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.matches("input,textarea,select") ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        replay.toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        replay.seekBy(-15_000);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        replay.seekBy(15_000);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [replay]);

  if (!replay) return null;

  return (
    <section className="live-replay-controls" aria-label="Управление повтором">
      <div className="live-replay-actions">
        <Button onClick={replay.toggle} size="sm" type="button">
          {replay.isPlaying ? <Pause /> : <Play />}
          {replay.isPlaying ? "Пауза" : "Смотреть"}
        </Button>
        <Button
          aria-label="Назад на 15 секунд"
          onClick={() => replay.seekBy(-15_000)}
          size="icon"
          title="Назад на 15 секунд"
          type="button"
          variant="secondary"
        >
          <Rewind />
        </Button>
        <Button
          aria-label="Вперёд на 15 секунд"
          onClick={() => replay.seekBy(15_000)}
          size="icon"
          title="Вперёд на 15 секунд"
          type="button"
          variant="secondary"
        >
          <FastForward />
        </Button>
        <div className="live-replay-speeds" aria-label="Скорость повтора">
          {[1, 2, 5, 10].map((speed) => (
            <button
              aria-pressed={replay.speed === speed}
              data-active={replay.speed === speed}
              key={speed}
              onClick={() => replay.setSpeed(speed)}
              type="button"
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
      <input
        aria-label="Позиция повтора"
        max={replay.durationMs}
        min={0}
        onChange={(event) => replay.seekTo(Number(event.target.value))}
        type="range"
        value={Math.round(replay.elapsedMs)}
      />
      <span className="live-replay-time">
        {formatReplayClock(replay.elapsedMs)} / {formatReplayClock(replay.durationMs)}
      </span>
    </section>
  );
}

function formatReplayClock(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;

  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
function SessionWorkspace({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (n: number) => void;
}) {
  const session = useLive("session"),
    status = useLive("status");
  const now = useLiveNow();
  if (!session || status === "waiting") {
    const seconds = session
      ? Math.max(0, Math.floor((Date.parse(session.date_start) - now) / 1000))
      : null;
    return (
      <div className="live-waiting">
        <span>RaceSide LIVE</span>
        <h1>{session ? "Следующая сессия" : "Ждём следующую сессию"}</h1>
        <p>
          {(session ? sessionLabel(session) : null) ??
            "Расписание появится, как только восстановится связь."}
        </p>
        {seconds !== null && (
          <time>
            {String(Math.floor(seconds / 3600)).padStart(2, "0")}:
            {String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:
            {String(seconds % 60).padStart(2, "0")}
          </time>
        )}
      </div>
    );
  }
  return <LiveTrack selected={selected} onSelect={onSelect} />;
}
function TelemetryStrip({ selected }: { selected: number | null }) {
  const drivers = useLive("drivers"),
    session = useLive("session");
  const d = selected === null ? null : drivers[selected];
  const timed = sessionCapabilities(session).rankByLapTime;
  const rows = ordered(drivers, session),
    best = Math.min(
      ...rows
        .filter((driver) => !driver.eliminatedIn)
        .map((driver) => driver.bestLap ?? Infinity),
    );
  return (
    <div className="live-telemetry-strip">
      {d ? (
        <>
          <div className="live-strip-driver">
            <b>P{timed ? rows.indexOf(d) + 1 : (d.position ?? "—")}</b>
            <strong style={{ color: d.teamColour }}>{d.acronym}</strong>
          </div>
          <div className="live-strip-metric">
            <span>{timed ? "От лучшего" : "От лидера"}</span>
            <b>
              {timed
                ? d.bestLap
                  ? gapText(d.bestLap - best)
                  : "—"
                : gapText(d.gap)}
            </b>
          </div>
          <div className="live-strip-metric">
            <span>Последний круг</span>
            <b>{lapTime(d.lastLap)}</b>
          </div>
          {d.sectors.map((s, i) => (
            <div className="live-strip-metric live-strip-sector" key={i}>
              <span>Сектор {i + 1}</span>
              <b
                className={
                  s != null && s === d.bestSectors[i] ? "live-green" : ""
                }
              >
                {s?.toFixed(3) ?? "—"}
              </b>
            </div>
          ))}
        </>
      ) : (
        <span>Выберите пилота на трассе или в тайминге</span>
      )}
    </div>
  );
}

function SessionCountdown() {
  const session = useLive("session"),
    phaseEnd = useLive("phaseEndsAt"),
    timerPausedAt = useLive("timerPausedAt"),
    timerOffsetMs = useLive("timerOffsetMs"),
    status = useLive("status");
  const now = useLiveNow();
  const capabilities = sessionCapabilities(session);
  const end = capabilities.mode === "practice" ? session?.date_end : phaseEnd;
  if (!end || !["live", "paused"].includes(status)) return null;
  const clock =
    status === "paused" && timerPausedAt ? Date.parse(timerPausedAt) : now;
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(end) + (timerOffsetMs ?? 0) - clock) / 1000),
  );
  return (
    <strong>
      {String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </strong>
  );
}
