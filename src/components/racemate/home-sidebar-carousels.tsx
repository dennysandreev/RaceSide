"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  TrendingUp,
} from "lucide-react";

import { votePollFromHome } from "@/app/polls/actions";
import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { TeamColorProgress } from "@/components/racemate/team-color";
import { TeamLogo } from "@/components/racemate/team-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PollSummary } from "@/types/racemate";

export type HomeMarketSlide = {
  id: "drivers" | "constructors";
  title: string;
  emptyText: string;
  odds: {
    marketTitle: string;
    marketUrl: string;
    source: string;
    updatedAt: string;
    outcomes: Array<{
      name: string;
      probability: number;
      label: string;
      color?: string;
    }>;
  } | null;
};

export type HomeStandingSlide = {
  id: "drivers" | "constructors";
  title: string;
  actionHref: string;
  actionLabel: string;
  rows: Array<{
    position: number;
    name: string;
    meta: string;
    points: number;
    color?: string;
    driverSlug?: string;
    avatarUrl?: string | null;
    href?: string;
    teamCode?: string;
    teamLogo?: string;
  }>;
};

type Direction = "next" | "previous";

export function HomeSidebarCarousels({
  marketSlides,
  polls,
}: {
  marketSlides: HomeMarketSlide[];
  polls: PollSummary[];
}) {
  return (
    <>
      <MarketCarousel slides={marketSlides} />
      <PollCarousel polls={polls} />
    </>
  );
}

