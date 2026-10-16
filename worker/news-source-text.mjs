// Preserve short paragraphs/headings: they often identify a quote's speaker,
// contain a key number, or qualify the following passage.
export function cleanNewsRssText(value) {
  const clean = decodeNewsEntities(value).replace(/(?:\.{3}|…)\s*Keep reading\s*$/i, "").trim();
  if (clean === decodeNewsEntities(value).trim()) return clean;
  // Discard the cut-off sentence, not the complete facts that precede it.
  const end = [...clean.matchAll(/[.!?](?:\s+|(?=[A-Z]))/g)].at(-1);
  return end ? clean.slice(0, end.index + 1).trim() : clean;
}

export function hasUsableNewsSourceText(value) {
  // Length alone made 390-character RSS reports wait forever. A concise,
  // complete source can support a concise article; absent substance still waits.
  return typeof value === "string" && value.trim().length >= 120 && (value.match(/[\p{L}]+/gu) ?? []).length >= 18;
}

export function truncateNewsSourceText(value, maxLength = 12000) {
  const marker = /\n*\[Текст обрезан для лимита AI-контекста\]\s*$/;
  const wasTruncated = marker.test(value ?? "");
  const clean = String(value ?? "").replace(marker, "").trim();
  if (!wasTruncated && clean.length <= maxLength) return clean;
  const prefix = clean.slice(0, maxLength);
  const end = prefix.lastIndexOf("\n\n");
  return end > 0 ? prefix.slice(0, end).trim() : prefix.replace(/\s+\S*$/, "").trim();
}

export function extractNewsSourceHtml(html, decode = value => value, sourceUrl = "", drivers = []) {
  const body = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  // The Race rankings use raster name banners with empty alt text. Their
  // filenames carry team + initials; resolve a unique driver from DB context.
  // Do not infer identities from an arbitrary photograph or remembered rosters.
  const withHeadings = /^https?:\/\/(?:www\.)?the-race\.com\//i.test(sourceUrl)
    ? body.replace(/<img\b[^>]*>/gi, tag => {
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
      const label = src?.match(/\/([A-Z][A-Z-]*)_([A-Z]{2})\.(?:jpg|png|webp)(?:\?|$)/i);
      const width = Number(tag.match(/\bwidth=["'](\d+)["']/i)?.[1]);
      const height = Number(tag.match(/\bheight=["'](\d+)["']/i)?.[1]);
      if (!label || !height || width / height < 3) return tag;
      let matches = drivers.filter(driver => {
        const words = String(driver.full_name ?? "").split(/\s+/).filter(Boolean);
        return words.length > 1 && words.slice(0, -1).some(word => `${word[0]}${words.at(-1)[0]}`.toUpperCase() === label[2].toUpperCase());
      });
      if (matches.length > 1) matches = matches.filter(driver => {
        const team = Array.isArray(driver.teams) ? driver.teams[0] : driver.teams;
        const key = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        return [team?.name, team?.short_name].some(name => name && key(name) === key(label[1]));
      });
      return matches.length === 1 ? `\n${matches[0].full_name}\n` : tag;
    }) : body;
  const plain = decodeNewsEntities(decode(withHeadings
    .replace(/<(script|style|noscript|svg|nav|aside|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
  const paragraphs = plain.split(/\n+/).map(line => line.replace(/\s+/g, " ").trim())
    .filter(line => line.length > 1)
    .filter(line => !/^(advert|advertisement|subscribe|sign up|cookies?|privacy policy|terms of use)\b/i.test(line));
  if (/^https?:\/\/(?:www\.)?racefans\.net\//i.test(sourceUrl)) {
    let end = paragraphs.findIndex(line => /^(?:Published by|Join the (?:original )?discussion here:|Browse all .* articles)$/i.test(line));
    if (end >= 0) {
      // The related stories start with a race heading immediately above the
      // browse link. It is navigation, not the article's sporting context.
      const heading = paragraphs.slice(0, end).findLastIndex(line => /^\d{4} .+ Grand Prix$/i.test(line));
      if (heading >= 0 && end - heading <= 10) end = heading;
      paragraphs.splice(end);
    }
  }
  return paragraphs.length ? paragraphs.join("\n\n") : null;
}

export function decodeNewsEntities(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
  return String(value ?? "").replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? match;
    const number = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  });
}

export function extractNewsSourceMarkdown(markdown) {
  let content = String(markdown ?? "");
  // RaceFans reader pages include a long navigation glossary before the article.
  // Keep its date/byline but exclude unrelated sporting facts and related stories.
  if (/^URL Source: https?:\/\/(?:www\.)?racefans\.net\//im.test(content)) {
    const articleStart = content.search(/^Posted on\s*$/im);
    if (articleStart >= 0) content = content.slice(articleStart);
    const articleEnd = content.search(/^(?:Join the (?:original )?discussion here:|Published by|\*\*Browse all Formula 1 articles)/im);
    if (articleEnd >= 0) content = content.slice(0, articleEnd);
  }
  const lines = content.split(/\n+/).map(line => line.trim())
    .filter(line => !/^(Title:|URL Source:|Published Time:|Markdown Content:|Advert\b|Menu and widgets|Follow RaceFans)/i.test(line))
    .map(line => line.replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .filter(line => line.length > 1);
  return lines.length ? lines.join("\n\n") : null;
}
