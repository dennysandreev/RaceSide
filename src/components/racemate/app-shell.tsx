import { telemetryFlags } from "@/features/telemetry/lib/flags";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AdSlot } from "@/components/racemate/ad-slot";

import { IntentLink as Link } from "@/components/racemate/intent-link";
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  CarFront,
  ChevronRight,
  Flag,
  Menu,
  Newspaper,
  Radio,
  Trophy,
  Users,
  UserRound,
} from "lucide-react";

import { ActiveNavigationLink } from "@/components/racemate/active-navigation-link";
import { MobileAutoHideHeader } from "@/components/racemate/mobile-auto-hide-header";
import { PlusOffer } from "@/components/racemate/plus-offer";
import {
  RaceMateLogo,
  RaceMateMark,
} from "@/components/racemate/racemate-logo";
import { SidebarNextSession } from "@/components/racemate/sidebar-next-session";
import { SiteFooter } from "@/components/racemate/site-footer";
import { ThemeToggle } from "@/components/racemate/theme-toggle";
import {
  getIsAdmin,
  getSessionProfileSummary,
  getSessionUser,
} from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { formatSubscriptionTimeLeft } from "@/lib/billing/subscription-display";
import { getPlusOfferAudience } from "@/lib/plus-offer-policy";
import type { SubscriptionAccess } from "@/lib/billing/types";
import { cn } from "@/lib/utils";

const navigation = [
  {
    href: "/news",
    label: "Новости",
    icon: Newspaper,
    activePrefixes: ["/news"],
  },
  { href: "/social", label: "Соцсети", icon: Radio },
  {
    href: "/leaderboard",
    label: "Чемпионат",
    icon: Trophy,
    activePrefixes: ["/leaderboard"],
  },
  {
    href: "/drivers",
    label: "Пилоты",
    icon: UserRound,
    activePrefixes: ["/drivers"],
  },
  {
    href: "/teams",
    label: "Команды",
    icon: CarFront,
    activePrefixes: ["/teams", "/anatomy"],
  },
  { href: "/calendar", label: "Календарь", icon: CalendarDays },
  {
    href: "/weekend",
    label: "Текущий этап",
    icon: Flag,
    activePrefixes: ["/weekend", "/race-replay"],
  },
  ...(telemetryFlags.telemetryHub
    ? [
        {
          href: "/telemetry",
          label: "Телеметрия",
          icon: Activity,
          activePrefixes: ["/telemetry"],
        },
      ]
    : []),
  {
    href: "/fantasy",
    label: "Фентази лига",
    icon: Users,
    activePrefixes: ["/fantasy", "/leagues", "/predictions", "/prediction"],
  },
  { href: "/admin", label: "Админка", icon: Flag },
];

