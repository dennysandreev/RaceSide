"use client";
import { useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useLivePresentation, useLiveSeeking, useLiveSeekRevision, useLiveStore } from "./live-provider";

const duration = (seconds: number) => {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
};

export function LiveRewindControls() {
  const presentation = useLivePresentation(), store = useLiveStore(), busy = useLiveSeeking();
  const revision = useLiveSeekRevision();
  const [draft, setDraft] = useState<{ value: number; revision: number } | null>(null);
  const disabled = busy || !presentation;
  const available = presentation ? Math.min(180, Math.max(0, (presentation.latestTime - presentation.earliestTime) / 1000)) : 0;
  const lag = presentation ? Math.max(0, (presentation.latestTime - presentation.cursorTime) / 1000) : 0;
  const offset = draft?.revision === revision ? draft.value : -Math.min(available, lag);
  const move = (seconds: number) => {
    if (!presentation) return;
    setDraft(null);
    const delayMs = Math.max(0, Math.min(available * 1000, seconds * 1000));
    store.seek({ mode: "rewind", delayMs,
      ...(presentation.paused ? { pausedAt: presentation.latestTime - delayMs } : {}) });
  };
  return (
    <section className="live-rewind" aria-label="Перемотка последних трёх минут" aria-busy={busy}>
      <div className="live-rewind-actions">
        <Button size="icon" variant="ghost" disabled={disabled} aria-label={presentation?.paused ? "Продолжить просмотр" : "Приостановить просмотр"}
          onClick={() => store.seek(presentation?.paused
            ? { mode: "rewind", delayMs: Math.min(180000, Math.max(0, presentation.latestTime - presentation.cursorTime)) }
            : { mode: "rewind", pausedAt: store.getPresentationNow() })}>
          {presentation?.paused ? <Play /> : <Pause />}
        </Button>
        <Button size="icon" variant="ghost" disabled={disabled || lag >= available} aria-label="Назад на 5 секунд" onClick={() => move(lag + 5)}>
          <RotateCcw /><span className="live-rewind-step" aria-hidden="true">5</span>
        </Button>
        <Button size="icon" variant="ghost" disabled={disabled || lag <= 0} aria-label="Вперёд на 5 секунд" onClick={() => move(lag - 5)}>
          <RotateCw /><span className="live-rewind-step" aria-hidden="true">5</span>
        </Button>
      </div>
      <div className="live-rewind-scale">
        <span className="live-rewind-start">−{duration(available)}</span>
        <Slider min={-Math.max(1, available)} max={0} step={1} value={[offset]}
          disabled={disabled || available < 1} thumbLabels={["Момент просмотра"]}
          onValueChange={([value]) => setDraft({ value, revision })}
          onValueCommit={([value]) => { move(-value); setDraft(null); }} />
        <Button size="sm" variant="ghost" className="live-rewind-end" disabled={disabled}
          aria-label="Вернуться в Live" aria-pressed={presentation?.mode === "live"}
          onClick={() => store.seek({ mode: "live" })}>
          <span className="live-view-dot" aria-hidden="true" />Live
        </Button>
      </div>
      <output className="live-rewind-position" aria-label="Отставание от LIVE">
        {presentation?.expired ? "Пауза истекла" : `−${duration(-offset)}`}
      </output>
      {presentation?.expired ? (
        <p className="live-rewind-notice" role="status">
          Этот момент уже вне последних трёх минут.
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => store.seek({ mode: "rewind", delayMs: 180000 })}>Продолжить с начала окна</Button>
        </p>
      ) : null}
    </section>
  );
}
