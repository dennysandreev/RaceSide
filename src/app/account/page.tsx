import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Flag,
  ListOrdered,
  LogOut,
  Mail,
  PencilLine,
  Plus,
  Trophy,
  UserRound,
  Vote,
  Warehouse,
  Crown,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";

import { AppShell } from "@/components/racemate/app-shell";
import { RaceMateMark } from "@/components/racemate/racemate-logo";
import { PageTitle } from "@/components/racemate/page-title";
import { signOut } from "@/app/auth/actions";
import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { TelegramSettings } from "@/components/racemate/telegram-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getTeamAsset, getTeamProfileAsset } from "@/data/f1-assets";
import {
  getConstructorChampionshipMatrix,
  getDriverChampionshipMatrix,
  getGlobalFantasyLeaderboard,
  getPredictionState,
} from "@/data/racemate-repository";
import { ensureProfile } from "@/lib/auth";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSubscriptionAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type TeamRelation = {
  id?: string | null;
  name: string;
  code?: string | null;
  color_hex?: string | null;
};

type DriverRelation = {
  id?: string | null;
  full_name: string;
  slug?: string | null;
  teams: TeamRelation | TeamRelation[] | null;
};

type FavoriteTeamRow = {
  team_id: string;
  teams: TeamRelation | TeamRelation[] | null;
};

type FavoriteDriverRow = {
  driver_id: string;
  drivers: DriverRelation | DriverRelation[] | null;
};

type FavoriteTeam = {
  id: string;
  name: string;
  code?: string;
  color?: string;
  logo?: string;
  championshipPosition?: number;
  championshipPoints?: number;
  wins?: number;
};

type FavoriteDriver = {
  id: string;
  name: string;
  slug?: string;
  team: string;
  teamCode?: string;
  teamColor?: string;
  championshipPosition?: number;
  championshipPoints?: number;
};