export function AppShell({
  children,
  hideAds = false,
  immersive = false,
  leaderboardTable,
  viewport = false,
}: {
  children: React.ReactNode;
  hideAds?: boolean;
  immersive?: boolean;
  leaderboardTable?: "drivers" | "constructors";
  viewport?: boolean;
}) {
  const userPromise = getSessionUser();
  const profilePromise = getSessionProfileSummary();
  const adminPromise = getIsAdmin();
  const subscriptionPromise = userPromise.then((user) =>
    getSubscriptionAccess(user?.id ?? null),
  );
  const visibleNavigation = navigation.filter((item) => item.href !== "/admin");

  return (
    <div
      data-public-ui
      className={
        viewport ? "telemetry-app-shell h-dvh overflow-hidden" : "min-h-dvh"
      }
    >
      <MobileAutoHideHeader className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/82 px-4 backdrop-blur-xl shadow-[0_2px_18px_rgb(225_6_0_/_0.12)] sm:px-6 lg:px-8 xl:hidden">
        <Link
          aria-label="RaceSide, на главную"
          className="group flex items-center rounded-md pr-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/"
        >
          <RaceMateLogo className="w-48 sm:w-52" variant="signature" />
        </Link>

        <details className="group relative xl:hidden">
          <summary
            aria-label="Открыть меню"
            className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
            role="button"
          >
            <span className="sr-only">Открыть меню</span>
            <Menu aria-hidden="true" className="size-5" />
          </summary>
          <div className="absolute right-0 top-12 z-40 grid w-[min(18rem,calc(100vw-2rem))] gap-2 rounded-lg border border-border bg-background p-2 shadow-2xl">
            {visibleNavigation.map((item) => (
              <ActiveNavigationLink
                activeClassName="bg-primary/12 text-foreground shadow-[inset_3px_0_0_var(--primary)]"
                activePrefixes={item.activePrefixes}
                className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={getNavigationHref(item.href, leaderboardTable)}
                key={item.href}
              >
                {item.label}
              </ActiveNavigationLink>
            ))}
            <Suspense fallback={null}>
              <AdminNavigationItem adminPromise={adminPromise} mobile />
            </Suspense>
            <div className="mt-1 grid gap-2 border-t border-border pt-2">
              <ThemeToggle />
              <Suspense fallback={<AccountDockSkeleton compact />}>
                <AccountDockStatus
                  compact
                  profilePromise={profilePromise}
                  subscriptionPromise={subscriptionPromise}
                  userPromise={userPromise}
                />
              </Suspense>
            </div>
          </div>
        </details>
      </MobileAutoHideHeader>

      <aside className="raceside-desktop-sidebar fixed bottom-0 left-0 top-0 z-30 hidden w-64 flex-col border-r border-border bg-background/72 backdrop-blur-xl xl:flex">
        <div className="raceside-sidebar-brand px-6">
          <Link
            aria-label="RaceSide, на главную"
            className="group flex items-center rounded-md p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
          >
            <RaceMateLogo variant="signature" />
          </Link>
        </div>
        <div className="raceside-sidebar-session px-6">
          <div className="glass-card rounded-lg p-4">
            <p className="font-telemetry text-[0.62rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              следующая сессия
            </p>
            <SidebarNextSession />
          </div>
        </div>
        <nav
          className="raceside-desktop-navigation grid min-h-0 flex-1 content-start"
          aria-label="Боковая навигация"
        >
          {visibleNavigation.map((item) => {
            const Icon = item.icon;

            return (
              <ActiveNavigationLink
                activeClassName="border-primary bg-primary/10 text-foreground shadow-[inset_3px_0_0_rgb(225_6_0_/_0.18)]"
                activePrefixes={item.activePrefixes}
                className="group flex items-center gap-4 border-r-2 border-transparent px-6 py-3.5 text-muted-foreground transition-colors hover:border-primary hover:bg-accent/60 hover:text-foreground [&[aria-current=page]_svg]:text-primary"
                href={getNavigationHref(item.href, leaderboardTable)}
                key={item.href}
              >
                <Icon aria-hidden="true" className="size-5" />
                <span className="font-telemetry text-xs font-bold uppercase tracking-[0.08em]">
                  {item.label}
                </span>
              </ActiveNavigationLink>
            );
          })}
          <Suspense fallback={null}>
            <AdminNavigationItem adminPromise={adminPromise} />
          </Suspense>
        </nav>
        <div className="raceside-sidebar-account grid border-t border-border px-6">
          <ThemeToggle />
          <Suspense fallback={<AccountDockSkeleton />}>
            <AccountDockStatus
              profilePromise={profilePromise}
              subscriptionPromise={subscriptionPromise}
              userPromise={userPromise}
            />
          </Suspense>
        </div>
      </aside>

      <main
        className={
          viewport
            ? "mx-auto flex h-dvh w-full max-w-[1440px] min-w-0 flex-col overflow-hidden px-4 pb-3 pt-20 sm:px-6 lg:px-8 xl:pl-[18rem] xl:pt-6"
            : immersive
              ? "mx-auto min-h-dvh w-full max-w-[1440px] px-4 pb-0 pt-20 sm:px-6 lg:px-8 xl:pl-[18rem] xl:pt-6"
              : "mx-auto min-h-dvh w-full max-w-[1440px] px-4 pb-12 pt-20 sm:px-6 lg:px-8 xl:pl-[18rem] xl:pt-6"
        }
      >
        {children}
      </main>
      {!viewport && !immersive && !hideAds && (
        <Suspense fallback={null}>
          <AdSlot />
        </Suspense>
      )}
      {!viewport && !immersive && <SiteFooter />}
      {!viewport && !immersive && (
        <Suspense fallback={null}>
          <PlusOfferStatus
            subscriptionPromise={subscriptionPromise}
            userPromise={userPromise}
          />
        </Suspense>
      )}
    </div>
  );
}

