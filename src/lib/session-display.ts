export function formatSessionName(name?: string | null) {
  if (!name) {
    return "Сессия";
  }

  return name
    .replace(/^Свободна(?:я)?\s+практика\s*(\d+)/i, "Практика $1")
    .replace(/^Free\s+Practice\s*(\d+)/i, "Практика $1")
    .trim();
}

export function splitSessionStart(value: string) {
  const normalized = value.trim();
  const match = /(?:^|,\s*)(\d{1,2}:\d{2})$/.exec(normalized);

  if (!match) return { date: normalized, time: null };

  return {
    date: normalized.slice(0, match.index).trim(),
    time: match[1],
  };
}

export function formatSessionCountdown(startsAtIso?: string | null, status?: string | null) {
  if (status === "Live") {
    return "Live сейчас";
  }

  if (!startsAtIso) {
    return status || "Расписание уточняется";
  }

  const startMs = new Date(startsAtIso).getTime();

  if (!Number.isFinite(startMs)) {
    return status || "Расписание уточняется";
  }

  const diffMs = startMs - Date.now();

  if (diffMs <= 0) {
    return status === "Завершена" ? "Сессия завершена" : "Live сейчас";
  }

  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `Через ${days} дн. ${hours} ч` : `Через ${days} дн.`;
  }

  if (hours > 0) {
    return minutes > 0 ? `Через ${hours} ч ${minutes} мин` : `Через ${hours} ч`;
  }

  return `Через ${minutes} мин`;
}
