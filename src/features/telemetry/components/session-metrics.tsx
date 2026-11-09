"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Cog, Download, Share2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Session, SessionLapMetric, SessionMetrics } from "../lib/types";
import { telemetryRequest } from "../lib/client";
import { lapTime, teamColor } from "../lib/format";
import { formatMetric, metricDomain, metricMapLayout, metricHelp, metricTeamLabel, metricTitles, metricValue, sessionMetricRows, sessionMetricsCsv, type SessionMetric } from "../lib/session-metrics";
import { TelemetryShare } from "./telemetry-share";
import "./session-metrics.css";

export function SessionMetricsWorkspace({ session, metric, onMetricChange, actionsContainer }: {
  session: Session; metric: SessionMetric; onMetricChange: (value: SessionMetric) => void; actionsContainer?: HTMLElement | null;
}) {
  const [result, setResult] = useState<{ data?: SessionMetrics; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void telemetryRequest<SessionMetrics>(`session-metrics?session=${session.id}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ data }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : "Не удалось загрузить телеметрию." }); });
    return () => controller.abort();
  }, [session.id, retry]);
  if (!result) return <section className="race-pace-loading" role="status"><Cog className="telemetry-loading-gear" aria-hidden="true" /><div><strong>Готовим скорость и газ</strong><p>Загрузка может занять время</p></div></section>;
  if (!result.data) return <section className="race-pace-empty"><h3>Не удалось загрузить телеметрию</h3><p>{result.error}</p><Button data-slot="button" variant="outline" onClick={() => { setResult(null); setRetry(n=>n+1); }}>Попробовать ещё раз</Button></section>;
  return <SessionMetricsAnalysis data={result.data} metric={metric} onMetricChange={onMetricChange} actionsContainer={actionsContainer} />;
}

export function SessionMetricsAnalysis({ data, metric, onMetricChange, actionsContainer }: {
  data: SessionMetrics; metric: SessionMetric; onMetricChange: (value: SessionMetric) => void; actionsContainer?: HTMLElement | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const rows = sessionMetricRows(data, metric);
  const available = rows.filter(row => metricValue(row, metric) != null && (metric !== "map" || row.averageSpeed != null));
  const current = rows.find(row=>row.driver.number===active) ?? available[0] ?? rows[0];
  const actions = <div className="race-pace-actions">
    <Button data-slot="button" variant="outline" aria-label="CSV" disabled={!rows.length} onClick={() => {
      const url = URL.createObjectURL(new Blob([sessionMetricsCsv(data, metric)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = `raceside-session-${data.session.id}-${metric}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}><Download /><span>CSV</span></Button>
    <Button data-slot="button" variant="outline" aria-label="Поделиться" disabled={!available.length} onClick={() => setShareOpen(true)}><Share2 /><span>Поделиться</span></Button>
  </div>;
  return <section className="race-pace-workspace session-metrics" aria-label="Скорость и газ">
    {actionsContainer ? createPortal(actions, actionsContainer) : actions}
    <header className="session-metrics-heading">
      <div><h3>{metricTitles[metric]}</h3><p>{metric === "speed" ? "Быстрейший круг каждого пилота" : "Быстрейший круг каждой команды"} · вся сессия</p></div>
      <div className="session-metrics-tools"><TooltipProvider><Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
        <TooltipTrigger asChild><Button data-slot="button" variant="ghost" size="icon" aria-label="Как это считается" onClick={() => setHelpOpen(v=>!v)}><CircleHelp /></Button></TooltipTrigger>
        <TooltipContent side="bottom" className="session-metrics-help"><p>{metricHelp[metric]}</p><p>Скорость и газ показываем при покрытии не менее 97% круга. Пропущенные значения остаются пустыми.</p></TooltipContent>
      </Tooltip></TooltipProvider><Button data-slot="button" variant="outline" size="sm" aria-label="Таблица" onClick={() => setTableOpen(true)}><Table2 /><span>Таблица</span></Button></div>
    </header>
    <Tabs value={metric} onValueChange={value => onMetricChange(value as SessionMetric)}><TabsList className="session-metrics-tabs" aria-label="Показатель">
      <TabsTrigger value="speed">Макс. скорость</TabsTrigger><TabsTrigger value="throttle">Полный газ</TabsTrigger><TabsTrigger value="map">Карта скоростей</TabsTrigger>
    </TabsList></Tabs>
    <div className="session-metrics-scroll" tabIndex={0} role="region" aria-label={metricTitles[metric]}>
      {available.length ? <MetricChart rows={available} metric={metric} active={current?.driver.number} onActive={setActive} /> : <div className="race-pace-empty"><h3>Пока не хватает телеметрии</h3><p>В таблице можно посмотреть, какие круги доступны.</p></div>}
    </div>
    <footer className="session-metrics-footer" aria-live="polite">
      {current && <><strong style={{ color: teamColor(current.driver) }}>{metric === "speed" ? current.driver.name : current.driver.team}</strong>
        <span>{current.driver.code} · {current.lap ? `круг ${current.lap.number} · ${lapTime(current.lap.time)}` : "Нет подходящего круга"}</span>
        <b>{metric === "map" ? `${formatMetric(current.averageSpeed, "speed")} в среднем · ${formatMetric(current.topSpeed, "speed")} максимум` : formatMetric(metricValue(current, metric), metric)}</b></>}
      <small>Показано {available.length} из {rows.length}{available.length < rows.length ? " · остальные — в таблице" : ""}</small>
    </footer>
    <Dialog open={tableOpen} onOpenChange={setTableOpen}><DialogContent className="session-metrics-dialog"><DialogHeader><DialogTitle>{metricTitles[metric]}</DialogTitle><DialogDescription>Все показатели в строке относятся к одному быстрейшему подходящему кругу.</DialogDescription></DialogHeader>
      <div className="session-metrics-table"><Table><TableHeader><TableRow><TableHead>{metric === "speed" ? "Пилот" : "Команда"}</TableHead><TableHead>Круг</TableHead><TableHead>Макс., км/ч</TableHead><TableHead>Средняя, км/ч</TableHead><TableHead>Полный газ</TableHead></TableRow></TableHeader><TableBody>
        {rows.map(row=><TableRow key={row.driver.number}><TableCell><strong style={{ color: teamColor(row.driver) }}>{metric === "speed" ? row.driver.name : row.driver.team}</strong>{metric !== "speed" && <small>{row.driver.code}</small>}</TableCell><TableCell>{row.lap ? `${row.lap.number} · ${lapTime(row.lap.time)}` : "Нет подходящего круга"}</TableCell><TableCell>{row.topSpeed ?? "—"}</TableCell><TableCell>{row.averageSpeed?.toFixed(1) ?? "—"}</TableCell><TableCell>{formatMetric(row.fullThrottle, "throttle")}</TableCell></TableRow>)}
      </TableBody></Table></div>
    </DialogContent></Dialog>
    <TelemetryShare open={shareOpen} onOpenChange={setShareOpen} imageSource={`/api/share-image/session-metrics/${data.session.id}?metric=${metric}`} title="Поделиться телеметрией" />
  </section>;
}

function MetricChart({ rows, metric, active, onActive }: { rows: SessionLapMetric[]; metric: SessionMetric; active?: number; onActive: (driver: number) => void }) {
  const map = metric === "map";
  const left=62, right=966, top=44, bottom=370;
  const domain = map ? metricDomain(rows.map(r=>r.topSpeed!)) : [0, Math.ceil(Math.max(...rows.map(r=>metricValue(r,metric)!))*1.08)] as [number,number];
  const xDomain = metricDomain(rows.map(r=>r.averageSpeed ?? 0));
  const y=(value:number)=>bottom-(value-domain[0])/(domain[1]-domain[0])*(bottom-top);
  const x=(value:number)=>left+(value-xDomain[0])/(xDomain[1]-xDomain[0])*(right-left);
  const step=(right-left)/rows.length;
  const mapPoints = map ? metricMapLayout(rows) : [];
  return <svg className="session-metrics-chart" viewBox="0 0 1000 450" role="group" aria-label={metricTitles[metric]}>
    {Array.from({ length:5 }, (_,i)=>{const value=domain[0]+(domain[1]-domain[0])*i/4;return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="var(--border)" strokeDasharray={i ? "3 5" : undefined} /><text x={left-10} y={y(value)+4} textAnchor="end" fill="var(--muted-foreground)" fontSize="12">{value.toFixed(metric === "throttle" ? 0 : 0)}</text></g>;})}
    <text x={left} y={18} fill="var(--muted-foreground)" fontSize="12">{metric === "throttle" ? "Время на полном газу, %" : "Максимальная скорость, км/ч"}</text>
    {map && <>{Array.from({ length:5 },(_,i)=>{const value=xDomain[0]+(xDomain[1]-xDomain[0])*i/4;return <g key={i}><line x1={x(value)} x2={x(value)} y1={top} y2={bottom} stroke="var(--border)" strokeDasharray="3 5" /><text x={x(value)} y={bottom+24} textAnchor="middle" fill="var(--muted-foreground)" fontSize="12">{value.toFixed(1)}</text></g>;})}<text x={(left+right)/2} y={437} textAnchor="middle" fill="var(--muted-foreground)" fontSize="12">Средняя скорость, км/ч</text></>}
    {rows.map((row,i)=>{const value=metricValue(row,metric)!, cx=map?x(row.averageSpeed!):left+step*(i+.5), cy=y(value), color=teamColor(row.driver);
      const label=metric === "speed" ? row.driver.code : metricTeamLabel(row);
      return <g key={row.driver.number} className="session-metric-mark" tabIndex={0} role="button" aria-pressed={active===row.driver.number}
        aria-label={`${label}: ${formatMetric(value,metric)}, ${row.driver.code}, круг ${row.lap?.number}`}
        onMouseEnter={()=>onActive(row.driver.number)} onFocus={()=>onActive(row.driver.number)} onClick={()=>onActive(row.driver.number)}
        onKeyDown={event=>{if(event.key==="Enter" || event.key===" "){event.preventDefault();onActive(row.driver.number);}}}>
        <title>{`${label} · ${row.driver.code} · круг ${row.lap?.number}\n${formatMetric(value,metric)}${map ? ` · средняя ${formatMetric(row.averageSpeed,"speed")}` : ""}`}</title>
        {map ? <><circle cx={cx} cy={cy} r={17} fill="transparent" /><circle cx={cx} cy={cy} r={active===row.driver.number?8:6} fill={color} stroke="var(--foreground)" strokeWidth={active===row.driver.number?2:0} /><line x1={cx} y1={cy} x2={mapPoints[i].labelX} y2={mapPoints[i].labelY-5} stroke={color} opacity={0.4} /><text x={mapPoints[i].labelX} y={mapPoints[i].labelY} textAnchor="middle" fill={color} fontSize="13">{label}</text></> : <>
          <rect x={cx-step/2+1} y={top} width={step-2} height={bottom-top} fill="transparent" />
          <rect x={cx-step*.31} y={cy} width={step*.62} height={Math.max(1,bottom-cy)} rx={2} fill={color} opacity={active===row.driver.number?1:.8} />
          <text x={cx} y={cy-10} textAnchor="middle" fill="var(--foreground)" fontSize="12">{value.toFixed(metric === "throttle" ? 1 : 0)}{metric === "throttle" ? "%" : ""}</text>
          <text x={cx} y={bottom+26} textAnchor={metric === "speed" ? "middle" : "end"} transform={metric === "throttle" ? `rotate(-25 ${cx} ${bottom+26})` : undefined} fill="var(--muted-foreground)" fontSize="12">{label}</text>
        </>}
      </g>;
    })}
  </svg>;
}
