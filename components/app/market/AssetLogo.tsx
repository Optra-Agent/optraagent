"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { LOCAL_LOGOS } from "./logo-symbols";

/** The server already verified the logo. The browser re-checks scheme and host so a bad value can never load. */
const TRUSTED_HOSTS = new Set(["cdn.robinhood.com"]);
export function trustedLogo(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && TRUSTED_HOSTS.has(parsed.hostname) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Asset logo (verified server logo, else the ticker's local logo), or the ticker's initials when there is none or it fails to load. Decorative: the row names the asset. */
export function AssetLogo({ symbol, logoUrl, size = 36, className }: { symbol: string; logoUrl?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState<readonly string[]>([]);
  // A verified server logo wins. Then the ticker's own logo, served from this app. Then initials.
  const local = LOCAL_LOGOS.has(symbol) ? `/img/stocks/${encodeURIComponent(symbol)}.png` : undefined;
  const src = [trustedLogo(logoUrl), local].find((candidate): candidate is string => Boolean(candidate) && !failed.includes(candidate as string));
  return (
    <span className={cn("asset-logo", className)} data-fallback={src ? "0" : "1"} style={{ width: size, height: size }} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote host is allowlisted above; no image optimizer config is needed
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed((list) => [...list, src])} />
      ) : (
        <span className="asset-initials">{symbol.slice(0, 3)}</span>
      )}
    </span>
  );
}
