"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WalletSession } from "./WalletSession";

const navigation = [
  { href: "/agents", label: "Agents" },
  { href: "/forge", label: "Forge" },
  { href: "/lab", label: "Lab" },
  { href: "/tape", label: "Tape" },
  { href: "/hooks", label: "Hooks" },
  { href: "/market", label: "Market" },
  { href: "/verify", label: "Verify" },
];

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const headerRef = useRef<HTMLElement>(null);
  const menuOpen = open && openedAt === pathname;

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (headerRef.current && event.target instanceof Node && !headerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  return (
    <header className="app-header" ref={headerRef}>
      <Link className="brand" href="/" aria-label="Optra home">OPTRA <span>AGENT</span></Link>
      <nav className={`primary-nav${menuOpen ? " is-open" : ""}`} id="primary-nav" aria-label="Main navigation">
        {navigation.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>{item.label}</Link>;
        })}
      </nav>
      <div className="header-session"><WalletSession /></div>
      <button
        className="nav-toggle"
        type="button"
        aria-expanded={menuOpen}
        aria-controls="primary-nav"
        onClick={() => { setOpenedAt(pathname); setOpen(!menuOpen); }}
      >
        <span className="nav-toggle-label">{menuOpen ? "Close" : "Menu"}</span>
        <span className="nav-toggle-bars" aria-hidden="true" />
      </button>
    </header>
  );
}
