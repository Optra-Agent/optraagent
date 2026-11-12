import type { Metadata } from "next";
import { MarketScreen } from "../../../components/app/market/MarketScreen";

export const metadata: Metadata = { title: "Market data" };

export default function MarketPage() {
  return <MarketScreen />;
}
