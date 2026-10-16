"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ArrowUpRight, CircleHelp } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { Comparison, TelemetryAnalysis, TrackCategory, AnalysisSection, SignalKind, TelemetrySignal, RepeatSummary } from "../lib/types";
import type { CursorStore } from "../lib/client";
import { getTraceColors, number } from "../lib/format";
import { TelemetryChart } from "./telemetry-chart";
import { TelemetryTrack, type TrackRegion } from "./telemetry-track";

const categoryLabels: Record<TrackCategory, string> = {
  slow: "Медленные повороты", medium: "Средние повороты", fast: "Быстрые повороты", straight: "Прямые",
};
const cornerDescriptions = {
  slow: { speed: "Меньше 150 км/ч", description: "Здесь пилоты заметно снижают скорость. Особенно важны торможение и разгон на выходе." },
  medium: { speed: "От 150 км/ч, но ниже 230 км/ч", description: "Здесь важен баланс: сохранить скорость в повороте и начать разгон на выходе." },
  fast: { speed: "230 км/ч и выше", description: "Эти повороты пилоты проходят на высокой скорости. Важно сохранить её на всём участке." },
};
const signalLabels: Record<SignalKind, string> = {
  "speed-drop": "Суперклиппинг", coasting: "Движение накатом", "weak-acceleration": "Ослабление разгона",
};
const signalColors: Record<SignalKind, string> = {
  "speed-drop": "var(--analysis-signal-drop)", coasting: "var(--analysis-signal-coast)", "weak-acceleration": "var(--analysis-signal-weak)",
};
type WorkspaceProps = { comparison: Comparison; cursor: CursorStore; onInspect: (from: number, to: number) => void };
type AnalysisProps = WorkspaceProps & { analysis: TelemetryAnalysis };

function Unavailable({ title, description }: { title: string; description: string }) {
  return <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}
function gainText(gain: number | null, comparison: Comparison, analysis: TelemetryAnalysis, threshold = analysis.quality.neutralSeconds) {
  if (gain == null) return "Нет данных";
  if (Math.abs(gain) < threshold) return "Близкий темп";
  return `${comparison.traces[gain > 0 ? analysis.reference : analysis.other].driver.code} · ${number(Math.abs(gain), 3)} с`;
}
function Gain({ gain, comparison, analysis, threshold = analysis.quality.neutralSeconds, verified = true, emptyLabel = "Нет данных" }: { gain: number | null; comparison: Comparison; analysis: TelemetryAnalysis; threshold?: number; verified?: boolean; emptyLabel?: string }) {
  const colors = getTraceColors(comparison);
  const winner = !verified || gain == null || Math.abs(gain) < threshold ? null : gain > 0 ? analysis.reference : analysis.other;
  return <span className="analysis-gain" title={!verified && gain != null ? "Оценка разницы времени: секторного тайминга для проверки не хватает." : undefined} style={{ color: winner == null ? undefined : colors[winner] }}>{gain == null ? emptyLabel : !verified ? `≈ ${number(Math.abs(gain), 3)} с` : gainText(gain, comparison, analysis, threshold)}</span>;
}
function sectionLabel(section: AnalysisSection, analysis?: TelemetryAnalysis) {
  if (section.corner != null) return `Поворот ${section.corner}`;
  const previous = analysis?.sections[analysis.sections.indexOf(section) - 1];
  const next = analysis?.sections[analysis.sections.indexOf(section) + 1];
  return previous?.corner != null ? `Прямая после T${previous.corner}` : next?.corner != null ? `Прямая перед T${next.corner}` : `${number(section.from, 0)}–${number(section.to, 0)} м`;
}

