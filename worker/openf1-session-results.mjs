const PRACTICE_SESSION_TYPES = new Set([
  "fp1",
  "fp2",
  "fp3",
  "practice",
  "practice_1",
  "practice_2",
  "practice_3",
]);
const QUALIFYING_SESSION_TYPES = new Set(["qualifying", "sprint_qualifying"]);
const RACE_SESSION_TYPES = new Set(["race", "sprint"]);

export const OPENF1_RESULT_SESSION_TYPES = Object.freeze([
  "fp1",
  "fp2",
  "fp3",
  "practice",
  "practice_1",
  "practice_2",
  "practice_3",
  "sprint_qualifying",
  "qualifying",
  "sprint",
  "race",
]);

export function isOpenF1ResultSessionType(value) {
  return OPENF1_RESULT_SESSION_TYPES.includes(
    String(value ?? "").toLowerCase(),
  );
}

export function normalizeOpenF1SessionKey(value) {
  return positiveIntegerOrNull(value);
}

export function isOpenF1TimedSessionType(value) {
  const sessionType = String(value ?? "").toLowerCase();
  return (
    PRACTICE_SESSION_TYPES.has(sessionType) ||
    QUALIFYING_SESSION_TYPES.has(sessionType)
  );
}

export function isOpenF1ResultProbeDue({
  endAt,
  hasLiveAccess = false,
  historicalDelayMinutes = 31,
  liveDelayMinutes = 2,
  nowMs = Date.now(),
}) {
  const endMs = new Date(endAt ?? "").getTime();

  if (!Number.isFinite(endMs)) {
    return false;
  }

  const delayMinutes = hasLiveAccess
    ? liveDelayMinutes
    : historicalDelayMinutes;
  return nowMs >= endMs + Math.max(0, Number(delayMinutes) || 0) * 60_000;
}

export function hasFinalOpenF1SessionSignal(controls) {
  const latest = (Array.isArray(controls) ? controls : [])
    .filter((row) =>
      row?.flag === "CHEQUERED" ||
      /SESSION (?:STARTED|RESUMED|FINISHED|ABORTED|SUSPENDED)|GREEN LIGHT/i.test(
        row?.message ?? "",
      ),
    )
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .at(-1);

  return Boolean(
    latest &&
      (latest.flag === "CHEQUERED" ||
        /SESSION FINISHED/i.test(latest.message ?? "")),
  );
}

export function normalizeOpenF1SessionClassification(payload, sessionType) {
  const normalizedType = String(sessionType ?? "").toLowerCase();
  const rows = Array.isArray(payload) ? payload : [];
  let nextUnclassifiedPosition =
    rows.reduce(
      (maximum, row) =>
        Math.max(maximum, positiveIntegerOrNull(row?.position) ?? 0),
      0,
    ) + 1;
  const seenDrivers = new Set();
  const results = [];

  for (const row of rows) {
    const driverNumber = positiveIntegerOrNull(row?.driver_number);
    let position = positiveIntegerOrNull(row?.position);

    if (
      !position &&
      RACE_SESSION_TYPES.has(normalizedType) &&
      isTerminalRaceResult(row)
    ) {
      position = nextUnclassifiedPosition;
      nextUnclassifiedPosition += 1;
    }

    if (!driverNumber || !position || seenDrivers.has(driverNumber)) {
      continue;
    }

    seenDrivers.add(driverNumber);
    const status = getOpenF1ResultStatus(row, normalizedType);

    results.push({
      driverNumber,
      position,
      classifiedPosition: getClassifiedPosition(row, position),
      laps: nonNegativeIntegerOrNull(row?.number_of_laps),
      points: nonNegativeNumberOrNull(row?.points),
      status,
      timeText: getOpenF1ResultTimeText(row, normalizedType),
      rawPayload: row,
    });
  }

  return results.sort((left, right) => left.position - right.position);
}

