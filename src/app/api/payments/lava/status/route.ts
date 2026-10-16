import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getUserLavaOrderByInvoice } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const invoiceId = new URL(request.url).searchParams.get("invoiceId");
  if (!invoiceId || !/^[a-f0-9-]{36}$/i.test(invoiceId)) return NextResponse.json({ error: "invalid invoice" }, { status: 400 });
  const order = await getUserLavaOrderByInvoice(user.id, invoiceId.toLowerCase());
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ orderNumber: order.orderNumber, status: order.status, paidAt: order.paidAt }, { headers: { "Cache-Control": "no-store" } });
}
