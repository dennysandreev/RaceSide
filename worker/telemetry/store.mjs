import { orientComparison } from "./track-geometry.mjs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
export const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
export function createTelemetryDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("STORAGE_UNAVAILABLE");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export class TelemetryStore {
  constructor(db) {
    this.db = db;
  }
  async get(key) {
    const { data, error } = await this.db
      .from("telemetry_cache")
      .select("payload,expires_at")
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error("STORAGE_UNAVAILABLE");
    return data &&
      (!data.expires_at || Date.parse(data.expires_at) > Date.now())
      ? data.payload
      : null;
  }
  async put(key, payload, ttl = null) {
    const { error } = await this.db.from("telemetry_cache").upsert({
      key,
      payload,
      expires_at: ttl ? new Date(Date.now() + ttl).toISOString() : null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("STORAGE_UNAVAILABLE");
  }
  async enqueue(task, cacheKey) {
    const key = hash(cacheKey ?? task);
    const { data, error } = await this.db.rpc("enqueue_telemetry_task", {
      p_key: key,
      p_task: task,
    });
    if (error) throw new Error("STORAGE_UNAVAILABLE");
    return data;
  }
  async task(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) return null;
    const { data, error } = await this.db
      .from("telemetry_tasks")
      .select("id,task,status,result_key,error_code,job_id,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("STORAGE_UNAVAILABLE");
    if (data?.status === "queued" && data.error_code) return { ...data, status: "failed" };
    if (data && data.status === "queued" && data.job_id) {
      const { data: job } = await this.db
        .from("job_runs")
        .select("status")
        .eq("id", data.job_id)
        .maybeSingle();
      if (job?.status === "failed")
        return {
          ...data,
          status: "failed",
          error_code: data.error_code ?? "PROVIDER_UNAVAILABLE",
        };
    }
    return data;
  }
  async finish(id, resultKey, jobId) {
    let request = this.db
      .from("telemetry_tasks")
      .update({
        status: "ready",
        result_key: resultKey,
        error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (jobId) request = request.eq("job_id", jobId);
    const { error } = await request;
    if (error) throw new Error("STORAGE_UNAVAILABLE");
  }
  async fail(id, errorCode, jobId) {
    let request = this.db
      .from("telemetry_tasks")
      .update({ status: "failed", error_code: errorCode, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (jobId) request = request.eq("job_id", jobId);
    const { error } = await request;
    if (error) throw new Error("STORAGE_UNAVAILABLE");
  }
  async saveComparison(comparison) {
    const id = hash(comparison).slice(0, 24);
    const { error } = await this.db
      .from("telemetry_comparisons")
      .upsert({ id, comparison }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error("STORAGE_UNAVAILABLE");
    return id;
  }
  async getComparison(id) {
    if (!/^[a-f0-9]{24}$/.test(id)) return null;
    const { data, error } = await this.db
      .from("telemetry_comparisons")
      .select("id,comparison,created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("STORAGE_UNAVAILABLE");
    return data
      ? { id: data.id, comparison: orientComparison(data.comparison), createdAt: data.created_at }
      : null;
  }
  async getNormalizedLaps(session, driver) {
    const { data, error } = await this.db.from("telemetry_cache")
      .select("payload,expires_at")
      .like("key", `normalized:telemetry-%:${session}:${driver}:%`)
      .order("updated_at", { ascending: false }).limit(24);
    if (error) throw new Error("STORAGE_UNAVAILABLE");
    return (data ?? []).filter((row) => !row.expires_at || Date.parse(row.expires_at) > Date.now()).map((row) => row.payload);
  }
}
