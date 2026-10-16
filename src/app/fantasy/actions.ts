"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ensureProfile, requireUser } from "@/lib/auth";
import {
  FANTASY_LEAGUE_AVATAR_BUCKET,
  getFantasyLeagueAvatarStoragePath,
} from "@/lib/fantasy-league-avatar";
import {
  getPredictionLocksForRace,
  preserveLockedPredictionValues,
} from "@/lib/prediction-locks";
import { consumeRateLimit } from "@/lib/rate-limit";
import { invalidateServerTtlCache, invalidateServerTtlCachePrefix } from "@/lib/server-ttl-cache";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SHARE_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export async function saveFantasyPrediction(formData: FormData) {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirect("/fantasy");
  }

  const limit = consumeRateLimit("fantasy:prediction:save", `user:${user.id}`, 30, 60 * 1_000);

  if (!limit.ok) {
    redirect("/fantasy?message=driver");
  }

  const raceId = String(formData.get("raceId") ?? "");
  const poleDriverId = nullableFormValue(formData.get("poleDriverId"));
  const fastestLapDriverId = nullableFormValue(formData.get("fastestLapDriverId"));
  const top10DriverIds = normalizeTop10(formData.getAll("top10DriverIds"));
  const dnfPick = parseDnfPick(formData.get("dnfDriverId"));
  const topScoringTeamId = nullableFormValue(formData.get("topScoringTeamId"));
  const fastestPitStopTeamId = nullableFormValue(formData.get("fastestPitStopTeamId"));
  const scope = parsePredictionScope(formData.get("predictionScope"));

  if (!raceId) {
    redirect("/fantasy");
  }

  const { data: existing } = await supabase
    .from("predictions")
    .select("id, pole_driver_id, winner_driver_id, fastest_lap_driver_id, dnf_driver_id, dnf_pick_kind, top_scoring_team_id, fastest_pit_stop_team_id, top10_driver_ids, score, scored_at, score_breakdown, share_slug, share_image_version")
    .eq("user_id", user.id)
    .eq("race_id", raceId)
    .is("league_id", null)
    .maybeSingle();

  const locks = await getPredictionLocksForRace(raceId);

  if (locks.raceLocked && !existing) {
    redirect("/fantasy?message=locked");
  }

  const activeDriverIds = await getActiveDriverIds(supabase);
  const activeTeamIds = await getActiveTeamIds(supabase);
  const submitted = buildSubmittedValues({
    existing,
    scope,
    poleDriverId,
    fastestLapDriverId,
    top10DriverIds,
    dnfPick,
    topScoringTeamId,
    fastestPitStopTeamId,
  });

  if (
    scope !== "qualification" &&
    !locks.raceLocked &&
    submitted.top10DriverIds.length > 0 &&
    !isValidTop10Pick(submitted.top10DriverIds, activeDriverIds)
  ) {
    redirect("/fantasy?message=top10");
  }

  if (
    (scope !== "race" && !locks.poleLocked && submitted.poleDriverId && !activeDriverIds.has(submitted.poleDriverId)) ||
    (scope !== "qualification" && !locks.raceLocked && submitted.fastestLapDriverId && !activeDriverIds.has(submitted.fastestLapDriverId)) ||
    (scope !== "qualification" && !locks.raceLocked && submitted.dnfPickKind === "driver" && submitted.dnfDriverId && !activeDriverIds.has(submitted.dnfDriverId)) ||
    (scope !== "qualification" && !locks.raceLocked && submitted.topScoringTeamId && !activeTeamIds.has(submitted.topScoringTeamId)) ||
    (scope !== "qualification" && !locks.raceLocked && submitted.fastestPitStopTeamId && !activeTeamIds.has(submitted.fastestPitStopTeamId))
  ) {
    redirect("/fantasy?message=driver");
  }

  const values = preserveLockedPredictionValues({
    current: existing
      ? {
          poleDriverId: existing.pole_driver_id,
          winnerDriverId: existing.winner_driver_id,
          fastestLapDriverId: existing.fastest_lap_driver_id,
          dnfDriverId: existing.dnf_driver_id,
          dnfPickKind: existing.dnf_pick_kind === "none" ? "none" : "driver",
          topScoringTeamId: existing.top_scoring_team_id,
          fastestPitStopTeamId: existing.fastest_pit_stop_team_id,
          top10DriverIds: normalizeTop10(existing.top10_driver_ids ?? []),
        }
      : null,
    locks,
    submitted,
  });
  const changed = !existing || hasPredictionChanged(existing, values);
  const keepQualificationScore =
    changed &&
    Boolean(existing) &&
    locks.poleLocked &&
    !locks.raceLocked &&
    typeof existing?.score === "number";
  const payload = {
    user_id: user.id,
    race_id: raceId,
    league_id: null,
    winner_driver_id: values.winnerDriverId,
    pole_driver_id: values.poleDriverId,
    fastest_lap_driver_id: values.fastestLapDriverId,
    dnf_driver_id: values.dnfDriverId,
    dnf_pick_kind: values.dnfPickKind,
    top_scoring_team_id: values.topScoringTeamId,
    fastest_pit_stop_team_id: values.fastestPitStopTeamId,
    top3_driver_ids: values.top10DriverIds.slice(0, 3),
    top10_driver_ids: values.top10DriverIds,
    submitted_at: new Date().toISOString(),
    is_public: true,
    share_image_version: existing
      ? changed
        ? Math.max(1, existing.share_image_version ?? 1) + 1
        : Math.max(1, existing.share_image_version ?? 1)
      : 1,
    ...(changed && !keepQualificationScore ? { score: null, scored_at: null, score_breakdown: null } : {}),
  };
  let predictionId = existing?.id ?? null;
  let shareSlug = existing?.share_slug ?? null;
  let shareImageVersion = payload.share_image_version;

  if (existing) {
    const { data, error } = await supabase
      .from("predictions")
      .update(payload)
      .eq("id", existing.id)
      .select("id, share_slug, share_image_version")
      .single();

    if (error || !data) {
      redirect("/fantasy?message=driver");
    }

    predictionId = data.id;
    shareSlug = data.share_slug;
    shareImageVersion = data.share_image_version ?? shareImageVersion;
  } else {
    const { data, error } = await supabase
      .from("predictions")
      .insert(payload)
      .select("id, share_slug, share_image_version")
      .single();

    if (error || !data) {
      redirect("/fantasy?message=driver");
    }

    predictionId = data.id;
    shareSlug = data.share_slug;
    shareImageVersion = data.share_image_version ?? shareImageVersion;
  }

  if (!predictionId) {
    redirect("/fantasy?message=driver");
  }

  if (!shareSlug) {
    shareSlug = await createPredictionShareSlug(supabase, {
      predictionId,
      raceId,
      userId: user.id,
    });
  }

  invalidateServerTtlCache("fantasy:global-leaderboard");
  invalidateServerTtlCachePrefix("fantasy:league-scores:");
  revalidatePath("/");
  revalidatePath("/fantasy");
  revalidatePath("/predictions");
  revalidatePath(`/prediction/${shareSlug}`);
  const shareScope = scope === "qualification" ? "qualification" : "race";
  redirect(`/fantasy/prediction?saved=1&share=${encodeURIComponent(shareSlug)}&shareScope=${shareScope}&v=${shareImageVersion}`);
}

