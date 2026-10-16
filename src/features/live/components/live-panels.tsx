"use client";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Headphones, Flag, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLive, useLiveStore } from "./live-provider";
import { compoundText, lapTime } from "../lib/format";
import { eventCategory, eventDriverNumbers } from "../lib/event-display";
import { DriverDetail } from "./live-driver-detail";
import { DriverPortrait } from "./live-timing";
import type { FeedEvent, RadioMessage, TelemetrySample } from "../lib/types";
const time = (value: string) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export function DriverPanel({ selected }: { selected: number | null }) {
  const drivers = useLive("drivers");
  if (selected === null || !drivers[selected])
    return (
      <p className="live-quiet">Выберите пилота в тайминге или на трассе.</p>
    );
  return (
    <DriverDetail selected={selected}>
      <Telemetry selected={selected} />
    </DriverDetail>
  );
}
const emptyTelemetry: TelemetrySample[] = [];
function Telemetry({ selected }: { selected: number }) {
  const store = useLiveStore();
  const buffer = useSyncExternalStore(
    (fn) => store.subscribe(`telemetry:${selected}`, fn),
    () => store.telemetry.get(selected) ?? emptyTelemetry,
    () => emptyTelemetry,
  );
  const p = buffer[buffer.length - 1];
  return (
    <>
      <div className="live-telemetry-values">
        <div>
          <strong>{p?.speed ?? "—"}</strong>
          <span>км/ч</span>
        </div>
        <dl>
          <div>
            <dt>Передача</dt>
            <dd>{p?.gear ?? "—"}</dd>
          </div>
          <div>
            <dt>Обороты</dt>
            <dd>{p?.rpm?.toLocaleString("ru-RU") ?? "—"}</dd>
          </div>
          <div>
            <dt>DRS</dt>
            <dd>
              {p?.drs == null
                ? "—"
                : [10, 12, 14].includes(p.drs)
                  ? "Открыт"
                  : "Закрыт"}
            </dd>
          </div>
        </dl>
      </div>
      <div className="live-graphs">
        {(["speed", "throttle", "brake"] as const).map((key, index) => (
          <div className="live-graph" key={key}>
            <div>
              <span>{["Скорость", "Газ", "Тормоз"][index]}</span>
              <b>
                {p?.[key] ?? "—"}
                {index ? "%" : " км/ч"}
              </b>
            </div>
            <svg
              viewBox="0 0 600 95"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${["Скорость", "Газ", "Тормоз"][index]} за последние 60 секунд`}
            >
              <path d="M0 94 H600" stroke="var(--border)" />
              <polyline
                fill="none"
                stroke={index === 2 ? "var(--primary)" : "var(--foreground)"}
                strokeWidth="2"
                points={buffer
                  .filter((p) => p[key] != null)
                  .map(
                    (p) =>
                      `${600 - (Math.max(0, Date.parse(buffer[buffer.length - 1].timestamp) - Date.parse(p.timestamp)) / 60000) * 600},${90 - ((p[key] ?? 0) / (index ? 100 : 360)) * 80}`,
                  )
                  .join(" ")}
              />
            </svg>
          </div>
        ))}
      </div>
      {!p && <p className="live-quiet">Телеметрия пилота пока не поступила.</p>}
    </>
  );
}
export function Analytics() {
  const drivers = useLive("drivers"),
    pits = useLive("pits");
  const rows = Object.values(drivers);
  const speedRanking = [...rows].sort((a, b) =>
    (b.maxSpeed ?? -1) - (a.maxSpeed ?? -1) ||
    (a.position ?? 99) - (b.position ?? 99) ||
    a.driverNumber - b.driverNumber,
  );
  const compounds = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].flatMap(
    (compound) => {
      const samples = rows.flatMap((d) =>
        d.pace.filter((p) => !p.pit && p.compound === compound),
      );
      if (!samples.length) return [];
      const min = Math.min(...samples.map((p) => p.duration));
      const clean = samples.filter((p) => p.duration < min * 1.15);
      return [
        {
          compound,
          pace: clean.reduce((sum, p) => sum + p.duration, 0) / clean.length,
          count: rows.filter((d) => d.compound === compound).length,
        },
      ];
    },
  );
  return (
    <div className="live-analytics">
      <section>
        <h2>Пит-стопы</h2>
        <div className="live-inner-list">
          {pits.map((p) => (
            <div className="live-analytics-row" key={p.id}>
              <strong>
                {drivers[p.driverNumber]?.acronym ?? p.driverNumber}
              </strong>
              <span>{p.lap} кр.</span>
              <span title="Остановка / время на пит-лейне">
                {p.duration?.toFixed(2) ?? "—"} /{" "}
                {p.laneDuration?.toFixed(1) ?? "—"} с
              </span>
            </div>
          ))}
          {!pits.length && <p className="live-quiet">Пит-стопов пока нет</p>}
        </div>
      </section>
      <section>
        <h2>Темп круга</h2>
        <div className="live-inner-list">
          {rows
            .filter((d) => d.bestLap)
            .sort((a, b) => a.bestLap! - b.bestLap!)
            .slice(0, 5)
            .map((d, i) => (
              <div className="live-analytics-row" key={d.driverNumber}>
                <strong style={{ color: d.teamColour }}>{d.acronym}</strong>
                <span>{i === 0 ? "Лучший" : "Личный"}</span>
                <b>{lapTime(d.bestLap)}</b>
              </div>
            ))}
          <p className="live-quiet">
            Лучший последний круг:{" "}
            {lapTime(
              Math.min(
                ...rows
                  .map((d) => d.lastLap ?? Infinity)
                  .filter(Number.isFinite),
              ),
            )}
          </p>
        </div>
      </section>
      <section>
        <h2>Темп шин</h2>
        <div className="live-inner-list">
          {compounds.map((p) => (
            <div className="live-analytics-row" key={p.compound}>
              <strong>{compoundText[p.compound]}</strong>
              <span>{p.count} пил.</span>
              <b>{lapTime(p.pace)}</b>
            </div>
          ))}
          {!compounds.length && (
            <p className="live-quiet">
              Сравним темп после первых быстрых кругов.
            </p>
          )}
        </div>
      </section>
      <section>
        <h2>Максимальная скорость</h2>
        <ol className="live-inner-list live-speed-ranking">
          {speedRanking.map((driver, index) => (
            <li className="live-analytics-row" key={driver.driverNumber}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong style={{ color: driver.teamColour }} title={driver.fullName}>
                {driver.acronym}
              </strong>
              <b>{driver.maxSpeed == null ? "—" : Math.round(driver.maxSpeed)}
                {driver.maxSpeed != null && <small> км/ч</small>}
              </b>
            </li>
          ))}
          {!speedRanking.length && <li className="live-quiet">Скорости появятся после выезда пилотов.</li>}
        </ol>
      </section>
    </div>
  );
}
export function EventFeed({
  filter,
  onFilter,
}: {
  filter: number | null;
  onFilter: (driverNumber: number | null) => void;
}) {
  const events = useLive("events"),
    drivers = useLive("drivers"),
    session = useLive("session");
  const store = useLiveStore();
  const [archive, setArchive] = useState<{
    sessionKey: number;
    items: FeedEvent[];
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [historyError, setHistoryError] = useState(false),
    [historyEnd, setHistoryEnd] = useState(false);
  const archived =
    archive?.sessionKey === session?.session_key ? archive?.items : null;
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false),
    [seen, setSeen] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(events);
  const visible = archived ?? (paused ? frozen : events);
  const driverList = Object.values(drivers).sort(
    (a, b) =>
      (a.position ?? 99) - (b.position ?? 99) ||
      a.acronym.localeCompare(b.acronym),
  );
  const decorated = visible.map((event) => ({
    event,
    category: eventCategory(event),
    driverNumbers: eventDriverNumbers(event, driverList),
  }));
  const filtered = decorated.filter(
    ({ driverNumbers }) => filter === null || driverNumbers.includes(filter),
  );
  const unread = paused ? events.findIndex((e) => e.id === seen) : 0;
  const loadEarlier = async () => {
    const before = visible.at(-1)?.timestamp;
    if (!before) return;
    setLoading(true);
    setHistoryError(false);
    try {
      const response = await fetch(
        `/api/live/history?topic=events&before=${encodeURIComponent(before)}${store.presentation ? `&at=${Math.floor(store.getPresentationNow())}&session_key=${session?.session_key}` : ""}`,
      );
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!result.items.length) setHistoryEnd(true);
      else {
        setArchive({ sessionKey: result.sessionKey, items: result.items });
        ref.current?.scrollTo({ top: 0 });
      }
    } catch {
      setHistoryError(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="live-feed-wrap live-event-feed">
      <label className="live-event-filter">
        <span className="sr-only">События пилота</span>
        <select
          value={filter ?? ""}
          onChange={(event) =>
            onFilter(event.target.value ? Number(event.target.value) : null)
          }
        >
          <option value="">Все пилоты</option>
          {driverList.map((driver) => (
            <option key={driver.driverNumber} value={driver.driverNumber}>
              {driver.acronym} · {driver.fullName}
            </option>
          ))}
        </select>
      </label>
      {(archived || (paused && unread !== 0)) && (
        <Button
          className="live-new-events"
          variant="secondary"
          size="sm"
          onClick={() => {
            setPaused(false);
            setArchive(null);
            setHistoryEnd(false);
            setHistoryError(false);
            ref.current?.scrollTo({ top: 0 });
          }}
        >
          <ArrowUp />
          {archived
            ? "К новым событиям"
            : unread < 0
              ? "Новые события"
              : `${unread} новых событий`}
        </Button>
      )}
      <div
        className="live-feed"
        ref={ref}
        onScroll={() => {
          if (archived) return;
          const next = (ref.current?.scrollTop ?? 0) > 60;
          if (next && !paused) {
            setSeen(events[0]?.id ?? null);
            setFrozen(events);
          }
          setPaused(next);
        }}
      >
        {filtered.map(({ event: e, category, driverNumbers }) => (
          <article className="live-event" data-tone={category.tone} key={e.id}>
            <div className="live-event-meta">
              <span className="live-event-kind">{category.label}</span>
              <span className="live-event-lap">
                {e.lap ? `${e.lap} круг` : "Сессия"}
              </span>
              <time>{time(e.timestamp)}</time>
            </div>
            <p>{e.message}</p>
            {driverNumbers.length > 0 && (
              <div className="live-event-drivers" aria-label="Пилоты события">
                {driverNumbers.map((driverNumber) => {
                  const driver = drivers[driverNumber];
                  return (
                    <button
                      className="live-event-driver"
                      key={driverNumber}
                      onClick={() => onFilter(driverNumber)}
                      style={
                        {
                          "--driver-color":
                            driver?.teamColour ?? "var(--muted-foreground)",
                        } as CSSProperties
                      }
                      title={`Показать события ${driver?.fullName ?? driverNumber}`}
                      type="button"
                    >
                      {driver?.acronym ?? driverNumber}
                    </button>
                  );
                })}
              </div>
            )}
            {e.duration && <strong>{e.duration.toFixed(3)} с</strong>}
          </article>
        ))}
        {!filtered.length && filter !== null && (
          <div className="live-empty live-event-empty">
            <Flag />
            <p>Событий этого пилота пока нет</p>
            <button type="button" onClick={() => onFilter(null)}>
              Показать все события
            </button>
          </div>
        )}
        {visible.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || historyEnd}
            onClick={() => void loadEarlier()}
          >
            {loading
              ? "Загружаем…"
              : historyEnd
                ? "Вы дошли до начала сессии"
                : "Более ранние события"}
          </Button>
        )}
        {historyError && (
          <p className="live-quiet">
            Не удалось загрузить события. Попробуйте ещё раз.
          </p>
        )}
        {!visible.length && filter === null && (
          <div className="live-empty">
            <Flag />
            <p>На трассе пока тихо</p>
            <span>
              Здесь появятся флаги, обгоны и сообщения дирекции гонки.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
export function RadioFeed({
  filter,
  onFilter,
}: {
  filter: number | null;
  onFilter: (n: number | null) => void;
}) {
  const radio = useLive("radio"),
    drivers = useLive("drivers");
  const ready = radio.filter(
    (message) =>
      message.status === "ready" && Boolean(message.original && message.ru),
  );
  const visible = ready.filter(
    (message) => filter === null || message.driverNumber === filter,
  );
  return (
    <div className="live-radio">
      <label className="live-radio-filter">
        <span className="sr-only">Радио пилота</span>
        <select
          value={filter ?? ""}
          onChange={(e) =>
            onFilter(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">Все пилоты</option>
          {Object.values(drivers).map((d) => (
            <option key={d.driverNumber} value={d.driverNumber}>
              {d.acronym} · {d.fullName}
            </option>
          ))}
        </select>
      </label>
      <div className="live-feed">
        {visible.map((message) => (
          <RadioCard key={message.id} radio={message} />
        ))}
        {!visible.length && (
          <div className="live-empty">
            <Headphones />
            <p>Переводов пока нет</p>
            <span>
              Готовые сообщения появятся здесь вместе с оригинальным текстом.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
function RadioCard({ radio: r }: { radio: RadioMessage }) {
  const drivers = useLive("drivers");
  const d = drivers[r.driverNumber];
  return (
    <article
      className="live-radio-card"
      style={{ "--team": d?.teamColour ?? "var(--primary)" } as CSSProperties}
    >
      <header className="live-radio-heading">
        {d ? (
          <DriverPortrait key={d.driverNumber} driver={d} />
        ) : (
          <Headphones size={24} />
        )}
        <div className="live-radio-identity">
          <strong>
            {d?.acronym ?? r.driverNumber}{" "}
            <span>{r.test ? "Тест" : "Радио"}</span>
          </strong>
          <small>
            {d?.team}
            {r.lap ? ` · ${r.lap} кр.` : ""}
          </small>
        </div>
        <time dateTime={r.timestamp}>{time(r.timestamp)}</time>
      </header>
      <p className="live-radio-message">{r.ru}</p>
      <p className="live-radio-original" lang="en">
        {r.original}
      </p>
    </article>
  );
}
