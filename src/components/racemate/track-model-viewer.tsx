"use client";

import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { type ReactNode, type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TrackOrientationSphere } from "@/components/racemate/track-orientation-sphere";
import {
  getTrackModelOverviewRotation, moveTrackModelTouchCamera, normalizeDegrees, orbitTrackModelCamera, panTrackModelCamera,
  preserveTrackModelOrbitFocus, readTrackModelGesture, resolveTrackModelGesture,
  TRACK_MODEL_MAX_ZOOM, TRACK_MODEL_MIN_ZOOM, TRACK_MODEL_TOUCH_QUERY, TRACK_MODEL_ZOOM_STEP, zoomTrackModelAtPoint,
  type TrackModelCameraState, type TrackModelGesture, type TrackModelGestureMode, type TrackModelViewport,
} from "@/lib/track-model-camera";
import { cn } from "@/lib/utils";

type ViewCamera = TrackModelCameraState & { tiltDeg: number };
export type TrackModelView = ViewCamera & {
  fullscreen: boolean;
  frameRotationDeg: number;
  frameTiltDeg: number;
  viewport: TrackModelViewport;
  moved: { current: boolean };
};

type Props = {
  circuit: string;
  initialRotationDeg?: number;
  initialTiltDeg?: number;
  points: readonly (readonly number[])[];
  children: (view: TrackModelView) => ReactNode;
  className?: string;
  fullscreenOpen?: boolean;
  onFullscreenOpenChange?: (open: boolean) => void;
  onInteract?: () => void;
  onReset?: () => void;
  toolbarExtra?: ReactNode;
  bottomInset?: number;
  wideBottomInset?: number;
};

