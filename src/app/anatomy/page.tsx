import { AppShell } from "@/components/racemate/app-shell";
import { AnatomyExplorer } from "@/features/anatomy/explorer";
import { createPageMetadata } from "@/lib/seo";
import "@/features/anatomy/anatomy.css";
import "@/features/anatomy/driving-lesson.css";

export const metadata = createPageMetadata({
  title: "Болид Формулы-1 2026 — устройство",
  description: "Изучи 31 узел болида Формулы-1 2026 и пройди учебный круг Монцы: работа механизмов, энергия, торможение и потоки воздуха.",
  path: "/anatomy",
});

export default function AnatomyPage() {
  return <AppShell viewport><div className="an-page an-viewport"><AnatomyExplorer/></div></AppShell>;
}
