import { AppShell } from "@/components/racemate/app-shell";
import { AnatomyExplorer } from "@/features/anatomy/explorer";
import { createPageMetadata } from "@/lib/seo";
import "@/features/anatomy/anatomy.css";

export const metadata = createPageMetadata({
  title: "Болид Формулы-1 2026 — устройство",
  description: "Изучи болид Формулы-1 сезона 2026: объёмная модель, 30 узлов, активные крылья и движение воздуха.",
  path: "/anatomy",
});

export default function AnatomyPage() {
  return <AppShell viewport><div className="an-page an-viewport"><AnatomyExplorer/></div></AppShell>;
}
