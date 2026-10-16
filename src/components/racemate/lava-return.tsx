import Link from "next/link";
import { CheckCircle2, Clock3, CircleX } from "lucide-react";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/racemate/app-shell";
import { PaymentStatusPoller } from "@/components/racemate/payment-status-poller";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getUserLavaOrderByInvoice } from "@/lib/billing/repository";

export async function LavaReturn({ invoiceId, result }: { invoiceId?: string; result: "success" | "failed" | "cancelled" }) {
  const user = await requireUser();
  if (!invoiceId || !/^[a-f0-9-]{36}$/i.test(invoiceId)) notFound();
  const order = await getUserLavaOrderByInvoice(user.id, invoiceId.toLowerCase());
  if (!order) notFound();
  const paid = order.status === "paid";
  const pending = order.status === "pending";
  const checking = pending && result === "success";
  const title = paid ? "Оплата прошла успешно" : checking ? "Проверяем оплату…" : "Оплата не завершена";
  const description = paid ? "RaceSide Plus уже доступен." : checking ? "Ждём подтверждения от платёжного сервиса. Обычно это занимает несколько секунд." : pending ? "Подтверждения оплаты пока нет. Вы можете проверить статус или вернуться к подписке." : "Доступ пока не изменился. Можно вернуться и попробовать ещё раз.";
  const Icon = paid ? CheckCircle2 : pending ? Clock3 : CircleX;
  return <AppShell hideAds>
    {pending ? <PaymentStatusPoller /> : null}
    <section className="mx-auto grid min-h-[65vh] max-w-2xl place-items-center">
      <div className="stitch-panel w-full p-7 text-center sm:p-10">
        <Icon aria-hidden="true" className={`mx-auto size-12 ${paid ? "text-success" : pending ? "text-primary" : "text-muted-foreground"}`} />
        <h1 className="mt-5 font-display text-3xl font-black">{title}</h1>
        <p className="mx-auto mt-3 max-w-lg leading-7 text-muted-foreground">{description}</p>
        <Button asChild className="mt-7"><Link href={paid ? "/account/subscription" : pending ? `/payment/confirmation/${order.orderNumber}` : "/plus#checkout"}>{paid ? "Открыть подписку" : pending ? "Проверить статус" : "Попробовать снова"}</Link></Button>
      </div>
    </section>
  </AppShell>;
}
