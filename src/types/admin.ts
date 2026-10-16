import type { Json } from "@/types/supabase";
import type { Database } from "@/types/supabase";

export type AdminOperationsSnapshot = {
  latestJobs: Database["public"]["Tables"]["job_runs"]["Row"][];
  scheduleJobs: Array<{ scheduleKey: string; job: Database["public"]["Tables"]["job_runs"]["Row"] | null; lastSuccessAt: string | null }>;
  queuedJobs: number;
  runningJobs: number;
  failedJobs24h: number;
  telemetry: { failed24h: number; queuedErrors: number; queued: number; staleQueued: number; ready24h: number; lastRequestAt: string | null; lastReadyAt: string | null; cacheUpdatedAt: string | null };
};

export type AdminActionResult<T = unknown> = {
  ok: boolean;
  message: string;
  data?: T;
  fieldErrors?: Record<string, string[]>;
};

export type AdminTableQuery = {
  page: number;
  pageSize: number;
  search: string;
  status?: string;
  sort?: string;
  from?: string;
  to?: string;
  params?: Record<string, string>;
};

export type AdminJobParameter = {
  name: string;
  flag: string;
  type: "boolean" | "integer" | "string" | "uuid";
  required: boolean;
  min?: number;
  max?: number;
  options?: string[];
};

export type AdminJobDefinition = {
  name: string;
  title: string;
  description: string;
  group: "ai" | "archive" | "community" | "news" | "notifications" | "reports" | "social" | "sport" | "legacy";
  expectedIntervalMinutes: number;
  adaptiveSchedule?: {
    activeLabel: string;
    idleLabel: string;
  };
  maxAttempts: number;
  danger?: boolean;
  confirmation?: string;
  availability?: { available: boolean | null; detail: string };
  parameters: AdminJobParameter[];
};

export type AdminJobRun = {
  id: string;
  jobName: string;
  status: string;
  requestedBy: string | null;
  availableAt: string | null;
  claimedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  itemsProcessed: number;
  attemptCount: number;
  maxAttempts: number;
  retryOf: string | null;
  requestKey: string | null;
  queueVersion: number | null;
  workerId: string | null;
  metadata: Json | null;
  errorMessage: string | null;
};

export type AdminSystemSignal = {
  id: string;
  label: string;
  status: "healthy" | "stale" | "warning" | "failed" | "unknown" | "paused";
  detail: string;
  checkedAt: string | null;
  href?: string;
};

export type AdminSystemStatus = AdminSystemSignal & {
  kind: "api" | "service" | "source" | "schedule";
  group: string;
  description: string;
  lastSuccessAt: string | null;
  nextCheckAt: string | null;
  isEnabled: boolean;
};

export type AdminSchedule = {
  availability?: { available: boolean | null; detail: string };
  id: string;
  scheduleKey: string;
  jobName: string;
  scheduleKind: "interval" | "daily" | "adaptive";
  intervalMinutes: number | null;
  dailyTimeUtc: string | null;
  args: Json;
  maxAttempts: number;
  isEnabled: boolean;
  nextRunAt: string;
  lastEnqueuedAt: string | null;
  lastJobRunId: string | null;
  lastRun: AdminJobRun | null;
  updatedAt: string;
};

export type AdminAuditEntry = {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: "started" | "succeeded" | "failed";
  beforeData: Json;
  afterData: Json;
  metadata: Json;
  createdAt: string;
  finishedAt: string | null;
};

export type AdminAiUsageSummaryRow = {
  dimension: "day" | "model" | "purpose" | "total";
  bucket: string;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  unpriced_count: number;
};

export type AdminAiPromptVariable = {
  name: string;
  label: string;
};

export type AdminAiPromptDefinition = {
  key: string;
  purpose: string;
  title: string;
  description: string;
  area: string;
  modelFallback: string;
  maxTokens: number;
  usedBy: string[];
  variables: AdminAiPromptVariable[];
  defaultSystemPrompt: string;
  defaultUserTemplate: string;
  protectedInstruction: string;
};

