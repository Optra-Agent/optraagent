import Link from "next/link";
import { AppNav } from "../../components/app/AppNav";

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-frame">
      <div className="paper-banner" role="note">
        <strong>PAPER</strong>
        <span>Virtual USDG. Option premiums are modeled. Real-money execution is disabled.</span>
      </div>
      <AppNav />
      <div className="app-content">{children}</div>
      <footer className="app-footer">
        <p>Paper trading only. Modeled Black–Scholes premiums, 50 bp slippage, venue fees not modeled. Not investment advice.</p>
        <p>
          Live trading disabled · Hooks inspired by Uniswap v4, none deployed onchain · <Link href="/verify">Verify claims</Link>
        </p>
      </footer>
    </div>
  );
}
