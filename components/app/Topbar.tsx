import type { ReactNode } from "react";
import { LiveModeButton } from "./LiveMode";

export const pageTitles: Record<string, string> = {
  "/agents": "Agents", "/forge": "Forge", "/lab": "Lab", "/tape": "Tape", "/hooks": "Hooks", "/market": "Market", "/verify": "Verify",
};

export function titleFor(pathname: string | null | undefined): string {
  if (!pathname) return "Optra";
  if (/^\/agents\/.+/.test(pathname)) return "Agent";
  return pageTitles[pathname] ?? "Optra";
}

/**
 * The topbar content: where you are, which network, that this is paper, and the wallet. The same view is used by the
 * real app and by the landing preview. The long disclosure lives in the PAPER chip's title and the sidebar, not on every screen.
 */
export function TopbarView({ title, session, menu }: { title: string; session: ReactNode; menu?: ReactNode }) {
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
        <span className="topbar-chip topbar-paper" role="note" title="Virtual USDG. Option premiums are modeled. Real-money execution is disabled."><strong>PAPER</strong><span className="topbar-paper-text">Real-money execution is disabled</span></span>
        <LiveModeButton />
      </div>
      <div className="topbar-session">{session}</div>
    </>
  );
}
