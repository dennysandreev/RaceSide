export const DEFAULT_SESSION_NOTIFICATION_SETTINGS = {
  practice: {
    enabled: false,
    reminder_24h: false,
    reminder_1h: true,
    reminder_15m: true,
    spoiler_free: false,
  },
  sprint_qualifying: {
    enabled: true,
    reminder_24h: false,
    reminder_1h: true,
    reminder_15m: true,
    spoiler_free: true,
  },
  qualifying: {
    enabled: true,
    reminder_24h: false,
    reminder_1h: true,
    reminder_15m: true,
    spoiler_free: true,
  },
  sprint: {
    enabled: true,
    reminder_24h: false,
    reminder_1h: true,
    reminder_15m: true,
    spoiler_free: true,
  },
  race: {
    enabled: true,
    reminder_24h: false,
    reminder_1h: true,
    reminder_15m: true,
    spoiler_free: true,
  },
};

export function getSessionNotificationKey(sessionType) {
  if (["fp1", "fp2", "fp3", "practice", "practice_1", "practice_2", "practice_3"].includes(sessionType)) {
    return "practice";
  }

  if (["sprint_qualifying", "sprint_shootout"].includes(sessionType)) {
    return "sprint_qualifying";
  }

  if (["qualifying", "sprint", "race"].includes(sessionType)) {
    return sessionType;
  }

  return null;
}

export function getSessionNotificationSetting(preference, sessionType) {
  const key = getSessionNotificationKey(sessionType);

  if (!key) {
    return null;
  }

  const fallback = DEFAULT_SESSION_NOTIFICATION_SETTINGS[key];
  const candidate = isRecord(preference?.session_notifications)
    ? preference.session_notifications[key]
    : null;

  if (isRecord(candidate)) {
    return {
      enabled: readBoolean(candidate.enabled, fallback.enabled),
      reminder_24h: readBoolean(candidate.reminder_24h, fallback.reminder_24h),
      reminder_1h: readBoolean(candidate.reminder_1h, fallback.reminder_1h),
      reminder_15m: readBoolean(candidate.reminder_15m, fallback.reminder_15m),
      spoiler_free: readBoolean(candidate.spoiler_free, fallback.spoiler_free),
    };
  }

  // Legacy fallback keeps reminders working while the migration rolls out.
  const reminderEnabled = key === "practice"
    ? preference?.practice_reminders
    : key === "sprint_qualifying" || key === "qualifying"
      ? preference?.qualifying_reminders
      : key === "sprint"
        ? preference?.sprint_reminders
        : preference?.race_reminders;
  const resultEnabled = key === "practice"
    ? preference?.practice_results
    : key === "sprint_qualifying" || key === "qualifying"
      ? preference?.qualifying_results
      : key === "sprint"
        ? preference?.sprint_results
        : preference?.race_results;

  return {
    enabled: Boolean(reminderEnabled || resultEnabled),
    reminder_24h: readBoolean(preference?.reminder_24h, fallback.reminder_24h),
    reminder_1h: readBoolean(preference?.reminder_1h, fallback.reminder_1h),
    reminder_15m: readBoolean(preference?.reminder_15m, fallback.reminder_15m),
    spoiler_free: key !== "practice",
  };
}

export function isReminderDue(millisecondsUntil, leadMs, windowMs = 10 * 60 * 1_000) {
  return millisecondsUntil > leadMs - windowMs && millisecondsUntil <= leadMs;
}

export function hasSessionStartChanged(previousStartAt, nextStartAt) {
  const previousTimestamp = Date.parse(previousStartAt ?? "");
  const nextTimestamp = Date.parse(nextStartAt ?? "");

  if (Number.isFinite(previousTimestamp) && Number.isFinite(nextTimestamp)) {
    return previousTimestamp !== nextTimestamp;
  }

  return String(previousStartAt ?? "") !== String(nextStartAt ?? "");
}

export function isNotificationFreshForConnection(notificationCreatedAt, connectedAt) {
  if (!connectedAt) {
    return true;
  }

  const notificationTimestamp = Date.parse(notificationCreatedAt ?? "");
  const connectedTimestamp = Date.parse(connectedAt);

  if (!Number.isFinite(notificationTimestamp) || !Number.isFinite(connectedTimestamp)) {
    return true;
  }

  return notificationTimestamp >= connectedTimestamp;
}

export function getRemainingNewsNotificationBudget(alreadyQueued, dailyLimit = 30) {
  const limit = Number.isFinite(Number(dailyLimit))
    ? Math.max(0, Math.floor(Number(dailyLimit)))
    : 30;
  const queued = Number.isFinite(Number(alreadyQueued))
    ? Math.max(0, Math.floor(Number(alreadyQueued)))
    : 0;

  return Math.max(0, limit - queued);
}

export function buildNewsArticlePath(article) {
  const routeKey = String(article?.slug ?? article?.id ?? "").trim();
  return `/news/${encodeURIComponent(routeKey)}`;
}

export function getFantasyDeadlineReminders(preference) {
  return [
    {
      key: "4h",
      enabled: readBoolean(preference?.fantasy_reminder_4h, true),
      leadMs: 4 * 60 * 60 * 1_000,
      label: "4 часа",
      urgency: "⏳",
    },
    {
      key: "15m",
      enabled: readBoolean(preference?.fantasy_reminder_15m, true),
      leadMs: 15 * 60 * 1_000,
      label: "15 минут",
      urgency: "🚨",
    },
  ];
}

export function isRacePredictionComplete(prediction) {
  return Boolean(
    prediction?.fastest_lap_driver_id &&
    (prediction?.dnf_pick_kind === "none" || prediction?.dnf_driver_id) &&
    prediction?.top_scoring_team_id &&
    prediction?.fastest_pit_stop_team_id &&
    Array.isArray(prediction?.top10_driver_ids) &&
    prediction.top10_driver_ids.length === 10 &&
    new Set(prediction.top10_driver_ids).size === 10
  );
}

export function escapeTelegramHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function telegramMedal(position) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return `${position}.`;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
export async function claimNotification(db, notification) {
  const { data, error } = await db.from("notification_queue")
    .update({ status: "sending", attempts: Number(notification.attempts ?? 0) + 1 })
    .eq("id", notification.id).eq("status", "pending").is("sent_at", null)
    .select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
