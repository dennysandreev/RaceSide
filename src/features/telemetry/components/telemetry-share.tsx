"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Share2, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trackTelemetry } from "../lib/client";
import type { CompareConfig } from "../lib/types";
export function TelemetryShare({
  open,
  onOpenChange,
  config,
  savedId,
  onSaved,
  corner,
  range,
  imageSource,
  title = "Поделиться сравнением",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config?: CompareConfig;
  savedId?: string;
  onSaved?: (id: string) => void;
  corner?: number;
  range?: [number, number];
  imageSource?: string;
  title?: string;
}) {
  const [id, setId] = useState(savedId),
    [format, setFormat] = useState<"horizontal" | "vertical">("horizontal"),
    [error, setError] = useState(""),
    [sharing, setSharing] = useState(false),
    [status, setStatus] = useState(""),
    [prepared, setPrepared] = useState<{
      source: string;
      file: File;
      preview: string;
    } | null>(null);
  useEffect(() => {
    if (!open || imageSource || !config) return;
    if (savedId) {
      void Promise.resolve().then(() => setId(savedId));
      return;
    }
    const controller = new AbortController();
    void fetch("/api/telemetry/permalink", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, view: { corner, range } }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setId(data.id);
        onSaved?.(data.id);
        trackTelemetry("telemetry_permalink_created", data.id);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
    // Create one immutable link per comparison when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, savedId, config, imageSource]);
  const image = imageSource ? `${imageSource}&format=${format}` : id
    ? `/api/share-image/telemetry/${id}?v=22&format=${format}`
    : null;
  useEffect(() => {
    if (!open || !image) return;
    const controller = new AbortController();
    let preview: string | undefined;
    void fetch(image, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Не удалось создать карточку. Попробуйте ещё раз.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const file = new File([blob], `raceside-${imageSource ? "pace" : "telemetry"}-${format}.png`, {
          type: "image/png",
        });
        preview = URL.createObjectURL(file);
        setPrepared({ source: image, file, preview });
        setError("");
        setStatus("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      if (preview) URL.revokeObjectURL(preview);
      setPrepared(null);
    };
  }, [open, image, format, imageSource]);
  const card = prepared?.source === image ? prepared : null;
  function downloadImage() {
    if (!card) return;
    const anchor = document.createElement("a");
    anchor.href = card.preview;
    anchor.download = card.file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  async function shareImage() {
    if (!card) return;
    setError("");
    setStatus("");
    const data = { files: [card.file] };
    if (!navigator.share || !navigator.canShare?.(data)) {
      downloadImage();
      setStatus("Картинка скачана. Прикрепите её к публикации в соцсети.");
      return;
    }
    setSharing(true);
    try {
      // The file is prepared before the click to preserve native share activation.
      await navigator.share(data);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setError(
          "Не удалось отправить картинку. Попробуйте ещё раз или скачайте её.",
        );
    } finally {
      setSharing(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="telemetry-share-dialog"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div
          className="telemetry-share-formats"
          role="group"
          aria-label="Ориентация карточки"
        >
          <button
            type="button"
            className={format === "horizontal" ? "is-active" : undefined}
            aria-pressed={format === "horizontal"}
            onClick={() => setFormat("horizontal")}
          >
            <span className="telemetry-share-format-icon is-horizontal" />
            <span>Горизонтальная</span>
            <small>3200 × 1800</small>
          </button>
          <button
            type="button"
            className={format === "vertical" ? "is-active" : undefined}
            aria-pressed={format === "vertical"}
            onClick={() => setFormat("vertical")}
          >
            <span className="telemetry-share-format-icon is-vertical" />
            <span>Вертикальная</span>
            <small>2160 × 3840</small>
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {card ? (
          <div className="telemetry-share-preview">
            <Image
              unoptimized
              width={format === "horizontal" ? 3200 : 2160}
              height={format === "horizontal" ? 1800 : 3840}
              src={card.preview}
              alt="Предпросмотр карточки RaceSide"
              onError={() =>
                setError("Не удалось создать карточку. Попробуйте ещё раз.")
              }
              onLoad={() => {
                setError("");
                trackTelemetry("telemetry_share_generated", id);
              }}
            />
          </div>
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
        <div className="telemetry-share-actions">
          <Button
            variant="outline"
            disabled={!card || sharing}
            onClick={downloadImage}
          >
            <Download data-icon="inline-start" />
            Скачать
          </Button>
          <Button disabled={!card || sharing} onClick={() => void shareImage()}>
            <Share2 data-icon="inline-start" />
            {sharing ? "Отправляем…" : "Поделиться картинкой"}
          </Button>
        </div>
        {status && (
          <p className="telemetry-share-status" role="status">
            {status}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
