"use client";
import type { ReactNode } from "react";
import { Flag, Headphones, Timer } from "lucide-react";
import { useLive } from "./live-provider";
import { DriverPortrait, ordered, Tyre } from "./live-timing";
import { compoundText, driverStatus, gapText, lapTime, tyreAgeText, tyreAgeDescription } from "../lib/format";
import { sessionCapabilities } from "../lib/session";

export function DriverDetail({
  selected,
  children,
}: {
  selected: number;
  children: ReactNode;
}) {
  const drivers = useLive("drivers"),
    session = useLive("session"),
    pits = useLive("pits"),
    events = useLive("events"),
    radio = useLive("radio");
  const d = drivers[selected];
  if (!d) return null;
  const timed = sessionCapabilities(session).rankByLapTime;
  const rank = timed ? ordered(drivers, session).indexOf(d) + 1 : d.position;
  const laps = d.lapHistory ?? [];
  const clean = laps.filter((lap) => !lap.pit && !lap.deleted).slice(-5);
  const pace = clean.length
    ? clean.reduce((sum, p) => sum + p.duration, 0) / clean.length
    : null;
  const ideal = d.bestSectors.every((s) => s !== null)
    ? d.bestSectors.reduce<number>((sum, s) => sum + (s ?? 0), 0)
    : null;
  const stops = pits
    .filter((p) => p.driverNumber === selected)
    .slice()
    .reverse();
  const driverEvents = events
    .filter((e) => e.driverNumber === selected)
    .slice(0, 5);
  const latestRadio = radio.find((r) => r.driverNumber === selected);
  const fastest = Math.min(
    ...Object.values(drivers).map((d) => d.bestLap ?? Infinity),
  );
  return (
    <div className="live-driver-detail">
      <header className="live-profile-header">
        <DriverPortrait key={d.driverNumber} driver={d} />
        <div>
          <p>
            {d.team} <span>№ {d.driverNumber}</span>
          </p>
          <h2>
            {d.fullName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
          </h2>
          <span className="live-driver-state">
            {driverStatus[d.status] ?? "На трассе"}
          </span>
        </div>
        <strong>P{rank ?? "—"}</strong>
      </header>
      <dl className="live-profile-metrics">
        {[
          ["Лучший круг", lapTime(d.bestLap)],
          ["Последний круг", lapTime(d.lastLap)],
          ["Темп · 5 кругов", lapTime(pace)],
          [
            timed ? "От лучшего" : "От лидера",
            timed
              ? d.bestLap
                ? gapText(d.bestLap - fastest)
                : "—"
              : gapText(d.gap),
          ],
          ["Круги", d.lap],
          ["Пит-стопы", d.pitCount],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className="live-driver-section live-driver-telemetry">
        <div className="live-section-heading">
          <h3>Телеметрия</h3>
          <span>Последние 60 секунд</span>
        </div>
        <dl className="live-session-speed">
          <dt>Макс. скорость за сессию</dt>
          <dd>{d.maxSpeed == null ? "—" : `${Math.round(d.maxSpeed)} км/ч`}</dd>
        </dl>
        {children}
      </section>
      <div className="live-driver-columns">
        <section className="live-driver-section">
          <div className="live-section-heading">
            <h3>Круг за кругом</h3>
            <span>{laps.length} записано</span>
          </div>
          <div className="live-lap-table-wrap">
            <table className="live-lap-table">
              <thead>
                <tr>
                  <th>Круг</th>
                  <th>Время</th>
                  <th>К лучшему</th>
                  <th>Шины</th>
                </tr>
              </thead>
              <tbody>
                {[...laps].reverse().map((lap) => (
                  <tr key={lap.lap}>
                    <td>
                      {lap.lap}
                      {lap.pit && <small> · пит</small>}
                    </td>
                    <td
                      className={
                        lap.duration === d.bestLap ? "live-purple" : ""
                      }
                    >
                      {lap.deleted ? (
                        <s title="Время круга удалено">
                          {lapTime(lap.duration)}
                        </s>
                      ) : (
                        lapTime(lap.duration)
                      )}
                    </td>
                    <td>
                      {lap.deleted
                        ? "Удалён"
                        : d.bestLap
                          ? `+${(lap.duration - d.bestLap).toFixed(3)}`
                          : "—"}
                    </td>
                    <td>
                      <span className="live-tyre" data-compound={lap.compound}>
                        <b title={compoundText[lap.compound ?? ""]}>
                          {lap.compound?.[0] ?? "—"}
                        </b>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!laps.length && (
              <p className="live-quiet">
                Время появится после первого завершённого круга.
              </p>
            )}
          </div>
        </section>
        <section className="live-driver-section">
          <div className="live-section-heading">
            <h3>Сектора и шины</h3>
            <Tyre driver={d} />
          </div>
          <dl className="live-sector-summary">
            {d.bestSectors.map((s, i) => (
              <div key={i}>
                <dt>Лучший S{i + 1}</dt>
                <dd>{s?.toFixed(3) ?? "—"}</dd>
              </div>
            ))}
            <div>
              <dt>Идеальный круг</dt>
              <dd>{lapTime(ideal)}</dd>
            </div>
          </dl>
          <p className="live-quiet">
            Идеальный круг — сумма лучших секторов пилота.
          </p>
          <div className="live-tyre-summary">
            <b>{compoundText[d.compound ?? ""] ?? "Ждём данные о шинах"}</b>
            <span title={tyreAgeDescription(d)}>{tyreAgeText(d)} {d.tyreAgeEstimated ? "кругов после пита" : "кругов на текущем комплекте"}</span>
          </div>
        </section>
        <section className="live-driver-section">
          <div className="live-section-heading">
            <h3>Пит-стопы</h3>
            <span>{stops.length}</span>
          </div>
          {stops.map((p, i) => (
            <div className="live-pit-detail" key={p.id}>
              <span className="live-pit-number">{i + 1}</span>
              <div>
                <strong>{p.lap ? `${p.lap}-й круг` : "Заезд в боксы"}</strong>
                <small>
                  {compoundText[p.before ?? ""] ?? "—"}
                  {p.after ? ` → ${compoundText[p.after] ?? p.after}` : ""}
                </small>
              </div>
              <dl>
                <div>
                  <dt>Стоянка</dt>
                  <dd>{p.duration?.toFixed(2) ?? "—"} с</dd>
                </div>
                <div>
                  <dt>Пит-лейн</dt>
                  <dd>{p.laneDuration?.toFixed(2) ?? "—"} с</dd>
                </div>
              </dl>
            </div>
          ))}
          {!stops.length && (
            <p className="live-quiet">
              <Timer size={15} /> Пилот ещё не заезжал в боксы.
            </p>
          )}
        </section>
        <section className="live-driver-section">
          <div className="live-section-heading">
            <h3>По ходу сессии</h3>
            <Flag size={16} />
          </div>
          {driverEvents.map((e) => (
            <p className="live-driver-note" key={e.id}>
              {e.message}
            </p>
          ))}
          {!driverEvents.length && (
            <p className="live-quiet">Событий с участием пилота пока нет.</p>
          )}
          {latestRadio && (
            <div className="live-driver-radio-note">
              <Headphones size={16} />
              <p>{latestRadio.ru ?? "Радиосообщение обрабатывается…"}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
