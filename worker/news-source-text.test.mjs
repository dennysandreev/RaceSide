import assert from "node:assert/strict";
import test from "node:test";
import { extractNewsSourceHtml, extractNewsSourceMarkdown, decodeNewsEntities, cleanNewsRssText, hasUsableNewsSourceText, truncateNewsSourceText } from "./news-source-text.mjs";

test("a short factual RSS can be processed while missing source substance still waits", () => {
  const snippet = "Mercedes driver George Russell retired from the Malaysian Grand Prix after a power unit failure. He had been running in a podium position late in the race.";
  assert.ok(snippet.length < 400);
  assert.equal(hasUsableNewsSourceText(snippet), true);
  for (const value of [null, "", "Keep reading", "Subscribe to read this story."]) assert.equal(hasUsableNewsSourceText(value), false);
});

test("RSS retains complete facts and removes the unfinished promotional tail", () => {
  assert.equal(cleanNewsRssText("Russell retired late in the race.After starting seventh, he reached second. The power unit ...Keep reading"), "Russell retired late in the race.After starting seventh, he reached second.");
  assert.equal(cleanNewsRssText("A complete report with no promotional tail."), "A complete report with no promotional tail.");
});

test("long sources end at a paragraph boundary without a reader-facing missing-text marker", () => {
  const input = "First complete paragraph.\n\nSecond complete paragraph.\n\nAn unfinished description of another driver";
  assert.equal(truncateNewsSourceText(input, 66), "First complete paragraph.\n\nSecond complete paragraph.");
  assert.equal(truncateNewsSourceText(input + "\n\n[Текст обрезан для лимита AI-контекста]"), "First complete paragraph.\n\nSecond complete paragraph.");
});

test("driver banners preserve a section's actual subject without guessing from a teammate", () => {
  const html = '<article><img src="https://storage.ghost.io/content/images/2026/10/FERRARI_LH.jpg" alt="" width="1000" height="234"><p>Started: 2nd. Finished: 3rd.</p><p>Had a pace advantage over Leclerc.</p></article>';
  const drivers = [{ full_name: "Lewis Hamilton" }, { full_name: "Charles Leclerc" }];
  const result = extractNewsSourceHtml(html, value => value, "https://www.the-race.com/formula-1/rankings/", drivers);
  assert.match(result, /^Lewis Hamilton\n\nStarted/);
  assert.match(result, /pace advantage over Leclerc/);
  assert.doesNotMatch(extractNewsSourceHtml(html, value => value, "https://example.com/article", drivers), /Lewis Hamilton/);
});

test("ambiguous banner initials require a matching DB team; unrelated images do not add names", () => {
  const image = '<img src="https://storage.ghost.io/WILLIAMS_AA.jpg" alt="" width="1000" height="234">';
  const url = "https://www.the-race.com/formula-1/rankings/";
  assert.equal(extractNewsSourceHtml(image, value => value, url, [{ full_name: "Alexander Albon" }, { full_name: "Andrea Kimi Antonelli" }]), null);
  const drivers = [{ full_name: "Alexander Albon", teams: { name: "Williams" } }, { full_name: "Andrea Kimi Antonelli", teams: { name: "Mercedes" } }];
  assert.equal(extractNewsSourceHtml(image, value => value, url, drivers), "Alexander Albon");
  assert.equal(extractNewsSourceHtml(image.replace('height="234"', 'height="1000"'), value => value, url, drivers), null);
});

test("source extraction keeps short speaker names, numbers and caveats", () => {
  const text = extractNewsSourceHtml('<article><nav>Subscribe here</nav><h2>FIA proposal</h2><p>Jon Noble</p><p>The FIA is considering a change.</p><blockquote>Not yet approved.</blockquote><p>Four sessions.</p><script>ignore source</script></article>');
  assert.match(text, /Jon Noble\n\nThe FIA/);
  assert.match(text, /Not yet approved/);
  assert.match(text, /Four sessions/);
  assert.doesNotMatch(text, /Subscribe here|ignore source/);
});

test("reader fallback preserves linked decision makers and author headings", () => {
  const text = extractNewsSourceMarkdown('Title: Page\n## Jon Noble\n[The FIA](https://fia.com) is considering changes.\nNot yet approved.\n![image](https://example.com/image.jpg)');
  assert.match(text, /^Jon Noble\n\nThe FIA is considering changes/);
  assert.match(text, /Not yet approved/);
  assert.doesNotMatch(text, /image.jpg|Title:/);
});

test("HTML quotes remain usable as exact source evidence", () => {
  assert.equal(decodeNewsEntities("F1&#8217;s &ldquo;proposal&rdquo;"), "F1’s “proposal”");
  assert.equal(extractNewsSourceHtml("<article><p>&#x201c;No decision&#x201d;</p></article>"), "“No decision”");
});

test("RaceFans reader excludes navigation and related news before selecting context", () => {
  const result = extractNewsSourceMarkdown('URL Source: https://www.racefans.net/2026/article\nMenu: Hamilton Mercedes 2025\nPosted on\n18 September | Written by Keith Collantine\nOne fan stopped watching.\nJoin the discussion here:\nUnrelated article: 30 races\nPublished by\nAuthor biography');
  assert.match(result, /Keith Collantine/);
  assert.match(result, /One fan stopped watching/);
  assert.doesNotMatch(result, /Mercedes|30 races|biography/);
});

test("RaceFans HTML excludes the related-race heading and author biography", () => {
  const html = '<article><h1>Practice in Malaysia</h1><p>Written by Keith Collantine</p><p>Verstappen did not run soft tyres.</p><p>Advert | Become a Supporter</p><h3>2026 Bahrain Grand Prix</h3><p>Hamilton at another event</p><p>Browse all 2026 Bahrain Grand Prix articles</p><h3>Published by</h3><p>Keith founded the site in 2005.</p></article>';
  const result = extractNewsSourceHtml(html, value => value, 'https://www.racefans.net/2026/10/02/practice/');
  assert.match(result, /Written by Keith Collantine/);
  assert.match(result, /Verstappen did not run soft tyres/);
  assert.doesNotMatch(result, /Bahrain|Hamilton|2005|Advert/);
  assert.match(extractNewsSourceHtml(html, value => value, 'https://example.com/article'), /Bahrain/);
});
test("RaceFans original-discussion links end the article before unrelated headlines", () => {
  const url = "https://www.racefans.net/2026/10/02/featured-comment/";
  const prose = "Norris defended his comments.\n\nJoin the original discussion here:\n\nFerrari fined €10,000\n\nHamilton faces investigation";
  assert.equal(extractNewsSourceHtml(prose, value => value, url), "Norris defended his comments.");
  assert.equal(extractNewsSourceMarkdown(`URL Source: ${url}\n${prose}`), "Norris defended his comments.");
});
