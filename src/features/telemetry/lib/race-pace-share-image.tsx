import { RaceSideShareLogo } from "@/components/racemate/driver-comparison-share-image";
import { formatGrandPrixNameRu } from "@/lib/race-display";
import { lapTime, teamColor } from "./format";
import type { RacePace } from "./types";
import { compoundColors, paceShareCompounds, paceSeries, paceValue, paceLapRange, paceDistribution, paceDistributionDomain,
  type PaceDistribution, type PaceAxis, type PaceLapRange, type PaceSection, type PaceDistributionScope } from "./race-pace";
import { chartText, chartTextWidth, renderAtExportScale, shareFormats, ShareFooter, type ShareFormat } from "./share-image";

export type PaceImageView = {
  axis: PaceAxis;
  compounds: string[];
  drivers: number[];
  hideSafetyCar: boolean;
  trend: boolean;
  field: boolean;
  lapRange?: PaceLapRange;
  section?: PaceSection;
  distributionScope?: PaceDistributionScope;
};
const ink = "#eeeeef", muted = "#a8a8af", border = "#303037";

// Only the selected tyres appear in the export. The all-tyres preset uses one
// multicolour tyre, matching the interactive control and including unknowns.
export function racePaceTyreGraphic(compounds: string[], size: number) {
  const tyres = paceShareCompounds(compounds), width = tyres.length * size;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${width} ${size}">`;
  for (const [index, compound] of tyres.entries()) {
    const cx = size * (index + 0.5), cy = size / 2, radius = size * 0.4;
    const color = compoundColors[compound] ?? ink;
    svg += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#1c1c22" stroke="#42424a"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${radius-4}" fill="#101013" stroke="${compound === "ALL" ? border : color}" stroke-width="3"/>`;
    if (compound === "ALL") {
      const circumference = 2 * Math.PI * (radius - 4);
      for (const [i, value] of ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].entries())
        svg += `<circle cx="${cx}" cy="${cy}" r="${radius-4}" fill="none" stroke="${compoundColors[value]}" stroke-width="3" stroke-dasharray="${circumference/5-2} ${circumference-circumference/5+2}" stroke-dashoffset="${-i*circumference/5}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }
    if (["INTERMEDIATE", "WET"].includes(compound))
      for (const angle of [0,45,90,135,180,225,270,315]) svg += `<path d="M${cx-2} ${cy-radius}l-2 3" stroke="#74747c" transform="rotate(${angle} ${cx} ${cy})"/>`;
    const label = compound === "ALL" ? "ВСЕ" : compound === "UNKNOWN" ? "?" : compound[0];
    const fontSize = size * (compound === "ALL" ? 0.2 : 0.34);
    svg += chartText(label, cx, cy-fontSize/2, fontSize, color, "middle");
  }
  return `data:image/svg+xml;base64,${Buffer.from(svg+"</svg>").toString("base64")}`;
}

// Use the same filtered segments and values as the interactive chart. SVG labels
// reuse the lap export's Geist outlines and remain sharp at either orientation.
export function racePaceGraphic(data: RacePace, view: PaceImageView, width: number, height: number) {
  const range = paceLapRange(data.totalLaps, view.lapRange);
  const series = paceSeries(data, view.axis, view.compounds, { hidePits: true, hideSafetyCar: view.hideSafetyCar, lapRange: range });
  const selected = series.filter((item) => view.drivers.includes(item.driver));
  const points = selected.flatMap((item) => item.points);
  const times = points.map((point) => paceValue(point, view.trend)!);
  const min = times.length ? Math.floor(Math.min(...times) - 0.5) : 0;
  const max = times.length ? Math.ceil(Math.max(...times) + 0.5) : 1;
  const minX = view.axis === "age" ? 0 : range[0] === range[1] ? range[0] - 0.5 : range[0];
  const maxX = view.axis === "age" ? Math.max(1, ...points.map((point) => point.x)) : range[0] === range[1] ? range[1] + 0.5 : range[1];
  const left = 90, top = 20, right = width - 22, bottom = height - 64;
  const x = (value: number) => left + (value - minX) / (maxX - minX) * (right - left);
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="plot"><rect x="${left}" y="${top}" width="${right-left}" height="${bottom-top}"/></clipPath></defs>`;
  for (let i = 0; i <= 5; i++) {
    const value = min + (max - min) * i / 5, yy = y(value);
    svg += `<path d="M${left} ${yy}H${right}" stroke="${border}"/>`;
    svg += chartText(lapTime(value).slice(0, -2), left - 12, yy - 7, 14, muted, "end");
  }
  const ticks = view.axis === "lap" && range[0] === range[1] ? [range[0]]
    : [...new Set(Array.from({ length: 7 }, (_, i) => Math.round(minX + (maxX - minX) * i / 6)))];
  for (const value of ticks) svg += chartText(String(value), x(value), bottom + 16, 14, muted, "middle");
  svg += chartText(view.axis === "age" ? "Возраст шин, кругов" : "Круг гонки", (left + right) / 2, height - 22, 15, muted, "middle");
  svg += `<g clip-path="url(#plot)">`;
  const visible = series.filter((item) => view.field || view.drivers.includes(item.driver))
    .sort((a, b) => Number(view.drivers.includes(a.driver)) - Number(view.drivers.includes(b.driver)));
  for (const segment of visible) {
    const driver = data.drivers.find((item) => item.number === segment.driver)!;
    const color = teamColor(driver), highlight = view.drivers.includes(segment.driver);
    const coordinates = segment.points.map((point) => `${x(point.x).toFixed(2)},${y(paceValue(point, view.trend)!).toFixed(2)}`).join(" ");
    svg += `<polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="${highlight ? 2.4 : 0.8}" opacity="${highlight ? 1 : 0.08}" stroke-linejoin="round"/>`;
    if (highlight) for (const point of segment.points) svg += `<circle cx="${x(point.x).toFixed(2)}" cy="${y(paceValue(point, view.trend)!).toFixed(2)}" r="2" fill="${color}"/>`;
  }
  svg += "</g></svg>";
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function racePaceDistributionGraphic(rows: PaceDistribution[], width: number, height: number, summary = true) {
  const domain = paceDistributionDomain(rows);
  const left = 84, right = width - 16, top = 16, bottom = height - (summary ? 144 : 58);
  const step = (right-left) / Math.max(1, rows.length);
  const y = (time: number) => bottom - (time-domain[0]) / (domain[1]-domain[0]) * (bottom-top);
  const widest = Math.max(1, ...rows.flatMap(row => [row.mean.toFixed(2),row.median.toFixed(2),row.deviation.toFixed(2)]).map(text=>chartTextWidth(text,1)));
  const size = Math.min(13, (step-6)/widest);
  const codeSize = summary ? size+1 : 12;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  for (let i = 0; i <= 5; i++) {
    const time = domain[0] + (domain[1]-domain[0])*i/5;
    svg += `<path d="M${left} ${y(time)}H${right}" stroke="${border}"/>`;
    svg += chartText(lapTime(time).slice(0,-2), left-10, y(time)-7, 13, muted, "end");
  }
  for (const [index, row] of rows.entries()) {
    const x = left + step*(index+0.5), half = Math.min(22, step*0.28), color = teamColor(row.driver);
    svg += `<path d="M${x} ${y(row.high)}V${y(row.low)}M${x-half/2} ${y(row.high)}H${x+half/2}M${x-half/2} ${y(row.low)}H${x+half/2}" stroke="${muted}" fill="none"/>`;
    svg += `<rect x="${x-half}" y="${y(row.q3)-(row.q1===row.q3?1:0)}" width="${half*2}" height="${Math.max(2,y(row.q1)-y(row.q3))}" fill="${color}" stroke="${ink}" stroke-opacity="0.4"/>`;
    svg += `<path d="M${x-half} ${y(row.median)}H${x+half}" stroke="#09090b" stroke-width="2"/>`;
    for (const point of row.outliers) svg += `<circle cx="${x}" cy="${y(point.time)}" r="2.5" stroke="${muted}" fill="#111114"/>`;
    svg += chartText(row.driver.code, x, bottom+18, codeSize, ink, "middle");
    if (summary) for (const [i, value] of [row.mean.toFixed(2), row.median.toFixed(2), row.deviation.toFixed(2), String(row.count)].entries())
      svg += chartText(value, x, bottom+44+i*23, size, muted, "middle");
    else svg += chartText(String(row.count), x, bottom+38, 10, muted, "middle");
  }
  if (summary) for (const [index, label] of ["Среднее, с", "Медиана, с", "Разброс, с", "Круги"].entries())
    svg += chartText(label, left-10, bottom+44+index*23, 10, muted, "end");
  return `data:image/svg+xml;base64,${Buffer.from(svg+"</svg>").toString("base64")}`;
}

function RacePaceDistributionImage({ data, view, format, meetingName }: {
  data: RacePace; view: PaceImageView; format: ShareFormat; meetingName?: string;
}) {
  const [width, height] = shareFormats[format], vertical = format === "vertical", pad = vertical ? 36 : 24;
  const range = paceLapRange(data.totalLaps, view.lapRange);
  const rows = paceDistribution(data, view.compounds, { hidePits: true, hideSafetyCar: view.hideSafetyCar, lapRange: range },
    view.distributionScope === "selected" ? view.drivers : undefined);
  const chartWidth = width-pad*2, chartHeight = height-(vertical ? 850 : 300);
  const pilotForm = new Intl.PluralRules("ru").select(rows.length);
  const rangeLabel = range[0] === range[1] ? `круг ${range[0]}` : `круги ${range[0]}–${range[1]}`;
  return renderAtExportScale(<div style={{ display: "flex", flexDirection: "column", width, height, padding: pad,
    paddingBottom: vertical ? 110 : 64, gap: vertical ? 20 : 12, boxSizing: "border-box", background: "#09090b", color: ink, fontFamily: "Geist Sans", position: "relative" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <span style={{ color: "#ed1c24", fontSize: vertical ? 24 : 16, fontWeight: 700 }}>ТЕМП ГОНКИ · {data.session.season}</span>
        <span style={{ fontSize: vertical ? 46 : 34, fontWeight: 900 }}>{formatGrandPrixNameRu(meetingName ?? data.session.country)}</span>
        <span style={{ color: muted, fontSize: vertical ? 22 : 15 }}>{data.session.circuit} · {rangeLabel}</span>
      </div><RaceSideShareLogo />
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: vertical ? 28 : 21, fontWeight: 700 }}>Распределение темпа · {rows.length} {pilotForm === "one" ? "пилот" : pilotForm === "few" ? "пилота" : "пилотов"}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- Self-contained SVG tyre symbols for ImageResponse. */}
      {view.compounds.length > 0 && <img alt="Выбранные шины" width={paceShareCompounds(view.compounds).length*42} height={42} src={racePaceTyreGraphic(view.compounds,42)} />}
    </div>
    <span style={{ color: muted, fontSize: vertical ? 18 : 13 }}>По медиане · {view.hideSafetyCar ? "Без SC / VSC" : "С кругами под SC / VSC"} · исходные времена</span>
    {/* eslint-disable-next-line @next/next/no-img-element -- Standard box plot generated from the same statistics as the screen. */}
    <img alt="Распределение времени кругов по пилотам" width={chartWidth} height={chartHeight}
      src={racePaceDistributionGraphic(rows,chartWidth,chartHeight,!vertical)} />
    {vertical && <div style={{ display: "flex", gap: 16 }}>
      {[rows.slice(0,Math.ceil(rows.length/2)),rows.slice(Math.ceil(rows.length/2))].map((half,index)=><div key={index} style={{ display: "flex",flexDirection:"column",width:(chartWidth-16)/2,gap:7 }}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:muted}}>
          <span style={{width:46}}>Пилот</span><span style={{width:80,textAlign:"right"}}>Среднее, с</span><span style={{width:80,textAlign:"right"}}>Медиана, с</span><span style={{width:70,textAlign:"right"}}>Разброс, с</span><span style={{width:46,textAlign:"right"}}>Круги</span>
        </div>
        {half.map(row=><div key={row.driver.number} style={{display:"flex",justifyContent:"space-between",fontSize:14,borderTop:`1px solid ${border}`,paddingTop:5}}>
          <span style={{width:46,fontWeight:700}}>{row.driver.code}</span><span style={{width:80,textAlign:"right"}}>{row.mean.toFixed(2)}</span><span style={{width:80,textAlign:"right"}}>{row.median.toFixed(2)}</span><span style={{width:70,textAlign:"right"}}>{row.deviation.toFixed(2)}</span><span style={{width:46,textAlign:"right"}}>{row.count}</span>
        </div>)}
      </div>)}
    </div>}
    <span style={{ color: muted, fontSize: vertical ? 18 : 12 }}>Прямоугольник: средние 50% кругов · линия: медиана · точки: необычные круги</span>
    <ShareFooter vertical={vertical} />
  </div>);
}

