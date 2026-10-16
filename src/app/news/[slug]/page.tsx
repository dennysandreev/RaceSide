import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Flame, Newspaper } from "lucide-react";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";

import { reactToArticle } from "@/app/news/actions";
import { AppShell } from "@/components/racemate/app-shell";
import { ArticleShareActions } from "@/components/racemate/article-share-actions";
import { JsonLd } from "@/components/racemate/json-ld";
import { NewsImage } from "@/components/racemate/news-image";
import { NewsErrorReport } from "@/components/racemate/news-error-report";
import { NewsTagBadge } from "@/components/racemate/news-tag-badge";
import {
  StitchPanel,
  StitchPanelHeader,
} from "@/components/racemate/stitch-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getArticleReactionCounts,
  getNewsArticle,
  getNewsItems,
} from "@/data/racemate-repository";
import {
  absoluteUrl,
  createPageMetadata,
  SITE_URL,
  truncateSeoText,
} from "@/lib/seo";
import { getOrCreateNewsShareUrl } from "@/lib/share-links";
import { formatNewsDate, formatNewsContext, newsArticleTypeLabel } from "@/lib/news-editorial";

type NewsArticlePageProps = {
  params: Promise<{ slug: string }>;
};

const getCachedNewsArticle = cache(getNewsArticle);

export async function generateMetadata({
  params,
}: NewsArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getCachedNewsArticle(slug);

  if (!article) {
    return createPageMetadata({
      description: "Материал не найден или больше не опубликован.",
      noIndex: true,
      path: `/news/${slug}`,
      title: "Новость не найдена",
    });
  }

  const canonicalUrl = buildArticleUrl(article.slug);
  const description = truncateSeoText(article.summary);
  const imageUrl = toAbsoluteUrl(article.imageUrl);

  return createPageMetadata({
    authors: ["RaceSide"],
    description,
    image: imageUrl,
    path: canonicalUrl,
    publishedTime: article.publishedAt,
    modifiedTime: article.modifiedAt,
    section: "Новости Формулы-1",
    tags: article.tags.map((tag) => tag.name),
    title: article.title,
    type: "article",
  });
}

