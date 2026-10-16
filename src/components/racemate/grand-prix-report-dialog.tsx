"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ChevronDown,
  Flag,
  Gauge,
  Timer,
  TrendingUp,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { GrandPrixRecapShare } from "@/components/racemate/grand-prix-recap-share";
import { ReportTimingCharts } from "@/components/racemate/grand-prix-report-charts";
import { TeamColorDot } from "@/components/racemate/team-color";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTeamAsset } from "@/data/f1-assets";
import {
  getReportPitStops,
  reportNews,
  reportNumber,
  reportObject,
  reportParagraphs,
  reportText,
  type GrandPrixReportAnalytics,
  type ReportStandingChange,
} from "@/lib/grand-prix-report";
import { cn } from "@/lib/utils";
import { formatGrandPrixNameRu } from "@/lib/race-display";
import type {
  GrandPrixReport,
  GrandPrixReportResult,
  TyreStint,
} from "@/types/racemate";
import "./grand-prix-report.css";

const sections = [
  { id: "overview", label: "Обзор" },
  { id: "positions", label: "Позиции и отрывы" },
  { id: "strategy", label: "Темп и стратегия" },
  { id: "results", label: "Итоги" },
] as const;
type SectionId = (typeof sections)[number]["id"];
const numberFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 3,
});
const numberText = (value: unknown) =>
  reportNumber(value) === null
    ? "—"
    : numberFormat.format(reportNumber(value)!);
const signed = (value: number) => (value > 0 ? "+" : "") + numberText(value);
const surname = (name: string) => name.split(" ").slice(-1).join(" ");
const teamColor = (team: string) =>
  getTeamAsset(team)?.color ?? "var(--muted-foreground)";
const slugFor = (name: string, slugs: Record<string, string>) =>
  slugs[name] ??
  slugs[name.toLowerCase()] ??
  Object.entries(slugs).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];

