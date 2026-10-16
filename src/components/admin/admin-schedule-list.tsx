"use client";

import { useState } from "react";
import { FilePenLine } from "lucide-react";

import {
  runAdminScheduleNowAction,
  saveAdminScheduleAction,
} from "@/app/admin/operations";
import { AdminConfirmedAction } from "@/components/admin/admin-confirmed-action";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminStatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getAdminJobCopy } from "@/lib/admin-display";
import jobCatalog from "@/config/admin-jobs.json";
import type { AdminJobDefinition, AdminSchedule } from "@/types/admin";

const jobDefinitions = jobCatalog as AdminJobDefinition[];

export function AdminScheduleList({
  schedules,
}: {
  schedules: AdminSchedule[];
}) {
  const legacy = (schedule: AdminSchedule) => jobDefinitions.find(job => job.name === schedule.jobName)?.group === "legacy";
  return (
    <div>
      <div className="divide-y divide-border">{schedules.filter(schedule => !legacy(schedule)).map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} />)}</div>
      <details className="border-t border-border p-4"><summary className="cursor-pointer font-medium">Поддержка прошлых оплат</summary><p className="mt-2 text-xs text-muted-foreground">Сверка заказов ЮMoney и Tribute. Новые оплаты оформляются через Lava.top.</p><div className="mt-3 divide-y divide-border">{schedules.filter(legacy).map(schedule => <ScheduleRow key={schedule.id} schedule={schedule} />)}</div></details>
    </div>
  );
}