export function TelemetryIntelligence({ comparison, cursor, onInspect, children, view, onView }: WorkspaceProps & { children: ReactNode; view: string; onView: (view: string) => void }) {
  const [exit, setExit] = useState(comparison.analysis?.exits[0]?.corner);
  const analysis = comparison.analysis;
  const chooseExit = (corner: number) => { setExit(corner); onView("exits"); };
  return <div className="telemetry-intelligence">
    <div className="analysis-content">
      {view === "profile" && (analysis ? <TrackProfile comparison={comparison} analysis={analysis} cursor={cursor} onInspect={onInspect} onExit={chooseExit} /> : <Unavailable title="Разбор участков пока недоступен" description="Графики и разбор всего круга остаются доступны." />)}
      {view === "exits" && (analysis ? <ExitWorkspace comparison={comparison} analysis={analysis} cursor={cursor} corner={exit} onCorner={setExit} /> : <Unavailable title="Не хватает данных о поворотах" description="Откройте графики выбранных кругов или разбор всего круга." />)}
      {view === "signals" && (analysis ? <SignalWorkspace comparison={comparison} analysis={analysis} cursor={cursor} /> : <Unavailable title="Поиск событий пока недоступен" description="Графики выбранных кругов остаются доступны." />)}
      {view === "analysis" && <div className="telemetry-detail-panel">{children}</div>}
    </div>
  </div>;
}

function TrackProfile({ comparison, analysis, cursor, onInspect, onExit }: AnalysisProps & { onExit: (corner: number) => void }) {
  const [category, setCategory] = useState<TrackCategory>("slow");
  const [hint, setHint] = useState<TrackCategory>();
  const colors = getTraceColors(comparison);
  const rows = analysis.sections.filter((section) => section.category === category);
  const scale = Math.max(0.1, ...analysis.profile.map((p) => Math.abs(p.gain ?? 0)));
  const speedValues = analysis.profile.find((p) => p.category === category)?.speedValues ?? [];
  const highlights = [analysis.reference, analysis.other].map((driver, i) => ({ driver,
    section: analysis.sections.filter((s) => s.gain != null && (i === 0 ? s.gain >= analysis.quality.neutralSeconds : s.gain <= -analysis.quality.neutralSeconds))
      .sort((a, b) => Math.abs(b.gain!) - Math.abs(a.gain!))[0] }));
  const select = (section: AnalysisSection) => section.corner == null ? onInspect(section.from, section.to) : onExit(section.corner);
  const regions: TrackRegion[] = rows.map((section) => ({ id: section.id, from: section.from, to: section.to,
    color: section.gain == null || Math.abs(section.gain) < analysis.quality.neutralSeconds ? "var(--muted-foreground)" : colors[section.gain > 0 ? analysis.reference : analysis.other],
    label: `${sectionLabel(section, analysis)}: ${gainText(section.gain, comparison, analysis)}`, onSelect: () => select(section) }));
  return <div className="analysis-workspace analysis-profile">
    <section className="analysis-panel">
      <header className="analysis-heading"><div><h2>Сравнение участков</h2><p>Где выиграно время</p></div></header>
      {!analysis.sections.length ? <Unavailable title="На этой трассе ещё нет разметки поворотов" description="Скорость и отрыв можно сравнить на графиках по дистанции." /> : <>
        <div className="analysis-bar-legend"><span style={{ color: colors[analysis.reference] }}>← {comparison.traces[analysis.reference].driver.code} быстрее</span><span style={{ color: colors[analysis.other] }}>{comparison.traces[analysis.other].driver.code} быстрее →</span></div>
        <TooltipProvider delayDuration={300}><div className="analysis-bars" aria-label="Выигрыш времени по типам участков">
          {analysis.profile.map((row) => {
            const gain = row.gain, neutral = gain == null || Math.abs(gain) < analysis.quality.neutralSeconds;
            const width = Math.abs(gain ?? 0) / scale * 44;
            const explanation = row.category === "straight" ? null : cornerDescriptions[row.category];
            const button = <button key={row.category} type="button" className="analysis-bar-row" aria-pressed={category === row.category} onClick={(event) => {
              setCategory(row.category);
              if (explanation) {
                // Radix closes hints on click by default; keep tap-to-read available.
                event.preventDefault();
                setHint(row.category);
              } else setHint(undefined);
            }}>
              <span className="analysis-bar-label">{categoryLabels[row.category]}{explanation && <CircleHelp aria-hidden="true" />}<small>{row.count ? row.available === row.count ? `${row.count} участков` : `${row.available} из ${row.count} участков` : "Нет участков"}</small></span>
              <span className="analysis-bar-plot"><span className="analysis-bar-fill" style={{ left: `${gain != null && gain > 0 ? 50 - width : 50}%`, width: `${width}%`, background: neutral ? "var(--muted-foreground)" : colors[gain! > 0 ? analysis.reference : analysis.other] }} />
                <span className="analysis-bar-value" data-side={gain != null && gain > 0 ? "left" : "right"}>{gain == null ? "Нет данных" : neutral ? "Близкий темп" : `${number(Math.abs(gain), 3)} с`}</span>
              </span>
            </button>;
            return explanation ? <Tooltip key={row.category} open={hint === row.category} onOpenChange={(open) => setHint((current) => open ? row.category : current === row.category ? undefined : current)}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent className="analysis-category-tooltip" side="top" align="start" sideOffset={8} collisionPadding={12}>
                <p className="analysis-category-speed">Минимальная скорость: {explanation.speed.toLowerCase()}</p>
                <p>{explanation.description}</p>
                <p className="analysis-category-method">Группа определяется по средней минимальной скорости двух выбранных кругов рядом с вершиной поворота.</p>
              </TooltipContent>
            </Tooltip> : button;
          })}
        </div></TooltipProvider>
        <div className="analysis-bar-axis"><span>−{number(scale, 2)} с</span><span>0</span><span>+{number(scale, 2)} с</span></div>
        <div className="analysis-profile-summary">
          <div className="analysis-profile-highlights" aria-label="Ключевые участки круга">
            {highlights.map(({ driver, section }) => <button key={driver} type="button" className="analysis-profile-highlight" disabled={!section} onClick={() => { if (section) select(section); }}>
              <span><small>Главный выигрыш {comparison.traces[driver].driver.code}</small><strong>{section ? sectionLabel(section, analysis) : analysis.quality.timingAvailable ? "Явного преимущества нет" : "Не хватает данных"}</strong></span>
              <span className="analysis-profile-highlight-value" style={{ color: section ? colors[driver] : undefined }}>{section ? `${number(Math.abs(section.gain!), 3)} с` : "—"}{section && <ArrowUpRight aria-hidden="true" />}</span>
            </button>)}
          </div>
          <div className="analysis-profile-speed" title={category === "straight" ? "Максимальная скорость на участках прямых." : "Медиана минимальных скоростей в поворотах выбранной группы."}>
            <span><strong>{category === "straight" ? "Максимальная скорость" : "Типичная скорость"}</strong><small>{categoryLabels[category]}</small></span>
            {[analysis.reference, analysis.other].map((driver) => <span key={driver} style={{ color: colors[driver] }}><small>{comparison.traces[driver].driver.code}</small><strong>{speedValues[driver] == null ? "—" : `${number(speedValues[driver], 0)} км/ч`}</strong></span>)}
          </div>
        </div>
      </>}
    </section>
    <TelemetryTrack comparison={comparison} cursor={cursor} onCorner={onExit} onSector={() => {}} regions={regions} caption={`${categoryLabels[category]} · ${rows.length} участков`} />
  </div>;
}

