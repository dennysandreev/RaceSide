let cachedSupportChatId = null;

export async function sendSupportTelegramMessage(input, options = {}) {
  const botToken = normalizeString(
    options.botToken ?? process.env.TELEGRAM_SUPPORT_BOT_TOKEN,
  );
  if (!botToken) {
    return { ok: false, status: "not_configured", reason: "support_bot_token_missing" };
  }

  const chatId = await resolveSupportChatId(botToken, options);
  if (!chatId) {
    return { ok: false, status: "not_configured", reason: "support_chat_not_found" };
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(input.text ?? "").slice(0, 4_096),
      parse_mode: input.parseMode === null ? undefined : input.parseMode ?? "HTML",
      disable_web_page_preview: true,
      reply_markup: input.replyMarkup ?? undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      reason: `telegram_http_${response.status}`,
    };
  }

  return { ok: true, status: "sent" };
}

export function escapeSupportTelegramHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function resolveSupportChatId(botToken, options) {
  const configuredChatId = normalizeString(
    options.chatId ?? process.env.TELEGRAM_SUPPORT_CHAT_ID,
  );
  if (configuredChatId && /^-?\d+$/.test(configuredChatId)) {
    return configuredChatId;
  }
  if (cachedSupportChatId) return cachedSupportChatId;

  const username = normalizeUsername(
    options.username ?? process.env.TELEGRAM_SUPPORT_USERNAME,
  );
  if (!username) return null;

  const persistedChatId = await resolvePersistedSupportChatId(options.client, username);
  if (persistedChatId) {
    cachedSupportChatId = persistedChatId;
    return persistedChatId;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates?limit=100&timeout=0`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const updates = Array.isArray(payload?.result) ? payload.result : [];
  const match = updates.toReversed().find((update) => {
    const message = update?.message ?? update?.edited_message;
    const fromUsername = normalizeUsername(message?.from?.username);
    const chatUsername = normalizeUsername(message?.chat?.username);
    return message?.chat?.type === "private" && (
      fromUsername === username || chatUsername === username
    );
  });
  const resolved = String(match?.message?.chat?.id ?? match?.edited_message?.chat?.id ?? "");
  if (!/^-?\d+$/.test(resolved)) return null;
  cachedSupportChatId = resolved;
  return resolved;
}

async function resolvePersistedSupportChatId(client, username) {
  if (!client) return null;

  const { data, error } = await client
    .from("telegram_accounts")
    .select("chat_id, username, is_active")
    .ilike("username", username)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) return null;
  const resolved = String(data?.chat_id ?? "");
  return /^-?\d+$/.test(resolved) ? resolved : null;
}

function normalizeUsername(value) {
  return normalizeString(value)?.replace(/^@/, "").toLowerCase() ?? null;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
