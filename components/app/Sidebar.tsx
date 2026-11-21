import Link from "next/link";
import { BrandMark } from "../brand";
import { Activity, FlaskConical, Hammer, Layers, ScrollText, ShieldCheck, Webhook } from "lucide-react";
import type { ComponentType } from "react";

export const navGroups = [
  { label: "Workspace", items: [
    { href: "/agents", label: "Agents", icon: Layers },
    { href: "/forge", label: "Forge", icon: Hammer },
    { href: "/lab", label: "Lab", icon: FlaskConical },
    { href: "/tape", label: "Tape", icon: ScrollText },
  ] },
  { label: "Reference", items: [
    { href: "/hooks", label: "Hooks", icon: Webhook },
    { href: "/market", label: "Market", icon: Activity },
    { href: "/verify", label: "Verify", icon: ShieldCheck },
  ] },
] as const satisfies readonly { label: string; items: readonly { href: string; label: string; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }[] }[];

/**
 * The sidebar markup. The real app shell and the landing-page product preview both render this, so they cannot drift apart.
 * `interactive={false}` renders inert text instead of links.
 */
export function SidebarView({ active, interactive = true, onNavigate, preview }: { active?: string; interactive?: boolean; onNavigate?: () => void; preview?: { screens: readonly string[]; onSelect: (href: string) => void } }) {
  const brand = (
    <>
      <BrandMark />
      <span className="brand-word">OPTRA</span>
      <span className="brand-sub">AGENT</span>
    </>
  );
  return (
    <>
      <div className="sidebar-brand">
        {interactive
          ? <Link className="brand" href="/" aria-label="Optra home" onClick={onNavigate}>{brand}</Link>
          : <span className="brand">{brand}</span>}
      </div>
      <nav className="sidebar-nav" aria-label={interactive ? "Main navigation" : undefined}>
        {navGroups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <p className="sidebar-label">{group.label}</p>
            {group.items.map((item) => {
              const current = active === item.href || Boolean(active?.startsWith(`${item.href}/`));
              const Icon = item.icon;
              const content = <><Icon className="sidebar-icon" aria-hidden /><span>{item.label}</span></>;
              if (preview?.screens.includes(item.href)) {
                return <button key={item.href} type="button" className="sidebar-link" aria-current={current ? "page" : undefined} onClick={() => preview.onSelect(item.href)}>{content}</button>;
              }
              return interactive
                ? <Link key={item.href} className="sidebar-link" href={item.href} aria-current={current ? "page" : undefined} onClick={onNavigate}>{content}</Link>
                : <span key={item.href} className="sidebar-link" aria-current={current ? "page" : undefined}>{content}</span>;
            })}
          </div>
        ))}
      </nav>
    </>
  );
}
