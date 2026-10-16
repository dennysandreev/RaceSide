import { LavaReturn } from "@/components/racemate/lava-return";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ invoiceId?: string }> }) {
  const { invoiceId } = await searchParams;
  return <LavaReturn invoiceId={invoiceId} result="failed" />;
}
