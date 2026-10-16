"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useState } from "react";
import { FilePenLine, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { saveAiPromptVersionAction } from "@/app/admin/operations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdminActionResult,
  AdminAiPromptItem,
  AdminOpenRouterModel,
  AdminAiPromptVersion,
} from "@/types/admin";

const initialState: AdminActionResult = { ok: false, message: "" };

export function AdminAiPromptRegistry({
  items,
  models,
}: {
  items: AdminAiPromptItem[];
  models: AdminOpenRouterModel[];
}) {
  return (
    <div className="divide-y divide-border">
      {items.map((item) => (
        <PromptRow item={item} key={item.definition.key} models={models} />
      ))}
    </div>
  );
}

function PromptRow({
  item,
  models,
}: {
  item: AdminAiPromptItem;
  models: AdminOpenRouterModel[];
}) {
  const [open, setOpen] = useState(false);
  const [editorSession, setEditorSession] = useState(0);
  const activeVersion = item.latestDraft ?? item.published;

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) setEditorSession((current) => current + 1);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <div className="flex flex-col gap-4 px-4 py-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{item.definition.title}</h3>
            <Badge variant="outline">{item.definition.area}</Badge>
            {item.published ? (
              <Badge variant="success">Опубликована версия {item.published.version}</Badge>
            ) : (
              <Badge variant="secondary">Стандартный текст</Badge>
            )}
            {item.latestDraft ? (
              <Badge variant="warning">Есть черновик {item.latestDraft.version}</Badge>
            ) : null}
          </div>
          <p className="mt-2 max-w-[75ch] text-sm leading-6 text-muted-foreground">
            {item.definition.description}
          </p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="flex gap-2">
              <dt>Используется:</dt>
              <dd>{item.definition.usedBy.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Модель:</dt>
              <dd className="font-mono">
                {item.definition.modelFallback}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>Лимит ответа:</dt>
              <dd className="font-mono tabular-nums">
                {Math.min(activeVersion?.maxTokens ?? item.definition.maxTokens, item.definition.maxTokens)} токенов
              </dd>
            </div>
          </dl>
        </div>
        <DialogTrigger asChild>
          <Button className="shrink-0" size="sm" variant="outline">
            <FilePenLine data-icon="inline-start" />
            Править
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-5xl">
        <PromptEditorForm
          activeVersion={activeVersion}
          item={item}
          models={models}
          key={`${item.definition.key}-${editorSession}`}
          onPublished={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PromptEditorForm({
  activeVersion,
  item,
  models,
  onPublished,
}: {
  activeVersion: AdminAiPromptVersion | null;
  item: AdminAiPromptItem;
  models: AdminOpenRouterModel[];
  onPublished: () => void;
}) {
  const formId = useId();
  const [systemPrompt, setSystemPrompt] = useState(
    activeVersion?.systemPrompt ?? item.definition.defaultSystemPrompt,
  );
  const [userTemplate, setUserTemplate] = useState(
    activeVersion?.userTemplate ?? item.definition.defaultUserTemplate,
  );
  const model = item.definition.modelFallback;
  const [maxTokens, setMaxTokens] = useState(
    Math.min(activeVersion?.maxTokens ?? item.definition.maxTokens, item.definition.maxTokens),
  );
  const [state, formAction, pending] = useActionState(
    saveAiPromptVersionAction,
    initialState,
  );

  useEffect(() => {
    if (!state.ok || !state.message) return;
    toast.success(state.message);
    if (isPublishedResult(state.data)) onPublished();
  }, [onPublished, state]);

  function restoreDefault() {
    setSystemPrompt(item.definition.defaultSystemPrompt);
    setUserTemplate(item.definition.defaultUserTemplate);
    setMaxTokens(item.definition.maxTokens);
  }

  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <DialogTitle>{item.definition.title}</DialogTitle>
          {activeVersion ? (
            <Badge variant={activeVersion.status === "draft" ? "warning" : "success"}>
              Версия {activeVersion.version}
            </Badge>
          ) : (
            <Badge variant="secondary">Стандартный текст</Badge>
          )}
        </div>
        <DialogDescription>
          Изменения применяются только после публикации новой версии. Уже запущенные
          обработки продолжат работу со своим текстом.
        </DialogDescription>
      </DialogHeader>

      <form action={formAction} id={formId}>
        <input name="promptKey" type="hidden" value={item.definition.key} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <FieldGroup>
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_12rem]">
              <Field data-invalid={Boolean(state.fieldErrors?.model)}>
                <FieldLabel htmlFor={`${formId}-model`}>Модель OpenRouter</FieldLabel>
                <Input
                  aria-invalid={Boolean(state.fieldErrors?.model)}
                  autoComplete="off"
                  id={`${formId}-model`}
                  maxLength={160}
                  name="model"
                  readOnly
                  required
                  value={model}
                />
                <FieldDescription>
                  Одна модель для всех текстовых задач.
                </FieldDescription>
                <FieldError>{state.fieldErrors?.model?.join(" ")}</FieldError>
              </Field>

              <Field data-invalid={Boolean(state.fieldErrors?.maxTokens)}>
                <FieldLabel htmlFor={`${formId}-max-tokens`}>
                  Лимит ответа
                </FieldLabel>
                <Input
                  aria-invalid={Boolean(state.fieldErrors?.maxTokens)}
                  id={`${formId}-max-tokens`}
                  max={item.definition.maxTokens}
                  min={16}
                  name="maxTokens"
                  onChange={(event) => setMaxTokens(Number(event.target.value))}
                  required
                  step={1}
                  type="number"
                  value={maxTokens}
                />
                <FieldDescription>Токены только для ответа AI.</FieldDescription>
                <FieldError>{state.fieldErrors?.maxTokens?.join(" ")}</FieldError>
              </Field>
            </div>

            {getSelectedModel(models, model) ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {formatModelDetails(getSelectedModel(models, model)!)}
              </p>
            ) : models.length ? (
              <p className="text-xs leading-5 text-warning">
                Каталог OpenRouter пока не подтвердил доступность модели.
              </p>
            ) : (
              <p className="text-xs leading-5 text-warning">
                Каталог OpenRouter временно недоступен. Текущую модель можно
                сохранить без изменений.
              </p>
            )}

            <Field data-invalid={Boolean(state.fieldErrors?.systemPrompt)}>
              <FieldLabel htmlFor={`${formId}-system`}>Инструкция для AI</FieldLabel>
              <Textarea
                aria-invalid={Boolean(state.fieldErrors?.systemPrompt)}
                className="min-h-52 font-mono text-xs leading-5"
                id={`${formId}-system`}
                maxLength={20_000}
                name="systemPrompt"
                onChange={(event) => setSystemPrompt(event.target.value)}
                required
                value={systemPrompt}
              />
              <FieldDescription>
                Роль, редакционные правила и критерии качества. Формат ответа защищён
                отдельно.
              </FieldDescription>
              <FieldError>
                {state.fieldErrors?.systemPrompt?.join(" ")}
              </FieldError>
            </Field>

            <Field data-invalid={Boolean(state.fieldErrors?.userTemplate)}>
              <FieldLabel htmlFor={`${formId}-user`}>Шаблон задачи</FieldLabel>
              <Textarea
                aria-invalid={Boolean(state.fieldErrors?.userTemplate)}
                className="min-h-64 font-mono text-xs leading-5"
                id={`${formId}-user`}
                maxLength={30_000}
                name="userTemplate"
                onChange={(event) => setUserTemplate(event.target.value)}
                required
                value={userTemplate}
              />
              <FieldDescription>
                Все переменные должны остаться в двойных фигурных скобках.
              </FieldDescription>
              <FieldError>
                {state.fieldErrors?.userTemplate?.join(" ")}
              </FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor={`${formId}-note`}>Что изменилось</FieldLabel>
              <Input
                id={`${formId}-note`}
                maxLength={500}
                name="changeNote"
                placeholder="Например: точнее отделяем слухи от подтверждений"
              />
              <FieldDescription>
                Короткая заметка появится в истории версий.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <aside className="flex min-w-0 flex-col gap-5">
            <section>
              <h4 className="text-sm font-medium">Доступные переменные</h4>
              <div className="mt-3 flex flex-col gap-2">
                {item.definition.variables.map((variable) => (
                  <div className="grid gap-1" key={variable.name}>
                    <code className="overflow-x-auto rounded-sm bg-muted px-2 py-1 font-mono text-xs">
                      {"{{"}{variable.name}{"}}"}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {variable.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section>
              <h4 className="text-sm font-medium">Последние версии</h4>
              <div className="mt-3 flex flex-col gap-3">
                <Link className="text-xs font-medium text-primary" href={`/admin/ai?tab=history&promptKey=${encodeURIComponent(item.definition.key)}`}>Открыть всю историю</Link>
                {item.history.length ? item.history.map((version) => (
                  <div className="grid gap-1 text-xs" key={version.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">Версия {version.version}</span>
                      <span className="text-muted-foreground">
                        {getVersionStatusLabel(version.status)}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {formatDate(version.publishedAt ?? version.createdAt)}
                    </span>
                    <span className="break-all font-mono text-muted-foreground">
                      {version.model ?? item.definition.modelFallback} ·{" "}
                      {version.maxTokens ?? item.definition.maxTokens} токенов
                    </span>
                    {version.changeNote ? (
                      <p className="leading-5 text-muted-foreground">
                        {version.changeNote}
                      </p>
                    ) : null}
                  </div>
                )) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    Пока используется стандартный текст из каталога RaceSide.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </form>

      <Alert>
        <AlertTitle>Защищённый формат ответа</AlertTitle>
        <AlertDescription>
          <p>
            Эта часть всегда добавляется фоновой обработкой и недоступна для изменения,
            чтобы новости, отчёты и опросы не ломались из-за неверного JSON.
          </p>
          <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-3 font-mono text-xs leading-5 text-foreground">
            {item.definition.protectedInstruction}
          </pre>
        </AlertDescription>
      </Alert>

      {state.message && !state.ok ? (
        <p aria-live="polite" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <DialogFooter className="items-center sm:justify-between">
        <Button onClick={restoreDefault} type="button" variant="ghost">
          <RotateCcw data-icon="inline-start" />
          Вернуть стандартные настройки
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose asChild>
            <Button type="button" variant="outline">Закрыть</Button>
          </DialogClose>
          <DraftButton formId={formId} pending={pending} />
          <PublishPromptDialog
            formId={formId}
            pending={pending}
            title={item.definition.title}
          />
        </div>
      </DialogFooter>
    </>
  );
}

function DraftButton({
  formId,
  pending,
}: {
  formId: string;
  pending: boolean;
}) {
  return (
    <Button
      disabled={pending}
      form={formId}
      name="intent"
      type="submit"
      value="draft"
      variant="secondary"
    >
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
      {pending ? "Сохраняется…" : "Сохранить черновик"}
    </Button>
  );
}

function PublishPromptDialog({
  formId,
  pending,
  title,
}: {
  formId: string;
  pending: boolean;
  title: string;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={pending} type="button">Опубликовать версию</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Опубликовать новую инструкцию?</AlertDialogTitle>
          <AlertDialogDescription>
            «{title}» начнёт использовать новый текст в следующих обработках.
            Текущая опубликованная версия останется в истории.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            form={formId}
            name="intent"
            type="submit"
            value="publish"
          >
            Опубликовать
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function isPublishedResult(data: unknown) {
  return Boolean(
    data &&
    typeof data === "object" &&
    "published" in data &&
    data.published === true,
  );
}

function getVersionStatusLabel(status: "draft" | "published" | "archived") {
  if (status === "published") return "Опубликована";
  if (status === "archived") return "В архиве";
  return "Черновик";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function getSelectedModel(models: AdminOpenRouterModel[], modelId: string) {
  return models.find((model) => model.id === modelId) ?? null;
}

function formatModelDetails(model: AdminOpenRouterModel) {
  const details = [];

  if (model.contextLength) {
    details.push(
      `контекст ${new Intl.NumberFormat("ru-RU").format(model.contextLength)}`,
    );
  }
  if (model.maxCompletionTokens) {
    details.push(
      `ответ до ${new Intl.NumberFormat("ru-RU").format(model.maxCompletionTokens)} токенов`,
    );
  }
  if (
    model.promptPricePerMillion !== null &&
    model.completionPricePerMillion !== null
  ) {
    details.push(
      `$${model.promptPricePerMillion.toFixed(2)} / $${model.completionPricePerMillion.toFixed(2)} за 1 млн токенов`,
    );
  }

  return `${model.name}${details.length ? ` · ${details.join(" · ")}` : ""}`;
}