export default async function AccountPage() {
  const profile = await ensureProfile();
  const displayName =
    profile?.display_name?.trim() ||
    profile?.email?.split("@")[0] ||
    "Гость RaceSide";
  const email = profile?.email ?? "Почта не указана";
  const timezone = profile?.timezone ?? "Europe/Moscow";
  const [overview, predictionState, driversMatrix, constructorsMatrix, leaderboard, extras, subscription] = await Promise.all([
    getAccountOverview(profile?.id ?? null),
    getPredictionState(profile?.id ?? null),
    getDriverChampionshipMatrix(CURRENT_F1_SEASON),
    getConstructorChampionshipMatrix(CURRENT_F1_SEASON),
    getGlobalFantasyLeaderboard(),
    getAccountExtras(profile?.id ?? null),
    getSubscriptionAccess(profile?.id ?? null),
  ]);
  const favoriteDrivers = enrichFavoriteDrivers(overview.favoriteDrivers, driversMatrix.rows).slice(0, 2);
  const favoriteTeam = enrichFavoriteTeams(overview.favoriteTeams, constructorsMatrix.rows)[0] ?? null;
  const accentColor = favoriteTeam?.color ?? favoriteDrivers[0]?.teamColor ?? null;
  const summary = predictionState.seasonSummary;
  const leaderboardRank =
    leaderboard.rows.find(
      (row) => row.displayName.trim().toLowerCase() === displayName.trim().toLowerCase(),
    )?.rank ?? null;

  return (
    <AppShell>
      <section className="grid gap-4 pb-6 sm:gap-5">
        <section className="stitch-panel relative overflow-hidden p-0">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle at 12% 0%, ${hexWithAlpha(accentColor, 0.32) ?? "rgb(225 6 0 / 0.26)"}, transparent 26rem), radial-gradient(circle at 96% 120%, rgb(225 6 0 / 0.14), transparent 22rem), linear-gradient(135deg, rgb(255 255 255 / 0.07), transparent 44%)`,
            }}
          />
          <div className="relative flex flex-col justify-between gap-6 p-5 sm:p-7 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-4 sm:gap-6">
              <span
                aria-hidden="true"
                className="grid size-18 shrink-0 place-items-center rounded-full border-2 bg-[oklch(0.21_0.014_250)] font-display text-2xl font-extrabold sm:size-24 sm:text-3xl"
                style={{ borderColor: accentColor ?? "var(--primary)" }}
              >
                {getInitials(displayName)}
              </span>
              <div className="min-w-0">
                <p className="font-telemetry flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-primary">
                  <UserRound aria-hidden="true" className="size-3.5" />
                  Паддок-пасс RaceSide
                </p>
                <PageTitle className="mt-1.5 flex max-w-3xl flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="min-w-0 break-words">{displayName}</span>
                  {subscription.active ? (
                    <Badge
                      aria-label="RaceSide Plus"
                      className="h-6 shrink-0 px-2 text-[0.64rem] tracking-[0.08em]"
                      title="Подписка RaceSide Plus активна"
                    >
                      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
                        <RaceMateMark className="h-3.5 w-[1.125rem] text-primary-foreground" plus />
                      </span>
                    </Badge>
                  ) : null}
                </PageTitle>
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <ProfileChip icon={Mail} value={email} />
                  <ProfileChip icon={Clock3} value={formatTimezone(timezone)} />
                  {extras.memberSince ? (
                    <ProfileChip icon={CalendarDays} value={`В RaceSide с ${extras.memberSince}`} />
                  ) : null}
                </div>
              </div>
            </div>
            <div className="relative grid w-full shrink-0 grid-cols-2 gap-2 sm:w-auto lg:grid-cols-1 xl:grid-cols-2">
              <Button asChild>
                <Link href="/onboarding" prefetch={false}>
                  <PencilLine aria-hidden="true" data-icon="inline-start" />
                  Изменить
                </Link>
              </Button>
              <form action={signOut}>
                <Button className="w-full" type="submit" variant="secondary">
                  Выйти
                  <LogOut aria-hidden="true" data-icon="inline-end" />
                </Button>
              </form>
            </div>
          </div>
          <div className="relative grid grid-cols-2 border-t stitch-divider bg-background/25 sm:grid-cols-4">
            <HeroStat
              hint="за сезон"
              icon={Trophy}
              label="Очки прогнозов"
              value={summary.totalScore !== null ? formatNumber(summary.totalScore) : "—"}
            />
            <HeroStat
              hint={leaderboardRank ? "в глобальном рейтинге" : "сохрани первый прогноз"}
              icon={ListOrdered}
              label="Место"
              value={leaderboardRank ? `#${leaderboardRank}` : "—"}
            />
            <HeroStat
              hint={summary.scoredPredictionCount ? `${summary.scoredPredictionCount} с результатом` : "пока без результатов"}
              icon={Flag}
              label="Прогнозов"
              value={String(summary.predictionCount)}
            />
            <HeroStat hint="в опросах" icon={Vote} label="Голосов" value={String(extras.pollVotes)} />
          </div>
        </section>

        <GaragePanel accentColor={accentColor} drivers={favoriteDrivers} team={favoriteTeam} />
        <section className="stitch-panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary/10"><Crown className="size-5 text-primary" /></span><div><h2 className="font-display text-lg font-bold">RaceSide Plus</h2><p className="mt-1 text-sm text-muted-foreground">{subscription.active && subscription.periodEnd ? `Доступ открыт до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(subscription.periodEnd))}` : "LIVE, полная телеметрия, Telegram и просмотр без рекламы."}</p></div></div>
          <Button asChild variant={subscription.active ? "secondary" : "default"}><Link href="/account/subscription">{subscription.active ? "Моя подписка" : "Подробнее"}<ChevronRight aria-hidden="true" data-icon="inline-end" /></Link></Button>
        </section>
        <TelegramSettings userId={profile?.id ?? null} />
      </section>
    </AppShell>
  );
}

