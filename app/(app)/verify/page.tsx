import type { Metadata } from "next";
import { VerifyScreen } from "../../../components/app/verify/VerifyScreen";

export const metadata: Metadata = { title: "Verify" };

export default function VerifyPage() {
  return <VerifyScreen />;
}
