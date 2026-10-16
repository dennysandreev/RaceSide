"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSyncExternalStore } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";

export function AdminUrlTabs({
  children,
  defaultValue,
  values,
  sourceIds,
}: {
  children: React.ReactNode;
  defaultValue: string;
  values: readonly string[];
  sourceIds?: readonly string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const value = requested && values.includes(requested) ? requested : defaultValue;
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash, () => "");
  const missingSource = value === "sources" && hash.startsWith("#source-") && sourceIds && !sourceIds.includes(hash.slice("#source-".length));

  return (
    <Tabs
      onValueChange={(nextValue) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("tab", nextValue);
        params.set("page", "1");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }}
      value={value}
    >
      {missingSource ? <Alert><AlertDescription>Источник по этой ссылке не найден. Возможно, его удалили. Остальные источники доступны ниже.</AlertDescription></Alert> : null}
      {children}
    </Tabs>
  );
}

function subscribeToHash(notify: () => void) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("popstate", notify);
  };
}
