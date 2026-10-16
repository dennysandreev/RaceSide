export const RACE_PACE_VERSION = "race-pace-3";
export const isRaceSession = (session) =>
  [session?.type, session?.name].some((value) =>
    ["race", "sprint"].includes(String(value).toLowerCase()),
  );
const median = (values) => [...values].sort((a, b) => a - b)[1];
const isRed = (row) =>
  row.flag === "RED" ||
  /^(RED FLAG\b|SESSION ABORTED$)/.test(
    String(row.message ?? "").toUpperCase(),
  );
const isTrackGreen = (row) =>
  row.flag === "GREEN" &&
  row.scope !== "Sector" &&
  !/PIT EXIT/.test(String(row.message ?? "").toUpperCase());
const isSafetyCarStart = (message) =>
  /^(SAFETY CAR DEPLOYED|SAFETY CAR LIGHTS ON|FORMATION LAP(?:\(S\)|S)? BEHIND SAFETY CAR)$/.test(message);

// OpenF1 often records withdrawal announcements without a subsequent GREEN.
// Release SC at the leader's next control-line crossing; VSC uses the latest
// permitted release (15 seconds, FIA B5.12.4). A new deployment cancels old ends.
function controlTimeline(catalog) {
  const rows = (catalog.raceControl ?? [])
    .map((row) => ({ ...row }))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const endings = [];
  let phase, deployment;
  const nextLapStart = (number, after) => {
    const starts = catalog.laps
      .filter((lap) => lap.number === number)
      .map((lap) => Date.parse(lap.start))
      .filter((date) => Number.isFinite(date) && date > after);
    return starts.length ? Math.min(...starts) : undefined;
  };
  const standingRestart = (row) => {
    if (!Number.isInteger(row.lap_number)) return;
    const restart = nextLapStart(row.lap_number + 1, Date.parse(row.date));
    const racing = restart && nextLapStart(row.lap_number + 2, restart);
    if (Number.isFinite(restart) && Number.isFinite(racing)) {
      endings.push({
        date: new Date(restart).toISOString(),
        endPhase: "SC",
        deployment,
        restart: true,
      });
      endings.push({
        date: new Date(racing).toISOString(),
        endPhase: "START",
        deployment,
      });
    }
  };
  rows.forEach((row, index) => {
    const message = String(row.message ?? "").toUpperCase();
    if (isRed(row)) {
      phase = "RED";
      deployment = undefined;
      return;
    }
    if (/^SESSION STARTED$/.test(message) && phase === "RED") {
      phase = "SC";
      row.resumeBehindSC = true;
    } else if (/^EXTRA FORMATION LAP$/.test(message)) phase = "SC";
    else if (/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/.test(message))
      phase = "VSC";
    else if (isSafetyCarStart(message) && phase !== "RED") phase = "SC";
    else if (isTrackGreen(row)) {
      phase = undefined;
      deployment = undefined;
      return;
    } else {
      let end;
      const announced = Date.parse(row.date);
      if (
        phase === "VSC" &&
        /VSC ENDING|VIRTUAL SAFETY CAR ENDING/.test(message)
      )
        end = announced + 15_000;
      if (
        phase === "SC" &&
        /SAFETY CAR IN THIS LAP/.test(message) &&
        Number.isInteger(row.lap_number)
      ) {
        end = nextLapStart(row.lap_number + 1, announced);
      }
      // The standing-start announcement precedes the actual restart. Keep
      // formation laps neutralised and exclude the first racing lap's start.
      if (
        phase === "SC" &&
        message === "STANDING START" &&
        Number.isInteger(row.lap_number)
      )
        standingRestart(row);
      if (Number.isFinite(end))
        endings.push({
          date: new Date(end).toISOString(),
          endPhase: phase,
          deployment,
        });
      return;
    }
    deployment = index;
    row.deployment = deployment;
    if (message === "EXTRA FORMATION LAP") standingRestart(row);
  });
  return [...rows, ...endings].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );
}

