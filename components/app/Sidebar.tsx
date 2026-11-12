import Link from "next/link";

export const navGroups = [
  { label: "Workspace", items: [
    { href: "/agents", label: "Agents" },
    { href: "/forge", label: "Forge" },
    { href: "/lab", label: "Lab" },
    { href: "/tape", label: "Tape" },
  ] },
  { label: "Reference", items: [
    { href: "/hooks", label: "Hooks" },
    { href: "/market", label: "Market" },
    { href: "/verify", label: "Verify" },
  ] },
] as const;

/**
 * The sidebar markup. The real app shell and the landing-page preview both render this, so they cannot drift apart.
 * `interactive={false}` renders inert text instead of links.
 */
export function SidebarView({ active, interactive = true, onNavigate }: { active?: string; interactive?: boolean; onNavigate?: () => void }) {
  return (
    <>
      <div className="sidebar-brand">
        {interactive
          ? <Link className="brand" href="/" aria-label="Optra home" onClick={onNavigate}>OPTRA <span>AGENT</span></Link>
          : <span className="brand">OPTRA <span>AGENT</span></span>}
      </div>
      <nav className="sidebar-nav" aria-label={interactive ? "Main navigation" : undefined}>
        {navGroups.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <p className="sidebar-label">{group.label}</p>
            {group.items.map((item) => {
              const current = active === item.href || Boolean(active?.startsWith(`${item.href}/`));
              return interactive
                ? <Link key={item.href} className="sidebar-link" href={item.href} aria-current={current ? "page" : undefined} onClick={onNavigate}>{item.label}</Link>
                : <span key={item.href} className="sidebar-link" aria-current={current ? "page" : undefined}>{item.label}</span>;
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <strong>PAPER MODE</strong>
        <span>Virtual USDG. Modeled premiums. Live trading is disabled.</span>
      </div>
    </>
  );
}