export function normalizeLiveRaceClassification(snapshot) {
  return Object.values(snapshot?.drivers ?? {})
    .map((driver) => {
      const driverNumber = positiveIntegerOrNull(driver?.driverNumber);
      const position = positiveIntegerOrNull(driver?.position);
      const laps = nonNegativeIntegerOrNull(driver?.lap);
      if (!driverNumber || !position || laps === null) return null;

      const terminal = ["DNF", "DNS", "DSQ", "RETIRED"].includes(
        String(driver.status ?? "").toUpperCase(),
      );
      const status =
        String(driver.status ?? "").toUpperCase() === "RETIRED"
          ? "DNF"
          : terminal
            ? String(driver.status).toUpperCase()
            : "Финиш";
      return {
        driverNumber,
        position,
        classifiedPosition: terminal ? status : String(position),
        laps,
        points: null,
        status,
        timeText: position === 1 ? null : formatGapToLeader(driver.gap),
        rawPayload: {
          driver_number: driverNumber,
          position,
          number_of_laps: laps,
          gap_to_leader: driver.gap ?? null,
          interval: driver.interval ?? null,
          live_status: driver.status ?? null,
          provisional: true,
        },
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.position - right.position);
}

function isTerminalRaceResult(row) {
  return Boolean(row?.dnf || row?.dns || row?.dsq);
}

export function getOpenF1ParticipantIdentity(row) {
  const driverNumber = positiveIntegerOrNull(row?.driver_number);
  const firstName = cleanName(row?.first_name);
  const lastName = cleanName(row?.last_name);
  const fullName =
    cleanName(row?.full_name) ||
    [firstName, lastName].filter(Boolean).join(" ");
  const code =
    String(row?.name_acronym ?? "")
      .trim()
      .toUpperCase()
      .slice(0, 3) || null;
  const identitySlug = slugifyIdentity(fullName || code);

  if (!driverNumber || !identitySlug || !fullName) {
    return null;
  }

  return {
    driverNumber,
    firstName: firstName || fullName.split(/\s+/)[0] || "Пилот",
    lastName: lastName || fullName.split(/\s+/).slice(1).join(" ") || fullName,
    fullName,
    code,
    externalId: `openf1-driver:${identitySlug}`,
    slug: identitySlug,
    teamName: cleanName(row?.team_name),
    headshotUrl: String(row?.headshot_url ?? "").trim() || null,
  };
}

export function isOpenF1ClassificationReady(
  results,
  { minimumRows = 10 } = {},
) {
  if (
    !Array.isArray(results) ||
    results.length < Math.max(1, Number(minimumRows) || 10)
  ) {
    return false;
  }

  const driverNumbers = new Set(results.map((result) => result.driverNumber));
  const positions = new Set(results.map((result) => result.position));

  return (
    driverNumbers.size === results.length &&
    positions.size === results.length &&
    positions.has(1)
  );
}

export function getOpenF1ResultTimeText(row, sessionType) {
  const normalizedType = String(sessionType ?? "").toLowerCase();

  if (RACE_SESSION_TYPES.has(normalizedType)) {
    if (Number(row?.position) === 1) {
      return formatRaceDuration(row?.duration);
    }

    return formatGapToLeader(row?.gap_to_leader);
  }

  return formatLapDuration(getLatestDuration(row?.duration));
}

export function getOpenF1ResultStatus(row, sessionType) {
  if (row?.dsq) return "DSQ";
  if (row?.dns) return "DNS";
  if (row?.dnf) return "DNF";

  const normalizedType = String(sessionType ?? "").toLowerCase();

  if (QUALIFYING_SESSION_TYPES.has(normalizedType)) {
    const duration = Array.isArray(row?.duration)
      ? row.duration
      : [row?.duration];
    const lastTimedIndex = duration.reduce(
      (latest, value, index) => (positiveNumberOrNull(value) ? index : latest),
      -1,
    );

    return lastTimedIndex >= 0 ? `Q${lastTimedIndex + 1}` : "Квалификация";
  }

  if (PRACTICE_SESSION_TYPES.has(normalizedType)) {
    return "Лучшее время";
  }

  return "Финиш";
}

function getClassifiedPosition(row, position) {
  if (row?.dsq) return "DSQ";
  if (row?.dns) return "DNS";
  if (row?.dnf) return "DNF";
  return String(position);
}

function getLatestDuration(value) {
  const values = Array.isArray(value) ? value : [value];

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const duration = positiveNumberOrNull(values[index]);

    if (duration) {
      return duration;
    }
  }

  return null;
}

function formatLapDuration(value) {
  const duration = positiveNumberOrNull(value);

  if (!duration) {
    return null;
  }

  const minutes = Math.floor(duration / 60);
  const seconds = duration - minutes * 60;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatRaceDuration(value) {
  const duration = positiveNumberOrNull(value);

  if (!duration) {
    return null;
  }

  const hours = Math.floor(duration / 3_600);
  const minutes = Math.floor((duration - hours * 3_600) / 60);
  const seconds = duration - hours * 3_600 - minutes * 60;

  if (!hours) {
    return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
  }

  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatGapToLeader(value) {
  const numericGap = positiveNumberOrNull(value);

  if (numericGap) {
    return `+${numericGap.toFixed(3)}`;
  }

  const text = String(value ?? "").trim();
  if (!text || text === "0") {
    return null;
  }

  return text.startsWith("+") ? text : `+${text}`;
}

function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function nonNegativeNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cleanName(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  return text
    .toLowerCase()
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`,
    );
}

function slugifyIdentity(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
