import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { formatGrandPrixNameRu } from "@/lib/race-display";
import { normalizeDailyDigestBody } from "@/lib/daily-digest-content";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Json } from "@/types/supabase";

export const runtime = "nodejs";

type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type TelegramMessage = {
  chat: { id: number; title?: string; username?: string; type?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  message_id?: number;
  media_group_id?: string;
  date?: number;
  edit_date?: number;
  views?: number;
  forward_count?: number;
  photo?: { file_id: string; file_unique_id?: string; width?: number; height?: number }[];
  video?: { file_id: string; file_unique_id?: string; width?: number; height?: number; mime_type?: string };
  video_note?: { file_id: string; file_unique_id?: string; length?: number; duration?: number };
  reactions?: { results?: { total_count?: number }[] };
  forward_origin?: unknown;
  forward_from_chat?: unknown;
  reply_to_message?: unknown;
};

type TelegramUpdate = {
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    from: TelegramUser;
    message?: TelegramMessage;
  };
};

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");

  if (!expectedSecret || !safeEqual(expectedSecret, receivedSecret ?? "")) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const admin = createSupabaseAdminClient();

  if (!botToken || !admin) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const update = (await request.json()) as TelegramUpdate;

  if (update.channel_post || update.edited_channel_post) {
    await handleChannelPost(update, botToken, admin);
    return NextResponse.json({ ok: true });
  }

  if (update.callback_query) {
    await handleCallback(update.callback_query, botToken, admin);
    return NextResponse.json({ ok: true });
  }

  if (update.message?.text && update.message.from) {
    await handleMessage(update.message, botToken, admin);
  }

  return NextResponse.json({ ok: true });
}

async function handleChannelPost(
  update: TelegramUpdate,
  botToken: string,
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
) {
  const message = update.edited_channel_post ?? update.channel_post;
  if (!message?.chat.id || !message.message_id) return;
  const { data: sources } = await admin
    .from("social_sources")
    .select("id, name, url, external_key, include_reposts, include_replies")
    .eq("platform", "telegram")
    .eq("is_active", true);
  const chatId = String(message.chat.id);
  const username = message.chat.username?.replace(/^@/, "").toLowerCase();
  const source = (sources ?? []).find((item) => {
    const key = item.external_key?.replace(/^@/, "").toLowerCase();
    return key === chatId || (username && key === username);
  });
  if (!source) return;
  if (message.video_note) {
    await admin
      .from("social_posts")
      .update({
        status: "rejected",
        next_retry_at: null,
        last_processing_error: "unsupported_telegram_video_note",
      })
      .eq("platform", "telegram")
      .eq("external_id", `${chatId}:${message.message_id}`);
    return;
  }
  const isForward = Boolean(message.forward_origin || message.forward_from_chat);
  const isReply = Boolean(message.reply_to_message);
  if ((isForward && !source.include_reposts) || (isReply && !source.include_replies)) return;

  const text = (message.text || message.caption || "").replace(/\s+/g, " ").trim();
  const hasMedia = Boolean(message.photo?.length || message.video);
  if (!text && !hasMedia) return;
  const mediaGroupId = message.media_group_id?.trim();
  const externalId = mediaGroupId
    ? `${chatId}:album:${mediaGroupId}`
    : `${chatId}:${message.message_id}`;
  const originalUrl = username ? `https://t.me/${username}/${message.message_id}` : source.url;
  const reactions = (message.reactions?.results ?? []).reduce((sum, item) => sum + Number(item.total_count ?? 0), 0);
  const { data: existing } = await admin
    .from("social_posts")
    .select("id, content_hash, title, body, original_url, published_at, status")
    .eq("platform", "telegram")
    .eq("external_id", externalId)
    .maybeSingle();
  const effectiveText = text || existing?.body?.trim() || existing?.title?.trim() || "";
  const contentHash = effectiveText
    ? createHash("sha256")
      .update(effectiveText.normalize("NFKC").replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase())
      .digest("hex")
    : null;
  const changed = Boolean(existing && text && existing.content_hash !== contentHash);
  const nextRetryAt = new Date(Date.now() + (mediaGroupId ? 30_000 : 0)).toISOString();
  const postPayload = {
    platform: "telegram",
    source_id: source.id,
    external_id: externalId,
    author: message.chat.title || (username ? `@${username}` : source.name),
    title: effectiveText || null,
    body: effectiveText || null,
    original_url: mediaGroupId && existing?.original_url ? existing.original_url : originalUrl,
    published_at: mediaGroupId && existing?.published_at
      ? existing.published_at
      : new Date(Number(message.date || Math.floor(Date.now() / 1_000)) * 1_000).toISOString(),
    edited_at: message.edit_date ? new Date(message.edit_date * 1_000).toISOString() : null,
    reaction_count: reactions,
    repost_count: message.forward_count ?? null,
    view_count: message.views ?? null,
    popularity_score: reactions + Number(message.forward_count ?? 0) * 3 + Math.log10(Number(message.views ?? 0) + 1) * 5,
    content_hash: contentHash,
    source_metrics: { reactions, forwards: message.forward_count ?? null, views: message.views ?? null },
    raw_payload: JSON.parse(JSON.stringify(message)) as Json,
    last_synced_at: new Date().toISOString(),
    ...(mediaGroupId && existing?.status !== "published" ? { next_retry_at: nextRetryAt } : {}),
    ...(changed ? {
      status: "pending",
      ai_title_ru: null,
      ai_summary_ru: null,
      ai_processed_at: null,
      next_retry_at: nextRetryAt,
      last_processing_error: null,
    } : {}),
  };
  let postId = existing?.id;
  if (existing) {
    const { error } = await admin.from("social_posts").update(postPayload).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { data, error } = await admin.from("social_posts").insert({
      ...postPayload,
      status: "pending",
      next_retry_at: nextRetryAt,
    }).select("id").single();
    if (error) throw error;
    postId = data.id;
  }

  if (postId) {
    const media = await uploadTelegramMedia(message, postId, botToken, admin);
    if (media.length) {
      await admin.from("social_post_media").upsert(media, { onConflict: "post_id,url" });
      const imageUrl = media.find((item) => item.media_type === "image")?.url;
      if (imageUrl) await admin.from("social_posts").update({ image_url: imageUrl }).eq("id", postId);
    }
  }
}