export async function createFantasyLeague(formData: FormData) {
  const profile = await ensureProfile();
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase) {
    redirect("/fantasy");
  }

  if (!profile) {
    redirect("/fantasy?message=create");
  }

  const limit = consumeRateLimit("fantasy:leagues:create", `user:${profile.id}`, 5, 10 * 60 * 1_000);

  if (!limit.ok) {
    redirect("/fantasy?message=create");
  }

  const name = String(formData.get("name") ?? "").trim();
  const isPublic = formData.get("isPublic") === "on";

  if (!name || name.length > 64) {
    redirect("/fantasy?message=name");
  }

  const inviteCode = makeInviteCode();
  const db = admin ?? supabase;
  const { data, error } = await db
    .from("prediction_leagues")
    .insert({
      owner_user_id: profile.id,
      name,
      invite_code: inviteCode,
      is_public: isPublic,
    })
    .select("id")
    .single();

  if (!error && data) {
    const { error: memberError } = await db.from("prediction_league_members").upsert(
      {
        league_id: data.id,
        user_id: profile.id,
        role: "owner",
      },
      { onConflict: "league_id,user_id" },
    );

    if (memberError) {
      redirect("/fantasy?message=create");
    }
  } else {
    redirect("/fantasy?message=create");
  }

  invalidateServerTtlCachePrefix("fantasy:league-scores:");
  revalidatePath("/fantasy");
  revalidatePath("/leagues");
  revalidatePath(`/fantasy/leagues/${data.id}`);
  redirect(`/fantasy/leagues/${data.id}?created=1`);
}

