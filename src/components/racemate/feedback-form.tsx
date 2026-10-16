"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Check, Send } from "lucide-react";

import { submitFeedbackAction } from "@/app/feedback/actions";
import { TurnstileWidget } from "@/components/racemate/turnstile-widget";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FEEDBACK_CONTACT_MAX_LENGTH,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_MESSAGE_MIN_LENGTH,
  type FeedbackState,
} from "@/lib/feedback";

const initialState: FeedbackState = { ok: false, message: "", retryKey: 0 };

export function FeedbackForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, formAction, pending] = useActionState(submitFeedbackAction, initialState);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");

  if (state.ok) {
    return (
      <div className="grid gap-5">
        <Alert role="status">
          <Check aria-hidden="true" />
          <AlertTitle>Сообщение отправлено</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <Button asChild className="w-fit" variant="secondary">
          <Link href="/">На главную</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} aria-busy={pending}>
      <FieldGroup>
        <Field data-disabled={pending} data-invalid={state.field === "message" || undefined}>
          <FieldLabel htmlFor="feedback-message">Сообщение</FieldLabel>
          <Textarea
            aria-describedby="feedback-message-hint feedback-error"
            aria-invalid={state.field === "message" || undefined}
            className="min-h-40"
            disabled={pending}
            id="feedback-message"
            maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
            minLength={FEEDBACK_MESSAGE_MIN_LENGTH}
            name="message"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Например, на странице гонки не загружается расписание"
            required
            rows={7}
            value={message}
          />
          <FieldDescription className="flex flex-wrap justify-between gap-2 text-xs leading-5" id="feedback-message-hint">
            <span>Если заметил ошибку, добавь ссылку на страницу.</span>
            <span className="tabular-nums">{message.length} / {FEEDBACK_MESSAGE_MAX_LENGTH}</span>
          </FieldDescription>
        </Field>
        <Field data-disabled={pending} data-invalid={state.field === "contact" || undefined}>
          <FieldLabel htmlFor="feedback-contact">Как с тобой связаться?</FieldLabel>
          <Input
            aria-describedby="feedback-contact-hint feedback-error"
            aria-invalid={state.field === "contact" || undefined}
            autoComplete="off"
            disabled={pending}
            id="feedback-contact"
            maxLength={FEEDBACK_CONTACT_MAX_LENGTH}
            name="contact"
            onChange={(event) => setContact(event.target.value)}
            placeholder="Email или @имя в Telegram"
            value={contact}
          />
          <FieldDescription className="text-xs leading-5" id="feedback-contact-hint">Необязательно</FieldDescription>
        </Field>
        {turnstileSiteKey ? <TurnstileWidget key={state.retryKey} siteKey={turnstileSiteKey} /> : null}
        <p aria-live="polite" className="empty:hidden text-sm text-danger" id="feedback-error">{state.message}</p>
        <Field>
          <Button className="w-full sm:w-fit" disabled={pending} type="submit">
            <Send aria-hidden="true" data-icon="inline-start" />
            {pending ? "Отправляется…" : "Отправить сообщение"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  );
}
