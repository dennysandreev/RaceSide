import assert from "node:assert/strict";
import test from "node:test";
import {
  canShowPlusOffer,
  getPlusOfferAudience,
  isPlusOfferRoute,
  PLUS_OFFER_COOLDOWN_MS,
} from "./plus-offer-policy.ts";

test("guests see registration, free accounts see Plus, subscribers see neither", () => {
  assert.equal(getPlusOfferAudience(false, false), "guest");
  assert.equal(getPlusOfferAudience(true, false), "free");
  assert.equal(getPlusOfferAudience(true, true), null);
});

test("reading pages allow offers, while auth, payment and working surfaces do not", () => {
  for (const pathname of ["/", "/news", "/news/article", "/calendar", "/drivers/norris", "/weekend"]) {
    assert.equal(isPlusOfferRoute(pathname), true, pathname);
  }
  for (const pathname of ["/auth", "/auth/update-password", "/account", "/payment/success", "/plus", "/admin/news", "/telemetry", "/live", "/race-replay", "/fantasy", "/leagues/invite", "/predictions", "/legal/cookies", "/onboarding"]) {
    assert.equal(isPlusOfferRoute(pathname), false, pathname);
  }
  assert.equal(isPlusOfferRoute("/newsletter"), true);
  assert.equal(isPlusOfferRoute("/feedback"), false);
  assert.equal(isPlusOfferRoute("/live-news"), true);
});

test("dismissal suppresses offers for seven days and then permits them", () => {
  const dismissedAt = Date.parse("2026-10-04T09:00:00Z");
  const input = { pathname: "/news", shownThisSession: false, dismissedAt };
  assert.equal(canShowPlusOffer({ ...input, now: dismissedAt }), false);
  assert.equal(canShowPlusOffer({ ...input, now: dismissedAt + PLUS_OFFER_COOLDOWN_MS - 1 }), false);
  assert.equal(canShowPlusOffer({ ...input, now: dismissedAt + PLUS_OFFER_COOLDOWN_MS }), true);
});

test("navigation or reload cannot show the offer again in the same visit", () => {
  assert.equal(canShowPlusOffer({ pathname: "/calendar", shownThisSession: true, dismissedAt: 0, now: Date.now() }), false);
});

test("missing or corrupt stored dates do not break first-time offers", () => {
  const now = Date.parse("2026-10-04T09:00:00Z");
  for (const dismissedAt of [0, -1, NaN, Infinity, now + 1]) {
    assert.equal(canShowPlusOffer({ pathname: "/news", shownThisSession: false, dismissedAt, now }), true);
  }
  assert.equal(canShowPlusOffer({ pathname: "/auth", shownThisSession: false, dismissedAt: NaN, now }), false);
});
