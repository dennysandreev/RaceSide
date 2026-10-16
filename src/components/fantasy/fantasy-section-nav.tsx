import {
  Crosshair,
  LayoutDashboard,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FantasySection = "overview" | "prediction" | "leagues" | "leaderboard";

const sections = [
  { id: "overview", href: "/fantasy", icon: LayoutDashboard, label: "Обзор" },
  { id: "prediction", href: "/fantasy/prediction", icon: Crosshair, label: "Прогноз" },
  { id: "leagues", href: "/fantasy/leagues", icon: Users, label: "Лиги" },
  { id: "leaderboard", href: "/fantasy/leaderboard", icon: Trophy, label: "Рейтинг" },
] as const;

export function FantasySectionNav({
  active,
  integrated = false,
}: {
  active: FantasySection;
  integrated?: boolean;
}) {
  return (
    <nav
      aria-label="Разделы фентази-лиги"
      className={cn(
        "fantasy-section-nav grid grid-cols-4 gap-px overflow-hidden bg-border/60",
        integrated
          ? "rounded-none border-0 border-b border-border/70"
          : "rounded-xl border border-border/70 p-px",
      )}
    >
      {sections.map((section, index) => {
        const selected = section.id === active;
        const Icon = section.icon;

        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={cn(
              "group relative flex min-h-[3.75rem] min-w-0 flex-col items-center justify-center gap-1.5 bg-card/90 px-1.5 font-display text-[0.7rem] font-bold transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-transparent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-16 sm:flex-row sm:justify-start sm:gap-3 sm:px-4 sm:text-sm",
              selected
                ? "bg-background text-foreground after:bg-primary"
                : "text-muted-foreground hover:bg-accent/45 hover:text-foreground",
            )}
            href={section.href}
            key={section.id}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/30 transition-colors sm:size-8",
                selected
                  ? "border-primary/55 bg-primary text-primary-foreground"
                  : "group-hover:border-primary/35 group-hover:text-primary",
              )}
            >
              <Icon aria-hidden="true" className="size-3.5 sm:size-4" />
            </span>
            <span className="truncate">{section.label}</span>
            <span
              aria-hidden="true"
              className={cn(
                "ml-auto hidden font-telemetry text-[0.58rem] font-bold tracking-[0.08em] lg:inline",
                selected ? "text-primary" : "text-muted-foreground/65",
              )}
            >
              0{index + 1}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function FantasySectionHeader({
  active,
  children,
  className,
}: {
  active: FantasySection;
  children: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("relative rounded-xl border border-border/70 bg-card/75", className)}>
      <div className="overflow-hidden rounded-t-[calc(var(--radius-xl)-1px)]">
        <FantasySectionNav active={active} integrated />
      </div>
      <div className="relative px-4 py-4 sm:px-6 sm:py-5">{children}</div>
    </header>
  );
}