function RepeatConclusion({ summary, label, comparison, analysis }: { summary: RepeatSummary; label: string; comparison: Comparison; analysis: TelemetryAnalysis }) {
  if (summary.pairs < 2) return <p className="analysis-muted">{label}: {summary.pairs === 1 ? "есть одна пара кругов — для повторяемости нужна ещё одна." : "пока не хватает проездов с точным временем участка."}</p>;
  const [wins, losses] = summary.wins;
  const winner = wins > losses ? analysis.reference : losses > wins ? analysis.other : null;
  return <p className="analysis-repeat-conclusion">{label}: {winner == null ? summary.neutral === summary.pairs ? `темп близкий в ${summary.pairs} сравнениях.` : `преимущество менялось между кругами (${summary.pairs} сравнения).` : `${comparison.traces[winner].driver.code} быстрее в ${Math.max(wins, losses)} из ${summary.pairs} сравнений.`}
    {winner != null && Math.max(wins, losses) >= 2 && summary.medianGain != null && <> Типичная разница — {number(Math.abs(summary.medianGain), 3)} с.</>}
  </p>;
}

function ExitWorkspace({ comparison, analysis, cursor, corner, onCorner }: Omit<AnalysisProps, "onInspect"> & { corner?: number; onCorner: (corner: number) => void }) {
  const exit = analysis.exits.find((item) => item.corner === corner) ?? analysis.exits[0];
  const exitDistance = exit?.exit;
  useEffect(() => { if (exitDistance != null) cursor.set(exitDistance); }, [cursor, exitDistance]);
  if (!exit) return <Unavailable title="Разбор выходов пока недоступен" description="Для него нужна разметка поворотов на этой трассе." />;
  const colors = getTraceColors(comparison), ref = analysis.reference, other = analysis.other;
  const range: [number, number] = [exit.from, exit.to];
  const index = analysis.exits.indexOf(exit);
  const firstFull = exit.fullThrottle[ref], secondFull = exit.fullThrottle[other];
  const throttleDifference = firstFull == null || secondFull == null ? null : secondFull - firstFull;
  const resolution = Math.max(25, Math.max(...comparison.traces.map((t) => (t.metrics.topSpeed ?? 0) / 3.6 * t.quality.sampleIntervalSeconds * 2)));
  const regions: TrackRegion[] = [{ id: "exit", from: analysis.sections.find((s) => s.corner === exit.corner)?.apex ?? exit.from, to: exit.exit,
    color: !exit.exitVerified || exit.exitGain == null || Math.abs(exit.exitGain) < exit.exitNeutralSeconds ? "var(--muted-foreground)" : colors[exit.exitGain > 0 ? ref : other], label: "Выход из поворота", selected: true }];
  if (exit.to > exit.exit) regions.push({ id: "straight", from: exit.exit, to: exit.to,
    color: !exit.straightVerified || exit.straightGain == null || Math.abs(exit.straightGain) < exit.straightNeutralSeconds ? "var(--muted-foreground)" : colors[exit.straightGain > 0 ? ref : other], label: "Следующая прямая" });
  return <div className="analysis-workspace analysis-exits">
    <section className="analysis-panel">
      <header className="analysis-heading"><div><h2>Выходы и разгон</h2><p>Скорость, газ и преимущество при разгоне</p></div>
        <div className="analysis-corner-control"><Button variant="ghost" size="icon" aria-label="Предыдущий поворот" disabled={index === 0} onClick={() => onCorner(analysis.exits[index - 1].corner)}><ChevronLeft /></Button>
          <Select value={String(exit.corner)} onValueChange={(value) => onCorner(Number(value))}><SelectTrigger aria-label="Поворот для разбора"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{analysis.exits.map((item) => <SelectItem key={item.corner} value={String(item.corner)}>Поворот {item.corner}</SelectItem>)}</SelectGroup></SelectContent></Select>
          <Button variant="ghost" size="icon" aria-label="Следующий поворот" disabled={index === analysis.exits.length - 1} onClick={() => onCorner(analysis.exits[index + 1].corner)}><ChevronRight /></Button>
        </div>
      </header>
      <div className="analysis-facts"><div><span>Скорость на выходе</span><strong><span style={{ color: colors[ref] }}>{number(exit.speeds[ref], 0)}</span> / <span style={{ color: colors[other] }}>{number(exit.speeds[other], 0)}</span> км/ч</strong></div>
        <div><span>Полный газ</span><strong>{throttleDifference == null ? "Не хватает данных" : Math.abs(throttleDifference) < resolution ? "Близкие точки разгона" : `${comparison.traces[throttleDifference > 0 ? ref : other].driver.code} на ${number(Math.abs(throttleDifference), 0)} м раньше`}</strong></div>
        <div><span>Следующая прямая</span><strong><Gain gain={exit.straightGain} comparison={comparison} analysis={analysis} threshold={exit.straightNeutralSeconds} verified={exit.straightVerified} /></strong></div>
      </div>
      <div className="analysis-local-charts"><TelemetryChart comparison={comparison} channel="speed" range={range} onRange={() => {}} cursor={cursor} compact interactiveRange={false} traceIndices={[ref, other]} distanceOrigin={exit.exit} markers={[{ distance: exit.exit, label: "Выход" }]} />
        <TelemetryChart comparison={comparison} channel="throttle" range={range} onRange={() => {}} cursor={cursor} compact interactiveRange={false} traceIndices={[ref, other]} distanceOrigin={exit.exit} markers={[{ distance: exit.exit, label: "Выход" }]} /></div>
      <p className="analysis-muted">0 м — выход из поворота; дальше показана следующая прямая.</p>
      <div className="analysis-repeats"><h3>Повторяемость преимущества</h3>
        {exit.repeats.length ? <><Table><TableHeader><TableRow><TableHead>Круги {comparison.traces[ref].driver.code} / {comparison.traces[other].driver.code}</TableHead><TableHead>На выходе</TableHead><TableHead>На прямой</TableHead></TableRow></TableHeader><TableBody>{exit.repeats.map((row) => <TableRow key={row.laps.join(":")} data-state={row.laps[0] === comparison.traces[ref].lap.number && row.laps[1] === comparison.traces[other].lap.number ? "selected" : undefined}><TableCell>{row.laps.join(" / ")}<small className="analysis-tyre-context">{row.compounds[0] === row.compounds[1] ? `${row.compounds[0] ?? "Шины неизвестны"} · ${row.tyreAges[0] ?? "—"} / ${row.tyreAges[1] ?? "—"} круг.` : row.compounds.map((compound, i) => `${compound ?? "Шины неизвестны"} · ${row.tyreAges[i] ?? "—"} круг.`).join(" / ")}</small></TableCell><TableCell><Gain gain={row.exitGain} comparison={comparison} analysis={analysis} threshold={row.exitNeutralSeconds} verified={row.exitVerified} emptyLabel="—" /></TableCell><TableCell><Gain gain={row.straightGain} comparison={comparison} analysis={analysis} threshold={row.straightNeutralSeconds} verified={row.straightVerified} emptyLabel="—" /></TableCell></TableRow>)}</TableBody></Table>
          <RepeatConclusion summary={exit.repeatSummary.exit} label="На выходе" comparison={comparison} analysis={analysis} />
          <RepeatConclusion summary={exit.repeatSummary.straight} label="На прямой" comparison={comparison} analysis={analysis} />
          <p className="analysis-muted">Шины и их возраст показаны для каждой пары. «≈» — оценка без проверки по секторному таймингу.</p>
        </> : <p className="analysis-muted">{analysis.repeatability.reason === "average" ? "Средний темп объединяет несколько кругов. Повторяемость проверяем на отдельных кругах." : analysis.repeatability.reason === "sessions" ? "Для повторяемости нужны два пилота в одной сессии." : "Пока не хватает проездов с непрерывной телеметрией на этом участке."}</p>}
      </div>
    </section>
    <div className="analysis-map-column"><TelemetryTrack comparison={comparison} cursor={cursor} onCorner={onCorner} onSector={() => {}} selectedCorner={exit.corner} regions={regions} title="Участок на трассе" cursorMarker />
      <dl className="analysis-breakdown"><div><dt>Выход из поворота</dt><dd><Gain gain={exit.exitGain} comparison={comparison} analysis={analysis} threshold={exit.exitNeutralSeconds} verified={exit.exitVerified} /></dd></div><div><dt>Следующая прямая</dt><dd><Gain gain={exit.straightGain} comparison={comparison} analysis={analysis} threshold={exit.straightNeutralSeconds} verified={exit.straightVerified} /></dd></div><div><dt>Выход и прямая</dt><dd><Gain gain={exit.totalGain} comparison={comparison} analysis={analysis} threshold={Math.max(exit.exitNeutralSeconds, exit.straightNeutralSeconds)} verified={exit.exitVerified && exit.straightVerified} /></dd></div></dl>
    </div>
  </div>;
}

