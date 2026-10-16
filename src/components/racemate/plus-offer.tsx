"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  canShowPlusOffer,
  isPlusOfferRoute,
  PLUS_OFFER_DELAY_MS,
  PLUS_OFFER_DISMISSED_KEY,
  PLUS_OFFER_SESSION_KEY,
  type PlusOfferAudience,
} from "@/lib/plus-offer-policy";

const PlusOfferDialog = dynamic(() => import("./plus-offer-dialog"), {
  ssr: false,
});

// Keep the visit limit when browser storage is unavailable.
let shownThisVisit = false;

function canShow(pathname: string) {
  let dismissedAt = 0;
  let shownThisSession = shownThisVisit;
  try {
    dismissedAt = Number(localStorage.getItem(PLUS_OFFER_DISMISSED_KEY));
  } catch {
    // The offer also works with storage blocked.
  }
  try {
    shownThisSession ||= sessionStorage.getItem(PLUS_OFFER_SESSION_KEY) === "1";
  } catch {
    // Fall back to the in-memory visit limit.
  }
  return canShowPlusOffer({
    pathname,
    shownThisSession,
    dismissedAt,
    now: Date.now(),
  });
}

export function PlusOffer({ audience }: { audience: PlusOfferAudience }) {
  const pathname = usePathname();
  const [offeredPath, setOfferedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!canShow(pathname)) return;
    let timer: ReturnType<typeof setTimeout>;

    function showWhenReady() {
      if (!canShow(pathname)) return;
      const editing = document.activeElement?.closest(
        "input, textarea, select, [contenteditable=true]",
      );
      const anotherOverlay = document.querySelector(
        '[role="dialog"], [role="alertdialog"], details[open]',
      );
      if (document.visibilityState !== "visible" || editing || anotherOverlay) {
        timer = setTimeout(showWhenReady, 1_000);
        return;
      }
      shownThisVisit = true;
      try {
        sessionStorage.setItem(PLUS_OFFER_SESSION_KEY, "1");
      } catch {
        // The in-memory visit limit still prevents repeated offers.
      }
      setOfferedPath(pathname);
    }

    timer = setTimeout(showWhenReady, PLUS_OFFER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pathname]);

  function dismiss() {
    try {
      localStorage.setItem(PLUS_OFFER_DISMISSED_KEY, String(Date.now()));
    } catch {
      // Closing must always work, including in private browsing.
    }
    setOfferedPath(null);
  }

  if (offeredPath !== pathname || !isPlusOfferRoute(pathname)) return null;
  return <PlusOfferDialog audience={audience} onDismiss={dismiss} />;
}