export function HomeStandingsCarousel({ slides }: { slides: HomeStandingSlide[] }) {
  const carousel = useCarousel(slides.length, 9_000);
  const slide = slides[carousel.activeIndex];

  if (!slide) return null;

  return (
    <Card
      className="touch-pan-y overflow-hidden"
      {...carousel.dragProps}
      onBlurCapture={carousel.onBlur}
      onFocusCapture={carousel.onFocus}
      onMouseEnter={carousel.pauseTemporarily}
      onMouseLeave={carousel.resumeTemporarily}
    >
      <CardHeader className="h-14 justify-center border-b border-border/70 px-4 py-2 sm:px-5 sm:py-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Activity aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0 truncate">{slide.title}</span>
          </CardTitle>
          <CarouselCounter activeIndex={carousel.activeIndex} length={slides.length} />
        </div>
      </CardHeader>
      <CardContent className="grid min-h-[24rem] grid-rows-[1fr_auto] pt-2 sm:pt-2">
        <div
          className="home-carousel-slide divide-y divide-border"
          data-direction={carousel.direction}
          data-dragging={carousel.isDragging || undefined}
          key={`${slide.id}-${carousel.transitionKey}`}
          style={carousel.slideStyle}
        >
          {slide.rows.map((row) => {
            const identity = (
              <>
                {slide.id === "constructors" ? (
                  <TeamLogo
                    code={row.teamCode}
                    color={row.color}
                    logo={row.teamLogo}
                    name={row.name}
                    shape="square"
                  />
                ) : (
                  <DriverAvatarBadge
                    className="size-10"
                    color={row.color}
                    name={row.name}
                    sizes="2.5rem"
                    slug={row.driverSlug}
                    src={row.avatarUrl}
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold transition-colors group-hover:text-primary motion-reduce:transition-none">
                    {row.name}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color ?? "var(--primary)" }}
                    />
                    <span className="block truncate text-xs text-muted-foreground">{row.meta}</span>
                  </span>
                </span>
              </>
            );

            return (
              <div
                className="grid min-h-[3.35rem] grid-cols-[2.25rem_minmax(0,1fr)_4rem] items-center gap-3 px-1 py-1"
                key={`${slide.id}-${row.position}-${row.name}`}
              >
                <span className="relative grid size-8 place-items-center overflow-hidden rounded-md border border-border/75 bg-background/45 font-telemetry text-sm font-extrabold text-foreground">
                  {row.position}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-1 bottom-0 h-0.5 rounded-t-full"
                    style={{ backgroundColor: row.color ?? "var(--primary)" }}
                  />
                </span>
                {row.href ? (
                  <Link
                    className="group flex min-h-11 min-w-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={row.href}
                    prefetch={false}
                  >
                    {identity}
                  </Link>
                ) : (
                  <div className="flex min-h-11 min-w-0 items-center gap-2">{identity}</div>
                )}
                <span className="grid justify-items-end">
                  <span className="font-telemetry text-base font-extrabold leading-none">{row.points}</span>
                  <span className="mt-1 text-[0.6rem] font-semibold uppercase text-muted-foreground">очк.</span>
                </span>
              </div>
            );
          })}
        </div>
        <div>
          <Button asChild className="mt-3 w-full" size="sm" variant="secondary">
            <Link href={slide.actionHref} prefetch={false}>{slide.actionLabel}</Link>
          </Button>
          <CarouselNavigation
            activeIndex={carousel.activeIndex}
            label="таблицы чемпионата"
            length={slides.length}
            next={carousel.next}
            previous={carousel.previous}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MarketCarousel({ slides }: { slides: HomeMarketSlide[] }) {
  const carousel = useCarousel(slides.length, 7_500);
  const slide = slides[carousel.activeIndex];

  if (!slide) {
    return null;
  }

  return (
    <Card
      className="touch-pan-y overflow-hidden"
      {...carousel.dragProps}
      onBlurCapture={carousel.onBlur}
      onFocusCapture={carousel.onFocus}
      onMouseEnter={carousel.pauseTemporarily}
      onMouseLeave={carousel.resumeTemporarily}
    >
      <CardHeader className="h-14 justify-center border-b border-border/70 px-4 py-2 sm:px-5 sm:py-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <TrendingUp aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0 truncate">{slide.title}</span>
          </CardTitle>
          <CarouselCounter activeIndex={carousel.activeIndex} length={slides.length} />
        </div>
      </CardHeader>
      <CardContent className="grid min-h-[19.5rem] grid-rows-[1fr_auto] pt-4 sm:pt-4">
        <div
          className="home-carousel-slide grid gap-4"
          data-direction={carousel.direction}
          data-dragging={carousel.isDragging || undefined}
          key={`${slide.id}-${carousel.transitionKey}`}
          style={carousel.slideStyle}
        >
          {slide.odds ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-5">{slide.odds.marketTitle}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {slide.odds.source} · обновлено {slide.odds.updatedAt}
                  </p>
                </div>
                <Link
                  className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={slide.odds.marketUrl}
                  prefetch={false}
                  rel="noreferrer"
                  target="_blank"
                >
                  Рынок
                  <ExternalLink aria-hidden="true" className="size-3" />
                </Link>
              </div>
              <div className="grid gap-3">
                {slide.odds.outcomes.map((outcome) => (
                  <div className="grid gap-1.5" key={outcome.name}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{outcome.name}</span>
                      <span className="whitespace-nowrap font-mono text-muted-foreground">
                        {outcome.label}
                      </span>
                    </div>
                    <TeamColorProgress
                      className="h-2"
                      color={outcome.color}
                      value={outcome.probability * 100}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">{slide.emptyText}</p>
          )}
        </div>
        <CarouselNavigation
          activeIndex={carousel.activeIndex}
          label="рынки чемпионства"
          length={slides.length}
          next={carousel.next}
          previous={carousel.previous}
        />
      </CardContent>
    </Card>
  );
}

function PollCarousel({ polls }: { polls: PollSummary[] }) {
  const [items, setItems] = useState(polls);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isVoting, startVoting] = useTransition();
  const carousel = useCarousel(items.length, 8_500);
  const poll = items[carousel.activeIndex];

  const submitVote = (pollId: string | undefined, optionId: string) => {
    if (!pollId || poll?.userVote || isVoting) return;
    setPendingOptionId(optionId);
    setVoteError(null);
    startVoting(async () => {
      const result = await votePollFromHome(pollId, optionId);

      if (!result.ok) {
        setPendingOptionId(null);
        if (result.reason === "auth-required") {
          window.location.assign("/auth?next=%2F");
          return;
        }
        setVoteError(result.reason === "closed" ? "Голосование уже завершено" : result.reason === "already-voted" ? "Твой голос уже учтен" : "Не удалось сохранить голос");
        return;
      }

      setItems((current) => current.map((item) => {
        if (item.id !== pollId) return item;
        return {
          ...item,
          userVote: optionId,
          votes: item.votes + 1,
          options: incrementPollOptionVotes(item.options, optionId),
        };
      }));
      setPendingOptionId(null);
    });
  };

  return (
    <Card
      className="touch-pan-y overflow-hidden"
      {...carousel.dragProps}
      onBlurCapture={carousel.onBlur}
      onFocusCapture={carousel.onFocus}
      onMouseEnter={carousel.pauseTemporarily}
      onMouseLeave={carousel.resumeTemporarily}
    >
      <CardHeader className="h-14 justify-center border-b border-border/70 px-4 py-2 sm:px-5 sm:py-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="min-w-0 text-base">
            <Link
              className="group flex min-w-0 items-center gap-2 rounded-md outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
              href="/polls"
              prefetch={false}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/16">
                <BarChart3 aria-hidden="true" className="size-4" />
              </span>
              <span className="min-w-0 truncate">Актуальные опросы</span>
            </Link>
          </CardTitle>
          <CarouselCounter activeIndex={carousel.activeIndex} length={items.length} />
        </div>
      </CardHeader>
      <CardContent className="grid h-[27rem] min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-hidden pt-4 sm:pt-4">
        {poll ? (
          <div
            className="home-carousel-slide grid min-h-0 grid-rows-[auto_auto_1fr_auto] gap-3 overflow-hidden"
            data-direction={carousel.direction}
            data-dragging={carousel.isDragging || undefined}
            key={`${poll.id ?? poll.question}-${carousel.transitionKey}`}
            style={carousel.slideStyle}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={pollKindTone(poll.kind)}>{pollKindLabel(poll.kind)}</Badge>
              <span className="font-telemetry text-[0.68rem] font-bold uppercase text-muted-foreground">
                {poll.votes ? `${poll.votes} голосов` : "Новый опрос"}
              </span>
            </div>
            <div>
              <p className="line-clamp-3 text-balance font-display text-lg font-bold leading-6">{poll.question}</p>
              {poll.race ? (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {poll.race.name} · раунд {poll.race.round}
                </p>
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              {getPollOptions(poll).map((option, index) => {
                const percent = getVotePercent(option.votes ?? 0, poll.votes);
                const showResult = Boolean(poll.userVote);
                const isSelected = poll.userVote === option.id;

                return (
                  <button
                    className={cn(
                      "relative grid min-h-11 w-full overflow-hidden rounded-md border border-border/70 bg-background/35 px-3 py-2 text-left transition-colors hover:border-primary/55 hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                      isSelected && "border-primary/60",
                      pendingOptionId === option.id && "border-primary/60 bg-primary/8",
                    )}
                    data-carousel-control
                    disabled={Boolean(poll.userVote) || isVoting}
                    key={option.id}
                    onClick={() => submitVote(poll.id, option.id)}
                    type="button"
                  >
                    {showResult ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 bg-primary/12"
                        style={{ width: `${percent}%` }}
                      />
                    ) : null}
                    <span className="relative flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-full border border-border font-mono text-[0.62rem] text-muted-foreground",
                            isSelected && "border-primary bg-primary text-primary-foreground",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 leading-5">{option.label}</span>
                      </span>
                      {showResult ? (
                        <span className="shrink-0 font-telemetry text-xs font-bold text-muted-foreground">
                          {percent}%
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <p aria-live="polite" className={cn("min-h-5 text-xs leading-5 text-muted-foreground", voteError && "text-danger")}>
              {voteError ?? (isVoting ? "Сохраняем голос..." : null)}
            </p>
          </div>
        ) : (
          <div className="grid min-h-48 place-items-center text-center">
            <div>
              <BarChart3 aria-hidden="true" className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">Новые опросы уже готовятся</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Они появятся перед следующим этапом.
              </p>
            </div>
          </div>
        )}
        <CarouselNavigation
          activeIndex={carousel.activeIndex}
          label="актуальные опросы"
          length={items.length}
          next={carousel.next}
          previous={carousel.previous}
        />
      </CardContent>
    </Card>
  );
}

function CarouselNavigation({
  activeIndex,
  label,
  length,
  next,
  previous,
}: {
  activeIndex: number;
  label: string;
  length: number;
  next: () => void;
  previous: () => void;
}) {
  if (length <= 1) {
    return null;
  }

  return (
    <div className="relative z-10 mt-1 flex items-center justify-between gap-3 border-t border-border/70 bg-card pt-3" data-carousel-control>
      <button
        aria-label={`Предыдущий слайд: ${label}`}
        className="grid size-9 place-items-center rounded-md border border-border/70 bg-secondary/45 text-muted-foreground transition-[background-color,border-color,color,transform] hover:border-primary/45 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
        onClick={previous}
        title="Назад"
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </button>
      <div aria-label={`Слайд ${activeIndex + 1} из ${length}`} className="flex items-center justify-center gap-2">
        {Array.from({ length }, (_, index) => (
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full bg-muted-foreground/35 transition-[background-color,transform] duration-300",
              index === activeIndex && "scale-125 bg-primary",
            )}
            key={index}
          />
        ))}
      </div>
      <button
        aria-label={`Следующий слайд: ${label}`}
        className="grid size-9 place-items-center rounded-md border border-border/70 bg-secondary/45 text-muted-foreground transition-[background-color,border-color,color,transform] hover:border-primary/45 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
        onClick={next}
        title="Вперед"
        type="button"
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}

function CarouselCounter({ activeIndex, length }: { activeIndex: number; length: number }) {
  if (length <= 1) {
    return null;
  }

  return (
    <span className="font-telemetry shrink-0 text-[0.68rem] font-bold text-muted-foreground">
      {String(activeIndex + 1).padStart(2, "0")} / {String(length).padStart(2, "0")}
    </span>
  );
}

function useCarousel(length: number, intervalMs: number) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState<Direction>("next");
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragSettling, setIsDragSettling] = useState(false);
  const [isTemporarilyPaused, setIsTemporarilyPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [transitionKey, setTransitionKey] = useState(0);
  const dragRef = useRef<{
    deltaX: number;
    deltaY: number;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const dragSettleTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  const move = useCallback((step: 1 | -1) => {
    if (length <= 1) return;
    setDirection(step > 0 ? "next" : "previous");
    setActiveIndex((current) => (current + step + length) % length);
    setTransitionKey((current) => current + 1);
  }, [length]);

  const next = useCallback(() => move(1), [move]);
  const previous = useCallback(() => move(-1), [move]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (length <= 1 || isTemporarilyPaused || reduceMotion) return;
    const timer = window.setTimeout(next, intervalMs);
    return () => window.clearTimeout(timer);
  }, [activeIndex, intervalMs, isTemporarilyPaused, length, next, reduceMotion]);

  useEffect(() => () => {
    if (dragSettleTimerRef.current !== null) {
      window.clearTimeout(dragSettleTimerRef.current);
    }
  }, []);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const width = event.currentTarget.getBoundingClientRect().width;
    const swipeThreshold = Math.min(96, Math.max(48, width * 0.14));
    const isHorizontalSwipe = Math.abs(drag.deltaX) >= swipeThreshold && Math.abs(drag.deltaX) > Math.abs(drag.deltaY) * 1.2;
    const didDrag = Math.abs(drag.deltaX) > 8 && Math.abs(drag.deltaX) > Math.abs(drag.deltaY);

    setIsDragging(false);

    if (didDrag) {
      suppressClickRef.current = true;
    }

    if (!cancelled && isHorizontalSwipe) {
      setIsDragSettling(true);
      setDragOffsetX(drag.deltaX < 0 ? -width * 1.04 : width * 1.04);
      dragSettleTimerRef.current = window.setTimeout(() => {
        if (drag.deltaX < 0) {
          next();
        } else {
          previous();
        }
        setDragOffsetX(0);
        setIsDragSettling(false);
        dragSettleTimerRef.current = null;
      }, reduceMotion ? 0 : 210);
    } else {
      setIsDragSettling(Math.abs(dragOffsetX) > 0);
      setDragOffsetX(0);
      dragSettleTimerRef.current = window.setTimeout(() => {
        setIsDragSettling(false);
        dragSettleTimerRef.current = null;
      }, reduceMotion ? 0 : 180);
    }

    if (didDrag) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 260);
    }

    if (event.pointerType !== "mouse") {
      setIsTemporarilyPaused(false);
    }
  }, [dragOffsetX, next, previous, reduceMotion]);

  const dragProps = {
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (suppressClickRef.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => finishDrag(event, true),
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
        return;
      }
      if (isDragSettling) {
        return;
      }
      if ((event.target as HTMLElement).closest("[data-carousel-control]")) {
        return;
      }

      dragRef.current = {
        deltaX: 0,
        deltaY: 0,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      setIsDragging(true);
      setIsTemporarilyPaused(true);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }

      drag.deltaX = event.clientX - drag.startX;
      drag.deltaY = event.clientY - drag.startY;
      if (Math.abs(drag.deltaX) > 8 && Math.abs(drag.deltaX) > Math.abs(drag.deltaY)) {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        const maxOffset = event.currentTarget.getBoundingClientRect().width * 0.72;
        setDragOffsetX(Math.max(-maxOffset, Math.min(maxOffset, drag.deltaX)));
        event.preventDefault();
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => finishDrag(event),
  };

  return {
    activeIndex,
    dragProps,
    direction,
    isDragging,
    next,
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setIsTemporarilyPaused(false);
      }
    },
    onFocus: () => setIsTemporarilyPaused(true),
    pauseTemporarily: () => setIsTemporarilyPaused(true),
    previous,
    resumeTemporarily: () => setIsTemporarilyPaused(false),
    slideStyle: {
      opacity: dragOffsetX ? Math.max(0.72, 1 - Math.abs(dragOffsetX) / 1_500) : 1,
      transform: `perspective(72rem) translate3d(${dragOffsetX}px, 0, 0) rotateY(${Math.max(-5, Math.min(5, dragOffsetX / 55))}deg)`,
      transformOrigin: dragOffsetX < 0 ? "right center" : "left center",
      transition: isDragSettling && !reduceMotion
        ? "transform 210ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out"
        : "none",
      willChange: isDragging || isDragSettling ? "transform, opacity" : undefined,
    },
    transitionKey,
  };
}

function getPollOptions(poll: PollSummary) {
  return poll.options.filter(
    (option): option is { id: string; label: string; votes?: number } => typeof option !== "string",
  );
}

function incrementPollOptionVotes(options: PollSummary["options"], optionId: string): PollSummary["options"] {
  if (!options.every((option): option is { id: string; label: string; votes?: number } => typeof option !== "string")) {
    return options;
  }

  return options.map((option) => option.id === optionId
    ? { ...option, votes: (option.votes ?? 0) + 1 }
    : option);
}

function getVotePercent(votes: number, total: number) {
  return total ? Math.round((votes / total) * 100) : 0;
}

function pollKindLabel(kind: PollSummary["kind"]) {
  switch (kind) {
    case "sport":
      return "Спорт";
    case "strategy":
      return "Стратегия";
    case "fan":
      return "Интрига";
    default:
      return "Опрос";
  }
}

function pollKindTone(kind: PollSummary["kind"]): "danger" | "warning" | "secondary" {
  switch (kind) {
    case "sport":
      return "danger";
    case "strategy":
      return "warning";
    default:
      return "secondary";
  }
}