async function uploadTelegramMedia(
  message: TelegramMessage,
  postId: string,
  botToken: string,
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
) {
  const files = [];
  const photo = message.photo?.at(-1);
  if (photo) files.push({ fileId: photo.file_id, uniqueId: photo.file_unique_id ?? photo.file_id, type: "image", width: photo.width, height: photo.height });
  if (message.video) files.push({ fileId: message.video.file_id, uniqueId: message.video.file_unique_id ?? message.video.file_id, type: "video", width: message.video.width, height: message.video.height });
  const rows = [];
  for (const [index, file] of files.entries()) {
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(file.fileId)}`, { cache: "no-store" });
    if (!fileResponse.ok) continue;
    const filePayload = await fileResponse.json() as { result?: { file_path?: string } };
    const filePath = filePayload.result?.file_path;
    if (!filePath) continue;
    const download = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`, { cache: "no-store" });
    if (!download.ok) continue;
    const contentType = download.headers.get("content-type") || (file.type === "image" ? "image/jpeg" : "video/mp4");
    const extension = filePath.split(".").at(-1)?.replace(/[^a-z0-9]/gi, "") || (file.type === "image" ? "jpg" : "mp4");
    const storagePath = `telegram/${postId}/${file.uniqueId}.${extension}`;
    const { error } = await admin.storage.from("social-media").upload(storagePath, await download.arrayBuffer(), { contentType, upsert: true });
    if (error) continue;
    const { data } = admin.storage.from("social-media").getPublicUrl(storagePath);
    rows.push({ post_id: postId, media_type: file.type, url: data.publicUrl, preview_url: file.type === "image" ? data.publicUrl : null, width: file.width ?? null, height: file.height ?? null, sort_order: Number(message.message_id ?? 0) * 10 + index, provider_media_id: file.uniqueId });
  }
  return rows;
}

