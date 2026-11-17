"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A slim progress rail on the right edge: one tick per section, the current one named, and a fill that follows the scroll.
 * Each tick is a real link to its section. Hidden below desktop width, where the page menu already does this job.
 */
const STOPS: { id: string; label: string }[] = [
  { id: "intro", label: "Intro" },
  { id: "floor", label: "Floor" },
  { id: "app", label: "App" },
  { id: "agents", label: "Agents" },
  { id: "studio", label: "The agent" },
  { id: "forge", label: "Forge" },
  { id: "how", label: "How" },
  { id: "tape", label: "Tape" },
  { id: "sessions", label: "Risk" },
  { id: "developers", label: "API" },
  { id: "verify", label: "Verify" },
  { id: "faq", label: "FAQ" },
];

export function StageRail() {
  const [active, setActive] = useState(0);
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const line = window.innerHeight * 0.4;
      let current = 0;
      STOPS.forEach((stop, index) => {
        const el = document.getElementById(stop.id);
        if (el && el.getBoundingClientRect().top <= line) current = index;
      });
      setActive(current);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      fillRef.current?.style.setProperty("--p", String(max > 0 ? Math.min(1, window.scrollY / max) : 0));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <nav className="rail" aria-label="Page progress">
      <span className="rail-track" aria-hidden="true"><span ref={fillRef} className="rail-fill" /></span>
      <ol>
        {STOPS.map((stop, index) => (
          <li key={stop.id}>
            <a href={`#${stop.id}`} aria-current={index === active ? "location" : undefined} data-active={index === active ? "1" : "0"} data-passed={index < active ? "1" : "0"}>
              <span className="rail-label">{stop.label}</span>
              <span className="rail-tick" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
