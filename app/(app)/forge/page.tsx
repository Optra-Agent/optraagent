import type { Metadata } from "next";
import { ForgeScreen } from "../../../components/app/forge/ForgeScreen";

export const metadata: Metadata = { title: "Forge" };

export default function ForgePage() {
  return <ForgeScreen />;
}
