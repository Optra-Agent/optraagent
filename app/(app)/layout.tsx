import Link from "next/link";
import { AppShell } from "../../components/app/AppShell";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppShell
      footer={
        <footer className="app-footer">
          <p>Agents run on paper with modeled Black–Scholes premiums, 50 bp slippage, venue fees not modeled. Real-money orders exist only as wallet-signed CallPut actions you confirm yourself. Not investment advice.</p>
          <p>
            No OPTRA agent places real-money orders · Hooks inspired by Uniswap v4; one experimental guard is deployed, unaudited and uninitialized · <Link href="/verify">Verify claims</Link>
          </p>
        </footer>
      }
    >
      {children}
    </AppShell>
  );
}
