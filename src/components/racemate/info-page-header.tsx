import { FileText, type LucideIcon } from "lucide-react";

import { PageTitle } from "@/components/racemate/page-title";

export function InfoPageHeader({
  description,
  icon: Icon = FileText,
  label = "RaceSide",
  title,
}: {
  description: string;
  icon?: LucideIcon;
  label?: string;
  title: string;
}) {
  return (
    <header className="min-w-0">
      <p className="stitch-label flex items-center gap-2 text-primary">
        <Icon aria-hidden="true" className="size-3.5" />
        {label}
      </p>
      <PageTitle className="mt-2 max-w-4xl">{title}</PageTitle>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </header>
  );
}
