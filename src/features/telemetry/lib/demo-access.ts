import "server-only";

import { selectTelemetryDemoCandidates, selectTelemetryDemoSession } from "@/features/telemetry/lib/demo-selection";
import { resultKey, telemetryStore } from "@/features/telemetry/lib/server";
import type { Meeting, Session } from "@/features/telemetry/lib/types";
import { withServerTtlCache } from "@/lib/server-ttl-cache";

export type TelemetryDemoScope = {
  meeting: Meeting;
  sessions: [Session];
};

export async function getTelemetryDemoScope(): Promise<TelemetryDemoScope | null> {
  return withServerTtlCache(
    "telemetry:demo-scope:single-race",
    60_000,
    loadTelemetryDemoScope,
    {
      shouldCache: (scope) => scope !== null,
      staleWhileRevalidateMs: 5 * 60_000,
    },
  );
}

async function loadTelemetryDemoScope(): Promise<TelemetryDemoScope | null> {
  const store = telemetryStore();
  const years = (await store.get<number[]>(resultKey({ kind: "seasons" }))) ?? [];
  if (!years.length) {
    await store.enqueue({ kind: "seasons" }, resultKey({ kind: "seasons" }));
    return null;
  }
  const seasons = await Promise.all(
    years.map(async (year) => ({
      meetings: (await store.get<Meeting[]>(`meetings:${year}`)) ?? [],
      year,
    })),
  );

  for (const meeting of selectTelemetryDemoCandidates(seasons)) {
    const sessions = (await store.get<Session[]>(`sessions:${meeting.id}`)) ?? [];
    const session = selectTelemetryDemoSession(sessions);
    if (session) return { meeting, sessions: [session] };
    if (!sessions.length) await store.enqueue({ kind: "sessions", meeting: meeting.id }, resultKey({ kind: "sessions", meeting: meeting.id }));
  }
  return null;
}

export { configUsesDemoSessions } from "@/features/telemetry/lib/demo-selection";
