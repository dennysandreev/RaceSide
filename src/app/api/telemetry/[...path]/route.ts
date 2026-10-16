import { consumeIpRateLimit, getRetryAfterSeconds } from "@/lib/rate-limit";
import { parseConfig } from "../../../../../worker/telemetry/core.mjs";
import { resultKey } from "../../../../../worker/telemetry/service.mjs";
import { normalizeTelemetryMeeting } from "../../../../../worker/telemetry/track-geometry.mjs";
import { telemetryFlags } from "@/features/telemetry/lib/flags";
import {
  telemetryStore,
  readSaved,
  queryTelemetry,
  present,
  presentRacePace,
  getTelemetryBootstrap,
  toTelemetrySetupCatalog,
  userError,
} from "@/features/telemetry/lib/server";
import type { Comparison, Catalog, Meeting, RacePace } from "@/features/telemetry/lib/types";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { billingFlags } from "@/lib/billing/config";
import { configUsesDemoSessions, getTelemetryDemoScope, type TelemetryDemoScope } from "@/features/telemetry/lib/demo-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const EVENTS = new Set([
  "telemetry_open",
  "telemetry_compare_created",
  "telemetry_driver_selected",
  "telemetry_lap_selected",
  "telemetry_chart_changed",
  "telemetry_corner_selected",
  "telemetry_share_open",
  "telemetry_share_generated",
  "telemetry_permalink_created",
]);
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!telemetryFlags.telemetryHub)
    return Response.json({ error: "Раздел пока недоступен." }, { status: 404 });
  const user = await getSessionUser();
  if (!user && billingFlags.entitlementsEnforced) return subscriptionResponse(401, "Войдите, чтобы открыть демо телеметрии.");
  const access = await getSubscriptionAccess(user?.id ?? null);
  const limit = await consumeIpRateLimit("api:telemetry", request, 60, 60000);
  if (!limit.ok)
    return Response.json(
      { error: "Слишком много запросов. Подождите немного." },
      {
        status: 429,
        headers: { "Retry-After": getRetryAfterSeconds(limit.resetAt) },
      },
    );
  const demoScope = access.entitlements.telemetry_full ? null : await getTelemetryDemoScope();
  if (!access.entitlements.telemetry_full && !demoScope) {
    if (request.method === "GET" && new URL(request.url).pathname.endsWith("/bootstrap"))
      return Response.json(
        {
          status: 202,
          data: {
            seasons: [], season: null, meetings: [], meeting: null,
            sessions: [], session: null, catalog: null, stage: "demo",
          },
        },
        { status: 202, headers: { "Cache-Control": "no-store", "Retry-After": "3" } },
      );
    return subscriptionResponse(503, "Демо телеметрии пока готовится.");
  }
  const { path } = await context.params,
    route = path.join("/"),
    url = new URL(request.url),
    get = (name: string) => Number(url.searchParams.get(name));
  try {
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > 8192)
        return Response.json(
          { error: "Слишком большой запрос." },
          { status: 413 },
        );
      const body = JSON.parse(text);
      if (route === "compare") {
        if (demoScope && !configUsesDemoSessions(body, demoScope)) return subscriptionResponse(403, "Этот Гран-при доступен с RaceSide Plus.");
        const result = await queryTelemetry({
          kind: "compare",
          config: parseConfig(body),
        });
        return Response.json(result, {
          status: result.status,
          headers: { "Cache-Control": "no-store", "Retry-After": "3" },
        });
      }
      if (route === "permalink") {
        if (demoScope && !configUsesDemoSessions(body.config, demoScope)) return subscriptionResponse(403, "Ссылки на другие этапы доступны с RaceSide Plus.");
        if (!telemetryFlags.telemetryShare)
          return Response.json(
            { error: "Ссылки пока недоступны." },
            { status: 404 },
          );
        const config = parseConfig(body.config),
          store = telemetryStore();
        const comparison = await store.get<Comparison>(
          resultKey({ kind: "compare", config }),
        );
        if (!comparison)
          return Response.json(
            { error: "Сначала дождитесь загрузки сравнения." },
            { status: 409 },
          );
        const id = await store.saveComparison({
          ...comparison,
          config: {
            ...comparison.config,
            ...(body.view
              ? {
                  channel: parseConfig({ ...config, ...body.view }).channel,
                  corner: parseConfig({ ...config, ...body.view }).corner,
                  range: parseConfig({ ...config, ...body.view }).range,
                }
              : {}),
          },
        });
        return Response.json({ id, url: `/telemetry/compare/${id}` });
      }
      if (route === "events") {
        if (
          !EVENTS.has(body.event) ||
          (body.comparisonId && !/^[a-f0-9]{24}$/.test(body.comparisonId))
        )
          throw new Error("INVALID_REQUEST");
        const { error } = await telemetryStore()
          .db.from("telemetry_events")
          .insert({
            event: body.event,
            comparison_id: body.comparisonId ?? null,
          });
        if (error) throw new Error("STORAGE_UNAVAILABLE");
        return new Response(null, { status: 204 });
      }
    } else {
      if (route === "bootstrap") {
        const optional = (name: string) => {
          const value = get(name);
          return Number.isInteger(value) && value > 0 ? value : undefined;
        };
        const data = await getTelemetryBootstrap({
          demoScope,
          season: optional("season"),
          meeting: optional("meeting"),
          session: optional("session"),
          waitMs: 0,
        });
        const status = data.stage === "ready" ? 200 : 202;
        return Response.json(
          { status, data },
          {
            status,
            headers: {
              "Cache-Control": "no-store",
              ...(status === 202 ? { "Retry-After": "3" } : {}),
            },
          },
        );
      }
      if (route.startsWith("tasks/")) {
        const store = telemetryStore(),
          task = await store.task(path[1]);
        if (!task)
          return Response.json(
            { error: "Сравнение не найдено." },
            { status: 404 },
          );
        if (demoScope && !taskAllowedInDemo(task.task, demoScope)) return subscriptionResponse(403, "Это сравнение доступно с RaceSide Plus.");
        if (task.status === "failed") {
          const error = userError(
            new Error(task.error_code ?? "PROVIDER_UNAVAILABLE"),
          );
          return Response.json(error, { status: 503 });
        }
        if (task.status === "ready" && task.result_key) {
          const result = await store.get(task.result_key);
          if (result) {
            const kind =
              task.task &&
              typeof task.task === "object" &&
              "kind" in task.task ? task.task.kind : null;
            const data = kind === "compare"
                ? present(result as Comparison)
                : kind === "race-pace" ? presentRacePace(result as RacePace)
                : kind === "meetings"
                  ? (result as Meeting[]).map(normalizeTelemetryMeeting)
                  : result;
            return Response.json(
              { status: 200, data },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
        }
        return Response.json(
          { status: 202, taskId: task.id },
          {
            status: 202,
            headers: { "Retry-After": "3", "Cache-Control": "no-store" },
          },
        );
      }
      if (route.startsWith("comparison/")) {
        const saved = await readSaved(path[1]);
        if (!saved)
          return Response.json(
            { error: "Сравнение не найдено." },
            { status: 404 },
          );
        if (demoScope && !configUsesDemoSessions(saved.comparison.config, demoScope)) return subscriptionResponse(403, "Это сравнение доступно с RaceSide Plus.");
        const from = url.searchParams.has("from") ? get("from") : 0,
          to = url.searchParams.has("to")
            ? get("to")
            : saved.comparison.track.length;
        return Response.json({
          data: present(saved.comparison, { from, to, points: 1500 }),
        });
      }
      if (route === "race-pace") {
        if (demoScope && !demoScope.sessions.some((session) => session.id === get("session")))
          return subscriptionResponse(403, "Эта гонка доступна с RaceSide Plus.");
        const result = await queryTelemetry({
          kind: "race-pace",
          session: get("session"),
        });
        return Response.json(result, {
          status: result.status,
          headers: { "Cache-Control": "no-store", "Retry-After": "3" },
        });
      }
      if (route === "seasons" || route === "meetings" || route === "sessions") {
        if (demoScope) {
          if (route === "seasons") return Response.json({ status: 200, data: [demoScope.meeting.season] });
          if (route === "meetings") return Response.json({ status: 200, data: get("season") === demoScope.meeting.season ? [normalizeTelemetryMeeting(demoScope.meeting)] : [] });
          return Response.json({ status: 200, data: get("meeting") === demoScope.meeting.id ? demoScope.sessions : [] });
        }
        const result = await queryTelemetry(
          route === "seasons"
            ? { kind: "seasons" }
            : route === "meetings"
              ? { kind: "meetings", season: get("season") }
              : { kind: "sessions", meeting: get("meeting") },
        );
        return Response.json(result, {
          status: result.status,
          headers: { "Retry-After": "3" },
        });
      }
      if (["drivers", "laps", "catalog", "setup-catalog"].includes(route)) {
        if (demoScope && !demoScope.sessions.some((session) => session.id === get("session"))) return subscriptionResponse(403, "Этот Гран-при доступен с RaceSide Plus.");
        const result = await queryTelemetry({
          kind: "catalog",
          session: get("session"),
        });
        if (result.status === 200) {
          const catalog = result.data as Catalog;
          return Response.json({
            status: 200,
            data:
              route === "catalog"
                ? catalog
                : route === "setup-catalog"
                  ? toTelemetrySetupCatalog(catalog)
                : route === "drivers"
                  ? catalog.drivers
                  : catalog.laps.filter(
                      (l) => !get("driver") || l.driverNumber === get("driver"),
                    ),
          });
        }
        return Response.json(result, {
          status: result.status,
          headers: { "Retry-After": "3" },
        });
      }
      if (route.startsWith("lap/")) {
        const [session, driver, lap] = path[1].split(":").map(Number);
        if (demoScope && !demoScope.sessions.some((item) => item.id === session)) return subscriptionResponse(403, "Этот Гран-при доступен с RaceSide Plus.");
        const result = await queryTelemetry({ kind: "catalog", session });
        if (result.status === 202)
          return Response.json(result, { status: 202 });
        const found = (result.data as Catalog).laps.find(
          (l) => l.driverNumber === driver && l.number === lap,
        );
        return Response.json(
          { data: found ?? null },
          { status: found ? 200 : 404 },
        );
      }
    }
    return Response.json({ error: "Не найдено." }, { status: 404 });
  } catch (error) {
    const response = userError(error);
    return Response.json(response, {
      status:
        response.code === "STORAGE_UNAVAILABLE" ||
        response.code === "PROVIDER_UNAVAILABLE"
          ? 503
          : 422,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
export const GET = handle;
export const POST = handle;

function subscriptionResponse(status: number, error: string) {
  return Response.json({ error, code: "SUBSCRIPTION_REQUIRED" }, { status, headers: { "Cache-Control": "no-store" } });
}

function taskAllowedInDemo(task: unknown, scope: TelemetryDemoScope) {
  if (!task || typeof task !== "object" || !("kind" in task)) return false;
  if (task.kind === "compare" && "config" in task) return configUsesDemoSessions(task.config, scope);
  if ((task.kind === "catalog" || task.kind === "race-pace") && "session" in task && typeof task.session === "number") return scope.sessions.some((session) => session.id === task.session);
  if (task.kind === "sessions" && "meeting" in task) return task.meeting === scope.meeting.id;
  if (task.kind === "meetings" && "season" in task) return task.season === scope.meeting.season;
  return task.kind === "seasons";
}
