"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";

import { RaceFlag } from "@/components/racemate/race-flag";
import {
  getSeasonGlobeMarkerOpacity,
  hasGlobeCoordinates,
  latLngToVector3,
  placeSeasonGlobeLabels,
  SEASON_GLOBE_MARKER_RADIUS,
  type SeasonGlobeLabelCandidate,
} from "@/lib/season-globe-geometry";
import type { SeasonGlobeEvent } from "@/types/racemate";

const circuitLabels: Record<string, string> = {
  "albert park": "Мельбурн", shanghai: "Шанхай", suzuka: "Сузука", bahrain: "Сахир",
  jeddah: "Джидда", miami: "Майами", imola: "Имола", monaco: "Монако",
  catalunya: "Барселона", madring: "Мадрид", villeneuve: "Монреаль", "red bull ring": "Шпильберг",
  silverstone: "Сильверстоун", spa: "Спа", hungaroring: "Хунгароринг", zandvoort: "Зандворт",
  monza: "Монца", baku: "Баку", sepang: "Сепанг", "marina bay": "Сингапур",
  americas: "Остин", rodriguez: "Мехико", "rodríguez": "Мехико", interlagos: "Интерлагос",
  "josé carlos pace": "Интерлагос", vegas: "Лас-Вегас", lusail: "Лусаил", yas: "Яс-Марина",
};

function getCircuitLabel(event: SeasonGlobeEvent) {
  const name = event.circuitName.toLowerCase();
  return Object.entries(circuitLabels).find(([key]) => name.includes(key))?.[1] ??
    event.circuitName.replace(/\s*(international|street|city|motor|grand prix|circuit|autodrome|raceway)\b/gi, "").trim();
}

export function SeasonGlobeLabels({ events, selectedRound }: { events: SeasonGlobeEvent[]; selectedRound: number }) {
  const elementsRef = useRef(new Map<number, HTMLDivElement>());
  const projectedRef = useRef(new Vector3());
  const cameraDirectionRef = useRef(new Vector3());
  const labels = useMemo(() => events.filter(
    (event): event is SeasonGlobeEvent & { latitude: number; longitude: number } => hasGlobeCoordinates(event),
  ).map((event) => ({
    event,
    label: getCircuitLabel(event),
    position: latLngToVector3(event.latitude, event.longitude, SEASON_GLOBE_MARKER_RADIUS),
  })), [events]);

  useFrame(({ camera, size }) => {
    const direction = cameraDirectionRef.current.copy(camera.position).normalize();
    const distance = camera.position.length();
    const candidates: SeasonGlobeLabelCandidate[] = [];

    for (const { event, label, position } of labels) {
      const element = elementsRef.current.get(event.round);
      if (!element) continue;
      element.style.visibility = "hidden";
      const facing = position.dot(direction) / SEASON_GLOBE_MARKER_RADIUS;
      const selected = event.round === selectedRound;
      if (getSeasonGlobeMarkerOpacity(distance, facing) < 0.95) continue;
      const projected = projectedRef.current.copy(position).project(camera);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1 || projected.z > 1) continue;
      candidates.push({
        round: event.round, facing, selected,
        x: ((projected.x + 1) / 2) * size.width,
        y: ((1 - projected.y) / 2) * size.height,
        width: selected ? 162 : Math.max(38, label.length * 6.2),
        height: selected ? 48 : 18,
      });
    }

    const labelLimit = size.width < 440 && size.height < 360 ? 3 : 6;
    for (const placement of placeSeasonGlobeLabels(candidates, size.width, size.height, labelLimit)) {
      const element = elementsRef.current.get(placement.round)!;
      element.style.visibility = "visible";
      element.style.width = `${placement.width}px`;
      element.style.transform = `translate3d(${placement.left}px, ${placement.top}px, 0)`;
    }
  });

  return (
    <Html fullscreen pointerEvents="none" zIndexRange={[3, 0]}>
      <div aria-hidden="true" className="season-globe-label-layer">
        {labels.map(({ event, label }) => (
          <div
            className={event.round === selectedRound ? "season-globe-label season-globe-label-selected" : "season-globe-label"}
            key={event.round}
            ref={(element) => { if (element) elementsRef.current.set(event.round, element); else elementsRef.current.delete(event.round); }}
          >
            {event.round === selectedRound ? (
              <>
                <RaceFlag className="h-4 w-6" countryCode={event.countryCode} label={event.country} />
                <div className="min-w-0">
                  <span className="block truncate text-[11px] font-bold leading-4">{label}</span>
                  <span className="block truncate text-[10px] leading-4 text-primary">{event.raceName}</span>
                </div>
              </>
            ) : label}
          </div>
        ))}
      </div>
    </Html>
  );
}
