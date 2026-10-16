import { NextResponse } from "next/server";

import { getNextSession } from "@/data/racemate-repository";
import { consumeIpRateLimit, getRetryAfterSeconds } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = await consumeIpRateLimit("api:next-session", request, 100, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Слишком много запросов." }, {
      status: 429,
      headers: { "Retry-After": getRetryAfterSeconds(limit.resetAt) },
    });
  }

  try {
    const { race, circuit, session, startsAt, startsAtIso, status } = await getNextSession();
    return NextResponse.json({ race, circuit, session, startsAt, startsAtIso, status }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Расписание временно недоступно." }, { status: 503 });
  }
}
