/** Keep older saved digests readable after article links were removed from generation. */
export function normalizeDailyDigestBody(value: string): string {
  return value
    .replace(/[ \t]*\[[^\]]+\][ \t]*\([ \t]*https?:\/\/[^)\s]+[ \t]*\)/giu, "")
    .replace(/[ \t]*\(?https?:\/\/[^)\s]+\)?/giu, "")
    .replace(/^[ \t]*-[ \t]+/gm, "• ")
    .replace(/\*\*/g, "")
    .replace(/\\([\\`*_{}\[\]()<>#!|])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