export default async function NewsArticlePage({
  params,
}: NewsArticlePageProps) {
  const { slug } = await params;
  const article = await getCachedNewsArticle(slug);

  if (!article) {
    notFound();
  }

  if (slug !== article.slug) {
    permanentRedirect(`/news/${article.slug}`);
  }

  const canonicalUrl = buildArticleUrl(article.slug);
  const [reactions, latestNews, shareUrl] = await Promise.all([
    getArticleReactionCounts(article.id),
    getNewsItems({ includeTotal: false, pageSize: 4 }),
    getOrCreateNewsShareUrl(article.id, canonicalUrl),
  ]);
  const detailParagraphs = splitArticleDetails(article.details);
  const imageUrl = toAbsoluteUrl(article.imageUrl);
  const raceTag = article.tags.find((tag) => tag.type === "race");
  const sources = article.sources?.length ? article.sources : [{ source_url: article.href ?? "", source_name: article.source, source_authors: article.editorial?.source_authors ?? [] }];
  const publishedDate = formatNewsDate(article.publishedAt);
  const modifiedDate = article.modifiedAt !== article.publishedAt ? formatNewsDate(article.modifiedAt) : null;
  const contextFacts = article.editorial?.context?.map(formatNewsContext).filter(Boolean) ?? [];
  const orderedTags = raceTag
    ? [raceTag, ...article.tags.filter((tag) => tag.slug !== raceTag.slug)]
    : article.tags;

  return (
    <AppShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                item: SITE_URL,
                name: "Главная",
                position: 1,
              },
              {
                "@type": "ListItem",
                item: `${SITE_URL}/news`,
                name: "Новости",
                position: 2,
              },
              {
                "@type": "ListItem",
                item: canonicalUrl,
                name: article.title,
                position: 3,
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@id": `${canonicalUrl}#article`,
            "@type": "NewsArticle",
            articleSection: "Формула-1",
            author: {
              "@id": `${SITE_URL}/#organization`,
            },
            citation: sources.map(source => source.source_url).filter(Boolean),
            dateModified: article.modifiedAt ?? article.publishedAt,
            datePublished: article.publishedAt,
            description: truncateSeoText(article.summary),
            headline: truncateSeoText(article.title, 110),
            image: imageUrl ? [imageUrl] : undefined,
            inLanguage: "ru-RU",
            genre: newsArticleTypeLabel(article.editorial?.article_type),
            isBasedOn: sources.map(source => ({ "@type": "CreativeWork", url: source.source_url, publisher: { "@type": "Organization", name: source.source_name }, author: source.source_authors?.map(name => ({ "@type": "Person", name })) })),
            keywords: article.tags.map((tag) => tag.name).join(", "),
            mainEntityOfPage: canonicalUrl,
            publisher: {
              "@id": `${SITE_URL}/#organization`,
            },
            url: canonicalUrl,
          },
        ]}
      />
      <header className="border-b border-border py-5 sm:py-6">
        <h1 className="font-display max-w-5xl text-balance text-2xl font-extrabold leading-tight tracking-[-0.03em] sm:text-4xl">
          {article.title}
        </h1>
        <div className="mt-3 flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {publishedDate ? <time dateTime={article.publishedAt}>{publishedDate} МСК</time> : <span>{article.time}</span>}
          <span aria-hidden="true">·</span>
          <span className="min-w-0 break-words">
            Источник:{" "}
            <span className="font-medium text-foreground" title={article.source}>
              {article.source}
            </span>
          </span>
        </div>
        {modifiedDate ? <p className="mt-1 text-sm text-muted-foreground">Обновлено <time dateTime={article.modifiedAt}>{modifiedDate} МСК</time></p> : null}
        {orderedTags.length || article.raceTag ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!raceTag && article.raceTag ? (
              <Link href={article.raceFilter ? `/news?race=${article.raceFilter}` : "/news"}>
                <Badge variant="warning">{article.raceTag}</Badge>
              </Link>
            ) : null}
            {orderedTags.map((tag) => (
              <NewsTagBadge href={`/news?tag=${tag.slug}`} key={tag.slug} tag={tag} />
            ))}
          </div>
        ) : null}
      </header>

      <section className="grid gap-5 py-5 sm:py-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <article className="stitch-panel p-5 sm:p-6">
          <HighlightedParagraph
            className="max-w-[72ch] text-lg leading-8 text-foreground max-sm:hyphens-auto max-sm:text-justify"
            highlights={article.highlights ?? []}
            text={article.summary}
          />
          <NewsImage
            alt={article.title}
            className="relative mt-6 aspect-video overflow-hidden rounded-lg border border-border bg-muted"
            priority
            src={article.imageUrl}
          />
          {detailParagraphs.length ? (
            <div className="mt-5 grid max-w-[72ch] gap-4 text-base leading-7 text-muted-foreground">
              {detailParagraphs.map((paragraph) => (
                <HighlightedParagraph
                  className="text-pretty max-sm:hyphens-auto max-sm:text-justify"
                  highlights={article.highlights ?? []}
                  key={paragraph}
                  text={paragraph}
                />
              ))}
            </div>
          ) : (
            <p className="mt-5 max-w-[72ch] text-base leading-7 text-muted-foreground">
              Подробности появятся после обработки материала.
            </p>
          )}
          {contextFacts.length ? <section aria-label="Контекст RaceSide" className="mt-6 border-t border-border pt-4">
            <h2 className="text-base font-semibold text-foreground">Контекст RaceSide</h2>
            <ul className="mt-2 grid gap-2 text-sm leading-6 text-muted-foreground">{contextFacts.map(fact => <li key={fact}>{fact}</li>)}</ul>
            {article.raceFilter ? <Link className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline" href={`/calendar/${article.raceFilter.replace("-", "/")}`}>Открыть результаты этапа</Link> : null}
          </section> : null}
          <footer className="mt-6 border-t border-border pt-4">
            <p className="text-sm leading-6 text-muted-foreground">Подготовлено RaceSide с помощью ИИ по указанным источникам.</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {sources.filter(source => /^https?:\/\//.test(source.source_url)).map(source => <Link className="inline-flex min-h-10 items-center gap-1.5 text-sm underline-offset-4 hover:text-primary hover:underline" href={source.source_url} key={source.source_url} rel="noreferrer" target="_blank">{source.source_name}<ExternalLink aria-hidden="true" className="size-3.5" /></Link>)}
              </div>
              <NewsErrorReport articleId={article.id} articleSlug={article.slug} />
            </div>
          </footer>
        </article>

        <aside className="grid content-start gap-5">
          <StitchPanel>
            <StitchPanelHeader icon={Flame} title="Оцени и поделись" />
            <div className="p-3">
              <form action={reactToArticle} className="flex flex-wrap gap-2">
                <input name="articleId" type="hidden" value={article.id} />
                <input name="articleSlug" type="hidden" value={article.slug} />
                {Object.entries(reactions).map(([reaction, count]) => (
                  <Button
                    aria-label={`Поставить реакцию ${reaction}`}
                    className="h-9 min-w-14 gap-1.5 rounded-full border-0 bg-muted px-3 shadow-none hover:bg-primary/10"
                    key={reaction}
                    name="reaction"
                    type="submit"
                    value={reaction}
                    variant="ghost"
                  >
                    <span className="text-base leading-none">{reaction}</span>
                    <span className="font-telemetry text-xs font-bold text-muted-foreground">{count}</span>
                  </Button>
                ))}
              </form>
            </div>
            <ArticleShareActions shareUrl={shareUrl} title={article.title} />
          </StitchPanel>

          <StitchPanel>
            <StitchPanelHeader icon={Newspaper} title="Свежие материалы" />
            <div className="grid gap-2 p-4">
              {latestNews.items
                .filter((item) => item.id !== article.id)
                .slice(0, 3)
                .map((item) => (
                  <Link
                    className="rounded-md border border-border bg-background/35 p-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/news/${item.slug}`}
                    key={item.slug}
                  >
                    <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{item.time}</p>
                  </Link>
                ))}
            </div>
          </StitchPanel>
        </aside>
      </section>
    </AppShell>
  );
}

function splitArticleDetails(details?: string) {
  return (details ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function HighlightedParagraph({
  className,
  highlights,
  text,
}: {
  className?: string;
  highlights: string[];
  text: string;
}) {
  const phrases = highlights
    .map((highlight) => highlight.trim())
    .filter((highlight) => highlight.length >= 4 && text.toLowerCase().includes(highlight.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);

  if (!phrases.length) {
    return <p className={className}>{text}</p>;
  }

  const pattern = new RegExp(`(${phrases.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern).filter(Boolean);

  return (
    <p className={className}>
      {parts.map((part, index) =>
        phrases.some((phrase) => phrase.toLowerCase() === part.toLowerCase()) ? (
          <mark
            className="bg-transparent font-medium text-foreground decoration-2 decoration-primary underline underline-offset-4"
            key={`${part}-${index}`}
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        ),
      )}
    </p>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildArticleUrl(articleSlug: string) {
  return absoluteUrl(`/news/${articleSlug}`);
}

function toAbsoluteUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    return absoluteUrl(value);
  } catch {
    return undefined;
  }
}
