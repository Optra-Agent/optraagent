import Link from "next/link";
import { WalletSession } from "./WalletSession";

const navigation = [
  { href: "/agents", label: "Agents" },
  { href: "/market", label: "Market" },
  { href: "/lab", label: "Lab" },
  { href: "/forge", label: "Forge" },
  { href: "/hooks", label: "Hooks" },
  { href: "/tape", label: "Tape" },
];

export function AppNav() {
  return (
    <header className="app-header">
      <Link className="brand" href="/agents" aria-label="Optra home">OPTRA <span>AGENT</span></Link>
      <nav className="primary-nav" aria-label="Main navigation">
        {navigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
      </nav>
      <div className="header-session"><WalletSession /></div>
    </header>
  );
}
