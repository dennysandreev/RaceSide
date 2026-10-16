import Link from "next/link";
import { Clock3, Settings2 } from "lucide-react";

import {
  AdminMetric,
  AdminPage,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { loadAdminSystems } from "@/data/admin-repository";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AdminSystemStatus } from "@/types/admin";

export default async function AdminSystemsPage() {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const data = await loadAdminSystems(admin);
  const groups = groupSystems(data.items);

  return (
    <AdminPage>
      <AdminPageHeader
        actions={(
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/schedules">
              <Clock3 data-icon="inline-start" />
              Открыть расписания
            </Link>
          </Button>
        )}
        description="Состояние продуктовых сервисов, внешних API, источников и фоновых проверок. Время показано по последней реальной загрузке или запуску."
        title="Состояние систем"
      />
      <section className="grid grid-cols-2 gap-y-5 border-b border-border pb-5 lg:grid-cols-4">
        <AdminMetric label="В норме" tone="success" value={String(data.metrics.healthy)} />
        <AdminMetric label="Нужна проверка" tone={data.metrics.attention ? "warning" : "default"} value={String(data.metrics.attention)} />
        <AdminMetric label="Ошибки" tone={data.metrics.failed ? "danger" : "default"} value={String(data.metrics.failed)} />
        <AdminMetric label="На паузе" value={String(data.metrics.paused)} />
      </section>

      {[...groups.entries()].map(([group, items]) => (
        <AdminSection
          description={getGroupDescription(group)}
          key={group}
          title={group}
        >
          <div className="divide-y divide-border">
            {items.map((item) => (
              <SystemRow item={item} key={item.id} />
            ))}
          </div>
        </AdminSection>
      ))}
    </AdminPage>
  );
}

function SystemRow({ item }: { item: AdminSystemStatus }) {
  return (
    <article
      className="scroll-mt-20 grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_15rem_auto] lg:items-center"
      id={item.id.replace(":", "-")}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{item.label}</h3>
          <AdminStatusBadge status={item.isEnabled ? item.status : "paused"} />
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {item.description}
        </p>
        <p className="mt-2 text-xs leading-5 text-foreground">{item.detail}</p>
      </div>
      <dl className="grid gap-2 text-xs">
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Последняя проверка</dt>
          <dd>{formatDate(item.checkedAt)}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-muted-foreground">Следующая проверка</dt>
          <dd>{item.isEnabled ? formatDate(item.nextCheckAt) : "После включения"}</dd>
        </div>
      </dl>
      <Button asChild size="sm" variant="ghost">
        <Link href={item.href ?? (item.kind === "schedule" ? "/admin/schedules" : getSourceHref(item.group))}>
          <Settings2 data-icon="inline-start" />
          {item.kind === "schedule" ? "Настроить" : item.kind === "source" ? "Открыть источник" : "Открыть"}
        </Link>
      </Button>
    </article>
  );
}

function groupSystems(items: AdminSystemStatus[]) {
  const groups = new Map<string, AdminSystemStatus[]>();

  for (const item of items) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }

  return groups;
}

function getGroupDescription(group: string) {
  const descriptions: Record<string, string> = {
    OpenF1: "Сессии, классификации и доступные данные недавних заездов.",
    Jolpica: "Календарь, результаты и положение в чемпионате.",
    OpenRouter: "Подготовка новостей, сводок и других AI-материалов.",
    "RSS и новости": "Получение материалов из подключённых новостных лент.",
    "Социальные источники": "X, Reddit, Telegram и обработка новых публикаций.",
    Telegram: "Сборка и доставка уведомлений пользователям.",
    Погода: "Прогноз для ближайшего гоночного уик-энда.",
    "Внутренние процессы": "Расчёты RaceSide, отчёты и служебные обновления.",
    "Продуктовые сервисы": "LIVE-центр и телеметрия, доступные пользователям RaceSide.",
  };
  return descriptions[group] ?? "Подключённые данные и плановые проверки.";
}

function getSourceHref(group: string) {
  return group === "RSS и новости" ? "/admin/news?tab=sources#sources" : "/admin/social?tab=sources#sources";
}

function formatDate(value: string | null) {
  if (!value) return "Пока нет данных";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
