"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarView } from "./Sidebar";
import { WalletSession } from "./WalletSession";

/** One authenticated layout: persistent sidebar on desktop, Sheet drawer below 1024px, compact topbar everywhere. */
export function AppShell({ children, footer }: { children: React.ReactNode; footer: React.ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="shell">
        <aside className="sidebar" aria-label="Sidebar">
          <SidebarView active={pathname} />
        </aside>
        <div className="shell-main">
          <header className="topbar">
            <Sheet open={drawer} onOpenChange={setDrawer}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="topbar-menu" aria-label="Open navigation">Menu</Button>
              </SheetTrigger>
              <SheetContent side="left" className="sidebar-sheet w-[280px] max-w-[85vw] gap-0 border-r p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                  <SheetDescription>Main sections of the Optra application.</SheetDescription>
                </SheetHeader>
                <SidebarView active={pathname} onNavigate={() => setDrawer(false)} />
              </SheetContent>
            </Sheet>
            <div className="topbar-mode" role="note">
              <strong>PAPER</strong>
              <span>Virtual USDG. Option premiums are modeled. Real-money execution is disabled.</span>
            </div>
            <div className="topbar-session"><WalletSession /></div>
          </header>
          <div className="app-content">{children}</div>
          {footer}
        </div>
      </div>
    </TooltipProvider>
  );
}
