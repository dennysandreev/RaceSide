"use client";

import Image from "next/image";
import { useState } from "react";
import { Activity, ArrowRight, Radio, Trophy, X } from "lucide-react";

import { IntentLink as Link } from "@/components/racemate/intent-link";
import { RaceSideLogoSvg } from "@/components/racemate/racemate-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { billingPriceCatalog, formatMoney } from "@/lib/billing/catalog";
import type { PlusOfferAudience } from "@/lib/plus-offer-policy";
import { cn } from "@/lib/utils";

type Screen = "live" | "telemetry" | "fantasy";

const screenshots = {
  live: { title: "RaceSide LIVE", alt: "LIVE с таймингом и пилотами на карте трассы", width: 1280, height: 720, extension: "png", icon: Radio },
  telemetry: { title: "Телеметрия", alt: "Телеметрия с графиками и сравнением пилотов", width: 1440, height: 900, extension: "png", icon: Activity },
  fantasy: { title: "Фэнтези-лига", alt: "Фэнтези-лига с прогнозами на квалификацию и гонку", width: 1000, height: 554, extension: "webp", icon: Trophy },
} as const;

const annualPrice = billingPriceCatalog.plus_first_year;
const monthlyFromPrice = formatMoney(annualPrice.amountMinor / annualPrice.durationMonths);

function Screenshot({ screen, sizes }: { screen: Screen; sizes: string }) {
  const screenshot = screenshots[screen];
  return (["dark", "light"] as const).map((theme) => (
    <Image
      alt={screenshot.alt}
      className="plus-theme-image"
      data-theme-image={theme}
      height={screenshot.height}
      key={theme}
      sizes={sizes}
      src={`/plus/${screen}-${theme}${screen === "fantasy" ? "" : "-trajectory-20261005"}.${screenshot.extension}`}
      width={screenshot.width}
    />
  ));
}

export default function PlusOfferDialog({
  audience,
  onDismiss,
}: {
  audience: PlusOfferAudience;
  onDismiss: () => void;
}) {
  const guest = audience === "guest";
  const [selectedScreen, setSelectedScreen] = useState<Screen>("live");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent className="plus-offer-dialog max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[650px]" showCloseButton={false}>
        <header className="plus-offer-brand">
          <span aria-label="RaceSide Plus" className="plus-offer-wordmark" role="img">
            <RaceSideLogoSvg className="plus-offer-logo" plus width={164} />
          </span>
          <DialogClose asChild>
            <Button aria-label="Закрыть предложение" className="ml-auto" size="icon" variant="ghost">
              <X aria-hidden="true" data-icon="inline-start" />
            </Button>
          </DialogClose>
        </header>
        <div className="plus-offer-intro">
          <DialogTitle className="plus-offer-title">
            {guest ? "Ваш сезон Формулы-1" : <>Больше гонки.<br />Меньше догадок.</>}
          </DialogTitle>
          <DialogDescription className="plus-offer-description">
            {guest
              ? "Следите за гонками, разбирайте круги и соревнуйтесь с друзьями."
              : "Следите за гонкой в LIVE и разбирайте каждый круг по данным."}
          </DialogDescription>
        </div>

        {guest ? (
          <>
            <div aria-label="Превью LIVE, телеметрии и фэнтези-лиги" className="plus-offer-gallery" role="group">
              {(["telemetry", "fantasy", "live"] as const).map((screen) => {
                const screenshot = screenshots[screen];
                const Icon = screenshot.icon;
                return (
                  <button
                    aria-label={`Рассмотреть ${screenshot.title}`}
                    aria-pressed={selectedScreen === screen}
                    className={cn("plus-offer-screen", `plus-offer-screen-${screen}`)}
                    key={screen}
                    onClick={() => setSelectedScreen(screen)}
                    type="button"
                  >
                    <span className="plus-offer-screen-bar"><Icon aria-hidden="true" />{screenshot.title}</span>
                    <span className="plus-offer-screen-image">
                      <Screenshot screen={screen} sizes={screen === "live" ? "(max-width: 640px) 72vw, 370px" : "(max-width: 640px) 55vw, 340px"} />
                    </span>
                  </button>
                );
              })}
            </div>
            <ul className="plus-offer-benefits">
              <li><Radio aria-hidden="true" /><span><b>LIVE каждой сессии</b><small>С подпиской Plus</small></span></li>
              <li><Activity aria-hidden="true" /><span><b>Демо телеметрии</b><small>Бесплатно</small></span></li>
              <li><Trophy aria-hidden="true" /><span><b>Фэнтези-лига</b><small>Бесплатно</small></span></li>
            </ul>
            <div className="plus-offer-actions">
              <Button asChild className="plus-offer-primary w-full" size="lg">
                <Link href="/auth?mode=signup&next=%2Ftelemetry" onClick={onDismiss}>Создать аккаунт<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
              </Button>
              <div className="plus-offer-login">Уже есть аккаунт? <Link href="/auth?next=%2Ftelemetry" onClick={onDismiss}>Войти</Link></div>
            </div>
            <footer className="plus-offer-upsell">
              <div><p className="plus-offer-upsell-title">Хотите больше? Откройте Plus</p><p>LIVE, вся телеметрия и Telegram. Без рекламы.</p></div>
              <Link className="plus-offer-price-link" href="/plus" onClick={onDismiss}>от {monthlyFromPrice} в месяц<span>Что входит в Plus</span></Link>
            </footer>
          </>
        ) : (
          <>
            <div aria-label="Примеры интерфейсов LIVE и телеметрии" className="plus-offer-paid-gallery">
              <div className="plus-offer-preview plus-offer-preview-live"><Screenshot screen="live" sizes="(max-width: 640px) 79vw, 400px" /></div>
              <div className="plus-offer-preview plus-offer-preview-telemetry"><Screenshot screen="telemetry" sizes="(max-width: 640px) 90vw, 460px" /></div>
            </div>
            <ul className="plus-offer-paid-benefits">
              <li><Radio aria-hidden="true" /><span><b>Все сессии в LIVE</b><small>Тайминг, трасса и радио</small></span></li>
              <li><Activity aria-hidden="true" /><span><b>Полная телеметрия</b><small>Выбирайте пилотов и круги</small></span></li>
            </ul>
            <footer className="plus-offer-checkout">
              <div className="plus-offer-price"><span>от</span> {monthlyFromPrice} <small>в месяц</small></div>
              <Button asChild className="plus-offer-primary" size="lg">
                <Link href="/plus" onClick={onDismiss}>Открыть RaceSide Plus<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>
              </Button>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
