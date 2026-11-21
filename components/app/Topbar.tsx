import type { ReactNode } from "react";

export const pageTitles: Record<string, string> = {
  "/agents": "Agents", "/forge": "Forge", "/lab": "Lab", "/tape": "Tape", "/hooks": "Hooks", "/market": "Market", "/verify": "Verify",
};

export function titleFor(pathname: string | null | undefined): string {
  if (!pathname) return "Optra";
  if (/^\/agents\/.+/.test(pathname)) return "Agent";
  return pageTitles[pathname] ?? "Optra";
}

/**
 * The topbar content: where you are, which network, and the wallet. The same view is used by the
 * real app and by the landing preview. Simulated execution is disclosed where it happens (configuration, results, orders), not in the chrome.
 */
export function TopbarView({ title, session, menu, socialLink }: { title: string; session: ReactNode; menu?: ReactNode; socialLink?: ReactNode }) {
  return (
    <>
      {menu}
      <div className="topbar-where">
        <span className="topbar-crumb">Optra</span>
        <span className="topbar-slash" aria-hidden="true">/</span>
        <span className="topbar-page">{title}</span>
      </div>
      <div className="topbar-context">
        <span className="topbar-chip topbar-net" title="Network"><i aria-hidden="true" />Robinhood Chain</span>
      </div>
      <div className="topbar-actions">
        {socialLink}
        <div className="topbar-session">{session}</div>
      </div>
    </>
  );
}
