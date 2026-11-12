"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const sections = [
  { href: "#agents", label: "Agents" },
  { href: "#forge", label: "Forge and hooks" },
  { href: "#how", label: "How it works" },
  { href: "#tape", label: "Tape" },
  { href: "#status", label: "Status" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <header className="m-header" ref={ref}>
      <div className="m-header-inner">
        <Link className="brand" href="/" aria-label="Optra Agent home">OPTRA <span>AGENT</span></Link>
        <nav className={`m-nav${open ? " is-open" : ""}`} id="m-nav" aria-label="Page sections">
          {sections.map((item) => <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>)}
        </nav>
        <Link className="button button-primary button-sm m-launch" href="/agents">Launch app</Link>
        <button className="nav-toggle" type="button" aria-expanded={open} aria-controls="m-nav" onClick={() => setOpen(!open)}>
          <span className="nav-toggle-label">{open ? "Close" : "Menu"}</span>
          <span className="nav-toggle-bars" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
