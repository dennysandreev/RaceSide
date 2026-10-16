"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { LiveStore } from "../lib/store";
import { LiveReplayAdapter } from "../lib/replay";
import { ReplayClock } from "../lib/replay-clock";
import type { LiveMessage, LiveSessionState, LiveView } from "../lib/types";
import { LIVE_VIEW_STORAGE_KEY, savedLiveView, presentationView, viewQuery } from "../lib/presentation";
import type { RaceReplaySnapshot } from "@/types/racemate";
const Context = createContext<LiveStore | null>(null);

export type LiveReplayController = {
  durationMs: number;
  elapsedMs: number;
  isPlaying: boolean;
  seekBy: (deltaMs: number) => void;
  seekTo: (elapsedMs: number) => void;
  setSpeed: (speed: number) => void;
  speed: number;
  toggle: () => void;
};

const ReplayContext = createContext<LiveReplayController | null>(null);

export function LiveProvider({
  children,
  replay,
}: {
  children: React.ReactNode;
  replay?: RaceReplaySnapshot;
}) {
  if (replay) {
    return (
      <ReplayProvider key={replay.replaySessionId} replay={replay}>
        {children}
      </ReplayProvider>
    );
  }

  return <StreamingProvider>{children}</StreamingProvider>;
}

function StreamingProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => new LiveStore());
  useEffect(() => {
    let disposed = false,
      socket: WebSocket | null = null,
      retryTimer: ReturnType<typeof setTimeout>,
      seekTimer: ReturnType<typeof setTimeout>,
      attempt = 0,
      lastReceived = Date.now();
    let view: LiveView = { mode: "live" }, requestId = 0;
    try { view = savedLiveView(localStorage.getItem(LIVE_VIEW_STORAGE_KEY)); } catch { /* Storage may be disabled. */ }
    const persist = () => {
      try { localStorage.setItem(LIVE_VIEW_STORAGE_KEY, JSON.stringify(view)); } catch { /* Viewing still works without storage. */ }
    };
    const controller = new AbortController();
    const receive = (m: LiveMessage) => {
      lastReceived = Date.now();
      store.accept(m);
      if (m.presentation) {
        view = presentationView(m.presentation);
        if (m.reset) { clearTimeout(seekTimer); persist(); }
      }
      store.setConnection(
        m.health?.sourceConnected === false ? "reconnecting" : "connected",
      );
    };
    store.setSeekHandler((nextView) => {
      if (socket?.readyState !== WebSocket.OPEN || store.seeking) return;
      view = nextView;
      persist();
      store.setSeeking(true);
      socket.send(JSON.stringify({ type: "seek", ...view, requestId: ++requestId }));
      clearTimeout(seekTimer);
      seekTimer = setTimeout(() => socket?.close(), 5000);
    });
    const connect = async () => {
      if (disposed) return;
      const ticketResponse = await fetch("/api/live/ticket", { cache: "no-store", signal: controller.signal });
      if (!ticketResponse.ok) throw new Error("LIVE_TICKET_UNAVAILABLE");
      const { ticket } = await ticketResponse.json() as { ticket: string };
      if (disposed) return;
      const query = viewQuery(view);
      query.set("ticket", ticket);
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/live?${query}`,
      );
      socket.onopen = () => store.setSeekReady(true);
      socket.onmessage = (e) => {
        try {
          receive(JSON.parse(e.data));
          attempt = 0;
        } catch {
          socket?.close();
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (disposed) return;
        store.setSeekReady(false);
        store.setConnection(attempt > 3 ? "offline" : "reconnecting");
        retryTimer = setTimeout(
          () => void connect().catch(scheduleReconnect),
          Math.min(30000, 1000 * 2 ** attempt++) + Math.random() * 300,
        );
      };
    };
    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      store.setConnection(attempt > 3 ? "offline" : "reconnecting");
      retryTimer = setTimeout(() => void connect().catch(scheduleReconnect), Math.min(30000, 1000 * 2 ** attempt++));
    };
    // Hydration completes before opening the socket; the socket itself sends a
    // fresh snapshot so there is no snapshot/delta race or missed update window.
    void fetch(`/api/live/snapshot?${viewQuery(view)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        receive(await r.json());
      })
      .catch(() => {
        if (!disposed) store.setConnection("reconnecting");
      })
      .finally(() => {
        if (!disposed) void connect().catch(scheduleReconnect);
      });
    const watchdog = setInterval(() => {
      if (Date.now() - lastReceived > 12000) {
        store.setConnection("reconnecting");
        socket?.close();
      }
    }, 5000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(watchdog);
      clearTimeout(retryTimer);
      clearTimeout(seekTimer);
      store.setSeekHandler(null);
      socket?.close();
    };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

function ReplayProvider({
  children,
  replay,
}: {
  children: React.ReactNode;
  replay: RaceReplaySnapshot;
}) {
  const [adapter] = useState(() => new LiveReplayAdapter(replay));
  const [store] = useState(() => {
    const initial = new LiveStore();
    initial.accept(adapter.frame(adapter.playbackStartMs, false));
    initial.setConnection("connected");
    return initial;
  });
  const [clock] = useState(() => new ReplayClock(adapter.durationMs, adapter.playbackStartMs));
  const [elapsedMs, setElapsedMs] = useState(adapter.playbackStartMs);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const publish = useCallback(() => {
    const elapsed = clock.read();
    if (elapsed >= adapter.durationMs) clock.setPlaying(false);
    const message = adapter.frame(elapsed, clock.playing);
    store.accept(message);
    store.setConnection("connected");
    setElapsedMs(elapsed);
    setIsPlaying(clock.playing);
  }, [adapter, clock, store]);

  useEffect(() => {
    store.setReplaySampler((driverNumber) => adapter.sampleLocation(driverNumber, clock.read()));
    const first = requestAnimationFrame(publish);
    return () => {
      cancelAnimationFrame(first);
      store.setReplaySampler(null);
    };
  }, [adapter, clock, publish, store]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(publish, 100);
    return () => window.clearInterval(timer);
  }, [isPlaying, publish]);

  const seekTo = useCallback((nextElapsedMs: number) => {
    clock.seek(nextElapsedMs);
    store.resetSamples();
    publish();
  }, [clock, publish, store]);

  const controller = useMemo<LiveReplayController>(
    () => ({
      durationMs: adapter.durationMs,
      elapsedMs,
      isPlaying,
      seekBy: (deltaMs) => seekTo(clock.read() + deltaMs),
      seekTo,
      setSpeed: (nextSpeed) => {
        clock.setSpeed(nextSpeed);
        setSpeed(nextSpeed);
        publish();
      },
      speed,
      toggle: () => {
        if (!clock.playing && clock.read() >= adapter.durationMs) {
          seekTo(adapter.playbackStartMs);
        }
        clock.setPlaying(!clock.playing);
        publish();
      },
    }),
    [adapter, clock, elapsedMs, isPlaying, publish, seekTo, speed],
  );

  return (
    <Context.Provider value={store}>
      <ReplayContext.Provider value={controller}>
        {children}
      </ReplayContext.Provider>
    </Context.Provider>
  );
}
export function useLiveStore() {
  const store = useContext(Context);
  if (!store) throw new Error("LiveProvider required");
  return store;
}
export function useLive<K extends keyof LiveSessionState>(key: K) {
  const store = useLiveStore();
  return useSyncExternalStore(
    (fn) => store.subscribe(key, fn),
    () => store.state[key],
    () => store.state[key],
  );
}
export function useConnection() {
  const store = useLiveStore();
  return useSyncExternalStore(
    (fn) => store.subscribe("connection", fn),
    () => store.connection,
    () => store.connection,
  );
}

export function useLiveReplay() {
  return useContext(ReplayContext);
}
export function useLivePresentation() {
  const store = useLiveStore();
  return useSyncExternalStore((fn) => store.subscribe("presentation", fn), () => store.presentation, () => null);
}
export function useLiveViewingMode() {
  const store = useLiveStore();
  return useSyncExternalStore((fn) => store.subscribe("presentation", fn), () => store.presentation?.mode ?? "live", () => "live");
}
export function useLiveSeeking() {
  const store = useLiveStore();
  return useSyncExternalStore((fn) => store.subscribe("seeking", fn), () => store.seeking || !store.seekReady, () => true);
}
export function useLiveSeekRevision() {
  const store = useLiveStore();
  return useSyncExternalStore((fn) => store.subscribe("seekRevision", fn), () => store.seekRevision, () => 0);
}
export function useLiveNow() {
  const store = useLiveStore();
  const [now, setNow] = useState(store.getPresentationNow);
  useEffect(() => {
    const update = () => setNow(store.getPresentationNow());
    const unsubscribe = store.subscribe("presentation", update);
    const timer = setInterval(update, 250);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [store]);
  return now;
}
