"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Info, Layers3, Search, X, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { components, systems, rearWingOptions, type SystemId, type RearWingVariant } from "./catalog";
import { ersPowerLimit } from "./model";

const W17Viewer = dynamic(() => import("./w17-viewer"), { ssr: false, loading: () => <div className="an-model-placeholder">Загружаем болид…</div> });
const W17ComponentViewer = dynamic(() => import("./w17-viewer").then(module => module.W17ComponentViewer), { ssr: false });
type Panel = "catalog" | "detail" | "energy" | "about" | null;

export function AnatomyExplorer() {
  const [selectedId, setSelectedId] = useState("engine");
  const [system, setSystem] = useState<SystemId | "all">("all");
  const [query, setQuery] = useState("");
  const [aero, setAero] = useState<"corner" | "straight">("corner");
  const [rearWing, setRearWing] = useState<RearWingVariant>("mercedes");
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const root = useRef<HTMLDivElement>(null);
  const detailBody = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const selected = components.find(c => c.id === selectedId) ?? components[5];
  const selectedIndex = components.indexOf(selected);
  const previous = components[(selectedIndex + components.length - 1) % components.length];
  const next = components[(selectedIndex + 1) % components.length];
  const results = components.filter(c => (system === "all" || c.system === system) && `${c.name} ${c.tag} ${c.parts}`.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru").trim()));

  function openPanel(next: Exclude<Panel, null>) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPanel(next);
  }

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => { el.dataset.visible = String(entry.isIntersecting); });
    observer.observe(el);
    const visibility = () => { el.dataset.documentVisible = String(!document.hidden); };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  function openDetail(id: string) {
    setSelectedId(id);
    openPanel("detail");
  }
  function showComponent(id: string) {
    setSelectedId(id);
    detailBody.current?.scrollTo({ top: 0 });
  }
  const viewerProps = { selected: selectedId, onSelect: setSelectedId, phase: "acceleration" as const, together: false, running, onRunningChange:setRunning, playing: !panel, aero, onAeroChange: setAero, rearWing, onRearWingChange: setRearWing };

  return <div className="an-explorer an-studio stitch-panel" ref={root} data-playing={!panel} data-phase="acceleration" data-visible="true">
    <header className="an-explorer-header">
      <div className="an-explorer-title"><h1>Болид Формулы-1</h1><span>Сезон 2026</span></div>
      <div className="an-header-actions">
        <Button variant="ghost" size="sm" aria-haspopup="dialog" onClick={() => openPanel("catalog")} aria-label="Все узлы"><Layers3/><span className="an-action-label">Все узлы</span></Button>
        <Button variant="ghost" size="sm" className="an-energy-action" aria-haspopup="dialog" onClick={() => openPanel("energy")}><Zap/>ERS</Button>
        <Button variant="ghost" size="icon" aria-label="О модели" aria-haspopup="dialog" onClick={() => openPanel("about")}><Info/></Button>
      </div>
    </header>
    <div className="an-cockpit-layout">
      <W17Viewer {...viewerProps} onSelect={openDetail}/>

    </div>

    <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}>
      <DialogContent className={cn("an-page an-dialog", panel === "catalog" && "an-catalog-dialog")} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }} onKeyDown={event => {
        if (panel !== "detail" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.isContentEditable || target.closest("input, textarea, select, [role=slider], .an-component-3d")) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          showComponent(event.key === "ArrowLeft" ? previous.id : next.id);
        }
      }}>
        <DialogHeader>
          <DialogTitle aria-live={panel === "detail" ? "polite" : undefined} aria-atomic="true">{panel === "catalog" ? "Все узлы болида" : panel === "detail" ? selected.name : panel === "energy" ? "Мощность ERS" : "О модели"}</DialogTitle>
          <DialogDescription className="sr-only">{panel === "catalog" ? "Найди узел или выбери систему" : panel === "detail" ? selected.tag : panel === "energy" ? "Зависимость допустимой мощности от скорости" : "Характеристики и режимы просмотра"}</DialogDescription>
          {panel === "detail" && <div className="an-detail-nav" role="group" aria-label="Переключение узлов">
            <Button type="button" variant="outline" size="icon" aria-label={`Предыдущий узел: ${previous.name}`} title={previous.name} onClick={() => showComponent(previous.id)}><ArrowLeft aria-hidden="true"/></Button>
            <span className="an-detail-position">{selectedIndex + 1} из {components.length}</span>
            <Button type="button" variant="outline" size="icon" aria-label={`Следующий узел: ${next.name}`} title={next.name} onClick={() => showComponent(next.id)}><ArrowRight aria-hidden="true"/></Button>
          </div>}
        </DialogHeader>
        {panel === "catalog" && <>
          <div className="an-search"><Search size={16} aria-hidden="true"/><Input aria-label="Найти узел" placeholder="Двигатель, тормоза, батарея…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="Очистить поиск" type="button" onClick={() => setQuery("")}><X size={15}/></button>}</div>
          <div className="an-system-controls" role="radiogroup" aria-label="Система болида">{[{ id: "all", name: "Все" }, ...systems.map(s => ({ id: s.id, name: s.short }))].map(s => <label key={s.id} className={cn(system === s.id && "is-active")}><input type="radio" name="system" checked={system === s.id} onChange={() => setSystem(s.id as SystemId | "all")}/>{s.name}</label>)}</div>
          <div className="an-dialog-body an-catalog-results" aria-live="polite">{results.length ? <div className="an-components">{results.map(c => <button className={cn("an-component", selectedId === c.id && "is-selected")} key={c.id} type="button" aria-pressed={selectedId === c.id} onClick={() => { setSelectedId(c.id); setPanel("detail"); }}><span className="an-list-number">{String(components.indexOf(c) + 1).padStart(2, "0")}</span><strong>{c.name}</strong><ArrowRight size={15} aria-hidden="true"/></button>)}</div> : <div className="an-no-results"><p>Такого узла не нашлось</p><button type="button" onClick={() => { setQuery(""); setSystem("all"); }}>Показать все узлы<ArrowLeft size={14}/></button></div>}</div>
        </>}
        {panel === "detail" && <div className="an-dialog-body an-explanation" ref={detailBody}>
            {selectedId==="rear-wing"&&<p>{rearWingOptions.find(wing=>wing.id===rearWing)?.detail}</p>}
            <p>{selected.description}</p>
            <W17ComponentViewer key={selectedId} {...viewerProps} playing initialOpen={["brakes","cooling","battery","inverter","fuel"].includes(selectedId)} initialView={selectedId==="bodywork"?"underside":"perspective"}/>
            <h3>Как работает</h3><ol className="an-steps">{selected.steps.map((step, index) => <li key={step}><span>{index + 1}</span><p>{step}</p></li>)}</ol>
            <h3>Что внутри</h3><p>{selected.parts}</p><p>{selected.fact}</p>
            <h3>Работает вместе с</h3><div className="an-related">{selected.related.map(id => <button type="button" key={id} onClick={() => showComponent(id)}>{components.find(c => c.id === id)?.name}<ArrowRight size={12}/></button>)}</div>
        </div>}
        {panel === "energy" && <div className="an-dialog-body"><EnergyLab/></div>}
        {panel === "about" && <div className="an-dialog-body an-about">
          <dl className="an-w17-specs"><div><dt>Длина</dt><dd>менее 5505 <span>мм</span></dd></div><div><dt>Ширина</dt><dd>1900 <span>мм</span></dd></div><div><dt>Высота</dt><dd>970 <span>мм</span></dd></div><div><dt>Силовая установка</dt><dd>V6 · гибрид</dd></div></dl>
          <p>«В движении» показывает замедленную работу болида на месте: двигатель, трансмиссия, приводы, колёса, турбина и насосы работают вместе. Переключись из «В сборе» в другой режим и наведи на корпус, чтобы увидеть механизмы. Нажми «В движении» ещё раз, чтобы остановить их. Здесь показан прямой участок на одной передаче, без поворотов и неровностей.</p>
          <p>Собирательная модель болида сезона 2026. Внешний облик основан на открытых фотографиях; скрытые детали реконструированы.</p>
          <p>Потоки показывают обтекание кузова, путь воздуха через радиаторы к хвосту, ускорение под днищем, отклонение у крыльев и вихревой след. В режиме «В сборе» детали остаются непрозрачными. В остальных режимах обшивка и входные каналы становятся полупрозрачными, чтобы можно было проследить воздух внутри. Цвет и движение передают условную относительную скорость. Это учебная визуализация, а не CFD-расчёт: давление, сопротивление и прижимная сила здесь не измеряются.</p>
        </div>}
      </DialogContent>
    </Dialog>
  </div>;
}

