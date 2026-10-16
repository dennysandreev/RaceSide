"use client";
import Link from "next/link";
import Image from "next/image";
import { formatGrandPrixNameRu } from "@/lib/race-display";
import { PageTitle } from "@/components/racemate/page-title";
import { SeasonSwitcher } from "@/components/racemate/season-switcher";
import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowLeftRight,
  Activity,
  Cog,
  FlaskConical,
  Users,
  Layers,
  Share2,
  SlidersHorizontal,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import type { CursorStore } from "../lib/client";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type {
  CompareConfig,
  Comparison,
  Meeting,
  Session,
  Mode,
  Channel,
  SavedComparison,
  RacePace,
  LapSelection,
  TelemetryBootstrapData,
  TelemetryBootstrapStage,
  TelemetrySetupCatalog,
} from "../lib/types";
import {
  telemetryBootstrapLabel,
  telemetryBootstrapRequest,
  telemetryRequest,
  createCursorStore,
  trackTelemetry,
} from "../lib/client";
import {
  lapTime,
  lapAnalysisRows,
  gearAnalysisRows,
  number,
  deltaTime,
  getTraceColors,
  teamColor,
  sessionName,
  lapLabel,
  lapDetail,
} from "../lib/format";
import { TelemetryChart } from "./telemetry-chart";
import { TelemetryTrack } from "./telemetry-track";
import { TelemetryIntelligence } from "./telemetry-intelligence";
import { TelemetryShare } from "./telemetry-share";
import { telemetryFlags } from "../lib/flags";
import { RacePaceWorkspace, type RacePaceView } from "./race-pace";
const comparisonKinds = [
  { value: "drivers", label: "Пилоты и круги", icon: Users },
  { value: "session", label: "Сессии", icon: Layers },
  { value: "race-pace", label: "Темп гонки", icon: Activity },
] as const;
const views = [
  ["overview", "Обзор"],
  ["speed", "Скорость"],
  ["pedals", "Педали"],
  ["engine", "Мотор и передачи"],
  ["track", "Трасса"],
  ["profile", "Сравнение участков"],
  ["exits", "Выходы и разгон"],
  ["signals", "Управление энергией"],
  ["analysis", "Разбор круга"],
];
const analysisViews = new Set(["profile", "exits", "signals", "analysis"]);
const isRaceSession = (session?: Session | null) =>
  session?.type.toLowerCase() === "race" ||
  ["race", "sprint"].includes(session?.name.toLowerCase() ?? "");
const isMainRaceSession = (session?: Session | null) =>
  session?.name.toLowerCase() === "race";
