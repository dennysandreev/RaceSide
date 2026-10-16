import { MessageSquare } from "lucide-react";

import { AppShell } from "@/components/racemate/app-shell";
import { FeedbackForm } from "@/components/racemate/feedback-form";
import { InfoPageHeader } from "@/components/racemate/info-page-header";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Обратная связь",
  description: "Обратная связь с командой RaceSide: отзывы, вопросы и сообщения об ошибках.",
  path: "/feedback",
});

export default function FeedbackPage() {
  return (
    <AppShell>
      <section className="mx-auto w-full max-w-3xl pb-8">
        <div className="stitch-panel grid gap-6 p-5 text-sm sm:p-7">
          <InfoPageHeader
            description="Поделись впечатлениями, сообщи об ошибке или свяжись с командой RaceSide."
            icon={MessageSquare}
            title="Обратная связь"
          />
          <FeedbackForm turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
        </div>
      </section>
    </AppShell>
  );
}
