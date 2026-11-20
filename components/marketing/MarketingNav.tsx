"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { BrandMark, XSocialLink } from "../brand";

const sections = [
  { href: "#floor", label: "Floor" },
  { href: "#agents", label: "Agents" },
  { href: "#story", label: "How it works" },
  { href: "/hooks", label: "Hooks" },
  { href: "/lab", label: "Lab" },
  { href: "#proof", label: "Verify" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="m-header">
      <div className="m-header-inner">
        <Link className="brand" href="/" aria-label="Optra Agent home"><BrandMark priority /><span className="brand-word">OPTRA</span> <span className="brand-sub">AGENT</span></Link>
        <nav className="m-nav" aria-label="Page sections">
          {sections.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
        </nav>
        <div className="m-nav-actions">
          <Link className={cn(buttonVariants({ size: "sm" }), "m-launch")} href="/agents">Launch app</Link>
          <XSocialLink className="m-social-link" />
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="m-menu" aria-label="Open page sections">Menu</Button>
          </SheetTrigger>
          <SheetContent side="right" className="sidebar-sheet w-[280px] max-w-[85vw] gap-0 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Page sections</SheetTitle>
              <SheetDescription>Jump to a section of the Optra landing page.</SheetDescription>
            </SheetHeader>
            <div className="sidebar-brand"><span className="brand"><BrandMark /><span className="brand-word">OPTRA</span> <span className="brand-sub">AGENT</span></span></div>
            <nav className="sidebar-nav" aria-label="Page sections menu">
              <div className="sidebar-group">
                {sections.map((item) => <a key={item.href} className="sidebar-link" href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}
              </div>
              <div className="sidebar-group">
                <Link className={cn(buttonVariants(), "mx-3")} href="/agents">Launch app</Link>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