export async function joinFantasyLeague(formData: FormData) {
  const profile = await ensureProfile();
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase) {
    redirect("/fantasy");
  }

  if (!profile) {
    redirect("/fantasy?message=join");
  }

  const limit = consumeRateLimit("fantasy:leagues:join", `user:${profile.id}`, 10, 10 * 60 * 1_000);

  if (!limit.ok) {
    redirect("/fantasy?message=join");
  }

  const inviteCode = String(formData.get("inviteCode") ?? "")
    .trim()
    .toUpperCase();
  const leagueId = String(formData.get("leagueId") ?? "").trim();
  const returnPath = leagueId ? `/fantasy/leagues/${leagueId}` : "/fantasy";

  if ((!inviteCode && !leagueId) || inviteCode.length > 16 || leagueId.length > 80) {
    redirect(`${returnPath}?message=code`);
  }

  const db = admin ?? supabase;
  let leagueQuery = db
    .from("prediction_leagues")
    .select("id, is_public");

  if (leagueId) {
    leagueQuery = leagueQuery.eq("id", leagueId);
  }

  leagueQuery = inviteCode
    ? leagueQuery.eq("invite_code", inviteCode)
    : leagueQuery.eq("is_public", true);

  const { data: league } = await leagueQuery.maybeSingle();

  if (!league) {
    redirect(`${returnPath}?message=not-found`);
  }

  const { error } = await db.from("prediction_league_members").upsert({
    league_id: league.id,
    user_id: profile.id,
    role: "member",
  });

  if (error) {
    redirect(`${returnPath}?message=join`);
  }

  invalidateServerTtlCachePrefix("fantasy:league-scores:");
  revalidatePath("/fantasy");
  revalidatePath("/leagues");
  revalidatePath(`/fantasy/leagues/${league.id}`);
  redirect(`/fantasy/leagues/${league.id}?joined=1`);
}

export async function updateFantasyLeague(formData: FormData) {
  const profile = await ensureProfile();
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const leagueId = String(formData.get("leagueId") ?? "").trim();

  if (!supabase || !leagueId) {
    redirect("/fantasy/leagues");
  }

  if (!profile) {
    redirect(`/fantasy/leagues/${leagueId}?message=auth`);
  }

  const limit = consumeRateLimit("fantasy:leagues:update", `user:${profile.id}`, 10, 10 * 60 * 1_000);

  if (!limit.ok) {
    redirect(`/fantasy/leagues/${leagueId}?message=update`);
  }

  const name = String(formData.get("name") ?? "").trim();
  const isPublic = formData.get("isPublic") === "on";

  if (!name || name.length > 64) {
    redirect(`/fantasy/leagues/${leagueId}?message=name`);
  }

  const db = admin ?? supabase;
  const { data: league } = await db
    .from("prediction_leagues")
    .select("owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.owner_user_id !== profile.id) {
    redirect(`/fantasy/leagues/${leagueId}?message=owner`);
  }

  const { error } = await db
    .from("prediction_leagues")
    .update({ is_public: isPublic, name })
    .eq("id", leagueId);

  if (error) {
    redirect(`/fantasy/leagues/${leagueId}?message=update`);
  }

  invalidateServerTtlCachePrefix("fantasy:league-scores:");
  revalidatePath("/fantasy");
  revalidatePath("/leagues");
  revalidatePath(`/fantasy/leagues/${leagueId}`);
  redirect(`/fantasy/leagues/${leagueId}?updated=1`);
}