export function RacePaceShareImage({ data, view, format, meetingName }: {
  data: RacePace; view: PaceImageView; format: ShareFormat; meetingName?: string;
}) {
  if (view.section === "distribution") return <RacePaceDistributionImage data={data} view={view} format={format} meetingName={meetingName} />;
  const [width, height] = shareFormats[format], vertical = format === "vertical";
  const pad = vertical ? 36 : 24;
  const drivers = data.drivers.filter((driver) => view.drivers.includes(driver.number));
  const range = paceLapRange(data.totalLaps, view.lapRange);
  const fullRace = range[0] === 1 && range[1] === data.totalLaps;
  const rangeLabel = range[0] === range[1] ? `Круг ${range[0]}` : `Круги ${range[0]}–${range[1]}`;
  const series = paceSeries(data, view.axis, view.compounds, { hidePits: true, hideSafetyCar: view.hideSafetyCar, lapRange: range });
  const chartWidth = width-pad*2-(vertical ? 44 : 36);
  const tyreSize = vertical ? 54 : 42;
  const shareTyres = paceShareCompounds(view.compounds);
  const chartHeight = vertical ? 1260 - Math.ceil(drivers.length / 2) * 112 - drivers.length * 36 : 480 - drivers.length * 24;
  const root = (
    <div style={{ display: "flex", flexDirection: "column", width, height, padding: pad, gap: vertical ? 24 : 10,
      paddingBottom: vertical ? 110 : 64, boxSizing: "border-box", background: "#09090b", color: ink, fontFamily: "Geist Sans", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
          <span style={{ display: "flex", color: "#ed1c24", fontSize: vertical ? 24 : 16, fontWeight: 700 }}>ТЕМП ГОНКИ · {data.session.season}</span>
          <span style={{ display: "flex", fontSize: vertical ? 46 : 34, fontWeight: 900, letterSpacing: "-0.035em" }}>{formatGrandPrixNameRu(meetingName ?? data.session.country)}</span>
          <span style={{ display: "flex", color: muted, fontSize: vertical ? 22 : 15 }}>{data.session.circuit} · {fullRace ? `${data.totalLaps} кругов` : rangeLabel}</span>
        </div>
        <RaceSideShareLogo />
      </div>
      <div style={{ display: "flex", flexWrap: vertical ? "wrap" : "nowrap", gap: vertical ? 16 : 12 }}>
        {drivers.map((driver) => {
          const laps = series.filter((item) => item.driver === driver.number).flatMap((item) => item.points);
          const ordered = laps.map((point) => point.time!).sort((a, b) => a-b);
          const middle = Math.floor(ordered.length / 2);
          const median = ordered.length ? ordered.length % 2 ? ordered[middle] : (ordered[middle-1] + ordered[middle]) / 2 : null;
          return <div key={driver.number} style={{ display: "flex", flexDirection: "column", width: vertical ? (width-pad*2-16)/2 : (width-pad*2-12*(drivers.length-1))/Math.max(1,drivers.length),
            boxSizing: "border-box", flexShrink: 0, borderLeft: `4px solid ${teamColor(driver)}`, background: "#17171b", padding: vertical ? 12 : 8, gap: 3 }}>
            <span style={{ display: "flex", color: teamColor(driver), fontSize: vertical ? 24 : 18, fontWeight: 900 }}>{driver.code}</span>
            <span style={{ display: "flex", fontSize: vertical ? 18 : 12 }}>{driver.name}</span>
            <span style={{ display: "flex", color: muted, fontSize: vertical ? 15 : 11 }}>{laps.length} кр. · медиана {lapTime(median)}</span>
          </div>;
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", background: "#111114", border: `1px solid ${border}`, borderRadius: 12, padding: vertical ? 22 : 18, gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", fontSize: vertical ? 28 : 21, fontWeight: 700 }}>{view.axis === "age" ? "По возрасту шин" : "По кругам гонки"}</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- Tyre symbols use outlined Geist glyphs in the PNG. */}
          {shareTyres.length > 0 && <img alt="Выбранные шины" width={shareTyres.length*tyreSize} height={tyreSize}
            src={racePaceTyreGraphic(view.compounds,tyreSize)} />}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- Self-contained vector chart for ImageResponse. */}
        <img alt="Темп выбранных пилотов" width={chartWidth} height={chartHeight}
          src={racePaceGraphic(data,view,chartWidth,chartHeight)} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: vertical ? 12 : 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "flex", fontSize: vertical ? 26 : 19, fontWeight: 700 }}>Смена шин</span>
          <span style={{ display: "flex", color: muted, fontSize: vertical ? 15 : 11 }}>Вся гонка</span>
        </div>
        {drivers.map((driver) => <div key={driver.number} style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ display: "flex", width: vertical ? 70 : 52, color: teamColor(driver), fontSize: vertical ? 23 : 15, fontWeight: 700 }}>{driver.code}</span>
          <div style={{ display: "flex", position: "relative", flex: 1, height: vertical ? 28 : 16, background: "#202025", borderRadius: 4, overflow: "hidden" }}>
            {data.stints.filter((stint) => stint.driver === driver.number && view.compounds.includes(stint.compound)).map((stint) => <div key={stint.from} style={{ display: "flex", position: "absolute", top: 0, bottom: 0,
              left: `${(stint.from-1)/data.totalLaps*100}%`, width: `${(stint.to-stint.from+1)/data.totalLaps*100}%`, background: compoundColors[stint.compound] ?? compoundColors.UNKNOWN,
              borderRight: "2px solid #09090b", alignItems: "center", justifyContent: "center", gap: 7, color: "#151515", fontSize: vertical ? 16 : 10, overflow: "hidden" }}>
              <span style={{ display: "flex", fontWeight: 900 }}>{stint.compound === "UNKNOWN" ? "?" : stint.compound[0]}</span>
              {stint.to-stint.from > 5 && <span style={{ display: "flex" }}>{stint.from}–{stint.to}</span>}
            </div>)}
            {/* ImageResponse needs direct children to draw the range masks. */}
            {!fullRace && [
              <div key="before" style={{ display: "flex", position: "absolute", top: 0, bottom: 0, left: 0,
                width: `${(range[0]-1)/data.totalLaps*100}%`, background: "#09090bcc" }} />,
              <div key="after" style={{ display: "flex", position: "absolute", top: 0, bottom: 0, right: 0,
                width: `${(data.totalLaps-range[1])/data.totalLaps*100}%`, background: "#09090bcc" }} />,
            ]}
          </div>
        </div>)}
      </div>
      <ShareFooter vertical={vertical} />
    </div>
  );
  return renderAtExportScale(root);
}
