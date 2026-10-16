import { IntentLink as Link } from "@/components/racemate/intent-link";

import { RaceMateLogo } from "@/components/racemate/racemate-logo";

const primaryFooterLinks = [
  { href: "/plus", label: "RaceSide Plus" },
  { href: "/feedback", label: "Обратная связь" },
  { href: "/contacts", label: "Контакты" },
];

const secondaryFooterLinks = [
  { href: "/legal/disclaimer", label: "Отказ от ответственности" },
  { href: "/legal/terms", label: "Соглашение" },
  { href: "/legal/privacy", label: "Конфиденциальность" },
  { href: "/legal/cookies", label: "Cookies" },
];

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1440px] px-4 pb-6 sm:px-6 lg:px-8 xl:pl-[18rem]">
      <div className="relative overflow-hidden rounded-lg border border-border/75 bg-background/70">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

        <div className="relative flex flex-col gap-3.5 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <Link
            aria-label="RaceSide, на главную"
            className="group flex w-fit shrink-0 items-center"
            href="/"
          >
            <RaceMateLogo size="footer" variant="signature" />
          </Link>

          <nav
            aria-label="Ссылки подвала"
            className="grid gap-2 lg:justify-items-end"
          >
            {[primaryFooterLinks, secondaryFooterLinks].map((links, index) => (
              <div
                className="flex flex-wrap gap-x-4 gap-y-1.5 lg:justify-end"
                key={index === 0 ? "primary" : "secondary"}
              >
                {links.map((link) => (
                  <Link
                    className="whitespace-nowrap rounded-sm text-xs font-normal text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={link.href}
                    key={link.href}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="relative flex flex-col gap-1 border-t border-border/60 bg-background/40 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-[0.68rem] leading-4 text-muted-foreground/85">
            © 2026 RaceSide · Новости, аналитика и статистика мира автоспорта
          </p>
          <p className="text-[0.68rem] leading-4 text-muted-foreground/60">
            Проект не связан с Formula 1, FIA, командами, пилотами или правообладателями
          </p>
        </div>
      </div>
    </footer>
  );
}