// Keep local yellows independent: clearing one marshal sector cannot clear another.
function controlFlags(lap, rows) {
  if (!rows.length) return lap.status ?? ["UNKNOWN"];
  const start = Date.parse(lap.start),
    end = start + (lap.time ?? 0) * 1000;
  if (!Number.isFinite(start)) return ["UNKNOWN"];
  const yellow = new Set(),
    flags = new Set();
  let global = "GREEN",
    deployment;
  const active = () => [global, ...(yellow.size ? ["YELLOW"] : [])];
  for (const row of rows) {
    const date = Date.parse(row.date);
    if (!Number.isFinite(date)) continue;
    if (date >= end && date > start) break;
    if (date > start) active().forEach((flag) => flags.add(flag));
    const message = String(row.message ?? "").toUpperCase();
    const sector = row.sector ?? "all";
    if (row.endPhase) {
      if (row.endPhase === global && row.deployment === deployment)
        global = row.restart ? "START" : "GREEN";
    } else if (isRed(row)) {
      global = "RED";
      deployment = undefined;
    } else if (row.resumeBehindSC || message === "EXTRA FORMATION LAP") {
      global = "SC";
      deployment = row.deployment;
    } else if (/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/.test(message)) {
      global = "VSC";
      deployment = row.deployment;
    } else if (isSafetyCarStart(message) && global !== "RED") {
      global = "SC";
      deployment = row.deployment;
    } else if (isTrackGreen(row)) {
      global = "GREEN";
      deployment = undefined;
      yellow.clear();
    } else if (
      /SAFETY CAR ENDED|VSC ENDED|VIRTUAL SAFETY CAR ENDED/.test(message)
    )
      global = "GREEN";
    if (["YELLOW", "DOUBLE YELLOW"].includes(row.flag)) yellow.add(sector);
    if (
      row.flag === "CLEAR" ||
      (row.flag === "GREEN" && row.scope === "Sector")
    )
      yellow.delete(sector);
    if (date >= start) active().forEach((flag) => flags.add(flag));
  }
  active().forEach((flag) => flags.add(flag));
  return [...flags];
}

export function raceControlLaps(catalog) {
  const control = controlTimeline(catalog);
  return catalog.laps.map((lap) => ({
    ...lap,
    status: controlFlags(lap, control),
  }));
}

function consistentTyres(laps, catalog) {
  // A tyre set cannot change on track. OpenF1 can include pre-start changes in
  // race stint ranges, or omit a later change. Do not propagate those ranges
  // across physical pit visits, and never guess the missing new compound.
  const pitDataKnown = catalog.pitDataKnown ?? catalog.laps.some((lap) => lap.pitIn);
  if (!pitDataKnown) return laps;
  let previous, tyres;
  return laps.map((lap) => {
    const metadata = { compound: lap.compound, stint: lap.stint, tyreAge: lap.tyreAge };
    const known = lap.compound && lap.compound !== "UNKNOWN" && lap.stint != null;
    const contiguous = previous?.number === lap.number - 1;
    const changed = previous && (previous.stint !== lap.stint || previous.compound !== lap.compound);
    const pitExit = lap.pitOut || (previous?.pitIn && !previous.pitOut);
    const afterPit = pitExit || previous?.pitOut;
    const stopped = contiguous && (catalog.raceControl ?? []).some((row) =>
      isRed(row) && Date.parse(row.date) >= Date.parse(previous.start) &&
      Date.parse(row.date) <= Date.parse(lap.start));
    if (!contiguous || !known || stopped || (changed && afterPit) || !previous.compound || previous.stint == null)
      tyres = metadata;
    else if (pitExit)
      tyres = { compound: null, stint: null, tyreAge: null };
    else if (changed)
      tyres = { ...tyres, tyreAge: null };
    else if (tyres?.stint === lap.stint && tyres.compound === lap.compound)
      tyres = metadata;
    previous = lap;
    return { ...lap, ...tyres };
  });
}

export function raceTyreLaps(catalog) {
  if (!isRaceSession(catalog.session)) return catalog.laps;
  const corrected = new Map();
  for (const number of new Set(catalog.laps.map((lap) => lap.driverNumber))) {
    const laps = catalog.laps.filter((lap) => lap.driverNumber === number)
      .sort((a, b) => a.number - b.number);
    consistentTyres(laps, catalog).forEach((lap, index) => corrected.set(laps[index], lap));
  }
  return catalog.laps.map((lap) => corrected.get(lap));
}

