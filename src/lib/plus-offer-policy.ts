export type PlusOfferAudience = "guest" | "free";

export const PLUS_OFFER_DELAY_MS = 15_000;
export const PLUS_OFFER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000;
export const PLUS_OFFER_DISMISSED_KEY = "raceside:plus-offer:dismissed-at";
export const PLUS_OFFER_SESSION_KEY = "raceside:plus-offer:shown";

const excludedRoutes = [
  "/account",
  "/admin",
  "/auth",
  "/fantasy",
  "/feedback",
  "/leagues",
  "/legal",
  "/live",
  "/onboarding",
  "/payment",
  "/plus",
  "/prediction",
  "/predictions",
  "/race-replay",
  "/telemetry",
];

export function getPlusOfferAudience(
  signedIn: boolean,
  activeSubscription: boolean,
): PlusOfferAudience | null {
  if (activeSubscription) return null;
  return signedIn ? "free" : "guest";
}

export function isPlusOfferRoute(pathname: string) {
  return !excludedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function canShowPlusOffer({
  pathname,
  shownThisSession,
  dismissedAt,
  now,
}: {
  pathname: string;
  shownThisSession: boolean;
  dismissedAt: number;
  now: number;
}) {
  if (!isPlusOfferRoute(pathname) || shownThisSession) return false;
  if (!Number.isFinite(dismissedAt) || dismissedAt <= 0 || dismissedAt > now) {
    return true;
  }
  return now - dismissedAt >= PLUS_OFFER_COOLDOWN_MS;
}