async function handleMessage(
  message: TelegramMessage,
  botToken: string,
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
) {
  const command = message.text?.trim().split(/\s+/, 1)[0]?.split("@")[0]?.toLowerCase();
  const text = message.text?.trim() ?? "";

  if (command === "/start") {
    const token = text.match(/^\/start(?:@\w+)?\s+link_([A-Za-z0-9_-]+)$/)?.[1];

    if (token) {
      await linkAccount(token, message, botToken, admin);
      return;
    }

    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Привет! Я бот RaceSide. Напомню о ближайшей сессии, прогнозе и важных новостях. Подключите Telegram в личном кабинете RaceSide, чтобы выбрать уведомления.",
      reply_markup: siteKeyboard("Открыть RaceSide", "/account#telegram"),
    });
    return;
  }

  const account = await findAccount(admin, message.from!.id);

  if (command === "/help") {
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Доступные команды:\n/next — ближайшая сессия\n/summary — главное за день\n/settings — настройки уведомлений\n/unsubscribe — отключить уведомления",
    });
    return;
  }

  if (!account) {
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Сначала подключите Telegram в личном кабинете RaceSide.",
      reply_markup: siteKeyboard("Подключить", "/account#telegram"),
    });
    return;
  }

  if (command === "/next") {
    const { data: session } = await admin
      .from("sessions")
      .select("name, start_at, races(race_name)")
      .gte("start_at", new Date().toISOString())
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { data: profile } = await admin
      .from("profiles")
      .select("timezone")
      .eq("id", account.user_id)
      .maybeSingle();

    if (!session?.start_at) {
      await sendTelegramMessage(botToken, message.chat.id, { text: "Ближайшая сессия пока не появилась в календаре." });
      return;
    }

    const race = firstRelation(session.races as unknown as { race_name: string } | { race_name: string }[] | null);
    await sendTelegramMessage(botToken, message.chat.id, {
      text: `Следующая сессия\n\n${session.name}\n${race ? formatGrandPrixNameRu(race.race_name) : "Гоночный уикенд"}\n${formatDateTime(session.start_at, profile?.timezone ?? "Europe/Moscow")}`,
      reply_markup: siteKeyboard("Открыть уикенд", "/weekend"),
    });
    return;
  }

  if (command === "/summary") {
    const { data: digest } = await admin
      .from("digests")
      .select("title, body_md")
      .eq("status", "published")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    await sendTelegramMessage(botToken, message.chat.id, digest
      ? { text: `${digest.title}\n\n${stripMarkdown(normalizeDailyDigestBody(digest.body_md)).slice(0, 3500)}`, reply_markup: siteKeyboard("Читать на RaceSide", "/") }
      : { text: "Свежая сводка ещё готовится." });
    return;
  }

  if (command === "/settings") {
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Выберите, о чём и когда писать, в личном кабинете RaceSide.",
      reply_markup: siteKeyboard("Настроить уведомления", "/account#telegram"),
    });
    return;
  }

  if (command === "/unsubscribe") {
    await Promise.all([
      admin
        .from("telegram_accounts")
        .update({ is_active: false, disconnected_at: new Date().toISOString() })
        .eq("user_id", account.user_id),
      admin
        .from("notification_preferences")
        .upsert({ user_id: account.user_id, telegram_enabled: false }, { onConflict: "user_id" }),
    ]);
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Уведомления отключены. Подключить их снова можно в личном кабинете RaceSide.",
      reply_markup: siteKeyboard("Открыть настройки", "/account#telegram"),
    });
    return;
  }

  await sendTelegramMessage(botToken, message.chat.id, {
    text: "Не узнал команду. Нажмите /help, чтобы посмотреть доступные действия.",
  });
}

