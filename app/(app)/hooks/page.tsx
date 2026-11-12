import type { Metadata } from "next";
import { HookCatalogScreen } from "../../../components/app/hooks/HookCatalogScreen";

export const metadata: Metadata = { title: "Hook library" };

export default function HooksPage() {
  return <HookCatalogScreen />;
}
