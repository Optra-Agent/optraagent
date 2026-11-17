import Link from "next/link";
import { MarketingNav } from "../../components/marketing/MarketingNav";
import { Splash } from "../../components/marketing/Splash";
import { BrandMark } from "../../components/brand";
import { getForgeDemo } from "../../components/marketing/section-data";
import "./marketing.css";
import "./graph.css";
import "./network.css";
import "./studio.css";
import "./clean.css";
import "./signature.css";

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="m-frame">
      <Splash recipeHash={getForgeDemo().validHash} />
      <a className="skip-link" href="#top">Skip to content</a>
      <div className="paper-banner" role="note">
        <strong>PAPER</strong>
        <span>Virtual USDG. Option premiums are modeled. Real-money execution is disabled.</span>
      </div>
      <MarketingNav />
      <main id="top">{children}</main>
      <footer className="m-footer">
        <div className="m-wrap m-footer-inner">
          <div className="m-footer-lead">
            <Link className="brand" href="/" aria-label="Optra Agent home"><BrandMark /><span className="brand-word">OPTRA</span> <span className="brand-sub">AGENT</span></Link>
            <p>
              Optra Agent is a paper-trading product. Synthetic options priced from Robinhood Chain stock-token prices are not shares and not investment advice. Optra is not affiliated with Robinhood, Uniswap or any exchange.
            </p>
          </div>
          <nav className="m-footer-links" aria-label="Application">
            <Link href="/agents">Agents</Link>
            <Link href="/forge">Forge</Link>
            <Link href="/lab">Lab</Link>
            <Link href="/tape">Tape</Link>
            <Link href="/hooks">Hooks</Link>
            <Link href="/market">Market</Link>
            <Link href="/verify">Verify</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
