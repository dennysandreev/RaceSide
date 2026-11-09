"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampLessonTime, LESSON_DURATION, sampleLesson } from "./monza-lesson";

export function useLessonPlayback() {
  const [frame, setFrame] = useState(() => sampleLesson(0));
  const clock = useRef(frame);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [reduced, setReduced] = useState(false);
  const pause = useCallback(() => { setPlaying(false); setFrame(clock.current); }, []);
  const seek = useCallback((time: number) => {
    clock.current = sampleLesson(clampLessonTime(time));
    setFrame(clock.current);
    setPlaying(false);
  }, []);
  const toggle = useCallback(() => {
    if (playing) { pause(); return; }
    if (reduced) return;
    if (clock.current.time >= LESSON_DURATION) {
      clock.current = sampleLesson(0);
      setFrame(clock.current);
    }
    setPlaying(true);
  }, [playing, reduced, pause]);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motionPreference = () => { setReduced(media.matches); if (media.matches) pause(); };
    const visibility = () => { if (document.hidden) pause(); };
    motionPreference();
    media.addEventListener("change", motionPreference);
    document.addEventListener("visibilitychange", visibility);
    return () => { media.removeEventListener("change", motionPreference); document.removeEventListener("visibilitychange", visibility); };
  }, [pause]);

  useEffect(() => {
    if (!playing || reduced) return;
    let request = 0, previous = performance.now(), painted = 0;
    const tick = (now: number) => {
      clock.current = sampleLesson(clock.current.time + Math.min((now - previous) / 1000, .1) * rate);
      previous = now;
      // Canvas reads the shared clock each frame; prose and controls update at 12 Hz.
      if (now - painted > 80 || clock.current.time === LESSON_DURATION) { setFrame(clock.current); painted = now; }
      if (clock.current.time === LESSON_DURATION) { setPlaying(false); return; }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, rate, reduced]);

  return { frame, clock, playing, reduced, rate, setRate, pause, seek, toggle };
}
export type LessonPlayback = ReturnType<typeof useLessonPlayback>;
