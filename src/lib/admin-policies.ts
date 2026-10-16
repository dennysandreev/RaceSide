export type AdminEditorialStatus = "draft" | "published" | "rejected";
export type AdminSocialStatus = "pending" | "published" | "rejected" | "review";
export type AdminPollStatus = "closed" | "draft" | "published";

const editorialTransitions: Record<AdminEditorialStatus, ReadonlySet<AdminEditorialStatus>> = {
  draft: new Set(["draft", "published", "rejected"]),
  published: new Set(["draft", "published", "rejected"]),
  rejected: new Set(["draft", "published", "rejected"]),
};
const socialTransitions: Record<AdminSocialStatus, ReadonlySet<AdminSocialStatus>> = {
  pending: new Set(["pending", "published", "rejected", "review"]),
  published: new Set(["pending", "published", "rejected"]),
  rejected: new Set(["pending", "published", "rejected"]),
  review: new Set(["pending", "published", "rejected", "review"]),
};
const pollTransitions: Record<AdminPollStatus, ReadonlySet<AdminPollStatus>> = {
  draft: new Set(["draft", "published", "closed"]),
  published: new Set(["published", "closed"]),
  closed: new Set(["closed"]),
};

export function canTransitionAdminStatus(
  entity: "news" | "poll" | "social",
  from: string,
  to: string,
) {
  if (entity === "news" && isEditorialStatus(from) && isEditorialStatus(to)) {
    return editorialTransitions[from].has(to);
  }
  if (entity === "social" && isSocialStatus(from) && isSocialStatus(to)) {
    return socialTransitions[from].has(to);
  }
  if (entity === "poll" && isPollStatus(from) && isPollStatus(to)) {
    return pollTransitions[from].has(to);
  }
  return false;
}

export function canReplacePollOptions(votesCount: number) {
  return Number.isInteger(votesCount) && votesCount === 0;
}

export function isNewsRemovedFromFeed(
  publicationStatus: string,
  publishedAt: string | null,
) {
  return publicationStatus === "draft" && publishedAt !== null;
}

export function isNewsPubliclyAvailable(article: { status: string; publication_status: string; duplicate_of: string | null; ai_model: string | null }) {
  return article.status === "processed" && article.publication_status === "published" && article.duplicate_of === null && article.ai_model !== "fallback";
}

export function getAdminTelemetrySignal(snapshot: { failed24h: number; queuedErrors: number; staleQueued: number; queued: number; ready24h: number }) {
  if (snapshot.failed24h) return "failed";
  if (snapshot.staleQueued) return "stale";
  if (snapshot.queued || snapshot.queuedErrors) return "warning";
  return snapshot.ready24h ? "healthy" : "unknown";
}

export function buildNewsEditorialUpdate(input: {
  currentPublishedAt: string | null;
  currentSlug: string;
  nextStatus: AdminEditorialStatus;
  title: string | null;
  summary: string | null;
  body: string | null;
  actorUserId: string;
  now: string;
}) {
  return {
    stableSlug: input.currentSlug,
    update: {
      ai_title_ru: input.title,
      ai_summary_ru: input.summary,
      ai_summary_long_ru: input.body,
      publication_status: input.nextStatus,
      status: input.title && input.summary ? "processed" : "pending",
      published_at: input.nextStatus === "published"
        ? input.currentPublishedAt ?? input.now
        : input.currentPublishedAt,
      published_manually: input.nextStatus === "published",
      manual_published_at: input.nextStatus === "published" ? input.now : null,
      manual_published_by: input.nextStatus === "published" ? input.actorUserId : null,
    },
  };
}

export const SPORT_ADMIN_EDITABLE_TABLES = new Set([
  "drivers",
  "grand_prix_reports",
  "race_replay_sessions",
]);

function isEditorialStatus(value: string): value is AdminEditorialStatus {
  return ["draft", "published", "rejected"].includes(value);
}

function isSocialStatus(value: string): value is AdminSocialStatus {
  return ["pending", "published", "rejected", "review"].includes(value);
}

function isPollStatus(value: string): value is AdminPollStatus {
  return ["closed", "draft", "published"].includes(value);
}