export type AdminAiPromptVersion = {
  id: string;
  promptKey: string;
  version: number;
  status: "draft" | "published" | "archived";
  systemPrompt: string;
  userTemplate: string;
  model: string | null;
  maxTokens: number | null;
  changeNote: string | null;
  checksum: string;
  createdAt: string;
  publishedAt: string | null;
};

export type AdminAiPromptVersionSummary = Omit<
  AdminAiPromptVersion,
  "systemPrompt" | "userTemplate"
>;

export type AdminAiPromptItem = {
  definition: AdminAiPromptDefinition;
  published: AdminAiPromptVersion | null;
  latestDraft: AdminAiPromptVersion | null;
  history: AdminAiPromptVersionSummary[];
};

export type AdminOpenRouterModel = {
  id: string;
  name: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
};

export type AdminAiBudget = {
  scope: "default";
  daily_limit_usd: number;
  monthly_limit_usd: number;
  updated_at: string | null;
};

export type AdminExternalApiBudget = {
  provider: "x";
  resource_type: "post_read";
  unit_cost_usd: number;
  daily_limit_usd: number;
  monthly_limit_usd: number;
  updated_at: string | null;
};

export type AdminCostTimelineRow = {
  day: string;
  ai_cost_usd: number;
  x_api_cost_usd: number;
  x_post_count: number;
};

export type AdminUserErrorReport = {
  id: string;
  kind: "news_error" | "feedback";
  contact: string | null;
  articleId: string;
  articleSlug: string | null;
  articleTitle: string | null;
  sourceName: string | null;
  message: string;
  status: "new" | "in_progress" | "resolved" | "dismissed";
  pagePath: string;
  referrerPath: string | null;
  userAgent: string | null;
  releaseSha: string | null;
  requestFingerprint: string | null;
  isAuthenticated: boolean;
  technicalContext: Json;
  telegramDeliveryStatus: string;
  telegramDeliveryError: string | null;
  adminNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminAgentRunKind =
  | "watcher"
  | "browser_smoke"
  | "editorial"
  | "bug_triage"
  | "weekly_audit";

export type AdminAgentRunStatus = "running" | "succeeded" | "partial" | "failed";

export type AdminFindingCategory =
  | "availability"
  | "data"
  | "job"
  | "content"
  | "browser"
  | "security"
  | "cost"
  | "ux"
  | "seo";

export type AdminFindingSeverity = "P0" | "P1" | "P2" | "P3";

export type AdminFindingStatus =
  | "open"
  | "acknowledged"
  | "action_pending"
  | "fixing"
  | "monitoring"
  | "resolved"
  | "ignored";

export type AdminFinding = {
  id: string;
  fingerprint: string;
  category: AdminFindingCategory;
  severity: AdminFindingSeverity;
  status: AdminFindingStatus;
  title: string;
  description: string;
  evidence: Json;
  route: string | null;
  entityType: string | null;
  entityId: string | null;
  jobRunId: string | null;
  releaseSha: string | null;
  ownerKind: "agent" | "human";
  ownerUserId: string | null;
  githubIssueUrl: string | null;
  githubPrUrl: string | null;
  resolution: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  lastAlertedAt: string | null;
  alertCount: number;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminFindingEvent = {
  id: string;
  findingId: string;
  eventType:
    | "detected"
    | "repeated"
    | "severity_changed"
    | "action_requested"
    | "action_started"
    | "action_succeeded"
    | "action_failed"
    | "fix_pr_opened"
    | "acknowledged"
    | "resolved"
    | "ignored"
    | "reopened"
    | "alert_sent";
  actorKind: "agent" | "human" | "system";
  actorUserId: string | null;
  payload: Json;
  createdAt: string;
};

export type OpsServiceHeartbeat = {
  serviceName: "web" | "worker" | "cron" | "admin-job-runner" | "watcher";
  instanceId: string;
  releaseSha: string | null;
  status: "healthy" | "degraded" | "unhealthy";
  summary: Json;
  checkedAt: string;
  updatedAt: string;
};