async function getAccountOverview(userId: string | null) {
  const supabase = await createSupabaseServerClient();
  const [favoriteTeamsResult, favoriteDriversResult] = await Promise.all([
    userId
      ? supabase
          ?.from("user_favorite_teams")
          .select("team_id, teams(id, name, code, color_hex)")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
      : null,
    userId
      ? supabase
          ?.from("user_favorite_drivers")
          .select("driver_id, drivers(id, full_name, slug, teams:current_team_id(id, name, code, color_hex))")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
      : null,
  ]);

  return {
    favoriteTeams: ((favoriteTeamsResult?.data ?? []) as unknown as FavoriteTeamRow[])
      .map(mapFavoriteTeam)
      .filter(Boolean) as FavoriteTeam[],
    favoriteDrivers: ((favoriteDriversResult?.data ?? []) as unknown as FavoriteDriverRow[])
      .map(mapFavoriteDriver)
      .filter(Boolean) as FavoriteDriver[],
  };
}

async function getAccountExtras(userId: string | null) {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !userId) {
    return { memberSince: null as string | null, pollVotes: 0 };
  }

  const [votesResult, profileResult] = await Promise.all([
    supabase
      .from("poll_votes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.from("profiles").select("created_at").eq("id", userId).maybeSingle(),
  ]);
  const createdAt = (profileResult?.data as { created_at?: string | null } | null)?.created_at ?? null;

  return {
    memberSince: createdAt ? formatMonthYear(createdAt) : null,
    pollVotes: votesResult?.count ?? 0,
  };
}

function enrichFavoriteDrivers(
  favorites: FavoriteDriver[],
  matrixRows: Awaited<ReturnType<typeof getDriverChampionshipMatrix>>["rows"],
) {
  return favorites.map((favorite) => {
    const row = matrixRows.find(
      (candidate) =>
        (favorite.slug && candidate.driverSlug === favorite.slug) ||
        candidate.driver.toLowerCase() === favorite.name.toLowerCase(),
    );

    return {
      ...favorite,
      championshipPoints: row?.total,
      championshipPosition: row?.position,
    };
  });
}

function enrichFavoriteTeams(
  favorites: FavoriteTeam[],
  matrixRows: Awaited<ReturnType<typeof getConstructorChampionshipMatrix>>["rows"],
) {
  return favorites.map((favorite) => {
    const favoriteName = favorite.name.toLowerCase();
    const row = matrixRows.find((candidate) => {
      const candidateName = candidate.team.toLowerCase();

      return (
        (favorite.code && candidate.teamCode === favorite.code) ||
        candidateName === favoriteName ||
        candidateName.includes(favoriteName) ||
        favoriteName.includes(candidateName)
      );
    });

    return {
      ...favorite,
      championshipPoints: row?.points,
      championshipPosition: row?.position,
      wins: row?.wins,
    };
  });
}

function HeroStat({
  hint,
  icon: Icon,
  label,
  value,
}: {
  hint: string;
  icon: IconComponent;
  label: string;
  value: string;
}) {
  return (
    <div className="border-r stitch-divider px-4 py-3.5 last:border-r-0 sm:px-5 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r [&:nth-child(-n+2)]:border-b sm:[&:nth-child(-n+2)]:border-b-0">
      <p className="flex items-center gap-1.5">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
        <span className="stitch-label text-[0.56rem] text-muted-foreground">{label}</span>
      </p>
      <p className="font-telemetry mt-2 text-xl font-extrabold leading-none sm:text-2xl">{value}</p>
      <p className="mt-1 truncate text-[0.62rem] font-semibold text-muted-foreground">{hint}</p>
    </div>
  );
}

/*
 * «Гараж» — команда сезона и до двух пилотов одним цельным блоком.
 * Пустые слоты показываются пунктиром, чтобы был понятен лимит: 1 команда, 2 пилота.
 */