const initialDrivers = (catalog?: TelemetrySetupCatalog | null) => {
  const sorted = [...(catalog?.drivers ?? [])].sort(
    (a, b) => (a.position ?? 99) - (b.position ?? 99),
  );
  return [sorted[0]?.number ?? 0, sorted[1]?.number ?? 0];
};
export function TelemetryHub({
  demoMode = false,
  initialSeason,
  initialMeeting,
  initialSession,
  initialMode = "best",
  saved,
  initialMeetingName,
  initialBootstrap,
  initialRacePace = false,
  initialPaceView,
}: {
  demoMode?: boolean;
  initialSeason?: number;
  initialMeeting?: number;
  initialSession?: number;
  initialMode?: Mode;
  saved?: SavedComparison;
  initialMeetingName?: string;
  initialBootstrap?: TelemetryBootstrapData;
  initialRacePace?: boolean;
  initialPaceView?: RacePaceView;
}) {
  const [paceMode, setPaceModeState] = useState(initialRacePace);
  const paceModeRef = useRef(initialRacePace);
  function setPaceMode(enabled: boolean) {
    paceModeRef.current = enabled;
    setPaceModeState(enabled);
  }
  const bootstrapCatalog = initialBootstrap?.catalog ?? null;
  const [seasons, setSeasons] = useState<number[]>(
      initialBootstrap?.seasons ?? [],
    ),
    [season, setSeason] = useState(
      initialBootstrap?.season ??
        initialSeason ??
        new Date().getUTCFullYear(),
    );
  const [meetings, setMeetings] = useState<Meeting[]>(
      initialBootstrap?.meetings ?? [],
    ),
    [meeting, setMeeting] = useState(
      initialBootstrap?.meeting ?? initialMeeting ?? 0,
    ),
    [sessions, setSessions] = useState<Session[]>(
      initialBootstrap?.sessions ?? [],
    ),
    [selectedSession, setSelectedSession] = useState(
      initialBootstrap?.session ?? initialSession ?? 0,
    ),
    [selectedSecondSession, setSelectedSecondSession] = useState(0);
  const [catalogs, setCatalogs] = useState<
      (TelemetrySetupCatalog | null)[]
    >([bootstrapCatalog, bootstrapCatalog]),
    [drivers, setDrivers] = useState(initialDrivers(bootstrapCatalog)),
    [laps, setLaps] = useState<LapSelection[]>(["best", "best"]);
  const [mode, setMode] = useState<Mode>(
      saved?.comparison.config.mode ?? initialMode,
    ),
    [view, setView] = useState("overview"),
    [windowMode, setWindowMode] = useState<"weekend" | "session">(demoMode ? "session" : "weekend");
  const [comparison, setComparison] = useState<Comparison | null>(
      saved?.comparison ?? null,
    ),
    [requestConfig, setRequestConfig] = useState<CompareConfig | null>(
      saved?.comparison.config ?? null,
    ),
    [comparisonMeetingName, setComparisonMeetingName] = useState(initialMeetingName),
    [savedId, setSavedId] = useState(saved?.id);
  const [range, setRange] = useState<[number, number]>(
      saved?.comparison.config.range ?? [
        0,
        saved?.comparison.track.length ?? 1,
      ],
    ),
    [corner, setCorner] = useState<number | undefined>(
      saved?.comparison.config.corner,
    );
  const bootstrapReady = initialBootstrap?.stage === "ready";
  const [loading, setLoading] = useState(!saved && !bootstrapReady),
    [loadingPhase, setLoadingPhase] = useState<
      "initial" | "catalog" | "comparison" | null
    >(saved || bootstrapReady ? null : "initial"),
    [bootstrapStage, setBootstrapStage] = useState<TelemetryBootstrapStage>(
      initialBootstrap?.stage ?? "seasons",
    ),
    [error, setError] = useState(""),
    [share, setShare] = useState(false),
    [editing, setEditing] = useState(false),
    [showInvalid, setShowInvalid] = useState(false);
  const controller = useRef<AbortController | null>(null),
    cursor = useMemo(() => createCursorStore(), []);
  const mainSession = catalogs[0]?.session;
  function begin(phase: "initial" | "catalog" | "comparison" = "catalog") {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setLoading(true);
    setLoadingPhase(phase);
    setError("");
    return c.signal;
  }
  function fail(e: unknown) {
    if (e instanceof Error && e.name === "AbortError") return;
    setError(
      e instanceof Error ? e.message : "Не удалось загрузить телеметрию.",
    );
    setLoading(false);
    setLoadingPhase(null);
  }
  const load = <T,>(path: string, signal: AbortSignal) =>
    telemetryRequest<T>(path, {
      signal,
    });
  function applyBootstrap(data: TelemetryBootstrapData) {
    setBootstrapStage(data.stage);
    setSeasons(data.seasons);
    if (data.season != null) setSeason(data.season);
    setMeetings(data.meetings);
    if (data.meeting != null) setMeeting(data.meeting);
    setSessions(data.sessions);
    if (data.session != null) setSelectedSession(data.session);
    if (data.catalog) {
      setCatalogs([data.catalog, data.catalog]);
      setSelectedSecondSession(0);
      setDrivers(initialDrivers(data.catalog));
      setLaps(["best", "best"]);
    }
    if (data.stage === "ready") {
      setLoading(false);
      setLoadingPhase(null);
    }
  }
  async function loadInitialBootstrap(signal: AbortSignal) {
    const data = await telemetryBootstrapRequest(
      {
        season: initialSeason,
        meeting: initialMeeting,
        session: initialSession,
      },
      { signal, onProgress: applyBootstrap },
    );
    if (!signal.aborted) {
      applyBootstrap(data);
      if (paceModeRef.current && !isMainRaceSession(data.catalog?.session)) {
        await openRaceSession(data.sessions, signal);
      }
    }
  }
  async function pickSession(id: number, signal: AbortSignal, index = 0, firstCatalog?: TelemetrySetupCatalog) {
    if (index === 0) {
      setSelectedSession(id);
      const nextSession = sessions.find((session) => session.id === id);
      setSelectedSecondSession(mode === "session" &&
        catalogs[1]?.session.meetingId === nextSession?.meetingId &&
        catalogs[1]?.session.id !== id ? catalogs[1]?.session.id ?? 0 : 0);
      setCatalogs([null, null]);
    } else {
      setSelectedSecondSession(id);
    }
    const catalog = await load<TelemetrySetupCatalog>(
      `setup-catalog?session=${id}`,
      signal,
    );
    if (signal.aborted) return;
    if (index === 0) {
      const second = mode === "session" && !paceModeRef.current &&
        catalogs[1]?.session.meetingId === catalog.session.meetingId &&
        catalogs[1]?.session.id !== catalog.session.id ? catalogs[1] : catalog;
      const available = catalog.drivers.filter((driver) =>
        second.drivers.some((other) => other.number === driver.number));
      const keepDriver = mode === "session" && !paceModeRef.current &&
        available.some((driver) => driver.number === drivers[0]);
      setCatalogs([catalog, second]);
      setDrivers((old) => keepDriver ? old : initialDrivers({ ...catalog, drivers: available }));
      setLaps((old) => ["best", second !== catalog && keepDriver ? old[1] : "best"]);
    } else {
      setCatalogs((old) => [old[0], catalog]);
      const available = (firstCatalog ?? catalogs[0])?.drivers.filter((driver) =>
        catalog.drivers.some((other) => other.number === driver.number)) ?? [];
      const keepDriver = !firstCatalog && available.some((driver) => driver.number === drivers[0]);
      setDrivers((old) => available.some((driver) => driver.number === old[0])
        ? old : initialDrivers({ ...catalog, drivers: available }));
      setLaps((old) => [keepDriver ? old[0] : "best", "best"]);
    }
    setLoading(false);
    setLoadingPhase(null);
    return catalog;
  }
  async function openRaceSession(list: Session[], signal: AbortSignal) {
    if (signal.aborted) return;
    const race = list.find(isMainRaceSession);
    if (race) {
      setLoading(true);
      setLoadingPhase("catalog");
      await pickSession(race.id, signal);
    } else {
      setLoading(false);
      setLoadingPhase(null);
    }
  }
  async function pickMeeting(
    id: number,
    signal: AbortSignal,
    sessionId?: number,
  ) {
    if (!editing) { setPaceRequested(false); setPaceData(null); }
    setMeeting(id);
    setSelectedSession(0);
    setSelectedSecondSession(0);
    setSessions([]);
    setCatalogs([null, null]);
    const list = await load<Session[]>(`sessions?meeting=${id}`, signal);
    if (signal.aborted) return;
    setSessions(list);
    if (sessionId && !list.some((s) => s.id === sessionId))
      throw new Error("Эта сессия недоступна для выбранного Гран-при.");
    if (!list.length) {
      setCatalogs([null, null]);
      setLoading(false);
      setLoadingPhase(null);
      return;
    }
    if (paceModeRef.current) {
      await openRaceSession(list, signal);
      return;
    }
    const chosen =
      list.find((s) => s.id === sessionId) ??
      [...list].reverse().find((s) => s.type === "Qualifying") ??
      list.at(-1)!;
    const first = await pickSession(chosen.id, signal);
    if (mode === "session" && !signal.aborted) {
      const other = list.find((session) => session.id !== chosen.id);
      if (other && first) await pickSession(other.id, signal, 1, first);
    }
  }
  async function pickSeason(
    year: number,
    signal: AbortSignal,
    meetingId?: number,
    sessionId?: number,
  ) {
    if (!editing) { setPaceRequested(false); setPaceData(null); }
    setSeason(year);
    setMeeting(0);
    setMeetings([]);
    setSessions([]);
    setSelectedSession(0);
    setSelectedSecondSession(0);
    setCatalogs([null, null]);
    const list = await load<Meeting[]>(`meetings?season=${year}`, signal);
    if (signal.aborted) return;
    setMeetings(list);
    if (meetingId && !list.some((m) => m.id === meetingId))
      throw new Error("Этот Гран-при не найден в выбранном сезоне.");
    const chosen =
      list.find((m) => m.id === meetingId) ??
      [...list].sort((a, b) => Date.parse(b.start) - Date.parse(a.start))[0];
    if (chosen) await pickMeeting(chosen.id, signal, sessionId);
    else {
      setLoading(false);
      setLoadingPhase(null);
    }
  }
  useEffect(() => {
    trackTelemetry("telemetry_open", saved?.id);
    if (saved) return () => controller.current?.abort();
    if (initialBootstrap?.stage === "ready")
      return () => controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    const timer = window.setTimeout(() => {
      void loadInitialBootstrap(c.signal).catch(fail);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      c.abort();
    };
    // Initial route selection is loaded once; subsequent changes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => cursor.destroy(), [cursor]);
  async function compare() {
    if (!catalogs[0]) return;
    setEditing(false);
    const signal = begin("comparison");
    const selectedMode = mode;
    const config: CompareConfig = {
      mode: selectedMode,
      reference: 0,
      window: windowMode,
      traces: [
        {
          session: catalogs[0].session.id,
          driver: drivers[0],
          lap: selectedMode === "lap" ? laps[0] : "best",
        },
      ],
    };
    if (!["teammate", "evolution"].includes(selectedMode))
      config.traces.push({
        session: (selectedMode === "session" ? catalogs[1] : catalogs[0])!
          .session.id,
        driver: selectedMode === "session" ? drivers[0] : drivers[1],
        lap: ["lap", "session"].includes(selectedMode) ? laps[1] : "best",
      });
    if (selectedMode === "session") config.traces[0].lap = laps[0];
    try {
      const result = await telemetryRequest<Comparison>("compare", {
        body: config,
        signal,
      });
      if (signal.aborted) return;
      setComparison(result);
      setComparisonMeetingName(meetings.find(
        (item) => item.id === result.traces[0].session.meetingId,
      )?.name);
      setEditing(false);
      setRequestConfig(config);
      setRange([0, result.track.length]);
      setCorner(undefined);
      setSavedId(undefined);
      setMode(selectedMode);
      setLoading(false);
      setLoadingPhase(null);
      cursor.set(0);
      trackTelemetry("telemetry_compare_created");
    } catch (e) {
      fail(e);
    }
  }
  function selectCorner(n: number) {
    const c = comparison?.track.corners.find((c) => c.number === n);
    if (c) {
      setCorner(n);
      setRange([c.start, c.end]);
      cursor.set(c.apex);
      trackTelemetry("telemetry_corner_selected");
    }
  }
  function showRange(next: [number, number]) {
    setRange(next);
    setCorner(undefined);
    cursor.set(Math.max(next[0], Math.min(next[1], cursor.get())));
  }
  function showView(next: string) {
    if (comparison && ["speed", "pedals", "engine"].includes(next)) {
      setRange([0, comparison.track.length]);
      setCorner(undefined);
    }
    setView(next);
  }
  const channels: ("delta" | Channel)[] =
    view === "overview"
      ? ["delta", "speed"]
      : view === "speed"
        ? ["speed"]
        : view === "pedals"
          ? ["throttle", "brake"]
          : view === "engine"
            ? ["gear", "rpm"]
            : [];
  const editable = !saved;
  const editingCatalog = Boolean(
    editing && loading && loadingPhase === "catalog",
  );
  const kind = paceMode ? "race-pace" : mode === "session" || mode === "evolution" ? mode : "drivers";
  const manualLaps = kind !== "evolution" && mode !== "teammate";
  const sameSelection =
    kind === "drivers" &&
    mode !== "teammate" &&
    drivers[0] === drivers[1] &&
    laps[0] === laps[1];
  const missingSession =
    mode === "session" &&
    (!catalogs[1] || catalogs[1].session.id === mainSession?.id);
  const sessionDrivers = (catalogs[0]?.drivers ?? []).filter((driver) =>
    !catalogs[1] || catalogs[1].drivers.some((other) => other.number === driver.number));
  const missingSessionDriver = kind === "session" &&
    !sessionDrivers.some((driver) => driver.number === drivers[0]);
  function updateLaps(next: LapSelection[]) {
    setLaps(next);
    if (kind === "drivers" && mode !== "teammate")
      setMode(next.every((lap) => lap === "best") ? "best" : "lap");
  }
  function chooseLap(index: number, value: string) {
    const next = laps.map((lap, i) =>
      i === index
        ? value === "best" || value === "race_average"
          ? value
          : Number(value)
        : lap,
    );
    updateLaps(next);
    trackTelemetry("telemetry_lap_selected");
  }
  function chooseDriver(index: number, value: string) {
    if (value === "teammate") {
      setMode("teammate");
      setLaps(["best", "best"]);
      return;
    }
    setDrivers((old) =>
      old.map((driver, i) => (i === index ? Number(value) : driver)),
    );
    const next =
      kind === "session"
        ? ["best" as const, "best" as const]
        : laps.map((lap, i) => (i === index ? ("best" as const) : lap));
    setLaps(next);
    if (kind === "drivers" && (mode !== "teammate" || index === 1))
      setMode(next.every((lap) => lap === "best") ? "best" : "lap");
    trackTelemetry("telemetry_driver_selected");
  }
  const traceColors = comparison ? getTraceColors(comparison) : [];
  const [paceRequested, setPaceRequested] = useState(initialRacePace && Boolean(initialSession));
  const [paceActionsContainer, setPaceActionsContainer] = useState<HTMLDivElement | null>(null);
  const [paceData, setPaceData] = useState<RacePace | null>(null);
  function setupSnapshot() {
    return { paceMode, mode, season, meeting, meetings, sessions, selectedSession, selectedSecondSession,
      catalogs, drivers, laps, showInvalid, paceRequested, paceData, windowMode };
  }
  const settingsSnapshot = useRef<ReturnType<typeof setupSnapshot> | null>(null);
  function openSettings() {
    settingsSnapshot.current = setupSnapshot();
    setEditing(true);
  }
  function changeSettingsOpen(open: boolean) {
    if (open) { openSettings(); return; }
    controller.current?.abort();
    const previous = settingsSnapshot.current;
    if (previous) {
      setPaceMode(previous.paceMode); setMode(previous.mode);
      setSeason(previous.season); setMeeting(previous.meeting);
      setMeetings(previous.meetings); setSessions(previous.sessions);
      setSelectedSession(previous.selectedSession); setCatalogs(previous.catalogs);
      setSelectedSecondSession(previous.selectedSecondSession);
      setDrivers(previous.drivers); setLaps(previous.laps);
      setShowInvalid(previous.showInvalid); setWindowMode(previous.windowMode);
      setPaceRequested(previous.paceRequested); setPaceData(previous.paceData);
    }
    setError(""); setLoading(false); setLoadingPhase(null); setEditing(false);
  }
  const paceScreen = editing ? settingsSnapshot.current?.paceMode ?? paceMode : paceMode;
  const paceReady = (editing && paceScreen && Boolean(paceData) ||
    !loading && !error && Boolean(paceRequested && mainSession && paceData?.session.id === mainSession.id));
  const shownPaceSession = editing && paceScreen ? paceData?.session : mainSession;
  const raceLoaded = useCallback((data: RacePace) => {
    setPaceData(data);
    setEditing(false);
  }, []);
  const comparisonModeTabs = (
      <Tabs
        value={kind}
        onValueChange={(value) => {
          setPaceMode(value === "race-pace");
          setError("");
          if (value === "race-pace") {
            if (!editing) { setPaceRequested(false); setPaceData(null); }
            if (!isMainRaceSession(mainSession) && loadingPhase !== "initial") {
              void openRaceSession(sessions, begin()).catch(fail);
            }
            return;
          }
          setLaps(["best", "best"]);
          setShowInvalid(false);
          setMode(value === "drivers" ? "best" : (value as Mode));
          if (!catalogs[0] && !demoMode) {
            const chosen = [...sessions].reverse().find((session) => session.type === "Qualifying") ?? sessions.at(-1);
            if (chosen) {
              const signal = begin();
              void pickSession(chosen.id, signal).then(async (first) => {
                if (value !== "session" || !first || signal.aborted) return;
                const other = sessions.find((session) => session.id !== first.session.id);
                if (other) await pickSession(other.id, signal, 1, first);
              }).catch(fail);
            }
          } else if (
            value === "session" &&
            catalogs[1]?.session.id === mainSession?.id
          ) {
            const other = sessions.find(
              (session) => session.id !== mainSession?.id,
            );
            if (other) void pickSession(other.id, begin(), 1).catch(fail);
          }
        }}
      >
        <TabsList className="telemetry-mode-switch" aria-label="Что сравнить">
          {comparisonKinds.map((item) => (
              <TabsTrigger
                disabled={demoMode && item.value === "session" || loading && loadingPhase !== "initial"}
                title={demoMode && item.value === "session" ? "Сравнение разных сессий доступно с RaceSide Plus" : undefined}
                key={item.value}
                value={item.value}
              >
                <item.icon aria-hidden="true" className="size-3.5" />
                {item.label}{demoMode && item.value === "session" ? " · Plus" : ""}
              </TabsTrigger>
            ))}
        </TabsList>
      </Tabs>
  );
  const demoSession = comparison?.traces[0]?.session ?? sessions[0];
  const demoMeetingName = initialMeetingName ?? meetings.find((item) => item.id === demoSession?.meetingId)?.name;
  const demoNotice = demoMode ? (
    <Alert className="telemetry-demo-notice" role="region" aria-label="Демо телеметрии">
      <div className="telemetry-demo-icon" aria-hidden="true"><FlaskConical /></div>
      <div className="telemetry-demo-copy">
        <AlertTitle className="line-clamp-none">В демо доступна одна гонка</AlertTitle>
        <AlertDescription>
          <p>
            {demoSession && demoMeetingName
              ? `${formatGrandPrixNameRu(demoMeetingName)} · ${demoSession.season} · ${sessionName(demoSession.name)}`
              : "Готовим демо одной гонки."}
            {demoSession && demoMeetingName && " · Любые пилоты и круги."}
          </p>
          <p>Оформите RaceSide Plus, чтобы открыть телеметрию всех Гран-при и сессий.</p>
        </AlertDescription>
      </div>
      <Button asChild size="sm" className="telemetry-demo-cta">
        <Link href="/plus#plans" title="Другие сессии доступны с RaceSide Plus">
          Оформить Plus<ArrowUpRight data-icon="inline-end" />
        </Link>
      </Button>
    </Alert>
  ) : null;
  const controls = editable ? (
    <>
      {demoNotice}
      {editing && error && <Alert variant="destructive">
        <AlertTitle>Не удалось обновить выбор</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>}
      <FieldGroup className="telemetry-selectors">
        {(comparison || paceReady || editing) && (
          <Field className="telemetry-season-field">
            <FieldLabel htmlFor="telemetry-season">Сезон</FieldLabel>
            <select
              id="telemetry-season"
              value={season}
              disabled={
                demoMode || seasons.length === 0 || (loading && loadingPhase !== "initial")
              }
              onChange={(event) =>
                void pickSeason(Number(event.target.value), begin()).catch(fail)
              }
            >
              {seasons.length === 0 && (
                <option value={season}>
                  {loading ? "Загружаем сезоны" : "Нет доступных сезонов"}
                </option>
              )}
              {seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field className="telemetry-meeting-field">
          <FieldLabel htmlFor="telemetry-meeting">Гран-при</FieldLabel>
          <select
            id="telemetry-meeting"
            value={meeting}
            disabled={
              demoMode || meetings.length === 0 || (loading && loadingPhase !== "initial")
            }
            onChange={(event) =>
              void pickMeeting(Number(event.target.value), begin()).catch(fail)
            }
          >
            {meetings.length === 0 && (
              <option value={0}>
                {loading ? "Загружаем этапы" : "Нет доступных этапов"}
              </option>
            )}
            {meetings.map((item) => (
              <option key={item.id} value={item.id}>
                {formatGrandPrixNameRu(item.name).replace(/^Гран-при\s+/i, "")}
              </option>
            ))}
          </select>
        </Field>
        {!paceMode && kind !== "session" && <Field className="telemetry-session-field">
          <FieldLabel id="telemetry-session-label">
            Сессия
          </FieldLabel>
          {sessions.length === 0 ? (
            <p className="telemetry-session-placeholder" role="status">
              {loading ? "Загружаем сессии" : "Нет доступных сессий"}
            </p>
          ) : (
            <Tabs
              value={String(selectedSession)}
              onValueChange={(value) =>
                void pickSession(Number(value), begin()).catch(fail)
              }
            >
              <TabsList
                className="telemetry-session-options"
                aria-labelledby="telemetry-session-label"
              >
                {sessions.map((session) => (
                  <TabsTrigger
                    key={session.id}
                    value={String(session.id)}
                    disabled={demoMode || loading && loadingPhase !== "initial"}
                  >
                    {sessionName(session.name)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </Field>}
      </FieldGroup>
      {loading && (loadingPhase === "initial" || loadingPhase === "catalog") && (
        <div role="status" className="telemetry-setup-progress">
          <Cog aria-hidden="true" className="telemetry-loading-gear" />
          <div>
            <p className="telemetry-loading-title">
              {loadingPhase === "initial"
                ? telemetryBootstrapLabel[bootstrapStage]
                : "Обновляем выбор"}
            </p>
            <p className="telemetry-loading-description">
              Загрузка может занять время
            </p>
          </div>
        </div>
      )}
      {comparisonModeTabs}
      {!paceMode && catalogs[0] && (
        <>
        {kind === "session" && (
          <Field className="telemetry-session-driver">
            <FieldLabel htmlFor="telemetry-session-driver">Пилот</FieldLabel>
            <div className="telemetry-driver-choice">
              <DriverAvatarBadge
                className="telemetry-choice-avatar"
                name={sessionDrivers.find((driver) => driver.number === drivers[0])?.name ?? "Пилот"}
                slug={sessionDrivers.find((driver) => driver.number === drivers[0])?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                season={season}
                fallbackLabel={sessionDrivers.find((driver) => driver.number === drivers[0])?.code}
                color="transparent"
                sizes="48px"
              />
              <select id="telemetry-session-driver"
                value={missingSessionDriver ? 0 : drivers[0]}
                disabled={loading || !sessionDrivers.length}
                onChange={(event) => chooseDriver(0, event.target.value)}>
                {!sessionDrivers.length && <option value={0}>Нет общих пилотов</option>}
                {[...sessionDrivers].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
                  .map((driver) => <option key={driver.id} value={driver.number}>{driver.name} · {driver.team}</option>)}
              </select>
            </div>
          </Field>
        )}
        <FieldGroup className={`telemetry-picks${kind === "session" ? " telemetry-session-picks" : ""}`}>
          {[0, 1]
            .filter((index) => index === 0 || kind !== "evolution")
            .map((index) => {
              const catalog = (
                index === 1 && kind === "session" ? catalogs[1] : catalogs[0]
              )!;
              const driverNumber =
                kind === "session" ? drivers[0] : drivers[index];
              const choices = catalog.laps
                .filter(
                  (lap) =>
                    lap.driverNumber === driverNumber &&
                    (showInvalid ||
                      (!lap.deleted &&
                        lap.complete &&
                        !lap.pitIn &&
                        !lap.pitOut)),
                )
                .sort((a, b) => a.number - b.number);
              return (
                <FieldGroup
                  className="telemetry-pick"
                  key={index}
                  style={
                    {
                      "--trace": teamColor(
                        catalog.drivers.find(
                          (driver) => driver.number === driverNumber,
                        ),
                      ),
                    } as React.CSSProperties
                  }
                >
                  {kind === "session" ? (
                    <Field>
                      <FieldLabel htmlFor={index === 0 ? "telemetry-first-session" : "telemetry-second-session"}>
                        {index === 0 ? "Первая сессия" : "Вторая сессия"}
                      </FieldLabel>
                      <select
                        id={index === 0 ? "telemetry-first-session" : "telemetry-second-session"}
                        value={index === 1
                          ? missingSession ? "" : selectedSecondSession || catalog.session.id
                          : selectedSession}
                        disabled={loading || sessions.length < (index === 0 ? 1 : 2)}
                        onChange={(event) =>
                          void pickSession(
                            Number(event.target.value),
                            begin(),
                            index,
                          ).catch(fail)
                        }
                      >
                        {index === 1 && missingSession && (
                          <option value="" disabled>
                            Нет другой сессии
                          </option>
                        )}
                        {sessions
                          .filter((session) => index === 0
                            ? missingSession || session.id !== catalogs[1]?.session.id
                            : session.id !== mainSession?.id)
                          .map((session) => (
                            <option key={session.id} value={session.id}>
                              {sessionName(session.name)}
                            </option>
                          ))}
                      </select>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor={`telemetry-driver-${index}`}>
                        {index === 0 ? "Пилот" : "Соперник"}
                      </FieldLabel>
                      <div className="telemetry-driver-choice">
                        {!(index === 1 && mode === "teammate") && (
                          <DriverAvatarBadge
                            className="telemetry-choice-avatar"
                            name={
                              catalog.drivers.find(
                                (driver) => driver.number === driverNumber,
                              )?.name ?? "Пилот"
                            }
                            slug={catalog.drivers
                              .find((driver) => driver.number === driverNumber)
                              ?.name.toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")}
                            season={season}
                            fallbackLabel={
                              catalog.drivers.find(
                                (driver) => driver.number === driverNumber,
                              )?.code
                            }
                            color="transparent"
                            sizes="48px"
                          />
                        )}
                        <select
                          id={`telemetry-driver-${index}`}
                          value={
                            index === 1 && mode === "teammate"
                              ? "teammate"
                              : driverNumber
                          }
                          disabled={loading}
                          onChange={(event) =>
                            chooseDriver(index, event.target.value)
                          }
                        >
                          {index === 1 && (
                            <option value="teammate">
                              Напарник по команде
                            </option>
                          )}
                          {[...catalog.drivers]
                            .sort(
                              (a, b) => (a.position ?? 99) - (b.position ?? 99),
                            )
                            .map((driver) => (
                              <option key={driver.id} value={driver.number}>
                                {driver.name} · {driver.team}
                              </option>
                            ))}
                        </select>
                      </div>
                    </Field>
                  )}
                  {manualLaps && (
                    <Field>
                      <FieldLabel htmlFor={`telemetry-lap-${index}`}>
                        {kind === "session"
                          ? isRaceSession(catalog.session) ? "Круг или темп" : "Круг"
                          : isRaceSession(catalog.session)
                            ? "Круг или темп"
                            : "Круг"}
                      </FieldLabel>
                      <select
                        id={`telemetry-lap-${index}`}
                        value={laps[index]}
                        disabled={loading || (index === 1 && missingSession)}
                        onChange={(event) =>
                          chooseLap(index, event.target.value)
                        }
                      >
                        <option value="best">Лучший доступный</option>
                        {isRaceSession(catalog.session) && (
                          <option value="race_average">
                            Средний темп гонки
                          </option>
                        )}
                        {choices.map((lap) => (
                          <option key={lap.id} value={lap.number}>
                            Круг {lap.number} · {lapTime(lap.time)}
                            {lap.deleted
                              ? " · удалён"
                              : lap.pitIn || lap.pitOut
                                ? " · пит-лейн"
                                : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </FieldGroup>
              );
            })}
          {kind === "evolution" && (
            <Field>
              <FieldLabel htmlFor="telemetry-evolution-window">
                Период
              </FieldLabel>
              <select
                id="telemetry-evolution-window"
                value={windowMode}
                disabled={loading}
                onChange={(event) =>
                  setWindowMode(event.target.value as "weekend" | "session")
                }
              >
                <option value="weekend">Весь уикенд</option>
                <option value="session">Начало и конец сессии</option>
              </select>
            </Field>
          )}
        </FieldGroup>
        </>
      )}
      {!paceMode && catalogs[0] && manualLaps && (
        <label className="telemetry-invalid-toggle">
          <input
            type="checkbox"
            checked={showInvalid}
            onChange={(event) => {
              setShowInvalid(event.target.checked);
              if (!event.target.checked)
                updateLaps(
                  laps.map((value, index) => {
                    if (value === "best" || value === "race_average")
                      return value;
                    const catalog =
                      index === 1 && kind === "session"
                        ? catalogs[1]
                        : catalogs[0];
                    const driver =
                      kind === "session" ? drivers[0] : drivers[index];
                    const lap = catalog?.laps.find(
                      (lap) =>
                        lap.driverNumber === driver && lap.number === value,
                    );
                    return lap &&
                      lap.complete &&
                      !lap.deleted &&
                      !lap.pitIn &&
                      !lap.pitOut
                      ? value
                      : "best";
                  }),
                );
            }}
          />
          Включить удалённые круги и заезды через пит-лейн
        </label>
      )}
      {paceMode && <div className="telemetry-controls-action">
        <p aria-hidden="true" />
        <Button data-slot="button" disabled={loading || !isMainRaceSession(mainSession)} onClick={() => {
          setPaceData(null);
          setPaceRequested(true);
          setEditing(false);
        }}>
          <Activity data-icon="inline-start" />Показать темп
        </Button>
      </div>}
      {!paceMode && <div
        className="telemetry-controls-action"
        data-warning={Boolean(catalogs[0] && (sameSelection || missingSession || missingSessionDriver))}
      >
        <p aria-live="polite">
          {!catalogs[0]
            ? ""
            : sameSelection
              ? "Для сравнения выберите разные круги."
              : missingSession
                ? "Для сравнения нужна ещё одна завершённая сессия."
                : missingSessionDriver
                  ? "В этих сессиях нет общего пилота для сравнения."
                : mode === "teammate"
                  ? "Сравним лучшие круги пилотов одной команды."
                  : kind === "session"
                    ? "Один пилот в двух сессиях выбранного Гран-при."
                    : kind === "evolution"
                      ? "Посмотрим, как менялся темп пилота."
                      : "Сравним выбранные круги на одной дистанции."}
        </p>
        <Button
          data-slot="button"
          disabled={
            loading ||
            !catalogs[0] ||
            !drivers[0] ||
            (kind === "drivers" && mode !== "teammate" && !drivers[1]) ||
            sameSelection ||
            missingSession || missingSessionDriver
          }
          onClick={() => void compare()}
        >
          <ArrowLeftRight data-icon="inline-start" />
          {loadingPhase === "comparison" ? "Готовим сравнение" : "Сравнить"}
        </Button>
      </div>}
    </>
  ) : null;
  const selectedMeeting = meetings.find((item) => item.id === meeting);
  const selectedHeadingSessions = [
    selectedSession,
    ...(mode === "session" ? [selectedSecondSession || catalogs[1]?.session.id] : []),
  ].flatMap((id) => {
    const session = sessions.find((item) => item.id === id &&
      item.meetingId === meeting && item.season === season);
    return session ? [sessionName(session.name)] : [];
  }).filter((name, index, list) => list.indexOf(name) === index);
  const showSelectedHeading = editable && !error && (
    editing || loadingPhase === "comparison" || paceScreen && paceRequested && !paceReady
  );
  const headingSeason = showSelectedHeading ? season :
    (paceScreen ? shownPaceSession?.season : comparison?.traces[0].session.season) ?? season;
  const raceName = showSelectedHeading ? selectedMeeting?.name : paceScreen
    ? (meetings.find((item) => item.id === shownPaceSession?.meetingId) ??
      settingsSnapshot.current?.meetings.find((item) => item.id === shownPaceSession?.meetingId))?.name
    : comparisonMeetingName ?? meetings.find(
      (item) => item.id === comparison?.traces[0].session.meetingId,
    )?.name;
  const selectedHeadingDetails = [selectedMeeting?.circuit, season,
    selectedHeadingSessions.join(" / ")].filter(Boolean).join(" · ");
  const showComparisonHeading = Boolean(comparison || loadingPhase === "comparison");
  const showPaceHeading = Boolean(paceReady || paceRequested && selectedMeeting);
  const comparisonSummary = comparison && (!loading || editingCatalog) && (
    <div className="telemetry-summary">
      {comparison.traces.map((t, i) => {
        const parts = t.driver.name
          .toLowerCase()
          .split(" ")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
        const slug = t.driver.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return (
          <div
            className="telemetry-competitor"
            key={t.lap.id}
            style={{ "--trace": traceColors[i] } as React.CSSProperties}
          >
            <DriverAvatarBadge
              className="telemetry-avatar"
              name={t.driver.name}
              slug={slug}
              season={t.session.season}
              fallbackLabel={t.driver.code}
              color="transparent"
              sizes="32px"
            />
            <div className="telemetry-identity">
              <span className="telemetry-team">{t.driver.team}</span>
              <h2>
                <span>{parts.slice(0, -1).join(" ")}</span> {parts.at(-1)}
              </h2>
              <div className="telemetry-lap-context">
                <span className="telemetry-trace-key">{t.driver.code}</span>
                <span>{lapLabel(t.lap)}</span>
                {t.lap.kind !== "race_average" && (
                  <span
                    className="telemetry-tyre"
                    data-compound={t.lap.compound}
                  >
                    {t.lap.compound?.slice(0, 1) ?? "?"}
                  </span>
                )}
              </div>
              {t.lap.deleted && <Badge variant="danger">Круг удалён</Badge>}
              {t.lap.status
                .filter((status) => status !== "GREEN" && status !== "UNKNOWN")
                .map((status) => (
                  <Badge key={status} variant="outline">
                    {status}
                  </Badge>
                ))}
            </div>
            <div className="telemetry-lap-time">
              <span>{sessionName(t.session.name)}</span>
              <strong>{lapTime(t.lap.time)}</strong>
              <span>{lapDetail(t.lap)}</span>
            </div>
          </div>
        );
      })}
      <div
        className="telemetry-final-delta"
        style={{
          "--delta-color": traceColors[
            (comparison.traces[0].lap.time ?? 0) <
            (comparison.traces[1].lap.time ?? 0) ? 0 : 1
          ],
        } as React.CSSProperties}
      >
        <span>Разница на финише</span>
        <strong>
          {deltaTime(
            (comparison.traces[0].lap.time ?? 0) -
              (comparison.traces[1].lap.time ?? 0),
          )}
          <small> с</small>
        </strong>
        <p>
          <ArrowUpRight aria-hidden="true" />
          {
            comparison.traces[
              (comparison.traces[0].lap.time ?? 0) <
              (comparison.traces[1].lap.time ?? 0)
                ? 0
                : 1
            ].driver.code
          }{" "}
          быстрее
        </p>
      </div>
    </div>
  );
  if (paceScreen) {
    return (
      <div className="telemetry-hub" data-ready={paceReady} data-view="race-pace">
        <section className="telemetry-event stitch-panel" data-setup={!paceReady}>
          {!paceReady && <>
            <Image alt="" className="telemetry-event-image" fill priority
              sizes="(max-width: 768px) 100vw, 72rem" src="/stitch/telemetry-hero.webp" />
            <div aria-hidden="true" className="telemetry-event-shade" />
          </>}
          <header className="telemetry-heading p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="stitch-label flex items-center gap-2 text-primary">
                  <Activity aria-hidden="true" className="size-3.5" />
                  Телеметрия · сезон {headingSeason}
                </p>
                {demoMode && !paceReady && <Badge>Демо</Badge>}
              </div>
              <PageTitle className="mt-2 max-w-4xl">
                {showPaceHeading ? formatGrandPrixNameRu(raceName ?? "Гонка") : "Телеметрия"}
              </PageTitle>
              {showPaceHeading ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {[showSelectedHeading ? selectedMeeting?.circuit : shownPaceSession?.circuit,
                  headingSeason, "Темп гонки"].filter(Boolean).join(" · ")}
              </p> : <SeasonSwitcher
                activeSeason={season}
                className="mt-3"
                onSeasonChange={(year) => void pickSeason(year, begin()).catch(fail)}
                pathname="/telemetry"
                seasons={seasons.length ? seasons : [season]}
              />}
            </div>
            {paceReady && <div className="telemetry-heading-actions">
              <div className="race-pace-header-actions" ref={setPaceActionsContainer} />
              <Button data-slot="button" variant="outline" aria-label="Изменить" onClick={openSettings}>
                <SlidersHorizontal aria-hidden="true" /><span>Изменить</span>
              </Button>
            </div>}
          </header>
        </section>
        {paceReady ? <>
          <Dialog open={editing} onOpenChange={changeSettingsOpen}>
            <DialogContent className="telemetry-settings-dialog">
              <DialogHeader>
                <DialogTitle>Изменить сравнение</DialogTitle>
                <DialogDescription>Выберите режим, Гран-при и что сравнить.</DialogDescription>
              </DialogHeader>
              {controls}
            </DialogContent>
          </Dialog>
        </> : <div className="telemetry-setup stitch-panel">{controls}</div>}
        {error && !editing ? (
          <Alert variant="destructive">
            <AlertTitle>Не удалось открыть гонку</AlertTitle>
            <AlertDescription>
              {error}
              <Button variant="outline" size="sm"
                onClick={() => void loadInitialBootstrap(begin("initial")).catch(fail)}>
                Попробовать ещё раз
              </Button>
            </AlertDescription>
          </Alert>
        ) : (paceReady || paceRequested && !loading && isMainRaceSession(mainSession)) && shownPaceSession ? (
          <RacePaceWorkspace session={shownPaceSession} initialView={initialPaceView} onReady={raceLoaded} actionsContainer={paceActionsContainer} />
        ) : !loading && !isMainRaceSession(mainSession) && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Гонка пока недоступна</EmptyTitle>
              <EmptyDescription>
                Выберите другой этап с завершённой гонкой.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    );
  }
  return (
    <div
      className="telemetry-hub"
      data-ready={Boolean(comparison)}
      data-view={view}
    >
      <section className="telemetry-event stitch-panel" data-setup={!comparison}>
        {!comparison && (
          <>
            <Image
              alt=""
              className="telemetry-event-image"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 72rem"
              src="/stitch/telemetry-hero.webp"
            />
            <div aria-hidden="true" className="telemetry-event-shade" />
          </>
        )}
        <header className="telemetry-heading p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="stitch-label flex items-center gap-2 text-primary">
                <Activity aria-hidden="true" className="size-3.5" />
                Телеметрия · сезон{" "}
                {headingSeason}
              </p>
              {demoMode && !comparison && <Badge>Демо</Badge>}
            </div>
            <PageTitle className="mt-2 max-w-4xl">
              {showComparisonHeading
                ? raceName
                  ? formatGrandPrixNameRu(raceName)
                  : "Сравнение телеметрии"
                : "Телеметрия"}
            </PageTitle>
            {!showComparisonHeading && (
              <SeasonSwitcher
                activeSeason={season}
                className="mt-3"
                onSeasonChange={(year) =>
                  void pickSeason(year, begin()).catch(fail)
                }
                pathname="/telemetry"
                seasons={seasons.length ? seasons : [season]}
              />
            )}
            {showComparisonHeading && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {showSelectedHeading ? selectedHeadingDetails : comparison && `${comparison.track.name} · ${comparison.traces[0].session.season} · ${comparison.traces
                    .map((t) => sessionName(t.session.name))
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(" / ")}`}
              </p>
            )}
          </div>
          <div className="telemetry-heading-actions">
            {comparison && saved && (
              <Button data-slot="button" variant="outline" asChild>
                <Link href="/telemetry">Новое сравнение</Link>
              </Button>
            )}
            {comparison && telemetryFlags.telemetryShare && (
              <Button
                data-slot="button"
                variant="outline"
                aria-label="Поделиться сравнением"
                onClick={() => {
                  setShare(true);
                  trackTelemetry("telemetry_share_open", savedId);
                }}
              >
                <Share2 data-icon="inline-start" />
                <span>Поделиться</span>
              </Button>
            )}
            {comparison && editable && (
              <Button data-slot="button" variant="outline" onClick={openSettings}
                aria-label="Изменить сравнение">
                <SlidersHorizontal data-icon="inline-start" /><span>Изменить</span>
              </Button>
            )}
          </div>
        </header>
        {comparisonSummary}
      </section>
      {!comparison && (
        <div className="telemetry-setup stitch-panel">{controls}</div>
      )}
      {comparison && editable && (
        <Dialog open={editing} onOpenChange={changeSettingsOpen}>
          <DialogContent className="telemetry-settings-dialog">
            <DialogHeader>
              <DialogTitle>Изменить сравнение</DialogTitle>
              <DialogDescription>
                Выберите сессию, пилотов и круги.
              </DialogDescription>
            </DialogHeader>
            {controls}
          </DialogContent>
        </Dialog>
      )}
      {error && !editing && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось открыть телеметрию</AlertTitle>
          <AlertDescription>
            {error}
            <Button
              data-slot="button"
              variant="outline"
              size="sm"
              onClick={() =>
                catalogs[0]
                  ? void compare()
                  : void loadInitialBootstrap(begin("initial")).catch(fail)
              }
            >
              Попробовать ещё раз
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {loading && loadingPhase === "comparison" && !editingCatalog && (
        <div role="status" className="telemetry-loading stitch-panel">
          <Cog aria-hidden="true" className="telemetry-loading-gear" />
          <div>
            <p className="telemetry-loading-title">Готовим данные</p>
            <p className="telemetry-loading-description">
              Загрузка может занять время
            </p>
          </div>
        </div>
      )}
      {comparison && (!loading || editingCatalog) && (
        <>
          <div className="telemetry-workspace-toolbar">
            <select
              className="telemetry-mobile-view"
              aria-label="Что показать"
              value={view}
              onChange={(event) => {
                showView(event.target.value);
                trackTelemetry("telemetry_chart_changed");
              }}
            >
              {views.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Tabs
              value={view}
              onValueChange={(v) => {
                showView(v);
                trackTelemetry("telemetry_chart_changed");
              }}
            >
              <TabsList
                className="telemetry-view-tabs"
                aria-label="Данные телеметрии"
              >
                {views.map(([v, label]) => (
                  <TabsTrigger value={v} key={v}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

          </div>
          <div className="telemetry-workspace" data-view={view}>
            {channels.length > 0 && (
              <div className="telemetry-charts">
                {channels.map((channel) => (
                  <TelemetryChart
                    key={channel}
                    comparison={comparison}
                    channel={channel}
                    range={["speed", "pedals", "engine"].includes(view) ? [0, comparison.track.length] : range}
                    onRange={showRange}
                    cursor={cursor}
                    interactiveRange={view === "overview"}
                  />
                ))}
              </div>
            )}
            {(view === "overview" || view === "track") && (
              <TelemetryTrack
                comparison={comparison}
                cursor={cursor}
                onCorner={selectCorner}
                selectedCorner={corner}
                onSector={(index) => {
                  const bounds = [
                    0,
                    ...comparison.track.sectors,
                    comparison.track.length,
                  ];
                  showRange([bounds[index], bounds[index + 1]]);
                }}
              />
            )}
            {analysisViews.has(view) && (
              <TelemetryIntelligence key={comparison.traces.map((trace) => trace.lap.id).join(":")}
                comparison={comparison} cursor={cursor} view={view} onView={showView} onInspect={(from, to) => { showView("speed"); cursor.set((from + to) / 2); }}>
                <Analysis comparison={comparison} />
                {view === "analysis" && comparison.evolution && (
                  <div className="telemetry-evolution">
                    <h2>Как менялось время кругов</h2>
                    <p>
                      Наблюдаемое изменение одного пилота. Шины, топливо и
                      погода также влияют на время.
                    </p>
                    <div className="telemetry-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Сессия</th>
                            <th>Круг</th>
                            <th>Время</th>
                            <th>Средняя скорость</th>
                            <th>Трасса</th>
                            <th>Шины</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparison.evolution.map((e) => (
                            <tr key={e.lap.id}>
                              <th>{sessionName(e.session.name)}</th>
                              <td>{e.lap.number}</td>
                              <td>{lapTime(e.lap.time)}</td>
                              <td>{number(e.metrics.averageSpeed)} км/ч</td>
                              <td>{number(e.lap.weather?.track)} °C</td>
                              <td>{e.lap.compound ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </TelemetryIntelligence>
            )}
            {view === "track" && corner != null && (
              <div className="telemetry-detail-panel">
                <Analysis comparison={comparison} corner={corner} />
              </div>
            )}
          </div>
          {(channels.length > 0 || view === "track") && (
            <TelemetryScrubber cursor={cursor} range={view === "track" ? [0, comparison.track.length] : range} />
          )}
        </>
      )}
      {!comparison && !loading && !error && !catalogs[0] && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Ждём телеметрию сессии</EmptyTitle>
            <EmptyDescription>
              Выберите завершённый Гран-при. Данные текущей сессии появятся
              после её окончания.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {comparison && requestConfig && (
        <TelemetryShare
          open={share}
          onOpenChange={setShare}
          config={requestConfig}
          savedId={savedId}
          onSaved={setSavedId}
          corner={corner}
          range={range}
        />
      )}
    </div>
  );
}
function TelemetryScrubber({
  cursor,
  range,
}: {
  cursor: CursorStore;
  range: [number, number];
}) {
  const distance = useSyncExternalStore(cursor.subscribe, cursor.get, () => 0);
  return (
    <div className="telemetry-scrubber">
      <label htmlFor="telemetry-cursor-range">Позиция на круге</label>
      <input
        id="telemetry-cursor-range"
        type="range"
        min={range[0]}
        max={range[1]}
        step="any"
        value={Math.max(range[0], Math.min(range[1], distance))}
        aria-valuetext={`${Math.round(distance)} метров от старта`}
        onChange={(event) => cursor.set(Number(event.target.value))}
      />
      <output htmlFor="telemetry-cursor-range">{number(distance, 0)} м</output>
    </div>
  );
}
function Analysis({
  comparison,
  corner,
}: {
  comparison: Comparison;
  corner?: number;
}) {
  const traceColors = getTraceColors(comparison);
  const selected = comparison.track.corners.find(
    (item) => item.number === corner,
  );
  if (selected) {
    const values = comparison.traces.map((trace) =>
      trace.corners.find((item) => item.number === selected.number),
    );
    const referenceTime = values[comparison.config.reference]?.time;
    const rows = [
      ["Время поворота", "time", "с"],
      ["Скорость на входе", "entry", "км/ч"],
      ["Минимальная скорость", "minimum", "км/ч"],
      ["Скорость на выходе", "exit", "км/ч"],
    ] as const;
    return (
      <section
        className="telemetry-analysis telemetry-corner-analysis"
        aria-live="polite"
      >
        <header>
          <h2>Поворот {selected.number}</h2>
          <p>
            {number(selected.start, 0)}–{number(selected.end, 0)} м от старта
          </p>
        </header>
        <div className="telemetry-table-wrap">
          <table>
            <thead>
              <tr>
                <th>На этом повороте</th>
                {comparison.traces.map((trace, index) => (
                  <th key={trace.lap.id} style={{ color: traceColors[index] }}>
                    {trace.driver.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, key, unit]) => (
                <tr key={key}>
                  <th>{label}</th>
                  {values.map((value, index) => (
                    <td key={comparison.traces[index].lap.id}>
                      {value?.[key] == null
                        ? "—"
                        : `${number(value[key], key === "time" ? 3 : 0)} ${unit}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {comparison.traces.map((trace, index) => {
          const time = values[index]?.time;
          if (
            index === comparison.config.reference ||
            time == null ||
            referenceTime == null
          )
            return null;
          const difference = time - referenceTime;
          return (
            <p className="telemetry-corner-gain" key={trace.lap.id}>
              {Math.abs(difference) < 0.0005 ? (
                "Одинаковое время на повороте"
              ) : (
                <>
                  <strong
                    style={{
                      color:
                        traceColors[
                          difference < 0 ? index : comparison.config.reference
                        ],
                    }}
                  >
                    {difference < 0
                      ? trace.driver.code
                      : comparison.traces[comparison.config.reference].driver
                          .code}{" "}
                    быстрее на {number(Math.abs(difference), 3)} с
                  </strong>
                  <span>Только на выбранном повороте</span>
                </>
              )}
            </p>
          );
        })}
      </section>
    );
  }
  return (
    <section className="telemetry-analysis">
      <h2>Разбор круга</h2>
      <div className="telemetry-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Показатель</th>
              {comparison.traces.map((t, i) => (
                <th key={t.lap.id} style={{ color: traceColors[i] }}>
                  {t.driver.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lapAnalysisRows(comparison).map((row) => (
              <tr key={row.label}>
                <th>
                  {row.label}
                  {row.description && <small>{row.description}</small>}
                </th>
                {row.values.map((value, index) => (
                  <td
                    className={
                      row.best[index] ? "telemetry-analysis-best" : undefined
                    }
                    key={comparison.traces[index].lap.id}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
            {gearAnalysisRows(comparison).map((row) => (
              <tr key={`gear-${row.gear}`}>
                <th>Передача {row.gear}</th>
                {row.values.map((value, index) => (
                  <td
                    className={
                      row.best[index] ? "telemetry-analysis-best" : undefined
                    }
                    key={comparison.traces[index].lap.id}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
