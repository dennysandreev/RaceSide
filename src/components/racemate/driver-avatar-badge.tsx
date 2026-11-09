import Image from "next/image";

import historicalFallbackAvatar from "../../../public/drivers/avatars/archive-helmet-neutral-v2.png";

import { normalizeDriverAvatarSlug } from "@/lib/driver-avatar-slug";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import { cn } from "@/lib/utils";

const localDriverAvatarSlugs = new Set([
  "alexander-albon",
  "andrea-kimi-antonelli",
  "arvid-lindblad",
  "carlos-sainz",
  "charles-leclerc",
  "esteban-ocon",
  "fernando-alonso",
  "franco-colapinto",
  "gabriel-bortoleto",
  "george-russell",
  "isack-hadjar",
  "lance-stroll",
  "lando-norris",
  "lewis-hamilton",
  "liam-lawson",
  "max-verstappen",
  "nico-hulkenberg",
  "oliver-bearman",
  "oscar-piastri",
  "pierre-gasly",
  "rafael-camara",
  "sergio-perez",
  "valtteri-bottas",
]);

export function getLocalDriverAvatarSrc(slug?: string | null, season = CURRENT_F1_SEASON) {
  const normalizedSlug = normalizeDriverAvatarSlug(slug);

  return season === CURRENT_F1_SEASON && normalizedSlug && localDriverAvatarSlugs.has(normalizedSlug)
    ? `/drivers/avatars/${season}/${normalizedSlug}.webp`
    : null;
}

export function getHistoricalDriverFallbackSrc(season: number) {
  return season >= 2020 && season <= 2025 ? historicalFallbackAvatar.src : null;
}

type DriverAvatarBadgeProps = {
  className?: string;
  color?: string | null;
  fallbackClassName?: string;
  fallbackLabel?: string | number | null;
  imageClassName?: string;
  name: string;
  sizes?: string;
  slug?: string | null;
  season?: number;
  src?: string | null;
};

export function DriverAvatarBadge({
  className,
  color,
  fallbackClassName,
  fallbackLabel,
  imageClassName,
  name,
  sizes = "3rem",
  slug,
  season = CURRENT_F1_SEASON,
  src,
}: DriverAvatarBadgeProps) {
  const resolvedAvatarSrc = src === undefined ? getLocalDriverAvatarSrc(slug, season) : src;
  const historicalFallbackSrc = getHistoricalDriverFallbackSrc(season);
  const usesHistoricalFallback = !resolvedAvatarSrc && Boolean(historicalFallbackSrc);
  const avatarSrc = resolvedAvatarSrc ?? historicalFallbackSrc;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-background",
        className,
      )}
      style={{ borderColor: color ?? "var(--border)" }}
      title={name}
    >
      {avatarSrc ? (
        <Image
          alt=""
          className={cn(
            usesHistoricalFallback ? "object-contain object-center p-[6%]" : "object-cover object-top",
            imageClassName,
          )}
          fill
          sizes={sizes}
          src={avatarSrc}
          unoptimized={usesHistoricalFallback}
        />
      ) : (
        <span
          className={cn(
            "font-display text-xs font-bold text-muted-foreground",
            fallbackClassName,
          )}
        >
          {fallbackLabel ?? getDriverInitials(name)}
        </span>
      )}
    </span>
  );
}

export function getDriverInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
