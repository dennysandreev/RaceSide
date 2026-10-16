import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { AppShell } from "@/components/racemate/app-shell";
import { Button } from "@/components/ui/button";

export function SubscriptionGate({
  description,
  signedIn,
  title,
}: {
  description: string;
  signedIn: boolean;
  title: string;
}) {
  return <AppShell hideAds><SubscriptionGateContent description={description} signedIn={signedIn} title={title} /></AppShell>;
}

export function SubscriptionGateContent({ description, signedIn, title }: { description: string; signedIn: boolean; title: string }) {
  return <section className="mx-auto grid min-h-[68vh] w-full max-w-3xl place-items-center py-8"><div className="stitch-panel relative w-full overflow-hidden p-7 text-center sm:p-12"><div aria-hidden className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgb(225_6_0_/.22),transparent_70%)]" /><LockKeyhole className="relative mx-auto mt-5 size-12 rounded-full bg-primary/12 p-3 text-primary" /><p className="font-telemetry relative mt-5 text-xs font-bold uppercase tracking-[0.15em] text-primary">RaceSide Plus</p><h1 className="relative mt-3 font-display text-4xl font-black tracking-[-0.035em]">{title}</h1><p className="relative mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">{description}</p><Button asChild className="relative mt-7"><Link href={signedIn ? "/plus#checkout" : "/auth?returnUrl=%2Fplus%23checkout"}>{signedIn ? "Выбрать подписку" : "Войти и продолжить"}</Link></Button><p className="relative mt-4 text-xs text-muted-foreground">390 ₽ в месяц · 3 900 ₽ в год · карты продлеваются автоматически</p></div></section>;
}
