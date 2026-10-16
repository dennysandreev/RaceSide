import { Activity, Cog } from "lucide-react";
import { PageTitle } from "@/components/racemate/page-title";
import Image from "next/image";

export default function Loading() {
  return (
    <div className="telemetry-hub" data-ready="false">
      <section className="telemetry-event stitch-panel" data-setup="true">
        <Image
          alt=""
          className="telemetry-event-image"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 72rem"
          src="/stitch/telemetry-hero.webp"
        />
        <div aria-hidden="true" className="telemetry-event-shade" />
        <header className="telemetry-heading p-5">
          <div className="min-w-0">
            <p className="stitch-label flex items-center gap-2 text-primary">
              <Activity aria-hidden="true" className="size-3.5" />
              Телеметрия
            </p>
            <PageTitle className="mt-2 max-w-4xl">Телеметрия</PageTitle>
            <div className="mt-3 inline-flex h-11 items-center rounded-md border border-border/80 bg-background/70 px-3 font-telemetry text-[0.68rem] font-extrabold uppercase text-muted-foreground backdrop-blur-sm">
              Сезон {new Date().getUTCFullYear()}
            </div>
          </div>
        </header>
      </section>
      <div className="telemetry-setup stitch-panel">
        <div role="status" className="telemetry-setup-progress">
          <Cog aria-hidden="true" className="telemetry-loading-gear" />
          <div>
            <p className="telemetry-loading-title">Открываем телеметрию</p>
            <p className="telemetry-loading-description">
              Загрузка может занять время
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