export async function deleteFantasyLeague(formData: FormData) {
  const profile = await ensureProfile();
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const leagueId = String(formData.get("leagueId") ?? "").trim();
  const confirmName = String(formData.get("confirmName") ?? "").trim();

  if (!supabase || !leagueId) {
    redirect("/fantasy/leagues");
  }

  if (!profile) {
    redirect(`/fantasy/leagues/${leagueId}?message=auth`);
  }

  const limit = consumeRateLimit("fantasy:leagues:delete", `user:${profile.id}`, 3, 10 * 60 * 1_000);

  if (!limit.ok) {
    redirect(`/fantasy/leagues/${leagueId}?message=delete`);
  }

  const db = admin ?? supabase;
  const { data: league } = await db
    .from("prediction_leagues")
    .select("owner_user_id, name")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league || league.owner_user_id !== profile.id) {
    redirect(`/fantasy/leagues/${leagueId}?message=owner`);
  }

  if (confirmName !== league.name) {
    redirect(`/fantasy/leagues/${leagueId}?message=confirm`);
  }

  const { error } = await db.from("prediction_leagues").delete().eq("id", leagueId);

  if (error) {
    redirect(`/fantasy/leagues/${leagueId}?message=delete`);
  }

  if (admin) {
    await admin.storage
      .from(FANTASY_LEAGUE_AVATAR_BUCKET)
      .remove([getFantasyLeagueAvatarStoragePath(leagueId)]);
  }

  invalidateServerTtlCachePrefix("fantasy:league-scores:");
  revalidatePath("/fantasy");
  revalidatePath("/leagues");
  redirect("/fantasy/leagues?deleted=1");
}

export async function leaveFantasyLeague(formData: FormData) {
  const profile = await ensureProfile();
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const leagueId = String(formData.get("leagueId") ?? "").trim();

  if (!supabase || !leagueId) {
    redirect("/fantasy/leagues");
  }

  if (!profile) {
    redirect(`/fantasy/leagues/${leagueId}?message=auth`);
  }

  const limit = consumeRateLimit("fantasy:leagues:leave", `user:${profile.id}`, 10, 10 * 60 * 1_000);

  if (!limit.ok) {
    redirect(`/fantasy/leagues/${leagueId}?message=leave`);
  }

  const db = admin ?? supabase;
  const { data: league } = await db
    .from("prediction_leagues")
    .select("owner_user_id")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) {
    redirect("/fantasy/leagues?message=not-found");
  }

  if (league.owner_user_id === profile.id) {
    redirect(`/fantasy/leagues/${leagueId}?message=owner`);
  }

  const { error } = await db
    .from("prediction_league_members")
    .delete()
    .eq("league_id", leagueId)
    .eq("user_id", profile.id)
    .neq("role", "owner");

  if (error) {
    redirect(`/fantasy/leagues/${leagueId}?message=leave`);
  }

  invalidateServerTtlCachePrefix("fantasy:league-scores:");
  revalidatePath("/fantasy");
  revalidatePath(`/fantasy/leagues/${leagueId}`);
  redirect("/fantasy/leagues?left=1");
}

function nullableFormValue(value: FormDataEntryValue | null) {
  const stringValue = String(value ?? "");

  return stringValue ? stringValue : null;
}

