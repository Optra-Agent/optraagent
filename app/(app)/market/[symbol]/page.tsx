import type { Metadata } from "next";
import { MarketDetailScreen } from "../../../../components/app/market/MarketDetailScreen";

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${decodeURIComponent(symbol).toUpperCase().slice(0, 16)} market` };
}

export default async function MarketDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <MarketDetailScreen symbol={decodeURIComponent(symbol).slice(0, 16)} />;
}