function AccountDock({
  compact = false,
  profile,
  subscription,
  user,
}: {
  compact?: boolean;
  profile: Awaited<ReturnType<typeof getSessionProfileSummary>>;
  subscription: SubscriptionAccess;
  user: Awaited<ReturnType<typeof getSessionUser>>;
}) {
  const isAuthenticated = Boolean(user);
  const isActive = subscription.active;
  const timeLeft = isActive
    ? formatSubscriptionTimeLeft(subscription.periodEnd)
    : null;
  const displayName =
    profile?.displayName ||
    user?.email?.split("@")[0] ||
    "Участник RaceSide";
  const plusDetail = isActive
    ? (timeLeft ?? "Доступ открыт")
    : isAuthenticated
      ? "Подключить"
      : null;

  return (
    <div
      className={cn(
        "raceside-account-dock overflow-hidden rounded-md border border-border bg-card/70",
        compact && "w-full",
      )}
    >
      <Link
        aria-label={
          isActive
            ? `RaceSide Plus, подписка активна${timeLeft ? `, ${timeLeft.toLowerCase()}` : ""}`
            : isAuthenticated
              ? "Подключить RaceSide Plus"
              : "Открыть RaceSide Plus"
        }
        className={cn(
          "group flex min-w-0 items-center gap-2.5 px-2.5 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent motion-reduce:transition-none",
          compact ? "h-10" : "h-11",
        )}
        href="/plus"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-primary/10 ring-1 ring-inset ring-primary/15">
          <RaceMateMark className="h-4 w-[1.375rem]" plus />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold leading-tight text-foreground">
            <span className="truncate">RaceSide Plus</span>
            {isActive && (
              <BadgeCheck aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
            )}
          </span>
          {plusDetail && (
            <span className="mt-0.5 block truncate text-[0.65rem] leading-tight text-muted-foreground">
              {plusDetail}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
        />
      </Link>

      <Link
        aria-label={isAuthenticated ? `Открыть профиль ${displayName}` : "Войти в RaceSide"}
        className={cn(
          "group flex min-w-0 items-center gap-2.5 border-t border-border/80 px-2.5 transition-colors hover:bg-accent/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent motion-reduce:transition-none",
          compact ? "h-10" : "h-11",
        )}
        href={isAuthenticated ? "/account" : "/auth"}
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-sm text-primary",
            isAuthenticated ? "bg-primary/12" : "bg-primary text-primary-foreground",
          )}
        >
          <UserRound aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold leading-tight text-foreground">
            {isAuthenticated ? displayName : "Войти"}
          </span>
          <span className="block truncate text-[0.65rem] leading-tight text-muted-foreground">
            {isAuthenticated ? "Личный кабинет" : "Аккаунт и настройки"}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
        />
      </Link>
    </div>
  );
}

function AccountDockSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className="raceside-account-dock overflow-hidden rounded-md border border-border bg-card/70">
      {["plus", "account"].map((row) => (
        <div
          className={cn(
            "flex items-center gap-2.5 px-2.5",
            compact ? "h-10" : "h-11",
            row === "account" && "border-t border-border/80",
          )}
          key={row}
        >
          <Skeleton className="size-7 shrink-0 rounded-sm" />
          <span className="grid flex-1 gap-1">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2 w-24" />
          </span>
        </div>
      ))}
    </div>
  );
}

async function AccountDockStatus({
  compact = false,
  profilePromise,
  subscriptionPromise,
  userPromise,
}: {
  compact?: boolean;
  profilePromise: ReturnType<typeof getSessionProfileSummary>;
  subscriptionPromise: Promise<SubscriptionAccess>;
  userPromise: ReturnType<typeof getSessionUser>;
}) {
  const [profile, subscription, user] = await Promise.all([
    profilePromise,
    subscriptionPromise,
    userPromise,
  ]);

  return (
    <AccountDock
      compact={compact}
      profile={profile}
      subscription={subscription}
      user={user}
    />
  );
}

async function PlusOfferStatus({
  subscriptionPromise,
  userPromise,
}: {
  subscriptionPromise: Promise<SubscriptionAccess>;
  userPromise: ReturnType<typeof getSessionUser>;
}) {
  const [subscription, user] = await Promise.all([subscriptionPromise, userPromise]);
  const audience = getPlusOfferAudience(Boolean(user), subscription.active);
  return audience ? <PlusOffer audience={audience} key={user?.id ?? "guest"} /> : null;
}

async function AdminNavigationItem({
  adminPromise,
  mobile = false,
}: {
  adminPromise: ReturnType<typeof getIsAdmin>;
  mobile?: boolean;
}) {
  if (!(await adminPromise)) return null;

  return (
    <ActiveNavigationLink
      activeClassName={
        mobile
          ? "bg-primary/12 text-foreground"
          : "border-primary bg-primary/10 text-foreground"
      }
      className={
        mobile
          ? "rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "group flex items-center gap-4 border-r-2 border-transparent px-6 py-3.5 text-muted-foreground hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
      href="/admin"
    >
      {!mobile && <Flag aria-hidden="true" className="size-5" />}
      <span
        className={
          mobile
            ? undefined
            : "font-telemetry text-xs font-bold uppercase tracking-[0.08em]"
        }
      >
        Админка
      </span>
    </ActiveNavigationLink>
  );
}

function getNavigationHref(
  href: string,
  leaderboardTable?: "drivers" | "constructors",
) {
  if (href === "/leaderboard" && leaderboardTable === "constructors") {
    return "/leaderboard?table=constructors";
  }

  return href;
}
