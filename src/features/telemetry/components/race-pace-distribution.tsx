"use client";

import { useState } from "react";
import { CartesianGrid, LineChart, ResponsiveContainer, XAxis, YAxis, usePlotArea } from "recharts";
import { CircleHelp, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lapTime, teamColor } from "../lib/format";
import { paceDistributionDomain, type PaceDistribution } from "../lib/race-pace";

function PaceBoxes({ rows, domain, active, onActive }: {
  rows: PaceDistribution[]; domain: [number, number]; active: number;
  onActive: (driver: number) => void;
}) {
  const area = usePlotArea();
  if (!area || !rows.length) return null;
  const step = area.width / rows.length;
  const y = (time: number) => area.y + area.height * (1 - (time - domain[0]) / (domain[1] - domain[0]));
  return rows.map((row, index) => {
    const x = area.x + step * (index + 0.5), half = Math.min(18, step * 0.28);
    const color = teamColor(row.driver), top = y(row.q3), height = Math.max(2, y(row.q1) - top);
    return <g key={row.driver.number} className="pace-distribution-box" role="button" tabIndex={0}
      data-driver={row.driver.number} aria-pressed={active === row.driver.number}
      aria-label={`${row.driver.code}: медиана ${lapTime(row.median)}, среднее ${lapTime(row.mean)}, разброс ${row.deviation.toFixed(3)} с, ${row.count} кругов`}
      onMouseEnter={() => onActive(row.driver.number)} onClick={() => onActive(row.driver.number)}
      onFocus={(event) => {
        onActive(row.driver.number);
        event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); onActive(row.driver.number);
        }
      }}>
      <rect className="pace-distribution-hit" x={x - step / 2 + 1} y={area.y} width={step - 2} height={area.height} rx={4} />
      <path d={`M${x} ${y(row.high)}V${y(row.low)}M${x-half/2} ${y(row.high)}H${x+half/2}M${x-half/2} ${y(row.low)}H${x+half/2}`}
        stroke="var(--muted-foreground)" fill="none" strokeWidth={1.5} pointerEvents="none" />
      <rect x={x-half} y={top - (row.q1 === row.q3 ? 1 : 0)} width={half*2} height={height}
        fill={color} stroke="var(--foreground)" strokeOpacity={0.4} rx={1} pointerEvents="none" />
      <path d={`M${x-half} ${y(row.median)}H${x+half}`} stroke="#0b0b0b" strokeWidth={2} pointerEvents="none" />
      {row.outliers.map((point) => <circle key={point.lap} cx={x} cy={y(point.time)} r={2.8}
        fill="var(--card)" stroke="var(--foreground)" strokeOpacity={0.65} pointerEvents="none">
        <title>{row.driver.code} · круг {point.lap} · {lapTime(point.time)}</title>
      </circle>)}
    </g>;
  });
}

export function RacePaceDistribution({ rows }: { rows: PaceDistribution[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const row = rows.find((item) => item.driver.number === active) ?? rows[0];
  const domain = paceDistributionDomain(rows);
  return <div className="pace-distribution">
    <header className="pace-distribution-heading">
      <span>По медиане · пилотов: {rows.length}</span>
      <div>
        <TooltipProvider><Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Что показывает распределение темпа"
              onClick={() => setHelpOpen((open) => !open)}><CircleHelp /></Button>
          </TooltipTrigger>
          <TooltipContent className="pace-distribution-help" side="bottom">
            <p>Прямоугольник охватывает средние 50% кругов. Линия внутри — медиана: половина кругов быстрее неё, половина медленнее.</p>
            <p>Усы показывают крайние времена в пределах 1,5 межквартильного размаха. Остальные круги показаны точками и остаются в расчёте.</p>
            <p>Разброс — стандартное отклонение всех включённых времён. Статистика учитывает выбранные круги и шины, а сглаживание на неё не влияет. Темп также зависит от топлива, трафика и условий трассы.</p>
          </TooltipContent>
        </Tooltip></TooltipProvider>
        <Button variant="outline" size="sm" onClick={() => setTableOpen(true)}><Table2 data-icon="inline-start" />Таблица</Button>
      </div>
    </header>
    <div className="pace-distribution-scroll" role="region" tabIndex={0} aria-label="Распределение времени кругов по пилотам">
      <div className="pace-distribution-chart" style={{ minWidth: Math.max(320, rows.length * 44 + 96) }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1100, height: 420 }}>
          <LineChart data={rows} margin={{ top: 14, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="driver.code" type="category" scale="band" interval={0} height={44} tickLine={false} axisLine={false}
              tick={({ x, y, index }) => <g transform={`translate(${x},${y})`}>
                <text y={12} textAnchor="middle" fill="var(--foreground)" fontSize={11} fontWeight={600}>{rows[index]?.driver.code}</text>
                <text y={28} textAnchor="middle" fill="var(--muted-foreground)" fontSize={10}>{rows[index]?.count} кр.</text>
              </g>} />
            <YAxis type="number" dataKey="median" domain={domain} allowDataOverflow width={72} tickMargin={6} tickLine={false} axisLine={false}
              tickFormatter={(time: number) => lapTime(time).slice(0, -2)} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <PaceBoxes rows={rows} domain={domain} active={row.driver.number} onActive={setActive} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
    <section className="pace-distribution-detail" aria-label="Значения выбранного пилота">
      <div className="pace-distribution-identity" style={{ borderColor: teamColor(row.driver) }}>
        <strong>{row.driver.code}</strong><span>{row.driver.name}</span>
        <small>{row.count} кр.{row.count < 5 ? " · мало кругов" : ""}</small>
      </div>
      <div><span>Средний круг</span><strong>{lapTime(row.mean)}</strong></div>
      <div><span>Медиана</span><strong>{lapTime(row.median)}</strong></div>
      <div><span>Разброс</span><strong>{row.deviation.toFixed(3).replace(".", ",")} с</strong></div>
      <div><span>Средние 50% кругов</span><strong>{lapTime(row.q1)}–{lapTime(row.q3)}</strong></div>
    </section>
    <Dialog open={tableOpen} onOpenChange={setTableOpen}>
      <DialogContent className="telemetry-settings-dialog pace-distribution-table-dialog">
        <DialogHeader><DialogTitle>Распределение темпа</DialogTitle>
          <DialogDescription>Пилоты отсортированы по медиане времени круга. Все значения рассчитаны с текущими фильтрами.</DialogDescription>
        </DialogHeader>
        <div className="pace-distribution-table-scroll">
          <Table><TableHeader><TableRow><TableHead>Пилот</TableHead><TableHead>Круги</TableHead><TableHead>Среднее</TableHead><TableHead>Медиана</TableHead><TableHead>Разброс, с</TableHead><TableHead>Средние 50%</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((item) => <TableRow key={item.driver.number}>
              <TableCell><strong>{item.driver.code}</strong><small>{item.driver.name}</small></TableCell>
              <TableCell>{item.count}{item.count < 5 && <small>Мало кругов</small>}</TableCell>
              <TableCell>{lapTime(item.mean)}</TableCell><TableCell>{lapTime(item.median)}</TableCell>
              <TableCell>{item.deviation.toFixed(3).replace(".", ",")}</TableCell>
              <TableCell>{lapTime(item.q1)}–{lapTime(item.q3)}</TableCell>
            </TableRow>)}</TableBody></Table>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