export function GrandPrixReportDialog({
  analytics,
  driverSlugByName = {},
  open,
  report,
}: {
  analytics?: GrandPrixReportAnalytics | null;
  driverSlugByName?: Record<string, string>;
  open: boolean;
  report: GrandPrixReport | null;
}) {
  const router = useRouter();
  const contentRoot = useRef<HTMLDivElement>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const closeReport = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("raceReport");
    router.replace(url.pathname + url.search + url.hash, { scroll: false });
  }, [router]);
  useEffect(() => {
    if (!open || !analytics?.timingPending) return;
    const refresh = () => {
      if (!document.hidden) router.refresh();
    };
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [open, analytics?.timingPending, report?.id, router]);
  useEffect(() => {
    if (!open) return;
    let root: HTMLDivElement | null = null;
    const onScroll = () => {
      if (!root) return;
      const top = root.getBoundingClientRect().top + 110;
      const current = [...sections]
        .reverse()
        .find(
          (section) =>
            root!
              .querySelector("#report-" + section.id)!
              .getBoundingClientRect().top <= top,
        );
      setActiveSection(current?.id ?? "overview");
    };
    const frame = requestAnimationFrame(() => {
      root = scrollRoot.current;
      root?.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    });
    return () => {
      cancelAnimationFrame(frame);
      root?.removeEventListener("scroll", onScroll);
    };
  }, [open, report?.id]);
  const goTo = (id: SectionId) => {
    setActiveSection(id);
    const root = scrollRoot.current;
    const section = root?.querySelector("#report-" + id);
    if (!root || !section) return;
    root.scrollTo({
      top:
        section.getBoundingClientRect().top -
        root.getBoundingClientRect().top +
        root.scrollTop -
        18,
      behavior: "instant",
    });
  };
  if (!report) return null;
  const podium = report.results
    .filter((row) => row.position !== null && row.position <= 3)
    .sort((a, b) => a.position! - b.position!);
  const fastest = report.results.find((row) => row.isFastestLap);
  const fastestHighlight = reportObject(report.highlights.fastestLap);
  const pitHighlight = reportObject(report.highlights.fastestPitStop);
  const bestGain = [...report.results]
    .filter((row) => (row.positionDelta ?? 0) > 0)
    .sort((a, b) => b.positionDelta! - a.positionDelta!)[0];
  const paragraphs = reportParagraphs(report.aiSummary);
  const news = reportNews(report.newsSummary).filter(
    (text) => !paragraphs.some((paragraph) => paragraph.includes(text)),
  );
  const totalLaps =
    analytics?.totalLaps ??
    reportNumber(report.raceStatistics.laps) ??
    Math.max(0, ...report.results.map((row) => row.laps ?? 0));
  const finishers = reportNumber(report.raceStatistics.finishers);
  const retirements = reportNumber(report.raceStatistics.retirements);
  const dateLabel = report.raceDate;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeReport();
      }}
    >
      <DialogContent
        ref={contentRoot}
        className="race-report-dialog"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRoot.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = Array.from(
            document.querySelectorAll<HTMLAnchorElement>("a[href]"),
          ).find((link) => link.href.includes("raceReport=" + report.raceSlug));
          trigger?.focus({ preventScroll: true });
        }}
      >
        <header className="rr-header">
          <div className="min-w-0">
            <div className="rr-eyebrow">
              Отчёт о Гран-при{" "}
              <span>
                Этап {report.round} / {report.season}
              </span>
            </div>
            <DialogTitle className="rr-title">
              {formatGrandPrixNameRu(report.raceName)}
            </DialogTitle>
            <DialogDescription className="rr-description">
              {[
                report.circuitName,
                dateLabel,
                totalLaps > 0 ? numberText(totalLaps) + " кругов" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </DialogDescription>
          </div>
          <div className="rr-header-actions">
            <GrandPrixRecapShare
              compact
              raceName={report.raceName}
              season={report.season}
              round={report.round}
            />
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="Закрыть отчёт">
                <X />
              </Button>
            </DialogClose>
          </div>
        </header>
        <nav className="rr-nav" aria-label="Разделы отчёта">
          <div className="rr-nav-links">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                aria-current={
                  activeSection === section.id ? "location" : undefined
                }
                onClick={() => goTo(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
          <div className="rr-mobile-nav">
            <label className="sr-only" htmlFor="report-section-select">
              Раздел отчёта
            </label>
            <select
              id="report-section-select"
              value={activeSection}
              onChange={(event) => goTo(event.target.value as SectionId)}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
            <span>4 раздела</span>
          </div>
        </nav>
        <div ref={scrollRoot} className="rr-scroll">
          <section
            id="report-overview"
            className="rr-section rr-overview"
            aria-label="Обзор гонки"
          >
            {podium.length ? (
              <div className="rr-podium">
                {podium.map((row) => (
                  <article
                    className={cn(
                      "rr-podium-driver",
                      row.position === 1 && "rr-winner",
                    )}
                    key={row.driver}
                  >
                    <div
                      className="rr-podium-place"
                      style={{
                        color:
                          row.position === 1 ? teamColor(row.team) : undefined,
                      }}
                    >
                      P{row.position}
                      <span>
                        {row.position === 1 ? "Победитель" : "Подиум"}
                      </span>
                    </div>
                    <DriverAvatarBadge
                      name={row.driver}
                      slug={slugFor(row.driver, driverSlugByName)}
                      season={report.season}
                      color={teamColor(row.team)}
                      className="rr-podium-avatar"
                      sizes="80px"
                    />
                    <div className="min-w-0">
                      <DriverName
                        row={row}
                        slugs={driverSlugByName}
                        className="rr-podium-name"
                      />
                      <div className="rr-team">
                        <TeamColorDot color={teamColor(row.team)} />
                        {row.team}
                      </div>
                      <div className="rr-podium-time">
                        {row.time ?? "—"}
                        <span>{numberText(row.points)} очков</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <MissingData
                title="Результаты ещё готовятся"
                detail="Подиум появится, когда будут опубликованы результаты гонки."
              />
            )}
            <div className="rr-stat-grid">
              <Stat
                icon={<Gauge />}
                label="Лучший круг"
                value={
                  fastest?.bestLap ?? reportText(fastestHighlight.time) ?? "—"
                }
                detail={
                  fastest?.driver ??
                  reportText(fastestHighlight.driver) ??
                  "Время пока недоступно"
                }
              />
              <Stat
                icon={<Timer />}
                label="Быстрейший пит-стоп"
                value={
                  reportNumber(pitHighlight.duration) !== null
                    ? numberText(pitHighlight.duration) + " с"
                    : "—"
                }
                detail={
                  reportText(pitHighlight.team) ??
                  reportText(pitHighlight.driver) ??
                  "Время пока недоступно"
                }
              />
              <Stat
                icon={<TrendingUp />}
                label="Больше всего позиций"
                value={bestGain ? signed(bestGain.positionDelta!) : "—"}
                detail={bestGain?.driver ?? "Нет данных о старте"}
              />
              <Stat
                icon={<Flag />}
                label="На финише"
                value={numberText(finishers)}
                detail={
                  retirements !== null
                    ? "Сходов: " + numberText(retirements)
                    : "Число сходов уточняется"
                }
              />
            </div>
            <div className="rr-news">
              <div>
                <span className="rr-eyebrow">Вокруг Гран-при</span>
                <h2>Что обсуждали вокруг этапа</h2>
                <p className="rr-caption">Обзор новостей и обсуждений от AI</p>
              </div>
              <div className="rr-news-copy">
                {paragraphs.length || news.length ? (
                  <>
                    {paragraphs.map((text, index) => (
                      <p key={index}>{text}</p>
                    ))}
                    {news.length > 0 && (
                      <ul>
                        {news.map((text, index) => (
                          <li key={index}>{text}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Обзор новостей ещё готовится. Результаты и статистику можно
                    посмотреть ниже.
                  </p>
                )}
              </div>
            </div>
          </section>
          <section id="report-positions" className="rr-section">
            <SectionHeading
              number="01"
              title="Позиции и отрывы"
              detail="Как менялось положение пилотов по ходу гонки"
            />
            <ReportTimingCharts analytics={analytics} mode="positions" />
          </section>
          <section id="report-strategy" className="rr-section">
            <SectionHeading
              number="02"
              title="Темп и стратегия"
              detail="Шины, время кругов и работа на пит-лейне"
            />
            <TyreHistory
              report={report}
              analytics={analytics}
              totalLaps={totalLaps}
            />
            <ReportTimingCharts analytics={analytics} mode="pace" />
            <div className="rr-two-columns rr-strategy-details">
              <PitStops report={report} />
              <div className="rr-conditions">
                <h3>Условия гонки</h3>
                <dl>
                  <Detail
                    label="Температура воздуха"
                    value={
                      reportNumber(report.weather.averageAirTemperature) !==
                      null
                        ? numberText(report.weather.averageAirTemperature) +
                          " °C"
                        : "—"
                    }
                  />
                  <Detail
                    label="Дождь во время гонки"
                    value={
                      typeof report.weather.rainfall === "boolean"
                        ? report.weather.rainfall
                          ? "Был дождь"
                          : "Без дождя"
                        : "—"
                    }
                  />
                  <Detail
                    label="Машина безопасности"
                    value={numberText(report.raceStatistics.safetyCarCount)}
                  />
                  <Detail
                    label="Виртуальная машина безопасности"
                    value={numberText(
                      report.raceStatistics.virtualSafetyCarCount,
                    )}
                  />
                  <Detail
                    label="Красные флаги"
                    value={numberText(report.raceStatistics.redFlagCount)}
                  />
                  <Detail
                    label="Пит-стопы"
                    value={numberText(report.pitStops.length)}
                  />
                </dl>
                <p className="rr-caption">Температура — средняя за гонку.</p>
                <Link
                  href={"/telemetry?season=" + report.season}
                  className="rr-more-link"
                >
                  Открыть Telemetry Hub <Badge variant="outline">Plus</Badge>
                  <ArrowRight size={15} />
                </Link>
              </div>
            </div>
          </section>
          <section id="report-results" className="rr-section">
            <SectionHeading
              number="03"
              title="Итоги Гран-при"
              detail="Финиш, сравнение напарников и положение в чемпионате"
            />
            <Classification report={report} slugs={driverSlugByName} />
            <div className="rr-two-columns rr-comparisons">
              <PositionGains results={report.results} />
              <Teammates results={report.results} />
            </div>
            <div className="rr-championship">
              <h3>Чемпионат после этапа</h3>
              <p className="rr-caption">
                Очки за весь уик-энд, включая спринт, если он был.
              </p>
              <div className="rr-two-columns">
                <Standings
                  title="Пилоты"
                  rows={analytics?.championship.drivers ?? []}
                />
                <Standings
                  title="Команды"
                  rows={analytics?.championship.teams ?? []}
                />
              </div>
            </div>
          </section>
          <footer className="rr-footer">
            <span>Обновлено {report.generatedAt}</span>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function SectionHeading({
  number,
  title,
  detail,
}: {
  number: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="rr-section-heading">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p className="rr-caption">{detail}</p>
      </div>
    </div>
  );
}
function MissingData({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rr-missing">
      <h4>{title}</h4>
      <p>{detail}</p>
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rr-stat">
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rr-detail">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
function DriverName({
  row,
  slugs,
  className,
}: {
  row: GrandPrixReportResult;
  slugs: Record<string, string>;
  className?: string;
}) {
  const slug = slugFor(row.driver, slugs);
  return slug ? (
    <Link href={"/drivers/" + slug} className={cn("rr-driver-link", className)}>
      {row.driver}
    </Link>
  ) : (
    <span className={className}>{row.driver}</span>
  );
}
const compounds: Record<
  string,
  { label: string; color: string; name: string }
> = {
  SOFT: { label: "S", color: "#ec414b", name: "Мягкие" },
  MEDIUM: { label: "M", color: "#e6b933", name: "Средние" },
  HARD: { label: "H", color: "#d6d9de", name: "Жёсткие" },
  INTERMEDIATE: { label: "I", color: "#4bac65", name: "Промежуточные" },
  WET: { label: "W", color: "#5298eb", name: "Дождевые" },
  UNKNOWN: { label: "?", color: "#8b8e96", name: "Нет данных" },
};
function TyreHistory({
  report,
  analytics,
  totalLaps,
}: {
  report: GrandPrixReport;
  analytics?: GrandPrixReportAnalytics | null;
  totalLaps: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = report.results.map((row) => ({
    ...row,
    stints:
      analytics?.drivers.find((driver) => driver.driver === row.driver)
        ?.tyres ??
      row.tyres ??
      [],
  }));
  const hasKnownLaps = (stints: TyreStint[]) =>
    stints.some(
      (stint) =>
        (stint.startLap ?? 0) > 0 &&
        (stint.endLap ?? 0) >= (stint.startLap ?? 0),
    );
  return (
    <div className="rr-tyres">
      <div className="rr-block-heading">
        <h3>Шины по кругам</h3>
        <div className="rr-tyre-legend">
          {Object.values(compounds).map((tyre) => (
            <span key={tyre.label}>
              <i style={{ background: tyre.color }} />
              {tyre.label}
              <span className="sr-only"> — {tyre.name}</span>
            </span>
          ))}
        </div>
      </div>
      {totalLaps > 0 && rows.some((row) => hasKnownLaps(row.stints)) ? (
        <>
          <div className="rr-tyre-axis">
            <span>Круг</span>
            <div>
              <span>1</span>
              <span>{Math.round(totalLaps / 2)}</span>
              <span>{totalLaps}</span>
            </div>
          </div>
          {rows.slice(0, expanded ? rows.length : 6).map((row) => (
            <div className="rr-tyre-row" key={row.driver}>
              <span>
                <TeamColorDot color={teamColor(row.team)} />
                {surname(row.driver)}
              </span>
              <div className="rr-tyre-track">
                {row.stints
                  .filter(
                    (stint) =>
                      (stint.startLap ?? 0) > 0 &&
                      (stint.endLap ?? 0) >= (stint.startLap ?? 0),
                  )
                  .map((stint, index) => {
                    const from = Math.max(1, stint.startLap!),
                      to = Math.min(totalLaps, stint.endLap!);
                    const tyre = compounds[stint.compound.toUpperCase()] ?? {
                      label: "?",
                      color: "#8b8e96",
                      name: "Состав неизвестен",
                    };
                    return to >= from ? (
                      <span
                        key={index}
                        className="rr-tyre-stint"
                        style={{
                          left: ((from - 1) / totalLaps) * 100 + "%",
                          width: ((to - from + 1) / totalLaps) * 100 + "%",
                          background: tyre.color,
                        }}
                        title={tyre.name + ": круги " + from + "–" + to}
                        aria-label={
                          row.driver +
                          ", " +
                          tyre.name +
                          ", круги " +
                          from +
                          "–" +
                          to
                        }
                      >
                        {tyre.label}
                      </span>
                    ) : null;
                  })}
                {!hasKnownLaps(row.stints) && (
                  <span className="rr-tyre-unknown">Нет данных по кругам</span>
                )}
              </div>
            </div>
          ))}
          {rows.length > 6 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Свернуть" : "Все пилоты"}
              <ChevronDown className={cn(expanded && "rotate-180")} />
            </Button>
          )}
        </>
      ) : (
        <MissingData
          title="Стратегии по кругам пока недоступны"
          detail="Составы шин, если они известны, показаны в итоговой таблице."
        />
      )}
    </div>
  );
}
function PitStops({ report }: { report: GrandPrixReport }) {
  const [expanded, setExpanded] = useState(false);
  const [lane, setLane] = useState(false);
  const all = getReportPitStops(report);
  const measured = all
    .filter((pit) => (lane ? pit.laneDuration : pit.duration) !== null)
    .sort((a, b) =>
      lane ? a.laneDuration! - b.laneDuration! : a.duration! - b.duration!,
    );
  const max = Math.max(
    1,
    ...measured.map((pit) => (lane ? pit.laneDuration! : pit.duration!)),
  );
  return (
    <div className="rr-pits">
      <div className="rr-block-heading">
        <h3>Пит-стопы</h3>
        {all.some((pit) => pit.laneDuration !== null) && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={lane}
            onClick={() => setLane(!lane)}
          >
            {lane ? "Весь пит-лейн" : "Остановка"}
          </Button>
        )}
      </div>
      <p className="rr-caption">
        {measured.length
          ? lane
            ? "Время проезда по пит-лейну вместе с остановкой."
            : "Время остановки. Проезд по пит-лейну сюда не входит."
          : "Число остановок по пилотам. Время остановок пока недоступно."}
      </p>
      {measured.length ? (
        <div className="rr-pit-list">
          {measured
            .slice(0, expanded ? measured.length : 6)
            .map((pit, index) => (
              <div className="rr-pit-row" key={pit.driver + pit.lap + index}>
                <span>
                  {surname(pit.driver)}
                  <small>Круг {pit.lap}</small>
                </span>
                <div>
                  <i
                    style={{
                      width:
                        ((lane ? pit.laneDuration! : pit.duration!) / max) *
                          100 +
                        "%",
                      background: teamColor(pit.team),
                    }}
                  />
                </div>
                <strong>
                  {numberText(lane ? pit.laneDuration : pit.duration)} с
                </strong>
              </div>
            ))}
          {measured.length > 6 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Свернуть" : "Все пит-стопы"}
            </Button>
          )}
        </div>
      ) : all.length ? (
        <PitStopCounts report={report} />
      ) : (
        <MissingData
          title="Данные об остановках пока недоступны"
          detail="Остановки по кругам видны на графике шин, если есть данные о смене состава."
        />
      )}
      {measured.length > 0 && all.length > measured.length && (
        <p className="rr-caption">
          Ещё {all.length - measured.length} остановок без замера времени.
        </p>
      )}
    </div>
  );
}
function PitStopCounts({ report }: { report: GrandPrixReport }) {
  const [expanded, setExpanded] = useState(false);
  const counts = report.results
    .map((row) => ({
      ...row,
      count: getReportPitStops(report).filter(
        (pit) => pit.driver === row.driver,
      ).length,
    }))
    .sort((a, b) => b.count - a.count);
  const maximum = Math.max(1, ...counts.map((row) => row.count));
  return (
    <div className="rr-pit-list">
      {counts.slice(0, expanded ? counts.length : 6).map((row) => (
        <div className="rr-pit-row" key={row.driver}>
          <span>{surname(row.driver)}</span>
          <div>
            <i
              style={{
                width: (row.count / maximum) * 100 + "%",
                background: teamColor(row.team),
              }}
            />
          </div>
          <strong>{row.count}</strong>
        </div>
      ))}
      {counts.length > 6 && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Свернуть" : "Все пилоты"}
        </Button>
      )}
    </div>
  );
}
function resultTime(row: GrandPrixReportResult) {
  if (row.time) return row.time;
  if (/^\+\d+\s+Lap/i.test(row.status))
    return "+" + row.status.match(/\d+/)?.[0] + " кр.";
  if (row.status && !/^finished$/i.test(row.status)) return "Сход";
  return "—";
}
function Classification({
  report,
  slugs,
}: {
  report: GrandPrixReport;
  slugs: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = report.results.slice(0, expanded ? report.results.length : 10);
  return (
    <div className="rr-classification">
      <h3>Финишная классификация</h3>
      {!rows.length ? (
        <MissingData
          title="Результаты ещё готовятся"
          detail="Итоговая таблица появится после публикации результатов."
        />
      ) : (
        <>
          <Table className="rr-result-table">
            <TableHeader>
              <TableRow>
                <TableHead>Место</TableHead>
                <TableHead>Пилот / команда</TableHead>
                <TableHead className="text-right">Старт</TableHead>
                <TableHead className="text-right">Позиции</TableHead>
                <TableHead className="text-right">Время / отрыв</TableHead>
                <TableHead className="text-right">Лучший круг</TableHead>
                <TableHead className="text-right">Очки</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.driver}>
                  <TableCell className="rr-result-place">
                    {row.position ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="rr-result-driver">
                      <DriverAvatarBadge
                        name={row.driver}
                        slug={slugFor(row.driver, slugs)}
                        season={report.season}
                        color={teamColor(row.team)}
                        className="size-10"
                      />
                      <div>
                        <DriverName row={row} slugs={slugs} />
                        <span className="rr-result-team">{row.team}</span>
                      </div>
                      {row.isFastestLap && (
                        <Badge variant="secondary" className="rr-fastest-badge">
                          Лучший круг
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.grid === 0 ? "Пит-лейн" : numberText(row.grid)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      (row.positionDelta ?? 0) > 0 && "rr-positive",
                      (row.positionDelta ?? 0) < 0 && "rr-negative",
                    )}
                  >
                    {row.positionDelta === null
                      ? "—"
                      : signed(row.positionDelta)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {resultTime(row)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      row.isFastestLap && "font-semibold",
                    )}
                  >
                    {row.bestLap ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {numberText(row.points)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="rr-mobile-results">
            {rows.map((row) => (
              <div className="rr-mobile-result" key={row.driver}>
                <strong>{row.position ?? "—"}</strong>
                <div>
                  <DriverName row={row} slugs={slugs} />
                  <span className="rr-result-team">{row.team}</span>
                  <span className="rr-result-meta">
                    Старт{" "}
                    {row.grid === 0 ? "с пит-лейна" : numberText(row.grid)} ·{" "}
                    <span
                      className={cn(
                        (row.positionDelta ?? 0) > 0 && "rr-positive",
                        (row.positionDelta ?? 0) < 0 && "rr-negative",
                      )}
                    >
                      {row.positionDelta === null
                        ? "—"
                        : signed(row.positionDelta)}
                    </span>
                  </span>
                  <span className="rr-result-best-lap">
                    Лучший круг <strong>{row.bestLap ?? "—"}</strong>
                  </span>
                </div>
                <div className="rr-mobile-result-time">
                  <strong>
                    {numberText(row.points)} <small>очк.</small>
                  </strong>
                  <span>{resultTime(row)}</span>
                </div>
              </div>
            ))}
          </div>
          {report.results.length > 10 && (
            <Button
              className="rr-expand"
              variant="outline"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded
                ? "Свернуть таблицу"
                : "Все " + report.results.length + " пилота"}
              <ChevronDown className={cn(expanded && "rotate-180")} />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
function PositionGains({ results }: { results: GrandPrixReportResult[] }) {
  const [expanded, setExpanded] = useState(false);
  const rows = results
    .filter((row) => row.positionDelta !== null)
    .sort((a, b) => Math.abs(b.positionDelta!) - Math.abs(a.positionDelta!));
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.positionDelta!)));
  return (
    <div>
      <h3>От старта к финишу</h3>
      <p className="rr-caption">Разница между стартовым и итоговым местом</p>
      {rows.length ? (
        <div className="rr-gain-list">
          {rows.slice(0, expanded ? rows.length : 8).map((row) => (
            <div className="rr-gain-row" key={row.driver}>
              <span>{surname(row.driver)}</span>
              <div className="rr-gain-track">
                <i
                  style={{
                    left:
                      row.positionDelta! < 0
                        ? 50 - (Math.abs(row.positionDelta!) / max) * 50 + "%"
                        : "50%",
                    width: (Math.abs(row.positionDelta!) / max) * 50 + "%",
                    background:
                      row.positionDelta! < 0
                        ? "var(--muted-foreground)"
                        : teamColor(row.team),
                  }}
                />
              </div>
              <strong
                className={cn(
                  row.positionDelta! > 0 && "rr-positive",
                  row.positionDelta! < 0 && "rr-negative",
                )}
              >
                {signed(row.positionDelta!)}
              </strong>
            </div>
          ))}
          {rows.length > 8 && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Свернуть" : "Все пилоты"}
            </Button>
          )}
        </div>
      ) : (
        <MissingData
          title="Нет данных о стартовой решётке"
          detail="Изменение позиций появится, когда будет известен старт каждого пилота."
        />
      )}
    </div>
  );
}
function Teammates({ results }: { results: GrandPrixReportResult[] }) {
  const [expanded, setExpanded] = useState(false);
  const teams = [...new Set(results.map((row) => row.team))];
  return (
    <div>
      <h3>Внутри команды</h3>
      <p className="rr-caption">Место на финише и очки обоих напарников</p>
      <div className="rr-teammates">
        {teams.slice(0, expanded ? teams.length : 4).map((team) => (
          <div key={team}>
            <div className="rr-team">
              <TeamColorDot color={teamColor(team)} />
              {team}
            </div>
            {results
              .filter((row) => row.team === team)
              .map((row) => (
                <div className="rr-teammate-row" key={row.driver}>
                  <span>{surname(row.driver)}</span>
                  <strong>
                    {row.position === null ? "—" : "P" + row.position}
                  </strong>
                  <span>{numberText(row.points)} очк.</span>
                </div>
              ))}
          </div>
        ))}
      </div>
      {teams.length > 4 && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Свернуть" : "Все команды"}
        </Button>
      )}
    </div>
  );
}
function Standings({
  title,
  rows,
}: {
  title: string;
  rows: ReportStandingChange[];
}) {
  const [before, setBefore] = useState(false);
  const sorted = [...rows]
    .sort((a, b) =>
      before
        ? (a.previousPosition ?? 99) - (b.previousPosition ?? 99)
        : a.position - b.position,
    )
    .slice(0, 5);
  const max = Math.max(
    1,
    ...rows.map((row) => (before ? row.previousPoints : row.points)),
  );
  return (
    <div className="rr-standings">
      <div className="rr-block-heading">
        <h4>{title}</h4>
        {rows.length > 0 && (
          <div
            className="rr-period"
            aria-label={title + ": положение в чемпионате"}
          >
            <button
              type="button"
              aria-pressed={before}
              onClick={() => setBefore(true)}
            >
              До этапа
            </button>
            <button
              type="button"
              aria-pressed={!before}
              onClick={() => setBefore(false)}
            >
              После
            </button>
          </div>
        )}
      </div>
      {rows.length ? (
        <ol>
          {sorted.map((row) => (
            <li key={row.id}>
              <div>
                <span className="rr-standing-position">
                  {before ? (row.previousPosition ?? "—") : row.position}
                </span>
                <span>{row.name}</span>
                <strong>
                  {numberText(before ? row.previousPoints : row.points)}
                </strong>
                {!before && (
                  <small
                    className={cn(
                      row.gained >= 0 ? "rr-positive" : "rr-negative",
                    )}
                  >
                    {signed(row.gained)}
                  </small>
                )}
              </div>
              <div className="rr-standing-track">
                <i
                  style={{
                    width:
                      ((before ? row.previousPoints : row.points) / max) * 100 +
                      "%",
                    background: teamColor(row.team || row.name),
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <MissingData
          title="Таблица чемпионата пока недоступна"
          detail="Сравнение появится, когда будут сохранены полные результаты до и после этапа."
        />
      )}
    </div>
  );
}
