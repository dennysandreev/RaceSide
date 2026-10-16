import { Clock3, Newspaper, Search, Sparkles } from "lucide-react";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Metadata } from "next";
import Image from "next/image";
import { IntentLink as Link } from "@/components/racemate/intent-link";

import { PublicPageSkeleton } from "@/components/racemate/public-page-loading";
import { AppShell } from "@/components/racemate/app-shell";
import { FeedFiltersDisclosure } from "@/components/racemate/feed-filters-disclosure";
import { JsonLd } from "@/components/racemate/json-ld";
import { PageTitle } from "@/components/racemate/page-title";
import { NewsImage } from "@/components/racemate/news-image";
import { NewsQuickFilters } from "@/components/racemate/news-quick-filters";
import { MobileNewsDigestDialog } from "@/components/racemate/mobile-news-digest-dialog";
import {
  StitchPanel,
  StitchPanelHeader,
  StitchSegmentedLinks,
} from "@/components/racemate/stitch-primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getFavoriteNewsFilters,
  getLatestDailyDigest,
  getNewsDriverTags,
  getNewsItems,
  getNewsTeamTags,
} from "@/data/racemate-repository";
import { getSessionUser } from "@/lib/auth";
import { absoluteUrl, createPageMetadata } from "@/lib/seo";
import { withServerTtlCache } from "@/lib/server-ttl-cache";
import { cn } from "@/lib/utils";
import type { DailyDigest, NewsItem, NewsTagFilter } from "@/types/racemate";

export const dynamic = "force-dynamic";

type NewsSearchParams = {
  filter?: string;
  page?: string;
  race?: string;
  q?: string;
  tag?: string;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<NewsSearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const isFiltered = Boolean(query.filter || query.q || query.race || query.tag);
  const path = !isFiltered && page > 1 ? `/news?page=${page}` : "/news";

  return createPageMetadata({
    description:
      "Свежие новости Формулы-1 на русском: короткие сводки, главные события сезона, команды, пилоты и разборы гоночных этапов.",
    noIndex: isFiltered,
    path,
    title: page > 1 && !isFiltered
      ? `Новости Формулы-1 - страница ${page}`
      : "Новости Формулы-1 на русском",
  });
}

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<NewsSearchParams>;
}) {
  const query = await searchParams;
  return (
    <AppShell>
      <Suspense fallback={<PublicPageSkeleton label="Новости загружаются" variant="feed" />}>
        <NewsContent query={query} />
      </Suspense>
    </AppShell>
  );
}

