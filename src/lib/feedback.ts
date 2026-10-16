export const FEEDBACK_MESSAGE_MIN_LENGTH = 10;
export const FEEDBACK_MESSAGE_MAX_LENGTH = 2_000;
export const FEEDBACK_CONTACT_MAX_LENGTH = 160;

export type FeedbackState = {
  ok: boolean;
  message: string;
  field?: "message" | "contact";
  retryKey: number;
};

export function validateFeedback(messageValue: unknown, contactValue: unknown) {
  const message = typeof messageValue === "string" ? messageValue.trim() : "";
  const contact = typeof contactValue === "string" ? contactValue.trim() : "";

  if (message.length < FEEDBACK_MESSAGE_MIN_LENGTH || message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return { ok: false as const, field: "message" as const, error: "Расскажи чуть подробнее, от 10 до 2000 символов." };
  }
  if (contact.length > FEEDBACK_CONTACT_MAX_LENGTH || /[\r\n\u0000-\u001f]/.test(contact)) {
    return { ok: false as const, field: "contact" as const, error: "Оставь email или имя в Telegram, до 160 символов." };
  }
  return { ok: true as const, message, contact: contact || null };
}
