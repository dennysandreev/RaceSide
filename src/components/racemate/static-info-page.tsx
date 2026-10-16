import Link from "next/link";
import { ArrowRight, FileText, Flag } from "lucide-react";

import { InfoPageHeader } from "@/components/racemate/info-page-header";
import { Button } from "@/components/ui/button";
import type { StaticDocumentPage, StaticPlaceholderPage } from "@/content/static-pages";
import { cn } from "@/lib/utils";

export function StaticDocumentPageView({ page }: { page: StaticDocumentPage }) {
  return (
    <section className="pb-8">
      <article className="stitch-panel grid gap-6 p-5 sm:p-7">
        <InfoPageHeader description={page.description} title={page.title} />
        <MarkdownContent content={page.body} />
      </article>
    </section>
  );
}

export function PlaceholderPageView({ page }: { page: StaticPlaceholderPage }) {
  return (
    <section className="grid gap-5 py-5">
      <div className="stitch-panel relative overflow-hidden p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgb(225_6_0_/_0.22),transparent_20rem),linear-gradient(135deg,rgb(255_255_255_/_0.08),transparent_44%)]" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
          <div>
            <p className="stitch-label mb-3 text-primary">Раздел готовится</p>
            <h1 className="font-display text-balance text-3xl font-extrabold leading-tight tracking-[-0.04em] sm:text-5xl">
              {page.title}
            </h1>
            <p className="mt-4 max-w-[70ch] text-base leading-7 text-muted-foreground">
              {page.description}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/45 p-4">
            <Flag aria-hidden="true" className="size-8 text-primary" />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Мы добавили страницу, чтобы ссылка уже работала. Полный раздел появится после запуска функции.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="stitch-panel p-5 sm:p-6">
          <h2 className="font-display text-2xl font-bold">Что здесь будет</h2>
          <div className="mt-5 grid gap-3">
            {page.details.map((item) => (
              <p
                className="rounded-md border border-border bg-background/35 p-4 text-sm leading-6 text-muted-foreground"
                key={item}
              >
                {item}
              </p>
            ))}
          </div>
        </section>
        <aside className="stitch-panel h-fit p-5">
          <p className="stitch-label text-muted-foreground">Пока можно открыть</p>
          <Button asChild className="mt-4 w-full justify-center">
            <Link href={page.ctaHref} prefetch={false}>
              {page.ctaLabel}
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        </aside>
      </div>
    </section>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className="grid max-w-[76ch] gap-4 text-sm leading-6 text-muted-foreground">
      {blocks.map((block, index) => {
        if (block.type === "h2") {
          return (
            <h2
              className="pt-3 font-display text-lg font-bold leading-tight text-foreground"
              key={index}
            >
              {renderInline(block.value)}
            </h2>
          );
        }

        if (block.type === "h3") {
          return (
            <h3 className="pt-2 text-base font-bold leading-tight text-foreground" key={index}>
              {renderInline(block.value)}
            </h3>
          );
        }

        if (block.type === "list") {
          return (
            <ul className="grid list-disc gap-2 pl-5" key={index}>
              {block.items.map((item) => (
                <li key={item}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "code") {
          return (
            <pre
              className="overflow-x-auto rounded-md border border-border bg-background/55 p-4 font-telemetry text-sm text-foreground"
              key={index}
            >
              <code>{block.value}</code>
            </pre>
          );
        }

        return (
          <p className={cn(block.value.startsWith("**") && "text-foreground")} key={index}>
            {renderInline(block.value)}
          </p>
        );
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "code"; value: string }
  | { type: "h2"; value: string }
  | { type: "h3"; value: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; value: string };

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.trim().split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    blocks.push({ type: "paragraph", value: paragraph.join(" ").trim() });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd() ?? "";
    const trimmed = line.trim();

    if (!trimmed || trimmed === "---") {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith("```")) {
      flushParagraph();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index]?.trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      blocks.push({ type: "code", value: codeLines.join("\n") });
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushParagraph();
      blocks.push({ type: "h3", value: trimmed.slice(4) });
      continue;
    }

    if (trimmed.startsWith("## ")) {
      flushParagraph();
      blocks.push({ type: "h2", value: trimmed.slice(3) });
      continue;
    }

    if (trimmed.startsWith("- ")) {
      flushParagraph();
      const items = [trimmed.slice(2)];

      while (lines[index + 1]?.trim().startsWith("- ")) {
        index += 1;
        items.push(lines[index]?.trim().slice(2) ?? "");
      }

      blocks.push({ type: "list", items });
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();

  return blocks;
}

function renderInline(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong className="font-semibold text-foreground" key={index}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part === "RaceSide") {
      return (
        <span className="font-semibold text-foreground" key={index}>
          {part}
        </span>
      );
    }

    return part;
  });
}

export function DocumentIcon() {
  return <FileText aria-hidden="true" className="size-5" />;
}