async function NewsContent({ query }: {
  query: NewsSearchParams;
}) {
  const { filter, page, q, tag, race } = query;
  const currentPage = Math.max(1, Number(page ?? 1) || 1);
  const activeFavoriteFilter = filter === "favorites";
  const userPromise = getSessionUser();
  const sidebarDataPromise = withServerTtlCache(
    "public:news:sidebar",
    60_000,
    () => Promise.all([
      getLatestDailyDigest(),
      getNewsDriverTags(),
      getNewsTeamTags(),
    ]),
    { staleWhileRevalidateMs: 5 * 60_000 },
  );
  const publicNewsPromise = activeFavoriteFilter
    ? null
    : withServerTtlCache(
        `public:news:list:${JSON.stringify([currentPage, q ?? null, tag ?? null, race ?? null])}`,
        60_000,
        () => getNewsItems({
          page: currentPage,
          pageSize: 21,
          search: q,
          tagSlug: tag,
          race,
        }),
        { staleWhileRevalidateMs: 5 * 60_000 },
      );
  const user = await userPromise;
  const favoriteFilters = activeFavoriteFilter
    ? await getFavoriteNewsFilters(user?.id)
    : { drivers: [], teams: [] };
  const favoriteTagSlugs = [
    ...favoriteFilters.drivers.map((item) => item.slug),
    ...favoriteFilters.teams.map((item) => item.slug),
  ];
  const hasFavoriteSelections = favoriteTagSlugs.length > 0;
  const newsResult = await (publicNewsPromise ?? getNewsItems({
    page: currentPage,
    pageSize: 21,
    search: q,
    tagSlug: tag,
    tagSlugs: favoriteTagSlugs,
    race,
  }));
  const [featured, ...restItems] = newsResult.items;
  const isIndexableList = !activeFavoriteFilter && !q && !tag && !race;
  const listPath = currentPage > 1 ? `/news?page=${currentPage}` : "/news";

  return (
    <>
      {isIndexableList ? (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            hasPart: {
              "@type": "ItemList",
              itemListElement: newsResult.items.map((item, index) => ({
                "@type": "ListItem",
                item: absoluteUrl(`/news/${item.slug}`),
                name: item.title,
                position: (currentPage - 1) * 21 + index + 1,
              })),
            },
            inLanguage: "ru-RU",
            name: currentPage > 1
              ? `Новости Формулы-1, страница ${currentPage}`
              : "Новости Формулы-1",
            url: absoluteUrl(listPath),
          }}
        />
      ) : null}
      <section className="relative min-h-[11.5rem] overflow-hidden rounded-xl border border-border bg-card p-5 lg:h-40 lg:min-h-0">
        <Image
          alt=""
          className="object-cover opacity-80"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 72rem"
          src="/stitch/news-blog-hero-v2.webp"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/76 to-background/18" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgb(255_255_255_/_0.06),transparent_44%)]" />
        <div className="relative z-10 flex min-h-[9rem] flex-col gap-5 lg:h-full lg:min-h-0">
          <div className="absolute right-0 top-0 lg:hidden">
            <Suspense fallback={<Skeleton className="size-10" />}><NewsMobileDigest data={sidebarDataPromise} /></Suspense>
          </div>
          <div className="min-w-0 lg:absolute lg:left-0 lg:top-0 lg:max-w-[calc(100%-20rem)]">
            <p className="stitch-label flex items-center gap-2 pr-14 text-primary lg:pr-0">
              <Newspaper aria-hidden="true" className="size-3.5" />
              Новости · сезон {new Date().getUTCFullYear()}
            </p>
            <PageTitle className="mt-2 max-w-4xl pr-12 lg:pr-0">
              Новости Формулы-1
            </PageTitle>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Всё главное из мира Формулы-1 в одном месте, свежие новости и разбор этапов
            </p>
          </div>
          <div className="mt-auto w-full lg:absolute lg:right-0 lg:top-1/2 lg:mt-0 lg:w-auto lg:-translate-y-1/2">
            <StitchSegmentedLinks
              className="grid w-full grid-cols-2 sm:inline-flex sm:w-auto"
              items={[
                {
                  active: !activeFavoriteFilter,
                  href: getNewsModeHref("main", { q, race, tag }),
                  label: "Главное",
                },
                {
                  active: activeFavoriteFilter,
                  href: user
                    ? getNewsModeHref("favorites", { q, race, tag })
                    : `/auth?next=${encodeURIComponent(getNewsModeHref("favorites", { q, race, tag }))}`,
                  label: "Моя лента",
                },
              ]}
              linkClassName="inline-flex min-h-10 items-center justify-center px-4 font-display font-bold leading-none"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 pb-8 pt-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-5">
        <div className="order-1 lg:hidden">
          <Suspense fallback={<Skeleton className="h-12 w-full" />}>
            <NewsFilters data={sidebarDataPromise} activeFavoriteFilter={activeFavoriteFilter} activeSearch={q} activeTag={tag} collapsible />
          </Suspense>
        </div>

        <div className="order-2 grid content-start gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {q || tag || race || activeFavoriteFilter ? (
            <div className="stitch-panel flex flex-wrap items-center justify-between gap-3 p-3">
              <span className="text-sm text-muted-foreground">
                Показаны новости по выбранному фильтру
              </span>
              <Button asChild size="sm" variant="secondary">
                <Link href="/news">Показать всю ленту</Link>
              </Button>
            </div>
          ) : null}

          {featured ? (
            <NewsCard featured item={featured} />
          ) : (
            <div className="stitch-panel p-5 text-sm text-muted-foreground">
              {activeFavoriteFilter && !hasFavoriteSelections
                ? "Добавьте любимых пилотов и команд, чтобы собрать свою ленту."
                : activeFavoriteFilter
                  ? "По вашим любимым пилотам и командам пока нет свежих новостей."
                  : "Свежих обработанных новостей пока нет."}
              {activeFavoriteFilter && !hasFavoriteSelections ? (
                <Button asChild className="mt-4 flex w-fit" size="sm" variant="secondary">
                  <Link href="/onboarding">Настроить любимых</Link>
                </Button>
              ) : null}
            </div>
          )}

          {restItems.length ? (
            <div className="grid items-stretch gap-4 md:grid-cols-2">
              {restItems.map((item) => (
                <NewsCard item={item} key={item.slug} />
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <p className="text-sm text-muted-foreground">
              Страница {newsResult.page} из {newsResult.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                asChild
                className={newsResult.page <= 1 ? "pointer-events-none opacity-50" : undefined}
                size="sm"
                variant="secondary"
              >
                <Link
                  aria-disabled={newsResult.page <= 1}
                  href={getNewsHref(newsResult.page - 1, { filter, q, race, tag })}
                  tabIndex={newsResult.page <= 1 ? -1 : undefined}
                >
                  Назад
                </Link>
              </Button>
              <Button
                asChild
                className={
                  newsResult.page >= newsResult.totalPages ? "pointer-events-none opacity-50" : undefined
                }
                size="sm"
                variant="secondary"
              >
                <Link
                  aria-disabled={newsResult.page >= newsResult.totalPages}
                  href={getNewsHref(newsResult.page + 1, { filter, q, race, tag })}
                  tabIndex={newsResult.page >= newsResult.totalPages ? -1 : undefined}
                >
                  Вперед
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <aside className="order-3 hidden content-start gap-5 lg:order-2 lg:col-start-2 lg:row-start-1 lg:grid">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <NewsFilters data={sidebarDataPromise} activeFavoriteFilter={activeFavoriteFilter} activeSearch={q} activeTag={tag} />
            <NewsDigest data={sidebarDataPromise} />
          </Suspense>
        </aside>
      </section>
    </>
  );
}

type NewsSidebarData = Promise<[DailyDigest | null, NewsTagFilter[], NewsTagFilter[]]>;

async function NewsMobileDigest({ data }: { data: NewsSidebarData }) {
  const [digest] = await data;
  return <MobileNewsDigestDialog digest={digest} />;
}

async function NewsDigest({ data }: { data: NewsSidebarData }) {
  const [digest] = await data;
  return <DailyDigestPanel digest={digest} />;
}

async function NewsFilters({ data, ...props }: {
  data: NewsSidebarData;
  activeFavoriteFilter: boolean;
  activeSearch?: string;
  activeTag?: string;
  collapsible?: boolean;
}) {
  const [, drivers, teams] = await data;
  return <PersonalNewsPanel {...props} drivers={drivers} teams={teams} />;
}

function PersonalNewsPanel({
  activeFavoriteFilter,
  activeSearch,
  activeTag,
  collapsible = false,
  drivers,
  teams,
}: {
  activeFavoriteFilter: boolean;
  activeSearch?: string;
  activeTag?: string;
  collapsible?: boolean;
  drivers: NewsTagFilter[];
  teams: NewsTagFilter[];
}) {
  const searchForm = (
    <form action="/news" className="flex items-center gap-2">
      {activeFavoriteFilter ? <input name="filter" type="hidden" value="favorites" /> : null}
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          className="h-10 pl-9"
          defaultValue={activeSearch}
          maxLength={100}
          name="q"
          placeholder="Найти статью"
          type="search"
        />
      </div>
      <Button aria-label="Найти статью" className="size-10 shrink-0" size="icon" type="submit">
        <Search aria-hidden="true" className="size-4" />
      </Button>
    </form>
  );

  const filters = (
    <>
      {searchForm}
      <NewsQuickFilters activeTag={activeTag} drivers={drivers} teams={teams} />
    </>
  );

  if (collapsible) {
    return (
      <FeedFiltersDisclosure>
        <div className="grid gap-3 border-t border-border/70 p-3">
          {filters}
        </div>
      </FeedFiltersDisclosure>
    );
  }

  return (
    <StitchPanel>
      <div className="grid gap-3 p-4">
        {filters}
      </div>
    </StitchPanel>
  );
}

function DailyDigestPanel({ digest }: { digest: DailyDigest | null }) {
  return (
    <StitchPanel>
      <StitchPanelHeader icon={Sparkles} title="AI-сводка за день" />
      <div className="p-4">
        {digest ? (
          <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">
            {digest.body}
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Сводка за прошедшие сутки появится после 12:00 UTC.
          </p>
        )}
      </div>
    </StitchPanel>
  );
}

function getNewsHref(
  page: number,
  filters: { filter?: string; q?: string; tag?: string; race?: string },
) {
  const params = new URLSearchParams();

  if (page > 1) {
    params.set("page", String(page));
  }

  if (filters.filter) {
    params.set("filter", filters.filter);
  }

  if (filters.q) {
    params.set("q", filters.q);
  }

  if (filters.tag) {
    params.set("tag", filters.tag);
  }

  if (filters.race) {
    params.set("race", filters.race);
  }

  const query = params.toString();

  return query ? `/news?${query}` : "/news";
}

function getNewsModeHref(
  mode: "main" | "favorites",
  filters: { q?: string; tag?: string; race?: string },
) {
  return getNewsHref(1, {
    ...filters,
    filter: mode === "favorites" ? "favorites" : undefined,
  });
}

function NewsCard({
  featured = false,
  item,
}: {
  featured?: boolean;
  item: NewsItem;
}) {
  const imageSizes = featured
    ? "(min-width: 1280px) 44rem, (min-width: 1024px) calc(100vw - 26rem), 100vw"
    : "(min-width: 1280px) 22rem, (min-width: 1024px) calc((100vw - 28rem) / 2), (min-width: 640px) 50vw, 100vw";

  return (
    <Link
      className={cn(
        "group stitch-panel flex h-full min-w-0 flex-col overflow-hidden transition-[border-color,background-color] duration-200 hover:border-primary/45 hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        featured && "w-full",
      )}
      href={`/news/${item.slug}`}
    >
      {item.imageUrl ? (
        <NewsImage
          alt={item.title}
          className={cn(
            "relative w-full shrink-0 overflow-hidden border-b border-border/80 bg-muted",
            featured ? "aspect-[16/8.6]" : "aspect-video",
          )}
          priority={featured}
          sizes={imageSizes}
          src={item.imageUrl}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "grid w-full shrink-0 place-items-center border-b border-border/80 bg-muted/55 text-muted-foreground",
            featured ? "aspect-[16/8.6]" : "aspect-video",
          )}
        >
          <Newspaper className={featured ? "size-10" : "size-8"} strokeWidth={1.5} />
        </div>
      )}

      <div className={cn("flex flex-1 flex-col p-4 sm:p-5", featured && "sm:p-6")}>
        <NewsMeta item={item} />
        <h2
          className={cn(
            "mt-4 text-balance font-display font-extrabold leading-tight tracking-[-0.04em] transition-colors group-hover:text-primary motion-reduce:transition-none",
            featured
              ? "max-w-3xl text-xl sm:text-3xl"
              : "line-clamp-3 text-xl",
          )}
        >
          {item.title}
        </h2>
        <p
          className={cn(
            "mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground",
            featured && "max-w-[72ch] sm:text-base sm:leading-7",
          )}
        >
          {item.summary}
        </p>
      </div>
    </Link>
  );
}

function NewsMeta({
  item,
}: {
  item: {
    source: string;
    time: string;
  };
}) {
  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate font-telemetry text-xs font-bold uppercase tracking-[0.08em] text-foreground/78">
        {item.source}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-telemetry text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        <Clock3 aria-hidden="true" className="size-3.5" />
        {item.time}
      </span>
    </div>
  );
}
