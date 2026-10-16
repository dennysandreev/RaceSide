import { CircleAlert, Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { makeAdminPageHref } from "@/lib/admin-table-query";
import type { AdminTableQuery } from "@/types/admin";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-balance text-2xl font-bold tracking-[-0.02em] md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-[72ch] text-pretty text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminPage({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 md:p-6 lg:p-8">{children}</div>;
}

export function AdminMetric({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className="min-w-0 border-l border-border px-4 first:border-l-0 first:pl-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-2xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {helper ? <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p> : null}
    </div>
  );
}

export function AdminSection({
  title,
  description,
  actions,
  children,
  id,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-card", className)} id={id}>
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description ? <p className="mt-1 max-w-[72ch] text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function AdminStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variant =
    /success|published|ready|active|healthy|sent|succeeded|completed|generated|edited|unique|processed|approved/.test(normalized)
      ? "success"
      : /fail|error|reject|danger|unavailable/.test(normalized)
        ? "danger"
        : /queued|pending|review|stale|warning|processing|running|partial|duplicate|checking|sending/.test(normalized)
          ? "warning"
          : "secondary";
  const label = statusLabels[normalized] ?? status;

  return <Badge variant={variant}>{label}</Badge>;
}

export function AdminDigestMeta({
  dateKey,
  status,
}: {
  dateKey: string | null;
  status: string;
}) {
  const archived = isPastMoscowDate(dateKey);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-medium">{formatDigestDate(dateKey)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {archived ? <Badge variant="outline">Архив</Badge> : null}
        <AdminStatusBadge status={status} />
      </div>
    </div>
  );
}

export function AdminEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Empty className="min-h-56 rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox aria-hidden="true" /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  );
}

export function AdminErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 p-6 text-center">
      <CircleAlert aria-hidden="true" className="size-7 text-danger" />
      <p className="max-w-[55ch] text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  );
}

export function AdminPagination({
  pathname,
  page,
  pageSize,
  total,
  query,
  search,
  status,
}: {
  pathname: string;
  page: number;
  pageSize: number;
  total: number;
  query?: AdminTableQuery;
  search?: string;
  status?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const previousHref = makeAdminPageHref(pathname, Math.max(1, page - 1), query ?? { search, status, pageSize });
  const nextHref = makeAdminPageHref(pathname, Math.min(pages, page + 1), query ?? { search, status, pageSize });

  return (
    <Pagination className="border-t border-border px-4 py-3">
      <PaginationContent className="w-full max-w-md justify-between">
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={page <= 1}
            className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
            href={page <= 1 ? undefined : previousHref}
            tabIndex={page <= 1 ? -1 : undefined}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink
            className="min-w-28 whitespace-nowrap px-4"
            href={makeAdminPageHref(pathname, page, query ?? { search, status, pageSize })}
            isActive
            size="default"
          >
            {page} из {pages}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            aria-disabled={page >= pages}
            className={page >= pages ? "pointer-events-none opacity-50" : undefined}
            href={page >= pages ? undefined : nextHref}
            tabIndex={page >= pages ? -1 : undefined}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

export function AdminTechnicalValue({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="max-h-64 max-w-full overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5 text-muted-foreground">
      {text || "Нет дополнительных данных"}
    </pre>
  );
}

const statusLabels: Record<string, string> = {
  dismissed: "Закрыто без действий",
  private: "По приглашению",
  suppressed: "Пропущено",
  missing: "Нет данных",
  active: "Активно",
  acknowledged: "Принято",
  action_pending: "Ждёт действия",
  ai_failed: "Ошибка обработки",
  approved: "Проверено",
  archived: "Архив",
  cancelled: "Отменено",
  checking: "Проверяется",
  closed: "Закрыт",
  complete: "Готово",
  completed: "Завершено",
  draft: "Черновик",
  duplicate: "Дубль",
  edited: "Отредактировано",
  failed: "Ошибка",
  fallback: "Резервный текст",
  fixing: "Исправляется",
  generated: "Подготовлено",
  healthy: "В норме",
  hidden: "Скрыто",
  indexed: "Добавлено",
  ignored: "Не требует действий",
  legacy: "Прежний запрос",
  limited: "Ограниченный режим",
  monitoring: "Под наблюдением",
  new: "Новое",
  in_progress: "В работе",
  not_configured: "Не настроено",
  open: "Открыт",
  partial: "Частично готово",
  paused: "На паузе",
  pending: "Ожидает",
  processed: "Обработано",
  processing: "Обработка",
  processing_dedup: "Проверка дублей",
  published: "Опубликовано",
  queued: "В очереди",
  ready: "Готово",
  rejected: "Отклонено",
  removed_from_feed: "Снято с ленты",
  review: "На проверке",
  recommend: "Рекомендации",
  resolved: "Исправлено",
  running: "Выполняется",
  scheduled: "Запланировано",
  shadow: "Наблюдение",
  sending: "Отправляется",
  sent: "Отправлено",
  skipped: "Пропущено",
  stale: "Устарело",
  started: "Начато",
  success: "Готово",
  succeeded: "Готово",
  unavailable: "Недоступно",
  unknown: "Нет данных",
  unique: "Не дубль",
  warning: "Нужна проверка",
};

function isPastMoscowDate(dateKey: string | null) {
  return Boolean(dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey < getMoscowDateKey());
}

function getMoscowDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Moscow",
    year: "numeric",
  }).format(new Date());
}

function formatDigestDate(dateKey: string | null) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "Дата сводки не указана";

  return `Сводка за ${new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(`${dateKey}T12:00:00Z`))}`;
}
