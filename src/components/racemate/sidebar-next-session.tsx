"use client";

import { useEffect, useSyncExternalStore } from "react";

import { SidebarSessionStatus } from "@/components/racemate/sidebar-session-status";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSessionName } from "@/lib/session-display";
import { createSidebarSessionCache, EMPTY_SIDEBAR_SESSION } from "@/lib/sidebar-session";

const sessionCache = createSidebarSessionCache(async () => {
  const response = await fetch("/api/next-session", {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Sidebar session unavailable");
  return response.json();
});
const getServerSnapshot = () => EMPTY_SIDEBAR_SESSION;

export function SidebarNextSession() {
  const { session, loaded } = useSyncExternalStore(
    sessionCache.subscribe,
    sessionCache.getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const visible = () => desktop.matches && document.visibilityState === "visible";

    function schedule() {
      clearTimeout(timer);
      if (!stopped && visible()) timer = setTimeout(() => { void refresh(); }, sessionCache.getRefreshDelay());
    }

    async function refresh(force = false) {
      clearTimeout(timer);
      if (stopped || !visible()) return;
      await sessionCache.refresh(force);
      schedule();
    }

    const resume = () => { void refresh(true); };
    void refresh();
    desktop.addEventListener("change", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      stopped = true;
      clearTimeout(timer);
      desktop.removeEventListener("change", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  if (!loaded) return <Skeleton className="mt-2 h-[4.25rem] w-full" />;

  return (
    <>
      <p className="font-display mt-2 text-sm font-bold">
        {session ? formatSessionName(session.session) : "Расписание уточняется"}
      </p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        {session?.race ?? "Календарь сезона"}
      </p>
      <SidebarSessionStatus
        sessionName={session?.session}
        startsAtIso={session?.startsAtIso}
        status={session?.status}
      />
    </>
  );
}
