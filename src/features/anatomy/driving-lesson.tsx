"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Disc3, Eye, Gauge, Info, Layers3, Map, Pause, Play, RotateCcw, Route, SkipBack, SkipForward, Wind, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MONZA_MODEL } from "@/data/monza-model";
import { cn } from "@/lib/utils";
import { components } from "./catalog";
import { adjacentLessonTime, LESSON_DURATION, lessonExplanation, lessonSystems, lessonTimeline, phaseNames, timeAtProgress, type LessonFrame, type LessonSystem } from "./monza-lesson";
import { useLessonPlayback, type LessonPlayback } from "./use-lesson-playback";
import { monzaChapters } from "./monza-lesson-track";
import type { LessonCamera } from "./monza-lesson-scene";

const MonzaLessonScene = dynamic(() => import("./monza-lesson-scene").then(module => module.MonzaLessonScene), { ssr: false, loading: () => <div className="an-lesson-scene-loading"><span>Монца</span><p>Готовим трассу и болид…</p></div> });
const W17ComponentViewer = dynamic(() => import("./w17-viewer").then(module => module.W17ComponentViewer), { ssr: false });
const keepAero = () => {};
const keepWing = () => {};
const formatTime = (time: number) => `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

// Keep the model's equal horizontal scale, using north-up X/Z coordinates.
const points = MONZA_MODEL.points;
const bounds = points.reduce((b, p) => ({ minX: Math.min(b.minX, p[1]), maxX: Math.max(b.maxX, p[1]), minY: Math.min(b.minY, p[2]), maxY: Math.max(b.maxY, p[2]) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
const mapScale = Math.min(272 / (bounds.maxX - bounds.minX), 182 / (bounds.maxY - bounds.minY));
const project = (x: number, y: number) => ({ x: 160 + (x - (bounds.minX + bounds.maxX) / 2) * mapScale, y: 110 - (y - (bounds.minY + bounds.maxY) / 2) * mapScale });
function mapPoint(progress: number) {
  const high = points.findIndex(point => point[0] >= progress);
  const b = points[high < 0 ? points.length - 1 : high], a = points[Math.max(0, high - 1)];
  const t = b[0] === a[0] ? 0 : (progress - a[0]) / (b[0] - a[0]);
  return project(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
function trackPath(start: number, end: number) {
  return [mapPoint(start), ...points.filter(p => p[0] > start && p[0] < end).map(p => project(p[1], p[2])), mapPoint(end)].map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
const outline = trackPath(0, 1);
const mapSections = lessonTimeline.map(section => ({ ...section, path: trackPath(section.start, section.end) }));

function MonzaMap({ frame, seek }: { frame: LessonFrame; seek: (time: number) => void }) {
  const car = mapPoint(frame.progress), start = mapPoint(0);
  return <div className="an-lesson-map">

    <svg viewBox="94 0 132 220" role="group" aria-label="Карта учебного круга Монцы">
      <path d={outline} className="an-lesson-track-base"/>
      <path d={mapSections[frame.index].path} className="an-lesson-track-active"/>
      {mapSections.map(section => <path key={section.id} d={section.path} className="an-lesson-track-hit" onClick={() => seek(timeAtProgress((section.start + section.end) / 2))}><title>{section.name}</title></path>)}
      <path d={`M${start.x - 5},${start.y}h10`} className="an-lesson-start"/>
      <circle cx={car.x} cy={car.y} r="7" className="an-lesson-car-halo"/>
      <circle cx={car.x} cy={car.y} r="3.5" className="an-lesson-car"/>
    </svg>

  </div>;
}

function LessonTransport({ playback }: { playback: LessonPlayback }) {
  const { frame, playing, reduced, rate, seek, toggle, setRate } = playback;
  const chapter = monzaChapters.findLast(item => lessonTimeline.find(section => section.id === item.id)!.time <= frame.time)!;
  return <div className="an-lesson-transport">
    <nav className="an-lesson-chapters" aria-label="Участки Монцы">{monzaChapters.map(item => <button type="button" key={item.id} aria-current={chapter.id === item.id ? "step" : undefined} onClick={() => seek(lessonTimeline.find(section => section.id === item.id)!.time)}><span/>{item.name}</button>)}</nav>
    <div className="an-lesson-transport-row">
      <div className="an-lesson-playback-buttons">
        <Button variant="ghost" size="icon" aria-label="Предыдущий момент" disabled={frame.time === 0} onClick={() => seek(adjacentLessonTime(frame.time, -1))}><SkipBack/></Button>
        <Button size="sm" className="an-lesson-play" disabled={reduced} onClick={toggle} aria-label={playing ? "Пауза" : frame.time === LESSON_DURATION ? "Посмотреть ещё раз" : "Воспроизвести круг"}>{playing ? <Pause/> : <Play/>}<span>{playing ? "Пауза" : frame.time === LESSON_DURATION ? "Ещё раз" : "Поехали"}</span></Button>
        <Button variant="ghost" size="icon" aria-label="Следующий момент" disabled={frame.index === lessonTimeline.length - 1} onClick={() => seek(adjacentLessonTime(frame.time, 1))}><SkipForward/></Button>
      </div>
      <div className="an-lesson-scrub">
        <div className="an-lesson-segments" aria-hidden="true">{lessonTimeline.map(section => <i key={section.id} data-phase={section.phase} style={{ flex: section.duration }}/>)}</div>
        <input type="range" min={0} max={LESSON_DURATION} step={.05} value={frame.time} aria-label="Положение на учебном круге" aria-valuetext={`${frame.section.name}, ${phaseNames[frame.phase]}, ${formatTime(frame.time)}`} onChange={event => seek(Number(event.target.value))}/>
      </div>
      <div className="an-lesson-time"><span>{formatTime(frame.time)}</span><span> / {formatTime(LESSON_DURATION)}</span></div>
      <label className="an-lesson-rate"><span className="sr-only">Скорость воспроизведения</span><select aria-label="Скорость воспроизведения" value={rate} onChange={e => setRate(Number(e.target.value))}><option value={.5}>0,5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
      <Button variant="ghost" size="icon" aria-label="В начало круга" onClick={() => seek(0)}><RotateCcw/></Button>
    </div>
    <div className="an-lesson-transport-caption"><span>{reduced ? "Анимация отключена. Выбирай моменты на шкале или стрелками." : "Учебный круг · движение замедлено"}</span><span>{Math.round(frame.progress * 100)}% круга</span></div>
  </div>;
}

const systemIcons = { drive: Gauge, brakes: Disc3, energy: Zap, aero: Wind, chassis: Route };
function brief(system: LessonSystem, frame: LessonFrame) {
  if (system === "drive") return frame.phase === "braking" ? "Газ отпущен, но коленвал и связанные с ним механизмы продолжают вращаться." : "Проследи путь тяги: от движения поршней через коробку передач к задним колёсам.";
  if (system === "brakes") return frame.phase === "braking" ? "Колодки сжимают диски, а MGU-K возвращает часть энергии в батарею. Вместе они замедляют болид." : "Сейчас педаль отпущена, диски вращаются свободно. На торможении в работу включатся колодки и MGU-K.";
  if (system === "energy") return frame.energy === "recover" ? "На торможении MGU-K становится генератором. Энергия движется через инвертор обратно в батарею." : frame.energy === "deploy" ? "Батарея питает MGU-K через инвертор. Электромотор помогает двигателю разгонять болид." : "В этом учебном моменте батарея не отдаёт и не принимает энергию. Её помощь снова включится на разгоне.";
  if (system === "aero") return frame.section.wings ? "На прямой крылья раскрываются, чтобы уменьшить сопротивление. Перед торможением они вернутся в поворотное положение." : "Крылья и днище создают прижим. Видимые потоки помогают проследить, как воздух проходит вокруг машины.";
  return frame.phase === "braking" ? "При торможении нагрузка смещается на передние колёса. Рычаги и амортизаторы контролируют положение машины." : "Рычаги связывают колёса с шасси, а пружины и амортизаторы помогают сохранять контакт с трассой.";
}

export function DrivingLesson({ onExit }: { onExit: () => void }) {
  const playback = useLessonPlayback();
  const { frame, pause } = playback;
  const [system, setSystem] = useState<LessonSystem>("drive");
  const [selectedId, setSelectedId] = useState("engine");
  const [detail, setDetail] = useState(false);
  const [inside, setInside] = useState(false);
  const [cameraMode, setCameraMode] = useState<LessonCamera>("follow");
  const returnFocus = useRef<HTMLElement | null>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const selected = components.find(component => component.id === selectedId)!;
  const currentSystem = lessonSystems.find(item => item.id === system)!;
  const explanation = lessonExplanation(system, frame);
  const lesson = { clock: playback.clock, system, focus: currentSystem.components, revision: frame.time };
  const viewerProps = { selected: selectedId, onSelect: openDetail, phase: frame.phase, together: true, running: playback.playing, playing: playback.playing, aero: frame.wingOpening > 0 ? "straight" as const : "corner" as const, onAeroChange: keepAero, rearWing: "mercedes" as const, onRearWingChange: keepWing, lesson };
  const inspectId = system === "energy" ? "mguk" : system === "aero" ? "front-wing" : currentSystem.components[0];
  useEffect(() => { if (detail) detailTitle.current?.focus({ preventScroll: true }); }, [detail]);

  function openDetail(id: string) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!currentSystem.components.includes(id)) {
      const relatedSystem = lessonSystems.find(item => item.components.includes(id));
      if (relatedSystem) setSystem(relatedSystem.id);
    }
    pause(); setSelectedId(id); setDetail(true);
  }
  function closeDetail() { pause(); setDetail(false); requestAnimationFrame(() => returnFocus.current?.focus({ preventScroll: true })); }

  return <Dialog open onOpenChange={open => { if (!open) onExit(); }}>
    <DialogContent className="an-page an-lesson-experience translate-x-0 translate-y-0" showCloseButton={false} onEscapeKeyDown={event => { if (detail) { event.preventDefault(); closeDetail(); } }}>
      <div className="an-driving-lesson" data-system={system} data-phase={frame.phase} data-lesson-time={frame.time.toFixed(3)} data-lesson-playing={playback.playing} data-inspecting={detail}>
        <header className="an-lesson-header">
          <Button variant="ghost" size="sm" aria-label="К модели" onClick={onExit}><ArrowLeft/><span>К модели</span></Button>
          <div><DialogTitle>Болид в деле</DialogTitle><DialogDescription>Монца · учебный круг</DialogDescription></div>
          <details className="an-lesson-about"><summary aria-label="Об учебном круге"><Info/></summary><div><strong>Один круг, пять систем</strong><p>Выбирай участок Монцы, ставь круг на паузу и открывай узлы. Трасса, болид и механизмы связаны одной шкалой времени.</p><p>Это учебный сценарий без телеметрии гонщика. Работа крыльев и энергии условная, коробка показана на одной передаче. Ход подвески и деформация шин не рассчитываются.</p></div></details>
        </header>
        <div className="an-lesson-stage" data-inspecting={detail}>
          <div className="an-lesson-track-scene"><MonzaLessonScene car={{ ...viewerProps, inside }} cameraMode={cameraMode} reduced={playback.reduced} callout={components.find(component => component.id === inspectId)!.name} onInspect={() => openDetail(inspectId)}/></div>
          <div className="an-lesson-scene-heading"><span><i/>{frame.time === LESSON_DURATION ? "Круг завершён" : phaseNames[frame.phase]} · {playback.playing ? "На круге" : "На паузе"}</span><h2>{frame.section.name}</h2><p>Монца, Италия <span>· 5,793 км</span></p></div>
          <div className="an-lesson-minimap"><MonzaMap frame={frame} seek={playback.seek}/><span>{Math.round(frame.progress * 100)}% круга</span></div>
          <div className="an-lesson-scene-controls">
            <fieldset aria-label="Камера" className="an-lesson-camera"><legend className="sr-only">Камера</legend>{([{ id: "follow", name: "С болидом", icon: Eye }, { id: "overview", name: "Вся трасса", icon: Map }] as const).map(item => <label key={item.id} className={cn(cameraMode === item.id && "is-active")}><input type="radio" name="lesson-camera" checked={cameraMode === item.id} onChange={() => setCameraMode(item.id)}/><item.icon/><span>{item.name}</span></label>)}</fieldset>
            <button className="an-lesson-cutaway" type="button" aria-pressed={inside} onClick={() => setInside(!inside)}><Layers3/><span>{inside ? "Вернуть кузов" : "Под кузовом"}</span></button>
          </div>
          {detail && <section className="an-lesson-inspection" aria-label="Разбор узла">
            <div className="an-lesson-inspection-heading"><div><span>{frame.section.location} · {formatTime(frame.time)}</span><h3 ref={detailTitle} tabIndex={-1}>{selected.name}</h3></div><Button variant="ghost" size="icon" aria-label="Вернуться к трассе" onClick={closeDetail}><X/></Button></div>
            <W17ComponentViewer key={selectedId} {...viewerProps} onSelect={setSelectedId} initialOpen initialView="perspective"/>
            <div className="an-lesson-component-choices" aria-label="Узлы системы">{currentSystem.components.map(id => <button type="button" key={id} aria-pressed={id === selectedId} onClick={() => setSelectedId(id)}>{components.find(component => component.id === id)?.name}</button>)}</div>
            <details className="an-lesson-mechanism-details" key={`${system}/${selectedId}`}><summary>Как устроен этот узел</summary><ol>{selected.steps.map(step => <li key={step}>{step}</li>)}</ol></details>
          </section>}
        </div>
        <section className="an-lesson-deck" aria-label="Что делает болид">
          <fieldset className="an-lesson-systems"><legend className="sr-only">Что изучаем</legend>{lessonSystems.map(item => { const Icon = systemIcons[item.id]; return <label key={item.id} className={cn(system === item.id && "is-active")}><input type="radio" name="lesson-system" checked={system === item.id} onChange={() => { setSystem(item.id); setSelectedId(item.components[0]); }}/><Icon/><span>{item.name}</span></label>; })}</fieldset>
          <div className="an-lesson-story"><div><h3>{explanation.title}</h3><p>{brief(system, frame)}</p>{system === "energy" && explanation.path.length > 0 && <div className="an-lesson-energy-path" aria-label="Направление энергии">{explanation.path.map((id, index) => <span key={id}>{index > 0 && <ArrowRight/>}{id === "battery" ? "Батарея" : id === "inverter" ? "Инвертор" : "MGU-K"}</span>)}</div>}</div>
            <Button variant="outline" className="an-lesson-inspect" onClick={() => detail ? closeDetail() : openDetail(inspectId)}>{detail ? <><ArrowLeft/>К трассе</> : <>Посмотреть внутри<ArrowUpRight/></>}</Button>
          </div>
        </section>
        <label className="an-lesson-mobile-location"><span className="sr-only">Момент круга</span><select aria-label="Момент круга" value={frame.section.id} onChange={event => playback.seek(lessonTimeline.find(section => section.id === event.target.value)!.time)}>{lessonTimeline.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>
        <LessonTransport playback={playback}/>
      </div>
    </DialogContent>
  </Dialog>;
}