function normalizeTop10(values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function parseDnfPick(value: FormDataEntryValue | null): {
  driverId: string | null;
  kind: "driver" | "none";
} {
  const stringValue = String(value ?? "").trim();

  if (stringValue === "__none") {
    return { driverId: null, kind: "none" };
  }

  return { driverId: stringValue || null, kind: "driver" };
}

type PredictionScope = "qualification" | "race" | "all";

function parsePredictionScope(value: FormDataEntryValue | null): PredictionScope {
  const scope = String(value ?? "");

  return scope === "qualification" || scope === "race" ? scope : "all";
}

function buildSubmittedValues({
  existing,
  scope,
  poleDriverId,
  fastestLapDriverId,
  top10DriverIds,
  dnfPick,
  topScoringTeamId,
  fastestPitStopTeamId,
}: {
  existing: {
    pole_driver_id: string | null;
    winner_driver_id: string | null;
    fastest_lap_driver_id: string | null;
    dnf_driver_id: string | null;
    dnf_pick_kind?: string | null;
    top_scoring_team_id?: string | null;
    fastest_pit_stop_team_id?: string | null;
    top10_driver_ids?: string[] | null;
  } | null;
  scope: PredictionScope;
  poleDriverId: string | null;
  fastestLapDriverId: string | null;
  top10DriverIds: string[];
  dnfPick: { driverId: string | null; kind: "driver" | "none" };
  topScoringTeamId: string | null;
  fastestPitStopTeamId: string | null;
}) {
  const current = {
    poleDriverId: existing?.pole_driver_id ?? null,
    winnerDriverId: existing?.winner_driver_id ?? null,
    fastestLapDriverId: existing?.fastest_lap_driver_id ?? null,
    dnfDriverId: existing?.dnf_driver_id ?? null,
    dnfPickKind: existing?.dnf_pick_kind === "none" ? "none" as const : "driver" as const,
    topScoringTeamId: existing?.top_scoring_team_id ?? null,
    fastestPitStopTeamId: existing?.fastest_pit_stop_team_id ?? null,
    top10DriverIds: normalizeTop10(existing?.top10_driver_ids ?? []),
  };

  if (scope === "qualification") {
    return { ...current, poleDriverId };
  }

  const raceValues = {
    ...current,
    winnerDriverId: top10DriverIds[0] ?? null,
    fastestLapDriverId,
    dnfDriverId: dnfPick.driverId,
    dnfPickKind: dnfPick.kind,
    topScoringTeamId,
    fastestPitStopTeamId,
    top10DriverIds,
  };

  return scope === "race" ? raceValues : { ...raceValues, poleDriverId };
}

async function getActiveDriverIds(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) {
  const { data } = await supabase.from("drivers").select("id").eq("is_active", true);

  return new Set((data ?? []).map((driver) => driver.id));
}

async function getActiveTeamIds(supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) {
  const { data } = await supabase.from("teams").select("id").eq("is_active", true);

  return new Set((data ?? []).map((team) => team.id));
}

function isValidTop10Pick(top10DriverIds: string[], activeDriverIds: Set<string>) {
  if (top10DriverIds.length < 1 || top10DriverIds.length > 10) {
    return false;
  }

  const uniqueIds = new Set(top10DriverIds);

  return uniqueIds.size === top10DriverIds.length && top10DriverIds.every((driverId) => activeDriverIds.has(driverId));
}

function hasPredictionChanged(
  existing: {
    pole_driver_id: string | null;
    winner_driver_id: string | null;
    fastest_lap_driver_id: string | null;
    dnf_driver_id: string | null;
    dnf_pick_kind?: string | null;
    top_scoring_team_id?: string | null;
    fastest_pit_stop_team_id?: string | null;
    top10_driver_ids?: string[] | null;
  },
  values: {
    poleDriverId: string | null;
    winnerDriverId: string | null;
    fastestLapDriverId: string | null;
    dnfDriverId: string | null;
    dnfPickKind: "driver" | "none";
    topScoringTeamId: string | null;
    fastestPitStopTeamId: string | null;
    top10DriverIds: string[];
  },
) {
  return (
    existing.pole_driver_id !== values.poleDriverId ||
    existing.winner_driver_id !== values.winnerDriverId ||
    existing.fastest_lap_driver_id !== values.fastestLapDriverId ||
    existing.dnf_driver_id !== values.dnfDriverId ||
    (existing.dnf_pick_kind ?? "driver") !== values.dnfPickKind ||
    (existing.top_scoring_team_id ?? null) !== values.topScoringTeamId ||
    (existing.fastest_pit_stop_team_id ?? null) !== values.fastestPitStopTeamId ||
    normalizeTop10(existing.top10_driver_ids ?? []).join("|") !== values.top10DriverIds.join("|")
  );
}

async function createPredictionShareSlug(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  {
    predictionId,
    raceId,
    userId,
  }: {
    predictionId: string;
    raceId: string;
    userId: string;
  },
) {
  const [{ data: race }, { data: profile }] = await Promise.all([
    supabase
      .from("races")
      .select("race_name, season_year")
      .eq("id", raceId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const racePart = slugifySharePart(race?.race_name ?? "grand-prix", "grand-prix");
  const userPart = slugifySharePart(profile?.display_name ?? "fan", "fan");
  const seasonPart = race?.season_year ?? new Date().getUTCFullYear();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = `${racePart}-${seasonPart}-${userPart}-${makeShareSuffix()}`;
    const { data, error } = await supabase
      .from("predictions")
      .update({
        share_slug: candidate,
        shared_at: new Date().toISOString(),
      })
      .eq("id", predictionId)
      .select("share_slug")
      .single();

    if (!error && data?.share_slug) {
      return data.share_slug;
    }
  }

  redirect("/fantasy?message=driver");
}

function makeInviteCode() {
  return makeRandomCode(INVITE_CODE_ALPHABET, 8);
}

function makeShareSuffix() {
  return makeRandomCode(SHARE_SUFFIX_ALPHABET, 8);
}

function makeRandomCode(alphabet: string, length: number) {
  return Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");
}

function slugifySharePart(value: string, fallback: string) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}