export function TrackModelViewer({ circuit, initialRotationDeg = 0, initialTiltDeg = 10, points, children,
  className, fullscreenOpen, onFullscreenOpenChange, onInteract, onReset, toolbarExtra, bottomInset = 100,
  wideBottomInset = bottomInset }: Props) {
  const mobile = useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(TRACK_MODEL_TOUCH_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(TRACK_MODEL_TOUCH_QUERY).matches,
    () => false,
  );
  const [internalOpen, setInternalOpen] = useState(false);
  const fullscreen = fullscreenOpen ?? internalOpen;
  const setFullscreen = (open: boolean) => { setInternalOpen(open); onFullscreenOpenChange?.(open); };
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<TrackModelViewport>({ width: 900, height: 600, top: 64, bottom: bottomInset });
  const [camera, setCamera] = useState<ViewCamera>({ pan: { x: 0, y: 0 }, rotationDeg: initialRotationDeg, tiltDeg: initialTiltDeg, zoom: 1 });
  const [touched, setTouched] = useState(false);
  const overviewRotation = useMemo(() => getTrackModelOverviewRotation(points, initialRotationDeg, initialTiltDeg, viewport), [points, initialRotationDeg, initialTiltDeg, viewport]);
  const current = useMemo(() => touched ? camera : { ...camera, rotationDeg: overviewRotation }, [touched, camera, overviewRotation]);
  const cameraRef = useRef(current);
  const moved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ pointerId: number; x: number; y: number; camera: ViewCamera; orbit: boolean } | null>(null);
  const gesture = useRef<{ start: TrackModelGesture; previous: TrackModelGesture; camera: ViewCamera; mode: TrackModelGestureMode | null } | null>(null);
  const tap = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastTouch = useRef(0);
  const frame = useRef<number | null>(null);
  const pending = useRef<ViewCamera | null>(null);
  const gestureFrame = useRef<number | null>(null);
  const gestureTask = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { if (!pending.current) cameraRef.current = current; }, [current]);

  const apply = useCallback((next: ViewCamera) => {
    onInteract?.();
    cameraRef.current = next;
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setTouched(true);
      if (pending.current) setCamera(pending.current);
      pending.current = null;
    });
  }, [onInteract]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current);
  }, []);
  useEffect(() => () => {
    if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = null;
    gestureTask.current = null;
    pointers.current.clear();
    drag.current = null;
    gesture.current = null;
    tap.current = null;
  }, [node]);
  useLayoutEffect(() => {
    if (!node) return;
    const resize = () => {
      const { width, height } = node.getBoundingClientRect();
      setViewport({
        width: Math.max(1, width), height: Math.max(1, height),
        top: fullscreen ? 84 : 16,
        // At the @lg/track breakpoint, track facts and the 2D/3D switch fit in one row.
        bottom: width >= 512 ? wideBottomInset : bottomInset,
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, fullscreen, bottomInset, wideBottomInset]);

  const zoomTo = useCallback((requested: number, focal = { x: 0, y: 0 }) => {
    const state = cameraRef.current;
    const zoom = Math.max(TRACK_MODEL_MIN_ZOOM, Math.min(TRACK_MODEL_MAX_ZOOM, requested));
    apply({ ...state, ...zoomTrackModelAtPoint(state, zoom, { ...focal, y: focal.y - (viewport.top - viewport.bottom) / (2 * viewport.height) }) });
  }, [apply, viewport]);

  const orbit = (rotationDeg: number, tiltDeg: number) => {
    const state = cameraRef.current;
    apply({
      ...state, rotationDeg, tiltDeg,
      pan: preserveTrackModelOrbitFocus({
        pan: state.pan, zoom: state.zoom, startRotationDeg: state.rotationDeg,
        startTiltDeg: state.tiltDeg, nextRotationDeg: rotationDeg, nextTiltDeg: tiltDeg, viewportAspectRatio: viewport.width / viewport.height
      })
    });
  };

  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = null;
    if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = null;
    gestureTask.current = null;
    pointers.current.clear();
    drag.current = null;
    gesture.current = null;
    tap.current = null;
    setTouched(false);
    const next = { pan: { x: 0, y: 0 }, rotationDeg: overviewRotation, tiltDeg: initialTiltDeg, zoom: 1 };
    cameraRef.current = next;
    setCamera(next);
    onReset?.();
  };

  useEffect(() => {
    if (!node || (mobile && !fullscreen)) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const bounds = node.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
      zoomTo(cameraRef.current.zoom * Math.exp(-event.deltaY * unit * 0.0015), {
        x: (event.clientX - bounds.left) / bounds.width - 0.5,
        y: (event.clientY - bounds.top) / bounds.height - 0.5,
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [node, mobile, fullscreen, zoomTo]);

  const beginDrag = (pointerId: number, x: number, y: number, orbit = false) => {
    drag.current = { pointerId, x, y, camera: cameraRef.current, orbit };
  };
  const beginGesture = (bounds: DOMRect) => {
    const start = readTrackModelGesture(pointers.current, bounds);
    gesture.current = { start, previous: start, camera: cameraRef.current, mode: null };
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (!cancelled) gestureTask.current?.();
    if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = null;
    gestureTask.current = null;
    const start = drag.current;
    if (!cancelled && event.pointerType === "touch" && !moved.current && start && pointers.current.size === 1) {
      const previous = tap.current;
      if (previous && event.timeStamp - previous.time < 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24) {
        const bounds = event.currentTarget.getBoundingClientRect();
        zoomTo(cameraRef.current.zoom + TRACK_MODEL_ZOOM_STEP * 2, {
          x: (event.clientX - bounds.left) / bounds.width - 0.5,
          y: (event.clientY - bounds.top) / bounds.height - 0.5,
        });
        tap.current = null;
      } else tap.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
    } else tap.current = null;
    pointers.current.delete(event.pointerId);
    drag.current = null;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (pointers.current.size === 1) {
      const [id, point] = pointers.current.entries().next().value!;
      beginDrag(id, point.x, point.y);
    } else if (pointers.current.size >= 2) {
      beginGesture(event.currentTarget.getBoundingClientRect());
    }
  };

  const view: TrackModelView = {
    ...current, fullscreen, viewport, frameRotationDeg: overviewRotation,
    frameTiltDeg: initialTiltDeg, moved
  };
  const stage = (
    <div ref={setNode} tabIndex={0} role="group"
      aria-label={`3D-карта трассы ${circuit}. Перемещай карту одним пальцем. Двумя пальцами поворачивай и приближай. Двигай оба пальца вверх для наклона, вниз для вида сверху.`}
      className={cn("@container/track relative isolate size-full min-h-0 overflow-hidden bg-[var(--track-model-stage)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        mobile && !fullscreen ? "touch-pan-y" : "touch-none cursor-grab active:cursor-grabbing", className)}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        if (e.timeStamp - lastTouch.current < 500 || (e.target as Element).closest("button, a")) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        zoomTo(cameraRef.current.zoom + TRACK_MODEL_ZOOM_STEP * 2, { x: (e.clientX - bounds.left) / bounds.width - 0.5, y: (e.clientY - bounds.top) / bounds.height - 0.5 });
      }}
      onPointerDown={(e) => {
        if ((mobile && !fullscreen) || (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) || (e.target as Element).closest("button, a")) return;
        if (e.pointerType === "touch") lastTouch.current = e.timeStamp;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!pointers.current.size) moved.current = false;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size >= 2) {
          beginGesture(e.currentTarget.getBoundingClientRect());
          drag.current = null;
          moved.current = true;
          tap.current = null;
        } else beginDrag(e.pointerId, e.clientX, e.clientY,
          e.pointerType === "mouse" && (e.button === 2 || e.shiftKey));
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const bounds = e.currentTarget.getBoundingClientRect();
        const pinch = gesture.current;
        if (pointers.current.size >= 2 && pinch) {
          // Read both fingers once per frame, rather than interpreting the
          // intermediate position after only one pointer event has arrived.
          gestureTask.current = () => {
            if (pointers.current.size < 2 || gesture.current !== pinch) return;
            const next = readTrackModelGesture(pointers.current, bounds);
            pinch.mode ??= resolveTrackModelGesture(pinch.start, next, bounds.width, bounds.height);
            if (!pinch.mode) return;
            // Zoom, rotation and translation work together. A vertical swipe
            // can still become tilt after an earlier event from one finger.
            if (pinch.mode === "transform" && resolveTrackModelGesture(pinch.previous, next, bounds.width, bounds.height, 1) === "tilt") {
              pinch.start = pinch.previous;
              pinch.camera = cameraRef.current;
              pinch.mode = "tilt";
            }
            if (pinch.mode === "tilt") {
              const angle = Math.abs(normalizeDegrees((next.angle - pinch.start.angle) * 180 / Math.PI));
              const dx = Math.abs((next.center.x - pinch.start.center.x) * bounds.width);
              const dy = Math.abs((next.center.y - pinch.start.center.y) * bounds.height);
              if (angle >= 15 || Math.abs(next.distance / Math.max(1, pinch.start.distance) - 1) >= 0.16 || (dx >= 8 && dx > dy * 1.5)) {
                pinch.mode = "transform";
              }
            }
            apply(moveTrackModelTouchCamera(
              pinch.mode === "tilt" ? pinch.camera : cameraRef.current,
              pinch.mode === "tilt" ? pinch.start : pinch.previous,
              next, pinch.mode, { ...viewport, width: bounds.width, height: bounds.height },
            ));
            pinch.previous = next;
          };
          if (gestureFrame.current === null) gestureFrame.current = requestAnimationFrame(() => {
            gestureFrame.current = null;
            gestureTask.current?.();
            gestureTask.current = null;
          });
          return;
        }
        const start = drag.current;
        if (!start || start.pointerId !== e.pointerId) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!moved.current && Math.hypot(dx, dy) < 5) return;
        moved.current = true;
        if (start.orbit) {
          const next = orbitTrackModelCamera({
            deltaX: dx, deltaY: dy, startRotationDeg: start.camera.rotationDeg,
            startTiltDeg: start.camera.tiltDeg, minimumTiltDeg: 0, maximumTiltDeg: 82,
          });
          orbit(next.rotationDeg, next.tiltDeg);
        } else apply(panTrackModelCamera(start.camera, dx, dy, bounds));
      }}
      onPointerUp={(e) => endPointer(e)} onPointerCancel={(e) => endPointer(e, true)}
      onLostPointerCapture={(e) => { if (pointers.current.has(e.pointerId)) endPointer(e, true); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "+", "=", "-"].includes(e.key)) return;
        e.preventDefault();
        const state = cameraRef.current;
        if (e.key === "Home") reset();
        else if (e.key === "+" || e.key === "=") zoomTo(state.zoom + TRACK_MODEL_ZOOM_STEP);
        else if (e.key === "-") zoomTo(state.zoom - TRACK_MODEL_ZOOM_STEP);
        else orbit(normalizeDegrees(state.rotationDeg + (e.key === "ArrowLeft" ? -15 : e.key === "ArrowRight" ? 15 : 0)),
          Math.max(0, Math.min(82, state.tiltDeg + (e.key === "ArrowUp" ? -4 : e.key === "ArrowDown" ? 4 : 0))));
      }}>
      {children(view)}
      {!mobile ? <TrackOrientationSphere initialRotationDeg={overviewRotation} initialTiltDeg={initialTiltDeg}
        rotationDeg={current.rotationDeg} tiltDeg={current.tiltDeg} onChange={orbit} /> : null}
      <div role="toolbar" aria-label="Управление картой" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex max-w-[calc(100%_-_6rem)] flex-wrap items-center justify-end gap-1.5">
        <Button size="icon" variant="secondary" className="size-11 sm:size-11" disabled={current.zoom <= TRACK_MODEL_MIN_ZOOM} aria-label="Отдалить трассу" onClick={() => { zoomTo(cameraRef.current.zoom - TRACK_MODEL_ZOOM_STEP); }}><Minus aria-hidden="true" /></Button>
        <Button size="icon" variant="secondary" className="size-11 sm:size-11" disabled={current.zoom >= TRACK_MODEL_MAX_ZOOM} aria-label="Приблизить трассу" onClick={() => { zoomTo(cameraRef.current.zoom + TRACK_MODEL_ZOOM_STEP); }}><Plus aria-hidden="true" /></Button>
        {toolbarExtra}
        <Button size="icon" variant="secondary" className="size-11 sm:size-11" aria-label={fullscreen ? "Свернуть карту" : "Развернуть карту"} title={fullscreen ? "Свернуть карту" : "Развернуть карту"} onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">Масштаб {Math.round(current.zoom * 100)}%, {current.tiltDeg === 0 ? "вид сверху" : "объёмный вид"}</span>
      {mobile && !fullscreen ? <Button variant="secondary" className="absolute inset-0 z-40 size-full items-end rounded-none bg-transparent pb-5" onClick={() => setFullscreen(true)}>Открыть 3D-карту</Button> : null}
    </div>
  );

  return <>
    {fullscreen ? <div className={cn("size-full min-h-0", className)} /> : stage}
    <Dialog open={fullscreen} onOpenChange={setFullscreen}>
      <DialogContent showCloseButton={false} className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[var(--track-model-stage)] p-0 motion-reduce:animate-none sm:max-w-none">
        <DialogTitle className="sr-only">Трасса {circuit} на весь экран</DialogTitle>
        <DialogDescription className="sr-only">Перемещай карту одним пальцем. Двумя пальцами поворачивай и приближай. Двигай оба пальца вверх для наклона, вниз для вида сверху.</DialogDescription>
        {fullscreen ? stage : null}
      </DialogContent>
    </Dialog>
  </>;
}
