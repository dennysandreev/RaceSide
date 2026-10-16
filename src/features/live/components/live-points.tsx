"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useConnection, useLive } from "./live-provider";
import { sessionMode } from "../lib/session";
import { projectChampionship } from "../lib/championship";

const points = (value: number) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
function Movement({ value }: { value: number | null }) {
  if (!value)
    return (
      <span className="live-points-movement" aria-label="Без изменения места">
        ·
      </span>
    );
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className="live-points-movement"
      data-direction={value > 0 ? "up" : "down"}
      aria-label={`${value > 0 ? "Поднялся" : "Опустился"} на ${Math.abs(value)}`}
    >
      <Icon aria-hidden="true" />
      {Math.abs(value)}
    </span>
  );
}
export function ChampionshipPoints({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (number: number) => void;
}) {
  const base = useLive("championship"),
    session = useLive("session"),
    drivers = useLive("drivers"),
    status = useLive("status"),
    currentLap = useLive("currentLap");
  const connection = useConnection();
  if (!base || base.sessionKey !== session?.session_key)
    return (
      <div className="live-points live-points-empty">
        <h2>Очки и чемпионат</h2>
        <p>
          {session
            ? "Зачёт перед этим этапом пока недоступен. Он появится, когда данные обновятся."
            : "Зачёт появится вместе с ближайшей сессией."}
        </p>
      </div>
    );
  const projection = projectChampionship(
    base,
    { drivers, status, currentLap },
    sessionMode(session),
  );
  const hasSprint =
    base.sprint.status === "ready" && base.sprint.points.length > 0;
  const badge =
    status === "finished"
      ? "Заезд завершён"
      : connection !== "connected"
        ? "Ждём обновления"
        : projection.started
          ? "Обновляется в лайве"
          : `Этап ${base.round}`;
  return (
    <div className="live-points">
      <header className="live-points-heading">
        <div>
          <h2>Очки и чемпионат</h2>
        </div>
        <span
          className="live-points-update"
          data-active={
            projection.started &&
            status !== "finished" &&
            connection === "connected"
          }
        >
          {badge}
        </span>
      </header>
      {projection.sprintPending || projection.missingDrivers ? (
        <p className="live-points-notice" role="status">
          {projection.sprintPending
            ? "Ждём итог спринта: его очки пока не учтены."
            : "Позиции уточняются. Очки для пилотов без подтверждённой позиции пока не начислены."}
        </p>
      ) : null}
      <div className="live-points-tables">
        <section aria-labelledby="live-points-drivers-title">
          <header className="live-points-table-heading">
            <h3 id="live-points-drivers-title">Пилоты</h3>
          </header>
          <table className="live-points-table live-points-drivers">
            <colgroup>
              <col className="live-points-rank-column" />
              <col />
              <col className="live-points-score-column" />
              <col className="live-points-score-column" />
              <col className="live-points-score-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Место</th>
                <th scope="col">Пилот</th>
                <th scope="col">До этапа</th>
                <th scope="col">
                  {hasSprint
                    ? "За этап"
                    : sessionMode(session) === "sprint"
                      ? "Спринт"
                      : "За гонку"}
                </th>
                <th scope="col">Всего</th>
              </tr>
            </thead>
            <tbody>
              {projection.drivers.map((driver) => (
                <tr
                  key={driver.id}
                  data-selected={
                    driver.liveNumber !== null && driver.liveNumber === selected
                  }
                >
                  <td>
                    <span className="live-points-rank">
                      <b>{driver.projectedPosition}</b>
                      <Movement value={driver.movement} />
                    </span>
                  </td>
                  <td>
                    <button
                      className="live-points-driver"
                      disabled={driver.liveNumber === null}
                      onClick={() =>
                        driver.liveNumber !== null &&
                        onSelect(driver.liveNumber)
                      }
                      aria-pressed={
                        driver.liveNumber !== null &&
                        driver.liveNumber === selected
                      }
                      aria-label={`Выбрать ${driver.fullName}`}
                    >
                      <span
                        className="live-team-line"
                        style={{ background: driver.colour }}
                        aria-hidden="true"
                      />
                      <span className="live-points-identity">
                        <strong>{driver.acronym}</strong>
                        <small title={driver.fullName}>{driver.fullName}</small>
                      </span>
                      {projection.racing && driver.racePosition !== null ? (
                        <span
                          className="live-points-race-position"
                          title="Позиция в заезде"
                        >
                          P{driver.racePosition}
                        </span>
                      ) : null}
                    </button>
                  </td>
                  <td>{points(driver.points)}</td>
                  <td
                    className="live-points-earned"
                    title={
                      hasSprint
                        ? `Спринт: ${points(driver.sprint)} · Гонка: ${points(driver.sessionEarned)}`
                        : undefined
                    }
                  >
                    {driver.earned > 0 ? `+${points(driver.earned)}` : "0"}
                  </td>
                  <td className="live-points-total">{points(driver.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section aria-labelledby="live-points-teams-title">
          <header className="live-points-table-heading">
            <h3 id="live-points-teams-title">Команды</h3>
          </header>
          <table className="live-points-table live-points-teams">
            <colgroup>
              <col className="live-points-rank-column" />
              <col />
              <col className="live-points-score-column" />
              <col className="live-points-score-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Место</th>
                <th scope="col">Команда</th>
                <th scope="col">
                  {hasSprint
                    ? "За этап"
                    : sessionMode(session) === "sprint"
                      ? "Спринт"
                      : "За гонку"}
                </th>
                <th scope="col">Всего</th>
              </tr>
            </thead>
            <tbody>
              {projection.teams.map((team) => (
                <tr key={team.id}>
                  <td>
                    <span className="live-points-rank">
                      <b>{team.projectedPosition}</b>
                      <Movement value={team.movement} />
                    </span>
                  </td>
                  <td>
                    <div className="live-points-team">
                      <span
                        className="live-team-line"
                        style={{ background: team.colour }}
                        aria-hidden="true"
                      />
                      <span className="live-points-identity">
                        <strong title={team.name}>{team.name}</strong>
                        <small>
                          {team.contributors
                            .map(
                              (driver) =>
                                `${driver.acronym} ${driver.earned > 0 ? "+" : ""}${points(driver.earned)}`,
                            )
                            .join(" · ") || `До этапа: ${points(team.points)}`}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td className="live-points-earned">
                    {team.earned > 0 ? `+${points(team.earned)}` : "0"}
                  </td>
                  <td className="live-points-total">{points(team.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <footer className="live-points-footer">
        <span>↑↓ Изменение места · P1 Позиция в заезде</span>
        <span>
          {base.season} · Этап {base.round}
        </span>
        <p>
          {hasSprint ? "Очки спринта уже учтены. " : ""}
          {projection.finalized
            ? "Очки по опубликованным результатам заезда."
            : "Прогноз предполагает полное начисление очков. Итог могут изменить штрафы и сокращение дистанции."}
          {!base.countbackComplete
            ? " При равенстве очков сохранён порядок зачёта до этапа."
            : ""}
        </p>
      </footer>
    </div>
  );
}
