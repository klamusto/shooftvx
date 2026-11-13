import type { Metadata } from "next";
import { WatchClient } from "@/components/watch-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ matchId: string }>;
}): Promise<Metadata> {
  const { matchId } = await params;
  return {
    title: `مشاهدة المباراة ${matchId} بث مباشر`,
    description: "شاهد المباراة بث مباشر بجودة عالية وبدون تقطيع على شوف تيفي Shoof TV.",
  };
}

export default async function WatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  return <WatchClient matchId={matchId} />;
}
