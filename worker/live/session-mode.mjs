export function sessionMode(session) {
  const name =
    `${session?.session_type ?? ""} ${session?.session_name ?? ""}`.toLowerCase();
  if (/sprint/.test(name) && /qualif|shootout/.test(name))
    return "sprint_qualifying";
  if (/qualif/.test(name)) return "qualifying";
  if (/sprint/.test(name)) return "sprint";
  if (/practice|\bfp[123]\b/.test(name)) return "practice";
  if (/\brace\b/.test(name)) return "race";
  return "unknown";
}
export function sessionCapabilities(session) {
  const mode = sessionMode(session),
    race = mode === "race" || mode === "sprint",
    qualifying = mode === "qualifying" || mode === "sprint_qualifying";
  return {
    mode,
    showRaceGap: race,
    showIntervals: race,
    showLapCounter: race,
    showCountdown: mode === "practice" || qualifying,
    showQualifyingPhase: qualifying,
    showEliminationZone:
      qualifying && Number.isInteger(session?.advancing_drivers),
    showPitCount: true,
    rankByLapTime: mode === "practice" || qualifying,
  };
}
export function chooseSession(rows, now = Date.now()) {
  const sorted = rows
    .filter((r) => !r.is_cancelled && Number.isFinite(Date.parse(r.date_start)))
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  const active = sorted
    .filter(
      (r) =>
        Date.parse(r.date_start) <= now &&
        Date.parse(r.date_end) + 120000 > now,
    )
    .at(-1);
  const next = sorted.find((r) => Date.parse(r.date_start) > now);
  const previous = sorted.filter((r) => Date.parse(r.date_end) <= now).at(-1);
  return {
    session: active ?? next ?? previous ?? null,
    active: Boolean(active),
    previous: previous ?? null,
  };
}
function latestSessionControl(session, controls, now) {
  const start = Date.parse(session?.date_start);
  if (!Number.isFinite(start) || now < start) return null;
  return [...controls]
    .filter((row) => {
      const at = Date.parse(row.date);
      return (
        Number.isFinite(at) && at >= start && at <= now &&
        (row.session_key == null ||
          Number(row.session_key) === Number(session.session_key)) &&
        ((row.flag === "CHEQUERED" && row.scope !== "Driver") ||
          /SESSION (?:STARTED|RESUMED|WILL BE TEMPORARILY STOPPED|SUSPENDED|ABORTED|FINISHED)|GREEN LIGHT/i.test(
            row.message ?? "",
          ))
      );
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .at(-1) ?? null;
}
const sessionControlFinished = (row) =>
  Boolean(row && (row.flag === "CHEQUERED" ||
    /SESSION (?:FINISHED|ABORTED)/i.test(row.message ?? "")));
export function sessionStillOngoing(session, controls, now = Date.now()) {
  const latest = latestSessionControl(session, controls, now);
  return Boolean(latest && !sessionControlFinished(latest));
}
export async function chooseSessionWithControls(rows, {
  loadControls, currentSession = null, currentStatus = null, now = Date.now(),
}) {
  const choice = chooseSession(rows, now);
  const currentOngoing = ["live", "paused"].includes(currentStatus);
  const candidate = currentOngoing && currentSession
    ? rows.find((row) => Number(row.session_key) === Number(currentSession.session_key)) ?? currentSession
    : choice.previous;
  if (!candidate || (choice.active && Number(choice.session.session_key) === Number(candidate.session_key)))
    return choice;
  const controls = await loadControls(candidate.session_key).catch(() => null);
  const latest = latestSessionControl(candidate, controls ?? [], now);
  // Reconnects must retain a known live session when Race Control is temporarily
  // unavailable. The scheduled end is never evidence that racing has stopped.
  const ongoing = latest
    ? !sessionControlFinished(latest)
    : currentOngoing &&
      Number(currentSession?.session_key) === Number(candidate.session_key);
  if (!ongoing)
    return choice;
  // A scheduled next session may itself have been delayed. Switch only when its
  // source confirms it has actually started, or the previous one has finished.
  if (choice.active && Number(choice.session.session_key) !== Number(candidate.session_key)) {
    const nextControls = await loadControls(choice.session.session_key).catch(() => []);
    if (sessionStillOngoing(choice.session, nextControls, now)) return choice;
  }
  return { ...choice, session: candidate, active: true };
}
export function sessionHistoryEnd(session, controls, ongoing, now = Date.now()) {
  const latest = latestSessionControl(session, controls, now);
  return Math.min(
    now,
    sessionControlFinished(latest)
      ? Date.parse(latest.date) + 120000
      : ongoing ? now : Date.parse(session.date_end) + 120000,
  );
}
export function sessionLabel(session) {
  const mode = sessionMode(session),
    name = session?.session_name ?? "";
  if (mode === "practice") {
    const n = name.match(/[123]/)?.[0];
    return n ? `Практика ${n}` : "Практика";
  }
  return (
    {
      qualifying: "Квалификация",
      sprint_qualifying: "Квалификация спринта",
      sprint: "Спринт",
      race: "Гонка",
    }[mode] ?? name
  );
}