function ScheduleRow({ schedule }: { schedule: AdminSchedule }) {
  const copy = getAdminJobCopy(schedule.jobName);
  const definition = jobDefinitions.find(job => job.name === schedule.jobName);

  return (
    <article id={`schedule-${schedule.scheduleKey}`} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_13rem_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{copy.title}</h3>
          <AdminStatusBadge status={schedule.isEnabled ? "scheduled" : "paused"} />
          {schedule.lastRun ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">Последний запуск: <AdminStatusBadge status={schedule.lastRun.status} /></span>
          ) : null}
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>
        {schedule.availability ? <p className="mt-2 text-xs text-muted-foreground">{schedule.availability.detail}</p> : null}
      </div>
      <dl className="grid gap-1 text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>Периодичность</dt>
          <dd className="text-right text-foreground">
            {formatSchedule(schedule)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Следующий запуск</dt>
          <dd className="text-right text-foreground">
            {schedule.isEnabled ? formatDate(schedule.nextRunAt) : "На паузе"}
          </dd>
        </div>
        {schedule.scheduleKind === "adaptive" ? (
          <div className="flex justify-between gap-3">
            <dt>Фоновый режим</dt>
            <dd className="text-right text-foreground">Раз в сутки</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {schedule.availability?.available === false ? null : definition?.danger ? (
          <AdminConfirmedAction action={runAdminScheduleNowAction} confirmLabel="Запустить" description={definition.confirmation ?? definition.description} title={`Запустить «${definition.title}»?`} triggerLabel="Запустить">
            <input name="scheduleId" type="hidden" value={schedule.id} />
          </AdminConfirmedAction>
        ) : (
          <AdminActionForm action={runAdminScheduleNowAction} submitLabel="Запустить" submitVariant="secondary">
            <input name="scheduleId" type="hidden" value={schedule.id} />
          </AdminActionForm>
        )}
        <ScheduleEditor schedule={schedule} />
      </div>
    </article>
  );
}

function ScheduleEditor({ schedule }: { schedule: AdminSchedule }) {
  const adaptiveDefinition = jobDefinitions.find(job => job.name === schedule.jobName)?.adaptiveSchedule;
  const [kind, setKind] = useState<"interval" | "daily">(
    schedule.scheduleKind === "daily" ? "daily" : "interval",
  );

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <FilePenLine data-icon="inline-start" />
          Настроить
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{getAdminJobCopy(schedule.jobName).title}</DialogTitle>
          <DialogDescription>
            {schedule.scheduleKind === "adaptive"
              ? "Частота автоматически меняется по расписанию сессий. Здесь можно поставить проверку на паузу."
              : "Можно изменить время запуска и паузу. Команда и её параметры остаются защищёнными."}
          </DialogDescription>
        </DialogHeader>
        <AdminActionForm
          action={saveAdminScheduleAction}
          submitLabel="Сохранить расписание"
        >
          {(state) => (
            <>
          <input name="scheduleId" type="hidden" value={schedule.id} />
          {schedule.scheduleKind === "adaptive" ? (
            <input name="scheduleKind" type="hidden" value="adaptive" />
          ) : null}
          <FieldGroup>
            {schedule.scheduleKind === "adaptive" ? (
              <Field>
                <FieldLabel>Адаптивный режим</FieldLabel>
                <FieldDescription>
                  {adaptiveDefinition?.activeLabel ?? "Чаще после завершения сессии"}.
                  {" "}
                  {adaptiveDefinition?.idleLabel ?? "В остальное время — раз в сутки"}.
                </FieldDescription>
              </Field>
            ) : (
              <Field data-invalid={Boolean(state.fieldErrors?.intervalMinutes)}>
                <FieldLabel>Режим запуска</FieldLabel>
                <Select
                  defaultValue={schedule.scheduleKind}
                  name="scheduleKind"
                  onValueChange={(value) => setKind(value as "interval" | "daily")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interval">Через равные интервалы</SelectItem>
                    <SelectItem value="daily">Один раз в день</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}

            {schedule.scheduleKind !== "adaptive" && kind === "interval" ? (
              <Field>
                <FieldLabel htmlFor={`${schedule.id}-interval`}>
                  Интервал, минут
                </FieldLabel>
                <Input
                  defaultValue={schedule.intervalMinutes ?? 30}
                  id={`${schedule.id}-interval`}
                  max={10_080}
                  min={2}
                  name="intervalMinutes"
                  aria-invalid={Boolean(state.fieldErrors?.intervalMinutes)}
                  required
                  type="number"
                />
                <FieldDescription>От 2 минут до 7 дней.</FieldDescription>
                <FieldError>{state.fieldErrors?.intervalMinutes?.join(" ")}</FieldError>
              </Field>
            ) : null}

            {schedule.scheduleKind !== "adaptive" && kind === "daily" ? (
              <Field data-invalid={Boolean(state.fieldErrors?.dailyTimeUtc)}>
                <FieldLabel htmlFor={`${schedule.id}-daily`}>
                  Время запуска, UTC
                </FieldLabel>
                <Input
                  defaultValue={(schedule.dailyTimeUtc ?? "12:00").slice(0, 5)}
                  id={`${schedule.id}-daily`}
                  name="dailyTimeUtc"
                  aria-invalid={Boolean(state.fieldErrors?.dailyTimeUtc)}
                  required
                  type="time"
                />
                <FieldDescription>
                  Московское время сейчас отличается от UTC на 3 часа.
                </FieldDescription>
                <FieldError>{state.fieldErrors?.dailyTimeUtc?.join(" ")}</FieldError>
              </Field>
            ) : null}

            <Field orientation="horizontal">
              <Switch
                defaultChecked={schedule.isEnabled}
                id={`${schedule.id}-enabled`}
                name="isEnabled"
              />
              <div>
                <FieldLabel htmlFor={`${schedule.id}-enabled`}>
                  Выполнять автоматически
                </FieldLabel>
                <FieldDescription>
                  Выключи, чтобы временно поставить проверку на паузу.
                </FieldDescription>
              </div>
            </Field>
          </FieldGroup>
            </>
          )}
        </AdminActionForm>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Закрыть</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatSchedule(schedule: AdminSchedule) {
  if (schedule.scheduleKind === "adaptive") {
    return jobDefinitions.find(job => job.name === schedule.jobName)?.adaptiveSchedule?.activeLabel
      ?? "По расписанию сессий";
  }
  if (schedule.scheduleKind === "daily") {
    return `Ежедневно в ${(schedule.dailyTimeUtc ?? "00:00").slice(0, 5)} UTC`;
  }
  if ((schedule.intervalMinutes ?? 0) < 60) {
    return `Каждые ${schedule.intervalMinutes} мин`;
  }
  const hours = (schedule.intervalMinutes ?? 0) / 60;
  return Number.isInteger(hours) ? `Каждые ${hours} ч` : `Каждые ${schedule.intervalMinutes} мин`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
