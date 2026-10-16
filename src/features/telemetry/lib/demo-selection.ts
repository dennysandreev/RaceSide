export function selectTelemetryDemoCandidates<T extends { start: string }>(
  seasons: Array<{ meetings: T[]; year: number }>,
  nowMs = Date.now(),
) {
  const candidates: T[] = [];
  let currentSeasonFound = false;

  for (const season of [...seasons].sort((a, b) => b.year - a.year)) {
    const completed = season.meetings
      .filter((meeting) => Date.parse(meeting.start) < nowMs)
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));

    if (!completed.length) continue;
    const candidate = currentSeasonFound ? completed[0] : completed[2];
    currentSeasonFound = true;
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

export function selectTelemetryDemoSession<
  T extends { name: string; end: string },
>(sessions: T[], nowMs = Date.now()): T | null {
  return sessions.find((session) =>
    session.name.toLowerCase() === "race" &&
    Number.isFinite(Date.parse(session.end)) &&
    Date.parse(session.end) <= nowMs,
  ) ?? null;
}

export function configUsesDemoSessions(config: unknown, scope: { sessions: Array<{ id: number }> }) {
  if (!isRecord(config) || !Array.isArray(config.traces)) return false;
  if (config.mode === "evolution" && config.window !== "session") return false;
  if (scope.sessions.length !== 1) return false;
  const sessionId = scope.sessions[0].id;
  return config.traces.length > 0 && config.traces.every((trace) => isRecord(trace) && typeof trace.session === "number" && trace.session === sessionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
