import aiPrompts from "../config/ai-prompts.json" with { type: "json" };

export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function getSupabaseServiceEnv() {
  const env = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!env || !serviceRoleKey) {
    return null;
  }

  return { ...env, serviceRoleKey };
}

export function hasSupabaseEnv() {
  return getSupabaseEnv() !== null;
}

export function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

export function getOpenRouterEnv() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = aiPrompts[0].modelFallback;

  if (!apiKey) {
    return null;
  }

  return { apiKey, model };
}