function SignalWorkspace({ comparison, analysis, cursor }: Omit<AnalysisProps, "onInspect">) {
  const [trace, setTrace] = useState(analysis.reference);
  const [kinds, setKinds] = useState<SignalKind[]>(["speed-drop", "coasting", "weak-acceleration"]);
  const [selected, setSelected] = useState<string>();
  const colors = getTraceColors(comparison);
  const events = analysis.signals.filter((event) => event.trace === trace && kinds.includes(event.kind));
  const event = events.find((e) => e.id === selected) ?? events[0];
  const eventDistance = event?.from, eventId = event?.id;
  useEffect(() => { if (eventDistance != null) cursor.set(eventDistance); }, [cursor, eventDistance, eventId]);
  const select = (value: TelemetrySignal) => { setSelected(value.id); cursor.set(value.from); };
  const regions: TrackRegion[] = events.map((e, i) => ({ id: e.id, from: e.from, to: e.to, color: signalColors[e.kind],
    label: `${i + 1}. ${signalLabels[e.kind]} · ${number(e.from, 0)}–${number(e.to, 0)} м`, marker: String(i + 1), selected: e.id === event?.id, onSelect: () => select(e) }));
  const range: [number, number] | null = event ? [Math.max(0, event.from - 100), Math.min(comparison.track.length, event.to + 100)] : null;
  return <div className="analysis-workspace analysis-signals">
    <section className="analysis-panel analysis-signal-map">
      <header className="analysis-heading">
        <h2>Управление энергией</h2>
        <Select value={String(trace)} onValueChange={(value) => { setTrace(Number(value)); setSelected(undefined); }}>
          <SelectTrigger aria-label="Пилот для поиска событий"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{comparison.traces.map((t, i) => <SelectItem key={t.lap.id} value={String(i)}>{t.driver.code} · {t.lap.kind === "race_average" ? "средний темп" : `круг ${t.lap.number}`}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </header>
      <fieldset className="analysis-signal-filters"><legend className="sr-only">Какие события показать</legend>{(Object.keys(signalLabels) as SignalKind[]).map((kind) => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={(e) => setKinds(e.target.checked ? [...kinds, kind] : kinds.filter((k) => k !== kind))} /><span aria-hidden="true" style={{ background: signalColors[kind] }} />{signalLabels[kind]}</label>)}</fieldset>
      <TelemetryTrack comparison={comparison} cursor={cursor} onCorner={() => {}} onSector={() => {}} regions={regions} hideCorners />
      <div className="analysis-event-list" aria-label="События на выбранном круге">{events.map((e, i) => <button key={e.id} type="button" aria-pressed={event?.id === e.id} onClick={() => select(e)}><span className="analysis-event-number" style={{ color: signalColors[e.kind] }}>{i + 1}</span><span>{signalLabels[e.kind]}<small>{number(e.from, 0)}–{number(e.to, 0)} м</small></span><strong>{e.kind === "coasting" ? `${number(e.to - e.from, 0)} м` : `${number(e.startSpeed, 0)} → ${number(e.endSpeed, 0)} км/ч`}</strong><ChevronRight aria-hidden="true" /></button>)}</div>
    </section>
    <section className="analysis-panel analysis-signal-detail" aria-live="polite">
      {event && range ? <><header className="analysis-heading"><div><h2>{signalLabels[event.kind]}</h2><p style={{ color: colors[trace] }}>{comparison.traces[trace].driver.code} · круг {comparison.traces[trace].lap.number} · {number(event.duration, 1)} с</p></div></header>
        <div className="analysis-facts"><div><span>Скорость</span><strong>{number(event.startSpeed, 0)} → {number(event.endSpeed, 0)} км/ч</strong></div><div><span>Газ</span><strong>{number(event.throttle, 0)}%</strong></div><div><span>Тормоз на участке</span><strong>Не нажат</strong></div></div>
        <div className="analysis-observation"><p>{event.kind === "speed-drop" ? "Газ нажат полностью, тормоз отпущен, а машина замедляется." : event.kind === "coasting" ? "Пилот отпустил газ и двигался накатом до торможения." : "Ускорение уменьшилось при полном газе, без торможения."}</p>{event.kind !== "speed-drop" && <p>{event.kind === "coasting" ? "Возможна экономия топлива или энергии." : "Ограничение электрической тяги или рекуперация — гипотеза."}<small>Причину нельзя подтвердить: влияют также уклон, ветер, аэродинамика и трафик.</small></p>}</div>
        <div className="analysis-local-charts analysis-signal-charts"><TelemetryChart comparison={comparison} channel="speed" range={range} onRange={() => {}} cursor={cursor} compact interactiveRange={false} traceIndices={[trace]} highlight={[event.from, event.to]} /></div>
        <p className="analysis-muted">{number(event.from, 0)}–{number(event.to, 0)} м · {event.gear == null ? "Есть переключения передач" : `Передача ${event.gear} · без переключений`}</p>
      </> : <Unavailable title={comparison.traces[trace].lap.kind === "race_average" ? "События ищем на отдельных кругах" : "Таких событий на круге не нашли"} description={comparison.traces[trace].lap.kind === "race_average" ? "Усреднённые значения педалей не показывают отдельные действия пилота. Выберите обычный круг." : !kinds.length ? "Включите хотя бы один тип события на карте." : "Попробуйте другой круг или пилота."} />}
    </section>
  </div>;
}
