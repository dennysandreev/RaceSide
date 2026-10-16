const relation = (value) => (Array.isArray(value) ? value[0] : value);
const numeric = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null;

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// This reads the existing sporting cache only. Never substitute the latest
// standings: after the finish they can already include the selected round.
export async function loadLiveChampionship(db, session) {
  if (!db || !session) return null;
  let raceId = session.race_id;
  if (!raceId) {
    const matches = await rows(
      db
        .from("sessions")
        .select("race_id")
        .eq("openf1_session_key", session.session_key),
    );
    if (matches.length !== 1) return null;
    raceId = matches[0].race_id;
  }
  const races = await rows(
    db.from("races").select("id,season_year,round").eq("id", raceId),
  );
  const race = races[0];
  if (!race || !Number.isInteger(race.round) || race.round < 1) return null;
  const previousRound = race.round - 1;
  const [driverRows, teamRows, profiles, teamProfiles, sessions] =
    await Promise.all([
      previousRound
        ? rows(
            db
              .from("driver_standings")
              .select(
                "driver_id,team_id,position,points,drivers(code,permanent_number,full_name)",
              )
              .eq("season_year", race.season_year)
              .eq("round", previousRound),
          )
        : [],
      previousRound
        ? rows(
            db
              .from("constructor_standings")
              .select("team_id,position,points,teams(name,color_hex)")
              .eq("season_year", race.season_year)
              .eq("round", previousRound),
          )
        : [],
      rows(
        db
          .from("driver_season_profiles")
          .select(
            "driver_id,primary_team_id,code,permanent_number,drivers(full_name)",
          )
          .eq("season_year", race.season_year),
      ),
      rows(
        db
          .from("team_season_profiles")
          .select("team_id,display_name,color_hex")
          .eq("season_year", race.season_year),
      ),
      rows(
        db
          .from("sessions")
          .select(
            "id,session_type,status,start_at,openf1_session_key,races!inner(round,season_year)",
          )
          .eq("races.season_year", race.season_year)
          .lte("races.round", race.round)
          .in("session_type", ["race", "sprint"]),
      ),
    ]);
  // An incomplete snapshot must not turn unknown championship points into zero.
  if (
    !teamProfiles.length ||
    (previousRound &&
      (teamRows.length < teamProfiles.length ||
        driverRows.length < Math.min(20, teamProfiles.length * 2)))
  )
    return null;
  if ([...driverRows, ...teamRows].some((row) => numeric(row.points) === null))
    return null;
  const priorRaces = sessions.filter(
    (row) =>
      row.session_type === "race" && relation(row.races)?.round < race.round,
  );
  const sprintSession = sessions.find(
    (row) =>
      row.session_type === "sprint" &&
      relation(row.races)?.round === race.round,
  );
  const selectedIsSprint =
    /sprint/i.test(session.session_name ?? "") &&
    !/qualif|shootout/i.test(session.session_name ?? "");
  const sprintApplies =
    sprintSession &&
    !/sprint/i.test(session.session_name ?? "") &&
    Date.parse(session.date_start) > Date.parse(sprintSession.start_at ?? "");
  const sprintFinished =
    sprintApplies &&
    sprintSession.openf1_session_key !== session.session_key &&
    !selectedIsSprint &&
    sprintSession.status === "completed";
  const selectedSession = sessions.find(
    (row) => row.openf1_session_key === session.session_key,
  );
  const resultSession =
    selectedSession?.status === "completed" ? selectedSession : null;
  const resultIds = [
    ...priorRaces.map((row) => row.id),
    ...(sprintFinished ? [sprintSession.id] : []),
    ...(resultSession ? [resultSession.id] : []),
  ];
  const results = [];
  // Some seasons have more than 1000 result rows; don't silently truncate them.
  if (resultIds.length)
    for (let from = 0; ; from += 1000) {
      const page = await rows(
        db
          .from("session_results")
          .select(
            "session_id,driver_id,team_id,position,points,classified_position",
          )
          .in("session_id", resultIds)
          .order("id")
          .range(from, from + 999),
      );
      results.push(...page);
      if (page.length < 1000) break;
    }
  const profileById = new Map(profiles.map((row) => [row.driver_id, row]));
  if (previousRound) {
    const standingIds = new Set(driverRows.map((row) => row.driver_id));
    const previousSessionIds = new Set(priorRaces.map((row) => row.id));
    if (
      results.some(
        (row) =>
          previousSessionIds.has(row.session_id) &&
          row.driver_id &&
          !standingIds.has(row.driver_id),
      )
    )
      return null;
  }
  const teamById = new Map(teamProfiles.map((row) => [row.team_id, row]));
  const drivers = (
    previousRound
      ? driverRows
      : profiles.map((row) => ({
          ...row,
          team_id: row.primary_team_id,
          position: null,
          points: 0,
        }))
  ).map((row) => {
    const profile = profileById.get(row.driver_id);
    const driver = relation(row.drivers);
    return {
      id: row.driver_id,
      driverNumber: numeric(
        profile?.permanent_number ?? driver?.permanent_number,
      ),
      acronym: profile?.code ?? driver?.code ?? "",
      fullName:
        relation(profile?.drivers)?.full_name ?? driver?.full_name ?? "Пилот",
      teamId: profile?.primary_team_id ?? row.team_id ?? null,
      points: Number(row.points),
      position: numeric(row.position),
      finishes: [],
    };
  });
  // A replacement driver has no previous standing yet, but does have a verified
  // season profile. Retain former participants in the championship as well.
  for (const profile of profiles)
    if (!drivers.some((row) => row.id === profile.driver_id))
      drivers.push({
        id: profile.driver_id,
        driverNumber: numeric(profile.permanent_number),
        acronym: profile.code ?? "",
        fullName: relation(profile.drivers)?.full_name ?? "Пилот",
        teamId: profile.primary_team_id,
        points: 0,
        position: null,
        finishes: [],
      });
  const teams = (
    previousRound
      ? teamRows
      : teamProfiles.map((row) => ({ ...row, position: null, points: 0 }))
  ).map((row) => ({
    id: row.team_id,
    name:
      teamById.get(row.team_id)?.display_name ??
      relation(row.teams)?.name ??
      "Команда",
    colour:
      teamById.get(row.team_id)?.color_hex ??
      relation(row.teams)?.color_hex ??
      "#a1a1aa",
    points: Number(row.points),
    position: numeric(row.position),
    finishes: [],
  }));
  const driverById = new Map(drivers.map((row) => [row.id, row]));
  const standingTeamById = new Map(teams.map((row) => [row.id, row]));
  const priorIds = new Set(priorRaces.map((row) => row.id));
  for (const result of results)
    if (priorIds.has(result.session_id)) {
      const position = result.classified_position
        ? numeric(result.classified_position)
        : numeric(result.position);
      if (!Number.isInteger(position) || position <= 0) continue;
      for (const entry of [
        driverById.get(result.driver_id),
        standingTeamById.get(result.team_id),
      ])
        if (entry) {
          entry.finishes[position - 1] =
            (entry.finishes[position - 1] ?? 0) + 1;
        }
    }
  const sprintResults = sprintFinished
    ? results.filter((row) => row.session_id === sprintSession.id)
    : [];
  const sprintReady =
    sprintFinished &&
    sprintResults.length >= Math.min(20, teamProfiles.length * 2) &&
    sprintResults.every((row) => numeric(row.points) !== null);
  const finalResults = resultSession
    ? results.filter((row) => row.session_id === resultSession.id)
    : [];
  const resultsReady =
    finalResults.length >= Math.min(20, teamProfiles.length * 2) &&
    finalResults.every(
      (row) => numeric(row.points) !== null && numeric(row.points) >= 0,
    );
  return {
    sessionKey: session.session_key,
    season: race.season_year,
    round: race.round,
    drivers,
    teams,
    results: resultsReady
      ? finalResults.map((row) => ({
          driverId: row.driver_id,
          teamId: row.team_id,
          position: row.classified_position
            ? numeric(row.classified_position)
            : numeric(row.position),
          points: Number(row.points),
        }))
      : null,
    countbackComplete:
      priorRaces.length === previousRound &&
      priorRaces.every(
        (row) =>
          results.filter((result) => result.session_id === row.id).length >=
          Math.min(20, teamProfiles.length * 2),
      ),
    sprint: {
      status: !sprintApplies ? "none" : sprintReady ? "ready" : "pending",
      points: sprintReady
        ? sprintResults.map((row) => ({
            driverId: row.driver_id,
            teamId: row.team_id,
            points: Number(row.points),
          }))
        : [],
    },
  };
}