async function linkAccount(
  rawToken: string,
  message: TelegramMessage,
  botToken: string,
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
) {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { data: token } = await admin
    .from("telegram_link_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, user_id")
    .maybeSingle();

  if (!token || !message.from) {
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Ссылка уже использована или устарела. Создайте новую в личном кабинете RaceSide.",
      reply_markup: siteKeyboard("Получить новую ссылку", "/account#telegram"),
    });
    return;
  }

  const existingOwner = await findAnyAccount(admin, message.from.id);

  if (existingOwner && existingOwner.user_id !== token.user_id) {
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Этот Telegram уже связан с другим аккаунтом RaceSide. Сначала отключите его в прежнем профиле.",
    });
    return;
  }

  const [{ error: accountError }, { error: preferencesError }] = await Promise.all([
    admin.from("telegram_accounts").upsert({
      user_id: token.user_id,
      telegram_user_id: message.from.id,
      chat_id: message.chat.id,
      username: message.from.username ?? null,
      first_name: message.from.first_name ?? null,
      is_active: true,
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      last_error: null,
    }, { onConflict: "user_id" }),
    admin.from("notification_preferences").upsert({
      user_id: token.user_id,
      telegram_enabled: true,
    }, { onConflict: "user_id" }),
  ]);

  if (accountError || preferencesError) {
    await sendTelegramMessage(botToken, message.chat.id, {
      text: "Не удалось завершить подключение. Создайте новую ссылку в RaceSide и попробуйте ещё раз.",
    });
    return;
  }

  await sendTelegramMessage(botToken, message.chat.id, {
    text: "Telegram подключён. Базовые уведомления уже включены, а остальные можно выбрать в личном кабинете.",
    reply_markup: siteKeyboard("Настроить уведомления", "/account#telegram"),
  });
}

async function handleCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  botToken: string,
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
) {
  const sessionId = callback.data?.match(/^reveal:([0-9a-f-]{36})$/i)?.[1];
  const chatId = callback.message?.chat.id;

  if (!sessionId || !chatId) {
    await answerCallback(botToken, callback.id, "Кнопка уже неактуальна");
    return;
  }

  const account = await findAccount(admin, callback.from.id);

  if (!account) {
    await answerCallback(botToken, callback.id, "Сначала подключите RaceSide");
    return;
  }

  const [{ data: session }, { data: results }] = await Promise.all([
    admin
      .from("sessions")
      .select("id, name, session_type, races(race_name)")
      .eq("id", sessionId)
      .maybeSingle(),
    admin
      .from("session_results")
      .select("position, time_text, drivers(full_name)")
      .eq("session_id", sessionId)
      .not("position", "is", null)
      .order("position", { ascending: true })
      .limit(3),
  ]);

  if (!session || !results?.length) {
    await answerCallback(botToken, callback.id, "Результаты ещё уточняются");
    return;
  }

  await admin.from("spoiler_reveals").upsert({
    user_id: account.user_id,
    session_id: sessionId,
    revealed_at: new Date().toISOString(),
  }, { onConflict: "user_id,session_id" });

  const race = firstRelation(session.races as unknown as { race_name: string } | { race_name: string }[] | null);
  const lines = results.map((result) => {
    const driver = firstRelation(result.drivers as unknown as { full_name: string } | { full_name: string }[] | null);
    return `${result.position}. ${driver?.full_name ?? "Пилот"}${result.time_text ? ` · ${result.time_text}` : ""}`;
  });

  await answerCallback(botToken, callback.id, "Результаты открыты");
  await sendTelegramMessage(botToken, chatId, {
    text: `${session.name}\n${race ? formatGrandPrixNameRu(race.race_name) : ""}\n\n${lines.join("\n")}`,
    reply_markup: siteKeyboard("Полные результаты", `/weekend?session=${encodeURIComponent(session.id)}`),
  });
}

async function findAccount(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  telegramUserId: number,
) {
  const { data } = await admin
    .from("telegram_accounts")
    .select("user_id, chat_id, is_active")
    .eq("telegram_user_id", telegramUserId)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

async function findAnyAccount(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  telegramUserId: number,
) {
  const { data } = await admin
    .from("telegram_accounts")
    .select("user_id, chat_id, is_active")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  return data;
}

async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  payload: { text: string; reply_markup?: unknown },
) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, disable_web_page_preview: true, ...payload }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }
}

async function answerCallback(botToken: string, callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    cache: "no-store",
  });
}

function siteKeyboard(text: string, path: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://raceside.online").replace(/\/$/, "");
  return { inline_keyboard: [[{ text, url: `${baseUrl}${path}` }]] };
}

function formatDateTime(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
}

function stripMarkdown(value: string) {
  return value.replace(/[#*_>`]/g, "").replace(/\[(.+?)]\(.+?\)/g, "$1").trim();
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function safeEqual(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}
