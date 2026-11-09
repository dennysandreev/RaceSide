import { RaceSideShareLogo } from "@/components/racemate/driver-comparison-share-image";
import { formatGrandPrixNameRu } from "@/lib/race-display";
import { teamColor, sessionName } from "./format";
import { metricDomain, metricMapLayout, metricTeamLabel, metricTitles, metricValue, sessionMetricRows, type SessionMetric } from "./session-metrics";
import { chartText, renderAtExportScale, ShareFooter, shareFormats, type ShareFormat } from "./share-image";
import type { SessionMetrics } from "./types";

export function sessionMetricGraphic(data: SessionMetrics, metric: SessionMetric, vertical: boolean) {
  const rows=sessionMetricRows(data,metric).filter(r=>metricValue(r,metric)!=null && (metric!=="map" || r.averageSpeed!=null));
  const height=vertical && metric!=="map" ? Math.max(600,rows.length*58+80) : 450;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}">`;
  const ink="#eeeeef",muted="#a8a8af";
  if(metric==="map") {
    const xd=metricDomain(rows.map(r=>r.averageSpeed!)),yd=metricDomain(rows.map(r=>r.topSpeed!));
    for(let i=0;i<5;i++) {
      const x=62+904*i/4,y=370-326*i/4;
      svg+=`<path d="M62 ${y}H966M${x} 44V370" stroke="#303037" stroke-dasharray="3 5"/>`;
      svg+=chartText((yd[0]+(yd[1]-yd[0])*i/4).toFixed(0),52,y-7,12,muted,"end");
      svg+=chartText((xd[0]+(xd[1]-xd[0])*i/4).toFixed(1),x,387,12,muted,"middle");
    }
    for(const p of metricMapLayout(rows)) {
      const color=teamColor(p.row.driver);
      svg+=`<line x1="${p.x}" y1="${p.y}" x2="${p.labelX}" y2="${p.labelY-5}" stroke="${color}" opacity=".4"/><circle cx="${p.x}" cy="${p.y}" r="6" fill="${color}"/>`;
      svg+=chartText(metricTeamLabel(p.row),p.labelX,p.labelY-10,13,color,"middle");
    }
    svg+=chartText("km/h",62,16,12,muted);
    svg+=chartText("km/h",960,422,12,muted,"end");
  } else if(vertical) {
    const max=Math.max(1,...rows.map(r=>metricValue(r,metric)!));
    rows.forEach((r,i)=>{
      const y=22+i*58,value=metricValue(r,metric)!,color=teamColor(r.driver);
      svg+=chartText(metric==="speed" ? r.driver.code : metricTeamLabel(r),14,y,19,color);
      svg+=`<rect x="200" y="${y}" width="${650*value/max}" height="22" rx="2" fill="${color}"/>`;
      svg+=chartText(value.toFixed(metric==="throttle"?1:0)+(metric==="throttle"?"%":""),970,y,19,ink,"end");
    });
  } else {
    const max=Math.max(1,...rows.map(r=>metricValue(r,metric)!))*1.08,step=904/Math.max(1,rows.length);
    for(let i=0;i<5;i++){const y=370-326*i/4;svg+=`<path d="M62 ${y}H966" stroke="#303037" stroke-dasharray="3 5"/>`;svg+=chartText((max*i/4).toFixed(0),52,y-7,12,muted,"end");}
    rows.forEach((r,i)=>{
      const value=metricValue(r,metric)!,x=62+step*(i+.5),y=370-value/max*326,color=teamColor(r.driver);
      svg+=`<rect x="${x-step*.31}" y="${y}" width="${step*.62}" height="${370-y}" rx="2" fill="${color}"/>`;
      svg+=chartText(value.toFixed(metric==="throttle"?1:0)+(metric==="throttle"?"%":""),x,y-21,12,ink,"middle");
      const label=metric==="speed"?r.driver.code:metricTeamLabel(r);
      svg+=`<g transform="rotate(${metric==="throttle"?-25:0} ${x} 396)">${chartText(label,x,387,12,muted,metric==="throttle"?"end":"middle")}</g>`;
    });
  }
  return { src:`data:image/svg+xml;base64,${Buffer.from(svg+"</svg>").toString("base64")}`,height };
}

export function SessionMetricsShareImage({data,metric,format,meetingName}:{data:SessionMetrics;metric:SessionMetric;format:ShareFormat;meetingName?:string}) {
  const [width,height]=shareFormats[format],vertical=format==="vertical",pad=vertical?44:48;
  const graphic=sessionMetricGraphic(data,metric,vertical), chartWidth=width-pad*2-32;
  const chartHeight=Math.min(vertical?1370:490,chartWidth*graphic.height/1000);
  return renderAtExportScale(<div style={{display:"flex",flexDirection:"column",width,height,padding:pad,gap:vertical?30:20,background:"#09090b",color:"#eeeeef",fontFamily:"Geist Sans",position:"relative"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{display:"flex",flexDirection:"column",gap:8}}>
      <span style={{color:"#ed1c24",fontSize:vertical?24:16,fontWeight:700}}>ТЕЛЕМЕТРИЯ СЕССИИ · {data.session.season}</span>
      <span style={{fontSize:vertical?44:34,fontWeight:900}}>{formatGrandPrixNameRu(meetingName??data.session.country)}</span>
      <span style={{color:"#a8a8af",fontSize:vertical?23:16}}>{data.session.circuit} · {sessionName(data.session.name)}</span>
    </div><RaceSideShareLogo /></div>
    <div style={{display:"flex",flexDirection:"column",gap:12}}><span style={{fontSize:vertical?34:26,fontWeight:700}}>{metricTitles[metric]}</span><span style={{fontSize:vertical?21:15,color:"#a8a8af"}}>{metric==="speed"?"Быстрейший круг каждого пилота":"Быстрейший круг каждой команды"} · вся сессия</span></div>
    {/* eslint-disable-next-line @next/next/no-img-element -- Outlined vector labels for ImageResponse. */}
    <img src={graphic.src} width={chartWidth} height={chartHeight} alt={metricTitles[metric]} />
    <div style={{display:"flex",fontSize:vertical?20:14,color:"#a8a8af",lineHeight:1.5}}>{metric==="map"?"По горизонтали — средняя скорость, по вертикали — максимальная, км/ч. Скорости не измеряют прижимную силу отдельно от других факторов.":metric==="throttle"?"Доля времени с газом от 99%. Учитывается длительность между замерами.":"Максимальная скорость на выбранном быстрейшем круге, км/ч."}</div>
    <ShareFooter vertical={vertical} />
  </div>);
}
