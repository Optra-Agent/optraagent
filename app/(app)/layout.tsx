import Link from "next/link";
import { AppShell } from "../../components/app/AppShell";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AppShell
      footer={
        <footer className="app-footer">
          <p>Paper trading only. Modeled Black–Scholes premiums, 50 bp slippage, venue fees not modeled. Not investment advice.</p>
          <p>
            Live trading disabled · Hooks inspired by Uniswap v4, none deployed onchain · <Link href="/verify">Verify claims</Link>
          </p>
        </footer>
      }
    >
      {children}
    </AppShell>
  );
}