function GaragePanel({
  accentColor,
  drivers,
  team,
}: {
  accentColor: string | null;
  drivers: FavoriteDriver[];
  team: FavoriteTeam | null;
}) {
  const driverSlots: (FavoriteDriver | null)[] = [drivers[0] ?? null, drivers[1] ?? null];
  const teamProfileAsset = team
    ? getTeamProfileAsset(team.code) ?? getTeamProfileAsset(team.name)
    : null;

  return (
    <section className="stitch-panel relative overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b stitch-divider p-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-secondary/40">
            <Warehouse aria-hidden="true" className="size-4.5 text-primary" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold leading-tight">Мой гараж</h2>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
              Команда сезона и два пилота — RaceSide подсвечивает их везде
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/onboarding" prefetch={false}>
            Настроить
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {team ? (
        <div
          className="relative overflow-hidden border-b stitch-divider"
          style={{
            background: `linear-gradient(105deg, ${hexWithAlpha(team.color, 0.3) ?? "rgb(225 6 0 / 0.2)"}, transparent 62%)`,
          }}
        >
          {teamProfileAsset ? (
            <>
              <Image
                alt=""
                aria-hidden="true"
                className="pointer-events-none object-contain object-[85%_center] p-5 opacity-65 drop-shadow-[0_10px_10px_rgb(0_0_0_/_0.24)] sm:p-7"
                fill
                sizes="(min-width: 1280px) 50rem, 100vw"
                src={teamProfileAsset.carImageUrl}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/95 via-background/65 to-background/10"
              />
            </>
          ) : team.logo ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -right-6 top-1/2 h-32 w-56 -translate-y-1/2 bg-contain bg-center bg-no-repeat opacity-[0.07] sm:h-40 sm:w-72"
              style={{ backgroundImage: `url(${team.logo})` }}
            />
          ) : null}
          <div className="relative flex flex-wrap items-center gap-4 p-4 sm:p-5">
            <span
              aria-hidden="true"
              className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border bg-[oklch(0.17_0.012_250)] p-2 sm:h-20 sm:w-32"
              style={{ borderColor: hexWithAlpha(team.color, 0.5) ?? "var(--border)" }}
            >
              {team.logo ? (
                <span
                  className="block h-full w-full bg-contain bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${team.logo})` }}
                />
              ) : (
                <span className="font-display text-lg font-extrabold">{team.code ?? team.name.slice(0, 3)}</span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="stitch-label text-[0.56rem] text-muted-foreground">Команда сезона</p>
              <p className="mt-1 truncate font-display text-xl font-extrabold leading-tight sm:text-2xl">{team.name}</p>
              {team.championshipPosition ? (
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  Кубок конструкторов: P{team.championshipPosition} · {formatNumber(team.championshipPoints ?? 0)} очк.
                  {team.wins ? ` · ${team.wins} ${pluralize(team.wins, ["победа", "победы", "побед"])}` : ""}
                </p>
              ) : null}
            </div>
            {team.championshipPosition ? (
              <span
                className="font-telemetry grid size-14 shrink-0 place-items-center rounded-full border-2 text-lg font-extrabold sm:size-16"
                style={{ borderColor: team.color ?? "var(--primary)" }}
              >
                P{team.championshipPosition}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyGarageSlot
          className="m-4 sm:m-5"
          text="Выбери команду сезона — гараж окрасится в ее цвета."
        />
      )}

      <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
        {driverSlots.map((driver, index) =>
          driver ? (
            <DriverGarageCard driver={driver} key={driver.id} />
          ) : (
            <EmptyGarageSlot
              key={`empty-${index}`}
              text={index === 0 ? "Первый пилот гаража — выбери в онбординге." : "Второе место свободно."}
            />
          ),
        )}
      </div>
      <p
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-4 font-display text-[4rem] font-extrabold leading-none tracking-tight opacity-[0.045] sm:text-[6rem]"
        style={{ color: accentColor ?? "var(--primary)" }}
      >
        RM
      </p>
    </section>
  );
}

function DriverGarageCard({ driver }: { driver: FavoriteDriver }) {
  const body = (
    <>
      <DriverAvatarBadge
        className="size-14 sm:size-16"
        color={driver.teamColor}
        name={driver.name}
        sizes="4rem"
        slug={driver.slug}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base font-extrabold leading-tight">{driver.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: driver.teamColor ?? "var(--border)" }}
          />
          <span className="truncate">{driver.team}</span>
        </span>
        {driver.championshipPosition ? (
          <span className="font-telemetry mt-2 inline-block rounded border border-border/70 bg-secondary/40 px-1.5 py-1 text-[0.62rem] font-extrabold">
            P{driver.championshipPosition} · {formatNumber(driver.championshipPoints ?? 0)} очк.
          </span>
        ) : null}
      </span>
      {driver.slug ? (
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  const className =
    "relative flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-background/35 p-3.5 transition-colors";

  if (driver.slug) {
    return (
      <Link
        className={cn(className, "hover:border-primary/45 hover:bg-accent/50")}
        href={`/drivers/${driver.slug}`}
        prefetch={false}
      >
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}

function EmptyGarageSlot({ className, text }: { className?: string; text: string }) {
  return (
    <Link
      className={cn(
        "group flex min-h-[5.5rem] items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 bg-background/20 p-4 text-center transition-colors hover:border-primary/50 hover:bg-accent/40",
        className,
      )}
      href="/onboarding"
      prefetch={false}
    >
      <Plus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
      <span className="text-sm font-semibold text-muted-foreground transition-colors group-hover:text-foreground">
        {text}
      </span>
    </Link>
  );
}

function ProfileChip({ icon: Icon, value }: { icon: IconComponent; value: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/40 px-2 py-1">
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate text-xs font-semibold text-foreground">{value}</span>
    </span>
  );
}

function mapFavoriteTeam(row: FavoriteTeamRow): FavoriteTeam | null {
  const team = firstRelation(row.teams);

  if (!team) {
    return null;
  }

  const asset = getTeamAsset(team.code) ?? getTeamAsset(team.name);

  return {
    id: row.team_id,
    name: asset?.name ?? team.name,
    code: asset?.code ?? team.code ?? undefined,
    color: team.color_hex ?? asset?.color,
    logo: asset?.logo,
  };
}

function mapFavoriteDriver(row: FavoriteDriverRow): FavoriteDriver | null {
  const driver = firstRelation(row.drivers);

  if (!driver) {
    return null;
  }

  const team = firstRelation(driver.teams);
  const asset = getTeamAsset(team?.code) ?? getTeamAsset(team?.name);

  return {
    id: row.driver_id,
    name: driver.full_name,
    slug: driver.slug ?? undefined,
    team: asset?.name ?? team?.name ?? "Команда уточняется",
    teamCode: asset?.code ?? team?.code ?? undefined,
    teamColor: team?.color_hex ?? asset?.color,
  };
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatTimezone(timezone: string) {
  const labels: Record<string, string> = {
    "Europe/Moscow": "Москва",
    "Europe/Kaliningrad": "Калининград",
    "Asia/Yekaterinburg": "Екатеринбург",
    "Asia/Novosibirsk": "Новосибирск",
    "Asia/Vladivostok": "Владивосток",
  };

  return labels[timezone] ?? timezone;
}

function formatMonthYear(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  // Формат с днем дает родительный падеж месяца («июля»); день отбрасываем.
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .format(date)
    .replace(" г.", "")
    .split(" ")
    .slice(1)
    .join(" ");
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "R"
  );
}

function hexWithAlpha(hex: string | null | undefined, alpha: number) {
  if (!hex) {
    return null;
  }

  const normalized = hex.trim();

  if (!/^#([0-9a-f]{6})$/i.test(normalized)) {
    return null;
  }

  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);

  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

function pluralize(value: number, forms: [string, string, string]) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }

  return forms[2];
}
