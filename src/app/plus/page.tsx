import Image from "next/image";
import Link from "next/link";
import { Activity, BellRing, Check, Radio, Rocket } from "lucide-react";

import { AppShell } from "@/components/racemate/app-shell";
import {
  PlusCheckout,
  type CheckoutPaymentOption,
} from "@/components/racemate/plus-checkout";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import {
  billingFlags,
  getLavaConfig,
} from "@/lib/billing/config";
import { getInternationalPrices, getPendingUserOrder, getUserActiveLavaSubscription } from "@/lib/billing/repository";
import type { BillingPriceCode } from "@/lib/billing/types";
import { createPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata = createPageMetadata({
  title: "RaceSide Plus",
  description:
    "LIVE гонки, полная телеметрия и Telegram-уведомления без рекламы.",
  path: "/plus",
});

export default async function PlusPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string; plan?: string }>;
}) {
  const [{ payment, plan }, user] = await Promise.all([
    searchParams,
    getSessionUser(),
  ]);
  const [access, recurringSubscription, pendingOrder, internationalPrices] = await Promise.all([
    getSubscriptionAccess(user?.id ?? null),
    user ? getUserActiveLavaSubscription(user.id) : null,
    user ? getPendingUserOrder(user.id) : null,
    getInternationalPrices(),
  ]);
  const lavaAvailable = billingFlags.checkout && billingFlags.lava && Boolean(getLavaConfig());

  return (
    <AppShell immersive>
      <section className="relative overflow-hidden rounded-xl border border-border bg-background px-3 py-3 text-foreground sm:px-6 sm:py-5 lg:px-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_14%_0%,rgb(225_6_0_/_0.14),transparent_48%),radial-gradient(circle_at_90%_0%,rgb(0_210_190_/_0.08),transparent_42%)] dark:bg-[radial-gradient(circle_at_14%_0%,rgb(225_6_0_/_0.24),transparent_48%),radial-gradient(circle_at_90%_0%,rgb(0_210_190_/_0.10),transparent_42%)]"
        />

        <div className="relative grid items-center gap-2 sm:gap-4 lg:grid-cols-[0.7fr_1.3fr] lg:gap-6">
          <div className="max-w-lg">
            <p className="font-telemetry text-[0.6rem] font-bold uppercase tracking-[0.18em] text-primary sm:text-[0.68rem]">
              RaceSide Plus
            </p>
            <h1 className="mt-1 text-balance font-display text-[2.1rem] font-black leading-[0.92] tracking-[-0.04em] sm:mt-2 sm:text-5xl lg:text-[3.4rem]">
              Всё о Формуле-1.
              <br />
              <span className="text-primary">В одном месте.</span>
            </h1>
            <p className="mt-2 max-w-md text-pretty text-xs leading-5 text-muted-foreground sm:mt-3 sm:text-base sm:leading-6">
              LIVE-данные Гран-при, аналитика телеметрии и индивидуальные
              Telegram-уведомления. Без рекламы.
            </p>
          </div>

          <ProductPreview />
        </div>

        <div className="relative mt-4 pt-4 sm:mt-5 sm:pt-5 lg:mt-6 lg:pt-5">
          <div className="w-full">
            <div className="grid grid-cols-2 border-y border-border lg:grid-cols-4">
              <Feature icon={Radio} title="LIVE Гран-при">
                Машины, тайминг, трасса и радио
              </Feature>
              <Feature icon={Activity} title="Вся телеметрия">
                Аналитика прошедших сессий
              </Feature>
              <Feature icon={BellRing} title="Telegram">
                Важное по выбранным событиям
              </Feature>
              <Feature icon={Rocket} title="Больше возможностей">
                Ранний доступ к новым функциям
              </Feature>
            </div>

            <div className="mb-2 mt-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="font-telemetry text-sm font-black uppercase tracking-[0.02em] sm:text-base">
                  Оформите RaceSide Plus
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Выберите удобный вариант оплаты и срок действия подписки
                </p>
              </div>
              {access.active ? (
                <p className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  <Check aria-hidden="true" className="size-4 text-success" />
                  Plus активен. Новый срок добавится к текущему.
                </p>
              ) : (
                <p className="hidden font-telemetry text-[0.62rem] font-bold uppercase tracking-[0.08em] text-muted-foreground sm:block">
                  Карты продлеваются автоматически
                </p>
              )}
            </div>

            <PlusCheckout
              activeSubscription={access.active}
              recurringSubscription={Boolean(recurringSubscription)}
              initialPaymentOption={parsePaymentOption(payment)}
              initialPriceCode={parsePriceCode(plan)}
              signedIn={Boolean(user)}
              pendingOrder={pendingOrder ? { orderNumber: pendingOrder.orderNumber } : null}
              lava={lavaAvailable}
              internationalPrices={internationalPrices}
              accountEmail={user?.email ?? null}
            />
            {access.active ? (
              <Button asChild className="mt-2" size="sm" variant="secondary">
                <Link href="/account/subscription">История и срок доступа</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function ProductPreview() {
  return (
    <div className="group/preview relative mx-auto w-full max-w-[14rem] pb-[12%] [perspective:1200px] sm:max-w-xl sm:pb-[15%] lg:max-w-[35rem]">
      <div className="relative overflow-hidden rounded-lg border border-border bg-[#111] transition-transform duration-500 ease-out [transform-origin:35%_50%] will-change-transform group-hover/preview:-translate-x-1.5 group-hover/preview:rotate-[-0.7deg] group-hover/preview:scale-[0.99] motion-reduce:transform-none motion-reduce:transition-none">
        <Image
          alt="LIVE-экран RaceSide с машинами на трассе, полным таймингом и событиями гонки"
          className="plus-theme-image h-auto w-full"
          data-theme-image="dark"
          height={720}
          priority
          sizes="(min-width: 1280px) 35rem, (min-width: 1024px) 46vw, (min-width: 640px) 36rem, 17rem"
          src="/plus/live-dark-trajectory-20261005.png"
          width={1280}
        />
        <Image
          alt="LIVE-экран RaceSide с машинами на трассе, полным таймингом и событиями гонки"
          className="plus-theme-image h-auto w-full"
          data-theme-image="light"
          height={720}
          priority
          sizes="(min-width: 1280px) 35rem, (min-width: 1024px) 46vw, (min-width: 640px) 36rem, 17rem"
          src="/plus/live-light-trajectory-20261005.png"
          width={1280}
        />
      </div>
      <div className="absolute -right-[4%] bottom-0 w-[66%] overflow-hidden rounded-lg shadow-[0_10px_30px_rgb(225_6_0_/_0.24)] transition-[transform,box-shadow] duration-500 ease-out [transform-origin:80%_80%] will-change-transform group-hover/preview:-translate-y-2 group-hover/preview:translate-x-2 group-hover/preview:rotate-[1deg] group-hover/preview:scale-[1.035] group-hover/preview:shadow-[0_16px_42px_rgb(225_6_0_/_0.36)] motion-reduce:transform-none motion-reduce:transition-none">
        <Image
          alt="Экран телеметрии RaceSide со сравнением двух пилотов"
          className="plus-theme-image h-auto w-full"
          data-theme-image="dark"
          height={900}
          sizes="(min-width: 1280px) 18rem, (min-width: 1024px) 27vw, 58vw"
          src="/plus/telemetry-dark-trajectory-20261005.png"
          width={1440}
        />
        <Image
          alt="Экран телеметрии RaceSide со сравнением двух пилотов"
          className="plus-theme-image h-auto w-full"
          data-theme-image="light"
          height={900}
          sizes="(min-width: 1280px) 18rem, (min-width: 1024px) 27vw, 58vw"
          src="/plus/telemetry-light-trajectory-20261005.png"
          width={1440}
        />
      </div>
    </div>
  );
}

function Feature({
  children,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  icon: typeof Radio;
  title: string;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-center gap-2 border-b border-r border-border px-2 py-2 even:border-r-0 sm:min-h-0 sm:items-start sm:px-3 sm:py-2.5 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 text-primary"
      />
      <div className="min-w-0">
        <h2 className="font-display text-xs font-bold sm:text-sm">{title}</h2>
        <p className="mt-0.5 hidden text-xs leading-5 text-muted-foreground sm:block">
          {children}
        </p>
      </div>
    </div>
  );
}

function parsePriceCode(value?: string): BillingPriceCode | undefined {
  if (value === "plus_monthly" || value === "plus_first_year") return value;
  return undefined;
}

function parsePaymentOption(value?: string): CheckoutPaymentOption | undefined {
  if (
    value === "russian_card" ||
    value === "international_card"
  ) {
    return value;
  }
  return undefined;
}