export function buildRacePace(catalog) {
  if (!isRaceSession(catalog.session)) throw new Error("RACE_PACE_ONLY");
  if (Date.parse(catalog.session.end) + 31 * 60_000 > Date.now())
    throw new Error("SESSION_NOT_FINISHED");
  const control = controlTimeline(catalog);
  const drivers = [...catalog.drivers].sort(
    (a, b) => (a.position ?? 99) - (b.position ?? 99) || a.number - b.number,
  );
  const points = [],
    stints = [];
  for (const driver of drivers) {
    const laps = [
      ...new Map(
        catalog.laps
          .filter(
            (lap) =>
              lap.driverNumber === driver.number &&
              Number.isInteger(lap.number) &&
              lap.number > 0,
          )
          .map((lap) => [lap.number, lap]),
      ).values(),
    ].sort((a, b) => a.number - b.number);
    const driverPoints = consistentTyres(laps, catalog)
      .map((lap, index) => {
        const flags = controlFlags(lap, control);
        if (flags.includes("RED") || lap.status?.includes("RED")) return null;
        const reasons = [];
        if (lap.number === 1) reasons.push("START");
        else if (flags.includes("START")) reasons.push("START");
        if (lap.pitIn) reasons.push("PIT_IN");
        if (
          lap.pitOut ||
          (laps[index - 1]?.number === lap.number - 1 && laps[index - 1]?.pitIn)
        )
          reasons.push("PIT_OUT");
        if (lap.deleted) reasons.push("DELETED");
        if (!lap.complete || !Number.isFinite(lap.time) || lap.time <= 0)
          reasons.push("INCOMPLETE");
        if (!lap.validityKnown || !flags.length || flags.includes("UNKNOWN"))
          reasons.push("UNKNOWN_CONTROL");
        for (const flag of ["RED", "SC", "VSC", "YELLOW"])
          if (flags.includes(flag)) reasons.push(flag);
        return {
          driver: driver.number,
          lap: lap.number,
          time: Number.isFinite(lap.time) && lap.time > 0 ? lap.time : null,
          compound:
            typeof lap.compound === "string"
              ? lap.compound.toUpperCase()
              : "UNKNOWN",
          tyreAge:
            Number.isFinite(lap.tyreAge) && lap.tyreAge >= 0
              ? lap.tyreAge
              : null,
          stint:
            Number.isInteger(lap.stint) && lap.stint > 0 ? lap.stint : null,
          clean: reasons.length === 0,
          reasons,
          trend: null,
        };
      })
      .filter(Boolean);
    for (let i = 1; i < driverPoints.length - 1; i++) {
      const trio = driverPoints.slice(i - 1, i + 2),
        point = driverPoints[i];
      if (
        point.stint != null &&
        trio.every(
          (p, offset) =>
            p.clean &&
            p.stint === point.stint &&
            p.compound === point.compound &&
            p.lap === point.lap + offset - 1,
        )
      )
        point.trend = median(trio.map((p) => p.time));
    }
    let segment;
    for (const point of driverPoints) {
      if (
        !segment ||
        segment.to !== point.lap - 1 ||
        segment.number !== point.stint ||
        segment.compound !== point.compound
      ) {
        segment = {
          driver: driver.number,
          number: point.stint,
          compound: point.compound,
          from: point.lap,
          to: point.lap,
          ageAtStart: point.tyreAge,
        };
        stints.push(segment);
      } else segment.to = point.lap;
    }
    points.push(...driverPoints);
  }
  if (!points.some((point) => point.time != null))
    throw new Error("RACE_PACE_UNAVAILABLE");
  const warnings = [];
  if (
    points.some(
      (point) =>
        point.compound === "UNKNOWN" ||
        point.tyreAge == null ||
        point.stint == null,
    )
  )
    warnings.push("MISSING_TYRES");
  if (points.some((point) => point.reasons.includes("UNKNOWN_CONTROL")))
    warnings.push("MISSING_CONTROL");
  return {
    version: RACE_PACE_VERSION,
    session: catalog.session,
    drivers,
    points,
    stints,
    totalLaps: Math.max(
      ...catalog.laps.map((lap) => lap.number).filter(Number.isFinite),
    ),
    warnings,
  };
}