function EnergyLab() {
  const [speed,setSpeed]=useState(300);
  const [overtake,setOvertake]=useState(false);
  const [limited,setLimited]=useState(false);
  const power=ersPowerLimit(speed,overtake,limited);
  return <section className="an-energy-lab" aria-labelledby="energy-lab-title"><div><h2 id="energy-lab-title" className="sr-only">Мощность ERS</h2><p>Как меняется допустимая мощность электромотора со скоростью.</p><a href="https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_c_technical_-_iss_20_-_2026-08-05.pdf#page=64" target="_blank" rel="noreferrer">FIA, статья C5.2.8 <ArrowRight size={14}/></a></div><div className="an-energy-instrument"><div className="an-power-readout"><span>Предел ERS-K</span><output>{Math.round(power)}<small> кВт</small></output></div><svg viewBox="0 0 420 160" role="img" aria-label={`Предел ERS-K при ${speed} км/ч: ${power} кВт`}><path d="M25 15V134H403" className="an-chart-axis"/><path d="M25 74H403M25 15H403" className="an-chart-grid"/><path d={Array.from({length:81},(_,i)=>`${i?"L":"M"}${25+i*4.725} ${134-ersPowerLimit(200+i*2,overtake,limited)/350*119}`).join(" ")} className="an-chart-curve"/><circle cx={25+(speed-200)/160*378} cy={134-power/350*119} r="5" className="an-chart-dot"/><text x="25" y="154">200</text><text x="245" y="154">300</text><text x="352" y="154">360 км/ч</text></svg><label className="an-speed-label" htmlFor="an-speed">Скорость <output>{speed} км/ч</output></label><input id="an-speed" type="range" min="200" max="360" step="1" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/><div className="an-energy-switches"><label><input type="checkbox" checked={overtake} onChange={e=>setOvertake(e.target.checked)}/>Обгон разрешён</label><label><input type="checkbox" checked={limited} onChange={e=>setLimited(e.target.checked)}/>Сектор с ограничением 250 кВт</label></div><p>Предел по регламенту. Реальная отдача зависит от заряда, температуры и стратегии; режим низкого сцепления не учтён.</p></div></section>;
}
